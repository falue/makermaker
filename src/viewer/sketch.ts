import * as THREE from 'three';
import { BASE, toWorld, type Frame, type V3 } from '../doc/frames';
import { centre, corners, inside, nesting, type DrawnProfile } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BasePlane, SketchPlacement } from '../doc/types';

export type ToolKind = 'rect' | 'circle' | 'polygon';
export type { DrawnProfile };

/** End face of an extrude step, in world coordinates. */
export interface Cap {
  part: string;
  step: string;
  frame: Frame;
}

/** A sketch as the viewer shows it: world frame, shapes in mm (with ids). */
export interface ViewSketch {
  id: string;
  frame: Frame;
  placement: Resolved<SketchPlacement>;
  shapes: (DrawnProfile & { id: string })[];
}

/** A drawn shape; sizes typed as text are kept as expressions. */
export interface Drawn {
  profile: DrawnProfile;
  typed: Partial<Record<'w' | 'h' | 'd', string>>;
}

/** Where shapes go: an existing sketch, or a new one at `placement`; `part`: the part whose face it lies on. */
export interface Target {
  sketch: string | null;
  placement: Resolved<SketchPlacement>;
  frame: Frame;
  part: string | null;
  name: string;
}

/** A drawn shape (kept in its sketch) and/or shapes pulled by `depth` (0: left flat). */
export interface SketchResult {
  target: Target;
  drawn?: Drawn;
  /** Existing shapes to pull (E on a selection). */
  shapes?: string[];
  /** Only these areas of the shapes. */
  areas?: Area[];
  depth: number;
  depthTyped?: string;
  mode: 'add' | 'cut';
}

/** What the tool needs from the viewport. */
export interface ToolView {
  el: HTMLElement;
  overlay: THREE.Group;
  snapStep: number;
  caps: Cap[];
  sketches: ViewSketch[];
  /** The selected sketch, drawn into when the pointer is on no other target. */
  activeSketch: string | null;
  ray(e: MouseEvent): THREE.Ray;
  /** Nearest part surface under the pointer (cut-away regions excluded). */
  hit(e: MouseEvent): THREE.Intersection | undefined;
  /** Base plane facing the camera most. */
  facing(): BasePlane;
  toScreen(p: THREE.Vector3): [number, number];
  /** Screen pixels per mm at `at`. */
  pixelsPerMm(at: THREE.Vector3): number;
  /** Hides and locks the pointer while pulling (movement then has no end), and frees it. */
  lockPointer(): void;
  unlockPointer(): void;
  /** Lights the whole face of a hit (none: clears it). */
  markFace(hit?: THREE.Intersection): void;
  /** Part corners in the world, to snap to. */
  corners(): THREE.Vector3[];
  render(): void;
}

/** draw: flat shapes into a fixed sketch (drawing mode); pull: existing shapes; plane: pick a plane for a new drawing. */
export type ToolMode = { kind: 'draw'; target: Target } | { kind: 'pull'; target: Target; ids: string[] } | { kind: 'plane' };

/** A tool that takes the pointer and keys in the viewport. */
export interface Tool {
  readonly kind: ToolKind | null;
  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean;
  move(e: PointerEvent): void;
  up(): void;
  dblclick(): void;
  /** Returns true if the key was used. */
  key(e: KeyboardEvent): boolean;
  dispose(): void;
}

/** A pull's depth before snapping (mm), summed from pointer movement. */
export interface PullStart {
  raw: number;
}

/**
 * Adds the pointer's movement to a pull: along the normal's direction on screen (any way: up, down, sideways), or,
 * looking along the normal, moving up pulls towards the viewer. Movement works with the pointer locked, so a pull
 * has no end at the screen edge.
 */
