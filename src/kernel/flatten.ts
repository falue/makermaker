/** Faces flattened and laid out into nets (plain numbers, no OpenCascade): the maths of the unwrap export. */

export type P2 = [number, number];

/** A face meshed and flattened. */
export interface FlatFace {
  /** Its points: x, y, z per node (mm). */
  pts: Float64Array;
  /** Its triangles: 3 nodes each, counter-clockwise seen from outside. */
  tris: Uint32Array;
  /** Its points flat: x, y per node, seen from outside (its triangles counter-clockwise there too). */
  flat: Float64Array;
  /** Its edges shared with other faces: the edge's key, its nodes in order along it. */
  edges: { key: number; nodes: number[] }[];
}

/** A net: faces turned and moved into one flat piece (`m`: cos, sin, dx, dy), and the edges they hang on. */
export interface Island {
  faces: { face: number; m: number[] }[];
  folds: { a: { face: number; nodes: number[] }; b: { face: number; nodes: number[] } }[];
}

const at = (pts: Float64Array, i: number) => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: number[]) => Math.sqrt(dot(a, a));

/** A triangle in its own plane: its corners' x, y (the first at 0, 0, the second on x) and its area; null: no area. */
function local(pts: Float64Array, a: number, b: number, c: number) {
  const [p, q, r] = [at(pts, a), at(pts, b), at(pts, c)];
  const [u, v] = [sub(q, p), sub(r, p)];
  const n = cross(u, v);
  const area = len(n) / 2;
  if (area < 1e-12) return null;
  const e1 = u.map((x) => x / len(u));
  const e2 = cross(n, e1).map((x) => x / (2 * area));
  return { z: [0, 0, len(u), 0, dot(v, e1), dot(v, e2)], area };
}

/**
 * Least squares conformal map (Lévy et al. 2002): the flat points whose triangles keep their angles as well as can be,
 * two points far apart pinned at their true distance, then scaled to the face's true area. Per triangle with corners
 * z (complex, in its own plane) and flat points U, a conformal map makes Σ (z[j+2] − z[j+1]) · U[j] zero; the sum of
 * their squares over area is least. Solved by conjugate gradients on the normal equations, from the face projected.
 */
