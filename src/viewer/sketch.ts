import * as THREE from 'three';
import { BASE, extent, toWorld, type Frame, type V3 } from '../doc/frames';
import { arcOf, area, centre, corners, curved, inside, nesting, ontoArcThrough, cornerCuts, pointAlong, segCrossings, segLength, segments, segPoints, sideDirs, sidesOf, bakeTurn, type DrawnProfile } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BasePlane, Curve, ShapeGroup, SketchPlacement } from '../doc/types';
import { marks } from './marks';
import { ballAcross, ballOnFour, ballOnThree, ballsInCorner, bezierCurve, circleCurve, tangentAlong, tangentFrom, tangentStart, type Ball, type TangentCurve } from './shapes';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { comboText, keysOf, MODIFIER_NAMES, MODIFIER_SIGNS, pressed, role, roleKey, roleKeyName, type Action, type ModEvent } from '../ui/keys';
import { keepInside } from '../ui/inside';
import { caret, caretHtml, restOf } from '../ui/complete';
import { inName } from '../doc/expr';
import { sizeHtml } from '../ui/axes';
import { icon } from '../ui/icons';

export type ToolKind = 'rect' | 'circle' | 'ngon' | 'line' | 'sphere';
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
  /** A line's sides, what was typed for each (its points are worked out from these again when a parameter changes). */
  sides?: ({ l?: string; deg?: string; base?: number; d?: string } | null)[];
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
  /** Pulled on a body: what it does to it (see `pullOp`); else a new body. */
  op?: PullOp;
  /** How far it also reaches behind the plane (mm), as typed. */
  back?: number;
  backTyped?: string;
}

/** What the tool needs from the viewport. */
export interface ToolView {
  el: HTMLElement;
  /** A group's origin (world) new sketches on a base plane count from (its base planes, turned with it); null: the world's. */
  drawFrame: THREE.Matrix4 | null;
  /** The shown work planes (world frames, `half`: half their size in mm): drawing tools draw on them. */
  workPlanes: { id: string; name: string; frame: Frame; rect: [number, number, number, number] }[];
  overlay: THREE.Group;
  /** The step a drag moves in near `at` (mm), by the zoom and modifiers (Shift ×10 unless `coarse` is false, Ctrl the minimum). */
  step(at: THREE.Vector3, e?: ModEvent, coarse?: boolean): number;
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
  /** Whether the face of a hit is flat. */
  flatFace(hit: THREE.Intersection): boolean;
  /** What a click points at (world): a corner, an edge point or a face point; null: empty space. */
  pointAt(e: MouseEvent): THREE.Vector3 | null;
  /** Marks what a click at the pointer reaches (as `pointAt` finds it) and returns it; null: clears. */
  aimAt(e: MouseEvent | null): { at: THREE.Vector3; what: string } | null;
  /** The same where the pointer is now. */
  aimHere(): { at: THREE.Vector3; what: string } | null;
  /** The point a click reaches, from the real geometry; null: nothing there. */
  truePointAt(e: MouseEvent): Promise<THREE.Vector3 | null>;
  /** The nearest point on the true curve of a curved sketch side or circle (`only`: of that shape) within `reach` mm. */
  onSketchCurve(at: THREE.Vector3, reach?: number, only?: string): THREE.Vector3 | null;
  /** The point on the kernel's true line or circle of the body edge within `reach` mm of `at` (world); null: none (a mesh body). */
  onBodyEdge(at: THREE.Vector3, reach?: number): THREE.Vector3 | null;
  bodyCircleAt(at: THREE.Vector3, reach: number): { c: THREE.Vector3; n: THREE.Vector3; r: number } | null;
  bodyCurveTop(at: THREE.Vector3, w: THREE.Vector3, reach: number): THREE.Vector3 | null;
  /** Base plane facing the camera most. */
  facing(): BasePlane;
  /** Where the camera looks (world, unit). */
  looking(): THREE.Vector3;
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
  /** Lights a work plane (null: none). */
  lightPlane(id: string | null): void;
  /** Body corners in the world, to snap to. */
  corners(): THREE.Vector3[];
  /** Body edges in the world (each as segments), to snap to. */
  edges(): [THREE.Vector3, THREE.Vector3][][];
  /** Spheres in the world. */
  spheres(): { center: THREE.Vector3; r: number }[];
  /** Whether `solid` (world; `inner`: a point inside it) and body `id` share volume. */
  overlaps(id: string, solid: THREE.BufferGeometry, inner: THREE.Vector3): boolean;
  render(): void;
}

/** draw: flat shapes into a fixed sketch (sketch mode); pull: existing shapes; plane: pick a plane for a new sketch. */
export type ToolMode = { kind: 'draw'; target: Target } | { kind: 'plane' };

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
  /** A right click, not a drag. */
  rightClick?(e: MouseEvent): void;
  /** True while the tool only waits for clicks: a left drag then turns the view, a click without dragging goes to `down`. */
  clicks?(): boolean;
}

/** A pull's depth before snapping (mm), summed from pointer movement; `tap`: the centre modifier pressed, not moved since. */
export interface PullStart {
  raw: number;
  tap?: boolean;
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
  /** Chosen with P; none: by the direction (see `pullOp`). */
  op?: PullOp;
}

/** What a pull on a body does to it: joins it, cuts it, or makes a new body beside it. */
export type PullOp = 'join' | 'cut' | 'new';
export const PULL_OPS: Record<PullOp, string> = { join: 'Join', cut: 'Cut', new: 'New body' };
const OP_ICONS: Record<PullOp, string> = { join: 'union', cut: 'subtract', new: 'body' };

/** Whether a pull from `t` can join or cut a body: drawn on one of its faces. */
export const onBody = (t: Target) => !!t.body;

/** A pull's operation: on a body as chosen, else by the direction (into it: Cut, out of it: Join); Cut only where it shares volume with the body (`cuts`); elsewhere a new body. */
export function pullOp(p: Pulling, onBody: boolean, depth: number, cuts: boolean): PullOp {
  if (!onBody) return 'new';
  const op = p.op ?? (depth < 0 ? 'cut' : 'join');
  return op === 'cut' && !cuts ? 'join' : op;
}

/**
 * Whether a pull from `from` to `to` along `n` shares volume with `body`: `build` makes its solid in the world between
 * two depths, non-indexed, its first triangle on the first depth. Shrunk a hair along `n`, so faces only touching do not count.
 */
export function pullCuts(view: ToolView, body: string, n: V3, [from, to]: [number, number], build: (from: number, to: number) => THREE.BufferGeometry) {
  const eps = Math.min(0.01, (to - from) / 4);
  const geo = build(from + eps, to - eps);
  const p = geo.attributes.position;
  const corner = (i: number) => new THREE.Vector3().fromBufferAttribute(p, i);
  const inner = corner(0).add(corner(1)).add(corner(2)).divideScalar(3).addScaledVector(v3(n), (to - from) / 2 - eps);
  return view.overlaps(body, geo, inner);
}

/**
 * To object in a pull: the distance from the plane to `at` along its normal (for Back: behind it) goes into what is
 * being typed (depth or back), to calculate on with it; Enter keeps it.
 */
export function reachInto(p: Pulling, at: THREE.Vector3, frame: { o: V3; n: V3 }, host: ToolHost) {
  const d = at.clone().sub(v3(frame.o)).dot(v3(frame.n));
  const k = p.side ? 'typedBack' : 'typed';
  p[k] = (p[k] ?? '') + host.lengthText(p.side ? -d : d);
}

/** A pull's size label: the size along the world axis it goes (L, W, H along X, Y, Z), else Depth (a slanted face). */
export const pullName = (n: V3) => ['L', 'W', 'H'].find((_, k) => Math.abs(n[k]) > 0.999) ?? 'Depth';

/** While aiming To object: the pull shows reaching `at` (only while nothing is typed for the depth). */
export function aimInto(p: Pulling, at: THREE.Vector3, frame: { o: V3; n: V3 }) {
  if (!p.side && p.typed === undefined) p.depth = at.clone().sub(v3(frame.o)).dot(v3(frame.n));
}

/** A length measured goes into what is being typed while pulling (depth or back). */
export function typeInto(p: Pulling, text: string) {
  const k = p.side ? 'typedBack' : 'typed';
  p[k] = (p[k] ?? '') + text;
}

/** A pull's depth and how far it reaches back (mm): typed, else as pulled; Alt: back as far as the depth (both ways from the plane). */
export function pulled(p: Pulling, length: (text: string) => number | null) {
  const typed = (t: string | undefined) => (t === undefined ? null : length(t));
  const depth = typed(p.typed) ?? p.depth;
  return { depth, back: typed(p.typedBack) ?? (p.alt ? Math.abs(depth) : 0) };
}

/**
 * Typing while pulling: into the depth or (Tab) the back; Backspace erases; on a body the centre modifier (Alt) arms a
 * tap (see `pullTap`). Returns whether the key was used.
 */
export function pullKey(e: KeyboardEvent, p: Pulling, onBody: boolean) {
  const k = p.side ? 'typedBack' : 'typed';
  if (onBody && e.key === roleKeyName('centre')) p.tap ||= !e.repeat;
  else if (pressed(e, 'otherSide') && restOf(p[k] ?? '')) p[k] += restOf(p[k]!); // a name showing: written out
  else if (pressed(e, 'otherSide')) p.side = p.side ? 0 : 1;
  else if (pressed(e, 'erase')) p[k] = p[k]?.slice(0, -1) || undefined;
  else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) p[k] = (p[k] ?? '') + e.key;
  else return false;
  return true;
}

/**
 * The centre modifier let go while pulling on a body (`on`: its depth, whether it can cut): tapped (not moved while held,
 * so not both ways from the plane), the pull takes its next operation. Returns whether it switched.
 */
export function pullTap(e: KeyboardEvent, p: Pulling, on: { depth: number; cuts: boolean }) {
  if (e.key !== roleKeyName('centre') || !p.tap) return false;
  p.tap = false;
  const ops = (Object.keys(PULL_OPS) as PullOp[]).filter((o) => o !== 'cut' || on.cuts);
  p.op = ops[(ops.indexOf(pullOp(p, true, on.depth, on.cuts)) + 1) % ops.length];
  return true;
}

/**
 * Adds the pointer's movement to a pull (ending a tap): along the normal's direction on screen (any way: up, down, sideways), or,
 * looking along the normal, moving up pulls towards the viewer. Movement works with the pointer locked, so a pull
 * has no end at the screen edge.
 */
export function pullBy(view: ToolView, e: PointerEvent, normal: V3, middle: THREE.Vector3, s: PullStart) {
  const n = v3(normal);
  const [x0, y0] = view.toScreen(middle);
  const [x1, y1] = view.toScreen(middle.clone().add(n));
  const [dx, dy] = [x1 - x0, y1 - y0]; // screen px per mm along the normal
  const ppm = view.pixelsPerMm(middle);
  s.tap = false;
  if (Math.hypot(dx, dy) < 0.2 * ppm) s.raw -= (e.movementY / ppm) * (n.dot(view.ray(e).direction) < 0 ? 1 : -1);
  else s.raw += (e.movementX * dx + e.movementY * dy) / (dx * dx + dy * dy);
}

export interface ToolHost {
  /** A ball drawn in space: the next one can start. */
  ball(ball: NonNullable<SketchResult['sphere']>): void;
  /** The Distance measure tool, this one waiting: `use` gets the length taken, `done` runs when it ends either way. */
  measure(use: (mm: number) => void, done: () => void): void;
  /** A typed size in mm (expressions and units allowed), or null if invalid. */
  length(text: string): number | null;
  /** A typed plain number (expressions allowed), or null if invalid or a length. */
  number(text: string): number | null;
  /** A length (mm) as shown, in the document's units. */
  lengthText(mm: number): string;
  /** A finished action (null: cancelled or stopped). After a flat shape the tool goes on. */
  done(result: SketchResult | null): void;
  hint(text: string): void;
  /** A note that follows the pointer (null: none); `more`: other keys, shown with the tool's hint. */
  cursorTip(text: string | null, more?: string | null): void;
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
  /** `pts`: further points clicked (a turned rectangle's side end, a circle's second point); `lines`: a tangent circle's lines; `mode`: the drawing mode for this shape only (Alt while drawing) */
  | { kind: 'shape'; target: Target; anchor: UV; cur: UV; px: [number, number]; dragged: boolean; typed: (string | undefined)[]; axis: number; shift: boolean; pts: UV[]; lines: [UV, UV][]; mode?: string }
  /**
   * A line: points so far, each side's curve, and the open side's end; typed length or diameter (0) and angle (1) of the
   * open side; `base`: the direction (radians, plane coordinates) its angle counts from: the previous side's (going
   * straight on is 0°), else the plane's x axis, or a line picked with B. `out`: the handle pulled from the last point;
   * `held`: a bezier point pressed, its handle being pulled (`adds`: a new point, `closes`: on the line's start);
   * `arcEnd`: a first arc's end, its bulge still to come; `arc`: the open arc's middle; `round`: a tangent from a curve,
   * its first point sliding along it, at `t`, near `near` where it was clicked (`line`: the curve, lit). In 3D (see
   * `space`): `z` each point's height off the plane, `curZ` the open side's end's; `lock`: the world axis (0 X, 1 Y,
   * 2 Z) the open side runs along.
   */
  | { kind: 'polygon'; target: Target; pts: UV[]; z: number[]; curZ: number; lock: number | null; curves: (Curve | null)[]; sides: NonNullable<Drawn['sides']>; cur: UV; typed: (string | undefined)[]; axis: number; base: number; out: UV | null; held: { at: UV; px: [number, number]; pull: UV | null; adds: boolean; closes: boolean } | null; arcEnd: UV | null; arc: UV | null; round?: { curve: TangentCurve; near: UV; t: number; line: Segment[] } }
  /** A ball in space: the points clicked, or the planes it touches and its radius; `cur`: the point the pointer is on; `typed`: a diameter. */
  | { kind: 'ball'; pts: THREE.Vector3[]; planes: { at: THREE.Vector3; n: THREE.Vector3 }[]; cur: THREE.Vector3 | null; r: number; typed?: string }
  | ({ kind: 'pull'; target: Target; drawn: Drawn; shapes: DrawnProfile[] } & Pulling);

const v3 = (a: V3) => new THREE.Vector3(...a);
/**
 * A point the pointer snaps to (plane coordinates), what it is, and the outline it belongs to; a body corner keeps where
 * it is (world); a point along a line the line's key and the lengths on both sides of it (mm).
 */
type SnapPoint = { at: UV; what: string; line?: Segment[]; corner?: THREE.Vector3; key?: string; parts?: [number, number] };
/** A straight line's key, by its ends (world, either way round). */
export const sideKey = (a: THREE.Vector3, b: THREE.Vector3) => [a, b].map((v) => v.toArray().map((x) => x.toFixed(3)).join(',')).sort().join('|');
/** The key of a body edge for A / Shift A: straight as a side, a curved one by its start and middle (a closed one starts and ends alike). */
export const edgeKey = (segs: Segment[]) => (segs.length === 1 ? sideKey(segs[0][0], segs[0][1]) : `curve:edge:${sideKey(segs[0][0], segs[segs.length >> 1][0])}`);
/** `i/n` in lowest terms. */
function fraction(i: number, n: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(i, n);
  return `${i / g}/${n / g}`;
}
/** A line the pointer snaps to (world segments; `curves`: per segment the key of the curved side it is part of); sketch outlines keep their shape and sketch, guides themselves. */
type SnapLine = { segs: Segment[]; curves?: (string | null)[]; what: string; shape?: { p: ViewSketch['shapes'][number]; sketch: ViewSketch }; guide?: { at: THREE.Vector3; dir: THREE.Vector3; fixed: boolean } };
/** Guides' colour and reach (mm each way: practically endless). */
const GUIDE_COLOR = 0xd946ef;
const guideSeg = (g: { at: THREE.Vector3; dir: THREE.Vector3 }, reach = 1e4): Segment => [g.at.clone().addScaledVector(g.dir, -reach), g.at.clone().addScaledVector(g.dir, reach)];
/** Whether the segment lies on the guide's line. */
const onLine = (g: { at: THREE.Vector3; dir: THREE.Vector3 }, [a, b]: Segment) => [a, b].every((v) => v.clone().sub(g.at).cross(g.dir).length() < 1e-4);
const sameSeg = (p: Segment | null, q: Segment | null) => p === q || (!!p && !!q && p[0].equals(q[0]) && p[1].equals(q[1]));
/** The keys that lock a 3D line's open side to the world's X, Y or Z. */
const AXIS_KEYS = ['moveX', 'moveY', 'moveZ'] as const;
const AXIS_NAME: Record<BasePlane, string> ={ xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };
const NAMES: Record<ToolKind, string> = { rect: 'a rectangle', circle: 'a circle', ngon: 'a regular polygon', line: 'a line', sphere: 'a sphere' };

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
  /** Pulling: waiting for the click that sets how far ("to object"); what the pointer would reach meanwhile. */
  private reaching = false;
  /** The Measure tool is on, this one waits for it. */
  private measuring = false;
  /** A To object click just went into a shape's size: its release does not end the shape. */
  private reached = false;
  private aimed: string | null = null;
  /** Lines and polygon sides snap to this angle step while Shift is held (A finer, Shift A coarser; kept across restarts). */
  /** The angle step Shift turns in (A / Shift A: finer / coarser, see `ANGLE_STEPS`). */
  static angleStep = 45;
  /** Shift held while drawing a line or polygon; the angle rays show then, and until `raysUntil` after a step change. */
  private shiftHeld = false;
  private raysUntil = 0;
  /** Snap points along a line (by its key, see `sideKey`): evenly spaced inside a side, or around a circle. Kept across tool restarts. */
  static divisions = new Map<string, number>();
  /** Each shape's drawing mode (see `MODES`), this session. */
  static modes = new Map<ToolKind, string>();
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
  private keyUp = (e: KeyboardEvent) => {
    const ph = this.phase;
    if (e.key === 'Shift' && this.shiftHeld) (this.shiftHeld = false), this.update();
    if (e.key === roleKeyName('tangent')) this.holdTangent(false);
    if (ph.kind === 'pull' && onBody(ph.target) && pullTap(e, ph, { depth: pulled(ph, (t) => this.host.length(t)).depth, cuts: this.cuts(ph) })) this.update();
  };