export function pullBy(view: ToolView, e: PointerEvent, f: Frame, middle: THREE.Vector3, s: PullStart) {
  const n = v3(f.n);
  const [x0, y0] = view.toScreen(middle);
  const [x1, y1] = view.toScreen(middle.clone().add(n));
  const [dx, dy] = [x1 - x0, y1 - y0]; // screen px per mm along the normal
  const ppm = view.pixelsPerMm(middle);
  if (Math.hypot(dx, dy) < 0.2 * ppm) s.raw -= (e.movementY / ppm) * (n.dot(view.ray(e).direction) < 0 ? 1 : -1);
  else s.raw += (e.movementX * dx + e.movementY * dy) / (dx * dx + dy * dy);
}

export interface ToolHost {
  /** A typed size in mm (expressions and units allowed), or null if invalid. */
  length(text: string): number | null;
  /** A finished action (null: cancelled or stopped). After a flat shape the tool goes on. */
  done(result: SketchResult | null): void;
  hint(text: string): void;
}

type UV = [number, number];

type Phase =
  | { kind: 'hover' }
  /** Rectangle or circle from `anchor`; typed sizes per axis (circle: only 0, the diameter). */
  | { kind: 'shape'; target: Target; anchor: UV; cur: UV; px: [number, number]; dragged: boolean; typed: (string | undefined)[]; axis: number; alt: boolean; shift: boolean }
  | { kind: 'polygon'; target: Target; pts: UV[]; cur: UV }
  | { kind: 'pull'; target: Target; drawn?: Drawn; shapes: DrawnProfile[]; ids?: string[]; raw: number; depth: number; typed: string | undefined };

const v3 = (a: V3) => new THREE.Vector3(...a);
const AXIS_NAME: Record<BasePlane, string> = { xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };
const NAMES: Record<ToolKind, string> = { rect: 'a rectangle', circle: 'a circle', polygon: 'a polygon' };

/**
 * Draws rectangles, circles and polygons into sketches and pulls them into extrusions. A shape goes into the sketch
 * under the pointer, or onto the top face of the part under it (that face's sketch; pulling into the part cuts), or
 * into the selected sketch, or onto the base plane facing the camera. Right after drawing, moving pulls; a click
 * without pulling or Esc keeps it flat and the tool goes on. Ctrl snaps to the grid, the pointer to corners and
 * centres; typed sizes and depths are exact (incase-style typing). In drawing mode (`draw`) shapes go flat into its
 * sketch and the tool goes on; `pull` only pulls existing shapes (E); `plane` picks where a new drawing goes.
 */
