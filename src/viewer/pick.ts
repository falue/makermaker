import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

const reach = new THREE.Sphere();

/**
 * A mesh's `raycast`: through a search tree, built when a ray first comes near it. Indirect, so the index stays in order:
 * B-rep faces are ranges of it. Hits are those of three's own raycast.
 */
export function fastRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  const g = this.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!raycaster.ray.intersectsSphere(reach.copy(g.boundingSphere!).applyMatrix4(this.matrixWorld))) return;
  g.boundsTree ??= new MeshBVH(g, { indirect: true });
  acceleratedRaycast.call(this, raycaster, hits);
}
