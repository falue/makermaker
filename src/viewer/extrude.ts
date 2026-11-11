import * as THREE from 'three';
import { caret } from '../ui/complete';
import { inName } from '../doc/expr';
import { extent, toWorld, type Frame, type V3 } from '../doc/frames';
import type { Area } from '../doc/types';
import { area, inside, type DrawnProfile } from '../doc/profiles';
import type { AreaMesh } from '../kernel/build';
import { aimInto, FRONT, onBody, OP_HINT, planeHit, pullBy, pullCuts, pullName, pulled, pullKey, pullOp, pullTap, reachInto, sizeLabel, typeInto, uvOf, type PullOp, type Pulling, type Target, type Tool, type ToolHost, type ToolView } from './sketch';
import { pressed, role, toggles } from '../ui/keys';
import { keepInside } from '../ui/inside';

const v3 = (a: V3) => new THREE.Vector3(...a);
const PICK_HINT = 'Click a face or sketch to extrude · [Shift]-click: more (again: drops it) · double-click: everything inside a shape · a sketch in the list: all of it · [Enter] pulls them · [Esc] stops';
const PULL_HINT = 'Pull, or type a depth · [Tab] how far back · [T] to object · [D] measure · [Alt] held: both ways from the plane · [Shift] coarse · [Ctrl] precise · click or [Enter]: done · [Esc] back to picking';

/**
 * A face of a body: where it was clicked, its outward normal (world), which face of which mesh, the finish (fillet /
 * chamfer) it belongs to, and if round its axis (see `PickedFace`).
 */
export type FaceItem = { body: string; point: THREE.Vector3; n: THREE.Vector3; mesh: THREE.Mesh; index: number; finish?: string; round?: { at: THREE.Vector3; dir: THREE.Vector3; length: number; r: number; shaft: boolean } };

/** A shown sketch's areas (where shapes overlap, each piece is one) and which of them are picked. */
export type AreaGroup = { target: Target; areas: AreaMesh[]; picked: Set<number> };

/** What to pull: per sketch its picked areas (and the shapes they need), the faces, and how far. */
export type ExtrudeResult = {
  groups: { target: Target; shapes: string[]; areas: Area[] }[];
  faces: FaceItem[];
  depth: number;
  depthTyped?: string;
  back: number;
  backTyped?: string;
  /** Sketches on a body: what the pull does to it. */
  op: PullOp;
};

export interface ExtrudeHost {
  /** Whether a face can be pulled (else it says why). */
  accept(face: FaceItem): boolean;
  /** While pulling: the faces at `mm` (shown in the model). */
  live(faces: FaceItem[], mm: number): void;
  /** A pull dropped (Esc): the faces back where they were. */
  cancel(): void;
  /** Pulled (null: the tool stops). */
  done(r: ExtrudeResult | null): void;
  /** A fillet or chamfer clicked: its size is dragged instead. */
  resize(face: FaceItem): void;
}

export interface ExtrudeView extends ToolView {
  /** The closed sketch shape whose outline is under the pointer, in front of any body; null: none. */
  outlineAt(e: MouseEvent): { sketch: string; shape: string } | null;
  faceItem(hit: THREE.Intersection): FaceItem;
  /** Lights picked faces (orange) and the hovered one (blue). */
  markFaces(picked: FaceItem[], hover?: FaceItem | null): void;
}

type Hit = { group: AreaGroup; idx: number[] } | { face: FaceItem } | null;
const same = (a: FaceItem, b: FaceItem) => a.mesh === b.mesh && a.index === b.index;

/**
 * Extrude: pick faces and areas of the shown sketches (a plain first click pulls at once, Shift / Ctrl-click picks more
 * first), then pull them all by one distance. `focus`: the sketch in sketch mode, its areas shown faintly.
 */
