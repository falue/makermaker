import { measureArea, type Edge, type Face, type Wire } from 'replicad';
import { buildBody, type BuildFeature } from './build';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** An edge as points: straight edges by their ends, curves every `step` mm (at least 16 pieces). */
function pointsOf(e: Edge, step = 0.5): V3[] {
  const n = e.geomType === 'LINE' ? 1 : Math.max(16, Math.ceil(e.length / step));
  return Array.from({ length: n + 1 }, (_, i) => e.pointAt(i / n).toTuple() as V3);
}

/** A wire's edges chained into one closed loop of points (each edge turned to follow the last). */
function loopOf(w: Wire): V3[] {
  const out: V3[] = [];
  for (const e of w.edges) {
    const pts = pointsOf(e);
    const last = out.at(-1);
    if (last && Math.hypot(...sub(pts[0], last)) > Math.hypot(...sub(pts.at(-1)!, last))) pts.reverse();
    out.push(...(last ? pts.slice(1) : pts));
  }
  return out;
}

/**
 * A laser SVG of a body (proof of concept): its biggest flat face, with holes, at 1:1 in mm, built without fillets
 * and chamfers. Looking at the face from outside; x as level as possible.
 */
export function laserSvg(features: BuildFeature[], margin = 2): string {
  const shape = buildBody(features.filter((f) => f.type !== 'finish'));
  try {
    const flat = shape.faces.filter((f) => f.geomType === 'PLANE');
    if (!flat.length) throw new Error('it has no flat face');
    const face: Face = flat.reduce((a, b) => (measureArea(b) > measureArea(a) ? b : a));
    const o = face.center.toTuple() as V3;
    const n = unit(face.normalAt(o).toTuple() as V3);
    const u = Math.abs(n[2]) > 0.999 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n));
    const v = cross(n, u);
    // the outline and each hole as one closed path (both calls use up the face they are called on); svg y points down
    const paths = [face.clone().outerWire(), ...face.clone().innerWires()].map((w) => loopOf(w).map((p) => [dot(sub(p, o), u), -dot(sub(p, o), v)]));
    const all = paths.flat();
    const [x0, y0] = [Math.min(...all.map((p) => p[0])) - margin, Math.min(...all.map((p) => p[1])) - margin];
    const [w, h] = [Math.max(...all.map((p) => p[0])) - x0 + margin, Math.max(...all.map((p) => p[1])) - y0 + margin];
    const f = (x: number) => +x.toFixed(4);
    const d = paths.map((pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`).join(' ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}">
  <path d="${d}" fill="none" stroke="#ff0000" stroke-width="0.1"/>
</svg>
`;
  } finally {
    shape.delete();
  }
}
