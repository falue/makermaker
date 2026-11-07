import { Matrix3, Vector3 } from 'three';
import { arcOf, bakeTurn, bounds, centre, mapPoints, sideDirs, type DrawnProfile } from '../doc/profiles';
import type { Curve } from '../doc/types';

type UV = [number, number];

/**
 * A resize handle pushes the edge (or corner) in direction (sx, sy) of the shape's own frame; the rotate handle turns
 * it; `point` moves point `i` of a polygon or line; `control` a curve's handle on side `i`; `centre` the arc's on side `i`.
 */
export type Handle = { kind: 'resize'; sx: number; sy: number } | { kind: 'rotate' } | { kind: 'point'; i: number } | { kind: 'control'; i: number; which: 'c1' | 'c2' | 'mid' } | { kind: 'centre'; i: number };

const rad = (deg: number) => (deg * Math.PI) / 180;
const turn = ([x, y]: UV, deg: number): UV => [x * Math.cos(rad(deg)) - y * Math.sin(rad(deg)), x * Math.sin(rad(deg)) + y * Math.cos(rad(deg))];
const rotOf = (p: DrawnProfile) => (p.kind === 'circle' || p.kind === 'line' ? 0 : p.rot);

/** Point in the shape's own frame: around its centre, bakeTurn. */
function local(p: DrawnProfile, [u, v]: UV): UV {
  const [cx, cy] = centre(p);
  return turn([u - cx, v - cy], -rotOf(p));
}