export class SketchTool implements Tool {
  private phase: Phase = { kind: 'hover' };
  /** The point the pointer snapped to (world), shown as a dot. */
  private snapped: THREE.Vector3 | null = null;
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });

  constructor(
    readonly kind: ToolKind | null,
    private view: ToolView,
    private host: ToolHost,
    readonly mode?: ToolMode,
  ) {
    view.el.append(this.labels);
    if (mode?.kind === 'pull') {
      const sketch = view.sketches.find((s) => s.id === mode.target.sketch);
      this.enterPull(mode.target, sketch?.shapes.filter((s) => mode.ids.includes(s.id)) ?? [], undefined, mode.ids);
    } else this.host.hint(this.hoverHint());
    this.update();
  }

  dispose() {
    this.view.unlockPointer();
    this.view.markFace();
    this.clearPreview();
    this.labels.remove();
    this.view.render();
  }

  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const ph = this.phase;
    if (ph.kind === 'hover' && this.mode?.kind === 'plane') {
      const target = this.target(e);
      if (target) this.host.done({ target, depth: 0, mode: 'add' });
      return true;
    }
    if (ph.kind === 'hover' && this.kind) {
      const target = this.target(e);
      if (!target) {
        this.host.hint('Draw on the top face of an extrusion, on a sketch or on empty space · [Esc] stops');
        return true;
      }
      const at = this.point(e, target, e.ctrlKey);
      if (!at) return true;
      this.view.markFace();
      this.phase =
        this.kind === 'polygon'
          ? { kind: 'polygon', target, pts: [at], cur: at }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, alt: e.altKey, shift: e.shiftKey };
      this.host.hint(this.kind === 'polygon' ? POLYGON_HINT : SHAPE_HINT);
    } else if (ph.kind === 'shape') this.shapeDone(); // second click of click-click drawing
    else if (ph.kind === 'polygon') {
      const at = this.point(e, ph.target, e.ctrlKey);
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
      if (!this.kind && this.mode?.kind !== 'plane') return;
      const target = this.target(e);
      this.view.markFace(target?.part && !target.sketch ? this.view.hit(e) : undefined);
      this.host.hint(target ? this.hoverHint(target) : 'Only the top faces of extrusions take sketches for now · [Esc] stops');
      if (target) this.point(e, target, e.ctrlKey); // shows a snap dot
      return this.update();
    }
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const at = this.point(e, ph.target, e.ctrlKey);
      if (at) ph.cur = at;
      if (ph.kind === 'shape') {
        ph.dragged ||= Math.hypot(e.clientX - ph.px[0], e.clientY - ph.px[1]) > 4;
        Object.assign(ph, { alt: e.altKey, shift: e.shiftKey });
      }
    } else {
      pullBy(this.view, e, ph.target.frame, this.middle(ph), ph);
      ph.depth = this.snap(ph.raw, e.ctrlKey);
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
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull');
    if (e.key === 'Escape') {
      if (ph.kind === 'hover') return this.host.done(null), true;
      if (ph.kind === 'pull') return this.commit(true), this.update(), true; // a drawn shape stays flat
      this.phase = { kind: 'hover' };
      this.host.hint(this.hoverHint());
    } else if (ph.kind === 'shape') {
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (e.key === 'Backspace') ph.typed[ph.axis] = ph.typed[ph.axis]?.slice(0, -1) || undefined;
      else if (e.key === 'Tab' && this.kind === 'rect') ph.axis = 1 - ph.axis;
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
    } else return false;
    this.update();
    return true;
  }

  private hoverHint(target?: Target) {
    if (this.mode?.kind === 'plane') return `Click ${target ? target.name : 'a top face or empty space'} to draw on it · [Esc] cancels`;
    const how = this.kind === 'polygon' ? 'Click corners' : 'Drag (or click twice)';
    if (this.mode?.kind === 'draw') return `${how} to draw ${NAMES[this.kind!]} · [R] [C] [P] switch · snaps to corners and centres · [Ctrl] grid · [Esc] stops drawing shapes`;
    return `${how} to draw ${NAMES[this.kind!]}${target ? ` on ${target.name}` : ''} · [Ctrl] snaps · [Esc] stops`;
  }

  /**
   * Where the pointer draws: a visible sketch whose shape lies under it, the top face of the part under it, the
   * selected sketch, a sketch on the base plane facing the camera, or that plane (null: another face of a part).
   */
  private target(e: MouseEvent): Target | null {
    if (this.mode?.kind === 'draw') return this.mode.target;
    const ray = this.view.ray(e);
    const hit = this.view.hit(e);
    const onSketch = this.view.sketches.find((s) => {
      const p = planeHit(ray, s.frame);
      return p && (!hit || p.distanceTo(ray.origin) <= hit.distance + 1e-3) && s.shapes.some((q) => inside(q, ...uvOf(s.frame, p)));
    });
    if (onSketch) return this.sketchTarget(onSketch);
    if (hit) {
      const n = hit.face!.normal;
      if (n.dot(ray.direction) > 0) return null; // a back face seen through a section cut
      const id = hit.object.userData.partId as string;
      const cap = [...this.view.caps].reverse().find((c) => {
        const o = v3(c.frame.o);
        return c.part === id && Math.abs(n.dot(v3(c.frame.n))) > 0.999 && Math.abs(hit.point.clone().sub(o).dot(n)) < 1e-3;
      });
      if (!cap) return null;
      const existing = this.view.sketches.find((s) => s.placement.kind === 'cap' && s.placement.part === id && s.placement.step === cap.step);
      return existing
        ? this.sketchTarget(existing)
        : { sketch: null, placement: { kind: 'cap', part: id, step: cap.step }, frame: cap.frame, part: id, name: 'this face' };
    }
    const axis = this.view.facing();
    const active = this.view.sketches.find((s) => s.id === this.view.activeSketch);
    const base = active ?? this.view.sketches.find((s) => s.placement.kind === 'base' && s.placement.axis === axis && s.placement.offset === 0);
    return base ? this.sketchTarget(base) : { sketch: null, placement: { kind: 'base', axis, offset: 0 }, frame: BASE[axis], part: null, name: AXIS_NAME[axis] };
  }

  private sketchTarget(s: ViewSketch): Target {
    return { sketch: s.id, placement: s.placement, frame: s.frame, part: s.placement.kind === 'cap' ? s.placement.part : null, name: 'its sketch' };
  }

  private snap(v: number, ctrl: boolean) {
    const step = ctrl ? this.view.snapStep : 0.1;
    return Math.round(v / step) * step;
  }

  /**
   * Where the pointer snaps, in the target's plane coordinates: the plane origin, corners and centres of the shapes of
   * every visible sketch, and part corners (from other planes: projected onto this one).
   */
  private snapPoints(t: Target): UV[] {
    const pts: UV[] = [[0, 0]];
    for (const s of this.view.sketches)
      for (const p of s.shapes) {
        const own: UV[] = [centre(p), ...corners(p)];
        if (p.kind === 'circle') for (const [cx, cy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) own.push([p.x + (cx * p.d) / 2, p.y + (cy * p.d) / 2]);
        pts.push(...(s.id === t.sketch ? own : own.map((q) => uvOf(t.frame, v3(toWorld(s.frame, ...q))))));
      }
    pts.push(...this.view.corners().map((c) => uvOf(t.frame, c)));
    return pts;
  }

  /** Pointer on the target plane, in plane coordinates: on a snap point within `px` pixels, else on the grid (Ctrl) or 0.1 mm. */
  private point(e: MouseEvent, t: Target, grid: boolean, px = 10): UV | null {
    const p = planeHit(this.view.ray(e), t.frame);
    if (!p) return null;
    const r = this.view.el.getBoundingClientRect();
    const near = this.snapPoints(t).find((q) => {
      const [x, y] = this.view.toScreen(v3(toWorld(t.frame, ...q)));
      return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < px;
    });
    this.snapped = near ? v3(toWorld(t.frame, ...near)) : null;
    if (near) return near;
    const [u, v] = uvOf(t.frame, p);
    return [this.snap(u, grid), this.snap(v, grid)];
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
    return ph.alt ? { kind: 'rect', x: au, y: av, w, h, r: 0, rot: 0 } : { kind: 'rect', x: au + (sx * w) / 2, y: av + (sy * h) / 2, w, h, r: 0, rot: 0 };
  }

  private shapeDone() {
    const ph = this.phase;
    if (ph.kind !== 'shape') return;
    const profile = this.shape(ph);
    const size = profile.kind === 'rect' ? Math.min(profile.w, profile.h) : profile.kind === 'circle' ? profile.d : 1;
    if (!(size > 0)) return this.host.hint('Too small: drag further or type a size · [Esc] cancels');
    const [a, b] = ph.typed.map((t) => (this.typed(t) === undefined ? undefined : t));
    this.drawn(ph.target, { profile, typed: this.kind === 'circle' ? { d: a } : { w: a, h: b } });
  }

  private closePolygon() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const pts = ph.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
    if (pts.length < 3) return this.host.hint('A polygon needs 3 corners · ' + POLYGON_HINT);
    const profile: DrawnProfile = { kind: 'polygon', pts, r: 0, rot: 0 };
    this.drawn(ph.target, { profile, typed: {} });
  }

  /** A finished shape: in drawing mode it stays flat and drawing goes on, else pulling starts. */
  private drawn(target: Target, drawn: Drawn) {
    if (this.mode?.kind !== 'draw') return this.enterPull(target, [drawn.profile], drawn);
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    this.host.done({ target, drawn, depth: 0, mode: 'add' });
  }

  private enterPull(target: Target, shapes: DrawnProfile[], drawn?: Drawn, ids?: string[]) {
    this.phase = { kind: 'pull', target, drawn, shapes, ids, raw: 0, depth: 0, typed: undefined };
    this.view.lockPointer();
    const keep = drawn ? ' · click without pulling or [Esc]: keep it flat' : ' · [Esc] cancels';
    this.host.hint(PULL_HINT + (target.part ? ' · pulling into the part cuts' : '') + keep);
  }

  /** Centre of the pulled shapes, on the sketch plane (world). */
  private middle(ph: Extract<Phase, { kind: 'pull' }>) {
    const cs = ph.shapes.map((p) => centre(p));
    return v3(toWorld(ph.target.frame, cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length));
  }

  /** Ends a pull: a drawn shape is kept (pulled or flat), existing shapes are pulled unless `flat` (then cancelled). */
  private commit(flat = false) {
    const ph = this.phase;
    if (ph.kind !== 'pull') return;
    const depth = flat ? 0 : (this.typed(ph.typed) ?? ph.depth);
    this.phase = { kind: 'hover' };
    this.view.unlockPointer();
    if (this.kind) this.host.hint(this.hoverHint()); // before done: the host may replace this tool
    if (!ph.drawn && !depth) return this.host.done(null);
    this.host.done({
      target: ph.target,
      drawn: ph.drawn,
      shapes: ph.ids,
      depth,
      depthTyped: flat || this.typed(ph.typed) === undefined ? undefined : ph.typed,
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
      const profile: DrawnProfile = ph.kind === 'shape' ? this.shape(ph) : { kind: 'polygon', pts: [...ph.pts, ph.cur], r: 0, rot: 0 };
      this.view.overlay.add(outline(profile, f));
      if (profile.kind === 'rect' && ph.kind === 'shape') {
        label('W', ph.typed[0], profile.w, v3(toWorld(f, profile.x, profile.y - profile.h / 2)), ph.axis === 0);
        label('H', ph.typed[1], profile.h, v3(toWorld(f, profile.x + profile.w / 2, profile.y)), ph.axis === 1);
      }
      if (profile.kind === 'circle' && ph.kind === 'shape') label('Ø', ph.typed[0], profile.d, v3(toWorld(f, profile.x + profile.d / 2, profile.y)), true);
    }
    if (this.snapped && ph.kind !== 'pull')
      this.view.overlay.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([this.snapped]), new THREE.PointsMaterial({ color: 0xff8c1a, size: 10, sizeAttenuation: false, depthTest: false })));
    if (ph.kind === 'pull') {
      const f = ph.target.frame;
      const depth = this.typed(ph.typed) ?? ph.depth;
      for (const p of ph.shapes) this.view.overlay.add(outline(p, f));
      if (depth) this.solid(ph.shapes, f, depth, ph.target.part !== null && depth < 0);
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
const PULL_HINT = 'Move to pull · [Ctrl] snaps · type a depth · click or [Enter]: done';

/** Where the ray meets the frame's plane (null: parallel or behind). */
export function planeHit(ray: THREE.Ray, f: Frame) {
  return ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(v3(f.n), v3(f.o)), new THREE.Vector3());
}

export function uvOf(f: Frame, p: THREE.Vector3): UV {
  const d = p.clone().sub(v3(f.o));
  return [d.dot(v3(f.x)), d.dot(v3(f.y))];
}

export function shape2d(p: DrawnProfile): THREE.Shape {
  if (p.kind === 'circle') return new THREE.Shape().absarc(p.x, p.y, p.d / 2, 0, Math.PI * 2, false);
  return new THREE.Shape(corners(p).map(([x, y]) => new THREE.Vector2(x, y)));
}

/** The shape's outline on the frame's plane, lifted `lift` mm along the normal (0: drawn over everything, for previews). */
export function outline(p: DrawnProfile, f: Frame, color = 0x3b6fd8, lift = 0) {
  const n = v3(f.n).multiplyScalar(lift);
  const pts = shape2d(p).getPoints(48).map((q) => v3(toWorld(f, q.x, q.y)).add(n));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: lift !== 0 }));
}
