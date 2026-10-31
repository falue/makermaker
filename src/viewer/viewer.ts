import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BasePlane } from '../doc/types';
import type { PartMesh } from '../kernel/build';
import { along, axisWheel, choose } from './gizmo';
import { SketchTool, type Cap, type SketchEdit, type ToolHost, type ToolKind, type ToolView } from './sketch';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';
type Span = [number, number];

export interface ViewerHost {
  /** `add`: Shift-click, adds the part to the selection or removes it. */
  select(id: string | null, add: boolean): void;
  /** Parts were dragged to new positions (mm). */
  move(moves: { id: string; position: Vec3 }[]): void;
  /** A typed distance in mm, or null if invalid. */
  length(text: string): number | null;
  /** A length in mm, as shown to the user. */
  format(mm: number): string;
}

/** A face picked for a section: a point on it, the normal pointing away from the camera, and how deep its part reaches along that. */
export interface PickedFace {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  depth: number;
}

// The view cube works in three's y-up frame: world (x, y, z) is cube (x, z, -y); Front looks from -y.
const toCube = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const fromCube = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.z, v.y);
const round = (v: number, step: number) => Math.round(v / step) * step;
const unit = (k: number) => new THREE.Vector3().setComponent(k, 1);

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

interface Drag {
  /** Press point on the part: the wheel's centre. */
  start: THREE.Vector3;
  /** Per axis, where the press ray passes closest to the axis line through `start`; axis moves count from there. */
  t0: number[];
  /** Alt: free in the base plane facing the camera, through `start`. */
  plane: THREE.Plane;
  /** Picked by the drag direction when leaving the wheel's dead zone; null inside it or in the plane. */
  axis: number | null;
  /** A distance typed while dragging, moved exactly along the axis. */
  typed: string | undefined;
  last: PointerEvent | null;
  group: { id: string; from: THREE.Vector3 }[];
  moved: boolean;
  /** A click on a member of a multi-selection that does not move selects just that one. */
  only: string | null;
}

/**
 * Z-up viewport. Dragging a part moves it along one axis, picked by the drag direction like a weapon wheel (shown at
 * the press point; leaving its dead zone picks the axis, going back through it frees it; typing sets the distance;
 * Alt: free in the base plane facing the camera; Ctrl snaps to `snapStep`). Clicking a cut face picks its part. Drag the background to orbit, right-drag pans, wheel zooms. The view cube top right turns the camera; clicking a side switches
 * to orthographic until the next rotation. Top left: Ortho / Persp and Fit. A sketch tool takes the pointer while active.
 */
export class Viewer implements ToolView {
  snapStep = 5; // mm
  /** End faces of extrusions, where sketches can start. */
  caps: Cap[] = [];
  overlay = new THREE.Group();

  private renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  private scene = new THREE.Scene();
  private perspective = new THREE.PerspectiveCamera(35, 1, 1, 50000);
  private orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.orthographic;
  private controls = new OrbitControls(this.camera, this.renderer.domElement);
  private viewHeight = 400; // orthographic frustum height in mm at zoom 1
  private parts = new Map<string, THREE.Group>();
  private selection: string[] = [];
  private frame = 0;
  private grid = new THREE.Group();
  private dark = matchMedia('(prefers-color-scheme: dark)');
  private pick: THREE.Ray | null = null; // last click, for Tab cycling
  private downAt = { x: 0, y: 0 };
  private downOnPart = false; // the last press hit a part: its release is no click on empty space
  private drag: Drag | null = null;
  private fitted = false;
  private tool: SketchTool | null = null;
  private toolPress = false;
  private projection = document.createElement('span');
  private wheel = axisWheel();
  private wheelPx = 70; // spoke length on screen
  private deadPx = 24; // dead zone radius: no axis until the pointer leaves it
  private moveLabel = Object.assign(document.createElement('div'), { className: 'size-label active', hidden: true });
  private facePick: ((face: PickedFace | null) => void) | null = null;
  /** Custom section planes; each keeps its positive side. */
  private custom: THREE.Plane[] = [];
  private axes = new THREE.AxesHelper(30);