/** Half sizes of the shape in its own frame, and the offset of that box from the centre (polygons are not centred). */
function box(p: DrawnProfile): { half: UV; mid: UV } {
  if (p.kind === 'rect') return { half: [p.w / 2, p.h / 2], mid: [0, 0] };
  if (p.kind === 'circle' || p.kind === 'ngon') return { half: [p.d / 2, p.d / 2], mid: [0, 0] };
  const [cx, cy] = centre(p);
  // its true sides, unturned, corners sharp
  const [x0, y0, x1, y1] = bounds(p.kind === 'line' ? p : { ...p, rot: 0, r: 0, rs: undefined });
  return { half: [(x1 - x0) / 2, (y1 - y0) / 2], mid: [(x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy] };
}

/** The handle on the middle of the arc on side `i`; none: its points lie on one line. */
function arcCentre(q: Extract<DrawnProfile, { pts: UV[] }>, i: number, mid: UV): { at: UV; handle: Handle }[] {
  const arc = arcOf(q.pts[i], mid, q.pts[(i + 1) % q.pts.length]);
  return arc ? [{ at: arc.c, handle: { kind: 'centre', i } }] : [];
}

/** A polygon's or line's points and curve handles, as they lie. */
export function pointHandles(p: DrawnProfile): { at: UV; handle: Handle }[] {
  if (p.kind !== 'polygon' && p.kind !== 'line') return [];
  const q = bakeTurn(p);
  return [
    ...q.pts.map((at, i): { at: UV; handle: Handle } => ({ at, handle: { kind: 'point', i } })),
    ...(q.curves ?? []).flatMap((c, i): { at: UV; handle: Handle }[] =>
      !c
        ? []
        : 'c1' in c
          ? [{ at: c.c1, handle: { kind: 'control', i, which: 'c1' } }, { at: c.c2, handle: { kind: 'control', i, which: 'c2' } }]
          : [{ at: c.mid, handle: { kind: 'control', i, which: 'mid' } }, ...arcCentre(q, i, c.mid)],
    ),
  ];
}

/** A straight line of two points: those points are all it has to grab. */
export const simpleLine = (p: DrawnProfile) => p.kind === 'line' && p.pts.length === 2 && !p.curves?.some(Boolean);

/** Handles in plane coordinates; the rotate handle sits `reach` mm beyond the top edge (none for circles). */
export function handlesOf(p: DrawnProfile, reach: number): { at: UV; handle: Handle }[] {
  if (simpleLine(p)) return [];
  const [cx, cy] = centre(p);
  const { half, mid } = box(p);
  const at = (lx: number, ly: number): UV => {
    const [x, y] = turn([mid[0] + lx, mid[1] + ly], rotOf(p));
    return [cx + x, cy + y];
  };
  const round = p.kind === 'circle' || p.kind === 'ngon'; // resized evenly: edge handles only
  const dirs = round ? [[1, 0], [0, 1], [-1, 0], [0, -1]] : [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const out: { at: UV; handle: Handle }[] = dirs.map(([sx, sy]) => ({ at: at(sx * half[0], sy * half[1]), handle: { kind: 'resize', sx, sy } }));
  if (p.kind !== 'circle' && p.kind !== 'line') out.push({ at: at(0, half[1] + reach), handle: { kind: 'rotate' } });
  return out;
}

export interface ResizeOptions {
  /** From the middle instead of the opposite edge. */
  alt: boolean;
  /** Keep proportions. */
  shift: boolean;
  /** Sizes land on this step. */
  step: number;
  /** Exact sizes typed for the own x / y axis (mm). */
  typed: [number | undefined, number | undefined];
}

/**
 * The shape resized by dragging `h` from `q0` to `q` (plane coordinates), as in incase: the opposite edge stays
 * (Alt: the middle), Shift keeps proportions (led by a typed axis, else the one that changed most).
 */
export function resized(p: DrawnProfile, h: { sx: number; sy: number }, q0: UV, q: UV, o: ResizeOptions): DrawnProfile {
  const { half, mid } = box(p);
  const full: UV = [half[0] * 2, half[1] * 2];
  const dir: UV = [h.sx, h.sy];
  const [a0, a] = [local(p, q0), local(p, q)];
  const raw = (k: number) => full[k] + (o.alt ? 2 : 1) * dir[k] * (a[k] - a0[k]);
  const sized = (k: number) => o.typed[k] ?? (dir[k] ? Math.max(o.step, Math.round(raw(k) / o.step) * o.step) : full[k]);
  let size: UV = [sized(0), sized(1)];
  const round = p.kind === 'circle' || p.kind === 'ngon';
  if (o.shift || round) {
    const change = (k: number) => (dir[k] ? Math.abs(raw(k) / (full[k] || 1) - 1) : -1);
    const lead = o.typed[0] !== undefined ? 0 : o.typed[1] !== undefined ? 1 : change(0) >= change(1) ? 0 : 1;
    const k = full[lead] ? size[lead] / full[lead] : 1;
    size = lead === 0 ? [size[0], full[1] * k] : [full[0] * k, size[1]];
  }
  // the box centre moves by half the growth towards the dragged side (not with Alt, not on undragged axes)
  const grow = (k: number) => (o.alt || (!dir[k] && !round) ? 0 : (dir[k] * (size[k] - full[k])) / 2);
  const [gx, gy] = turn([grow(0), grow(1)], rotOf(p));
  const [cx, cy] = centre(p);
  if (p.kind === 'rect') return { ...p, x: cx + gx, y: cy + gy, w: size[0], h: size[1] };
  if (p.kind === 'circle' || p.kind === 'ngon') return { ...p, x: cx + gx, y: cy + gy, d: size[dir[0] ? 0 : 1] };
  // polygon or line: scale its points in its own frame around the anchor, then store them bakeTurn around their new centre
  const anchor = (k: number) => mid[k] - (o.alt ? 0 : dir[k] * half[k]);
  const scale = (pt: UV): UV => {
    const l = local(p, pt);
    const s = l.map((v, k) => (full[k] ? anchor(k) + (v - anchor(k)) * (size[k] / full[k]) : v)) as UV;
    const [x, y] = turn(s, rotOf(p));
    return [cx + x, cy + y];
  };
  const scaled = p.pts.map(scale);
  const n = scaled.length;
  const c: UV = [scaled.reduce((t, s) => t + s[0], 0) / n, scaled.reduce((t, s) => t + s[1], 0) / n];
  return mapPoints(p, (pt) => {
    const [x, y] = scale(pt);
    return turn([x - c[0], y - c[1]], -rotOf(p)).map((v, k) => v + c[k]) as UV;
  });
}

type Pathed = Extract<DrawnProfile, { pts: UV[] }>;
const unit = ([x, y]: UV): UV => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
/** The sides meeting at point `i`: the one coming in and the one going out, where they exist. */
function sidesAt(p: Pathed, i: number) {
  const n = p.pts.length;
  const closed = p.kind === 'polygon';
  return { into: i > 0 ? i - 1 : closed ? n - 1 : null, out: closed || i < n - 1 ? i : null };
}

/** Whether a curve runs through point `i` without a corner. */
export function isSmooth(p: Pathed, i: number) {
  const { into, out } = sidesAt(p, i);
  if (into === null || out === null) return false;
  const n = p.pts.length;
  const [, d0] = sideDirs(p.pts[into], p.curves?.[into], p.pts[i]);
  const [d1] = sideDirs(p.pts[i], p.curves?.[out], p.pts[(i + 1) % n]);
  const [u, v] = [unit(d0), unit(d1)];
  return u[0] * v[0] + u[1] * v[1] > 0.99996; // within half a degree
}

/** The middle of the arc leaving `a` in direction `t` (unit) to reach `b`, and the direction it arrives in. Null: as good as straight, or doubling back. */
function arcLeaving(a: UV, t: UV, b: UV): { mid: UV; end: UV } | null {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (l < 1e-9) return null;
  const v: UV = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const along = t[0] * v[0] + t[1] * v[1];
  const side = t[1] * v[0] - t[0] * v[1]; // towards the arc's middle, from the chord: on t's side
  if (Math.abs(side) < 1e-6 || along < -0.9998) return null;
  const n: UV = side > 0 ? [-v[1], v[0]] : [v[1], -v[0]];
  const h = (l / 2) * Math.tan(Math.atan2(Math.abs(side), along) / 2);
  return { mid: [(a[0] + b[0]) / 2 + n[0] * h, (a[1] + b[1]) / 2 + n[1] * h], end: [2 * along * v[0] - t[0], 2 * along * v[1] - t[1]] };
}

/**
 * `after` is `before` with point `i` moved; where a curve ran through a point without a corner it still does. An arc is
 * made anew from the tangent it has to keep, on along arcs that ran on smoothly; before a straight side its far end
 * slides along that side, as far as it reaches. A bezier's handle turns, and it ends there.
 */
function tangentsHeld(before: Pathed, after: Pathed, i: number): Pathed {
  const n = after.pts.length;
  const smooth = before.pts.map((_, k) => isSmooth(before, k));
  const pts = [...after.pts];
  const curves = [...(after.curves ?? [])];
  const q = pts[i];
  const side = (at: number, step: number) => (step > 0 ? sidesAt(after, at).out : sidesAt(after, at).into);
  const beyond = (at: number, step: number) => (at + step + n) % n;
  const towards = (a: UV, b: UV) => unit([b[0] - a[0], b[1] - a[1]]);
  const isArc = (c: Curve | null | undefined) => !!c && 'mid' in c;
  const walk = (at: number, step: number, t: UV, left = n) => {
    const k = side(at, step);
    if (k === null || !left) return;
    const b = beyond(at, step);
    const c = curves[k];
    if (b === i || !c) return;
    if ('c1' in c) {
      const key = step > 0 ? 'c1' : 'c2';
      const l = Math.hypot(c[key][0] - pts[at][0], c[key][1] - pts[at][1]);
      curves[k] = { ...c, [key]: [pts[at][0] + t[0] * l, pts[at][1] + t[1] * l] };
      return;
    }
    const after2 = side(b, step);
    if (smooth[b] && after2 !== null && !curves[after2]) {
      // straight on from it: where the tangent from here crosses that side tells where the arc ends on it
      const stop = pts[beyond(b, step)];
      const e = towards(pts[b], stop);
      const den = t[0] * e[1] - t[1] * e[0];
      if (Math.abs(den) > 1e-6) {
        const reach = ((pts[b][0] - pts[at][0]) * e[1] - (pts[b][1] - pts[at][1]) * e[0]) / den;
        const end: UV = [pts[at][0] + t[0] * reach + e[0] * reach, pts[at][1] + t[1] * reach + e[1] * reach];
        const made = reach > 1e-6 && (stop[0] - end[0]) * e[0] + (stop[1] - end[1]) * e[1] > 1e-6 ? arcLeaving(pts[at], t, end) : null;
        if (made) {
          pts[b] = end;
          curves[k] = { mid: made.mid };
          return;
        }
      }
    }
    const made = arcLeaving(pts[at], t, pts[b]);
    if (!made) return;
    curves[k] = { mid: made.mid };
    if (smooth[b]) walk(b, step, made.end, left - 1);
  };
  for (const step of [1, -1]) {
    const k = side(i, step);
    if (k === null) continue;
    const b = beyond(i, step);
    if (b === i || !smooth[b]) continue;
    if (!curves[k]) walk(b, step, towards(q, pts[b]));
    else if (isArc(curves[k]) && !smooth[i]) {
      // this arc keeps its tangent at the far end, the other way round
      const [d0, d1] = sideDirs(before.pts[step > 0 ? i : b], before.curves?.[k], before.pts[step > 0 ? b : i]);
      const made = arcLeaving(pts[b], step > 0 ? unit([-d1[0], -d1[1]]) : unit(d0), q);
      if (made) curves[k] = { mid: made.mid };
    }
  }
  const [into, out] = [side(i, -1), side(i, 1)];
  if (smooth[i] && into !== null && out !== null) {
    const [a, b] = [pts[beyond(i, -1)], pts[beyond(i, 1)]];
    if (isArc(curves[into]) && isArc(curves[out]) && smooth[beyond(i, -1)]) {
      const made = arcLeaving(a, unit(sideDirs(before.pts[beyond(i, -1)], before.curves?.[into], before.pts[i])[0]), q);
      if (made) curves[into] = { mid: made.mid };
    }
    if (isArc(curves[out]) && !curves[into]) walk(i, 1, towards(a, q));
    else if (isArc(curves[into]) && !curves[out]) walk(i, -1, towards(b, q));
    else if (isArc(curves[out])) walk(i, 1, unit(sideDirs(a, curves[into], q)[1]));
    else if (isArc(curves[into])) {
      const d = sideDirs(q, curves[out], b)[0];
      walk(i, -1, unit([-d[0], -d[1]]));
    }
  }
  return { ...after, pts, curves };
}

/** Point `i` moved to `q`: its bezier handles move along, a side's arc keeps its shape, and tangents stay (see `tangentsHeld`). */
export function pointMoved(p: Pathed, i: number, q: UV): Pathed {
  const s = bakeTurn(p);
  const n = s.pts.length;
  const was = s.pts[i];
  const { into, out } = sidesAt(s, i);
  const by: UV = [q[0] - was[0], q[1] - was[1]];
  // the arc's middle follows the chord from `from` to `to`, as turned and scaled
  const follow = (mid: UV, from: UV, to: UV, fixed: UV): UV => {
    const [ax, ay] = [from[0] - fixed[0], from[1] - fixed[1]];
    const [bx, by2] = [to[0] - fixed[0], to[1] - fixed[1]];
    const l = ax * ax + ay * ay || 1;
    const [cos, sin] = [(ax * bx + ay * by2) / l, (ax * by2 - ay * bx) / l];
    const [mx, my] = [mid[0] - fixed[0], mid[1] - fixed[1]];
    return [fixed[0] + mx * cos - my * sin, fixed[1] + mx * sin + my * cos];
  };
  const curves = s.curves?.map((c, k): Curve | null => {
    if (!c || (k !== into && k !== out)) return c;
    if ('c1' in c) return { c1: k === out ? [c.c1[0] + by[0], c.c1[1] + by[1]] : c.c1, c2: k === into ? [c.c2[0] + by[0], c.c2[1] + by[1]] : c.c2 };
    return { mid: follow(c.mid, was, q, s.pts[k === out ? (i + 1) % n : (i - 1 + n) % n]) };
  });
  const after = { ...s, pts: s.pts.map((v, k) => (k === i ? q : v)), ...(curves ? { curves } : {}) };
  return s.curves?.some((c) => c && 'mid' in c) ? tangentsHeld(s, after, i) : after;
}

/** A curve's handle on side `i` moved to `q`; a bezier handle at a smooth point turns the one across it too (its length kept). */
export function controlMoved(p: Pathed, i: number, which: 'c1' | 'c2' | 'mid', q: UV): Pathed {
  const s = bakeTurn(p);
  const curves = [...(s.curves ?? [])];
  const c = curves[i];
  if (!c) return s;
  if ('mid' in c) curves[i] = { mid: q };
  else {
    curves[i] = { ...c, [which]: q };
    const n = s.pts.length;
    const at = which === 'c1' ? i : (i + 1) % n;
    const across = which === 'c1' ? sidesAt(s, at).into : sidesAt(s, at).out;
    const o = across === null ? null : curves[across];
    if (across !== null && across !== i && o && 'c1' in o && isSmooth(s, at)) {
      const key = which === 'c1' ? 'c2' : 'c1';
      const l = Math.hypot(o[key][0] - s.pts[at][0], o[key][1] - s.pts[at][1]);
      const d = unit([s.pts[at][0] - q[0], s.pts[at][1] - q[1]]);
      curves[across] = { ...o, [key]: [s.pts[at][0] + d[0] * l, s.pts[at][1] + d[1] * l] };
    }
  }
  return { ...s, curves };
}

/**
 * The arc on side `i` with its middle dragged to `q`, or its radius typed (else on `step`): it moves the only way the
 * tangents allow. Smooth at both ends between straight sides: like a fillet, its ends sliding along them, as far as
 * they reach. Smooth at its start: along the normal there, the angle kept, its end (and what follows) moving; else
 * smooth at its end: the same from there; neither: along the line square to its chord, both ends staying.
 */
export function centreMoved(p: Pathed, i: number, q: UV, radius?: number, step = 0): Pathed {
  const s = bakeTurn(p);
  const n = s.pts.length;
  const next = (i + 1) % n;
  const [a, b] = [s.pts[i], s.pts[next]];
  const c = s.curves?.[i];
  const arc = c && 'mid' in c ? arcOf(a, c.mid, b) : null;
  if (!c || !('mid' in c) || !arc) return s;
  const onStep = (v: number) => (step ? Math.round(v / step) * step : v);
  const withMid = (r: Pathed, mid: UV): Pathed => ({ ...r, curves: r.curves!.map((x, k) => (k === i ? { mid } : x)) });
  const fromStart = isSmooth(s, i);
  const [before, after] = [sidesAt(s, i).into, sidesAt(s, next).out];
  if (fromStart && isSmooth(s, next) && before !== null && after !== null && !s.curves?.[before] && !s.curves?.[after]) {
    const [prev, far] = [s.pts[before], s.pts[(next + 1) % n]];
    const [d1, d2]: UV[] = [[a[0] - prev[0], a[1] - prev[1]], [far[0] - b[0], far[1] - b[1]]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) > 1e-9) {
      // where the straight sides cross: scaling around it keeps the arc tangent to both
      const t = ((b[0] - prev[0]) * d2[1] - (b[1] - prev[1]) * d2[0]) / den;
      const o: UV = [prev[0] + d1[0] * t, prev[1] + d1[1] * t];
      const out = unit([arc.c[0] - o[0], arc.c[1] - o[1]]);
      const toC = Math.hypot(arc.c[0] - o[0], arc.c[1] - o[1]);
      // how far the sides reach
      const reach = (end: UV, stop: UV) => {
        const v: UV = [end[0] - o[0], end[1] - o[1]];
        const l = v[0] * v[0] + v[1] * v[1];
        const k = ((stop[0] - o[0]) * v[0] + (stop[1] - o[1]) * v[1]) / (l || 1);
        return k > 0 ? k : Infinity;
      };
      const wanted = radius ?? onStep((((q[0] - o[0]) * out[0] + (q[1] - o[1]) * out[1]) / toC) * arc.r);
      const k = Math.min(Math.max(0.01, wanted) / arc.r, reach(a, prev), reach(b, far));
      const scaled = (v: UV): UV => [o[0] + (v[0] - o[0]) * k, o[1] + (v[1] - o[1]) * k];
      return { ...s, pts: s.pts.map((v, m) => (m === i ? scaled(a) : m === next ? scaled(b) : v)), curves: s.curves!.map((x, m) => (m === i ? { mid: scaled(c.mid) } : x)) };
    }
  }
  if (fromStart || isSmooth(s, next)) {
    const [fix, sweep] = fromStart ? [a, arc.a1 - arc.a0] : [b, arc.a0 - arc.a1];
    const u = unit([arc.c[0] - fix[0], arc.c[1] - fix[1]]);
    const r = Math.max(0.01, radius ?? onStep((q[0] - fix[0]) * u[0] + (q[1] - fix[1]) * u[1]));
    const m: UV = [fix[0] + u[0] * r, fix[1] + u[1] * r];
    const round = (k: number): UV => {
      const [x, y] = [fix[0] - m[0], fix[1] - m[1]];
      return [m[0] + x * Math.cos(k) - y * Math.sin(k), m[1] + x * Math.sin(k) + y * Math.cos(k)];
    };
    return withMid(pointMoved(s, fromStart ? next : i, round(sweep)), round(sweep / 2));
  }
  const m: UV = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
  // towards the arc's middle
  let d = unit([a[1] - b[1], b[0] - a[0]]);
  if ((c.mid[0] - m[0]) * d[0] + (c.mid[1] - m[1]) * d[1] < 0) d = [-d[0], -d[1]];
  const along = (v: UV) => (v[0] - m[0]) * d[0] + (v[1] - m[1]) * d[1];
  const pulled = along(q);
  const r = Math.max(half, radius ?? onStep(Math.hypot(pulled, half)));
  const h = (radius === undefined ? Math.sign(pulled) || -1 : Math.sign(along(arc.c)) || -1) * Math.sqrt(r * r - half * half);
  return withMid(s, [m[0] + d[0] * (h + r), m[1] + d[1] * (h + r)]);
}

/**
 * Point `i` from smooth to sharp, or back; arcs stay arcs. Sharp: each bezier handle there points at its side's other
 * handle (a corner, the handles free). Smooth: straight sides become bezier curves, the handles lying along an arc
 * there, else along the line between its neighbours. Ends of a line stay.
 */
export function smoothToggled(p: Pathed, i: number): Pathed {
  const s = bakeTurn(p);
  const { into, out } = sidesAt(s, i);
  if (into === null || out === null) return s;
  const n = s.pts.length;
  const [prev, at, next] = [s.pts[(i - 1 + n) % n], s.pts[i], s.pts[(i + 1) % n]];
  const sides = Array.from({ length: p.kind === 'line' ? n - 1 : n }, (_, k) => s.curves?.[k] ?? null);
  const [a, b] = [sides[into], sides[out]];
  const third = (from: UV, to: UV): UV => [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3];
  if (isSmooth(s, i)) {
    if (a && 'c1' in a) sides[into] = { c1: a.c1, c2: third(at, a.c1) };
    if (b && 'c1' in b) sides[out] = { c1: third(at, b.c2), c2: b.c2 };
    return { ...s, curves: sides };
  }
  const d = unit(a && 'mid' in a ? sideDirs(prev, a, at)[1] : b && 'mid' in b ? sideDirs(at, b, next)[0] : [next[0] - prev[0], next[1] - prev[1]]);
  const [l0, l1] = [Math.hypot(at[0] - prev[0], at[1] - prev[1]) / 3, Math.hypot(next[0] - at[0], next[1] - at[1]) / 3];
  if (!a || 'c1' in a) sides[into] = { c1: a ? a.c1 : third(prev, at), c2: [at[0] - d[0] * l0, at[1] - d[1] * l0] };
  if (!b || 'c1' in b) sides[out] = { c1: [at[0] + d[0] * l1, at[1] + d[1] * l1], c2: b ? b.c2 : third(next, at) };
  return { ...s, curves: sides };
}

/** The shape turned by `deg` around its centre. */
export const rotated = (p: DrawnProfile, deg: number): DrawnProfile => (p.kind === 'circle' || p.kind === 'line' ? p : { ...p, rot: p.rot + deg });

/** The shape shifted by (du, dv). */
export function moved(p: DrawnProfile, du: number, dv: number): DrawnProfile {
  if (p.kind === 'polygon' || p.kind === 'line') return mapPoints(p, ([x, y]) => [x + du, y + dv]);
  return { ...p, x: p.x + du, y: p.y + dv };
}

/** Reference point `ref` of the shape's box (-1, 0, 1 per own axis, as Illustrator's reference point locator), in plane coordinates. */
export function anchorAt(p: DrawnProfile, ref: UV): UV {
  const [cx, cy] = centre(p);
  const { half, mid } = box(p);
  const [x, y] = turn([mid[0] + ref[0] * half[0], mid[1] + ref[1] * half[1]], rotOf(p));
  return [cx + x, cy + y];
}

/** The shape moved so its reference point `ref` lies at `at`. */
export function placed(p: DrawnProfile, ref: UV, at: UV): DrawnProfile {
  const [x, y] = anchorAt(p, ref);
  return moved(p, at[0] - x, at[1] - y);
}

/** The shape at `size` (own width, height) with its reference point `ref` staying. */
export const sizedTo = (p: DrawnProfile, ref: UV, size: UV) =>
  resized(p, { sx: -ref[0], sy: -ref[1] }, [0, 0], [0, 0], { alt: false, shift: false, step: 1e-6, typed: size });

/** The shape turned to `deg` around its reference point `ref`. */
export const turnedTo = (p: DrawnProfile, ref: UV, deg: number) => placed(rotated(p, deg - rotOf(p)), ref, anchorAt(p, ref));

/** Width and height in the shape's own frame (circles: the diameter twice). */
export function sizeOf(p: DrawnProfile): UV {
  const { half } = box(p);
  return [half[0] * 2, half[1] * 2];
}

/** Angle in degrees of plane point `q` around the shape's centre. */
export function angleAt(p: DrawnProfile, [u, v]: UV) {
  const [cx, cy] = centre(p);
  return (Math.atan2(v - cy, u - cx) * 180) / Math.PI;
}

/** A ball by points or planes (world). */
export type Ball = { center: Vector3; d: number };

/** x with rows[i]·x = rhs[i]; null: the rows hardly span space. */
function solve3(rows: Vector3[], rhs: number[]) {
  const m = new Matrix3().set(...rows[0].toArray(), ...rows[1].toArray(), ...rows[2].toArray());
  if (Math.abs(m.determinant()) < 1e-6) return null;
  m.invert();
  return new Vector3(...rhs).applyMatrix3(m);
}

/** The ball with `a` and `b` opposite each other. */
export function ballAcross(a: Vector3, b: Vector3): Ball {
  return { center: a.clone().add(b).divideScalar(2), d: a.distanceTo(b) };
}

/** The smallest ball through three points: they lie on its widest circle. Null: on one line. */
export function ballOnThree(a: Vector3, b: Vector3, c: Vector3): Ball | null {
  const [u, v] = [b.clone().sub(a), c.clone().sub(a)];
  const n = u.clone().cross(v);
  if (n.lengthSq() < 1e-9) return null;
  const to = v.clone().cross(n).multiplyScalar(u.lengthSq()).add(n.clone().cross(u).multiplyScalar(v.lengthSq())).divideScalar(2 * n.lengthSq());
  return { center: a.clone().add(to), d: 2 * to.length() };
}

/** The one ball through four points. Null: they lie in one plane. */
export function ballOnFour(a: Vector3, b: Vector3, c: Vector3, e: Vector3): Ball | null {
  const rows = [b, c, e].map((p) => p.clone().sub(a));
  const to = solve3(rows.map((r) => r.clone().multiplyScalar(2)), rows.map((r) => r.lengthSq()));
  return to && { center: a.clone().add(to), d: 2 * to.length() };
}

/** Balls touching three planes on the side their normals point to: the centre at radius r is `at` + r × `along`. Null: they meet in no one point. */
export function ballsInCorner(planes: { at: Vector3; n: Vector3 }[]) {
  const rows = planes.map((q) => q.n);
  const at = solve3(rows, planes.map((q) => q.n.dot(q.at)));
  const along = solve3(rows, [1, 1, 1]);
  return at && along && { at, along };
}

/** A curve a line can be drawn tangent to: its point and direction (any length, either way) at `t`, 0..1. */
export type TangentCurve = { at(t: number): [number, number]; dir(t: number): [number, number] };

export function circleCurve([x, y]: [number, number], r: number, a0 = 0, a1 = 2 * Math.PI): TangentCurve {
  const angle = (t: number) => a0 + (a1 - a0) * t;
  return { at: (t) => [x + r * Math.cos(angle(t)), y + r * Math.sin(angle(t))], dir: (t) => [-Math.sin(angle(t)), Math.cos(angle(t))] };
}

export function bezierCurve(a: [number, number], c1: [number, number], c2: [number, number], b: [number, number]): TangentCurve {
  return {
    at: (t) => [0, 1].map((k) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t ** 2 * c2[k] + t ** 3 * b[k]) as [number, number],
    dir: (t) => [0, 1].map((k) => 3 * (1 - t) ** 2 * (c1[k] - a[k]) + 6 * (1 - t) * t * (c2[k] - c1[k]) + 3 * t ** 2 * (b[k] - c2[k])) as [number, number],
  };
}

/** Where `f` crosses 0 on 0..1. */
function zeros(f: (t: number) => number, steps = 96) {
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    let [lo, hi] = [i / steps, (i + 1) / steps];
    if (f(lo) * f(hi) > 0) continue;
    for (let k = 0; k < 50; k++) {
      const m = (lo + hi) / 2;
      if (f(lo) * f(m) <= 0) hi = m;
      else lo = m;
    }
    out.push((lo + hi) / 2);
  }
  return out;
}

