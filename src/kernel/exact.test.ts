import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { makeBox, makeCylinder, makeSphere, setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { meshBody } from './build';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));
beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

describe('exact data with the mesh', () => {
  it("a box with a hole: its faces' planes and the hole's cylinder, its circles, volume and tight box, by mesh group", () => {
    const shape = makeBox([0, 0, 0], [20, 10, 5]).cut(makeCylinder(2, 10, [10, 5, -1]));
    const m = meshBody(shape);
    const x = m.exact!;
    expect(x.faces).toHaveLength(m.faces.length / 2);
    expect(x.edges).toHaveLength(m.edgeGroups.length / 2);
    expect(x.faces.filter((f) => f.kind === 'plane')).toHaveLength(6);
    const hole = x.faces.find((f) => f.kind === 'cylinder');
    expect(hole).toMatchObject({ kind: 'cylinder', r: 2, shaft: false });
    if (hole?.kind === 'cylinder') expect(Math.abs(hole.dir[2])).toBeCloseTo(1, 9);
    const top = x.faces.find((f) => f.kind === 'plane' && f.n[2] > 0.99);
    if (top?.kind === 'plane') expect(top.at[2]).toBeCloseTo(5, 9);
    const rims = x.edges.filter((e) => e.kind === 'circle');
    expect(rims.length).toBeGreaterThanOrEqual(2);
    for (const e of rims) if (e.kind === 'circle') expect([e.r, e.c[0], e.c[1]]).toEqual([2, 10, 5].map((v) => expect.closeTo(v, 9)));
    expect(x.volume).toBeCloseTo(20 * 10 * 5 - Math.PI * 4 * 5, 6);
    expect(x.box[0].map((v) => +v.toFixed(6))).toEqual([0, 0, 0]);
    expect(x.box[1].map((v) => +v.toFixed(6))).toEqual([20, 10, 5]);
    shape.delete();
  });

  it('a ball: a sphere face, its box tight (not loosened by its control points)', () => {
    const shape = makeSphere(7);
    const x = meshBody(shape).exact!;
    expect(x.faces[0]).toMatchObject({ kind: 'sphere', r: 7 });
    expect(x.box[1][0]).toBeCloseTo(7, 6);
    shape.delete();
  });
});
