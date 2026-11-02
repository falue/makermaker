import type { BuildFeature } from '../kernel/build';
import { extent, frames, toPlane, toWorld, unplaced, type Frame, type V3 } from './frames';
import { centre, corners, inside, type DrawnProfile } from './profiles';
import type { Resolved } from './resolve';
import type { ExtrudeIn } from './types';

type UV = [number, number];

/**
 * A face that can be pushed or pulled: an extrusion's end face (its depth changes) or a side made by one edge of a
 * shape (`edge`: index of a straight side between corners `edge` and `edge + 1`; -1: a circle). `rate`: how far
 * the depth or the edge moves per mm the face moves outwards.
 */
export type PulledFace = { kind: 'cap'; feature: string; rate: number; back?: boolean } | { kind: 'side'; feature: string; shape: string; edge: number; rate: number };

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * The extrusion face at body point `p` with outward normal `out` (body coordinates); tool bodies of booleans count
 * too. The last feature that made such a face wins. `eps`: mm, the mesh is that far off curved faces.
 */
export function faceAt(features: BuildFeature[], p: V3, out: V3, eps = 0.05): PulledFace | null {
  const plan = frames(features.filter((f) => f.type !== 'boolean'));
  let found: PulledFace | null = null;
  for (const s of features) {
    if (s.type === 'boolean') found = faceAt(s.features, unplaced(s.place, p), unplaced(s.place, out, true), eps) ?? found;
    const f = s.type === 'extrude' && plan.get(s.id);
    if (f) found = extrudeFace(s as Resolved<ExtrudeIn>, f, p, out, eps) ?? found;
  }
  return found;
}

function extrudeFace(s: Resolved<ExtrudeIn>, f: Frame, p: V3, out: V3, eps: number): PulledFace | null {
  const h = dot(sub(p, f.o), f.n);
  const along = dot(out, f.n);
  const [u, v] = toPlane(f, p);
  const [from, to] = extent(s.depth, s.back);
  if (Math.abs(along) > 0.999) {
    if (s.through || !s.profiles.some((q) => inside(q, u, v))) return null;
    if (Math.abs(h - s.depth) < eps) return { kind: 'cap', feature: s.id, rate: along };
    // the face behind the plane (when it reaches back): moving it out makes `back` longer
    const behind = -(Math.sign(s.depth) || 1);
    return s.back && Math.abs(h - behind * s.back) < eps ? { kind: 'cap', feature: s.id, rate: behind * along, back: true } : null;
  }
  if (Math.abs(along) > 0.02) return null;
  if (!s.through && (h < from - eps || h > to + eps)) return null;
  const len = Math.hypot(dot(out, f.x), dot(out, f.y));
  const n: UV = [dot(out, f.x) / len, dot(out, f.y) / len];
  for (const q of s.profiles) {
    const side = sideOf(q, [u, v], n, eps);
    if (side) return { kind: 'side', feature: s.id, shape: q.id, ...side };
  }
  return null;
}

/**
 * Frame of the side face made by straight side `edge` of shape `shape` in extrusion `feature` (body coordinates):
 * origin at the side's first corner on the sketch plane, x along the side, n out of the shape (`flip`: into it, for
 * hole walls), y = n × x.
 */
export function sideFrame(features: BuildFeature[], feature: string, shape: string, edge: number, flip = false): Frame | undefined {
  const s = features.find((f) => f.id === feature);
  const f = frames(features.filter((t) => t.type !== 'boolean')).get(feature);
  const p = s?.type === 'extrude' ? s.profiles.find((q) => q.id === shape) : undefined;
  if (!f || !p || p.kind === 'circle') return undefined;
  const pts = corners(p);
  if (edge >= pts.length) return undefined;
  const m = normalOf(pts, edge, counterClockwise(pts));
  const [a, b] = [pts[edge], pts[(edge + 1) % pts.length]];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const along = (u: number, v: number): V3 => [f.x[0] * u + f.y[0] * v, f.x[1] * u + f.y[1] * v, f.x[2] * u + f.y[2] * v];
  const k = flip ? -1 : 1;
  const x = along((k * (b[0] - a[0])) / l, (k * (b[1] - a[1])) / l);
  const n = along(k * m[0], k * m[1]);
  const y: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  return { o: toWorld(f, ...a), x, y, n };
}

