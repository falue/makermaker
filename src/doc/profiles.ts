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

/** Polynomials in powers of t (lowest first): product and difference. */
export const polyMul = (p: number[], q: number[]) => p.flatMap((x, i) => q.map((y, j) => [i + j, x * y] as const)).reduce((out, [k, v]) => ((out[k] = (out[k] ?? 0) + v), out), [] as number[]);
/** A cubic bezier per axis in powers of t (lowest first), and its direction's. */
export function bezierPoly(a: UV, c1: UV, c2: UV, b: UV): [number[][], number[][]] {
  const pos = [0, 1].map((k) => [a[k], 3 * (c1[k] - a[k]), 3 * (c2[k] - 2 * c1[k] + a[k]), b[k] - 3 * c2[k] + 3 * c1[k] - a[k]]);
  return [pos, pos.map((p) => [p[1], 2 * p[2], 3 * p[3]])];
}

export const polySub = (p: number[], q: number[]) => Array.from({ length: Math.max(p.length, q.length) }, (_, i) => (p[i] ?? 0) - (q[i] ?? 0));

/**
 * The roots of polynomial `p` (powers of t, lowest first) on `lo`..`hi`, all of them: between its derivative's roots it
 * runs one way, so each stretch holds at most one (bisected); a root it only touches is one of the derivative's.
 */
export function polyRoots(p: number[], lo = 0, hi = 1): number[] {
  while (p.length > 1 && Math.abs(p[p.length - 1]) < 1e-14 * Math.max(...p.map(Math.abs))) p = p.slice(0, -1);
  const f = (t: number) => p.reduceRight((s, c) => s * t + c, 0);
  if (p.length < 2) return [];
  if (p.length === 2) return [-p[0] / p[1]].filter((t) => t >= lo && t <= hi);
  const scale = Math.max(...p.map(Math.abs));
  const turns = polyRoots(p.slice(1).map((c, i) => c * (i + 1)), lo, hi);
  const marks = [lo, ...turns, hi];
  const out: number[] = turns.filter((t) => Math.abs(f(t)) < 1e-12 * scale);
  for (let i = 0; i + 1 < marks.length; i++) {
    let [a, b] = [marks[i], marks[i + 1]];
    if (f(a) * f(b) > 0 || out.some((t) => t === a || t === b)) continue;
    for (let k = 0; k < 60 && b - a > 1e-15; k++) {
      const m = (a + b) / 2;
      if (f(a) * f(m) <= 0) b = m;
      else a = m;
    }
    out.push((a + b) / 2);
  }
  return [...new Set(out)].sort((x, y) => x - y);
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
  return bez(a, c.c1, c.c2, b, bezierT(a, c.c1, c.c2, b, q));
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
    const before: Seg = { a: q.pts[(i - 1 + n) % n], b: c, c: q.curves?.[(i - 1 + n) % n] };
    const after: Seg = { a: c, b: q.pts[(i + 1) % n], c: q.curves?.[i] };
    const [, din] = sideDirs(before.a, before.c, c);
    const [dout] = sideDirs(c, after.c, after.b);
    const [u, v] = [unit(din), unit(dout)];
    const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    if (turn < 1e-6) return null;
    const curved = !!before.c || !!after.c;
    // a chamfer: straight across, its length along each side (along a curve too, as the kernel measures it)
    if (r < 0) return { t: -r, pts: curved ? [pointAlong(before, segLength(before) + r), pointAlong(after, -r)] : [[c[0] + u[0] * r, c[1] + u[1] * r], [c[0] - v[0] * r, c[1] - v[1] * r]] };
    const bis = unit([v[0] - u[0], v[1] - u[1]]);
    let o: UV = [c[0] + (bis[0] * r) / Math.cos(turn / 2), c[1] + (bis[1] * r) / Math.cos(turn / 2)];
    const t = r * Math.tan(turn / 2);
    let ends: UV[] = [[c[0] - u[0] * t, c[1] - u[1] * t], [c[0] + v[0] * t, c[1] + v[1] * t]];
    // beside a curve: the circle r from both true sides, as the kernel's fillet (Newton from the one along the tangents)
    if (curved)
      for (let k = 0; k < 40; k++) {
        ends = [before, after].map((g) => nearestOn(g, o));
        const [n1, n2] = ends.map((e) => unit([o[0] - e[0], o[1] - e[1]]));
        const [f1, f2] = ends.map((e) => Math.hypot(o[0] - e[0], o[1] - e[1]) - r);
        const det = n1[0] * n2[1] - n1[1] * n2[0];
        if (Math.abs(det) < 1e-12) break;
        const step: UV = [(-f1 * n2[1] + f2 * n1[1]) / det, (-n1[0] * f2 + n2[0] * f1) / det];
        o = [o[0] + step[0], o[1] + step[1]];
        if (Math.hypot(...step) < 1e-13 * (1 + r)) {
          ends = [before, after].map((g) => nearestOn(g, o));
          break;
        }
      }
    const [a0, a1] = ends.map(([x, y]) => Math.atan2(y - o[1], x - o[0]));
    const d = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; // the short way round
    const pts = Array.from({ length: steps + 1 }, (_, k): UV => (k === 0 ? ends[0] : k === steps ? ends[1] : [o[0] + r * Math.cos(a0 + (d * k) / steps), o[1] + r * Math.sin(a0 + (d * k) / steps)]));
    return { t: curved ? Math.max(...ends.map((e) => Math.hypot(e[0] - c[0], e[1] - c[1]))) : t, centre: o, pts };
  });
}

