import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PartMesh } from '../kernel/build';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export type Vec3 = [number, number, number];

export interface ViewerHost {
  /** `add`: Shift-click, adds the part to the selection or removes it. */
  select(id: string | null, add: boolean): void;
  /** Parts were dragged to new positions (mm). */
  move(moves: { id: string; position: Vec3 }[]): void;
  /** The camera switched between orthographic and perspective on its own. */
  projection(): void;
}

// The view cube works in three's y-up frame: world (x, y, z) is cube (x, z, -y); Front looks from -y.
const toCube = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const fromCube = (v: THREE.Vector3) => new THREE.Vector3(v.x, -v.z, v.y);
const round = (v: number, step: number) => Math.round(v / step) * step;

interface Drag {
  plane: THREE.Plane;
  start: THREE.Vector3;
  group: { id: string; from: THREE.Vector3 }[];
  moved: boolean;
  /** A click on a member of a multi-selection that does not move selects just that one. */
  only: string | null;
}

/**
 * Z-up viewport. Drag a part to move it (Ctrl snaps to `snapStep`), drag the background to orbit, right-drag pans,
 * wheel zooms. The view cube top right turns the camera; clicking a side switches to orthographic until the next rotation.
 */
export class Viewer {
  snapStep = 5; // mm

  private renderer = new THREE.WebGLRenderer({ antialias: true });
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
  private drag: Drag | null = null;
  private fitted = false;

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
    private el: HTMLElement,
    private host: ViewerHost,
  ) {
    this.selectedMaterial.color.set(0x8fb4ff);
    this.renderer.setPixelRatio(devicePixelRatio);
    const canvas = this.renderer.domElement;
    el.append(canvas, this.viewCube());

    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, -2, 3);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888880, 2), sun, this.grid, new THREE.AxesHelper(30));
    this.applyTheme();
    this.dark.addEventListener('change', this.applyTheme);

    this.controls.addEventListener('change', this.render);
    new ResizeObserver(() => this.resize()).observe(el);

    // capture: runs before the orbit controls, so grabbing a part does not orbit
    el.addEventListener('pointerdown', (e) => e.target === canvas && this.down(e), { capture: true });
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Ctrl+click on macOS would open it
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
    this.render();
  }

  setPosition(id: string, [x, y, z]: number[]) {
    if (this.drag?.group.some((g) => g.id === id)) return;
    this.group(id).position.set(x, y, z);
    this.render();
  }

  /** Removes parts that are no longer in the document. */
  retain(ids: Set<string>) {
    for (const [id, group] of this.parts) {
      if (ids.has(id)) continue;
      this.disposeChildren(group);
      this.scene.remove(group);
      this.parts.delete(id);
    }
    this.render();
  }

  select(ids: string[]) {
    this.selection = ids;
    for (const [id, group] of this.parts)
      for (const c of group.children)
        if (c instanceof THREE.Mesh) c.material = ids.includes(id) ? this.selectedMaterial : this.material;
    this.render();
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
        new THREE.Raycaster(this.pick.origin, this.pick.direction).intersectObjects(this.meshes()).map((h) => h.object.userData.partId as string),
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

  private render = () => {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
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
    this.grid.children.forEach((c) => (c as THREE.GridHelper).dispose());
    this.grid.clear().add(grid);
    this.render();
  };

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

  private meshes() {
    return [...this.parts.values()].flatMap((g) => g.children.filter((c) => c instanceof THREE.Mesh));
  }

  private raycaster(e: MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return ray;
  }

  /** Grabbing a part selects it (Shift: adds or removes) and starts moving the selection on a plane through the grab point. */
  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const ray = this.raycaster(e);
    this.pick = ray.ray.clone();
    const hit = ray.intersectObjects(this.meshes())[0];
    if (!hit) return;
    const id = hit.object.userData.partId as string;
    const member = this.selection.includes(id);
    if (e.shiftKey || !member) this.host.select(id, e.shiftKey);
    if (!this.selection.includes(id)) return; // Shift-click removed it
    this.controls.enabled = false;
    // horizontal plane, or the screen plane when looking from the side
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    const normal = Math.abs(look.z) > 0.3 ? new THREE.Vector3(0, 0, 1) : look.negate();
    this.drag = {
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
      start: hit.point.clone(),
      group: this.selection.map((g) => ({ id: g, from: this.group(g).position.clone() })),
      moved: false,
      only: !e.shiftKey && member && this.selection.length > 1 ? id : null,
    };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }

  /** Moves the dragged parts together; the first one lands on the snap step (Ctrl). */
  private move(e: PointerEvent) {
    const d = this.drag;
    if (!d) {
      // a left drag without modifiers rotates: that leaves the side view the cube set up
      if (e.buttons === 1 && !e.shiftKey && !e.ctrlKey && !e.metaKey && this.dragged(e)) this.leaveSideView();
      return;
    }
    if (!d.moved && !this.dragged(e)) return;
    const p = this.raycaster(e).ray.intersectPlane(d.plane, new THREE.Vector3());
    if (!p) return;
    d.moved = true;
    const step = e.ctrlKey ? this.snapStep : 0.1;
    const lead = d.group[0].from;
    const delta = p.sub(d.start);
    const by = new THREE.Vector3(
      round(lead.x + delta.x, step) - lead.x,
      round(lead.y + delta.y, step) - lead.y,
      round(lead.z + delta.z, step) - lead.z,
    );
    for (const g of d.group) this.group(g.id).position.copy(g.from).add(by);
    this.render();
  }

  /** Ends a move, or handles a click: on empty space it deselects (unless Shift). */
  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    if (d?.moved) return this.host.move(d.group.map((g) => ({ id: g.id, position: this.group(g.id).position.toArray() })));
    if (d?.only) return this.host.select(d.only, false);
    if (!d && e.button === 0 && !e.shiftKey && !this.dragged(e)) this.host.select(null, false);
  }

  private dragged(e: PointerEvent) {
    return Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
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
    // dragging the cube orbits the camera; the capture makes the release no click on a face
    let last = { x: 0, y: 0 };
    this.cube.onpointerdown = (e) => (last = { x: e.clientX, y: e.clientY });
    this.cube.onpointermove = (e) => {
      if (e.buttons !== 1) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (!this.cube.hasPointerCapture(e.pointerId)) {
        if (Math.hypot(dx, dy) <= 4) return;
        this.cube.setPointerCapture(e.pointerId);
        this.leaveSideView();
      }
      last = { x: e.clientX, y: e.clientY };
      const target = this.controls.target;
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target).applyQuaternion(toCube));
      s.theta -= dx * dragSpeed;
      s.phi -= dy * dragSpeed;
      const offset = new THREE.Vector3().setFromSpherical(s.makeSafe()).applyQuaternion(toCube.clone().invert());
      this.camera.position.copy(target).add(offset);
      this.controls.update();
    };
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
    this.host.projection();
  }

  /** Turns the camera to look from `dir` (same target and distance); `side`: straight at a cube side, switching to orthographic for it. */
  private viewFrom(dir: THREE.Vector3, side = true, ms = 300) {
    if (!side) this.leaveSideView();
    else this.cubeWrap.classList.add('aligned');
    if (side && !this.isOrthographic) {
      this.setOrthographic(true);
      this.autoOrtho = true;
      this.host.projection();
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