  constructor(
    readonly kind: ToolKind | null,
    private view: ToolView,
    private host: ToolHost,
    readonly mode?: ToolMode,
  ) {
    view.el.append(this.labels);
    if (kind === 'line') {
      const box = this.spaceBox.querySelector('input')!;
      box.checked = SketchTool.space;
      box.onchange = () => {
        SketchTool.space = box.checked;
        box.blur(); // keys go on to the tool
        const ph = this.phase;
        if (ph.kind === 'polygon' && this.lastPoint) ph.cur = this.sideEnd(this.lastPoint[0], ph) ?? ph.cur;
        this.update();
      };
      view.el.append(this.spaceBox);
    }
    addEventListener('keyup', this.keyUp);
    this.host.hint(this.hoverHint());
    this.update();
    const m = this.drawMode();
    if (m) showMode(view.el, kind!, m);
  }

  dispose() {
    this.view.el.querySelector('.mode-note')?.remove();
    clearTimeout(this.dwell.timer);
    removeEventListener('keyup', this.keyUp);
    this.view.aimAt(null);
    SketchTool.guides = SketchTool.guides.filter((g) => g.fixed);
    this.view.unlockPointer();
    this.view.markFace();
    this.litPlane(null);
    this.clearPreview();
    this.labels.remove();
    this.spaceBox.remove();
    this.host.cursorTip(null);
    this.view.render();
  }

  /** Returns true if the press belongs to the tool (no orbiting). */
  down(e: PointerEvent): boolean {
    const used = this.press(e);
    clearTimeout(this.dwell.timer); // nor does a line just clicked get one
    SketchTool.guides = SketchTool.guides.filter((g) => g.fixed); // a click (which may have snapped to them) drops the others
    this.update();
    return used;
  }

  /** On a curve the line tool starts a tangent from, as the tangent modifier's click does (a Mac makes a Ctrl-click a right click). */
  rightClick(e: MouseEvent) {
    const target = this.phase.kind === 'hover' && this.kind === 'line' ? this.target(e) : null;
    if (!target) return;
    this.tangentHeld = true;
    this.point(e, target);
    const on = !!this.tangentOn;
    this.tangentHeld = false;
    if (on) this.down(new PointerEvent('pointerdown', { button: 0, clientX: e.clientX, clientY: e.clientY, [`${roleKey('tangent')}Key`]: true }));
    else this.point(e, target);
  }

