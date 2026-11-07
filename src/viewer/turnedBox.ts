import * as THREE from 'three';
import type { Exact } from '../kernel/exact';

/**
 * A body's tight box in the world, placed by `m`, from its exact edges: their ends, and where a circle or arc reaches
 * farthest along each axis. Null where that is not all: a face other than a plane or cylinder (a sphere, a fillet's
 * torus, free-form), or an edge other than a line or circle.
 */
export function turnedBox(exact: Exact, m: THREE.Matrix4): THREE.Box3 | null {
  if (exact.faces.some((f) => f.kind !== 'plane' && f.kind !== 'cylinder') || exact.edges.some((e) => e.kind !== 'line' && e.kind !== 'circle')) return null;
  const inv = m.clone().invert();
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((w) => w.transformDirection(inv));
  const box = new THREE.Box3();
  const v = (p: [number, number, number]) => new THREE.Vector3(...p);
  for (const e of exact.edges) {
    box.expandByPoint(v(e.a).applyMatrix4(m)).expandByPoint(v(e.b).applyMatrix4(m));
    if (e.kind !== 'circle') continue;
    const [c, n] = [v(e.c), v(e.n)];
    // angles round n from its start: the arc runs from 0 through its middle to its end
    const x = v(e.a).sub(c).normalize();
    const y = n.clone().cross(x);
    const angle = (p: THREE.Vector3) => Math.atan2(p.clone().sub(c).dot(y), p.clone().sub(c).dot(x));
    const turn = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const [mid, end] = [turn(angle(v(e.mid))), v(e.a).distanceTo(v(e.b)) < 1e-9 ? 2 * Math.PI : turn(angle(v(e.b)))];
    const ccw = mid < end; // else it runs the other way round
    for (const w of axes)
      for (const k of [1, -1]) {
        const out = w.clone().projectOnPlane(n);
        if (out.lengthSq() < 1e-18) continue;
        const p = c.clone().addScaledVector(out.normalize(), k * e.r);
        const t = turn(angle(p));
        if (ccw ? t <= end + 1e-12 : t === 0 || t >= end - 1e-12) box.expandByPoint(p.applyMatrix4(m));
      }
  }
  return box;
}
