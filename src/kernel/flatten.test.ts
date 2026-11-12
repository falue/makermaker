import { describe, expect, it } from 'vitest';
import { facingOut, lscm, loopArea, nets, netLines, stretchOf, type FlatFace } from './flatten';

/** A grid of `nu` × `nv` cells over (u, v) in [0, 1]², points from `at`, triangles counter-clockwise in (u, v). */
function grid(nu: number, nv: number, at: (u: number, v: number) => number[]) {
  const pts: number[] = [];
  const tris: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(...at(i / nu, j / nv));
  const id = (i: number, j: number) => j * (nu + 1) + i;
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { pts: Float64Array.from(pts), tris: Uint32Array.from(tris) };
}

const areaOf = (flat: Float64Array, tris: Uint32Array) => {
  let a = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const [p, q, r] = [tris[t], tris[t + 1], tris[t + 2]];
    a += ((flat[2 * q] - flat[2 * p]) * (flat[2 * r + 1] - flat[2 * p + 1]) - (flat[2 * r] - flat[2 * p]) * (flat[2 * q + 1] - flat[2 * p + 1])) / 2;
  }
  return a;
};

describe('lscm', () => {
  it('rolls a piece of a cylinder out without stretch, at its true size', () => {
    // a third of a tube, r 20, 30 high: flat 2π·20/3 × 30
    const { pts, tris } = grid(24, 6, (u, v) => [20 * Math.cos((u * 2 * Math.PI) / 3), 20 * Math.sin((u * 2 * Math.PI) / 3), 30 * v]);
    const flat = facingOut(lscm(pts, tris), tris);
    expect(stretchOf({ pts, tris, flat })).toBeLessThan(0.01);
    // the mesh's own area (chords, not the arc): flat keeps it
    expect(areaOf(flat, tris)).toBeCloseTo(24 * 6 * 2 * (20 * 2 * Math.sin(Math.PI / 72)) * 5 * 0.5, 0);
  });
  it('flattens a dome with some stretch, and says how much', () => {
    const { pts, tris } = grid(32, 8, (u, v) => {
      const [a, b] = [u * 2 * Math.PI, (v * Math.PI) / 4]; // a cap 45° from the pole down
      return [20 * Math.sin(b) * Math.cos(a), 20 * Math.sin(b) * Math.sin(a), 20 * Math.cos(b)];
    });
    // the grid's seam and pole: only the cap without its pole row, cut open at u = 0
    const flat = facingOut(lscm(pts, tris), tris);
    const s = stretchOf({ pts, tris, flat });
    expect(s).toBeGreaterThan(0.02);
    expect(s).toBeLessThan(0.5);
  });
});

/** A cube of side `s` as six flat faces of two triangles, each flat in its own plane, edges keyed by their corners. */
function cube(s: number): FlatFace[] {
  const corner = (i: number) => [(i & 1) * s, ((i >> 1) & 1) * s, ((i >> 2) & 1) * s];
  // each face's corners counter-clockwise seen from outside
  const quads = [
    [0, 2, 3, 1], // bottom (z 0)
    [4, 5, 7, 6], // top
    [0, 1, 5, 4], // front (y 0)
    [2, 6, 7, 3], // back
    [0, 4, 6, 2], // left (x 0)
    [1, 3, 7, 5], // right
  ];
  return quads.map((q) => {
    const pts = Float64Array.from(q.flatMap(corner));
    const tris = Uint32Array.from([0, 1, 2, 0, 2, 3]);
    // flat: its own plane, axes along its first two sides
    const [o, a, , b] = q.map(corner);
    const e1 = a.map((x, k) => (x - o[k]) / s);
    const e2 = b.map((x, k) => (x - o[k]) / s);
    const flat = Float64Array.from(q.flatMap((c) => [0, 1].map((m) => [e1, e2][m].reduce((n, x, k) => n + x * (corner(c)[k] - o[k]), 0))));
    facingOut(flat, tris);
    const edges = q.map((c, k) => {
      const d = q[(k + 1) % 4];
      return { key: Math.min(c, d) * 8 + Math.max(c, d), nodes: c < d ? [k, (k + 1) % 4] : [(k + 1) % 4, k] };
    });
    return { pts, tris, flat, edges };
  });
}

describe('nets', () => {
  it('unwraps a cube into one cross of six squares, five folds, one closed outline', () => {
    const faces = cube(10);
    const islands = nets(faces);
    expect(islands).toHaveLength(1);
    expect(islands[0].faces).toHaveLength(6);
    expect(islands[0].folds).toHaveLength(5);
    const { loops, folds } = netLines(islands[0], faces);
    expect(loops).toHaveLength(1);
    expect(loops[0].closed).toBe(true);
    expect(Math.abs(loopArea(loops[0].pts))).toBeCloseTo(600, 6);
    expect(folds).toHaveLength(5);
  });
});
