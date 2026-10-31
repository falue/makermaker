import * as THREE from 'three';

/** Parameter along the line `o + t·d` (d unit) of the point closest to `ray`. */
export function along(ray: THREE.Ray, o: THREE.Vector3, d: THREE.Vector3) {
  const w = o.clone().sub(ray.origin);
  const b = d.dot(ray.direction);
  const denom = 1 - b * b;
  return denom < 1e-6 ? 0 : (b * w.dot(ray.direction) - w.dot(d)) / denom;
}

/**
 * Axis wheel for moving, 1 unit per spoke (the viewer scales it to a constant screen size): a double arrow per axis,
 * a ball in the middle and a ring for the dead zone. Drawn over everything.
 */
export function axisWheel(colors = [0xe0503c, 0x4caf50, 0x3b7be0], centre = 0x9e9e9e): THREE.Group {
  const wheel = new THREE.Group();
  const look = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  colors.forEach((color, k) => {
    const m = look(color);
    const spoke = new THREE.Group().add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 8), m),
      new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 16).translate(0, 0.875, 0), m),
      new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 16).rotateX(Math.PI).translate(0, -0.875, 0), m),
    );
    if (k === 0) spoke.rotation.z = -Math.PI / 2;
    if (k === 2) spoke.rotation.x = Math.PI / 2;
    spoke.userData.axis = k;
    wheel.add(spoke);
  });
  const dead = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), look(centre));
  dead.name = 'dead'; // the dead zone, radius 1 (the viewer scales it and turns it to the camera)
  wheel.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8), look(centre)), dead);
  wheel.traverse((o) => (o.renderOrder = 1e7));
  wheel.visible = false;
  return wheel;
}

/** Shows the chosen axis strong and the others faint (null: all faint). */
export function choose(wheel: THREE.Group, axis: number | null, faint = 0.3) {
  for (const spoke of wheel.children)
    if (spoke.userData.axis !== undefined)
      spoke.traverse((o) => o instanceof THREE.Mesh && (o.material.opacity = spoke.userData.axis === axis ? 1 : faint));
}
