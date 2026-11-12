import { basicFaceExtrusion, cast, drawRectangle, FaceFinder, getOC, measureArea, measureVolume, Plane, Vector, type Edge, type Face, type Shape3D, type Sketch, type Wire } from 'replicad';
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
/** A point well inside a face (its middle may lie in a hole): the middle of its mesh's biggest triangle. */
function insidePoint(face: Face): V3 {
  new (getOC().BRepMesh_IncrementalMesh)(face.wrapped, 0.5, false, 0.5, false).delete();
  const t = face.triangulation();
  if (!t) return face.center.toTuple() as V3;
  const p = (i: number): V3 => [t.vertices[3 * i], t.vertices[3 * i + 1], t.vertices[3 * i + 2]];
  let best: [V3, number] = [face.center.toTuple() as V3, -1];
  for (let k = 0; k < t.trianglesIndexes.length; k += 3) {
    const [a, b, c] = [p(t.trianglesIndexes[k]), p(t.trianglesIndexes[k + 1]), p(t.trianglesIndexes[k + 2])];
    const area = Math.hypot(...cross(sub(b, a), sub(c, a)));
    if (area > best[1]) best = [[0, 1, 2].map((j) => (a[j] + b[j] + c[j]) / 3) as V3, area];
  }
  return best[0];
}

function facesOf(shape: Shape3D): Face[] {
  return new FaceFinder().find(shape);
}

/**
 * A body's cuts for the laser: a flat face (the one through body point `at` facing `n`; else its biggest) with its
 * holes, at 1:1 in mm; with fillets, chamfers or flat faces at an angle to it (a slanted part), the whole finished body
 * as seen from the face (rounded corners show, rounded or chamfered edges do not shrink it), where its flat faces meet
 * at an angle (as modelled, before fillets and chamfers) as marks. Looking at the face from outside; x as level as possible.
 */
export function laserCuts(features: BuildFeature[], face?: { at: V3; n: V3 }): Cut[] {
  const { cuts, solid } = laserPart(features, face);
  solid.delete();
  return cuts;
}

/**
 * A body's laser cuts (see `laserCuts`) and the part they make: the outlines cut straight through its sheet (from the
 * face to the biggest one facing the other way). With other bodies (in this body's coordinates) around it: where a
 * slanted side of the face (less than 45° off square) lies on one of `around`, the straight cut would push into it, so
 * the part as seen there is cut back to the side's inner edge (a mark there becomes the cut); where one of `parts`
 * (other bodies' laser parts) pushes into this body, the part as seen there is cut away to make room.
 */
export function laserPart(features: BuildFeature[], face?: { at: V3; n: V3 }, around: Shape3D[] = [], parts: Shape3D[] = []): { cuts: Cut[]; solid: Shape3D; anchor: { at: V3; dir: V3 } } {
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
    // a body with fillets, chamfers or faces at an angle to it (a slanted part): the whole of it as seen from the face
    const whole = finished ?? shape;
    const front = facesOf(whole).flatMap((f) => seen(f, n));
    const square = (f: Face) => f.geomType === 'PLANE' && dot(unit(f.normalAt(f.center).toTuple() as V3), n) > 1 - 1e-6;
    // what other laser parts push into
    const pushed = parts.flatMap((p) => {
      const hit = whole.clone().intersect(p);
      return measureVolume(hit) > 1e-2 ? (slices.push(hit), [hit]) : (hit.delete(), []);
    });
    const away = against(chosen, flat, n, around);
    if (finished || pushed.length || away.length || flat.some((f) => sees(f, n) && !square(f))) {
      cut = projected(whole, front, n, slices, [...away, ...pushed.flatMap((p) => facesOf(p).flatMap((f) => seen(f, n)))]);
      // the angles as modelled: not where fillets and chamfers meet, nor where cut back
      const gone = new Set(away.flatMap((f) => f.edges.map(edgeKey)));
      marks = creases(flat.filter((f) => sees(f, n)), flatten, gone);
    }
    // the part: the cut faces moved to the sheet's back (none: the body's lowest corner) and pushed through it
    const backs = flat.filter((f) => dot(unit(f.normalAt(f.center).toTuple() as V3), n) < -1 + 1e-6);
    const level = (p: V3) => dot(p, n);
    const back = backs.length ? level(backs.reduce((a, b) => (measureArea(b) > measureArea(a) ? b : a)).center.toTuple() as V3) : Math.min(...shape.edges.flatMap((e) => [e.startPoint, e.endPoint]).map((p) => level(p.toTuple() as V3)));
    const solid = prisms(cut.map((f) => f.clone().translate(...(n.map((x) => x * (back - level(f.center.toTuple() as V3))) as V3)) as Face), new Vector(n.map((x) => x * (level(o) - back)) as V3));
    if (!solid) throw new Error('it has no thickness facing that way');
    // the outlines and each one's holes (both calls use up the face they are called on)
    const cuts = [...marks, ...cut.flatMap((f) => [f.clone().outerWire(), ...f.clone().innerWires()].map((w, k): Cut => {
      const edges = w.edges;
      const { pts, curves } = loopOf(w, flatten);
      // all its edges arcs of one circle: one circle (OpenCascade may split it in two)
      const arc = edges.every((e) => e.geomType === 'CIRCLE') && curves[0] ? arcOf(pts[0], curves[0].mid, pts[1 % pts.length]) : null;
      const round = arc && pts.every((p, i) => Math.abs(Math.hypot(p[0] - arc.c[0], p[1] - arc.c[1]) - arc.r) < 1e-6 && curves[i] && Math.abs(Math.hypot(curves[i]!.mid[0] - arc.c[0], curves[i]!.mid[1] - arc.c[1]) - arc.r) < 1e-6);
      return { hole: k > 0, pts, curves, ...(round ? { circle: { c: arc.c, r: arc.r } } : {}) };
    }))];
    return { cuts, solid, anchor: { at: insidePoint(chosen), dir: n } };
  } finally {
    shape.delete();
    finished?.delete();
    for (const s of slices) s.delete();
  }
}

