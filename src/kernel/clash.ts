import { measureDistanceBetween, measureVolume, type Shape3D } from 'replicad';
import type { Place } from '../doc/frames';
import { grownShape, placeShape, swept, type Sweep } from './build';
import type { Solid } from './measure';

/**
 * What to check: `of` against all `bodies` as they are placed, each of `of` grown by `clearance` (0: only real overlaps);
 * then each joint in `motions` through its positions, one at a time: the bodies it moves against those it does not.
 */
export type ClashAsk = {
  bodies: { id: string; place: Place }[];
  of: string[];
  clearance: number;
  /** What moves is what `places` names, the same in every step; `sweep`: its way from the first step to the last, in the world. */
  motions: { joint: string; sweep: Sweep; steps: { value: number; places: Record<string, Place> }[] }[];
  ignore: string[];
};
/** Two bodies overlapping, within the clearance: the shared part in the world (a joint's: all it ever shares on the way); `joint` and `value`: where it starts; `closest`: their real distance there. */
export type ClashHit = { a: string; b: string; volume: number; joint?: string; value?: number; closest?: number; vertices: Float32Array; indices: Uint32Array };
/** The clearance zone around a body, in the world. */
export type ClashZone = { id: string; vertices: Float32Array; indices: Uint32Array };
/** `sweeps`: the space what a joint moves goes through; `failed`: bodies that could not grow (no zone; their distances measured instead, on a joint's way only overlaps). */
export type ClashResult = { hits: ClashHit[]; zones: ClashZone[]; sweeps: ClashZone[]; failed: string[]; stopped?: boolean };

export const pairKey = (a: string, b: string) => [a, b].sort().join(' ');

function merged(parts: { vertices: Float32Array; indices: Uint32Array }[]) {
  const [nv, ni] = [parts.reduce((n, p) => n + p.vertices.length, 0), parts.reduce((n, p) => n + p.indices.length, 0)];
  const [vertices, indices] = [new Float32Array(nv), new Uint32Array(ni)];
  let [v, i] = [0, 0];
  for (const p of parts) {
    vertices.set(p.vertices, v);
    for (let k = 0; k < p.indices.length; k++) indices[i + k] = p.indices[k] + v / 3;
    v += p.vertices.length;
    i += p.indices.length;
  }
  return { vertices, indices };
}

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

/** Thrown at a pause when the check was stopped. */
const STOP = Symbol('stop');

