import { measureDistanceBetween, measureVolume, type Shape3D } from 'replicad';
import type { Place } from '../doc/frames';
import { grownShape, placeShape } from './build';
import type { Solid } from './measure';

/**
 * What to check: `of` against all `bodies` as they are placed, each of `of` grown by `clearance` (0: only real overlaps);
 * then each joint in `motions` through its positions, one at a time: the bodies it moves against those it does not.
 */
export type ClashAsk = {
  bodies: { id: string; place: Place }[];
  of: string[];
  clearance: number;
  motions: { joint: string; steps: { value: number; places: Record<string, Place> }[] }[];
  ignore: string[];
};
/** Two bodies overlapping, within the clearance: the shared part in the world; `joint` and `value`: first found there; `closest`: their real distance. */
export type ClashHit = { a: string; b: string; volume: number; joint?: string; value?: number; closest?: number; vertices: Float32Array; indices: Uint32Array };
/** The clearance zone around a body, in the world. */
export type ClashZone = { id: string; vertices: Float32Array; indices: Uint32Array };
export type ClashResult = { hits: ClashHit[]; zones: ClashZone[]; failed: string[] };

export const pairKey = (a: string, b: string) => [a, b].sort().join(' ');

/** Touching does not count (mm³). */
const NOTHING = 1e-3;

function meshed(shape: Shape3D) {
  const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
  return { vertices: new Float32Array(m.vertices), indices: new Uint32Array(m.triangles) };
}

const apart = (u: Shape3D, v: Shape3D) => {
  const [[a0, a1], [b0, b1]] = [u.boundingBox.bounds, v.boundingBox.bounds];
  return [0, 1, 2].some((k) => a1[k] < b0[k] || b1[k] < a0[k]);
};

/** The part `u` and `v` share, if it has any volume. */
function shared(u: Shape3D, v: Shape3D) {
  if (apart(u, v)) return null;
  const common = u.intersect(v) as Shape3D;
  const volume = measureVolume(common);
  if (volume > NOTHING) return { common, volume };
  common.delete();
  return null;
}

export function clashes(solids: Map<string, Solid>, ask: ClashAsk): ClashResult {
  const out: ClashResult = { hits: [], zones: [], failed: [] };
  const of = new Set(ask.of);
  const known = ask.bodies.filter((b) => solids.has(b.id));
  const seen = new Set(ask.ignore);
  const held: Shape3D[] = [];
  const hold = (s: Shape3D) => (held.push(s), s);
  const at = (shape: Shape3D, place: Place) => placeShape(shape.clone(), place);
  // grown once, in the body's own coordinates
  const grownLocal = new Map<string, Shape3D | null>();
  const grown = (id: string) => {
    if (!grownLocal.has(id)) {
      try {
        grownLocal.set(id, hold(grownShape(solids.get(id)!.shape, ask.clearance, true)));
      } catch {
        grownLocal.set(id, null);
        out.failed.push(id);
      }
    }
    return grownLocal.get(id)!;
  };
  /** Which of a pair gets grown: one being checked. */
  const lead = (a: string, b: string) => (of.has(a) ? [a, b] : [b, a]);
  /** The box around a body where it is, from its own box's corners (a bit bigger when turned): no copying, so most pairs are out at once. */
  const boundsOf = new Map<string, number[][]>();
  const worldBox = (id: string, { axis, angle, offset }: Place) => {
    if (!boundsOf.has(id)) boundsOf.set(id, solids.get(id)!.shape.boundingBox.bounds);
    const [lo, hi] = boundsOf.get(id)!;
    const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
    const l = Math.hypot(...axis) || 1;
    const [ux, uy, uz] = axis.map((v) => v / l);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const x of [lo[0], hi[0]])
      for (const y of [lo[1], hi[1]])
        for (const z of [lo[2], hi[2]]) {
          const d = (ux * x + uy * y + uz * z) * (1 - c);
          const q = [x * c + (uy * z - uz * y) * s + ux * d, y * c + (uz * x - ux * z) * s + uy * d, z * c + (ux * y - uy * x) * s + uz * d];
          q.forEach((v, k) => ((min[k] = Math.min(min[k], v + offset[k])), (max[k] = Math.max(max[k], v + offset[k]))));
        }
    return [min, max];
  };
  /** The pair where they are; a hit is noted and the pair is done. */
  const test = (a: string, b: string, pa: Place, pb: Place, joint?: { joint: string; value: number }) => {
    const [[a0, a1], [b0, b1]] = [worldBox(a, pa), worldBox(b, pb)];
    const reach = ask.clearance + 1e-6;
    if ([0, 1, 2].some((k) => a1[k] + reach < b0[k] || b1[k] + reach < a0[k])) return;
    const [g, o] = lead(a, b);
    const [pg, po] = g === a ? [pa, pb] : [pb, pa];
    const local = ask.clearance > 0 ? grown(g) : null;
    const [real, other] = [at(solids.get(g)!.shape, pg), at(solids.get(o)!.shape, po)];
    const wide = local ? at(local, pg) : real;
    try {
      const hit = shared(wide, other);
      if (!hit) return;
      seen.add(pairKey(a, b));
      out.hits.push({ a: g, b: o, volume: hit.volume, ...joint, ...(local ? { closest: measureDistanceBetween(real, other) } : {}), ...meshed(hit.common) });
      hit.common.delete();
    } finally {
      real.delete();
      other.delete();
      if (wide !== real) wide.delete();
    }
  };
  // as they are now
  for (const [i, a] of known.entries())
    for (const b of known.slice(i + 1)) if (!seen.has(pairKey(a.id, b.id)) && (of.has(a.id) || of.has(b.id))) test(a.id, b.id, a.place, b.place);
  // each joint through its positions: what it moves against what it does not; a pair found once is done
  for (const { joint, steps } of ask.motions)
    for (const { value, places } of steps)
      for (const m of known) {
        const place = places[m.id];
        if (!place) continue;
        for (const b of known)
          if (!places[b.id] && !seen.has(pairKey(m.id, b.id)) && (of.has(m.id) || of.has(b.id))) test(m.id, b.id, place, b.place, { joint, value });
      }
  if (ask.clearance > 0)
    for (const b of known)
      if (of.has(b.id) && grown(b.id)) {
        const zone = at(grown(b.id)!, b.place);
        out.zones.push({ id: b.id, ...meshed(zone) });
        zone.delete();
      }
  held.forEach((s) => s.delete());
  return out;
}
