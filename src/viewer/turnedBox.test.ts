import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { getOC, makeBox, makeCylinder, setOC, type Shape3D } from 'replicad';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { meshBody } from '../kernel/build';
import { turnedBox } from './turnedBox';

beforeAll(async () => setOC(await init({ wasmBinary: readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm')) })), 60_000);

/** The kernel's tight box of the shape turned as `m` turns it. */
function kernelBox(shape: Shape3D, m: THREE.Matrix4) {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const axis = new THREE.Vector3(q.x, q.y, q.z).normalize();
  const turned = shape.clone().rotate((2 * Math.acos(q.w) * 180) / Math.PI, [0, 0, 0], axis.toArray());
  const oc = getOC();
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(turned.wrapped, box, false, false);
  const [lo, hi] = [box.CornerMin(), box.CornerMax()];
  const out = [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
  turned.delete();
  return out;
}

describe('the box of a turned body', () => {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.4, -0.7, 1.1));
  it('a cylinder, a half cylinder and a block with a round notch: the kernel box to 1e-6', () => {
    const half = makeCylinder(10, 30).cut(makeBox([-20, 0, -1], [20, 20, 40]));
    const notched = makeBox([0, 0, 0], [40, 20, 10]).cut(makeCylinder(6, 20, [20, 20, -5]));
    for (const shape of [makeCylinder(10, 30), half, notched] as Shape3D[]) {
      const exact = meshBody(shape).exact!;
      const box = turnedBox(exact, m)!;
      const [lo, hi] = kernelBox(shape, m);
      expect(box.min.toArray().map((x, k) => x - lo[k]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
      expect(box.max.toArray().map((x, k) => x - hi[k]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
      shape.delete();
    }
  });
});
