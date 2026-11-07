import type { Resolved } from './resolve';
import type { Curve, Profile } from './types';

/** A profile in mm, without id (resolved profiles fit too). */
export type DrawnProfile = Resolved<Profile> extends infer P ? (P extends unknown ? Omit<P, 'id'> : never) : never;
type P = DrawnProfile;
type UV = [number, number];
type Pathed = Extract<P, { pts: UV[] }>;

/** The middle and radius of the arc from `a` through `mid` to `b`, and its angles there (radians, `a1` the far end, running from `a0` through the middle); null: they lie on one line. */
export function arcOf(a: UV, mid: UV, b: UV) {
  const d = 2 * (a[0] * (mid[1] - b[1]) + mid[0] * (b[1] - a[1]) + b[0] * (a[1] - mid[1]));
  if (Math.abs(d) < 1e-9) return null;
  const sq = ([x, y]: UV) => x * x + y * y;
  const x = (sq(a) * (mid[1] - b[1]) + sq(mid) * (b[1] - a[1]) + sq(b) * (a[1] - mid[1])) / d;
  const y = (sq(a) * (b[0] - mid[0]) + sq(mid) * (a[0] - b[0]) + sq(b) * (mid[0] - a[0])) / d;
  const [a0, am, ab] = [a, mid, b].map((p) => Math.atan2(p[1] - y, p[0] - x));
  const turn = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = turn(am - a0) < turn(ab - a0);
  return { c: [x, y] as UV, r: Math.hypot(a[0] - x, a[1] - y), a0, a1: a0 + (ccw ? turn(ab - a0) : -turn(a0 - ab)) };
}

/** Points along a side from `a` to `b`, both ends in. */
function sidePoints(a: UV, c: Curve | null | undefined, b: UV, steps = 32): UV[] {
  if (!c) return [a, b];
  if ('c1' in c) {
    const at = (t: number, k: number) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * c.c1[k] + 3 * (1 - t) * t ** 2 * c.c2[k] + t ** 3 * b[k];
    return Array.from({ length: steps + 1 }, (_, i) => (i === steps ? b : i ? [at(i / steps, 0), at(i / steps, 1)] : a));
  }
  const arc = arcOf(a, c.mid, b);
  if (!arc) return [a, b];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = arc.a0 + ((arc.a1 - arc.a0) * i) / steps;
    return i === steps ? b : i ? [arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)] : a;
  });
}

/** The point of a curved side nearest `q`. */
export function nearestOnSide(a: UV, c: Curve, b: UV, q: UV): UV {
  if ('mid' in c) {
    const arc = arcOf(a, c.mid, b);
    if (arc) {
      const t = Math.atan2(q[1] - arc.c[1], q[0] - arc.c[0]);
      const full = 2 * Math.PI;
      const dir = Math.sign(arc.a1 - arc.a0);
      const along = (((t - arc.a0) * dir) % full + full) % full;
      const sweep = Math.abs(arc.a1 - arc.a0);
      if (along <= sweep) return [arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)];
      return Math.hypot(q[0] - a[0], q[1] - a[1]) < Math.hypot(q[0] - b[0], q[1] - b[1]) ? a : b;
    }
    return a;
  }
  const at = (t: number): UV => [0, 1].map((k) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * c.c1[k] + 3 * (1 - t) * t ** 2 * c.c2[k] + t ** 3 * b[k]) as UV;
  const far = (t: number) => Math.hypot(at(t)[0] - q[0], at(t)[1] - q[1]);
  let best = 0;
  for (let k = 1; k <= 256; k++) if (far(k / 256) < far(best / 256)) best = k;
  let [lo, hi] = [Math.max(0, best - 1) / 256, Math.min(256, best + 1) / 256];
  for (let k = 0; k < 40; k++) {
    const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
    if (far(m1) < far(m2)) hi = m2;
    else lo = m1;
  }
  return at((lo + hi) / 2);
}

