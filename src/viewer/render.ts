import * as THREE from 'three';

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
 * A path traced picture of `meshes` (placed in the world) as `camera` sees it, `width` × `height` px: a soft sky and a
 * pale floor under the meshes, `samples` passes. The path tracer loads on first use.
 */
export async function pathTraced(meshes: THREE.Mesh[], camera: THREE.Camera, width: number, height: number, samples: number, watch: RenderWatch, slowMs = 120) {
  if (!meshes.length) throw new Error('Nothing to render: no body is shown');
  const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  // the sky is y-up, the model z-up: everything turns a quarter around x
  const turn = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const model = new THREE.Group();
  model.applyMatrix4(turn);
  scene.add(model);
  const box = new THREE.Box3();
  for (const m of meshes) model.add(m), box.expandByObject(m);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.9 }));
  const reach = box.getSize(new THREE.Vector3()).length() * 20;
  floor.scale.set(reach, reach, 1);
  floor.position.set(box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).y, box.min.z - 0.01);
  model.add(floor);
  const sky = new GradientEquirectTexture();
  sky.topColor.set(0xffffff);
  sky.bottomColor.set(0x9aa0a8);
  sky.update();
  scene.background = sky;
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
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    for (const m of meshes) (m.material as THREE.Material).dispose(); // their geometry belongs to the viewer
    renderer.dispose();
    renderer.forceContextLoss(); // browsers keep only a few contexts: the viewer's must not be the one dropped
  }
}
