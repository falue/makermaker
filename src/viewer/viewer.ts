import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { Backdrop, BasePlane, CameraState } from '../doc/types';
import type { BodyMesh } from '../kernel/build';
import { along, axisWheel, choose } from './gizmo';
import { toWorld, type Frame } from '../doc/frames';
import { area, bounds, centre, corners, edgeDistance, inside, type DrawnProfile } from '../doc/profiles';
import { inGroup } from '../doc/shapegroups';
import { lineFaceAt, type Face } from '../doc/arrangement';
import { anchorAt, angleAt, handlesOf, moved, resized, rotated, sizeOf, type Handle } from './shapes';
import type { AreaMesh } from '../kernel/build';
import { AreaTool } from './areas';
import { FacePullTool, type PullLook } from './faces';
import { icon } from '../ui/icons';
import { marks } from './marks';
import { cameraFrom, pathTraced, type RenderWatch } from './render';
import { drawSky, SKIES, twoColours } from './sky';
import { axisHtml } from '../ui/axes';
import type { Settings } from '../ui/settings';
import { outline, planeHit, shape2d, SketchTool, uvOf, type Target, type Tool, type ToolHost, type ToolKind, type ToolMode, type ToolView, type ViewSketch } from './sketch';
import { picksFace, pressed, toggles } from '../ui/keys';
import { keepInside } from '../ui/inside';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';
type Span = [number, number];

export interface ViewerHost {
  /** `add`: Shift- or ⌘ / Ctrl-click, adds the body to the selection or removes it. */
  select(id: string | null, add: boolean): void;
  /** Bodies were dragged to new positions (mm). */
  move(moves: { id: string; position: Vec3 }[]): void;
  /** A sketch shape was clicked; `add`: Shift or ⌘ / Ctrl, toggles it in the selection. */
  pickShape(sketch: string, shape: string, add: boolean): void;
  /** Shapes of a sketch were moved, resized or turned (mm, degrees); sizes typed as text are kept as expressions. */
  setShapes(sketch: string, shapes: { id: string; profile: DrawnProfile }[], typed?: Partial<Record<'w' | 'h' | 'd', string>>): void;
  /** A typed distance in mm, or null if invalid. */
  length(text: string): number | null;
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
  /** Faces or edges picked (Alt-click, Shift more; double right-click: an edge loop), with the area (mm²) or length (mm), the edge count and one circle's Ø; null: none any more. */
  pickedPart(part: PickedPart | null): void;
}

/** A picked face or edges: area (mm²) or total length (mm), how many edges, and Ø (mm) when it is one circle. */
export type PickedPart = { kind: 'face' | 'edge'; body: string; size: number; count?: number; diameter?: number };

/** A part of a finish on a body: the one replacing the edge through `mid` (null: the whole finish). */
export type FinishPick = { body: string; feature: string; mid: Vec3 | null };

/** A face picked for a section: a point on it and the normal pointing away from the camera; `body`: whose face (none: a base plane). */
/** What a click reaches ("to object"): where, and what it is ('corner', 'centre', '1/2', 'on edge', 'on face'). */
export type Aim = { at: THREE.Vector3; what: string };

/** A sketch shape under the pointer for Extrude (`onLine`: on its outline), or a face its lines enclose there. */
type SketchHit = { sketch: ViewSketch; q: ViewSketch['shapes'][number]; onLine: boolean } | { sketch: ViewSketch; face: Face };

/** A line to turn around (world): through `at` along unit `dir`; `what` it was taken from, `length`: the edge's or line's. */
export type TurnAxis = { at: THREE.Vector3; dir: THREE.Vector3; what: string; length?: number };

export interface PickedFace {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  body?: string;
  /** A quiet pick: the corner, edge point or face point clicked (none: empty space). */
  snap?: THREE.Vector3;
  /** A closed shape of a visible sketch clicked in front of any face: that sketch, the click, and the shape if its outline was clicked. */
  sketch?: { id: string; at: MouseEvent; shape?: string };
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
}

/**
 * Z-up viewport. Dragging a body moves it along one axis, picked by the drag direction like a weapon wheel (shown at
 * the press point; leaving its dead zone picks the axis, going back through it frees it; typing sets the distance;
 * the step follows the zoom: Shift coarse, Ctrl precise). Clicking a cut face picks its body. Drag the background to orbit, right-drag pans, wheel zooms. The view cube top right turns the camera; clicking a side switches
 * to orthographic until the next rotation. Top left: Ortho / Persp and Fit. A sketch tool takes the pointer while active.
 */
