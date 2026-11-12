import { basicFaceExtrusion, drawRectangle, FaceFinder, measureArea, Plane, Vector, type Edge, type Face, type Shape3D, type Sketch, type Wire } from 'replicad';
import { arcOf, biarcs, offsetPath } from '../doc/profiles';
import { svgOf, type Cut } from '../io/cutfile';
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
 * corners show, rounded or chamfered faces' edges do not shrink it); with flat faces at an angle to it (a slanted part), the whole
 * body as seen from the face, where those faces meet as marks. Looking at the face from outside; x as level as possible.
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
    let marks: Cut[] = [];
    // faces looking the same way, some at an angle to it (a slanted part): the whole body as seen from the face
    const front = flat.filter((f) => dot(unit(f.normalAt(f.center).toTuple() as V3), n) > 1e-6);
    if (!finished && front.some((f) => dot(unit(f.normalAt(f.center).toTuple() as V3), n) < 1 - 1e-6)) {
      cut = projected(shape, front, n, slices);
      marks = creases(front, flatten);
    } else if (finished) {
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
    return [...marks, ...cut.flatMap((f) => [f.clone().outerWire(), ...f.clone().innerWires()].map((w, k): Cut => {
      const edges = w.edges;
      const { pts, curves } = loopOf(w, flatten);
      // all its edges arcs of one circle: one circle (OpenCascade may split it in two)
      const arc = edges.every((e) => e.geomType === 'CIRCLE') && curves[0] ? arcOf(pts[0], curves[0].mid, pts[1 % pts.length]) : null;
      const round = arc && pts.every((p, i) => Math.abs(Math.hypot(p[0] - arc.c[0], p[1] - arc.c[1]) - arc.r) < 1e-6 && curves[i] && Math.abs(Math.hypot(curves[i]!.mid[0] - arc.c[0], curves[i]!.mid[1] - arc.c[1]) - arc.r) < 1e-6);
      return { hole: k > 0, pts, curves, ...(round ? { circle: { c: arc.c, r: arc.r } } : {}) };
    }))];
  } finally {
    shape.delete();
    finished?.delete();
    for (const s of slices) s.delete();
  }
}

/**
 * `shape` as seen along `n`, flat: each of its faces looking that way (`front`; together they cover what is seen)
 * pushed along -n past its lowest point, the faces where they all cross a plane there. Kept in `keep` for deleting.
 */
function projected(shape: Shape3D, front: Face[], n: V3, keep: Shape3D[]): Face[] {
  const [lo, hi] = shape.boundingBox.bounds as [V3, V3];
  const along = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => dot([k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]], n));
  const [low, high] = [Math.min(...along), Math.max(...along)];
  const down = new Vector(n.map((x) => -x * (high - low + 2)) as V3);
  let all: Shape3D | null = null;
  for (const f of front) {
    const prism = basicFaceExtrusion(f.clone() as Face, down) as Shape3D;
    const next: Shape3D = all ? all.fuse(prism) : prism;
    if (all) (all.delete(), prism.delete());
    all = next;
  }
  // a sheet square to n, 1 mm below the lowest point
  const size = 4 * Math.hypot(...sub(hi, lo)) + 10;
  const x = Math.abs(n[2]) > 0.999 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n));
  const sheet = (drawRectangle(size, size).sketchOnPlane(new Plane(n.map((v) => v * (low - 1)) as V3, x, n)) as Sketch).face();
  const flat = all!.intersect(sheet);
  all!.delete();
  keep.push(flat);
  return facesOf(flat);
}

/** Where two faces of `front` meet at an angle: open lines, flat (`flatten`), drawn as marks (see `Cut`). */
function creases(front: Face[], flatten: (p: V3) => P2): Cut[] {
  const key = (e: Edge) => [e.startPoint, e.endPoint, e.pointAt(0.5)].map((p) => p.toTuple().map((v) => v.toFixed(4)).join(' ')).sort().join('|');
  const out: Cut[] = [];
  front.forEach((a, i) => {
    const na = unit(a.normalAt(a.center).toTuple() as V3);
    const mine = new Set(a.edges.map(key));
    for (const b of front.slice(i + 1)) {
      if (dot(na, unit(b.normalAt(b.center).toTuple() as V3)) > 1 - 1e-6) continue;
      for (const e of b.edges) {
        if (!mine.has(key(e))) continue;
        const { pts, curves } = sidesOf(e, flatten);
        out.push({ hole: false, pts, curves, open: true, mark: true });
      }
    }
  });
  return out;
}

/** Cuts moved for the beam's `kerf` (mm wide): the outline out by half of it, holes in, so the part comes out true; arcs stay arcs. */
export function withKerf(cuts: Cut[], kerf: number): Cut[] {
  if (!kerf) return cuts;
  const d = (c: Cut) => (c.hole ? -kerf / 2 : kerf / 2);
  return cuts.map((c) => c.mark ? c : ({ ...c, ...offsetPath({ kind: 'polygon', pts: c.pts, curves: c.curves, r: 0, rot: 0 }, d(c)), ...(c.circle ? { circle: { c: c.circle.c, r: Math.max(0.001, c.circle.r + d(c)) } } : {}) }));
}

/** A laser SVG of a body (see `laserCuts`). */
export const laserSvg = (features: BuildFeature[], margin = 2) => svgOf(laserCuts(features), margin);