/** The point of a side nearest `q`. */
function nearestOn({ a, b, c }: Seg, q: UV): UV {
  if (c) return nearestOnSide(a, c, b, q);
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** A side of an outline, exact: straight, an arc through `mid`, or a cubic bezier. */
export type Seg = { a: UV; b: UV; c?: Curve | null };

const bez = (a: UV, c1: UV, c2: UV, b: UV, t: number): UV => [0, 1].map((k) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t ** 2 * c2[k] + t ** 3 * b[k]) as UV;

/** The bezier's parameter nearest `q`: of its ends and where (B − q) · B′ = 0 (a quintic), the nearest. */
function bezierT(a: UV, c1: UV, c2: UV, b: UV, q: UV): number {
  const [pos, vel] = bezierPoly(a, c1, c2, b);
  const off = pos.map((p, k) => [p[0] - q[k], ...p.slice(1)]);
  const far = (t: number) => Math.hypot(bez(a, c1, c2, b, t)[0] - q[0], bez(a, c1, c2, b, t)[1] - q[1]);
  return [0, 1, ...polyRoots(polySub(polyMul(off[0], vel[0]), polyMul(off[1].map((x) => -x), vel[1])))].reduce((best, t) => (far(t) < far(best) ? t : best));
}

/** The part of a side between its points nearest `from` and `to`, running from exactly `from` to `to`. */
function trimmed(a: UV, c: Curve, b: UV, from: UV, to: UV): Seg {
  if ('mid' in c) {
    const arc = arcOf(a, c.mid, b);
    if (!arc) return { a: from, b: to };
    // the middle between the two points, along the arc
    const dir = Math.sign(arc.a1 - arc.a0) || 1;
    const along = (q: UV) => arc.a0 + dir * ((((Math.atan2(q[1] - arc.c[1], q[0] - arc.c[0]) - arc.a0) * dir) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const m = (along(from) + along(to)) / 2;
    return { a: from, b: to, c: { mid: [arc.c[0] + arc.r * Math.cos(m), arc.c[1] + arc.r * Math.sin(m)] } };
  }
  const [t0, t1] = [bezierT(a, c.c1, c.c2, b, from), bezierT(a, c.c1, c.c2, b, to)];
  // de Casteljau: the handles of the piece from t0 to t1 are the derivative's, scaled to its length
  const d = (t: number): UV => [0, 1].map((k) => 3 * ((1 - t) ** 2 * (c.c1[k] - a[k]) + 2 * (1 - t) * t * (c.c2[k] - c.c1[k]) + t ** 2 * (b[k] - c.c2[k]))) as UV;
  const h = (t1 - t0) / 3;
  return { a: from, b: to, c: { c1: [from[0] + d(t0)[0] * h, from[1] + d(t0)[1] * h], c2: [to[0] - d(t1)[0] * h, to[1] - d(t1)[1] * h] } };
}

/**
 * The outline as exact sides, turned: straight, true arcs, beziers, each corner's rounding (an arc) or chamfer in
 * its place (`cornerCuts`; beside a curved side cut where that puts it); a circle as two half arcs; a line open.
 */
export function segments(p: P): Seg[] {
  const known = SEGMENTS.get(p);
  if (known) return known;
  const out = sidesNow(p);
  SEGMENTS.set(p, out);
  return out;
}

/** `segments` by shape: shapes are never changed in place, so each is worked out once (hover asks many times a frame). */
const SEGMENTS = new WeakMap<P, Seg[]>();

function sidesNow(p: P): Seg[] {
  if (p.kind === 'circle') {
    const r = p.d / 2;
    const [e, n, w, s]: UV[] = [[p.x + r, p.y], [p.x, p.y + r], [p.x - r, p.y], [p.x, p.y - r]];
    return [{ a: e, b: w, c: { mid: n } }, { a: w, b: e, c: { mid: s } }];
  }
  const q = p.kind === 'line' ? p : (roundable(p) ?? { pts: corners(p) });
  const cuts = p.kind === 'line' ? [] : cornerCuts(p);
  const n = p.kind === 'line' ? q.pts.length - 1 : q.pts.length;
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [q.pts[i], q.pts[(i + 1) % q.pts.length]];
    const [from, to] = [cuts[i]?.pts.at(-1) ?? a, cuts[(i + 1) % q.pts.length]?.pts[0] ?? b];
    const c = q.curves?.[i];
    const cut = cuts[i];
    if (cut) out.push(cut.centre ? { a: cut.pts[0], b: from, c: { mid: cut.pts[Math.floor(cut.pts.length / 2)] } } : { a: cut.pts[0], b: from });
    out.push(c && (from !== a || to !== b) ? trimmed(a, c, b, from, to) : { a: from, b: to, c });
  }
  return out;
}

/** The point of the outline (`segments`) nearest `q`, and how far it is. */
export function nearestOnOutline(p: P, q: UV): { at: UV; d: number } {
  let best = { at: q, d: Infinity };
  for (const g of segments(p)) {
    const at = nearestOn(g, q);
    const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
    if (d < best.d) best = { at, d };
  }
  return best;
}

/** A side as points, both ends in, at most `tol` mm off it. */
export function segPoints({ a, b, c }: Seg, tol = 1e-3): UV[] {
  if (!c) return [a, b];
  if ('mid' in c) {
    const arc = arcOf(a, c.mid, b);
    if (!arc) return [a, b];
    const steps = Math.max(2, Math.ceil(Math.abs(arc.a1 - arc.a0) / (2 * Math.acos(Math.max(0, 1 - tol / arc.r)))));
    return sidePoints(a, c, b, steps);
  }
  // halved until its handles lie within `tol` of its chord
  const flat = (a: UV, c1: UV, c2: UV, b: UV): UV[] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const off = (q: UV) => Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / l;
    if (Math.max(off(c1), off(c2)) <= tol) return [a, b];
    const m = (x: UV, y: UV): UV => [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2];
    const [ab, bc, cd] = [m(a, c1), m(c1, c2), m(c2, b)];
    const [abc, bcd] = [m(ab, bc), m(bc, cd)];
    const mid = m(abc, bcd);
    return [...flat(a, ab, abc, mid).slice(0, -1), ...flat(mid, bcd, cd, b)];
  };
  return flat(a, c.c1, c.c2, b);
}

/** A side's length: exact for lines and arcs, a bezier's by Gauss–Legendre (see `bezierLength`). */
export function segLength({ a, b, c }: Seg): number {
  if (!c) return Math.hypot(b[0] - a[0], b[1] - a[1]);
  if ('mid' in c) {
    const arc = arcOf(a, c.mid, b);
    return arc ? arc.r * Math.abs(arc.a1 - arc.a0) : Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return bezierLength(a, c.c1, c.c2, b, 1);
}

/** A bezier's speed (length per parameter) at `t`. */
const bezierSpeed = (a: UV, c1: UV, c2: UV, b: UV, t: number) => Math.hypot(...([0, 1].map((k) => 3 * ((1 - t) ** 2 * (c1[k] - a[k]) + 2 * (1 - t) * t * (c2[k] - c1[k]) + t ** 2 * (b[k] - c2[k]))) as UV));

/** A bezier's length from its start to parameter `t`: 16-point Gauss–Legendre on 8 pieces. */
function bezierLength(a: UV, c1: UV, c2: UV, b: UV, t: number): number {
  let sum = 0;
  for (let piece = 0; piece < 8; piece++) for (const [x, w] of GAUSS) sum += (w * bezierSpeed(a, c1, c2, b, (t * (piece + (x + 1) / 2)) / 8)) / 16;
  return sum * t;
}

/** The point `s` mm along a side from its start (clamped to its ends). */
export function pointAlong(g: Seg, s: number): UV {
  const { a, b, c } = g;
  const f = Math.max(0, Math.min(1, s / (segLength(g) || 1)));
  if (c && 'mid' in c) {
    const arc = arcOf(a, c.mid, b);
    if (arc) {
      const t = arc.a0 + (arc.a1 - arc.a0) * f;
      return [arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)];
    }
  }
  if (!c || 'mid' in c) return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  // Newton on the length from the start
  const goal = f * segLength(g);
  let t = f;
  for (let k = 0; k < 8; k++) t = Math.max(0, Math.min(1, t - (bezierLength(a, c.c1, c.c2, b, t) - goal) / (bezierSpeed(a, c.c1, c.c2, b, t) || 1)));
  return bez(a, c.c1, c.c2, b, t);
}

/** Where two sides cross (lines and arcs exactly; null: a bezier takes part, ask the caller to find it). */
export function segCrossings(g: Seg, h: Seg): UV[] | null {
  if ((g.c && 'c1' in g.c) || (h.c && 'c1' in h.c)) return null;
  type Circ = { c: UV; r: number; a0: number; a1: number };
  const circ = (s: Seg): Circ | null => (s.c && 'mid' in s.c ? arcOf(s.a, s.c.mid, s.b) : null);
  const onArc = (k: Circ, q: UV) => {
    const d = Math.sign(k.a1 - k.a0) || 1;
    const t = ((((Math.atan2(q[1] - k.c[1], q[0] - k.c[0]) - k.a0) * d) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return t <= Math.abs(k.a1 - k.a0) + 1e-9 || t >= 2 * Math.PI - 1e-9;
  };
  const onLine = (s: Seg, q: UV) => {
    const [dx, dy] = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const t = ((q[0] - s.a[0]) * dx + (q[1] - s.a[1]) * dy) / (dx * dx + dy * dy || 1);
    return t >= -1e-9 && t <= 1 + 1e-9;
  };
  const [cg, ch] = [circ(g), circ(h)];
  // on both, each once (touching: one point)
  const on = (q: UV, i: number, all: UV[]) => (cg ? onArc(cg, q) : onLine(g, q)) && (ch ? onArc(ch, q) : onLine(h, q)) && !all.slice(0, i).some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9);
  if (!cg && !ch) {
    const [r, t] = [[g.b[0] - g.a[0], g.b[1] - g.a[1]], [h.b[0] - h.a[0], h.b[1] - h.a[1]]];
    const den = r[0] * t[1] - r[1] * t[0];
    if (Math.abs(den) < 1e-12) return [];
    const k = ((h.a[0] - g.a[0]) * t[1] - (h.a[1] - g.a[1]) * t[0]) / den;
    return [[g.a[0] + k * r[0], g.a[1] + k * r[1]] as UV].filter(on);
  }
  if (cg && ch) {
    const [dx, dy] = [ch.c[0] - cg.c[0], ch.c[1] - cg.c[1]];
    const d = Math.hypot(dx, dy);
    if (d < 1e-12 || d > cg.r + ch.r + 1e-9 || d < Math.abs(cg.r - ch.r) - 1e-9) return [];
    const x = (d * d + cg.r * cg.r - ch.r * ch.r) / (2 * d);
    // touching (within rounding, which the root would blow up to about 1e-6): one point
    const touch = Math.abs(d - cg.r - ch.r) < 1e-12 * (cg.r + ch.r) || Math.abs(d - Math.abs(cg.r - ch.r)) < 1e-12 * (cg.r + ch.r);
    const y = touch ? 0 : Math.sqrt(Math.max(0, cg.r * cg.r - x * x));
    const m: UV = [cg.c[0] + (x * dx) / d, cg.c[1] + (x * dy) / d];
    return ([[m[0] - (y * dy) / d, m[1] + (y * dx) / d], [m[0] + (y * dy) / d, m[1] - (y * dx) / d]] as UV[]).filter(on);
  }
  // a line and a circle
  const [k, l] = cg ? [cg, h] : [ch!, g];
  const [dx, dy] = [l.b[0] - l.a[0], l.b[1] - l.a[1]];
  const [fx, fy] = [l.a[0] - k.c[0], l.a[1] - k.c[1]];
  const [qa, qb, qc] = [dx * dx + dy * dy, 2 * (fx * dx + fy * dy), fx * fx + fy * fy - k.r * k.r];
  // touching (the line's distance from the middle the radius, within rounding): one point
  const away = Math.abs(fx * dy - fy * dx) / Math.sqrt(qa);
  const disc = Math.abs(away - k.r) < 1e-12 * k.r ? 0 : qb * qb - 4 * qa * qc;
  if (disc < 0 || qa < 1e-24) return [];
  return [-1, 1].map((sg): UV => {
    const t = (-qb + sg * Math.sqrt(disc)) / (2 * qa);
    return [l.a[0] + t * dx, l.a[1] + t * dy];
  }).filter(on);
}

const GAUSS = [0.0950125098, 0.2816035508, 0.4580167777, 0.6178762444, 0.7554044084, 0.8656312024, 0.9445750231, 0.9894009350]
  .map((x, i) => [x, [0.1894506105, 0.1826034150, 0.1691565194, 0.1495959888, 0.1246289713, 0.0951585117, 0.0622535239, 0.0271524594][i]])
  .flatMap(([x, w]) => [[x, w], [-x, w]]);

/**
 * A curve (`at`, `dir`: point and direction at t, 0..1) as arcs within `tol` mm: a biarc per piece (two arcs meeting
 * tangent, tangent to the curve at both ends), pieces halved until it fits. The points from start to end and each
 * side's arc (null: straight).
 */
export function biarcs(at: (t: number) => UV, dir: (t: number) => UV, tol = 1e-3, depth = 14): { pts: UV[]; curves: ({ mid: UV } | null)[] } {
  const unit = ([x, y]: UV): UV => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
  const dot = (u: UV, v: UV) => u[0] * v[0] + u[1] * v[1];
  /** The arc from `a` leaving along unit `t` to `b`: its middle (null: straight). */
  const arcTo = (a: UV, t: UV, b: UV): { mid: UV } | null => {
    const c: UV = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(...c);
    const turn = Math.atan2(t[0] * c[1] - t[1] * c[0], dot(t, c)); // from the tangent to the chord: half the arc's sweep
    if (l < 1e-12 || Math.abs(turn) < 1e-9) return null;
    const h = (Math.tan(turn / 2) * l) / 2; // the arc's height over its chord's middle
    return { mid: [(a[0] + b[0]) / 2 + (c[1] / l) * h, (a[1] + b[1]) / 2 - (c[0] / l) * h] };
  };
  const piece = (t0: number, t1: number, left: number): { pts: UV[]; curves: ({ mid: UV } | null)[] } => {
    const [p0, p1, d0, d1] = [at(t0), at(t1), unit(dir(t0)), unit(dir(t1))];
    const v: UV = [p1[0] - p0[0], p1[1] - p0[1]];
    const s: UV = [d0[0] + d1[0], d0[1] + d1[1]];
    // the joint: both arms d long (|v − d s| = 2d)
    const a = 2 * (1 - dot(d0, d1));
    const d = a < 1e-12 ? dot(v, v) / (2 * dot(v, s) || 1) : (-dot(v, s) + Math.sqrt(dot(v, s) ** 2 + a * dot(v, v))) / a;
    const j: UV = [(p0[0] + d * d0[0] + p1[0] - d * d1[0]) / 2, (p0[1] + d * d0[1] + p1[1] - d * d1[1]) / 2];
    const jd = unit([p1[0] - d * d1[0] - p0[0] - d * d0[0], p1[1] - d * d1[1] - p0[1] - d * d0[1]]);
    const out = { pts: [p0, j, p1], curves: [arcTo(p0, d0, j), arcTo(j, jd, p1)] };
    // how far the curve strays from them (to the nearest point of either arc, its ends included)
    const off = (q: UV, k: number) => {
      const [x, y, c] = [out.pts[k], out.pts[k + 1], out.curves[k]];
      if (c) {
        const n = nearestOnSide(x, c, y, q);
        return Math.hypot(q[0] - n[0], q[1] - n[1]);
      }
      const l2 = (y[0] - x[0]) ** 2 + (y[1] - x[1]) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - x[0]) * (y[0] - x[0]) + (q[1] - x[1]) * (y[1] - x[1])) / l2));
      return Math.hypot(q[0] - x[0] - t * (y[0] - x[0]), q[1] - x[1] - t * (y[1] - x[1]));
    };
    const fits = Number.isFinite(d) && d > 0 && Array.from({ length: 31 }, (_, i) => at(t0 + ((t1 - t0) * (i + 1)) / 32)).every((q) => Math.min(off(q, 0), off(q, 1)) <= tol);
    if (fits || !left) return out;
    const m = (t0 + t1) / 2;
    const [x, y] = [piece(t0, m, left - 1), piece(m, t1, left - 1)];
    return { pts: [...x.pts, ...y.pts.slice(1)], curves: [...x.curves, ...y.curves] };
  };
  return piece(0, 1, depth);
}