/** `q` moved onto the circle through three points that lie on a curve, between them: how far a chord's point really is from the curve (they lie on one line: `q`). */
export function ontoArcThrough(a: UV, b: UV, c: UV, q: UV): UV {
  const arc = arcOf(a, b, c);
  if (!arc) return q;
  const r = Math.hypot(q[0] - arc.c[0], q[1] - arc.c[1]);
  return r > 1e-9 ? [arc.c[0] + ((q[0] - arc.c[0]) * arc.r) / r, arc.c[1] + ((q[1] - arc.c[1]) * arc.r) / r] : q;
}

/** Whether a side bends. */
export const curved = (p: P) => (p.kind === 'polygon' || p.kind === 'line') && !!p.curves?.some(Boolean);

/** Each side of a polygon or line as points, both ends in, bakeTurn. */
export function sidesOf(p: Pathed): UV[][] {
  const n = p.kind === 'line' ? p.pts.length - 1 : p.pts.length;
  return Array.from({ length: Math.max(0, n) }, (_, i) => sidePoints(p.pts[i], p.curves?.[i], p.pts[(i + 1) % p.pts.length]));
}

/** Its points and curve handles through `f`. */
export function mapPoints<T extends Pathed>(p: T, f: (q: UV) => UV): T {
  const curves = p.curves?.map((c) => (!c ? null : 'c1' in c ? { c1: f(c.c1), c2: f(c.c2) } : { mid: f(c.mid) }));
  return { ...p, pts: p.pts.map(f), ...(curves ? { curves } : {}) };
}