/** The `t` of those that lies nearest `near`; null: none where the curve has a direction. */
function nearestOf(c: TangentCurve, ts: number[], near: [number, number]) {
  const far = (t: number) => Math.hypot(c.at(t)[0] - near[0], c.at(t)[1] - near[1]);
  return ts.filter((t) => Math.hypot(...c.dir(t)) > 1e-9).sort((u, v) => far(u) - far(v))[0] ?? null;
}

/** The `t` nearest point `q` on the curve. */
export const tangentStart = (c: TangentCurve, q: [number, number]) => nearestOf(c, Array.from({ length: 257 }, (_, i) => i / 256), q) ?? 0;

/**
 * The tangent from curve `c` to `to`: at `t`, the one nearest `near`; `to` where none reaches (inside a circle, beyond
 * an arc's end): it stays at `from`, running along the curve there. `dir`: radians, the way `to` lies.
 */
export function tangentFrom(c: TangentCurve, near: [number, number], from: number, to: [number, number]) {
  const t = nearestOf(c, zeros((u) => {
    const [p, d] = [c.at(u), c.dir(u)];
    return (p[0] - to[0]) * d[1] - (p[1] - to[1]) * d[0];
  }), near) ?? from;
  const [at, d] = [c.at(t), c.dir(t)];
  const k = (to[0] - at[0]) * d[0] + (to[1] - at[1]) * d[1] < 0 ? -1 : 1;
  return { t, at, dir: Math.atan2(k * d[1], k * d[0]) };
}

/** The `t` where curve `c` runs in direction `dir` (radians, either way), the one nearest `near`; null: nowhere. */
export function tangentAlong(c: TangentCurve, dir: number, near: [number, number]) {
  return nearestOf(c, zeros((u) => {
    const d = c.dir(u);
    return d[0] * Math.sin(dir) - d[1] * Math.cos(dir);
  }), near);
}
