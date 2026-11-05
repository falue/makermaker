import { centreMoved, pointMoved } from '../viewer/shapes';
import { arcOf, type DrawnProfile } from './profiles';
import { paramLookup, resolve } from './resolve';
import type { Curve, Doc } from './types';

type UV = [number, number];
type Pathed = Extract<DrawnProfile, { pts: UV[] }>;

/** A side of a resolved line or polygon as it is now: length (straight), diameter (an arc), direction (radians). */
export function sideNow(p: Pathed, i: number) {
  const [a, b] = [p.pts[i], p.pts[(i + 1) % p.pts.length]];
  const c = p.curves?.[i];
  const arc = c && 'mid' in c ? arcOf(a, c.mid, b) : null;
  return { l: Math.hypot(b[0] - a[0], b[1] - a[1]), d: arc ? arc.r * 2 : null, dir: Math.atan2(b[1] - a[1], b[0] - a[0]), straight: !c };
}

/**
 * Point `from` moved by `by`, and what follows it along with it, up to `to` (all rigid); the side after `to` takes up the
 * change.
 */
function followingMoved(p: Pathed, from: number, to: number, by: UV): Pathed {
  const at = (v: UV): UV => [v[0] + by[0], v[1] + by[1]];
  const moved = pointMoved(p, to, at(p.pts[to]));
  const curves = moved.curves && [...moved.curves];
  for (let k = from; k < to; k++) {
    const c = p.curves?.[k];
    if (curves) curves[k] = !c ? null : 'c1' in c ? { c1: at(c.c1), c2: at(c.c2) } : { mid: at(c.mid) };
  }
  return { ...moved, pts: moved.pts.map((v, k) => (k >= from && k < to ? at(p.pts[k]) : v)), ...(curves ? { curves } : {}) };
}

/**
 * The points as a resolved line's or polygon's sides' sizes say, side after side, as if each were dragged there; what
 * follows a changed side moves along. A polygon's last point stays, so it stays closed the way it was: the side before
 * it takes up the change.
 */
export function sized<T extends Pathed>(p: T): T {
  if (!p.sizes?.some(Boolean)) return p;
  let q: Pathed = p.kind === 'polygon' ? { ...p, rot: 0 } : p;
  p.sizes.forEach((s, i) => {
    if (!s || i >= q.pts.length) return;
    const now = sideNow(q, i);
    if (now.d !== null && s.d && s.d > 0) q = centreMoved(q, i, [0, 0], s.d / 2);
    else if (now.straight && (s.l || s.deg !== undefined)) {
      const typedDir = s.deg !== undefined && Number.isFinite(s.deg) ? (s.base ?? 0) + (s.deg * Math.PI) / 180 : null;
      const l = s.l && Number.isFinite(s.l) ? (typedDir === null ? Math.abs(s.l) : s.l) : now.l;
      const dir = typedDir ?? now.dir;
      const next = (i + 1) % q.pts.length;
      const a = q.pts[i];
      const end: UV = [a[0] + l * Math.cos(dir), a[1] + l * Math.sin(dir)];
      if (Math.hypot(end[0] - q.pts[next][0], end[1] - q.pts[next][1]) > 1e-7) {
        const last = q.pts.length - (q.kind === 'polygon' ? 2 : 1);
        q = next && next < last ? followingMoved(q, next, last, [end[0] - q.pts[next][0], end[1] - q.pts[next][1]]) : pointMoved(q, next, end);
      }
    }
  });
  return { ...p, pts: q.pts, ...(q.curves ? { curves: q.curves } : {}) };
}

const round = (q: UV): UV => [+q[0].toFixed(4), +q[1].toFixed(4)];
export const roundedCurves = (curves: (Curve | null)[]) => curves.map((c) => (!c ? null : 'c1' in c ? { c1: round(c.c1), c2: round(c.c2) } : { mid: round(c.mid) }));

/** Parameters changed: every line and polygon follows its sides' sizes. What does not move stays the same object. */
export function followSizes(next: Doc, prev: Doc): Doc {
  if (next.params === prev.params) return next;
  const lookup = paramLookup(next.params);
  const walk = <T>(o: T): T => {
    if (typeof o !== 'object' || !o) return o;
    if (Array.isArray(o)) {
      const out = o.map(walk);
      return out.some((v, k) => v !== o[k]) ? (out as T) : o;
    }
    const shape = o as unknown as { sizes?: unknown; pts?: UV[] };
    if (shape.sizes && shape.pts) {
      const errors = new Map<string, string>();
      const r = resolve(o, lookup, '', errors) as unknown as Pathed;
      if (errors.size) return o;
      const s = sized(r);
      const pts = s.pts.map(round);
      if (pts.every((q, k) => Math.hypot(q[0] - shape.pts![k][0], q[1] - shape.pts![k][1]) < 1e-4)) return o;
      return { ...o, pts, ...(s.curves ? { curves: roundedCurves(s.curves) } : {}) };
    }
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(o)) {
      const w = walk(v);
      if (w !== v) (out ??= { ...(o as Record<string, unknown>) })[k] = w;
    }
    return (out ?? o) as T;
  };
  const [sketches, bodies] = [walk(next.sketches), walk(next.bodies)];
  return sketches === next.sketches && bodies === next.bodies ? next : { ...next, sketches, bodies };
}