/** A polygon with its turn in its points (`rot` 0); a line as it is. */
export function bakeTurn<T extends Pathed>(p: T): T {
  if (p.kind === 'line' || !p.rot) return p;
  const [cx, cy] = centre(p);
  const a = (p.rot * Math.PI) / 180;
  return { ...mapPoints(p, ([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]), rot: 0 };
}

/** The outline as points, curves in short pieces, turned; a closed shape's last point does not repeat its first (a circle has none). */
export function flattened(p: P): UV[] {
  if (p.kind !== 'polygon' && p.kind !== 'line') return corners(p);
  if (!curved(p)) return corners(p);
  const sides = sidesOf(bakeTurn(p));
  const pts = sides.flatMap((s) => s.slice(0, -1));
  return p.kind === 'line' ? [...pts, p.pts[p.pts.length - 1]] : pts;
}

/** The direction (not unit length) a side leaves its start in, and the one it reaches its end in. */
export function sideDirs(a: UV, c: Curve | null | undefined, b: UV): [UV, UV] {
  const chord: UV = [b[0] - a[0], b[1] - a[1]];
  if (!c) return [chord, chord];
  if ('c1' in c) {
    const out: UV = [c.c1[0] - a[0], c.c1[1] - a[1]];
    const into: UV = [b[0] - c.c2[0], b[1] - c.c2[1]];
    return [Math.hypot(...out) > 1e-9 ? out : chord, Math.hypot(...into) > 1e-9 ? into : chord];
  }
  const arc = arcOf(a, c.mid, b);
  if (!arc) return [chord, chord];
  const s = Math.sign(arc.a1 - arc.a0);
  const tangent = (t: number): UV => [-Math.sin(t) * s, Math.cos(t) * s];
  return [tangent(arc.a0), tangent(arc.a1)];
}

/** The rect's or polygon's corners, turned by `rot` (a line: its points); a circle has none. */
export function corners(p: P): [number, number][] {
  if (p.kind === 'circle') return [];
  if (p.kind === 'line') return p.pts;
  if (p.kind === 'ngon') {
    const n = Math.max(3, Math.round(p.sides));
    // the first corner points up (before turning)
    return Array.from({ length: n }, (_, k) => {
      const a = ((p.rot + 90 + (k * 360) / n) * Math.PI) / 180;
      return [p.x + (p.d / 2) * Math.cos(a), p.y + (p.d / 2) * Math.sin(a)] as [number, number];
    });
  }
  const pts: [number, number][] =
    p.kind === 'rect'
      ? [
          [p.x - p.w / 2, p.y - p.h / 2],
          [p.x + p.w / 2, p.y - p.h / 2],
          [p.x + p.w / 2, p.y + p.h / 2],
          [p.x - p.w / 2, p.y + p.h / 2],
        ]
      : p.pts;
  if (!p.rot) return pts;
  const [cx, cy] = centre(p);
  const a = (p.rot * Math.PI) / 180;
  return pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
}

/** A shape's corners to round, turned, with its sides' curves (rectangle, regular polygon, polygon); null: it has none. */
export function roundable(p: P): { pts: UV[]; curves?: (Curve | null)[] } | null {
  if (p.kind === 'rect' || p.kind === 'ngon') return { pts: corners(p) };
  return p.kind === 'polygon' ? bakeTurn(p) : null;
}

/**
 * The largest rounding each corner of a shape takes (in the order of `roundable`): `round` a radius, `bevel` a
 * chamfer's length along its sides; each reaching half of either side beside it, so no two corners overlap. A corner
 * whose sides run on in line takes none.
 */
export function cornerLimits(p: P): { round: number; bevel: number }[] {
  const q = roundable(p);
  if (!q) return [];
  const n = q.pts.length;
  return q.pts.map((at, i) => {
    const [prev, next] = [q.pts[(i - 1 + n) % n], q.pts[(i + 1) % n]];
    const [, din] = sideDirs(prev, q.curves?.[(i - 1 + n) % n], at);
    const [dout] = sideDirs(at, q.curves?.[i], next);
    const turn = Math.acos(Math.max(-1, Math.min(1, (din[0] * dout[0] + din[1] * dout[1]) / (Math.hypot(...din) * Math.hypot(...dout) || 1))));
    if (turn < 1e-6) return { round: 0, bevel: 0 };
    const reach = Math.min(Math.hypot(at[0] - prev[0], at[1] - prev[1]), Math.hypot(next[0] - at[0], next[1] - at[1])) / 2;
    return { round: reach / Math.tan(turn / 2), bevel: reach };
  });
}

/**
 * The corners of a shape as asked (`rs`: each corner its own, else R for all), in the order of `roundable`: above 0
 * a radius, below 0 a chamfer of that length; each at most what its corner takes (`cornerLimits`, kept a hair short
 * so neighbours never meet), so one too big leaves the others as asked and no corner fails.
 */
export function cornerRadii(p: P, keep = 0.999): number[] {
  const all = 'r' in p ? (p.r ?? 0) : 0;
  const rs = 'rs' in p ? p.rs : undefined;
  return cornerLimits(p).map(({ round, bevel }, i) => {
    const asked = rs?.[i] ?? all;
    return asked > 0 ? Math.min(asked, keep * round) : asked < 0 ? -Math.min(-asked, keep * bevel) : 0;
  });
}

/**
 * Each corner's rounding or chamfer (null: sharp), in the order of `roundable`: how far along its sides it starts (`t`,
 * along their tangents at the corner, so beside a curved side close to where the kernel's meets it), its points from
 * the side before to the side after (an arc in `steps` pieces, a chamfer its two ends), an arc's middle point there.
 */
export function cornerCuts(p: P, steps = 8): ({ t: number; pts: UV[]; centre?: UV } | null)[] {
  const q = roundable(p);
  if (!q) return [];
  const n = q.pts.length;
  const unit = ([x, y]: UV): UV => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
  return cornerRadii(p).map((r, i) => {
    if (!r) return null;
    const c = q.pts[i];
    const [, din] = sideDirs(q.pts[(i - 1 + n) % n], q.curves?.[(i - 1 + n) % n], c);
    const [dout] = sideDirs(c, q.curves?.[i], q.pts[(i + 1) % n]);
    const [u, v] = [unit(din), unit(dout)];
    const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    if (turn < 1e-6) return null;
    // a chamfer: straight across, its length along each side
    if (r < 0) return { t: -r, pts: [[c[0] + u[0] * r, c[1] + u[1] * r], [c[0] - v[0] * r, c[1] - v[1] * r]] };
    const bis = unit([v[0] - u[0], v[1] - u[1]]);
    const o: UV = [c[0] + (bis[0] * r) / Math.cos(turn / 2), c[1] + (bis[1] * r) / Math.cos(turn / 2)];
    const t = r * Math.tan(turn / 2);
    const [a0, a1] = [[c[0] - u[0] * t, c[1] - u[1] * t], [c[0] + v[0] * t, c[1] + v[1] * t]].map(([x, y]) => Math.atan2(y - o[1], x - o[0]));
    const d = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; // the short way round
    return { t, centre: o, pts: Array.from({ length: steps + 1 }, (_, k): UV => [o[0] + r * Math.cos(a0 + (d * k) / steps), o[1] + r * Math.sin(a0 + (d * k) / steps)]) };
  });
}

/**
 * The outline as drawn, its corners rounded or chamfered (`cornerCuts`); a curved side as points, left out where a
 * corner's rounding takes its place. Without any: `flattened`.
 */
export function roundedOutline(p: P, steps = 8): UV[] {
  const q = roundable(p);
  const cuts = cornerCuts(p, steps);
  if (!q || !cuts.some(Boolean)) return flattened(p);
  const n = q.pts.length;
  const far = (a: UV, b: UV, t: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) > t;
  return q.pts.flatMap((c, i) => {
    const next = q.pts[(i + 1) % n];
    const inner = q.curves?.[i] ? sidePoints(c, q.curves[i], next).slice(1, -1).filter((pt) => far(pt, c, cuts[i]?.t ?? 0) && far(pt, next, cuts[(i + 1) % n]?.t ?? 0)) : [];
    return [...(cuts[i]?.pts ?? [c]), ...inner];
  });
}

/** Bounding box in plane coordinates: [minX, minY, maxX, maxY]. */
export function bounds(p: P): [number, number, number, number] {
  if (p.kind === 'circle') return [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2];
  const pts = flattened(p);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Shifts that line the boxes up (left, centre, right, top, middle, bottom) or space them evenly (distribute: equal gaps). */
export function alignment(boxes: [number, number, number, number][], how: Align): [number, number][] {
  const [x0, y0, x1, y1] = [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...boxes.map((b) => b[k])));
  const axis = how === 'left' || how === 'centerX' || how === 'right' || how === 'distributeX' ? 0 : 1;
  const lo = (b: (typeof boxes)[number]) => b[axis];
  const hi = (b: (typeof boxes)[number]) => b[axis + 2];
  const shift = (d: number): [number, number] => (axis ? [0, d] : [d, 0]);
  if (how === 'distributeX' || how === 'distributeY') {
    const order = boxes.map((_, i) => i).sort((a, b) => lo(boxes[a]) - lo(boxes[b]));
    const gap = ((axis ? y1 - y0 : x1 - x0) - boxes.reduce((s, b) => s + hi(b) - lo(b), 0)) / (boxes.length - 1);
    const out: [number, number][] = boxes.map(() => [0, 0]);
    let at = axis ? y0 : x0;
    for (const i of order) {
      out[i] = shift(at - lo(boxes[i]));
      at += hi(boxes[i]) - lo(boxes[i]) + gap;
    }
    return out;
  }
  const [min, max] = axis ? [y0, y1] : [x0, x1];
  return boxes.map((b) => {
    if (how === 'left' || how === 'bottom') return shift(min - lo(b));
    if (how === 'right' || how === 'top') return shift(max - hi(b));
    return shift((min + max) / 2 - (lo(b) + hi(b)) / 2);
  });
}

export type Align = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY';

export function area(p: P): number {
  if (p.kind === 'line') return 0;
  if (p.kind === 'rect') return p.w * p.h;
  if (p.kind === 'circle') return (Math.PI * p.d * p.d) / 4;
  const pts = flattened(p);
  return Math.abs(pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)) / 2;
}

