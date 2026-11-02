import { corners, inside, type DrawnProfile } from './profiles';

type UV = [number, number];
/** An enclosed face: its outline counter-clockwise, and the outlines of what lies inside it unconnected (holes). */
export interface Face {
  outer: UV[];
  holes: UV[][];
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
export function faces(paths: { pts: UV[]; closed: boolean }[], snap = 1e-6): Face[] {
  const segs = paths.flatMap(({ pts, closed }) => (closed ? pts : pts.slice(0, -1)).map((a, i): [UV, UV] => [a, pts[(i + 1) % pts.length]]));
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
  segs.forEach(([a, b], i) => {
    const vs = [...new Set(cuts[i])].sort((x, y) => x - y).map((t) => vertex([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
    vs.slice(1).forEach((v, k) => link(vs[k], v));
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
  const polys = cycles.map((c) => ({ pts: c.map((v) => at[v]), part: part.get(c[0]), area: signedArea(c.map((v) => at[v])) }));
  const out = polys.filter((p) => p.area > 1e-12).sort((p, q) => p.area - q.area);
  const result = out.map((p) => ({ face: { outer: p.pts, holes: [] as UV[][] }, part: p.part }));
  for (const rim of polys.filter((p) => p.area < -1e-12)) {
    const host = result.find((r) => r.part !== rim.part && inPolygon(r.face.outer, rim.pts[0]));
    host?.face.holes.push(rim.pts);
  }
  return result.map((r) => r.face);
}

/** Points along a closed shape's outline (circles in `steps` pieces), or a line's points. */
function pathOf(p: DrawnProfile, steps = 180): { pts: UV[]; closed: boolean } {
  if (p.kind === 'line') return { pts: p.pts, closed: false };
  if (p.kind === 'circle') return { pts: Array.from({ length: steps }, (_, k): UV => [p.x + (p.d / 2) * Math.cos((2 * Math.PI * k) / steps), p.y + (p.d / 2) * Math.sin((2 * Math.PI * k) / steps)]), closed: true };
  return { pts: corners(p), closed: true };
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
