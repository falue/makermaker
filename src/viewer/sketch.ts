import * as THREE from 'three';
import { BASE, toWorld, type Frame, type V3 } from '../doc/frames';
import { area, centre, inside, nesting, type DrawnProfile } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { BasePlane, SketchPlane } from '../doc/types';
import { along } from './gizmo';

export type ToolKind = 'rect' | 'circle' | 'polygon';
export type { DrawnProfile };

/** End face of an extrude step, in world coordinates. */
export interface Cap {
  part: string;
  step: string;
  frame: Frame;
}

/** A drawn shape; sizes typed as text are kept as expressions; `id`: an existing profile reopened for editing. */
export interface Drawn {
  profile: DrawnProfile;
  typed: Partial<Record<'w' | 'h' | 'd', string>>;
  id?: string;
}

export interface SketchResult {
  /** null: a new part at the origin. */
  part: string | null;
  plane: Resolved<SketchPlane>;
  shapes: Drawn[];
  depth: number;
  depthTyped?: string;
  mode: 'add' | 'cut';
  /** The edited step: only its shapes change. */
  edit?: string;
}

/** A sketch to reopen: an existing step's plane and shapes. */
export interface SketchEdit {
  step: string;
  part: string;
  plane: Resolved<SketchPlane>;
  frame: Frame;
  shapes: Drawn[];
}

/** What the tool needs from the viewport. */
export interface ToolView {
  el: HTMLElement;
  overlay: THREE.Group;
  snapStep: number;
  caps: Cap[];
  ray(e: MouseEvent): THREE.Ray;
  /** Nearest part surface under the pointer (cut-away regions excluded). */
  hit(e: MouseEvent): THREE.Intersection | undefined;
  /** Base plane facing the camera most. */
  facing(): BasePlane;
  toScreen(p: THREE.Vector3): [number, number];
  /** Screen pixels per mm at `at`. */
  pixelsPerMm(at: THREE.Vector3): number;
  /** Turns the camera to look straight at a plane with normal `n`. */
  lookAlong(n: THREE.Vector3): void;
  render(): void;
}

export interface ToolHost {
  /** A typed size in mm (expressions and units allowed), or null if invalid. */
  length(text: string): number | null;
  done(result: SketchResult | null): void;
  hint(text: string): void;
}

interface Target {
  part: string | null;
  plane: Resolved<SketchPlane>;
  frame: Frame;
  name: string;
}

type UV = [number, number];

type Phase =
  | { kind: 'hover' }
  /** Rectangle or circle from `anchor`; typed sizes per axis (circle: only 0, the diameter). */
  | { kind: 'shape'; target: Target; anchor: UV; cur: UV; px: [number, number]; dragged: boolean; typed: (string | undefined)[]; axis: number; alt: boolean; shift: boolean }
  | { kind: 'polygon'; target: Target; pts: UV[]; cur: UV }
  /** t0 / y0: where pulling began (along the normal, or the pointer's screen y when looking along the normal). */
  | { kind: 'pull'; target: Target; shapes: Drawn[]; t0: number; y0: number; depth: number; typed: string | undefined };

/** A sketch with several shapes on one plane; `target` is null until the plane is chosen. */
interface Session {
  target: Target | null;
  shapes: Drawn[];
  selected: number | null;
  edit?: string;
}

const v3 = (a: V3) => new THREE.Vector3(...a);
const AXIS_NAME: Record<BasePlane, string> = { xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };
const NAMES: Record<ToolKind, string> = { rect: 'a rectangle', circle: 'a circle', polygon: 'a polygon' };

/**
 * Draws rectangles, circles and polygons on a plane and pulls them into an extrusion.
 * Direct (`kind` given): one shape, drawn on the top face of the part under the pointer (adds to that part; pulling
 * into it cuts) or on the base plane facing the camera (a new part), then pulled. Session (`sketch`): pick a plane,
 * draw any number of shapes (snapping to their corners and centres), then finish and pull them together; shapes
 * inside shapes are holes. Ctrl snaps to the grid; typed sizes and depths are exact (incase-style typing).
 */