/** Length of a line's or outline's sides. */
export const outlineLength = (p: P) => segments(p).reduce((s, g) => s + segLength(g), 0);

/** Bounding box in plane coordinates: [minX, minY, maxX, maxY]. */
export function bounds(p: P): [number, number, number, number] {
  if (p.kind === 'circle') return [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2];
  const known = BOUNDS.get(p);
  if (known) return known;
  const pts = segments(p).flatMap((g) => {
    if (!g.c) return [g.a, g.b];
    if ('c1' in g.c) {
      const { c1, c2 } = g.c;
      // where the bezier turns along x or y: roots of its derivative
      const ts = [0, 1].flatMap((k) => {
        const [qa, qb, qc] = [g.b[k] - 3 * c2[k] + 3 * c1[k] - g.a[k], 2 * (c2[k] - c1[k]) - 2 * (c1[k] - g.a[k]), c1[k] - g.a[k]];
        if (Math.abs(qa) < 1e-12) return Math.abs(qb) < 1e-12 ? [] : [-qc / qb];
        const disc = qb * qb - 4 * qa * qc;
        return disc < 0 ? [] : [(-qb + Math.sqrt(disc)) / (2 * qa), (-qb - Math.sqrt(disc)) / (2 * qa)];
      });
      return [g.a, g.b, ...ts.filter((t) => t > 0 && t < 1).map((t) => bez(g.a, c1, c2, g.b, t))];
    }
    const arc = arcOf(g.a, g.c.mid, g.b);
    if (!arc) return [g.a, g.b];
    // the arc's ends, and the quarter points it passes
    const [lo, hi] = [Math.min(arc.a0, arc.a1), Math.max(arc.a0, arc.a1)];
    const quarters: UV[] = [];
    for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) quarters.push([arc.c[0] + arc.r * Math.cos((k * Math.PI) / 2), arc.c[1] + arc.r * Math.sin((k * Math.PI) / 2)]);
    return [g.a, g.b, ...quarters];
  });
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const out: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  BOUNDS.set(p, out);
  return out;
}

