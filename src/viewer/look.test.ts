import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { boxUv } from './look';

describe('boxUv', () => {
  it('projects each triangle whole along its own main axis, corners doubled where those differ', () => {
    const g = new TeapotGeometry(50, 12);
    g.deleteAttribute('uv');
    const corners = g.attributes.position.count;
    boxUv(g);
    const [p, uv, index] = [g.attributes.position, g.attributes.uv as THREE.BufferAttribute, g.index!.array];
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let worst = 0;
    for (let t = 0; t < index.length; t += 3) {
      a.fromBufferAttribute(p, index[t]);
      b.fromBufferAttribute(p, index[t + 1]).sub(a);
      c.fromBufferAttribute(p, index[t + 2]).sub(a);
      const n = b.clone().cross(c);
      if (n.length() < 1e-6) continue;
      const [u0, u1, u2] = [0, 1, 2].map((k) => new THREE.Vector2().fromBufferAttribute(uv, index[t + k]));
      const flat = Math.abs(u1.sub(u0).cross(u2.sub(u0))); // in TILE² units
      const main = Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
      // a projection along the main axis shrinks the area by exactly that component
      worst = Math.max(worst, Math.abs(flat * 24 * 24 - main) / n.length());
    }
    expect(worst).toBeLessThan(1e-3);
    expect(g.attributes.position.count).toBeGreaterThan(corners);
    expect(g.userData.weld).toHaveLength(g.attributes.position.count);
  });
});
