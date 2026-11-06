import { arcOf, bakeTurn, curved, flattened, inside, sidesOf, type DrawnProfile } from './profiles';
import type { Curve } from './types';

type UV = [number, number];
/** A closed outline with its sides' true curves. */
export type Loop = { pts: UV[]; curves: (Curve | null)[] };
/** An enclosed face: its outline counter-clockwise, and the outlines of what lies inside it unconnected (holes), as points; `loops`: the outline and the holes with their true curves, to build from. */
export interface Face {
  outer: UV[];
  holes: UV[][];
  loops: Loop[];
}

/** A curved side a path's pieces come from: a bezier curve, or an arc (a circle's quarter too). */
type Source = { a: UV; c1: UV; c2: UV; b: UV } | { a: UV; mid: UV; b: UV };
/** A piece of a path along its curve, from `t0` to `t1` (0..1); null: straight. */
type Along = { source: Source; t0: number; t1: number } | null;

/** The point of an arc source at `t`. */
function arcPoint(s: Extract<Source, { mid: UV }>, t: number): UV {
  const arc = arcOf(s.a, s.mid, s.b);
  if (!arc) return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
  const k = arc.a0 + (arc.a1 - arc.a0) * t;
  return [arc.c[0] + arc.r * Math.cos(k), arc.c[1] + arc.r * Math.sin(k)];
}

/** The curve of `source` from `t0` to `t1` (either way round; a bezier's handles by blossoming). */
function partOf(source: Source, t0: number, t1: number): Curve {
  if ('mid' in source) return { mid: arcPoint(source, (t0 + t1) / 2) };
  const { a, c1, c2, b } = source;
  const lerp = (p: UV, q: UV, t: number): UV => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const blossom = (u: number, v: number, w: number) => {
    const [p, q, r] = [lerp(a, c1, u), lerp(c1, c2, u), lerp(c2, b, u)];
    return lerp(lerp(p, q, v), lerp(q, r, v), w);
  };
  return { c1: blossom(t0, t0, t1), c2: blossom(t0, t1, t1) };
}

/** A traced outline's pieces joined into true curves where they run on along one curve. */
function loopOf(pts: UV[], along: Along[]): Loop {
  const n = pts.length;
  const runsOn = (i: number) => {
    const [p, q] = [along[(i - 1 + n) % n], along[i]];
    return !!p && !!q && p.source === q.source && Math.abs(p.t1 - q.t0) < 1e-9;
  };
  // from where a run starts (none: a curve closed on itself, from its first piece)
  const first = Math.max(0, along.findIndex((_, i) => !runsOn(i)));
  const out: Loop = { pts: [], curves: [] };
  for (let k = 0; k < n; ) {
    const i = (first + k) % n;
    const here = along[i];
    let m = 1;
    while (here && k + m < n && runsOn((first + k + m) % n)) m++;
    out.pts.push(pts[i]);
    out.curves.push(here ? partOf(here.source, here.t0, along[(i + m - 1) % n]!.t1) : null);
    k += m;
  }
  return out;
}

const cross = (a: UV, b: UV) => a[0] * b[1] - a[1] * b[0];
const sub = (a: UV, b: UV): UV => [a[0] - b[0], a[1] - b[1]];
const signedArea = (pts: UV[]) => pts.reduce((s, p, i) => s + cross(p, pts[(i + 1) % pts.length]), 0) / 2;