/** `bounds` by shape (see `SEGMENTS`). */
const BOUNDS = new WeakMap<P, [number, number, number, number]>();

/** Whether plane point (u, v) lies within `reach` of the shape's box (nothing farther can be near or inside it). */
export const nearBox = (p: P, u: number, v: number, reach: number) => {
  const [x0, y0, x1, y1] = bounds(p);
  return u >= x0 - reach && u <= x1 + reach && v >= y0 - reach && v <= y1 + reach;
};

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

/** Enclosed area, exact: lines, arcs and beziers by Green's theorem; corner roundings and chamfers taken off. */
export function area(p: P): number {
  if (p.kind === 'line') return 0;
  if (p.kind === 'circle') return (Math.PI * p.d * p.d) / 4;
  const x = (u: UV, v: UV) => u[0] * v[1] - u[1] * v[0];
  return Math.abs(segments(p).reduce((s, { a, b, c }) => {
    if (!c) return s + x(a, b) / 2;
    if ('c1' in c) return s + (6 * x(a, c.c1) + 3 * x(a, c.c2) + x(a, b) + 3 * x(c.c1, c.c2) + 3 * x(c.c1, b) + 6 * x(c.c2, b)) / 20;
    const arc = arcOf(a, c.mid, b);
    const t = arc ? arc.a1 - arc.a0 : 0;
    return s + x(a, b) / 2 + (arc ? (arc.r * arc.r * (t - Math.sin(t))) / 2 : 0);
  }, 0));
}

