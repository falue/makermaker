import * as THREE from 'three';
import { BASE, extent, toWorld, type Frame, type V3 } from '../doc/frames';
import { centre, corners, inside, nesting, type DrawnProfile } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BasePlane, ShapeGroup, SketchPlacement } from '../doc/types';
import { marks } from './marks';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { comboText, KEYS, MAC, mod, pressed } from '../ui/keys';
import { keepInside } from '../ui/inside';

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
  /** Its sub-groups of shapes. */
  groups: ShapeGroup[];
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
  /** How far it also reaches behind the plane (mm), as typed. */
  back?: number;
  backTyped?: string;
  mode: 'add' | 'cut';
}

/** What the tool needs from the viewport. */
export interface ToolView {
  el: HTMLElement;
  overlay: THREE.Group;
  /** The step a drag moves in near `at` (mm), by the zoom and modifiers (Shift ×10 unless `coarse` is false, Ctrl the minimum). */
  step(at: THREE.Vector3, e?: { shiftKey: boolean; ctrlKey: boolean }, coarse?: boolean): number;
  /** The angle step (degrees) a drawn line turns in with Ctrl. */
  minAngle: number;
  /** Where shapes drawn on the face of a body hit go (null: nowhere: a curved face no feature made). */
  placeOn(hit: THREE.Intersection): Omit<Target, 'sketch'> | null;
  /** The section's cut face under the pointer (seen through the cut): its plane to draw on; null: none. */
  cutPlane(e: MouseEvent): Omit<Target, 'sketch'> | null;
  sketches: ViewSketch[];
  /** The selected sketch, drawn into when the pointer is on no other target. */
  activeSketch: string | null;
  ray(e: MouseEvent): THREE.Ray;
  /** Nearest body surface under the pointer (cut-away regions excluded). */
  hit(e: MouseEvent): THREE.Intersection | undefined;
  /** What a click points at (world): a corner, an edge point or a face point; null: empty space. */
  pointAt(e: MouseEvent): THREE.Vector3 | null;
  /** Marks what a click at the pointer reaches (as `pointAt` finds it) and returns it; null: clears. */
  aimAt(e: MouseEvent | null): { at: THREE.Vector3; what: string } | null;
  /** The same where the pointer is now. */
  aimHere(): { at: THREE.Vector3; what: string } | null;
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
  /** Spheres in the world. */
  spheres(): { center: THREE.Vector3; r: number }[];
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
 * Pulling new shapes or areas: as pulled (`depth`, on the step), the typed depth and back (behind the plane), the one
 * typed into (`side` 1: the back), Alt held (the back as far as the depth).
 */
export interface Pulling extends PullStart {
  depth: number;
  typed: string | undefined;
  typedBack?: string;
  side?: number;
  alt?: boolean;
}

/** A pull's depth and how far it reaches back (mm): typed, else as pulled; Alt: back as far as the depth (both ways from the plane). */
export function pulled(p: Pulling, length: (text: string) => number | null) {
  const typed = (t: string | undefined) => (t === undefined ? null : length(t));
  const depth = typed(p.typed) ?? p.depth;
  return { depth, back: typed(p.typedBack) ?? (p.alt ? Math.abs(depth) : 0) };
}

/** Typing while pulling: into the depth or (Tab) the back; Backspace erases. Returns whether the key was used. */
export function pullKey(e: KeyboardEvent, p: Pulling) {
  const k = p.side ? 'typedBack' : 'typed';
  if (pressed(e, 'otherSide')) p.side = p.side ? 0 : 1;
  else if (pressed(e, 'erase')) p[k] = p[k]?.slice(0, -1) || undefined;
  else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) p[k] = (p[k] ?? '') + e.key;
  else return false;
  return true;
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
  /** A typed plain number (expressions allowed), or null if invalid or a length. */
  number(text: string): number | null;
  /** A length (mm) as shown, in the document's units. */
  lengthText(mm: number): string;
  /** A finished action (null: cancelled or stopped). After a flat shape the tool goes on. */
  done(result: SketchResult | null): void;
  hint(text: string): void;
  /** A note that follows the pointer (null: none). */
  cursorTip(text: string | null): void;
  /** Where that note is (viewport px), if shown. */
  cursorTipRect(): DOMRect | null;
  /** New shapes are drawn as construction lines. */
  construction(): boolean;
}

type UV = [number, number];
type Segment = [THREE.Vector3, THREE.Vector3];

type Phase =
  | { kind: 'hover' }
  /** Rectangle or circle from `anchor`; typed sizes per axis (circle: only 0, the diameter). */
  | { kind: 'shape'; target: Target; anchor: UV; cur: UV; px: [number, number]; dragged: boolean; typed: (string | undefined)[]; axis: number; alt: boolean; shift: boolean }
  /**
   * Line or polygon: corners so far and the open side's end; typed length (0) and angle (1) of the open side;
   * `chained`: a line started at the last one's end by holding ⌘ (else Ctrl); `base`: the direction (radians, plane
   * coordinates) its angle counts from: the previous line's (going straight on is 0°), else the plane's x axis, or a line picked with B.
   */
  | { kind: 'polygon'; target: Target; pts: UV[]; cur: UV; typed: (string | undefined)[]; axis: number; base: number; chained?: boolean }
  | ({ kind: 'pull'; target: Target; drawn?: Drawn; shapes: DrawnProfile[]; ids?: string[] } & Pulling);

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
/** A line the pointer snaps to (world segments); sketch outlines keep their shape and sketch, guides themselves. */
type SnapLine = { segs: Segment[]; what: string; shape?: { p: ViewSketch['shapes'][number]; sketch: ViewSketch }; guide?: { at: THREE.Vector3; dir: THREE.Vector3; fixed: boolean } };
/** Guides' colour and reach (mm each way: practically endless). */
const GUIDE_COLOR = 0xd946ef;
const guideSeg = (g: { at: THREE.Vector3; dir: THREE.Vector3 }, reach = 1e4): Segment => [g.at.clone().addScaledVector(g.dir, -reach), g.at.clone().addScaledVector(g.dir, reach)];
/** Whether the segment lies on the guide's line. */
const onLine = (g: { at: THREE.Vector3; dir: THREE.Vector3 }, [a, b]: Segment) => [a, b].every((v) => v.clone().sub(g.at).cross(g.dir).length() < 1e-4);
const sameSeg = (p: Segment | null, q: Segment | null) => p === q || (!!p && !!q && p[0].equals(q[0]) && p[1].equals(q[1]));
const AXIS_NAME: Record<BasePlane, string> = { xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };
const NAMES: Record<ToolKind, string> = { rect: 'a rectangle', circle: 'a circle', ngon: 'a regular polygon', polygon: 'a polygon', line: 'a line', sphere: 'a sphere' };