export class Viewer implements ToolView {
  /** The smallest step anything moves in (mm; Settings → General): precise moves (Ctrl) use it. */
  minStep = 0.01;
  /** The smallest step a drawn line turns in (degrees; Settings → General), with Ctrl. */
  minAngle = 0.01;
  /** End faces of extrusions, where sketches can start. */
  /** Visible sketches (world frames) and the selected one with its selected shapes. */
  sketches: ViewSketch[] = [];
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
  private pickSketches: false | 'areas' | 'outlines' = false;
  private sketchMark = new THREE.Group();
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
  /** The view's background (settings): the theme grey, or a gradient from the top to the bottom of the view. */
  private backdrop: Settings['background'] = { mode: 'solid', top: '#ffffff', bottom: '#ffffff', sky: 0 };
  /** The gradient background: a column redrawn when the camera tilts (`drawn`: for which tilt and view). */
  private sky = { canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 256 }), texture: null as THREE.CanvasTexture | null, drawn: '' };
  /** Selected bodies get an outline around their silhouette (tool bodies in red): they are drawn into `mask`, then a ring of `px` around it on top. */
  private silhouette = {
    mask: new THREE.WebGLRenderTarget(1, 1),
    flat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    // covers the screen, whatever the camera sees
    quad: Object.assign(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { mask: { value: null }, texel: { value: new THREE.Vector2() }, width: { value: 3 }, color: { value: new THREE.Vector3(0, 0xbc / 255, 0xd4 / 255) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        // outside the mask, within `width` px of it: the colour, edges smoothed over half a pixel
        fragmentShader: `uniform sampler2D mask; uniform vec2 texel; uniform float width; uniform vec3 color; varying vec2 vUv;
          void main() {
            if (texture2D(mask, vUv).r > 0.5) discard;
            float a = 0.0;
            for (int x = -8; x <= 8; x++) for (int y = -8; y <= 8; y++) {
              float d = length(vec2(x, y));
              if (d > width + 0.5 || texture2D(mask, vUv + vec2(x, y) * texel).r < 0.5) continue;
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
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.localClippingEnabled = true;
    const canvas = this.renderer.domElement;
    el.append(canvas, this.viewCube(), this.cameraControls(), this.crumbs, this.moveLabel);

    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, -2, 3);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888880, 2), sun, this.grid, this.axes, this.sectionView, this.sketchView, this.sketchGrid, this.overlay, this.wheel, this.centres, this.edgeMark, this.pickedEdgeMark, this.measureMark, this.sketchMark, this.aimMark, this.cutMark, this.axisMark, this.ticks);
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
    // frame the default box now: a first frame looking straight down shows the cube's Front edge-on, and Chrome keeps it unpainted
    this.home(0);

    // capture: runs before the orbit controls, so grabbing a body or drawing does not orbit
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== canvas) return;
        // a double right-click near an edge: its loop (a right-drag still turns the view)
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
    canvas.addEventListener('pointerleave', () => ((this.hover = null), unpreview(), this.markSketch(null)));
    addEventListener('keyup', (e) => (e.key === 'Control' || e.key === 'Alt') && unpreview());
    canvas.addEventListener('pointermove', (e) => {
      this.hover = e;
      if (this.facePick && !this.drag) {
        if (this.quietPick) return void (this.axisHover ? this.axisHover(this.axisAt(e)) : this.aiming?.(this.aimAt(e))); // a gizmo drag moves on
        const hit = this.frontHit(e);
        const s = this.sketchShapeAt(e, hit);
        this.markSketch(s);
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
      if (this.clickAt) return this.clicked(e);
      if (!this.toolPress) return this.up(e);
      this.toolPress = false;
      this.tool?.up();
    });
    canvas.addEventListener('dblclick', (e) => {
      if (this.tool) return this.tool.dblclick(e);
      // on a sketch shape: into its sketch group; on a finish face: the whole finish (an edge loop: a double Ctrl press, see down)
      const hit = this.frontHit(e);
      const shape = this.shapeAt(this.ray(e), this.focus ? undefined : hit?.distance);
      if (shape) return this.host.enterShape(shape.sketch, shape.shape);
      const f = hit && this.finishAt(hit);
      if (f) this.host.pickFinish({ body: hit.object.userData.bodyId, feature: f.feature, mid: null });
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Ctrl+click on macOS would open it
    // scrolling sideways (trackpad) pans sideways, Shift + wheel up and down; plain up and down stays the orbit controls' zoom
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const ppm = this.pixelsPerMm(this.controls.target);
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
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        // the Esc that freed a locked pointer was already handled
        if (pressed(e, 'cancel') && performance.now() - this.escFreed < 300) return e.preventDefault(), e.stopPropagation();
        const used = this.drag?.moved
          ? this.dragKey(e)
          : this.edit?.next
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

  /** A drawing tool (`kind`; none: picking a plane); `mode`: sketch mode, pulling or plane picking. */
  startTool(kind: ToolKind | null, host: ToolHost, mode?: ToolMode) {
    this.stopTool();
    this.tool = new SketchTool(kind, this, host, mode);
    if (mode?.kind !== 'pull') this.renderer.domElement.classList.add('drawing');
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
  private pickedFaces: { mesh: THREE.Mesh; faces: number[] } | null = null;
  /** Picked faces and edges: lit in the accent blue (an Alt-hover previews in orange). */
  private pickedMark: THREE.Mesh | null = null;
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

  placeOn(hit: THREE.Intersection) {
    // flat: all normals of the B-rep face agree
    const k = faceOf(hit);
    const groups = hit.object.userData.faces as Uint32Array;
    const geo = (hit.object as THREE.Mesh).geometry;
    const index = geo.index!.array.subarray(groups[k * 2], groups[k * 2] + groups[k * 2 + 1]);
    const normal = (v: number) => new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, v);
    const n0 = normal(index[0]);
    const flat = index.every((v) => normal(v).dot(n0) > 0.9999);
    return this.host.placeOn({ point: hit.point.clone(), normal: hit.face!.normal.clone().negate(), body: hit.object.userData.bodyId }, flat);
  }

  /** Where shapes go on the face last clicked on a selected body (a face first, then the sketch tool). */
  lastTarget() {
    const hit = this.lastHit;
    return hit && this.selection.includes(hit.object.userData.bodyId) ? this.placeOn(hit) : null;
  }

  /** Pushes or pulls a face along its outward normal `n` from `at` (E on a face). */
  startFacePull(host: ToolHost, n: Vec3, at: THREE.Vector3, onPull: (mm: number, phase: 'live' | 'done' | 'cancel') => void, look?: PullLook) {
    this.stopTool();
    this.tool = new FacePullTool(this, host, n, at, onPull, look);
    this.toolButtons(true);
  }

  /** Pulls existing shapes of a sketch into an extrusion (E). */
  startPull(host: ToolHost, target: Target, ids: string[]) {
    this.startTool(null, host, { kind: 'pull', target, ids });
  }

  /** Picks areas of a sketch and pulls them (E in sketch mode). */
  /** `all`: everything picked already (a sketch chosen from the list). */
  startAreas(host: ToolHost, target: Target, areas: AreaMesh[], all = false, first?: { at: MouseEvent; shape?: string }) {
    this.stopTool();
    this.tool = new AreaTool(this, host, target, areas, all, first);
    this.toolButtons(true);
    this.renderSketches();
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

  /** Handles of the single selected shape: plane coordinates, screen position, kind. */
  private handles(reachPx = 26) {
    const h = this.handled();
    if (!h) return [];
    const f = h.sketch.frame;
    const reach = reachPx / this.pixelsPerMm(new THREE.Vector3(...toWorld(f, ...centre(h.shape))));
    return handlesOf(h.shape, reach).map(({ at, handle }) => ({ at, handle, world: new THREE.Vector3(...toWorld(f, ...at)) }));
  }

  /** Sketch outlines (the selected sketch darker, its selected shapes orange) and the handles of a single selected shape. */
  private renderSketches(raised = 0.05) {
    const lift = this.focus ? 0 : raised; // a sketch group open: outlines over everything, the see-through bodies included
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
        const faint = !!this.focus && (s.id !== this.focus.sketch || !inGroup(s, p, this.focus.group)); // outside the open (sub-)group
        if (this.moving && (q !== p || by)) this.sketchView.add(outline(p, s.frame, 0x8a8f98, lift)); // where it was
        this.sketchView.add(outline(q, frame, color, lift, 1.5, 2, faint ? 0.25 : 1));
        if (q.kind === 'circle') this.sketchView.add(marks([new THREE.Vector3(...toWorld(frame, q.x, q.y))], color, 6)); // its centre, clickable
      }
    }
    const refs = this.tool ? [] : this.refMarks();
    const handles = this.tool || this.drag?.moved ? [] : this.handles();
    const resize = handles.filter((h) => h.handle.kind === 'resize').map((h) => h.world);
    const turn = handles.filter((h) => h.handle.kind === 'rotate').map((h) => h.world);
    if (resize.length) this.sketchView.add(marks(resize, 0xff8c1a));
    if (turn.length) {
      // the line reaches in to the point the shape turns around (its centre), marked with a ring
      const h = this.handled()!;
      const pivot = new THREE.Vector3(...toWorld(h.sketch.frame, ...centre(h.shape)));
      this.sketchView.add(marks(turn, 0x1d4ed8), marks([pivot], 0x1d4ed8, 9), new THREE.Line(new THREE.BufferGeometry().setFromPoints([pivot, turn[0]]), new THREE.LineBasicMaterial({ color: 0x1d4ed8, depthTest: false })));
    }
    this.sketchView.traverse((o) => (o.renderOrder = o instanceof THREE.Points || o.type === 'Line' || o.type === 'Line2' ? 1e6 : 0));
    if (refs.length) this.sketchView.add(...refs); // under the handles: a handle on the reference point gets a blue ring
    for (const o of refs) o.renderOrder = 1e6 - 1;
    this.render();
  }

  /**
   * Blue marks on the reference points of the active sketch's selected shapes (and of shapes measured from
   * elsewhere than their centre), each with an arrow in the direction the shape grows.
   */
  private refMarks(arrowPx = 36, headPx = 10) {
    const s = this.sketches.find((v) => v.id === this.activeSketch);
    if (!s) return [];
    const points: THREE.Vector3[] = [];
    const lines: THREE.Vector3[] = [];
    for (const q of s.shapes) {
      const ref = this.shapeRefs.get(q.id) ?? [0, 0];
      if (!this.selectedShapes.includes(q.id)) continue;
      const p = this.overrides.get(q.id) ?? q;
      const [u, v] = anchorAt(p, ref);
      const at = new THREE.Vector3(...toWorld(s.frame, u, v));
      points.push(at);
      if (!ref[0] && !ref[1]) continue;
      const [cu, cv] = anchorAt(p, [0, 0]);
      const dir = new THREE.Vector3(...toWorld(s.frame, cu, cv)).sub(at).normalize();
      const side = dir.clone().cross(new THREE.Vector3(...s.frame.n));
      // mm per screen px along a direction in the (tilted) plane
      const mm = (d: THREE.Vector3) => {
        const [[x0, y0], [x1, y1]] = [this.toScreen(at), this.toScreen(at.clone().add(d))];
        return 1 / (Math.hypot(x1 - x0, y1 - y0) || 1);
      };
      const tip = at.clone().addScaledVector(dir, arrowPx * mm(dir));
      const back = tip.clone().addScaledVector(dir, -headPx * mm(dir));
      const wing = (headPx / 2) * mm(side);
      lines.push(at, tip, tip, back.clone().addScaledVector(side, wing), tip, back.addScaledVector(side, -wing));
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
        const d = q.kind === 'circle' ? Math.min(edgeDistance(q, u, v), Math.hypot(u - q.x, v - q.y)) : edgeDistance(q, u, v); // a circle's centre picks it too
        const edge = d <= reach ? d : Infinity; // outside the reach only the inside counts
        if (edge === Infinity && !inside(q, u, v)) continue;
        const a = area(q);
        if (!best || distance < best.distance - 1e-6 || edge < best.edge || (edge === best.edge && a < best.area)) best = { sketch: s.id, shape: q.id, distance, edge, area: a };
      }
    }
    return best;
  }

  /**
   * Picking with sketches, in front of any face: a closed sketch shape's outline under the pointer (all of it), else the
   * face lines enclose there (see `lineFaceAt`), else the closed shape the pointer is in; null: none.
   */
  private sketchShapeAt(e: MouseEvent, hit: THREE.Intersection | undefined): SketchHit | null {
    if (!this.pickSketches) return null;
    const ray = this.ray(e);
    const s = this.shapeAt(ray, hit?.distance);
    const sketch = s && this.sketches.find((k) => k.id === s.sketch);
    const q = sketch?.shapes.find((x) => x.id === s!.shape);
    if (this.pickSketches === 'outlines') return sketch && q && s!.edge < Infinity ? { sketch, q, onLine: true } : null; // any shape, lines too
    const closed = q && !q.construction && q.kind !== 'line' ? q : null;
    if (sketch && closed && s!.edge < Infinity) return { sketch, q: closed, onLine: true };
    // inside lines' faces: the nearest sketch with lines that close a face around the pointer
    for (const k of this.sketches.filter((x) => x.shapes.some((p) => p.kind === 'line' && !p.construction))) {
      const p = planeHit(ray, k.frame);
      if (!p || p.distanceTo(ray.origin) > (hit?.distance ?? Infinity) + 1e-3) continue;
      const face = lineFaceAt(k.shapes.filter((x) => !x.construction), uvOf(k.frame, p));
      if (face) return { sketch: k, face };
    }
    return sketch && closed ? { sketch, q: closed, onLine: false } : null;
  }

  /** Lights what a click there pulls: on a shape's outline all of it (the outline too), inside it the piece without the shapes inside it, or a lines' face. */
  private markSketch(at: SketchHit | null) {
    for (const o of this.sketchMark.children) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.sketchMark.clear();
    if (at) {
      const f = at.sketch.frame;
      const poly = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      let shape: THREE.Shape;
      if ('face' in at) (shape = poly(at.face.outer)).holes = at.face.holes.map(poly);
      else if (at.q.kind === 'line') shape = new THREE.Shape(); // a line: only its outline lights
      else {
        const { sketch, q, onLine } = at;
        shape = shape2d(q);
        if (!onLine) shape.holes = sketch.shapes.filter((o) => o !== q && !o.construction && o.kind !== 'line' && area(o) < area(q) && inside(q, ...centre(o))).map(shape2d);
      }
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.35, depthTest: false, side: THREE.DoubleSide }));
      fill.matrixAutoUpdate = false;
      fill.matrix.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.n)).setPosition(...f.o);
      this.sketchMark.add(fill, ...('q' in at && at.onLine ? [outline(at.q, f, 0xff8c1a, 0, 1.5, 4)] : []));
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

  /** The next click on a body picks a face (null: Esc). */
  /** `quiet`: no face marking or crosshair: clicks are only kept from selecting (a drag still turns the view). */
  pickFace(done: (face: PickedFace | null) => void, quiet = false, sketches: false | 'areas' | 'outlines' = false) {
    this.facePick = done;
    this.quietPick = quiet;
    this.pickSketches = sketches;
    if (!quiet) this.renderer.domElement.classList.add('drawing');
  }

  /** What a click points at (world): a body corner within `cornerPx`, else the nearest point of an edge within 6 px, else the face point; null: empty space. */
  pointAt(e: MouseEvent) {
    return this.snapAt(e)?.at ?? null;
  }

  /**
   * What a click points at (world) and what it is: a body corner or sphere centre within `px`, else on the edge
   * within 6 px its middle (within `px` of it) or the nearest point, else the face point; null: empty space.
   */
  private snapAt(e: MouseEvent, px = 10): Aim | null {
    const r = this.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const near = (p: THREE.Vector3) => {
      const [x, y] = this.toScreen(p);
      return Math.hypot(mx - x, my - y) < px;
    };
    const corner = this.corners().find(near);
    if (corner) return { at: corner, what: this.balls.some((b) => b.center.equals(corner)) ? 'centre' : 'corner' };
    const edge = this.edgeAt(e);
    if (edge) {
      // an open edge's middle, else the edge point nearest the pointer's ray
      const lengths = edge.segs.map(([a, b]) => a.distanceTo(b));
      let half = lengths.reduce((n, l) => n + l, 0) / 2;
      const k = Math.max(0, lengths.findIndex((l) => (half -= l) <= 0));
      const mid = edge.segs[k][0].clone().lerp(edge.segs[k][1], 1 + half / (lengths[k] || 1));
      const open = edge.segs[0][0].distanceTo(edge.segs.at(-1)![1]) > 1e-6;
      if (open && near(mid)) return { at: mid, what: '1/2' };
      const ray = this.ray(e);
      let best: [number, THREE.Vector3] | null = null;
      for (const [a, b] of edge.segs) {
        const p = new THREE.Vector3();
        const d = ray.distanceSqToSegment(a, b, undefined, p);
        if (!best || d < best[0]) best = [d, p];
      }
      return { at: best![1], what: 'on edge' };
    }
    const hit = this.frontHit(e);
    return hit ? { at: hit.point.clone(), what: 'on face' } : null;
  }

  /** Waiting for "to object" (the move fields): told what a click at the pointer would reach (see `aimAt`). */
  aiming: ((s: Aim | null) => void) | null = null;

  /** Marks what a click at the pointer reaches ("to object") and returns it (where, and what: 'corner', '1/2' …); null: clears. */
  aimAt(e: MouseEvent | null): Aim | null {
    for (const o of this.aimMark.children) ((o as THREE.Points).geometry.dispose(), ((o as THREE.Points).material as THREE.Material).dispose());
    this.aimMark.clear();
    const s = e && this.snapAt(e);
    if (s) this.aimMark.add(Object.assign(marks([s.at], 0xff8c1a, s.what.startsWith('on ') ? 8 : 12), { renderOrder: 1e6 }));
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
      const circle = circleOf(edge.segs.flatMap(([a, b]) => [a, a.clone().lerp(b, 0.5)]));
      return circle ? { at: circle.centre, dir: circle.normal, what: 'round edge: its centre' } : line(nearest(edge.segs), 'edge');
    }
    const s = this.shapeAt(ray, this.frontHit(e)?.distance);
    const sketch = s && s.edge < Infinity ? this.sketches.find((k) => k.id === s.sketch) : undefined;
    const q = sketch?.shapes.find((x) => x.id === s!.shape);
    if (!sketch || !q) return point ? { at: point.at, dir: z, what: 'point: Z through it' } : null;
    const f = sketch.frame;
    if (q.kind === 'circle') return { at: new THREE.Vector3(...toWorld(f, q.x, q.y)), dir: new THREE.Vector3(...f.n), what: 'circle: its centre' };
    const pts = (q.kind === 'line' ? q.pts : [...corners(q), corners(q)[0]]).map(([u, v]) => new THREE.Vector3(...toWorld(f, u, v)));
    return line(nearest(pts.slice(1).map((p, k): [THREE.Vector3, THREE.Vector3] => [pts[k], p])), q.kind === 'line' ? 'line' : 'side');
  }

  private axisMark = new THREE.Group();

  /** Where the pointer's ray meets the plane through `at` square to `n` (null: parallel to it). */
  pointOnPlane(e: MouseEvent, at: THREE.Vector3, n: THREE.Vector3) {
    return this.ray(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, at), new THREE.Vector3());
  }

  private ticks = new THREE.Group();

  /**
   * A turn's angle steps: ticks every `step` degrees around `at` (square to `dir`), from the ray towards `from` at
   * radius |from − at|, and the ray turned to `angle` degrees (null: gone).
   */
  showTicks(t: { at: THREE.Vector3; dir: THREE.Vector3; from: THREE.Vector3; step: number; angle: number } | null) {
    for (const o of this.ticks.children) ((o as THREE.LineSegments).geometry.dispose(), ((o as THREE.LineSegments).material as THREE.Material).dispose());
    this.ticks.clear();
    if (t) {
      const ray = t.from.clone().sub(t.at);
      const along = (deg: number, k: number) => t.at.clone().add(ray.clone().applyAxisAngle(t.dir, (deg * Math.PI) / 180).multiplyScalar(k));
      const n = Math.min(360, Math.round(360 / t.step));
      const marks = Array.from({ length: n }, (_, i) => [along(i * t.step, 0.88), along(i * t.step, 1)]).flat();
      const look = (color: number) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
      this.ticks.add(Object.assign(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(marks), look(0x8a8f98)), { renderOrder: 1e6 }));
      this.ticks.add(Object.assign(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([t.at, along(0, 1), t.at, along(t.angle, 1.1)]), look(0xff8c1a)), { renderOrder: 1e6 }));
    }
    this.render();
  }

  /** An axis drawn dashed in the cut's red, `half` mm both ways from the point on it nearest `mid` (null: gone). */
  showAxis(a: TurnAxis | null, mid = new THREE.Vector3(), half = 50) {
    for (const o of this.axisMark.children) ((o as THREE.Line).geometry.dispose(), ((o as THREE.Line).material as THREE.Material).dispose());
    this.axisMark.clear();
    if (a) {
      const c = a.at.clone().addScaledVector(a.dir, mid.clone().sub(a.at).dot(a.dir));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([c.clone().addScaledVector(a.dir, -half), c.clone().addScaledVector(a.dir, half)]), new THREE.LineDashedMaterial({ color: 0xe5484d, dashSize: half / 20, gapSize: half / 30, depthTest: false }));
      l.computeLineDistances();
      l.renderOrder = 1e6;
      this.axisMark.add(l);
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

  setBody(id: string, mesh: BodyMesh) {
    const group = this.group(id);
    this.disposeChildren(group);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const solid = new THREE.Mesh(geometry);
    Object.assign(solid.userData, { bodyId: id, faces: mesh.faces, corners: mesh.corners, finishFaces: mesh.finishFaces, finishes: mesh.finishes });
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
    group.add(solid, lines);
    this.dress(id);
    if (this.finishSel?.body === id) this.setFinishMark(this.finishSel);
    if (!this.fitted) {
      this.fitted = true;
      requestAnimationFrame(() => this.home(0)); // after the other bodies of this batch
    }
    this.applySection();
  }

  /** Where a body sits in the world: its origin and its turn (from turned groups). */
  setPlacement(id: string, at: THREE.Vector3, turn: THREE.Quaternion) {
    const g = this.group(id);
    g.quaternion.copy(turn);
    if (!(this.drag?.moved && this.withOwned(this.selection).includes(id))) g.position.copy(at); // not while dragged
    g.updateMatrixWorld();
    this.applySection();
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

  select(ids: string[]) {
    this.selection = ids;
    this.rehide();
    const body = this.pickedFaces?.mesh.userData.bodyId ?? this.pickedEdge?.body;
    if (body && !ids.includes(body)) this.dropPicked();
    for (const id of this.bodies.keys()) this.dress(id);
    this.markCentres();
    this.applySection();
  }

  /** Colour and visibility per body; hidden bodies are not drawn, picked or snapped to (but still built). */
  /** `cutter`: a boolean's tool body, drawn as red outlines (shown while selected even when hidden: join / intersect tools). */
  setLooks(looks: { id: string; color: string; visible: boolean; cutter: boolean; owner?: string }[]) {
    this.looksHidden = new Set(looks.filter((l) => !l.visible).map((l) => l.id));
    this.cutters = new Set(looks.filter((l) => l.cutter).map((l) => l.id));
    this.rehide();
    this.owners = new Map(looks.flatMap((l) => (l.owner ? [[l.id, l.owner]] : [])));
    for (const l of looks) {
      this.materialOf(l.id).color.set(l.color);
      this.dress(l.id);
    }
    this.applySection();
  }

  /** Tool bodies of booleans show (as outlines) only while selected; the rest as their looks say. */
  private rehide() {
    const shown = (id: string) => this.selection.includes(id);
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
    const cutter = this.cutters.has(id);
    const dropped = !cutter && this.dropped.has(id);
    const faded = dropped || (!cutter && !!this.focus && !this.focus.solid.has(id));
    (solid as THREE.Mesh).material = cutter ? this.ghost : dropped ? this.droppedFill : faded ? this.fadedOf(id) : this.materialOf(id);
    (lines as THREE.LineSegments).material = cutter ? this.cutterEdge : faded ? this.fadedEdges : this.edgeMaterial; // selected: a red silhouette
    // a see-through body's depth, drawn before the see-through colours (sections and picking skip it)
    const g = this.bodies.get(id)!;
    let depth = g.children.find((c) => c.userData.depth);
    if (faded && !depth) {
      depth = Object.assign(new THREE.Mesh((solid as THREE.Mesh).geometry, this.depthOnly), { raycast: () => {} });
      Object.assign(depth.userData, { depth: true, outline: true });
      g.add(depth);
    }
    if (depth) depth.visible = faded;
    lines.renderOrder = cutter ? 1e5 : 0;
  }

  private dropped = new Set<string>();
  private droppedFill = new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.7, transparent: true, opacity: 0.35, depthWrite: false });

  /** Bodies `ids` see-through in the cut's red (to be deleted), the others as they are. */
  setDropped(ids: string[]) {
    this.dropped = new Set(ids);
    for (const id of this.bodies.keys()) this.dress(id);
    this.render();
  }

  /** `ids` and the bodies they own, all the way down. */
  private withOwned(ids: string[]) {
    const out = [...ids];
    for (let i = 0; i < out.length; i++) for (const [owned, owner] of this.owners) if (owner === out[i] && !out.includes(owned)) out.push(owned);
    return out;
  }

  /** A body's colour, see-through: drawn behind an open sketch group. */
  private fadedOf(id: string, opacity = 0.35) {
    let m = this.faded.get(id);
    if (!m) this.faded.set(id, (m = new THREE.MeshStandardMaterial({ roughness: 0.7, transparent: true, opacity, depthWrite: false })));
    m.copy(this.materialOf(id));
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

  /** Tab: selects the next (`step` 1) or previous body under the pointer (outside the view: along the last click). */
  cycle(step: number) {
    const ray = this.hover ? this.ray(this.hover) : this.pick;
    if (!ray) return;
    const ids = [...new Set(this.intersect(new THREE.Raycaster(ray.origin, ray.direction)).map((h) => h.object.userData.bodyId as string))];
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
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), this.camera.up));
    this.frameAll(this.allBox().getCenter(new THREE.Vector3()), turn, ms);
  }

  /**
   * Glides the camera (both, ortho and perspective; `ms` long, as views turn) to look at `target` turned as `turn`,
   * so far back (ortho: zoomed so) that all bodies are in view with a `margin`.
   */
  private frameAll(target: THREE.Vector3, turn: THREE.Quaternion, ms = 600, margin = 1.1) {
    const box = this.allBox();
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
   * The bodies as a PNG on a transparent background, `scale` times the screen resolution, with ambient occlusion if it
   * is on: no grid, origin, sketches, cutters or selection.
   */
  async snapshot(scale = 1): Promise<Blob> {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    const cutters = [...this.cutters].flatMap((id) => this.bodies.get(id) ?? []);
    const helpers = [this.grid, this.axes, this.sketchView, this.sketchGrid, this.overlay, this.wheel, this.centres, this.faceMark, this.pickedMark, this.edgeMark, this.pickedEdgeMark, this.measureMark, this.sketchMark, this.finishMark, ...cutters].filter((o) => o?.visible) as THREE.Object3D[];
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
  renderNice(camera: CameraState, background: Backdrop, samples: number, watch: RenderWatch) {
    const meshes = [...this.bodies].flatMap(([id, g]) => {
      const solid = g.children[0] as THREE.Mesh | undefined;
      if (!solid || this.hidden.has(id) || this.cutters.has(id)) return [];
      const m = new THREE.Mesh(solid.geometry, new THREE.MeshStandardMaterial({ color: this.materialOf(id).color, roughness: 0.55 }));
      m.applyMatrix4(g.matrixWorld);
      return [m];
    });
    return pathTraced(meshes, cameraFrom(camera), ...camera.size, background, Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), samples, watch);
  }

  /** The camera's tilt and half field of view (ortho: as the perspective camera would see it), for the sky. */
  private tilt() {
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    return { pitch: Math.asin(THREE.MathUtils.clamp(look.z, -1, 1)), tanHalf: Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)) };
  }

  /** Redraws the gradient background when the camera tilted. */
  private drawSky() {
    const backdrop = this.backdropColours();
    if (backdrop.stops.length < 2 || !this.sky.texture) return;
    const { pitch, tanHalf } = this.tilt();
    const key = `${pitch.toFixed(3)} ${tanHalf}`;
    if (key === this.sky.drawn) return;
    this.sky.drawn = key;
    drawSky(this.sky.canvas.getContext('2d')!, 1, 256, pitch, tanHalf, backdrop);
    this.sky.texture.needsUpdate = true;
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
      this.scaleDashes();
      if (this.ao.on) this.renderAO();
      else this.renderer.render(this.scene, this.camera);
      this.drawSilhouette();
      // picked edges and measures stay over the outline
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      for (const mark of [this.pickedEdgeMark, this.edgeMark, this.measureMark]) if (mark.children.length) this.renderer.render(mark, this.camera); // the measure last
      this.renderer.autoClear = autoClear;
      // the view cube shows the camera's rotation (cube frame mirrored into CSS's y-down frame)
      const e = new THREE.Matrix4().makeRotationFromQuaternion(toCube.clone().multiply(this.camera.quaternion)).invert().elements;
      this.cube.style.transform = `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
    });
  };

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
  }

  /** The silhouette of `solids` outlined in `rgb` (0..1) over the picture. */
  private outline(solids: THREE.Mesh[], rgb: [number, number, number]) {
    if (!solids.length) return;
    const { mask, flat, quad, px } = this.silhouette;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (mask.width !== size.x || mask.height !== size.y) mask.setSize(size.x, size.y);
    const [clear, alpha, autoClear] = [r.getClearColor(new THREE.Color()), r.getClearAlpha(), r.autoClear];
    r.setRenderTarget(mask);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.autoClear = false; // all solids into one mask: one silhouette around them together
    for (const s of solids) {
      const own = s.material as THREE.Material;
      flat.clippingPlanes = own.clippingPlanes; // a cut copy stays cut
      s.material = flat;
      r.render(s, this.camera);
      s.material = own;
    }
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    const u = (quad.material as THREE.ShaderMaterial).uniforms;
    u.mask.value = mask.texture;
    u.color.value.set(...rgb);
    u.texel.value.set(1 / size.x, 1 / size.y);
    u.width.value = px * r.getPixelRatio();
    r.autoClear = false;
    r.render(quad, this.camera);
    r.autoClear = autoClear;
  }

  /** Dashed lines (construction lines, guides) keep `px` long dashes and gaps on screen at any zoom. */
  private scaleDashes(px = 5) {
    const mm = px / this.pixelsPerMm(this.controls.target);
    for (const g of [this.sketchView, this.overlay])
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
    if (b.mode === 'colours') return twoColours(b.top, b.bottom);
    if (b.mode === 'sky') return SKIES[b.sky]?.[1] ?? SKIES[0][1];
    return { stops: [{ color: `#${new THREE.Color(this.isDark ? 0x1c1d20 : 0xeeeeec).getHexString()}`, at: 0 }], band: 25 };
  }

  applyTheme = () => {
    const dark = this.isDark;
    const backdrop = this.backdropColours();
    if (backdrop.stops.length > 1) {
      this.sky.texture ??= Object.assign(new THREE.CanvasTexture(this.sky.canvas), { colorSpace: THREE.SRGBColorSpace });
      this.sky.drawn = ''; // colours changed: draw again
      this.scene.background = this.sky.texture;
    } else this.scene.background = new THREE.Color(backdrop.stops[0].color);
    const grid = new THREE.GridHelper(1000, 100, dark ? 0x45474d : 0xbbbbbb, dark ? 0x2c2e32 : 0xd6d6d4);
    grid.rotation.x = Math.PI / 2;
    grid.material.depthWrite = false;
    grid.renderOrder = -2;
    this.grid.children.forEach((c) => (c as THREE.GridHelper).dispose());
    this.grid.clear().add(grid);
    this.render();
  };

  /** The axis wheel: while a move runs at its press point (spokes it may take), else at the move fields' gizmo; spokes `wheelPx` long on screen, the dead zone ring facing the camera. */
  private placeWheel() {
    const d = this.drag?.moved ? this.drag : null;
    const at = d?.start ?? this.gizmo?.at;
    this.wheel.visible = !!at;
    if (!at) return;
    this.wheel.position.copy(at);
    this.wheel.scale.setScalar(this.wheelPx / this.pixelsPerMm(at));
    const ring = this.wheel.getObjectByName('dead')!;
    ring.quaternion.copy(this.camera.quaternion);
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

  /** A press on the gizmo: the move a body grab starts, from its middle; the move sets the axes' values (released unmoved: as before). */
  private dragGizmo(e: PointerEvent) {
    const g = this.gizmo!;
    const from = [0, 1, 2].map((k) => g.value(k));
    const set = (by: THREE.Vector3) => from.forEach((v, k) => g.set(k, v + by.getComponent(k)));
    this.downAt = { x: e.clientX, y: e.clientY };
    this.downOnPart = true; // no click on empty space
    this.startDrag(e, this.ray(e), g.at.clone(), {
      axes: [0, 1, 2],
      lead: new THREE.Vector3(), // the distance lands on the step
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(unit(this.facingAxis()), g.at),
      only: null,
      apply: set,
      end: (by) => {
        if (!by) set(new THREE.Vector3());
      },
    });
  }

  /** The axis whose spoke points most along the drag on screen; spokes pointing at the camera (short on screen) are skipped. */
  private wheelAxis(e: PointerEvent, start: THREE.Vector3, short = 0.25) {
    const [x0, y0] = this.toScreen(start);
    const spokes = [0, 1, 2].map((k) => {
      const [x1, y1] = this.toScreen(start.clone().addScaledVector(unit(k), this.wheel.scale.x));
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

  /** The edges of the shown bodies (world segments), with their body; cut outlines of the section too (`cut`). */
  private bodyEdges() {
    const out: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; cut?: true }[] = [...this.cutEdges().lines];
    for (const [id, g] of this.bodies)
      for (const c of this.hidden.has(id) ? [] : g.children) {
        const groups = c.userData.edgeGroups as Uint32Array | undefined;
        if (!groups) continue;
        const pos = (c as THREE.LineSegments).geometry.attributes.position;
        const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(g.matrix);
        for (let k = 0; k < groups.length; k += 2) {
          const segs: [THREE.Vector3, THREE.Vector3][] = [];
          for (let i = groups[k]; i + 1 < groups[k] + groups[k + 1]; i += 2) segs.push([at(i), at(i + 1)]);
          out.push({ body: id, segs });
        }
      }
    return out;
  }

  /** The body edge within `px` of the pointer that no face in front hides (null: none). */
  private edgeAt(e: MouseEvent, px = 6) {
    const r = this.el.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    const ray = this.ray(e);
    const front = this.intersect(this.raycaster(e))[0]?.distance ?? Infinity;
    let best: { body: string; segs: [THREE.Vector3, THREE.Vector3][]; cut?: true; d: number } | null = null;
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
    return best && { body: best.body, segs: best.segs, cut: best.cut };
  }

  private measureMark = new THREE.Group();

  /** One measure of a box (world) drawn along its edge in `axis` (0 x, 1 y, 2 z) with end ticks; null: clears it. */
  showMeasure(box: THREE.Box3 | null, axis: number) {
    for (const o of this.measureMark.children) ((o as LineSegments2).geometry.dispose(), ((o as LineSegments2).material as THREE.Material).dispose());
    this.measureMark.clear();
    if (box) {
      const [a, b] = [box.min.clone(), box.min.clone()];
      // the front edge: x along the front bottom, y and z up the right front corner
      if (axis) [a.x, b.x] = [box.max.x, box.max.x];
      b.setComponent(axis, box.max.getComponent(axis));
      const tick = box.getSize(new THREE.Vector3()).length() * 0.03;
      const across = new THREE.Vector3().setComponent(axis === 2 ? 0 : 2, tick);
      const pts = [a, b, a.clone().sub(across), a.clone().add(across), b.clone().sub(across), b.clone().add(across)];
      this.measureMark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(pts.flatMap((v) => v.toArray())), new LineMaterial({ color: 0xff8c1a, linewidth: 3, depthTest: false })), { renderOrder: 1e6 }));
    }
    this.render();
  }

  /** A point (world) marked over everything, with a small cross along the axes (null: none). */
  showPoint(at: THREE.Vector3 | null, px = 14) {
    this.showMeasure(null, 0);
    if (at) {
      const r = px / this.pixelsPerMm(at);
      const cross = [0, 1, 2].flatMap((k) => [at.clone().addScaledVector(unit(k), -r), at.clone().addScaledVector(unit(k), r)]);
      this.measureMark.add(Object.assign(new LineSegments2(new LineSegmentsGeometry().setPositions(cross.flatMap((v) => v.toArray())), new LineMaterial({ color: 0xff8c1a, linewidth: 2, depthTest: false })), { renderOrder: 1e6 }), marks([at], 0xff8c1a, 10));
      this.measureMark.traverse((o) => (o.renderOrder = 1e6));
    }
    this.render();
  }

  /** Clears the picked faces and edges. */
  dropPicked() {
    this.pickedEdge = this.pickedFaces = null;
    this.pickedMark = this.replaceMark(this.pickedMark, undefined, [], 0);
    this.markEdge(undefined, this.pickedEdgeMark);
    this.host.pickedPart(null);
  }

  /** Picked faces of one body: lit, their area reported (none: cleared). */
  private pickFaces(mesh: THREE.Mesh, faces: number[]) {
    if (!faces.length) return this.dropPicked();
    this.pickedEdge = null;
    this.markEdge(undefined, this.pickedEdgeMark);
    this.pickedFaces = { mesh, faces };
    this.pickedMark = this.replaceMark(this.pickedMark, mesh, faces, PICKED);
    this.host.pickedPart({ kind: 'face', body: mesh.userData.bodyId, size: faces.reduce((n, k) => n + faceArea(mesh, k), 0), count: faces.length });
  }

  private pickEdges(picked: { body: string; edges: [THREE.Vector3, THREE.Vector3][][] }) {
    if (!picked.edges.length) return this.dropPicked();
    this.pickedEdge = picked;
    this.pickedFaces = null;
    this.pickedMark = this.replaceMark(this.pickedMark, undefined, [], 0);
    this.markEdge(picked.edges.flat(), this.pickedEdgeMark, PICKED);
    const size = picked.edges.flat().reduce((n, [a, b]) => n + a.distanceTo(b), 0);
    // one circle, maybe in parts (segment middles too: a rectangle's corners alone lie on a circle)
    const circle = circleOf(picked.edges.flatMap((segs) => segs.flatMap(([a, b]) => [a, a.clone().lerp(b, 0.5)])));
    this.host.pickedPart({ kind: 'edge', body: picked.body, size, count: picked.edges.length, diameter: circle?.d });
  }

  /**
   * The edges joined to the one near the pointer (end to end) that lie in the plane of the face under it: e.g. all
   * around a rectangle's top. Off a face: that edge alone.
   */
  private edgeLoop(e: MouseEvent) {
    const start = this.edgeAt(e);
    if (!start) return null;
    const hit = this.frontHit(e);
    const plane = hit && new THREE.Plane().setFromNormalAndCoplanarPoint(hit.face!.normal.clone().transformDirection(hit.object.matrixWorld), hit.point);
    const flat = (segs: [THREE.Vector3, THREE.Vector3][]) => !!plane && segs.every(([a, b]) => Math.abs(plane.distanceToPoint(a)) < 0.05 && Math.abs(plane.distanceToPoint(b)) < 0.05);
    if (!flat(start.segs)) return { body: start.body, edges: [start.segs] };
    const ends = (segs: [THREE.Vector3, THREE.Vector3][]) => [segs[0][0], segs[segs.length - 1][1]];
    const pool = this.bodyEdges().filter((x) => x.body === start.body && flat(x.segs));
    const loop = [pool.find((x) => x.segs[0][0].equals(start.segs[0][0]) && x.segs.length === start.segs.length) ?? { body: start.body, segs: start.segs }];
    for (let i = 0; i < loop.length; i++)
      for (const x of pool)
        if (!loop.includes(x) && ends(x.segs).some((p) => ends(loop[i].segs).some((q) => p.distanceTo(q) < 0.01))) loop.push(x);
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
    return [...out, ...this.balls.map((b) => b.center), ...this.cutEdges().corners];
  }

  spheres() {
    return this.balls;
  }

  private measured = new Map<string, { key: string; box: THREE.Box3; volume: number; area: number }>();

  /** A body's box in the world, volume (mm³) and surface area (mm²) from its triangles (null: not built yet); kept until its mesh or place changes. */
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
    const out = { key, box, volume: Math.abs(volume), area };
    this.measured.set(id, out);
    return out;
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
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      );
      mesh.parent!.add(mark);
    }
    this.render();
    return mark;
  }

  /** The selected part of a finish (`mid`: the edge it replaced; null: the whole finish), lit on its body. */
  private finishSel: FinishPick | null = null;
  private finishMark: THREE.Mesh | null = null;

  setFinishMark(sel: FinishPick | null) {
    this.finishSel = sel;
    const solid = sel && (this.bodies.get(sel.body)?.children[0] as THREE.Mesh | undefined);
    const finishes = (solid?.userData.finishes ?? []) as { feature: string; mid: number[] }[];
    const same = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) < 0.01);
    const faces = [...((solid?.userData.finishFaces ?? []) as Int32Array)].flatMap((k, f) =>
      k >= 0 && finishes[k].feature === sel!.feature && (!sel!.mid || same(finishes[k].mid, sel!.mid)) ? [f] : [],
    );
    this.finishMark = this.replaceMark(this.finishMark, solid ?? undefined, faces, 0xff8c1a);
  }

  /** The finish part under a body hit, if the hit face is one. */
  private finishAt(hit: THREE.Intersection): { feature: string; mid: Vec3 } | null {
    const k = (hit.object.userData.finishFaces as Int32Array | undefined)?.[faceOf(hit)] ?? -1;
    return k >= 0 ? (hit.object.userData.finishes as { feature: string; mid: Vec3 }[])[k] : null;
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
    if (this.quietPick) return this.endFacePick({ point: hit?.point.clone() ?? new THREE.Vector3(), normal: new THREE.Vector3(), snap: this.pointAt(e) ?? undefined });
    const s = this.sketchShapeAt(e, hit);
    const sketch = s ? { sketch: { id: s.sketch.id, at: e, shape: 'q' in s && s.onLine ? s.q.id : undefined } } : {};
    if (hit) return this.endFacePick({ point: hit.point.clone(), normal: hit.face!.normal.clone().negate(), body: hit.object.userData.bodyId, ...sketch });
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    const k = this.facingAxis();
    this.endFacePick({ point: new THREE.Vector3(), normal: unit(k).multiplyScalar(Math.sign(look.getComponent(k)) || 1), ...sketch });
  }

  /**
   * A preview of a move by `by` (world, mm; null: back to where it was): the selected bodies move, translucent copies
   * stay where they were; `shapes` show moved, their old outlines grey.
   */
  previewMove(by: THREE.Vector3 | null, shapes: { id: string; profile: DrawnProfile }[] = [], across: { sketch: string; by: THREE.Vector3; bodies: string[] } | null = null, opacity = 0.25) {
    if (!this.moving && by) {
      const looks = [new THREE.MeshBasicMaterial({ color: 0x8a8f98, transparent: true, opacity, depthWrite: false }), new THREE.LineBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 2 * opacity })];
      this.moving = { from: new Map(), carried: new Map(), ghosts: new THREE.Group(), looks };
      this.scene.add(this.moving.ghosts);
      for (const id of this.withOwned(this.selection)) this.ghostAt(id, this.moving.from);
    }
    const m = this.moving;
    if (!m) return;
    for (const [id, at] of m.from) this.group(id).position.copy(at).add(by ?? new THREE.Vector3());
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
      if (o instanceof LineSegments2 || o instanceof THREE.Points) o.visible = false;
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

  /**
   * The step a drag moves in near `at` (mm): it grows with what the screen shows, as a power law (about 1 mm at a normal
   * zoom, 0.5 m with 20 m across the view), rounded to 1-2-5; Shift ten times (`coarse`: where Shift is no constraint),
   * Ctrl the minimum step.
   */
  step(at: THREE.Vector3, e?: { shiftKey: boolean; ctrlKey: boolean }, coarse = true) {
    if (e?.ctrlKey) return this.minStep;
    const raw = 8.67 * (1 / this.pixelsPerMm(at)) ** 1.26;
    const p = 10 ** Math.floor(Math.log10(raw));
    const n = raw / p;
    const nice = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
    return Math.max(this.minStep, nice * (coarse && e?.shiftKey ? 10 : 1));
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
    this.markSketch(null);
    this.markFace();
    if (!this.tool) this.renderer.domElement.classList.remove('drawing');
    done?.(face);
  }

  /**
   * Shows the bodies clipped to the section boxes (an inverted axis shows both sides outside its range), one clipped
   * copy per box, with hatched caps on the cut faces: per plane, the solids' back faces minus their front faces mark
   * the cut area in the stencil buffer, then a plane fills it. `rebound`: measure the bodies again (not while dragging).
   * Planes sit `eps` inside the shown range, so a face lying exactly on a cut is cut away cleanly instead of flickering.
   */
  private applySection(rebound = true, cap = 1e4 /* mm, cap plane size */, hatchMm = 4, shade = 0.6, eps = 1e-3) {
    this.sectionView.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      (o.material as THREE.Material).dispose();
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
      const planes = box.flatMap(([lo, hi], k) => {
        const n = new THREE.Vector3().setComponent(k, 1);
        return [
          ...(Number.isFinite(lo) ? [new THREE.Plane(n.clone(), -lo - eps)] : []),
          ...(Number.isFinite(hi) ? [new THREE.Plane(n.clone().negate(), hi - eps)] : []),
        ];
      });
      planes.push(...this.custom.map((c) => new THREE.Plane(c.normal.clone(), c.constant - eps)));
      this.cutPlanes.push(planes);
      for (const plane of planes) {
        order++;
        for (const [id, g] of this.bodies) {
          const solid = g.children.find((c) => c instanceof THREE.Mesh);
          if (!solid || this.hidden.has(id) || this.cutters.has(id)) continue;
          for (const side of [THREE.BackSide, THREE.FrontSide]) {
            const op = side === THREE.BackSide ? THREE.IncrementWrapStencilOp : THREE.DecrementWrapStencilOp;
            const mark = new THREE.Mesh(
              solid.geometry,
              new THREE.MeshBasicMaterial({
                side,
                clippingPlanes: [plane],
                colorWrite: false,
                depthWrite: false,
                depthTest: false,
                stencilWrite: true,
                stencilFunc: THREE.AlwaysStencilFunc,
                stencilFail: op,
                stencilZFail: op,
                stencilZPass: op,
              }),
            );
            mark.position.copy(g.position);
            mark.quaternion.copy(g.quaternion);
            mark.renderOrder = order;
            this.sectionView.add(mark);
          }
        }
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(cap, cap),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(0xd8c3a0).multiplyScalar(shade),
            map: this.hatch,
            roughness: 0.9,
            clippingPlanes: planes.filter((p) => p !== plane),
            stencilWrite: true,
            stencilRef: 0,
            stencilFunc: THREE.NotEqualStencilFunc,
            stencilFail: THREE.ReplaceStencilOp,
            stencilZFail: THREE.ReplaceStencilOp,
            stencilZPass: THREE.ReplaceStencilOp,
          }),
        );
        face.userData.cap = true;
        plane.coplanarPoint(face.position);
        face.lookAt(face.position.clone().sub(plane.normal));
        face.onAfterRender = (r) => r.clearStencil();
        face.renderOrder = order + 0.5;
        this.sectionView.add(face);
      }
      // the bodies clipped to this box, drawn after the caps
      for (const [id, g] of this.bodies)
        for (const c of this.hidden.has(id) ? [] : g.children) {
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
    for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
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
    bar.append(this.projection, toggle('Grid', 'Show or hide the ground grid', this.grid), toggle('Origin', 'Show or hide the origin axes', this.axes));
    return bar;
  }

  /** A projection chosen by hand stays when leaving a cube side. */
  private pickProjection(on: boolean) {
    this.autoOrtho = false;
    this.setOrthographic(on);
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
    const r = this.el.getBoundingClientRect();
    const grab = this.handles().find((h) => {
      const [x, y] = this.toScreen(h.world);
      return Math.hypot(e.clientX - r.left - x, e.clientY - r.top - y) < 8;
    });
    const held = this.handled();
    if (grab && held) {
      const q0 = uvOf(held.sketch.frame, planeHit(ray.ray, held.sketch.frame) ?? grab.world);
      const h = grab.handle;
      this.edit = { sketch: held.sketch, start: held.shape, handle: h, q0, a0: angleAt(held.shape, q0), typed: [], axis: h.kind === 'resize' && !h.sx ? 1 : 0, last: null, next: null };
      this.downOnPart = true;
      this.controls.enabled = false;
      return this.renderer.domElement.setPointerCapture(e.pointerId);
    }
    const hit = this.focus ? undefined : this.intersect(ray)[0]; // an open sketch group: faded bodies are not picked
    const shape = this.shapeAt(ray.ray, hit?.distance);
    this.downOnPart = !!hit || !!shape;
    if (this.downOnPart) this.host.touched();
    if (hit?.face && hit.face.normal.dot(ray.ray.direction) < 0) {
      this.lastFace = { point: hit.point.clone(), normal: hit.face.normal.clone().negate(), body: hit.object.userData.bodyId };
      this.lastHit = hit;
    }
    if (shape) {
      if (toggles(e)) return this.host.pickShape(shape.sketch, shape.shape, true);
      const member = this.activeSketch === shape.sketch && this.selectedShapes.includes(shape.shape);
      if (!member) this.host.pickShape(shape.sketch, shape.shape, false);
      return this.startShapeMove(ray.ray, shape.sketch, member && this.selectedShapes.length > 1 ? shape.shape : null, e);
    }
    if (picksFace(e)) {
      // a double press: the edge loop
      const loop = this.twice('pick', e) ? this.edgeLoop(e) : null;
      if (loop) return this.host.select(loop.body, false), this.pickEdges(loop);
      // an edge near the pointer, else the face: its body selected and the part picked (a face: E pulls it, S sketches on it);
      // Shift adds it to (or takes it from) the parts picked on that body
      const edge = this.edgeAt(e);
      if (!edge && !hit) return;
      const body = edge?.body ?? (hit!.object.userData.bodyId as string);
      // what is picked already (selecting below starts over)
      const [edges, faces] = [this.pickedEdge?.body === body ? this.pickedEdge.edges : [], this.pickedFaces?.mesh === hit?.object ? this.pickedFaces!.faces : []];
      this.host.select(body, false);
      if (edge) {
        const had = e.shiftKey ? edges : [];
        const same = (segs: [THREE.Vector3, THREE.Vector3][]) => segs.length === edge.segs.length && segs[0][0].distanceTo(edge.segs[0][0]) < 1e-6;
        return this.pickEdges({ body, edges: had.some(same) ? had.filter((x) => !same(x)) : [...had, edge.segs] });
      }
      const k = faceOf(hit!);
      const had = e.shiftKey ? faces : [];
      return this.pickFaces(hit!.object as THREE.Mesh, had.includes(k) ? had.filter((x) => x !== k) : [...had, k]);
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
    const group = this.withOwned(this.selection).map((g) => ({ id: g, from: this.group(g).position.clone() }));
    this.startDrag(e, ray.ray, start, {
      axes: [0, 1, 2],
      lead: group[0].from,
      // the base plane facing the camera most (top view: XY, front: XZ, side: YZ)
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(unit(this.facingAxis()), start),
      only: member && this.selection.length > 1 ? id : null,
      apply: (by) => {
        for (const g of group) this.group(g.id).position.copy(g.from).add(by);
        this.applySection(false);
      },
      end: (by) => {
        if (by) return this.host.move(group.map((g) => ({ id: g.id, position: this.group(g.id).position.toArray() })));
        for (const g of group) this.group(g.id).position.copy(g.from);
        this.applySection();
      },
    });
  }

  /** Readies a move of the selected shapes of `sketch` within its plane (along its two axes). */
  private startShapeMove(ray: THREE.Ray, sketch: string, only: string | null, e: PointerEvent) {
    const s = this.sketches.find((v) => v.id === sketch)!;
    const f = s.frame;
    const [fx, fy] = [new THREE.Vector3(...f.x), new THREE.Vector3(...f.y)];
    const from = s.shapes.filter((q) => this.selectedShapes.includes(q.id));
    const start = planeHit(ray, f) ?? new THREE.Vector3(...f.o);
    const shifted = (by: THREE.Vector3) => from.map((q) => ({ id: q.id, profile: moved(q, by.dot(fx), by.dot(fy)) }));
    const strongest = (v: THREE.Vector3) => [v.x, v.y, v.z].map(Math.abs).reduce((best, c, k, a) => (c > a[best] ? k : best), 0);
    this.startDrag(e, ray, start, {
      axes: [strongest(fx), strongest(fy)],
      lead: new THREE.Vector3(...toWorld(f, ...centre(from[0]))),
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...f.n), start),
      only,
      apply: (by) => {
        for (const { id, profile } of shifted(by)) this.overrides.set(id, profile);
        this.renderSketches();
      },
      end: (by) => {
        if (by) return this.host.setShapes(sketch, shifted(by));
        this.overrides.clear();
        this.renderSketches();
      },
    });
  }

  private startDrag(e: PointerEvent, ray: THREE.Ray, start: THREE.Vector3, o: Pick<Drag, 'axes' | 'lead' | 'plane' | 'only' | 'apply' | 'end'>) {
    this.controls.enabled = false;
    this.drag = { ...o, start, t0: [0, 1, 2].map((k) => along(ray, start, unit(k))), axis: null, typed: undefined, last: null, moved: false, by: new THREE.Vector3() };
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
      if (e.buttons === 1 && !e.shiftKey && !e.ctrlKey && !e.metaKey && this.dragged(e)) this.leaveSideView();
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
      const pulled = along(ray, d.start, unit(d.axis)) - d.t0[d.axis];
      delta = unit(d.axis).multiplyScalar(typed === null ? pulled : typed * (Math.sign(pulled) || 1));
      text = 'XYZ'[d.axis];
    }
    choose(this.wheel, d.axis);
    if (delta) {
      const step = this.step(d.start, e);
      const lead = d.lead;
      d.by =
        (typed !== null && d.axis !== null) || !delta.lengthSq()
          ? delta
          : new THREE.Vector3(round(lead.x + delta.x, step) - lead.x, round(lead.y + delta.y, step) - lead.y, round(lead.z + delta.z, step) - lead.z);
      d.apply(d.by);
      if (d.axis !== null) text += ` ${d.typed === undefined ? this.host.format(d.by.getComponent(d.axis)) : `${d.typed}▏`}`;
    }
    this.label(text, d.start);
  }

  private label(text: string, at: THREE.Vector3) {
    const [x, y] = this.toScreen(at);
    Object.assign(this.moveLabel, { hidden: false, innerHTML: axisHtml(text) });
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
    if (ed.handle.kind === 'rotate') {
      const deg = angleAt(st, q) - ed.a0;
      const turn = e?.ctrlKey ? 0.1 : e?.shiftKey ? 15 : 1; // degrees
      ed.next = rotated(st, Math.round(deg / turn) * turn);
      this.label(`${(ed.next.kind === 'circle' || ed.next.kind === 'line' ? 0 : ed.next.rot).toFixed(1)}°`, world);
    } else {
      const typed = ed.typed.map((t) => (t === undefined ? undefined : (this.host.length(t) ?? undefined))) as [number | undefined, number | undefined];
      ed.next = resized(st, ed.handle, ed.q0, q, { alt: !!e?.altKey, shift: !!e?.shiftKey, step: this.step(world, e ?? undefined, false), typed });
      const [w, h] = sizeOf(ed.next);
      const body = (k: number, name: string, mm: number) => `${name}${k === ed.axis ? '▸' : ' '}${ed.typed[k] === undefined ? this.host.format(mm) : `${ed.typed[k]}▏`}`;
      this.label(st.kind === 'circle' ? body(ed.axis, 'Ø', w) : `${body(0, 'W', w)}   ${body(1, 'H', h)}`, world);
    }
    this.overrides.set(st.id, ed.next);
    this.renderSketches();
  }

  /** Keys while resizing: typing sets the size of the marked axis, Tab the other one, Enter keeps, Esc undoes. */
  private editKey(e: KeyboardEvent): boolean {
    const ed = this.edit!;
    if (pressed(e, 'confirm') || pressed(e, 'cancel')) return this.endEdit(pressed(e, 'confirm')), true;
    if (ed.handle.kind !== 'resize') return false;
    if (pressed(e, 'otherSide')) ed.axis = 1 - ed.axis;
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
    if (!ed) return;
    if (keep && ed.next) {
      const [a, b] = ed.typed;
      const typed = ed.start.kind === 'circle' ? { d: a ?? b } : { w: a, h: b };
      return this.host.setShapes(ed.sketch.id, [{ id: ed.start.id, profile: ed.next }], typed);
    }
    this.overrides.clear();
    this.renderSketches();
  }

  /** Keys during a move: typing sets the distance, Enter keeps the move, Esc undoes it. */
  private dragKey(e: KeyboardEvent): boolean {
    const d = this.drag!;
    if (pressed(e, 'confirm') || pressed(e, 'cancel')) this.endDrag(pressed(e, 'confirm'));
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
    if (this.edit) return this.endEdit(true);
    const d = this.drag;
    if (d?.moved) return this.endDrag(true);
    this.drag = null;
    this.controls.enabled = true;
    if (d?.only) return this.sketches.some((s) => s.shapes.some((q) => q.id === d.only)) ? this.host.pickShape(this.activeSketch!, d.only, false) : this.host.select(d.only, false);
    if (!d && !this.downOnPart && e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !this.dragged(e)) this.host.select(null, false);
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
          onclick: () => this.viewFrom(fromCube(dir)),
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
                this.viewFrom(fromCube(corner), false);
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
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target).applyQuaternion(toCube));
      s.theta -= e.movementX * dragSpeed;
      s.phi -= e.movementY * dragSpeed;
      const offset = new THREE.Vector3().setFromSpherical(s.makeSafe()).applyQuaternion(toCube.clone().invert());
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
      onclick: () => {
        const face = this.lastFace;
        const show = (f: PickedFace | null) => f && this.lookAlong(f.normal.clone().negate(), f.point);
        if (face?.body && this.selection.includes(face.body)) show(face);
        else this.pickFace(show);
      },
    });
    const fit = Object.assign(document.createElement('button'), { className: 'tool fit', title: 'Fit (F): move the camera back or forth, as it looks now, until everything is in view', innerHTML: icon('fit'), onclick: () => this.fit() });
    const home = Object.assign(document.createElement('button'), { className: 'tool', title: 'Home (H): everything framed from the front-right corner', innerHTML: icon('home'), onclick: () => this.home() });
    const below = Object.assign(document.createElement('div'), { className: 'below-cube' });
    below.append(look, fit, home);
    this.cubeWrap.className = 'viewcube';
    this.cubeWrap.append(this.cube, ...arrows, below);
    return this.cubeWrap;
  }

  /** Looks at the neighbouring side: the one to the right / left / above / below on screen. */
  private turn(side: 'up' | 'down' | 'left' | 'right') {
    const [x, y] = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[side];
    const dir = this.screenAxis(x, y);
    if (dir.z) dir.addScaledVector(this.camera.position.clone().sub(this.controls.target).normalize(), 1e-3); // off the pole, towards the old view
    this.viewFrom(dir);
  }

  /** The user rotated away from a cube side: hide the arrows, back to perspective if the cube switched to orthographic. */
  private leaveSideView() {
    this.flat = false;
    this.cubeWrap.classList.remove('aligned');
    if (!this.autoOrtho) return;
    this.autoOrtho = false;
    this.setOrthographic(false);
  }

  /** Turns the camera to look from `dir` (same target and distance); `side`: straight at a cube side, switching to orthographic for it. */
  private viewFrom(dir: THREE.Vector3, side = true, ms = 600, at?: THREE.Vector3) {
    // leaving an angled view for a flat one: remember it, so pulling can return to it
    if (side && !this.flat) this.angledView = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!side) this.leaveSideView();
    else {
      this.flat = true;
      // the cube's turn arrows only for one of its 6 sides
      this.cubeWrap.classList.toggle('aligned', Math.max(...dir.toArray().map(Math.abs)) / dir.length() > 0.999);
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
      } else this.controls.update();
    };
    requestAnimationFrame(animate);
  }
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
  // joined at shared ends (0.1 µm), grown both ways from each segment not taken yet
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
        const j = ends.get(key(end))?.find((k) => !used.has(k));
        if (j === undefined) return;
        used.add(j);
        const [a, b] = segs[j];
        const fromEnd = key(a) === key(end);
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