/** Outward unit normal of the side from corner `i` to the next (`ccw`: corners run counter-clockwise). */
function normalOf(pts: UV[], i: number, ccw: boolean): UV {
  const [[x0, y0], [x1, y1]] = [pts[i], pts[(i + 1) % pts.length]];
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return ccw ? [(y1 - y0) / l, (x0 - x1) / l] : [(y0 - y1) / l, (x1 - x0) / l];
}

const counterClockwise = (pts: UV[]) => pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0) > 0;

/** The side of shape `p` through plane point `q` whose normal is ±`n`; `rate` +1 when `n` points out of the shape. */
export function sideOf(p: DrawnProfile, [u, v]: UV, n: UV, eps: number): { edge: number; rate: number } | null {
  if (p.kind === 'circle') {
    const r = Math.hypot(u - p.x, v - p.y);
    if (Math.abs(r - p.d / 2) > eps) return null;
    const c = ((u - p.x) * n[0] + (v - p.y) * n[1]) / r;
    return Math.abs(c) > 0.9 ? { edge: -1, rate: Math.sign(c) } : null;
  }
  const pts = corners(p);
  const ccw = counterClockwise(pts);
  for (let i = 0; i < pts.length; i++) {
    const [[x0, y0], [x1, y1]] = [pts[i], pts[(i + 1) % pts.length]];
    const [dx, dy] = [x1 - x0, y1 - y0];
    const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(u - x0 - t * dx, v - y0 - t * dy) > eps) continue;
    const m = normalOf(pts, i, ccw);
    const c = m[0] * n[0] + m[1] * n[1];
    if (Math.abs(c) > 0.99) return { edge: i, rate: Math.sign(c) };
  }
  return null;
}

/**
 * Shape `p` with side `edge` moved `by` mm outwards: rect sides move alone, circles and regular polygons grow evenly.
 * A side pushed past the opposite one goes on through it: the shape lies beyond it (sizes stay positive).
 */
export function pushed(p: DrawnProfile, edge: number, by: number): DrawnProfile {
  if (p.kind === 'line') return p; // never extruded: no side
  if (p.kind === 'circle') return { ...p, d: Math.abs(p.d + 2 * by) };
  if (p.kind === 'ngon') return { ...p, d: Math.abs(p.d + (2 * by) / Math.cos(Math.PI / Math.max(3, Math.round(p.sides)))) };
  const a = (p.rot * Math.PI) / 180;
  const turn = ([x, y]: UV, k: number): UV => [x * Math.cos(k) - y * Math.sin(k), x * Math.sin(k) + y * Math.cos(k)];
  if (p.kind === 'rect') {
    const dir: UV = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as UV[])[edge]; // corners run bottom, right, top, left
    const [gx, gy] = turn([(dir[0] * by) / 2, (dir[1] * by) / 2], a);
    return { ...p, x: p.x + gx, y: p.y + gy, w: Math.abs(p.w + Math.abs(dir[0]) * by), h: Math.abs(p.h + Math.abs(dir[1]) * by) };
  }
  // polygon: both corners of the side move; corners are stored unturned around their (new) centre
  const pts = corners(p);
  const m = normalOf(pts, edge, counterClockwise(pts));
  const moved = pts.map(([x, y], i): UV => (i === edge || i === (edge + 1) % pts.length ? [x + m[0] * by, y + m[1] * by] : [x, y]));
  const c = centre({ ...p, pts: moved });
  return { ...p, pts: moved.map(([x, y]) => turn([x - c[0], y - c[1]], -a).map((w, k) => w + c[k]) as UV) };
}