/** Rect and circle: their centre; polygon and line: the centre of their points (unchanged by turning). */
export function centre(p: P): [number, number] {
  if (p.kind !== 'polygon' && p.kind !== 'line') return [p.x, p.y];
  const n = p.pts.length;
  return [p.pts.reduce((s, q) => s + q[0], 0) / n, p.pts.reduce((s, q) => s + q[1], 0) / n];
}

/** Whether plane point (u, v) lies inside the outline (`segments`; a line is open: never). */
export function inside(p: P, u: number, v: number): boolean {
  if (p.kind === 'line') return false;
  if (p.kind === 'circle') return Math.hypot(u - p.x, v - p.y) <= p.d / 2;
  const segs = segments(p);
  // the polygon of the sides' ends, then each curved side's area between its chord and itself toggles
  let odd = crosses(segs.map((g) => g.a), u, v);
  for (const { a, b, c } of segs) {
    if (!c) continue;
    if ('mid' in c) {
      const arc = arcOf(a, c.mid, b);
      const side = (q: UV) => Math.sign((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]));
      if (arc && Math.hypot(u - arc.c[0], v - arc.c[1]) < arc.r && side([u, v]) === side(c.mid)) odd = !odd;
    } else if ((bezierCrossings(a, c.c1, c.c2, b, u, v) + +crossesSide(b, a, u, v)) % 2) odd = !odd; // inside the loop of it and its chord
  }
  return odd;
}

/** How often a ray from (u, v) along +x crosses the bezier (roots of y(t) = v, where it passes through, not touches). */
function bezierCrossings(a: UV, c1: UV, c2: UV, b: UV, u: number, v: number): number {
  const [[x, y], [, dy]] = bezierPoly(a, c1, c2, b);
  const at = (p: number[], t: number) => p.reduceRight((s, k) => s * t + k, 0);
  return polyRoots([y[0] - v, ...y.slice(1)]).filter((t) => t > 0 && t < 1 && at(x, t) > u && Math.abs(at(dy, t)) > 1e-12).length;
}

/** Whether a ray from (u, v) along +x crosses the segment (the even-odd rule's half-open test). */
const crossesSide = ([xi, yi]: UV, [xj, yj]: UV, u: number, v: number) => yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi;

/** Even-odd test of a closed polygon. */
function crosses(pts: UV[], u: number, v: number): boolean {
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if (crossesSide(pts[i], pts[j], u, v)) odd = !odd;
  return odd;
}

/** Distance (mm) from plane point (u, v) to the outline, exact (`segments`; a line stays open). */
export function edgeDistance(p: P, u: number, v: number): number {
  if (p.kind === 'circle') return Math.abs(Math.hypot(u - p.x, v - p.y) - p.d / 2);
  return nearestOnOutline(p, [u, v]).d;
}

