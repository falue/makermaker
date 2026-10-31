import * as THREE from 'three';
import type { Backdrop, CameraState } from '../doc/types';

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
 * A path traced picture of `meshes` (placed in the world) as `camera` sees it, `width` × `height` px: lit by a soft
 * sky, seen against the `background` sky (horizon level, halfway), over its floor if it has one (the colour at the
 * horizon, so mostly its shadows show), `samples` passes. The path tracer loads on first use.
 */
export async function pathTraced(meshes: THREE.Mesh[], camera: THREE.Camera, width: number, height: number, background: Backdrop, samples: number, watch: RenderWatch, slowMs = 120) {
  if (!meshes.length) throw new Error('Nothing to render: no body is shown');
  const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
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
  const horizon = new THREE.Color(background.bottom).lerp(new THREE.Color(background.top), 0.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: horizon, roughness: 0.9 }));
  floor.visible = background.floor;
  const reach = box.getSize(new THREE.Vector3()).length() * 20;
  floor.scale.set(reach, reach, 1);
  floor.position.set(box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).y, box.min.z - 0.01);
  model.add(floor);
  const sky = new GradientEquirectTexture();
  sky.topColor.set(0xffffff);
  sky.bottomColor.set(0x9aa0a8);
  sky.update();
  // the background sky: bottom straight down, top straight up, linear in height (the horizon halfway)
  const backdrop = new GradientEquirectTexture();
  backdrop.bottomColor.set(background.bottom);
  backdrop.topColor.set(background.top);
  backdrop.exponent = 1;
  backdrop.update();
  scene.background = backdrop;
  scene.environment = sky;
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
    return await new Promise<Blob>((done, fail) => renderer.domElement.toBlob((b) => (b ? done(b) : fail(new Error('the picture could not be made'))), 'image/png'));
  } finally {
    tracer.dispose();
    sky.dispose();
    backdrop.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    for (const m of meshes) (m.material as THREE.Material).dispose(); // their geometry belongs to the viewer
    renderer.dispose();
    renderer.forceContextLoss(); // browsers keep only a few contexts: the viewer's must not be the one dropped
  }
}