  private press(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    this.tangentHeld = role(e, 'tangent');
    const ph = this.phase;
    if (this.ballMode() && (ph.kind === 'hover' || ph.kind === 'ball')) return void this.ballPress(e), true;
    if (ph.kind === 'hover' && this.mode?.kind === 'plane') {
      const target = this.target(e);
      if (target) this.host.done({ target, depth: 0 });
      return true;
    }
    if (ph.kind === 'shape' && this.reaching) {
      // a width or height from the first corner (from the middle: twice), a diameter from the centre; off bodies: on its plane
      const off = planeHit(this.view.ray(e), ph.target.frame);
      this.reached = true;
      if (!this.view.pointAt(e) && !off) return true;
      this.reaching = false;
      this.aimed = null;
      void this.view.truePointAt(e).then((real) => {
        const p = real ?? off;
        if (this.phase !== ph || !p) return;
        const [u, v] = uvOf(ph.target.frame, p);
        const [du, dv] = [u - ph.anchor[0], v - ph.anchor[1]];
        const size = this.kind === 'circle' || this.kind === 'sphere' || this.kind === 'ngon' ? 2 * Math.hypot(du, dv) : Math.abs(ph.axis ? dv : du) * (this.drawMode(ph)?.id === 'centre' ? 2 : 1);
        ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + this.host.lengthText(size);
        this.update();
      });
      this.view.aimAt(null);
      this.update();
      return true;
    }
    if (ph.kind === 'hover' && this.kind) {
      const target = this.target(e);
      if (!target) {
        this.host.hint('Draw on a top face, a sketch or empty space · [Esc] stops');
        return true;
      }
      const at = this.spaceAt(e, target) ?? this.point(e, target);
      if (!at) return true;
      this.view.markFace();
      this.litPlane(null);
      // a tangent circle starts on a line
      const line = this.drawMode()?.lines ? this.lineUV(target) : null;
      const round = this.tangentOn && { ...this.tangentOn, near: at, t: tangentStart(this.tangentOn.curve, at) };
      if (this.drawMode()?.lines && !line) return this.host.hint('Circle tangent to two lines: click the first line · [Alt] another drawing mode'), true;
      this.phase =
        this.kind === 'line'
          ? { kind: 'polygon', target, pts: [at], z: [this.atZ], curZ: this.atZ, lock: null, curves: [], sides: [], cur: at, typed: [], axis: 0, base: 0, out: null, held: this.drawMode()?.id === 'bezier' ? { at, px: [e.clientX, e.clientY], pull: null, adds: false, closes: false } : null, arcEnd: null, arc: null, ...(round ? { round } : {}) }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, shift: role(e, 'constrain'), pts: [], lines: line ? [line] : [] };
      if (this.phase.kind === 'polygon') this.trueSpace(e, this.phase, 0);
      this.host.hint(this.kind === 'line' ? lineHint(this.drawMode()?.id) : SHAPE_HINT);
    } else if (ph.kind === 'shape') {
      ph.px = [e.clientX, e.clientY]; // a drag counts from this press
      this.advance(); // a further click of click-click drawing
    } else if (ph.kind === 'polygon') {
      const at = this.sideEnd(e, ph);
      if (!at) return true;
      const r = this.view.el.getBoundingClientRect();
      const near = (i: number) => {
        const [x, y] = this.view.toScreen(v3(toWorld(ph.target.frame, ...ph.pts[i], ph.z[i])));
        return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8;
      };
      const closes = this.canClose(ph) && near(0);
      // straight back to the point before: a side on top of the last one (two points: no area to close)
      const mode = this.drawMode()?.id;
      if (!closes && ph.pts.length >= 2 && mode !== 'bezier' && mode !== 'arc' && near(ph.pts.length - 2))
        return this.host.hint('That runs straight back along the last side: click another point · [Esc] cancels'), true;
      // a bezier point goes in when let go: a drag first pulls its handles
      if (this.drawMode()?.id === 'bezier') ph.held = { at: closes ? ph.pts[0] : at, px: [e.clientX, e.clientY], pull: null, adds: true, closes };
      else {
        const n = ph.pts.length;
        this.corner(ph, at, closes);
        if (ph.pts.length > n) this.trueSpace(e, ph, n);
      }
    } else if (ph.kind === 'pull' && this.reaching) {
      // "to object": the clicked point's distance goes into the typed depth (or back)
      if (!this.view.pointAt(e)) return true;
      this.reaching = false;
      this.aimed = null;
      void this.view.truePointAt(e).then((p) => {
        if (this.phase !== ph || !p) return;
        reachInto(ph, p, ph.target.frame, this.host);
        this.update();
      });
      this.view.aimAt(null);
    } else if (ph.kind === 'pull') this.commit();
    this.update();
    return true;
  }

  /** The work plane lit as hovered. */
  private lit: string | null = null;
  private litPlane(id: string | null) {
    if (id !== this.lit) this.view.lightPlane((this.lit = id));
  }

  move(e: PointerEvent) {
    if (this.measuring) return;
    const ph = this.phase;
    this.snapWhat = this.snapKey = null;
    this.snapSeg = this.onGuide = null;
    this.tangentHeld = role(e, 'tangent');
    if (this.ballMode() && (ph.kind === 'hover' || ph.kind === 'ball')) return this.ballMove(e, ph);
    if (ph.kind === 'hover') {
      if (!this.kind && this.mode?.kind !== 'plane') return;
      const target = this.target(e);
      this.view.markFace(target?.body && !target.sketch ? this.view.hit(e) : undefined);
      this.litPlane(target?.placement.kind === 'work' ? target.placement.plane : null);
      this.host.hint(target ? this.hoverHint(target) : 'Only top faces of extrusions take sketches · [Esc] stops');
      if (target && !this.spaceAt(e, target)) this.point(e, target); // shows a snap dot
      return this.update();
    }
    if (ph.kind === 'shape' && this.reaching) return this.aim(this.view.aimAt(e)); // aiming: the shape stays as it is
    if (ph.kind === 'polygon' && ph.held) {
      if (ph.held.pull || Math.hypot(e.clientX - ph.held.px[0], e.clientY - ph.held.px[1]) > 4) {
        const at = this.point(e, ph.target);
        if (at) ph.held.pull = this.handleTo(ph.held.at, at, e);
      }
    } else if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const anchor = ph.kind === 'shape' ? ph.anchor : null; // sizes from it on whole steps
      const riding = this.riding(ph);
      const at = ph.kind === 'polygon' ? this.sideEnd(e, ph) : this.point(e, ph.target, !riding && (anchor ?? true));
      if (at) ph.cur = riding ? this.ride(e, ph, at) : at;
      this.shiftHeld = role(e, 'constrain');
      if (ph.kind === 'shape') {
        ph.dragged ||= Math.hypot(e.clientX - ph.px[0], e.clientY - ph.px[1]) > 4;
        ph.shift = role(e, 'constrain');
      }
    } else if (ph.kind === 'pull') {
      if (this.reaching) return this.aim(this.view.aimAt(e)); // aiming at what to reach
      ph.alt = role(e, 'centre');
      pullBy(this.view, e, ph.target.frame.n, this.middle(ph), ph);
      const step = this.view.step(this.middle(ph), e);
      ph.depth = Math.round(ph.raw / step) * step;
    }
    this.update();
  }

  up() {
    const ph = this.phase;
    if (ph.kind === 'polygon' && ph.held) {
      const held = ph.held;
      if (held.adds) this.corner(ph, held.at, held.closes);
      ph.held = null;
      if (this.phase === ph) ph.out = held.pull;
    }
    if (ph.kind === 'shape') ph.dragged &&= !this.reached; // the release of a To object click does not end the shape
    this.reached = false;
    if (ph.kind === 'shape' && ph.dragged) this.advance();
    this.update();
  }

  /** The drawing mode now (none: a shape without modes): the shape's own while drawing it (Alt), else the kept one. */
  private drawMode(ph?: Extract<Phase, { kind: 'shape' }>) {
    const list = this.kind ? MODES[this.kind] : undefined;
    if (!list) return null;
    return list.find((x) => x.id === (ph?.mode ?? SketchTool.modes.get(this.kind!))) ?? list[0];
  }

  /** The next drawing mode, kept (false: the shape has none). */
  nextMode() {
    if (!this.drawMode()) return false;
    this.switchMode(1);
    this.update();
    return true;
  }

  /**
   * The next drawing mode (`by` -1: the one before), shown for a moment: while drawing for that shape only (its first
   * point stays; a tangent circle starts over, on a line), else kept for the shapes to come (this session).
   */
  private switchMode(by: number) {
    const list = this.kind ? MODES[this.kind] : undefined;
    if (!list) return;
    const ph = this.phase;
    const now = list.indexOf(this.drawMode(ph.kind === 'shape' ? ph : undefined)!);
    const next = list[(now + by + list.length) % list.length];
    if (this.kind === 'sphere') {
      // points already clicked carry over to the next way through points; else it starts over
      this.view.aimAt(null);
      this.view.markFace();
      SketchTool.modes.set(this.kind, next.id);
      if (ph.kind === 'ball' && BALL_POINTS[next.id] && !ph.planes.length) ph.pts = ph.pts.slice(0, BALL_POINTS[next.id] - 1);
      else this.phase = { kind: 'hover' };
      showMode(this.view.el, this.kind, next);
      return this.host.hint(this.hoverHint());
    }
    if (ph.kind === 'polygon') {
      SketchTool.modes.set(this.kind!, next.id);
      [ph.arcEnd, ph.arc, ph.typed, ph.axis] = [null, null, [], 0];
      if (this.lastPoint) ph.cur = this.sideEnd(this.lastPoint[0], ph) ?? ph.cur;
    } else if (ph.kind !== 'shape') SketchTool.modes.set(this.kind!, next.id);
    else if (next.lines) (SketchTool.modes.set(this.kind!, next.id), (this.phase = { kind: 'hover' }));
    else Object.assign(ph, { mode: next.id, pts: [], lines: [] });
    showMode(this.view.el, this.kind!, next);
    this.host.hint(this.phase.kind === 'shape' ? SHAPE_HINT : this.phase.kind === 'polygon' ? lineHint(next.id) : this.hoverHint());
  }

  /** The sphere's ways through points or planes, in space (its first is drawn on a plane). */
  private ballMode() {
    return this.kind === 'sphere' && this.drawMode()?.id !== 'centre';
  }

  /** A flat face under the pointer, or a work plane or empty space (the plane it draws on, facing the camera); its side outward. */
  private planeUnder(e: MouseEvent) {
    const hit = this.view.hit(e);
    if (hit) return this.view.flatFace(hit) ? { hit, at: hit.point.clone(), n: hit.face!.normal.clone() } : null; // world already (the view's hits)
    const target = this.target(e);
    const at = target && planeHit(this.view.ray(e), target.frame);
    if (!target || !at) return null;
    const n = v3(target.frame.n);
    return { hit: undefined, at, n: n.dot(this.view.ray(e).direction) > 0 ? n.negate() : n };
  }

  /** The point the pointer is on: a snap on what it shows, else on the plane under it. */
  private ballAim(e: MouseEvent) {
    const aim = this.view.aimAt(e);
    this.snapWhat = aim?.what ?? null;
    if (aim) return aim.at;
    const target = this.target(e);
    return target && planeHit(this.view.ray(e), target.frame);
  }

  /** The ball so far, the pointer's point counting. */
  private ballNow(ph: Extract<Phase, { kind: 'ball' }>): Ball | null {
    const typed = ph.typed === undefined ? null : this.host.length(ph.typed);
    if (ph.planes.length) {
      const corner = ph.planes.length === 3 ? ballsInCorner(ph.planes) : null;
      const r = typed !== null ? ((ph.r < 0 ? -1 : 1) * typed) / 2 : ph.r; // below 0: on the planes' other side
      return corner && r ? { center: corner.at.clone().addScaledVector(corner.along, r), d: 2 * Math.abs(r) } : null;
    }
    const [a, b, c, d] = ph.cur ? [...ph.pts, ph.cur] : ph.pts;
    return d ? ballOnFour(a, b, c, d) : c ? ballOnThree(a, b, c) : b && this.drawMode()?.id === 'diameter' ? ballAcross(a, b) : null;
  }

  private ballMove(e: PointerEvent, ph: Extract<Phase, { kind: 'hover' | 'ball' }>) {
    if (this.drawMode()?.id === 'planes' && (ph.kind === 'hover' || ph.planes.length < 3)) {
      const under = this.planeUnder(e);
      this.view.markFace(under?.hit);
      this.snapWhat = under ? null : 'Not flat: a sphere touches flat faces and planes';
    } else if (ph.kind === 'ball' && ph.planes.length) {
      // its centre rides the line all such balls have theirs on: a snap projected on it, else the pointer's ray nearest it; its diameter on the zoom's step
      const corner = ballsInCorner(ph.planes)!;
      const dir = corner.along.clone().normalize();
      const aim = this.view.aimAt(e);
      const snap = aim && aim.what !== 'on face' && !aim.what.startsWith('on ') ? aim.at : null;
      this.snapWhat = snap ? aim!.what : null;
      const ray = this.view.ray(e);
      const point = new THREE.Vector3();
      if (!snap) new THREE.Ray(corner.at.clone().addScaledVector(dir, -1e6), dir).distanceSqToSegment(ray.origin, ray.origin.clone().addScaledVector(ray.direction, 1e6), point);
      const along = (snap ?? point).clone().sub(corner.at).dot(dir) / corner.along.length();
      const step = this.view.step(corner.at, e, false);
      ph.r = snap ? along : (Math.round((2 * along) / step) * step) / 2;
    } else {
      const at = this.ballAim(e);
      if (ph.kind === 'ball') ph.cur = at;
    }
    this.host.hint(this.hoverHint());
    this.update();
  }

  private async ballPress(e: PointerEvent) {
    if (this.phase.kind === 'hover') this.phase = { kind: 'ball', pts: [], planes: [], cur: null, r: 0 };
    const ph = this.phase;
    if (ph.kind !== 'ball') return;
    if (this.drawMode()?.id === 'planes') {
      if (ph.planes.length === 3) return this.ballDone(ph);
      const under = this.planeUnder(e);
      if (!under) return ph.planes.length || (this.phase = { kind: 'hover' }), this.host.hint('Not flat: click a flat face or work plane · [Esc] cancels');
      ph.planes.push({ at: under.at, n: under.n });
      if (ph.planes.length === 3 && !ballsInCorner(ph.planes)) {
        ph.planes.pop();
        return this.host.hint('These three planes meet in no one point: click another · [Esc] cancels');
      }
      this.view.markFace();
    } else {
      const at = this.ballAim(e);
      if (!at) return ph.pts.length || (this.phase = { kind: 'hover' }), undefined;
      const real = this.view.pointAt(e) ? ((await this.view.truePointAt(e)) ?? at) : at;
      if (this.phase !== ph) return;
      if (ph.pts.some((p) => p.distanceTo(real) < 1e-6)) return this.host.hint('That point was clicked already: click another · [Esc] cancels');
      ph.pts.push(real);
      ph.cur = null;
      if (ph.pts.length === BALL_POINTS[this.drawMode()!.id]) return this.ballDone(ph);
    }
    this.host.hint(this.hoverHint());
    this.update();
  }

  private ballDone(ph: Extract<Phase, { kind: 'ball' }>) {
    const ball = this.ballNow(ph);
    if (!ball) {
      ph.pts.pop();
      return this.host.hint(ph.planes.length ? 'Move away from the corner, or type its diameter · [Esc] cancels' : 'These points lie on one line or plane: no ball goes through them. Click another · [Esc] cancels');
    }
    this.view.aimAt(null);
    this.host.ball({ center: ball.center.toArray() as V3, d: ball.d, typed: ph.typed && this.host.length(ph.typed) !== null ? ph.typed : undefined });
  }

  /** What the next click of a sphere in space does. */
  private ballHint() {
    const ph = this.phase.kind === 'ball' ? this.phase : null;
    const name = this.drawMode()!.name;
    const end = ' · [Alt] another way · [Esc] ' + (ph ? 'starts over' : 'stops');
    if (this.drawMode()!.id === 'planes') {
      const n = ph?.planes.length ?? 0;
      return n < 3 ? `${name}: click flat face or plane ${n + 1} of 3${end}` : `${name}: move along, or type its Ø · click or [Enter] makes it${end}`;
    }
    return `${name}: click point ${(ph?.pts.length ?? 0) + 1} of ${BALL_POINTS[this.drawMode()!.id]} · [A] / [Shift A] split a line${end}`;
  }

  /** The straight side, edge or guide nearest the pointer within `px` (snap points do not hide it; one in the plane goes before one off it), in the target's plane coordinates; null: none. */
  private lineUV(t: Target, px = 8): [UV, UV] | null {
    const e = this.lastPoint?.[0];
    if (!e) return null;
    const r = this.view.el.getBoundingClientRect();
    const best = { flat: null as [UV, UV] | null, off: null as [UV, UV] | null };
    const nearest = { flat: px, off: px };
    for (const { segs, shape, curves } of this.snapLines()) {
      if (shape?.p.kind === 'circle' || (!shape && segs.length > 1)) continue;
      for (const [i, [a, b]] of segs.entries()) {
        if (curves?.[i]) continue;
        const { d } = this.screenDist(e.clientX - r.left, e.clientY - r.top, a, b);
        const [p, q] = [uvOf(t.frame, a), uvOf(t.frame, b)];
        const k = inPlane(t.frame, a) && inPlane(t.frame, b) ? 'flat' : 'off';
        if (d < nearest[k] && Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) [best[k], nearest[k]] = [[p, q], d]; // not seen end-on
      }
    }
    return best.flat ?? best.off;
  }

  /** Drawing a tangent circle, both lines picked: its middle rides on their bisector. */
  private riding(ph: Phase): ph is Extract<Phase, { kind: 'shape' }> {
    return ph.kind === 'shape' && ph.lines.length > 1 && this.drawMode(ph)?.id === 'tangent';
  }

  /** The bisector a tangent circle's middle rides on, as a guide: it snaps and crosses like one. */
  private bisectGuide() {
    const ph = this.phase;
    const b = this.riding(ph) && bisector(ph.lines[0], ph.lines[1], ph.cur);
    if (!b || ph.kind !== 'shape') return null;
    const f = ph.target.frame;
    const l = Math.hypot(...b.v);
    const at = v3(toWorld(f, ...b.o));
    return { at, dir: v3(toWorld(f, b.o[0] + b.v[0] / l, b.o[1] + b.v[1] / l)).sub(at).normalize(), fixed: false };
  }

  /** Where the pointer's `at` puts a tangent circle: a snap as it is, else on its bisector at a radius on the zoom's step. */
  private ride(e: MouseEvent, ph: Extract<Phase, { kind: 'shape' }>, at: UV): UV {
    const b = bisector(ph.lines[0], ph.lines[1], at);
    if (!b || (this.snapped && this.snapWhat !== BISECTOR)) return at;
    const raw = ((at[0] - b.o[0]) * b.v[0] + (at[1] - b.o[1]) * b.v[1]) / (b.v[0] * b.v[0] + b.v[1] * b.v[1]);
    const step = this.view.step(v3(toWorld(ph.target.frame, ...at)), e, false);
    const r = Math.round(raw / step) * step || raw; // 0 would lose the side the pointer is on
    return [b.o[0] + b.v[0] * r, b.o[1] + b.v[1] * r];
  }

  /** A click (or the end of a drag) while drawing a shape: the next point (or line) its mode needs, else done. */
  private advance() {
    const ph = this.phase;
    if (ph.kind !== 'shape') return;
    const m = this.drawMode(ph);
    const clicks = 1 + ph.pts.length + Math.max(0, ph.lines.length - 1);
    if (!m || clicks + 1 >= m.clicks) return this.shapeDone();
    if (m.lines) {
      const line = this.lineUV(ph.target);
      if (!line) return this.host.hint('Circle tangent to two lines: click the second line · [Esc] cancels');
      if (ph.lines.length && !bisector(ph.lines[0], line, ph.cur)) return this.host.hint('That line runs along the first: click one that crosses it · [Esc] cancels');
      ph.lines.push(line);
    } else ph.pts.push(ph.cur);
    ph.dragged = false;
    this.host.hint(m.next ?? SHAPE_HINT);
  }

  clicks() {
    return this.mode?.kind === 'plane';
  }

  /** Double-click: the line ends here, open (the first click set the point, the second none: see `corner`). */
  dblclick() {
    if (this.phase.kind === 'polygon' && this.phase.pts.length >= 2) this.finishLine();
    this.update();
  }

  /** Keys while drawing; returns true if used. Letters only count while typing a size, so tool keys still switch tools. */
  key(e: KeyboardEvent): boolean {
    const ph = this.phase;
    if (e.key === roleKeyName('tangent')) this.holdTangent(true);
    // a line's length or angle starts with a digit, so letters still snap, fix guides and switch tools
    const sideTyping = ph.kind === 'polygon' && (ph.typed[ph.axis] !== undefined || /[\d.($-]/.test(e.key));
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull' || sideTyping || (ph.kind === 'ball' && ph.planes.length === 3));
    const more = pressed(e, 'moreSnaps');
    const free = ph.kind !== 'pull' && !((ph.kind === 'shape' || ph.kind === 'polygon') && ph.typed[ph.axis] !== undefined) && !(ph.kind === 'ball' && ph.planes.length === 3); // not while typing a size
    const guide = this.hoveredGuide();
    // Measure while a size is typed: this tool waits, the value goes in (a line: its length or an arc's diameter)
    if ((ph.kind === 'shape' && !(this.kind === 'ngon' && ph.axis === 1)) || ph.kind === 'pull' || (ph.kind === 'polygon' && ph.axis === 0)) {
      if (pressed(e, 'measureValue') && !inName((ph.kind === 'pull' ? (ph.side ? ph.typedBack : ph.typed) : ph.typed[ph.axis]) ?? '')) {
        this.measuring = true;
        this.view.unlockPointer();
        this.host.measure(
          (mm) => {
            if (this.phase !== ph) return;
            const text = this.host.lengthText(mm);
            if (ph.kind === 'pull') typeInto(ph, text);
            else {
              const axis = ph.typed[ph.axis] ?? '';
              ph.typed[ph.axis] = axis + text;
            }
            this.update();
          },
          () => (this.measuring = false),
        );
        return true;
      }
    }
    // To object while drawing a shape: the next click's distance goes into the size being typed (not a polygon's sides)
    if (ph.kind === 'shape' && pressed(e, 'toObject') && !(this.kind === 'ngon' && ph.axis === 1) && !inName(ph.typed[ph.axis] ?? '')) {
      this.reaching = true;
      this.host.hint('To object: click a corner, edge or face · its distance goes into the size (type on to calculate with it) · [Esc] cancels');
      this.aim(this.view.aimHere());
      return true;
    }
    // Alt: the next drawing mode (before drawing: kept; while drawing: for this shape only)
    if ((ph.kind === 'hover' || ph.kind === 'shape' || ph.kind === 'ball' || (ph.kind === 'polygon' && !ph.held)) && e.key === 'Alt' && !e.repeat && this.drawMode()) return this.switchMode(e.shiftKey ? -1 : 1), this.update(), true;
    if (ph.kind === 'hover' && this.cycle.count > 1 && pressed(e, 'otherSide') && this.lastPoint) {
      this.cycle.at++; // the next line under the pointer
      this.point(...this.lastPoint);
    } else if (free && this.snapped && !this.snapWhat?.startsWith('on ') && this.lastPoint && pressed(e, 'fixGuide')) {
      this.pointGuides(this.snapped, this.lastPoint[1]);
    } else if (free && guide && pressed(e, 'fixGuide')) {
      guide.fixed = !guide.fixed;
      if (!SketchTool.guides.includes(guide)) SketchTool.guides.push(guide); // the bisector, kept
    }
    else if (free && ph.kind === 'polygon' && this.space(ph.target) && AXIS_KEYS.some((a) => pressed(e, a))) {
      // 3D: the open side along that world axis (again: free)
      const k = AXIS_KEYS.findIndex((a) => pressed(e, a));
      ph.lock = ph.lock === k ? null : k;
      if (this.lastPoint) ph.cur = this.sideEnd(this.lastPoint[0], ph) ?? ph.cur;
    }
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
      divideMore(k, more);
      this.showing = k;
      this.splitAt = [this.lastPoint[0].clientX, this.lastPoint[0].clientY];
      const at = ph.kind === 'polygon' ? this.sideEnd(this.lastPoint[0], ph) : this.point(...this.lastPoint);
      if (at && (ph.kind === 'shape' || ph.kind === 'polygon')) ph.cur = at;
    } else if (free && (more || pressed(e, 'fewerSnaps')) && ph.kind !== 'polygon') {
      this.nothingToSplit = true; // says so at the pointer, until it moves
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
      if (this.reaching) return (this.reaching = false), (this.aimed = null), this.view.aimAt(null), this.update(), true; // only the aiming ends
      if (ph.kind === 'hover') return this.host.done(null), true;
      if (ph.kind === 'pull') return this.commit(true), this.update(), true; // a drawn shape stays flat
      if (ph.kind === 'polygon' && ph.pts.length >= 2) return this.finishLine(), this.update(), true;
      this.phase = { kind: 'hover' };
      this.host.hint(this.hoverHint());
    } else if (ph.kind === 'ball') {
      if (typing) ph.typed = (ph.typed ?? '') + e.key;
      else if (pressed(e, 'erase') && ph.typed !== undefined) ph.typed = ph.typed.slice(0, -1) || undefined;
      else if (pressed(e, 'erase')) (ph.planes.pop(), ph.pts.pop());
      else if (pressed(e, 'confirm') && ph.planes.length === 3) this.ballDone(ph);
      else return false;
    } else if (ph.kind === 'shape') {
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (pressed(e, 'erase')) ph.typed[ph.axis] = ph.typed[ph.axis]?.slice(0, -1) || undefined;
      else if (pressed(e, 'otherSide') && restOf(ph.typed[ph.axis] ?? '')) ph.typed[ph.axis] += restOf(ph.typed[ph.axis]!); // a name showing: written out
      else if (pressed(e, 'otherSide') && (this.kind === 'rect' || this.kind === 'ngon')) ph.axis = 1 - ph.axis;
      else if (pressed(e, 'confirm')) this.shapeDone();
      else return false;
    } else if (ph.kind === 'polygon') {
      if (typing) ph.typed[ph.axis] = (ph.typed[ph.axis] ?? '') + e.key;
      else if (pressed(e, 'erase') && ph.typed[ph.axis] !== undefined) ph.typed[ph.axis] = ph.typed[ph.axis]!.slice(0, -1) || undefined;
      else if (pressed(e, 'otherSide') && restOf(ph.typed[ph.axis] ?? '')) ph.typed[ph.axis] += restOf(ph.typed[ph.axis]!); // a name showing: written out
      else if (pressed(e, 'otherSide')) ph.axis = ph.arcEnd ? 0 : 1 - ph.axis; // a first arc's bulge: only its diameter
      else if (pressed(e, 'confirm') && ph.typed.some((t) => t !== undefined)) this.corner(ph, ph.cur, false); // typed: Enter sets the point
      else if (pressed(e, 'confirm')) {
        if (ph.pts.length >= 2) this.finishLine();
        else this.phase = { kind: 'hover' }; // no side yet: nothing to keep
        if (this.phase.kind === 'hover') this.host.hint(this.hoverHint());
      } else if (pressed(e, 'erase') && ph.arcEnd) [ph.arcEnd, ph.arc] = [null, null];
      else if (pressed(e, 'erase') && ph.pts.length > 1) {
        ph.pts.pop();
        ph.z.pop();
        ph.curves.pop();
        ph.sides.pop();
        ph.out = null;
        const n = ph.pts.length;
        ph.base = n > 1 ? this.dirInto(ph) : 0;
      } else return false;
      if (this.phase === ph && this.lastPoint) ph.cur = this.sideEnd(this.lastPoint[0], ph) ?? ph.cur; // typed values apply at once
    } else if (ph.kind === 'pull') {
      if (pressed(e, 'toObject') && !inName((ph.side ? ph.typedBack : ph.typed) ?? '')) {
        // the next click picks how far: the pointer shows again for it
        this.reaching = true;
        this.view.unlockPointer();
        this.host.hint('To object: click a corner, edge or face · its distance goes into the size (type on to calculate with it) · [Esc] cancels');
        return this.aim(this.view.aimHere()), true;
      } else if (pressed(e, 'confirm')) this.commit();
      else if (!pullKey(e, ph, onBody(ph.target))) return false;
    } else return false;
    this.update();
    return true;
  }

  private hoverHint(target?: Target) {
    if (this.ballMode()) return this.ballHint();
    if (this.mode?.kind === 'plane') return `Click ${target ? target.name : 'a top face or empty space'} to draw on it · [Esc] cancels`;
    const m = this.drawMode();
    const how = this.kind === 'line' ? ({ polygon: 'Click points', bezier: 'Click points, drag to pull handles', arc: 'Click a start and an end, then the bulge' }[m?.id ?? ''] ?? 'Click two points') : m?.lines ? 'Click a line' : m && m.clicks > 2 ? 'Click three times' : 'Drag (or click twice)';
    const modes = m ? ` · ${m.name} ([Alt], or the tool's key or button again: the next mode)` : '';
    if (this.mode?.kind === 'draw') return `${how} to draw ${NAMES[this.kind!]}${modes} · [R] [C] [L] switch · snaps to corners and centres · [A] / [Shift A] more / fewer snap points on a line · [Ctrl] grid · [Esc] stops drawing shapes`;
    return `${how} to draw ${NAMES[this.kind!]}${modes}${target ? ` · on ${target.name}` : ''} · [Ctrl] precise · right-drag turns the view · [Esc] stops`;
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
    // a work plane in front of any face: its sketch, or a new one on it
    for (const w of this.view.workPlanes) {
      const p = planeHit(ray, w.frame);
      if (!p || (hit && p.distanceTo(ray.origin) > hit.distance + 1e-3)) continue;
      const [u, v] = uvOf(w.frame, p);
      if (u < w.rect[0] || u > w.rect[2] || v < w.rect[1] || v > w.rect[3]) continue;
      const placement = { kind: 'work' as const, plane: w.id };
      const existing = this.view.sketches.find((s) => s.placement.kind === 'work' && s.placement.plane === w.id);
      return existing ? this.sketchTarget(existing) : { sketch: null, placement, frame: w.frame, body: null, name: w.name };
    }
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
    // in a group's own origin (`drawFrame`): its base planes, chosen by the view turned into it
    const m = this.view.drawFrame;
    const dir = ray.direction.clone().normalize().transformDirection(m ? m.clone().invert() : new THREE.Matrix4());
    const facing = (['yz', 'xz', 'xy'] as const)[[dir.x, dir.y, dir.z].map(Math.abs).reduce((best, c, k, all) => (c > all[best] ? k : best), 0)];
    const axis = Math.abs(dir.z) > Math.sin((groundDeg * Math.PI) / 180) ? 'xy' : m ? facing : this.view.facing();
    const active = this.view.sketches.find((s) => s.id === this.view.activeSketch);
    const base = active ?? (m ? undefined : this.view.sketches.find((s) => s.placement.kind === 'base' && s.placement.axis === axis && s.placement.offset === 0));
    const f = BASE[axis];
    const frame: Frame = m ? { o: v3(f.o).applyMatrix4(m).toArray(), x: v3(f.x).transformDirection(m).toArray(), y: v3(f.y).transformDirection(m).toArray(), n: v3(f.n).transformDirection(m).toArray() } : f;
    return base ? this.sketchTarget(base) : { sketch: null, placement: { kind: 'base', axis, offset: 0 }, frame, body: null, name: AXIS_NAME[axis] };
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
    // a line off the plane: only the points just asked for with A, projected
    const add = (v: THREE.Vector3, o: Omit<SnapPoint, 'at'>) => (inPlane(t.frame, v) || (o.key && o.key === this.showing)) && pts.push({ at: uvOf(t.frame, v), ...o });
    for (const { at, ...o } of linePoints(lines)) add(at, o);
    for (const c of this.view.corners()) add(c, { what: 'corner', corner: c });
    // the line being drawn: its own points, its start closes it
    const ph = this.phase;
    if (ph.kind === 'polygon') ph.pts.slice(0, -1).forEach((at, i) => pts.push({ at, what: !i && this.canClose(ph) ? 'start: a click closes it' : 'point of this line' }));
    return pts;
  }

  /**
   * Lines to snap to, each as segments (world): outlines of every visible sketch's shapes (with the shape), body edges,
   * and the sides of the line being drawn.
   */
  private snapLines(): SnapLine[] {
    const bisect = this.bisectGuide();
    const ph = this.phase;
    const own = ph.kind === 'polygon' ? ph.pts.slice(1).map((b, i) => drawnSide(ph.pts[i], b, ph.curves[i] ?? null, ph.target.frame)) : [];
    return [
      ...snapLines(this.view.sketches, this.view.edges()),
      ...own,
      ...SketchTool.guides.map((guide) => ({ segs: [guideSeg(guide)], what: 'on guide', guide })),
      ...(bisect ? [{ segs: [guideSeg(bisect)], what: BISECTOR, guide: bisect }] : []),
    ];
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
    // a circle's top along w: its middle and radius out, in its plane (null: w stands square to it)
    const topOf = (c: THREE.Vector3, n: THREE.Vector3, r: number, w: THREE.Vector3) => {
      const out = w.clone().projectOnPlane(n);
      return out.lengthSq() > 1e-12 ? c.clone().addScaledVector(out.normalize(), r) : null;
    };
    for (const l of lines) {
      const p = l.shape?.p;
      if (p?.kind === 'circle') {
        const f = l.shape!.sketch.frame;
        for (const [w, along] of sides) {
          const top = topOf(v3(toWorld(f, p.x, p.y)), v3(f.n), p.d / 2, w);
          if (top) tops.push([top, along]);
        }
      } else if (!l.shape && !l.guide && l.segs.length > 1) {
        // a curved body edge: on the kernel's circle or path, where its points' outermost one lies near it (else that point: an end)
        const pts = [l.segs[0][0], ...l.segs.map((g) => g[1])];
        const reach = Math.max(...l.segs.map(([a, b]) => a.distanceTo(b)));
        for (const [w, along] of sides) {
          const far = pts.reduce((a, b) => (b.dot(w) > a.dot(w) ? b : a));
          const k = this.view.bodyCircleAt(far, reach);
          const top = k ? topOf(k.c, k.n, k.r, w) : this.view.bodyCurveTop(far, w, reach);
          tops.push([top && top.distanceTo(far) <= reach ? top : far, along]);
        }
      }
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

  /** Kept guides along the plane's X and Y through a point; if they are there already, they go. */
  private pointGuides(at: THREE.Vector3, t: Target) {
    const dirs = [v3(t.frame.x), v3(t.frame.y)];
    const on = (g: (typeof SketchTool.guides)[number], dir: THREE.Vector3) => g.dir.clone().cross(dir).length() < 1e-6 && g.at.clone().sub(at).cross(dir).length() < 1e-6;
    const both = dirs.every((dir) => SketchTool.guides.some((g) => g.fixed && on(g, dir)));
    SketchTool.guides = SketchTool.guides.filter((g) => !dirs.some((dir) => on(g, dir)));
    if (!both) SketchTool.guides.push(...dirs.map((dir) => ({ at: at.clone(), dir, fixed: true })));
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
    const from = this.phase.kind === 'polygon' ? this.phase.pts.at(-1) : undefined;
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
        if (from && Math.hypot(at[0] - from[0], at[1] - from[1]) < 1e-9) continue; // where the line being drawn goes on from
        const [x, y] = this.view.toScreen(v3(toWorld(t.frame, ...at)));
        const d = Math.hypot(mx - x, my - y);
        if (d < px && (!best || d < best.d)) best = { at, lines: [p.line, q.line], d };
      }
    return best;
  }

  /**
   * Pointer on the target plane, in plane coordinates: on the nearest snap point within `px` pixels, else on a crossing of lines
   * within `px`, else on the nearest line within `linePx` (sketch outlines, body edges in the plane), else
   * on the step for the zoom (Ctrl: the minimum step; `grid` false: where it is; a point: the steps counted from it, so
   * sizes from there come out whole). Sets `snapWhat`.
   */
  private point(e: MouseEvent, t: Target, grid: boolean | UV = true): UV | null {
    this.lastPoint = [e, t];
    this.nothingToSplit = false;
    const lines = this.snapLines();
    const uv = this.snapAt(e, t, lines, grid);
    this.snapSeg ??= this.roundSeg(e, t, lines);
    this.showing = this.snapKey && SketchTool.divisions.has(this.snapKey) ? this.snapKey : null; // a line split with A shows its points while the pointer is on it
    this.dots = this.showing ? this.snapPoints(t, this.snapLines()).filter((q) => q.key === this.showing).map((q) => v3(toWorld(t.frame, ...q.at))) : [];
    return uv;
  }

  /**
   * A point near line `l` (world) on what it really is: a sketch outline on its exact sides; a curved body edge on the
   * kernel's curve (a mesh body's: on the circle through the points next to it); a straight line where it is.
   */
  private onTrueLine(l: SnapLine, at: THREE.Vector3, t: Target): THREE.Vector3 {
    const nearest = l.segs.reduce<[number, number]>((best, [a, b], i) => {
      const d = at.distanceTo(new THREE.Line3(a, b).closestPointToPoint(at, true, new THREE.Vector3()));
      return d < best[1] ? [i, d] : best;
    }, [0, Infinity])[0];
    const [a, b] = l.segs[nearest];
    if (l.shape) return this.view.onSketchCurve(at, a.distanceTo(b) + 0.1, l.shape.p.id) ?? new THREE.Line3(a, b).closestPointToPoint(at, false, new THREE.Vector3());
    if (l.guide || l.segs.length === 1) return new THREE.Line3(a, b).closestPointToPoint(at, false, new THREE.Vector3());
    // a curved body edge: on the kernel's circle; a mesh body's: on the circle through its points beside it
    const exact = this.view.onBodyEdge(at, a.distanceTo(b) + 0.1);
    if (exact) return exact;
    const third = l.segs[nearest + 1]?.[1] ?? l.segs[nearest - 1]?.[0];
    if (!third) return at;
    const on = ontoArcThrough(uvOf(t.frame, a), uvOf(t.frame, b), uvOf(t.frame, third), uvOf(t.frame, at));
    return v3(toWorld(t.frame, ...on));
  }

  /** On a line, an edge and a point along it at once: the one taken, Tab going on to the next (before anything is drawn: Tab has other uses then). */
  private cycle = { lines: '', at: 0, count: 0 };
  private nothingToSplit = false;
  /** Where the pointer was at the last A or Shift A: the line split stays the line until it moves. */
  private splitAt: [number, number] | null = null;

  /** The curve under the pointer that a click of the line tool starts a tangent from (see `tangentHeld`). */
  private tangentOn: { curve: TangentCurve; line: Segment[] } | null = null;
  /** The tangent modifier is held. */
  private tangentHeld = false;
  /** The pointer is on a curve the line tool could start a tangent from, with the modifier. */
  private tangentNear = false;

  /** The tangent modifier pressed or let go: what the pointer is on changes at once. */
  private holdTangent(on: boolean) {
    if (on === this.tangentHeld) return;
    this.tangentHeld = on;
    if (this.phase.kind === 'hover' && this.kind === 'line' && this.lastPoint) {
      this.point(...this.lastPoint);
      this.update();
    }
  }

  private snapAt(e: MouseEvent, t: Target, lines: SnapLine[], grid: boolean | UV, px = 10, linePx = 8): UV | null {
    this.cycle.count = 0;
    this.tangentOn = null;
    this.tangentNear = false;
    const p = planeHit(this.view.ray(e), t.frame);
    if (!p) return null;
    const r = this.view.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    let near: SnapPoint | undefined;
    let nearest = px;
    const points = this.snapPoints(t, lines);
    const distance = (q: SnapPoint) => {
      const [x, y] = this.view.toScreen(v3(toWorld(t.frame, ...q.at)));
      return Math.hypot(mx - x, my - y);
    };
    for (const q of points) {
      const d = distance(q);
      if (d < nearest) [near, nearest] = [q, d];
    }
    type Near = { at: THREE.Vector3; line: Segment[]; what: string; key?: string; seg?: Segment; on: Segment; i: number; guide?: (typeof SketchTool.guides)[number]; d: number };
    const under = new Map<number, Near>();
    const close: { line: number; a: UV; b: UV }[] = [];
    // along lines and at their crossings only in the plane drawn on: a line off it would snap to its projection, away from the pointer
    let off: { seg: Segment; d: number } | null = null; // the nearest straight line off the plane: hovered, it gives a guide (projected)
    for (const [line, { segs, what, shape, guide, curves }] of lines.entries())
      for (const [i, [a, b]] of segs.entries()) {
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
        const key = guide ? undefined : shape?.p.kind === 'circle' ? `circle:${shape.p.id}` : (curves?.[i] ?? (shape ? sideKey(a, b) : edgeKey(segs)));
        if (!under.has(line) || d < under.get(line)!.d) under.set(line, { at: a.clone().lerp(b, k), line: segs, what, key, seg: key && straightKey(key) ? [a, b] : undefined, on: [a, b], i, guide, d });
      }
    // the line just split with A stays the line while the pointer is on it: a point that went must not hand it to what lies near
    const still = this.splitAt && Math.hypot(e.clientX - this.splitAt[0], e.clientY - this.splitAt[1]) < 3;
    if (!still) this.splitAt = null;
    const splitting = !!still && !!this.showing && [...under.values()].some((u) => u.key === this.showing);
    if (splitting) near = points.filter((q) => q.key === this.showing && distance(q) < px).sort((u, v) => distance(u) - distance(v))[0];
    // a helper line on a real one is not there: only beyond it
    const real = [...under.entries()].filter(([, u]) => !u.guide).sort(([, u], [, v]) => +(v.key === this.showing) - +(u.key === this.showing) || u.d - v.d);
    const lying = (g: NonNullable<Near['guide']>, [a, b]: Segment) => g.dir.clone().cross(b.clone().sub(a).normalize()).length() < 1e-4 && a.clone().sub(g.at).cross(g.dir).length() < 1e-3;
    for (const [line, u] of under) if (u.guide && real.some(([, r]) => lying(u.guide!, r.on))) under.delete(line);
    // a line starting on a curve: with the modifier its tangent goes before all points
    if (this.phase.kind === 'hover' && this.kind === 'line' && this.straightMode()) {
      for (const [line, u] of real) {
        const round = curveOf(lines[line], u.i, t.frame);
        if (!round) continue;
        this.tangentNear = true;
        if (!this.tangentHeld) break;
        const uv = uvOf(t.frame, this.onTrueLine(lines[line], u.at, t));
        this.tangentOn = { curve: round.curve, line: u.line };
        this.snapped = v3(toWorld(t.frame, ...uv));
        this.snapLine = u.line;
        this.snapWhat = `on ${round.name} · Click: a tangent from it`;
        this.snapPoint = this.snapSeg = this.snapKey = this.onGuide = null;
        return uv;
      }
    }
    // on a line, on an edge or on a point along it, all at once: Tab goes through them (see `key`)
    const along = near?.key ? 1 : 0;
    const seen = [near?.key, ...real.map(([line]) => line)].join();
    if (seen !== this.cycle.lines) this.cycle = { lines: seen, at: 0, count: 0 };
    this.cycle.count = along + real.length;
    const turn = this.cycle.at % Math.max(1, this.cycle.count);
    if (turn >= along && along) near = undefined; // a line instead of the point on it
    const nearest2 = [...under.entries()].sort(([, u], [, v]) => u.d - v.d)[0];
    const taken = turn ? real[turn - along] : splitting ? real[0] : nearest2;
    const best = taken ? { ...taken[1], at: this.onTrueLine(lines[taken[0]], taken[1].at, t) } : null;
    this.snapLine = null;
    this.snapped = near ? v3(toWorld(t.frame, ...near.at)) : null;
    this.snapPoint = near && !near.key ? this.snapped : null; // not a point along a line (that line gives the guide)
    this.snapWhat = near?.what ?? null;
    this.snapKey = near?.key ?? null;
    this.snapSeg = near?.key && straightKey(near.key) ? near.line![0] : null;
    if (near?.parts) this.snapWhat = `${near.what} (${near.parts.map((mm) => this.host.lengthText(mm)).join(' | ')})`;
    if (near) {
      // a point along a curve: on the curve, not on its flattened piece
      if (near.key?.startsWith('curve:')) {
        const world = v3(toWorld(t.frame, ...near.at));
        const on = near.key.startsWith('curve:edge:') ? this.onTrueLine({ segs: near.line!, what: '' }, world, t) : this.view.onSketchCurve(world, 1);
        if (on) {
          near = { ...near, at: uvOf(t.frame, on) };
          this.snapped = v3(toWorld(t.frame, ...near.at));
          if (this.snapPoint) this.snapPoint = this.snapped;
        }
      }
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
    const cross = turn || splitting ? null : this.crossing(close, t, mx, my, px);
    if (cross) {
      // where they really cross: from one true line to the next until they meet (straight lines cross as they are)
      const exact = crossed(cross.lines.map((i) => lines[i]), cross.at, t.frame);
      if (exact) cross.at = exact;
      else if (cross.lines.some((i) => lines[i].shape?.p.kind === 'circle' || (lines[i].shape ? curved(lines[i].shape!.p) : lines[i].segs.length > 1))) {
        let at = v3(toWorld(t.frame, ...cross.at));
        for (let k = 0; k < 12; k++) for (const i of cross.lines) at = this.onTrueLine(lines[i], at, t);
        cross.at = uvOf(t.frame, at);
      }
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
      if (seg[0].distanceTo(seg[1]) > 1e-3) {
        this.snapSeg = seg; // not seen end-on
        this.snapKey = sideKey(off.seg[0], off.seg[1]); // A / Shift A: its points, on this plane
      }
    }
    const [u, v] = uvOf(t.frame, p);
    if (!grid) return [u, v];
    const step = this.view.step(p, e, false); // Shift squares shapes here, it does not coarsen
    const [ou, ov] = grid === true ? [0, 0] : grid;
    return [ou + Math.round((u - ou) / step) * step, ov + Math.round((v - ov) / step) * step];
  }

  /**
   * The open side's end for the pointer, as angle (from `base`) and length from the last corner. Angle: typed, else the angle step
   * (Shift), else towards a snap point or line, else in 1° steps (Ctrl: the minimum angle). Length: typed, else up to
   * the snap (along that angle), else on the zoom's step (Ctrl: the minimum step).
   */
  private sideEnd(e: MouseEvent, ph: Extract<Phase, { kind: 'polygon' }>): UV | null {
    ph.arc = null;
    const off = this.spaceAt(e, ph.target, ph);
    ph.curZ = this.atZ;
    if (off) return off;
    if (this.drawMode()?.id === 'arc' && (ph.pts.length > 1 || ph.arcEnd)) {
      const at = this.point(e, ph.target, !ph.arcEnd);
      return at && (ph.arcEnd ? this.bulge(ph, at) : this.tangentArc(ph, at, e));
    }
    const at = this.point(e, ph.target, false);
    if (!at) return null;
    const sliding = this.sliding(ph);
    const from = sliding && tangentFrom(sliding.curve, sliding.near, sliding.t, at);
    const start = from ? from.at : ph.pts[ph.pts.length - 1];
    // relative to the direction it counts from
    const raw = deg((from ? from.dir : Math.atan2(at[1] - start[1], at[0] - start[0])) - ph.base);
    const by = (step: number) => Math.round(raw / step) * step;
    const typedDeg = ph.typed[1] === undefined ? null : this.host.number(ph.typed[1]);
    let a = ph.base + ((typedDeg ?? (role(e, 'constrain') ? by(SketchTool.angleStep) : this.snapped ? raw : by(role(e, 'precise') ? this.view.minAngle : 1))) * Math.PI) / 180;
    if (sliding && from) {
      // its start slides to where the curve runs that way; nowhere (a short arc): its direction as it is
      const t = tangentAlong(sliding.curve, a, from.at);
      if (t === null) a = from.dir;
      sliding.t = t ?? from.t;
      ph.pts[0] = t === null ? from.at : sliding.curve.at(t);
    }
    const [x0, y0] = from ? ph.pts[0] : start;
    const along = (at[0] - x0) * Math.cos(a) + (at[1] - y0) * Math.sin(a);
    const step = this.view.step(v3(toWorld(ph.target.frame, ...at)), e, false);
    const len = this.typed(ph.typed[0]) ?? (this.snapped ? along : Math.round(along / step) * step);
    return [x0 + len * Math.cos(a), y0 + len * Math.sin(a)];
  }

  /** Straight sides, not bezier curves or arcs. */
  private straightMode() {
    return ['single', 'polygon'].includes(this.drawMode()?.id ?? '');
  }

  /** Lines may leave the sketch plane (the 3D box, on at first; it shows only while it applies). */
  static space = true;
  private spaceBox = Object.assign(document.createElement('label'), { className: 'check space-box', title: 'Off: lines stay on the sketch plane', innerHTML: '<input type="checkbox"> 3D line' });
  /** The height off the plane of the point `spaceAt` found last (0: on the plane); `aimed3d`: it came from a snap there. */
  private atZ = 0;
  private aimed3d = false;

  /** Whether a line can leave the plane here: straight sides, seen at an angle (not straight on or from the back). */
  private angled(t: Target) {
    return this.kind === 'line' && this.straightMode() && Math.abs(this.view.looking().dot(v3(t.frame.n))) < Math.cos((1 * Math.PI) / 180);
  }

  private space(t: Target) {
    return SketchTool.space && this.angled(t);
  }

  /**
   * In 3D, a point off the plane: along the locked axis from the last point (typed: that far; else to a point aimed at,
   * or on the zoom's step), else a snap off the plane under the pointer; sets `atZ`. Null: on the plane as usual.
   */
  private spaceAt(e: MouseEvent, t: Target, ph?: Extract<Phase, { kind: 'polygon' }>): UV | null {
    this.atZ = 0;
    this.aimed3d = false;
    if (!this.space(t)) return null;
    this.lastPoint = [e, t];
    const f = t.frame;
    const lift = (p: THREE.Vector3): UV => {
      this.atZ = p.clone().sub(v3(f.o)).dot(v3(f.n));
      [this.snapped, this.snapLine] = [null, null]; // the view marks it
      return uvOf(f, p);
    };
    const typed = ph && this.typed(ph.typed[0]);
    if (ph && ph.lock !== null) {
      const from = v3(toWorld(f, ...ph.pts.at(-1)!, ph.z.at(-1)!));
      const dir = new THREE.Vector3().setComponent(ph.lock, 1);
      const shown = typed === undefined ? this.view.aimAt(e) : null;
      const aim = shown && shown.what !== 'on face' ? shown : this.view.aimAt(null); // to a corner, edge or line, not any face
      const ray = this.view.ray(e);
      const on = new THREE.Vector3();
      new THREE.Ray(from.clone().addScaledVector(dir, -1e6), dir).distanceSqToSegment(ray.origin, ray.origin.clone().addScaledVector(ray.direction, 1e6), on);
      const along = (aim ?? { at: on }).at.clone().sub(from).dot(dir);
      const step = this.view.step(from, e, false);
      this.snapWhat = `along ${'XYZ'[ph.lock]}${aim ? ` to ${aim.what}` : ''}`;
      return lift(from.addScaledVector(dir, typed !== undefined ? Math.sign(along || 1) * typed : aim ? along : Math.round(along / step) * step));
    }
    const aim = ph?.typed.some((x) => x !== undefined) ? null : this.view.aimAt(e); // typed sizes: on the plane
    if (!aim || inPlane(f, aim.at)) return this.view.aimAt(null), null;
    this.snapWhat = aim.what;
    this.aimed3d = true;
    return lift(aim.at);
  }

  /** A point clicked on a snap off the plane: moved onto the real geometry once that is known. */
  private trueSpace(e: MouseEvent, ph: Extract<Phase, { kind: 'polygon' }>, i: number) {
    if (!this.aimed3d) return;
    const f = ph.target.frame;
    void this.view.truePointAt(e).then((p) => {
      if (!p || this.phase !== ph || i >= ph.pts.length) return;
      [ph.pts[i], ph.z[i]] = [uvOf(f, p), p.clone().sub(v3(f.o)).dot(v3(f.n))];
      this.update();
    });
  }

  /** The curve the line's first side is drawn tangent to, while it is the open side. */
  private sliding(ph: Extract<Phase, { kind: 'polygon' }>) {
    return ph.pts.length === 1 && this.straightMode() ? ph.round : undefined;
  }

  /** Aiming "to object" while pulling: the depth follows what the pointer would reach, the pointer's note says what. */
  private aim(s: { at: THREE.Vector3; what: string } | null) {
    const ph = this.phase;
    if (ph.kind === 'pull' && s) aimInto(ph, s.at, ph.target.frame);
    this.aimed = s?.what ?? null;
    this.update();
  }

  /** A curve handle pulled from `from` to `at`; Shift: its direction in the angle step. */
  private handleTo(from: UV, at: UV, e: MouseEvent): UV {
    if (!role(e, 'constrain')) return at;
    const by = (SketchTool.angleStep * Math.PI) / 180;
    const a = Math.round(Math.atan2(at[1] - from[1], at[0] - from[0]) / by) * by;
    const l = Math.hypot(at[0] - from[0], at[1] - from[1]);
    return [from[0] + l * Math.cos(a), from[1] + l * Math.sin(a)];
  }

  /** The direction (radians) the line reaches its last point in. */
  private dirInto(ph: Extract<Phase, { kind: 'polygon' }>) {
    const n = ph.pts.length;
    const [, d] = sideDirs(ph.pts[n - 2], ph.curves[n - 2], ph.pts[n - 1]);
    return Math.atan2(d[1], d[0]);
  }

  /** The arc going on from the line's end along its direction, towards `at` (typed: its diameter and angle); sets `arc`; its end. */
  private tangentArc(ph: Extract<Phase, { kind: 'polygon' }>, at: UV, e?: MouseEvent): UV {
    const a = ph.pts[ph.pts.length - 1];
    const t = this.dirInto(ph);
    const n: UV = [-Math.sin(t), Math.cos(t)]; // its left
    const c: UV = [at[0] - a[0], at[1] - a[1]];
    const den = 2 * (c[0] * n[0] + c[1] * n[1]);
    if (Math.abs(den) < 1e-6) return at; // straight on: no arc
    const pointed = (c[0] * c[0] + c[1] * c[1]) / den; // its radius, signed: left positive
    const s = Math.sign(pointed);
    const d = this.typed(ph.typed[0]);
    const r = (d == null ? Math.abs(pointed) : d / 2) * s;
    const m: UV = [a[0] + n[0] * r, a[1] + n[1] * r];
    const a0 = Math.atan2(a[1] - m[1], a[0] - m[0]);
    const full = 2 * Math.PI;
    let sweep = (((Math.atan2(at[1] - m[1], at[0] - m[0]) - a0) * s) % full + full) % full;
    const typedDeg = ph.typed[1] === undefined ? null : this.host.number(ph.typed[1]);
    if (typedDeg !== null) sweep = (Math.abs(typedDeg) * Math.PI) / 180;
    else if (e && role(e, 'constrain')) sweep = Math.round(sweep / ((SketchTool.angleStep * Math.PI) / 180)) * ((SketchTool.angleStep * Math.PI) / 180);
    sweep = Math.min(sweep, full - 0.01);
    if (sweep < 1e-4) return at;
    const on = (k: number): UV => [m[0] + Math.abs(r) * Math.cos(a0 + s * k), m[1] + Math.abs(r) * Math.sin(a0 + s * k)];
    ph.arc = on(sweep / 2);
    return on(sweep);
  }

  /** A first arc: from its start to `arcEnd`, bulging to the pointer `at` (typed: its diameter, on the pointer's side); sets `arc`; its end. */
  private bulge(ph: Extract<Phase, { kind: 'polygon' }>, at: UV): UV {
    const [a, b] = [ph.pts[0], ph.arcEnd!];
    const d = this.typed(ph.typed[0]);
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dy) || 1;
    const side = Math.sign(dx * (at[1] - a[1]) - dy * (at[0] - a[0])) || 1;
    if (d == null) ph.arc = Math.abs(dx * (at[1] - a[1]) - dy * (at[0] - a[0])) / l < 1e-6 ? null : at;
    else {
      const big = Math.max(d / 2, l / 2);
      const sag = big - Math.sqrt(big * big - (l * l) / 4);
      ph.arc = [(a[0] + b[0]) / 2 - (side * dy * sag) / l, (a[1] + b[1]) / 2 + (side * dx * sag) / l];
    }
    return b;
  }

  /** Whether a click on the line's start closes it: three points, or two with a curve (one on the way counts). */
  private canClose(ph: Extract<Phase, { kind: 'polygon' }>) {
    const mode = this.drawMode()?.id;
    if (ph.z.some(Boolean)) return false; // off its plane: no flat shape
    return ph.pts.length >= 3 || (ph.pts.length === 2 && (ph.curves.some(Boolean) || mode === 'bezier' || mode === 'arc'));
  }

  /** The open side's curve, to `end`, in the mode now. */
  private openCurve(ph: Extract<Phase, { kind: 'polygon' }>, end: UV, closes = false): Curve | null {
    const mode = this.drawMode()?.id;
    if (mode === 'arc') return ph.arc && { mid: ph.arc };
    if (mode !== 'bezier') return null;
    const a = ph.pts[ph.pts.length - 1];
    const third = (from: UV, to: UV): UV => [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3];
    const l = Math.hypot(end[0] - a[0], end[1] - a[1]);
    const before = ph.curves.at(-1);
    const across = this.acrossLast(ph, end);
    // pulled, else smooth through the last point; on from a line or an arc: along it
    const on = ph.pts.length > 1 && !(before && 'c1' in before);
    const t = on ? this.dirInto(ph) : 0;
    const c1: UV = ph.out ?? (across ? [a[0] + across[0] * l / 3, a[1] + across[1] * l / 3] : on ? [a[0] + (Math.cos(t) * l) / 3, a[1] + (Math.sin(t) * l) / 3] : third(a, end));
    const pull = ph.held?.pull;
    const first = ph.curves[0];
    // a handle pulled at the end mirrors there; closing: smooth through the start
    const c2: UV = pull ? [end[0] * 2 - pull[0], end[1] * 2 - pull[1]] : closes && first && 'c1' in first ? [end[0] * 2 - first.c1[0], end[1] * 2 - first.c1[1]] : third(end, a);
    return { c1, c2 };
  }

  /** A bezier point clicked, not pulled, is smooth: the direction (unit) its handles lie in, from the point before it to `end`; null: none to turn. */
  private acrossLast(ph: Extract<Phase, { kind: 'polygon' }>, end: UV): UV | null {
    const n = ph.pts.length;
    const before = ph.curves[n - 2];
    if (this.drawMode()?.id !== 'bezier' || ph.out || n < 2 || !before || !('c1' in before)) return null;
    const [x, y] = [end[0] - ph.pts[n - 2][0], end[1] - ph.pts[n - 2][1]];
    const l = Math.hypot(x, y);
    return l > 1e-6 ? [x / l, y / l] : null;
  }

  /** The sides so far, the side before the open one bent to run smoothly on towards `end`. */
  private bentSides(ph: Extract<Phase, { kind: 'polygon' }>, end: UV): (Curve | null)[] {
    const across = this.acrossLast(ph, end);
    if (!across) return ph.curves;
    const n = ph.pts.length;
    const [a, b] = [ph.pts[n - 2], ph.pts[n - 1]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) / 3;
    return [...ph.curves.slice(0, -1), { ...(ph.curves[n - 2] as { c1: UV; c2: UV }), c2: [b[0] - across[0] * l, b[1] - across[1] * l] }];
  }

  /**
   * Adds a point: in the first mode a line is done at it; `closes`: on the line's start, it becomes a closed shape. A
   * first arc takes its end first, then its bulge. A point on the last one does nothing (a double-click's second).
   */
  private corner(ph: Extract<Phase, { kind: 'polygon' }>, at: UV, closes: boolean) {
    const prev = ph.pts[ph.pts.length - 1];
    if (Math.hypot(at[0] - prev[0], at[1] - prev[1], ph.curZ - ph.z.at(-1)!) < 0.05) return;
    const mode = this.drawMode()?.id;
    if (mode === 'arc' && ph.pts.length === 1 && !ph.arcEnd) {
      [ph.arcEnd, ph.typed, ph.axis, ph.arc] = [closes ? ph.pts[0] : at, [], 0, null];
      ph.cur = ph.arcEnd;
      return this.host.hint('Arc: move to its bulge and click, or type its diameter, [Enter] · [Esc] cancels');
    }
    const end = closes ? ph.pts[0] : at;
    if (mode === 'arc' && closes && ph.pts.length > 1) {
      ph.arc = null;
      this.tangentArc(ph, end);
    }
    const curve = this.openCurve(ph, end, closes);
    const sides = [...this.bentSides(ph, end), curve];
    if (closes && area({ kind: 'polygon', pts: ph.pts, curves: sides, r: 0, rot: 0 }) < 0.01) return this.host.hint('That encloses nothing: one more point, or pull a handle · ' + lineHint(mode));
    ph.curves = sides.slice(0, -1);
    if (closes && ph.held?.pull && ph.curves[0] && 'c1' in ph.curves[0]) ph.curves[0] = { ...ph.curves[0], c1: ph.held.pull };
    ph.curves.push(curve);
    const [typedSize, typedAngle] = ph.typed;
    ph.sides.push(closes || (typedSize === undefined && typedAngle === undefined) ? null : curve ? ('mid' in curve && typedSize !== undefined ? { d: typedSize } : null) : { ...(typedSize !== undefined ? { l: typedSize } : {}), ...(typedAngle !== undefined ? { deg: typedAngle, base: ph.base } : {}) });
    if (closes) return this.closeLine();
    ph.pts.push(end);
    ph.z.push(ph.curZ);
    [ph.typed, ph.axis, ph.out, ph.arc, ph.arcEnd, ph.lock] = [[], 0, null, null, null, null];
    ph.base = this.dirInto(ph); // the next side counts from this one
    if (mode === 'single') this.finishLine();
    else this.host.hint(lineHint(mode));
  }

  private typed(text: string | undefined) {
    return text === undefined ? undefined : (this.host.length(text) ?? undefined);
  }

  /** The line's handles while drawing: the one pulled (with its mirror across the point) and the last point's. */
  private handlesShown(ph: Extract<Phase, { kind: 'polygon' }>) {
    const f = ph.target.frame;
    const from = ph.held?.at ?? ph.pts[ph.pts.length - 1];
    const pull = ph.held ? ph.held.pull : ph.out;
    if (!pull) return;
    const ends = [pull, ...(ph.held?.adds ? [[from[0] * 2 - pull[0], from[1] * 2 - pull[1]] as UV] : [])].map((q) => v3(toWorld(f, ...q)));
    const m = new LineMaterial({ color: 0xff8c1a, linewidth: 1, depthTest: false });
    m.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
    this.view.overlay.add(new LineSegments2(new LineSegmentsGeometry().setPositions(ends.flatMap((q) => [...v3(toWorld(f, ...from)).toArray(), ...q.toArray()])), m), marks(ends, 0xff8c1a, 7));
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
    const m = this.drawMode(ph)?.id;
    const typedD = this.typed(ph.typed[0]);
    if (this.kind === 'circle' || this.kind === 'sphere') {
      if (m === 'diameter' || (m === 'three' && !ph.pts.length)) {
        const d = typedD ?? Math.hypot(du, dv);
        const l = Math.hypot(du, dv) || 1;
        return { kind: 'circle', x: au + (du / l) * (d / 2), y: av + (dv / l) * (d / 2), d };
      }
      if (m === 'three') return circleThrough(ph.anchor, ph.pts[0], ph.cur) ?? { kind: 'circle', x: au, y: av, d: 0 };
      if (m === 'tangent') return (ph.lines.length > 1 && tangentCircle(ph.lines[0], ph.lines[1], ph.cur, typedD)) || { kind: 'circle', x: ph.cur[0], y: ph.cur[1], d: 0 }; // typed: its radius
      return { kind: 'circle', x: au, y: av, d: typedD ?? 2 * Math.hypot(du, dv) };
    }
    if (this.kind === 'ngon') {
      // typed: diameter (across the corners), then the number of sides
      const sides = Math.max(3, Math.round((ph.typed[1] === undefined ? 0 : this.host.number(ph.typed[1])) || 6));
      const half = Math.PI / sides;
      const snap = (deg: number) => (ph.shift ? Math.round(deg / 15) * 15 : deg);
      if (m === 'edge') {
        // one side from the first click to the pointer, the polygon to its left
        const s = Math.hypot(du, dv);
        const apothem = s / (2 * Math.tan(half));
        const [cx, cy] = [au + du / 2 - (dv / (s || 1)) * apothem, av + dv / 2 + (du / (s || 1)) * apothem];
        const d = typedD ?? s / Math.sin(half);
        return { kind: 'ngon', x: cx, y: cy, d, sides, rot: (Math.atan2(av - cy, au - cx) * 180) / Math.PI - 90 };
      }
      const deg = snap((Math.atan2(dv, du) * 180) / Math.PI - 90);
      // the first corner points at the pointer; 'side': a side's middle does (the diameter across the corners grows to match)
      if (m === 'side') return { kind: 'ngon', x: au, y: av, d: typedD ?? (2 * Math.hypot(du, dv)) / Math.cos(half), sides, rot: deg + 180 / sides };
      return { kind: 'ngon', x: au, y: av, d: typedD ?? 2 * Math.hypot(du, dv), sides, rot: deg };
    }
    if (m === 'turnedCentre') {
      // its middle, a point it points to, then its size: twice the pointer's distance along and across
      const [bu, bv] = ph.pts[0] ?? ph.cur;
      const l = Math.hypot(bu - au, bv - av) || 1;
      const [eu, ev] = [(bu - au) / l, (bv - av) / l];
      const [pu, pv] = ph.pts.length ? [ph.cur[0] - au, ph.cur[1] - av] : [bu - au, bv - av];
      const w = typedD ?? 2 * Math.abs(pu * eu + pv * ev);
      const h = this.typed(ph.typed[1]) ?? (ph.pts.length ? 2 * Math.abs(-pu * ev + pv * eu) : 0);
      return { kind: 'rect', x: au, y: av, w, h, r: 0, rot: (Math.atan2(ev, eu) * 180) / Math.PI };
    }
    if (m === 'turned') {
      // a side from the first click to the second, then the width to the pointer (either side)
      if (!ph.pts.length) return { kind: 'rect', x: au + du / 2, y: av + dv / 2, w: typedD ?? Math.hypot(du, dv), h: 0, r: 0, rot: (Math.atan2(dv, du) * 180) / Math.PI };
      const [bu, bv] = ph.pts[0];
      const s = Math.hypot(bu - au, bv - av) || 1;
      const [nu, nv] = [-(bv - av) / s, (bu - au) / s];
      const off = (ph.cur[0] - au) * nu + (ph.cur[1] - av) * nv;
      const h = this.typed(ph.typed[1]) ?? Math.abs(off);
      const side = Math.sign(off) || 1;
      return { kind: 'rect', x: (au + bu) / 2 + (nu * side * h) / 2, y: (av + bv) / 2 + (nv * side * h) / 2, w: s, h, r: 0, rot: (Math.atan2(bv - av, bu - au) * 180) / Math.PI };
    }
    const centred = m === 'centre';
    const k = centred ? 2 : 1; // from the centre, the pointer sets half the size
    if (ph.shift) {
      const s = Math.max(Math.abs(du), Math.abs(dv));
      du = Math.sign(du || 1) * s;
      dv = Math.sign(dv || 1) * s;
    }
    const w = this.typed(ph.typed[0]) ?? Math.abs(du) * k;
    const h = this.typed(ph.typed[1]) ?? Math.abs(dv) * k;
    const sx = Math.sign(du || 1);
    const sy = Math.sign(dv || 1);
    return centred ? { kind: 'rect', x: au, y: av, w, h, r: 0, rot: 0 } : { kind: 'rect', x: au + (sx * w) / 2, y: av + (sy * h) / 2, w, h, r: 0, rot: 0 };
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
      return this.host.done({ target: ph.target, sphere: { center, d: profile.d, typed: a }, depth: 0 });
    }
    // typed sizes stay as typed (a tangent circle's is its radius: its diameter is worked out)
    this.drawn(ph.target, { profile, typed: profile.kind === 'rect' ? { w: a, h: b } : this.drawMode(ph)?.id === 'tangent' ? {} : { d: a } });
  }

  /** The line closed on its start: a shape to pull. */
  private closeLine() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const curves = ph.curves.some(Boolean) ? { curves: ph.curves } : {};
    this.drawn(ph.target, { profile: { kind: 'polygon', pts: ph.pts, ...curves, r: 0, rot: 0 }, typed: {}, sides: ph.sides });
  }

  /** Ends the line open at its points so far (never pulled: it stays flat). */
  private finishLine() {
    const ph = this.phase;
    if (ph.kind !== 'polygon') return;
    const curves = ph.curves.some(Boolean) ? { curves: ph.curves } : {};
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    // off its plane: straight sides only, no typed sizes to work its points out from
    const lifted = !curves.curves && ph.z.some(Boolean);
    this.host.done({ target: ph.target, drawn: { profile: { kind: 'line', pts: ph.pts, ...curves, ...(lifted ? { z: ph.z } : {}) }, typed: {}, sides: lifted ? undefined : ph.sides }, depth: 0 });
  }

  /** A finished shape: in sketch mode or as a construction line it stays flat and drawing goes on, else pulling starts. */
  private drawn(target: Target, drawn: Drawn) {
    if (this.mode?.kind !== 'draw' && !this.host.construction()) return this.enterPull(target, [drawn.profile], drawn);
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    this.host.done({ target, drawn, depth: 0 });
  }

  private enterPull(target: Target, shapes: DrawnProfile[], drawn: Drawn) {
    this.phase = { kind: 'pull', target, drawn, shapes, raw: 0, depth: 0, typed: undefined };
    this.view.unflatten(v3(target.frame.n));
    this.view.lockPointer();
    this.host.hint(PULL_HINT + (onBody(target) ? OP_HINT : '') + ' · click without pulling or [Esc]: keep it flat');
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
    this.host.done({
      target: ph.target,
      drawn: ph.drawn,
      depth,
      depthTyped: flat || this.typed(ph.typed) === undefined ? undefined : ph.typed,
      back,
      backTyped: flat || this.typed(ph.typedBack) === undefined ? undefined : ph.typedBack,
      op: pullOp(ph, onBody(ph.target), depth, !flat && this.cuts(ph)),
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
    const labels: [string, THREE.Vector3, boolean, boolean?, PullOp?][] = []; // text, where, typed into, T reaches for it, what a pull does to the body
    let angle: Parameters<SketchTool['angleLabel']>[0] | null = null; // the open side's angle: placed last, around the others
    let sideLength: string | null = null;
    const ph = this.phase;
    const fmt = (mm: number) => mm.toFixed(2);
    const label = (name: string, typed: string | undefined, mm: number, at: THREE.Vector3, active: boolean, t = false) =>
      labels.push([`${name} ${typed === undefined ? fmt(mm) : caret(typed)}`, at, active, t]);
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const f = ph.target.frame;
      const open = ph.kind === 'polygon' ? (ph.held?.adds ? ph.held.at : ph.arcEnd ?? ph.cur) : ph.cur;
      const drawing: DrawnProfile = ph.kind === 'shape' ? this.shape(ph) : { kind: 'line', pts: [...ph.pts, open], curves: [...this.bentSides(ph, open), ph.held && !ph.held.adds ? null : this.openCurve(ph, open, ph.held?.closes)], z: [...ph.z, ph.curZ] };
      const profile = { ...drawing, construction: this.host.construction() }; // dashed while drawing construction lines
      this.view.overlay.add(outline(profile, f));
      if (profile.kind === 'rect' && ph.kind === 'shape') {
        // at the middles of its bottom and right sides, turned with it
        const t = ((profile.rot ?? 0) * Math.PI) / 180;
        const at = (lx: number, ly: number) => v3(toWorld(f, profile.x + lx * Math.cos(t) - ly * Math.sin(t), profile.y + lx * Math.sin(t) + ly * Math.cos(t)));
        label('L', ph.typed[0], profile.w, at(0, -profile.h / 2), ph.axis === 0);
        label('W', ph.typed[1], profile.h, at(profile.w / 2, 0), ph.axis === 1);
      }
      if (ph.kind === 'polygon') this.handlesShown(ph);
      const sliding = ph.kind === 'polygon' && this.sliding(ph);
      if (sliding) {
        const lit = new LineMaterial({ color: 0xff8c1a, linewidth: 3, depthTest: false });
        lit.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
        this.view.overlay.add(new LineSegments2(new LineSegmentsGeometry().setPositions(sliding.line.flat().flatMap((v) => v.toArray())), lit), marks([v3(toWorld(f, ...ph.pts[0]))], 0xff8c1a, 12));
      }
      if (ph.kind === 'polygon' && ph.arc) {
        // an arc: its diameter in the pointer's note, its angle at its middle (a first arc's bulge: only its diameter)
        const arc = arcOf(ph.pts[ph.pts.length - 1], ph.arc, open);
        if (arc) {
          sideLength = `Ø ${ph.typed[0] === undefined ? fmt(arc.r * 2) : caret(ph.typed[0]!)}`;
          if (!ph.arcEnd) label('∠', ph.typed[1], (Math.abs(arc.a1 - arc.a0) * 180) / Math.PI, v3(toWorld(f, ...ph.arc)), ph.axis === 1);
        }
      } else if (ph.kind === 'polygon' && !ph.held && (ph.lock !== null || ph.curZ || ph.z.at(-1))) {
        // off the plane: its length in space; locked: the axis through the last point
        const last = ph.pts[ph.pts.length - 1];
        sideLength = `L ${ph.typed[0] === undefined ? fmt(Math.hypot(ph.cur[0] - last[0], ph.cur[1] - last[1], ph.curZ - ph.z.at(-1)!)) : caret(ph.typed[0]!)}`;
        if (ph.lock !== null) {
          const at = v3(toWorld(f, ...last, ph.z.at(-1)!));
          const dir = new THREE.Vector3().setComponent(ph.lock, 1e4);
          const m = new LineMaterial({ color: [0xe5484d, 0x30a46c, 0x3e63dd][ph.lock], linewidth: 1.5, depthTest: false });
          m.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
          this.view.overlay.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions([...at.clone().sub(dir).toArray(), ...at.clone().add(dir).toArray()]), m), { renderOrder: 1e6 }));
        }
      } else if (ph.kind === 'polygon' && !ph.held) {
        // the open side: its length first in the pointer's note, its angle labelled inside the angle
        const last = ph.pts[ph.pts.length - 1];
        const [du, dv] = [ph.cur[0] - last[0], ph.cur[1] - last[1]];
        const a = (deg(Math.atan2(dv, du) - ph.base) * Math.PI) / 180; // from the direction it counts from, the short way
        const at = v3(toWorld(f, ...last));
        const mm = 1 / this.view.pixelsPerMm(at);
        sideLength = `L ${ph.typed[0] === undefined ? fmt(Math.hypot(du, dv)) : caret(ph.typed[0]!)}`;
        const shown = `${+((a * 180) / Math.PI).toFixed(2)}°`;
        angle = { text: `∠ ${ph.typed[1] === undefined ? shown : caret(ph.typed[1]!)}`, active: ph.axis === 1, corner: last, end: ph.cur, base: ph.base, frame: f };
        // what it is measured from: a faint ray along that direction, and the arc from it to the side
        const arc = Array.from({ length: 25 }, (_, k) => ph.base + (a * k) / 24).map((t) => v3(toWorld(f, last[0] + ARC_PX * mm * Math.cos(t), last[1] + ARC_PX * mm * Math.sin(t))));
        const segs = [at, v3(toWorld(f, last[0] + 2 * ARC_PX * mm * Math.cos(ph.base), last[1] + 2 * ARC_PX * mm * Math.sin(ph.base))), ...arc.slice(1).flatMap((p, k) => [arc[k], p])];
        const m = new LineMaterial({ color: 0xff8c1a, linewidth: 1, depthTest: false, transparent: true, opacity: 0.7 });
        m.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
        this.view.overlay.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(segs.flatMap((v) => v.toArray())), m), { renderOrder: 1e6 }));
      }
      if (profile.kind === 'circle' && ph.kind === 'shape') {
        const tangent = this.drawMode(ph)?.id === 'tangent'; // sized by its radius
        if (!tangent || ph.lines.length > 1) label(tangent ? 'R' : 'Ø', ph.typed[0], tangent ? profile.d / 2 : profile.d, v3(toWorld(f, profile.x + profile.d / 2, profile.y)), true);
      }
      if (profile.kind === 'ngon' && ph.kind === 'shape') {
        label('Ø', ph.typed[0], profile.d, v3(toWorld(f, profile.x + profile.d / 2, profile.y)), ph.axis === 0);
        labels.push([`Sides ${ph.typed[1] === undefined ? profile.sides : caret(ph.typed[1]!)}`, v3(toWorld(f, profile.x, profile.y - profile.d / 2)), ph.axis === 1]);
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
    // a tangent circle: the lines picked, and the one a click would pick
    const lineMode = (ph.kind === 'hover' || ph.kind === 'shape') && this.drawMode(ph.kind === 'shape' ? ph : undefined)?.lines;
    const onFrame = lineMode && this.lastPoint?.[1];
    if (onFrame) {
      const picked = ph.kind === 'shape' ? ph.lines : [];
      const next = picked.length < 2 ? this.lineUV(onFrame) : null;
      const segs = [...picked, ...(next ? [next] : [])].flat().flatMap((q) => v3(toWorld(onFrame.frame, ...q)).toArray());
      const lit = new LineMaterial({ color: 0xff8c1a, linewidth: 3, depthTest: false });
      lit.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
      if (segs.length) this.view.overlay.add(new LineSegments2(new LineSegmentsGeometry().setPositions(segs), lit));
    }
    const bisect = this.bisectGuide();
    for (const g of ph.kind === 'pull' ? [] : [...SketchTool.guides, ...(bisect ? [bisect] : [])]) {
      // dashed like construction lines (mm)
      const m = new LineMaterial({ color: GUIDE_COLOR, linewidth: g.fixed ? 1.4 : 0.8, depthTest: false, dashed: true, dashSize: 1.5, gapSize: 1.5 });
      m.resolution.set(this.view.el.clientWidth, this.view.el.clientHeight);
      this.view.overlay.add(new LineSegments2(new LineSegmentsGeometry().setPositions(guideSeg(g).flatMap((v) => v.toArray())), m).computeLineDistances());
    }
    // on a point along a line (not anywhere along it)
    const tangentKey = ph.kind === 'hover' && this.tangentNear && !this.tangentOn ? `${MODIFIER_NAMES[roleKey('tangent')]}-click or right-click: a tangent from it` : null;
    const more = this.snapKey && !this.snapWhat?.startsWith('on ') ? `Press ${comboText(keysOf('moreSnaps')[0])} for more points, ${comboText(keysOf('fewerSnaps')[0])} for fewer` : null;
    const guide = this.hoveredGuide();
    const onPoint = this.snapped && !this.snapWhat?.startsWith('on ');
    const fix = onPoint ? `${comboText(keysOf('fixGuide')[0])}: X and Y guides through this point` : guide ? `Press ${comboText(keysOf('fixGuide')[0])} to ${guide.fixed ? 'let the guide go with the next click' : 'keep the guide'}` : null;
    const cycleHint = ph.kind === 'hover' && this.cycle.count > 1 ? `Tab: the next of ${this.cycle.count} here` : null;
    // a line split with A: into how many parts
    const split = this.showing ? `Split in ${SketchTool.divisions.get(this.showing)! + (this.showing.startsWith('circle:') ? 0 : 1)}` : null;
    const base = ph.kind === 'polygon' && this.hoveredLine(ph.target.frame) !== null ? `Press ${comboText(keysOf('baseline')[0])} to measure the angle from this line` : null;
    const axes = ph.kind === 'polygon' && this.space(ph.target) ? `${AXIS_KEYS.map((a) => comboText(keysOf(a)[0])).join(' / ')}: along that axis (again: free)` : null;
    const t = ph.kind === 'hover' || ph.kind === 'ball' ? (this.mode?.kind === 'draw' ? this.mode.target : this.lastPoint?.[1]) : ph.target;
    this.spaceBox.hidden = !t || !this.angled(t);
    const angles = ph.kind === 'polygon' && !ph.arc && !ph.held && !this.snapKey ?`Angle steps ${SketchTool.angleStep}° · hold Shift to snap · ${comboText(keysOf('moreSnaps')[0])} finer, ${comboText(keysOf('fewerSnaps')[0])} coarser` : null;
    // pulling: while aiming what the pointer reaches (what T does is in the size label)
    const pulling = ph.kind === 'pull' && this.reaching && [this.aimed, 'Click: its distance goes into the size'].filter(Boolean).join('\n');
    // at the pointer what it measures and is on; other keys with the tool's hint
    this.host.cursorTip(ph.kind === 'pull' ? pulling || null : [sideLength, ph.kind === 'polygon' && this.sliding(ph) && 'Tangent', this.snapWhat, split, this.nothingToSplit && 'No line here to split: put the pointer on one'].filter(Boolean).join('\n') || null, [tangentKey, more, cycleHint, fix, axes, base, angles].filter(Boolean).join(' · ') || null);
    if (ph.kind === 'polygon' && !ph.arc && !ph.held && (this.shiftHeld || performance.now() < this.raysUntil)) this.angleRays(ph);
    if (ph.kind === 'ball') {
      // see-through orange until made, also inside a body; what was clicked marked
      const ball = this.ballNow(ph);
      if (ball) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(ball.d / 2, 48, 24), new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
        mesh.position.copy(ball.center);
        this.view.overlay.add(mesh);
        label('Ø', ph.typed, ball.d, ball.center, ph.planes.length === 3);
      }
      if (ph.pts.length) this.view.overlay.add(marks(ph.pts, 0xff8c1a, 10));
      for (const q of ph.planes) {
        const patch = new THREE.Mesh(new THREE.CircleGeometry(18 / this.view.pixelsPerMm(q.at), 32), new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.6, depthTest: false, side: THREE.DoubleSide }));
        patch.position.copy(q.at);
        patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), q.n);
        this.view.overlay.add(patch);
      }
    }
    if (ph.kind === 'pull') {
      const f = ph.target.frame;
      const { depth, back } = pulled(ph, (t) => this.host.length(t));
      for (const p of ph.shapes) this.view.overlay.add(outline(p, f));
      if (depth || back) this.solid(ph.shapes, f, depth, back);
      label(pullName(f.n), ph.typed, depth, this.middle(ph).addScaledVector(v3(f.n), depth), !ph.side, !ph.side && !this.reaching);
      if (onBody(ph.target)) labels[labels.length - 1][4] = pullOp(ph, true, depth, this.cuts(ph)); // what it does to the body
      if (back || ph.side) label('Back', ph.typedBack, back, this.middle(ph).addScaledVector(v3(f.n), -(Math.sign(depth) || 1) * back), !!ph.side, !!ph.side && !this.reaching);
    }
    const els = labels.map(([text, , active, t, op]) => sizeLabel(text, active, t, op));
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
    const el = Object.assign(document.createElement('div'), { className: `size-label${a.active ? ' active' : ''}`, innerHTML: caretHtml(a.text) });
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
    const [from, to] = extent(depth, back);
    this.view.overlay.add(new THREE.Mesh(extruded(ps, f, from, to), new THREE.MeshStandardMaterial({ color: 0x3b6fd8, transparent: true, opacity: 0.45, depthWrite: false })));
  }

  /** Whether the pull shares volume with the body it was drawn on (only then it can cut). */
  private cuts(ph: Extract<Phase, { kind: 'pull' }>) {
    const { depth, back } = pulled(ph, (t) => this.host.length(t));
    const f = ph.target.frame;
    return !!ph.target.body && (!!depth || !!back) && pullCuts(this.view, ph.target.body, f.n, extent(depth, back), (from, to) => extruded(ph.shapes, f, from, to));
  }
}

