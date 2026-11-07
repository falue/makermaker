import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { makeBox, makeCylinder, makeSphere, setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { meshBody } from './build';
import { solidChecks } from './exact';

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
    expect(x.box![0].map((v) => +v.toFixed(6))).toEqual([0, 0, 0]);
    expect(x.box![1].map((v) => +v.toFixed(6))).toEqual([20, 10, 5]);
    shape.delete();
  });

  it('a ball: a sphere face, its box tight (not loosened by its control points)', () => {
    const shape = makeSphere(7);
    const x = meshBody(shape).exact!;
    expect(x.faces[0]).toMatchObject({ kind: 'sphere', r: 7 });
    expect(x.box![1][0]).toBeCloseTo(7, 6);
    shape.delete();
  });
});

describe('print check on the solid', () => {
  it('a box, a cylinder (its seam) and a ball (its poles) are closed and manifold; a lone face is open', () => {
    for (const s of [makeBox([0, 0, 0], [10, 10, 10]), makeCylinder(5, 10), makeSphere(5)]) {
      expect(solidChecks(s)).toEqual({ closed: true, manifold: true });
      s.delete();
    }
    const face = makeBox([0, 0, 0], [10, 10, 10]).faces[0];
    expect(solidChecks(face as unknown as Parameters<typeof solidChecks>[0])).toEqual({ closed: false, manifold: true });
    // two boxes sharing an edge only: four faces on it
    const pair = makeBox([0, 0, 0], [10, 10, 10]).fuse(makeBox([10, 10, 0], [20, 20, 10]));
    expect(solidChecks(pair).manifold).toBe(false);
    pair.delete();
  });
});

describe('free edges', () => {
  it('a bezier edge comes with a path the true edge lies on within 1e-6 mm, both ways', async () => {
    const { draw } = await import('replicad');
    const { nearestOnPath, hermite } = await import('./paths');
    const shape = draw([0, 0]).cubicBezierCurveTo([40, 0], [5, 35], [40, 30]).lineTo([0, 30]).close().sketchOnPlane().extrude(5) as Parameters<typeof meshBody>[0];
    const m = meshBody(shape);
    const k = m.exact!.edges.findIndex((e) => e.kind === 'curve');
    const e = m.exact!.edges[k] as Extract<NonNullable<typeof m.exact>['edges'][number], { kind: 'curve' }>;
    const edge = shape.edges.find((x) => x.geomType === 'BEZIER_CURVE' || x.geomType === 'BSPLINE_CURVE')!;
    const dense = Array.from({ length: 20001 }, (_, i) => edge.pointAt(i / 20000).toTuple() as [number, number, number]);
    const toDense = (q: number[]) => Math.min(...dense.slice(1).map((b, i) => {
      const a = dense[i];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1] + (q[2] - a[2]) * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1)));
      return Math.hypot(q[0] - a[0] - t * d[0], q[1] - a[1] - t * d[1], q[2] - a[2] - t * d[2]);
    }));
    // the edge's points on the path (only the edge at z 0 or 5: whichever the path is)
    const z = e.path.pts[0][2];
    for (let i = 0; i <= 200; i++) {
      const q = edge.pointAt(i / 200).toTuple() as [number, number, number];
      if (Math.abs(q[2] - z) > 1e-9) continue;
      const p = nearestOnPath(e.path, q);
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(1e-6);
    }
    // the path's pieces on the edge
    if (Math.abs(dense[0][2] - z) < 1e-9)
      for (let i = 0; i + 1 < e.path.pts.length; i++) for (const t of [0.25, 0.5, 0.75]) expect(toDense(hermite(e.path.pts[i], e.path.dirs[i], e.path.pts[i + 1], e.path.dirs[i + 1], t))).toBeLessThan(1e-6);
    expect(e.path.pts.length).toBeLessThan(1024);
    shape.delete();
  });
});
