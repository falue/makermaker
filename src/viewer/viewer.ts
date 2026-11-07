import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { Backdrop, BasePlane, CameraState, Light, Views } from '../doc/types';
import type { BodyMesh } from '../kernel/build';
import { along, axisWheel, choose } from './gizmo';
import { toWorld, type Frame } from '../doc/frames';
import { arcOf, area, bounds, centre, edgeDistance, inside, bakeTurn, nearestOnOutline, nearBox, segments, segPoints, type DrawnProfile, type Seg } from '../doc/profiles';
import { inGroup } from '../doc/shapegroups';
import { anchorAt, angleAt, centreMoved, controlMoved, handlesOf, pointHandles, pointMoved, resized, rotated, simpleLine, sizeOf, smoothToggled, type Handle } from './shapes';
import { ExtrudeTool, type AreaGroup, type ExtrudeHost, type FaceItem } from './extrude';
import { FacePullTool, type PullLook } from './faces';
import { closeButton, icon } from '../ui/icons';
import { marks } from './marks';
import { borders, dragged, newViewLayout, panes, type ViewBorder, type ViewLayout } from './viewlayout';
import { fastRaycast } from './pick';
import { MeshBVH } from 'three-mesh-bvh';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEFAULT_LIGHT, lightDirections, plainLook, toLook, type Look } from '../doc/materials';
import { applyLook, boxUv, glowLight, needsUv, pictureLoaded, renderMaterial, sphereOf } from './look';
import { loadImage, photoPass, photoTexture } from './photo';
import { cameraFrom, pathTraced, type RenderWatch } from './render';
import type { Exact, ExactEdge } from '../kernel/exact';
import { farthestOnPath, nearestOnPath } from '../kernel/paths';
import { turnedBox } from './turnedBox';
import { backdropCss, drawSky, SKIES, twoColours } from './sky';
import { axisHtml, sizeHtml } from '../ui/axes';
import { caret, caretHtml, restOf } from '../ui/complete';
import type { Settings } from '../ui/settings';
import { divideMore, edgeKey, FRONT, linePoints, outline, planeHit, shape2d, sideKey, snapLines, SketchTool, uvOf, type Target, type Tool, type ToolHost, type ToolKind, type ToolMode, type ToolView, type ViewSketch } from './sketch';
import { picksFace, pressed, role, toggles, type ModEvent } from '../ui/keys';
import { keepInside } from '../ui/inside';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';
type Span = [number, number];

export interface ViewerHost {
  /** `add`: Shift- or ⌘ / Ctrl-click, adds the body to the selection or removes it. */
  select(id: string | null, add: boolean): void;
  /** A right-click on body `id` at screen (x, y): its menu, if it has one. */
  bodyMenu(id: string, x: number, y: number): void;
  /** A drag of the selected bodies began: the move fields open (all three at 0); returns their close. */
  dragMove(): () => void;
  /** An image was corner-dragged to a new middle (world, mm) and width. */
  placeImage(id: string, o: Vec3, width?: number): void;
  /** The selected images were dragged by `by` (world, mm): the move fields open with it. */
  imageDragged(by: Vec3): void;
  /** A sketch shape was clicked; `add`: Shift or ⌘ / Ctrl, toggles it in the selection. */
  pickShape(sketch: string, shape: string, add: boolean): void;
  /** Shapes of a sketch were moved, resized or turned (mm, degrees); sizes typed as text are kept as expressions. */
  setShapes(sketch: string, shapes: { id: string; profile: DrawnProfile }[], typed?: Partial<Record<'w' | 'h' | 'd', string>>): void;
  /** A typed distance in mm, or null if invalid. */
  length(text: string): number | null;
  number(text: string): number | null;
  /** What the real solids say (see `MeasureAsk`). */
  askSolids(asks: MeasureAsk[]): Promise<MeasureAnswer[]>;
  /** A body that is a mesh: its triangles are all there is. */
  meshOnly(body: string): boolean;
  /** The kernel's tight box of a turned body arrived (see `measure`): what shows sizes reads them again. */
  boxesKnown(): void;
  /** Where shapes drawn on a body face go (`flat`: the face is planar). */
  placeOn(face: PickedFace, flat: boolean): Omit<Target, 'sketch'> | null;
  /** A press on a body or a sketch shape (before any selecting). */
  touched(): void;
  /** A clicked part of a finish (null: a click elsewhere on a body). */
  pickFinish(sel: FinishPick | null): void;
  /** A length in mm, as shown to the user. */
  format(mm: number): string;
  /** A press on a picked finish's face (at `at`, world): drag its size. */
  dragFinish(body: string, feature: string, at: THREE.Vector3): void;
  /** A press on picked edges (world segments per edge): drag a fillet or chamfer onto them. */
  dragEdges(body: string, edges: [THREE.Vector3, THREE.Vector3][][]): void;
  /** A double-click on a sketch shape: open its sketch group, down to its sub-group. */
  enterShape(sketch: string, shape: string): void;
  /** Faces or edges picked (Alt-click, Shift more; double right-click or Alt double-click: an edge's tangent chain), with the area (mm²) or length (mm), the edge count and one circle's Ø; null: none any more. */
  pickedPart(part: PickedPart | null): void;
}

/** A picked face or edges: area (mm²) or total length (mm), how many edges, and Ø (mm) when it is one circle. */
/** A picked face or edge's size (area or length) and a circle's Ø; `exact`: from the kernel, else from the mesh (shown with ~). */
export type PickedPart = { kind: 'face' | 'edge'; body: string; size: number; count?: number; diameter?: number; exact: boolean };

/** A part of a finish on a body: the one replacing the edge through `mid` (null: the whole finish). */
export type FinishPick = { body: string; feature: string; mid: Vec3 | null };

/** A face picked for a section: a point on it and the normal pointing away from the camera; `body`: whose face (none: a base plane). */
/** What a click reaches ("to object"): where, and what it is ('corner', 'centre', '1/2', 'on edge', 'on face'). */
/** What a click reaches ("to object"): where, what it is, and the line or circle A / Shift A splits finer or coarser there. */
import type { MeasureAnswer, MeasureAsk } from '../kernel/measure';

export type Aim = { at: THREE.Vector3; what: string; key?: string; on?: PartRef };
/** A part of a body's real solid (see `MeasureAsk`): its edge or face by number. */
export type PartRef = { body: string; edge?: number; face?: number };

/** A sketch shape whose outline is under the pointer. */
type SketchHit = { sketch: ViewSketch; q: ViewSketch['shapes'][number] };

/**
 * A line to turn around (world): through `at` along unit `dir`; `what` it was taken from, `length`: the edge's or
 * line's, `d` and `body`: a round edge's diameter and body.
 */
export type TurnAxis = { at: THREE.Vector3; dir: THREE.Vector3; what: string; length?: number; d?: number; body?: string };

/** Where an extra view looks from. */
export type ViewKind = '3d' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom' | 'face';

/** An extra view as a file keeps it. */
type SavedView = Views['views'][number];

/**
 * An extra view rendering live (path traced): the picture's place over the view and its bar's status and Save; `gen`
 * counts restarts (an older run stops), `stale`: something changed while another view rendered; `image`: done;
 * `shot`: the render Save adds to; `background`: its own (a render's), else the view's.
 */
type LiveRender = { gen: number; timer: number; stale: boolean; key?: string; running?: boolean; picture: HTMLElement; status: HTMLElement; save: HTMLButtonElement; image?: Blob; shot?: string; background?: Backdrop };

export interface PickedFace {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  body?: string;
  /** A quiet pick: the corner, edge point or face point clicked (none: empty space), and the edge there (its length). */
  edge?: { length: number; ref?: PartRef };
  /** A quiet pick: the corner, edge point or face point clicked (none: empty space), what it is ('corner', 'on edge', 'on face' …), and a straight edge there (its ends). */
  snap?: THREE.Vector3;
  what?: string;
  line?: { at: THREE.Vector3; to: THREE.Vector3 };
  /** Picking outlines: the shape of a visible sketch whose outline was clicked, in front of any face. */
  sketch?: { id: string; shape: string };
  /** A round (cylindrical) face clicked (world): its axis from `at` along `dir` for `length`, radius `r`; `shaft`: material inside it (else a hole). */
  round?: { at: THREE.Vector3; dir: THREE.Vector3; length: number; r: number; shaft: boolean };
  /** The face of a body clicked, whole (see `FaceItem`). */
  item?: FaceItem;
  /** A work plane clicked (picks that take them, in front of any body): its id; `point` on it, `normal` its own, away from the camera. */
  plane?: string;
  /** A quiet pick taking parts, Alt-clicked: the edge (its segments, world; `ref`: its part of the solid, none for section and crossing lines) or the face there; `adds`: Shift held too. */
  part?: { edge: [THREE.Vector3, THREE.Vector3][]; ref?: PartRef; refs?: PartRef[] } | { face: FaceItem };
  /** A quiet pick: `snap` could not be read from a solid or a sketch's true curve (a section or crossing line). */
  about?: boolean;
  adds?: boolean;
}

// The view cube works in three's y-up frame: world (x, y, z) is cube (x, z, -y); Front looks from -y.
const toCube = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const fromCube = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.z, v.y);
const round = (v: number, step: number) => Math.round(v / step) * step;
const unit = (k: number) => new THREE.Vector3().setComponent(k, 1);

/** The B-rep face (index) of a body mesh hit. */
/** The area (mm²) of the B-rep face `hit` lies on, from its triangles. */
function faceArea(mesh: THREE.Mesh, face: number) {
  const index = mesh.geometry.index!;
  const pos = mesh.geometry.attributes.position;
  const groups = mesh.userData.faces as Uint32Array;
  const k = face * 2;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let area = 0;
  for (let i = groups[k]; i < groups[k] + groups[k + 1]; i += 3) {
    a.fromBufferAttribute(pos, index.getX(i));
    b.fromBufferAttribute(pos, index.getX(i + 1)).sub(a);
    c.fromBufferAttribute(pos, index.getX(i + 2)).sub(a);
    area += b.cross(c).length() / 2;
  }
  return area;
}

/** Picked faces and edges: the accent blue (hover previews are orange). */
const PICKED = 0x2f6bff;

/** The circle the points lie on (within `tol` mm): centre, normal, diameter; else null (a straight or other edge). */
function circleOf(pts: THREE.Vector3[], tol = 0.05) {
  if (pts.length < 4) return null;
  const [a, b, c] = [pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor((2 * pts.length) / 3)]];
  const [ab, ac] = [b.clone().sub(a), c.clone().sub(a)];
  const n = ab.clone().cross(ac);
  if (n.lengthSq() < 1e-12) return null;
  // the circumcentre of a, b, c
  const centre = a.clone().add(n.clone().cross(ab).multiplyScalar(ac.lengthSq()).add(ac.clone().cross(n).multiplyScalar(ab.lengthSq())).divideScalar(2 * n.lengthSq()));
  const r = centre.distanceTo(a);
  const normal = n.normalize();
  return pts.every((p) => Math.abs(p.distanceTo(centre) - r) < tol && Math.abs(p.clone().sub(a).dot(normal)) < tol) ? { centre, normal, d: 2 * r } : null;
}

function faceOf(hit: THREE.Intersection) {
  const groups = hit.object.userData.faces as Uint32Array;
  const at = hit.faceIndex! * 3;
  let k = 0;
  while (k < groups.length && !(at >= groups[k] && at < groups[k] + groups[k + 1])) k += 2;
  return k / 2;
}

/** A line's points, curve handles and arc middles while hovered. */
const HELP_COLOR = 0x8b5cf6;

/** The origin: AxesHelper's lines and colours, thick and over everything. */
function originLines(size = 30, px = 3) {
  const axes = new THREE.AxesHelper(size);
  const geo = new LineSegmentsGeometry().setPositions(axes.geometry.attributes.position.array as Float32Array).setColors(axes.geometry.attributes.color.array as Float32Array);
  axes.dispose();
  const lines = new LineSegments2(geo, new LineMaterial({ vertexColors: true, linewidth: px, depthTest: false, depthWrite: false, transparent: true }));
  lines.renderOrder = 1e6;
  return lines;
}

/** A normals material (for the AO pass) that keeps `m`'s clipping, side and stencil. */
function normalsLike(m: THREE.Material) {
  const n = new THREE.MeshNormalMaterial({ clippingPlanes: m.clippingPlanes, side: m.side });
  for (const k of ['stencilWrite', 'stencilRef', 'stencilFunc', 'stencilFail', 'stencilZFail', 'stencilZPass', 'depthTest', 'depthWrite'] as const) (n as unknown as Record<string, unknown>)[k] = m[k];
  return n;
}