/**
 * What of `f` looks along `n`: a flat face whole or not at all; a cylinder or sphere cut where it turns away (the plane
 * through its axis or centre, square to `n`), the parts that look that way; another round face whole if some of it does
 * (seen from both sides it can come to nothing: see `projected`).
 */
function seen(f: Face, n: V3): Face[] {
  if (f.geomType !== 'CYLINDRE' && f.geomType !== 'SPHERE') return sees(f, n) ? [f] : [];
  const oc = getOC();
  const surface = new oc.BRepAdaptor_Surface(f.wrapped, false);
  const xyz = (p: { X(): number; Y(): number; Z(): number }): V3 => [p.X(), p.Y(), p.Z()];
  let at: V3;
  let m: V3 = n;
  if (f.geomType === 'SPHERE') at = xyz(surface.Sphere().Location());
  else {
    const ax = surface.Cylinder().Axis();
    const a = unit(xyz(ax.Direction()));
    at = xyz(ax.Location());
    m = sub(n, a.map((v) => v * dot(n, a)) as V3); // square to the axis
  }
  surface.delete();
  if (Math.hypot(...m) < 1e-6) return []; // a cylinder along n: seen edge-on
  m = unit(m);
  const size = 4 * Math.hypot(f.boundingBox.width, f.boundingBox.height, f.boundingBox.depth) + 10;
  const x = Math.abs(m[2]) > 0.999 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], m));
  const blade = (drawRectangle(size, size).sketchOnPlane(new Plane(at, x, m)) as Sketch).face();
  const [args, tools] = [new oc.NCollection_List_TopoDS_Shape(), new oc.NCollection_List_TopoDS_Shape()];
  args.Append(f.wrapped);
  tools.Append(blade.wrapped);
  const splitter = new oc.BRepAlgoAPI_Splitter();
  splitter.SetArguments(args);
  splitter.SetTools(tools);
  splitter.Build();
  const parts = splitter.HasErrors() ? [f] : facesOf(cast(splitter.Shape()) as Shape3D);
  [splitter, args, tools, blade].forEach((o) => o.delete());
  return parts.filter((p) => dot(unit(p.normalAt(p.pointOnSurface(0.5, 0.5)).toTuple() as V3), n) > 1e-6);
}

/** Whether some of `f` looks along `n` (a flat face all of it; a round one at any of 25 points over it). */
function sees(f: Face, n: V3) {
  if (f.geomType === 'PLANE') return dot(unit(f.normalAt(f.center).toTuple() as V3), n) > 1e-6;
  const at = [0.02, 0.25, 0.5, 0.75, 0.98];
  return at.some((a) => at.some((b) => dot(unit(f.normalAt(f.pointOnSurface(a, b)).toTuple() as V3), n) > 1e-3));
}