/**
 * Draws rectangles, circles and polygons into sketches and pulls them into extrusions. A shape goes into the sketch
 * under the pointer, or onto the top face of the body under it (that face's sketch; pulling into the body cuts), or
 * into the selected sketch, or onto the base plane facing the camera. Right after drawing, moving pulls; a click
 * without pulling or Esc keeps it flat and the tool goes on. the pointer snaps to the zoom's step (Ctrl: the minimum step), to corners and
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
  /** Where the last line ended (world; kept across tool restarts): a ⌘ (else Ctrl)-click draws the next line from there. */
  private static lineEnd: THREE.Vector3 | null = null;
  /** The direction the last line ended in (world): a line on from its end measures its angle from it. */
  private static lineDir: THREE.Vector3 | null = null;
  /** Pulling: waiting for the click that sets how far ("to object"); what the pointer would reach meanwhile. */
  private reaching = false;
  private aimed: string | null = null;
  /** Lines and polygon sides snap to this angle step while Shift is held (A finer, Shift A coarser; kept across restarts). */
  /** The angle step Shift turns in (A / Shift A: finer / coarser, see `ANGLE_STEPS`). */
  static angleStep = 45;
  /** Shift held while drawing a line or polygon; the angle rays show then, and until `raysUntil` after a step change. */
  private shiftHeld = false;
  private raysUntil = 0;
  /** Snap points along a line (by its key, see `sideKey`): evenly spaced inside a side, or around a circle. Kept across tool restarts. */
  private static divisions = new Map<string, number>();
  /** The line the pointer snapped to or along (its key), for A / Shift A. */
  private snapKey: string | null = null;
  /** The line whose snap points were just changed: all its points show while the pointer stays on it. */
  private showing: string | null = null;
  private dots: THREE.Vector3[] = [];
  /** The last pointer position snapped, to snap again when the points change. */
  private lastPoint: [MouseEvent, Target] | null = null;
  /**
   * Guide lines (world, through `at` along `dir`): a straight line or edge hovered for `guideMs` gets one, snapped to
   * like any line. One per direction (a parallel one replaces it); a click or the tool ending drops them, unless fixed
   * (G): those stay until G again or sketch mode ends (`dropGuides`).
   */
  private static guides: { at: THREE.Vector3; dir: THREE.Vector3; fixed: boolean }[] = [];
  /** Hover time (ms) on a line before it gets a guide (Settings → General). */
  static guideMs = 333;
  /** The straight line or edge the pointer is on (world), for a guide. */
  private snapSeg: Segment | null = null;
  /** The corner, line end or centre the pointer snapped to (world): resting there gives guides along both plane axes. */
  private snapPoint: THREE.Vector3 | null = null;
  /** Drops all guide lines, fixed ones too (sketch mode ended). */
  static dropGuides() {
    SketchTool.guides = [];
  }
  /** The guide the pointer is on. */
  private onGuide: (typeof SketchTool.guides)[number] | null = null;
  private dwell: { seg: Segment | null; point: THREE.Vector3 | null; timer: number } = { seg: null, point: null, timer: 0 };
  private labels = Object.assign(document.createElement('div'), { className: 'size-labels' });
  /** Letting Shift go hides the angle rays without waiting for the pointer to move. */
  private shiftUp = (e: KeyboardEvent) => e.key === 'Shift' && this.shiftHeld && ((this.shiftHeld = false), this.update());

  constructor(
    readonly kind: ToolKind | null,
    private view: ToolView,
    private host: ToolHost,
    readonly mode?: ToolMode,
  ) {
    view.el.append(this.labels);
    addEventListener('keyup', this.shiftUp);
    if (mode?.kind === 'pull') {
      const sketch = view.sketches.find((s) => s.id === mode.target.sketch);
      this.enterPull(mode.target, sketch?.shapes.filter((s) => mode.ids.includes(s.id)) ?? [], undefined, mode.ids);
    } else this.host.hint(this.hoverHint());
    this.update();
  }

  dispose() {
    clearTimeout(this.dwell.timer);
    removeEventListener('keyup', this.shiftUp);
    this.view.aimAt(null);
    SketchTool.guides = SketchTool.guides.filter((g) => g.fixed);
    this.view.unlockPointer();
    this.view.markFace();
    this.clearPreview();
    this.labels.remove();
    this.host.cursorTip(null);
    this.view.render();
  }

  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean {
    const used = this.press(e);
    SketchTool.guides = SketchTool.guides.filter((g) => g.fixed); // a click (which may have snapped to them) drops the others
    this.update();
    return used;
  }

  private press(e: PointerEvent): boolean {
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
      const at = this.point(e, target);
      if (!at) return true;
      this.view.markFace();
      if (this.kind === 'line' && SketchTool.lineEnd && mod(e)) {
        this.phase = { kind: 'polygon', target, pts: [uvOf(target.frame, SketchTool.lineEnd), at], cur: at, typed: [], axis: 0, base: 0 };
        this.finishLine();
        return this.update(), true;
      }
      this.phase =
        this.kind === 'polygon' || this.kind === 'line'
          ? { kind: 'polygon', target, pts: [at], cur: at, typed: [], axis: 0, base: 0 }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, alt: e.altKey, shift: e.shiftKey };
      this.host.hint(this.kind === 'polygon' ? POLYGON_HINT : this.kind === 'line' ? LINE_HINT : SHAPE_HINT);
    } else if (ph.kind === 'shape') this.shapeDone(); // second click of click-click drawing
    else if (ph.kind === 'polygon') {
      const at = this.sideEnd(e, ph);
      if (!at) return true;
      const r = this.view.el.getBoundingClientRect();
      const [x, y] = this.view.toScreen(v3(toWorld(ph.target.frame, ...ph.pts[0])));
      this.corner(ph, at, Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8);
      if (this.phase.kind === 'hover' && this.kind === 'line' && mod(e)) this.chain(e, ph.target); // ⌘ still held: on from this end
    } else if (ph.kind === 'pull' && this.reaching) {
      // "to object": the depth to the clicked point, along the plane's normal
      const p = this.view.pointAt(e);
      if (!p) return true;
      this.reaching = false;
      this.aimed = null;
      this.view.aimAt(null);
      ph.depth = p.sub(v3(ph.target.frame.o)).dot(v3(ph.target.frame.n));
      ph.typed = undefined;
      this.commit();
    } else if (ph.kind === 'pull') this.commit();
    this.update();
    return true;
  }

  move(e: PointerEvent) {
    const ph = this.phase;
    this.snapWhat = this.snapKey = null;
    this.snapSeg = this.onGuide = null;
    if (ph.kind === 'hover') {
      if (!this.kind && this.mode?.kind !== 'plane') return;
      const target = this.target(e);
      this.view.markFace(target?.body && !target.sketch ? this.view.hit(e) : undefined);
      this.host.hint(target ? this.hoverHint(target) : 'Only the top faces of extrusions take sketches for now · [Esc] stops');
      if (target) this.point(e, target); // shows a snap dot
      return this.update();
    }
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const at = ph.kind === 'polygon' ? this.sideEnd(e, ph) : this.point(e, ph.target);
      if (at) ph.cur = at;
      this.shiftHeld = e.shiftKey;
      if (ph.kind === 'shape') {
        ph.dragged ||= Math.hypot(e.clientX - ph.px[0], e.clientY - ph.px[1]) > 4;
        Object.assign(ph, { alt: e.altKey, shift: e.shiftKey });
      }
    } else {
      if (this.reaching) return this.aim(this.view.aimAt(e)); // aiming at what to reach
      ph.alt = e.altKey;
      pullBy(this.view, e, ph.target.frame.n, this.middle(ph), ph);
      const step = this.view.step(this.middle(ph), e);
      ph.depth = Math.round(ph.raw / step) * step;
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
    // a line's length or angle starts with a digit, so letters still snap, fix guides and switch tools
    const sideTyping = ph.kind === 'polygon' && (ph.typed[ph.axis] !== undefined || /[\d.(-]/.test(e.key));
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull' || sideTyping);
    const more = pressed(e, 'moreSnaps');
    const free = ph.kind !== 'pull' && !((ph.kind === 'shape' || ph.kind === 'polygon') && ph.typed[ph.axis] !== undefined); // not while typing a size
    const guide = this.hoveredGuide();
    const modKey = MAC ? 'Meta' : 'Control';
    if (ph.kind === 'hover' && this.kind === 'line' && SketchTool.lineEnd && e.key === modKey && this.lastPoint) {
      this.chain(...this.lastPoint);
      this.update();
      return false;
    }
    // ⌘ was for a shortcut (⌘Z …), not for a line on from the last
    if (ph.kind === 'polygon' && ph.chained && ph.pts.length === 1 && !ph.typed.some((t) => t !== undefined) && (MAC ? e.metaKey : e.ctrlKey) && e.key !== modKey) {
      this.phase = { kind: 'hover' };
      this.host.hint(this.hoverHint());
      this.update();
      return false;
    }
    if (free && guide && pressed(e, 'fixGuide')) guide.fixed = !guide.fixed;
    else if (free && ph.kind === 'polygon' && pressed(e, 'baseline')) {
      // the hovered line, either way round: the one nearer the side's direction (again, or off a line: the x axis)
      const line = this.hoveredLine(ph.target.frame);
      const now = Math.atan2(ph.cur[1] - ph.pts[ph.pts.length - 1][1], ph.cur[0] - ph.pts[ph.pts.length - 1][0]);
      const along = line === null ? 0 : Math.abs(deg(line - now)) <= 90 ? line : line + Math.PI;
      ph.base = line !== null && Math.abs(deg(along - ph.base)) > 1e-6 ? along : 0;
      if (this.lastPoint) ph.cur = this.sideEnd(this.lastPoint[0], ph) ?? ph.cur;
    }
    else if (free && (more || pressed(e, 'fewerSnaps')) && this.snapKey && this.lastPoint) {
      const k = this.snapKey;
      const circle = k.startsWith('circle:');
      SketchTool.divisions.set(k, Math.max(circle ? 2 : 1, (SketchTool.divisions.get(k) ?? (circle ? 4 : 1)) + (more ? 1 : -1)));
      this.showing = k;
      const at = ph.kind === 'polygon' ? this.sideEnd(this.lastPoint[0], ph) : this.point(...this.lastPoint);
      if (at && (ph.kind === 'shape' || ph.kind === 'polygon')) ph.cur = at;
    } else if (free && (more || pressed(e, 'fewerSnaps')) && ph.kind === 'polygon') {
      // off a line: the angle step for Shift, finer or coarser; its rays show for a moment
      const i = ANGLE_STEPS.indexOf(SketchTool.angleStep);
      SketchTool.angleStep = ANGLE_STEPS[Math.min(ANGLE_STEPS.length - 1, Math.max(0, i + (more ? 1 : -1)))];
      this.raysUntil = performance.now() + 1500;
      setTimeout(() => this.update(), 1600);
    } else if (ph.kind === 'polygon' && e.key === 'Shift') {
      this.shiftHeld = true; // the rays show at once
      this.update();
      return false;
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
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (pressed(e, 'erase') && ph.typed[ph.axis] !== undefined) ph.typed[ph.axis] = ph.typed[ph.axis]!.slice(0, -1) || undefined;
      else if (pressed(e, 'otherSide')) ph.axis = 1 - ph.axis;
      else if (pressed(e, 'confirm') && ph.typed.some((t) => t !== undefined)) this.corner(ph, ph.cur, false); // typed: Enter sets the corner
      else if (pressed(e, 'confirm')) this.closePolygon();
      else if (pressed(e, 'erase') && ph.pts.length > 1) ph.pts.pop();
      else return false;
      if (this.phase === ph && this.lastPoint) ph.cur = this.sideEnd(this.lastPoint[0], ph) ?? ph.cur; // typed values apply at once
    } else if (ph.kind === 'pull') {
      if (ph.typed === undefined && pressed(e, 'toObject')) {
        // the next click picks how far: the pointer shows again for it
        this.reaching = true;
        this.view.unlockPointer();
        this.host.hint('Click a corner, edge or face: the extrusion reaches it · [Esc] cancels');
        return this.aim(this.view.aimHere()), true;
      } else if (pressed(e, 'confirm')) this.commit();
      else if (!pullKey(e, ph)) return false;
    } else return false;
    this.update();
    return true;
  }

  private hoverHint(target?: Target) {
    if (this.mode?.kind === 'plane') return `Click ${target ? target.name : 'a top face or empty space'} to draw on it · [Esc] cancels`;
    const how = this.kind === 'polygon' ? 'Click corners' : this.kind === 'line' ? `Click two points${SketchTool.lineEnd ? ` ([${MAC ? '⌘' : 'Ctrl'}]-click: on from the last end)` : ''}` : 'Drag (or click twice)';
    if (this.mode?.kind === 'draw') return `${how} to draw ${NAMES[this.kind!]} · [R] [C] [P] switch · snaps to corners and centres · [A] / [Shift A] more / fewer snap points on a line · [Ctrl] grid · [Esc] stops drawing shapes`;
    return `${how} to draw ${NAMES[this.kind!]}${target ? ` on ${target.name}` : ''} · [Ctrl] precise · right-drag turns the view · [Esc] stops`;
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
      // a back face seen through a section cut: the cut face in front of it takes the shapes
      const placed = hit.face!.normal.dot(ray.direction) > 0 ? this.view.cutPlane(e) : this.view.placeOn(hit);
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
    for (const { segs, shape, guide } of lines) {
      if (guide) continue;
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
    const guides = SketchTool.guides.map((guide) => ({ segs: [guideSeg(guide)], what: 'on guide', guide }));
    return [...outlines, ...this.view.edges().map((segs) => ({ segs, what: 'on edge' })), ...guides];
  }

  /**
   * For a guide at the top, bottom or a side of something round (as seen along the plane's axes): sketch circles,
   * curved body edges, sphere outlines. The pointer within `px` of such a point gives the segment along the axis
   * across it, projected onto the plane.
   */
  private roundSeg(e: MouseEvent, t: Target, lines: SnapLine[], px = 10): Segment | null {
    const [u, v] = [v3(t.frame.x), v3(t.frame.y)];
    const sides: [THREE.Vector3, THREE.Vector3][] = [[u, v], [u.clone().negate(), v], [v, u], [v.clone().negate(), u]]; // outward, along
    const tops: [THREE.Vector3, THREE.Vector3][] = [];
    for (const l of lines)
      if (l.shape?.p.kind === 'circle' || (!l.shape && !l.guide && l.segs.length > 1)) {
        const pts = [l.segs[0][0], ...l.segs.map((g) => g[1])];
        for (const [w, along] of sides) tops.push([pts.reduce((a, b) => (b.dot(w) > a.dot(w) ? b : a)), along]);
      }
    for (const s of this.view.spheres()) for (const [w, along] of sides) tops.push([s.center.clone().addScaledVector(w, s.r), along]);
    const r = this.view.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    let best: [THREE.Vector3, THREE.Vector3] | null = null;
    let nearest = px;
    for (const top of tops) {
      const [x, y] = this.view.toScreen(top[0]);
      const d = Math.hypot(mx - x, my - y);
      if (d < nearest) [best, nearest] = [top, d];
    }
    if (!best) return null;
    const at = v3(toWorld(t.frame, ...uvOf(t.frame, best[0])));
    return [at, at.clone().add(best[1])];
  }

  /** The direction (radians, in the frame's plane) of the straight line, edge or guide the pointer is on; null: none. */
  private hoveredLine(f: Frame): number | null {
    const [a, b] = this.onGuide ? guideSeg(this.onGuide) : (this.snapSeg ?? []);
    if (!a || !b) return null;
    const d = b.clone().sub(a);
    const [x, y] = [d.dot(v3(f.x)), d.dot(v3(f.y))];
    return Math.hypot(x, y) > 1e-9 ? Math.atan2(y, x) : null;
  }

  /** The guide the pointer is on, or the guide of the line it is on. */
  private hoveredGuide() {
    return this.onGuide ?? SketchTool.guides.find((g) => this.snapSeg && onLine(g, this.snapSeg));
  }

  /** A guide along a hovered line; it replaces an unfixed one in the same direction. */
  private addGuide([a, b]: Segment) {
    const dir = b.clone().sub(a).normalize();
    const parallel = (g: (typeof SketchTool.guides)[number]) => g.dir.clone().cross(dir).length() < 1e-6;
    if (SketchTool.guides.some((g) => onLine(g, [a, b]))) return;
    SketchTool.guides = [...SketchTool.guides.filter((g) => g.fixed || !parallel(g)), { at: a.clone(), dir, fixed: false }];
    this.update();
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
   * on the step for the zoom (Ctrl: the minimum step; `grid` false: where it is). Sets `snapWhat`.
   */
  private point(e: MouseEvent, t: Target, grid = true): UV | null {
    this.lastPoint = [e, t];
    const lines = this.snapLines();
    const uv = this.snapAt(e, t, lines, grid);
    this.snapSeg ??= this.roundSeg(e, t, lines);
    if (this.showing !== this.snapKey) this.showing = null; // the pointer left the line just changed
    this.dots = this.showing ? this.snapPoints(t, this.snapLines()).filter((q) => q.key === this.showing).map((q) => v3(toWorld(t.frame, ...q.at))) : [];
    return uv;
  }

  private snapAt(e: MouseEvent, t: Target, lines: SnapLine[], grid: boolean, px = 10, linePx = 8): UV | null {
    const p = planeHit(this.view.ray(e), t.frame);
    if (!p) return null;
    const r = this.view.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    let near: SnapPoint | undefined;
    let nearest = px;
    for (const q of this.snapPoints(t, lines)) {
      const [x, y] = this.view.toScreen(v3(toWorld(t.frame, ...q.at)));
      const d = Math.hypot(mx - x, my - y);
      if (d < nearest) [near, nearest] = [q, d];
    }
    this.snapLine = null;
    this.snapped = near ? v3(toWorld(t.frame, ...near.at)) : null;
    this.snapPoint = near && !near.key ? this.snapped : null; // not a point along a line (that line gives the guide)
    this.snapWhat = near?.what ?? null;
    this.snapKey = near?.key ?? null;
    this.snapSeg = near?.key && !near.key.startsWith('circle:') ? near.line![0] : null;
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
    let best: { at: THREE.Vector3; line: Segment[]; what: string; key?: string; seg?: Segment; guide?: (typeof SketchTool.guides)[number]; d: number } | null = null;
    const close: { line: number; a: UV; b: UV }[] = [];
    // along lines and at their crossings only in the plane drawn on: a line off it would snap to its projection, away from the pointer
    let off: { seg: Segment; d: number } | null = null; // the nearest straight line off the plane: hovered, it gives a guide (projected)
    for (const [line, { segs, what, shape, guide }] of lines.entries())
      for (const [a, b] of segs) {
        const flat = inPlane(t.frame, a) && inPlane(t.frame, b);
        if (!flat && (guide || shape?.p.kind === 'circle' || (!shape && segs.length > 1))) continue;
        const { d, k } = this.screenDist(mx, my, a, b);
        if (d >= linePx) continue;
        if (!flat) {
          if (!off || d < off.d) off = { seg: [a, b], d };
          continue;
        }
        close.push({ line, a: uvOf(t.frame, a), b: uvOf(t.frame, b) });
        // the line for A / Shift A: a circle, a straight side, or a straight body edge
        const key = guide ? undefined : shape?.p.kind === 'circle' ? `circle:${shape.p.id}` : shape || segs.length === 1 ? sideKey(a, b) : undefined;
        if (!best || d < best.d) best = { at: a.clone().lerp(b, k), line: segs, what, key, seg: key && !key.startsWith('circle:') ? [a, b] : undefined, guide, d };
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
      this.snapSeg = best.seg ?? null;
      this.onGuide = best.guide ?? null;
      return uv;
    }
    if (off) {
      const seg = off.seg.map((v) => v3(toWorld(t.frame, ...uvOf(t.frame, v)))) as Segment;
      if (seg[0].distanceTo(seg[1]) > 1e-3) this.snapSeg = seg; // not seen end-on
    }
    const [u, v] = uvOf(t.frame, p);
    if (!grid) return [u, v];
    const step = this.view.step(p, e, false); // Shift squares shapes here, it does not coarsen
    return [Math.round(u / step) * step, Math.round(v / step) * step];
  }

  /**
   * The open side's end for the pointer, as angle (from `base`) and length from the last corner. Angle: typed, else the angle step
   * (Shift), else towards a snap point or line, else in 1° steps (Ctrl: the minimum angle). Length: typed, else up to
   * the snap (along that angle), else on the zoom's step (Ctrl: the minimum step).
   */
  private sideEnd(e: MouseEvent, ph: Extract<Phase, { kind: 'polygon' }>): UV | null {
    const at = this.point(e, ph.target, false);
    if (!at) return null;
    const [x0, y0] = ph.pts[ph.pts.length - 1];
    const [du, dv] = [at[0] - x0, at[1] - y0];
    // relative to the direction it counts from
    const raw = deg(Math.atan2(dv, du) - ph.base);
    const by = (step: number) => Math.round(raw / step) * step;
    const typedDeg = ph.typed[1] === undefined ? null : this.host.number(ph.typed[1]);
    const a = ph.base + ((typedDeg ?? (e.shiftKey ? by(SketchTool.angleStep) : this.snapped ? raw : by(e.ctrlKey ? this.view.minAngle : 1))) * Math.PI) / 180;
    const along = du * Math.cos(a) + dv * Math.sin(a);
    const step = this.view.step(v3(toWorld(ph.target.frame, ...at)), e, false);
    const len = this.typed(ph.typed[0]) ?? (this.snapped ? along : Math.round(along / step) * step);
    return [x0 + len * Math.cos(a), y0 + len * Math.sin(a)];
  }

  /** Aiming "to object" while pulling: the depth follows what the pointer would reach, the pointer's note says what. */
  private aim(s: { at: THREE.Vector3; what: string } | null) {
    const ph = this.phase;
    if (ph.kind === 'pull' && s) Object.assign(ph, { depth: s.at.clone().sub(v3(ph.target.frame.o)).dot(v3(ph.target.frame.n)), typed: undefined });
    this.aimed = s?.what ?? null;
    this.update();
  }

  /** ⌘ (else Ctrl) after a line: the next one starts at its end, shown, snapped and typed into like the first. */
  private chain(e: MouseEvent, t: Target) {
    const d = SketchTool.lineDir;
    const base = d ? Math.atan2(d.dot(v3(t.frame.y)), d.dot(v3(t.frame.x))) : 0;
    const ph: Extract<Phase, { kind: 'polygon' }> = { kind: 'polygon', target: t, pts: [uvOf(t.frame, SketchTool.lineEnd!)], cur: uvOf(t.frame, SketchTool.lineEnd!), typed: [], axis: 0, base, chained: true };
    this.phase = ph;
    ph.cur = this.sideEnd(e, ph) ?? ph.cur;
    this.host.hint(LINE_HINT);
  }

  /** Adds a corner: a line is done at its second, a polygon when it `closes` (on its first corner, from the 4th). */
  private corner(ph: Extract<Phase, { kind: 'polygon' }>, at: UV, closes: boolean) {
    const prev = ph.pts[ph.pts.length - 1];
    ph.pts.push(at);
    ph.typed = [];
    ph.axis = 0;
    ph.base = Math.atan2(at[1] - prev[1], at[0] - prev[0]); // the next side counts from this one
    if (this.kind === 'line') this.finishLine();
    else if (closes && ph.pts.length >= 4) (ph.pts.pop(), this.closePolygon());
  }

  private typed(text: string | undefined) {
    return text === undefined ? undefined : (this.host.length(text) ?? undefined);
  }

  /** The directions Shift snaps to: short rays around the last corner, the one in use stronger. */
  private angleRays(ph: Extract<Phase, { kind: 'polygon' }>, px = 46) {
    const f = ph.target.frame;
    const last = ph.pts[ph.pts.length - 1];
    const at = v3(toWorld(f, ...last));
    const r = px / this.view.pixelsPerMm(at);
    const step = SketchTool.angleStep;
    const now = deg(Math.atan2(ph.cur[1] - last[1], ph.cur[0] - last[0]) - ph.base);
    // fine steps: only those near the pointer's direction (360 rays would be a blur)
    const angles = Array.from({ length: Math.round(360 / step) }, (_, k) => k * step).filter((a) => step >= 5 || Math.abs(((a - now + 540) % 360) - 180) < 12);
    const ray = (a: number, k = 1) => [at, v3(toWorld(f, last[0] + r * k * Math.cos(ph.base + (a * Math.PI) / 180), last[1] + r * k * Math.sin(ph.base + (a * Math.PI) / 180)))];
    const near = Math.round(now / step) * step;
    for (const [pts, color, width] of [
      [angles.flatMap((a) => ray(a)), 0xff8c1a, 1],
      [ray(near, 1.6), 0xff8c1a, 2.5],
    ] as const) {
      const m = new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true, opacity: width > 1 ? 0.9 : 0.45 });
      this.view.overlay.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(pts.flatMap((v) => v.toArray())), m), { renderOrder: 1e6 }));
    }
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
    SketchTool.lineDir = SketchTool.lineEnd.clone().sub(v3(toWorld(ph.target.frame, ...pts[pts.length - 2])));
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
    const { depth, back } = flat ? { depth: 0, back: 0 } : pulled(ph, (t) => this.host.length(t));
    this.phase = { kind: 'hover' };
    this.view.unlockPointer();
    if (this.kind) this.host.hint(this.hoverHint()); // before done: the host may replace this tool
    if (!ph.drawn && !depth && !back) return this.host.done(null);
    this.host.done({
      target: ph.target,
      drawn: ph.drawn,
      shapes: ph.ids,
      depth,
      depthTyped: flat || this.typed(ph.typed) === undefined ? undefined : ph.typed,
      back,
      backTyped: flat || this.typed(ph.typedBack) === undefined ? undefined : ph.typedBack,
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
    // a line hovered long enough gets a guide, a point two (along the plane's axes)
    const point = this.snapSeg ? null : this.snapPoint;
    const frame = this.lastPoint?.[1].frame;
    if (!sameSeg(this.snapSeg, this.dwell.seg) || !(point === this.dwell.point || (point && this.dwell.point?.equals(point)))) {
      clearTimeout(this.dwell.timer);
      const seg = this.snapSeg;
      const guide = seg ? () => this.addGuide(seg) : point && frame ? () => [frame.x, frame.y].forEach((d) => this.addGuide([point, point.clone().add(v3(d))])) : null;
      this.dwell = { seg, point, timer: guide ? window.setTimeout(guide, SketchTool.guideMs) : 0 };
    }
    this.clearPreview();
    const labels: [string, THREE.Vector3, boolean][] = []; // text, where, typed into
    let angle: Parameters<SketchTool['angleLabel']>[0] | null = null; // the open side's angle: placed last, around the others
    let sideLength: string | null = null;
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
      if (ph.kind === 'polygon') {
        // the open side: its length first in the pointer's note, its angle labelled inside the angle
        const last = ph.pts[ph.pts.length - 1];
        const [du, dv] = [ph.cur[0] - last[0], ph.cur[1] - last[1]];
        const a = (deg(Math.atan2(dv, du) - ph.base) * Math.PI) / 180; // from the direction it counts from, the short way
        const at = v3(toWorld(f, ...last));
        const mm = 1 / this.view.pixelsPerMm(at);
        sideLength = `L ${ph.typed[0] === undefined ? fmt(Math.hypot(du, dv)) : `${ph.typed[0]}▏`}`;
        const shown = `${+((a * 180) / Math.PI).toFixed(2)}°`;
        angle = { text: `∠ ${ph.typed[1] === undefined ? shown : `${ph.typed[1]}▏`}`, active: ph.axis === 1, corner: last, end: ph.cur, base: ph.base, frame: f };
        // what it is measured from: a faint ray along that direction, and the arc from it to the side
        const arc = Array.from({ length: 25 }, (_, k) => ph.base + (a * k) / 24).map((t) => v3(toWorld(f, last[0] + ARC_PX * mm * Math.cos(t), last[1] + ARC_PX * mm * Math.sin(t))));
        const segs = [at, v3(toWorld(f, last[0] + 2 * ARC_PX * mm * Math.cos(ph.base), last[1] + 2 * ARC_PX * mm * Math.sin(ph.base))), ...arc.slice(1).flatMap((p, k) => [arc[k], p])];
        const m = new LineMaterial({ color: 0xff8c1a, linewidth: 1, depthTest: false, transparent: true, opacity: 0.7 });
        m.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
        this.view.overlay.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(segs.flatMap((v) => v.toArray())), m), { renderOrder: 1e6 }));
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
    for (const g of ph.kind === 'pull' ? [] : SketchTool.guides) {
      // dashed like construction lines (mm)
      const m = new LineMaterial({ color: GUIDE_COLOR, linewidth: g.fixed ? 1.4 : 0.8, depthTest: false, dashed: true, dashSize: 1.5, gapSize: 1.5 });
      m.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
      this.view.overlay.add(new LineSegments2(new LineSegmentsGeometry().setPositions(guideSeg(g).flatMap((v) => v.toArray())), m).computeLineDistances());
    }
    const chain = this.kind === 'line' && ph.kind === 'hover' && SketchTool.lineEnd ? `Hold ${MAC ? '⌘' : 'Ctrl'} to start the line from the end of the last one` : null;
    // on a point along a line (not anywhere along it)
    const more = this.snapKey && !this.snapWhat?.startsWith('on ') ? `Press ${comboText(KEYS.moreSnaps.default[0])} for more points, ${comboText(KEYS.fewerSnaps.default[0])} for fewer` : null;
    const guide = this.hoveredGuide();
    const fix = guide ? `Press ${comboText(KEYS.fixGuide.default[0])} to ${guide.fixed ? 'let the guide go with the next click' : 'keep the guide'}` : null;
    const base = ph.kind === 'polygon' && this.hoveredLine(ph.target.frame) !== null ? `Press ${comboText(KEYS.baseline.default[0])} to measure the angle from this line` : null;
    const angles = ph.kind === 'polygon' && !this.snapKey ? `Angle steps ${SketchTool.angleStep}° · hold Shift to snap · ${comboText(KEYS.moreSnaps.default[0])} finer, ${comboText(KEYS.fewerSnaps.default[0])} coarser` : null;
    // pulling: what T does, or while aiming what the pointer reaches
    const pulling = ph.kind === 'pull' && (this.reaching ? [this.aimed, 'Click: the pull reaches it'].filter(Boolean).join('\n') : ph.typed === undefined ? TO_OBJECT : null);
    this.host.cursorTip(ph.kind === 'pull' ? pulling || null : [sideLength, this.snapWhat, more, fix, base, angles, chain].filter(Boolean).join('\n') || null); // one per line
    if (ph.kind === 'polygon' && (this.shiftHeld || performance.now() < this.raysUntil)) this.angleRays(ph);
    if (ph.kind === 'pull') {
      const f = ph.target.frame;
      const { depth, back } = pulled(ph, (t) => this.host.length(t));
      for (const p of ph.shapes) this.view.overlay.add(outline(p, f));
      if (depth || back) this.solid(ph.shapes, f, depth, back);
      label('Depth', ph.typed, depth, this.middle(ph).addScaledVector(v3(f.n), depth), !ph.side);
      if (back || ph.side) label('Back', ph.typedBack, back, this.middle(ph).addScaledVector(v3(f.n), -(Math.sign(depth) || 1) * back), !!ph.side);
    }
    const els = labels.map(([text, , active]) => Object.assign(document.createElement('div'), { className: `size-label${active ? ' active' : ''}`, textContent: text }));
    this.labels.replaceChildren(...els);
    labels.forEach(([, at], i) => keepInside(els[i], ...this.view.toScreen(at)));
    if (angle) this.angleLabel(angle, els);
    this.view.render();
  }

  /**
   * The angle's label: inside the angle, between the ray it is measured from and the side, as close to the corner as
   * it stays clear of the other labels, both lines, the pointer and its note; too tight there, just outside the angle.
   */
  private angleLabel(a: { text: string; active: boolean; corner: UV; end: UV; base: number; frame: Frame }, others: HTMLElement[], margin = 4) {
    const el = Object.assign(document.createElement('div'), { className: `size-label${a.active ? ' active' : ''}`, textContent: a.text });
    this.labels.append(el);
    const [w, h] = [el.offsetWidth / 2 + margin, el.offsetHeight / 2 + margin];
    const box = this.labels.getBoundingClientRect();
    const local = (q: DOMRect) => [q.left - box.left, q.top - box.top, q.right - box.left, q.bottom - box.top];
    const screen = (q: UV) => this.view.toScreen(v3(toWorld(a.frame, ...q)));
    const c = screen(a.corner);
    const e = screen(a.end);
    const tip = this.host.cursorTipRect();
    // the view's own controls (view cube, breadcrumb …) are in the way too
    const controls = [...this.view.el.children].filter((o) => o !== this.labels && !(o instanceof HTMLCanvasElement) && (o as HTMLElement).offsetParent);
    const taken = [...[...others, ...controls].map((o) => local(o.getBoundingClientRect())), ...(tip ? [local(tip)] : []), [e[0] - 12, e[1] - 12, e[0] + 12, e[1] + 12]];
    // screen directions of the ray measured from and of the side; the angle between them, signed, the short way
    const ref = screen([a.corner[0] + Math.cos(a.base), a.corner[1] + Math.sin(a.base)]);
    const a0 = Math.atan2(ref[1] - c[1], ref[0] - c[0]);
    const a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    const sweep = ((((a1 - a0 + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const s = Math.sign(sweep) || 1;
    const t = (deg(Math.atan2(a.end[1] - a.corner[1], a.end[0] - a.corner[0]) - a.base) * Math.PI) / 180;
    const mm = ARC_PX / this.view.pixelsPerMm(v3(toWorld(a.frame, ...a.corner)));
    const arc = Array.from({ length: 13 }, (_, k) => a.base + (t * k) / 12).map((u) => screen([a.corner[0] + mm * Math.cos(u), a.corner[1] + mm * Math.sin(u)]));
    const lines = [[c, [c[0] + 2 * ARC_PX * Math.cos(a0), c[1] + 2 * ARC_PX * Math.sin(a0)]], [c, e], ...arc.slice(1).map((p, k) => [arc[k], p])];
    const fits = ([cx, cy]: number[]) => {
      const [l, t, r, b] = [cx - w, cy - h, cx + w, cy + h];
      const covers = ([px, py]: number[]) => px > l && px < r && py > t && py < b;
      return l >= 0 && t >= 0 && r <= box.width && b <= box.height && !taken.some(([L, T, R, B]) => L < r && R > l && T < b && B > t) && !lines.some(([p, q]) => Array.from({ length: 41 }, (_, k) => k / 40).some((k) => covers([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])])));
    };
    const at = (dir: number, dist: number) => [c[0] + dist * Math.cos(dir), c[1] + dist * Math.sin(dir)];
    // inside the angle (nearest first, the middle first), else just outside it on either side
    const spots = [
      ...[1.6, 2.2, 3].flatMap((k) => [0.5, 0.35, 0.65, 0.2, 0.8].map((f) => at(a0 + f * sweep, k * ARC_PX))),
      ...[1.6, 2.4, 3.4].flatMap((k) => [0.5, 0.9, 1.4].flatMap((d) => [at(a0 - s * d, k * ARC_PX), at(a1 + s * d, k * ARC_PX)])),
    ];
    const [px, py] = spots.find(fits) ?? spots[0];
    keepInside(el, px, py);
  }

  /** Translucent extrusion of the shapes; shapes inside an odd number of others are holes. */
  private solid(ps: DrawnProfile[], f: Frame, depth: number, back: number) {
    const level = nesting(ps);
    const shapes = ps.flatMap((p, i) => {
      if (level[i] % 2) return [];
      const outer = shape2d(p);
      outer.holes = ps.filter((q, j) => level[j] === level[i] + 1 && inside(p, ...centre(q))).map(shape2d);
      return [outer];
    });
    const [from, to] = extent(depth, back);
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: to - from, bevelEnabled: false, curveSegments: 32 });
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x3b6fd8, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(v3(f.x), v3(f.y), v3(f.n)).setPosition(v3(f.o).addScaledVector(v3(f.n), from));
    this.view.overlay.add(mesh);
  }
}