/** Rect and circle: their centre; polygon and line: the centre of their points (unchanged by turning). */
export function centre(p: P): [number, number] {
  if (p.kind !== 'polygon' && p.kind !== 'line') return [p.x, p.y];
  const n = p.pts.length;
  return [p.pts.reduce((s, q) => s + q[0], 0) / n, p.pts.reduce((s, q) => s + q[1], 0) / n];
}

export function inside(p: P, u: number, v: number): boolean {
  if (p.kind === 'line') return false; // open: nothing inside
  if (p.kind === 'circle') return Math.hypot(u - p.x, v - p.y) <= p.d / 2;
  const pts = flattened(p);
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/** Distance (mm) from plane point (u, v) to the outline (rounded corners counted sharp; a line stays open). */
export function edgeDistance(p: P, u: number, v: number): number {
  if (p.kind === 'circle') return Math.abs(Math.hypot(u - p.x, v - p.y) - p.d / 2);
  const pts = flattened(p);
  return Math.min(
    ...(p.kind === 'line' ? pts.slice(0, -1) : pts).map(([x0, y0], i) => {
      const [x1, y1] = pts[(i + 1) % pts.length];
      const [dx, dy] = [x1 - x0, y1 - y0];
      const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(u - x0 - t * dx, v - y0 - t * dy);
    }),
  );
}

/** How many larger profiles contain each profile's centre: even adds material, odd makes a hole. */
export function nesting(ps: P[]): number[] {
  return ps.map((p) => {
    const [u, v] = centre(p);
    const a = area(p);
    return ps.filter((q) => q !== p && area(q) > a && inside(q, u, v)).length;
  });
}

/**
 * The loop that open lines close (each its points, joined end to end either way round, ends within `tol` mm) with
 * line `start` in it: the lines' ids, the loop's corners, each once, and its sides' curves; null: they do not close.
 */
export function closedLoop(lines: { id: string; pts: UV[]; curves?: (Curve | null)[] }[], start: string, tol = 1e-3) {
  const same = (a: UV, b: UV) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
  const first = lines.find((l) => l.id === start);
  if (!first) return null;
  const sidesIn = (l: (typeof lines)[number]) => l.pts.slice(1).map((_, i) => l.curves?.[i] ?? null);
  const ids = [start];
  const pts = [...first.pts];
  const curves = sidesIn(first);
  // closed: back at the first point; straight sides need three corners, curves two
  while (!same(pts[0], pts.at(-1)!) || pts.length < (curves.some(Boolean) ? 3 : 4)) {
    const end = pts.at(-1)!;
    const next = lines.find((l) => !ids.includes(l.id) && (same(l.pts[0], end) || same(l.pts.at(-1)!, end)));
    if (!next) return null;
    ids.push(next.id);
    const on = same(next.pts[0], end);
    pts.push(...(on ? next.pts : [...next.pts].reverse()).slice(1));
    curves.push(...(on ? sidesIn(next) : sidesIn(next).reverse().map((c): Curve | null => (c && 'c1' in c ? { c1: c.c2, c2: c.c1 } : c))));
  }
  return { ids, pts: pts.slice(0, -1), ...(curves.some(Boolean) ? { curves } : {}) };
}

/** An open line moved `d` mm to its left, its corners mitred (as a parallel line at that distance). */
/** A closed outline grown by `d` mm (negative: shrunk), its corners mitred. */
export function grown(pts: [number, number][], d: number): [number, number][] {
  const n = pts.length;
  const ccw = pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * y, 0) > 0;
  // the outward normal of the side from a to b
  const out = (a: [number, number], b: [number, number]): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const s = ccw ? 1 : -1;
    return [(s * (b[1] - a[1])) / l, (s * (a[0] - b[0])) / l];
  };
  return pts.map((p, i) => {
    const [n0, n1] = [out(pts[(i - 1 + n) % n], p), out(p, pts[(i + 1) % n])];
    const m = [n0[0] + n1[0], n0[1] + n1[1]];
    const k = d / Math.max(0.2, (m[0] * n1[0] + m[1] * n1[1]) / (Math.hypot(...m) || 1)) / (Math.hypot(...m) || 1);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
}

/** A side as it lies after an offset; `on`: the circle or line it runs on, where it meets its neighbours. */
type Offset = { a: UV; b: UV; curve: Curve | null; on: { c: UV; r: number } | { o: UV; d: UV }; sweep?: number };

/**
 * A curved line or polygon `by` mm to the side (a polygon: outside; a line: its left). Arcs stay arcs around their
 * middle, straight sides stay straight, beziers go by their control legs (close, not exact). Where a corner opens or
 * crosses, neighbours meet where they cross; no crossing near it: half way between their ends.
 */
export function offsetPath(p: Pathed, by: number): { pts: UV[]; curves: (Curve | null)[] } {
  const n = p.pts.length;
  const closed = p.kind === 'polygon';
  const ring = flattened(p);
  const ccw = ring.reduce((t, [x, y], i) => t + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * y, 0) > 0;
  const left = closed && ccw ? -by : by;
  const hat = ([x, y]: UV): UV => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
  const off = (q: UV, d: UV): UV => [q[0] - hat(d)[1] * left, q[1] + hat(d)[0] * left];
  const cross = (o: UV, d: UV, q: UV, e: UV): UV | null => {
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((q[0] - o[0]) * e[1] - (q[1] - o[1]) * e[0]) / den;
    return [o[0] + d[0] * t, o[1] + d[1] * t];
  };
  const sides: Offset[] = Array.from({ length: closed ? n : n - 1 }, (_, i) => {
    const [a, b] = [p.pts[i], p.pts[(i + 1) % n]];
    const c = p.curves?.[i] ?? null;
    const [d0, d1] = sideDirs(a, c, b);
    const arc = c && 'mid' in c ? arcOf(a, c.mid, b) : null;
    if (arc) {
      const sweep = arc.a1 - arc.a0;
      const r = Math.max(0.01, sweep > 0 ? arc.r - left : arc.r + left);
      const at = (t: number): UV => [arc.c[0] + r * Math.cos(t), arc.c[1] + r * Math.sin(t)];
      return { a: at(arc.a0), b: at(arc.a1), curve: { mid: at(arc.a0 + sweep / 2) }, on: { c: arc.c, r }, sweep };
    }
    if (c && 'c1' in c) {
      const [a1, b1] = [off(a, d0), off(b, d1)];
      const leg: UV = [c.c2[0] - c.c1[0], c.c2[1] - c.c1[1]];
      const at = off(c.c1, leg);
      return { a: a1, b: b1, curve: { c1: cross(a1, d0, at, leg) ?? off(c.c1, d0), c2: cross(b1, d1, at, leg) ?? off(c.c2, d1) }, on: { o: b1, d: d1 } };
    }
    return { a: off(a, d0), b: off(b, d0), curve: null, on: { o: off(a, d0), d: d0 } };
  });
  /** Where two sides' circles or lines cross. */
  const crossings = (u: Offset['on'], v: Offset['on']): UV[] => {
    if ('o' in u && 'o' in v) return [cross(u.o, u.d, v.o, v.d)].filter((q): q is UV => !!q);
    if ('c' in u && 'c' in v) {
      const l = Math.hypot(v.c[0] - u.c[0], v.c[1] - u.c[1]);
      const x = (l * l + u.r * u.r - v.r * v.r) / (2 * l || 1);
      const h = u.r * u.r - x * x;
      if (!l || h < 0) return [];
      const e = hat([v.c[0] - u.c[0], v.c[1] - u.c[1]]);
      return [1, -1].map((k) => [u.c[0] + e[0] * x - k * e[1] * Math.sqrt(h), u.c[1] + e[1] * x + k * e[0] * Math.sqrt(h)]);
    }
    const [circle, line] = ('c' in u ? [u, v] : [v, u]) as [{ c: UV; r: number }, { o: UV; d: UV }];
    const e = hat(line.d);
    const t = (circle.c[0] - line.o[0]) * e[0] + (circle.c[1] - line.o[1]) * e[1];
    const near: UV = [line.o[0] + e[0] * t, line.o[1] + e[1] * t];
    const h = circle.r ** 2 - (near[0] - circle.c[0]) ** 2 - (near[1] - circle.c[1]) ** 2;
    if (h < 0) return [];
    return [1, -1].map((k) => [near[0] + k * e[0] * Math.sqrt(h), near[1] + k * e[1] * Math.sqrt(h)]);
  };
  const moved = (s: Offset, end: 'a' | 'b', q: UV) => {
    const by2: UV = [q[0] - s[end][0], q[1] - s[end][1]];
    s[end] = q;
    if (s.curve && 'c1' in s.curve) {
      const k = end === 'a' ? 'c1' : 'c2';
      s.curve = { ...s.curve, [k]: [s.curve[k][0] + by2[0], s.curve[k][1] + by2[1]] };
    }
  };
  sides.forEach((next, i) => {
    if (!i && !closed) return;
    const prev = sides[(i - 1 + sides.length) % sides.length];
    if (Math.hypot(prev.b[0] - next.a[0], prev.b[1] - next.a[1]) < 1e-6) return;
    const half: UV = [(prev.b[0] + next.a[0]) / 2, (prev.b[1] + next.a[1]) / 2];
    const far = 5 * Math.abs(by);
    const q = crossings(prev.on, next.on)
      .sort((u, v) => Math.hypot(u[0] - half[0], u[1] - half[1]) - Math.hypot(v[0] - half[0], v[1] - half[1]))
      .find((u) => Math.hypot(u[0] - p.pts[i][0], u[1] - p.pts[i][1]) <= far) ?? half;
    moved(prev, 'b', q);
    moved(next, 'a', q);
  });
  // arcs cut or lengthened at their ends: their middle again
  for (const s of sides)
    if (s.sweep !== undefined && 'c' in s.on) {
      const { c, r } = s.on;
      const dir = Math.sign(s.sweep);
      const [t0, t1] = [s.a, s.b].map((q) => Math.atan2(q[1] - c[1], q[0] - c[0]));
      const full = 2 * Math.PI;
      const sweep = dir * ((((t1 - t0) * dir) % full + full) % full);
      s.curve = { mid: [c[0] + r * Math.cos(t0 + sweep / 2), c[1] + r * Math.sin(t0 + sweep / 2)] };
    }
  return { pts: closed ? sides.map((s) => s.a) : [...sides.map((s) => s.a), sides[sides.length - 1].b], curves: sides.map((s) => s.curve) };
}

export function beside(pts: [number, number][], d: number): [number, number][] {
  if (!d) return pts;
  const left = (a: [number, number], b: [number, number]): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(a[1] - b[1]) / l, (b[0] - a[0]) / l];
  };
  return pts.map((p, i) => {
    const [n0, n1] = [left(pts[Math.max(0, i - 1)], pts[Math.max(1, i)]), left(pts[Math.min(i, pts.length - 2)], pts[Math.min(i + 1, pts.length - 1)])];
    const m = [n0[0] + n1[0], n0[1] + n1[1]];
    const k = d / Math.max(0.2, (m[0] * n1[0] + m[1] * n1[1]) / (Math.hypot(...m) || 1)) / (Math.hypot(...m) || 1);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
}