/** The faces each pushed along `down` into a prism, fused; null: none gives a volume. */
function prisms(faces: Face[], down: Vector): Shape3D | null {
  let all: Shape3D | null = null;
  for (const f of faces) {
    // a round face seen edge-on in places (a hole's wall) gives no volume, or a broken one: it adds nothing seen
    let prism: Shape3D | null = null;
    try {
      prism = basicFaceExtrusion(f.clone() as Face, down) as Shape3D;
      if (!(Math.abs(measureVolume(prism)) > 1e-6)) throw new Error('flat');
      const next: Shape3D = all ? all.fuse(prism) : prism;
      if (all) (all.delete(), prism.delete());
      all = next;
    } catch {
      if (prism !== all) prism?.delete();
    }
  }
  return all;
}

/**
 * `shape` as seen along `n`, flat: each of its faces looking that way (`front`; together they cover what is seen, round ones too)
 * pushed along -n past its lowest point, less the same of `away`, the faces where they all cross a plane there. Kept in
 * `keep` for deleting.
 */
function projected(shape: Shape3D, front: Face[], n: V3, keep: Shape3D[], away: Face[] = []): Face[] {
  const [lo, hi] = shape.boundingBox.bounds as [V3, V3];
  const along = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => dot([k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]], n));
  const [low, high] = [Math.min(...along), Math.max(...along)];
  const down = new Vector(n.map((x) => -x * (high - low + 2)) as V3);
  let all = prisms(front, down);
  if (!all) throw new Error('nothing of it faces that way');
  const less = prisms(away, down);
  if (less) {
    const rest = all.cut(less);
    [all, less].forEach((s) => s.delete());
    all = rest;
  }
  // a sheet square to n, 1 mm below the lowest point
  const size = 4 * Math.hypot(...sub(hi, lo)) + 10;
  const x = Math.abs(n[2]) > 0.999 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n));
  const sheet = (drawRectangle(size, size).sketchOnPlane(new Plane(n.map((v) => v * (low - 1)) as V3, x, n)) as Sketch).face();
  const flat = all.intersect(sheet);
  [all, sheet].forEach((s) => s.delete());
  keep.push(flat);
  return facesOf(flat);
}

/**
 * The flat sides of `chosen` (of `flat`) slanted to it (less than 45° off square) that lie on one of `around`: over
 * half of a 0.05 mm layer on their outside is in one.
 */
function against(chosen: Face, flat: Face[], n: V3, around: Shape3D[]): Face[] {
  if (!around.length) return [];
  const rim = new Set(chosen.edges.map(edgeKey));
  return flat.filter((f) => {
    const m = unit(f.normalAt(f.center).toTuple() as V3);
    if (Math.abs(dot(m, n)) < 1e-6 || Math.abs(dot(m, n)) > Math.SQRT1_2 || !f.edges.some((e) => rim.has(edgeKey(e)))) return false;
    const layer = basicFaceExtrusion(f.clone() as Face, new Vector(m.map((v) => v * 0.05) as V3)) as Shape3D;
    try {
      const covered = around.reduce((sum, other) => {
        const hit = layer.intersect(other);
        const v = measureVolume(hit);
        hit.delete();
        return sum + v;
      }, 0);
      return covered > measureVolume(layer) / 2;
    } finally {
      layer.delete();
    }
  });
}

/** An edge by its ends and middle (4 decimals), the same from both faces it bounds. */
const edgeKey = (e: Edge) => [e.startPoint, e.endPoint, e.pointAt(0.5)].map((p) => p.toTuple().map((v) => v.toFixed(4)).join(' ')).sort().join('|');

/** Where two faces of `front` meet at an angle (not on the edges `skip`): open lines, flat (`flatten`), drawn as marks (see `Cut`). */
function creases(front: Face[], flatten: (p: V3) => P2, skip = new Set<string>()): Cut[] {
  const out: Cut[] = [];
  front.forEach((a, i) => {
    const na = unit(a.normalAt(a.center).toTuple() as V3);
    const mine = new Set(a.edges.map(edgeKey));
    for (const b of front.slice(i + 1)) {
      if (dot(na, unit(b.normalAt(b.center).toTuple() as V3)) > 1 - 1e-6) continue;
      for (const e of b.edges) {
        const k = edgeKey(e);
        if (!mine.has(k) || skip.has(k)) continue;
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