/** Whether `p` lies inside the polygon `pts` (even-odd). */
export function inPolygon(pts: UV[], [x, y]: UV) {
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [[xi, yi], [xj, yj]] = [pts[i], pts[j]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

export const inFace = (f: Face, p: UV) => inPolygon(f.outer, p) && !f.holes.some((h) => inPolygon(h, p));

/**
 * The faces that open lines and closed outlines enclose together: every segment is split where it meets another,
 * ends sticking out are dropped, and each enclosed face gets the unconnected outlines inside it as holes.
 */
export function faces(given: { pts: UV[]; closed: boolean; along?: Along[] }[], snap = 1e-6): Face[] {
  const paths = withEnds(given);
  const segs = paths.flatMap(({ pts, closed }) => (closed ? pts : pts.slice(0, -1)).map((a, i): [UV, UV] => [a, pts[(i + 1) % pts.length]]));
  const alongs = paths.flatMap(({ pts, closed, along }) => (closed ? pts : pts.slice(0, -1)).map((_, i) => along?.[i] ?? null));
  // where each segment is cut (along it, 0..1), by every other segment it meets
  const cuts = segs.map(() => [0, 1]);
  segs.forEach(([a, b], i) => {
    const r = sub(b, a);
    for (let j = i + 1; j < segs.length; j++) {
      const [c, d] = segs[j];
      const s = sub(d, c);
      const den = cross(r, s);
      if (Math.abs(den) < 1e-12) continue; // parallel
      const t = cross(sub(c, a), s) / den;
      const u = cross(sub(c, a), r) / den;
      const e = 1e-9;
      if (t < -e || t > 1 + e || u < -e || u > 1 + e) continue;
      cuts[i].push(Math.min(1, Math.max(0, t)));
      cuts[j].push(Math.min(1, Math.max(0, u)));
    }
  });
  // vertices (snapped), and the edges between them
  const ids = new Map<string, number>();
  const at: UV[] = [];
  const vertex = (p: UV) => {
    const key = p.map((v) => Math.round(v / snap)).join();
    if (!ids.has(key)) ids.set(key, at.push(p) - 1);
    return ids.get(key)!;
  };
  const near = new Map<number, Set<number>>();
  const link = (p: number, q: number) => {
    if (p === q) return;
    for (const [x, y] of [[p, q], [q, p]]) (near.get(x) ?? near.set(x, new Set()).get(x)!).add(y);
  };
  // what curve each edge lies on, either way round
  const edgeOn = new Map<string, Along>();
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i])].sort((x, y) => x - y);
    const vs = ts.map((t) => vertex([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
    const on = alongs[i];
    vs.slice(1).forEach((v, k) => {
      link(vs[k], v);
      if (!on) return;
      const [t0, t1] = [ts[k], ts[k + 1]].map((u) => on.t0 + (on.t1 - on.t0) * u);
      edgeOn.set(`${vs[k]},${v}`, { source: on.source, t0, t1 });
      edgeOn.set(`${v},${vs[k]}`, { source: on.source, t0: t1, t1: t0 });
    });
  });
  // ends sticking out enclose nothing
  for (let pruned = true; pruned; ) {
    pruned = false;
    for (const [v, ns] of near)
      if (ns.size < 2) {
        for (const n of ns) near.get(n)!.delete(v);
        near.delete(v);
        pruned = true;
      }
  }
  // around each vertex its neighbours counter-clockwise; a face's next edge turns most to the right
  const around = new Map([...near].map(([v, ns]) => [v, [...ns].sort((p, q) => Math.atan2(at[p][1] - at[v][1], at[p][0] - at[v][0]) - Math.atan2(at[q][1] - at[v][1], at[q][0] - at[v][0]))]));
  const used = new Set<string>();
  const cycles: number[][] = [];
  for (const [v, ns] of around)
    for (const w of ns) {
      if (used.has(`${v},${w}`)) continue;
      const cycle: number[] = [];
      for (let [p, q] = [v, w]; !used.has(`${p},${q}`); ) {
        used.add(`${p},${q}`);
        cycle.push(p);
        const list = around.get(q)!;
        const k = list.indexOf(p);
        [p, q] = [q, list[(k - 1 + list.length) % list.length]];
      }
      cycles.push(cycle);
    }
  // connected parts: an unconnected outline inside a face is a hole of it
  const part = new Map<number, number>();
  for (const v of around.keys())
    if (!part.has(v)) for (const stack = [v]; stack.length; ) for (const n of around.get(stack.pop()!)!) if (!part.has(n)) (part.set(n, v), stack.push(n));
  const polys = cycles.map((c) => ({
    pts: c.map((v) => at[v]),
    part: part.get(c[0]),
    area: signedArea(c.map((v) => at[v])),
    loop: loopOf(c.map((v) => at[v]), c.map((v, i) => edgeOn.get(`${v},${c[(i + 1) % c.length]}`) ?? null)),
  }));
  const out = polys.filter((p) => p.area > 1e-12).sort((p, q) => p.area - q.area);
  const result = out.map((p) => ({ face: { outer: p.pts, holes: [] as UV[][], loops: [p.loop] }, part: p.part }));
  for (const rim of polys.filter((p) => p.area < -1e-12)) {
    const host = result.find((r) => r.part !== rim.part && inPolygon(r.face.outer, rim.pts[0]));
    if (host) host.face.holes.push(rim.pts), host.face.loops.push(rim.loop);
  }
  return result.map((r) => r.face);
}

