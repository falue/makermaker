import * as THREE from 'three';
import { BASE, toWorld, type Frame, type V3 } from '../doc/frames';
import type { Resolved } from '../doc/resolve';
import type { BasePlane, Profile, SketchPlane } from '../doc/types';

export type ToolKind = 'rect' | 'circle' | 'polygon';
export type DrawnProfile = Resolved<Profile> extends infer P ? (P extends unknown ? Omit<P, 'id'> : never) : never;

/** End face of an extrude step, in world coordinates. */
export interface Cap {
  part: string;
  step: string;
  frame: Frame;
}

export interface SketchResult {
  /** null: a new part at the origin. */
  part: string | null;
  plane: Resolved<SketchPlane>;
  profile: DrawnProfile;
  depth: number;
  mode: 'add' | 'cut';
  /** Sizes typed as text (kept as expressions). */
  typed: Partial<Record<'w' | 'h' | 'd' | 'depth', string>>;
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
  | { kind: 'pull'; target: Target; profile: DrawnProfile; sizes: SketchResult['typed']; t0: number; y0: number; depth: number; typed: string | undefined };

const v3 = (a: V3) => new THREE.Vector3(...a);
const AXIS_NAME: Record<BasePlane, string> = { xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };

/**
 * Draws a rectangle, circle or polygon on a plane and pulls it into an extrusion, as one action:
 * on the top face of a part under the pointer (adds to that part; pulling into it cuts), else on the base plane
 * facing the camera (a new part). Ctrl snaps; typed sizes and depths are exact (incase-style typing).
 */
export class SketchTool {
  private phase: Phase = { kind: 'hover' };
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });

  constructor(
    readonly kind: ToolKind,
    private view: ToolView,
    private host: ToolHost,
  ) {
    view.el.append(this.labels);
    this.host.hint(this.hoverHint());
  }

  dispose() {
    this.clearPreview();
    this.labels.remove();
    this.view.render();
  }

  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const ph = this.phase;
    if (ph.kind === 'hover') {
      const target = this.target(e);
      if (!target) {
        this.host.hint('Draw on the top face of an extrusion, or on empty space · [Esc] stops');
        return true;
      }
      const at = this.point(e, target.frame);
      if (!at) return true;
      this.phase =
        this.kind === 'polygon'
          ? { kind: 'polygon', target, pts: [at], cur: at }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, alt: e.altKey, shift: e.shiftKey };
      this.host.hint(this.kind === 'polygon' ? POLYGON_HINT : SHAPE_HINT);
    } else if (ph.kind === 'shape') this.toPull(); // second click of click-click drawing
    else if (ph.kind === 'polygon') {
      const at = this.point(e, ph.target.frame);
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
      const target = this.target(e);
      this.host.hint(target ? this.hoverHint(target) : 'Only the top faces of extrusions take sketches for now · [Esc] stops');
      return;
    }
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const at = this.point(e, ph.target.frame);
      if (at) ph.cur = at;
      if (ph.kind === 'shape') {
        ph.dragged ||= Math.hypot(e.clientX - ph.px[0], e.clientY - ph.px[1]) > 4;
        Object.assign(ph, { alt: e.altKey, shift: e.shiftKey });
      }
    } else {
      // depth: where the pointer ray passes closest to the normal through the profile centre, from where pulling began;
      // looking along the normal that is undefined, so moving the pointer up pulls towards the viewer
      const n = v3(ph.target.frame.n);
      const facing = n.dot(this.view.ray(e).direction);
      if (Math.abs(facing) > 0.95) {
        if (Number.isNaN(ph.y0)) ph.y0 = e.clientY;
        const c = v3(toWorld(ph.target.frame, ...centre(ph.profile)));
        ph.depth = this.snap(((ph.y0 - e.clientY) / this.view.pixelsPerMm(c)) * -Math.sign(facing), e.ctrlKey);
      } else {
        if (Number.isNaN(ph.t0)) ph.t0 = this.along(e, ph);
        ph.depth = this.snap(this.along(e, ph) - ph.t0, e.ctrlKey);
      }
    }
    this.update();
  }

  up() {
    const ph = this.phase;
    if (ph.kind === 'shape' && ph.dragged) this.toPull();
    this.update();
  }

  dblclick() {
    if (this.phase.kind === 'polygon') this.closePolygon();
    this.update();
  }

  /** Keys while drawing; returns true if used. Letters only count while typing a size, so tool keys still switch tools. */
  key(e: KeyboardEvent): boolean {
    const ph = this.phase;
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull');
    if (e.key === 'Escape') {
      if (ph.kind === 'hover') this.host.done(null);
      else this.reset();
    } else if (ph.kind === 'shape') {
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (e.key === 'Backspace') ph.typed[ph.axis] = ph.typed[ph.axis]?.slice(0, -1) || undefined;
      else if (e.key === 'Tab' && this.kind === 'rect') ph.axis = 1 - ph.axis;
      else if (e.key === 'Enter') this.toPull();
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
    } else return false;
    this.update();
    return true;
  }

  private hoverHint(target?: Target) {
    const what = { rect: 'a rectangle', circle: 'a circle', polygon: 'a polygon' }[this.kind];
    const how = this.kind === 'polygon' ? 'Click corners' : 'Drag (or click twice)';
    return `${how} to draw ${what}${target ? ` on ${target.name}` : ''} · [Ctrl] snaps · [Esc] stops`;
  }

  private reset() {
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
  }

  /** The top face of the part under the pointer, else the base plane facing the camera (null: some other face). */
  private target(e: MouseEvent): Target | null {
    const hit = this.view.hit(e);
    if (!hit) {
      const axis = this.view.facing();
      return { part: null, plane: { kind: 'base', axis, offset: 0 }, frame: BASE[axis], name: AXIS_NAME[axis] };
    }
    const n = hit.face!.normal;
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

  /** Pointer on the frame's plane, in plane coordinates (snapped). */
  private point(e: MouseEvent, f: Frame): UV | null {
    const p = this.view.ray(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(v3(f.n), v3(f.o)), new THREE.Vector3());
    if (!p) return null;
    const d = p.sub(v3(f.o));
    return [this.snap(d.dot(v3(f.x)), e.ctrlKey), this.snap(d.dot(v3(f.y)), e.ctrlKey)];
  }

  /** Parameter along the plane normal through the profile centre closest to the pointer ray. */
  private along(e: MouseEvent, ph: Extract<Phase, { kind: 'pull' }>) {
    const ray = this.view.ray(e);
    const c = v3(toWorld(ph.target.frame, ...centre(ph.profile)));
    const n = v3(ph.target.frame.n);
    const w = c.clone().sub(ray.origin);
    const b = n.dot(ray.direction);
    const denom = 1 - b * b;
    return denom < 1e-6 ? 0 : (b * w.dot(ray.direction) - w.dot(n)) / denom;
  }

  private typed(text: string | undefined) {
    return text === undefined ? undefined : (this.host.length(text) ?? undefined);
  }

  /** The rectangle or circle as drawn so far. */
  private shape(ph: Extract<Phase, { kind: 'shape' }>): DrawnProfile {
    const [au, av] = ph.anchor;
    let du = ph.cur[0] - au;
    let dv = ph.cur[1] - av;
    if (this.kind === 'circle') {
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

  private toPull() {
    const ph = this.phase;
    if (ph.kind !== 'shape') return;
    const profile = this.shape(ph);
    const size = profile.kind === 'rect' ? Math.min(profile.w, profile.h) : profile.kind === 'circle' ? profile.d : 1;
    if (!(size > 0)) return this.host.hint('Too small: drag further or type a size · [Esc] cancels');
    const [a, b] = ph.typed.map((t) => (this.typed(t) === undefined ? undefined : t));
    this.enterPull(ph.target, profile, this.kind === 'circle' ? { d: a } : { w: a, h: b });
  }

  private closePolygon() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const pts = ph.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
    if (pts.length < 3) return this.host.hint('A polygon needs 3 corners · ' + POLYGON_HINT);
    this.enterPull(ph.target, { kind: 'polygon', pts, r: 0 });
  }

  private enterPull(target: Target, profile: DrawnProfile, sizes: SketchResult['typed'] = {}) {
    this.phase = { kind: 'pull', target, profile, sizes, t0: NaN, y0: NaN, depth: 0, typed: undefined };
    this.host.hint(target.part ? PULL_HINT + ' · pulling into the part cuts' : PULL_HINT);
  }

  private commit() {
    const ph = this.phase;
    if (ph.kind !== 'pull') return;
    const depth = this.typed(ph.typed) ?? ph.depth;
    if (!depth) return this.host.hint('Pull the shape up or down, or type a depth · ' + PULL_HINT);
    this.phase = { kind: 'hover' };
    this.host.done({
      part: ph.target.part,
      plane: ph.target.plane,
      profile: ph.profile,
      depth,
      mode: ph.target.part && depth < 0 ? 'cut' : 'add',
      typed: { ...ph.sizes, depth: this.typed(ph.typed) === undefined ? undefined : ph.typed },
    });
  }

  private clearPreview() {
    for (const o of this.view.overlay.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.view.overlay.clear();
  }

  /** Redraws the preview and the size labels. */
  private update() {
    this.clearPreview();
    const labels: [string, THREE.Vector3, boolean][] = []; // text, where, typed into
    const ph = this.phase;
    const fmt = (mm: number) => mm.toFixed(2);
    const label = (name: string, typed: string | undefined, mm: number, at: THREE.Vector3, active: boolean) =>
      labels.push([`${name} ${typed === undefined ? fmt(mm) : `${typed}▏`}`, at, active]);
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
      this.outline(ph.profile, f);
      if (depth) this.solid(ph.profile, f, depth, ph.target.part !== null && depth < 0);
      label('Depth', ph.typed, depth, v3(toWorld(f, ...centre(ph.profile))).addScaledVector(v3(f.n), depth), true);
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

  private outline(p: DrawnProfile, f: Frame) {
    const pts = shape2d(p).getPoints(48).map((q) => v3(toWorld(f, q.x, q.y)));
    this.view.overlay.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3b6fd8, depthTest: false })));
  }

  private solid(p: DrawnProfile, f: Frame, depth: number, cut: boolean) {
    const geo = new THREE.ExtrudeGeometry(shape2d(p), { depth: Math.abs(depth), bevelEnabled: false, curveSegments: 32 });
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

function centre(p: DrawnProfile): UV {
  if (p.kind !== 'polygon') return [p.x, p.y];
  const n = p.pts.length;
  return [p.pts.reduce((s, q) => s + q[0], 0) / n, p.pts.reduce((s, q) => s + q[1], 0) / n];
}

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