/** How many larger profiles contain each profile (tested at the middle of its longest side): even adds material, odd makes a hole. */
export function nesting(ps: P[]): number[] {
  return ps.map((p) => {
    const g = segments(p).reduce((l, g) => (segLength(g) > segLength(l) ? g : l));
    const pts = segPoints(g, 1e-3);
    const [u, v] = g.c ? pts[Math.floor(pts.length / 2)] : [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
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

/** Corners offset exactly (sides meeting where they cross) down to about 1° (cos of half the turn); sharper ones reach only that far. */
const MITER = 0.01;

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
    const k = d / Math.max(MITER, (m[0] * n1[0] + m[1] * n1[1]) / (Math.hypot(...m) || 1)) / (Math.hypot(...m) || 1);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
}

/**
 * A side after an offset: its exact offset curve `f` (t 0..1 the side, beyond it run on: a line straight, an arc round, a
 * bezier's along its end's tangent), the part kept (`t0`..`t1`, set where neighbours meet; `from`, `to`: before any
 * meet), what it is; `cuts`: loops taken out of a bezier's offset (from, to); `gone`: turned inside out, left out.
 */
type Offset = { kind: 'line' | 'arc' | 'bezier'; f: (t: number) => UV; t0: number; t1: number; from: number; to: number; at: number; base?: { a: UV; c1: UV; c2: UV; b: UV }; cuts?: [number, number][]; toA?: UV; toB?: UV; gone?: boolean };

/**
 * A curved line or polygon `by` mm to the side (a polygon: outside; a line: its left), exact: straight sides stay
 * straight, arcs stay arcs around their middle, beziers become beziers within `tol` mm of their true offset
 * (`offsetBezier`). Neighbours meet where their offsets (run on past their ends) cross: a mitre where the corner opens,
 * the true crossing where it closes; none near: straight on to half way between their ends (`toA`, `toB`). What the
 * offset turns inside out goes: an arc past its radius, a side its neighbours' crossing runs back over, a bezier's loop
 * where it bends tighter than the offset (cut out where the offset crosses itself; all of it: the side); its
 * neighbours then meet each other.
 */
export function offsetPath(p: Pathed, by: number, tol = 1e-3): { pts: UV[]; curves: (Curve | null)[] } {
  const n = p.pts.length;
  const closed = p.kind === 'polygon';
  const ring = flattened(p);
  const ccw = ring.reduce((t, [x, y], i) => t + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * y, 0) > 0;
  const left = closed && ccw ? -by : by;
  const hat = ([x, y]: UV): UV => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
  const off = (q: UV, d: UV): UV => [q[0] - hat(d)[1] * left, q[1] + hat(d)[0] * left];
  const sides: Offset[] = Array.from({ length: closed ? n : n - 1 }, (_, i): Offset => {
    const [a, b] = [p.pts[i], p.pts[(i + 1) % n]];
    const c = p.curves?.[i] ?? null;
    const arc = c && 'mid' in c ? arcOf(a, c.mid, b) : null;
    if (arc) {
      const sweep = arc.a1 - arc.a0;
      const r = sweep > 0 ? arc.r - left : arc.r + left;
      return { kind: 'arc', f: (t) => [arc.c[0] + r * Math.cos(arc.a0 + sweep * t), arc.c[1] + r * Math.sin(arc.a0 + sweep * t)], t0: 0, t1: 1, from: 0, to: 1, at: i, gone: r <= 1e-9 };
    }
    if (c && 'c1' in c) {
      const base = { a, c1: c.c1, c2: c.c2, b };
      const on = (t: number) => off(bez(a, c.c1, c.c2, b, t), bezDir(base, t));
      // past its ends: on along its end's tangent
      const f = (t: number): UV => {
        if (t >= 0 && t <= 1) return on(t);
        const [e, d] = t < 0 ? [on(0), hat(bezDir(base, 0))] : [on(1), hat(bezDir(base, 1))];
        const k = (t < 0 ? t : t - 1) * Math.hypot(...bezDir(base, t < 0 ? 0 : 1));
        return [e[0] + d[0] * k, e[1] + d[1] * k];
      };
      return { kind: 'bezier', f, t0: 0, t1: 1, from: 0, to: 1, at: i, base, ...loopsOf(base, f, left) };
    }
    const d: UV = [b[0] - a[0], b[1] - a[1]];
    const [oa, ob] = [off(a, d), off(b, d)];
    return { kind: 'line', f: (t) => [oa[0] + (ob[0] - oa[0]) * t, oa[1] + (ob[1] - oa[1]) * t], t0: 0, t1: 1, from: 0, to: 1, at: i };
  });
  /** Where `u` (past its end) and `v` (before its start) cross nearest their ends, as their parameters (Newton); null: not near. */
  const meet = (u: Offset, v: Offset): [number, number] | null => {
    let [s, t] = [u.to, v.from];
    const h = 1e-6;
    for (let k = 0; k < 60; k++) {
      const [pu, pv] = [u.f(s), v.f(t)];
      const r: UV = [pu[0] - pv[0], pu[1] - pv[1]];
      if (Math.hypot(...r) < 1e-12 * (1 + Math.abs(by))) return [s, t];
      const du: UV = [(u.f(s + h)[0] - u.f(s - h)[0]) / (2 * h), (u.f(s + h)[1] - u.f(s - h)[1]) / (2 * h)];
      const dv: UV = [(v.f(t + h)[0] - v.f(t - h)[0]) / (2 * h), (v.f(t + h)[1] - v.f(t - h)[1]) / (2 * h)];
      const det = -du[0] * dv[1] + du[1] * dv[0];
      if (Math.abs(det) < 1e-14) return null;
      // [du, -dv] [ds, dt] = -r
      s += (-(-r[0]) * dv[1] + -r[1] * dv[0]) / det;
      t += (du[0] * -r[1] - du[1] * -r[0]) / det;
      if (!Number.isFinite(s + t)) return null;
    }
    return null;
  };
  // neighbours meet; a side they run back over goes, and its neighbours meet again, until none goes
  for (let pass = 0; pass <= sides.length; pass++) {
    const live = sides.filter((x) => !x.gone);
    for (const x of live) Object.assign(x, { t0: x.from, t1: x.to, toA: undefined, toB: undefined });
    live.forEach((next, k) => {
      if (!k && !closed) return;
      const prev = live[(k - 1 + live.length) % live.length];
      const [pe, ns] = [prev.f(prev.to), next.f(next.from)];
      if (Math.hypot(pe[0] - ns[0], pe[1] - ns[1]) < 1e-9) return; // smooth: they run on
      const found = meet(prev, next);
      const q = found && prev.f(found[0]);
      // near the corners between them (a side gone between: either end of it)
      const corners = [p.pts[(prev.at + 1) % n], p.pts[next.at]];
      const near = q && Math.min(...corners.map((c) => Math.hypot(q[0] - c[0], q[1] - c[1]))) <= 5 * Math.abs(by);
      if (near) [prev.t1, next.t0] = found!; // run back past a side's start: it goes (below)
      else prev.toB = next.toA = [(pe[0] + ns[0]) / 2, (pe[1] + ns[1]) / 2]; // no crossing near: both run straight to half way between their ends
    });
    const back = live.filter((x) => x.t1 <= x.t0 + 1e-12 && (live.length > 1 || closed));
    if (!back.length) break;
    for (const x of back) x.gone = true;
  }
  // each side as points and curves: a bezier refitted in pieces (its loops left out), straight on where it was run on past its ends
  const pts: UV[] = [];
  const curves: (Curve | null)[] = [];
  const live = sides.filter((x) => !x.gone);
  for (const s of live) {
    const start = s.f(s.t0);
    if (s.toA) (pts.push(s.toA), curves.push(null));
    if (s.kind === 'line') (pts.push(start), curves.push(null));
    else if (s.kind === 'arc') (pts.push(start), curves.push({ mid: s.f((s.t0 + s.t1) / 2) }));
    else {
      const [lo, hi] = [Math.max(0, s.t0), Math.min(1, s.t1)];
      if (s.t0 < 0) (pts.push(start), curves.push(null));
      // the kept stretches between its loops
      const bounds = [lo, ...(s.cuts ?? []).filter(([u, w]) => u > lo && w < hi).flat(), hi];
      for (let k = 0; k + 1 < bounds.length; k += 2) {
        const fit = offsetBezier(s.base!, left, bounds[k], bounds[k + 1], tol);
        fit.curves.forEach((c, j) => (pts.push(fit.pts[j]), curves.push(c)));
      }
      if (s.t1 > 1) (pts.push(s.f(1)), curves.push(null));
    }
    if (s.toB) (pts.push(s.f(s.t1)), curves.push(null));
  }
  if (!closed && live.length) pts.push(live[live.length - 1].f(live[live.length - 1].t1));
  return { pts, curves };
}

/**
 * Where a bezier's offset `f` (`left` mm) runs backwards (it bends tighter than the offset: left · curvature > 1): each
 * such loop cut out where the offset crosses itself around it (`cuts`); one at an end trims the side there (`from`,
 * `to`); backwards all along, or a loop that never crosses back: `gone`.
 */
function loopsOf(base: { a: UV; c1: UV; c2: UV; b: UV }, f: (t: number) => UV, left: number): Partial<Offset> {
  const bend = (t: number) => {
    const d = bezDir(base, t);
    const dd = [0, 1].map((k) => 6 * ((1 - t) * (base.c2[k] - 2 * base.c1[k] + base.a[k]) + t * (base.b[k] - 2 * base.c2[k] + base.c1[k])));
    return (left * (d[0] * dd[1] - d[1] * dd[0])) / Math.hypot(...d) ** 3;
  };
  const steps = 400;
  const back = Array.from({ length: steps + 1 }, (_, k) => bend(k / steps) > 1);
  if (back.every(Boolean)) return { gone: true };
  // the backward stretches, their ends bisected
  const edge = (u: number, w: number) => {
    for (let k = 0; k < 50; k++) {
      const m = (u + w) / 2;
      if ((bend(m) > 1) === (bend(u) > 1)) u = m;
      else w = m;
    }
    return (u + w) / 2;
  };
  const runs: [number, number][] = [];
  let start = back[0] ? 0 : -1;
  for (let k = 0; k < steps; k++) {
    if (back[k + 1] && !back[k]) start = edge(k / steps, (k + 1) / steps);
    if (!back[k + 1] && back[k]) runs.push([start, edge(k / steps, (k + 1) / steps)]);
  }
  if (back[steps]) runs.push([start, 1]);
  const out: Partial<Offset> = { cuts: [] };
  for (const [ra, rb] of runs) {
    if (ra <= 0) out.from = rb;
    else if (rb >= 1) out.to = ra;
    else {
      // where the offset before the loop meets the offset after it; none: it never comes back (offset wider than the side holds)
      const cross = selfCrossing(f, ra, rb);
      if (!cross) return { gone: true };
      out.cuts!.push(cross);
    }
  }
  return out;
}

/** Where `f` before `ra` meets `f` after `rb` (its loop between): their parameters, from the crossing of its pieces refined by Newton; null: none. */
function selfCrossing(f: (t: number) => UV, ra: number, rb: number): [number, number] | null {
  const steps = 200;
  const a = Array.from({ length: steps + 1 }, (_, k) => (ra * k) / steps);
  const b = Array.from({ length: steps + 1 }, (_, k) => rb + ((1 - rb) * k) / steps);
  for (let i = steps - 1; i >= 0; i--)
    for (let j = 0; j < steps; j++) {
      const [p, q, r, s] = [f(a[i]), f(a[i + 1]), f(b[j]), f(b[j + 1])];
      const d1: UV = [q[0] - p[0], q[1] - p[1]];
      const d2: UV = [s[0] - r[0], s[1] - r[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-18) continue;
      const u = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den;
      const w = ((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / den;
      if (u < 0 || u > 1 || w < 0 || w > 1) continue;
      let [x, y] = [a[i] + u * (a[i + 1] - a[i]), b[j] + w * (b[j + 1] - b[j])];
      const h = 1e-7;
      for (let k = 0; k < 30; k++) {
        const [pu, pv] = [f(x), f(y)];
        const res: UV = [pu[0] - pv[0], pu[1] - pv[1]];
        if (Math.hypot(...res) < 1e-13) break;
        const du: UV = [(f(x + h)[0] - f(x - h)[0]) / (2 * h), (f(x + h)[1] - f(x - h)[1]) / (2 * h)];
        const dv: UV = [(f(y + h)[0] - f(y - h)[0]) / (2 * h), (f(y + h)[1] - f(y - h)[1]) / (2 * h)];
        const det = -du[0] * dv[1] + du[1] * dv[0];
        if (Math.abs(det) < 1e-18) break;
        x += (res[0] * dv[1] - res[1] * dv[0]) / det;
        y += (du[0] * -res[1] + du[1] * res[0]) / det;
      }
      return [x, y];
    }
  return null;
}

/** A bezier's direction (not unit length) at `t`. */
const bezDir = ({ a, c1, c2, b }: { a: UV; c1: UV; c2: UV; b: UV }, t: number): UV => {
  const d = [0, 1].map((k) => 3 * ((1 - t) ** 2 * (c1[k] - a[k]) + 2 * (1 - t) * t * (c2[k] - c1[k]) + t ** 2 * (b[k] - c2[k]))) as UV;
  // a handle on its end: the direction from the chord's side
  return Math.hypot(...d) > 1e-12 ? d : [b[0] - a[0], b[1] - a[1]];
};

/**
 * A bezier's offset `left` mm to its left, `t0`..`t1` of it, as beziers within `tol` mm: each piece from the offset's
 * points and directions at its ends, its handles sized so it passes through the offset's middle; halved until it fits.
 */
export function offsetBezier(base: { a: UV; c1: UV; c2: UV; b: UV }, left: number, t0 = 0, t1 = 1, tol = 1e-3, depth = 12): { pts: UV[]; curves: Curve[] } {
  const hat = ([x, y]: UV): UV => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
  const at = (t: number): UV => {
    const [q, d] = [bez(base.a, base.c1, base.c2, base.b, t), hat(bezDir(base, t))];
    return [q[0] - d[1] * left, q[1] + d[0] * left];
  };
  const piece = (u: number, w: number, deep: number): { pts: UV[]; curves: Curve[] } => {
    const [p0, p3, d0, d3, m] = [at(u), at(w), hat(bezDir(base, u)), hat(bezDir(base, w)), at((u + w) / 2)];
    // C(½) = ½(p0 + p3) + ⅜(α d0 − β d3) = m
    const rhs: UV = [(m[0] - (p0[0] + p3[0]) / 2) / 0.375, (m[1] - (p0[1] + p3[1]) / 2) / 0.375];
    const det = -d0[0] * d3[1] + d0[1] * d3[0];
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 3;
    let [al, be] = [chord, chord];
    if (Math.abs(det) > 1e-9) [al, be] = [(-rhs[0] * d3[1] + rhs[1] * d3[0]) / det, (d0[0] * rhs[1] - d0[1] * rhs[0]) / det];
    if (!(al > 0 && be > 0)) [al, be] = [chord, chord];
    const c: Curve = { c1: [p0[0] + d0[0] * al, p0[1] + d0[1] * al], c2: [p3[0] - d3[0] * be, p3[1] - d3[1] * be] };
    const fits = Array.from({ length: 15 }, (_, k) => at(u + ((w - u) * (k + 1)) / 16)).every((q) => {
      const near = nearestOnSide(p0, c, p3, q);
      return Math.hypot(q[0] - near[0], q[1] - near[1]) <= tol;
    });
    if (fits || !deep) return { pts: [p0, p3], curves: [c] };
    const mid = (u + w) / 2;
    const [x, y] = [piece(u, mid, deep - 1), piece(mid, w, deep - 1)];
    return { pts: [...x.pts, ...y.pts.slice(1)], curves: [...x.curves, ...y.curves] };
  };
  return piece(t0, t1, depth);
}

/** A split line moved `by` mm to its left as the cut takes it: arcs stay arcs (`offsetPath`), straight lines mitred (`beside`). */
export function movedLine(p: Extract<P, { kind: 'line' }>, by: number): Extract<P, { kind: 'line' }> {
  if (!by) return p;
  return curved(p) ? { ...p, ...offsetPath(p, by) } : { ...p, pts: beside(p.pts, by) };
}

/** An open line moved `d` mm to its left, its corners mitred (as a parallel line at that distance). */
export function beside(pts: [number, number][], d: number): [number, number][] {
  if (!d) return pts;
  const left = (a: [number, number], b: [number, number]): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(a[1] - b[1]) / l, (b[0] - a[0]) / l];
  };
  return pts.map((p, i) => {
    const [n0, n1] = [left(pts[Math.max(0, i - 1)], pts[Math.max(1, i)]), left(pts[Math.min(i, pts.length - 2)], pts[Math.min(i + 1, pts.length - 1)])];
    const m = [n0[0] + n1[0], n0[1] + n1[1]];
    const k = d / Math.max(MITER, (m[0] * n1[0] + m[1] * n1[1]) / (Math.hypot(...m) || 1)) / (Math.hypot(...m) || 1);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
}
