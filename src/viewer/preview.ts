import * as THREE from 'three';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { sunDirection, type Look } from '../doc/materials';
import type { Light } from '../doc/types';
import { boxUv, renderMaterial } from './look';

type Tracer = import('three-gpu-pathtracer').WebGLPathTracer;

const BLANK: Look = { color: '#ffffff', roughness: 0.5, bump: 0, metalness: 0, translucency: 0, glow: '#000000', glowStrength: 0 };
const WIDTH = 320;
const HEIGHT = 240;

/**
 * A teapot wearing a material, on the floor in a light grey, slightly shiny corner, in given light. `show` draws at
 * once (three's own renderer) and, when nothing changes for `rest` ms, path traces on the same picture, on `canvas`;
 * `thumbnail` traces a small picture for the list, when nothing is being shown. One renderer and one tracer do all of it.
 */
export class MaterialPreview {
  readonly canvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
  private renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 1, 5000);
  private teapot: THREE.Mesh;
  private sun = new THREE.DirectionalLight();
  private sky: THREE.DataTexture | null = null;
  private lit: Light | null = null;
  private tracer: Tracer | null = null;
  private wanted: { look: Look; light: Light } | null = null;
  private tracing: { look: Look; light: Light; at: number } | null = null;
  private thumbnails: { look: Look; light: Light; done: (url: string) => void }[] = [];
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
    this.teapot.position.y = 50; // its bottom on the floor
    this.teapot.castShadow = true;
    const corner = new THREE.MeshStandardMaterial({ color: 0x9c9da0, roughness: 0.6 });
    const side = (x: number, y: number, z: number, rx: number, ry: number) => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), corner);
      wall.position.set(x, y, z);
      wall.rotation.set(rx, ry, 0);
      wall.receiveShadow = true;
      return wall;
    };
    this.scene.add(this.teapot, this.sun, side(0, 0, 0, -Math.PI / 2, 0), side(-170, 0, 0, 0, Math.PI / 2), side(0, 0, -130, 0, 0));
    // the tracer takes its textures from the scene once: these wear each of them, hidden under the floor
    for (const look of [{ raster: 'metric' }, { raster: 'imperial' }, { bump: 1 }] as Partial<Look>[]) {
      const carrier = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), renderMaterial({ ...BLANK, ...look }));
      carrier.position.y = -10;
      this.scene.add(carrier);
    }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(1024);
    Object.assign(this.sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, near: 1, far: 2000 });
    this.sun.shadow.bias = -0.002;
    this.camera.up.set(0, 1, 0); // this scene is y up, the app's default z
    this.camera.position.set(330, 200, 430);
    this.camera.lookAt(-10, 45, -10);
    this.camera.updateMatrixWorld();
  }

  /** Shows a look: at once, then traced. */
  show(look: Look, light: Light) {
    this.wanted = { look, light };
    void this.run();
  }

  /** A small picture of a look, as a data URL, when there is time. */
  thumbnail(look: Look, light: Light) {
    return new Promise<string>((done) => {
      this.thumbnails.push({ look, light, done });
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
    const [x, y, z] = sunDirection(light);
    this.sun.position.set(x, z, -y).multiplyScalar(800);
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

  private copy() {
    this.canvas.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
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
        const { look, light } = this.wanted;
        this.wanted = null;
        this.dress(look, light);
        this.renderer.render(this.scene, this.camera);
        this.copy();
        this.tracing = { look, light, at: performance.now() + this.rest };
      } else if (this.tracing) {
        if (performance.now() >= this.tracing.at) {
          const done = await this.trace(this.samples, 1, () => this.copy());
          if (done) this.tracing = null;
        }
      } else if (this.thumbnails.length) {
        const job = this.thumbnails[0];
        this.dress(job.look, job.light);
        if (await this.trace(this.thumbnailSamples, 0.4)) {
          this.thumbnails.shift();
          const small = Object.assign(document.createElement('canvas'), { width: 80, height: 60 });
          small.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, 80, 60);
          job.done(small.toDataURL('image/jpeg', 0.8));
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