export function lscm(pts: Float64Array, tris: Uint32Array): Float64Array {
  const n = pts.length / 3;
  // pins: the point farthest from the first, and the one farthest from that
  const far = (from: number) => {
    let best = from;
    for (let i = 0, d = -1; i < n; i++) {
      const e = len(sub(at(pts, i), at(pts, from)));
      if (e > d) [d, best] = [e, i];
    }
    return best;
  };
  const pa = far(0);
  const pb = far(pa);
  const d = len(sub(at(pts, pb), at(pts, pa)));
  // a start: the points on a plane through both pins, square to the face's mean normal
  const normal = [0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    const [p, q, r] = [at(pts, tris[t]), at(pts, tris[t + 1]), at(pts, tris[t + 2])];
    cross(sub(q, p), sub(r, p)).forEach((x, k) => (normal[k] += x));
  }
  const e1 = sub(at(pts, pb), at(pts, pa)).map((x) => x / (d || 1));
  let e2 = cross(normal, e1);
  e2 = len(e2) > 1e-12 ? e2.map((x) => x / len(e2)) : [e1[1], -e1[0], 0];
  const x = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const v = sub(at(pts, i), at(pts, pa));
    [x[2 * i], x[2 * i + 1]] = [dot(v, e1), dot(v, e2)];
  }
  [x[2 * pa], x[2 * pa + 1], x[2 * pb], x[2 * pb + 1]] = [0, 0, d, 0];
  const pinned = (k: number) => k >> 1 === pa || k >> 1 === pb;
  // two rows per triangle (the sum's real and imaginary parts), six unknowns each: u, v of its corners
  const cols: number[] = [];
  const vals: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const tri = local(pts, tris[t], tris[t + 1], tris[t + 2]);
    if (!tri) continue;
    const w = 1 / Math.sqrt(tri.area);
    const row = (imag: boolean) => {
      for (let j = 0; j < 3; j++) {
        const [a, b] = [(tri.z[((j + 2) % 3) * 2] - tri.z[((j + 1) % 3) * 2]) * w, (tri.z[((j + 2) % 3) * 2 + 1] - tri.z[((j + 1) % 3) * 2 + 1]) * w];
        const node = tris[t + j];
        // real: a·u − b·v; imaginary: b·u + a·v
        cols.push(2 * node, 2 * node + 1);
        vals.push(imag ? b : a, imag ? a : -b);
      }
    };
    row(false);
    row(true);
  }
  const rows = cols.length / 6;
  const times = (p: Float64Array, out: Float64Array) => {
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let k = r * 6; k < r * 6 + 6; k++) if (!pinned(cols[k])) s += vals[k] * p[cols[k]];
      out[r] = s;
    }
  };
  const timesT = (r: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let i = 0; i < rows; i++) for (let k = i * 6; k < i * 6 + 6; k++) if (!pinned(cols[k])) out[cols[k]] += vals[k] * r[i];
  };
  // the residual of the start (pins included), then CGLS on the free unknowns
  const res = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    let s = 0;
    for (let k = r * 6; k < r * 6 + 6; k++) s += vals[k] * x[cols[k]];
    res[r] = -s;
  }
  const s = new Float64Array(2 * n);
  timesT(res, s);
  const p = Float64Array.from(s);
  const q = new Float64Array(rows);
  let gamma = dot2(s, s);
  const first = gamma;
  for (let it = 0; it < 4 * n + 100 && gamma > first * 1e-20 && gamma > 1e-30; it++) {
    times(p, q);
    const alpha = gamma / (dot2(q, q) || 1);
    for (let k = 0; k < 2 * n; k++) if (!pinned(k)) x[k] += alpha * p[k];
    for (let r = 0; r < rows; r++) res[r] -= alpha * q[r];
    timesT(res, s);
    const next = dot2(s, s);
    for (let k = 0; k < 2 * n; k++) p[k] = s[k] + (next / gamma) * p[k];
    gamma = next;
  }
  // its true size: the flat area made the face's
  let [area3, area2] = [0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    area3 += local(pts, tris[t], tris[t + 1], tris[t + 2])?.area ?? 0;
    area2 += signedArea(x, tris[t], tris[t + 1], tris[t + 2]);
  }
  const k = Math.sqrt(area3 / (Math.abs(area2) || 1));
  return x.map((v) => v * k);
}

const dot2 = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** A flat triangle's area, positive counter-clockwise. */
const signedArea = (f: Float64Array, a: number, b: number, c: number) => ((f[2 * b] - f[2 * a]) * (f[2 * c + 1] - f[2 * a + 1]) - (f[2 * c] - f[2 * a]) * (f[2 * b + 1] - f[2 * a + 1])) / 2;

/** `flat` mirrored if its triangles run clockwise (most of their area): then seen from outside, as the face is. */
export function facingOut(flat: Float64Array, tris: Uint32Array) {
  let area = 0;
  for (let t = 0; t < tris.length; t += 3) area += signedArea(flat, tris[t], tris[t + 1], tris[t + 2]);
  if (area < 0) for (let i = 0; i < flat.length; i += 2) flat[i] = -flat[i];
  return flat;
}

/**
 * How much a face stretches flat: its worst triangle's length change (0.05: 5 %, either way), triangles of under a
 * tenth of the mean area left out (a sphere's poles are slivers).
 */