export class SketchTool {
  private phase: Phase = { kind: 'hover' };
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });
  private session: Session | null;

  constructor(
    private drawKind: ToolKind | null,
    private view: ToolView,
    private host: ToolHost,
    sketch?: true | SketchEdit,
  ) {
    view.el.append(this.labels);
    this.session = !sketch ? null : sketch === true ? { target: null, shapes: [], selected: null } : this.reopen(sketch);
    this.host.hint(this.hoverHint());
    this.update();
  }

  /** The drawing tool, or null for selecting shapes in a session. */
  get kind() {
    return this.drawKind;
  }

  get inSession() {
    return this.session !== null;
  }

  dispose() {
    this.clearPreview();
    this.labels.remove();
    this.view.render();
  }

  /** In a session: switch the shape to draw (null: select shapes). */
  setKind(kind: ToolKind | null) {
    if (!this.session) return;
    this.drawKind = kind;
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    this.update();
  }

  /** Ends a session: pulls its shapes (or, when editing, keeps the depth); without shapes it cancels. */
  finish() {
    const s = this.session;
    if (!s?.target || !s.shapes.length) return this.host.done(null);
    if (s.edit) return this.host.done({ part: s.target.part, plane: s.target.plane, shapes: s.shapes, depth: 0, mode: 'add', edit: s.edit });
    this.enterPull(s.target, s.shapes);
    this.update();
  }

  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const ph = this.phase;
    const s = this.session;
    if (ph.kind === 'hover') {
      if (s && !s.target) {
        const target = this.target(e);
        if (target) this.choosePlane(target);
        return this.update(), true;
      }
      if (s && !this.drawKind) {
        const at = this.point(e, s.target!.frame, false);
        const hits = at ? s.shapes.map((d, i) => [i, d] as const).filter(([, d]) => inside(d.profile, ...at)) : [];
        hits.sort(([, a], [, b]) => area(a.profile) - area(b.profile)); // the innermost shape
        s.selected = hits[0]?.[0] ?? null;
        return this.update(), true;
      }
      const target = s?.target ?? this.target(e);
      if (!target) {
        this.host.hint('Draw on the top face of an extrusion, or on empty space · [Esc] stops');
        return true;
      }
      const at = this.point(e, target.frame, e.ctrlKey);
      if (!at) return true;
      this.phase =
        this.drawKind === 'polygon'
          ? { kind: 'polygon', target, pts: [at], cur: at }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, alt: e.altKey, shift: e.shiftKey };
      this.host.hint(this.drawKind === 'polygon' ? POLYGON_HINT : SHAPE_HINT);
    } else if (ph.kind === 'shape') this.shapeDone(); // second click of click-click drawing
    else if (ph.kind === 'polygon') {
      const at = this.point(e, ph.target.frame, e.ctrlKey);
      if (!at) return true;
      const [fx, fy] = this.view.toScreen(v3(toWorld(ph.target.frame, ...ph.pts[0])));
      const r = this.view.el.getBoundingClientRect();
      if (ph.pts.length >= 3 && Math.hypot(e.clientX - r.left - fx, e.clientY - r.top - fy) < 8) this.closePolygon();
      else ph.pts.push(at);
    } else if (ph.kind === 'pull') this.commit();
    this.update();
    return true;
  }

  move(e: PointerEvent) {
    const ph = this.phase;
    if (ph.kind === 'hover') {
      if (!this.session?.target) {
        const target = this.target(e);
        this.host.hint(target ? this.hoverHint(target) : 'Only the top faces of extrusions take sketches for now · [Esc] stops');
      }
      return;
    }
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const at = this.point(e, ph.target.frame, e.ctrlKey);
      if (at) ph.cur = at;
      if (ph.kind === 'shape') {
        ph.dragged ||= Math.hypot(e.clientX - ph.px[0], e.clientY - ph.px[1]) > 4;
        Object.assign(ph, { alt: e.altKey, shift: e.shiftKey });
      }
    } else {
      // depth: where the pointer ray passes closest to the normal through the shapes' centre, from where pulling began;
      // looking along the normal that is undefined, so moving the pointer up pulls towards the viewer
      const n = v3(ph.target.frame.n);
      const facing = n.dot(this.view.ray(e).direction);
      if (Math.abs(facing) > 0.95) {
        if (Number.isNaN(ph.y0)) ph.y0 = e.clientY;
        ph.depth = this.snap(((ph.y0 - e.clientY) / this.view.pixelsPerMm(this.middle(ph))) * -Math.sign(facing), e.ctrlKey);
      } else {
        if (Number.isNaN(ph.t0)) ph.t0 = along(this.view.ray(e), this.middle(ph), n);
        ph.depth = this.snap(along(this.view.ray(e), this.middle(ph), n) - ph.t0, e.ctrlKey);
      }
    }
    this.update();
  }

  up() {
    const ph = this.phase;
    if (ph.kind === 'shape' && ph.dragged) this.shapeDone();
    this.update();
  }

  dblclick() {
    if (this.phase.kind === 'polygon') this.closePolygon();
    this.update();
  }

  /** Keys while drawing; returns true if used. Letters only count while typing a size, so tool keys still switch tools. */
  key(e: KeyboardEvent): boolean {
    const ph = this.phase;
    const s = this.session;
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull');
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === 'Escape') {
      if (ph.kind !== 'hover') this.phase = { kind: 'hover' };
      else if (s?.target && this.drawKind) this.drawKind = null; // to selecting
      else if (!s?.shapes.length) return this.host.done(null), true;
      this.host.hint(this.hoverHint());
    } else if (ph.kind === 'shape') {
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (e.key === 'Backspace') ph.typed[ph.axis] = ph.typed[ph.axis]?.slice(0, -1) || undefined;
      else if (e.key === 'Tab' && this.drawKind === 'rect') ph.axis = 1 - ph.axis;
      else if (e.key === 'Enter') this.shapeDone();
      else return false;
    } else if (ph.kind === 'polygon') {
      if (e.key === 'Enter') this.closePolygon();
      else if (e.key === 'Backspace' && ph.pts.length > 1) ph.pts.pop();
      else return false;
    } else if (ph.kind === 'pull') {
      if (typing) ph.typed = (ph.typed ?? '') + e.key;
      else if (e.key === 'Backspace') ph.typed = ph.typed?.slice(0, -1) || undefined;
      else if (e.key === 'Enter') this.commit();
      else return false;
    } else if (s?.target) {
      const kinds: Record<string, ToolKind> = { r: 'rect', c: 'circle', p: 'polygon' };
      if (plain && kinds[e.key.toLowerCase()]) this.setKind(kinds[e.key.toLowerCase()]);
      else if (e.key === 'Enter') this.finish();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected !== null) {
        s.shapes.splice(s.selected, 1);
        s.selected = null;
      } else return false;
    } else return false;
    this.update();
    return true;
  }

  private reopen(edit: SketchEdit): Session {
    const target = { part: edit.part, plane: edit.plane, frame: edit.frame, name: 'this sketch' };
    this.view.lookAlong(v3(edit.frame.n));
    return { target, shapes: edit.shapes, selected: null, edit: edit.step };
  }

  private choosePlane(target: Target) {
    this.session!.target = target;
    this.view.lookAlong(v3(target.frame.n));
    this.host.hint(this.hoverHint());
  }

  private hoverHint(target?: Target) {
    const s = this.session;
    if (s && !s.target) return `Click ${target ? target.name : 'a top face or empty space'} to sketch on it · [Esc] cancels`;
    if (s && !this.drawKind)
      return 'Click a shape to select it · [Del] removes it · [R] [C] [P] draw · [Enter] finishes and pulls · [Esc] with no shapes cancels';
    const how = this.drawKind === 'polygon' ? 'Click corners' : 'Drag (or click twice)';
    if (s) return `${how} to draw ${NAMES[this.drawKind!]} · [R] [C] [P] switch · snaps to corners and centres · [Ctrl] grid · [Enter] finishes · [Esc] selects`;
    return `${how} to draw ${NAMES[this.drawKind!]}${target ? ` on ${target.name}` : ''} · [Ctrl] snaps · [Esc] stops`;
  }

  /** The top face of the part under the pointer, else the base plane facing the camera (null: some other face). */
  private target(e: MouseEvent): Target | null {
    const hit = this.view.hit(e);
    if (!hit) {
      const axis = this.view.facing();
      return { part: null, plane: { kind: 'base', axis, offset: 0 }, frame: BASE[axis], name: AXIS_NAME[axis] };
    }
    const n = hit.face!.normal;
    if (n.dot(this.view.ray(e).direction) > 0) return null; // a back face seen through a section cut
    const id = hit.object.userData.partId as string;
    const cap = [...this.view.caps].reverse().find((c) => {
      const o = v3(c.frame.o);
      return c.part === id && Math.abs(n.dot(v3(c.frame.n))) > 0.999 && Math.abs(hit.point.clone().sub(o).dot(n)) < 1e-3;
    });
    return cap ? { part: id, plane: { kind: 'cap', step: cap.step }, frame: cap.frame, name: 'this face' } : null;
  }

  private snap(v: number, ctrl: boolean) {
    const step = ctrl ? this.view.snapStep : 0.1;
    return Math.round(v / step) * step;
  }

  /** Corners and centres of the session's shapes and the plane origin, where the pointer snaps. */
  private snapPoints(): UV[] {
    const pts: UV[] = [[0, 0]];
    for (const { profile: p } of this.session?.shapes ?? []) {
      if (p.kind === 'polygon') pts.push(...p.pts);
      else pts.push([p.x, p.y]);
      if (p.kind === 'rect') for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push([p.x + (sx * p.w) / 2, p.y + (sy * p.h) / 2]);
      if (p.kind === 'circle') for (const [cx, cy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) pts.push([p.x + (cx * p.d) / 2, p.y + (cy * p.d) / 2]);
    }
    return pts;
  }

  /** Pointer on the frame's plane, in plane coordinates: on a snap point within `px` pixels, else on the grid (Ctrl) or 0.1 mm. */
  private point(e: MouseEvent, f: Frame, grid: boolean, px = 10): UV | null {
    const p = this.view.ray(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(v3(f.n), v3(f.o)), new THREE.Vector3());
    if (!p) return null;
    const r = this.view.el.getBoundingClientRect();
    const near = this.snapPoints().find((q) => {
      const [x, y] = this.view.toScreen(v3(toWorld(f, ...q)));
      return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < px;
    });
    if (near) return near;
    const d = p.sub(v3(f.o));
    return [this.snap(d.dot(v3(f.x)), grid), this.snap(d.dot(v3(f.y)), grid)];
  }

  private typed(text: string | undefined) {
    return text === undefined ? undefined : (this.host.length(text) ?? undefined);
  }

  /** The rectangle or circle as drawn so far. */
  private shape(ph: Extract<Phase, { kind: 'shape' }>): DrawnProfile {
    const [au, av] = ph.anchor;
    let du = ph.cur[0] - au;
    let dv = ph.cur[1] - av;
    if (this.drawKind === 'circle') {
      const d = this.typed(ph.typed[0]) ?? 2 * Math.hypot(du, dv);
      return { kind: 'circle', x: au, y: av, d };
    }
    const k = ph.alt ? 2 : 1; // from the centre, the pointer sets half the size
    if (ph.shift) {
      const s = Math.max(Math.abs(du), Math.abs(dv));
      du = Math.sign(du || 1) * s;
      dv = Math.sign(dv || 1) * s;
    }
    const w = this.typed(ph.typed[0]) ?? Math.abs(du) * k;
    const h = this.typed(ph.typed[1]) ?? Math.abs(dv) * k;
    const sx = Math.sign(du || 1);
    const sy = Math.sign(dv || 1);
    return ph.alt ? { kind: 'rect', x: au, y: av, w, h, r: 0 } : { kind: 'rect', x: au + (sx * w) / 2, y: av + (sy * h) / 2, w, h, r: 0 };
  }

  private shapeDone() {
    const ph = this.phase;
    if (ph.kind !== 'shape') return;
    const profile = this.shape(ph);
    const size = profile.kind === 'rect' ? Math.min(profile.w, profile.h) : profile.kind === 'circle' ? profile.d : 1;
    if (!(size > 0)) return this.host.hint('Too small: drag further or type a size · [Esc] cancels');
    const [a, b] = ph.typed.map((t) => (this.typed(t) === undefined ? undefined : t));
    this.drawn(ph.target, { profile, typed: this.drawKind === 'circle' ? { d: a } : { w: a, h: b } });
  }

  private closePolygon() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const pts = ph.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
    if (pts.length < 3) return this.host.hint('A polygon needs 3 corners · ' + POLYGON_HINT);
    this.drawn(ph.target, { profile: { kind: 'polygon', pts, r: 0 }, typed: {} });
  }

  /** A finished shape: kept in the session, else pulled right away. */
  private drawn(target: Target, shape: Drawn) {
    if (!this.session) return this.enterPull(target, [shape]);
    this.session.shapes.push(shape);
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
  }

  private enterPull(target: Target, shapes: Drawn[]) {
    this.phase = { kind: 'pull', target, shapes, t0: NaN, y0: NaN, depth: 0, typed: undefined };
    this.host.hint(target.part ? PULL_HINT + ' · pulling into the part cuts' : PULL_HINT);
  }

  /** Centre of the pulled shapes, on the sketch plane (world). */
  private middle(ph: Extract<Phase, { kind: 'pull' }>) {
    const cs = ph.shapes.map((d) => centre(d.profile));
    return v3(toWorld(ph.target.frame, cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length));
  }

  private commit() {
    const ph = this.phase;
    if (ph.kind !== 'pull') return;
    const depth = this.typed(ph.typed) ?? ph.depth;
    if (!depth) return this.host.hint('Pull the shapes up or down, or type a depth · ' + PULL_HINT);
    this.phase = { kind: 'hover' };
    this.host.done({
      part: ph.target.part,
      plane: ph.target.plane,
      shapes: ph.shapes,
      depth,
      depthTyped: this.typed(ph.typed) === undefined ? undefined : ph.typed,
      mode: ph.target.part && depth < 0 ? 'cut' : 'add',
    });
  }

  private clearPreview() {
    for (const o of this.view.overlay.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.view.overlay.clear();
  }

  /** Redraws the preview, the session's shapes and grid, and the size labels. */
  private update() {
    this.clearPreview();
    const labels: [string, THREE.Vector3, boolean][] = []; // text, where, typed into
    const ph = this.phase;
    const s = this.session;
    const fmt = (mm: number) => mm.toFixed(2);
    const label = (name: string, typed: string | undefined, mm: number, at: THREE.Vector3, active: boolean) =>
      labels.push([`${name} ${typed === undefined ? fmt(mm) : `${typed}▏`}`, at, active]);
    if (s?.target && ph.kind !== 'pull') {
      this.grid(s.target.frame);
      s.shapes.forEach((d, i) => this.outline(d.profile, s.target!.frame, i === s.selected ? 0xff8c1a : 0x3b6fd8));
    }
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const f = ph.target.frame;
      const profile: DrawnProfile = ph.kind === 'shape' ? this.shape(ph) : { kind: 'polygon', pts: [...ph.pts, ph.cur], r: 0 };
      this.outline(profile, f);
      if (profile.kind === 'rect' && ph.kind === 'shape') {
        label('W', ph.typed[0], profile.w, v3(toWorld(f, profile.x, profile.y - profile.h / 2)), ph.axis === 0);
        label('H', ph.typed[1], profile.h, v3(toWorld(f, profile.x + profile.w / 2, profile.y)), ph.axis === 1);
      }
      if (profile.kind === 'circle' && ph.kind === 'shape') label('Ø', ph.typed[0], profile.d, v3(toWorld(f, profile.x + profile.d / 2, profile.y)), true);
    }
    if (ph.kind === 'pull') {
      const f = ph.target.frame;
      const depth = this.typed(ph.typed) ?? ph.depth;
      for (const d of ph.shapes) this.outline(d.profile, f);
      if (depth) this.solid(ph.shapes.map((d) => d.profile), f, depth, ph.target.part !== null && depth < 0);
      label('Depth', ph.typed, depth, this.middle(ph).addScaledVector(v3(f.n), depth), true);
    }
    const r = this.view.el.getBoundingClientRect();
    this.labels.replaceChildren(
      ...labels.map(([text, at, active]) => {
        const [x, y] = this.view.toScreen(at);
        const el = Object.assign(document.createElement('div'), { className: `size-label${active ? ' active' : ''}`, textContent: text });
        el.style.cssText = `left:${Math.min(Math.max(x, 0), r.width)}px;top:${Math.min(Math.max(y, 0), r.height)}px`;
        return el;
      }),
    );
    this.view.render();
  }

  /** A grid on the sketch plane, `size` mm wide with lines every `step` mm. */
  private grid(f: Frame, size = 400, step = 10) {
    const g = new THREE.GridHelper(size, size / step, 0x3b6fd8, 0x3b6fd8);
    const m = g.material as THREE.LineBasicMaterial;
    Object.assign(m, { transparent: true, opacity: 0.25, depthWrite: false });
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(v3(f.x), v3(f.n), v3(f.y)).setPosition(v3(f.o)); // the helper lies in its x-z plane
    this.view.overlay.add(g);
  }

  private outline(p: DrawnProfile, f: Frame, color = 0x3b6fd8) {
    const pts = shape2d(p).getPoints(48).map((q) => v3(toWorld(f, q.x, q.y)));
    this.view.overlay.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false })));
  }

  /** Translucent extrusion of the shapes; shapes inside an odd number of others are holes. */
  private solid(ps: DrawnProfile[], f: Frame, depth: number, cut: boolean) {
    const level = nesting(ps);
    const shapes = ps.flatMap((p, i) => {
      if (level[i] % 2) return [];
      const outer = shape2d(p);
      outer.holes = ps.filter((q, j) => level[j] === level[i] + 1 && inside(p, ...centre(q))).map(shape2d);
      return [outer];
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: Math.abs(depth), bevelEnabled: false, curveSegments: 32 });
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: cut ? 0xe04040 : 0x3b6fd8, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(v3(f.x), v3(f.y), v3(f.n)).setPosition(v3(f.o).addScaledVector(v3(f.n), Math.min(0, depth)));
    this.view.overlay.add(mesh);
  }
}

const SHAPE_HINT = '[Alt] from the centre · [Shift] square · [Ctrl] snaps · type a size, [Tab] other side · [Enter] or click: done · [Esc] cancels';
const POLYGON_HINT = 'Click corners · click the first one, double-click or [Enter] to finish · [Backspace] removes the last · [Esc] cancels';
const PULL_HINT = 'Move to pull · [Ctrl] snaps · type a depth · click or [Enter]: done · [Esc] cancels';

function shape2d(p: DrawnProfile): THREE.Shape {
  if (p.kind === 'circle') return new THREE.Shape().absarc(p.x, p.y, p.d / 2, 0, Math.PI * 2, false);
  const pts =
    p.kind === 'rect'
      ? [
          [p.x - p.w / 2, p.y - p.h / 2],
          [p.x + p.w / 2, p.y - p.h / 2],
          [p.x + p.w / 2, p.y + p.h / 2],
          [p.x - p.w / 2, p.y + p.h / 2],
        ]
      : p.pts;
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}
