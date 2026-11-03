import * as THREE from 'three';
import { expect, it } from 'vitest';
import { fastRaycast } from './pick';

it('hits what three\'s own raycast hits, and leaves the index in order', () => {
  const geometry = new THREE.TorusKnotGeometry(10, 3, 120, 24);
  const index = [...geometry.index!.array];
  const plain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  plain.position.set(5, -3, 2);
  plain.rotation.set(0.4, 0.2, 1);
  plain.updateMatrixWorld();
  const fast = Object.assign(plain.clone(), { raycast: fastRaycast });
  fast.updateMatrixWorld();
  const key = (h: THREE.Intersection) => `${h.faceIndex} ${h.distance.toFixed(6)}`;
  let hit = 0;
  for (let i = 0; i < 300; i++) {
    const from = new THREE.Vector3(Math.sin(i) * 40, Math.cos(i * 1.7) * 40, Math.sin(i * 2.3) * 40);
    const ray = new THREE.Raycaster(from, new THREE.Vector3(5 + Math.sin(i) * 12, -3 + Math.cos(i) * 12, 2).sub(from).normalize());
    const [a, b] = [ray.intersectObject(plain), ray.intersectObject(fast)];
    expect(b.map(key).sort()).toEqual(a.map(key).sort());
    hit += a.length;
  }
  expect(hit).toBeGreaterThan(100);
  expect([...geometry.index!.array]).toEqual(index);
});

it('a ray that misses builds no tree', () => {
  const geometry = new THREE.SphereGeometry(1);
  const mesh = Object.assign(new THREE.Mesh(geometry), { raycast: fastRaycast });
  mesh.updateMatrixWorld();
  expect(new THREE.Raycaster(new THREE.Vector3(0, 50, 0), new THREE.Vector3(1, 0, 0)).intersectObject(mesh)).toEqual([]);
  expect(geometry.boundsTree).toBeUndefined();
});
