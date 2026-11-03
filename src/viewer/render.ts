import * as THREE from 'three';
import { lightDirections } from '../doc/materials';
import type { Backdrop, CameraState, Light } from '../doc/types';
import { photoEnvironment, photoPass, photoTexture } from './photo';
import { drawSky } from './sky';

/** A camera as `state` describes it (z up, like the viewer's). */
export function cameraFrom(state: CameraState): THREE.Camera {
  const [w, h] = state.size;
  const cam = state.ortho
    ? new THREE.OrthographicCamera((-state.height * w) / h / 2, (state.height * w) / h / 2, state.height / 2, -state.height / 2, -50000, 50000)
    : new THREE.PerspectiveCamera(state.fov, w / h, 1, 50000);
  cam.up.set(...state.up);
  cam.position.set(...state.position);
  cam.lookAt(...state.target);
  cam.updateMatrixWorld();
  return cam;
}

/** What a render reports to and asks of whoever watches it. */
export interface RenderWatch {
  /** The canvas the picture grows on, to preview. */
  show(canvas: HTMLCanvasElement): void;
  progress(done: number): void;
  cancelled(): boolean;
  /** Render slower, leaving the app usable. */
  slow(): boolean;
}

/**
 * A path traced picture of `meshes` (placed in the world) as `camera` sees it, `width` × `height` px, lit by `light`
 * (a photo sphere replaces its ambient colours), `samples` passes: traced on a transparent background, then laid over
 * `background` (the gradient around the horizon, `tanHalf`: tangent of half the view angle it assumes, or the photo as
 * `photoPass` shows it); a solid background gets a floor of its colour that catches the shadows. The path tracer
 * loads on first use.
 */
export async function pathTraced(meshes: THREE.Mesh[], camera: THREE.Camera, width: number, height: number, background: Backdrop, light: Light, { haze = 0, fog = 0 }: { haze?: number; fog?: number }, photo: { image: HTMLImageElement; turn: number } | null, tanHalf: number, samples: number, watch: RenderWatch, slowMs = 120) {
  if (!meshes.length) throw new Error('Nothing to render: no body is shown');
  const { WebGLPathTracer, GradientEquirectTexture, FogVolumeMaterial } = await import('three-gpu-pathtracer');
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, alpha: true });
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps the background colour close to what was picked
  const scene = new THREE.Scene();
  // the sky is y-up, the model z-up: everything turns a quarter around x
  const turn = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const model = new THREE.Group();
  model.applyMatrix4(turn);
  scene.add(model);
  const box = new THREE.Box3();
  for (const m of meshes) model.add(m), box.expandByObject(m);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: background.stops[0].color, roughness: 0.9 }));
  floor.visible = !photo && background.stops.every((s) => s.color === background.stops[0].color);
  const reach = box.getSize(new THREE.Vector3()).length() * 20;
  floor.scale.set(reach, reach, 1);
  floor.position.set(box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).y, box.min.z - 0.01);
  model.add(floor);
  const sky = photo ? photoEnvironment(photo.image, photo.turn) : new GradientEquirectTexture();
  if (sky instanceof GradientEquirectTexture) {
    sky.topColor.set(light.ambientColor);
    sky.bottomColor.set(light.ambientColor).multiplyScalar(0.6);
    sky.update();
  }
  scene.background = null; // transparent: the background is laid under it at the end
  scene.environment = sky;
  scene.environmentIntensity = light.ambient / Math.PI; // three's ambient light of that strength
  const toCamera = camera.getWorldDirection(new THREE.Vector3()).negate().toArray();
  const aim = lightDirections(light, toCamera);
  const sun = new THREE.DirectionalLight(light.sunColor, light.sun);
  sun.position.set(...aim.sun);
  model.add(sun);
  if (light.cameraOn) {
    const lamp = new THREE.DirectionalLight(0xffffff, light.cameraLight);
    lamp.position.set(...aim.camera);
    model.add(lamp);
  }
  const hazeColour = hazeColourOf(light.ambientColor);
  // the real fog: a box of it around everything, at full about 2/3 of the light gone across the model's size
  const size = box.getSize(new THREE.Vector3()).length();
  const fogMaterial = fog > 0 ? new FogVolumeMaterial({ color: hazeColour, density: fog / size }) : null;
  const fogBox = fogMaterial && new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fogMaterial);
  if (fogBox) {
    fogBox.scale.setScalar(size * 2);
    fogBox.position.copy(box.getCenter(new THREE.Vector3()));
    model.add(fogBox);
  }
  const view = camera.clone();
  if (view instanceof THREE.OrthographicCamera) {
    // the viewer's ortho camera sees behind itself (negative near); the tracer starts rays at the camera: step back
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    const back = view.position.distanceTo(box.getCenter(new THREE.Vector3())) + radius * 2;
    view.position.add(view.getWorldDirection(new THREE.Vector3()).multiplyScalar(-back));
    Object.assign(view, { near: 0.1, far: back + radius * 4 });
    view.updateProjectionMatrix();
  }
  view.applyMatrix4(turn);
  view.updateMatrixWorld();
  const tracer = new WebGLPathTracer(renderer);
  Object.assign(tracer, { renderDelay: 0, fadeDuration: 0, minSamples: 0 });
  tracer.setScene(scene, view);
  watch.show(renderer.domElement);
  try {
    while (tracer.samples < samples) {
      tracer.renderSample();
      watch.progress(Math.min(1, tracer.samples / samples));
      if (watch.cancelled()) throw new Error('Rendering cancelled');
      await new Promise((next) => (watch.slow() ? setTimeout(next, slowMs) : requestAnimationFrame(next)));
    }
    const out = Object.assign(document.createElement('canvas'), { width, height });
    const g = out.getContext('2d')!;
    const look = camera.getWorldDirection(new THREE.Vector3());
    if (photo) g.drawImage(photoPicture(photo, camera, width, height), 0, 0);
    else drawSky(g, width, height, Math.asin(THREE.MathUtils.clamp(look.z, -1, 1)), tanHalf, background);
    g.drawImage(renderer.domElement, 0, 0);
    if (fogBox) fogBox.visible = false;
    if (haze > 0) {
      // the model in the first third of what is hazed
      const eye = new THREE.Vector3().setFromMatrixPosition(view.matrixWorld);
      const middle = box.getCenter(new THREE.Vector3()).applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
      const distance = eye.distanceTo(middle);
      addHaze(g, depthPicture(renderer, scene, view as THREE.PerspectiveCamera | THREE.OrthographicCamera, Math.max(0, distance - radius), distance + radius * 3, width, height), hazeColour, haze);
    }
    return await new Promise<Blob>((done, fail) => out.toBlob((b) => (b ? done(b) : fail(new Error('the picture could not be made'))), 'image/png'));
  } finally {
    tracer.dispose();
    sky.dispose();
    floor.geometry.dispose();
    fogBox?.geometry.dispose();
    fogMaterial?.dispose();
    (floor.material as THREE.Material).dispose();
    for (const m of meshes) (m.material as THREE.Material).dispose(); // their geometry belongs to the viewer
    renderer.dispose();
    renderer.forceContextLoss(); // browsers keep only a few contexts: the viewer's must not be the one dropped
  }
}