export function stretchOf(face: Pick<FlatFace, 'pts' | 'tris' | 'flat'>) {
  const { pts, tris, flat } = face;
  const tri = Array.from({ length: tris.length / 3 }, (_, t) => local(pts, tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]));
  const mean = tri.reduce((s, x) => s + (x?.area ?? 0), 0) / (tri.length || 1);
  let worst = 0;
  tri.forEach((x, t) => {
    if (!x || x.area < mean / 10) return;
    const [a, b, c] = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
    // the map from the triangle's own plane to flat: J = [f1 − f0, f2 − f0] · [z1 − z0, z2 − z0]⁻¹ (z0 = 0, z1 on x)
    const [f1x, f1y, f2x, f2y] = [flat[2 * b] - flat[2 * a], flat[2 * b + 1] - flat[2 * a + 1], flat[2 * c] - flat[2 * a], flat[2 * c + 1] - flat[2 * a + 1]];
    const [z1, z2x, z2y] = [x.z[2], x.z[4], x.z[5]];
    const [j00, j10] = [f1x / z1, f1y / z1];
    const [j01, j11] = [(f2x - j00 * z2x) / z2y, (f2y - j10 * z2x) / z2y];
    // its singular values: how much it lengthens most and least
    const s = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
    const det = j00 * j11 - j01 * j10;
    const root = Math.sqrt(Math.max(0, s * s - 4 * det * det));
    const [big, small] = [Math.sqrt((s + root) / 2), Math.sqrt(Math.max(0, (s - root) / 2))];
    worst = Math.max(worst, big - 1, 1 - small);
  });
  return worst;
}

/** A face's outline: its triangles' sides used once, as directed pairs of nodes (counter-clockwise around it, holes clockwise). */
function rim(tris: Uint32Array): [number, number][] {
  const used = new Map<string, number>();
  for (let t = 0; t < tris.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const [a, b] = [tris[t + j], tris[t + ((j + 1) % 3)]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
  const out: [number, number][] = [];
  for (let t = 0; t < tris.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const [a, b] = [tris[t + j], tris[t + ((j + 1) % 3)]];
      if (used.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) out.push([a, b]);
    }
  return out;
}

const place = (m: number[], x: number, y: number): P2 => [m[0] * x - m[1] * y + m[2], m[1] * x + m[0] * y + m[3]];
/** `m` after `n` (n first). */
const then = (m: number[], n: number[]) => [m[0] * n[0] - m[1] * n[1], m[1] * n[0] + m[0] * n[1], ...place(m, n[2], n[3])];

/** The turn and move that lays points `from` best onto points `to` (least squares, no mirror, no scale). */
function fit(from: P2[], to: P2[]): number[] {
  const mean = (ps: P2[]) => ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length], [0, 0]);
  const [cf, ct] = [mean(from), mean(to)];
  let [c, s] = [0, 0];
  from.forEach((p, i) => {
    const [ax, ay, bx, by] = [p[0] - cf[0], p[1] - cf[1], to[i][0] - ct[0], to[i][1] - ct[1]];
    [c, s] = [c + ax * bx + ay * by, s + ax * by - ay * bx];
  });
  // no spread at all (one point): only a move
  const r = Math.hypot(c, s);
  const [cos, sin] = r > 1e-12 ? [c / r, s / r] : [1, 0];
  return [cos, sin, ct[0] - (cos * cf[0] - sin * cf[1]), ct[1] - (sin * cf[0] + cos * cf[1])];
}

/** Whether segments p1–p2 and q1–q2 cross inside both (touching at an end does not count). */
function crossing(p1: P2, p2: P2, q1: P2, q2: P2) {
  const side = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const [d1, d2, d3, d4] = [side(q1, q2, p1), side(q1, q2, p2), side(p1, p2, q1), side(p1, p2, q2)];
  const scale = Math.max(Math.abs(p2[0] - p1[0]) + Math.abs(p2[1] - p1[1]), Math.abs(q2[0] - q1[0]) + Math.abs(q2[1] - q1[1])) ** 2 * 1e-9;
  return ((d1 > scale && d2 < -scale) || (d1 < -scale && d2 > scale)) && ((d3 > scale && d4 < -scale) || (d3 < -scale && d4 > scale));
}