type Path = { pts: UV[]; closed: boolean; along?: Along[] };

/**
 * Open lines' ends added as corners to the other paths they lie on, within reach: a curve piece's 1 % of its length (a
 * point on the true curve, a tangent's say, lies off its flattened pieces by up to about 0.5 %), else `exact` mm. So a
 * line drawn onto a circle meets its outline where it was drawn.
 */
function withEnds(paths: Path[], exact = 1e-3): Path[] {
  const added = paths.map((p) => p.pts.map(() => [] as [number, UV][])); // per path and side: (along it, point)
  paths.forEach((line, own) => {
    if (line.closed) return;
    for (const p of [line.pts[0], line.pts[line.pts.length - 1]]) {
      let best: { d: number; i: number; k: number; t: number } | null = null;
      paths.forEach(({ pts, closed, along }, i) => {
        if (i === own) return;
        (closed ? pts : pts.slice(0, -1)).forEach((a, k) => {
          const r = sub(pts[(k + 1) % pts.length], a);
          const t = Math.min(1, Math.max(0, (sub(p, a)[0] * r[0] + sub(p, a)[1] * r[1]) / (r[0] ** 2 + r[1] ** 2 || 1)));
          const d = Math.hypot(p[0] - a[0] - t * r[0], p[1] - a[1] - t * r[1]);
          if (d <= (along?.[k] ? 0.01 * Math.hypot(...r) : exact) && (!best || d < best.d)) best = { d, i, k, t };
        });
      });
      const b = best as { d: number; i: number; k: number; t: number } | null;
      if (b && b.t > 0 && b.t < 1) added[b.i][b.k].push([b.t, p]); // at a corner already: nothing to add
    }
  });
  return paths.map((path, i) => {
    if (!added[i].some((x) => x.length)) return path;
    const pts: UV[] = [];
    const along: Along[] = [];
    path.pts.forEach((a, k) => {
      pts.push(a);
      if (!path.closed && k === path.pts.length - 1) return;
      const on = path.along?.[k] ?? null;
      const cut = [...added[i][k]].sort((x, y) => x[0] - y[0]);
      const ts = [0, ...cut.map((c) => c[0]), 1];
      cut.forEach((c) => pts.push(c[1]));
      ts.slice(1).forEach((t, n) => along.push(on && { source: on.source, t0: on.t0 + (on.t1 - on.t0) * ts[n], t1: on.t0 + (on.t1 - on.t0) * t }));
    });
    return { ...path, pts, along };
  });
}

/** Points along a closed shape's outline (circles in `steps` pieces), or a line's points. */
function pathOf(p: DrawnProfile, steps = 180): { pts: UV[]; closed: boolean; along?: Along[] } {
  if (p.kind === 'circle') {
    const on = (a: number): UV => [p.x + (p.d / 2) * Math.cos(a), p.y + (p.d / 2) * Math.sin(a)];
    const quarter = Math.round(steps / 4);
    const quarters = [0, 1, 2, 3].map((q): Source => ({ a: on((q * Math.PI) / 2), mid: on(((q + 0.5) * Math.PI) / 2), b: on(((q + 1) * Math.PI) / 2) }));
    const along = Array.from({ length: quarter * 4 }, (_, k): Along => ({ source: quarters[Math.floor(k / quarter)], t0: (k % quarter) / quarter, t1: ((k % quarter) + 1) / quarter }));
    return { pts: along.map((_, k) => on((2 * Math.PI * k) / (quarter * 4))), closed: true, along };
  }
  const path = { pts: flattened(p), closed: p.kind !== 'line' };
  if (!curved(p) || (p.kind !== 'polygon' && p.kind !== 'line')) return path;
  const q = bakeTurn(p);
  return {
    ...path,
    along: sidesOf(q).flatMap((side, i) => {
      const c = q.curves?.[i];
      const [a, b] = [side[0], side[side.length - 1]];
      const source: Source | null = side.length < 3 || !c ? null : 'c1' in c ? { a, c1: c.c1, c2: c.c2, b } : { a, mid: c.mid, b };
      return side.slice(1).map((_, k): Along => source && { source, t0: k / (side.length - 1), t1: (k + 1) / (side.length - 1) });
    }),
  };
}

