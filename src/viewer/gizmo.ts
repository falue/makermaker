import * as THREE from 'three';

/** Parameter along the line `o + t·d` (d unit) of the point closest to `ray`. */
export function along(ray: THREE.Ray, o: THREE.Vector3, d: THREE.Vector3) {
  const w = o.clone().sub(ray.origin);
  const b = d.dot(ray.direction);
  const denom = 1 - b * b;
  return denom < 1e-6 ? 0 : (b * w.dot(ray.direction) - w.dot(d)) / denom;
}

/**
 * Axis wheel for moving, 1 unit per spoke (the viewer scales it to a constant screen size): a slim double arrow per
 * axis fading like the origin's lines, a ball in the middle and a ring for the dead zone. Drawn over everything.
 */
export function axisWheel(
  // the origin's colours (AxesHelper): each axis fades from its first colour in the middle to the second at its tips
  colors: [number, number][] = [
    [0xff0000, 0xff9900],
    [0x00ff00, 0x99ff00],
    [0x0000ff, 0x0099ff],
  ],
  centre = 0x9e9e9e,
): THREE.Group {
  const wheel = new THREE.Group();
  const look = (color = 0xffffff, fade = false) => new THREE.MeshBasicMaterial({ color, vertexColors: fade, depthTest: false, depthWrite: false, transparent: true });
  colors.forEach(([inner, outer], k) => {
    const m = look(0xffffff, true);
    const parts = [
      new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8, 6),
      new THREE.ConeGeometry(0.05, 0.2, 16).translate(0, 0.85, 0),
      new THREE.ConeGeometry(0.05, 0.2, 16).rotateX(Math.PI).translate(0, -0.85, 0),
    ];
    const [a, b] = [new THREE.Color(inner), new THREE.Color(outer)];
    for (const g of parts) {
      const pos = g.attributes.position;
      const fade = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) a.clone().lerp(b, Math.min(1, Math.abs(pos.getY(i)) / 0.95)).toArray(fade, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(fade, 3));
    }
    const spoke = new THREE.Group().add(...parts.map((g) => new THREE.Mesh(g, m)));
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
