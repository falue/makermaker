import { FaceFinder, measureArea, type Edge, type Face, type Wire } from 'replicad';
import { grown } from '../doc/profiles';
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

/** One closed cut of a part: a loop of points, or a circle (kept as one); `hole`: inside the outline. */
export type Cut = { hole: boolean; pts: P2[]; circle?: { c: P2; r: number } };

/** An edge as points: straight edges by their ends, curves every `step` mm (at least 16 pieces). */
function pointsOf(e: Edge, step = 0.5): V3[] {
  const n = e.geomType === 'LINE' ? 1 : Math.max(16, Math.ceil(e.length / step));
  return Array.from({ length: n + 1 }, (_, i) => e.pointAt(i / n).toTuple() as V3);
}

/**
 * A wire's edges chained into one closed loop of points (the start not repeated). OpenCascade lists them in no set
 * order or direction: each next one is the edge with an end nearest the loop's end, turned to follow it.
 */
function loopOf(w: Wire): V3[] {
  const left = w.edges.map((e) => pointsOf(e));
  const out = left.shift()!;
  while (left.length) {
    const end = out.at(-1)!;
    const gap = (p: V3) => Math.hypot(...sub(p, end));
    let [best, flip, d] = [0, false, Infinity];
    left.forEach((pts, i) => {
      for (const [p, f] of [[pts[0], false], [pts.at(-1)!, true]] as const) if (gap(p) < d) [best, flip, d] = [i, f, gap(p)];
    });
    const pts = left.splice(best, 1)[0];
    out.push(...(flip ? pts.reverse() : pts).slice(1));
  }
  return Math.hypot(...sub(out[0], out.at(-1)!)) < 1e-6 ? out.slice(0, -1) : out;
}

/**
 * A body's cuts for the laser: a flat face (the one through body point `at` facing `n`; else its biggest) with its
 * holes, at 1:1 in mm, built without fillets and chamfers. Looking at the face from outside; x as level as possible.
 */
export function laserCuts(features: BuildFeature[], face?: { at: V3; n: V3 }): Cut[] {
  const shape = buildBody(features.filter((f) => f.type !== 'finish'));
  try {
    const flat = shape.faces.filter((f) => f.geomType === 'PLANE');
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
    // the outline and each hole (both calls use up the face they are called on)
    return [chosen.clone().outerWire(), ...chosen.clone().innerWires()].map((w, k): Cut => {
      const edges = w.edges;
      const pts = loopOf(w).map(flatten);
      // all its edges arcs, every point as far from the middle: one circle (OpenCascade may split it in two)
      const c: P2 = [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
      const r = Math.hypot(pts[0][0] - c[0], pts[0][1] - c[1]);
      const round = edges.every((e) => e.geomType === 'CIRCLE') && pts.every((p) => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r) < 1e-3);
      return round ? { hole: k > 0, pts, circle: { c, r } } : { hole: k > 0, pts };
    });
  } finally {
    shape.delete();
  }
}

/** Cuts moved for the beam's `kerf` (mm wide): the outline out by half of it, holes in, so the part comes out true. */
export function withKerf(cuts: Cut[], kerf: number): Cut[] {
  if (!kerf) return cuts;
  const d = (c: Cut) => (c.hole ? -kerf / 2 : kerf / 2);
  return cuts.map((c) => ({ ...c, pts: grown(c.pts, d(c)), ...(c.circle ? { circle: { c: c.circle.c, r: Math.max(0.001, c.circle.r + d(c)) } } : {}) }));
}

const f = (x: number) => +x.toFixed(4);

/** The cuts' box (min x, min y, max x, max y). */
function boxOf(cuts: Cut[]) {
  const all = cuts.flatMap((c) => (c.circle ? [[c.circle.c[0] - c.circle.r, c.circle.c[1] - c.circle.r], [c.circle.c[0] + c.circle.r, c.circle.c[1] + c.circle.r]] : c.pts));
  return [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
}

/** An SVG of the cuts at 1:1 in mm (`margin` around them), red hairlines as lasers take them. */
export function svgOf(cuts: Cut[], margin = 2): string {
  const [x0, y0, x1, y1] = boxOf(cuts);
  const [x, y, w, h] = [x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin];
  const shapes = cuts.map((c) =>
    c.circle ? `<circle cx="${f(c.circle.c[0])}" cy="${f(c.circle.c[1])}" r="${f(c.circle.r)}"/>` : `<path d="M${c.pts.map(([px, py]) => `${f(px)} ${f(py)}`).join('L')}Z"/>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}">
  <g fill="none" stroke="#ff0000" stroke-width="0.1">
    ${shapes.join('\n    ')}
  </g>
</svg>
`;
}

/** A DXF (R12, mm) of the cuts: closed polylines and circles, y up as DXF has it. */
export function dxfOf(cuts: Cut[]): string {
  const out: (string | number)[] = [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES'];
  for (const c of cuts) {
    if (c.circle) out.push(0, 'CIRCLE', 8, 'CUT', 10, f(c.circle.c[0]), 20, f(-c.circle.c[1]), 30, 0, 40, f(c.circle.r));
    else {
      out.push(0, 'POLYLINE', 8, 'CUT', 66, 1, 10, 0, 20, 0, 30, 0, 70, 1);
      for (const [x, y] of c.pts) out.push(0, 'VERTEX', 8, 'CUT', 10, f(x), 20, f(-y), 30, 0);
      out.push(0, 'SEQEND', 8, 'CUT');
    }
  }
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}

/** A laser SVG of a body (see `laserCuts`). */
export const laserSvg = (features: BuildFeature[], margin = 2) => svgOf(laserCuts(features), margin);