/** Shapes pulled from `from` to `to` along their plane's normal: a solid in the world, holes for shapes inside others. */
function extruded(ps: DrawnProfile[], f: Frame, from: number, to: number) {
  const level = nesting(ps);
  const shapes = ps.flatMap((p, i) => {
    if (level[i] % 2) return [];
    const outer = shape2d(p);
    outer.holes = ps.filter((q, j) => level[j] === level[i] + 1 && inside(p, ...centre(q))).map(shape2d);
    return [outer];
  });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: to - from, bevelEnabled: false, curveSegments: 32 });
  return geo.applyMatrix4(new THREE.Matrix4().makeBasis(v3(f.x), v3(f.y), v3(f.n)).setPosition(v3(f.o).addScaledVector(v3(f.n), from)));
}

/** What the pointer's note calls a tangent circle's bisector. */
const BISECTOR = 'on bisector';

const SHAPE_HINT = 'Drag to size, or type it · [Tab] other side or number of sides · [Alt] another drawing mode for this shape · [Shift] square / 15° · [Ctrl] precise · [Enter] or click: done · [Esc] cancels';

/** A drawing mode: its name, how many clicks it takes, whether it starts on lines, the hint after the first click; its pictogram is icon `<shape>-<id>`. */
type Mode = { id: string; name: string; clicks: number; lines?: true; next?: string };
/** The drawing modes of the shapes that have several (Alt cycles them, Shift Alt back). */
const MODES: Partial<Record<ToolKind, Mode[]>> = {
  rect: [
    { id: 'corners', name: 'Rectangle: two corners', clicks: 2 },
    { id: 'centre', name: 'Rectangle: from the centre', clicks: 2 },
    { id: 'turned', name: 'Rectangle: turned (a side, then its width)', clicks: 3, next: 'Turned rectangle: click the side\'s other end, then the width · [Esc] cancels' },
    { id: 'turnedCentre', name: 'Rectangle: turned, from the centre (a direction, then its size)', clicks: 3, next: 'Turned rectangle from its centre: click a point it points to, then its size · [Esc] cancels' },
  ],
  sphere: [
    { id: 'centre', name: 'Sphere: centre and radius, on a plane', clicks: 2 },
    { id: 'diameter', name: 'Sphere: two points across', clicks: 2 },
    { id: 'three', name: 'Sphere: through three points, the smallest', clicks: 3 },
    { id: 'four', name: 'Sphere: through four points', clicks: 4 },
    { id: 'planes', name: 'Sphere: touching three planes', clicks: 3 },
  ],
  circle: [
    { id: 'centre', name: 'Circle: centre and radius', clicks: 2 },
    { id: 'diameter', name: 'Circle: two points across', clicks: 2 },
    { id: 'three', name: 'Circle: through three points', clicks: 3, next: 'Circle through three points: click the second, then the third · [Esc] cancels' },
    { id: 'tangent', name: 'Circle: tangent to two lines', clicks: 3, lines: true, next: 'Tangent circle: click the second line, then where it lies (its size) · [Esc] cancels' },
  ],
  line: [
    { id: 'single', name: 'Line: one line per two clicks', clicks: 2 },
    { id: 'polygon', name: 'Line: free polygon, point by point', clicks: 2 },
    { id: 'bezier', name: 'Line: bezier curve (click: a smooth point, drag: pull its handles)', clicks: 2 },
    { id: 'arc', name: 'Line: round arcs, each on from the last', clicks: 2 },
  ],
  ngon: [
    { id: 'corner', name: 'Regular polygon: centre to a corner', clicks: 2 },
    { id: 'side', name: "Regular polygon: centre to a side's middle", clicks: 2 },
    { id: 'edge', name: 'Regular polygon: one side, end to end', clicks: 2 },
  ],
};

