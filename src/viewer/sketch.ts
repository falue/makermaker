import * as THREE from 'three';
import { BASE, toWorld, type Frame, type V3 } from '../doc/frames';
import { centre, corners, inside, nesting, type DrawnProfile } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BasePlane, SketchPlacement } from '../doc/types';
import { marks } from './marks';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { comboText, KEYS, pressed } from '../ui/keys';

export type ToolKind = 'rect' | 'circle' | 'ngon' | 'polygon' | 'line' | 'sphere';
export type { DrawnProfile };

/** End face of an extrude feature, in world coordinates. */
export interface Cap {
  body: string;
  feature: string;
  frame: Frame;
}

/** A sketch as the viewer shows it: world frame, shapes in mm (with ids). */
export interface ViewSketch {
  id: string;
  /** All shapes of a sketch share its colour. */
  color: number;
  frame: Frame;
  placement: Resolved<SketchPlacement>;
  shapes: (DrawnProfile & { id: string })[];
}

/** A drawn shape; sizes typed as text are kept as expressions. */
export interface Drawn {
  profile: DrawnProfile;
  typed: Partial<Record<'w' | 'h' | 'd', string>>;
}

/** Where shapes go: an existing sketch, or a new one at `placement`; `body`: the body whose face it lies on. */
export interface Target {
  sketch: string | null;
  placement: Resolved<SketchPlacement>;
  frame: Frame;
  body: string | null;
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
  /** A ball (world centre on the plane), instead of shapes. */
  sphere?: { center: V3; d: number; typed?: string };
  depth: number;
  depthTyped?: string;
  mode: 'add' | 'cut';
}

/** What the tool needs from the viewport. */
export interface ToolView {
  el: HTMLElement;
  overlay: THREE.Group;
  snapStep: number;
  /** Where shapes drawn on the face of a body hit go (null: nowhere: a curved face no feature made). */
  placeOn(hit: THREE.Intersection): Omit<Target, 'sketch'> | null;
  sketches: ViewSketch[];
  /** The selected sketch, drawn into when the pointer is on no other target. */
  activeSketch: string | null;
  ray(e: MouseEvent): THREE.Ray;
  /** Nearest body surface under the pointer (cut-away regions excluded). */
  hit(e: MouseEvent): THREE.Intersection | undefined;
  /** Base plane facing the camera most. */
  facing(): BasePlane;
  toScreen(p: THREE.Vector3): [number, number];
  /** Screen pixels per mm at `at`. */
  pixelsPerMm(at: THREE.Vector3): number;
  /** In a flat view along `n`, turns back to the last angled view. */
  unflatten(n: THREE.Vector3): void;
  /** Hides and locks the pointer while pulling (movement then has no end), and frees it. */
  lockPointer(): void;
  unlockPointer(): void;
  /** Lights the whole face of a hit (none: clears it). */
  markFace(hit?: THREE.Intersection): void;
  /** Body corners in the world, to snap to. */
  corners(): THREE.Vector3[];
  /** Body edges in the world (each as segments), to snap to. */
  edges(): [THREE.Vector3, THREE.Vector3][][];
  render(): void;
}

/** draw: flat shapes into a fixed sketch (sketch mode); pull: existing shapes; plane: pick a plane for a new sketch. */
export type ToolMode = { kind: 'draw'; target: Target } | { kind: 'pull'; target: Target; ids: string[] } | { kind: 'plane' };