type Box = [number, number, number, number];
const boxOf = (pts: UV[]): Box => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
const touch = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * The faces a sketch's lines enclose, together with the closed shapes they reach (by bounding box, and on from those):
 * `uses` are those lines' and shapes' ids; shapes no line reaches are left out (their areas stay exact).
 */
export function lineFaces(ps: (DrawnProfile & { id: string })[]): { faces: (Face & { at: UV; in: string[] })[]; uses: string[] } {
  const paths = ps.map((p) => ({ p, path: pathOf(p) }));
  const boxes = paths.map(({ path }) => boxOf(path.pts));
  const uses = new Set(paths.flatMap(({ p }, i) => (p.kind === 'line' ? [i] : [])));
  for (let grew = uses.size > 0; grew; ) {
    grew = false;
    boxes.forEach((b, i) => !uses.has(i) && [...uses].some((k) => touch(b, boxes[k])) && (uses.add(i), (grew = true)));
  }
  const taking = [...uses].map((i) => paths[i]);
  const found = faces(taking.map(({ path }) => path)).map((f) => {
    const at = innerPoint(f);
    return { ...f, at, in: taking.filter(({ p }) => p.kind !== 'line' && inside(p, ...at)).map(({ p }) => p.id) };
  });
  return { faces: found, uses: taking.map(({ p }) => p.id) };
}

/**
 * Closed shapes in pieces that overlap or touch (pulled, each piece is one body): outlines that meet or cross, or one
 * shape inside another (a hole in a plate), join theirs.
 */
export function pieces(ps: (DrawnProfile & { id: string })[], eps = 1e-6): string[][] {
  const outlines = ps.map((p) => pathOf(p, 72).pts);
  const boxes = outlines.map((pts) => boxOf(pts));
  const meet = (a: UV[], b: UV[]) =>
    a.some((p, i) => {
      const q = a[(i + 1) % a.length];
      return b.some((c, j) => {
        const d = b[(j + 1) % b.length];
        const [r, s] = [sub(q, p), sub(d, c)];
        const den = cross(r, s);
        if (Math.abs(den) < 1e-12) {
          // parallel: touching only on one line, where their spans along it overlap
          if (Math.abs(cross(sub(c, p), r)) > eps * Math.hypot(...r)) return false;
          const [t0, t1] = [c, d].map((x) => (sub(x, p)[0] * r[0] + sub(x, p)[1] * r[1]) / (r[0] ** 2 + r[1] ** 2 || 1));
          return Math.max(t0, t1) >= -eps && Math.min(t0, t1) <= 1 + eps;
        }
        const [t, u] = [cross(sub(c, p), s) / den, cross(sub(c, p), r) / den];
        return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps;
      });
    });
  const root = ps.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const near = a[0] <= b[2] + eps && b[0] <= a[2] + eps && a[1] <= b[3] + eps && b[1] <= a[3] + eps;
      if (near && (inside(ps[i], ...outlines[j][0]) || inside(ps[j], ...outlines[i][0]) || meet(outlines[i], outlines[j]))) root[find(i)] = find(j);
    }
  const groups = new Map<number, string[]>();
  ps.forEach((p, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(p.id));
  return [...groups.values()];
}

/** A point inside the face (not in a hole): the middle of the widest gap along a horizontal line through it. */
export function innerPoint(f: Face): UV {
  const [x0, y0, x1, y1] = boxOf(f.outer);
  let best: [number, UV] = [-1, f.outer[0]];
  for (const k of [0.5, 0.31, 0.69, 0.17, 0.83]) {
    const y = y0 + k * (y1 - y0);
    // crossings of the outline and the holes with this line, left to right
    const xs = [f.outer, ...f.holes]
      .flatMap((pts) => pts.flatMap(([xa, ya], i) => {
        const [xb, yb] = pts[(i + 1) % pts.length];
        return ya > y !== yb > y ? [xa + ((y - ya) * (xb - xa)) / (yb - ya)] : [];
      }))
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > best[0]) best = [xs[i + 1] - xs[i], [(xs[i] + xs[i + 1]) / 2, y]];
  }
  return best[0] > 0 ? best[1] : [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** The face of `ps` (see `lineFaces`) with point `p` in it, if any. */
export function lineFaceAt(ps: (DrawnProfile & { id: string })[], p: UV) {
  return lineFaces(ps).faces.find((f) => inFace(f, p)) ?? null;
}
