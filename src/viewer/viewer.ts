import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PartMesh } from '../kernel/build';

/** Z-up perspective viewport; renders only on change. */
export class Viewer {
  onPick: (id: string | null) => void = () => {};

  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  private controls: OrbitControls;
  private parts = new Map<string, THREE.Group>();
  private selected: string | null = null;
  private frame = 0;
  private grid = new THREE.Group();
  private dark = matchMedia('(prefers-color-scheme: dark)');

  private material = new THREE.MeshStandardMaterial({
    color: 0xd8c3a0,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private selectedMaterial = this.material.clone();
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2a2a2a });

  constructor(el: HTMLElement) {
    this.selectedMaterial.color.set(0x8fb4ff);
    this.renderer.setPixelRatio(devicePixelRatio);
    el.append(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888880, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, -2, 3);
    this.scene.add(sun);
    this.scene.add(this.grid, new THREE.AxesHelper(30));
    this.applyTheme();
    this.dark.addEventListener('change', this.applyTheme);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(120, -260, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(50, 0, 0);
    this.controls.addEventListener('change', this.render);
    this.controls.update();

    new ResizeObserver(() => {
      this.renderer.setSize(el.clientWidth, el.clientHeight);
      this.camera.aspect = el.clientWidth / el.clientHeight;
      this.camera.updateProjectionMatrix();
      this.render();
    }).observe(el);

    this.listenForPicks();
  }

  setPart(id: string, mesh: PartMesh) {
    const group = this.group(id);
    this.disposeChildren(group);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const solid = new THREE.Mesh(geometry, id === this.selected ? this.selectedMaterial : this.material);
    solid.userData.partId = id;
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.BufferAttribute(mesh.edges, 3));
    group.add(solid, new THREE.LineSegments(edges, this.edgeMaterial));
    this.render();
  }

  setPosition(id: string, [x, y, z]: number[]) {
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

  select(id: string | null) {
    this.selected = id;
    for (const [pid, group] of this.parts)
      group.children.forEach((c) => c instanceof THREE.Mesh && (c.material = pid === id ? this.selectedMaterial : this.material));
    this.render();
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

  private render = () => {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  };

  private disposeChildren(group: THREE.Group) {
    for (const c of group.children) (c as THREE.Mesh).geometry.dispose();
    group.clear();
  }

  /** A click without drag selects the part under the cursor. */
  private listenForPicks() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
        this.camera,
      );
      const meshes = [...this.parts.values()].flatMap((g) => g.children.filter((c) => c instanceof THREE.Mesh));
      this.onPick(raycaster.intersectObjects(meshes)[0]?.object.userData.partId ?? null);
    });
  }
}
