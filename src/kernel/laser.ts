import { drawRectangle, FaceFinder, measureArea, Plane, type Edge, type Face, type Shape3D, type Sketch, type Wire } from 'replicad';
import { arcOf, biarcs, bounds, offsetPath } from '../doc/profiles';
import type { Curve } from '../doc/types';
import { buildBody, type BuildFeature } from './build';

type V3 = [number, number, number];
type P2 = [number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** One closed cut of a part: a loop of corners with its sides' curves (side i from corner i to i + 1; arcs exact), or a circle (kept as one); `hole`: inside the outline. */
export type Cut = { hole: boolean; pts: P2[]; curves: (Curve | null)[]; circle?: { c: P2; r: number } };

/**
 * An edge flat (`flat`: onto the cut's plane) as points and its sides' arcs: straight by its ends, an arc by its ends
 * and middle (a full circle in halves), anything else as arcs within `tol` mm (`biarcs`).
 */
function sidesOf(e: Edge, flat: (p: V3) => P2, tol = 1e-3): { pts: P2[]; curves: ({ mid: P2 } | null)[] } {
  const at = (t: number) => flat(e.pointAt(t).toTuple() as V3);
  if (e.geomType === 'LINE') return { pts: [at(0), at(1)], curves: [null] };
  if (e.geomType === 'CIRCLE') return Math.hypot(at(0)[0] - at(1)[0], at(0)[1] - at(1)[1]) < 1e-9 ? { pts: [at(0), at(0.5), at(1)], curves: [{ mid: at(0.25) }, { mid: at(0.75) }] } : { pts: [at(0), at(1)], curves: [{ mid: at(0.5) }] };
  const dir = (t: number): P2 => {
    const [p, d] = [e.pointAt(t).toTuple() as V3, e.tangentAt(t).toTuple() as V3];
    const [a, b] = [flat(p), flat([p[0] + d[0], p[1] + d[1], p[2] + d[2]])];
    return [b[0] - a[0], b[1] - a[1]];
  };
  return biarcs(at, dir, tol);
}

/**
 * A wire's edges chained into one closed loop (the start not repeated), flat (see `sidesOf`). OpenCascade lists them
 * in no set order or direction: each next one is the edge with an end nearest the loop's end, turned to follow it.
 */
function loopOf(w: Wire, flat: (p: V3) => P2): { pts: P2[]; curves: ({ mid: P2 } | null)[] } {
  const left = w.edges.map((e) => sidesOf(e, flat));
  const out = left.shift()!;
  while (left.length) {
    const end = out.pts.at(-1)!;
    const gap = (p: P2) => Math.hypot(p[0] - end[0], p[1] - end[1]);
    let [best, flip, d] = [0, false, Infinity];
    left.forEach(({ pts }, i) => {
      for (const [p, f] of [[pts[0], false], [pts.at(-1)!, true]] as const) if (gap(p) < d) [best, flip, d] = [i, f, gap(p)];
    });
    const next = left.splice(best, 1)[0];
    out.pts.push(...(flip ? [...next.pts].reverse() : next.pts).slice(1));
    out.curves.push(...(flip ? [...next.curves].reverse() : next.curves));
  }
  return { pts: out.pts.slice(0, -1), curves: out.curves };
}

/** The faces of a shape. */
function facesOf(shape: Shape3D): Face[] {
  return new FaceFinder().find(shape);
}

/**
 * A body's cuts for the laser: a flat face (the one through body point `at` facing `n`; else its biggest) with its
 * holes, at 1:1 in mm; with fillets or chamfers, the finished body cut half way through its plate there (rounded
 * corners show, rounded or chamfered faces' edges do not shrink it). Looking at the face from outside; x as level as possible.
 */
export function laserCuts(features: BuildFeature[], face?: { at: V3; n: V3 }): Cut[] {
  const shape = buildBody(features.filter((f) => f.type !== 'finish'));
  const finished = features.some((f) => f.type === 'finish') ? buildBody(features) : null;
  const slices: Shape3D[] = [];
  try {
    const flat = facesOf(shape).filter((f) => f.geomType === 'PLANE');
    if (!flat.length) throw new Error('it has no flat face');
    // the view's point lies about 1e-3 mm near its face (replicad's own 1e-6 misses it far from the origin)
    const picked = face && new FaceFinder().near(face.at, 1e-3).find(shape).find((f) => f.geomType === 'PLANE' && dot(unit(f.normalAt(face.at).toTuple() as V3), unit(face.n)) > 0.99);
    const chosen: Face = picked ?? flat.reduce((a, b) => (measureArea(b) > measureArea(a) ? b : a));
    const o = chosen.center.toTuple() as V3;
    const n = unit(chosen.normalAt(o).toTuple() as V3);
    const u = Math.abs(n[2]) > 0.999 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n));
    const v = cross(n, u);
    // svg y points down
    const flatten = (p: V3): P2 => [dot(sub(p, o), u), -dot(sub(p, o), v)];
    let cut: Face[] = [chosen];
    if (finished) {
      // the plate: down to the nearest flat face facing the other way
      const depth = Math.min(...flat.filter((f) => dot(unit(f.normalAt(f.center).toTuple() as V3), n) < -0.999).map((f) => dot(sub(o, f.center.toTuple() as V3), n)).filter((d) => d > 1e-6));
      if (Number.isFinite(depth)) {
        const size = 2 * Math.hypot(...sub(shape.boundingBox.bounds[1] as V3, shape.boundingBox.bounds[0] as V3));
        const sheet = (drawRectangle(size, size).sketchOnPlane(new Plane(sub(o, n.map((x) => (x * depth) / 2) as V3), u, n)) as Sketch).face();
        slices.push(finished.clone().intersect(sheet));
        cut = facesOf(slices[0]); // flattened square to n: as if on the face
      }
    }
    // the outlines and each one's holes (both calls use up the face they are called on)
    return cut.flatMap((f) => [f.clone().outerWire(), ...f.clone().innerWires()].map((w, k): Cut => {
      const edges = w.edges;
      const { pts, curves } = loopOf(w, flatten);
      // all its edges arcs of one circle: one circle (OpenCascade may split it in two)
      const arc = edges.every((e) => e.geomType === 'CIRCLE') && curves[0] ? arcOf(pts[0], curves[0].mid, pts[1 % pts.length]) : null;
      const round = arc && pts.every((p, i) => Math.abs(Math.hypot(p[0] - arc.c[0], p[1] - arc.c[1]) - arc.r) < 1e-6 && curves[i] && Math.abs(Math.hypot(curves[i]!.mid[0] - arc.c[0], curves[i]!.mid[1] - arc.c[1]) - arc.r) < 1e-6);
      return { hole: k > 0, pts, curves, ...(round ? { circle: { c: arc.c, r: arc.r } } : {}) };
    }));
  } finally {
    shape.delete();
    finished?.delete();
    for (const s of slices) s.delete();
  }
}