/** Faint (20 % black) diagonal stripes on white, one per tile; tiles seamlessly. */
function hatchTexture(px = 16) {
  const c = Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, px, px);
  g.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  g.lineWidth = px / 6;
  g.beginPath();
  for (const o of [-px, 0, px]) {
    g.moveTo(o, px);
    g.lineTo(o + px, 0);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A move of bodies or sketch shapes. */
interface Drag {
  /** Press point: the wheel's centre. */
  start: THREE.Vector3;
  /** World axes the move may take (bodies: all three; shapes: their plane's two). */
  axes: number[];
  /** Where the first moved item starts: it lands on the snap step. */
  lead: THREE.Vector3;
  /** Shows the items moved by `by` (world). */
  apply(by: THREE.Vector3): void;
  /** Hands the move over (null: puts the items back). */
  end(by: THREE.Vector3 | null): void;
  by: THREE.Vector3;
  /** Per axis, where the press ray passes closest to the axis line through `start`; axis moves count from there. */
  t0: number[];
  /** Alt: free in this plane (bodies: the base plane facing the camera; shapes: their sketch plane). */
  plane: THREE.Plane;
  /** Picked by the drag direction when leaving the wheel's dead zone; null inside it or in the plane. */
  axis: number | null;
  /** A distance typed while dragging, moved exactly along the axis. */
  typed: string | undefined;
  last: PointerEvent | null;
  moved: boolean;
  /** A click on a member of a multi-selection that does not move selects just that one. */
  only: string | null;
}

/** A resize or turn of one sketch shape by its handle. */
interface ShapeEdit {
  sketch: ViewSketch;
  start: DrawnProfile & { id: string };
  handle: Handle;
  q0: [number, number];
  /** Angle of the press around the shape's centre (turning). */
  a0: number;
  /** Sizes typed for the shape's own x / y axis; `axis` takes the digits. */
  typed: (string | undefined)[];
  axis: number;
  last: PointerEvent | null;
  next: DrawnProfile | null;
  /** An arc's middle or a curve handle clicked, not dragged: it follows the pointer and takes typed values until a click or Enter. */
  armed?: boolean;
}

/**
 * Z-up viewport. Dragging a body opens the move fields and moves it along one axis, picked by the drag direction like a
 * weapon wheel (shown at the press point; leaving its dead zone picks the axis, going back through it frees it; typing
 * sets the distance; the step follows the zoom: Shift coarse, Ctrl precise). Clicking a cut face picks its body. Drag the background to orbit, right-drag pans, wheel zooms. The view cube top right turns the camera; clicking a side switches
 * to orthographic until the next rotation. Top left: Ortho / Persp and Fit. A sketch tool takes the pointer while active.
 */
/** A grey matcap: a sphere lit from the upper left, light grey to dark grey. */
function greyMatcap(size = 128) {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = canvas.getContext('2d')!;
  const light = g.createRadialGradient(size * 0.35, size * 0.3, size * 0.05, size / 2, size / 2, size * 0.62);
  light.addColorStop(0, '#d2d2d2');
  light.addColorStop(0.6, '#8f8f8f');
  light.addColorStop(1, '#4a4a4a');
  g.fillStyle = light;
  g.fillRect(0, 0, size, size);
  return Object.assign(new THREE.CanvasTexture(canvas), { colorSpace: THREE.SRGBColorSpace });
}

/** How bodies are drawn: shaded (their materials), grey, lines (each body hides only its own back edges), every line. */
export type ViewMode = 'shaded' | 'grey' | 'lines' | 'wire';
const VIEW_MODES: [ViewMode, string, string][] = [
  ['shaded', 'Shaded', 'Shaded: the bodies in their colours and materials'],
  ['grey', 'Grey', 'Grey: every body plain grey, the shapes alone'],
  ['lines', 'Lines', 'Lines: edges only; each body hides its own back edges, bodies behind others show through'],
  ['wire', 'All lines', 'All lines: every edge, also those behind'],
];

export class Viewer implements ToolView {
  /** The smallest step anything moves in (mm; Settings → General): precise moves (Ctrl) use it. */
  minStep = 0.01;
  /** The smallest step a drawn line turns in (degrees; Settings → General), with Ctrl. */
  minAngle = 0.01;
  /** End faces of extrusions, where sketches can start. */
  /** Visible sketches (world frames) and the selected one with its selected shapes. */
  sketches: ViewSketch[] = [];
  /** `rect`: its rectangle in its own coordinates (u0, v0, u1, v1). */
  workPlanes: { id: string; name: string; frame: Frame; rect: [number, number, number, number] }[] = [];
  private workMark = new THREE.Group();
  private alignMark = new THREE.Group();
  /** The work plane being edited (see `editPlane`), and a side of its rectangle being dragged (0 u0, 1 v0, 2 u1, 3 v1). */
  private planeEdit: { id: string; resize: (rect: [number, number, number, number], done: boolean) => void } | null = null;
  private planeDrag: { side: number; rect: [number, number, number, number] } | null = null;
  private editMark = new THREE.Group();

  /**
   * Editing work plane `id`: `lines` and `points` (world) it was made from marked orange; dragging a side of its
   * rectangle hands the new rectangle (its own coordinates) to `resize` (`done`: let go); null: editing ends.
   */
  editPlane(edit: { id: string; lines: [THREE.Vector3, THREE.Vector3][]; points: THREE.Vector3[]; resize: (rect: [number, number, number, number], done: boolean) => void } | null) {
    this.planeEdit = edit && { id: edit.id, resize: edit.resize };
    this.editMark.traverse((o) => o !== this.editMark && ((o as THREE.Mesh).geometry?.dispose(), ((o as THREE.Mesh).material as THREE.Material)?.dispose()));
    this.editMark.clear();
    this.gripMark = null;
    if (!this.editMark.parent) this.scene.add(this.editMark);
    if (edit?.lines.length) this.editMark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(edit.lines.flat().flatMap((v) => v.toArray())), new LineMaterial({ color: 0xff8c1a, linewidth: 2, depthTest: false })), { renderOrder: 1e6 }));
    if (edit?.points.length) this.editMark.add(Object.assign(marks(edit.points, 0xff8c1a, 9), { renderOrder: 1e6 }));
    this.render();
  }

  /** The grips of the edited plane: its sides' middles (world; side 0 u0, 1 v0, 2 u1, 3 v1). */
  private grips() {
    const w = this.planeEdit && this.workPlanes.find((p) => p.id === this.planeEdit!.id);
    if (!w) return [];
    const [u0, v0, u1, v1] = w.rect;
    const [um, vm] = [(u0 + u1) / 2, (v0 + v1) / 2];
    return [[u0, vm], [um, v0], [u1, vm], [um, v1]].map(([u, v]) => new THREE.Vector3(...toWorld(w.frame, u, v)));
  }

  /** The side whose grip lies within `px` of the pointer (-1: none); while a pick runs, a snap point or edge there goes first. */
  private planeSide(e: MouseEvent, px = 9) {
    const grips = this.grips();
    if (!grips.length || (this.facePick && (this.snapAt(e)?.what ?? 'on face') !== 'on face')) return -1;
    const r = this.el.getBoundingClientRect();
    const d = grips.map((g) => {
      const [x, y] = this.toScreen(g);
      return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y);
    });
    const k = d.indexOf(Math.min(...d));
    return d[k] < px ? k : -1;
  }

  private gripMark: THREE.Object3D | null = null;

  /** The edited plane's grips drawn as green squares, redrawn when they move. */
  private drawGrips() {
    const grips = this.grips();
    const key = grips.map((g) => g.toArray().join()).join(' ');
    if (this.gripMark?.userData.key === key) return;
    if (this.gripMark) {
      const m = this.gripMark as THREE.Points;
      this.editMark.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.gripMark = grips.length ? Object.assign(marks(grips, 0x2fae5a, 11), { renderOrder: 1e6 }) : null;
    if (this.gripMark) (this.gripMark.userData.key = key), this.editMark.add(this.gripMark);
  }

  /** A dragged side follows the pointer on the plane (at least 1 mm from its opposite side). */
  private dragSide(e: MouseEvent) {
    const w = this.workPlanes.find((p) => p.id === this.planeEdit?.id);
    const p = w && planeHit(this.ray(e), w.frame);
    if (!w || !p || !this.planeDrag) return;
    const [u, v] = uvOf(w.frame, p);
    const r = this.planeDrag.rect;
    const side = this.planeDrag.side;
    r[side] = side === 0 ? Math.min(u, r[2] - 1) : side === 2 ? Math.max(u, r[0] + 1) : side === 1 ? Math.min(v, r[3] - 1) : Math.max(v, r[1] + 1);
    this.planeEdit!.resize([...r], false);
  }


  /** The planes an alignment lines objects up on (square to axis `k` at `at`), over `box` and a margin each side: orange, half see-through (none: gone). */
  showAlignPlanes(planes: { k: number; at: number }[], box = new THREE.Box3(), margin = 5) {
    for (const o of this.alignMark.children) ((o as THREE.Mesh).geometry.dispose(), ((o as THREE.Mesh).material as THREE.Material).dispose());
    this.alignMark.clear();
    if (!this.alignMark.parent) this.scene.add(this.alignMark);
    const pad = (c: number) => Math.max(0.1 * (box.max.getComponent(c) - box.min.getComponent(c)), margin);
    for (const { k, at } of planes) {
      const [a, b] = [(k + 1) % 3, (k + 2) % 3];
      const end = (c: number, high: number) => (high ? box.max.getComponent(c) + pad(c) : box.min.getComponent(c) - pad(c));
      const c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => new THREE.Vector3().setComponent(k, at).setComponent(a, end(a, u)).setComponent(b, end(b, v)));
      const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]]), new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color: 0xff8c1a }));
      this.alignMark.add(fill, rim);
    }
    this.render();
  }

  private planeLooks: { id: string; selected: boolean }[] = [];
  /** The work plane hovered in the list: drawn orange (see `lightPlane`). */
  private hotPlane: string | null = null;

  /** The work planes: green, half see-through rectangles with their outlines (a selected one stronger). */
  setWorkPlanes(planes: { id: string; name: string; frame: Frame; rect: [number, number, number, number]; selected: boolean }[]) {
    this.workPlanes = planes;
    this.planeLooks = planes;
    this.drawWorkPlanes();
  }

  /** A work plane hovered in the list: orange for the moment (null: none); off the view, the arrow points to it. */
  lightPlane(id: string | null) {
    this.hotPlane = id;
    this.drawWorkPlanes();
  }

  private drawWorkPlanes() {
    for (const o of this.workMark.children) ((o as THREE.Mesh).geometry.dispose(), ((o as THREE.Mesh).material as THREE.Material).dispose());
    this.workMark.clear();
    for (const p of this.workPlanes.map((w) => ({ ...w, selected: this.planeLooks.find((l) => l.id === w.id)?.selected ?? false }))) {
      const color = p.id === this.hotPlane ? 0xff8c1a : 0x2fae5a;
      const [u0, v0, u1, v1] = p.rect;
      const c = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => new THREE.Vector3(...toWorld(p.frame, u, v)));
      const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]]), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: p.selected ? 0.28 : 0.14, side: THREE.DoubleSide, depthWrite: false }));
      const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color }));
      this.workMark.add(fill, rim);
    }
    this.render();
  }
  activeSketch: string | null = null;
  /** Reference points of shapes (by id; none: the centre), shown on the active sketch's shapes. */
  shapeRefs = new Map<string, [number, number]>();
  overlay = new THREE.Group();
  private sketchView = new THREE.Group();
  private sketchGrid = new THREE.Group();
  private selectedShapes: string[] = [];
  /** Shapes shown changed while they are dragged, before the change is handed over. */
  private overrides = new Map<string, DrawnProfile>();
  /** X / Y / Z typing: where the moved bodies were, with translucent copies there; old shape outlines grey. */
  private moving: { from: Map<string, THREE.Vector3>; carried: Map<string, THREE.Vector3>; ghosts: THREE.Group; looks: THREE.Material[] } | null = null;
  /** A sketch moved across its plane in the move preview: its frame shifts by `by` (world). */
  private shifted: { sketch: string; by: THREE.Vector3 } | null = null;
  private edit: ShapeEdit | null = null;

  private renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, alpha: true }); // alpha: snapshots without background
  private scene = new THREE.Scene();
  private perspective = new THREE.PerspectiveCamera(35, 1, 1, 50000);
  private orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.orthographic;
  private controls = Object.assign(new OrbitControls(this.camera, this.renderer.domElement), { zoomToCursor: true });
  private viewHeight = 400; // orthographic frustum height in mm at zoom 1
  private bodies = new Map<string, THREE.Group>();
  private selection: string[] = [];
  private frame = 0;
  private grid = new THREE.Group();
  private dark = matchMedia('(prefers-color-scheme: dark)');
  private pick: THREE.Ray | null = null; // last click, for Tab cycling
  private hover: PointerEvent | null = null; // the pointer over the view, for Tab cycling
  private downAt = { x: 0, y: 0 };
  private downOnPart = false; // the last press hit a body: its release is no click on empty space
  private drag: Drag | null = null;
  private fitted = false;
  private tool: Tool | null = null;
  private toolPress = false;
  private projection = document.createElement('span');
  /** Shaded, Grey, Lines, All lines: how bodies are drawn (in the view options). */
  private viewModes = document.createElement('select');
  private wheel = axisWheel();
  private wheelPx = 70; // spoke length on screen
  /**
   * The move fields' gizmo: the axis wheel at `at` (world), `axis` strong. A press on it starts the same move as
   * grabbing a body (dead zone, axis by direction, steps), which sets the axes' values (`value` at the press plus the move).
   */
  private gizmo: { at: THREE.Vector3; axis: number | null; value(axis: number): number; set(axis: number, mm: number): void } | null = null;
  private deadPx = 24; // dead zone radius: no axis until the pointer leaves it
  private moveLabel = Object.assign(document.createElement('div'), { className: 'size-label active', hidden: true });
  private facePick: ((face: PickedFace | null) => void) | null = null;
  private quietPick = false;
  /** Where a picking press started (see `clicked`). */
  private clickAt: { x: number; y: number } | null = null;
  private faceMark: THREE.Mesh | null = null;
  /** Picking a face for Extrude: closed sketch shapes count too, and what a click on one pulls is lit here. */
  private pickOutlines = false;
  /** A quiet pick's parts: 'alt': Alt previews and picks an edge or face (see `PickedFace.part`); 'lit': the face or edge a click lands on lit instead of its point (a point along an edge, its middle say, counts as the edge: see `alongEdge`). */
  private pickParts: 'alt' | 'lit' | null = null;
  /** A pick takes work planes too, as faces (see `PickedFace.plane`). */
  private pickPlanes = false;
  private sketchMark = new THREE.Group();
  /** A sketch hovered in the list: its shapes lit. */
  private sketchHover = new THREE.Group();
  private aimMark = new THREE.Group();
  /** The cut tool's cutting surfaces. */
  private cutMark = new THREE.Group();
  /** A tool locked the pointer; the browser freeing it (its Esc) counts as Esc for the tool. */
  private locked = false;
  private escFreed = 0;
  /** Custom section planes; each keeps its positive side. */
  private custom: THREE.Plane[] = [];
  /** The origin: three thick lines (AxesHelper's colours), drawn over everything. */
  private axes = originLines();
  /** Inside a group of its own origin: that origin (world), which grid, origin axes and view cube follow; else none. */
  private groupFrame = new THREE.Matrix4();
  private frameTurn = new THREE.Quaternion();

  /** Move axis `k` (world): X, Y or Z, inside a turned group its own. */
  private axisDir(k: number) {
    return unit(k).applyQuaternion(this.frameTurn);
  }

  /** The move axis (world) closest to the viewing direction: a free drag's plane stands square to it. */
  private facingMove() {
    const look = this.inAxes(this.camera.getWorldDirection(new THREE.Vector3()));
    const k = [look.x, look.y, look.z].map(Math.abs).reduce((best, c, i, all) => (c > all[best] ? i : best), 0);
    return this.axisDir(k);
  }

  /** A world vector in the move axes (inside a turned group: its X / Y / Z). */
  private inAxes(v: THREE.Vector3) {
    return v.clone().applyQuaternion(this.frameTurn.clone().invert());
  }
  /** Points to snap to besides body corners (sphere centres, with their body); selected ones get a mark. */
  private balls: { center: THREE.Vector3; r: number; body: string }[] = [];
  private centres = new THREE.Group();

  /** Visible range per axis in world mm (open ends: ±Infinity), fixed to the origin; inverted shows only what is outside. */
  private sections: Record<Axis, Span> = { x: [-Infinity, Infinity], y: [-Infinity, Infinity], z: [-Infinity, Infinity] };
  /** Called with the bodies' bounding box when it changed (the section sliders span it). */
  onBounds: ((box: THREE.Box3) => void) | null = null;
  private lastBounds = new THREE.Box3();
  private inverted: Record<Axis, boolean> = { x: false, y: false, z: false };
  /** The shown region while sectioned: boxes of [min, max] per axis (mm); empty when not sectioned. */
  private boxes: Span[][] = [];
  /** Per kept region of the section, its clipping planes; the outlines they cut out of the bodies (`cutEdges`, cached). */
  private cutPlanes: THREE.Plane[][] = [];
  private cuts: { lines: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; cut: true }[]; corners: THREE.Vector3[] } | null = null;
  private sectionView = new THREE.Group();
  private hatch = hatchTexture();

  /** Set when a view cube click switched to orthographic; the next rotation switches back to perspective. */
  private autoOrtho = false;
  /** The camera direction before the last flat view (cube side, look at a face or sketch). */
  private angledView: THREE.Vector3 | null = null;
  /** Looking straight at a face or a cube side (a flat view): pulling turns back to `angledView`. */
  private flat = false;
  private cube = document.createElement('div');
  private cubeWrap = document.createElement('div');

  /** One material per body: its colour. */
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private hidden = new Set<string>();
  /** Bodies hidden by their looks; `hidden` also hides tool bodies, except selected ones (outlines). */
  private looksHidden = new Set<string>();
  /** Body edges: their colours per point (see `setBody`). */
  private edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  /** How bodies are drawn (remembered per browser): their materials, all grey, lines (each body hides only its own back edges), or every line. */
  viewMode: ViewMode = VIEW_MODES.some(([m]) => m === localStorage.getItem('makermaker.viewMode')) ? (localStorage.getItem('makermaker.viewMode') as ViewMode) : 'shaded';
  /** Grey: shaded by a grey matcap (light from the upper left), not by the scene's coloured lights, so it stays grey. */
  private greyFill = new THREE.MeshMatcapMaterial({ matcap: greyMatcap(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  /**
   * Lines and every line: no fill (lines: its depth only), the edges and contours as wide lines (`fat`, px) in the
   * theme's line colour (every line: through everything); a plain line is 1 px whatever is asked.
   */
  private noFill = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private lineEdges = new LineMaterial({ color: 0x2a2a2a, linewidth: 1.6 });
  private allEdges = new LineMaterial({ color: 0x2a2a2a, linewidth: 1.6, depthTest: false });
  /** Cutters (tool bodies of cuts): red outlines seen through everything, no fill (still picked by their faces). */
  private cutters = new Set<string>();
  private cutterEdge = new THREE.LineBasicMaterial({ color: 0xe5484d, depthTest: false, transparent: true });
  private ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  /** Ambient occlusion (three's GTAO pass) on or off; its composer is made for the current camera when needed. */
  private ao = {
    on: false,
    composer: null as EffectComposer | null,
    gtao: null as GTAOPass | null,
    /** While sectioned: depth and normals of the cut view, for the AO pass (its own picture would see uncut bodies). */
    gbuffer: null as THREE.WebGLRenderTarget | null,
    /** The pass reads `gbuffer` (else its own picture). */
    external: false,
  };
  /** The light of the view (settings). */
  private sun = new THREE.DirectionalLight();
  private ambient = new THREE.HemisphereLight();
  private looks = new Map<string, Look>();
  /** The photo spheres of the document (data URLs by id), and the one shown: its picture as this camera sees it. */
  private photos = new Map<string, string>();
  private photo: { id: string; texture: THREE.Texture | null; target: THREE.WebGLRenderTarget; drawn: string } | null = null;
  private photoDraw = photoPass();
  /** The view's background (settings): the theme grey, or a gradient from the top to the bottom of the view. */
  private backdrop: Settings['background'] = { mode: 'solid', top: '#ffffff', bottom: '#ffffff', sky: 0, photo: null, turn: 0 };
  /** The gradient background: a column redrawn when the camera tilts (`drawn`: for which tilt and view). */
  private sky = { canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 256 }), texture: null as THREE.CanvasTexture | null, drawn: '' };
  /** Selected bodies get an outline around their silhouette (tool bodies in red): they are drawn into `mask`, then a ring of `px` around it on top. */
  private silhouette = {
    mask: new THREE.WebGLRenderTarget(1, 1, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }),
    nothing: new THREE.Scene(),
    flat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    // covers the screen, whatever the camera sees
    quad: Object.assign(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { mask: { value: null }, texel: { value: new THREE.Vector2() }, width: { value: 3 }, near: { value: 0 }, color: { value: new THREE.Vector3(0, 0xbc / 255, 0xd4 / 255) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        // outside the mask, within `width` px of it: the colour, edges smoothed over half a pixel; a coarse level of
        // the mask (`near`: its blocks over twice that wide) tells most pixels at one look that nothing is that near
        fragmentShader: `uniform sampler2D mask; uniform vec2 texel; uniform float width; uniform float near; uniform vec3 color; varying vec2 vUv;
          void main() {
            if (textureLod(mask, vUv, 0.0).r > 0.5 || textureLod(mask, vUv, near).r <= 0.0) discard;
            float a = 0.0;
            for (int x = -8; x <= 8; x++) for (int y = -8; y <= 8; y++) {
              float d = length(vec2(x, y));
              if (d > width + 0.5 || textureLod(mask, vUv + vec2(x, y) * texel, 0.0).r < 0.5) continue;
              a = max(a, clamp(width + 0.5 - d, 0.0, 1.0));
            }
            if (a <= 0.0) discard;
            gl_FragColor = vec4(color, a);
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    ), { frustumCulled: false }),
    px: 3,
  };
  /** Owner per owned body (a tool body belongs to the body whose boolean uses it): it moves along. */
  private owners = new Map<string, string>();

  constructor(
    readonly el: HTMLElement,
    private host: ViewerHost,
  ) {
    pictureLoaded.add(() => this.render());
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.localClippingEnabled = true;
    const canvas = this.renderer.domElement;
    el.append(canvas, this.viewCube(), this.cameraControls(), this.crumbs, this.moveLabel);

    this.setLight(DEFAULT_LIGHT);
    this.scene.add(this.ambient, this.sun, this.lamp, this.grid, this.axes, this.sectionView, this.sketchView, this.sketchGrid, this.overlay, this.wheel, this.centres, this.edgeMark, this.pickedEdgeMark, this.measureMark, this.sketchMark, this.sketchHover, this.aimMark, this.cutMark, this.axisMark, this.ticks, this.workMark);
    // grid first, then the origin lines over it; neither hides bodies
    this.applyTheme();
    this.dark.addEventListener('change', this.applyTheme);

    // orbiting turns around the selection's middle, else the middle of everything shown (as Blender does): the view does
    // not jump there, the camera only turns around it; each step of the controls is turned around that point
    let orbit: { pivot: THREE.Vector3; target: THREE.Vector3; turn: THREE.Quaternion } | null = null;
    this.controls.addEventListener('start', () => {
      const pivot = this.middleOf(this.selection, this.activeSketch, this.selectedShapes) ?? this.middleOf([...this.bodies.keys()], null, [], true);
      orbit = pivot ? { pivot, target: this.controls.target.clone(), turn: this.camera.quaternion.clone() } : null;
    });
    this.controls.addEventListener('end', () => (orbit = null));
    this.controls.addEventListener('change', () => {
      if (orbit) {
        // the controls turned by `r` around their target (and may have panned): the target turns around the pivot instead
        const r = this.camera.quaternion.clone().multiply(orbit.turn.clone().invert());
        const target = orbit.target.clone().sub(orbit.pivot).applyQuaternion(r).add(orbit.pivot).add(this.controls.target.clone().sub(orbit.target));
        const offset = this.camera.position.clone().sub(this.controls.target);
        this.controls.target.copy(target);
        this.camera.position.copy(target).add(offset);
        orbit = { ...orbit, target: target.clone(), turn: this.camera.quaternion.clone() };
      }
      this.render();
      this.tool?.refresh(); // labels and markers follow the camera
    });
    new ResizeObserver(() => this.resize()).observe(el);
    queueMicrotask(() => this.placeViews()); // the main view alone, until a document brings its views
    // frame the default box now: a first frame looking straight down shows the cube's Front edge-on, and Chrome keeps it unpainted
    this.home(0);

    // capture: runs before the orbit controls, so grabbing a body or drawing does not orbit
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== canvas) return;
        if (e.button === 2) this.rightPress = { x: e.clientX, y: e.clientY };
        if (this.faceMenu) clearTimeout(this.faceMenu), (this.faceMenu = 0);
        // a side of the edited work plane: dragged
        const side = e.button === 0 ? this.planeSide(e) : -1;
        if (side >= 0) {
          this.planeDrag = { side, rect: [...this.workPlanes.find((p) => p.id === this.planeEdit!.id)!.rect] };
          canvas.setPointerCapture(e.pointerId);
          return e.stopPropagation();
        }
        // a double right-click near an edge: its tangent chain (a right-drag still turns the view)
        if (e.button === 2 && !this.tool && !this.focus && this.twice('right', e)) {
          const loop = this.edgeLoop(e);
          if (loop) return this.host.select(loop.body, false), this.pickEdges(loop);
        }
        if (e.button === 0 && this.gizmo && !this.tool && this.onGizmo(e)) return this.dragGizmo(e), e.stopPropagation();
        if (e.button === 0 && (this.facePick || this.tool?.clicks?.())) {
          // picking: a drag turns the view (the orbit controls get this press), a click picks on release
          this.clickAt = { x: e.clientX, y: e.clientY };
          this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
          return;
        }
        if (e.button === 0 && this.edit?.armed) {
          this.endEdit(true);
          this.downOnPart = true;
          return e.stopPropagation();
        }
        if (this.tool?.down(e)) {
          this.toolPress = true;
          canvas.setPointerCapture(e.pointerId);
          e.stopPropagation();
        } else this.down(e);
      },
      { capture: true },
    );
    // the Ctrl preview goes when Ctrl is let go or the pointer leaves the view
    const unpreview = () => !this.tool && !this.facePick && (this.markEdge(), this.markFace());
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      unpreview();
      this.markSketch(null);
      if ((this.helpShape || this.boxHover) && !this.edit) ((this.helpShape = null), (this.boxHover = false), this.renderSketches());
    });
    addEventListener('keyup', (e) => (e.key === 'Control' || e.key === 'Alt') && unpreview());
    canvas.addEventListener('pointermove', (e) => {
      this.hover = e;
      if (!e.buttons) this.hoverRow(e), this.hoverHelp(e);
      if (this.planeDrag) return this.dragSide(e);
      if (this.edit) return this.move(e);
      if (this.planeEdit) canvas.style.cursor = this.planeSide(e) >= 0 ? 'grab' : '';
      if (this.facePick && !this.drag) {
        // a work plane in front: lit orange
        const plane = this.pickPlanes ? this.workPlaneAt(e) : null;
        if ((plane?.id ?? null) !== this.hotPlane) this.lightPlane(plane?.id ?? null);
        if (plane) {
          this.aimAt(null);
          this.markEdge();
          this.markFace();
          this.faceAim?.({ point: plane.point, normal: new THREE.Vector3(...plane.frame.n) });
          return void this.aiming?.({ at: plane.point, what: 'on work plane' });
        }
        if (this.quietPick && this.pickParts === 'lit') {
          // a face or edge lit whole; a snap point as usual
          const a = this.aimAt(e);
          const edge = a && alongEdge(a.what) ? this.edgeAt(e) : null;
          if (edge || a?.what === 'on face') this.aimAt(null);
          this.markEdge(edge?.segs);
          this.markFace(a?.what === 'on face' ? this.frontHit(e) : undefined);
          return void this.aiming?.(a);
        }
        if (this.quietPick && this.pickParts === 'alt' && picksFace(e)) {
          // Alt: the edge (a circle whole), else the face a click would take
          const edge = this.edgeAt(e);
          this.aiming?.(this.aimAt(null));
          this.markEdge(edge ? this.wholeCircle(edge).segs : undefined);
          return this.markFace(edge ? undefined : this.frontHit(e));
        }
        if (this.pickParts) this.markEdge(), this.markFace();
        if (this.quietPick) return void (this.axisHover ? this.axisHover(this.axisAt(e)) : this.aiming?.(this.aimAt(e))); // a gizmo drag moves on
        const hit = this.frontHit(e);
        const s = this.sketchShapeAt(e, hit);
        this.markSketch(s);
        this.faceAim?.(hit && !s ? this.picked(hit) : null);
        return this.markFace(s ? undefined : hit);
      }
      if (!this.tool && !this.drag && !e.buttons) {
        // Ctrl previews (orange) the edge near the pointer, else the face it would pick; picked parts keep their own (blue) marks
        const edge = picksFace(e) ? this.edgeAt(e) : null;
        this.markEdge(edge?.segs);
        this.markFace(!edge && picksFace(e) ? this.frontHit(e) : undefined);
      }
      this.tool?.move(e);
      if (!this.toolPress) this.move(e); // a drag that belongs to a tool is no orbit
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.rightUp(e);
      if (this.planeDrag) return this.planeEdit?.resize([...this.planeDrag.rect], true), (this.planeDrag = null);
      if (this.clickAt) return this.clicked(e);
      if (!this.toolPress) return this.up(e);
      this.toolPress = false;
      this.tool?.up();
    });
    canvas.addEventListener('dblclick', (e) => {
      if (this.tool) return this.tool.dblclick(e);
      if (this.toggleSmooth(e)) return;
      // on a sketch shape: into its sketch group; on a finish face: the whole finish (an edge's tangent chain: a double Alt press, see down)
      const hit = this.frontHit(e);
      const shape = this.shapeAt(this.ray(e), this.focus ? undefined : hit?.distance);
      if (shape) return this.host.enterShape(shape.sketch, shape.shape);
      const f = hit && this.finishAt(hit);
      if (f) this.host.pickFinish({ body: hit.object.userData.bodyId, feature: f.feature, mid: null });
    });
    // right-click on a body: its menu (Ctrl+click on macOS is a right-click too: no menu then, the browser's never)
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = !e.ctrlKey && this.frontHit(e)?.object.userData.bodyId;
      if (id) this.host.bodyMenu(id, e.clientX, e.clientY);
    });
    // scrolling sideways (trackpad) pans sideways, Shift + wheel up and down; plain up and down stays the orbit controls' zoom
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const ppm = this.pixelsPerMm(this.controls.target) / this.speeds.pan;
        // macOS turns Shift + wheel into sideways scrolling
        const by = e.shiftKey ? this.screenDir(0, -1).multiplyScalar((e.deltaY || e.deltaX) / ppm) : this.screenDir(1, 0).multiplyScalar(e.deltaX / ppm);
        this.camera.position.add(by);
        this.controls.target.add(by);
        this.controls.update();
        this.render();
      },
      { capture: true, passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement || !this.locked) return;
      this.locked = false;
      this.escFreed = performance.now();
      this.tool?.key(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    // a move, a face pick or a tool sees keys first (not those typed into fields)
    addEventListener(
      'keydown',
      (e) => {
        // aiming "to object" on a line or circle: A / Shift A split it finer or coarser, the aim follows (also from a field)
        const more = pressed(e, 'moreSnaps');
        if (this.aimKey && this.hover && (more || pressed(e, 'fewerSnaps'))) {
          divideMore(this.aimKey, more);
          const { clientX, clientY } = this.hover;
          this.renderer.domElement.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true }));
          return e.preventDefault(), e.stopPropagation();
        }
        // a running drag takes keys also from the move field it fills
        if (!this.drag?.moved && (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) return;
        // the Esc that freed a locked pointer was already handled
        if (pressed(e, 'cancel') && performance.now() - this.escFreed < 300) return e.preventDefault(), e.stopPropagation();
        const used = this.drag?.moved
          ? this.dragKey(e)
          : this.edit?.next || this.edit?.armed
            ? this.editKey(e)
            : this.facePick
              ? pressed(e, 'cancel') && (this.endFacePick(null), true)
              : this.tool?.key(e);
        if (!used) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true },
    );
  }

  /** The running drawing tool (null: none, or a pull). */
  get activeTool() {
    return this.tool?.kind ?? null;
  }

  /** The drawing tool's next drawing mode (false: it has none). */
  nextDrawMode() {
    return this.tool instanceof SketchTool && this.tool.nextMode();
  }

  /** A drawing tool (`kind`; none: picking a plane); `mode`: sketch mode or plane picking. */
  startTool(kind: ToolKind | null, host: ToolHost, mode?: ToolMode) {
    this.stopTool();
    this.tool = new SketchTool(kind, this, host, mode);
    this.renderer.domElement.classList.add('drawing');
    this.toolButtons(true);
    this.renderSketches(); // no handles while a tool runs
  }

  /** While a tool runs it takes the left button: right-drag turns the view, middle-drag pans. */
  private toolButtons(on: boolean) {
    this.controls.mouseButtons = on
      ? { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  /** The last face clicked on a body (front side), for tools picked after it. */
  lastFace: PickedFace | null = null;
  /** Faces picked with Alt-click (one body), lit until it is no longer selected. */
  /** Faces picked with Alt-click, per body mesh (Shift-Alt: on several bodies). */
  private pickedFaces: { mesh: THREE.Mesh; faces: number[] }[] = [];
  /** Picked faces and edges: lit in the accent blue (an Alt-hover previews in orange). */
  private pickedMarks: THREE.Mesh[] = [];
  private pickedEdgeMark = new THREE.Group();
  /** Edges picked with Alt-click (world segments per edge), lit until their body is no longer selected. */
  private pickedEdge: { body: string; edges: [THREE.Vector3, THREE.Vector3][][] } | null = null;
  private edgeMark = new THREE.Group();
  /** The last press per kind (time, client px), for telling double ones. */
  private presses = new Map<string, { t: number; x: number; y: number }>();

  /** Whether this press is the second of a double one of `kind` (within `ms` and 5 px): counted here, as a Mac sends no dblclick for Ctrl- or right-clicks. */
  private twice(kind: string, e: MouseEvent, ms = 500) {
    const [now, last] = [performance.now(), this.presses.get(kind)];
    const again = !!last && now - last.t < ms && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 5;
    if (again) this.presses.delete(kind);
    else this.presses.set(kind, { t: now, x: e.clientX, y: e.clientY });
    return again;
  }
  /** The open sketch group and sub-group (sketch mode): bodies see-through (except `solid` ones), other shapes faint. */
  private focus: { sketch: string; group: string | null; solid: Set<string> } | null = null;
  private faded = new Map<string, THREE.MeshStandardMaterial>();
  /** Writes see-through bodies' depth first, so they hide each other like solid ones and only the front shows. */
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  private fadedEdges = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2 });
  /** Where in the sketch group the view is: a row under the projection buttons. */
  private crumbs = Object.assign(document.createElement('div'), { className: 'overlay crumbs', hidden: true });
  private lastHit: THREE.Intersection | null = null;

  /**
   * Where a body hit lies on the true surface, and its outward normal there (world): on a kernel plane or cylinder
   * exact (the point moved onto it), else the hit triangle's.
   */
  private onSurface(hit: THREE.Intersection) {
    const face = (hit.object.userData.exact as Exact | null | undefined)?.faces[faceOf(hit)];
    const m = hit.object.matrixWorld;
    if (face?.kind === 'plane') {
      const n = new THREE.Vector3(...face.n).transformDirection(m);
      return { point: new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...face.at).applyMatrix4(m)).projectPoint(hit.point, new THREE.Vector3()), n };
    }
    if (face?.kind === 'cylinder') {
      const [at, dir] = [new THREE.Vector3(...face.at).applyMatrix4(m), new THREE.Vector3(...face.dir).transformDirection(m)];
      const axis = at.clone().addScaledVector(dir, hit.point.clone().sub(at).dot(dir));
      const out = hit.point.clone().sub(axis).normalize();
      return { point: axis.addScaledVector(out, face.r), n: face.shaft ? out : out.negate() };
    }
    return { point: hit.point.clone(), n: hit.face!.normal.clone() };
  }

  /** The outward normal (world) of the body face under the pointer, if any. */
  faceOutHere() {
    const hit = this.hover && this.frontHit(this.hover);
    return hit ? this.onSurface(hit).n.clone() : null;
  }

  private originPreview: LineSegments2 | null = null;

  /** The origin axes at `m` (world; 60 px long on screen) while a group's origin is picked; null: none. */
  previewOrigin(m: THREE.Matrix4 | null) {
    if (!m) return this.originPreview?.removeFromParent(), this.render();
    const o = (this.originPreview ??= Object.assign(originLines(30, 3), { matrixAutoUpdate: false }));
    (o.material as LineMaterial).resolution.set(this.el.clientWidth, this.el.clientHeight);
    const k = 60 / this.pixelsPerMm(new THREE.Vector3().setFromMatrixPosition(m)) / 30;
    o.matrix.copy(m).scale(new THREE.Vector3(k, k, k));
    o.matrixWorldNeedsUpdate = true;
    if (!o.parent) this.scene.add(o);
    this.render();
  }

  /** A body hit as a face pick: its point and the normal into the face (world), on the true surface where the kernel has it. */
  private picked(hit: THREE.Intersection) {
    const { point, n } = this.onSurface(hit);
    return { point, normal: n.negate(), body: hit.object.userData.bodyId as string };
  }

  placeOn(hit: THREE.Intersection) {
    // flat: all normals of the B-rep face agree (a kernel plane: it is)
    const k = faceOf(hit);
    const groups = hit.object.userData.faces as Uint32Array;
    const geo = (hit.object as THREE.Mesh).geometry;
    const index = geo.index!.array.subarray(groups[k * 2], groups[k * 2] + groups[k * 2 + 1]);
    const normal = (v: number) => new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, v);
    const n0 = normal(index[0]);
    const kind = (hit.object.userData.exact as Exact | null | undefined)?.faces[k]?.kind;
    const flat = kind ? kind === 'plane' : index.every((v) => normal(v).dot(n0) > 0.9999);
    return this.host.placeOn(this.picked(hit), flat);
  }

  /**
   * Where something dropped at client point (`x`, `y`) lands: a work plane in front, else a flat face, else the
   * ground; `point`: where on it.
   */
  dropTarget(x: number, y: number): (Omit<Target, 'sketch'> & { point: THREE.Vector3 }) | null {
    const e = { clientX: x, clientY: y } as MouseEvent;
    const hit = this.frontHit(e);
    const w = this.workPlaneAt(e, hit);
    if (w) return { placement: { kind: 'work', plane: w.id }, frame: w.frame, body: null, name: this.workPlanes.find((p) => p.id === w.id)!.name, point: w.point };
    const placed = hit && this.placeOn(hit);
    if (placed) return { ...placed, point: hit!.point.clone() };
    const ground = new THREE.Vector3();
    if (!this.ray(e).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), ground)) return null;
    return { placement: { kind: 'base', axis: 'xy', offset: 0 }, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, body: null, name: 'the ground', point: ground };
  }

  /** The images shown (see `setImages`): where they lie and how big (mm). */
  images: { id: string; frame: Frame; w: number; h: number }[] = [];
  private imageList: { id: string; data: string; frame: Frame; width: number; opacity: number; key: string | null; tolerance: number; selected: boolean }[] = [];
  private imageMark = new THREE.Group();
  /** Pictures as textures, by image and colour key; 'loading' while their file is read. */
  private textures = new Map<string, THREE.Texture | 'loading'>();
  /** The image hovered in the list: outlined orange. */
  private hotImage: string | null = null;

  /** The images: pictures on their planes, see-through as set (a colour key drops a colour); a selected one outlined. */
  setImages(list: Viewer['imageList']) {
    this.imageList = list;
    this.drawImages();
  }

  /** An image hovered in the list: outlined orange for the moment (null: none); off the view, the arrow points to it. */
  lightImage(id: string | null) {
    this.hotImage = id;
    this.drawImages();
  }

  private drawImages() {
    if (!this.imageMark.parent) this.scene.add(this.imageMark);
    this.imageMark.traverse((o) => o !== this.imageMark && ((o as THREE.Mesh).geometry?.dispose(), ((o as THREE.Mesh).material as THREE.Material)?.dispose()));
    this.imageMark.clear();
    this.images = [];
    for (const im of this.imageList) {
      const key = `${im.id}|${im.data.length}|${im.key}|${im.tolerance}`;
      const tex = this.textures.get(key);
      if (!tex) {
        this.textures.set(key, 'loading');
        void this.loadPicture(im, key);
      }
      if (!tex || tex === 'loading') continue;
      const { width, height } = tex.image as { width: number; height: number };
      const h = (im.width * height) / width;
      this.images.push({ id: im.id, frame: im.frame, w: im.width, h });
      const place = new THREE.Matrix4().makeBasis(new THREE.Vector3(...im.frame.x), new THREE.Vector3(...im.frame.y), new THREE.Vector3(...im.frame.n)).setPosition(...im.frame.o);
      const picture = new THREE.Mesh(new THREE.PlaneGeometry(im.width, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: im.opacity, side: THREE.DoubleSide, depthWrite: false }));
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => new THREE.Vector3((u * im.width) / 2, (v * h) / 2, 0));
      const lit = im.id === this.hotImage ? 0xff8c1a : im.selected ? 0x2f80ed : null;
      for (const o of [picture, ...(lit === null ? [] : [new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: lit }))])]) {
        o.matrixAutoUpdate = false;
        o.matrix.copy(place);
        this.imageMark.add(o);
      }
      if (im.selected) this.imageMark.add(Object.assign(marks(corners.map((c) => c.clone().applyMatrix4(place)), 0x2f80ed, 9), { renderOrder: 1e6 }));
    }
    this.render();
  }

  /** A press on a selected image: its corner resizes it, the picture moves it on its plane. True: it took the press. */
  private startImageEdit(e: PointerEvent, ray: THREE.Ray, hit?: THREE.Intersection) {
    const selected = this.imageList.filter((im) => im.selected);
    const r = this.el.getBoundingClientRect();
    for (const im of selected) {
      const shown = this.images.find((x) => x.id === im.id);
      if (!shown) continue;
      const [fx, fy, o] = [new THREE.Vector3(...im.frame.x), new THREE.Vector3(...im.frame.y), new THREE.Vector3(...im.frame.o)];
      const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]].find(([u, v]) => {
        const [x, y] = this.toScreen(o.clone().addScaledVector(fx, (u * shown.w) / 2).addScaledVector(fy, (v * shown.h) / 2));
        return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 9;
      });
      if (corner) return this.startImageScale(e, im.id, corner, shown.h / shown.w), true;
    }
    const at = this.imageAt(e, hit);
    const im = at && selected.find((x) => x.id === at.id);
    if (!im) return false;
    const [fx, fy, from] = [new THREE.Vector3(...im.frame.x), new THREE.Vector3(...im.frame.y), new THREE.Vector3(...im.frame.o)];
    const start = planeHit(ray, im.frame) ?? from.clone();
    const strongest = (v: THREE.Vector3) => [v.x, v.y, v.z].map(Math.abs).reduce((best, c, k, a) => (c > a[best] ? k : best), 0);
    const placed = (by: THREE.Vector3) => from.clone().addScaledVector(fx, by.dot(fx)).addScaledVector(fy, by.dot(fy));
    this.startDrag(e, ray, start, {
      axes: [strongest(fx), strongest(fy)],
      lead: from,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...im.frame.n), start),
      only: null,
      apply: (by) => this.showImageAt(im.id, placed(by)),
      end: (by) => {
        if (by) return this.host.imageDragged(placed(by).sub(from).toArray());
        this.showImageAt(im.id, from);
      },
    });
    return true;
  }

  /** An image shown elsewhere and at another width, for the moment (the document's comes back with `setImages`). */
  private showImageAt(id: string, o: THREE.Vector3, width?: number) {
    this.imageList = this.imageList.map((im) => (im.id === id ? { ...im, width: width ?? im.width, frame: { ...im.frame, o: o.toArray() } } : im));
    this.drawImages();
  }

  /** Drags corner `corner` (±1, ±1) of an image: the opposite one stays (Alt: its middle), its proportions too. */
  private startImageScale(down: PointerEvent, id: string, [u, v]: number[], ratio: number) {
    const im = this.imageList.find((x) => x.id === id)!;
    const [fx, fy, o] = [new THREE.Vector3(...im.frame.x), new THREE.Vector3(...im.frame.y), new THREE.Vector3(...im.frame.o)];
    const n = new THREE.Vector3(...im.frame.n);
    const fixed = o.clone().addScaledVector(fx, (-u * im.width) / 2).addScaledVector(fy, (-v * im.width * ratio) / 2);
    const canvas = this.renderer.domElement;
    canvas.setPointerCapture(down.pointerId);
    this.controls.enabled = false;
    const placed = (e: PointerEvent) => {
      const p = this.pointOnPlane(e, fixed, n) ?? fixed;
      if (role(e, 'centre')) return { width: Math.max(1, 2 * p.clone().sub(o).dot(fx) * u), o: o.clone() };
      const width = Math.max(1, p.clone().sub(fixed).dot(fx) * u);
      return { width, o: fixed.clone().addScaledVector(fx, (u * width) / 2).addScaledVector(fy, (v * width * ratio) / 2) };
    };
    const moved = (e: PointerEvent) => {
      const now = placed(e);
      this.showImageAt(id, now.o, now.width);
    };
    const up = (e: PointerEvent) => {
      canvas.removeEventListener('pointermove', moved);
      canvas.removeEventListener('pointerup', up);
      this.controls.enabled = true;
      const now = placed(e);
      this.host.placeImage(id, now.o.toArray(), now.width);
    };
    canvas.addEventListener('pointermove', moved);
    canvas.addEventListener('pointerup', up);
  }

  /** Dashed guide lines along `x` and `y` through a point (none: gone). */
  showCrossGuides(at: THREE.Vector3 | null, x?: THREE.Vector3, y?: THREE.Vector3, reach = 1e5) {
    for (const o of this.crossGuides.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    this.crossGuides.clear();
    if (!this.crossGuides.parent) this.overlay.add(this.crossGuides);
    for (const d of at ? [x!, y!] : []) {
      const m = new LineMaterial({ color: 0xc14bd6, linewidth: 1, depthTest: false, dashed: true, transparent: true });
      m.resolution.set(this.el.clientWidth, this.el.clientHeight);
      const ends = [at!.clone().addScaledVector(d, -reach), at!.clone().addScaledVector(d, reach)];
      this.crossGuides.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(ends.flatMap((v) => v.toArray())), m).computeLineDistances(), { renderOrder: 1e6 }));
    }
    this.render();
  }
  private crossGuides = new THREE.Group();

  /** How far `px` screen pixels reach at world point `at`, in mm. */
  reachAt(at: THREE.Vector3, px = 8) {
    return px / this.pixelsPerMm(at);
  }

  /** Reads an image's picture into a texture (its colour key made transparent), then draws the images again. */
  private async loadPicture(im: Viewer['imageList'][number], key: string) {
    const img = new Image();
    img.src = im.data;
    try {
      await img.decode();
    } catch {
      return; // not a picture the browser reads: stays 'loading', not shown
    }
    const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    if (im.key) {
      // pixels as near the key colour as the tolerance lets (0–1 of the largest colour distance): see-through
      const [kr, kg, kb] = [1, 3, 5].map((i) => parseInt(im.key!.slice(i, i + 2), 16));
      const px = g.getImageData(0, 0, canvas.width, canvas.height);
      const reach = im.tolerance * Math.sqrt(3 * 255 * 255);
      for (let i = 0; i < px.data.length; i += 4) if (Math.hypot(px.data[i] - kr, px.data[i + 1] - kg, px.data[i + 2] - kb) <= reach) px.data[i + 3] = 0;
      g.putImageData(px, 0, 0);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const [k, t] of this.textures) if (k.startsWith(`${im.id}|`) && k !== key && t !== 'loading') (t.dispose(), this.textures.delete(k));
    this.textures.set(key, tex);
    this.drawImages();
  }

  /** The nearest image under the pointer, in front of any body (`hit`: the body face there); null: none. */
  private imageAt(e: MouseEvent, hit = this.frontHit(e)) {
    const ray = this.ray(e);
    let best: { id: string; d: number } | null = null;
    for (const im of this.images) {
      const p = planeHit(ray, im.frame);
      const d = p?.distanceTo(ray.origin) ?? Infinity;
      if (!p || (hit && d > hit.distance) || (best && d >= best.d)) continue;
      const [u, v] = uvOf(im.frame, p);
      if (Math.abs(u) <= im.w / 2 && Math.abs(v) <= im.h / 2) best = { id: im.id, d };
    }
    return best;
  }

  /** Where shapes go on the face last clicked on a selected body (a face first, then the sketch tool). */
  lastTarget() {
    const hit = this.lastHit;
    return hit && this.selection.includes(hit.object.userData.bodyId) ? this.placeOn(hit) : null;
  }

  /** Drags a value along `n` from `at` (a finish's size). */
  startFacePull(host: ToolHost, n: Vec3, at: THREE.Vector3, onPull: (mm: number, phase: 'live' | 'done' | 'cancel') => void, look: PullLook) {
    this.stopTool();
    this.tool = new FacePullTool(this, host, n, at, onPull, look);
    this.toolButtons(true);
  }


  /** Extrude (E): picks faces and sketch areas, then pulls them (`faces` or areas picked already: at once). */
  startExtrude(host: ToolHost, x: ExtrudeHost, groups: AreaGroup[], faces: FaceItem[], focus?: string) {
    this.stopTool();
    const tool = new ExtrudeTool(this, host, x, groups, faces, focus);
    this.tool = tool;
    this.toolButtons(true);
    this.renderSketches();
    return tool;
  }

  /** The closed sketch shape whose outline is under the pointer, in front of any body; null: none. */
  outlineAt(e: MouseEvent) {
    const s = this.shapeAt(this.ray(e), this.frontHit(e)?.distance);
    const q = s && s.edge < Infinity ? this.sketches.find((k) => k.id === s.sketch)?.shapes.find((x) => x.id === s.shape) : undefined;
    return q && !q.construction && q.kind !== 'line' ? { sketch: s!.sketch, shape: q.id } : null;
  }

  /** The face of a body hit, to pull. */
  /**
   * A body hit as a face (its normal in the world already: see `intersect`); on a kernel plane or cylinder its point
   * moved onto the true surface and its normal the true one (what a pull or a step looks up stays within its tolerance
   * whatever the mesh detail).
   */
  faceItem(hit: THREE.Intersection): FaceItem {
    const mesh = hit.object as THREE.Mesh;
    const { point, n } = this.onSurface(hit);
    return { body: mesh.userData.bodyId, point, n, mesh, index: faceOf(hit), finish: this.finishAt(hit)?.feature, round: this.roundOf(hit) };
  }

  /** The middle of a face (world): its triangles' centres weighed by their areas. */
  faceCentre(f: FaceItem) {
    const mid = (f.mesh.userData.exact as Exact | null | undefined)?.faces[f.index]?.mid;
    if (mid) return new THREE.Vector3(...mid).applyMatrix4(f.mesh.matrixWorld); // the kernel's centre of mass
    const groups = f.mesh.userData.faces as Uint32Array;
    const index = f.mesh.geometry.index!.array;
    const pos = f.mesh.geometry.attributes.position;
    const [sum, a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let total = 0;
    for (let i = groups[f.index * 2]; i + 2 < groups[f.index * 2] + groups[f.index * 2 + 1]; i += 3) {
      [a, b, c].forEach((v, k) => v.fromBufferAttribute(pos, index[i + k]));
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      sum.addScaledVector(a.clone().add(b).add(c), area / 3);
      total += area;
    }
    return sum.divideScalar(total || 1).applyMatrix4(f.mesh.matrixWorld);
  }

  /** Half a face's size along x / y / z (body coordinates). */
  faceHalf(f: FaceItem): [number, number, number] {
    const groups = f.mesh.userData.faces as Uint32Array;
    const index = f.mesh.geometry.index!.array;
    const pos = f.mesh.geometry.attributes.position;
    const box = new THREE.Box3();
    for (let i = groups[f.index * 2]; i < groups[f.index * 2] + groups[f.index * 2 + 1]; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, index[i]));
    return box.getSize(new THREE.Vector3()).multiplyScalar(0.5).toArray();
  }

  /** The face last clicked (null: none). */
  lastFaceItem() {
    return this.lastHit && this.faceItem(this.lastHit);
  }

  /** The edge picked with Alt-click (its first), as a line from its start to its end (world); null: none. */
  pickedEdgeLine() {
    const segs = this.pickedEdge?.edges[0];
    return segs ? { at: segs[0][0].clone(), to: segs[segs.length - 1][1].clone() } : null;
  }

  /** The faces picked with Alt-click, to pull. */
  pickedFaceItems(): FaceItem[] {
    return this.pickedFaces.flatMap(({ mesh, faces }) => {
      const groups = mesh.userData.faces as Uint32Array;
      const index = mesh.geometry.index!.array;
      const pos = mesh.geometry.attributes.position;
      return faces.map((k): FaceItem => {
      // its first triangle: a point and the outward normal (counter-clockwise from outside)
        const [a, b, c] = [0, 1, 2].map((o) => new THREE.Vector3().fromBufferAttribute(pos, index[groups[k * 2] + o]).applyMatrix4(mesh.matrixWorld));
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        return { body: mesh.userData.bodyId, point: a.add(b).add(c).divideScalar(3), n, mesh, index: k, round: this.roundOfFace(mesh, k) };
      });
    });
  }

  /** The face of `body` at a point on it, facing `n` (both in its own coordinates). */
  faceItemAt(body: string, at: Vec3, n: Vec3): FaceItem | null {
    const meshes: THREE.Mesh[] = [];
    this.bodies.get(body)?.traverse((o) => o.userData.faces && meshes.push(o as THREE.Mesh));
    for (const mesh of meshes) {
      const out = new THREE.Vector3(...n);
      const from = new THREE.Vector3(...at).addScaledVector(out, 0.01).applyMatrix4(mesh.matrixWorld);
      const hit = new THREE.Raycaster(from, out.transformDirection(mesh.matrixWorld).negate()).intersectObject(mesh)[0];
      hit?.face?.normal.transformDirection(mesh.matrixWorld); // world, as `intersect` gives it
      if (hit) return this.faceItem(hit);
    }
    return null;
  }

  private faceMarks: THREE.Mesh[] = [];

  /** Lights picked faces (orange) and the hovered one (blue); faces of meshes gone meanwhile are left out. */
  markFaces(picked: FaceItem[], hover: FaceItem | null = null) {
    for (const m of this.faceMarks) this.replaceMark(m, undefined, [], 0);
    const by = new Map<THREE.Mesh, number[]>();
    for (const f of picked) if (f.mesh.parent) by.set(f.mesh, [...(by.get(f.mesh) ?? []), f.index]);
    this.faceMarks = [...by].map(([mesh, faces]) => this.replaceMark(null, mesh, faces, 0xff8c1a)!);
    if (hover?.mesh.parent && !picked.some((f) => f.mesh === hover.mesh && f.index === hover.index)) this.faceMarks.push(this.replaceMark(null, hover.mesh, [hover.index], 0x3b6fd8)!);
  }

  /** The sketch in sketch mode gets a grid on its plane (null: none). */
  setSketchGrid(frame: Frame | null, size = 400, step = 10) {
    for (const o of this.sketchGrid.children) (o as THREE.GridHelper).dispose();
    this.sketchGrid.clear();
    if (frame) {
      const g = new THREE.GridHelper(size, size / step, 0x3b6fd8, 0x3b6fd8);
      Object.assign(g.material, { transparent: true, opacity: 0.25, depthWrite: false });
      g.matrixAutoUpdate = false;
      // the helper lies in its x-z plane
      g.matrix.makeBasis(new THREE.Vector3(...frame.x), new THREE.Vector3(...frame.n), new THREE.Vector3(...frame.y)).setPosition(new THREE.Vector3(...frame.o));
      this.sketchGrid.add(g);
    }
    this.render();
  }

  /** Shows the sketches; `active`: the selected sketch, `shapes`: its selected shapes. */
  setSketches(sketches: ViewSketch[], active: string | null, shapes: string[]) {
    this.sketches = sketches;
    this.activeSketch = active;
    this.selectedShapes = shapes;
    this.overrides.clear();
    this.renderSketches();
    this.rebound();
  }

  /** The section sliders' range: around the bodies and the shown sketches' outlines. */
  private rebound() {
    const bounds = new THREE.Box3();
    for (const g of this.bodies.values()) bounds.expandByObject(g);
    for (const o of this.sketchView.children) if (o.type === 'Line2') bounds.expandByObject(o);
    if (bounds.equals(this.lastBounds)) return;
    this.lastBounds = bounds;
    this.onBounds?.(bounds);
  }

  /** The single selected shape (with its sketch), which gets handles. */
  private handled() {
    const s = this.sketches.find((v) => v.id === this.activeSketch);
    const p = this.selectedShapes.length === 1 ? s?.shapes.find((q) => q.id === this.selectedShapes[0]) : undefined;
    return s && p ? { sketch: s, shape: { ...p, ...this.overrides.get(p.id) } as DrawnProfile & { id: string } } : null;
  }

  /** A double-click on a point of the polygon or line hovered: smooth to sharp, or back. True: it was on one. */
  private toggleSmooth(e: MouseEvent) {
    const r = this.el.getBoundingClientRect();
    const grab = this.handles().find((g) => {
      const [x, y] = this.toScreen(g.world);
      return g.handle.kind === 'point' && Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8;
    });
    if (grab?.handle.kind !== 'point' || (grab.shape.kind !== 'polygon' && grab.shape.kind !== 'line')) return false;
    this.host.setShapes(grab.sketch.id, [{ id: grab.shape.id, profile: smoothToggled(grab.shape, grab.handle.i) }]);
    return true;
  }

  /** Handles of the single selected shape: plane coordinates, screen position, kind. */
  private handles(reachPx = 26) {
    const out: { at: [number, number]; handle: Handle; world: THREE.Vector3; shape: DrawnProfile & { id: string }; sketch: ViewSketch }[] = [];
    const add = (list: { at: [number, number]; handle: Handle }[], h: { sketch: ViewSketch; shape: DrawnProfile & { id: string } }) => {
      for (const { at, handle } of list) out.push({ at, handle, world: new THREE.Vector3(...toWorld(h.sketch.frame, ...at)), ...h });
    };
    const selected = this.handled();
    // a simple line selected shows its two points, hovered or not
    const help = this.helped() ?? (!this.tool && selected && simpleLine(selected.shape) ? selected : null);
    if (help) add(pointHandles(help.shape), help); // first: they win over the box's handles
    const h = this.boxHover ? selected : null;
    if (h) add(this.boxHandles(h, reachPx), h);
    return out;
  }

  private boxHandles(h: { sketch: ViewSketch; shape: DrawnProfile & { id: string } }, reachPx = 26) {
    return handlesOf(h.shape, reachPx / this.pixelsPerMm(new THREE.Vector3(...toWorld(h.sketch.frame, ...centre(h.shape)))));
  }

  /** The pointer is over the selected shape's box or its handles: only then they show and take hold. */
  private boxHover = false;
  private hoverBox(e: MouseEvent) {
    const h = this.handled();
    const r = this.el.getBoundingClientRect();
    const seen = h ? this.boxHandles(h).map(({ at }) => this.toScreen(new THREE.Vector3(...toWorld(h.sketch.frame, ...at)))) : [];
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    const near = 14; // px around the handles
    const over = !!seen.length && x > Math.min(...seen.map((p) => p[0])) - near && x < Math.max(...seen.map((p) => p[0])) + near && y > Math.min(...seen.map((p) => p[1])) - near && y < Math.max(...seen.map((p) => p[1])) + near;
    if (over === this.boxHover) return false;
    this.boxHover = over;
    return true;
  }

  /** The line or polygon of the open sketch under the pointer: its points and curve handles show, for the pointer tool only. */
  private helpShape: string | null = null;
  private helped() {
    const s = this.sketches.find((v) => v.id === this.activeSketch);
    const p = this.tool ? undefined : s?.shapes.find((q) => q.id === this.helpShape);
    return s && p ? { sketch: s, shape: { ...p, ...this.overrides.get(p.id) } as DrawnProfile & { id: string } } : null;
  }

  /** Follows the pointer: stays on a shape while over its outline or one of its handles. */
  private hoverHelp(e: MouseEvent) {
    if (this.tool || this.edit || !this.activeSketch) return;
    if (this.hoverBox(e)) this.renderSketches();
    const r = this.el.getBoundingClientRect();
    const onHandle = this.handles().some((h) => {
      if (h.handle.kind === 'resize' || h.handle.kind === 'rotate') return false;
      const [x, y] = this.toScreen(h.world);
      return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 10;
    });
    if (onHandle) return;
    const at = this.shapeAt(this.ray(e), this.focus ? undefined : this.frontHit(e)?.distance);
    const s = this.sketches.find((v) => v.id === this.activeSketch);
    const q = at && at.sketch === s?.id && at.edge < Infinity ? s.shapes.find((x) => x.id === at.shape) : undefined;
    const id = q && (q.kind === 'line' || q.kind === 'polygon') ? q.id : null;
    if (id !== this.helpShape) ((this.helpShape = id), this.renderSketches());
  }

  /** Sketch outlines (the selected sketch darker, its selected shapes orange) and the handles of a single selected shape. */
  private renderSketches() {
    const onFace = !this.focus; // a sketch group open: outlines over everything, the see-through bodies included
    for (const o of this.sketchView.children) {
      (o as THREE.Line).geometry.dispose();
      ((o as THREE.Line).material as THREE.Material).dispose();
    }
    this.sketchView.clear();
    for (const s of this.sketches) {
      const by = this.shifted?.sketch === s.id ? this.shifted.by : null;
      const frame = by ? { ...s.frame, o: new THREE.Vector3(...s.frame.o).add(by).toArray() } : s.frame;
      for (const p of s.shapes) {
        const color = s.id === this.activeSketch && this.selectedShapes.includes(p.id) ? 0xff8c1a : s.color;
        const q = this.overrides.get(p.id) ?? p;
        const faint = this.focus ? s.id !== this.focus.sketch || !inGroup(s, p, this.focus.group) : !!this.kept && !this.kept.has(s.id); // outside the open (sub-)group, or the selection's group
        if (this.moving && (q !== p || by)) this.sketchView.add(outline(p, s.frame, 0x8a8f98, onFace)); // where it was
        this.sketchView.add(outline(q, frame, color, onFace, 1.5, 2, faint ? 0.25 : 1));
      }
    }
    const refs = this.tool ? [] : this.refMarks();
    const handles = this.tool || this.drag?.moved ? [] : this.handles();
    const resize = handles.filter((h) => h.handle.kind === 'resize').map((h) => h.world);
    const turn = handles.filter((h) => h.handle.kind === 'rotate').map((h) => h.world);
    if (resize.length) this.sketchView.add(marks(resize, 0xff8c1a));
    const points = handles.filter((h) => h.handle.kind === 'point').map((h) => h.world);
    const controls = handles.filter((h) => h.handle.kind === 'control' || h.handle.kind === 'centre');
    if (points.length) this.sketchView.add(marks(points, HELP_COLOR));
    if (controls.length) {
      // each handle on a thin line from the point it pulls at; an arc's middle on its two radii (the handle on the arc: none)
      const h = this.helped()!;
      const q = bakeTurn(h.shape as Extract<DrawnProfile, { pts: [number, number][] }>);
      const on = (k: number) => new THREE.Vector3(...toWorld(h.sketch.frame, ...q.pts[k % q.pts.length]));
      const stems = controls.flatMap(({ handle: c, world }) => (c.kind === 'centre' ? [world, on(c.i), world, on(c.i + 1)] : c.kind !== 'control' || c.which === 'mid' ? [] : [world, on(c.which === 'c1' ? c.i : c.i + 1)]));
      this.sketchView.add(marks(controls.map((c) => c.world), HELP_COLOR, 7), new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stems), new THREE.LineBasicMaterial({ color: HELP_COLOR, depthTest: false })));
    }
    if (turn.length) {
      // the line reaches in to the point the shape turns around (its centre), marked with a ring
      const h = this.handled()!;
      const pivot = new THREE.Vector3(...toWorld(h.sketch.frame, ...centre(h.shape)));
      this.sketchView.add(marks(turn, 0x1d4ed8), marks([pivot], 0x1d4ed8, 9), new THREE.Line(new THREE.BufferGeometry().setFromPoints([pivot, turn[0]]), new THREE.LineBasicMaterial({ color: 0x1d4ed8, depthTest: false })));
    }
    this.sketchView.traverse((o) => (o.renderOrder = o instanceof THREE.Points || o.type === 'Line' || o.type === 'LineSegments' || o.type === 'Line2' ? 1e6 : 0));
    this.refObjs = refs;
    this.addRefs();
    this.render();
  }

  /** The reference marks now in the sketch view: rebuilt each frame, so their arrows keep their size on screen. */
  private refObjs: THREE.Object3D[] = [];

  private addRefs() {
    if (this.refObjs.length) this.sketchView.add(...this.refObjs); // under the handles: a handle on the reference point gets a blue ring
    for (const o of this.refObjs) o.renderOrder = 1e6 - 1;
  }

  /** The reference marks at the current zoom. */
  private drawRefs() {
    if (!this.refObjs.length) return;
    for (const o of this.refObjs as THREE.LineSegments[]) {
      this.sketchView.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.refObjs = this.refMarks();
    this.addRefs();
  }

  /**
   * Blue marks on the reference points of the active sketch's selected shapes (and of shapes measured from
   * elsewhere than their centre), each with an arrow in the direction the shape grows (at the centre a cross of four); the default
   * centre (none picked) only while the pointer is over the selected shape's box (`boxHover`), as its handles.
   */
  private refMarks(arrowPx = 36, headPx = 10, crossPx = 22) {
    const s = this.sketches.find((v) => v.id === this.activeSketch);
    if (!s) return [];
    const points: THREE.Vector3[] = [];
    const lines: THREE.Vector3[] = [];
    for (const q of s.shapes) {
      const picked = this.shapeRefs.get(q.id);
      if (!this.selectedShapes.includes(q.id) || (!this.boxHover && !picked)) continue;
      const ref = picked ?? [0, 0];
      const p = this.overrides.get(q.id) ?? q;
      const [u, v] = anchorAt(p, ref);
      const at = new THREE.Vector3(...toWorld(s.frame, u, v));
      points.push(at);
      // mm per screen px along a direction in the (tilted) plane
      const mm = (d: THREE.Vector3) => {
        const [[x0, y0], [x1, y1]] = [this.toScreen(at), this.toScreen(at.clone().add(d))];
        return 1 / (Math.hypot(x1 - x0, y1 - y0) || 1);
      };
      // off the centre: one arrow towards it; at the centre: a cross of four, along the shape's sides
      const towards = (r: [number, number]) => new THREE.Vector3(...toWorld(s.frame, ...anchorAt(p, r))).sub(at);
      const centred = !ref[0] && !ref[1];
      const dirs = (centred ? ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).map(towards) : [towards([0, 0])]).filter((d) => d.lengthSq() > 1e-12);
      for (const d of dirs) {
        const dir = d.normalize();
        const side = dir.clone().cross(new THREE.Vector3(...s.frame.n));
        const tip = at.clone().addScaledVector(dir, (centred ? crossPx : arrowPx) * mm(dir));
        const back = tip.clone().addScaledVector(dir, -headPx * mm(dir));
        const wing = (headPx / 2) * mm(side);
        lines.push(at, tip, tip, back.clone().addScaledVector(side, wing), tip, back.addScaledVector(side, -wing));
      }
    }
    const arrows = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: 0x1d4ed8, depthTest: false }));
    return points.length ? [marks(points, 0x1d4ed8, 16), arrows] : [];
  }

  /**
   * The visible sketch shape under the pointer, unless a body surface is nearer: the one with the nearest outline
   * within `reachPx`, else the smallest one around the pointer.
   */
  private shapeAt(ray: THREE.Ray, partDistance = Infinity, reachPx = 8) {
    let best: { sketch: string; shape: string; distance: number; edge: number; area: number } | null = null;
    for (const s of this.sketches) {
      const p = planeHit(ray, s.frame);
      if (!p) continue;
      const distance = p.distanceTo(ray.origin);
      if (distance > partDistance + 1e-3 || (best && distance > best.distance + 1e-6)) continue;
      const [u, v] = uvOf(s.frame, p);
      const reach = reachPx / this.pixelsPerMm(p);
      for (const q of s.shapes) {
        if (!nearBox(q, u, v, reach)) continue; // too far to be near or inside
        const d = q.kind === 'circle' ? Math.min(edgeDistance(q, u, v), Math.hypot(u - q.x, v - q.y)) : edgeDistance(q, u, v); // a circle's centre picks it too
        const edge = d <= reach ? d : Infinity; // outside the reach only the inside counts
        if (edge === Infinity && !inside(q, u, v)) continue;
        const a = area(q);
        if (!best || distance < best.distance - 1e-6 || edge < best.edge || (edge === best.edge && a < best.area)) best = { sketch: s.id, shape: q.id, distance, edge, area: a };
      }
    }
    return best;
  }

  /** Picking outlines: the sketch shape (lines too) whose outline is under the pointer, in front of any face; null: none. */
  private sketchShapeAt(e: MouseEvent, hit: THREE.Intersection | undefined): SketchHit | null {
    if (!this.pickOutlines) return null;
    const s = this.shapeAt(this.ray(e), hit?.distance);
    const sketch = s && s.edge < Infinity ? this.sketches.find((k) => k.id === s.sketch) : undefined;
    const q = sketch?.shapes.find((x) => x.id === s!.shape);
    return sketch && q ? { sketch, q } : null;
  }

  /** Lights all shapes of a sketch in orange, a temporary mark (hovering it in the list; null: none). */
  lightSketch(id: string | null) {
    for (const o of this.sketchHover.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    this.sketchHover.clear();
    const s = id ? this.sketches.find((k) => k.id === id) : undefined;
    for (const q of s?.shapes ?? []) this.sketchHover.add(outline(q, s!.frame, 0xff8c1a, false, 1.5, 3));
    this.sketchHover.traverse((o) => (o.renderOrder = 1e6));
    this.render();
  }

  /** Lights the sketch shape a click there picks: its outline, and inside it (a line: only its outline). */
  private markSketch(at: SketchHit | null) {
    for (const o of this.sketchMark.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.sketchMark.clear();
    if (at) {
      const f = at.sketch.frame;
      const shape = at.q.kind === 'line' ? new THREE.Shape() : shape2d(at.q);
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide }));
      fill.matrixAutoUpdate = false;
      fill.matrix.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.n)).setPosition(...f.o);
      this.sketchMark.add(fill, outline(at.q, f, 0xff8c1a, false, 1.5, 4));
      this.sketchMark.traverse((o) => (o.renderOrder = 1e6));
    }
    this.render();
  }

  /**
   * The section's cut face the pointer sees (looking into a body through the cut): the nearest section plane the ray
   * crosses inside the kept region, as a fixed plane facing the camera (x as level as possible); null: none.
   */
  cutPlane(e: MouseEvent): Omit<Target, 'sketch'> | null {
    const ray = this.ray(e);
    let best: { plane: THREE.Plane; d: number } | null = null;
    for (const planes of this.cutPlanes)
      for (const plane of planes) {
        const p = ray.intersectPlane(plane, new THREE.Vector3());
        if (!p || planes.some((o) => o !== plane && o.distanceToPoint(p) < -1e-6)) continue;
        const d = p.distanceTo(ray.origin);
        if (!best || d < best.d) best = { plane, d };
      }
    if (!best) return null;
    const n = best.plane.normal.clone().negate(); // out of the kept side, towards the camera
    const x = new THREE.Vector3(0, 0, 1).cross(n);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const v3 = (v: THREE.Vector3) => v.toArray() as [number, number, number];
    const frame = { o: v3(best.plane.projectPoint(new THREE.Vector3(), new THREE.Vector3())), x: v3(x), y: v3(n.clone().cross(x)), n: v3(n) };
    return { placement: { kind: 'plane', ...frame }, frame, body: null, name: 'the cut' };
  }

  /**
   * The middle of shown bodies `ids` and of sketch `sketch` (its `shapes`, else all of them), or with `all` of every
   * shown sketch too; null: nothing there.
   */
  private middleOf(ids: string[], sketch: string | null, shapes: string[], all = false) {
    const box = new THREE.Box3();
    for (const id of ids) if (!this.hidden.has(id) && !(all && this.cutters.has(id))) box.expandByObject(this.bodies.get(id) ?? new THREE.Object3D());
    for (const s of this.sketches.filter((v) => all || v.id === sketch))
      for (const q of s.shapes.filter((q) => all || !shapes.length || shapes.includes(q.id))) {
        const [x0, y0, x1, y1] = bounds(q);
        for (const [u, v] of [[x0, y0], [x1, y1]]) box.expandByPoint(new THREE.Vector3(...toWorld(s.frame, u, v)));
      }
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }

  /** Looks straight along `n`; `at`: that point moves to the middle of the view. */
  lookAlong(n: THREE.Vector3, at?: THREE.Vector3) {
    // straight up/down is a pole for the orbit controls: tilt a hair towards the front
    this.viewFrom(Math.abs(n.z) > 0.999 ? new THREE.Vector3(0, -1e-3, Math.sign(n.z)) : n.clone(), true, 600, at);
  }

  /** Where the camera looks (world, unit). */
  looking() {
    return this.camera.getWorldDirection(new THREE.Vector3());
  }

  /** Looking straight along `n` (a flat view), turns back to the last angled view: pulling along `n` needs depth to see. */
  unflatten(n: THREE.Vector3) {
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    if (this.angledView && this.flat && Math.abs(look.dot(n)) > 0.95) this.viewFrom(this.angledView, false);
  }

  lockPointer() {
    this.locked = true;
    Promise.resolve(this.renderer.domElement.requestPointerLock()).catch(() => {}); // without the lock it still pulls, up to the screen edge
  }

  unlockPointer() {
    this.locked = false;
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  /** Picking a face: told the face a click would take (null: none); ends with the pick. */
  faceAim: ((face: PickedFace | null) => void) | null = null;

  /** The next click on a body picks a face (null: Esc). */
  /** `quiet`: no face marking or crosshair: clicks are only kept from selecting (a drag still turns the view); `outlines`: sketch shapes clicked by their outline count too; `parts`: see `pickParts`. */
  pickFace(done: (face: PickedFace | null) => void, quiet = false, outlines = false, parts: Viewer['pickParts'] = null, planes = false) {
    this.facePick = done;
    this.quietPick = quiet;
    this.pickOutlines = outlines;
    this.pickParts = parts;
    this.pickPlanes = planes;
    if (!quiet) this.renderer.domElement.classList.add('drawing');
  }

  /** What a click points at (world): a body corner within `cornerPx`, else the nearest point of an edge within 6 px, else the face point; null: empty space. */
  pointAt(e: MouseEvent) {
    return this.snapAt(e)?.at ?? null;
  }

  /**
   * What a click points at (world) and what it is: the nearest point within `px` (a body corner, a sphere's or round
   * edge's centre, a sketch's snap point or one along a straight edge, see `linePoints`), else on the edge within 6 px
   * its middle (within `px` of it) or the nearest point, else the face point; null: empty space.
   */
  private snapAt(e: MouseEvent, px = 10): Aim | null {
    const r = this.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const dist = (p: THREE.Vector3) => {
      const [x, y] = this.toScreen(p);
      return Math.hypot(mx - x, my - y);
    };
    const near = (p: THREE.Vector3) => dist(p) < px;
    const points: Aim[] = [
      ...this.corners().map((at) => ({ at, what: this.balls.some((b) => b.center.equals(at)) ? 'centre' : 'corner' })),
      ...this.edgeCentres().map((at) => ({ at, what: 'centre' })),
      ...linePoints(snapLines(this.sketches, this.edges())).map(({ at, what, key }) => ({ at, what, key })),
    ];
    const point = points.reduce<[Aim | null, number]>((best, p) => (dist(p.at) < best[1] ? [p, dist(p.at)] : best), [null, px])[0];
    const edge = this.edgeAt(e);
    const ref = edge?.index === undefined ? undefined : { body: edge.body, edge: edge.index };
    if (point) return point.what === 'corner' || point.what === 'centre' ? point : { ...point, on: ref };
    // the line A / Shift A split (points along it come from `linePoints` under the same key)
    const key = edge && !edge.cut ? edgeKey(edge.segs) : undefined;
    if (edge) {
      // an open edge's middle, else the edge point nearest the pointer's ray
      const lengths = edge.segs.map(([a, b]) => a.distanceTo(b));
      let half = lengths.reduce((n, l) => n + l, 0) / 2;
      const k = Math.max(0, lengths.findIndex((l) => (half -= l) <= 0));
      const mid = edge.segs[k][0].clone().lerp(edge.segs[k][1], 1 + half / (lengths[k] || 1));
      const open = edge.segs[0][0].distanceTo(edge.segs.at(-1)![1]) > 1e-6;
      if (open && near(mid)) return { at: mid, what: '1/2', on: ref, key };
      const ray = this.ray(e);
      let best: [number, THREE.Vector3] | null = null;
      for (const [a, b] of edge.segs) {
        const p = new THREE.Vector3();
        const d = ray.distanceSqToSegment(a, b, undefined, p);
        if (!best || d < best[0]) best = [d, p];
      }
      return { at: best![1], what: 'on edge', on: ref, key };
    }
    // a sketch's line: a point on it
    const ray = this.ray(e);
    let line: { at: THREE.Vector3; key?: string; d: number } | null = null;
    for (const { segs, shape, curves } of snapLines(this.sketches, []))
      for (const [i, [a, b]] of segs.entries()) {
        const [ax, ay] = this.toScreen(a);
        const [bx, by] = this.toScreen(b);
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const k = len2 ? Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / len2)) : 0;
        const d = Math.hypot(mx - ax - k * (bx - ax), my - ay - k * (by - ay));
        if (d >= 8 || (line && d >= line.d)) continue;
        line = { at: a.clone().lerp(b, k), key: shape?.p.kind === 'circle' ? `circle:${shape.p.id}` : (curves?.[i] ?? sideKey(a, b)), d };
      }
    const hit = this.frontHit(e);
    if (line && (!hit || line.at.distanceTo(ray.origin) < hit.distance + 0.5)) return { at: line.at, what: 'on line', key: line.key };
    return hit ? { at: hit.point.clone(), what: 'on face', on: { body: hit.object.userData.bodyId, face: faceOf(hit) } } : null;
  }

  private truing = false;

  /**
   * Where an aimed point really lies: on the solid's true edge or face, or a sketch's true curve; what the hover showed
   * comes from the triangles. `about`: nothing could tell (a section or crossing line), or the solid is busy for too long.
   */
  private async truePoint(aim: Aim): Promise<{ at: THREE.Vector3; about: boolean }> {
    const ref = aim.on;
    if (!ref) {
      const curve = aim.what === 'corner' || aim.what === 'centre' ? null : this.onSketchCurve(aim.at);
      return { at: curve ?? aim.at, about: !curve && aim.what.startsWith('on edge') };
    }
    const near = this.toBody(ref.body, aim.at).toArray();
    const asked = this.host.askSolids([aim.what === '1/2' && ref.edge !== undefined ? { of: 'middle', body: ref.body, edge: ref.edge, near } : { of: 'point', body: ref.body, edge: ref.edge, face: ref.face, near }]);
    const [found] = await Promise.race([asked, new Promise<MeasureAnswer[]>((done) => setTimeout(() => done([null]), 1500))]);
    if (!Array.isArray(found)) return { at: aim.at, about: !this.host.meshOnly(ref.body) };
    const real = this.fromBody(ref.body, new THREE.Vector3(found[0], found[1], found[2]));
    return real.distanceTo(aim.at) < 0.5 ? { at: real, about: false } : { at: aim.at, about: true };
  }

  /** The point a click at the pointer reaches, from the real geometry (see `truePoint`); null: nothing there. */
  async truePointAt(e: MouseEvent) {
    const aim = this.snapAt(e);
    return aim && (await this.truePoint(aim)).at;
  }

  /** Waiting for "to object" (the move fields): told what a click at the pointer would reach (see `aimAt`). */
  aiming: ((s: Aim | null) => void) | null = null;

  /** The line or circle the aimed point lies on (A / Shift A split it finer or coarser while aiming). */
  private aimKey: string | null = null;

  /** Marks what a click at the pointer reaches ("to object") and returns it (where, and what: 'corner', '1/2' …); null: clears. */
  aimAt(e: MouseEvent | null): Aim | null {
    for (const o of this.aimMark.children) ((o as THREE.Points).geometry.dispose(), ((o as THREE.Points).material as THREE.Material).dispose());
    this.aimMark.clear();
    const s = e && this.snapAt(e);
    this.aimKey = s?.key ?? null;
    if (s) this.aimMark.add(Object.assign(marks([s.at], 0xff8c1a, s.what.startsWith('on ') ? 8 : 12), { renderOrder: 1e6 }));
    // a line split with A: all its points
    if (s?.key && SketchTool.divisions.has(s.key)) {
      const dots = linePoints(snapLines(this.sketches, this.edges())).filter((q) => q.key === s.key).map((q) => q.at);
      if (dots.length) this.aimMark.add(Object.assign(marks(dots, 0xff8c1a, 7), { renderOrder: 1e6 }));
    }
    this.render();
    return s;
  }

  /** Picking an axis (see `pickAxis`): told what a click at the pointer would take. */
  private axisHover: ((a: TurnAxis | null) => void) | null = null;

  /**
   * The next click picks an axis (`show`n while hovering): at a corner or centre the vertical (Z) through it, on a
   * round edge or sketch circle the line through its centre square to it, on a straight edge or sketch line that line,
   * on a face the vertical through that point; null: nothing there, or Esc.
   */
  pickAxis(done: (a: TurnAxis | null) => void, show: (a: TurnAxis | null) => void) {
    let last: TurnAxis | null = null;
    this.axisHover = (a) => show((last = a));
    this.axisHover(this.hover && this.axisAt(this.hover));
    this.pickFace((face) => {
      this.axisHover = null;
      done(face && last);
    }, true);
  }

  /** The axis a click there takes: a corner or centre (Z through it), a body edge, the outline of a sketch shape, a face point (Z). */
  private axisAt(e: MouseEvent): TurnAxis | null {
    const ray = this.ray(e);
    const z = new THREE.Vector3(0, 0, 1);
    const point = this.snapAt(e);
    if (point && (point.what === 'corner' || point.what === 'centre')) return { at: point.at, dir: z, what: `${point.what}: Z through it` };
    const nearest = (segs: [THREE.Vector3, THREE.Vector3][]) => segs.reduce((best, s) => (ray.distanceSqToSegment(...s) < ray.distanceSqToSegment(...best) ? s : best));
    const line = ([a, b]: [THREE.Vector3, THREE.Vector3], what: string) => ({ at: a.clone(), dir: b.clone().sub(a).normalize(), what, length: a.distanceTo(b) });
    const edge = this.edgeAt(e);
    if (edge) {
      // the kernel's circle; a mesh body's: fitted to its segments
      const exact = edge.index === undefined ? null : this.exactEdge(edge.body, edge.index);
      if (exact?.edge.kind === 'circle') return { at: new THREE.Vector3(...exact.edge.c).applyMatrix4(exact.place), dir: new THREE.Vector3(...exact.edge.n).transformDirection(exact.place), what: 'round edge: its centre', d: 2 * exact.edge.r, body: edge.body };
      if (exact?.edge.kind === 'line') return line([new THREE.Vector3(...exact.edge.a).applyMatrix4(exact.place), new THREE.Vector3(...exact.edge.b).applyMatrix4(exact.place)], 'edge');
      const circle = exact ? null : circleOf(edge.segs.flatMap(([a, b]) => [a, a.clone().lerp(b, 0.5)]));
      return circle ? { at: circle.centre, dir: circle.normal, what: 'round edge: its centre', d: circle.d, body: edge.body } : line(nearest(edge.segs), 'edge');
    }
    const s = this.shapeAt(ray, this.frontHit(e)?.distance);
    const sketch = s && s.edge < Infinity ? this.sketches.find((k) => k.id === s.sketch) : undefined;
    const q = sketch?.shapes.find((x) => x.id === s!.shape);
    if (!sketch || !q) return point ? { at: point.at, dir: z, what: 'point: Z through it' } : null;
    const f = sketch.frame;
    if (q.kind === 'circle') return { at: new THREE.Vector3(...toWorld(f, q.x, q.y)), dir: new THREE.Vector3(...f.n), what: 'circle: its centre' };
    // the side nearest: an arc's centre, else the side (a bezier's piece) as a line
    const w = ([u, v]: [number, number]) => new THREE.Vector3(...toWorld(f, u, v));
    const sides = segments(q).flatMap((g) => segPoints(g, 0.01).slice(1).map((b, k, all): [[THREE.Vector3, THREE.Vector3], Seg] => [[w(k ? all[k - 1] : g.a), w(b)], g]));
    const [piece, g] = sides.reduce((best, x) => (ray.distanceSqToSegment(...x[0]) < ray.distanceSqToSegment(...best[0]) ? x : best));
    const arc = g.c && 'mid' in g.c ? arcOf(g.a, g.c.mid, g.b) : null;
    if (arc) return { at: w(arc.c), dir: new THREE.Vector3(...f.n), what: 'arc: its centre', d: 2 * arc.r };
    return line(g.c ? piece : [w(g.a), w(g.b)], q.kind === 'line' ? 'line' : 'side');
  }

  private axisMark = new THREE.Group();

  /** Where the pointer's ray meets the plane through `at` square to `n` (null: parallel to it). */
  pointOnPlane(e: MouseEvent, at: THREE.Vector3, n: THREE.Vector3) {
    return this.ray(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, at), new THREE.Vector3());
  }

  private ticks = new THREE.Group();
  private tickLabel = Object.assign(document.createElement('div'), { className: 'size-label', hidden: true });

  /**
   * A turn's angle as the line tool draws one: the ray towards `from` and the ray turned `angle` degrees around `at`
   * (square to `dir`), an arc `arcPx` out between them and the angle written there; `rays`: the `step`s as orange rays
   * `px` long (fine steps only near the turn), the nearest one longer (null: gone).
   */
  showTicks(t: { at: THREE.Vector3; dir: THREE.Vector3; from: THREE.Vector3; step: number; angle: number; rays?: boolean } | null, px = 46, arcPx = 36) {
    for (const o of this.ticks.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    this.ticks.clear();
    if (!this.tickLabel.isConnected) this.el.append(this.tickLabel);
    this.tickLabel.hidden = !t;
    if (t) {
      const mm = 1 / this.pixelsPerMm(t.at);
      const unit = t.from.clone().sub(t.at).normalize();
      const along = (deg: number, r: number) => t.at.clone().add(unit.clone().applyAxisAngle(t.dir, (deg * Math.PI) / 180).multiplyScalar(r));
      const lines = (pts: THREE.Vector3[], width: number, opacity: number) => {
        const m = new LineMaterial({ color: 0xff8c1a, linewidth: width, depthTest: false, transparent: true, opacity });
        m.resolution.set(this.el.clientWidth, this.el.clientHeight);
        this.ticks.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(pts.flatMap((v) => v.toArray())), m), { renderOrder: 1e6 }));
      };
      const reach = Math.max(t.from.distanceTo(t.at), 2 * arcPx * mm);
      const arc = Array.from({ length: 25 }, (_, k) => along((t.angle * k) / 24, arcPx * mm));
      lines([t.at, along(0, reach), t.at, along(t.angle, reach), ...arc.slice(1).flatMap((p, k) => [arc[k], p])], 1, 0.7);
      if (t.rays) {
        const angles = Array.from({ length: Math.round(360 / t.step) }, (_, k) => k * t.step).filter((a) => t.step >= 5 || Math.abs(((a - t.angle + 540) % 360) - 180) < 12);
        lines(angles.flatMap((a) => [t.at, along(a, px * mm)]), 1, 0.45);
        lines([t.at, along(Math.round(t.angle / t.step) * t.step, 1.6 * px * mm)], 2.5, 0.9);
      }
      const [x, y] = this.toScreen(along(t.angle / 2, 1.8 * arcPx * mm));
      this.tickLabel.textContent = `∠ ${+t.angle.toFixed(2)}°`;
      keepInside(this.tickLabel, x, y);
    }
    this.render();
  }

  private measureLine = new THREE.Group();

  /** The measurement's axes as lines (`key` X, Y, Z), and its orange straight line (L, or the one axis it runs along). */
  private measureLegs: { key: string; a: THREE.Vector3; b: THREE.Vector3; line: LineSegments2 }[] = [];

  /**
   * A measurement: marks at `a` and `b`, between them the straight line in orange and, in the origin's colours, the way along
   * each axis it covers (one axis only: the straight line is that one). Returns those keys, axes first (null: all gone).
   */
  showMeasureLine(a: THREE.Vector3 | null, b: THREE.Vector3 | null = null) {
    for (const o of this.measureLine.children) ((o as THREE.Line).geometry.dispose(), ((o as THREE.Line).material as THREE.Material).dispose());
    this.measureLine.clear();
    this.measureLegs = [];
    if (!this.measureLine.parent) this.scene.add(this.measureLine);
    if (a) this.measureLine.add(Object.assign(marks(b ? [a, b] : [a], 0xff8c1a, 9), { renderOrder: 1e6 }));
    if (a && b) {
      const add = (key: string, from: THREE.Vector3, to: THREE.Vector3, colours?: Float32Array) => {
        const material = new LineMaterial({ ...(colours ? { vertexColors: true } : { color: 0xff8c1a }), depthTest: false, depthWrite: false, transparent: true });
        material.resolution.set(this.el.clientWidth, this.el.clientHeight);
        const line = Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions([...from.toArray(), ...to.toArray()]), material), { renderOrder: 1e6 });
        if (colours) line.geometry.setColors(colours);
        this.measureLine.add(line);
        this.measureLegs.push({ key, a: from, b: to, line });
      };
      const covered = [0, 1, 2].filter((k) => Math.abs(b.getComponent(k) - a.getComponent(k)) >= 1e-4);
      if (covered.length === 1) add('XYZ'[covered[0]], a, b);
      else {
        const helper = new THREE.AxesHelper(1);
        const colours = helper.geometry.attributes.color.array as Float32Array;
        const at = a.clone();
        for (const k of covered) {
          const next = at.clone().setComponent(k, b.getComponent(k));
          add('XYZ'[k], at.clone(), next, colours.slice(k * 6, k * 6 + 6));
          at.copy(next);
        }
        helper.dispose();
        add('L', a, b);
      }
      this.lightMeasureLeg(null);
    }
    this.render();
    return this.measureLegs.map((l) => l.key);
  }

  /** One of the measurement's lines thicker (null: none). */
  lightMeasureLeg(key: string | null) {
    for (const l of this.measureLegs) l.line.material.linewidth = l.key === key ? 3.5 : 1.5;
    this.render();
  }

  /** The measurement's line under the pointer (within `px`; not near its two ends, where a click takes that point as usual); null: none. */
  measureLegAt(e: MouseEvent, px = 7, endPx = 10) {
    const legs = this.measureLegs;
    if (!legs.length) return null;
    const r = this.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const near = (v: THREE.Vector3) => {
      const [x, y] = this.toScreen(v);
      return Math.hypot(mx - x, my - y) < endPx;
    };
    const axes = legs.filter((l) => l.key !== 'L');
    if (near(legs[0].a) || near(axes.at(-1)?.b ?? legs[0].b)) return null;
    let best: string | null = null;
    let nearest = px;
    for (const l of legs) {
      const [ax, ay] = this.toScreen(l.a);
      const [bx, by] = this.toScreen(l.b);
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const k = len2 ? Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / len2)) : 0;
      const d = Math.hypot(mx - ax - k * (bx - ax), my - ay - k * (by - ay));
      if (d < nearest) [best, nearest] = [l.key, d];
    }
    return best;
  }

  private partMarks: THREE.Mesh[] = [];
  private partEdges = new THREE.Group();

  /** Measured parts lit orange: edges (segments, world) and faces; none: cleared. */
  showMeasured(edges: [THREE.Vector3, THREE.Vector3][][], faces: FaceItem[]) {
    for (const m of this.partMarks) this.replaceMark(m, undefined, [], 0);
    this.partMarks = faces.flatMap((f) => this.replaceMark(null, f.mesh, [f.index], 0xff8c1a) ?? []);
    if (!this.partEdges.parent) this.scene.add(this.partEdges);
    this.markEdge(edges.length ? edges.flat() : undefined, this.partEdges);
  }

  /**
   * A face's area (mm²) and, when flat, the smallest rectangle around it along one of its mesh edges: its sides (long,
   * short), corners (world) and long side's direction.
   */
  faceSize(f: FaceItem) {
    const groups = f.mesh.userData.faces as Uint32Array;
    const index = f.mesh.geometry.index!.array;
    const pos = f.mesh.geometry.attributes.position;
    const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, index[i]).applyMatrix4(f.mesh.matrixWorld);
    const pts: THREE.Vector3[] = [];
    for (let i = groups[f.index * 2]; i < groups[f.index * 2] + groups[f.index * 2 + 1]; i++) pts.push(at(i));
    let area = 0;
    const normals: THREE.Vector3[] = [];
    for (let i = 0; i + 2 < pts.length; i += 3) {
      const c = pts[i + 1].clone().sub(pts[i]).cross(pts[i + 2].clone().sub(pts[i]));
      area += c.length() / 2;
      if (c.lengthSq() > 1e-12) normals.push(c.normalize());
    }
    // a kernel face: its area, and flat by its surface with its exact normal; else by the triangles'
    const exact = (f.mesh.userData.exact as Exact | null | undefined)?.faces[f.index];
    if (exact?.area !== undefined) area = exact.area; // see `areaExact` below
    const areaExact = exact?.area !== undefined;
    if (exact && exact.kind !== 'plane') return { area, areaExact };
    const n = exact?.kind === 'plane' ? new THREE.Vector3(...exact.n).transformDirection(f.mesh.matrixWorld) : normals[0];
    if (!n || (!exact && normals.some((m) => m.dot(n) < 0.9999))) return { area, areaExact };
    let best: { u: THREE.Vector3; v: THREE.Vector3; lo: [number, number]; hi: [number, number] } | null = null;
    const size = (b: NonNullable<typeof best>) => (b.hi[0] - b.lo[0]) * (b.hi[1] - b.lo[1]);
    for (let i = 0; i + 1 < pts.length && i < 600; i++) {
      const u = pts[i + 1].clone().sub(pts[i]).projectOnPlane(n); // in the plane (a triangle's side is off it by its float)
      if (u.lengthSq() < 1e-9) continue;
      u.normalize();
      const v = n.clone().cross(u);
      const [us, vs] = [pts.map((p) => p.dot(u)), pts.map((p) => p.dot(v))];
      const box = { u, v, lo: [Math.min(...us), Math.min(...vs)] as [number, number], hi: [Math.max(...us), Math.max(...vs)] as [number, number] };
      if (!best || size(box) < size(best) - 1e-9) best = box;
    }
    if (!best) return { area, areaExact };
    const { u, v, lo, hi } = best;
    const depth = exact?.kind === 'plane' ? new THREE.Vector3(...exact.at).applyMatrix4(f.mesh.matrixWorld).dot(n) : pts[0].dot(n);
    const corners = [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]].map(([a, b]) => u.clone().multiplyScalar(a).addScaledVector(v, b).addScaledVector(n, depth));
    const long = hi[0] - lo[0] >= hi[1] - lo[1];
    return { area, areaExact, sides: [Math.max(hi[0] - lo[0], hi[1] - lo[1]), Math.min(hi[0] - lo[0], hi[1] - lo[1])] as [number, number], corners, x: long ? u : v, n };
  }

  /** An axis drawn dashed in the cut's red (dashes kept on screen at any zoom), `half` mm both ways from the point on it nearest `mid` (null: gone). */
  showAxis(a: TurnAxis | null, mid = new THREE.Vector3(), half = 50) {
    for (const o of this.axisMark.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    this.axisMark.clear();
    if (a) {
      const c = a.at.clone().addScaledVector(a.dir, mid.clone().sub(a.at).dot(a.dir));
      const m = new LineMaterial({ color: 0xe5484d, linewidth: 1.4, depthTest: false, dashed: true });
      m.resolution.set(this.el.clientWidth, this.el.clientHeight);
      const ends = [c.clone().addScaledVector(a.dir, -half), c.clone().addScaledVector(a.dir, half)];
      this.axisMark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(ends.flatMap((v) => v.toArray())), m).computeLineDistances(), { renderOrder: 1e6 }));
    }
    this.render();
  }

  /**
   * The cut tool's cutting surfaces (quads, 4 world corners each, with their outlines; a ball around `at`; with `dir`, a
   * cylinder from `at` `h` mm along it; null: gone): red, half see-through.
   */
  showCut(quads: THREE.Vector3[][] | { at: THREE.Vector3; r: number; dir?: THREE.Vector3; h?: number } | null) {
    for (const o of this.cutMark.children) ((o as THREE.Mesh).geometry.dispose(), ((o as THREE.Mesh).material as THREE.Material).dispose());
    this.cutMark.clear();
    if (quads && !Array.isArray(quads)) {
      const { at, r, dir, h = 0 } = quads;
      const geo = dir ? new THREE.CylinderGeometry(r, r, h, 48) : new THREE.SphereGeometry(r, 48, 24);
      const solid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
      solid.position.copy(at);
      if (dir) solid.position.addScaledVector(dir, h / 2), solid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); // three's cylinder: centred, along y
      this.cutMark.add(solid);
    } else if (quads) {
      const tris = quads.flatMap(([p, q, r, s]) => [p, q, r, p, r, s]);
      const fill = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(tris), new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      const rims = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(quads.flatMap((q) => q.flatMap((v, i) => [v, q[(i + 1) % 4]]))), new THREE.LineBasicMaterial({ color: 0xe5484d }));
      this.cutMark.add(fill, rims);
    }
    this.render();
  }

  /** `aimAt` where the pointer is now (right after "to object" starts, before it moves). */
  aimHere() {
    return this.aimAt(this.hover);
  }

  setCustomSections(planes: { point: Vec3; normal: Vec3 }[]) {
    this.custom = planes.map((p) => {
      const n = new THREE.Vector3(...p.normal).normalize();
      return new THREE.Plane(n, -n.dot(new THREE.Vector3(...p.point)));
    });
    this.applySection();
  }

  stopTool() {
    this.markFace();
    this.tool?.dispose();
    this.tool = null;
    this.toolButtons(false);
    this.toolPress = false;
    this.renderer.domElement.classList.remove('drawing');
    this.renderSketches(); // handles come back
  }

  ray(e: MouseEvent) {
    return this.raycaster(e).ray;
  }

  hit(e: MouseEvent) {
    return this.intersect(this.raycaster(e))[0];
  }

  facing(): BasePlane {
    return (['yz', 'xz', 'xy'] as const)[this.facingAxis()];
  }

  pixelsPerMm(at: THREE.Vector3) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const [x0, y0] = this.toScreen(at);
    const [x1, y1] = this.toScreen(at.clone().add(up));
    return Math.hypot(x1 - x0, y1 - y0) || 1;
  }

  toScreen(p: THREE.Vector3): [number, number] {
    const v = p.clone().project(this.camera);
    return [((v.x + 1) / 2) * this.el.clientWidth, ((1 - v.y) / 2) * this.el.clientHeight];
  }

  get isOrthographic() {
    return this.camera === this.orthographic;
  }

  /** Cosmetic threads' lines: dashed, near black like the edges. */
  private cosmeticMaterial = new THREE.LineDashedMaterial({ color: 0x2a2a2a, dashSize: 0.6, gapSize: 0.4 });

  setBody(id: string, mesh: BodyMesh) {
    const group = this.group(id);
    this.disposeChildren(group);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    if (mesh.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const solid = Object.assign(new THREE.Mesh(geometry), { raycast: fastRaycast });
    // `capped`: the middles of finished edges held at the largest size they take (orange while selected)
    Object.assign(solid.userData, { bodyId: id, faces: mesh.faces, corners: mesh.corners, finishFaces: mesh.finishFaces, finishes: mesh.finishes, exact: mesh.exact, capped: Object.values(mesh.capped).flat().map((c) => c.pts[4]) });
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
    // edges unbaked finishes made are light grey, the rest near black
    const colors = new Float32Array(mesh.edges.length);
    const [dark, light] = [new THREE.Color(0x2a2a2a), new THREE.Color(0xb4b4b4)];
    for (let k = 0; k < mesh.edgeGroups.length; k += 2)
      for (let i = mesh.edgeGroups[k]; i < mesh.edgeGroups[k] + mesh.edgeGroups[k + 1]; i++) colors.set((mesh.finishEdges[k / 2] ? light : dark).toArray(), i * 3);
    edges.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(edges);
    lines.userData.edgeGroups = mesh.edgeGroups;
    lines.userData.exact = mesh.exact; // its edges' curves, by edge group
    group.add(solid, lines);
    if (mesh.cosmetic?.length) {
      // cosmetic threads: dashed, not picked
      const thread = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(mesh.cosmetic, 3)), this.cosmeticMaterial);
      thread.computeLineDistances();
      thread.raycast = () => {};
      group.add(thread);
    }
    this.dress(id);
    this.markCapped();
    if (this.finishSel?.body === id) this.setFinishMark(this.finishSel);
    if (this.stepSel?.body === id) this.setStepMark(this.stepSel);
    this.fitWaiting();
    this.applySection();
  }

  /** While more bodies are coming the first frame waits for them. */
  holdFit(on: boolean) {
    this.fitHeld = on;
    if (!on && this.bodies.size) this.fitWaiting();
  }
  private fitHeld = false;

  private fitWaiting() {
    if (this.fitted || this.fitHeld) return;
    this.fitted = true;
    requestAnimationFrame(() => this.home(0)); // after the other bodies of this batch
  }

  /** Where a body sits in the world: its origin and its turn (from turned groups). */
  /** Places a body; `placed` (once, after all of them) brings the section along. */
  setPlacement(id: string, at: THREE.Vector3, turn: THREE.Quaternion) {
    const g = this.group(id);
    g.quaternion.copy(turn);
    if (!(this.drag?.moved && this.withOwned(this.selection).includes(id))) g.position.copy(at); // not while dragged
    g.updateMatrixWorld();
  }

  /** After `setPlacement`s: the section follows; `rebound` false while animating (the bounds wait). */
  placed(rebound = true) {
    this.applySection(rebound);
  }

  /** Removes bodies that are no longer in the document. */
  retain(ids: Set<string>) {
    for (const [id, group] of this.bodies) {
      if (ids.has(id)) continue;
      this.disposeChildren(group);
      this.scene.remove(group);
      this.bodies.delete(id);
    }
    this.applySection();
  }

  /** `kept`: objects inside a group selected: that group's bodies and sketches; the rest fades (still picked). */
  select(ids: string[], kept: Set<string> | null = null) {
    this.selection = ids;
    this.kept = kept;
    this.rehide();
    const bodies = [...this.pickedFaces.map((p) => p.mesh.userData.bodyId as string), ...(this.pickedEdge ? [this.pickedEdge.body] : [])];
    if (bodies.some((b) => !ids.includes(b))) this.dropPicked();
    for (const id of this.bodies.keys()) this.dress(id);
    this.markCentres();
    this.markCapped();
    this.applySection();
  }

  /** Colour and visibility per body; hidden bodies are not drawn, picked or snapped to (but still built). */
  /** `cutter`: a boolean's tool body, drawn as red outlines (shown while selected even when hidden: join / intersect tools). */
  setLooks(looks: { id: string; look: Look; visible: boolean; cutter: boolean; outlined?: boolean; owner?: string }[]) {
    this.outlinedCutters = new Set(looks.filter((l) => l.outlined).map((l) => l.id));
    this.looksHidden = new Set(looks.filter((l) => !l.visible).map((l) => l.id));
    this.cutters = new Set(looks.filter((l) => l.cutter).map((l) => l.id));
    this.rehide();
    this.owners = new Map(looks.flatMap((l) => (l.owner ? [[l.id, l.owner]] : [])));
    for (const l of looks) {
      this.looks.set(l.id, l.look);
      applyLook(this.materialOf(l.id), l.look, l.look.metalness > 0 ? this.reflected() : null);
      this.dress(l.id);
    }
    this.applySection();
  }

  /** What metal mirrors in this view: a neutral room, made when first needed. */
  private reflected() {
    if (!this.around) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.around = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    return this.around;
  }
  private around: THREE.Texture | null = null;

  /** Tool bodies whose eye is on: their outlines show at all times. */
  private outlinedCutters = new Set<string>();

  /** Tool bodies of booleans show (as outlines) only while selected or with their eye on; the rest as their looks say. */
  private rehide() {
    const shown = (id: string) => this.selection.includes(id) || this.outlinedCutters.has(id);
    this.hidden = new Set([...this.looksHidden, ...this.cutters].filter((id) => !(this.cutters.has(id) && shown(id))));
  }

  /** A body's colour while the colour picker is open (not in the document yet). */
  previewColor(id: string, color: string) {
    this.materialOf(id).color.set(color);
    this.render();
  }

  /** Materials of a body: its colour, or a cutter's red edges. */
  private dress(id: string) {
    const [solid, lines] = this.bodies.get(id)?.children ?? [];
    if (!solid) return;
    const look = this.looks.get(id);
    if (look && needsUv(look)) boxUv((solid as THREE.Mesh).geometry);
    const cutter = this.cutters.has(id);
    const dropped = !cutter && this.dropped.has(id);
    const missed = !cutter && this.missed.has(id);
    // outside a sketch's focus or a group's objects: as the settings have it
    const around = this.focus ? this.surroundings.sketch : this.surroundings.group;
    const outside = !cutter && around !== 'none' && (this.focus ? !this.focus.solid.has(id) : !!this.kept && !this.kept.has(id));
    const faded = dropped || missed || outside;
    const mode = this.viewMode;
    const fill = mode === 'lines' ? this.depthOnly : mode === 'wire' ? this.noFill : mode === 'grey' ? this.greyFill : this.materialOf(id);
    (solid as THREE.Mesh).material = cutter ? this.ghost : dropped ? this.droppedFill : faded ? this.fadedOf(id) : fill;
    (lines as THREE.LineSegments).material = cutter ? this.cutterEdge : faded ? this.fadedEdges : this.edgeMaterial; // selected: a red silhouette
    lines.visible = cutter || faded || (mode !== 'lines' && mode !== 'wire'); // line modes: its wide copy instead (`drawContours`)
    // reduced opacity (and the cut tool): see-through bodies hide each other, their depth drawn before the see-through
    // colours (sections and picking skip it); x-ray shows what lies inside
    const hides = faded && (dropped || missed || around === 'dim');
    const g = this.bodies.get(id)!;
    let depth = g.children.find((c) => c.userData.depth);
    if (hides && !depth) {
      depth = Object.assign(new THREE.Mesh((solid as THREE.Mesh).geometry, this.depthOnly), { raycast: () => {} });
      Object.assign(depth.userData, { depth: true, outline: true });
      g.add(depth);
    }
    if (depth) depth.visible = hides;
    lines.renderOrder = cutter ? 1e5 : 0;
    this.glowLamp(g, look, cutter);
  }

  /** A glowing body lights its neighbours (`glowLight`, from its middle); under the standard light none do. */
  private glowLamp(g: THREE.Group, look: Look | undefined, cutter: boolean) {
    let lamp = g.children.find((c): c is THREE.PointLight => c instanceof THREE.PointLight);
    if (!look?.glowStrength || cutter || !this.glowsLight) return lamp?.removeFromParent();
    if (!lamp) g.add((lamp = new THREE.PointLight()));
    const { center, radius } = sphereOf((g.children[0] as THREE.Mesh).geometry);
    glowLight(look, radius, lamp).position.copy(center);
  }

  private dropped = new Set<string>();
  private surroundings: Settings['surroundings'] = { group: 'xray', sketch: 'dim' };

  /** How the rest looks around a group's objects and a sketch (see `Settings`). */
  setSurroundings(s: Settings['surroundings']) {
    this.surroundings = s;
    for (const id of this.bodies.keys()) this.dress(id);
    this.render();
  }
  private missed = new Set<string>();
  private kept: Set<string> | null = null;
  private droppedFill = new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.7, transparent: true, opacity: 0.35, depthWrite: false });

  /** Bodies `ids` see-through in the cut's red (to be deleted), `missed` faded (the cut leaves them as they are), the others as they are. */
  setDropped(ids: string[], missed: string[] = []) {
    this.dropped = new Set(ids);
    this.missed = new Set(missed);
    for (const id of this.bodies.keys()) this.dress(id);
    this.render();
  }

  /** Bodies a body takes along when it moves: a joint's parts, an attach's others (set by the host). */
  carried = new Map<string, string[]>();

  /** `ids` and the bodies they own or take along, all the way down. */
  private withOwned(ids: string[]) {
    const out = [...ids];
    for (let i = 0; i < out.length; i++) {
      for (const [owned, owner] of this.owners) if (owner === out[i] && !out.includes(owned)) out.push(owned);
      for (const c of this.carried.get(out[i]) ?? []) if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  /** A body's colour, see-through: drawn behind an open sketch group. */
  private fadedOf(id: string, opacity = 0.35) {
    let m = this.faded.get(id);
    if (!m) this.faded.set(id, (m = new THREE.MeshStandardMaterial({ roughness: 0.7, transparent: true, opacity, depthWrite: false })));
    const bumpy = !!m.normalMap;
    m.copy(this.materialOf(id));
    if (bumpy !== !!m.normalMap) m.needsUpdate = true;
    m.setValues({ transparent: true, opacity, depthWrite: false });
    return m;
  }

  /**
   * Sketch mode inside sketch group `focus.sketch`, sub-group `focus.group` (null: none open): bodies and other shapes
   * faint; `crumbs` shows the way down with a hover text each (clicking one goes there, `go(level)`).
   */
  setFocus(focus: { sketch: string; group: string | null; solid: Set<string> } | null, crumbs: { label: string; title: string }[] = [], go: (level: number) => void = () => {}) {
    this.focus = focus;
    this.crumbs.hidden = !crumbs.length;
    this.crumbs.replaceChildren(
      ...crumbs.flatMap(({ label, title }, i) => [
        ...(i ? [Object.assign(document.createElement('span'), { className: 'sep', textContent: '›' })] : []),
        Object.assign(document.createElement('button'), { textContent: label, className: i === crumbs.length - 1 ? 'here' : '', title, onclick: () => go(i) }),
      ]),
    );
    for (const id of this.bodies.keys()) this.dress(id);
    this.renderSketches();
  }

  private materialOf(id: string) {
    let m = this.materials.get(id);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0xd8c3a0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      this.materials.set(id, m);
    }
    return m;
  }

  /** Shows only `from` to `to` (world mm, ±Infinity: open) along `axis`; inverted: only what is outside. */
  setSection(axis: Axis, from: number, to: number, inverted: boolean) {
    this.sections[axis] = [from, to];
    this.inverted[axis] = inverted;
    this.applySection();
  }

  /** Frames everything again once the next geometry arrives (new or opened document). */
  fitNext() {
    this.fitted = false;
  }

  /** Tab: selects the next (`step` 1) or previous body or work plane under the pointer (outside the view: along the last click). */
  cycle(step: number) {
    const ray = this.hover ? this.ray(this.hover) : this.pick;
    if (!ray) return;
    const bodies = this.intersect(new THREE.Raycaster(ray.origin, ray.direction)).map((h) => ({ id: h.object.userData.bodyId as string, d: h.distance }));
    const ids = [...new Set([...bodies, ...this.planesOn(ray)].sort((a, b) => a.d - b.d).map((h) => h.id))];
    if (!ids.length) return;
    let i = ids.findIndex((id) => this.selection.includes(id));
    if (i < 0) i = -step; // none of them selected: start at the nearest
    this.host.select(ids[(i + step + ids.length) % ids.length], false);
  }

  /** The screen direction (`x` right, `y` up) in the world. */
  screenDir(x: number, y: number) {
    return new THREE.Vector3(x, y, 0).applyQuaternion(this.camera.quaternion);
  }

  /** The world axis nearest to the screen direction (`x` right, `y` up), e.g. for arrow-key nudging. */
  screenAxis(x: number, y: number) {
    const v = this.screenDir(x, y);
    const bodies = [v.x, v.y, v.z];
    const i = bodies.reduce((best, c, k) => (Math.abs(c) > Math.abs(bodies[best]) ? k : best), 0);
    return new THREE.Vector3().setComponent(i, Math.sign(bodies[i]));
  }

  /** Switches the camera and keeps the framing: the orthographic zoom matches the perspective view height at the target. */
  setOrthographic(on: boolean) {
    if (on === this.isOrthographic) return;
    const target = this.controls.target;
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    const from = this.camera;
    const to = on ? this.orthographic : this.perspective;
    to.quaternion.copy(from.quaternion);
    if (on) {
      to.position.copy(from.position);
      this.orthographic.zoom = this.viewHeight / (from.position.distanceTo(target) * k);
    } else {
      const dist = this.viewHeight / this.orthographic.zoom / k;
      to.position.copy(from.position).sub(target).setLength(dist).add(target);
    }
    to.updateProjectionMatrix();
    this.camera = to;
    this.dropComposer();
    this.controls.object = to;
    this.controls.update();
    this.projection.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === on));
    this.render();
  }

  /** All bodies' box (a default one when there are none). */
  private allBox() {
    const box = new THREE.Box3();
    for (const g of this.bodies.values()) box.expandByObject(g);
    return box.isEmpty() ? box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 20)) : box;
  }

  /** Fit (F): the camera keeps its direction and the point it looks at, and glides back or forth (zooms, in ortho) until all bodies are in view. */
  fit() {
    this.frameAll(this.controls.target.clone(), this.camera.quaternion.clone());
  }

  /** Home (H): all bodies framed from the front-right corner (`ms`: how long the camera glides there; 0: at once). */
  home(ms = 600) {
    // seen from the front-right corner: 45° around the vertical axis, ~40° above the horizon
    const dir = new THREE.Vector3(1.1 * Math.SQRT1_2, -1.1 * Math.SQRT1_2, 0.9).normalize();
    this.leaveSideView(); // a corner: the cube's arrows go, a side's own ortho too
    this.upright();
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), this.camera.up));
    this.frameAll(this.allBox().getCenter(new THREE.Vector3()), turn, ms);
  }

  /**
   * Glides the camera (both, ortho and perspective; `ms` long, as views turn) to look at `target` turned as `turn`,
   * so far back (ortho: zoomed so) that all bodies are in view with a `margin`.
   */
  private frameAll(target: THREE.Vector3, turn: THREE.Quaternion, ms = 600, margin = 1.1, box = this.allBox()) {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(turn); // towards the camera
    const inverse = turn.clone().invert();
    const aspect = this.el.clientHeight ? this.el.clientWidth / this.el.clientHeight : 1;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    // the box corners in the camera's axes, from the point looked at (z: towards the camera)
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target).applyQuaternion(inverse));
    const height = 2 * margin * Math.max(...corners.map((v) => Math.max(Math.abs(v.y), Math.abs(v.x) / aspect)));
    // perspective: far enough back that every corner lies inside the view's cone; ortho: only clear of the box
    const dist = Math.max(...corners.map((v) => v.z + (margin * Math.max(Math.abs(v.y), Math.abs(v.x) / aspect)) / tan));
    const ends = [Math.max(dist, box.getSize(new THREE.Vector3()).length()), dist];
    const cams = [this.orthographic, this.perspective];
    const t0 = this.controls.target.clone();
    const from = cams.map((c) => ({ off: c.position.clone().sub(t0), q: c.quaternion.clone() }));
    const h0 = this.viewHeight / this.orthographic.zoom; // the same picture at zoom 1
    this.orthographic.zoom = 1;
    const start = performance.now();
    const step = (now: number) => {
      const t = ms ? Math.min(1, (now - start) / ms) : 1;
      const k = t * t * (3 - 2 * t);
      this.controls.target.lerpVectors(t0, target, k);
      cams.forEach((c, i) => {
        // the direction turns along an arc, the distance and the turn ease over
        const u0 = from[i].off.lengthSq() > 1e-12 ? from[i].off.clone().normalize() : dir; // a camera still on its target (at load): no turn
        const u = u0.clone().applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(u0, dir), k));
        c.position.copy(this.controls.target).addScaledVector(u, from[i].off.length() + (ends[i] - from[i].off.length()) * k);
        c.quaternion.slerpQuaternions(from[i].q, turn, k);
      });
      this.viewHeight = h0 + (height - h0) * k;
      this.updateFrustums(aspect);
      if (t < 1) {
        this.controls.dispatchEvent({ type: 'change' }); // renders, tools follow
        requestAnimationFrame(step);
      } else (this.controls.update(), this.render());
    };
    step(start);
  }

  /**
   * Only bodies `ids`, framed, seen from direction `from` (towards the camera), as a snapshot; the view is put back.
   */
  async snapshotOf(ids: string[], from: [number, number, number]) {
    const state = this.cameraState();
    const hidden = [...this.bodies].filter(([id, g]) => !ids.includes(id) && g.visible);
    hidden.forEach(([, g]) => (g.visible = false));
    const box = new THREE.Box3();
    for (const id of ids) {
      const g = this.bodies.get(id);
      if (g) box.expandByObject(g);
    }
    const pole = Math.abs(from[2]) > 0.999;
    const dir = pole ? new THREE.Vector3(0, -1e-3, Math.sign(from[2])).normalize() : new THREE.Vector3(...from);
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), this.camera.up));
    this.frameAll(box.getCenter(new THREE.Vector3()), turn, 0, 1.15, box);
    const image = await this.snapshot(2);
    hidden.forEach(([, g]) => (g.visible = true));
    this.setCameraState(state);
    this.render();
    return image;
  }

  /**
   * The bodies as a PNG on a transparent background, `scale` times the screen resolution, with ambient occlusion if it
   * is on: no grid, origin, sketches, cutters or selection.
   */
  async snapshot(scale = 1): Promise<Blob> {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    const cutters = [...this.cutters].flatMap((id) => this.bodies.get(id) ?? []);
    const helpers = [this.grid, this.axes, this.sketchView, this.sketchGrid, this.overlay, this.wheel, this.centres, this.faceMark, ...this.pickedMarks, this.edgeMark, this.pickedEdgeMark, this.measureMark, this.sketchMark, this.sketchHover, this.finishMark, ...cutters].filter((o) => o?.visible) as THREE.Object3D[];
    const selection = this.selection;
    helpers.forEach((o) => (o.visible = false));
    this.select([]);
    const background = this.scene.background;
    this.scene.background = null;
    this.renderer.setPixelRatio(ratio * scale);
    this.renderer.setSize(size.x, size.y, false);
    if (this.ao.on) {
      // with ambient occlusion: a composer at this size, twice (its first frame has no occlusion yet)
      this.dropComposer();
      for (let i = 0; i < 2; i++) this.renderAO();
    } else this.renderer.render(this.scene, this.camera);
    // read back right after drawing: the buffer is cleared later
    const blob = await new Promise<Blob | null>((done) => this.renderer.domElement.toBlob(done, 'image/png'));
    this.dropComposer(); // back to the screen's size
    this.scene.background = background;
    helpers.forEach((o) => (o.visible = true));
    this.select(selection);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    this.render();
    return blob!;
  }

  /** A small snapshot, `width` px wide. */
  thumbnail(width = 320) {
    return this.snapshot(width / this.renderer.domElement.width);
  }

  /** Spheres (world): their centres snap; a selected sphere's shows a small mark. */
  setSpheres(balls: { center: THREE.Vector3; r: number; body: string }[]) {
    this.balls = balls;
    this.markCentres();
  }

  private markCentres() {
    const points = this.balls.filter((b) => this.selection.includes(b.body)).map((b) => b.center);
    for (const o of this.centres.children) ((o as THREE.Points).geometry.dispose(), ((o as THREE.Points).material as THREE.Material).dispose());
    this.centres.clear();
    if (points.length) this.centres.add(marks(points, 0x6b6b6b, 6));
    this.centres.traverse((o) => (o.renderOrder = 1e6));
    this.render();
  }

  /** The camera now, for rendering the same picture later; the picture is `scale` times the view's size. */
  cameraState(scale = 2): CameraState {
    const size = this.renderer.getSize(new THREE.Vector2()).multiplyScalar(scale);
    return {
      ortho: this.isOrthographic,
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      up: this.camera.up.toArray(),
      fov: this.perspective.fov,
      height: this.viewHeight / this.orthographic.zoom,
      size: [Math.round(size.x), Math.round(size.y)],
    };
  }

  /** Turns the view to a saved camera (its picture size aside). */
  setCameraState(state: CameraState) {
    this.setOrthographic(state.ortho);
    this.controls.target.set(...state.target);
    this.camera.position.set(...state.position);
    if (state.ortho) {
      this.orthographic.zoom = this.viewHeight / state.height;
      this.orthographic.updateProjectionMatrix();
    }
    this.controls.update();
    this.leaveSideView();
    this.render();
  }

  /** A path traced picture (`samples` passes) from a saved camera: shown bodies only, cutters and overlays left out. */
  async renderNice(camera: CameraState, background: Backdrop, light: Light, haze: { haze: number; fog: number }, samples: number, watch: RenderWatch) {
    const meshes: THREE.Mesh[] = [...this.bodies].flatMap(([id, g]) => {
      const solid = g.children[0] as THREE.Mesh | undefined;
      if (!solid || this.hidden.has(id) || this.cutters.has(id)) return [];
      const look = this.looks.get(id) ?? toLook(plainLook('#d8c3a0'));
      const m = new THREE.Mesh(solid.geometry, renderMaterial(look));
      // a glowing one lights what is around from its middle, as in the 3D view
      const lit = look.render ?? look;
      if (lit.glowStrength > 0) {
        const { center, radius } = sphereOf(solid.geometry);
        const lamp = glowLight(lit, radius);
        lamp.position.copy(center);
        m.add(lamp);
      }
      m.applyMatrix4(g.matrixWorld);
      return [m];
    });
    // images as they lie, lit like the rest
    for (const o of this.imageMark.children) {
      if (!(o instanceof THREE.Mesh)) continue;
      const { map, opacity } = o.material as THREE.MeshBasicMaterial;
      const m = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ map, opacity, transparent: true, roughness: 1, side: THREE.DoubleSide }));
      m.applyMatrix4(o.matrix);
      meshes.push(m);
    }
    const url = background.photo && this.photos.get(background.photo.id);
    const photo = url ? { image: await loadImage(url), turn: background.photo!.turn } : null;
    return pathTraced(meshes, cameraFrom(camera), ...camera.size, background, light, haze, photo, Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), samples, watch);
  }

  /** The camera's tilt and half field of view (ortho: as the perspective camera would see it), for the sky. */
  private tilt() {
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    return { pitch: Math.asin(THREE.MathUtils.clamp(look.z, -1, 1)), tanHalf: Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)) };
  }

  /** Redraws the gradient background when the camera tilted. */
  private drawSky() {
    const backdrop = this.backdropColours();
    if (backdrop.photo) return this.drawPhoto(backdrop.photo.turn);
    if (backdrop.stops.length < 2 || !this.sky.texture) return;
    const { pitch, tanHalf } = this.tilt();
    const key = `${pitch.toFixed(3)} ${tanHalf}`;
    if (key === this.sky.drawn) return;
    this.sky.drawn = key;
    drawSky(this.sky.canvas.getContext('2d')!, 1, 256, pitch, tanHalf, backdrop);
    this.sky.texture.needsUpdate = true;
  }

  /** Redraws the photo sphere when the camera turned or the view changed size. */
  private drawPhoto(turn: number) {
    const p = this.photo;
    if (!p?.texture) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const key = `${this.camera.quaternion.toArray().map((v) => v.toFixed(4))} ${size.x} ${size.y} ${turn}`;
    if (key === p.drawn) return;
    p.drawn = key;
    p.target.setSize(size.x, size.y);
    this.camera.updateMatrixWorld();
    this.renderer.setRenderTarget(p.target);
    this.photoDraw.draw(this.renderer, p.texture, this.camera, size.x / size.y, turn);
    this.renderer.setRenderTarget(null);
  }

  /** The document's photo spheres; the background follows when the one it shows comes or goes. */
  setPhotos(photos: { id: string; data: string }[]) {
    const before = this.backdropColours().photo?.id;
    this.photos = new Map(photos.map((p) => [p.id, p.data]));
    if (before !== this.backdropColours().photo?.id) this.applyTheme();
  }

  /** The photo sphere shown; its picture loads once. */
  private showPhoto(id: string) {
    if (this.photo?.id === id) return this.photo;
    this.dropPhoto();
    const p = (this.photo = { id, texture: null as THREE.Texture | null, target: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }), drawn: '' });
    void loadImage(this.photos.get(id)!).then((image) => {
      if (this.photo !== p) return;
      p.texture = photoTexture(image);
      this.render();
    });
    return p;
  }

  private dropPhoto() {
    this.photo?.texture?.dispose();
    this.photo?.target.dispose();
    this.photo = null;
  }

  /** The lights that go by the camera, where it is now. */
  private aimLights() {
    const toCamera = this.camera.position.clone().sub(this.controls.target).normalize().toArray();
    const { sun, camera } = lightDirections(this.lightNow, toCamera);
    this.sun.position.set(...sun);
    this.lamp.position.set(...camera);
  }
  private lightNow = DEFAULT_LIGHT;
  private lamp = new THREE.DirectionalLight();
  private glowsLight = true;

  /** The sun, the light from all around and the camera's light in the view; `glows`: glowing bodies light others. */
  setLight(l: Light, glows = true) {
    this.lightNow = l;
    if (glows !== this.glowsLight) {
      this.glowsLight = glows;
      for (const id of this.bodies.keys()) this.dress(id);
    }
    this.aimLights();
    this.lamp.intensity = l.cameraOn ? l.cameraLight : 0;
    this.sun.color.set(l.sunColor);
    this.sun.intensity = l.sun;
    this.ambient.color.set(l.ambientColor);
    this.ambient.groundColor.set(l.ambientColor).multiplyScalar(0.53);
    this.ambient.intensity = l.ambient;
    this.render();
  }

  /** The ambient occlusion composer for the current camera (stencil kept for the section caps). */
  private aoComposer() {
    if (this.ao.composer) return this.ao.composer;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, stencilBuffer: true, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(...this.renderer.getSize(new THREE.Vector2()).toArray());
    composer.addPass(new RenderPass(this.scene, this.camera));
    const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 15, thickness: 15, scale: 1.6, samples: 16 }); // three's defaults are for metres: mm here
    composer.addPass(gtao);
    // three's pass leaves only plain lines and points out of its depth picture; overlays (face marks, the gizmo,
    // cutters' invisible faces) and thick lines must stay out too, or they shade what is under them
    const pass = gtao as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[]; _overrideVisibility(): void };
    pass._overrideVisibility = () =>
      pass.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        const overlay = o instanceof LineSegments2 || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (m && (m.transparent || !m.depthWrite || !m.colorWrite));
        if (overlay && o.visible) (o.visible = false), pass._visibilityCache.push(o);
      });
    this.ao.gtao = gtao;
    this.ao.external = false;
    // the cut view's depth and normals, at the composer's size
    const depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedInt248Type);
    depthTexture.format = THREE.DepthStencilFormat;
    this.ao.gbuffer = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, stencilBuffer: true, depthTexture });
    composer.addPass(new OutputPass());
    this.render(); // its first frame has no occlusion yet: draw one more
    return (this.ao.composer = composer);
  }

  /**
   * A frame with ambient occlusion. While a section cuts, the AO pass reads the cut view's depth and normals: the
   * section view drawn again with normal materials that keep its clipping and stencil (cut faces included).
   */
  private renderAO() {
    const composer = this.aoComposer();
    const { gtao, gbuffer } = this.ao;
    const cut = this.boxes.length > 0;
    if (cut !== this.ao.external) {
      gtao!.setGBuffer(cut ? gbuffer!.depthTexture! : undefined, cut ? gbuffer!.texture : undefined);
      this.ao.external = cut;
    }
    if (cut) {
      const swapped: [THREE.Object3D, THREE.Material | THREE.Material[]][] = [];
      this.sectionView.traverse((o) => {
        if (o instanceof THREE.LineSegments) return swapped.push([o, o.material]), (o.visible = false);
        if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).colorWrite === false) return; // stencil helpers stay
        swapped.push([o, o.material]);
        o.material = normalsLike(o.material as THREE.Material);
      });
      this.renderer.setRenderTarget(gbuffer);
      this.renderer.clear();
      this.renderer.render(this.sectionView, this.camera);
      this.renderer.setRenderTarget(null);
      for (const [o, m] of swapped) {
        if (o instanceof THREE.LineSegments) o.visible = true;
        else ((o as THREE.Mesh).material as THREE.Material).dispose(), ((o as THREE.Mesh).material = m);
      }
    }
    composer.render();
  }

  /** Drops the ambient occlusion composer (camera or size changed): the next frame makes a new one. */
  private dropComposer() {
    this.ao.composer?.passes.forEach((p) => p.dispose());
    this.ao.composer?.dispose();
    this.ao.gbuffer?.depthTexture?.dispose();
    this.ao.gbuffer?.dispose();
    Object.assign(this.ao, { composer: null, gtao: null, gbuffer: null, external: false });
  }

  render = () => {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.placeWheel();
      this.drawSky();
      if (this.lightNow.followCamera || this.lightNow.cameraOn) this.aimLights();
      this.scaleDashes();
      this.drawCrossings();
      this.drawGrips();
      this.drawRefs();
      this.drawGrid();
      this.pointTo(this.arrowAt());
      for (const v of this.views) this.renderView(v);
      if (this.camera === this.perspective ? fitDepth(this.perspective, this.controls.target) : fitOrthoDepth(this.orthographic, this.shownBox())) this.dropComposer();
      this.drawContours();
      // lines: the bodies' own edges and contours drawn after the rest (`ownLines`)
      const wide = (c: THREE.Object3D) => (c.userData.wide || c.userData.contour !== undefined) && c.visible;
      const own = this.viewMode === 'lines' ? [...this.bodies.values()].filter((g) => g.visible && g.children.some(wide)) : [];
      const lines = own.map((g) => g.children.filter(wide));
      for (const l of lines.flat()) l.visible = false;
      if (this.ao.on && this.viewMode !== 'lines' && this.viewMode !== 'wire') this.renderAO();
      else this.renderer.render(this.scene, this.camera);
      for (const l of lines.flat()) l.visible = true;
      if (own.length) this.ownLines(own.map((g, k) => [g.children[0], ...lines[k]]));
      this.drawSilhouette();
      // picked edges and measures stay over the outline
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      for (const mark of [this.pickedEdgeMark, this.edgeMark, this.measureMark]) if (mark.children.length) this.renderer.render(mark, this.camera); // the measure last
      this.renderer.autoClear = autoClear;
      // the view cube shows the camera's rotation (cube frame mirrored into CSS's y-down frame)
      const e = new THREE.Matrix4().makeRotationFromQuaternion(toCube.clone().multiply(this.frameTurn.clone().invert()).multiply(this.camera.quaternion)).invert().elements; // inside a turned group: as turned from it
      this.cube.style.transform = `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
    });
  };

  /**
   * Lines mode: each body's edges hidden only by its own surfaces (depth cleared before each body), so bodies behind
   * others show through while their own back edges stay hidden; then all bodies' depth again for what is drawn after.
   */
  private ownLines(bodies: THREE.Object3D[][]) {
    const r = this.renderer;
    const autoClear = r.autoClear;
    r.autoClear = false;
    const clearDepth = () => (r.state.buffers.depth.setMask(true), r.clearDepth()); // a last material may have left depth writes off
    // each: its solid (depth only) first, then its edges and contour
    for (const parts of bodies) {
      clearDepth();
      for (const o of parts) r.render(o, this.camera);
    }
    clearDepth();
    for (const [solid] of bodies) r.render(solid, this.camera);
    r.autoClear = autoClear;
  }

  /** Per mesh for its contour: neighbouring triangles (the shared side's two points, the two triangles) and the triangles' normals, body coordinates. */
  private neighbours = new WeakMap<THREE.BufferGeometry, { pairs: Uint32Array; normals: Float32Array }>();

  private neighboursOf(geo: THREE.BufferGeometry) {
    let n = this.neighbours.get(geo);
    if (n) return n;
    const idx = geo.index!.array;
    const pos = geo.attributes.position.array;
    const normals = new Float32Array(idx.length);
    const open = new Map<number, number>();
    const pairs: number[] = [];
    const count = geo.attributes.position.count;
    for (let t = 0; t < idx.length / 3; t++) {
      const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
      const [ux, uy, uz] = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
      const [vx, vy, vz] = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
      normals.set([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], t * 3);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const key = Math.min(p, q) * count + Math.max(p, q);
        const other = open.get(key);
        if (other === undefined) open.set(key, t);
        else (pairs.push(p, q, other, t), open.delete(key));
      }
    }
    n = { pairs: new Uint32Array(pairs), normals };
    this.neighbours.set(geo, n);
    return n;
  }

  /**
   * Lines modes: each shown body's contour, where its curved faces turn away from the camera (between a triangle facing
   * it and one facing away), as lines in the body (`userData.contour`); worked out anew when the camera or body moved.
   */
  private drawContours() {
    const lined = this.viewMode === 'lines' || this.viewMode === 'wire';
    if (lined) this.scene.updateMatrixWorld();
    const cam = this.camera;
    const persp = cam === this.perspective;
    const view = cam.matrixWorld.elements.join();
    const material = this.viewMode === 'lines' ? this.lineEdges : this.allEdges;
    const wideLine = (key: 'wide' | 'contour') => {
      const l = Object.assign(new LineSegments2(new LineSegmentsGeometry(), material), { raycast: () => {} });
      l.userData[key] = '';
      return l;
    };
    for (const [id, g] of this.bodies) {
      let [edges, line] = [g.children.find((c) => c.userData.wide !== undefined), g.children.find((c) => c.userData.contour !== undefined)] as (LineSegments2 | undefined)[];
      const solid = g.children[0] as THREE.Mesh | undefined;
      const thin = g.children[1] as THREE.LineSegments | undefined;
      // drawn wide only where its thin edges are hidden for it (not a tool body, not faded)
      if (!lined || !g.visible || !solid || !thin || thin.visible || this.cutters.has(id)) {
        for (const l of [edges, line]) if (l) l.visible = false;
        continue;
      }
      if (!edges) g.add((edges = wideLine('wide')));
      if (edges.userData.wide !== thin.geometry.uuid) {
        edges.userData.wide = thin.geometry.uuid;
        edges.geometry.dispose();
        edges.geometry = new LineSegmentsGeometry().setPositions(thin.geometry.attributes.position.array as Float32Array);
      }
      if (!line) g.add((line = wideLine('contour')));
      for (const l of [edges, line]) Object.assign(l, { visible: true, material });
      const key = `${persp} ${view} ${solid.matrixWorld.elements.join()}`;
      if (line.userData.contour === key) continue;
      line.userData.contour = key;
      // the camera in body coordinates: where it is (perspective) or which way it looks (orthographic)
      const back = solid.matrixWorld.clone().invert();
      const eye = cam.getWorldPosition(new THREE.Vector3()).applyMatrix4(back);
      const look = cam.getWorldDirection(new THREE.Vector3()).transformDirection(back);
      const { pairs, normals } = this.neighboursOf(solid.geometry);
      const pos = solid.geometry.attributes.position.array;
      const faces = (t: number, a: number) =>
        persp ? normals[t * 3] * (eye.x - pos[a * 3]) + normals[t * 3 + 1] * (eye.y - pos[a * 3 + 1]) + normals[t * 3 + 2] * (eye.z - pos[a * 3 + 2]) > 0 : normals[t * 3] * look.x + normals[t * 3 + 1] * look.y + normals[t * 3 + 2] * look.z < 0;
      const out: number[] = [];
      for (let k = 0; k < pairs.length; k += 4) {
        const [a, b] = [pairs[k], pairs[k + 1]];
        if (faces(pairs[k + 2], a) !== faces(pairs[k + 3], a)) out.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      }
      line.geometry.dispose(); // a new one: a replaced one would keep its buffers until then
      line.geometry = new LineSegmentsGeometry().setPositions(out);
    }
  }

  /** Draws the bodies as `mode` has it (see `viewMode`). */
  setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    localStorage.setItem('makermaker.viewMode', mode);
    this.viewModes.value = mode;
    for (const id of this.bodies.keys()) this.dress(id);
    this.render();
  }

  /** Bodies hovered in the list: outlined orange (a temporary mark). */
  private hovered: string[] = [];
  /** At the view's edge, pointing to what is hovered in the list (else the selection) when it lies outside the view; a click centres it. */
  private offscreen = Object.assign(document.createElement('div'), { className: 'offscreen', hidden: true, innerHTML: icon('offscreen'), title: 'Click: into the middle of the view', onclick: () => {
      const at = this.arrowAt();
      if (at) this.centreOn(at);
    } });

  /** Outlines bodies orange (hovered in the list; none: clears it); off the view, an arrow at its edge points to them. */
  lightBodies(ids: string[]) {
    this.hovered = ids.filter((id) => this.bodies.has(id) && !this.hidden.has(id));
    this.render();
  }

  /** Told what lies under the pointer (a sketch's outline, a body, a work plane; null: nothing), when it changes: its list row lights. */
  onHover: ((id: string | null) => void) | null = null;
  private hovering: string | null = null;

  /** The work planes `ray` passes through within their rectangles, nearest first (`d`: the distance). */
  private planesOn(ray: THREE.Ray) {
    return this.workPlanes
      .flatMap((w) => {
        const point = planeHit(ray, w.frame);
        if (!point) return [];
        const [u, v] = uvOf(w.frame, point);
        return u >= w.rect[0] && u <= w.rect[2] && v >= w.rect[1] && v <= w.rect[3] ? [{ id: w.id, frame: w.frame, point, d: point.distanceTo(ray.origin) }] : [];
      })
      .sort((a, b) => a.d - b.d);
  }

  /** The nearest work plane under the pointer within its rectangle, in front of any body (`hit`: the body face there); null: none. */
  private workPlaneAt(e: MouseEvent, hit = this.frontHit(e)) {
    const w = this.planesOn(this.ray(e))[0];
    return w && !(hit && w.d > hit.distance) ? w : null;
  }

  private hoverRow(e: MouseEvent) {
    const hit = this.frontHit(e);
    const ray = this.ray(e);
    const s = this.shapeAt(ray, hit?.distance);
    // a plane counts only in front of the body hit
    const id = (s && s.edge < Infinity ? s.sketch : null) ?? this.workPlaneAt(e, hit)?.id ?? this.imageAt(e, hit)?.id ?? (hit?.object.userData.bodyId as string | undefined) ?? null;
    if (id !== this.hovering) this.onHover?.((this.hovering = id));
  }

  /** The middle of what the off-view arrow points to: the bodies hovered in the list, else a sketch or work plane hovered there, else the selected bodies (null: none). */
  private arrowAt() {
    const hot = this.workPlanes.find((w) => w.id === this.hotPlane);
    if (hot) return new THREE.Vector3(...toWorld(hot.frame, (hot.rect[0] + hot.rect[2]) / 2, (hot.rect[1] + hot.rect[3]) / 2));
    const picture = this.images.find((im) => im.id === this.hotImage);
    if (picture) return new THREE.Vector3(...picture.frame.o);
    const box = new THREE.Box3();
    const ids = this.hovered.length ? this.hovered : this.sketchHover.children.length ? [] : this.selection.filter((id) => this.bodies.has(id) && !this.hidden.has(id));
    for (const id of ids) if (this.bodies.has(id)) box.expandByObject(this.bodies.get(id)!); // undo may have removed a hovered one
    if (!this.hovered.length && this.sketchHover.children.length) box.setFromObject(this.sketchHover);
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }

  /** Slides the view (its turn and zoom kept) until `at` lies in its middle. */
  private centreOn(at: THREE.Vector3, ms = 400) {
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    const d = at.clone().sub(this.controls.target);
    // only across the view, unless it lies behind the camera
    if (at.clone().sub(this.camera.position).dot(look) > 0) d.addScaledVector(look, -d.dot(look));
    const cams = [this.orthographic, this.perspective];
    const [t0, p0] = [this.controls.target.clone(), cams.map((c) => c.position.clone())];
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = t * t * (3 - 2 * t);
      this.controls.target.copy(t0).addScaledVector(d, k);
      cams.forEach((c, i) => c.position.copy(p0[i]).addScaledVector(d, k));
      if (t < 1) (this.controls.dispatchEvent({ type: 'change' }), requestAnimationFrame(step));
      else (this.controls.update(), this.render());
    };
    requestAnimationFrame(step);
  }

  /** The off-view arrow: at the view's edge towards `at` (world) when it lies outside the view; null: hidden. */
  private pointTo(at: THREE.Vector3 | null, margin = 24) {
    if (!this.offscreen.isConnected) this.el.append(this.offscreen);
    const r = this.el.getBoundingClientRect();
    const p = at?.clone().project(this.camera);
    // behind the camera the projection mirrors: turned back round
    const [nx, ny] = p ? (p.z > 1 ? [-p.x, -p.y] : [p.x, p.y]) : [0, 0];
    const inside = !p || (p.z <= 1 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1);
    this.offscreen.hidden = inside;
    if (inside) return;
    // from the middle towards it, to where that ray leaves the view (less the margin)
    const [w, h] = [r.width / 2 - margin, r.height / 2 - margin];
    const [dx, dy] = [nx * (r.width / 2), -ny * (r.height / 2)];
    const k = Math.min(w / Math.abs(dx || 1e-9), h / Math.abs(dy || 1e-9));
    Object.assign(this.offscreen.style, { left: `${r.width / 2 + dx * k}px`, top: `${r.height / 2 + dy * k}px`, transform: `translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)` });
  }

  /** The outline around the selected bodies' silhouettes (cut ones too), over the finished picture. */
  private drawSilhouette() {
    const shown = this.selection.filter((id) => !this.hidden.has(id));
    const bodies = new Set(shown.filter((id) => !this.cutters.has(id)));
    // cut bodies from their section copies; tool bodies (not cut, not copied) as they are, outlined in red
    const solids = this.boxes.length
      ? this.sectionView.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && bodies.has(c.userData.bodyId))
      : [...bodies].flatMap((id) => (this.bodies.get(id)?.children[0] as THREE.Mesh | undefined) ?? []);
    this.outline(solids, [0, 0xbc / 255, 0xd4 / 255]);
    this.outline(
      shown.filter((id) => this.cutters.has(id)).flatMap((id) => (this.bodies.get(id)?.children[0] as THREE.Mesh | undefined) ?? []),
      [0xe5 / 255, 0x48 / 255, 0x4d / 255],
    );
    // hovered in the list: orange, a temporary mark
    this.outline(this.hovered.filter((id) => !this.hidden.has(id)).flatMap((id) => (this.bodies.get(id)?.children[0] as THREE.Mesh | undefined) ?? []), [1, 0x8c / 255, 0x1a / 255]);
  }

  /** The silhouette of `solids` outlined in `rgb` (0..1) over the picture. */
  private outline(solids: THREE.Mesh[], rgb: [number, number, number]) {
    if (!solids.length) return;
    const { mask, nothing, flat, quad, px } = this.silhouette;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (mask.width !== size.x || mask.height !== size.y) mask.setSize(size.x, size.y);
    const [clear, alpha, autoClear] = [r.getClearColor(new THREE.Color()), r.getClearAlpha(), r.autoClear];
    r.setRenderTarget(mask);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.autoClear = false; // all solids into one mask: one silhouette around them together
    mask.texture.generateMipmaps = false; // not after each of them
    for (const s of solids) {
      const own = s.material as THREE.Material;
      flat.clippingPlanes = own.clippingPlanes; // a cut copy stays cut
      s.material = flat;
      r.render(s, this.camera);
      s.material = own;
    }
    mask.texture.generateMipmaps = true;
    r.render(nothing, this.camera); // ends a render on the mask: its levels get made
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    const u = (quad.material as THREE.ShaderMaterial).uniforms;
    u.mask.value = mask.texture;
    u.color.value.set(...rgb);
    u.texel.value.set(1 / size.x, 1 / size.y);
    u.width.value = px * r.getPixelRatio();
    u.near.value = Math.ceil(Math.log2(2 * u.width.value + 1));
    r.autoClear = false;
    r.render(quad, this.camera);
    r.autoClear = autoClear;
  }

  /** Dashed lines (construction lines, guides, axes) keep `px` long dashes and gaps on screen at any zoom. */
  private scaleDashes(px = 5) {
    const mm = px / this.pixelsPerMm(this.controls.target);
    for (const g of [this.sketchView, this.overlay, this.axisMark])
      g.traverse((o) => {
        const m = (o as LineSegments2).material;
        if (m instanceof LineMaterial && m.dashed) m.dashSize = m.gapSize = mm;
      });
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.dropComposer();
    (this.axes.material as LineMaterial).resolution.set(w, h);
    for (const m of [this.lineEdges, this.allEdges]) m.resolution.set(w, h);
    for (const l of this.measureLegs) l.line.material.resolution.set(w, h);
    this.updateFrustums(w / h);
    this.render();
  }

  private updateFrustums(aspect: number) {
    const o = this.orthographic;
    const half = this.viewHeight / 2;
    Object.assign(o, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    o.updateProjectionMatrix();
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
  }

  /** Dark unless the page is set to light (`data-theme` on the root), or the system says so. */
  get isDark() {
    const set = document.documentElement.dataset.theme;
    return set ? set === 'dark' : this.dark.matches;
  }

  /** How fast the views zoom, pan and turn (settings; 1: as the orbit controls come). */
  private speeds = { zoom: 1, pan: 1, orbit: 1 };

  setSpeeds(speeds: { zoom: number; pan: number; orbit: number }) {
    this.speeds = speeds;
    for (const c of [this.controls, ...this.views.map((v) => v.controls)]) this.sped(c);
  }

  private sped(c: OrbitControls<THREE.Camera>) {
    Object.assign(c, { zoomSpeed: this.speeds.zoom, panSpeed: this.speeds.pan, rotateSpeed: this.speeds.orbit });
  }

  /** Ambient occlusion on or off (settings). */
  setAO(on: boolean) {
    this.ao.on = on;
    this.render();
  }

  /** The view's background (settings). */
  setBackdrop(backdrop: Settings['background']) {
    this.backdrop = backdrop;
    this.applyTheme();
  }

  /** The background now (solid: the theme grey). */
  backdropColours(): Backdrop {
    const b = this.backdrop;
    if (b.mode === 'photo' && b.photo && this.photos.has(b.photo)) return { stops: [{ color: this.solidGrey(), at: 0 }], band: 25, photo: { id: b.photo, turn: b.turn } };
    if (b.mode === 'colours') return twoColours(b.top, b.bottom);
    if (b.mode === 'sky') return SKIES[b.sky]?.[1] ?? SKIES[0][1];
    return { stops: [{ color: this.solidGrey(), at: 0 }], band: 25 };
  }

  private solidGrey = () => `#${new THREE.Color(this.isDark ? 0x1c1d20 : 0xeeeeec).getHexString()}`;

  applyTheme = () => {
    const dark = this.isDark;
    const backdrop = this.backdropColours();
    if (backdrop.photo) {
      const photo = this.showPhoto(backdrop.photo.id);
      photo.drawn = ''; // turned, or back from another background
      this.scene.background = photo.target.texture;
    } else if (backdrop.stops.length > 1) {
      this.dropPhoto();
      this.sky.texture ??= Object.assign(new THREE.CanvasTexture(this.sky.canvas), { colorSpace: THREE.SRGBColorSpace });
      this.sky.drawn = ''; // colours changed: draw again
      this.scene.background = this.sky.texture;
    } else {
      this.dropPhoto();
      this.scene.background = new THREE.Color(backdrop.stops[0].color);
    }
    this.gridLook = { major: dark ? 0x45474d : 0xbbbbbb, minor: dark ? 0x2c2e32 : 0xd6d6d4, zero: dark ? 0x60636b : 0xa2a2a2, key: '' }; // through 0: a tad stronger
    for (const m of [this.lineEdges, this.allEdges]) m.color.set(dark ? 0xdcdcdc : 0x2a2a2a);
    this.render();
  };

  /** Grid, origin axes and view cube follow `m` (a group's origin, world; null: the world's own). */
  setFrame(m: THREE.Matrix4 | null) {
    const f = m ?? new THREE.Matrix4();
    if (f.equals(this.groupFrame)) return;
    this.groupFrame.copy(f);
    f.decompose(new THREE.Vector3(), this.frameTurn, new THREE.Vector3());
    for (const o of [this.grid, this.axes]) Object.assign(o, { matrixAutoUpdate: false, matrixWorldNeedsUpdate: true }).matrix.copy(f);
    this.gridLook.key = '';
    // the view stands upright to it (its Z up on screen), orbiting around its Z
    this.upright();
    this.controls.update();
    this.render();
  }

  /** The ground grid's colours (the step's lines, every 5th, those through 0), and what it was drawn for (step and middle). */
  private gridLook = { major: 0xbbbbbb, minor: 0xd6d6d4, zero: 0xa2a2a2, key: '' };

  /**
   * The ground grid: a faint line every drag step there (1-2-5, by the zoom: finer zooming in, coarser out), every 5th
   * stronger (on a 5 step every 10th: 10, 50, 100 …), `cells` steps each way from the point looked at; drawn anew when
   * the step changes or the view moves far.
   */
  private drawGrid(cells = 250) {
    // around where the middle of the view meets the ground (zoomed in towards the pointer, the point orbited round
    // can lie far off), else the point looked at
    const toGrid = this.groupFrame.clone().invert();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const ground = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyQuaternion(this.frameTurn), 0).translate(new THREE.Vector3().setFromMatrixPosition(this.groupFrame));
    const world = ray.ray.intersectPlane(ground, new THREE.Vector3()) ?? this.controls.target.clone();
    const step = this.step(world);
    const t = world.clone().applyMatrix4(toGrid); // in the grid's own coordinates
    const every = this.every(step);
    const far = step * every * 10;
    const [cx, cy] = [Math.round(t.x / far) * far, Math.round(t.y / far) * far];
    const look = this.gridLook;
    const key = `${step} ${every} ${cx} ${cy} ${look.major} ${look.minor} ${look.zero}`;
    if (key === look.key) return;
    look.key = key;
    const lines: [number[], number[], number[]] = [[], [], []]; // the step's, every 5th (or 10th), through 0
    const reach = cells * step;
    const kind = (v: number) => (Math.abs(v) < step / 2 ? 2 : Math.round(v / step) % every === 0 ? 1 : 0);
    for (let i = -cells; i <= cells; i++) {
      const [x, y] = [cx + i * step, cy + i * step];
      lines[kind(x)].push(x, cy - reach, 0, x, cy + reach, 0);
      lines[kind(y)].push(cx - reach, y, 0, cx + reach, y, 0);
    }
    for (const o of this.grid.children as THREE.LineSegments[]) (o.geometry.dispose(), (o.material as THREE.Material).dispose());
    this.grid.clear();
    lines.forEach((pts, k) => {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: [look.minor, look.major, look.zero][k], depthWrite: false, transparent: !k, opacity: k ? 1 : 0.5 })); // the step's lines faint
      line.renderOrder = -2;
      this.grid.add(line);
    });
  }

  /** The axis wheel: while a move runs at its press point (spokes it may take), else at the move fields' gizmo; spokes `wheelPx` long on screen, the dead zone ring facing the camera. */
  private placeWheel() {
    const d = this.drag?.moved ? this.drag : null;
    const at = d?.start ?? this.gizmo?.at;
    this.wheel.visible = !!at;
    if (!at) return;
    this.wheel.position.copy(at);
    this.wheel.quaternion.copy(this.frameTurn); // its spokes along the move axes
    this.wheel.scale.setScalar(this.wheelPx / this.pixelsPerMm(at));
    const ring = this.wheel.getObjectByName('dead')!;
    ring.quaternion.copy(this.frameTurn.clone().invert().multiply(this.camera.quaternion)); // facing the camera inside the turned wheel
    ring.scale.setScalar(this.deadPx / this.wheelPx);
    for (const spoke of this.wheel.children) if (spoke.userData.axis !== undefined) spoke.visible = !d || d.axes.includes(spoke.userData.axis);
    if (!d) choose(this.wheel, this.gizmo!.axis);
  }

  /** The move fields' gizmo (null: gone), see `gizmo`. */
  showGizmo(g: typeof this.gizmo) {
    this.gizmo = g;
    this.render();
  }

  /** Whether the pointer is on the gizmo (within its spokes' reach on screen). */
  private onGizmo(e: MouseEvent) {
    const [x, y] = this.toScreen(this.gizmo!.at);
    const r = this.el.getBoundingClientRect();
    return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < this.wheelPx;
  }

  /** A press on the gizmo: the move a body grab starts, from its middle; the move sets the axes' values. */
  private dragGizmo(e: PointerEvent) {
    const g = this.gizmo!;
    const from = [0, 1, 2].map((k) => g.value(k));
    this.downAt = { x: e.clientX, y: e.clientY };
    this.downOnPart = true; // no click on empty space
    this.startDrag(e, this.ray(e), g.at.clone(), {
      axes: [0, 1, 2],
      lead: new THREE.Vector3(), // the distance lands on the step
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(this.facingMove(), g.at),
      only: null,
      apply: (by) => from.forEach((v, k) => g.set(k, v + this.inAxes(by).getComponent(k))),
      end: () => {},
    });
  }

  /** The axis whose spoke points most along the drag on screen; spokes pointing at the camera (short on screen) are skipped. */
  private wheelAxis(e: PointerEvent, start: THREE.Vector3, short = 0.25) {
    const [x0, y0] = this.toScreen(start);
    const spokes = [0, 1, 2].map((k) => {
      const [x1, y1] = this.toScreen(start.clone().addScaledVector(this.axisDir(k), this.wheel.scale.x));
      return [x1 - x0, y1 - y0];
    });
    const longest = Math.max(...spokes.map(([x, y]) => Math.hypot(x, y)));
    const dx = e.clientX - this.downAt.x;
    const dy = e.clientY - this.downAt.y;
    let best = this.drag!.axes[0];
    let score = -1;
    spokes.forEach(([x, y], k) => {
      const len = Math.hypot(x, y);
      const fit = Math.abs(x * dx + y * dy) / (len * Math.hypot(dx, dy));
      if (this.drag!.axes.includes(k) && len >= short * longest && fit > score) [best, score] = [k, fit];
    });
    return best;
  }

  /** Hit points in a cut-away region do not count. */
  private shown(p: THREE.Vector3) {
    if (!this.boxes.length) return true;
    return (
      this.boxes.some((box) => box.every(([lo, hi], k) => p.getComponent(k) >= lo && p.getComponent(k) <= hi)) &&
      this.custom.every((c) => c.distanceToPoint(p) >= 0)
    );
  }

  /** Body hits, nearest first, outside cut-away regions; while sectioned back faces count too, so a cut face picks its body. */
  private intersect(ray: THREE.Raycaster) {
    const side = this.boxes.length ? THREE.DoubleSide : THREE.FrontSide;
    for (const m of this.materials.values()) m.side = side;
    const hits = ray.intersectObjects(this.meshes()).filter((h) => this.shown(h.point));
    for (const m of this.materials.values()) m.side = THREE.FrontSide;
    for (const h of hits) h.face?.normal.transformDirection(h.object.matrixWorld); // world normals from here on
    return hits;
  }

  /** Body edges in the world, each as its segments. */
  edges() {
    return this.bodyEdges().map((e) => e.segs);
  }

  /**
   * Where the section cuts the shown bodies (world): each cut face's outline as loops of segments, with its body, and
   * its sharp corners; computed when first asked after the section or the bodies changed.
   */
  private cutEdges(sharp = 0.5 /* rad */) {
    if (this.cuts) return this.cuts;
    const lines: NonNullable<Viewer['cuts']>['lines'] = [];
    for (const planes of this.cutPlanes)
      for (const plane of planes)
        for (const [id, g] of this.bodies) {
          const solid = g.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
          if (!solid || this.hidden.has(id) || this.cutters.has(id)) continue;
          g.updateMatrix();
          for (const segs of planeCut(solid.geometry, g.matrix, plane, planes.filter((p) => p !== plane))) lines.push({ body: id, segs, cut: true });
        }
    const corners = lines.flatMap(({ segs }) =>
      segs.flatMap(([a, b], i) => {
        const next = segs[(i + 1) % segs.length];
        return next[0].distanceTo(b) < 1e-4 && b.clone().sub(a).angleTo(next[1].clone().sub(next[0])) > sharp ? [b] : [];
      }),
    );
    return (this.cuts = { lines, corners });
  }

  private crossings: { key: string; lines: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; cut: true; plane?: true }[]; ends: THREE.Vector3[] } | null = null;
  private crossMark = new THREE.Group();

  /**
   * Where shown bodies cross each other, and work planes (within their rectangles) cross bodies and each other: lines
   * that snap and pick like edges (no finishes on them: `cut`; `plane`: a work plane's), and their ends; computed when
   * first asked after bodies or planes changed. Bodies with over `maxTriangles` together get no crossings among them,
   * and they stop at `maxPairs` triangle pairs tried: a snapping aid must not freeze a big assembly.
   */
  private crossEdges(maxTriangles = 300_000, maxPairs = 50_000_000) {
    const shown = this.crossingBodies();
    const key = shown.map((b) => `${b.id} ${b.solid.geometry.id} ${b.g.matrix.elements.join()}`).join('|') + JSON.stringify(this.workPlanes.map((w) => [w.frame, w.rect]));
    if (this.crossings?.key === key) return this.crossings;
    const lines: NonNullable<Viewer['crossings']>['lines'] = [];
    // bodies crossing bodies, where their boxes overlap
    const big = shown.reduce((n, b) => n + (b.solid.geometry.index?.count ?? 0) / 3, 0) > maxTriangles;
    const tris = big ? [] : shown.map((b) => triangles(b.solid.geometry, b.g.matrix));
    let pairs = maxPairs;
    const boxes = tris.map((ts) => ts.reduce((box, t) => box.union(t.box), new THREE.Box3()));
    for (let i = 0; i < tris.length; i++)
      for (let j = i + 1; j < tris.length; j++) {
        const both = boxes[i].clone().intersect(boxes[j]);
        if (both.isEmpty()) continue;
        const [as, bs] = [tris[i].filter((t) => t.box.intersectsBox(both)), tris[j].filter((t) => t.box.intersectsBox(both))];
        pairs -= as.length * bs.length;
        if (pairs < 0) break;
        // each piece once (neighbouring triangles find shared ones twice), none too short to keep
        const pieces = new Map<string, [THREE.Vector3, THREE.Vector3]>();
        const point = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4)).join();
        for (const a of as)
          for (const b of bs) {
            const seg = a.box.intersectsBox(b.box) && triCross(a, b);
            if (seg && seg[0].distanceTo(seg[1]) > 1e-4) pieces.set([point(seg[0]), point(seg[1])].sort().join(' '), seg);
          }
        for (const line of chained([...pieces.values()])) lines.push({ body: shown[i].id, segs: line, cut: true });
      }
    lines.push(...this.planeEdges());
    const ends = lines.flatMap(({ segs }) => (segs[0][0].distanceTo(segs.at(-1)![1]) > 1e-6 ? [segs[0][0], segs.at(-1)![1]] : []));
    return (this.crossings = { key, lines, ends });
  }

  /** The bodies that cross: shown, no cutters. */
  private crossingBodies() {
    return [...this.bodies].flatMap(([id, g]) => {
      const solid = g.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
      return solid && !this.hidden.has(id) && !this.cutters.has(id) ? [{ id, g: (g.updateMatrix(), g), solid }] : [];
    });
  }

  /** Where a work plane cuts each body: kept per plane and body while neither changes. */
  private planeCuts = new Map<string, { key: string; segs: [THREE.Vector3, THREE.Vector3][][] }>();
  private planeCutKept(w: { id: string; plane: THREE.Plane; clips: THREE.Plane[] }, b: ReturnType<Viewer['crossingBodies']>[number]) {
    const id = `${w.id} ${b.id}`;
    const key = `${b.solid.geometry.id} ${b.g.matrix.elements.join()} ${w.plane.normal.toArray()} ${w.plane.constant} ${w.clips.map((c) => c.constant)}`;
    let kept = this.planeCuts.get(id);
    if (kept?.key !== key) this.planeCuts.set(id, (kept = { key, segs: planeCut(b.solid.geometry, b.g.matrix, w.plane, w.clips) }));
    return kept.segs;
  }

  /** The work planes' lines: across the bodies and each other. */
  private planeEdges() {
    const lines: NonNullable<Viewer['crossings']>['lines'] = [];
    if (!this.workPlanes.length) return lines;
    const shown = this.crossingBodies();
    // work planes: their planes and the four sides of their rectangles (clipping planes keep their inside)
    const planes = this.workPlanes.map((w) => {
      const [o, x, y, n] = [w.frame.o, w.frame.x, w.frame.y, w.frame.n].map((v) => new THREE.Vector3(...v));
      const side = (d: THREE.Vector3, at: number) => new THREE.Plane(d, -d.dot(o) - at);
      const [u0, v0, u1, v1] = w.rect;
      return { id: w.id, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, o), clips: [side(x, u0), side(x.clone().negate(), -u1), side(y, v0), side(y.clone().negate(), -v1)] };
    });
    for (const w of planes) for (const b of shown) for (const segs of this.planeCutKept(w, b)) lines.push({ body: b.id, segs, cut: true, plane: true });
    for (let i = 0; i < planes.length; i++)
      for (let j = i + 1; j < planes.length; j++) {
        const [p, q] = [planes[i].plane, planes[j].plane];
        const dir = p.normal.clone().cross(q.normal);
        if (dir.lengthSq() < 1e-12) continue;
        // a point on both (n·x = h each): (h₁ n₂×d + h₂ d×n₁) / |d|²
        const at = new THREE.Vector3().crossVectors(q.normal, dir).multiplyScalar(-p.constant).add(new THREE.Vector3().crossVectors(dir, p.normal).multiplyScalar(-q.constant)).divideScalar(dir.lengthSq());
        let [lo, hi] = [-1e6, 1e6];
        for (const c of [...planes[i].clips, ...planes[j].clips]) {
          const [d0, k] = [c.distanceToPoint(at), c.normal.dot(dir)];
          if (Math.abs(k) < 1e-12) {
            if (d0 < 0) lo = hi;
          } else if (k > 0) lo = Math.max(lo, -d0 / k);
          else hi = Math.min(hi, -d0 / k);
        }
        if (hi - lo > 1e-6) lines.push({ body: planes[i].id, segs: [[at.clone().addScaledVector(dir, lo), at.clone().addScaledVector(dir, hi)]], cut: true, plane: true });
      }
    return lines;
  }

  /** The work planes' crossing lines drawn green, redrawn when they change; what bodies cross of each other is left to the snapping that asks for it. */
  private drawCrossings() {
    const lines = this.planeEdges();
    const key = lines.map((l) => l.segs.flat().map((v) => v.toArray().join()).join(' ')).join('|');
    if (this.crossMark.userData.key === key) return;
    for (const o of this.crossMark.children) ((o as THREE.LineSegments).geometry.dispose(), ((o as THREE.LineSegments).material as THREE.Material).dispose());
    this.crossMark.clear();
    if (!this.crossMark.parent) this.scene.add(this.crossMark);
    this.crossMark.userData.key = key;
    const segs = lines.flatMap((l) => l.segs.flat());
    if (segs.length) this.crossMark.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: 0x2fae5a })));
  }

  /** The edges of the shown bodies (world segments), with their body; cut outlines of the section too (`cut`). */
  /** Centres of round body edges (world), per edge lines: kept while their geometry and place stay. */
  private roundCentres = new WeakMap<THREE.Object3D, { key: string; pts: THREE.Vector3[] }>();

  private edgeCentres() {
    const out: THREE.Vector3[] = [];
    for (const [id, g] of this.bodies)
      for (const c of this.hidden.has(id) ? [] : g.children) {
        const groups = c.userData.edgeGroups as Uint32Array | undefined;
        if (!groups) continue;
        const pos = (c as THREE.LineSegments).geometry.attributes.position;
        const key = `${(c as THREE.LineSegments).geometry.id} ${g.matrix.elements.join()}`;
        let kept = this.roundCentres.get(c);
        const exact = c.userData.exact as Exact | null | undefined;
        if (kept?.key !== key && exact) {
          // the kernel's circles and ellipses: their centres exact
          const pts = exact.edges.flatMap((e) => (e.kind === 'circle' || e.kind === 'ellipse' ? [new THREE.Vector3(...e.c).applyMatrix4(g.matrix)] : []));
          this.roundCentres.set(c, (kept = { key, pts }));
        }
        if (kept?.key !== key) {
          // a mesh body: circles fitted to its edges' segments
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k < groups.length; k += 2) {
            // segment starts and middles: a rectangle's corners alone lie on a circle
            const ring: THREE.Vector3[] = [];
            for (let i = groups[k]; i + 1 < groups[k] + groups[k + 1]; i += 2) {
              const [a, b] = [i, i + 1].map((j) => new THREE.Vector3().fromBufferAttribute(pos, j).applyMatrix4(g.matrix));
              ring.push(a, a.clone().lerp(b, 0.5));
            }
            const circle = circleOf(ring);
            if (circle) pts.push(circle.centre);
          }
          this.roundCentres.set(c, (kept = { key, pts }));
        }
        out.push(...kept.pts);
      }
    return out;
  }

  private bodyEdges() {
    const out: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; cut?: true; index?: number }[] = [...this.cutEdges().lines, ...this.crossEdges().lines];
    for (const [id, g] of this.bodies)
      for (const c of this.hidden.has(id) ? [] : g.children) {
        const groups = c.userData.edgeGroups as Uint32Array | undefined;
        if (!groups) continue;
        const pos = (c as THREE.LineSegments).geometry.attributes.position;
        const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(g.matrix);
        for (let k = 0; k < groups.length; k += 2) {
          const segs: [THREE.Vector3, THREE.Vector3][] = [];
          for (let i = groups[k]; i + 1 < groups[k] + groups[k + 1]; i += 2) segs.push([at(i), at(i + 1)]);
          out.push({ body: id, segs, index: k / 2 });
        }
      }
    return out;
  }

  /**
   * A picked edge's polyline (world) on the kernel's true curve, found by its ends and middle: a line its two ends, a
   * circle or arc points on the true circle `sag` mm apart from it at most; else its own points, its ends exact. A mesh
   * body's, or one not found: as given.
   */
  truePolyline(body: string, pts: THREE.Vector3[], sag = 0.001): THREE.Vector3[] {
    const g = this.bodies.get(body);
    const exact = g?.children.find((c) => c.userData.exact)?.userData.exact as Exact | undefined;
    if (!g || !exact || pts.length < 2) return pts;
    const at = (v: number[]) => new THREE.Vector3(...v).applyMatrix4(g.matrix);
    const [first, last, mid] = [pts[0], pts[pts.length - 1], pts[pts.length >> 1]];
    const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < 1e-3;
    for (const e of exact.edges) {
      const [a, b] = [at(e.a), at(e.b)];
      const flip = near(a, last) && near(b, first) && !(near(a, first) && near(b, last));
      if (!flip && !(near(a, first) && near(b, last))) continue;
      if (e.kind === 'line') return flip ? [b, a] : [a, b];
      if (e.kind !== 'circle') return [flip ? b : a, ...pts.slice(1, -1), flip ? a : b];
      const [c, n] = [at(e.c), new THREE.Vector3(...e.n).transformDirection(g.matrix)];
      if (Math.abs(mid.distanceTo(c) - e.r) > 0.1) continue; // a full circle through the same point, but not this one
      // from the first point round to the last, the way the polyline's middle lies
      const x = first.clone().sub(c).projectOnPlane(n).normalize();
      const y = n.clone().cross(x);
      const angle = (p: THREE.Vector3) => Math.atan2(p.clone().sub(c).dot(y), p.clone().sub(c).dot(x));
      const turn = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let end = first.distanceTo(last) < 1e-6 ? 2 * Math.PI : turn(angle(last)); // closed: all the way round
      if (turn(angle(mid)) > end) end -= 2 * Math.PI; // the middle lies the other way round
      const steps = Math.max(2, Math.ceil(Math.abs(end) / (2 * Math.acos(Math.max(-1, 1 - sag / e.r)))));
      return Array.from({ length: steps + 1 }, (_, k) => c.clone().addScaledVector(x, e.r * Math.cos((end * k) / steps)).addScaledVector(y, e.r * Math.sin((end * k) / steps)));
    }
    return pts;
  }

  /** Body edge `index`'s true length, from the kernel's data with its mesh (null: a mesh body, none). */
  edgeLength(body: string, index: number) {
    return this.exactEdge(body, index)?.edge.length ?? null;
  }

  /**
   * A picked edge as a whole: a circle the kernel keeps as halves (or more pieces) as all of them, their points and
   * refs together; any other edge as it is.
   */
  private wholeCircle(edge: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; index?: number }) {
    const own = { segs: edge.segs, refs: edge.index === undefined ? [] : [{ body: edge.body, edge: edge.index }] };
    const exact = edge.index === undefined ? null : this.exactEdge(edge.body, edge.index)?.edge;
    if (exact?.kind !== 'circle') return own;
    const lines = this.bodies.get(edge.body)?.children.find((c) => c.userData.exact);
    const all = ((lines?.userData.exact as Exact | null | undefined)?.edges ?? []).flatMap((x, k) =>
      x.kind === 'circle' && Math.hypot(...x.c.map((v, i) => v - exact.c[i])) < 1e-6 && Math.abs(x.r - exact.r) < 1e-6 && Math.abs(x.n.reduce((d, v, i) => d + v * exact.n[i], 0)) > 1 - 1e-9 ? [k] : [],
    );
    if (all.length < 2) return own;
    const pieces = this.bodyEdges().filter((x) => x.body === edge.body && x.index !== undefined && all.includes(x.index));
    return { segs: pieces.flatMap((x) => x.segs), refs: pieces.map((x) => ({ body: edge.body, edge: x.index! })) };
  }

  /** Body edge `index` (its edge group) as the kernel has it, and how its body is placed (null: a mesh body, none). */
  private exactEdge(body: string, index: number) {
    const g = this.bodies.get(body);
    const lines = g?.children.find((c) => c.userData.exact);
    const edge = (lines?.userData.exact as Exact | null | undefined)?.edges[index];
    return edge && g ? { edge, place: g.matrix } : null;
  }

  /** The body edge within `px` of the pointer that no face in front hides (null: none). */
  private edgeAt(e: MouseEvent, px = 6) {
    const r = this.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const ray = this.ray(e);
    const front = this.intersect(this.raycaster(e))[0]?.distance ?? Infinity;
    let best: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; cut?: true; index?: number; d: number } | null = null;
    for (const edge of this.bodyEdges())
      for (const [a, b] of edge.segs) {
        const [ax, ay] = this.toScreen(a);
        const [bx, by] = this.toScreen(b);
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const k = len2 ? Math.max(0, Math.min(1, ((mx - ax) * (bx - ax) + (my - ay) * (by - ay)) / len2)) : 0;
        const d = Math.hypot(mx - ax - k * (bx - ax), my - ay - k * (by - ay));
        if (d >= px || (best && d >= best.d)) continue;
        if (a.clone().lerp(b, k).distanceTo(ray.origin) > front + 0.5) continue; // behind a face
        best = { ...edge, d };
      }
    return best && { body: best.body, segs: best.segs, cut: best.cut, index: best.index };
  }

  private measureMark = new THREE.Group();

  /** One measure of a box (world) drawn along its edge in `axis` (0 x, 1 y, 2 z), a thin line with its ends marked; null: clears it. */
  showMeasure(box: THREE.Box3 | null, axis: number) {
    if (!box) return this.showSize(null);
    const [a, b] = [box.min.clone(), box.min.clone()];
    // the front edge: x along the front bottom, y and z up the right front corner
    if (axis) [a.x, b.x] = [box.max.x, box.max.x];
    b.setComponent(axis, box.max.getComponent(axis));
    this.showSize(a, b);
  }

  /** A size from `a` to `b` (world) over everything, a thin line with its ends marked; null: clears it. */
  showSize(a: THREE.Vector3 | null, b?: THREE.Vector3) {
    for (const o of this.measureMark.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    this.measureMark.clear();
    if (a && b) {
      // as the Distance measure draws one: a thin line, its two ends marked
      const material = new LineMaterial({ color: 0xff8c1a, depthTest: false, depthWrite: false, transparent: true });
      material.resolution.set(this.el.clientWidth, this.el.clientHeight);
      this.measureMark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions([...a.toArray(), ...b.toArray()]), material), { renderOrder: 1e6 }), Object.assign(marks([a, b], 0xff8c1a, 9), { renderOrder: 1e6 }));
    }
    this.render();
  }

  /** A point (world) marked over everything, with a small cross along the axes (null: none). */
  showPoint(at: THREE.Vector3 | THREE.Vector3[] | null, px = 14) {
    this.showMeasure(null, 0);
    const all = !at ? [] : Array.isArray(at) ? at : [at];
    if (all.length) {
      const cross = all.flatMap((p) => {
        const r = px / this.pixelsPerMm(p);
        return [0, 1, 2].flatMap((k) => [p.clone().addScaledVector(unit(k), -r), p.clone().addScaledVector(unit(k), r)]);
      });
      this.measureMark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(cross.flatMap((v) => v.toArray())), new LineMaterial({ color: 0xff8c1a, linewidth: 2, depthTest: false })), { renderOrder: 1e6 }), marks(all, 0xff8c1a, 10));
      this.measureMark.traverse((o) => (o.renderOrder = 1e6));
    }
    this.render();
  }

  /** Clears the picked faces and edges. */
  dropPicked() {
    this.pickedEdge = null;
    this.pickFaces([]);
    this.markEdge(undefined, this.pickedEdgeMark);
    this.host.pickedPart(null);
  }

  /** Picked faces (per body mesh): lit, their area reported (none: cleared). */
  /** The finish parts the picked faces belong to (null: none picked, or one is not a fillet's or chamfer's face). */
  pickedFinishes(): FinishPick[] | null {
    const parts = this.pickedFaces.flatMap(({ mesh, faces }) =>
      faces.map((f) => {
        const k = (mesh.userData.finishFaces as Int32Array | undefined)?.[f] ?? -1;
        return k < 0 ? null : { body: mesh.userData.bodyId as string, ...(mesh.userData.finishes as { feature: string; mid: Vec3 }[])[k] };
      }),
    );
    return parts.length && parts.every(Boolean) ? (parts as FinishPick[]) : null;
  }

  private pickFaces(picked: { mesh: THREE.Mesh; faces: number[] }[]) {
    for (const m of this.pickedMarks) this.replaceMark(m, undefined, [], 0);
    this.pickedFaces = picked.filter((p) => p.faces.length);
    this.pickedMarks = this.pickedFaces.map(({ mesh, faces }) => this.replaceMark(null, mesh, faces, PICKED)!);
    if (!this.pickedFaces.length) return this.host.pickedPart(null);
    this.pickedEdge = null;
    this.markEdge(undefined, this.pickedEdgeMark);
    const count = this.pickedFaces.reduce((n, p) => n + p.faces.length, 0);
    // the kernel's areas where it has them (bodies up to 1000 faces), else the triangles'
    const areas = this.pickedFaces.flatMap(({ mesh, faces }) => faces.map((k) => (mesh.userData.exact as Exact | null | undefined)?.faces[k]?.area ?? null));
    const exact = areas.every((a) => a !== null);
    const size = exact ? areas.reduce((n, a) => n + a!, 0) : this.pickedFaces.reduce((n, { mesh, faces }) => faces.reduce((m, k) => m + faceArea(mesh, k), n), 0);
    this.host.pickedPart({ kind: 'face', body: this.pickedFaces[0].mesh.userData.bodyId, size, count, exact });
  }

  private pickEdges(picked: { body: string; edges: [THREE.Vector3, THREE.Vector3][][] }) {
    if (!picked.edges.length) return this.dropPicked();
    this.pickFaces([]);
    this.pickedEdge = picked;
    this.markEdge(picked.edges.flat(), this.pickedEdgeMark, PICKED);
    // the kernel's edges where it has them: their lengths, and one circle's Ø (its parts on the same centre and radius)
    const known = this.bodyEdges().filter((x) => x.body === picked.body && x.index !== undefined);
    const exact = picked.edges.map((segs) => {
      const hit = known.find((x) => x.segs.length === segs.length && x.segs[0][0].distanceTo(segs[0][0]) < 1e-6);
      return hit ? this.exactEdge(picked.body, hit.index!)?.edge ?? null : null;
    });
    if (exact.every(Boolean)) {
      const circles = exact.filter((e) => e!.kind === 'circle') as Extract<ExactEdge, { kind: 'circle' }>[];
      const one = circles.length === exact.length && circles.every((c) => c.r === circles[0].r && c.c.every((v, k) => Math.abs(v - circles[0].c[k]) < 1e-9));
      return this.host.pickedPart({ kind: 'edge', body: picked.body, size: exact.reduce((n, e) => n + e!.length, 0), count: picked.edges.length, diameter: one ? 2 * circles[0].r : undefined, exact: true });
    }
    const size = picked.edges.flat().reduce((n, [a, b]) => n + a.distanceTo(b), 0);
    // one circle, maybe in parts (segment middles too: a rectangle's corners alone lie on a circle)
    const circle = circleOf(picked.edges.flatMap((segs) => segs.flatMap(([a, b]) => [a, a.clone().lerp(b, 0.5)])));
    this.host.pickedPart({ kind: 'edge', body: picked.body, size, count: picked.edges.length, diameter: circle?.d, exact: false });
  }

  /**
   * The tangent chain of the edge near the pointer: the edges joined to it end to end where they run on smoothly
   * (within `deg`: edges are drawn as segments, so a smooth joint still turns a little), e.g. a circle's halves, a
   * hole's rim, a rounded rectangle's outline. A straight edge between sharp corners (a box's): the edges joined end to
   * end in the plane of the face under the pointer, all around it.
   */
  private edgeLoop(e: MouseEvent, deg = 30) {
    const start = this.edgeAt(e);
    if (!start) return null;
    type Segs = [THREE.Vector3, THREE.Vector3][];
    // an edge's two ends, each with its direction there
    const tips = (segs: Segs): [THREE.Vector3, THREE.Vector3][] => [
      [segs[0][0], segs[0][1].clone().sub(segs[0][0]).normalize()],
      [segs[segs.length - 1][1], segs[segs.length - 1][1].clone().sub(segs[segs.length - 1][0]).normalize()],
    ];
    const pool = this.bodyEdges().filter((x) => x.body === start.body && !x.cut);
    const chain = [pool.find((x) => x.segs.length === start.segs.length && x.segs[0][0].distanceTo(start.segs[0][0]) < 1e-6) ?? start];
    const cos = Math.cos((deg * Math.PI) / 180);
    for (let i = 0; i < chain.length; i++)
      for (const [p, d] of tips(chain[i].segs))
        for (const x of pool) if (!chain.includes(x) && tips(x.segs).some(([q, t]) => q.distanceTo(p) < 0.01 && Math.abs(t.dot(d)) > cos)) chain.push(x);
    if (chain.length > 1) return { body: start.body, edges: chain.map((x) => x.segs) };
    // nothing runs on smoothly: the loop around the face under the pointer
    const hit = this.frontHit(e);
    const plane = hit && new THREE.Plane().setFromNormalAndCoplanarPoint(hit.face!.normal, hit.point);
    const flat = (segs: Segs) => !!plane && segs.every(([a, b]) => Math.abs(plane.distanceToPoint(a)) < 0.05 && Math.abs(plane.distanceToPoint(b)) < 0.05);
    if (!flat(chain[0].segs)) return { body: start.body, edges: [chain[0].segs] };
    const loop = [chain[0]];
    const ends = (segs: Segs) => [segs[0][0], segs[segs.length - 1][1]];
    for (let i = 0; i < loop.length; i++)
      for (const x of pool) if (!loop.includes(x) && flat(x.segs) && ends(x.segs).some((p) => ends(loop[i].segs).some((q) => p.distanceTo(q) < 0.01))) loop.push(x);
    return { body: start.body, edges: loop.map((x) => x.segs) };
  }

  /** Lights `segs` (world) as the picked or hovered edge; none: clears it. */
  private markEdge(segs?: [THREE.Vector3, THREE.Vector3][], mark = this.edgeMark, color = 0xff8c1a) {
    for (const o of mark.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    mark.clear();
    if (segs) mark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(segs.flat().flatMap((v) => v.toArray())), new LineMaterial({ color, linewidth: 4, depthTest: false })), { renderOrder: 1e6 }));
    this.render();
  }

  corners() {
    const out: THREE.Vector3[] = [];
    for (const [id, g] of this.bodies)
      for (const c of this.hidden.has(id) ? [] : g.children) {
        const xyz = c.userData.corners as Float32Array | undefined;
        for (let i = 0; xyz && i < xyz.length; i += 3) out.push(new THREE.Vector3(xyz[i], xyz[i + 1], xyz[i + 2]).applyMatrix4(g.matrix));
      }
    return [...out, ...this.balls.map((b) => b.center), ...this.cutEdges().corners, ...this.crossEdges().ends];
  }

  spheres() {
    return this.balls;
  }

  private measured = new Map<string, { key: string; box: THREE.Box3; volume: number; area: number; exact: boolean; boxExact: boolean; faces: number }>();

  /** A body's box in the world, volume (mm³) and surface area (mm²) from its triangles (null: not built yet); kept until its mesh or place changes. */
  /** The normals (world) of a body's B-rep faces touching point `p`: those meeting at an edge, at a point on it. */
  facesAt(id: string, p: THREE.Vector3, tol = 0.02) {
    const solid = this.bodies.get(id)?.children[0] as THREE.Mesh | undefined;
    const index = solid?.geometry.index;
    const groups = solid?.userData.faces as Uint32Array | undefined;
    if (!solid || !index || !groups) return [];
    const local = solid.worldToLocal(p.clone());
    const pos = solid.geometry.attributes.position;
    const tri = new THREE.Triangle();
    const [near, n] = [new THREE.Vector3(), new THREE.Vector3()];
    const normals: THREE.Vector3[] = [];
    for (let f = 0; f < groups.length / 2; f++) {
      for (let i = groups[f * 2]; i < groups[f * 2] + groups[f * 2 + 1]; i += 3) {
        tri.setFromAttributeAndIndices(pos, index.getX(i), index.getX(i + 1), index.getX(i + 2));
        if (tri.closestPointToPoint(local, near).distanceTo(local) > tol) continue;
        tri.getNormal(n);
        if (n.lengthSq() < 0.5) continue; // too thin to tell
        normals.push(n.clone().transformDirection(solid.matrixWorld));
        break;
      }
    }
    return normals;
  }

  /** Body `id`'s box in body `of`'s own coordinates (from its mesh points, tight however the two are turned); null: either not shown yet. */
  boxIn(id: string, of: string) {
    const [g, h] = [this.bodies.get(id), this.bodies.get(of)];
    const mesh = g?.children[0] as THREE.Mesh | undefined;
    if (!mesh?.geometry || !h) return null;
    const m = h.matrix.clone().invert().multiply(g!.matrix);
    const pos = mesh.geometry.attributes.position;
    const [box, v] = [new THREE.Box3(), new THREE.Vector3()];
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    return box;
  }

  measure(id: string) {
    const g = this.bodies.get(id);
    const solid = g?.children[0] as THREE.Mesh | undefined;
    const index = solid?.geometry.index;
    if (!g || !solid || !index) return null;
    const key = `${solid.geometry.id} ${g.matrix.elements.join()}`;
    const known = this.measured.get(id);
    if (known?.key === key) return known;
    const pos = solid.geometry.attributes.position;
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(g.matrix));
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let [volume, area] = [0, 0];
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(pos, index.getX(i));
      b.fromBufferAttribute(pos, index.getX(i + 1));
      c.fromBufferAttribute(pos, index.getX(i + 2));
      volume += a.dot(b.clone().cross(c)) / 6; // signed tetrahedra from the origin
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    // the kernel's numbers where it has them: volume and area, and the box: the kernel's while the body's turn keeps
    // the axes, else from its exact edges (`turnedBox`; turned, the kernel's box would be loose)
    const exact = solid.userData.exact as Exact | null | undefined;
    const axes = [0, 1, 2, 4, 5, 6, 8, 9, 10].every((k) => Math.abs(Math.abs(g.matrix.elements[k]) - 0.5) > 0.5 - 1e-9);
    const turned = exact && !axes ? turnedBox(exact, g.matrix) : null;
    if (exact?.box && axes) box.set(new THREE.Vector3(...exact.box[0]), new THREE.Vector3(...exact.box[1])).applyMatrix4(g.matrix);
    else if (turned) box.copy(turned);
    let boxExact = (!!exact?.box && axes) || !!turned;
    // else (a turned sphere or fillet; over 1000 faces): the kernel's numbers of the placed solid, asked once per shape and place
    const asked = this.kernelBoxes.get(id);
    const got = asked?.key === key ? asked.got : null;
    if (!boxExact && got) {
      box.copy(got.box);
      boxExact = true;
    } else if (!boxExact && asked?.key !== key && !this.host.meshOnly(id)) this.askBox(id, key, g.matrix);
    const out = { key, box, volume: exact?.volume ?? got?.volume ?? Math.abs(volume), area: exact?.area ?? got?.area ?? area, exact: !!exact || !!got, boxExact, faces: (solid.userData.faces as Uint32Array | undefined)?.length ?? 0 };
    this.measured.set(id, out);
    return out;
  }

  /** The box of everything drawn (world): what an orthographic camera's depth must take in. */
  private shownBox() {
    const box = new THREE.Box3();
    const part = new THREE.Box3();
    this.scene.updateMatrixWorld();
    this.scene.traverseVisible((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g?.attributes?.position && !g?.boundingBox) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox && !g.boundingBox.isEmpty()) box.union(part.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return box;
  }

  /** The kernel's tight boxes, volumes and surfaces of placed bodies (see `measure`), by body: for which shape and place; none while asked. */
  private kernelBoxes = new Map<string, { key: string; got?: { box: THREE.Box3; volume: number; area: number } }>();

  private askBox(id: string, key: string, m: THREE.Matrix4) {
    this.kernelBoxes.set(id, { key });
    const [offset, q] = [new THREE.Vector3(), new THREE.Quaternion()];
    m.decompose(offset, q, new THREE.Vector3());
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    const place = { axis: (s < 1e-9 ? [0, 0, 1] : [q.x / s, q.y / s, q.z / s]) as Vec3, angle: s < 1e-9 ? 0 : (2 * Math.acos(Math.min(1, q.w)) * 180) / Math.PI, offset: offset.toArray() as Vec3 };
    void this.host.askSolids([{ of: 'solid', body: id, place }]).then(([a]) => {
      if (this.kernelBoxes.get(id)?.key !== key || !a || typeof a !== 'object' || !('min' in a)) return;
      this.kernelBoxes.set(id, { key, got: { box: new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max)), volume: a.volume, area: a.area } });
      this.measured.delete(id);
      this.host.boxesKnown();
    });
  }

  /** A world point in a body's own coordinates, and back; a direction likewise. */
  toBody(body: string, v: THREE.Vector3) {
    return v.clone().applyMatrix4(this.bodies.get(body)?.matrix.clone().invert() ?? new THREE.Matrix4());
  }
  fromBody(body: string, v: THREE.Vector3) {
    return v.clone().applyMatrix4(this.bodies.get(body)?.matrix ?? new THREE.Matrix4());
  }
  dirToBody(body: string, v: THREE.Vector3) {
    return v.clone().transformDirection(this.bodies.get(body)?.matrix.clone().invert() ?? new THREE.Matrix4());
  }

  /** The nearest point on a body's true edge (the kernel's line, its circle all round, an ellipse's or free curve's path) within `reach` mm of `at` (world); null: none there. */
  onBodyEdge(at: THREE.Vector3, reach = 0.1) {
    let best: [number, THREE.Vector3] | null = null;
    for (const [id, g] of this.bodies) {
      const exact = g.children.find((c) => c.userData.exact)?.userData.exact as Exact | undefined;
      if (!exact || this.hidden.has(id)) continue;
      const p = at.clone().applyMatrix4(g.matrix.clone().invert()); // in the body's coordinates, as its edges
      for (const e of exact.edges) {
        let q: THREE.Vector3 | null = null;
        if (e.kind === 'line') q = new THREE.Line3(new THREE.Vector3(...e.a), new THREE.Vector3(...e.b)).closestPointToPoint(p, true, new THREE.Vector3());
        if (e.kind === 'circle') {
          const [c, n] = [new THREE.Vector3(...e.c), new THREE.Vector3(...e.n)];
          const out = p.clone().sub(c).projectOnPlane(n);
          if (out.lengthSq() > 1e-18) q = c.addScaledVector(out.normalize(), e.r);
        }
        // an ellipse or free curve: on its path (the cubics between its exact points)
        if ((e.kind === 'ellipse' || e.kind === 'curve') && e.path.pts.length > 1) q = new THREE.Vector3(...nearestOnPath(e.path, p.toArray()));
        const d = q ? q.distanceTo(p) : Infinity;
        if (q && d < reach && (!best || d < best[0])) best = [d, q.applyMatrix4(g.matrix)];
      }
    }
    return best?.[1] ?? null;
  }

  /** The top along world direction `w` of the ellipse or free body edge nearest `at` within `reach` mm (on its path); null: none there. */
  bodyCurveTop(at: THREE.Vector3, w: THREE.Vector3, reach: number): THREE.Vector3 | null {
    let best: [number, THREE.Vector3] | null = null;
    for (const [id, g] of this.bodies) {
      const exact = g.children.find((c) => c.userData.exact)?.userData.exact as Exact | undefined;
      if (!exact || this.hidden.has(id)) continue;
      const p = at.clone().applyMatrix4(g.matrix.clone().invert()).toArray();
      const local = w.clone().transformDirection(g.matrix.clone().invert()).toArray();
      for (const e of exact.edges) {
        if ((e.kind !== 'ellipse' && e.kind !== 'curve') || e.path.pts.length < 2) continue;
        const d = new THREE.Vector3(...nearestOnPath(e.path, p)).distanceTo(new THREE.Vector3(...p));
        if (d < reach && (!best || d < best[0])) best = [d, new THREE.Vector3(...farthestOnPath(e.path, local)).applyMatrix4(g.matrix)];
      }
    }
    return best?.[1] ?? null;
  }

  /** The kernel's circle (world) of the round body edge nearest `at` within `reach` mm; null: none there. */
  bodyCircleAt(at: THREE.Vector3, reach: number): { c: THREE.Vector3; n: THREE.Vector3; r: number } | null {
    let best: [number, { c: THREE.Vector3; n: THREE.Vector3; r: number }] | null = null;
    for (const [id, g] of this.bodies) {
      const exact = g.children.find((c) => c.userData.exact)?.userData.exact as Exact | undefined;
      if (!exact || this.hidden.has(id)) continue;
      const p = at.clone().applyMatrix4(g.matrix.clone().invert());
      for (const e of exact.edges) {
        if (e.kind !== 'circle') continue;
        const [c, n] = [new THREE.Vector3(...e.c), new THREE.Vector3(...e.n)];
        const out = p.clone().sub(c).projectOnPlane(n);
        const d = out.lengthSq() > 1e-18 ? c.clone().addScaledVector(out.normalize(), e.r).distanceTo(p) : Infinity;
        if (d < reach && (!best || d < best[0])) best = [d, { c: c.applyMatrix4(g.matrix), n: n.transformDirection(g.matrix), r: e.r }];
      }
    }
    return best?.[1] ?? null;
  }

  /** The nearest point on a sketch outline within `reach` mm of `at` (world), on its exact sides (`only`: that shape alone). */
  onSketchCurve(at: THREE.Vector3, reach = 0.2, only?: string) {
    let best: { d: number; p: THREE.Vector3 } | null = null;
    const found = (frame: ViewSketch['frame'], on: [number, number], q: [number, number]) => {
      const d = Math.hypot(on[0] - q[0], on[1] - q[1]);
      if (d < reach && (!best || d < best.d)) best = { d, p: new THREE.Vector3(...toWorld(frame, on[0], on[1])) };
    };
    for (const s of this.sketches) {
      const n = new THREE.Vector3(...s.frame.n);
      if (Math.abs(at.clone().sub(new THREE.Vector3(...s.frame.o)).dot(n)) > reach) continue;
      const q = uvOf(s.frame, at);
      for (const p of s.shapes) if (!only || p.id === only) found(s.frame, nearestOnOutline(p, q).at, q);
    }
    return (best as { p: THREE.Vector3 } | null)?.p ?? null;
  }

  private clashView = new THREE.Group();
  /** Overlaps in red, on top of everything, clearance zones in see-through green, the space moving parts go through in see-through orange (world). Nothing: gone. */
  showClashes(hits: { vertices: Float32Array; indices: Uint32Array }[], zones: { vertices: Float32Array; indices: Uint32Array }[], sweeps: { vertices: Float32Array; indices: Uint32Array }[] = []) {
    if (!this.clashView.parent) this.scene.add(this.clashView);
    for (const o of this.clashView.children) ((o as THREE.Mesh).geometry.dispose(), ((o as THREE.Mesh).material as THREE.Material).dispose());
    this.clashView.clear();
    const add = (m: { vertices: Float32Array; indices: Uint32Array }, color: number, opacity: number, order: number, hit: number | null, depthOnly = false) => {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(m.vertices, 3)).setIndex(new THREE.BufferAttribute(m.indices, 1));
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: hit === null, depthWrite: depthOnly, colorWrite: !depthOnly, side: THREE.DoubleSide }));
      mesh.renderOrder = order;
      mesh.userData.hit = hit;
      this.clashView.add(mesh);
    };
    zones.forEach((z) => add(z, 0x2fae5a, 0.22, 8e3, null));
    // a sweep is many overlapping solids: only the front layer gets drawn
    sweeps.forEach((z) => {
      add(z, 0, 0, 9e3, null, true);
      add(z, 0xff8c1a, 0.08, 9e3 + 1, null);
      // coplanar ones too: each pixel once
      Object.assign((this.clashView.children.at(-1) as THREE.Mesh).material as THREE.Material, { stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 128, stencilFuncMask: 128, stencilWriteMask: 128, stencilZPass: THREE.ReplaceStencilOp });
    });
    hits.forEach((h, k) => add(h, 0xe5484d, 0.85, 1e5, k));
    this.render();
  }

  /** The overlap under the pointer (its number), if any. */
  clashAt(e: MouseEvent) {
    const reds = this.clashView.children.filter((o) => o.userData.hit !== null);
    return (this.raycaster(e).intersectObjects(reds)[0]?.object.userData.hit as number | undefined) ?? null;
  }

  /** One overlap lit, the others dimmer (null: all alike). */
  lightClash(k: number | null) {
    for (const o of this.clashView.children) {
      if (o.userData.hit === null) continue;
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = k === null || o.userData.hit === k ? 0.85 : 0.3;
    }
    this.render();
  }

  /** Where the pointer is over the view (client pixels), if it is. */
  pointer() {
    return this.hover && { x: this.hover.clientX, y: this.hover.clientY };
  }

  /** A picking press ended: without dragging it picks a face or goes to the tool as a click. */
  private clicked(e: PointerEvent, px = 4) {
    const { x, y } = this.clickAt!;
    this.clickAt = null;
    if (this.tool) this.toolButtons(true);
    if (Math.hypot(e.clientX - x, e.clientY - y) > px) return;
    if (this.facePick) return this.pickFaceAt(e);
    const t = this.tool;
    if (t?.down(e) && t === this.tool) t.up(); // not to a tool that replaced it
  }

  /** Lights the whole B-rep face of `hit` (none: clears it). */
  markFace(hit?: THREE.Intersection, color = 0xff8c1a) {
    this.faceMark = this.replaceMark(this.faceMark, hit ? (hit.object as THREE.Mesh) : undefined, hit ? [faceOf(hit)] : [], color);
  }

  /** Lights B-rep faces `faces` of body mesh `mesh`, replacing mark `old` (none: only removes it). */
  private replaceMark(old: THREE.Mesh | null, mesh: THREE.Mesh | undefined, faces: number[], color: number) {
    if (old) {
      old.removeFromParent();
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
    const groups = mesh?.userData.faces as Uint32Array | undefined;
    let mark: THREE.Mesh | null = null;
    if (mesh && groups && faces.length) {
      const index = faces.flatMap((k) => [...mesh.geometry.index!.array.subarray(groups[k * 2], groups[k * 2] + groups[k * 2 + 1])]);
      const pos = mesh.geometry.attributes.position;
      const points = new Float32Array(index.length * 3);
      index.forEach((v, i) => points.set([pos.getX(v), pos.getY(v), pos.getZ(v)], i * 3));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(points, 3));
      mark = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
      );
      mark.renderOrder = 1e5; // over everything, what lies under it seen through
      mesh.parent!.add(mark);
    }
    this.render();
    return mark;
  }

  /** The selected part of a finish (`mid`: the edge it replaced; null: the whole finish), lit on its body. */
  private finishSel: FinishPick | null = null;
  private finishMark: THREE.Mesh | null = null;

  /** Faces of fillets and chamfers held at the largest size their edge takes, on the selected bodies: orange. */
  private cappedMarks: THREE.Mesh[] = [];

  private markCapped() {
    for (const m of this.cappedMarks) this.replaceMark(m, undefined, [], 0);
    const same = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) < 0.01);
    this.cappedMarks = this.selection.flatMap((id) => {
      const solid = this.bodies.get(id)?.children[0] as THREE.Mesh | undefined;
      const held = (solid?.userData.capped ?? []) as number[][];
      if (!solid || !held.length) return [];
      const finishes = solid.userData.finishes as { mid: number[] }[];
      const faces = [...(solid.userData.finishFaces as Int32Array)].flatMap((k, f) => (k >= 0 && held.some((m) => same(finishes[k].mid, m)) ? [f] : []));
      return this.replaceMark(null, solid, faces, 0xff8c1a) ?? [];
    });
  }

  setFinishMark(sel: FinishPick | null) {
    this.finishSel = sel;
    const solid = sel && (this.bodies.get(sel.body)?.children[0] as THREE.Mesh | undefined);
    const finishes = (solid?.userData.finishes ?? []) as { feature: string; mid: number[] }[];
    const same = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) < 0.01);
    const faces = [...((solid?.userData.finishFaces ?? []) as Int32Array)].flatMap((k, f) =>
      k >= 0 && finishes[k].feature === sel!.feature && (!sel!.mid || same(finishes[k].mid, sel!.mid)) ? [f] : [],
    );
    this.finishMark = this.replaceMark(this.finishMark, solid ?? undefined, faces, PICKED); // selected: blue
  }

  /**
   * A step of a body selected (see main's `stepSel`): its faces lit, those `of` says made it (each face asked with a point
   * on it and its outward normal, world); null: none.
   */
  setStepMark(sel: { body: string; of: (at: THREE.Vector3, n: THREE.Vector3) => boolean } | null) {
    this.stepSel = sel;
    const solid = sel && (this.bodies.get(sel.body)?.children[0] as THREE.Mesh | undefined);
    const groups = solid?.userData.faces as Uint32Array | undefined;
    const faces: number[] = [];
    if (solid && groups) {
      const [pos, idx] = [solid.geometry.attributes.position, solid.geometry.index!];
      const corner = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(solid.matrixWorld);
      for (let f = 0; f * 2 < groups.length; f++) {
        // its first triangle: its middle lies on the face, its winding gives the outward normal
        const [a, b, c] = [0, 1, 2].map((k) => corner(groups[f * 2] + k));
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        if (sel.of(a.add(b).add(c).divideScalar(3), n)) faces.push(f);
      }
    }
    this.stepMark = this.replaceMark(this.stepMark, solid ?? undefined, faces, PICKED);
    this.render();
  }
  private stepSel: { body: string; of: (at: THREE.Vector3, n: THREE.Vector3) => boolean } | null = null;
  private stepMark: THREE.Mesh | null = null;

  /** The finish part under a body hit, if the hit face is one. */
  private finishAt(hit: THREE.Intersection): { feature: string; mid: Vec3 } | null {
    const k = (hit.object.userData.finishFaces as Int32Array | undefined)?.[faceOf(hit)] ?? -1;
    return k >= 0 ? (hit.object.userData.finishes as { feature: string; mid: Vec3 }[])[k] : null;
  }

  /**
   * The B-rep face of `hit` if it is round (a cylinder's side, a hole's wall): its axis (from its normals, which all
   * stand square to it), the circle its points lie on, and how far it reaches along the axis; else undefined.
   */
  flatFace(hit: THREE.Intersection) {
    const mesh = hit.object as THREE.Mesh;
    const kind = (mesh.userData.exact as Exact | null | undefined)?.faces[faceOf(hit)]?.kind;
    if (kind) return kind === 'plane'; // the kernel's surface
    const groups = mesh.userData.faces as Uint32Array | undefined;
    const [index, nor] = [mesh.geometry.index, mesh.geometry.attributes.normal];
    if (!groups || !index) return true;
    const k = faceOf(hit);
    const [first, n] = [new THREE.Vector3(), new THREE.Vector3()];
    const ids = index.array.subarray(groups[k * 2], groups[k * 2] + groups[k * 2 + 1]);
    first.fromBufferAttribute(nor, ids[0]);
    return ids.every((i) => n.fromBufferAttribute(nor, i).dot(first) > 0.9999);
  }

  private roundOf(hit: THREE.Intersection) {
    return this.roundOfFace(hit.object as THREE.Mesh, faceOf(hit));
  }

  /** Face `k` of `mesh`, if round (a cylinder's or part of one): its axis, length, radius, and whether it is a shaft. */
  private roundOfFace(mesh: THREE.Mesh, k: number) {
    const groups = mesh.userData.faces as Uint32Array | undefined;
    const index = mesh.geometry.index;
    if (!groups || !index) return undefined;
    const [pos, nor] = [mesh.geometry.attributes.position, mesh.geometry.attributes.normal];
    const ids = [...new Set(index.array.subarray(groups[k * 2], groups[k * 2] + groups[k * 2 + 1]))];
    const pts = ids.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    // the kernel's cylinder: axis, radius and side exact (its length from the face's points along it); a mesh body's: fitted
    const exact = (mesh.userData.exact as Exact | null | undefined)?.faces[k];
    if (exact) {
      if (exact.kind !== 'cylinder') return undefined;
      const dir = new THREE.Vector3(...exact.dir).transformDirection(mesh.matrixWorld);
      const on = new THREE.Vector3(...exact.at).applyMatrix4(mesh.matrixWorld);
      const along = pts.map((p) => p.clone().sub(on).dot(dir));
      const [lo, hi] = [Math.min(...along), Math.max(...along)];
      return { at: on.addScaledVector(dir, lo), dir, length: hi - lo, r: exact.r, shaft: exact.shaft };
    }
    const ns = ids.map((i) => new THREE.Vector3().fromBufferAttribute(nor, i).transformDirection(mesh.matrixWorld));
    // the two normals most apart: their cross is the axis
    let dir = new THREE.Vector3();
    for (const a of ns) for (const b of ns) { const c = a.clone().cross(b); if (c.lengthSq() > dir.lengthSq()) dir = c; }
    if (dir.lengthSq() < 0.01) return undefined; // flat
    dir.normalize();
    const flat = pts.map((p) => p.clone().projectOnPlane(dir));
    const circle = circleOf(flat, 0.02);
    if (!circle) return undefined;
    const along = pts.map((p) => p.dot(dir));
    const [lo, hi] = [Math.min(...along), Math.max(...along)];
    const shaft = pts[0].clone().projectOnPlane(dir).sub(circle.centre).dot(ns[0]) > 0; // its normals point out of it
    return { at: circle.centre.clone().addScaledVector(dir, lo), dir, length: hi - lo, r: circle.d / 2, shaft };
  }

  /** The body face under the pointer, if it faces the camera (not a back face seen through a cut). */
  private frontHit(e: MouseEvent) {
    const ray = this.raycaster(e);
    const hit = this.intersect(ray)[0];
    return hit?.face && hit.face.normal.dot(ray.ray.direction) < 0 ? hit : undefined;
  }

  /** A face under the pointer, else the base plane facing the camera through the origin; the normal points away from the camera. */
  private pickFaceAt(e: PointerEvent) {
    const hit = this.frontHit(e);
    const plane = this.pickPlanes ? this.workPlaneAt(e) : null;
    if (plane) {
      const n = new THREE.Vector3(...plane.frame.n);
      if (n.dot(this.camera.getWorldDirection(new THREE.Vector3())) < 0) n.negate();
      return this.endFacePick({ point: plane.point, normal: n, plane: plane.id, what: 'on work plane' });
    }
    if (this.quietPick && this.pickParts === 'alt' && picksFace(e)) {
      const edge = this.edgeAt(e);
      this.markEdge();
      if (edge) {
        const whole = this.wholeCircle(edge);
        return this.endFacePick({ point: edge.segs[0][0].clone(), normal: new THREE.Vector3(), part: { edge: whole.segs, ref: whole.refs[0], refs: whole.refs }, adds: role(e, 'add') });
      }
      return this.endFacePick({ point: hit?.point.clone() ?? new THREE.Vector3(), normal: new THREE.Vector3(), ...(hit ? { part: { face: this.faceItem(hit) }, adds: role(e, 'add') } : {}) });
    }
    if (this.quietPick) {
      const edge = this.edgeAt(e);
      const snap = this.snapAt(e);
      const [a, b] = edge ? [edge.segs[0][0], edge.segs.at(-1)![1]] : [];
      // straight: every segment along the line from its first point to its last
      const straight = edge && a!.distanceTo(b!) > 1e-6 && edge.segs.every(([p, q]) => q.clone().sub(p).normalize().cross(b!.clone().sub(a!).normalize()).length() < 1e-3);
      // the click's point from the real geometry, then the pick ends (a click meanwhile counts for nothing)
      const pick = this.facePick;
      const item = hit ? { item: this.faceItem(hit) } : {};
      if (this.truing) return;
      this.truing = true;
      return void (snap ? this.truePoint(snap) : Promise.resolve(null)).then((real) => {
        this.truing = false;
        if (this.facePick !== pick) return;
        this.endFacePick({
          snap: real?.at,
          about: real?.about,
        point: hit?.point.clone() ?? new THREE.Vector3(),
        normal: hit ? hit.face!.normal.clone().negate() : new THREE.Vector3(),
        what: snap?.what,
        ...(edge ? { edge: { length: edge.segs.reduce((n, [p, q]) => n + p.distanceTo(q), 0), ref: edge.index === undefined ? undefined : { body: edge.body, edge: edge.index } } } : {}),
        ...(straight ? { line: { at: a!.clone(), to: b!.clone() } } : {}),
        ...item,
        });
      });
    }
    const s = this.sketchShapeAt(e, hit);
    const sketch = s ? { sketch: { id: s.sketch.id, shape: s.q.id } } : {};
    if (hit) return this.endFacePick({ ...this.picked(hit), round: this.roundOf(hit), item: this.faceItem(hit), adds: role(e, 'add'), ...sketch });
    // a body cut open by a section: its cut face (only back faces are hit through it)
    const behind = this.intersect(this.raycaster(e))[0];
    const cut = behind && this.cutPlane(e);
    if (behind && cut) {
      const n = new THREE.Vector3(...cut.frame.n);
      const p = this.ray(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...cut.frame.o)), new THREE.Vector3());
      if (p) return this.endFacePick({ point: p, normal: n.negate(), body: behind.object.userData.bodyId, ...sketch });
    }
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    const k = this.facingAxis();
    this.endFacePick({ point: new THREE.Vector3(), normal: unit(k).multiplyScalar(Math.sign(look.getComponent(k)) || 1), ...sketch });
  }

  /**
   * A preview of a move by `by` (world, mm; null: back to where it was): the selected bodies move (`each`: by their
   * own, tool bodies by their owner's), translucent copies stay where they were; `shapes` show moved, their old
   * outlines grey.
   */
  previewMove(by: THREE.Vector3 | null, shapes: { id: string; profile: DrawnProfile }[] = [], across: { sketch: string; by: THREE.Vector3; bodies: string[] } | null = null, opacity = 0.25, each?: Map<string, THREE.Vector3>) {
    if (!this.moving && by) {
      const looks = [new THREE.MeshBasicMaterial({ color: 0x8a8f98, transparent: true, opacity, depthWrite: false }), new THREE.LineBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 2 * opacity })];
      this.moving = { from: new Map(), carried: new Map(), ghosts: new THREE.Group(), looks };
      this.scene.add(this.moving.ghosts);
      for (const id of this.withOwned(this.selection)) this.ghostAt(id, this.moving.from);
    }
    const m = this.moving;
    if (!m) return;
    const shift = (id: string) => {
      if (!by || !each) return by ?? new THREE.Vector3();
      let o: string | undefined = id;
      while (o && !each.has(o)) o = this.owners.get(o);
      return (o ? each.get(o) : undefined) ?? new THREE.Vector3();
    };
    for (const [id, at] of m.from) this.group(id).position.copy(at).add(shift(id));
    // a sketch moved across its plane: the bodies extruded from it (with their tool bodies) go along, a ghost stays
    const along = this.withOwned(across?.bodies ?? []);
    for (const id of along) if (!m.carried.has(id)) this.ghostAt(id, m.carried);
    for (const [id, at] of m.carried) this.group(id).position.copy(at).add(along.includes(id) ? across!.by : new THREE.Vector3());
    this.shifted = across && { sketch: across.sketch, by: across.by };
    this.overrides = new Map(shapes.map((q) => [q.id, q.profile]));
    if (!by) {
      m.ghosts.removeFromParent();
      for (const look of m.looks) look.dispose();
      this.moving = this.shifted = null;
    }
    this.renderSketches();
    this.applySection(false);
    this.render();
  }

  /** Keeps where a body is (in `at`) for the move preview, and a grey see-through copy there. */
  private ghostAt(id: string, at: Map<string, THREE.Vector3>) {
    const m = this.moving!;
    at.set(id, this.group(id).position.clone());
    const copy = this.group(id).clone(); // shares the geometry
    copy.traverse((o) => {
      if (o instanceof LineSegments2 || o instanceof THREE.Points || o instanceof THREE.Light) o.visible = false;
      else if (o instanceof THREE.LineSegments || o instanceof THREE.Mesh) [o.userData.own, o.material] = [o.material, m.looks[o instanceof THREE.Mesh ? 0 : 1]];
    });
    m.ghosts.add(copy);
  }

  /** The move preview's ghosts drawn as the bodies themselves (a copy stays behind), or grey and see-through. */
  ghostsWhole(on: boolean) {
    const m = this.moving;
    m?.ghosts.traverse((o) => o.userData.own && ((o as THREE.Mesh).material = on ? o.userData.own : m.looks[o instanceof THREE.Mesh ? 0 : 1]));
    this.render();
  }

  /** An inch or foot document: steps and grid in inches (see `nice`). */
  imperial = false;

  /**
   * The step a drag moves in near `at` (mm), which the grid shows: it grows with what the screen shows, as a power law
   * (about 1 mm at a normal zoom, 0.5 m with 20 m across the view), rounded as `nice`; Shift ten times (`coarse`: where
   * Shift is no constraint), Ctrl the minimum step.
   */
  step(at: THREE.Vector3, e?: ModEvent, coarse = true) {
    if (e && role(e, 'precise')) return this.minStep;
    const raw = 8.67 * (1 / this.pixelsPerMm(at)) ** 1.26;
    return Math.max(this.minStep, this.nice(raw) * (coarse && e && role(e, 'constrain') ? 10 : 1));
  }

  /**
   * `mm` rounded to a step: metric 1-2-5 mm; imperial halves of an inch down to 1/64", then 1", 2", 6", then feet
   * 1-2-5.
   */
  private nice(mm: number) {
    const tens = (v: number) => {
      const p = 10 ** Math.floor(Math.log10(v));
      const n = v / p;
      return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
    };
    if (!this.imperial) return tens(mm);
    const inches = mm / 25.4;
    if (inches < 0.75) return 25.4 * Math.max(1 / 64, 2 ** Math.round(Math.log2(inches)));
    if (inches < 9) return 25.4 * [1, 2, 6].reduce((a, b) => (Math.abs(Math.log(b / inches)) < Math.abs(Math.log(a / inches)) ? b : a));
    return 304.8 * tens(inches / 12);
  }

  /** How many grid steps from one stronger line to the next: metric every 5 (a 5 step: 10); imperial on whole quarters, feet or 5 / 10 ft. */
  private every(step: number) {
    const lead = (v: number) => Math.round(v / 10 ** Math.floor(Math.log10(v)));
    if (!this.imperial) return lead(step) === 5 ? 10 : 5;
    const inches = step / 25.4;
    if (inches < 1 - 1e-9) return 4;
    if (inches < 12 - 1e-9) return Math.round(12 / inches);
    return lead(inches / 12) === 5 ? 10 : 5;
  }

  /** How far the move preview has moved the selection (world mm; zero without one). */
  moved() {
    const m = this.moving;
    const [id, at] = m ? [...m.from][0] ?? [] : [];
    return id ? this.group(id).position.clone().sub(at!) : new THREE.Vector3();
  }

  /** Stops waiting for a face (as Esc does). */
  cancelFacePick() {
    if (this.facePick) this.endFacePick(null);
  }

  private endFacePick(face: PickedFace | null) {
    const done = this.facePick;
    this.facePick = null;
    this.faceAim = null;
    this.markSketch(null);
    this.markFace();
    if (this.pickParts) this.markEdge();
    if (this.pickPlanes) this.lightPlane(null);
    if (!this.tool) this.renderer.domElement.classList.remove('drawing');
    done?.(face);
  }

  /**
   * Shows the bodies clipped to the section boxes (an inverted axis shows both sides outside its range), one clipped
   * copy per box, with hatched caps on the cut faces: per plane, the solids' back faces minus their front faces mark
   * the cut area in the stencil buffer, then a plane fills it. `rebound`: measure the bodies again (not while dragging).
   * Planes sit `eps` inside the shown range, so a face lying exactly on a cut is cut away cleanly instead of flickering.
   */
  /** The bodies in the object list's order (top first): in a section, a body higher up covers those below where they overlap. */
  listOrder: string[] = [];

  /** The last section's materials: disposed a rebuild later, so the new ones (drawn by then) keep their compiled shaders. */
  private retired: THREE.Material[] = [];
  /** Where a section plane cuts each body: kept per body and plane until either changes. */
  private capCuts = new Map<string, { key: string; segs: [THREE.Vector3, THREE.Vector3][][] }>();
  private capCut(id: string, solid: THREE.Mesh, matrix: THREE.Matrix4, plane: THREE.Plane, others: THREE.Plane[]) {
    const at = `${plane.normal.toArray()} ${plane.constant}`;
    const key = `${solid.geometry.id} ${matrix.elements.join()} ${others.map((p) => [p.normal.toArray(), p.constant])}`;
    let kept = this.capCuts.get(`${id} ${at}`);
    if (kept?.key !== key) this.capCuts.set(`${id} ${at}`, (kept = { key, segs: planeCut(solid.geometry, matrix, plane, others) }));
    return kept.segs;
  }

  private applySection(rebound = true, cap = 1e4 /* mm, cap plane size */, hatchMm = 4, shade = 0.6, eps = 1e-3, line = 0x1d1f24) {
    for (const m of this.retired) m.dispose();
    this.retired = [];
    this.sectionView.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      this.retired.push(o.material as THREE.Material);
      if (o.userData.cap) o.geometry.dispose();
    });
    this.sectionView.clear();
    [this.cuts, this.cutPlanes] = [null, []];
    const axes = ['x', 'y', 'z'] as const;
    const active = this.custom.length > 0 || axes.some((a) => this.inverted[a] || this.sections[a].some(Number.isFinite));
    if (rebound) this.rebound();
    const spans = (a: Axis): Span[] => {
      const [lo, hi] = this.sections[a];
      return this.inverted[a] ? ([[-Infinity, lo], [hi, Infinity]] as Span[]).filter(([s, e]) => s < e) : [[lo, hi]];
    };
    this.boxes = active ? spans('x').flatMap((x) => spans('y').flatMap((y) => spans('z').map((z) => [x, y, z]))) : [];
    const sectioned = this.boxes.length > 0;
    for (const [id, g] of this.bodies) g.visible = !sectioned && !this.hidden.has(id);
    if (!sectioned) return this.render();

    this.hatch.repeat.set(cap / hatchMm, cap / hatchMm);
    let order = 0;
    for (const box of this.boxes) {
      // where it cuts (picked and outlined there); clipped `eps` further in
      const exact = box.flatMap(([lo, hi], k) => {
        const n = new THREE.Vector3().setComponent(k, 1);
        return [...(Number.isFinite(lo) ? [new THREE.Plane(n.clone(), -lo)] : []), ...(Number.isFinite(hi) ? [new THREE.Plane(n.clone().negate(), hi)] : [])];
      });
      exact.push(...this.custom.map((c) => c.clone()));
      const planes = exact.map((p) => new THREE.Plane(p.normal.clone(), p.constant - eps));
      this.cutPlanes.push(exact);
      // per plane each body's cut face in its colour, hatched, the list's last first; where an earlier one lies already
      // (stencil bit 0x80), half see-through over it: the colours mix
      const rank = (id: string) => (this.listOrder.indexOf(id) + 1 || Infinity);
      const shown = [...this.bodies]
        .flatMap(([id, g]) => {
          const solid = g.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
          return solid && !this.hidden.has(id) && !this.cutters.has(id) ? [{ id, g, solid }] : [];
        })
        .sort((a, b) => rank(b.id) - rank(a.id));
      // a box around each shown body: a plane caps only what it crosses, and what it cuts away wholly is not drawn
      const around = new Map(shown.map(({ id, g, solid }) => {
        if (!solid.geometry.boundingBox) solid.geometry.computeBoundingBox();
        g.updateMatrix();
        return [id, solid.geometry.boundingBox!.clone().applyMatrix4(g.matrix)];
      }));
      for (const plane of planes) {
        const others = planes.filter((p) => p !== plane);
        /** A sheet on the cut plane, drawn `sub` after this body's marks. */
        const sheet = (material: THREE.Material, sub: number) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(cap, cap), material);
          m.userData.cap = true;
          plane.coplanarPoint(m.position);
          m.lookAt(m.position.clone().sub(plane.normal));
          m.renderOrder = order + sub;
          this.sectionView.add(m);
          return m;
        };
        const stencil = (ref: number, func: THREE.StencilFunc, mask = 0xff, op: THREE.StencilOp = THREE.KeepStencilOp) =>
          ({ stencilWrite: true, stencilRef: ref, stencilFunc: func, stencilFuncMask: mask, stencilFail: THREE.KeepStencilOp, stencilZFail: op, stencilZPass: op }) as const;
        const segs: [THREE.Vector3, THREE.Vector3][] = [];
        let last: THREE.Mesh | null = null;
        for (const { id, g, solid } of shown) {
          if (!plane.intersectsBox(around.get(id)!)) continue;
          order++;
          // inside the body: its back faces beyond the plane minus its front faces there (low bits; 1 inside)
          for (const side of [THREE.BackSide, THREE.FrontSide]) {
            const op = side === THREE.BackSide ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
            const mark = new THREE.Mesh(
              solid.geometry,
              new THREE.MeshBasicMaterial({ side, clippingPlanes: [plane], colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilWriteMask: 0x7f, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op }),
            );
            mark.position.copy(g.position);
            mark.quaternion.copy(g.quaternion);
            mark.renderOrder = order;
            this.sectionView.add(mark);
          }
          const look = { color: (solid.material as THREE.MeshStandardMaterial).color.clone().multiplyScalar(shade), map: this.hatch, roughness: 0.9, clippingPlanes: others };
          sheet(new THREE.MeshStandardMaterial({ ...look, ...stencil(0x01, THREE.EqualStencilFunc) }), 0.2);
          // the canvas' alpha kept: else the page shows through
          sheet(new THREE.MeshStandardMaterial({ ...look, opacity: 0.5, blending: THREE.CustomBlending, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, ...stencil(0x81, THREE.EqualStencilFunc) }), 0.3);
          // where it lies now: bit 0x80 (its count cleared)
          last = sheet(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, ...stencil(0x80, THREE.NotEqualStencilFunc, 0x7f, THREE.ReplaceStencilOp) }), 0.4);
          g.updateMatrix();
          segs.push(...this.capCut(id, solid, g.matrix, plane, others).flat());
        }
        if (last) last.onAfterRender = (r) => r.clearStencil();
        // every body's cut outline, also where another covers it: a line where bodies meet
        if (segs.length) {
          // in front of the cap by a depth offset, on it at any zoom
          const m = new LineMaterial({ color: line, linewidth: 1.5, clippingPlanes: others, ...FRONT });
          m.resolution.set(this.el.clientWidth, this.el.clientHeight);
          const lines = new LineSegments2(new LineSegmentsGeometry().setPositions(segs.flatMap(([a, b]) => [...a.toArray(), ...b.toArray()])), m);
          lines.userData.cap = true;
          lines.renderOrder = order + 0.75;
          this.sectionView.add(lines);
        }
      }
      // the bodies clipped to this box, drawn after the caps
      const far = new THREE.Vector3();
      const goneIn = ({ min, max }: THREE.Box3) => planes.some((p) => p.distanceToPoint(far.set(p.normal.x > 0 ? max.x : min.x, p.normal.y > 0 ? max.y : min.y, p.normal.z > 0 ? max.z : min.z)) < 0);
      for (const [id, g] of this.bodies)
        for (const c of this.hidden.has(id) || (around.has(id) && goneIn(around.get(id)!)) ? [] : g.children) {
          const solid = c instanceof THREE.Mesh;
          if ((solid && this.cutters.has(id)) || c.userData.outline) continue;
          const material = ((c as THREE.Mesh).material as THREE.Material).clone();
          material.clippingPlanes = planes;
          const copy = solid ? new THREE.Mesh(c.geometry, material) : new THREE.LineSegments((c as THREE.LineSegments).geometry, material);
          copy.position.copy(g.position);
          copy.quaternion.copy(g.quaternion);
          copy.renderOrder = 1e6;
          copy.userData.bodyId = id; // its outline when selected
          this.sectionView.add(copy);
        }
    }
    this.render();
  }

  private group(id: string) {
    let group = this.bodies.get(id);
    if (!group) {
      group = new THREE.Group();
      this.bodies.set(id, group);
      this.scene.add(group);
    }
    return group;
  }

  private disposeChildren(group: THREE.Group) {
    for (const c of group.children) (c as THREE.Mesh).geometry?.dispose(); // a glow lamp has none
    group.clear();
  }

  /** World axis (0 x, 1 y, 2 z) closest to the viewing direction. */
  private facingAxis() {
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    const bodies = [look.x, look.y, look.z].map(Math.abs);
    return bodies.indexOf(Math.max(...bodies));
  }

  /** Top left of the view: Ortho / Persp and Fit (each 3D view has its own). */
  private cameraControls() {
    const button = (text: string, title: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, title, onclick });
    this.projection.className = 'segmented';
    this.projection.append(
      button('Ortho', 'Orthographic: no perspective distortion, sizes compare directly', () => this.pickProjection(true)),
      button('Persp', 'Perspective', () => this.pickProjection(false)),
    );
    this.projection.firstElementChild!.classList.add('on');
    const bar = Object.assign(document.createElement('div'), { className: 'overlay top-left' });
    // switches for the ground grid and the origin (remembered per browser)
    const toggle = (name: string, title: string, what: THREE.Object3D) => {
      const key = `makermaker.${name.toLowerCase()}`;
      what.visible = localStorage.getItem(key) !== 'off';
      const b = button('', title, () => {
        what.visible = !what.visible;
        localStorage.setItem(key, what.visible ? 'on' : 'off');
        b.classList.toggle('on', what.visible);
        this.render();
      });
      b.className = `switch${what.visible ? ' on' : ''}`;
      b.append(Object.assign(document.createElement('span'), { className: 'track' }), name);
      return b;
    };
    const more = button('+ View', 'Another view beside this one: its own camera (Top, Front, … or 3D), the same model; right-click a face: a view looking at it', () => this.addView('3d'));
    this.viewModes.append(...VIEW_MODES.map(([mode, text, title]) => Object.assign(new Option(text, mode, false, mode === this.viewMode), { title })));
    this.viewModes.title = 'Visual style: how the bodies are drawn';
    this.viewModes.onchange = () => this.setViewMode(this.viewModes.value as ViewMode);
    // the cog's floating panel: grid, origin, visual style
    const options = Object.assign(document.createElement('div'), { className: 'view-options', hidden: true });
    const style = Object.assign(document.createElement('label'), { className: 'style' });
    style.append('Visual style', this.viewModes);
    const head = Object.assign(document.createElement('div'), { className: 'head' });
    head.append(Object.assign(document.createElement('strong'), { textContent: 'View' }), closeButton('Close', () => (options.hidden = true)));
    options.append(head, toggle('Grid', 'Show or hide the ground grid', this.grid), toggle('Origin', 'Show or hide the origin axes', this.axes), style);
    const cog = Object.assign(button('', 'Click: View options: grid, origin, visual style', () => (options.hidden = !options.hidden)), { className: 'icon cog', innerHTML: icon('settings') });
    bar.append(this.projection, cog, more, options);
    return bar;
  }

  private rightPress: { x: number; y: number } | null = null;
  /** The wait before a right-click's face menu shows (0: none waiting): a second right press means its edge loop instead. */
  private faceMenu = 0;

  /** A right-click on a face (not a drag, no second press soon): a menu to look at that face, here or in a new view. */
  private rightUp(e: PointerEvent, ms = 300) {
    const at = this.rightPress;
    this.rightPress = null;
    if (!at || Math.hypot(e.clientX - at.x, e.clientY - at.y) > 4 || this.facePick) return;
    if (this.tool) return this.tool.rightClick?.(e);
    const hit = this.frontHit(e);
    if (!hit) return;
    const look = { n: hit.face!.normal.clone(), at: hit.point.clone() };
    this.faceMenu = window.setTimeout(() => {
      this.faceMenu = 0;
      const r = this.el.getBoundingClientRect();
      const menu = Object.assign(document.createElement('div'), { className: 'flyout menu face-menu' });
      menu.style.left = `${e.clientX - r.left}px`;
      menu.style.top = `${e.clientY - r.top}px`;
      const gone = () => (menu.remove(), removeEventListener('pointerdown', away, true));
      const away = (ev: Event) => !menu.contains(ev.target as Node) && gone();
      const item = (name: string, text: string, onclick: () => void) => Object.assign(document.createElement('button'), { className: 'menu-item', innerHTML: `${icon(name)}${text}`, onclick: () => (gone(), onclick()) });
      menu.append(item('look', 'Look at this face', () => this.lookAlong(look.n, look.at)), item('lookNew', 'Look at this face in new view', () => this.addView('face', look)));
      this.el.append(menu);
      addEventListener('pointerdown', away, true);
    }, ms);
  }

  /** Extra views beside this one (in #stage): each its own camera and controls on the same scene; editing stays here. */
  private views: { el: HTMLElement; renderer: THREE.WebGLRenderer; ortho: THREE.OrthographicCamera; persp: THREE.PerspectiveCamera; camera: THREE.Camera; controls: OrbitControls<THREE.Camera>; height: number; kind: ViewKind; look?: { n: THREE.Vector3; at: THREE.Vector3 }; setOrtho(on: boolean): void; live: LiveRender | null; setLive(on: boolean): void }[] = [];

  /** The light live renders take, and what they need from the app: whether the render queue is busy, keeping a picture. */
  liveHost: { light: Light; haze: { haze: number; fog: number }; queueBusy(): boolean; save(camera: CameraState, background: Backdrop, image: Blob, shot?: string): string } | null = null;
  /** The live render view touched last: the only one that renders (the others keep their picture). */
  private liveView: Viewer['views'][number] | null = null;

  /**
   * A new view: `kind` looks from that side (3D: from the front right, above), 'face': along `look.n` at `look.at`;
   * fitted to everything shown (`saved`: as it was instead). Its bar: Ortho | Persp; the side, ⇄ (swap it with this
   * view, to edit there); a read only note, close.
   */
  addView(kind: ViewKind, look?: { n: THREE.Vector3; at: THREE.Vector3 }, saved?: SavedView) {
    const stage = this.el.parentElement!;
    const el = Object.assign(document.createElement('div'), { className: 'view' });
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(this.renderer.getPixelRatio());
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
    const persp = new THREE.PerspectiveCamera(35, 1, 1, 50000);
    for (const c of [ortho, persp]) c.up.set(0, 0, 1);
    const view: Viewer['views'][number] = { el, renderer, ortho, persp, camera: ortho, controls: new OrbitControls(ortho as THREE.Camera, renderer.domElement), height: 400, kind, look, setOrtho: (on) => pick(on), live: null, setLive: (on) => live(on) };
    view.controls.zoomToCursor = true;
    this.sped(view.controls);
    view.controls.addEventListener('change', () => (this.renderView(view), view.live && this.restartLive(view)));
    // while it is turned, the plain view shows through
    view.controls.addEventListener('start', () => view.live && (view.live.picture.hidden = true));
    el.addEventListener('pointerdown', () => view.live && this.liveView !== view && ((this.liveView = view), view.live.stale && this.restartLive(view)));
    const sides: [ViewKind, string][] = [['3d', '3D'], ['top', 'Top'], ['front', 'Front'], ['right', 'Right'], ['back', 'Back'], ['left', 'Left'], ['bottom', 'Bottom'], ...(look ? [['face', 'Face'] as [ViewKind, string]] : [])];
    const side = Object.assign(document.createElement('select'), { title: 'Where it looks from' });
    side.append(...sides.map(([k, name]) => Object.assign(document.createElement('option'), { value: k, textContent: name, selected: k === kind })));
    side.onchange = () => {
      view.kind = side.value as ViewKind;
      this.aimView(view, view.kind, look);
    };
    const button = (text: string, title: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, title, onclick });
    const projection = Object.assign(document.createElement('span'), { className: 'segmented' });
    const pick = (on: boolean) => {
      const from = view.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera;
      const to = on ? ortho : persp;
      to.position.copy(from.position);
      to.quaternion.copy(from.quaternion);
      view.camera = view.controls.object = to;
      projection.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === on));
      this.renderView(view);
    };
    projection.append(button('Ortho', 'Orthographic', () => pick(true)), button('Persp', 'Perspective', () => pick(false)));
    projection.firstElementChild!.classList.add('on');
    // 3D view | Live render: path traced, starting again whenever something changes
    const mode = Object.assign(document.createElement('span'), { className: 'segmented' });
    const status = Object.assign(document.createElement('span'), { className: 'read-only' });
    const save = button('Save', 'Keep this picture: into the renders (once; again: a new version of it) and saved (Downloads or the render folder)', () => {
      const l = view.live;
      if (l?.image && this.liveHost) l.shot = this.liveHost.save(this.viewCamera(view), l.background ?? this.backdropColours(), l.image, l.shot);
    });
    save.className = 'primary';
    const live = (on: boolean) => {
      mode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 1) === on));
      if (!on) {
        view.live?.picture.remove();
        view.live = null;
        if (this.liveView === view) this.liveView = null;
        status.textContent = 'read only';
        save.hidden = true;
        return;
      }
      if (view.live) return;
      view.live = { gen: 0, timer: 0, stale: false, picture: Object.assign(document.createElement('div'), { className: 'live' }), status, save };
      el.append(view.live.picture);
      this.liveView = view;
      this.restartLive(view);
    };
    mode.append(button('3D view', 'The model as you edit it', () => live(false)), button('Live render', 'Path traced, starting again whenever the model, the camera or the light changes; Save keeps the picture', () => live(true)));
    mode.firstElementChild!.classList.add('on');
    save.hidden = true;
    const bar = Object.assign(document.createElement('div'), { className: 'view-bar' });
    const middle = Object.assign(document.createElement('span'), { className: 'middle' });
    middle.append(
      mode,
      side,
      button('⇄', 'Edit here: this view and the main one swap cameras', () => this.swapView(view)),
    );
    const right = Object.assign(document.createElement('span'), { className: 'right' });
    right.append(
      Object.assign(status, { textContent: 'read only', title: 'Editing happens in the main view: ⇄ brings this view there' }),
      save,
      closeButton('Close this view', () => {
        live(false);
        this.views = this.views.filter((v) => v !== view);
        view.controls.dispose();
        renderer.dispose();
        el.remove();
        this.placeViews();
      }),
    );
    bar.append(projection, middle, right);
    el.append(bar, renderer.domElement);
    stage.append(el);
    this.views.push(view);
    this.placeViews();
    if (saved) {
      view.setOrtho(saved.ortho);
      for (const c of [ortho, persp]) c.position.set(...saved.position);
      view.controls.target.set(...saved.target);
      view.height = saved.height;
      ortho.zoom = saved.zoom;
      view.controls.update();
      if (saved.live) live(true);
    } else this.aimView(view, kind, look);
    return view;
  }

  /** An extra view's camera as a render takes it, at the size it shows. */
  private viewCamera(view: Viewer['views'][number]): CameraState {
    const bar = (view.el.querySelector('.view-bar') as HTMLElement).offsetHeight;
    const cam = view.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera;
    return {
      ortho: cam === view.ortho,
      position: cam.position.toArray(),
      target: view.controls.target.toArray(),
      up: cam.up.toArray(),
      fov: view.persp.fov,
      height: (view.ortho.top - view.ortho.bottom) / view.ortho.zoom,
      size: [view.el.clientWidth, view.el.clientHeight - bar],
    };
  }

  /** Something a render shows changed: the live render view touched last starts again, the others when touched. */
  liveChanged() {
    for (const v of this.views) if (v.live && this.liveKey(v) !== v.live.key) v === this.liveView ? this.restartLive(v) : (v.live.stale = true);
  }

  /** What a live view's picture is made of besides its camera: it renders again only when this changes. */
  private liveKey(view: Viewer['views'][number]) {
    const bodies = [...this.bodies].flatMap(([id, g]) => {
      const solid = g.children[0] as THREE.Mesh | undefined;
      return !solid || this.hidden.has(id) || this.cutters.has(id) ? [] : [[id, solid.geometry.uuid, g.matrixWorld.elements, this.looks.get(id)]];
    });
    const images = this.imageMark.children.flatMap((o) => {
      if (!(o instanceof THREE.Mesh)) return [];
      const { map, opacity } = o.material as THREE.MeshBasicMaterial;
      return [[map?.uuid, opacity, (o.geometry as THREE.PlaneGeometry).parameters, o.matrix.elements]];
    });
    return JSON.stringify([bodies, images, this.liveHost?.light, this.liveHost?.haze, view.live?.background ?? this.backdropColours()]);
  }

  /** Whether a live render is under way (the render queue waits for it). */
  liveRendering() {
    return this.views.some((v) => v.live?.running);
  }

  /**
   * "See in live render": a live render view with `camera` and `background` (the one there, else a new view), Save
   * adding to render `shot`.
   */
  showLive(camera: CameraState, background: Backdrop, shot: string) {
    const view = this.views.find((v) => v.live) ?? this.addView('3d');
    view.setOrtho(camera.ortho);
    for (const c of [view.ortho, view.persp]) c.position.set(...camera.position);
    view.controls.target.set(...camera.target);
    view.height = camera.ortho ? camera.height : view.height;
    view.ortho.zoom = 1;
    view.controls.update();
    view.setLive(true);
    Object.assign(view.live!, { background, shot });
    this.liveView = view;
    this.restartLive(view);
  }

  /** Starts live render view `view` again, a moment after the last change (`ms`), the picture so far shown meanwhile. */
  private restartLive(view: Viewer['views'][number], ms = 400, samples = 256) {
    const l = view.live;
    if (!l) return;
    clearTimeout(l.timer);
    const gen = ++l.gen;
    Object.assign(l, { image: undefined, stale: false, key: this.liveKey(view) });
    l.save.hidden = true;
    l.status.textContent = 'Waiting';
    l.timer = window.setTimeout(async () => {
      if (view.live !== l || l.gen !== gen) return;
      if (this.liveHost?.queueBusy()) return ((l.status.textContent = 'Waiting for the render queue'), this.restartLive(view, 1000));
      const host = this.liveHost;
      if (!host) return;
      l.running = true;
      l.picture.hidden = false;
      l.picture.style.top = `${(view.el.querySelector('.view-bar') as HTMLElement).offsetHeight}px`;
      l.picture.style.background = backdropCss(l.background ?? this.backdropColours());
      try {
        const image = await this.renderNice(this.viewCamera(view), l.background ?? this.backdropColours(), host.light, host.haze, samples, {
          show: (canvas) => l.picture.replaceChildren(canvas),
          progress: (done) => (l.status.textContent = `${Math.round(done * samples)} / ${samples}`),
          cancelled: () => view.live !== l || l.gen !== gen,
          slow: () => false,
        });
        l.image = image;
        l.status.textContent = 'Done';
        l.save.hidden = false;
        const img = Object.assign(document.createElement('img'), { src: URL.createObjectURL(image), alt: 'Live render' });
        img.onload = () => URL.revokeObjectURL(img.src);
        l.picture.replaceChildren(img);
      } catch (err) {
        if (view.live === l && l.gen === gen) l.status.textContent = (err as Error).message;
      } finally {
        l.running = false;
      }
    }, ms);
  }

  /** The borders between the views, by where they lie. */
  private viewLayout: ViewLayout = newViewLayout();
  private viewBorders: HTMLElement[] = [];

  /** Puts the views where the layout says; the borders follow (new ones when their number changed). */
  private placeViews() {
    const n = this.views.length + 1;
    const stage = this.el.parentElement!;
    const place = (el: HTMLElement, p: { x: number; y: number; w: number; h: number }) => {
      el.style.left = `${p.x * 100}%`;
      el.style.top = `${p.y * 100}%`;
      el.style.width = Number.isNaN(p.w) ? '' : `${p.w * 100}%`;
      el.style.height = Number.isNaN(p.h) ? '' : `${p.h * 100}%`;
    };
    panes(n, this.viewLayout).forEach((p, i) => place(i ? this.views[i - 1].el : this.el, p));
    const list = borders(n, this.viewLayout);
    if (list.length !== this.viewBorders.length) {
      for (const b of this.viewBorders) b.remove();
      this.viewBorders = list.map((_, i) => {
        const el = Object.assign(document.createElement('div'), { title: 'Drag to resize the views' });
        el.onpointerdown = (e) => this.dragViewBorder(e, el, i);
        stage.append(el);
        return el;
      });
    }
    list.forEach((b, i) => {
      const el = this.viewBorders[i];
      el.className = `view-border ${b.kind}`;
      place(el, b.kind === 'column' ? { x: b.at, y: 0, w: NaN, h: 1 } : { x: b.from, y: b.at, w: b.to - b.from, h: NaN });
    });
    this.render();
  }

  /** Drags border number `i`: its views change size as it goes; saved when let go. */
  private dragViewBorder(down: PointerEvent, el: HTMLElement, i: number) {
    down.preventDefault();
    el.setPointerCapture(down.pointerId);
    el.classList.add('dragged');
    const box = this.el.parentElement!.getBoundingClientRect();
    const border = borders(this.views.length + 1, this.viewLayout)[i] as ViewBorder;
    el.onpointermove = (e) => {
      const at = border.kind === 'column' ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height;
      this.viewLayout = dragged(this.viewLayout, border, at);
      this.placeViews();
      el.classList.add('dragged');
    };
    el.onpointerup = () => {
      el.onpointermove = el.onpointerup = null;
      el.classList.remove('dragged');
    };
  }

  /** How the document is looked at now: the main camera, the extra views and their borders (for its file). */
  viewsState(): Views {
    return {
      camera: this.cameraState(1),
      layout: this.viewLayout,
      views: this.views.map((v): SavedView => {
        const cam = v.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera;
        return { kind: v.kind, look: v.look && { n: v.look.n.toArray(), at: v.look.at.toArray() }, ortho: cam === v.ortho, position: cam.position.toArray(), target: v.controls.target.toArray(), height: v.height, zoom: v.ortho.zoom, ...(v.live ? { live: true } : {}) };
      }),
    };
  }

  /** The views of an opened document (none: the main one alone); false: it had none saved, so the view is free to fit. */
  setViews(state?: Views) {
    for (const v of this.views) (v.controls.dispose(), v.renderer.dispose(), v.el.remove());
    this.views = [];
    this.viewLayout = state?.layout ?? newViewLayout();
    for (const v of state?.views ?? []) this.addView(v.kind as ViewKind, v.look && { n: new THREE.Vector3(...v.look.n), at: new THREE.Vector3(...v.look.at) }, v);
    this.placeViews();
    if (state) this.setCameraState(state.camera);
    return !!state;
  }

  /** A view looking from `kind`'s side (see `addView`) at everything shown, fitted. */
  private aimView(view: Viewer['views'][number], kind: ViewKind, look?: { n: THREE.Vector3; at: THREE.Vector3 }) {
    const box = this.allBox();
    const centre = look?.at ?? (box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()));
    const size = box.isEmpty() ? 200 : box.getSize(new THREE.Vector3()).length();
    const from = { '3d': [1, -1, 0.8], top: [0, -1e-3, 1], bottom: [0, -1e-3, -1], front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0], face: look?.n.toArray() ?? [0, 0, 1] }[kind] as Vec3;
    const dir = new THREE.Vector3(...from).normalize();
    view.height = size * 1.1;
    view.ortho.zoom = 1;
    view.controls.target.copy(centre);
    for (const c of [view.ortho, view.persp]) c.position.copy(centre).addScaledVector(dir, size * 1.6);
    view.controls.update();
    this.renderView(view);
  }

  /** This view and `view` swap cameras: editing goes on from that angle here. */
  private swapView(view: Viewer['views'][number]) {
    const here = this.cameraState();
    const cam = view.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera;
    const ortho = cam === view.ortho;
    this.setCameraState({ ...here, ortho, position: cam.position.toArray(), target: view.controls.target.toArray(), height: view.height / view.ortho.zoom });
    // the view takes the main camera
    view.camera = view.controls.object = here.ortho ? view.ortho : view.persp;
    view.el.querySelectorAll('.segmented button').forEach((b, i) => b.classList.toggle('on', (i === 0) === here.ortho));
    view.el.querySelector('select')!.value = view.kind = '3d'; // the main camera: free
    (view.camera as THREE.Camera).position.set(...here.position);
    view.controls.target.set(...here.target);
    view.height = here.height;
    view.ortho.zoom = 1;
    view.controls.update();
    this.renderView(view);
  }

  /** Draws an extra view at its size now. */
  private renderView(view: Viewer['views'][number]) {
    const canvas = view.renderer.domElement;
    const [w, h] = [canvas.parentElement!.clientWidth, canvas.parentElement!.clientHeight - (view.el.querySelector('.view-bar') as HTMLElement).offsetHeight];
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * view.renderer.getPixelRatio()) || canvas.height !== Math.round(h * view.renderer.getPixelRatio())) view.renderer.setSize(w, h);
    const aspect = w / h;
    Object.assign(view.ortho, { left: (-view.height / 2) * aspect, right: (view.height / 2) * aspect, top: view.height / 2, bottom: -view.height / 2 });
    view.ortho.updateProjectionMatrix();
    view.persp.aspect = aspect;
    fitDepth(view.persp, view.controls.target);
    fitOrthoDepth(view.ortho, this.shownBox());
    view.persp.updateProjectionMatrix();
    // a view has a renderer of its own: the photo's picture is the main view's, and from its camera
    const background = this.scene.background;
    if (this.photo) this.scene.background = new THREE.Color(this.solidGrey());
    view.renderer.render(this.scene, view.camera);
    this.scene.background = background;
  }

  /** A projection chosen by hand stays when leaving a cube side. */
  private pickProjection(on: boolean) {
    this.autoOrtho = false;
    this.setOrthographic(on);
  }

  /**
   * Whether `solid` (world; `inner`: a point inside it) and body `id` share volume: their surfaces cross, or one lies
   * inside the other (a ray from a point inside crosses the other's surface an odd number of times).
   */
  overlaps(id: string, solid: THREE.BufferGeometry, inner: THREE.Vector3, dir = new THREE.Vector3(0.577, 0.578, 0.576).normalize()) {
    const meshes = (this.bodies.get(id)?.children ?? []).filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    const within = (tree: MeshBVH, p: THREE.Vector3) => tree.raycast(new THREE.Ray(p, dir), THREE.DoubleSide).length % 2 === 1;
    const own = new MeshBVH(solid);
    return meshes.some((m) => {
      const g = m.geometry;
      const tree = (g.boundsTree ??= new MeshBVH(g, { indirect: true })) as MeshBVH; // as pick.ts builds it
      const toLocal = m.matrixWorld.clone().invert();
      const corner = new THREE.Vector3().fromBufferAttribute(g.attributes.position, 0).applyMatrix4(m.matrixWorld);
      return tree.intersectsGeometry(solid, toLocal) || within(tree, inner.clone().applyMatrix4(toLocal)) || within(own, corner);
    });
  }

  /** Solids of the shown bodies (also while a section draws clipped copies instead). */
  private meshes() {
    return [...this.bodies].flatMap(([id, g]) => (this.hidden.has(id) ? [] : g.children.filter((c) => c instanceof THREE.Mesh)));
  }

  private raycaster(e: MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return ray;
  }

  /**
   * A handle of the single selected shape starts resizing or turning it. Pressing a shape or a body selects it (Shift:
   * adds or removes, no move) and readies a move of the selection.
   */
  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const ray = this.raycaster(e);
    this.pick = ray.ray.clone();
    if (this.startHandle(e)) return;
    const hit = this.focus ? undefined : this.intersect(ray)[0]; // an open sketch group: faded bodies are not picked
    const shape = this.shapeAt(ray.ray, hit?.distance);
    this.downOnPart = !!hit || !!shape;
    if (this.downOnPart) this.host.touched();
    if (!toggles(e) && this.startImageEdit(e, ray.ray, hit)) {
      this.downOnPart = true;
      return;
    }
    // an image not selected yet: a click selects it (a toggle adds it or takes it away)
    const picture = !shape && !this.facePick ? this.imageAt(e, hit) : null;
    if (picture) {
      this.downOnPart = true;
      this.host.select(picture.id, toggles(e));
      return;
    }
    // a work plane in front of the body there: a click selects it (Tab: what lies behind it)
    const plane = !shape && !this.facePick ? this.workPlaneAt(e, hit) : null;
    if (plane) {
      this.downOnPart = true;
      this.host.select(plane.id, toggles(e));
      return;
    }
    if (hit?.face && hit.face.normal.dot(ray.ray.direction) < 0) {
      this.lastFace = this.picked(hit);
      this.lastHit = hit;
    }
    if (shape) {
      if (toggles(e)) return this.host.pickShape(shape.sketch, shape.shape, true);
      const member = this.activeSketch === shape.sketch && this.selectedShapes.includes(shape.shape);
      if (!member) this.host.pickShape(shape.sketch, shape.shape, false);
      return this.startShapeMove(ray.ray, shape.sketch, member && this.selectedShapes.length > 1 ? shape.shape : null, e);
    }
    if (picksFace(e)) {
      // a double press: the tangent chain
      const loop = this.twice('pick', e) ? this.edgeLoop(e) : null;
      if (loop) return this.host.select(loop.body, false), this.pickEdges(loop);
      // an edge near the pointer, else the face: its body selected and the part picked (a face: E pulls it, S sketches on it);
      // Shift adds it to (or takes it from) the parts picked: edges on that body, faces on any body (all selected)
      // on a fillet's or chamfer's face (before its edges): that part of the finish selected, as a plain click does (Del
      // leaves its edge out); pressed again, its size drags
      const finish = !role(e, 'add') && hit && this.finishAt(hit);
      if (finish) {
        const id = hit!.object.userData.bodyId as string;
        if (this.finishSel?.body === id && this.finishSel.feature === finish.feature) return this.host.dragFinish(id, finish.feature, hit!.point.clone()), void (this.toolPress = !!this.tool);
        return this.host.select(id, false), this.host.pickFinish({ body: id, ...finish });
      }
      const edge = this.edgeAt(e);
      if (!edge && !hit) return;
      this.downOnPart = true; // an edge on the outline, the body itself missed: the release must not clear it
      const body = edge?.body ?? (hit!.object.userData.bodyId as string);
      // what is picked already (selecting below starts over)
      const [edges, faces] = [this.pickedEdge?.body === body ? this.pickedEdge.edges : [], this.pickedFaces];
      if (edge || !role(e, 'add') || !faces.length) this.host.select(body, false);
      else if (!this.selection.includes(body)) this.host.select(body, true);
      if (edge) {
        const had = role(e, 'add') ? edges : [];
        const same = (segs: [THREE.Vector3, THREE.Vector3][]) => segs.length === edge.segs.length && segs[0][0].distanceTo(edge.segs[0][0]) < 1e-6;
        return this.pickEdges({ body, edges: had.some(same) ? had.filter((x) => !same(x)) : [...had, edge.segs] });
      }
      const [mesh, k] = [hit!.object as THREE.Mesh, faceOf(hit!)];
      const had = role(e, 'add') ? faces : [];
      const on = had.find((p) => p.mesh === mesh);
      if (!on) return this.pickFaces([...had, { mesh, faces: [k] }]);
      return this.pickFaces(had.map((p) => (p === on ? { mesh, faces: on.faces.includes(k) ? on.faces.filter((x) => x !== k) : [...on.faces, k] } : p)));
    }
    // pressing a picked edge drags a fillet (up) or chamfer (down) onto the picked edges
    const near = this.pickedEdge && !toggles(e) ? this.edgeAt(e) : null; // a section's cut outline only measures: no finish from it
    if (near && !near.cut && this.pickedEdge!.edges.some((segs) => segs[0][0].distanceTo(near.segs[0][0]) < 1e-6)) {
      const { body, edges } = this.pickedEdge!;
      this.dropPicked(); // they turn into the finish
      this.host.dragEdges(body, edges);
      this.toolPress = !!this.tool; // the drag tool gets the release
      return;
    }
    if (!hit) return;
    const id = hit.object.userData.bodyId as string;
    if (toggles(e)) return this.host.select(id, true);
    const member = this.selection.includes(id);
    if (!member) this.host.select(id, false);
    if (!this.selection.includes(id)) return; // the click went to a tool (deleted it, say)
    const f = this.finishAt(hit);
    // pressing a picked finish's face again drags its size (below 0: the other kind)
    if (f && this.finishSel?.body === id && this.finishSel.feature === f.feature) {
      this.host.dragFinish(id, f.feature, hit.point.clone());
      this.toolPress = !!this.tool; // the drag tool gets the release
      return;
    }
    this.host.pickFinish(f && { body: id, ...f });
    const start = hit.point.clone();
    this.startDrag(e, ray.ray, start, {
      axes: [0, 1, 2],
      lead: this.group(this.withOwned(this.selection)[0]).position.clone(),
      // the base plane facing the camera most (top view: XY, front: XZ, side: YZ)
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(this.facingMove(), start),
      only: member && this.selection.length > 1 ? id : null,
      apply: (by) => this.dragIntoFields(by),
      end: () => {},
    });
  }

  /** A drag's first step opens the move fields; the drag then writes them (they show it moved, kept off normal `n`), Enter or ✓ there moves. */
  private dragIntoFields(by: THREE.Vector3, n?: THREE.Vector3) {
    const close = this.host.dragMove();
    const d = this.drag!;
    d.apply = (b) => {
      const v = this.inAxes(n ? b.clone().projectOnPlane(n) : b);
      [0, 1, 2].forEach((k) => this.gizmo?.set(k, v.getComponent(k)));
    };
    d.end = (b) => void (!b?.lengthSq() && close()); // let go where it started: no move
    d.apply(by);
  }

  /** Readies a move of the selected shapes of `sketch` within its plane (along its two axes). */
  private startShapeMove(ray: THREE.Ray, sketch: string, only: string | null, e: PointerEvent) {
    const s = this.sketches.find((v) => v.id === sketch)!;
    const f = s.frame;
    const [fx, fy] = [new THREE.Vector3(...f.x), new THREE.Vector3(...f.y)];
    const from = s.shapes.filter((q) => this.selectedShapes.includes(q.id));
    const start = planeHit(ray, f) ?? new THREE.Vector3(...f.o);
    const strongest = (v: THREE.Vector3) => [v.x, v.y, v.z].map(Math.abs).reduce((best, c, k, a) => (c > a[best] ? k : best), 0);
    this.startDrag(e, ray, start, {
      axes: [strongest(fx), strongest(fy)],
      lead: new THREE.Vector3(...toWorld(f, ...centre(from[0]))),
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), start),
      only,
      apply: (by) => this.dragIntoFields(by, new THREE.Vector3(...f.n)), // in its plane: a slanted one's axes leave it
      end: () => {},
    });
  }

  /** A press on a handle starts dragging it. True: it did. */
  private startHandle(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    const grab = this.handles().find((h) => {
      const [x, y] = this.toScreen(h.world);
      return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8;
    });
    if (!grab) return false;
    this.downAt = { x: e.clientX, y: e.clientY };
    const q0 = uvOf(grab.sketch.frame, planeHit(this.raycaster(e).ray, grab.sketch.frame) ?? grab.world);
    const h = grab.handle;
    this.edit = { sketch: grab.sketch, start: grab.shape, handle: h, q0, a0: angleAt(grab.shape, q0), typed: [], axis: h.kind === 'resize' && !h.sx ? 1 : 0, last: null, next: null };
    this.downOnPart = true;
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    return true;
  }

  private startDrag(e: PointerEvent, ray: THREE.Ray, start: THREE.Vector3, o: Pick<Drag, 'axes' | 'lead' | 'plane' | 'only' | 'apply' | 'end'>) {
    this.controls.enabled = false;
    this.drag = { ...o, start, t0: [0, 1, 2].map((k) => along(ray, start, this.axisDir(k))), axis: null, typed: undefined, last: null, moved: false, by: new THREE.Vector3() };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (this.edit) {
      this.edit.last = e;
      return this.applyEdit(this.edit);
    }
    const d = this.drag;
    if (!d) {
      // a left drag without modifiers rotates: that leaves the side view the cube set up
      if (e.buttons === 1 && !toggles(e) && this.dragged(e)) this.leaveSideView();
      return;
    }
    if (!d.moved && !this.dragged(e)) return;
    d.moved = true;
    d.last = e;
    this.applyDrag(d);
  }

  /**
   * Moves the dragged bodies together: inside the dead zone they stay put and the axis is free; leaving it picks the axis
   * whose spoke points most along the drag, kept until the pointer comes back through. A typed distance moves exactly
   * that far (in the direction dragged); else the first body lands on the snap step (Ctrl). Alt: free in the plane.
   */
  private applyDrag(d: Drag) {
    const e = d.last!;
    this.placeWheel();
    const ray = this.raycaster(e).ray;
    const typed = d.typed === undefined ? null : this.host.length(d.typed);
    let delta: THREE.Vector3 | null = new THREE.Vector3();
    let text: string;
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < this.deadPx) {
      d.axis = null;
      text = 'pick a direction';
    } else {
      d.axis ??= this.wheelAxis(e, d.start);
      const pulled = along(ray, d.start, this.axisDir(d.axis)) - d.t0[d.axis];
      delta = this.axisDir(d.axis).multiplyScalar(typed === null ? pulled : typed * (Math.sign(pulled) || 1));
      text = 'XYZ'[d.axis];
    }
    choose(this.wheel, d.axis);
    if (delta) {
      const step = this.step(d.start, e);
      // on the step in the move axes (inside a turned group: its own)
      const [lead, dl] = [this.inAxes(d.lead), this.inAxes(delta)];
      d.by =
        (typed !== null && d.axis !== null) || !delta.lengthSq()
          ? delta
          : new THREE.Vector3(round(lead.x + dl.x, step) - lead.x, round(lead.y + dl.y, step) - lead.y, round(lead.z + dl.z, step) - lead.z).applyQuaternion(this.frameTurn);
      d.apply(d.by);
      if (d.axis !== null) text += ` ${d.typed === undefined ? this.host.format(d.by.getComponent(d.axis)) : caret(d.typed)}`;
    }
    this.label(text, d.start);
  }

  /** `sizes`: L / W / H in it are a shape's length, width, height (coloured as X / Y / Z). */
  private label(text: string, at: THREE.Vector3, sizes = false) {
    const [x, y] = this.toScreen(at);
    Object.assign(this.moveLabel, { hidden: false, innerHTML: sizes ? sizeHtml(caretHtml(text), true) : axisHtml(caretHtml(text)) });
    keepInside(this.moveLabel, x + 60, y + 40);
  }

  /** Resizes (incase-style: Alt from the middle, Shift proportional, Ctrl precise, typed sizes) or turns (1°; Shift 15°, Ctrl 0.1°) the shape. */
  private applyEdit(ed: ShapeEdit) {
    const e = ed.last;
    const f = ed.sketch.frame;
    const p = e && planeHit(this.raycaster(e).ray, f);
    const q = p ? uvOf(f, p) : ed.q0;
    const st = ed.start;
    const world = new THREE.Vector3(...toWorld(f, ...centre(st)));
    if (ed.handle.kind === 'centre') {
      if (st.kind !== 'polygon' && st.kind !== 'line') return;
      const d = ed.typed[0] === undefined ? undefined : (this.host.length(ed.typed[0]) ?? undefined);
      ed.next = centreMoved(st, ed.handle.i, q, d === undefined ? undefined : d / 2, this.step(world, e ?? undefined, false));
      this.arcLabel(ed);
    } else if (ed.handle.kind === 'point' || ed.handle.kind === 'control') {
      if (st.kind !== 'polygon' && st.kind !== 'line') return;
      let at = this.handleLands(ed, q, e);
      if (ed.handle.kind === 'control' && ed.handle.which !== 'mid' && (ed.armed || ed.typed.some((t) => t !== undefined))) {
        // typed: its length and angle from its point
        const b = bakeTurn(st);
        const o = b.pts[ed.handle.which === 'c1' ? ed.handle.i : (ed.handle.i + 1) % b.pts.length];
        const l = ed.typed[0] === undefined ? null : this.host.length(ed.typed[0]);
        const deg = ed.typed[1] === undefined ? null : this.host.number(ed.typed[1]);
        const length = l ?? Math.hypot(at[0] - o[0], at[1] - o[1]);
        const angle = deg === null ? Math.atan2(at[1] - o[1], at[0] - o[0]) : (deg * Math.PI) / 180;
        at = [o[0] + length * Math.cos(angle), o[1] + length * Math.sin(angle)];
        ed.next = controlMoved(st, ed.handle.i, ed.handle.which, at);
        const body = (k: number, name: string, text: string) => `${name}${k === ed.axis ? '▸' : ' '}${ed.typed[k] === undefined ? text : caret(ed.typed[k]!)}`;
        this.label(`${body(0, 'L', this.host.format(length))}   ${body(1, '∠', ((angle * 180) / Math.PI).toFixed(1))}`, new THREE.Vector3(...toWorld(f, ...at)));
      } else ed.next = ed.handle.kind === 'point' ? pointMoved(st, ed.handle.i, at) : controlMoved(st, ed.handle.i, ed.handle.which, at);
    } else if (ed.handle.kind === 'rotate') {
      const deg = angleAt(st, q) - ed.a0;
      const turn = e && role(e, 'precise') ? 0.1 : e && role(e, 'constrain') ? SketchTool.angleStep : 1; // degrees
      const angle = Math.round(deg / turn) * turn;
      ed.next = rotated(st, angle);
      this.showTicks({ at: world, dir: new THREE.Vector3(...f.n), from: new THREE.Vector3(...toWorld(f, ...ed.q0)), step: SketchTool.angleStep, angle, rays: !!e && role(e, 'constrain') });
    } else {
      const typed = ed.typed.map((t) => (t === undefined ? undefined : (this.host.length(t) ?? undefined))) as [number | undefined, number | undefined];
      ed.next = resized(st, ed.handle, ed.q0, q, { alt: !!e && role(e, 'centre'), shift: !!e && role(e, 'constrain'), step: this.step(world, e ?? undefined, false), typed });
      const [w, h] = sizeOf(ed.next);
      const body = (k: number, name: string, mm: number) => `${name}${k === ed.axis ? '▸' : ' '}${ed.typed[k] === undefined ? this.host.format(mm) : caret(ed.typed[k]!)}`;
      this.label(st.kind === 'circle' ? body(ed.axis, 'Ø', w) : `${body(0, 'L', w)}   ${body(1, 'W', h)}`, world, true);
    }
    this.overrides.set(st.id, ed.next);
    this.renderSketches();
  }

  /** The diameter being set, at the arc's middle. */
  private arcLabel(ed: ShapeEdit) {
    const s = ed.next ?? ed.start;
    if (ed.handle.kind !== 'centre' || (s.kind !== 'polygon' && s.kind !== 'line')) return;
    const q = bakeTurn(s);
    const c = q.curves?.[ed.handle.i];
    const arc = c && 'mid' in c ? arcOf(q.pts[ed.handle.i], c.mid, q.pts[(ed.handle.i + 1) % q.pts.length]) : null;
    if (arc) this.label(`Ø ${ed.typed[0] === undefined ? this.host.format(arc.r * 2) : caret(ed.typed[0])}`, new THREE.Vector3(...toWorld(ed.sketch.frame, ...arc.c)));
  }

  /**
   * Where a dragged point or curve handle lands: on a sketch's point within 10 px (a point: not its own shape's), else
   * on the zoom's step (Ctrl: the minimum step); Shift: a curve handle turns in the angle step around its point.
   */
  private handleLands(ed: ShapeEdit, q: [number, number], e: PointerEvent | null): [number, number] {
    const f = ed.sketch.frame;
    const world = new THREE.Vector3(...toWorld(f, ...q));
    const r = this.el.getBoundingClientRect();
    if (e) {
      const others = this.sketches.map((s) => ({ ...s, shapes: s.shapes.filter((p) => p.id !== ed.start.id) }));
      const near = linePoints(snapLines(others, [])).find(({ at }) => {
        const [x, y] = this.toScreen(at);
        return Math.abs(at.clone().sub(new THREE.Vector3(...f.o)).dot(new THREE.Vector3(...f.n))) < 1e-3 && Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 10;
      });
      if (near) return uvOf(f, near.at);
    }
    const step = this.step(world, e ?? undefined, false);
    if (ed.handle.kind === 'control' && ed.handle.which !== 'mid' && e && role(e, 'constrain') && (ed.start.kind === 'polygon' || ed.start.kind === 'line')) {
      const s = bakeTurn(ed.start);
      const o = s.pts[ed.handle.which === 'c1' ? ed.handle.i : (ed.handle.i + 1) % s.pts.length];
      const by = (SketchTool.angleStep * Math.PI) / 180;
      const a = Math.round(Math.atan2(q[1] - o[1], q[0] - o[0]) / by) * by;
      const l = Math.round(Math.hypot(q[0] - o[0], q[1] - o[1]) / step) * step;
      return [o[0] + l * Math.cos(a), o[1] + l * Math.sin(a)];
    }
    return [Math.round(q[0] / step) * step, Math.round(q[1] / step) * step];
  }

  /** Keys while resizing: typing sets the size of the marked axis, Tab the other one, Enter keeps, Esc undoes. */
  private editKey(e: KeyboardEvent): boolean {
    const ed = this.edit!;
    if (pressed(e, 'confirm') || pressed(e, 'cancel')) return this.endEdit(pressed(e, 'confirm')), true;
    const handleTyped = ed.handle.kind === 'control' && ed.handle.which !== 'mid';
    if (ed.handle.kind !== 'resize' && ed.handle.kind !== 'centre' && !handleTyped) return false;
    if (pressed(e, 'otherSide') && restOf(ed.typed[ed.axis] ?? '')) ed.typed[ed.axis] += restOf(ed.typed[ed.axis]!); // a name showing: written out
    else if (pressed(e, 'otherSide') && (ed.handle.kind === 'resize' || handleTyped)) ed.axis = 1 - ed.axis;
    else if (pressed(e, 'erase')) ed.typed[ed.axis] = ed.typed[ed.axis]?.slice(0, -1) || undefined;
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) ed.typed[ed.axis] = (ed.typed[ed.axis] ?? '') + e.key;
    else return false;
    this.applyEdit(ed);
    return true;
  }

  /** Ends a resize or turn: hands the shape over (with typed sizes), or shows it as before. */
  private endEdit(keep: boolean) {
    const ed = this.edit;
    this.edit = null;
    this.controls.enabled = true;
    this.moveLabel.hidden = true;
    if (ed?.handle.kind === 'rotate') this.showTicks(null);
    if (!ed) return;
    if (keep && ed.next) {
      const [a, b] = ed.typed;
      const typed = ed.handle.kind !== 'resize' ? {} : ed.start.kind === 'circle' ? { d: a ?? b } : { w: a, h: b };
      return this.host.setShapes(ed.sketch.id, [{ id: ed.start.id, profile: ed.next }], typed);
    }
    this.overrides.clear();
    this.renderSketches();
  }

  /** Keys during a move: typing sets the distance, Enter keeps the move, Esc undoes it; with the move fields open Esc keeps it there and Enter goes on to them (moves). */
  private dragKey(e: KeyboardEvent): boolean {
    const d = this.drag!;
    const fields = !!this.gizmo;
    if (pressed(e, 'confirm') || pressed(e, 'cancel')) return this.endDrag(fields || pressed(e, 'confirm')), !(fields && pressed(e, 'confirm'));
    if (e.key === 'Tab' && restOf(d.typed ?? '')) d.typed += restOf(d.typed!); // a name showing: written out
    else if (pressed(e, 'erase')) d.typed = d.typed?.slice(0, -1) || undefined;
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) d.typed = (d.typed ?? '') + e.key;
    else return false;
    if (this.drag) this.applyDrag(d);
    return true;
  }

  /** Ends a move: hands the new positions over, or puts the bodies back. */
  private endDrag(keep: boolean) {
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.moveLabel.hidden = true;
    if (!d) return;
    d.end(keep && d.moved ? d.by : null);
  }

  /** Ends a move, or handles a click: on empty space it deselects (unless Shift). */
  private up(e: PointerEvent) {
    if (this.edit?.handle.kind === 'centre' && !this.dragged(e)) return ((this.edit.armed = true), (this.controls.enabled = false), this.arcLabel(this.edit));
    if (this.edit?.handle.kind === 'control' && this.edit.handle.which !== 'mid' && !this.dragged(e)) return ((this.edit.armed = true), (this.controls.enabled = false), this.applyEdit(this.edit));
    if (this.edit) return this.endEdit(true);
    const d = this.drag;
    if (d?.moved) return this.endDrag(true);
    this.drag = null;
    this.controls.enabled = true;
    if (d?.only) return this.sketches.some((s) => s.shapes.some((q) => q.id === d.only)) ? this.host.pickShape(this.activeSketch!, d.only, false) : this.host.select(d.only, false);
    if (!d && !this.downOnPart && e.button === 0 && !toggles(e) && !this.dragged(e)) this.host.select(null, false);
  }

  private dragged(e: PointerEvent, px = 4) {
    return Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > px;
  }

  /** Small cube top right; clicking a face looks from that side. */
  private viewCube(size = 56 /* px, cube edge */, dragSpeed = 0.02 /* rad per px */) {
    const half = size / 2;
    const faces: [string, string, THREE.Vector3, number][] = [
      // last: brightness, lit from the top front right
      ['Front', `translateZ(${half}px)`, new THREE.Vector3(0, 0, 1), 0.9],
      ['Back', `rotateY(180deg) translateZ(${half}px)`, new THREE.Vector3(0, 0, -1), 0.75],
      ['Right', `rotateY(90deg) translateZ(${half}px)`, new THREE.Vector3(1, 0, 0), 0.82],
      ['Left', `rotateY(-90deg) translateZ(${half}px)`, new THREE.Vector3(-1, 0, 0), 0.78],
      // straight up/down is a pole for the orbit controls: tilt a hair towards the front
      ['Top', `rotateX(90deg) translateZ(${half}px)`, new THREE.Vector3(0, 1, 1e-3), 1],
      ['Bottom', `rotateX(-90deg) translateZ(${half}px)`, new THREE.Vector3(0, -1, 1e-3), 0.68],
    ];
    this.cube.className = 'cube';
    this.cube.append(
      ...faces.map(([label, transform, dir, light]) => {
        const face = Object.assign(document.createElement('div'), {
          className: 'face',
          textContent: label,
          onclick: () => this.viewFrom(fromCube(dir).applyQuaternion(this.frameTurn)),
          style: `transform: ${transform}; filter: brightness(${light})`,
        });
        // corner spots look from that cube corner, 45° between the sides; hovering lights the spots of that corner on all three faces
        const n = dir.clone().round();
        const up = n.y ? new THREE.Vector3(0, 0, -n.y) : new THREE.Vector3(0, 1, 0);
        const right = up.clone().cross(n);
        face.append(
          ...(
            [
              ['tl', -1, 1],
              ['tr', 1, 1],
              ['bl', -1, -1],
              ['br', 1, -1],
            ] as const
          ).map(([at, x, y]) => {
            const corner = n.clone().addScaledVector(right, x).addScaledVector(up, y);
            const lit = (on: boolean) =>
              this.cube.querySelectorAll(`[data-corner="${corner.toArray()}"]`).forEach((c) => c.classList.toggle('lit', on));
            const spot = Object.assign(document.createElement('div'), {
              className: `corner ${at}`,
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                this.viewFrom(fromCube(corner).applyQuaternion(this.frameTurn), false);
              },
              onpointerenter: () => lit(true),
              onpointerleave: () => lit(false),
            });
            spot.dataset.corner = `${corner.toArray()}`;
            return spot;
          }),
        );
        return face;
      }),
    );
    // dragging the cube orbits the camera without end: the pointer is hidden and locked, so the screen edge does not stop it;
    // the capture makes the release no click on a face
    let start = { x: 0, y: 0 };
    let turning = false;
    this.cube.onpointerdown = (e) => {
      start = { x: e.clientX, y: e.clientY };
      turning = false;
    };
    this.cube.onpointermove = (e) => {
      if (e.buttons !== 1) return;
      if (!turning) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 4) return;
        turning = true;
        this.cube.setPointerCapture(e.pointerId);
        Promise.resolve(this.cube.requestPointerLock()).catch(() => {}); // without the lock it still turns, up to the screen edge
        this.leaveSideView();
      }
      const target = this.controls.target;
      // in the cube's frame: inside a turned group, turned as the group
      const back = this.frameTurn.clone().invert();
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target).applyQuaternion(back).applyQuaternion(toCube));
      // over a pole it goes on upside down (up flipped) instead of stopping there; phi < 0: that side
      const flip = this.camera.up.clone().applyQuaternion(back).z < 0;
      s.theta -= (flip ? -1 : 1) * e.movementX * dragSpeed;
      let phi = THREE.MathUtils.euclideanModulo((flip ? -s.phi : s.phi) - e.movementY * dragSpeed + Math.PI, 2 * Math.PI) - Math.PI;
      phi = Math.sign(phi || 1) * THREE.MathUtils.clamp(Math.abs(phi), 1e-6, Math.PI - 1e-6); // never on the pole itself
      if (phi < 0 !== flip) s.theta += Math.PI;
      s.phi = Math.abs(phi);
      this.upright(phi > 0);
      const offset = new THREE.Vector3().setFromSpherical(s).applyQuaternion(toCube.clone().invert()).applyQuaternion(this.frameTurn);
      this.camera.position.copy(target).add(offset);
      this.controls.update();
    };
    this.cube.onpointerup = () => document.pointerLockElement === this.cube && document.exitPointerLock();
    // after a side was chosen, arrows turn the view by 90° to the neighbouring side
    const arrows = (['up', 'down', 'left', 'right'] as const).map((side) =>
      Object.assign(document.createElement('button'), { className: `turn ${side}`, onclick: () => this.turn(side) }),
    );
    // below the cube: click it, then a face, and the camera looks straight at that face
    const look = Object.assign(document.createElement('button'), {
      className: 'tool',
      title: 'Look at a face: click this, then a face, or a face first, then this (Esc cancels)',
      innerHTML: icon('look'),
      onclick: () => this.lookAtFace(),
    });
    const fit = Object.assign(document.createElement('button'), { className: 'tool fit', title: 'Fit (F): move the camera back or forth, as it looks now, until everything is in view', innerHTML: icon('fit'), onclick: () => this.fit() });
    const home = Object.assign(document.createElement('button'), { className: 'tool', title: 'Home (H): everything framed from the front-right corner', innerHTML: icon('home'), onclick: () => this.home() });
    const below = Object.assign(document.createElement('div'), { className: 'below-cube' });
    below.append(look, fit, home);
    this.cubeWrap.className = 'viewcube';
    this.cubeWrap.append(this.cube, ...arrows, below);
    return this.cubeWrap;
  }

  /** Looks straight at the last clicked face if its body is selected, else at the face clicked next. */
  lookAtFace() {
    const face = this.lastFace;
    const show = (f: PickedFace | null) => f && this.lookAlong(f.normal.clone().negate(), f.point);
    if (face?.body && this.selection.includes(face.body)) show(face);
    else this.pickFace(show);
  }

  /** Looks at the neighbouring side: the one to the right / left / above / below on screen. */
  private turn(side: 'up' | 'down' | 'left' | 'right') {
    const [x, y] = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[side];
    // the axis nearest that screen direction, inside a turned group its axes
    const back = this.frameTurn.clone().invert();
    const v = this.screenDir(x, y).applyQuaternion(back);
    const i = [v.x, v.y, v.z].reduce((best, c, k, all) => (Math.abs(c) > Math.abs(all[best]) ? k : best), 0);
    const own = new THREE.Vector3().setComponent(i, Math.sign(v.getComponent(i)));
    if (own.z) own.addScaledVector(this.camera.position.clone().sub(this.controls.target).normalize().applyQuaternion(back), 1e-3); // off the pole, towards the old view
    this.viewFrom(own.applyQuaternion(this.frameTurn));
  }

  /** The user rotated away from a cube side: hide the arrows, back to perspective if the cube switched to orthographic. */
  private leaveSideView() {
    this.flat = false;
    this.cubeWrap.classList.remove('aligned');
    if (!this.autoOrtho) return;
    this.autoOrtho = false;
    this.setOrthographic(false);
  }

  /**
   * Both cameras' up: Z (inside a turned group its Z: the view orbits upright to it), or -Z after the view cube was
   * dragged over a pole. The orbit controls keep the up they were made with, so theirs is set too.
   */
  private upright(on = true) {
    const up = new THREE.Vector3(0, 0, on ? 1 : -1).applyQuaternion(this.frameTurn);
    for (const c of [this.perspective, this.orthographic]) c.up.copy(up);
    const own = this.controls as unknown as { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
    own._quat.setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
    own._quatInverse.copy(own._quat).invert();
  }

  /** Turns the camera to look from `dir` (same target and distance); `side`: straight at a cube side, switching to orthographic for it. */
  private viewFrom(dir: THREE.Vector3, side = true, ms = 600, at?: THREE.Vector3) {
    this.upright();
    // leaving an angled view for a flat one: remember it, so pulling can return to it
    if (side && !this.flat) this.angledView = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!side) this.leaveSideView();
    else {
      this.flat = true;
      // the cube's turn arrows only for one of its 6 sides
      const own = dir.clone().applyQuaternion(this.frameTurn.clone().invert()); // a side of the cube, turned as the frame
      this.cubeWrap.classList.toggle('aligned', Math.max(...own.toArray().map(Math.abs)) / own.length() > 0.999);
    }
    if (side && !this.isOrthographic) {
      this.setOrthographic(true);
      this.autoOrtho = true;
    }
    const target = this.controls.target;
    const [t0, t1] = [target.clone(), at ?? target.clone()];
    const cam = this.camera;
    const dist = cam.position.distanceTo(target);
    const from = cam.position.clone().sub(target).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize());
    // the camera turns along with its position: re-aiming each frame (z up) would roll it in one go near the poles
    const [q0, q1] = [cam.quaternion.clone(), new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(t1.clone().addScaledVector(dir.clone().normalize(), dist), t1, cam.up))];
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = t * t * (3 - 2 * t);
      target.lerpVectors(t0, t1, k);
      cam.position.copy(target).addScaledVector(from.clone().applyQuaternion(new THREE.Quaternion().slerp(turn, k)), dist);
      cam.quaternion.slerpQuaternions(q0, q1, k);
      if (t < 1) {
        this.controls.dispatchEvent({ type: 'change' }); // renders, tools follow
        requestAnimationFrame(animate);
      } else {
        this.controls.update();
        // the cube bounces as it settles (CSS `scale` stacks on its transform)
        this.cube.animate({ scale: [1, 1.12, 0.95, 1.03, 1] }, { duration: 400, easing: 'ease-out' });
      }
    };
    requestAnimationFrame(animate);
  }
}