/** How many points a sphere in space takes, by its way. */
const BALL_POINTS: Record<string, number> = { diameter: 2, three: 3, four: 4 };

/** The drawing mode's pictogram, name and how to change it, top left in the view for a moment. */
function showMode(el: HTMLElement, kind: ToolKind, m: Mode, ms = 3000) {
  el.querySelector('.mode-note')?.remove();
  const note = Object.assign(document.createElement('div'), { className: 'mode-note', innerHTML: `${icon(`${kind}-${m.id}`)}<span>${m.name}<small>Change with ${comboText(keysOf(kind as Action)[0])} or Alt</small></span>` });
  el.append(note);
  setTimeout(() => note.remove(), ms);
}

/**
 * The curve of line `l` at its segment `i` (plane coordinates) a line can be tangent to, and what it is called: a
 * sketch's circle, arc or bezier side, a body's round edge (from half a circle on: the whole circle); null: none.
 */
function curveOf(l: SnapLine, i: number, f: Frame): { curve: TangentCurve; name: string } | null {
  const arc = (a: UV, mid: UV, b: UV) => {
    const o = arcOf(a, mid, b);
    return o && { curve: circleCurve(o.c, o.r, o.a0, o.a1), name: 'arc' };
  };
  if (l.guide) return null;
  if (l.shape) {
    const { p, sketch } = l.shape;
    const uv = (q: UV) => uvOf(f, v3(toWorld(sketch.frame, ...q)));
    if (p.kind === 'circle') return { curve: circleCurve(uv([p.x, p.y]), p.d / 2), name: 'circle' };
    if ((p.kind !== 'polygon' && p.kind !== 'line') || !curved(p)) return null;
    const q = bakeTurn(p);
    let side = 0;
    for (const s of sidesOf(q)) {
      i -= s.length - 1;
      if (i < 0) break;
      side++;
    }
    const c = q.curves?.[side];
    if (!c) return null;
    const [a, b] = [uv(q.pts[side]), uv(q.pts[(side + 1) % q.pts.length])];
    return 'c1' in c ? { curve: bezierCurve(a, uv(c.c1), uv(c.c2), b), name: 'curve' } : arc(a, uv(c.mid), b);
  }
  if (l.segs.length < 4) return null;
  const pts = [...l.segs.map(([a]) => uvOf(f, a)), uvOf(f, l.segs[l.segs.length - 1][1])];
  const fit = arcOf(pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor((2 * pts.length) / 3)]);
  if (!fit || !pts.every((q) => Math.abs(Math.hypot(q[0] - fit.c[0], q[1] - fit.c[1]) - fit.r) < 1e-3)) return null;
  const length = l.segs.reduce((n, [a, b]) => n + a.distanceTo(b), 0);
  return length > 0.98 * Math.PI * fit.r ? { curve: circleCurve(fit.c, fit.r), name: 'circle' } : arc(pts[0], pts[pts.length >> 1], pts[pts.length - 1]);
}