/** The photo sphere as `camera` sees it, on a renderer of its own (the tracer's canvas holds the picture). */
function photoPicture(photo: { image: HTMLImageElement; turn: number }, camera: THREE.Camera, width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const texture = photoTexture(photo.image);
  const pass = photoPass();
  pass.draw(renderer, texture, camera, width / height, photo.turn);
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  copy.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  pass.dispose();
  texture.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return copy;
}

/** A picture of how far each pixel is, drawn with `camera` on the renderer (0 near .. 1 far; nothing there: 1). */
export function depthPicture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, near: number, far: number, width: number, height: number) {
  const reach = camera.far;
  camera.far = reach * 1000; // the floor reaches far: not cut off, that would show as a band
  camera.updateProjectionMatrix();
  scene.overrideMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying float d; void main() { vec4 v = modelViewMatrix * vec4(position, 1.0); d = -v.z; gl_Position = projectionMatrix * v; }',
    fragmentShader: `varying float d; void main() { gl_FragColor = vec4(vec3(clamp((d - ${near.toFixed(3)}) / ${(far - near).toFixed(3)}, 0.0, 1.0)), 1.0); }`,
  });
  const [mapping, background, environment] = [renderer.toneMapping, scene.background, scene.environment];
  renderer.toneMapping = THREE.NoToneMapping;
  scene.background = new THREE.Color(1, 1, 1);
  scene.environment = null;
  renderer.render(scene, camera);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(renderer.domElement, 0, 0, width, height);
  (scene.overrideMaterial as THREE.Material).dispose();
  scene.overrideMaterial = null;
  [renderer.toneMapping, scene.background, scene.environment] = [mapping, background, environment];
  camera.far = reach;
  camera.updateProjectionMatrix();
  return g.getImageData(0, 0, width, height).data;
}

/** Fades what is far (`depth`, see `depthPicture`) into `colour` on the picture of `g`. `amount`: 0 to 1. */
export function addHaze(g: CanvasRenderingContext2D, depth: Uint8ClampedArray, colour: THREE.Color, amount: number) {
  const picture = g.getImageData(0, 0, g.canvas.width, g.canvas.height);
  const { r, g: gr, b } = colour.clone().convertLinearToSRGB().multiplyScalar(255);
  // nothing at the nearest; at the farthest `amount`, twice over: far things and the sky are all haze at half way
  const [thick, top] = [amount * 3, Math.min(1, amount * 2) / (1 - Math.exp(-amount * 3))];
  for (let i = 0; i < picture.data.length; i += 4) {
    const k = top * (1 - Math.exp((-thick * depth[i]) / 255));
    picture.data[i] += (r - picture.data[i]) * k;
    picture.data[i + 1] += (gr - picture.data[i + 1]) * k;
    picture.data[i + 2] += (b - picture.data[i + 2]) * k;
  }
  g.putImageData(picture, 0, 0);
}

/** The haze colour of a light. */
export const hazeColourOf = (ambient: string) => new THREE.Color(ambient).lerp(new THREE.Color(0xc9ced6), 0.5);