/** `stopped` is asked at pauses, when other messages get their turn: what was found so far comes back. */
export async function clashes(solids: Map<string, Solid>, ask: ClashAsk, stopped: () => boolean = () => false): Promise<ClashResult> {
  const out: ClashResult = { hits: [], zones: [], sweeps: [], failed: [] };
  const of = new Set(ask.of);
  const known = ask.bodies.filter((b) => solids.has(b.id));
  const seen = new Set(ask.ignore);
  const held = new Set<Shape3D>();
  const hold = (s: Shape3D) => (held.add(s), s);
  const drop = (s: Shape3D) => (held.delete(s), s.delete());
  let breathed = performance.now();
  const pause = async () => {
    if (performance.now() - breathed < 40) return;
    await new Promise((go) => setTimeout(go));
    breathed = performance.now();
    if (stopped()) throw STOP;
  };
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
  const test = async (a: string, b: string, pa: Place, pb: Place) => {
    const [[a0, a1], [b0, b1]] = [worldBox(a, pa), worldBox(b, pb)];
    const reach = ask.clearance + 1e-6;
    if ([0, 1, 2].some((k) => a1[k] + reach < b0[k] || b1[k] + reach < a0[k])) return;
    await pause();
    const [g, o] = lead(a, b);
    const [pg, po] = g === a ? [pa, pb] : [pb, pa];
    const local = ask.clearance > 0 ? grown(g) : null;
    const [real, other] = [at(solids.get(g)!.shape, pg), at(solids.get(o)!.shape, po)];
    const wide = local ? at(local, pg) : real;
    try {
      const hit = shared(wide, other);
      // not grown (it could not be): the real distance tells, with only an overlap to show
      const closest = !(ask.clearance > 0) ? undefined : hit ? (local ? measureDistanceBetween(real, other) : 0) : local ? Infinity : measureDistanceBetween(real, other);
      if (!hit && !(closest! < ask.clearance)) return;
      seen.add(pairKey(a, b));
      out.hits.push({ a: g, b: o, volume: hit?.volume ?? 0, ...(closest === undefined ? {} : { closest }), ...(hit ? meshed(hit.common) : { vertices: new Float32Array(), indices: new Uint32Array() }) });
      hit?.common.delete();
    } finally {
      real.delete();
      other.delete();
      if (wide !== real) wide.delete();
    }
  };
  try {
    // each joint on its whole way: what it moves, swept, against what it does not, wherever it is now. A clearance grows
    // the still one: the same answer as the moving one grown, and the sweep stays its few plain faces
    const near = (u: number[][], v: number[][], reach: number) => ![0, 1, 2].some((k) => u[1][k] + reach < v[0][k] || v[1][k] + reach < u[0][k]);
    for (const { joint, sweep, steps } of ask.motions) {
      const first = steps[0];
      for (const m of known.filter((x) => first?.places[x.id])) {
        const others = known.filter((b) => !first.places[b.id] && !seen.has(pairKey(m.id, b.id)) && (of.has(m.id) || of.has(b.id)));
        // the box of its way, a bit bigger as steps cut the corners of an arc
        const boxes = steps.map((step) => worldBox(m.id, step.places[m.id]));
        const way = [0, 1].map((e) => [0, 1, 2].map((k) => (e ? Math.max : Math.min)(...boxes.map((x) => x[e][k]))));
        const slack = Math.hypot(...[0, 1, 2].map((k) => way[1][k] - way[0][k])) * 0.01;
        const inReach = others.filter((b) => near(way, worldBox(b.id, b.place), ask.clearance + slack));
        if (!inReach.length && !of.has(m.id)) continue;
        const placed = at(solids.get(m.id)!.shape, first.places[m.id]);
        const pieces = swept(placed, sweep).map(hold);
        placed.delete();
        if (of.has(m.id) && pieces.length) out.sweeps.push({ id: m.id, ...merged(pieces.map(meshed)) });
        for (const b of inReach) {
          // not grown (it could not be): at least what it overlaps on the way
          const local = (ask.clearance > 0 && grown(b.id)) || solids.get(b.id)!.shape;
          const other = hold(at(local, b.place));
          const parts: ReturnType<typeof meshed>[] = [];
          let volume = 0;
          for (const piece of pieces) {
            await pause();
            const hit = shared(piece, other);
            if (!hit) continue;
            parts.push(meshed(hit.common));
            volume = Math.max(volume, hit.volume);
            hit.common.delete();
          }
          // where it starts on the way
          let start: { value: number; closest?: number } | null = null;
          const box = worldBox(b.id, b.place);
          for (const step of steps) {
            if (!near(worldBox(m.id, step.places[m.id]), box, ask.clearance + 1e-6)) continue;
            const moved = at(solids.get(m.id)!.shape, step.places[m.id]);
            const hit = shared(moved, other);
            if (hit) {
              let closest: number | undefined;
              if (ask.clearance > 0) {
                const real = at(solids.get(b.id)!.shape, b.place);
                closest = measureDistanceBetween(moved, real);
                real.delete();
              }
              start = { value: step.value, closest };
              if (!parts.length) parts.push(meshed(hit.common)); // what stays inside it all along: nothing sweeps past it
              volume = Math.max(volume, hit.volume);
              hit.common.delete();
            }
            moved.delete();
            if (hit) break;
          }
          drop(other);
          if (!parts.length) continue;
          seen.add(pairKey(m.id, b.id));
          out.hits.push({ a: m.id, b: b.id, volume, joint, ...(start ? { value: start.value, ...(start.closest === undefined ? {} : { closest: start.closest }) } : {}), ...merged(parts) });
        }
        pieces.forEach(drop);
      }
    }
    // as they are now
    for (const [i, a] of known.entries())
      for (const b of known.slice(i + 1)) if (!seen.has(pairKey(a.id, b.id)) && (of.has(a.id) || of.has(b.id))) await test(a.id, b.id, a.place, b.place);
    if (ask.clearance > 0)
      for (const b of known)
        if (of.has(b.id) && grown(b.id)) {
          const zone = at(grown(b.id)!, b.place);
          out.zones.push({ id: b.id, ...meshed(zone) });
          zone.delete();
        }
  } catch (err) {
    if (err !== STOP) throw err;
    out.stopped = true;
  } finally {
    held.forEach((s) => s.delete());
  }
  return out;
}