export class ExtrudeTool implements Tool {
  readonly kind = null;
  private hover: Hit = null;
  private pull: Pulling | null = null;
  /** Pulling: waiting for the click that sets how far ("to object"); what the pointer would reach meanwhile. */
  private reaching = false;
  /** The Measure tool is on, this one waits for it. */
  private measuring = false;
  private aimed: string | null = null;
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });

  constructor(
    private view: ExtrudeView,
    private host: ToolHost,
    private x: ExtrudeHost,
    private groups: AreaGroup[],
    private faces: FaceItem[],
    private focus?: string,
  ) {
    view.el.append(this.labels);
    addEventListener('keyup', this.keyUp);
    host.hint(PICK_HINT);
    this.update();
  }

  /** Alt tapped while pulling on a body: the next operation. */
  private keyUp = (e: KeyboardEvent) => {
    if (this.pull && this.onBody() && pullTap(e, this.pull, { depth: this.depths().depth, cuts: this.cuts() })) this.update();
  };

  dispose() {
    removeEventListener('keyup', this.keyUp);
    this.view.aimAt(null);
    this.view.markFaces([]);
    this.host.cursorTip(null);
    this.view.unlockPointer();
    this.clear();
    this.labels.remove();
    this.view.render();
  }

  /** Still picking (not pulling). */
  picking() {
    return !this.pull;
  }

  /** How many faces and areas are picked. */
  count() {
    return this.faces.length + this.groups.reduce((n, g) => n + g.picked.size, 0);
  }

  /**
   * A sketch's areas picked, or dropped if they all were (false: it has none): inside its `shapes` (none: all its
   * shapes) an odd number of times, so shapes inside others are holes; with no shapes given, the faces lines enclose too.
   */
  pickSketch(id: string, shapes: string[] = []) {
    const g = this.groups.find((k) => k.target.sketch === id);
    const idx = g?.areas.flatMap((a, i) => {
      const n = shapes.length ? a.in.filter((s) => shapes.includes(s)).length : a.in.length;
      return n % 2 || (!shapes.length && !a.in.length) ? [i] : [];
    });
    if (!g || !idx?.length) return false;
    this.toggle({ group: g, idx });
    this.update();
    return true;
  }

  down(e: PointerEvent) {
    if (e.button !== 0) return false;
    if (this.pull && this.reaching) {
      // "to object": the clicked point's distance goes into the typed depth (or back)
      if (!this.view.pointAt(e)) return true;
      this.reaching = false;
      this.aimed = null;
      const pull = this.pull;
      void this.view.truePointAt(e).then((p) => {
        if (this.pull !== pull || !p) return;
        reachInto(pull, p, this.ref().frame, this.host);
        this.changed();
      });
      this.view.aimAt(null);
    } else if (this.pull) this.commit();
    else {
      const hit = this.hitAt(e);
      // empty space: with nothing picked the tool ends
      if (!hit) return this.count() || this.x.done(null), true;
      const first = !this.count() && !toggles(e);
      if (first && 'face' in hit && hit.face.finish) return this.x.resize(hit.face), true;
      this.toggle(hit);
      if (first && this.count()) this.startPull();
      this.update();
    }
    return true;
  }

  move(e: PointerEvent) {
    if (this.measuring) return;
    if (this.reaching) return this.aim(this.view.aimAt(e)); // aiming at what to reach
    if (this.pull) {
      const { frame, at } = this.ref();
      pullBy(this.view, e, frame.n, at, this.pull);
      const step = this.view.step(at, e);
      this.pull.depth = Math.round(this.pull.raw / step) * step;
      this.pull.alt = role(e, 'centre');
      return this.changed();
    }
    this.hover = this.hitAt(e);
    this.update();
  }

  up() {}

  refresh() {
    this.update();
  }

  /** Picks everything inside the shape under the pointer (the smallest there): all areas that lie in it. */
  dblclick(e: MouseEvent) {
    const hit = this.pull ? null : this.hitAt(e);
    if (!hit || !('group' in hit) || hit.idx.length !== 1) return;
    const g = hit.group;
    const shapes = this.view.sketches.find((s) => s.id === g.target.sketch)?.shapes ?? [];
    const sized = g.areas[hit.idx[0]].in.flatMap((id) => shapes.filter((q) => q.id === id)).sort((a, b) => area(a) - area(b));
    if (!sized.length) return;
    g.areas.forEach((a, k) => a.in.includes(sized[0].id) && g.picked.add(k));
    this.update();
  }

  clicks() {
    return !this.pull;
  }

  key(e: KeyboardEvent) {
    const p = this.pull;
    if (p) {
      if (pressed(e, 'cancel')) return this.drop(), true;
      if (pressed(e, 'confirm')) return this.commit(), true;
      const typing = inName((p.side ? p.typedBack : p.typed) ?? '');
      if (pressed(e, 'measureValue') && !typing) {
        this.measuring = true;
        this.view.unlockPointer();
        const pull = this.pull!;
        // the depth measured counts from the start: a free pull before goes (faces back, measured where they were)
        if (!pull.side) [pull.raw, pull.depth] = [0, 0];
        this.changed();
        this.host.measure(
          (mm) => {
            typeInto(pull, this.host.lengthText(mm));
            this.changed();
          },
          () => (this.measuring = false),
        );
        return true;
      }
      if (pressed(e, 'toObject') && !typing) {
        // the next click picks how far: the pointer shows again for it
        this.reaching = true;
        this.view.unlockPointer();
        this.host.hint('To object: click a corner, edge or face · its distance goes into the size (type on to calculate with it) · [Esc] cancels');
        return this.aim(this.view.aimHere()), true;
      }
      if (!pullKey(e, p, this.onBody())) return false;
      this.host.hint(this.pullHint());
      this.changed();
      return true;
    }
    if (pressed(e, 'cancel')) this.x.done(null);
    else if ((pressed(e, 'confirm') || pressed(e, 'pullPicked')) && this.count()) (this.startPull(), this.update());
    else return false;
    return true;
  }

  /** A face or areas picked, or dropped if picked already (all of them, for several areas). */
  private toggle(hit: NonNullable<Hit>) {
    if ('face' in hit) {
      const k = this.faces.findIndex((f) => same(f, hit.face));
      if (k >= 0) this.faces.splice(k, 1);
      else if (this.x.accept(hit.face)) this.faces.push(hit.face);
      return;
    }
    const { group, idx } = hit;
    if (idx.every((i) => group.picked.has(i))) idx.forEach((i) => group.picked.delete(i));
    else idx.forEach((i) => group.picked.add(i));
  }

  /** What a click there picks: a closed shape's outline (all areas inside it), the nearest area in front of any body, else a body's face. */
  private hitAt(e: MouseEvent): Hit {
    const out = this.view.outlineAt(e);
    const og = out && this.groups.find((g) => g.target.sketch === out.sketch);
    if (og) return { group: og, idx: og.areas.flatMap((a, i) => (a.in.includes(out!.shape) ? [i] : [])) };
    const body = this.view.hit(e);
    const ray = this.view.ray(e);
    let best: { group: AreaGroup; i: number; d: number } | null = null;
    for (const g of this.groups) {
      const p = planeHit(ray, g.target.frame);
      const d = p?.distanceTo(ray.origin) ?? Infinity;
      if (d > (body?.distance ?? Infinity) + 1e-3 || (best && d >= best.d)) continue;
      const i = areaAt(g.areas, uvOf(g.target.frame, p!), this.view.sketches.find((s) => s.id === g.target.sketch)?.shapes ?? []);
      if (i !== null) best = { group: g, i, d };
    }
    if (best) return { group: best.group, idx: [best.i] };
    return body ? { face: this.view.faceItem(body) } : null;
  }

  /** Aiming "to object": the depth follows what the pointer would reach, the pointer's note says what. */
  private aim(s: { at: THREE.Vector3; what: string } | null) {
    if (s) aimInto(this.pull!, s.at, this.ref().frame);
    this.aimed = s?.what ?? null;
    this.changed();
  }

  /** What the pull goes along: the first sketch with picked areas (from their middle), else the first face. */
  private ref(): { frame: { o: V3; n: V3 }; at: THREE.Vector3 } {
    const g = this.groups.find((k) => k.picked.size);
    if (g) return { frame: g.target.frame, at: this.middle(g) };
    const f = this.faces[0];
    return { frame: { o: f.point.toArray(), n: f.n.toArray() }, at: f.point.clone() };
  }

  /** Pulling what is picked: the pointer is locked, moving sets the depth. */
  private startPull() {
    this.pull = { raw: 0, depth: 0, typed: undefined };
    this.hover = null;
    this.view.unflatten(v3(this.ref().frame.n));
    this.view.lockPointer();
    this.host.hint(this.pullHint());
  }

  /** Esc while pulling: the faces go back, nothing stays picked, picking again. */
  private drop() {
    this.view.unlockPointer();
    this.view.aimAt(null);
    [this.pull, this.reaching, this.aimed] = [null, false, null];
    if (this.faces.length) this.x.cancel();
    this.faces = [];
    this.groups.forEach((g) => g.picked.clear());
    this.host.hint(PICK_HINT);
    this.update();
  }

  private depths() {
    return pulled(this.pull!, (t) => this.host.length(t));
  }

  /** The pull changed: the faces follow it in the model. */
  private changed() {
    if (this.faces.length) this.x.live(this.faces, this.depths().depth);
    this.update();
  }

  private commit() {
    const { depth, back } = this.depths();
    if (!depth && !back) return this.host.hint('Pull up or down first · ' + this.pullHint());
    const typed = (t: string | undefined) => (t !== undefined && this.host.length(t) !== null ? t : undefined);
    this.view.unlockPointer();
    const groups = this.groups
      .filter((g) => g.picked.size)
      .map((g) => {
        const picked = [...g.picked].map((i) => g.areas[i]);
        return {
          target: g.target,
          shapes: [...new Set(picked.flatMap((a) => [...a.in, ...a.out, ...(a.uses ?? [])]))], // outside shapes cut the areas, lines close them: needed too
          areas: picked.map((a) => ({ in: a.in, out: a.out, ...(a.at ? { at: a.at } : {}) })),
        };
      });
    this.x.done({ groups, faces: this.faces, depth, depthTyped: typed(this.pull!.typed), back, backTyped: typed(this.pull!.typedBack), op: this.op() });
  }

  /** Whether a picked sketch lies on a body (its pull can join or cut it). */
  private onBody() {
    return this.groups.some((g) => g.picked.size && onBody(g.target));
  }

  /** Whether a picked sketch's pull shares volume with the body it lies on (only then it can cut). */
  private cuts() {
    const { depth, back } = this.depths();
    return (!!depth || !!back) && this.groups.some((g) => g.picked.size && g.target.body && pullCuts(this.view, g.target.body, g.target.frame.n, extent(depth, back), (from, to) => prismOf(g.target.frame, [...g.picked].map((i) => g.areas[i].tris), from, to)));
  }

  /** What the pull does to the body its sketch lies on (see `pullOp`). */
  private op() {
    return pullOp(this.pull!, this.onBody(), this.depths().depth, this.cuts());
  }

  private pullHint() {
    return PULL_HINT + (this.onBody() ? OP_HINT : '');
  }

  /** Centre of a sketch's picked areas' corners, on its plane (world). */
  private middle(g: AreaGroup) {
    const sum = new THREE.Vector3();
    let n = 0;
    for (const i of g.picked) {
      const t = g.areas[i].tris;
      for (let k = 0; k < t.length; k += 2, n++) sum.add(v3(toWorld(g.target.frame, t[k], t[k + 1])));
    }
    return n ? sum.divideScalar(n) : v3(g.target.frame.o);
  }

  private clear() {
    for (const o of this.view.overlay.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.view.overlay.clear();
  }

  /** A fill of an area on its sketch's plane. */
  private fill(f: Frame, a: AreaMesh, color: number, opacity: number) {
    const pts: number[] = [];
    for (let k = 0; k < a.tris.length; k += 2) pts.push(...v3(toWorld(f, a.tris[k], a.tris[k + 1])).toArray());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    // on its plane, in front of the face it lies on by a depth offset (no shift in mm)
    this.view.overlay.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, ...FRONT })));
  }

  /** Areas pulled from `from` to `to` along their plane's normal, translucent (see `prismOf`). */
  private prism(f: Frame, all: Float32Array[], [from, to]: [number, number]) {
    this.view.overlay.add(new THREE.Mesh(prismOf(f, all, from, to), new THREE.MeshStandardMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })));
  }

  /** Picked areas and faces orange, the hovered ones blue (the focused sketch's other areas faint); while pulling the areas also at the depth. */
  private update() {
    this.clear();
    const p = this.pull;
    const { depth, back } = p ? this.depths() : { depth: 0, back: 0 };
    const hover = this.hover;
    for (const g of this.groups) {
      const lit = hover && 'group' in hover && hover.group === g ? hover.idx : [];
      g.areas.forEach((a, i) => {
        if (g.picked.has(i)) this.fill(g.target.frame, a, 0xff8c1a, 0.45);
        else if (lit.includes(i)) this.fill(g.target.frame, a, 0x3b6fd8, 0.35);
        else if (g.target.sketch === this.focus && !p) this.fill(g.target.frame, a, 0x3b6fd8, 0.08);
      });
      if (g.picked.size && (depth || back)) this.prism(g.target.frame, [...g.picked].map((i) => g.areas[i].tris), extent(depth, back));
    }
    // pulled faces show in the model itself
    this.view.markFaces(p ? [] : this.faces, hover && 'face' in hover ? hover.face : null);
    // pulling: while aiming what the pointer reaches (what T does is in the size label)
    const pulling = p && this.reaching && [this.aimed, 'Click: its distance goes into the size'].filter(Boolean).join('\n');
    this.host.cursorTip(p ? pulling || null : this.count() ? 'Hit Enter to start extruding' : null);
    this.labels.replaceChildren();
    if (p) {
      // the depth at the end, how far back behind the plane (when it reaches back or is typed into)
      const { frame, at } = this.ref();
      const n = v3(frame.n);
      const shown: [string, string | undefined, number, number, boolean][] = [[pullName(frame.n), p.typed, depth, depth, !p.side]];
      if (back || p.side) shown.push(['Back', p.typedBack, back, -(Math.sign(depth) || 1) * back, !!p.side]);
      for (const [name, typed, mm, along, active] of shown) {
        const op = name !== 'Back' && this.onBody() ? this.op() : undefined; // what it does to the body
        const el = sizeLabel(`${name} ${typed === undefined ? mm.toFixed(2) : caret(typed, active)}`, active, active && !this.reaching, op);
        this.labels.append(el);
        keepInside(el, ...this.view.toScreen(at.clone().addScaledVector(n, along)));
      }
    }
    this.view.render();
  }
}