/**
 * An orthographic camera's near and far around what is drawn (`box`): from its nearest to its farthest point along the
 * view, in steps of an eighth of a power of 2 of its size (so they seldom change); fixed at ±50 m, big scenes were cut
 * off and small ones had depth steps of 6 µm. True: they changed.
 */
function fitOrthoDepth(camera: THREE.OrthographicCamera, box: THREE.Box3) {
  if (box.isEmpty()) return false;
  const look = camera.getWorldDirection(new THREE.Vector3());
  const along = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).sub(camera.position).dot(look));
  const step = 2 ** Math.ceil(Math.log2(Math.max(1, Math.max(...along) - Math.min(...along)))) / 8;
  const near = Math.floor(Math.min(...along) / step - 1) * step;
  const far = Math.ceil(Math.max(...along) / step + 1) * step;
  if (near === camera.near && far === camera.far) return false;
  Object.assign(camera, { near, far });
  camera.updateProjectionMatrix();
  return true;
}

/**
 * A perspective camera's near and far for what it looks at (`target`): near a 200th of the way there, far 100 times
 * the way or 50 m (powers of 2, so they seldom change). Fixed at 1 mm, close zooms were cut off and far ones lost
 * depth precision. True: they changed.
 */
function fitDepth(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  const d = camera.position.distanceTo(target);
  const near = 2 ** Math.round(Math.log2(Math.max(1e-3, d / 200)));
  const far = Math.max(50000, 2 ** Math.ceil(Math.log2(d * 100 || 1)));
  if (near === camera.near && far === camera.far) return false;
  Object.assign(camera, { near, far });
  camera.updateProjectionMatrix();
  return true;
}

