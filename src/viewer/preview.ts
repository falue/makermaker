import * as THREE from 'three';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { findMaterial, lightDirections, toLook, type Look } from '../doc/materials';
import type { Doc } from '../doc/types';
import type { Light } from '../doc/types';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyLook, boxUv, renderMaterial } from './look';
import { addHaze, depthPicture, hazeColourOf } from './render';

type Tracer = import('three-gpu-pathtracer').WebGLPathTracer;

const BLANK: Look = { color: '#ffffff', roughness: 0.5, bump: 0, metalness: 0, translucency: 0, glow: '#000000', glowStrength: 0 };
const WIDTH = 640;
const HEIGHT = 480;
/** Goes up when the scene changes: pictures kept in browsers then are of something else. */
export const PREVIEW_SCENE = 6;

/**
 * A teapot wearing a material, on a POM-C floor in a corner of measuring grid walls, in given light. `show` draws at
 * once (three's own renderer) and, when nothing changes for `rest` ms, path traces on the same picture, on `canvas`;
 * `viewCanvas` always has it as the 3D view draws it. `thumbnail` traces a small picture for the list, when nothing is being shown. One renderer and one tracer do all of it.
 */
export class MaterialPreview {
  /** The picture as rendered, and as the 3D view draws it. */
  readonly canvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
  readonly viewCanvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
  /** What the 3D view has, in place of the renderer's looks: its materials, its light from all around, what metal mirrors. */
  private inView = { teapot: new THREE.MeshStandardMaterial(), floor: new THREE.MeshStandardMaterial(), grid: new THREE.MeshStandardMaterial(), ambient: new THREE.HemisphereLight(), around: null as THREE.Texture | null };
  private walls: THREE.Mesh[] = [];
  private renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 1, 5000);
  private teapot: THREE.Mesh;
  private sun = new THREE.DirectionalLight();
  private lamp = new THREE.DirectionalLight();
  private sky: THREE.DataTexture | null = null;
  private lit: Light | null = null;
  private tracer: Tracer | null = null;
  private wanted: { look: Look; light: Light; finished?: string; air: { haze: number; fog: number } } | null = null;
  private air = { haze: 0, fog: 0 };
  private fog: THREE.Mesh | null = null;
  private depth: Uint8ClampedArray | null = null;
  private tracing: { look: Look; light: Light; at: number } | null = null;
  private thumbnails: { look: Look; light: Light; done: (url: string) => void; width: number; samples: number; scale: number; quality: number }[] = [];
  private running = false;
  private closed = false;

  constructor(private rest = 300, private samples = 200, private thumbnailSamples = 32) {
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    const geometry = new TeapotGeometry(50, 12);
    geometry.deleteAttribute('uv');
    boxUv(geometry); // bumps and grids in mm, as on a body
    this.teapot = new THREE.Mesh(geometry, renderMaterial(BLANK));
    this.teapot.position.set(-12, 50, 9); // its bottom on the floor, its spout inside the picture
    this.teapot.castShadow = true;
    const standard = (id: string) => toLook(findMaterial({ materials: [] } as unknown as Doc, id)!);
    const [floorLook, gridLook] = [standard('std-pom-black'), standard('std-grid-metric')];
    const [floor, grid] = [renderMaterial(floorLook), renderMaterial(gridLook)];
    applyLook(this.inView.floor, floorLook);
    applyLook(this.inView.grid, gridLook);
    const side = (x: number, y: number, z: number, rx: number, ry: number) => {
      const geometry = new THREE.PlaneGeometry(1600, 1600);
      geometry.deleteAttribute('uv');
      boxUv(geometry);
      const wall = new THREE.Mesh(geometry, rx ? floor : grid);
      wall.position.set(x, y, z);
      wall.rotation.set(rx, ry, 0);
      wall.receiveShadow = true;
      this.walls.push(wall);
      return wall;
    };
    this.inView.ambient.visible = false;
    this.scene.add(this.inView.ambient, this.lamp, this.teapot, this.sun, side(0, 0, 0, -Math.PI / 2, 0), side(-170, 0, 0, 0, Math.PI / 2), side(0, 0, -130, 0, 0));
    // the tracer takes its textures from the scene once: these wear each of them, hidden under the floor
    for (const look of [{ overlay: 'metric' }, { overlay: 'imperial' }, { bump: 1 }] as Partial<Look>[]) {
      const carrier = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), renderMaterial({ ...BLANK, ...look }));
      carrier.position.y = -10;
      this.scene.add(carrier);
    }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(1024);
    Object.assign(this.sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, near: 1, far: 2000 });
    this.sun.shadow.bias = -0.002;
    this.camera.up.set(0, 1, 0); // this scene is y up, the app's default z
    this.camera.position.set(165, 115, 215);
    this.camera.lookAt(0, 42, 0);
    this.camera.updateMatrixWorld();
  }

  /** Shows a look: at once as the 3D view draws it; rendered: `finished` if there is such a picture, else traced, in `air` if given. */
  show(look: Look, light: Light, finished?: string, air: { haze: number; fog: number } = { haze: 0, fog: 0 }) {
    this.wanted = { look, light, finished, air };
    void this.run();
  }

  /** A picture of a look, as a data URL, when there is time: small by default, for the list. */
  thumbnail(look: Look, light: Light, { width = 80, samples = this.thumbnailSamples, scale = 0.25, quality = 0.8 } = {}) {
    return new Promise<string>((done) => {
      this.thumbnails.push({ look, light, done, width, samples, scale, quality });
      void this.run();
    });
  }

  dispose() {
    this.closed = true;
    this.tracer?.dispose();
    this.sky?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // browsers keep only a few contexts: the viewer's must not be the one dropped
  }

  /** The teapot and the light as asked, in the tracer too if it runs. */
  private dress(look: Look, light: Light) {
    const wears = this.teapot.material as THREE.MeshPhysicalMaterial;
    const next = renderMaterial(look);
    if (wears.map !== next.map || wears.normalMap !== next.normalMap || wears.transmission > 0 !== next.transmission > 0) wears.needsUpdate = true;
    wears.copy(next);
    next.dispose();
    this.tracer?.updateMaterials();
    if (light === this.lit) return;
    this.lit = light;
    // the scene is y up, the light's angles z up
    // where the camera is, as z up for the light's angles (this scene is y up)
    const eye = this.camera.position.clone().normalize();
    const { sun, camera } = lightDirections(light, [eye.x, -eye.z, eye.y]);
    const [x, y, z] = sun;
    this.sun.position.set(x, z, -y).multiplyScalar(800);
    this.lamp.position.set(camera[0], camera[2], -camera[1]);
    this.lamp.color.set(0xffffff);
    this.lamp.intensity = light.cameraOn ? light.cameraLight : 0;
    this.sun.color.set(light.sunColor);
    this.sun.intensity = light.sun;
    const [top, bottom] = [new THREE.Color(light.ambientColor), new THREE.Color(light.ambientColor).multiplyScalar(0.6)];
    this.sky?.dispose();
    this.sky = gradient(top, bottom);
    this.scene.environment = this.sky;
    this.scene.environmentIntensity = light.ambient / Math.PI; // three's ambient light of that strength
    this.tracer?.updateLights();
    this.tracer?.updateEnvironment();
  }

  /** Draws what is dressed as the 3D view does: on its materials and its light, without shadows, onto `viewCanvas`. */
  private drawAsView(look: Look, light: Light) {
    const { inView } = this;
    if (look.metalness > 0 && !inView.around) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      inView.around = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    applyLook(inView.teapot, look, look.metalness > 0 ? inView.around : null);
    inView.ambient.color.set(light.ambientColor);
    inView.ambient.groundColor.set(light.ambientColor).multiplyScalar(0.53);
    inView.ambient.intensity = light.ambient;
    const rendered = [this.teapot.material, ...this.walls.map((w) => w.material)];
    const { environment } = this.scene;
    this.teapot.material = inView.teapot;
    this.walls.forEach((w) => (w.material = w.rotation.x ? inView.floor : inView.grid));
    this.scene.environment = null;
    inView.ambient.visible = true;
    this.sun.castShadow = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.render(this.scene, this.camera);
    this.viewCanvas.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.sun.castShadow = true;
    inView.ambient.visible = false;
    this.scene.environment = environment;
    this.teapot.material = rendered[0] as THREE.Material;
    this.walls.forEach((w, i) => (w.material = rendered[i + 1] as THREE.Material));
  }

  private copy() {
    const g = this.canvas.getContext('2d')!;
    g.drawImage(this.renderer.domElement, 0, 0, WIDTH, HEIGHT);
    if (this.air.haze > 0 && this.depth) addHaze(g, this.depth, hazeColourOf(this.haze), this.air.haze);
  }
  private haze = '#ffffff';

  /** Fog and haze as asked: a box of real fog (a new scene for the tracer when it comes or goes), the depth for the haze. */
  private async setAir(air: { haze: number; fog: number }, light: Light) {
    this.air = air;
    this.haze = light.ambientColor;
    const { FogVolumeMaterial } = air.fog > 0 && !this.fog ? await import('three-gpu-pathtracer') : { FogVolumeMaterial: null };
    if (FogVolumeMaterial) {
      this.fog = new THREE.Mesh(new THREE.BoxGeometry(1600, 800, 1600), new FogVolumeMaterial({ color: 0xc9ced6, density: 0 }));
      this.fog.position.y = 400;
      this.scene.add(this.fog);
      this.tracer?.setScene(this.scene, this.camera);
    }
    if (this.fog) {
      const m = this.fog.material as THREE.MeshStandardMaterial & { density: number };
      m.density = air.fog / 1500;
      m.color.copy(hazeColourOf(light.ambientColor));
      this.fog.visible = air.fog > 0;
      this.tracer?.updateMaterials();
    }
    if (air.haze <= 0) return;
    const fogged = this.fog?.visible;
    if (this.fog) this.fog.visible = false;
    this.depth ??= depthPicture(this.renderer, this.scene, this.camera, 150, 900, WIDTH, HEIGHT);
    if (this.fog) this.fog.visible = !!fogged;
  }

  /** Traces what is dressed, up to `samples`; false: something newer came in between. */
  private async trace(samples: number, scale: number, each?: () => void) {
    if (!this.tracer) {
      const { WebGLPathTracer } = await import('three-gpu-pathtracer');
      this.tracer = Object.assign(new WebGLPathTracer(this.renderer), { renderDelay: 0, fadeDuration: 0, minSamples: 0, bounces: 5 });
      if (this.closed) return false;
      this.tracer.tiles.set(1, 1); // a whole picture per frame
      this.tracer.setScene(this.scene, this.camera);
    }
    this.tracer.renderScale = scale;
    this.tracer.reset();
    while (this.tracer.samples < samples) {
      this.tracer.renderSample();
      each?.();
      await new Promise(requestAnimationFrame);
      if (this.closed || this.wanted) return false;
    }
    return true;
  }

  /** Does one thing at a time: what is shown first, then its tracing once it rests, then the thumbnails. */
  private async run() {
    if (this.running) return;
    this.running = true;
    while (!this.closed) {
      if (this.wanted) {
        const { look, light, finished, air } = this.wanted;
        this.wanted = null;
        this.dress(look, light);
        await this.setAir(air, light);
        this.drawAsView(look, light);
        this.tracing = null;
        if (finished) {
          const image = new Image();
          image.src = finished;
          await image.decode();
          this.canvas.getContext('2d')!.drawImage(image, 0, 0, WIDTH, HEIGHT);
        } else {
          this.renderer.render(this.scene, this.camera);
          this.copy();
          this.tracing = { look, light, at: performance.now() + this.rest };
        }
      } else if (this.tracing) {
        if (performance.now() >= this.tracing.at) {
          const done = await this.trace(this.samples, 0.5, () => this.copy());
          if (done) this.tracing = null;
        }
      } else if (this.thumbnails.length) {
        const job = this.thumbnails[0];
        this.dress(job.look, job.light);
        if (await this.trace(job.samples, job.scale)) {
          this.thumbnails.shift();
          const small = Object.assign(document.createElement('canvas'), { width: job.width, height: (job.width * HEIGHT) / WIDTH });
          small.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, small.width, small.height);
          job.done(small.toDataURL('image/jpeg', job.quality));
        }
      } else break;
      await new Promise(requestAnimationFrame);
    }
    this.running = false;
  }
}

/** A sky from `top` to `bottom`, as the tracer and three's renderer both take it (y up). */
function gradient(top: THREE.Color, bottom: THREE.Color) {
  const [w, h] = [4, 32];
  const data = new Float32Array(w * h * 4);
  const c = new THREE.Color();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      c.copy(bottom).lerp(top, y / (h - 1));
      data.set([c.r, c.g, c.b, 1], (x + y * w) * 4);
    }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  Object.assign(t, { mapping: THREE.EquirectangularReflectionMapping, wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, needsUpdate: true });
  return t;
}