/** Cuts moved for the beam's `kerf` (mm wide): the outline out by half of it, holes in, so the part comes out true; arcs stay arcs. */
export function withKerf(cuts: Cut[], kerf: number): Cut[] {
  if (!kerf) return cuts;
  const d = (c: Cut) => (c.hole ? -kerf / 2 : kerf / 2);
  return cuts.map((c) => ({ ...c, ...offsetPath({ kind: 'polygon', pts: c.pts, curves: c.curves, r: 0, rot: 0 }, d(c)), ...(c.circle ? { circle: { c: c.circle.c, r: Math.max(0.001, c.circle.r + d(c)) } } : {}) }));
}

const f = (x: number) => +x.toFixed(4);

/** The cuts' box (min x, min y, max x, max y). */
function boxOf(cuts: Cut[]) {
  const all = cuts.map((c) => (c.circle ? [c.circle.c[0] - c.circle.r, c.circle.c[1] - c.circle.r, c.circle.c[0] + c.circle.r, c.circle.c[1] + c.circle.r] : bounds({ kind: 'polygon', pts: c.pts, curves: c.curves, r: 0, rot: 0 })));
  return [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...all.map((b) => b[k])));
}

/** A side's arc: radius, more than half round, running with rising angle (as SVG's flags have it); null: straight or a bezier. */
function arcFlags(a: P2, c: Curve | null, b: P2) {
  const arc = c && 'mid' in c ? arcOf(a, c.mid, b) : null;
  return arc && { r: arc.r, large: Math.abs(arc.a1 - arc.a0) > Math.PI, rising: arc.a1 > arc.a0, turn: arc.a1 - arc.a0 };
}