/** Whether a snap is a point along an edge (anywhere on it, or a fraction of it: '1/2' …), not one of its own points (a corner, a centre). */
export const alongEdge = (what: string) => what === 'on edge' || /^\d+\/\d+$/.test(what);

type Tri = { p: THREE.Vector3[]; n: THREE.Vector3; c: number; box: THREE.Box3 };

/** A mesh's triangles in the world (`matrix`), each with its plane (`n`·p = `c`) and box. */
function triangles(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): Tri[] {
  const pos = geo.attributes.position;
  const index = geo.index;
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(matrix);
  const out: Tri[] = [];
  for (let t = 0; t + 2 < (index ? index.count : pos.count); t += 3) {
    const p = [at(t), at(t + 1), at(t + 2)];
    const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
    if (n.lengthSq() < 1e-18) continue;
    n.normalize();
    out.push({ p, n, c: n.dot(p[0]), box: new THREE.Box3().setFromPoints(p) });
  }
  return out;
}

/** Where triangle `a` crosses triangle `b` (a segment; null: they do not, or lie in one plane). */
function triCross(a: Tri, b: Tri, eps = 1e-7): [THREE.Vector3, THREE.Vector3] | null {
  // the part of t on the other's plane
  const on = (t: Tri, o: Tri) => {
    const d = t.p.map((q) => o.n.dot(q) - o.c);
    if (d.every((x) => x > eps) || d.every((x) => x < -eps) || d.every((x) => Math.abs(x) <= eps)) return null;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if (Math.abs(d[k]) <= eps) pts.push(t.p[k]);
      else if (Math.abs(d[j]) > eps && d[k] * d[j] < 0) pts.push(t.p[k].clone().lerp(t.p[j], d[k] / (d[k] - d[j])));
    }
    return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : null;
  };
  const [s, r] = [on(a, b), on(b, a)];
  const dir = a.n.clone().cross(b.n);
  if (!s || !r || dir.lengthSq() < 1e-12) return null;
  // both lie on the planes' line: their overlap along it
  const [s0, s1, r0, r1] = [...s, ...r].map((p) => p.dot(dir));
  const [lo, hi] = [Math.max(Math.min(s0, s1), Math.min(r0, r1)), Math.min(Math.max(s0, s1), Math.max(r0, r1))];
  if (hi - lo < 1e-9) return null;
  const at = (v: number) => s[0].clone().lerp(s[1], (v - s0) / (s1 - s0 || 1));
  return [at(lo), at(hi)];
}