/**
 * The area containing point (u, v) of its plane, or null: an area of overlapping shapes by their exact outlines
 * (`shapes`: the sketch's), one lines close by its triangles.
 */
function areaAt(areas: AreaMesh[], [u, v]: [number, number], shapes: (DrawnProfile & { id: string })[]) {
  const shape = (id: string) => shapes.find((q) => q.id === id);
  const exact = areas.findIndex((a) => !a.at && a.in.every((id) => shape(id) && inside(shape(id)!, u, v)) && !a.out.some((id) => shape(id) && inside(shape(id)!, u, v)));
  if (exact >= 0) return exact;
  const i = areas.findIndex((a) => {
    if (!a.at) return false;
    const t = a.tris;
    for (let k = 0; k < t.length; k += 6) {
      const d1 = (u - t[k + 2]) * (t[k + 1] - t[k + 3]) - (t[k] - t[k + 2]) * (v - t[k + 3]);
      const d2 = (u - t[k + 4]) * (t[k + 3] - t[k + 5]) - (t[k + 2] - t[k + 4]) * (v - t[k + 5]);
      const d3 = (u - t[k]) * (t[k + 5] - t[k + 1]) - (t[k + 4] - t[k]) * (v - t[k + 1]);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  });
  return i < 0 ? null : i;
}

/**
 * Areas pulled from `from` to `to` along their plane's normal, a solid in the world: their triangles at both ends (the
 * first at `from`), and walls along the outline (triangle edges that only one triangle has).
 */
function prismOf(f: Frame, all: Float32Array[], from: number, to: number) {
  const at = (x: number, y: number, z: number) => v3(toWorld(f, x, y)).addScaledVector(v3(f.n), z).toArray();
  const pts: number[] = [];
  const edges = new Map<string, [number, number, number, number]>();
  for (const t of all)
    for (let k = 0; k < t.length; k += 6) {
      const tri = [0, 2, 4].map((o) => [t[k + o], t[k + o + 1]] as const);
      for (const z of [from, to]) for (const [x, y] of tri) pts.push(...at(x, y, z));
      tri.forEach(([x0, y0], i) => {
        const [x1, y1] = tri[(i + 1) % 3];
        const key = [x0, y0, x1, y1].map((v) => v.toFixed(4));
        const back = `${key[2]},${key[3]},${key[0]},${key[1]}`;
        if (edges.has(back)) edges.delete(back);
        else edges.set(key.join(), [x0, y0, x1, y1]);
      });
    }
  for (const [x0, y0, x1, y1] of edges.values()) pts.push(...at(x0, y0, from), ...at(x1, y1, from), ...at(x1, y1, to), ...at(x0, y0, from), ...at(x1, y1, to), ...at(x0, y0, to));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.computeVertexNormals();
  return geo;
}
