import * as THREE from 'three';
import { BASE, extent, toWorld, type Frame, type V3 } from '../doc/frames';
import { arcOf, area, centre, corners, curved, flattened, inside, nesting, sideDirs, sidesOf, bakeTurn, type DrawnProfile } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BasePlane, Curve, ShapeGroup, SketchPlacement } from '../doc/types';
import { marks } from './marks';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { comboText, keysOf, pressed, role, type Action, type ModEvent } from '../ui/keys';
import { keepInside } from '../ui/inside';
import { caret, caretHtml, restOf } from '../ui/complete';
import { inName } from '../doc/expr';
import { axisHtml } from '../ui/axes';
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
  /** How far it also reaches behind the plane (mm), as typed. */
  back?: number;
  backTyped?: string;
  mode: 'add' | 'cut';
}

/** What the tool needs from the viewport. */
export interface ToolView {
  el: HTMLElement;
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
  /** What a click points at (world): a corner, an edge point or a face point; null: empty space. */
  pointAt(e: MouseEvent): THREE.Vector3 | null;
  /** Marks what a click at the pointer reaches (as `pointAt` finds it) and returns it; null: clears. */
  aimAt(e: MouseEvent | null): { at: THREE.Vector3; what: string } | null;
  /** The same where the pointer is now. */
  aimHere(): { at: THREE.Vector3; what: string } | null;
  /** The point a click reaches, from the real geometry; null: nothing there. */
  truePointAt(e: MouseEvent): Promise<THREE.Vector3 | null>;
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
  /** Lights a work plane (null: none). */
  lightPlane(id: string | null): void;
  /** Body corners in the world, to snap to. */
  corners(): THREE.Vector3[];
  /** Body edges in the world (each as segments), to snap to. */
  edges(): [THREE.Vector3, THREE.Vector3][][];
  /** Spheres in the world. */
  spheres(): { center: THREE.Vector3; r: number }[];
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

/**
 * To object in a pull: the distance from the plane to `at` along its normal (for Back: behind it) goes into what is
 * being typed (depth or back), to calculate on with it; Enter keeps it.
 */
export function reachInto(p: Pulling, at: THREE.Vector3, frame: { o: V3; n: V3 }, host: ToolHost) {
  const d = at.clone().sub(v3(frame.o)).dot(v3(frame.n));
  const k = p.side ? 'typedBack' : 'typed';
  p[k] = (p[k] ?? '') + host.lengthText(p.side ? -d : d);
}

/** A pull's size label: the world axis it goes along (X, Y or Z), else Depth (a slanted face). */
export const pullName = (n: V3) => ['X', 'Y', 'Z'].find((_, k) => Math.abs(n[k]) > 0.999) ?? 'Depth';

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

/** Typing while pulling: into the depth or (Tab) the back; Backspace erases. Returns whether the key was used. */
export function pullKey(e: KeyboardEvent, p: Pulling) {
  const k = p.side ? 'typedBack' : 'typed';
  if (pressed(e, 'otherSide') && restOf(p[k] ?? '')) p[k] += restOf(p[k]!); // a name showing: written out
  else if (pressed(e, 'otherSide')) p.side = p.side ? 0 : 1;
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
   * `arcEnd`: a first arc's end, its bulge still to come; `arc`: the open arc's middle.
   */
  | { kind: 'polygon'; target: Target; pts: UV[]; curves: (Curve | null)[]; sides: NonNullable<Drawn['sides']>; cur: UV; typed: (string | undefined)[]; axis: number; base: number; out: UV | null; held: { at: UV; px: [number, number]; pull: UV | null; adds: boolean; closes: boolean } | null; arcEnd: UV | null; arc: UV | null }
  | ({ kind: 'pull'; target: Target; drawn: Drawn; shapes: DrawnProfile[] } & Pulling);

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
/** A line the pointer snaps to (world segments; `curves`: per segment the key of the curved side it is part of); sketch outlines keep their shape and sketch, guides themselves. */
type SnapLine = { segs: Segment[]; curves?: (string | null)[]; what: string; shape?: { p: ViewSketch['shapes'][number]; sketch: ViewSketch }; guide?: { at: THREE.Vector3; dir: THREE.Vector3; fixed: boolean } };
/** Guides' colour and reach (mm each way: practically endless). */
const GUIDE_COLOR = 0xd946ef;
const guideSeg = (g: { at: THREE.Vector3; dir: THREE.Vector3 }, reach = 1e4): Segment => [g.at.clone().addScaledVector(g.dir, -reach), g.at.clone().addScaledVector(g.dir, reach)];
/** Whether the segment lies on the guide's line. */
const onLine = (g: { at: THREE.Vector3; dir: THREE.Vector3 }, [a, b]: Segment) => [a, b].every((v) => v.clone().sub(g.at).cross(g.dir).length() < 1e-4);
const sameSeg = (p: Segment | null, q: Segment | null) => p === q || (!!p && !!q && p[0].equals(q[0]) && p[1].equals(q[1]));
const AXIS_NAME: Record<BasePlane, string> = { xy: 'the ground (XY)', xz: 'the front plane (XZ)', yz: 'the right plane (YZ)' };
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
  private shiftUp = (e: KeyboardEvent) => e.key === 'Shift' && this.shiftHeld && ((this.shiftHeld = false), this.update());

  constructor(
    readonly kind: ToolKind | null,
    private view: ToolView,
    private host: ToolHost,
    readonly mode?: ToolMode,
  ) {
    view.el.append(this.labels);
    addEventListener('keyup', this.shiftUp);
    this.host.hint(this.hoverHint());
    this.update();
    const m = this.drawMode();
    if (m) showMode(view.el, kind!, m);
  }

  dispose() {
    this.view.el.querySelector('.mode-note')?.remove();
    clearTimeout(this.dwell.timer);
    removeEventListener('keyup', this.shiftUp);
    this.view.aimAt(null);
    SketchTool.guides = SketchTool.guides.filter((g) => g.fixed);
    this.view.unlockPointer();
    this.view.markFace();
    this.litPlane(null);
    this.clearPreview();
    this.labels.remove();
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

  private press(e: PointerEvent): boolean {
    if (e.button !== 0) return false;
    const ph = this.phase;
    if (ph.kind === 'hover' && this.mode?.kind === 'plane') {
      const target = this.target(e);
      if (target) this.host.done({ target, depth: 0, mode: 'add' });
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
      const at = this.point(e, target);
      if (!at) return true;
      this.view.markFace();
      this.litPlane(null);
      // a tangent circle starts on a line
      const line = this.drawMode()?.lines ? this.lineUV(target) : null;
      if (this.drawMode()?.lines && !line) return this.host.hint('Circle tangent to two lines: click the first line · [Alt] another drawing mode'), true;
      this.phase =
        this.kind === 'line'
          ? { kind: 'polygon', target, pts: [at], curves: [], sides: [], cur: at, typed: [], axis: 0, base: 0, out: null, held: this.drawMode()?.id === 'bezier' ? { at, px: [e.clientX, e.clientY], pull: null, adds: false, closes: false } : null, arcEnd: null, arc: null }
          : { kind: 'shape', target, anchor: at, cur: at, px: [e.clientX, e.clientY], dragged: false, typed: [], axis: 0, shift: role(e, 'constrain'), pts: [], lines: line ? [line] : [] };
      this.host.hint(this.kind === 'line' ? lineHint(this.drawMode()?.id) : SHAPE_HINT);
    } else if (ph.kind === 'shape') {
      ph.px = [e.clientX, e.clientY]; // a drag counts from this press
      this.advance(); // a further click of click-click drawing
    } else if (ph.kind === 'polygon') {
      const at = this.sideEnd(e, ph);
      if (!at) return true;
      const r = this.view.el.getBoundingClientRect();
      const [x, y] = this.view.toScreen(v3(toWorld(ph.target.frame, ...ph.pts[0])));
      const closes = this.canClose(ph) && Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8;
      // a bezier point goes in when let go: a drag first pulls its handles
      if (this.drawMode()?.id === 'bezier') ph.held = { at: closes ? ph.pts[0] : at, px: [e.clientX, e.clientY], pull: null, adds: true, closes };
      else this.corner(ph, at, closes);
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
    if (ph.kind === 'hover') {
      if (!this.kind && this.mode?.kind !== 'plane') return;
      const target = this.target(e);
      this.view.markFace(target?.body && !target.sketch ? this.view.hit(e) : undefined);
      this.litPlane(target?.placement.kind === 'work' ? target.placement.plane : null);
      this.host.hint(target ? this.hoverHint(target) : 'Only top faces of extrusions take sketches · [Esc] stops');
      if (target) this.point(e, target); // shows a snap dot
      return this.update();
    }
    if (ph.kind === 'shape' && this.reaching) return this.aim(this.view.aimAt(e)); // aiming: the shape stays as it is
    if (ph.kind === 'polygon' && ph.held) {
      if (ph.held.pull || Math.hypot(e.clientX - ph.held.px[0], e.clientY - ph.held.px[1]) > 4) {
        const at = this.point(e, ph.target);
        if (at) ph.held.pull = this.handleTo(ph.held.at, at, e);
      }
    } else if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const riding = this.riding(ph);
      const at = ph.kind === 'polygon' ? this.sideEnd(e, ph) : this.point(e, ph.target, !riding);
      if (at) ph.cur = riding ? this.ride(e, ph, at) : at;
      this.shiftHeld = role(e, 'constrain');
      if (ph.kind === 'shape') {
        ph.dragged ||= Math.hypot(e.clientX - ph.px[0], e.clientY - ph.px[1]) > 4;
        ph.shift = role(e, 'constrain');
      }
    } else {
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
    // a line's length or angle starts with a digit, so letters still snap, fix guides and switch tools
    const sideTyping = ph.kind === 'polygon' && (ph.typed[ph.axis] !== undefined || /[\d.($-]/.test(e.key));
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (ph.kind === 'shape' || ph.kind === 'pull' || sideTyping);
    const more = pressed(e, 'moreSnaps');
    const free = ph.kind !== 'pull' && !((ph.kind === 'shape' || ph.kind === 'polygon') && ph.typed[ph.axis] !== undefined); // not while typing a size
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
    if ((ph.kind === 'hover' || ph.kind === 'shape' || (ph.kind === 'polygon' && !ph.held)) && e.key === 'Alt' && !e.repeat && this.drawMode()) return this.switchMode(e.shiftKey ? -1 : 1), this.update(), true;
    if (free && guide && pressed(e, 'fixGuide')) {
      guide.fixed = !guide.fixed;
      if (!SketchTool.guides.includes(guide)) SketchTool.guides.push(guide); // the bisector, kept
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
      if (this.reaching) return (this.reaching = false), (this.aimed = null), this.view.aimAt(null), this.update(), true; // only the aiming ends
      if (ph.kind === 'hover') return this.host.done(null), true;
      if (ph.kind === 'pull') return this.commit(true), this.update(), true; // a drawn shape stays flat
      if (ph.kind === 'polygon' && ph.pts.length >= 2) return this.finishLine(), this.update(), true;
      this.phase = { kind: 'hover' };
      this.host.hint(this.hoverHint());
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
      else if (!pullKey(e, ph)) return false;
    } else return false;
    this.update();
    return true;
  }

  private hoverHint(target?: Target) {
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
    for (const { at, ...o } of linePoints(lines)) add(at, o);
    for (const c of this.view.corners()) add(c, { what: 'corner', corner: c });
    // the line being drawn: its own points, its start closes it
    const ph = this.phase;
    if (ph.kind === 'polygon') ph.pts.slice(0, -1).forEach((at, i) => pts.push({ at, what: !i && this.canClose(ph) ? 'start: a click closes it' : 'point of this line' }));
    return pts;
  }

  /** Lines to snap to, each as segments (world): outlines of every visible sketch's shapes (with the shape), and body edges. */
  private snapLines(): SnapLine[] {
    const bisect = this.bisectGuide();
    return [
      ...snapLines(this.view.sketches, this.view.edges()),
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
    this.snapSeg = near?.key && straightKey(near.key) ? near.line![0] : null;
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
        const key = guide ? undefined : shape?.p.kind === 'circle' ? `circle:${shape.p.id}` : (curves?.[i] ?? (shape || segs.length === 1 ? sideKey(a, b) : undefined));
        if (!best || d < best.d) best = { at: a.clone().lerp(b, k), line: segs, what, key, seg: key && straightKey(key) ? [a, b] : undefined, guide, d };
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
    ph.arc = null;
    if (this.drawMode()?.id === 'arc' && (ph.pts.length > 1 || ph.arcEnd)) {
      const at = this.point(e, ph.target, !ph.arcEnd);
      return at && (ph.arcEnd ? this.bulge(ph, at) : this.tangentArc(ph, at, e));
    }
    const at = this.point(e, ph.target, false);
    if (!at) return null;
    const [x0, y0] = ph.pts[ph.pts.length - 1];
    const [du, dv] = [at[0] - x0, at[1] - y0];
    // relative to the direction it counts from
    const raw = deg(Math.atan2(dv, du) - ph.base);
    const by = (step: number) => Math.round(raw / step) * step;
    const typedDeg = ph.typed[1] === undefined ? null : this.host.number(ph.typed[1]);
    const a = ph.base + ((typedDeg ?? (role(e, 'constrain') ? by(SketchTool.angleStep) : this.snapped ? raw : by(role(e, 'precise') ? this.view.minAngle : 1))) * Math.PI) / 180;
    const along = du * Math.cos(a) + dv * Math.sin(a);
    const step = this.view.step(v3(toWorld(ph.target.frame, ...at)), e, false);
    const len = this.typed(ph.typed[0]) ?? (this.snapped ? along : Math.round(along / step) * step);
    return [x0 + len * Math.cos(a), y0 + len * Math.sin(a)];
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
    if (Math.hypot(at[0] - prev[0], at[1] - prev[1]) < 0.05) return;
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
    [ph.typed, ph.axis, ph.out, ph.arc, ph.arcEnd] = [[], 0, null, null, null];
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
      return this.host.done({ target: ph.target, sphere: { center, d: profile.d, typed: a }, depth: 0, mode: 'add' });
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
    this.host.done({ target: ph.target, drawn: { profile: { kind: 'line', pts: ph.pts, ...curves }, typed: {}, sides: ph.sides }, depth: 0, mode: 'add' });
  }

  /** A finished shape: in sketch mode or as a construction line it stays flat and drawing goes on, else pulling starts. */
  private drawn(target: Target, drawn: Drawn) {
    if (this.mode?.kind !== 'draw' && !this.host.construction()) return this.enterPull(target, [drawn.profile], drawn);
    this.phase = { kind: 'hover' };
    this.host.hint(this.hoverHint());
    this.host.done({ target, drawn, depth: 0, mode: 'add' });
  }

  private enterPull(target: Target, shapes: DrawnProfile[], drawn: Drawn) {
    this.phase = { kind: 'pull', target, drawn, shapes, raw: 0, depth: 0, typed: undefined };
    this.view.unflatten(v3(target.frame.n));
    this.view.lockPointer();
    this.host.hint(PULL_HINT + ' · click without pulling or [Esc]: keep it flat');
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
    const labels: [string, THREE.Vector3, boolean, boolean?][] = []; // text, where, typed into, T reaches for it
    let angle: Parameters<SketchTool['angleLabel']>[0] | null = null; // the open side's angle: placed last, around the others
    let sideLength: string | null = null;
    const ph = this.phase;
    const fmt = (mm: number) => mm.toFixed(2);
    const label = (name: string, typed: string | undefined, mm: number, at: THREE.Vector3, active: boolean, t = false) =>
      labels.push([`${name} ${typed === undefined ? fmt(mm) : caret(typed)}`, at, active, t]);
    if (ph.kind === 'shape' || ph.kind === 'polygon') {
      const f = ph.target.frame;
      const open = ph.kind === 'polygon' ? (ph.held?.adds ? ph.held.at : ph.arcEnd ?? ph.cur) : ph.cur;
      const drawing: DrawnProfile = ph.kind === 'shape' ? this.shape(ph) : { kind: 'line', pts: [...ph.pts, open], curves: [...this.bentSides(ph, open), ph.held && !ph.held.adds ? null : this.openCurve(ph, open, ph.held?.closes)] };
      const profile = { ...drawing, construction: this.host.construction() }; // dashed while drawing construction lines
      this.view.overlay.add(outline(profile, f));
      if (profile.kind === 'rect' && ph.kind === 'shape') {
        // at the middles of its bottom and right sides, turned with it
        const t = ((profile.rot ?? 0) * Math.PI) / 180;
        const at = (lx: number, ly: number) => v3(toWorld(f, profile.x + lx * Math.cos(t) - ly * Math.sin(t), profile.y + lx * Math.sin(t) + ly * Math.cos(t)));
        label('W', ph.typed[0], profile.w, at(0, -profile.h / 2), ph.axis === 0);
        label('H', ph.typed[1], profile.h, at(profile.w / 2, 0), ph.axis === 1);
      }
      if (ph.kind === 'polygon') this.handlesShown(ph);
      if (ph.kind === 'polygon' && ph.arc) {
        // an arc: its diameter in the pointer's note, its angle at its middle (a first arc's bulge: only its diameter)
        const arc = arcOf(ph.pts[ph.pts.length - 1], ph.arc, open);
        if (arc) {
          sideLength = `Ø ${ph.typed[0] === undefined ? fmt(arc.r * 2) : caret(ph.typed[0]!)}`;
          if (!ph.arcEnd) label('∠', ph.typed[1], (Math.abs(arc.a1 - arc.a0) * 180) / Math.PI, v3(toWorld(f, ...ph.arc)), ph.axis === 1);
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
    const more = this.snapKey && !this.snapWhat?.startsWith('on ') ? `Press ${comboText(keysOf('moreSnaps')[0])} for more points, ${comboText(keysOf('fewerSnaps')[0])} for fewer` : null;
    const guide = this.hoveredGuide();
    const fix = guide ? `Press ${comboText(keysOf('fixGuide')[0])} to ${guide.fixed ? 'let the guide go with the next click' : 'keep the guide'}` : null;
    const base = ph.kind === 'polygon' && this.hoveredLine(ph.target.frame) !== null ? `Press ${comboText(keysOf('baseline')[0])} to measure the angle from this line` : null;
    const angles = ph.kind === 'polygon' && !ph.arc && !ph.held && !this.snapKey ? `Angle steps ${SketchTool.angleStep}° · hold Shift to snap · ${comboText(keysOf('moreSnaps')[0])} finer, ${comboText(keysOf('fewerSnaps')[0])} coarser` : null;
    // pulling: while aiming what the pointer reaches (what T does is in the size label)
    const pulling = ph.kind === 'pull' && this.reaching && [this.aimed, 'Click: its distance goes into the size'].filter(Boolean).join('\n');
    // at the pointer what it measures and is on; other keys with the tool's hint
    this.host.cursorTip(ph.kind === 'pull' ? pulling || null : [sideLength, this.snapWhat].filter(Boolean).join('\n') || null, [more, fix, base, angles].filter(Boolean).join(' · ') || null);
    if (ph.kind === 'polygon' && !ph.arc && !ph.held && (this.shiftHeld || performance.now() < this.raysUntil)) this.angleRays(ph);
    if (ph.kind === 'pull') {
      const f = ph.target.frame;
      const { depth, back } = pulled(ph, (t) => this.host.length(t));
      for (const p of ph.shapes) this.view.overlay.add(outline(p, f));
      if (depth || back) this.solid(ph.shapes, f, depth, back);
      label(pullName(f.n), ph.typed, depth, this.middle(ph).addScaledVector(v3(f.n), depth), !ph.side, !ph.side && !this.reaching);
      if (back || ph.side) label('Back', ph.typedBack, back, this.middle(ph).addScaledVector(v3(f.n), -(Math.sign(depth) || 1) * back), !!ph.side, !!ph.side && !this.reaching);
    }
    const els = labels.map(([text, , active, t]) => sizeLabel(text, active, t));
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

/** The drawing mode's pictogram, name and how to change it, top left in the view for a moment. */
function showMode(el: HTMLElement, kind: ToolKind, m: Mode, ms = 3000) {
  el.querySelector('.mode-note')?.remove();
  const note = Object.assign(document.createElement('div'), { className: 'mode-note', innerHTML: `${icon(`${kind}-${m.id}`)}<span>${m.name}<small>Change with ${comboText(keysOf(kind as Action)[0])} or Alt</small></span>` });
  el.append(note);
  setTimeout(() => note.remove(), ms);
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
export function sizeLabel(text: string, active: boolean, t = false) {
  const el = Object.assign(document.createElement('div'), { className: `size-label${active ? ' active' : ''}`, innerHTML: axisHtml(caretHtml(text)) });
  if (t) el.append(Object.assign(document.createElement('small'), { innerHTML: `${icon('target')}T`, title: 'T: to object' }), Object.assign(document.createElement('small'), { innerHTML: `${icon('measure')}D`, title: 'D: Distance measure' }));
  return el;
}
/** Radius (px) of the arc showing what a side's angle is measured from. */
const ARC_PX = 36;
/** Whether a snap key is a straight line's (a circle's or curve's has a prefix). */
const straightKey = (k: string) => !k.startsWith('circle:') && !k.startsWith('curve:');
/** Angle steps for Shift on lines and polygon sides, coarse to fine. */
export const ANGLE_STEPS = [90, 45, 30, 15, 10, 5, 1];
const PULL_HINT = 'Pull, or type a depth · [Tab] how far back · [T] to object · [D] measure · [Alt] both ways from the plane · [Shift] coarse · [Ctrl] precise · click or [Enter]: done';

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
  for (const { segs, shape, guide } of lines) {
    if (guide) continue;
    if (!shape) {
      if (segs.length === 1) divide(segs[0]);
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
    cs.forEach((q, i) => pts.push({ at: at(q), what: p.kind === 'line' ? 'end' : 'corner', line: [p.kind === 'line' ? i - 1 : (i - 1 + sides.length) % sides.length, i].filter((k) => sides[k]).flatMap(pieces) }));
    sides.forEach((x, i) => {
      if (!bent || bent[i].length === 2) return divide(pieces(i)[0]);
      // along the curve, evenly by length
      const segs = pieces(i);
      const key = `curve:${sideKey(...world(x))}`;
      const m = SketchTool.divisions.get(key) ?? 1;
      const len = segs.reduce((n, [a, b]) => n + a.distanceTo(b), 0);
      for (let k = 1; k <= m; k++) {
        let left = (len * k) / (m + 1);
        const seg = segs.find(([a, b]) => (left -= a.distanceTo(b)) <= 0) ?? segs[segs.length - 1];
        const point = seg[1].clone().lerp(seg[0], -left / (seg[0].distanceTo(seg[1]) || 1));
        pts.push({ at: point, what: fraction(k, m + 1), line: segs, key, parts: [(len * k) / (m + 1), len - (len * k) / (m + 1)] });
      }
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

function outlineSegs(p: ViewSketch['shapes'][number], f: Frame): Segment[] {
  const pts = (p.kind === 'circle' ? shape2d(p).getPoints(48).map((q): UV => [q.x, q.y]) : flattened(p)).map((q) => v3(toWorld(f, ...q)));
  return (p.kind === 'line' ? pts.slice(0, -1) : pts).map((a, i): Segment => [a, pts[(i + 1) % pts.length]]);
}

/** Per segment of `outlineSegs` the key of the curved side it is part of (null: a straight side); none: no curves. */
function curveKeys(p: ViewSketch['shapes'][number], f: Frame): (string | null)[] | undefined {
  if (!curved(p) || (p.kind !== 'polygon' && p.kind !== 'line')) return undefined;
  const at = (q: UV) => v3(toWorld(f, ...q));
  return sidesOf(bakeTurn(p)).flatMap((s) => Array<string | null>(s.length - 1).fill(s.length > 2 ? `curve:${sideKey(at(s[0]), at(s[s.length - 1]))}` : null));
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
  return new THREE.Shape(flattened(p).map(([x, y]) => new THREE.Vector2(x, y)));
}

/**
 * The shape's outline on the frame's plane, `width` px wide, lifted `lift` mm along the normal (0: drawn over
 * everything, for previews); construction lines dashed; `opacity` below 1: faint.
 */
export function outline(p: DrawnProfile, f: Frame, color = 0x3b6fd8, lift = 0, dashMm = 1.5, width = 2, opacity = 1) {
  const n = v3(f.n).multiplyScalar(lift);
  const pts = (p.kind === 'line' ? flattened(p).map(([x, y]) => ({ x, y })) : shape2d(p).getPoints(48)).map((q) => v3(toWorld(f, q.x, q.y)).add(n));
  if (p.kind !== 'line') pts.push(pts[0]); // closed by its own last segment
  const material = new LineMaterial({ color, linewidth: width, depthTest: lift !== 0, dashed: !!p.construction, dashSize: dashMm, gapSize: dashMm, transparent: opacity < 1, opacity });
  return new Line2(new LineGeometry().setPositions(pts.flatMap((v) => v.toArray())), material).computeLineDistances();
}