/**
 * Where `plane` cuts a mesh (`matrix`: to the world), kept where all `others` keep it (clipping planes keep their
 * positive side): its segments joined end to end into loops (open where the others clip them).
 */
function planeCut(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, plane: THREE.Plane, others: THREE.Plane[]) {
  const pos = geo.attributes.position;
  const index = geo.index;
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(matrix);
  const segs: [THREE.Vector3, THREE.Vector3][] = [];
  for (let t = 0; t + 2 < (index ? index.count : pos.count); t += 3) {
    const p = [at(t), at(t + 1), at(t + 2)];
    const d = p.map((q) => plane.distanceToPoint(q) || 1e-9); // a corner on the plane counts as just above it
    const hits = [0, 1, 2].flatMap((k) => {
      const j = (k + 1) % 3;
      return d[k] * d[j] < 0 ? [p[k].clone().lerp(p[j], d[k] / (d[k] - d[j]))] : [];
    });
    if (hits.length !== 2) continue;
    let [a, b] = hits;
    for (const o of others) {
      const [da, db] = [o.distanceToPoint(a), o.distanceToPoint(b)];
      if (da < 0 && db < 0) [a, b] = [a, a];
      else if (da < 0) a = a.clone().lerp(b, da / (da - db));
      else if (db < 0) b = b.clone().lerp(a, db / (db - da));
    }
    if (a.distanceTo(b) > 1e-6) segs.push([a, b]);
  }
  return chained(segs);
}