/** The circle through three points (plane coordinates); null: they lie on one line. */
function circleThrough([ax, ay]: UV, [bx, by]: UV, [cx, cy]: UV): DrawnProfile | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const [a2, b2, c2] = [ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy];
  const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { kind: 'circle', x, y, d: 2 * Math.hypot(ax - x, ay - y) };
}

/**
 * The circle touching two lines (plane coordinates) in the corner between them where `p` is, its middle as near `p`
 * as its size lets (`radius`: that size); null: the lines are parallel.
 */
function tangentCircle(l1: [UV, UV], l2: [UV, UV], p: UV, radius?: number): DrawnProfile | null {
  const b = bisector(l1, l2, p);
  if (!b) return null;
  const { o, v } = b;
  const r = radius ?? Math.max(0, ((p[0] - o[0]) * v[0] + (p[1] - o[1]) * v[1]) / (v[0] * v[0] + v[1] * v[1]));
  return { kind: 'circle', x: o[0] + v[0] * r, y: o[1] + v[1] * r, d: 2 * r };
}

/** Where two lines cross (`o`) and the bisector of their angle on `p`'s side: a tangent circle's middle is `o` + `v` × its radius. Null: parallel. */
function bisector([a1, b1]: [UV, UV], [a2, b2]: [UV, UV], p: UV): { o: UV; v: UV } | null {
  const dir = ([a, b]: [UV, UV]): UV => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const [d1, d2] = [dir([a1, b1]), dir([a2, b2])];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-9) return null;
  // where the lines cross
  const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / cross;
  const o: UV = [a1[0] + d1[0] * t, a1[1] + d1[1] * t];
  // each line's normal towards p: the middle lies 1 out from both per unit of radius
  const normal = (d: UV): UV => {
    const n: UV = [-d[1], d[0]];
    return (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] < 0 ? [-n[0], -n[1]] : n;
  };
  const [n1, n2] = [normal(d1), normal(d2)];
  const det = n1[0] * n2[1] - n1[1] * n2[0];
  return { o, v: [(n2[1] - n1[1]) / det, (n1[0] - n2[0]) / det] }; // solves n1·v = 1, n2·v = 1
}
/** What the line tool says while drawing, by its mode. */
function lineHint(mode?: string) {
  const end = '[Alt] or [L] next mode · a click on the start closes it · [Enter], [Esc] or double-click finishes · [Backspace] removes the last';
  if (mode === 'bezier') return `Click: a smooth point, drag: pull its handles · [Shift] handle in angle steps, [Ctrl] precise · ${end}`;
  if (mode === 'arc') return `Click the arc's end, or type its diameter · [Tab] its angle, [Enter] · [Shift] angle steps · ${end}`;
  const how = 'or type a length · [Tab] the angle, [Enter] · [Shift] angle steps, [Ctrl] precise · [B] on a line: measure the angle from it';
  return mode === 'polygon' ? `Click the next point, ${how} · ${end}` : `Click the end point, ${how} · [Alt] or [L] next mode · [Esc] cancels`;
}
/** An angle (radians) in degrees, the short way: -180 to 180. */
const deg = (rad: number) => ((((rad * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
/** The pointer's note while pulling (before typing a depth). */
/** A size label (`active`: typed into); `t`: it says T reaches to an object for it. */
/** A size label in the view; `t`: T and D reach for it; `op`: what pulling on a body does, with the key that switches it. */
export function sizeLabel(text: string, active: boolean, t = false, op?: PullOp) {
  const el = Object.assign(document.createElement('div'), { className: `size-label${active ? ' active' : ''}`, innerHTML: sizeHtml(caretHtml(text), true) });
  if (op) el.append(Object.assign(document.createElement('small'), { className: `op ${op}`, innerHTML: `${icon(OP_ICONS[op])}${MODIFIER_SIGNS[roleKey('centre')]}`, title: `${PULL_OPS[op]} · tap ${MODIFIER_NAMES[roleKey('centre')]}: join / cut / new body` }));
  if (t) el.append(Object.assign(document.createElement('small'), { innerHTML: `${icon('target')}T`, title: 'T: to object' }), Object.assign(document.createElement('small'), { innerHTML: `${icon('measure')}D`, title: 'D: Distance measure' }));
  return el;
}
/** Radius (px) of the arc showing what a side's angle is measured from. */
const ARC_PX = 36;
/** Whether a snap key is a straight line's (a circle's or curve's has a prefix). */
const straightKey = (k: string) => !k.startsWith('circle:') && !k.startsWith('curve:');
/** Angle steps for Shift on lines and polygon sides, coarse to fine. */
export const ANGLE_STEPS = [90, 45, 30, 15, 10, 5, 1];
const PULL_HINT = 'Pull, or type a depth · [Tab] how far back · [T] to object · [D] measure · [Alt] held: both ways from the plane · [Shift] coarse · [Ctrl] precise · click or [Enter]: done';
/** On a body: what P does. */
export const OP_HINT = ' · [Alt] tapped: join / cut / new body';

/** A shape's outline as segments (world) on the frame's plane; a line stays open. */
/** Lines to snap to (world): outlines of the sketches' shapes (with the shape), and body edges. */
export function snapLines(sketches: ViewSketch[], edges: Segment[][]): SnapLine[] {
  return [...sketches.flatMap((sketch) => sketch.shapes.map((p) => ({ segs: outlineSegs(p, sketch.frame), curves: curveKeys(p, sketch.frame), what: 'on line', shape: { p, sketch } }))), ...edges.map((segs) => ({ segs, what: 'on edge' }))];
}

/**
 * The points on `lines` (world), each with what it is and the outline it belongs to (lit while snapped): centres,
 * corners (line ends), points along sides (the middle, or as many as set with A) and around circles (quadrants, or
 * as set) of the shapes; the same along straight body edges.
 */
export function linePoints(lines: SnapLine[]): (Omit<SnapPoint, 'at'> & { at: THREE.Vector3 })[] {
  const pts: (Omit<SnapPoint, 'at'> & { at: THREE.Vector3 })[] = [];
  // evenly spaced points inside a side, each with the lengths on both sides of it
  const divide = ([a, b]: Segment) => {
    const key = sideKey(a, b);
    const m = SketchTool.divisions.get(key) ?? 1;
    const len = a.distanceTo(b);
    for (let i = 1; i <= m; i++) pts.push({ at: a.clone().lerp(b, i / (m + 1)), what: fraction(i, m + 1), line: [[a, b]], key, parts: [(len * i) / (m + 1), len - (len * i) / (m + 1)] });
  };
  // evenly spaced points along a curved line
  const along = (segs: Segment[], key: string, m: number) => {
    const len = segs.reduce((n, [a, b]) => n + a.distanceTo(b), 0);
    for (let k = 1; k <= m; k++) {
      let left = (len * k) / (m + 1);
      const seg = segs.find(([a, b]) => (left -= a.distanceTo(b)) <= 0) ?? segs[segs.length - 1];
      pts.push({ at: seg[1].clone().lerp(seg[0], -left / (seg[0].distanceTo(seg[1]) || 1)), what: fraction(k, m + 1), line: segs, key, parts: [(len * k) / (m + 1), len - (len * k) / (m + 1)] });
    }
  };
  for (const { segs, shape, guide } of lines) {
    if (guide) continue;
    if (!shape) {
      if (segs.length === 1) divide(segs[0]);
      else if (SketchTool.divisions.has(edgeKey(segs))) along(segs, edgeKey(segs), SketchTool.divisions.get(edgeKey(segs))!);
      continue;
    }
    const { p, sketch } = shape;
    const cs = corners(p);
    const sides = p.kind === 'line' ? cs.slice(1).map((b, i) => [cs[i], b]) : cs.map((a, i) => [a, cs[(i + 1) % cs.length]]);
    const at = (q: UV) => v3(toWorld(sketch.frame, ...q));
    const world = ([a, b]: UV[]): Segment => [at(a), at(b)];
    const bent = curved(p) && (p.kind === 'polygon' || p.kind === 'line') ? sidesOf(bakeTurn(p)) : null;
    const turnedCurves = p.kind === 'polygon' || p.kind === 'line' ? bakeTurn(p).curves : undefined;
    const pieces = (i: number) => (bent ? bent[i].slice(1).map((b, k) => [at(bent[i][k]), at(b)] as Segment) : [world(sides[i])]);
    // centres and circle points light the whole shape, a point along a side that side, a corner the two sides meeting there
    if (p.kind !== 'line') pts.push({ at: at(centre(p)), what: 'centre', line: segs });
    // a rounded or chamfered corner: its middle (and an arc's centre) instead of the corner, sides between the cuts
    const cuts = cornerCuts(p);
    cs.forEach((q, i) => {
      const line = [p.kind === 'line' ? i - 1 : (i - 1 + sides.length) % sides.length, i].filter((k) => sides[k]).flatMap(pieces);
      const cut = cuts[i];
      if (!cut) return pts.push({ at: at(q), what: p.kind === 'line' ? 'end' : 'corner', line });
      pts.push({ at: at(cut.pts[cut.pts.length >> 1]), what: cut.centre ? 'arc middle' : 'chamfer middle', line });
      if (cut.centre) pts.push({ at: at(cut.centre), what: 'arc centre', line });
    });
    sides.forEach((x, i) => {
      const [from, to] = [cuts[i], cuts[(i + 1) % cuts.length]];
      if ((!bent || bent[i].length === 2) && (from || to)) return divide(world([from ? from.pts[from.pts.length - 1] : x[0], to ? to.pts[0] : x[1]]));
      if (!bent || bent[i].length === 2) return divide(pieces(i)[0]);
      // along the curve, evenly by its true length
      const segs = pieces(i);
      const key = `curve:${sideKey(...world(x))}`;
      const m = SketchTool.divisions.get(key) ?? 1;
      const side = { a: x[0], b: x[1], c: turnedCurves?.[i] };
      const len = segLength(side);
      for (let k = 1; k <= m; k++) pts.push({ at: at(pointAlong(side, (len * k) / (m + 1))), what: fraction(k, m + 1), line: segs, key, parts: [(len * k) / (m + 1), len - (len * k) / (m + 1)] });
      const c = turnedCurves?.[i];
      const arc = c && 'mid' in c ? arcOf(x[0], c.mid, x[1]) : null;
      if (arc) pts.push({ at: at(arc.c), what: 'arc centre', line: segs });
    });
    if (p.kind === 'circle') {
      const key = `circle:${p.id}`;
      const m = SketchTool.divisions.get(key) ?? 4;
      for (let i = 0; i < m; i++) {
        const a = (2 * Math.PI * i) / m;
        pts.push({ at: at([p.x + (Math.cos(a) * p.d) / 2, p.y + (Math.sin(a) * p.d) / 2]), what: m === 4 ? 'quadrant' : `${+((360 * i) / m).toFixed(1)}°`, line: segs, key });
      }
    }
  }
  return pts;
}

/** A finer or coarser split of the line or circle `key` (A / Shift A): at least the middle, a circle at least halves. */
export function divideMore(key: string, more: boolean) {
  const circle = key.startsWith('circle:');
  SketchTool.divisions.set(key, Math.max(circle ? 2 : 1, (SketchTool.divisions.get(key) ?? (circle ? 4 : 1)) + (more ? 1 : -1)));
}

/** Drawn on a face, in front of it: a depth offset towards the viewer, the same at any zoom (bodies sit 1 / 1 behind theirs). */
export const FRONT = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 } as const;

/** How far (mm) a drawn or snapped outline lies off the true curve at most. */
const DRAWN = 0.01;

/** A shape's outline as points (plane coordinates), each side within `DRAWN` of its true curve; a closed one's last point repeats its first. */
const outlinePts = (p: DrawnProfile): UV[] => segments(p).flatMap((g, i) => segPoints(g, DRAWN).slice(i ? 1 : 0));

/** A shape's outline as segments (world), its corners rounded or chamfered as drawn; a line stays open. */
/** The outline's points in the world; a 3D line's at their heights. */
const outlineWorld = (p: DrawnProfile, f: Frame) => (p.kind === 'line' && p.z && !curved(p) ?p.pts.map(([u, v], i) => v3(toWorld(f, u, v, p.z![i]))) : outlinePts(p).map((q) => v3(toWorld(f, ...q))));

function outlineSegs(p: ViewSketch['shapes'][number], f: Frame): Segment[] {
  const pts = outlineWorld(p, f);
  return pts.slice(1).map((b, i): Segment => [pts[i], b]);
}

/** A side of the line being drawn (plane coordinates `a` to `b`, `curve` as its shape has it) as a line to snap to. */
function drawnSide(a: UV, b: UV, curve: Curve | null, f: Frame): SnapLine {
  const p = { id: '', kind: 'line' as const, pts: [a, b], curves: [curve] };
  return { segs: outlineSegs(p, f), curves: curveKeys(p, f), what: 'on this line' };
}

/** Per segment of `outlineSegs` the key of the curved side it is part of (null: a straight side); none: no curves. */
function curveKeys(p: ViewSketch['shapes'][number], f: Frame): (string | null)[] | undefined {
  // rounded corners change the sides: no keys then
  if (!curved(p) || (p.kind !== 'polygon' && p.kind !== 'line') || cornerCuts(p).some(Boolean)) return undefined;
  const at = (q: UV) => v3(toWorld(f, ...q));
  return segments(p).flatMap((g) => Array<string | null>(segPoints(g, DRAWN).length - 1).fill(g.c ? `curve:${sideKey(at(g.a), at(g.b))}` : null));
}

/** Where sketch outlines `ls` (two) really cross nearest plane point `near` (frame `f`); null: one is no sketch shape or a bezier takes part. */
function crossed(ls: SnapLine[], near: UV, f: Frame): UV | null {
  if (!ls.every((l) => l.shape)) return null;
  const into = (l: SnapLine) => {
    const { frame } = l.shape!.sketch;
    const m = (q: UV) => uvOf(f, v3(toWorld(frame, ...q)));
    return segments(l.shape!.p).map(({ a, b, c }) => ({ a: m(a), b: m(b), c: !c ? c : 'mid' in c ? { mid: m(c.mid) } : { c1: m(c.c1), c2: m(c.c2) } }));
  };
  const [g, h] = ls.map(into);
  let best: UV | null = null;
  for (const x of g)
    for (const y of h) {
      const found = segCrossings(x, y);
      if (!found) return null;
      for (const q of found) if (!best || Math.hypot(q[0] - near[0], q[1] - near[1]) < Math.hypot(best[0] - near[0], best[1] - near[1])) best = q;
    }
  return best;
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
  return new THREE.Shape(outlinePts(p).slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)));
}

/**
 * The shape's outline on the frame's plane, `width` px wide; `onFace`: depth tested, pulled towards the viewer by a
 * depth offset (no shift in mm: it lies on its face at any zoom), else drawn over everything (previews); construction
 * lines dashed; `opacity` below 1: faint.
 */
export function outline(p: DrawnProfile, f: Frame, color = 0x3b6fd8, onFace = false, dashMm = 1.5, width = 2, opacity = 1) {
  const pts = outlineWorld(p, f);
  const material = new LineMaterial({ color, linewidth: width, depthTest: onFace, ...(onFace ? FRONT : {}), dashed: !!p.construction, dashSize: dashMm, gapSize: dashMm, transparent: opacity < 1, opacity });
  return new Line2(new LineGeometry().setPositions(pts.flatMap((v) => v.toArray())), material).computeLineDistances();
}