/** An SVG of the cuts at 1:1 in mm (`margin` around them), red hairlines as lasers take them; arcs as arcs, beziers as cubics. */
export function svgOf(cuts: Cut[], margin = 2): string {
  const [x0, y0, x1, y1] = boxOf(cuts);
  const [x, y, w, h] = [x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin];
  const shapes = cuts.map((c) => {
    if (c.circle) return `<circle cx="${f(c.circle.c[0])}" cy="${f(c.circle.c[1])}" r="${f(c.circle.r)}"/>`;
    const sides = c.pts.map((a, i) => {
      const [b, k] = [c.pts[(i + 1) % c.pts.length], c.curves[i]];
      const arc = arcFlags(a, k, b);
      if (arc) return `A${f(arc.r)} ${f(arc.r)} 0 ${+arc.large} ${+arc.rising} ${f(b[0])} ${f(b[1])}`;
      return k && 'c1' in k ? `C${f(k.c1[0])} ${f(k.c1[1])} ${f(k.c2[0])} ${f(k.c2[1])} ${f(b[0])} ${f(b[1])}` : `L${f(b[0])} ${f(b[1])}`;
    });
    return `<path d="M${f(c.pts[0][0])} ${f(c.pts[0][1])}${sides.slice(0, -1).join('')}${sides.at(-1)!.startsWith('L') ? '' : sides.at(-1)}Z"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}">
  <g fill="none" stroke="#ff0000" stroke-width="0.1">
    ${shapes.join('\n    ')}
  </g>
</svg>
`;
}

/** A DXF (R12, mm) of the cuts: closed polylines (arcs as bulges, beziers as arcs within 1 µm) and circles, y up as DXF has it. */
export function dxfOf(cuts: Cut[]): string {
  const out: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
  for (const c of cuts) {
    if (c.circle) {
      out.push(0, 'CIRCLE', 8, 'CUT', 10, f(c.circle.c[0]), 20, f(-c.circle.c[1]), 30, 0, 40, f(c.circle.r));
      continue;
    }
    out.push(0, 'POLYLINE', 8, 'CUT', 66, 1, 10, 0, 20, 0, 30, 0, 70, 1);
    const vertex = ([x, y]: P2, bulge = 0) => out.push(0, 'VERTEX', 8, 'CUT', 10, f(x), 20, f(-y), 30, 0, ...(bulge ? [42, +bulge.toFixed(9)] : []));
    // a bulge: tan of a quarter of the arc's angle, counter-clockwise positive (y flipped: turned round)
    const bulge = (a: P2, k: Curve | null, b: P2) => {
      const arc = arcFlags(a, k, b);
      return arc ? -Math.tan(arc.turn / 4) : 0;
    };
    c.pts.forEach((a, i) => {
      const [b, k] = [c.pts[(i + 1) % c.pts.length], c.curves[i]];
      if (!k || !('c1' in k)) return vertex(a, bulge(a, k, b));
      // a bezier as arcs within 1 µm
      const bez = (t: number, d = 0): P2 => [0, 1].map((m) => (d ? 3 * (1 - t) ** 2 * (k.c1[m] - a[m]) + 6 * (1 - t) * t * (k.c2[m] - k.c1[m]) + 3 * t ** 2 * (b[m] - k.c2[m]) : (1 - t) ** 3 * a[m] + 3 * (1 - t) ** 2 * t * k.c1[m] + 3 * (1 - t) * t ** 2 * k.c2[m] + t ** 3 * b[m])) as P2;
      const fit = biarcs((t) => bez(t), (t) => bez(t, 1));
      fit.curves.forEach((c, j) => vertex(fit.pts[j], bulge(fit.pts[j], c, fit.pts[j + 1])));
    });
    out.push(0, 'SEQEND', 8, 'CUT');
  }
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}

/** A laser SVG of a body (see `laserCuts`). */
export const laserSvg = (features: BuildFeature[], margin = 2) => svgOf(laserCuts(features), margin);