/** Segments joined at shared ends (0.1 µm; else the nearest end within `tol`) into lines, grown both ways from each segment not taken yet. */
function chained(segs: [THREE.Vector3, THREE.Vector3][], tol = 1e-3) {
  const key = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 1e4)).join();
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => s.forEach((v) => (ends.get(key(v)) ?? ends.set(key(v), []).get(key(v))!).push(i)));
  const used = new Set<number>();
  const loops: [THREE.Vector3, THREE.Vector3][][] = [];
  segs.forEach((first, i) => {
    if (used.has(i)) return;
    used.add(i);
    const loop = [first];
    const grow = (forward: boolean) => {
      for (let end = forward ? loop.at(-1)![1] : loop[0][0]; ; ) {
        const j = ends.get(key(end))?.find((k) => !used.has(k)) ?? segs.findIndex((g, k) => !used.has(k) && Math.min(g[0].distanceTo(end), g[1].distanceTo(end)) < tol);
        if (j < 0) return;
        used.add(j);
        const [a, b] = segs[j];
        const fromEnd = a.distanceTo(end) <= b.distanceTo(end);
        if (forward) loop.push(fromEnd ? [a, b] : [b, a]);
        else loop.unshift(fromEnd ? [b, a] : [a, b]);
        end = forward ? loop.at(-1)![1] : loop[0][0];
      }
    };
    grow(true);
    grow(false);
    loops.push(loop);
  });
  return loops;
}