/** A tool that takes the pointer and keys in the viewport. */
export interface Tool {
  readonly kind: ToolKind | null;
  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean;
  move(e: PointerEvent): void;
  up(): void;
  dblclick(e: MouseEvent): void;
  /** Returns true if the key was used. */
  key(e: KeyboardEvent): boolean;
  /** The camera moved: redraw labels and markers. */
  refresh(): void;
  dispose(): void;
  /** True while the tool only waits for clicks: a left drag then turns the view, a click without dragging goes to `down`. */
  clicks?(): boolean;
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
export function pullBy(view: ToolView, e: PointerEvent, normal: V3, middle: THREE.Vector3, s: PullStart) {
  const n = v3(normal);
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
  /** A length (mm) as shown, in the document's units. */
  lengthText(mm: number): string;
  /** A finished action (null: cancelled or stopped). After a flat shape the tool goes on. */
  done(result: SketchResult | null): void;
  hint(text: string): void;
  /** A note that follows the pointer (null: none). */
  cursorTip(text: string | null): void;
  /** New shapes are drawn as construction lines. */
  construction(): boolean;
}

type UV = [number, number];
type Segment = [THREE.Vector3, THREE.Vector3];

type Phase =
  | { kind: 'hover' }
  /** Rectangle or circle from `anchor`; typed sizes per axis (circle: only 0, the diameter). */
  | { kind: 'shape'; target: Target; anchor: UV; cur: UV; px: [number, number]; dragged: boolean; typed: (string | undefined)[]; axis: number; alt: boolean; shift: boolean }
  | { kind: 'polygon'; target: Target; pts: UV[]; cur: UV }
  | { kind: 'pull'; target: Target; drawn?: Drawn; shapes: DrawnProfile[]; ids?: string[]; raw: number; depth: number; typed: string | undefined };

const v3 = (a: V3) => new THREE.Vector3(...a);
/**
 * A point the pointer snaps to (plane coordinates), what it is, and the outline it belongs to; a body corner keeps where
 * it is (world); a point along a line the line's key and the lengths on both sides of it (mm).
 */
type SnapPoint = { at: UV; what: string; line?: Segment[]; corner?: THREE.Vector3; key?: string; parts?: [number, number] };
/** A straight line's key, by its ends (world, either way round). */
const sideKey = (a: THREE.Vector3, b: THREE.Vector3) => [a, b].map((v) => v.toArray().map((x) => x.toFixed(3)).join(',')).sort().join('|');
/** `i/n` in lowest terms. */
function fraction(i: number, n: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(i, n);
  return `${i / g}/${n / g}`;
}
/** A line the pointer snaps to (world segments); sketch outlines keep their shape and sketch. */
type SnapLine = { segs: Segment[]; what: string; shape?: { p: ViewSketch['shapes'][number]; sketch: ViewSketch } };
const AXIS_NAME: Record<BasePlane, string> = { xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };
const NAMES: Record<ToolKind, string> = { rect: 'a rectangle', circle: 'a circle', ngon: 'a regular polygon', polygon: 'a polygon', line: 'a line', sphere: 'a sphere' };

/**
 * Draws rectangles, circles and polygons into sketches and pulls them into extrusions. A shape goes into the sketch
 * under the pointer, or onto the top face of the body under it (that face's sketch; pulling into the body cuts), or
 * into the selected sketch, or onto the base plane facing the camera. Right after drawing, moving pulls; a click
 * without pulling or Esc keeps it flat and the tool goes on. Ctrl snaps to the grid, the pointer to corners and
 * centres; typed sizes and depths are exact (incase-style typing). In sketch mode (`draw`) shapes go flat into its
 * sketch and the tool goes on; `pull` only pulls existing shapes (E); `plane` picks where a new sketch goes.
 */
export class SketchTool implements Tool {
  private phase: Phase = { kind: 'hover' };
  /** The point the pointer snapped to (world), shown as a squircle; the line or shape it belongs to is lit too. */
  private snapped: THREE.Vector3 | null = null;
  private snapLine: Segment[] | null = null;
  /** What the pointer snapped to ('corner', '1/2', 'crossing' …), shown next to it. */
  private snapWhat: string | null = null;
  /** Where the last line ended (world; kept across tool restarts): a Ctrl-click draws the next line from there. */
  private static lineEnd: THREE.Vector3 | null = null;
  /** Snap points along a line (by its key, see `sideKey`): evenly spaced inside a side, or around a circle. Kept across tool restarts. */
  private static divisions = new Map<string, number>();
  /** The line the pointer snapped to or along (its key), for A / Shift A. */
  private snapKey: string | null = null;
  /** The line whose snap points were just changed: all its points show while the pointer stays on it. */
  private showing: string | null = null;
  private dots: THREE.Vector3[] = [];
  /** The last pointer position snapped, to snap again when the points change. */
  private lastPoint: [MouseEvent, Target, boolean] | null = null;
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
    this.host.cursorTip(null);
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
      if (this.kind === 'line' && SketchTool.lineEnd && (e.ctrlKey || e.metaKey)) {
        this.phase = { kind: 'polygon', target, pts: [uvOf(target.frame, SketchTool.lineEnd), at], cur: at };
        this.finishLine();
        return this.update(), true;
      }
      this.phase =
        this.kind === 'polygon' || this.kind === 'line'
          ? { kind: 'polygon', target, pts: [at], cur: at }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, alt: e.altKey, shift: e.shiftKey };
      this.host.hint(this.kind === 'polygon' ? POLYGON_HINT : this.kind === 'line' ? LINE_HINT : SHAPE_HINT);
    } else if (ph.kind === 'shape') this.shapeDone(); // second click of click-click drawing
    else if (ph.kind === 'polygon') {
      const at = this.point(e, ph.target, e.ctrlKey);
      if (!at) return true;
      const r = this.view.el.getBoundingClientRect();
      const near = (q: UV) => {
        const [x, y] = this.view.toScreen(v3(toWorld(ph.target.frame, ...q)));
        return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8;
      };
      ph.pts.push(at);
      if (this.kind === 'line') this.finishLine(); // a line is done at its second point
      else if (ph.pts.length >= 4 && near(ph.pts[0])) (ph.pts.pop(), this.closePolygon()); // the first corner closes it
    } else if (ph.kind === 'pull') this.commit();
    this.update();
    return true;
  }

  move(e: PointerEvent) {
    const ph = this.phase;
    this.snapWhat = this.snapKey = null;
    if (ph.kind === 'hover') {
      if (!this.kind && this.mode?.kind !== 'plane') return;
      const target = this.target(e);
      this.view.markFace(target?.body && !target.sketch ? this.view.hit(e) : undefined);
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
      pullBy(this.view, e, ph.target.frame.n, this.middle(ph), ph);
      ph.depth = this.snap(ph.raw, e.ctrlKey);
    }
    this.update();
  }

  up() {
    const ph = this.phase;
    if (ph.kind === 'shape' && ph.dragged) this.shapeDone();
    this.update();
  }

  clicks() {
    return this.mode?.kind === 'plane';
  }

  dblclick() {
    if (this.phase.kind === 'polygon') this.closePolygon();
    this.update();
  }

  /** Keys while drawing; returns true if used. Letters only count while typing a size, so tool keys still switch tools. */
  key(e: KeyboardEvent): boolean {
    const ph = this.phase;
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull');
    const more = pressed(e, 'moreSnaps');
    if ((more || pressed(e, 'fewerSnaps')) && this.snapKey && this.lastPoint && ph.kind !== 'pull' && !(ph.kind === 'shape' && ph.typed[ph.axis] !== undefined)) {
      const k = this.snapKey;
      const circle = k.startsWith('circle:');
      SketchTool.divisions.set(k, Math.max(circle ? 2 : 1, (SketchTool.divisions.get(k) ?? (circle ? 4 : 1)) + (more ? 1 : -1)));
      this.showing = k;
      const at = this.point(...this.lastPoint);
      if (at && (ph.kind === 'shape' || ph.kind === 'polygon')) ph.cur = at;
    } else if (pressed(e, 'cancel')) {
      if (ph.kind === 'hover') return this.host.done(null), true;
      if (ph.kind === 'pull') return this.commit(true), this.update(), true; // a drawn shape stays flat
      if (ph.kind === 'polygon' && ph.pts.length >= 2) return this.finishLine(), this.update(), true; // an open polygon
      this.phase = { kind: 'hover' };
      this.host.hint(this.hoverHint());
    } else if (ph.kind === 'shape') {
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (pressed(e, 'erase')) ph.typed[ph.axis] = ph.typed[ph.axis]?.slice(0, -1) || undefined;
      else if (pressed(e, 'otherSide') && (this.kind === 'rect' || this.kind === 'ngon')) ph.axis = 1 - ph.axis;
      else if (pressed(e, 'confirm')) this.shapeDone();
      else return false;
    } else if (ph.kind === 'polygon') {
      if (pressed(e, 'confirm')) this.closePolygon();
      else if (pressed(e, 'erase') && ph.pts.length > 1) ph.pts.pop();
      else return false;
    } else if (ph.kind === 'pull') {
      if (typing) ph.typed = (ph.typed ?? '') + e.key;
      else if (pressed(e, 'erase')) ph.typed = ph.typed?.slice(0, -1) || undefined;
      else if (pressed(e, 'confirm')) this.commit();
      else return false;
    } else return false;
    this.update();
    return true;
  }

  private hoverHint(target?: Target) {
    if (this.mode?.kind === 'plane') return `Click ${target ? target.name : 'a top face or empty space'} to draw on it · [Esc] cancels`;
    const how = this.kind === 'polygon' ? 'Click corners' : this.kind === 'line' ? `Click two points${SketchTool.lineEnd ? ' ([Ctrl]-click: on from the last end)' : ''}` : 'Drag (or click twice)';
    if (this.mode?.kind === 'draw') return `${how} to draw ${NAMES[this.kind!]} · [R] [C] [P] switch · snaps to corners and centres · [A] / [Shift A] more / fewer snap points on a line · [Ctrl] grid · [Esc] stops drawing shapes`;
    return `${how} to draw ${NAMES[this.kind!]}${target ? ` on ${target.name}` : ''} · [Ctrl] snaps · right-drag turns the view · [Esc] stops`;
  }

  /**
   * Where the pointer draws: the visible sketch with a shape under it or an outline within `px` pixels (the nearest),
   * the top face of the body under it, the selected sketch, or a sketch on a base plane, or that plane: the ground
   * unless seen almost edge-on (below `groundDeg`), then the base plane facing the camera (null: another face of a body).
   */
  private target(e: MouseEvent, px = 10, groundDeg = 20): Target | null {
    if (this.mode?.kind === 'draw') return this.mode.target;
    const ray = this.view.ray(e);
    const hit = this.view.hit(e);
    const r = this.view.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    let onSketch: ViewSketch | null = null;
    let nearest = px;
    for (const s of this.view.sketches) {
      const p = planeHit(ray, s.frame);
      if (!p || (hit && p.distanceTo(ray.origin) > hit.distance + 1e-3)) continue;
      const d = s.shapes.some((q) => inside(q, ...uvOf(s.frame, p))) ? 0 : Math.min(px, ...s.shapes.flatMap((q) => outlineSegs(q, s.frame).map(([a, b]) => this.screenDist(mx, my, a, b).d)));
      if (d < nearest) [onSketch, nearest] = [s, d];
    }
    if (onSketch) return this.sketchTarget(onSketch);
    if (hit) {
      if (hit.face!.normal.dot(ray.direction) > 0) return null; // a back face seen through a section cut
      const placed = this.view.placeOn(hit);
      if (!placed) return null;
      // a sketch already there takes the shapes
      const same = (s: ViewSketch) =>
        placed.placement.kind === 'plane'
          ? Math.abs(v3(s.frame.n).dot(v3(placed.frame.n)) - 1) < 1e-6 && Math.abs(v3(s.frame.o).sub(v3(placed.frame.o)).dot(v3(placed.frame.n))) < 1e-3
          : JSON.stringify(s.placement) === JSON.stringify(placed.placement);
      const existing = this.view.sketches.find(same);
      return existing ? this.sketchTarget(existing) : { sketch: null, ...placed };
    }
    const axis = Math.abs(ray.direction.clone().normalize().z) > Math.sin((groundDeg * Math.PI) / 180) ? 'xy' : this.view.facing();
    const active = this.view.sketches.find((s) => s.id === this.view.activeSketch);
    const base = active ?? this.view.sketches.find((s) => s.placement.kind === 'base' && s.placement.axis === axis && s.placement.offset === 0);
    return base ? this.sketchTarget(base) : { sketch: null, placement: { kind: 'base', axis, offset: 0 }, frame: BASE[axis], body: null, name: AXIS_NAME[axis] };
  }

  private sketchTarget(s: ViewSketch): Target {
    return { sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name: 'its sketch' };
  }

  private snap(v: number, ctrl: boolean) {
    const step = ctrl ? this.view.snapStep : 0.1;
    return Math.round(v / step) * step;
  }

  /**
   * Where the pointer snaps, in the target's plane coordinates, each with what it is and the outline it belongs to (lit
   * while snapped): the plane origin; centres, corners (line ends), points along sides (the middle, or as many as set
   * with A) and around circles (quadrants, or as set) of the shapes of every visible sketch; the same along straight
   * body edges; body corners and sphere centres (their edges are looked up when snapped). Only points in the plane drawn
   * on: one off it would snap to its projection, away from what it is.
   */
  private snapPoints(t: Target, lines: SnapLine[]): SnapPoint[] {
    const pts: SnapPoint[] = [{ at: [0, 0], what: 'origin' }];
    const add = (v: THREE.Vector3, o: Omit<SnapPoint, 'at'>) => inPlane(t.frame, v) && pts.push({ at: uvOf(t.frame, v), ...o });
    // evenly spaced points inside a side, each with the lengths on both sides of it
    const divide = ([a, b]: Segment) => {
      const key = sideKey(a, b);
      const m = SketchTool.divisions.get(key) ?? 1;
      const len = a.distanceTo(b);
      for (let i = 1; i <= m; i++) add(a.clone().lerp(b, i / (m + 1)), { what: fraction(i, m + 1), line: [[a, b]], key, parts: [(len * i) / (m + 1), len - (len * i) / (m + 1)] });
    };
    for (const { segs, shape } of lines) {
      if (!shape) {
        if (segs.length === 1) divide(segs[0]);
        continue;
      }
      const { p, sketch } = shape;
      const cs = corners(p);
      const sides = p.kind === 'line' ? cs.slice(1).map((b, i) => [cs[i], b]) : cs.map((a, i) => [a, cs[(i + 1) % cs.length]]);
      const world = ([a, b]: UV[]): Segment => [v3(toWorld(sketch.frame, ...a)), v3(toWorld(sketch.frame, ...b))];
      const at = (q: UV) => v3(toWorld(sketch.frame, ...q));
      // centres and circle points light the whole shape, a point along a side that side, a corner the two sides meeting there
      if (p.kind !== 'line') add(at(centre(p)), { what: 'centre', line: segs });
      cs.forEach((q, i) => add(at(q), { what: p.kind === 'line' ? 'end' : 'corner', line: [p.kind === 'line' ? sides[i - 1] : sides.at(i - 1), sides[i]].filter((x) => x).map((x) => world(x!)) }));
      sides.forEach((x) => divide(world(x)));
      if (p.kind === 'circle') {
        const key = `circle:${p.id}`;
        const m = SketchTool.divisions.get(key) ?? 4;
        for (let i = 0; i < m; i++) {
          const a = (2 * Math.PI * i) / m;
          add(at([p.x + (Math.cos(a) * p.d) / 2, p.y + (Math.sin(a) * p.d) / 2]), { what: m === 4 ? 'quadrant' : `${+((360 * i) / m).toFixed(1)}°`, line: segs, key });
        }
      }
    }
    for (const c of this.view.corners()) add(c, { what: 'corner', corner: c });
    return pts;
  }

  /** Lines to snap to, each as segments (world): outlines of every visible sketch's shapes (with the shape), and body edges. */
  private snapLines(): SnapLine[] {
    const outlines = this.view.sketches.flatMap((sketch) => sketch.shapes.map((p) => ({ segs: outlineSegs(p, sketch.frame), what: 'on line', shape: { p, sketch } })));
    return [...outlines, ...this.view.edges().map((segs) => ({ segs, what: 'on edge' }))];
  }

  /** Pixel distance from the pointer (`mx`, `my`, in the view) to a segment on screen, and where along it (0..1) it is nearest. */
  private screenDist(mx: number, my: number, a: THREE.Vector3, b: THREE.Vector3) {
    const [ax, ay] = this.view.toScreen(a);
    const [bx, by] = this.view.toScreen(b);
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const k = len2 ? Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / len2)) : 0;
    return { d: Math.hypot(mx - ax - k * (bx - ax), my - ay - k * (by - ay)), k };
  }

  /** The crossing of two of the lines near the pointer closest to it within `px` (plane coordinates, with both lines' indices), if any. */
  private crossing(near: { line: number; a: UV; b: UV }[], t: Target, mx: number, my: number, px: number) {
    let best: { at: UV; lines: [number, number]; d: number } | null = null;
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) {
        const [p, q] = [near[i], near[j]];
        if (p.line === q.line) continue;
        const r = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
        const s = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
        const den = r[0] * s[1] - r[1] * s[0];
        if (Math.abs(den) < 1e-12) continue; // parallel
        const w = [q.a[0] - p.a[0], q.a[1] - p.a[1]];
        const k = (w[0] * s[1] - w[1] * s[0]) / den;
        const m = (w[0] * r[1] - w[1] * r[0]) / den;
        if (k < -1e-9 || k > 1 + 1e-9 || m < -1e-9 || m > 1 + 1e-9) continue;
        const at: UV = [p.a[0] + k * r[0], p.a[1] + k * r[1]];
        const [x, y] = this.view.toScreen(v3(toWorld(t.frame, ...at)));
        const d = Math.hypot(mx - x, my - y);
        if (d < px && (!best || d < best.d)) best = { at, lines: [p.line, q.line], d };
      }
    return best;
  }

  /**
   * Pointer on the target plane, in plane coordinates: on the nearest snap point within `px` pixels, else on a crossing of lines
   * within `px`, else on the nearest line within `linePx` (sketch outlines, body edges in the plane), else
   * on the grid (Ctrl) or 0.1 mm. Sets `snapWhat`.
   */
  private point(e: MouseEvent, t: Target, grid: boolean): UV | null {
    this.lastPoint = [e, t, grid];
    const uv = this.snapAt(e, t, grid);
    if (this.showing !== this.snapKey) this.showing = null; // the pointer left the line just changed
    this.dots = this.showing ? this.snapPoints(t, this.snapLines()).filter((q) => q.key === this.showing).map((q) => v3(toWorld(t.frame, ...q.at))) : [];
    return uv;
  }

  private snapAt(e: MouseEvent, t: Target, grid: boolean, px = 10, linePx = 8): UV | null {
    const p = planeHit(this.view.ray(e), t.frame);
    if (!p) return null;
    const r = this.view.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const lines = this.snapLines();
    let near: SnapPoint | undefined;
    let nearest = px;
    for (const q of this.snapPoints(t, lines)) {
      const [x, y] = this.view.toScreen(v3(toWorld(t.frame, ...q.at)));
      const d = Math.hypot(mx - x, my - y);
      if (d < nearest) [near, nearest] = [q, d];
    }
    this.snapLine = null;
    this.snapped = near ? v3(toWorld(t.frame, ...near.at)) : null;
    this.snapWhat = near?.what ?? null;
    this.snapKey = near?.key ?? null;
    if (near?.parts) this.snapWhat = `${near.what} (${near.parts.map((mm) => this.host.lengthText(mm)).join(' | ')})`;
    if (near) {
      this.snapLine = near.line ?? null;
      const c = near.corner;
      if (c) {
        // a body corner lights the edges meeting there; none: a sphere centre
        const touching = lines.filter((l) => !l.shape && [l.segs[0][0], l.segs[l.segs.length - 1][1]].some((v) => v.distanceTo(c) < 1e-4)).flatMap((l) => l.segs);
        if (touching.length) this.snapLine = touching;
        else this.snapWhat = 'centre';
      }
      return near.at;
    }
    let best: { at: THREE.Vector3; line: Segment[]; what: string; key?: string; d: number } | null = null;
    const close: { line: number; a: UV; b: UV }[] = [];
    // along lines and at their crossings only in the plane drawn on: a line off it would snap to its projection, away from the pointer
    for (const [line, { segs, what, shape }] of lines.entries())
      for (const [a, b] of segs) {
        if (!inPlane(t.frame, a) || !inPlane(t.frame, b)) continue;
        const { d, k } = this.screenDist(mx, my, a, b);
        if (d >= linePx) continue;
        close.push({ line, a: uvOf(t.frame, a), b: uvOf(t.frame, b) });
        // the line for A / Shift A: a circle, a straight side, or a straight body edge
        const key = shape?.p.kind === 'circle' ? `circle:${shape.p.id}` : shape || segs.length === 1 ? sideKey(a, b) : undefined;
        if (!best || d < best.d) best = { at: a.clone().lerp(b, k), line: segs, what, key, d };
      }
    const cross = this.crossing(close, t, mx, my, px);
    if (cross) {
      this.snapped = v3(toWorld(t.frame, ...cross.at));
      this.snapLine = cross.lines.flatMap((i) => lines[i].segs);
      this.snapWhat = 'crossing';
      return cross.at;
    }
    if (best) {
      const uv = uvOf(t.frame, best.at);
      this.snapped = v3(toWorld(t.frame, ...uv));
      this.snapLine = best.line;
      this.snapWhat = best.what;
      this.snapKey = best.key ?? null;
      return uv;
    }
    if (grid) this.snapWhat = 'grid';
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
    if (this.kind === 'circle' || this.kind === 'sphere') {
      const d = this.typed(ph.typed[0]) ?? 2 * Math.hypot(du, dv);
      return { kind: 'circle', x: au, y: av, d };
    }
    if (this.kind === 'ngon') {
      // the first corner points at the pointer (Shift: turns in 15° steps); typed: diameter, then the number of sides
      const deg = (Math.atan2(dv, du) * 180) / Math.PI - 90;
      const sides = Math.round(Number(ph.typed[1]) || 6);
      return { kind: 'ngon', x: au, y: av, d: this.typed(ph.typed[0]) ?? 2 * Math.hypot(du, dv), sides: Math.max(3, sides), rot: ph.shift ? Math.round(deg / 15) * 15 : deg };
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
    const size = profile.kind === 'rect' ? Math.min(profile.w, profile.h) : profile.kind === 'polygon' || profile.kind === 'line' ? 1 : profile.d;
    if (!(size > 0)) return this.host.hint('Too small: drag further or type a size · [Esc] cancels');
    const [a, b] = ph.typed.map((t) => (this.typed(t) === undefined ? undefined : t));
    if (this.kind === 'sphere' && profile.kind === 'circle') {
      // drawn from its centre: the ball's centre is where dragging started, on the plane
      const center = toWorld(ph.target.frame, profile.x, profile.y);
      this.phase = { kind: 'hover' };
      return this.host.done({ target: ph.target, sphere: { center, d: profile.d, typed: a }, depth: 0, mode: 'add' });
    }
    this.drawn(ph.target, { profile, typed: profile.kind === 'rect' ? { w: a, h: b } : { d: a } });
  }

  private closePolygon() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const pts = ph.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
    if (pts.length < 3) return this.host.hint('A polygon needs 3 corners · ' + POLYGON_HINT);
    const profile: DrawnProfile = { kind: 'polygon', pts, r: 0, rot: 0 };
    this.drawn(ph.target, { profile, typed: {} });
  }

  /** Ends a line or an open polygon at its points so far (never pulled: it stays flat). */
  private finishLine() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const pts = ph.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
    if (pts.length < 2) return this.host.hint('A line needs 2 points · ' + LINE_HINT);
    SketchTool.lineEnd = v3(toWorld(ph.target.frame, ...pts[pts.length - 1]));
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    this.host.done({ target: ph.target, drawn: { profile: { kind: 'line', pts }, typed: {} }, depth: 0, mode: 'add' });
  }

  /** A finished shape: in sketch mode or as a construction line it stays flat and drawing goes on, else pulling starts. */
  private drawn(target: Target, drawn: Drawn) {
    if (this.mode?.kind !== 'draw' && !this.host.construction()) return this.enterPull(target, [drawn.profile], drawn);
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    this.host.done({ target, drawn, depth: 0, mode: 'add' });
  }

  private enterPull(target: Target, shapes: DrawnProfile[], drawn?: Drawn, ids?: string[]) {
    this.phase = { kind: 'pull', target, drawn, shapes, ids, raw: 0, depth: 0, typed: undefined };
    this.view.unflatten(v3(target.frame.n));
    this.view.lockPointer();
    const keep = drawn ? ' · click without pulling or [Esc]: keep it flat' : ' · [Esc] cancels';
    this.host.hint(PULL_HINT + keep);
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
      mode: 'add',
    });
  }

  private clearPreview() {
    for (const o of this.view.overlay.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.view.overlay.clear();
  }

  refresh() {
    this.update();
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
      const pts: UV[] = ph.kind === 'polygon' ? [...ph.pts, ph.cur] : [];
      const drawing: DrawnProfile = ph.kind === 'shape' ? this.shape(ph) : this.kind === 'line' ? { kind: 'line', pts } : { kind: 'polygon', pts, r: 0, rot: 0 };
      const profile = { ...drawing, construction: this.host.construction() }; // dashed while drawing construction lines
      this.view.overlay.add(outline(profile, f));
      if (profile.kind === 'rect' && ph.kind === 'shape') {
        label('W', ph.typed[0], profile.w, v3(toWorld(f, profile.x, profile.y - profile.h / 2)), ph.axis === 0);
        label('H', ph.typed[1], profile.h, v3(toWorld(f, profile.x + profile.w / 2, profile.y)), ph.axis === 1);
      }
      if (profile.kind === 'circle' && ph.kind === 'shape') label('Ø', ph.typed[0], profile.d, v3(toWorld(f, profile.x + profile.d / 2, profile.y)), true);
      if (profile.kind === 'ngon' && ph.kind === 'shape') {
        label('Ø', ph.typed[0], profile.d, v3(toWorld(f, profile.x + profile.d / 2, profile.y)), ph.axis === 0);
        labels.push([`Sides ${ph.typed[1] === undefined ? profile.sides : `${ph.typed[1]}▏`}`, v3(toWorld(f, profile.x, profile.y - profile.d / 2)), ph.axis === 1]);
      }
    }
    if (this.snapped && ph.kind !== 'pull') {
      if (this.snapLine) {
        const lit = new LineMaterial({ color: 0xff8c1a, linewidth: 3, depthTest: false });
        lit.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
        this.view.overlay.add(new LineSegments2(new LineSegmentsGeometry().setPositions(this.snapLine.flat().flatMap((v) => v.toArray())), lit));
      }
      this.view.overlay.add(marks([this.snapped], 0xff8c1a, this.snapWhat?.startsWith('on ') ? 8 : 12));
    }
    if (this.dots.length && ph.kind !== 'pull') this.view.overlay.add(marks(this.dots, 0xff8c1a, 7));
    const chain = this.kind === 'line' && ph.kind === 'hover' && SketchTool.lineEnd ? 'Hold Ctrl to start the line from the end of the last one' : null;
    const more = this.snapKey ? `Press ${comboText(KEYS.moreSnaps.default[0])} for more points, ${comboText(KEYS.fewerSnaps.default[0])} for fewer` : null;
    this.host.cursorTip(ph.kind === 'pull' ? null : [this.snapWhat, more, chain].filter(Boolean).join('\n') || null); // one per line
    if (ph.kind === 'pull') {
      const f = ph.target.frame;
      const depth = this.typed(ph.typed) ?? ph.depth;
      for (const p of ph.shapes) this.view.overlay.add(outline(p, f));
      if (depth) this.solid(ph.shapes, f, depth);
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
  private solid(ps: DrawnProfile[], f: Frame, depth: number) {
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
      new THREE.MeshStandardMaterial({ color: 0x3b6fd8, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(v3(f.x), v3(f.y), v3(f.n)).setPosition(v3(f.o).addScaledVector(v3(f.n), Math.min(0, depth)));
    this.view.overlay.add(mesh);
  }
}

const SHAPE_HINT = '[Alt] from the centre · [Shift] square / 15° · [Ctrl] snaps · type a size, [Tab] other side or number of sides · [Enter] or click: done · [Esc] cancels';
const LINE_HINT = 'Click the end point · [Ctrl] snaps · [Esc] cancels';
const POLYGON_HINT = 'Click corners · click the first one, double-click or [Enter] to close it · [Esc] leaves it open · [Backspace] removes the last';
const PULL_HINT = 'Move to pull · [Ctrl] snaps · type a depth · click or [Enter]: done';

/** A shape's outline as segments (world) on the frame's plane; a line stays open. */
function outlineSegs(p: ViewSketch['shapes'][number], f: Frame): Segment[] {
  const pts = (p.kind === 'line' ? p.pts.map(([x, y]) => ({ x, y })) : shape2d(p).getPoints(48)).map((q) => v3(toWorld(f, q.x, q.y)));
  return (p.kind === 'line' ? pts.slice(0, -1) : pts).map((a, i): Segment => [a, pts[(i + 1) % pts.length]]);
}

/** Whether a point (world) lies in the frame's plane. */
const inPlane = (f: Frame, v: THREE.Vector3, tol = 1e-3) => Math.abs(v.clone().sub(v3(f.o)).dot(v3(f.n))) < tol;

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

/** The shape's outline on the frame's plane, lifted `lift` mm along the normal (0: drawn over everything, for previews); construction lines dashed. */
export function outline(p: DrawnProfile, f: Frame, color = 0x3b6fd8, lift = 0, dashMm = 1.5) {
  const n = v3(f.n).multiplyScalar(lift);
  const pts = (p.kind === 'line' ? p.pts.map(([x, y]) => ({ x, y })) : shape2d(p).getPoints(48)).map((q) => v3(toWorld(f, q.x, q.y)).add(n));
  if (p.kind !== 'line') pts.push(pts[0]); // closed by its own last segment, so dashes count it (a LineLoop's closing segment is left out)
  const material = p.construction
    ? new THREE.LineDashedMaterial({ color, dashSize: dashMm, gapSize: dashMm, depthTest: lift !== 0 })
    : new THREE.LineBasicMaterial({ color, depthTest: lift !== 0 });
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geometry, material).computeLineDistances();
}