const SHAPE_HINT = '[Alt] from the centre · [Shift] square / 15° · [Ctrl] precise · type a size, [Tab] other side or number of sides · [Enter] or click: done · [Esc] cancels';
const LINE_HINT = 'Click the end point · type a length, [Tab] the angle, [Enter] · turns in 1° steps, [Shift] angle steps, [Ctrl] precise · [B] on a line: measure the angle from it · [Esc] cancels';
/** An angle (radians) in degrees, the short way: -180 to 180. */
const deg = (rad: number) => ((((rad * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
/** The pointer's note while pulling (before typing a depth). */
export const TO_OBJECT = 'T: to object (the pull reaches what you click)';
/** Radius (px) of the arc showing what a side's angle is measured from. */
const ARC_PX = 36;
/** Angle steps for Shift on lines and polygon sides, coarse to fine. */
export const ANGLE_STEPS = [90, 45, 30, 15, 10, 5, 1];
const POLYGON_HINT = 'Click corners · type a length, [Tab] the angle, [Enter] · [Shift] angle steps, [Ctrl] precise · [B] on a line: measure the angle from it · click the first one, double-click or [Enter] to close it · [Esc] leaves it open · [Backspace] removes the last';
const PULL_HINT = 'Move to pull · [Alt] both ways from the plane · [Shift] coarse · [Ctrl] precise · type a depth, [Tab] how far back · [T] to object · click or [Enter]: done';

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

/**
 * The shape's outline on the frame's plane, `width` px wide, lifted `lift` mm along the normal (0: drawn over
 * everything, for previews); construction lines dashed; `opacity` below 1: faint.
 */
export function outline(p: DrawnProfile, f: Frame, color = 0x3b6fd8, lift = 0, dashMm = 1.5, width = 2, opacity = 1) {
  const n = v3(f.n).multiplyScalar(lift);
  const pts = (p.kind === 'line' ? p.pts.map(([x, y]) => ({ x, y })) : shape2d(p).getPoints(48)).map((q) => v3(toWorld(f, q.x, q.y)).add(n));
  if (p.kind !== 'line') pts.push(pts[0]); // closed by its own last segment
  const material = new LineMaterial({ color, linewidth: width, depthTest: lift !== 0, dashed: !!p.construction, dashSize: dashMm, gapSize: dashMm, transparent: opacity < 1, opacity });
  return new Line2(new LineGeometry().setPositions(pts.flatMap((v) => v.toArray())), material).computeLineDistances();
}