/** Whether `p` lies inside the loops (an odd number of them around it). */
function inside(p: P2, loops: P2[][]) {
  let odd = false;
  for (const loop of loops)
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [a, b] = [loop[i], loop[j]];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) odd = !odd;
    }
  return odd;
}

/** Directed pairs of nodes chained into loops (pairs that do not close stay open, as they are). */
function chain(pairs: [number, number][]): number[][] {
  const next = new Map<number, number[]>();
  for (const [a, b] of pairs) next.set(a, [...(next.get(a) ?? []), b]);
  const loops: number[][] = [];
  for (const [a] of pairs) {
    if (!next.get(a)?.length) continue;
    const loop = [a];
    for (let n = next.get(a)!.shift()!; n !== a && next.get(n)?.length; n = next.get(n)!.shift()!) loop.push(n);
    loops.push(loop);
  }
  return loops;
}

/**
 * Faces joined into nets along their shared edges, longest edges first, wherever the face that comes along overlaps
 * nothing already in that net; the faces left over make nets of their own.
 */
export function nets(faces: FlatFace[]): Island[] {
  const outlines = faces.map((f) => chain(rim(f.tris)));
  const islands: Island[] = faces.map((_, i) => ({ faces: [{ face: i, m: [1, 0, 0, 0] }], folds: [] }));
  const islandOf = faces.map((_, i) => i);
  const transform = faces.map(() => [1, 0, 0, 0]);
  const flatAt = (f: number, node: number, m = transform[f]) => place(m, faces[f].flat[2 * node], faces[f].flat[2 * node + 1]);
  // each shared edge once: its two sides, longest first
  const sides = new Map<number, { face: number; nodes: number[] }[]>();
  faces.forEach((f, i) => f.edges.forEach((e) => sides.set(e.key, [...(sides.get(e.key) ?? []), { face: i, nodes: e.nodes }])));
  const pairs = [...sides.values()]
    .filter((s) => s.length === 2 && s[0].face !== s[1].face && s[0].nodes.length === s[1].nodes.length && s[0].nodes.length > 1)
    .map(([a, b]) => {
      // the same direction along the edge in both
      const first = (s: { face: number; nodes: number[] }, k: number) => at(faces[s.face].pts, s.nodes[k]);
      if (len(sub(first(a, 0), first(b, 0))) > len(sub(first(a, 0), first(b, b.nodes.length - 1)))) b = { ...b, nodes: [...b.nodes].reverse() };
      const length = a.nodes.slice(1).reduce((n, node, k) => n + len(sub(at(faces[a.face].pts, node), at(faces[a.face].pts, a.nodes[k]))), 0);
      return { a, b, length };
    })
    .sort((x, y) => y.length - x.length);
  /** An island's outline segments, as placed now (or after `m`), each with its face and nodes. */
  const segments = (island: Island, m?: number[]) =>
    island.faces.flatMap(({ face }) => {
      const mm = m ? then(m, transform[face]) : transform[face];
      return outlines[face].flatMap((loop) => loop.map((node, k) => ({ face, a: node, b: loop[(k + 1) % loop.length], p: flatAt(face, node, mm), q: flatAt(face, loop[(k + 1) % loop.length], mm) })));
    });
  for (const { a, b, length } of pairs) {
    const [ia, ib] = [islandOf[a.face], islandOf[b.face]];
    if (ia === ib) continue;
    const [from, to] = [b.nodes.map((n) => flatAt(b.face, n)), a.nodes.map((n) => flatAt(a.face, n))];
    const m = fit(from, to);
    // only where the edge lies the same flat on both sides (a cylinder's rim is straight, its end's round: no hinge)
    if (from.some((p, k) => Math.hypot(...place(m, p[0], p[1]).map((v, j) => v - to[k][j])) > 0.05 + 0.005 * length)) continue;
    // the hinge's own segments do not count, on either side
    const hinge = new Set([...a.nodes.slice(1).map((n, k) => `${a.face}:${a.nodes[k]}:${n}`), ...b.nodes.slice(1).map((n, k) => `${b.face}:${b.nodes[k]}:${n}`)]);
    const free = (s: { face: number; a: number; b: number }) => !hinge.has(`${s.face}:${s.a}:${s.b}`) && !hinge.has(`${s.face}:${s.b}:${s.a}`);
    const [here, coming] = [segments(islands[ia]).filter(free), segments(islands[ib], m).filter(free)];
    const box = (ss: { p: P2; q: P2 }[]) => ss.reduce((o, s) => [Math.min(o[0], s.p[0], s.q[0]), Math.min(o[1], s.p[1], s.q[1]), Math.max(o[2], s.p[0], s.q[0]), Math.max(o[3], s.p[1], s.q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const [bh, bc] = [box(here), box(coming)];
    const near = (s: { p: P2; q: P2 }, o: number[]) => Math.max(s.p[0], s.q[0]) >= o[0] && Math.min(s.p[0], s.q[0]) <= o[2] && Math.max(s.p[1], s.q[1]) >= o[1] && Math.min(s.p[1], s.q[1]) <= o[3];
    const [h, c] = [here.filter((s) => near(s, bc)), coming.filter((s) => near(s, bh))];
    let overlaps = h.some((s) => c.some((t) => crossing(s.p, s.q, t.p, t.q)));
    // one wholly inside the other: a point well inside each face of one, in a face of the other
    const loopsOf = (island: Island, mm?: number[]) => island.faces.map(({ face }) => outlines[face].map((loop) => loop.map((n) => flatAt(face, n, mm ? then(mm, transform[face]) : transform[face]))));
    const pointIn = (face: number, mm: number[]) => {
      const { tris, pts } = faces[face];
      let best = 0;
      for (let t = 3; t < tris.length; t += 3) if ((local(pts, tris[t], tris[t + 1], tris[t + 2])?.area ?? 0) > (local(pts, tris[best], tris[best + 1], tris[best + 2])?.area ?? 0)) best = t;
      const ps = [0, 1, 2].map((j) => flatAt(face, tris[best + j], mm));
      return [(ps[0][0] + ps[1][0] + ps[2][0]) / 3, (ps[0][1] + ps[1][1] + ps[2][1]) / 3] as P2;
    };
    if (!overlaps) {
      const [lh, lc] = [loopsOf(islands[ia]), loopsOf(islands[ib], m)];
      overlaps = islands[ib].faces.some(({ face }) => lh.some((loops) => inside(pointIn(face, then(m, transform[face])), loops))) || islands[ia].faces.some(({ face }) => lc.some((loops) => inside(pointIn(face, transform[face]), loops)));
    }
    if (overlaps) continue;
    for (const f of islands[ib].faces) (transform[f.face] = then(m, transform[f.face])), (islandOf[f.face] = ia);
    islands[ia].faces.push(...islands[ib].faces);
    islands[ia].folds.push(...islands[ib].folds, { a, b });
    islands[ib] = { faces: [], folds: [] };
  }
  // each net turned to lie in its smallest box, the long way across (a flat face's own axes point any way)
  return islands
    .filter((i) => i.faces.length)
    .map((i) => {
      const turn = upright(i.faces.flatMap(({ face }) => outlines[face].flat().map((n) => flatAt(face, n))));
      return { faces: i.faces.map(({ face }) => ({ face, m: then(turn, transform[face]) })), folds: i.folds };
    });
}

/** The turn (cos, sin, 0, 0) that sets `pts` in their smallest box (one side along a side of their hull), wider than high. */
function upright(pts: P2[]): number[] {
  // the convex hull, counter-clockwise (Andrew's monotone chain)
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (ps: P2[]) => ps.reduce<P2[]>((h, p) => {
    while (h.length > 1 && turn(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
    return [...h, p];
  }, []);
  const hull = [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
  let best = { area: Infinity, c: 1, s: 0, wide: true };
  hull.forEach((p, i) => {
    const q = hull[(i + 1) % hull.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < 1e-9) return;
    // turned by minus this side's angle: the side lies along x
    const [c, s] = [(q[0] - p[0]) / l, -(q[1] - p[1]) / l];
    const xs = hull.map(([x, y]) => c * x - s * y);
    const ys = hull.map(([x, y]) => s * x + c * y);
    const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    if (w * h < best.area - 1e-9) best = { area: w * h, c, s, wide: w >= h };
  });
  // a quarter turn more when it stands upright
  return best.wide ? [best.c, best.s, 0, 0] : [-best.s, best.c, 0, 0];
}

/**
 * A net's outline loops (its faces' outlines less the edges they hang on, joined end to end; holes clockwise), its
 * fold lines (open), and each face's own loops; all y down, as the cut writers take them.
 */
export function netLines(island: Island, faces: FlatFace[]) {
  const m = new Map(island.faces.map((f) => [f.face, f.m]));
  const pt = (face: number, node: number): P2 => place(m.get(face)!, faces[face].flat[2 * node], faces[face].flat[2 * node + 1]);
  const hinge = new Set(island.folds.flatMap(({ a, b }) => [a, b].flatMap((s) => s.nodes.slice(1).flatMap((n, k) => [`${s.face}:${s.nodes[k]}:${n}`, `${s.face}:${n}:${s.nodes[k]}`]))));
  // every face's outline segments not on a fold, chained: within a face by node, across a fold's end to the nearest start
  const segs = island.faces.flatMap(({ face }) => rim(faces[face].tris).filter(([a, b]) => !hinge.has(`${face}:${a}:${b}`)).map(([a, b]) => ({ face, a, b, p: pt(face, a), q: pt(face, b) })));
  const byStart = new Map(segs.map((s, i) => [`${s.face}:${s.a}`, i]));
  const used = new Uint8Array(segs.length);
  const loops: { pts: P2[]; closed: boolean }[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const pts: P2[] = [];
    let closed = false;
    for (let k = i; ; ) {
      used[k] = 1;
      pts.push(segs[k].p);
      const own = byStart.get(`${segs[k].face}:${segs[k].b}`);
      if (own === i) {
        closed = true;
        break;
      }
      if (own !== undefined && !used[own]) {
        k = own;
        continue;
      }
      // the face ends at a fold: of the starts there (a hair apart: the faces were fitted on), the one turning most
      // clockwise from the way back keeps the piece on the left
      const [end, from] = [segs[k].q, segs[k].p];
      const back = Math.atan2(from[1] - end[1], from[0] - end[0]);
      let [next, turn] = [-1, Infinity];
      for (let j = 0; j < segs.length; j++) {
        if ((used[j] && j !== i) || Math.hypot(segs[j].p[0] - end[0], segs[j].p[1] - end[1]) > 0.5) continue;
        const cw = (back - Math.atan2(segs[j].q[1] - segs[j].p[1], segs[j].q[0] - segs[j].p[0]) + 4 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
        if (cw < turn) [next, turn] = [j, cw];
      }
      if (next === i) closed = true;
      if (next < 0 || next === i) break;
      k = next;
    }
    if (pts.length > 1) loops.push({ pts, closed });
  }
  // traced y up (counter-clockwise around the piece), given y down
  const down = (ps: P2[]) => ps.map(([x, y]): P2 => [x, -y]);
  return {
    loops: loops.map((l) => ({ ...l, hole: l.closed && loopArea(l.pts) < 0, pts: down(l.pts) })),
    folds: island.folds.map(({ a }) => down(a.nodes.map((n) => pt(a.face, n)))),
    regions: island.faces.map(({ face }) => ({ face, loops: chain(rim(faces[face].tris)).map((l) => down(l.map((n) => pt(face, n)))) })),
  };
}

/** A loop's area, positive counter-clockwise (y up). */
export const loopArea = (loop: P2[]) => loop.reduce((s, p, i) => s + (p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1]), 0) / 2;
