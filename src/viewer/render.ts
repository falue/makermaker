import * as THREE from 'three';
import { sunDirection } from '../doc/materials';
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
 * `background` (the gradient around the horizon or the photo as the camera sees it, `tanHalf`: tangent of half the
 * view angle it assumes); a solid background gets a floor of its colour that catches the shadows. The path tracer
 * loads on first use.
 */
export async function pathTraced(meshes: THREE.Mesh[], camera: THREE.Camera, width: number, height: number, background: Backdrop, light: Light, photo: { image: HTMLImageElement; turn: number } | null, tanHalf: number, samples: number, watch: RenderWatch, slowMs = 120) {
  if (!meshes.length) throw new Error('Nothing to render: no body is shown');
  const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
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
  const sun = new THREE.DirectionalLight(light.sunColor, light.sun);
  sun.position.set(...sunDirection(light));
  model.add(sun);
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
    if (photo) g.drawImage(photoPicture(photo, camera, tanHalf, width, height), 0, 0);
    else drawSky(g, width, height, Math.asin(THREE.MathUtils.clamp(look.z, -1, 1)), tanHalf, background);
    g.drawImage(renderer.domElement, 0, 0);
    return await new Promise<Blob>((done, fail) => out.toBlob((b) => (b ? done(b) : fail(new Error('the picture could not be made'))), 'image/png'));
  } finally {
    tracer.dispose();
    sky.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    for (const m of meshes) (m.material as THREE.Material).dispose(); // their geometry belongs to the viewer
    renderer.dispose();
    renderer.forceContextLoss(); // browsers keep only a few contexts: the viewer's must not be the one dropped
  }
}

/** The photo sphere as `camera` sees it, on a renderer of its own (the tracer's canvas holds the picture). */
function photoPicture(photo: { image: HTMLImageElement; turn: number }, camera: THREE.Camera, tanHalf: number, width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const texture = photoTexture(photo.image);
  const pass = photoPass();
  pass.draw(renderer, texture, camera, tanHalf, width / height, photo.turn);
  const copy = Object.assign(document.createElement('canvas'), { width, height });
  copy.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  pass.dispose();
  texture.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return copy;
}