  /** Visible range per axis as fractions of the parts' bounding box (0..1); inverted shows only what is outside. */
  private sections: Record<Axis, Span> = { x: [0, 1], y: [0, 1], z: [0, 1] };
  private inverted: Record<Axis, boolean> = { x: false, y: false, z: false };
  /** The shown region while sectioned: boxes of [min, max] per axis (mm); empty when not sectioned. */
  private boxes: Span[][] = [];
  private sectionView = new THREE.Group();
  private hatch = hatchTexture();

  /** Set when a view cube click switched to orthographic; the next rotation switches back to perspective. */
  private autoOrtho = false;
  private cube = document.createElement('div');
  private cubeWrap = document.createElement('div');

  private material = new THREE.MeshStandardMaterial({
    color: 0xd8c3a0,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private selectedMaterial = this.material.clone();
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2a2a2a });

  constructor(
    readonly el: HTMLElement,
    private host: ViewerHost,
  ) {
    this.selectedMaterial.color.set(0x8fb4ff);
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.localClippingEnabled = true;
    const canvas = this.renderer.domElement;
    el.append(canvas, this.viewCube(), this.cameraControls(), this.moveLabel);

    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, -2, 3);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888880, 2), sun, this.grid, this.axes, this.sectionView, this.overlay, this.wheel);
    // grid first, then the origin lines over it; neither hides parts
    (this.axes.material as THREE.Material).depthTest = false;
    this.axes.renderOrder = -1;
    this.applyTheme();
    this.dark.addEventListener('change', this.applyTheme);

    this.controls.addEventListener('change', this.render);
    new ResizeObserver(() => this.resize()).observe(el);
    // frame the default box now: a first frame looking straight down shows the cube's Front edge-on, and Chrome keeps it unpainted
    this.fit();

    // capture: runs before the orbit controls, so grabbing a part or drawing does not orbit
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== canvas) return;
        if (this.facePick && e.button === 0) {
          e.stopPropagation();
          return this.pickFaceAt(e);
        }
        if (this.tool?.down(e)) {
          this.toolPress = true;
          canvas.setPointerCapture(e.pointerId);
          e.stopPropagation();
        } else this.down(e);
      },
      { capture: true },
    );
    canvas.addEventListener('pointermove', (e) => (this.tool?.move(e), this.move(e)));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.toolPress) return this.up(e);
      this.toolPress = false;
      this.tool?.up();
    });
    canvas.addEventListener('dblclick', () => this.tool?.dblclick());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Ctrl+click on macOS would open it
    // a move, a face pick or a tool sees keys first (not those typed into fields)
    addEventListener(
      'keydown',
      (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        const used = this.drag?.moved ? this.dragKey(e) : this.facePick ? e.key === 'Escape' && (this.endFacePick(null), true) : this.tool?.key(e);
        if (!used) return;
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true },
    );
  }

  /** The running tool: its drawing kind (null: selecting) and whether it is a sketch session. */
  get activeTool() {
    return this.tool ? { kind: this.tool.kind, session: this.tool.inSession } : null;
  }

  startTool(kind: ToolKind, host: ToolHost) {
    this.stopTool();
    this.tool = new SketchTool(kind, this, host);
    this.renderer.domElement.classList.add('drawing');
  }

  /** A sketch session: pick a plane (or reopen `edit`), draw several shapes, finish. */
  startSketch(host: ToolHost, edit?: SketchEdit) {
    this.stopTool();
    this.tool = new SketchTool('rect', this, host, edit ?? true);
    this.renderer.domElement.classList.add('drawing');
  }

  setToolKind(kind: ToolKind | null) {
    this.tool?.setKind(kind);
  }

  finishSketch() {
    this.tool?.finish();
  }

  lookAlong(n: THREE.Vector3) {
    // straight up/down is a pole for the orbit controls: tilt a hair towards the front
    this.viewFrom(Math.abs(n.z) > 0.999 ? new THREE.Vector3(0, -1e-3, Math.sign(n.z)) : n.clone());
  }

  /** The next click on a part picks a face (null: Esc). */
  pickFace(done: (face: PickedFace | null) => void) {
    this.facePick = done;
    this.renderer.domElement.classList.add('drawing');
  }

  setCustomSections(planes: { point: Vec3; normal: Vec3 }[]) {
    this.custom = planes.map((p) => {
      const n = new THREE.Vector3(...p.normal).normalize();
      return new THREE.Plane(n, -n.dot(new THREE.Vector3(...p.point)));
    });
    this.applySection();
  }

  stopTool() {
    this.tool?.dispose();
    this.tool = null;
    this.toolPress = false;
    this.renderer.domElement.classList.remove('drawing');
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

  setPart(id: string, mesh: PartMesh) {
    const group = this.group(id);
    this.disposeChildren(group);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const solid = new THREE.Mesh(geometry, this.selection.includes(id) ? this.selectedMaterial : this.material);
    solid.userData.partId = id;
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
    group.add(solid, new THREE.LineSegments(edges, this.edgeMaterial));
    if (!this.fitted) {
      this.fitted = true;
      requestAnimationFrame(() => this.fit()); // after the other parts of this batch
    }
    this.applySection();
  }

  setPosition(id: string, [x, y, z]: number[]) {
    if (this.drag?.group.some((g) => g.id === id)) return;
    this.group(id).position.set(x, y, z);
    this.applySection();
  }

  /** Removes parts that are no longer in the document. */
  retain(ids: Set<string>) {
    for (const [id, group] of this.parts) {
      if (ids.has(id)) continue;
      this.disposeChildren(group);
      this.scene.remove(group);
      this.parts.delete(id);
    }
    this.applySection();
  }

  select(ids: string[]) {
    this.selection = ids;
    for (const [id, group] of this.parts)
      for (const c of group.children)
        if (c instanceof THREE.Mesh) c.material = ids.includes(id) ? this.selectedMaterial : this.material;
    this.applySection();
  }

  setSection(axis: Axis, from: number, to: number, inverted: boolean) {
    this.sections[axis] = [from, to];
    this.inverted[axis] = inverted;
    this.applySection();
  }

  /** Frames everything again once the next geometry arrives (new or opened document). */
  fitNext() {
    this.fitted = false;
  }

  /** Tab: selects the next (`step` 1) or previous part along the last click's ray. */
  cycle(step: number) {
    if (!this.pick) return;
    const ids = [
      ...new Set(
        this.intersect(new THREE.Raycaster(this.pick.origin, this.pick.direction)).map((h) => h.object.userData.partId as string),
      ),
    ];
    if (!ids.length) return;
    let i = ids.findIndex((id) => this.selection.includes(id));
    if (i < 0) i = -step; // none of them selected: start at the nearest
    this.host.select(ids[(i + step + ids.length) % ids.length], false);
  }

  /** The world axis nearest to the screen direction (`x` right, `y` up), e.g. for arrow-key nudging. */
  screenAxis(x: number, y: number) {
    const v = new THREE.Vector3(x, y, 0).applyQuaternion(this.camera.quaternion);
    const parts = [v.x, v.y, v.z];
    const i = parts.reduce((best, c, k) => (Math.abs(c) > Math.abs(parts[best]) ? k : best), 0);
    return new THREE.Vector3().setComponent(i, Math.sign(parts[i]));
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
    this.controls.object = to;
    this.controls.update();
    this.projection.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === on));
    this.render();
  }

  /**
   * Frames all parts so they fit both the width and the height of the view: from the front-right corner, or
   * (`keepAngle`) from the direction the camera looks now.
   */
  fit(keepAngle = false) {
    const box = new THREE.Box3();
    for (const g of this.parts.values()) box.expandByObject(g);
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 20));
    const target = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // seen from the front-right corner: 45° around the vertical axis, ~40° above the horizon
    const dir = keepAngle
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(1.1 * Math.SQRT1_2, -1.1 * Math.SQRT1_2, 0.9).normalize();
    const o = this.orthographic;
    o.position.copy(target).addScaledVector(dir, Math.max(size.x, size.y, size.z) * 2);
    if (keepAngle) o.quaternion.copy(this.camera.quaternion); // also keeps the roll of straight-down views
    else o.lookAt(target);
    o.updateMatrixWorld();
    // half extents of the box as seen from the camera
    let halfW = 0;
    let halfH = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorldInverse);
          halfW = Math.max(halfW, Math.abs(v.x));
          halfH = Math.max(halfH, Math.abs(v.y));
        }
    const { clientWidth: w, clientHeight: h } = this.el;
    const aspect = h ? w / h : 1;
    const margin = 1.1;
    this.viewHeight = 2 * Math.max(halfH, halfW / aspect) * margin;
    this.updateFrustums(aspect);
    o.zoom = 1;
    o.updateProjectionMatrix();
    // perspective: same direction, far enough that the same height fits (near corners appear larger, hence the margin)
    const dist = (this.viewHeight * margin) / (2 * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
    this.perspective.position.copy(target).addScaledVector(dir, dist);
    this.perspective.quaternion.copy(o.quaternion);
    this.controls.target.copy(target);
    this.controls.update();
    this.render();
  }

  render = () => {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.placeWheel();
      this.renderer.render(this.scene, this.camera);
      // the view cube shows the camera's rotation (cube frame mirrored into CSS's y-down frame)
      const e = new THREE.Matrix4().makeRotationFromQuaternion(toCube.clone().multiply(this.camera.quaternion)).invert().elements;
      this.cube.style.transform = `matrix3d(${e[0]},${-e[1]},${e[2]},0,${-e[4]},${e[5]},${-e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`;
    });
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
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

  private applyTheme = () => {
    const dark = this.dark.matches;
    this.scene.background = new THREE.Color(dark ? 0x1c1d20 : 0xeeeeec);
    const grid = new THREE.GridHelper(1000, 100, dark ? 0x45474d : 0xbbbbbb, dark ? 0x2c2e32 : 0xd6d6d4);
    grid.rotation.x = Math.PI / 2;
    grid.material.depthWrite = false;
    grid.renderOrder = -2;
    this.grid.children.forEach((c) => (c as THREE.GridHelper).dispose());
    this.grid.clear().add(grid);
    this.render();
  };

  /** While a move runs: at its press point, spokes `wheelPx` long on screen, the dead zone ring facing the camera. */
  private placeWheel() {
    const d = this.drag;
    this.wheel.visible = !!d?.moved;
    if (!d?.moved) return;
    this.wheel.position.copy(d.start);
    this.wheel.scale.setScalar(this.wheelPx / this.pixelsPerMm(d.start));
    const ring = this.wheel.getObjectByName('dead')!;
    ring.quaternion.copy(this.camera.quaternion);
    ring.scale.setScalar(this.deadPx / this.wheelPx);
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
    let best = 0;
    let score = -1;
    spokes.forEach(([x, y], k) => {
      const len = Math.hypot(x, y);
      const fit = Math.abs(x * dx + y * dy) / (len * Math.hypot(dx, dy));
      if (len >= short * longest && fit > score) [best, score] = [k, fit];
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

  /** Part hits, nearest first, outside cut-away regions; while sectioned back faces count too, so a cut face picks its part. */
  private intersect(ray: THREE.Raycaster) {
    const side = this.boxes.length ? THREE.DoubleSide : THREE.FrontSide;
    this.material.side = this.selectedMaterial.side = side;
    const hits = ray.intersectObjects(this.meshes()).filter((h) => this.shown(h.point));
    this.material.side = this.selectedMaterial.side = THREE.FrontSide;
    return hits;
  }

  private pickFaceAt(e: PointerEvent) {
    const ray = this.raycaster(e);
    const hit = this.intersect(ray)[0];
    if (!hit?.face || hit.face.normal.dot(ray.ray.direction) > 0) return;
    const normal = hit.face.normal.clone().negate(); // faces point at the camera: keep the side behind the face
    const box = new THREE.Box3().setFromObject(hit.object);
    let depth = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) depth = Math.max(depth, normal.dot(new THREE.Vector3(x, y, z).sub(hit.point)));
    this.endFacePick({ point: hit.point.clone(), normal, depth });
  }

  private endFacePick(face: PickedFace | null) {
    const done = this.facePick;
    this.facePick = null;
    if (!this.tool) this.renderer.domElement.classList.remove('drawing');
    done?.(face);
  }

  /**
   * Shows the parts clipped to the section boxes (an inverted axis shows both sides outside its range), one clipped
   * copy per box, with hatched caps on the cut faces: per plane, the solids' back faces minus their front faces mark
   * the cut area in the stencil buffer, then a plane fills it. `rebound`: measure the parts again (not while dragging).
   * Planes sit `eps` inside the shown range, so a face lying exactly on a cut is cut away cleanly instead of flickering.
   */
  private applySection(rebound = true, cap = 1e4 /* mm, cap plane size */, hatchMm = 4, shade = 0.6, eps = 1e-3) {
    this.sectionView.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      (o.material as THREE.Material).dispose();
      if (o.userData.cap) o.geometry.dispose();
    });
    this.sectionView.clear();
    const axes = ['x', 'y', 'z'] as const;
    const active = this.custom.length > 0 || axes.some((a) => this.inverted[a] || this.sections[a][0] > 0 || this.sections[a][1] < 1);
    if (rebound) {
      const bounds = new THREE.Box3();
      for (const g of this.parts.values()) bounds.expandByObject(g);
      const range = (a: Axis): Span => {
        const [from, to] = this.sections[a];
        const lo = bounds.min[a];
        const size = bounds.max[a] - lo;
        return [from > 0 ? lo + from * size : -Infinity, to < 1 ? lo + to * size : Infinity];
      };
      const spans = (a: Axis): Span[] => {
        const [lo, hi] = range(a);
        return this.inverted[a] ? ([[-Infinity, lo], [hi, Infinity]] as Span[]).filter(([s, e]) => s < e) : [[lo, hi]];
      };
      this.boxes =
        active && !bounds.isEmpty() ? spans('x').flatMap((x) => spans('y').flatMap((y) => spans('z').map((z) => [x, y, z]))) : [];
    }
    const sectioned = this.boxes.length > 0;
    for (const g of this.parts.values()) g.visible = !sectioned;
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
      for (const plane of planes) {
        order++;
        for (const g of this.parts.values()) {
          const solid = g.children.find((c) => c instanceof THREE.Mesh);
          if (!solid) continue;
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
            mark.renderOrder = order;
            this.sectionView.add(mark);
          }
        }
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(cap, cap),
          new THREE.MeshStandardMaterial({
            color: this.material.color.clone().multiplyScalar(shade),
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
      // the parts clipped to this box, drawn after the caps
      for (const [id, g] of this.parts)
        for (const c of g.children) {
          const solid = c instanceof THREE.Mesh;
          const material = (solid ? (this.selection.includes(id) ? this.selectedMaterial : this.material) : this.edgeMaterial).clone();
          material.clippingPlanes = planes;
          const copy = solid ? new THREE.Mesh(c.geometry, material) : new THREE.LineSegments((c as THREE.LineSegments).geometry, material);
          copy.position.copy(g.position);
          copy.renderOrder = 1e6;
          this.sectionView.add(copy);
        }
    }
    this.render();
  }

  private group(id: string) {
    let group = this.parts.get(id);
    if (!group) {
      group = new THREE.Group();
      this.parts.set(id, group);
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
    const parts = [look.x, look.y, look.z].map(Math.abs);
    return parts.indexOf(Math.max(...parts));
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
    bar.append(this.projection, button('Fit', 'Fit everything into the view (F)', () => this.fit()));
    return bar;
  }

  /** A projection chosen by hand stays when leaving a cube side. */
  private pickProjection(on: boolean) {
    this.autoOrtho = false;
    this.setOrthographic(on);
  }

  private meshes() {
    return [...this.parts.values()].flatMap((g) => g.children.filter((c) => c instanceof THREE.Mesh));
  }

  private raycaster(e: MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return ray;
  }

  /** Pressing a part selects it (Shift: adds or removes, no move) and readies a move of the selection. */
  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const ray = this.raycaster(e);
    this.pick = ray.ray.clone();
    const hit = ray.intersectObjects(this.meshes()).find((h) => this.shown(h.point));
    this.downOnPart = !!hit;
    if (!hit) return;
    const id = hit.object.userData.partId as string;
    if (e.shiftKey) return this.host.select(id, true);
    const member = this.selection.includes(id);
    if (!member) this.host.select(id, false);
    const start = hit.point.clone();
    this.controls.enabled = false;
    this.drag = {
      typed: undefined,
      last: null,
      start,
      t0: [0, 1, 2].map((k) => along(ray.ray, start, unit(k))),
      // the base plane facing the camera most (top view: XY, front: XZ, side: YZ)
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(unit(this.facingAxis()), start),
      axis: null,
      group: this.selection.map((g) => ({ id: g, from: this.group(g).position.clone() })),
      moved: false,
      only: member && this.selection.length > 1 ? id : null,
    };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
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
   * Moves the dragged parts together: inside the dead zone they stay put and the axis is free; leaving it picks the axis
   * whose spoke points most along the drag, kept until the pointer comes back through. A typed distance moves exactly
   * that far (in the direction dragged); else the first part lands on the snap step (Ctrl). Alt: free in the plane.
   */
  private applyDrag(d: Drag) {
    const e = d.last!;
    this.placeWheel();
    const ray = this.raycaster(e).ray;
    const typed = d.typed === undefined ? null : this.host.length(d.typed);
    let delta: THREE.Vector3 | null = new THREE.Vector3();
    let text: string;
    if (e.altKey) {
      d.axis = null;
      delta = ray.intersectPlane(d.plane, new THREE.Vector3())?.sub(d.start) ?? null;
      text = 'free';
    } else if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < this.deadPx) {
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
      const step = e.ctrlKey ? this.snapStep : 0.1;
      const lead = d.group[0].from;
      const by =
        (typed !== null && d.axis !== null) || !delta.lengthSq()
          ? delta
          : new THREE.Vector3(round(lead.x + delta.x, step) - lead.x, round(lead.y + delta.y, step) - lead.y, round(lead.z + delta.z, step) - lead.z);
      for (const g of d.group) this.group(g.id).position.copy(g.from).add(by);
      if (d.axis !== null) text += ` ${d.typed === undefined ? this.host.format(by.getComponent(d.axis)) : `${d.typed}▏`}`;
    }
    const [x, y] = this.toScreen(d.start);
    Object.assign(this.moveLabel, { hidden: false, textContent: text });
    this.moveLabel.style.cssText = `left:${x + 60}px;top:${y + 40}px`;
    this.applySection(false);
  }

  /** Keys during a move: typing sets the distance, Enter keeps the move, Esc undoes it. */
  private dragKey(e: KeyboardEvent): boolean {
    const d = this.drag!;
    if (e.key === 'Enter' || e.key === 'Escape') this.endDrag(e.key === 'Enter');
    else if (e.key === 'Backspace') d.typed = d.typed?.slice(0, -1) || undefined;
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) d.typed = (d.typed ?? '') + e.key;
    else return false;
    if (this.drag) this.applyDrag(d);
    return true;
  }

  /** Ends a move: hands the new positions over, or puts the parts back. */
  private endDrag(keep: boolean) {
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.moveLabel.hidden = true;
    if (!d) return;
    if (keep && d.moved) this.host.move(d.group.map((g) => ({ id: g.id, position: this.group(g.id).position.toArray() })));
    else for (const g of d.group) this.group(g.id).position.copy(g.from);
    this.applySection();
  }

  /** Ends a move, or handles a click: on empty space it deselects (unless Shift). */
  private up(e: PointerEvent) {
    const d = this.drag;
    if (d?.moved) return this.endDrag(true);
    this.drag = null;
    this.controls.enabled = true;
    if (d?.only) return this.host.select(d.only, false);
    if (!d && !this.downOnPart && e.button === 0 && !e.shiftKey && !this.dragged(e)) this.host.select(null, false);
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
    this.cubeWrap.className = 'viewcube';
    this.cubeWrap.append(this.cube, ...arrows);
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
    this.cubeWrap.classList.remove('aligned');
    if (!this.autoOrtho) return;
    this.autoOrtho = false;
    this.setOrthographic(false);
  }

  /** Turns the camera to look from `dir` (same target and distance); `side`: straight at a cube side, switching to orthographic for it. */
  private viewFrom(dir: THREE.Vector3, side = true, ms = 300) {
    if (!side) this.leaveSideView();
    else this.cubeWrap.classList.add('aligned');
    if (side && !this.isOrthographic) {
      this.setOrthographic(true);
      this.autoOrtho = true;
    }
    const target = this.controls.target;
    const cam = this.camera;
    const dist = cam.position.distanceTo(target);
    const from = cam.position.clone().sub(target).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize());
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = t * t * (3 - 2 * t);
      cam.position.copy(target).addScaledVector(from.clone().applyQuaternion(new THREE.Quaternion().slerp(turn, k)), dist);
      this.controls.update();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
