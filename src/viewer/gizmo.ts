import * as THREE from 'three';

/** An axis (0 x, 1 y, 2 z) or the base plane facing the camera. */
export type Handle = 0 | 1 | 2 | 'plane';

/** Parameter along the line `o + t·d` (d unit) of the point closest to `ray`. */
export function along(ray: THREE.Ray, o: THREE.Vector3, d: THREE.Vector3) {
  const w = o.clone().sub(ray.origin);
  const b = d.dot(ray.direction);
  const denom = 1 - b * b;
  return denom < 1e-6 ? 0 : (b * w.dot(ray.direction) - w.dot(d)) / denom;
}

/**
 * Move gizmo, 1 unit long (the viewer scales it to a constant screen size): an arrow per axis and a ball in the
 * middle for the plane facing the camera. Drawn over everything; wider invisible meshes make the handles easy to grab.
 */
export function moveGizmo(colors = [0xe0503c, 0x4caf50, 0x3b7be0], centre = 0x9e9e9e): THREE.Group {
  const gizmo = new THREE.Group();
  const look = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  const grab = new THREE.MeshBasicMaterial({ visible: false });
  colors.forEach((color, k) => {
    const m = look(color);
    const arrow = new THREE.Group().add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8).translate(0, 0.5, 0), m),
      new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 16).translate(0, 0.975, 0), m),
      new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.95, 8).translate(0, 0.625, 0), grab),
    );
    if (k === 0) arrow.rotation.z = -Math.PI / 2;
    if (k === 2) arrow.rotation.x = Math.PI / 2;
    arrow.traverse((o) => Object.assign(o.userData, { handle: k, color }));
    gizmo.add(arrow);
  });
  const ball = new THREE.Group().add(
    new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8), look(centre)),
    new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), grab),
  );
  ball.traverse((o) => Object.assign(o.userData, { handle: 'plane', color: centre }));
  gizmo.add(ball);
  gizmo.traverse((o) => (o.renderOrder = 1e7));
  gizmo.visible = false;
  return gizmo;
}

/** Lights the hovered handle. */
export function highlight(gizmo: THREE.Group, handle: Handle | null, color = 0xffc400) {
  gizmo.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material.visible) (o.material as THREE.MeshBasicMaterial).color.set(o.userData.handle === handle ? color : o.userData.color);
  });
}
