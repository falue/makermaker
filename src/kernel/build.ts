import { assembleWire, basicFaceExtrusion, cast, makeBox, draw, drawCircle, drawRectangle, FaceFinder, makeBSplineApproximation, makeFace, measureVolume, makeLine, revolution, getOC, importSTEP, makeCylinder, makePolygon, makeSolid, makeSphere, measureArea, Vector, Plane, Sketches, Transformation, type CornerFinder, type Drawing, type Edge, type Face as BRepFace, type Shape3D, type Sketch } from 'replicad';
import { add, cross, cutPlane, dot, extent, frames, norm, scale, sub, toWorld, type Frame, type Place } from '../doc/frames';
import type { DrawingPen } from 'replicad';
import { bakeTurn, bounds, centre, cornerRadii, curved, inside, mapPoints, movedLine, nesting, roundable, sideDirs, type DrawnProfile } from '../doc/profiles';
import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { lineUses } from '../doc/arrangement';
import { exactOf, type Exact } from './exact';
import type { Resolved } from '../doc/resolve';
import type { Area, BooleanOp, BuildIn, Curve, EdgeRule, Profile } from '../doc/types';

/** A boolean with its tool body's features at hand, placed as the tool body sits in this body's coordinates. */
/** A joint's way: turning about or sliding along an axis, `amount` degrees or mm (above 0). */
export type Sweep = { kind: 'hinge' | 'slider'; at: [number, number, number]; dir: [number, number, number]; amount: number };
export type BooleanBuild = { id: string; type: 'boolean'; op: BooleanOp; features: BuildFeature[]; place: Place; grow?: number; sweep?: Sweep };
/** A box joint as the kernel builds it: the other body's features (without its box joint) where it sits, the finger count or width, which fingers stay. */
export type FingersBuild = { id: string; type: 'fingers'; features: BuildFeature[]; place: Place; count: number; width: number; from?: V3; first: boolean; clearance?: number };
export type BuildFeature = Resolved<BuildIn> | BooleanBuild | FingersBuild;
type Of<T extends BuildFeature['type']> = Extract<BuildFeature, { type: T }>;

export interface BodyMesh {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  /** Per B-rep face: start and count in `indices`. */
  faces: Uint32Array;
  /** B-rep vertices (edge ends), xyz, each once: snap points, not rounded to the view's precision. */
  corners: Float64Array;
  /** Per B-rep edge: start and count of its points in `edges` (segment pairs). */
  edgeGroups: Uint32Array;
  /** Per B-rep edge: 1 if an unbaked finish made it. */
  finishEdges: Uint8Array;
  /** Per B-rep face: the index in `finishes` of the finished edge it rounds or chamfers, else -1. */
  finishFaces: Int32Array;
  /** Edges unbaked finishes worked on: the feature and a point on the edge (its middle; `skip` takes these). */
  finishes: { feature: string; mid: V3 }[];
  /** By finish: how many of its picked edges could not be found any more. */
  lostEdges: Record<string, number>;
  /** Cosmetic threads' lines (segment pairs, xyz, body coordinates): drawn, not in the solid. */
  cosmetic?: Float32Array;
  /** An imported mesh's texture coordinates (u, v per vertex). */
  uvs?: Float32Array;
  /** How many separate solids it is in (a mesh: 1). */
  pieces?: number;
  /** Its faces', edges' and own exact numbers, per face and edge group (null: too many faces; a mesh: none). */
  exact?: Exact | null;
}

type V3 = [number, number, number];

/** What unbaked finishes start from and which edges they work on (sampled points), filled by `buildBody`. */
export interface Finishing {
  base: Shape3D | null;
  edges: { feature: string; size: number; mid: V3; pts: V3[] }[];
  /** By finish: how many of its picked edges could not be found any more. */
  lost?: Record<string, number>;
}

export class FeatureError extends Error {
  /** `max`: the largest size that works (a finish too big), for clamping to. */
  constructor(
    readonly featureId: string,
    message: string,
    readonly max?: number,
  ) {
    super(message);
  }
}

/** [cx, cy, r] of vertical cylindrical faces; their seam and tangent lines are never finished. */
type Circle = [number, number, number];

const EPS = 1e-3;
/** How near (mm) a point from the view's triangles lies to the face it was picked on (replicad's own 1e-6 misses it far from the origin). */
const ON_FACE = 1e-3;

/**
 * Features run in order, except unbaked finishes: they run last, so they also finish edges of later booleans (and
 * mirrors after them, so finishes keep their picked edges). A baked finish stays in place: a later boolean cuts through it. `finishing` gets what the unbaked ones did.
 */
export function buildBody(features: BuildFeature[], finishing?: Finishing): Shape3D {
  const plan = frames(features.filter((f) => f.type !== 'boolean' && f.type !== 'fingers'));
  const circles: Circle[] = [];
  let shape: Shape3D | null = null;
  const apply = (id: string, fn: (s: Shape3D | null) => Shape3D) => {
    const next = run(id, () => fn(shape));
    shape?.delete();
    shape = next;
  };
  // finishes run last (their edges picked on the body before them), except those before a shell: it hollows them too
  const early = new Set<string>();
  try {
    for (const [n, s] of features.entries()) {
      if (s.type === 'shell' || s.type === 'coat')
        for (const f of features.slice(0, n))
          if (f.type === 'finish' && f.enabled && !f.baked && !early.has(f.id)) {
            if (finishing && !finishing.base) finishing.base = shape!.clone();
            apply(f.id, (cur) => finish(cur, f, circles, finishing));
            early.add(f.id);
          }
      if (s.type === 'extrude') apply(s.id, (cur) => extrude(cur, s, plan.get(s.id), circles));
      if (s.type === 'sphere') apply(s.id, (cur) => sphere(cur, s));
      if (s.type === 'step') apply(s.id, (cur) => step(cur, s));
      if (s.type === 'boolean') apply(s.id, (cur) => boolean(cur, s));
      if (s.type === 'split') apply(s.id, (cur) => split(cur, s));
      if (s.type === 'revolve') apply(s.id, (cur) => revolve(cur, s, plan.get(s.id)));
      if (s.type === 'loft') apply(s.id, (cur) => loft(cur, s));
      if (s.type === 'sweep') apply(s.id, (cur) => sweep(cur, s));
      if (s.type === 'shell') apply(s.id, (cur) => shell(cur, s));
      if (s.type === 'coat') apply(s.id, (cur) => coat(cur, s));
      if (s.type === 'bulge') apply(s.id, (cur) => bulge(cur, s));
      if (s.type === 'push') apply(s.id, (cur) => push(cur, s));
      if (s.type === 'draft' && s.angle) apply(s.id, (cur) => draft(cur, s)); // 0: as if it were not there
      if (s.type === 'fingers') apply(s.id, (cur) => fingers(cur, s));
      if (s.type === 'piece') apply(s.id, (cur) => piece(cur, s));
      if (s.type === 'finish' && s.enabled && s.baked) apply(s.id, (cur) => finish(cur, s, circles, undefined, finishing));
    }
    if (!shape) throw new FeatureError(features[0]?.id ?? '', 'a body needs an added extrusion');
    if (finishing && !finishing.base) finishing.base = (shape as Shape3D).clone();
    for (const s of features) if (s.type === 'finish' && s.enabled && !s.baked && !early.has(s.id)) apply(s.id, (cur) => finish(cur, s, circles, finishing));
    // threads after the finishes: an edge rule (vertical, top …) would take the groove's hundreds of edges; cosmetic ones are drawn only (`cosmeticOf`)
    for (const s of features) if (s.type === 'thread' && s.modeled) apply(s.id, (cur) => thread(cur, s));
    // mirrors last: finishes keep working on the edges they were picked on
    for (const s of features)
      if (s.type === 'mirror') {
        apply(s.id, (cur) => cur!.clone().mirror(s.n, s.o));
        if (finishing?.base) finishing.base = finishing.base.mirror(s.n, s.o);
      }
  } catch (err) {
    (shape as Shape3D | null)?.delete();
    throw err;
  }
  return shape;
}

/** Distance from `p` to a polyline (points; `pairs`: separate segments a-b, c-d, ...). */
function toLine(p: V3, pts: ArrayLike<number>, pairs: boolean) {
  let best = Infinity;
  for (let i = 0; i + 5 < pts.length; i += pairs ? 6 : 3) {
    const a = [pts[i], pts[i + 1], pts[i + 2]];
    const d = [pts[i + 3] - a[0], pts[i + 4] - a[1], pts[i + 5] - a[2]];
    const l = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1], p[2] - a[2] - t * d[2]));
  }
  return best;
}

/**
 * The mesh of a body; `finishing` (from `buildBody`) marks the edges and faces its unbaked finishes made. `tolerance`:
 * how far (mm) the drawn surface may stray from the real one; display only, exports mesh for themselves.
 */
export function meshBody(shape: Shape3D, finishing?: Finishing, tolerance = 0.05): BodyMesh {
  const opts = { tolerance, angularTolerance: Math.max(0.1, tolerance * 4) };
  const m = shape.mesh(opts);
  const e = shape.meshEdges(opts);
  // an edge the finishes made lies on no edge of the shape before them (no unbaked finish: none, skip the costly check)
  const before = finishing?.edges.length ? finishing.base?.meshEdges(opts).lines : undefined;
  const point = (xyz: ArrayLike<number>, i: number): V3 => [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]];
  const finishEdges = new Uint8Array(e.edgeGroups.map((g) => +(!!before && toLine(point(e.lines, g.start + (g.count >> 1)), before, true) > 0.05)));
  // a finish face lies wholly within its size of the edge it replaced
  const lines = finishing?.edges.map((f) => f.pts.flat()) ?? [];
  const finishFaces = new Int32Array(
    m.faceGroups.map((g) => {
      if (!lines.length) return -1;
      const corners = Array.from(m.triangles.slice(g.start, g.start + g.count), (v) => point(m.vertices, v));
      let best = -1;
      let worst = Infinity;
      finishing?.edges.forEach((f, k) => {
        const far = Math.max(...corners.map((c) => toLine(c, lines[k], false)));
        if (far <= f.size * 1.5 + 0.05 && far < worst) [best, worst] = [k, far];
      });
      return best;
    }),
  );
  // edge groups count points: an edge's ends are its group's first and last point
  const ends = new Map<string, number[]>();
  for (const g of e.edgeGroups)
    for (const i of [g.start, g.start + g.count - 1]) {
      const p = e.lines.slice(i * 3, i * 3 + 3);
      ends.set(p.map((v) => v.toFixed(3)).join(), p);
    }
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    edges: new Float32Array(e.lines),
    faces: new Uint32Array(m.faceGroups.flatMap((g) => [g.start, g.count])),
    corners: new Float64Array([...ends.values()].flat()),
    edgeGroups: new Uint32Array(e.edgeGroups.flatMap((g) => [g.start, g.count])),
    finishEdges,
    finishFaces,
    finishes: finishing?.edges.map(({ feature, mid }) => ({ feature, mid })) ?? [],
    lostEdges: finishing?.lost ?? {},
    pieces: shape.solids.length,
    exact: exactOf(shape, m.faceGroups.map((g) => g.faceId), e.edgeGroups.map((g) => g.edgeId)),
  };
}

function run<T>(featureId: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw err instanceof FeatureError ? err : new FeatureError(featureId, err instanceof Error ? err.message : 'geometry operation failed');
  }
}

function positive(v: number, name: string) {
  if (!(v > 0)) throw new Error(`${name} must be greater than 0`);
}

function drawing(p: Resolved<Profile>): Drawing {
  switch (p.kind) {
    case 'rect':
      positive(p.w, 'width');
      positive(p.h, 'height');
      return rounded(p);
    case 'circle':
      positive(p.d, 'diameter');
      return drawCircle(p.d / 2).translate(p.x, p.y);
    case 'ngon':
      positive(p.d, 'diameter');
      if (!(p.sides >= 3)) throw new Error('a regular polygon needs 3 sides');
      return rounded(p);
    case 'line':
      throw new Error('an open line cannot be extruded');
    case 'polygon':
      if (p.pts.length < (curved(p) ? 2 : 3)) throw new Error('a polygon needs 3 corners');
      return rounded(p);
  }
}

/** A shape with corners, each rounded by its own radius or chamfered (`cornerRadii`: as asked, at most what the corner takes). */
function rounded(p: Resolved<Profile>): Drawing {
  const q = roundable(p)!;
  const radii = cornerRadii(p);
  let d = sidesDrawn(draw(q.pts[0]), q, true).close();
  // one fillet or chamfer per size, on its corners (doing one leaves the others' points where they are)
  for (const r of new Set(radii.filter((x) => x))) {
    const at = (c: CornerFinder) => c.inList(q.pts.filter((_, i) => radii[i] === r));
    d = r > 0 ? d.fillet(r, at) : d.chamfer(-r, at);
  }
  return d;
}

/** `pen` (at the first point) drawn on along the sides; `closed`: the last one back to the first point. */
function sidesDrawn(pen: DrawingPen, { pts, curves }: { pts: [number, number][]; curves?: (Curve | null)[] }, closed = false): DrawingPen {
  const ends = closed ? [...pts.slice(1), pts[0]] : pts.slice(1);
  ends.forEach((b, i) => {
    const c = curves?.[i];
    if (closed && i === ends.length - 1 && !c) return; // close() draws it
    if (!c) pen.lineTo(b);
    else if ('c1' in c) pen.cubicBezierCurveTo(b, c.c1, c.c2);
    else pen.threePointsArcTo(b, c.mid);
  });
  return pen;
}

/** Profiles inside an odd number of others are holes (even-odd), so a circle drawn inside a rectangle cuts it. */
function combine(ps: Resolved<Profile>[]): Drawing {
  const depth = nesting(ps);
  const [first, ...rest] = ps.map((_, i) => i).sort((a, b) => depth[a] - depth[b]);
  return rest.reduce((acc, i) => (depth[i] % 2 ? acc.cut(drawing(ps[i])) : acc.fuse(drawing(ps[i]))), drawing(ps[first]));
}

const filled = (d: Drawing) => d.toSVGPaths().length > 0;

/** One area: inside all its `in` shapes, outside all its `out` shapes. */
function area(byId: Map<string, Resolved<Profile>>, a: Area): Drawing {
  const get = (id: string) => {
    const p = byId.get(id);
    if (!p) throw new Error('a shape of a picked area is gone');
    return drawing(p);
  };
  const inside = a.in.map(get).reduce((x, y) => x.intersect(y));
  return a.out.reduce((d, id) => (byId.has(id) ? d.cut(get(id)) : d), inside);
}

/** The faces of a shape (a compound of them, or one). */
function facesIn(shape: { wrapped: TopoDS_Shape }): BRepFace[] {
  const oc = getOC();
  const out: BRepFace[] = [];
  const explorer = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) out.push(cast(explorer.Current()) as BRepFace);
  explorer.delete();
  return out;
}

/** A face's triangles in its plane (x, y per corner; the face on XY). */
function trisOf(face: BRepFace): Float32Array {
  const m = face.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
  const out = new Float32Array(m.triangles.length * 2);
  m.triangles.forEach((v, i) => out.set([m.vertices[v * 3], m.vertices[v * 3 + 1]], i * 2));
  return out;
}

/** Whether plane point (u, v) lies in triangles `t` (see `trisOf`). */
function inTris(t: Float32Array, [u, v]: [number, number]) {
  for (let k = 0; k + 5 < t.length; k += 6) {
    const d1 = (u - t[k + 2]) * (t[k + 1] - t[k + 3]) - (t[k] - t[k + 2]) * (v - t[k + 3]);
    const d2 = (u - t[k + 4]) * (t[k + 3] - t[k + 5]) - (t[k + 2] - t[k + 4]) * (v - t[k + 5]);
    const d3 = (u - t[k]) * (t[k + 5] - t[k + 1]) - (t[k + 4] - t[k]) * (v - t[k + 1]);
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  }
  return false;
}

/**
 * The faces a sketch's lines and the shapes they reach enclose, exact (plane coordinates, on XY): a face larger than
 * all of them split by their true curves (lines open, the shapes' outlines with their rounded corners), those clear
 * of its rim (the rest is outside); each with its triangles, a point inside it (its largest triangle's middle) and
 * the shapes it lies in. `uses`: the lines and shapes taking part (`lineUses`).
 */
function lineFacesExact(ps: Resolved<Profile>[]): { faces: { face: BRepFace; tris: Float32Array; at: [number, number]; in: string[] }[]; uses: string[] } {
  const uses = lineUses(ps);
  const taking = ps.filter((p) => uses.includes(p.id) && (p.kind !== 'line' || p.pts.length > 1));
  if (!taking.some((p) => p.kind === 'line')) return { faces: [], uses };
  const oc = getOC();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  for (const p of taking) {
    const sketch = (p.kind === 'line' ? sidesDrawn(draw(p.pts[0]), p).done() : drawing(p)).sketchOnPlane('XY');
    tools.Append(sketch instanceof Sketches ? sketch.wires().wrapped : (sketch as Sketch).wire.wrapped);
  }
  // the rim: all of them inside it, with room
  const box = taking.map((p) => bounds(p as DrawnProfile)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const room = 1 + 0.1 * Math.max(box[2] - box[0], box[3] - box[1]);
  const [x0, y0, x1, y1] = [box[0] - room, box[1] - room, box[2] + room, box[3] + room];
  const rim = (drawRectangle(x1 - x0, y1 - y0).translate((x0 + x1) / 2, (y0 + y1) / 2).sketchOnPlane('XY') as Sketch).face();
  const args = new oc.NCollection_List_TopoDS_Shape();
  args.Append(rim.wrapped);
  const splitter = new oc.BRepAlgoAPI_Splitter();
  splitter.SetArguments(args);
  splitter.SetTools(tools);
  splitter.SetFuzzyValue(1e-3); // a stored point (rounded) lies that near the curve it was snapped to: it meets it
  splitter.Build();
  const done = !splitter.HasErrors();
  const pieces = done ? facesIn({ wrapped: splitter.Shape() }) : [];
  [splitter, args, tools].forEach((x) => x.delete());
  if (!done) throw new Error('the lines could not be split into areas');
  const inner = pieces.filter((f) => {
    const [[a, b], [c, d]] = f.boundingBox.bounds;
    return a > x0 + 1e-6 && b > y0 + 1e-6 && c < x1 - 1e-6 && d < y1 - 1e-6;
  });
  return {
    uses,
    faces: inner.map((face) => {
      const tris = trisOf(face);
      let [best, at]: [number, [number, number]] = [-1, [0, 0]];
      for (let k = 0; k + 5 < tris.length; k += 6) {
        const area = Math.abs((tris[k + 2] - tris[k]) * (tris[k + 5] - tris[k + 1]) - (tris[k + 4] - tris[k]) * (tris[k + 3] - tris[k + 1]));
        if (area > best) [best, at] = [area, [(tris[k] + tris[k + 2] + tris[k + 4]) / 3, (tris[k + 1] + tris[k + 3] + tris[k + 5]) / 3]];
      }
      return { face, tris, at, in: taking.filter((p) => p.kind !== 'line' && inside(p as DrawnProfile, ...at)).map((p) => p.id) };
    }),
  };
}

/**
 * The picked areas as faces on frame `f` moved `offset` along its normal, exact: overlapping shapes' areas from their
 * drawings, areas lines close from `lineFacesExact` (the one around each area's point). Each a face of its own: they
 * are joined as solids (`madeOf`).
 */
function areaFaces(ps: Resolved<Profile>[], areas: Area[], f: Frame, offset = 0): BRepFace[] {
  const byId = new Map(ps.map((p) => [p.id, p]));
  const place = new Transformation().coordSystemChange({ origin: add(f.o, scale(f.n, offset)), zDir: f.n, xDir: f.x }, 'reference');
  let lined: ReturnType<typeof lineFacesExact>['faces'] | null = null;
  const faces = areas.flatMap((a): BRepFace[] => {
    if (!a.at) {
      const d = area(byId, a);
      if (!filled(d)) return [];
      const sketch = d.sketchOnPlane('XY');
      return sketch instanceof Sketches ? facesIn(sketch.faces()) : [(sketch as Sketch).face()];
    }
    lined ??= lineFacesExact(ps).faces;
    const hit = lined.find((x) => inTris(x.tris, a.at!));
    if (!hit) throw new Error('a picked area is no longer closed by its lines');
    return [hit.face];
  });
  if (!faces.length) throw new Error('the picked areas are empty');
  return faces.map((face) => cast(place.transform(face.wrapped)) as BRepFace);
}

/** `make` of each one (the picked areas' faces, or all the shapes as one drawing), joined. */
function madeOf<T>(ds: T[], make: (d: T) => Shape3D): Shape3D {
  return ds.map(make).reduce((x, y) => {
    try {
      return x.fuse(y);
    } finally {
      x.delete();
      y.delete();
    }
  });
}

/** A drawing's areas, as triangles in its plane (x, y per corner); `uses`: the shapes and lines a line-closed area needs. */
export interface AreaMesh extends Area {
  tris: Float32Array;
  uses?: string[];
}

/**
 * The areas of a sketch's shapes, with triangles to show and pick them: where lines take part, the faces they and the
 * shapes they reach enclose (see `lineFaces`); elsewhere the exact areas of overlapping shapes (see `shapeAreas`).
 */
export function areasOf(ps: Resolved<Profile>[]): AreaMesh[] {
  const { faces, uses } = lineFacesExact(ps);
  const lined = faces.map((f): AreaMesh => ({ in: f.in, out: [], at: f.at, uses, tris: f.tris }));
  return [...shapeAreas(ps.filter((p) => p.kind !== 'line' && !uses.includes(p.id))), ...lined];
}

/**
 * Splits overlapping shapes into areas: each area lies inside some shapes and outside the others (an even/odd
 * independent overlay).
 */
function shapeAreas(ps: Resolved<Profile>[]): AreaMesh[] {
  let bodies: { in: string[]; out: string[]; d: Drawing }[] = [];
  let all: Drawing | null = null;
  const seen: string[] = [];
  for (const p of ps) {
    const d = drawing(p);
    const next: typeof bodies = [];
    for (const r of bodies) {
      const both = r.d.clone().intersect(d.clone());
      if (filled(both)) next.push({ in: [...r.in, p.id], out: r.out, d: both });
      const rest = r.d.clone().cut(d.clone());
      if (filled(rest)) next.push({ in: r.in, out: [...r.out, p.id], d: rest });
    }
    const fresh = all ? d.clone().cut(all.clone()) : d.clone();
    if (filled(fresh)) next.push({ in: [p.id], out: [...seen], d: fresh });
    all = all ? all.fuse(d) : d;
    seen.push(p.id);
    bodies = next;
  }
  // later shapes count as outside too: an area keeps its place when shapes are added
  return bodies.map((r) => ({ in: r.in, out: seen.filter((id) => !r.in.includes(id)), tris: triangles(r.d) }));
}

function triangles(d: Drawing): Float32Array {
  // one piece gives a sketch (its face), several give sketches (their faces)
  const sketched = d.sketchOnPlane('XY') as unknown as { faces?(): Shape3D; face?(): Shape3D };
  const faces = sketched.faces ? sketched.faces() : sketched.face!();
  const m = faces.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
  const out = new Float32Array(m.triangles.length * 2);
  m.triangles.forEach((v, i) => out.set([m.vertices[v * 3], m.vertices[v * 3 + 1]], i * 2));
  return out;
}

/** Cylindrical faces standing on an XY-parallel plane (circles, rounded corners, tangent seams), for the edge rules. */
function addCircles(p: Resolved<Profile>, f: Frame, circles: Circle[]) {
  if (Math.abs(Math.abs(f.n[2]) - 1) > EPS) return;
  const at = (u: number, v: number, r: number) => {
    const [x, y] = toWorld(f, u, v);
    circles.push([x, y, r]);
  };
  if (p.kind === 'circle') at(p.x, p.y, p.d / 2);
  // rounded corners: each arc's middle on the corner's bisector
  const q = roundable(p);
  cornerRadii(p).forEach((r, i) => {
    if (r <= 0 || !q) return; // a chamfer's faces are flat
    const n = q.pts.length;
    const [a, c, b] = [q.pts[(i - 1 + n) % n], q.pts[i], q.pts[(i + 1) % n]];
    const [, din] = sideDirs(a, q.curves?.[(i - 1 + n) % n], c);
    const [dout] = sideDirs(c, q.curves?.[i], b);
    const [u, v] = [din, dout].map((d) => [d[0] / Math.hypot(...d), d[1] / Math.hypot(...d)]);
    const bis = [v[0] - u[0], v[1] - u[1]];
    const half = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) / 2;
    const k = r / Math.cos(half) / (Math.hypot(...bis) || 1);
    at(c[0] + bis[0] * k, c[1] + bis[1] * k, r);
  });
  // where curved sides run on without a corner: a seam, as a circle of no size
  if (p.kind === 'polygon' && curved(p)) {
    const q = bakeTurn(p);
    q.pts.forEach((pt, i) => {
      const n = q.pts.length;
      const [, d0] = sideDirs(q.pts[(i - 1 + n) % n], q.curves?.[(i - 1 + n) % n], pt);
      const [d1] = sideDirs(pt, q.curves?.[i], q.pts[(i + 1) % n]);
      if (d0[0] * d1[0] + d0[1] * d1[1] > 0.99996 * Math.hypot(...d0) * Math.hypot(...d1)) at(pt[0], pt[1], 0);
    });
  }
}

/** Joins, cuts or intersects with the tool body (built here from its features). */
function boolean(shape: Shape3D | null, s: Of<'boolean'>): Shape3D {
  let built = buildBody(s.features);
  if (s.grow) {
    const wider = grownShape(built, s.grow, true);
    built.delete();
    built = wider;
  }
  const tool = placeShape(built, s.place);
  try {
    if (!shape) {
      if (s.op !== 'union') throw new Error('nothing to cut or intersect yet');
      return tool.clone();
    }
    if (s.op === 'subtract' && s.sweep) {
      // all it goes through: where it starts, and what its faces pass on the way
      let out = shape.cut(tool);
      for (const piece of swept(tool, s.sweep)) {
        const next = out.cut(piece);
        out.delete();
        piece.delete();
        out = next;
      }
      return out;
    }
    return s.op === 'union' ? shape.fuse(tool) : s.op === 'subtract' ? shape.cut(tool) : shape.intersect(tool);
  } finally {
    tool.delete();
  }
}

/**
 * The space a shape goes through on `way`, as overlapping solids. OpenCascade sweeps faces, not solids. A flat face sliding
 * sweeps exactly; a curved one can cancel itself out (front against back) and a turning one can fold, so with those the
 * shape itself also stands at each step (3°, 1 mm, at most 60): ridges between them stay tiny. What stays inside the
 * shape all along is its own at the start: the caller's.
 */
export function swept(shape: Shape3D, way: Sweep): Shape3D[] {
  const oc = getOC();
  const dir = new oc.gp_Dir(way.dir[0], way.dir[1], way.dir[2]);
  const pnt = new oc.gp_Pnt(way.at[0], way.at[1], way.at[2]);
  const axis = new oc.gp_Ax1(pnt, dir);
  const hinge = way.kind === 'hinge';
  const by = new oc.gp_Vec(way.dir[0] * way.amount, way.dir[1] * way.amount, way.dir[2] * way.amount);
  const out: Shape3D[] = [];
  let curved = false;
  for (const face of shape.faces) {
    if (face.geomType === 'PLANE')
      try {
        const made = hinge ? new oc.BRepPrimAPI_MakeRevol(face.wrapped, axis, Math.min((way.amount * Math.PI) / 180, 2 * Math.PI), false) : new oc.BRepPrimAPI_MakePrism(face.wrapped, by, false, true);
        const piece = cast(made.Shape()) as Shape3D;
        made.delete();
        if (Math.abs(measureVolume(piece)) > 1e-3) out.push(piece);
        else piece.delete();
      } catch {
        curved = true; // this face does not sweep: the steps tell
      }
    else curved = true;
    face.delete();
  }
  [dir, pnt, axis, by].forEach((x) => x.delete());
  if (hinge || curved) {
    const n = Math.min(60, Math.ceil(way.amount / (hinge ? 3 : 1)));
    for (let k = 1; k <= n; k++) {
      const t = (way.amount * k) / n;
      out.push(hinge ? shape.clone().rotate(t, way.at, way.dir) : shape.clone().translate(way.dir[0] * t, way.dir[1] * t, way.dir[2] * t));
    }
  }
  return out;
}

/** `shape` turned and moved by `pl` (replicad's transforms consume the shape they are called on). */
export function placeShape(shape: Shape3D, pl: Place): Shape3D {
  const turned = pl.angle ? shape.rotate(pl.angle, [0, 0, 0], pl.axis) : shape;
  return pl.offset.some((v) => v) ? turned.translate(...pl.offset) : turned;
}

/** STEP solids by feature id, read once (`loadImports`) before building; null: the file could not be read. */
const imported = new Map<string, Shape3D | null>();

/** Reads the STEP files of `features` (tool bodies' too) not read yet: reading is async, building is not. */
export async function loadImports(features: BuildFeature[]) {
  for (const f of features) {
    if (f.type === 'boolean') await loadImports(f.features);
    if (f.type !== 'step' || imported.has(f.id)) continue;
    imported.set(f.id, await importSTEP(new Blob([f.data])).then((s) => s as Shape3D, () => null));
  }
}

function step(shape: Shape3D | null, s: Of<'step'>): Shape3D {
  const solid = imported.get(s.id)?.clone();
  if (!solid) throw new Error('the STEP file could not be read');
  if (!shape) return solid;
  try {
    return shape.fuse(solid);
  } finally {
    solid.delete();
  }
}

function sphere(shape: Shape3D | null, s: Of<'sphere'>): Shape3D {
  positive(s.d, 'diameter');
  const ball = makeSphere(s.d / 2).translate(s.x, s.y, s.z);
  if (!shape) return ball;
  try {
    return shape.fuse(ball);
  } finally {
    ball.delete();
  }
}

function extrude(shape: Shape3D | null, s: Of<'extrude'>, f: Frame | undefined, circles: Circle[]): Shape3D {
  if (!f) throw new Error('sketch plane lost: the face it was on is gone');
  if (!shape && s.mode === 'cut') throw new Error('nothing to cut yet');
  if (!s.profiles.length) throw new Error('no profile to extrude');
  if (!s.through && s.depth === 0 && !s.back) throw new Error('depth must not be 0');
  // span along the normal; through: beyond the body on both sides
  const box = shape?.boundingBox;
  const far = box ? Math.hypot(box.width, box.height, box.depth) + Math.hypot(...f.o) + 1 : 0;
  const [from, to] = s.through ? [-far, far] : extent(s.depth, s.back);
  const tool = s.areas
    ? madeOf(areaFaces(s.profiles, s.areas, f, from), (face) => basicFaceExtrusion(face, new Vector(scale(f.n, to - from))) as Shape3D)
    : madeOf([combine(s.profiles)], (d) => d.sketchOnPlane(new Plane(add(f.o, scale(f.n, from)), f.x, f.n)).extrude(to - from) as Shape3D);
  for (const p of s.profiles) addCircles(p, f, circles);
  return joined(shape, tool, s.mode);
}

/** Shapes turned around their axis (in their plane), joined to or cut from the body. */
function revolve(shape: Shape3D | null, s: Of<'revolve'>, f: Frame | undefined): Shape3D {
  if (!f) throw new Error('sketch plane lost: the face it was on is gone');
  if (!shape && s.mode === 'cut') throw new Error('nothing to cut yet');
  if (!s.profiles.length) throw new Error('no profile to revolve');
  if (!s.angle) throw new Error('the angle must not be 0');
  const dir = add(scale(f.x, s.axis.dir[0]), scale(f.y, s.axis.dir[1]));
  const [origin, angle] = [toWorld(f, ...s.axis.at), Math.max(-360, Math.min(360, s.angle))];
  const tool = s.areas
    ? madeOf(areaFaces(s.profiles, s.areas, f), (face) => revolution(face, origin, dir, angle) as Shape3D)
    : madeOf([combine(s.profiles)], (d) => d.sketchOnPlane(new Plane(f.o, f.x, f.n)).revolve(dir, { origin, angle }) as Shape3D);
  return joined(shape, tool, s.mode);
}

/** A solid through its shapes in order, joined to the body (the first one makes it). */
function loft(shape: Shape3D | null, s: Of<'loft'>): Shape3D {
  if (s.sections.length < 2) throw new Error('a loft needs two shapes or more');
  // run against the first shape's normal, it comes out inside-out (a shell then fails): the same solid, built the other way
  const middle = ({ frame: f, profile }: Of<'loft'>['sections'][number]) => toWorld(f, ...centre(profile));
  const against = dot(sub(middle(s.sections.at(-1)!), middle(s.sections[0])), s.sections[0].frame.n) < 0;
  const [first, ...rest] = (against ? s.sections.toReversed() : s.sections).map(({ frame: f, profile }) => drawing(profile).sketchOnPlane(new Plane(f.o, f.x, f.n)) as Sketch);
  return joined(shape, first.loftWith(rest, { ruled: s.ruled }), 'add');
}

/** The profile (its middle on the path's start, square to it) swept along the path, joined to the body. */
function sweep(shape: Shape3D | null, s: Of<'sweep'>): Shape3D {
  const { frame: f, profile: path } = s.path;
  const p = s.profile;
  if (p.kind === 'line') throw new Error('the profile must be a closed shape');
  // the profile centred on its own origin: the path's start
  const [cx, cy] = centre(p);
  const centred = p.kind === 'polygon' ? mapPoints(p, ([x, y]) => [x - cx, y - cy]) : { ...p, x: 0, y: 0 };
  const spine = (path.kind === 'line' ? sidesDrawn(draw(path.pts[0]), path).done() : drawing(path)).sketchOnPlane(new Plane(f.o, f.x, f.n)) as Sketch;
  const tool = spine.sweepSketch((plane) => drawing(centred).sketchOnPlane(plane) as Sketch, { transitionMode: 'right' });
  return joined(shape, tool, 'add');
}

/**
 * The body hollowed to walls `thickness` thick inside it, the faces through the `open` points taken away; none open: a
 * closed body, hollow inside (shelled with its biggest flat face open, then that face's wall put back).
 */
function shell(shape: Shape3D | null, s: Of<'shell'>): Shape3D {
  if (!shape) throw new Error('nothing to hollow yet');
  if (!(s.thickness > 0)) throw new Error('the wall thickness must be greater than 0');
  if (s.open.length) return shape.shell(s.thickness, (f) => f.either(s.open.map((p) => (g: typeof f) => g.near(p, ON_FACE))));
  const flat = shape.faces.filter((f) => f.geomType === 'PLANE').sort((a, b) => measureArea(b) - measureArea(a))[0];
  if (!flat) throw new Error('a closed shell needs a flat face (or pick faces to leave open)');
  const at = flat.center;
  const n = flat.normalAt(at);
  const hollow = shape.shell(s.thickness, (f) => f.containsPoint(at.toTuple()));
  // the wall that face was: the body within the thickness of it
  const b = shape.boundingBox;
  const far = 2 * Math.hypot(b.width, b.height, b.depth) + 10;
  const x = Math.abs(n.z) < 0.9 ? new Vector([0, 0, 1]).cross(n).normalized() : new Vector([1, 0, 0]);
  const band = drawRectangle(2 * far, 2 * far).sketchOnPlane(new Plane(at.toTuple(), x.toTuple(), n.multiply(-1).toTuple())).extrude(s.thickness) as Shape3D;
  const wall = shape.clone().intersect(band);
  band.delete();
  return joined(hollow, wall, 'add');
}

/** `shape` grown by `by` on all sides (`round`: the same distance everywhere; else sharp corners, a box stays a box). */
export function grownShape(shape: Shape3D, by: number, round: boolean): Shape3D {
  const oc = getOC();
  const maker = new oc.BRepOffsetAPI_MakeOffsetShape();
  const progress = new oc.Message_ProgressRange();
  try {
    maker.PerformByJoin(shape.wrapped, by, 1e-6, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, round ? oc.GeomAbs_JoinType.GeomAbs_Arc : oc.GeomAbs_JoinType.GeomAbs_Intersection, false, progress);
    return cast(maker.Shape()) as Shape3D;
  } catch {
    throw new Error(`it cannot grow by ${by} mm: try less (a hole may close, or corners meet)`);
  } finally {
    maker.delete();
    progress.delete();
  }
}

function coat(shape: Shape3D | null, s: Of<'coat'>): Shape3D {
  if (!shape) throw new Error('nothing to coat yet');
  if (s.thickness === 0) return shape.clone(); // while its faces are being picked
  positive(s.thickness, 'thickness');
  let out = grownShape(shape, s.thickness, s.corners === 'round');
  for (const { at: p, n } of s.exclude) {
    // the flat face under the click: facing that way, the point on it or a thickness out from it
    const face = shape.faces.find((f) => {
      if (f.geomType !== 'PLANE') return false;
      const c = f.center;
      const m = f.normalAt(c);
      const off = (p[0] - c.x) * m.x + (p[1] - c.y) * m.y + (p[2] - c.z) * m.z;
      const [[x0, y0, z0], [x1, y1, z1]] = f.boundingBox.bounds;
      const reach = s.thickness + 1e-3;
      const over = p[0] > x0 - reach && p[0] < x1 + reach && p[1] > y0 - reach && p[1] < y1 + reach && p[2] > z0 - reach && p[2] < z1 + reach;
      return m.x * n[0] + m.y * n[1] + m.z * n[2] > 0.999 && (Math.abs(off) < 1e-3 || Math.abs(off - s.thickness) < 1e-3) && over;
    });
    if (!face) throw new Error('only flat faces can be excluded: click one of them again to take it back');
    // over the face and as far as the coat reaches around it, what grew out of it goes
    const c = face.center;
    const m = face.normalAt(c);
    const x = Math.abs(m.z) < 0.9 ? new Vector([0, 0, 1]).cross(m).normalized() : new Vector([1, 0, 0]).cross(m).normalized();
    const y = m.cross(x);
    const margin = s.thickness * 1.5 + 0.1;
    // points along the edges at most `margin` apart: an arc bulges less than that between two
    const around = (f: typeof face) => f.edges.flatMap((e) => {
      const n = Math.max(4, Math.ceil(e.length / margin));
      return Array.from({ length: n + 1 }, (_, k) => e.pointAt(k / n));
    });
    const rim = around(face);
    // a round corner running on smoothly from it grows past it too: its reach counts
    const smooth = shape.faces.filter((f) => f.geomType !== 'PLANE' && around(f).some((q) => rim.some((r) => r.sub(q).Length < 1e-4 && Math.abs(f.normalAt(q).dot(m)) > 0.999)));
    const pts = [...rim, ...smooth.flatMap(around)];
    const [us, vs] = [pts.map((q) => q.sub(c).dot(x)), pts.map((q) => q.sub(c).dot(y))];
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const middle = c.add(x.multiply((u0 + u1) / 2)).add(y.multiply((v0 + v1) / 2));
    const slab = drawRectangle(u1 - u0 + 2 * margin, v1 - v0 + 2 * margin).sketchOnPlane(new Plane(middle.toTuple(), x.toTuple(), m.toTuple())).extrude(s.thickness + 0.01) as Shape3D;
    const cut = out.cut(slab);
    out.delete();
    slab.delete();
    out = cut;
  }
  if (!s.skin) return out;
  const skin = out.cut(shape);
  out.delete();
  return skin;
}

/**
 * Cosmetic threads drawn as a drawing shows them: at their other Ø (a hole's major, a shaft's minor), a circle at
 * each end and four lines along; segment pairs in body coordinates.
 */
export function cosmeticOf(features: BuildFeature[], steps = 48): Float32Array {
  const out: number[] = [];
  for (const s of features) {
    if (s.type !== 'thread' || s.modeled) continue;
    const r = s.inside ? s.d / 2 : s.d / 2 - 0.625 * 0.8660254 * s.pitch;
    const n = norm(s.dir);
    const x = norm(cross(Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], n));
    const y = cross(n, x);
    const at = (a: number, h: number) => add(add(s.at, scale(n, h)), add(scale(x, r * Math.cos(a)), scale(y, r * Math.sin(a))));
    for (const h of [0, s.length]) for (let k = 0; k < steps; k++) out.push(...at((2 * Math.PI * k) / steps, h), ...at((2 * Math.PI * (k + 1)) / steps, h));
    for (let k = 0; k < 4; k++) out.push(...at((k * Math.PI) / 2, 0), ...at((k * Math.PI) / 2, s.length));
  }
  return new Float32Array(out);
}

/**
 * A thread cut into the round surface with the ISO basic profile (ISO 68-1; Unified threads share it): 60° flanks, a
 * groove P/4 wide at the minor diameter (a shaft's root) or P/8 at the major one (a hole's), 5/8 H deep (H = 0.866 P),
 * opening just past the surface. It runs along a helix one pitch past both ends, built from flat faces, `steps` per turn
 * (OpenCascade's booleans with swept helical surfaces fail now and then), along Z, then turned and moved onto the axis.
 */
function thread(shape: Shape3D | null, s: Of<'thread'>, steps = 36): Shape3D {
  if (!shape) throw new Error('nothing to thread yet');
  if (!(s.pitch > 0) || !(s.length > 0) || !(s.d > 0)) throw new Error('diameter, pitch and length must be greater than 0');
  const [P, R] = [s.pitch, s.d / 2];
  const deep = 0.625 * 0.8660254 * P;
  const slope = Math.tan(Math.PI / 6); // half a 60° groove widens this much per mm of depth
  // the groove's closed end (radius, half width) and its open end just past the round surface
  const [closed, closedHalf] = s.inside ? [R, P / 16] : [R - deep, P / 8];
  const open = s.inside ? Math.min(s.r, R - deep) - 0.05 : Math.max(s.r, R) + 0.05;
  const openHalf = Math.min(0.49 * P, closedHalf + slope * Math.abs(closed - open));
  type P3 = [number, number, number];
  // the groove's outline at step i: its open side (two corners), then its closed end, square to the turning
  const at = (i: number): P3[] => {
    const a = (i / steps) * 2 * Math.PI;
    const z = -P + (i / steps) * P;
    const [c, n] = [Math.cos(a), Math.sin(a)];
    return [[open * c, open * n, z - openHalf], [open * c, open * n, z + openHalf], [closed * c, closed * n, z + closedHalf], [closed * c, closed * n, z - closedHalf]];
  };
  const count = Math.ceil(((s.length + 2 * P) / P) * steps);
  const faces = [makePolygon(at(0))];
  for (let i = 0; i < count; i++) {
    const [p, q] = [at(i), at(i + 1)];
    for (let k = 0; k < p.length; k++) {
      const [a, b] = [k, (k + 1) % p.length];
      faces.push(makePolygon([p[a], q[a], q[b]]), makePolygon([p[a], q[b], p[b]]));
    }
  }
  faces.push(makePolygon([...at(count)].reverse()));
  const groove = makeSolid(faces) as Shape3D;
  const axis: P3 = [-s.dir[1], s.dir[0], 0]; // Z × dir
  const angle = (Math.acos(Math.max(-1, Math.min(1, s.dir[2] / Math.hypot(...s.dir)))) * 180) / Math.PI;
  const turned = Math.hypot(...axis) > 1e-9 ? groove.rotate(angle, [0, 0, 0], axis) : s.dir[2] < 0 ? groove.rotate(180, [0, 0, 0], [1, 0, 0]) : groove;
  return joined(shape, turned.translate(...s.at), 'cut');
}

/** A bulge's height (0 to 1) from its rim (`t` 0) to its peak (1) for fullness `k`: 0 soft, 1 straight, 2 a quarter ellipse, more flatter topped. */
/**
 * A bulge's height (0 to 1) from `t` (0 at the rim, 1 at the peak) for fullness `k` (-4 to 4): 0 as it comes (a
 * pillow), above that fuller (1 a dome, 4 flat topped, steeper at the rim), below it pointier (-4: a cone).
 */
export const rise = (t: number, k: number) => 1 - Math.pow(1 - t, k >= 0 ? 1 + k : 1 / (1 - k / 4));

/** A bulge's fullness, kept between -4 and 4. */
const fullness = (k: number) => Math.max(-4, Math.min(4, k));

/**
 * A box joint: where the body and the other overlap, sliced across the overlap's longest side into fingers (`width`
 * above 0: exactly that long from the low end, or from `from` both ways, the rest at the ends; else `count` equal
 * ones), every other one cut from the body (the first, or the one starting at `from`, kept if `first`), each cut
 * `clearance` / 2 wider on both sides. Two standing square to each other where one only touches (a face or an edge) or
 * partly reaches into the other (boxes, along an axis): the joint fills the whole meeting place, through the thinner one
 * there along each such axis, both grown.
 */
function fingers(shape: Shape3D | null, s: Of<'fingers'>): Shape3D {
  if (!shape) throw new Error('nothing to joint yet');
  const other = placeShape(buildBody(s.features), s.place);
  const [[la, ha], [lb, hb]] = [shape.boundingBox.bounds, other.boundingBox.bounds];
  const gaps = [0, 1, 2].map((a) => Math.max(lb[a] - ha[a], la[a] - hb[a]));
  if (gaps.some((g) => g > EPS)) throw new Error('the two bodies do not touch: move one onto or into the other');
  if (gaps.every((g) => g > -EPS)) throw new Error('the two bodies meet only at a corner: put one onto or into the other');
  // per axis: one range holds the other, or they only partly cover each other
  const holds = (a: number) => (la[a] <= lb[a] + EPS && ha[a] >= hb[a] - EPS) || (lb[a] <= la[a] + EPS && hb[a] >= ha[a] - EPS);
  const partly = [0, 1, 2].some((a) => !holds(a));
  let base = shape;
  let overlap: Shape3D;
  if (!partly || !square(s.place)) overlap = shape.clone().intersect(other);
  else {
    const thin = (a: number) => (ha[a] - la[a] < hb[a] - lb[a] ? [la[a], ha[a]] : [lb[a], hb[a]]);
    const range = [0, 1, 2].map((a) => (holds(a) ? [Math.max(la[a], lb[a]), Math.min(ha[a], hb[a])] : thin(a)));
    overlap = makeBox(range.map((r) => r[0]) as V3, range.map((r) => r[1]) as V3) as unknown as Shape3D;
    base = shape.fuse(overlap);
  }
  other.delete();
  try {
    const box = overlap.boundingBox;
    const [lo, hi] = box.bounds;
    const k = [0, 1, 2].reduce((best, a) => (hi[a] - lo[a] > hi[best] - lo[best] ? a : best), 0);
    const length = hi[k] - lo[k];
    if (!(length > 1e-6)) throw new Error('the two bodies do not overlap: a slanted one must reach into the other, or both stand square to each other');
    // the slices along k: [start, end, index]; index 0 is the first finger
    const slices: [number, number, number][] = [];
    if (s.width > 0) {
      const start = s.from ? Math.max(lo[k], Math.min(hi[k], s.from[k])) : lo[k];
      for (let j = -Math.ceil((start - lo[k]) / s.width - 1e-9); start + j * s.width < hi[k] - 1e-9; j++) slices.push([Math.max(lo[k], start + j * s.width), Math.min(hi[k], start + (j + 1) * s.width), j]);
    } else {
      const n = Math.max(1, Math.round(s.count));
      for (let i = 0; i < n; i++) slices.push([lo[k] + (length * i) / n, lo[k] + (length * (i + 1)) / n, i]);
    }
    // the slices this body gives up (every other one): a box across the overlap for each
    const pad = 1;
    let cut: Shape3D | null = null;
    for (const [from, to, i] of slices) {
      if (Math.abs(i % 2) !== (s.first ? 1 : 0)) continue;
      const [a, b] = [lo.map((v) => v - pad) as V3, hi.map((v) => v + pad) as V3];
      const c = (s.clearance ?? 0) / 2;
      [a[k], b[k]] = [from - c, to + c];
      cut = joined(cut, makeBox(a, b) as unknown as Shape3D, 'add');
    }
    if (!cut) return base.clone();
    const away = overlap.clone().intersect(cut);
    cut.delete();
    return joined(base.clone(), away, 'cut');
  } finally {
    overlap.delete();
    if (base !== shape) base.delete();
  }
}

/** Whether a placement turns axes onto axes. */
function square(pl: Place) {
  const n = norm(pl.axis);
  const [c, sn] = [Math.cos((pl.angle * Math.PI) / 180), Math.sin((pl.angle * Math.PI) / 180)];
  const turned = (v: V3) => add(add(scale(v, c), scale(cross(n, v), sn)), scale(n, dot(n, v) * (1 - c)));
  return !pl.angle || ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).every((v) => turned(v).every((x) => Math.abs(x) < 1e-6 || Math.abs(Math.abs(x) - 1) < 1e-6));
}

/** One of a shape's separate solids (see `PieceFeature`). */
function piece(shape: Shape3D | null, s: Of<'piece'>): Shape3D {
  if (!shape) throw new Error('nothing to keep a piece of yet');
  const at = (x: Shape3D) => x.boundingBox.center.map((v) => Math.round(v * 1e3) / 1e3);
  const solids = shape.solids.map((x) => ({ x, at: at(x) })).sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2]);
  const keep = solids[s.index]?.x;
  for (const { x } of solids) if (x !== keep) x.delete();
  if (!keep) throw new Error('this piece is gone: the body is in fewer pieces now');
  return keep;
}

/** A flat face pushed or pulled: the face extruded along its normal, joined (out, glued along the face) or cut (in). */
function push(shape: Shape3D | null, s: Of<'push'>): Shape3D {
  if (!shape) throw new Error('nothing to push or pull yet');
  if (!s.distance) throw new Error('the distance must not be 0');
  const face = new FaceFinder().near(s.at, ON_FACE).find(shape).find((f) => f.geomType === 'PLANE' && dot(f.normalAt(s.at).toTuple() as V3, s.n) > 0.99);
  if (!face) throw new Error('its face is gone, or no longer flat');
  const tool = basicFaceExtrusion(face.clone() as BRepFace, new Vector(scale(norm(s.n), s.distance))) as Shape3D;
  try {
    return s.distance > 0 ? shape.fuse(tool, { optimisation: 'commonFace' }) : shape.cut(tool, { optimisation: 'commonFace' });
  } finally {
    tool.delete();
  }
}

/**
 * A flat face drafted (OpenCascade's taper): turned `angle` degrees about its hinge, matter taken away on the side
 * away from the hinge (negative: added).
 */
function draft(shape: Shape3D | null, s: Of<'draft'>): Shape3D {
  if (!shape) throw new Error('nothing to draft yet');
  const oc = getOC();
  const face = new FaceFinder().near(s.at, ON_FACE).find(shape).find((f) => f.geomType === 'PLANE' && dot(f.normalAt(s.at).toTuple() as V3, s.n) > 0.99);
  if (!face) throw new Error('its face is gone, or no longer flat');
  // the pull direction: in the face, square to the hinge, from it towards the face
  let d = norm(cross(norm(s.n), norm(s.axis.dir)));
  if (dot(sub(s.at, s.axis.at), d) < 0) d = scale(d, -1);
  const dir = new oc.gp_Dir(...d);
  const plane = new oc.gp_Pln(new oc.gp_Pnt(...s.axis.at), dir);
  const algo = new oc.BRepOffsetAPI_DraftAngle(shape.wrapped);
  try {
    algo.Add(face.wrapped, dir, (s.angle * Math.PI) / 180, plane, true);
    if (!algo.AddDone()) throw new Error('the draft could not be made there (angle too large?)');
    algo.Build(new oc.Message_ProgressRange());
    if (!algo.IsDone()) throw new Error('the draft could not be made there (angle too large?)');
    return cast(algo.Shape()) as Shape3D;
  } finally {
    algo.delete();
    plane.delete();
    dir.delete();
  }
}

/**
 * A face bulged out (its peak above it; below: a dent), its rim kept. A flat face is replaced by a smooth surface over
 * its outer edges (see `dome`) and the solid sewn again; a round one is turned again around its axis with a bulging
 * profile; sketch shapes get a solid of their own: their face and a dome over it.
 */
function bulge(shape: Shape3D | null, s: Of<'bulge'>): Shape3D {
  const on = s.on;
  if (on.kind === 'round') return bulgeRound(shape, s, on);
  if (on.kind === 'frame') {
    const f = on.frame;
    const sketched = combine(on.profiles).sketchOnPlane(new Plane(f.o, f.x, f.n)) as unknown as { faces?(): Shape3D; face?(): BRepFace };
    const base = sketched.faces ? sketched.faces().faces : [sketched.face!()];
    // each piece its own dome, its base facing away from it
    const solids = base.map((face) => makeSolid([dome(face.clone() as BRepFace, f.n, s), face]) as unknown as Shape3D); // reading a face's wire frees it
    return solids.reduce((acc: Shape3D | null, solid) => joined(acc, solid, 'add'), shape)!;
  }
  if (!shape) throw new Error('nothing to bulge yet');
  const faces = shape.faces;
  const hit = new FaceFinder().near(on.at, ON_FACE).find(shape).find((f) => f.geomType === 'PLANE');
  const i = hit ? faces.findIndex((f) => f.isSame(hit)) : -1;
  if (i < 0) throw new Error('its face is gone, or no longer flat');
  const face = faces[i];
  const n = face.normalAt(on.at).toTuple();
  const holes = (face.clone() as BRepFace).innerWires();
  if (!holes.length) return makeSolid([...faces.filter((_, j) => j !== i), dome(face, n, s, on.mid)]) as unknown as Shape3D;
  // with holes: a dome over its outline joined (a dent: cut), then the holes drilled through it again
  const lid = makeSolid([dome(face.clone() as BRepFace, n, s, on.mid), makeFace((face.clone() as BRepFace).outerWire())]) as unknown as Shape3D;
  // the lid lies on the face: glued along it (OpenCascade's common-face boolean)
  const height = dot(s.peak, n);
  let out = height > 0 ? shape.fuse(lid, { optimisation: 'commonFace' }) : shape.cut(lid, { optimisation: 'commonFace' });
  lid.delete();
  for (const w of holes) {
    const drill = basicFaceExtrusion(makeFace(w), new Vector(scale(n, Math.abs(height) + 1))) as Shape3D;
    const next = joined(out, drill, 'cut');
    out.delete();
    out = next;
  }
  return out;
}

/**
 * The smooth surface over a flat face's outer edges, rising along `n` (see `bulge`). How high each point rises comes
 * from a pillow (Poisson's equation on a grid over the face, 0 at the rim: one smooth field, rounded towards corners,
 * no creases), leaning so its top lies at the peak, then shaped by the curve. OpenCascade's filling passes through those heights on `dirs` lines from the rim to the peak.
 */
function dome(face: BRepFace, n: V3, s: Of<'bulge'>, mid?: V3, cells = 60, dirs = 48, rings = 6, margin = 0.3, grid = 12): BRepFace {
  const oc = getOC();
  // the peak's height above the face; the face's plane: u, v around its middle (read before its wire: that frees the face)
  const amount = dot(s.peak, n);
  if (Math.abs(amount) < 1e-6) throw new Error('the peak lies on the face: it needs a height');
  const c = mid ?? (face.center.toTuple() as V3);
  const edges = face.outerWire().edges;
  const u = Math.abs(n[2]) < 0.9 ? norm(cross([0, 0, 1], n)) : norm(cross([0, 1, 0], n));
  const v = cross(n, u);
  const uv = (p: V3): [number, number] => [dot(sub(p, c), u), dot(sub(p, c), v)];
  const at = (x: number, y: number, h: number) => add(add(c, add(scale(u, x), scale(v, y))), scale(n, h));
  // the rim as a polygon (plane coordinates): the edges chained end to end (they come in any order and direction)
  const runs = edges.map((e) => {
    const m = Math.max(4, Math.ceil(e.length / 2));
    return Array.from({ length: m + 1 }, (_, k) => uv(e.pointAt(k / m).toTuple() as V3));
  });
  const rim = runs.shift()!;
  while (runs.length) {
    const end = rim.at(-1)!;
    const gap = (p: [number, number]) => Math.hypot(p[0] - end[0], p[1] - end[1]);
    const near = (r: [number, number][]) => Math.min(gap(r[0]), gap(r.at(-1)!));
    const r = runs.splice(runs.reduce((best, r, k) => (near(r) < near(runs[best]) ? k : best), 0), 1)[0];
    rim.push(...(gap(r[0]) < gap(r.at(-1)!) ? r : r.reverse()).slice(1));
  }
  rim.pop(); // back at the start
  const xs = rim.map((p) => p[0]);
  const ys = rim.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const h = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) / cells;
  const [nx, ny] = [Math.ceil((Math.max(...xs) - x0) / h) + 3, Math.ceil((Math.max(...ys) - y0) / h) + 3];
  const X = (i: number) => x0 + (i - 1) * h;
  const Y = (j: number) => y0 + (j - 1) * h;
  const inside = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let odd = false;
      for (let k = 0, m = rim.length - 1; k < rim.length; m = k++) {
        const [a, b] = [rim[k], rim[m]];
        if (a[1] > Y(j) !== b[1] > Y(j) && X(i) < a[0] + ((Y(j) - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) odd = !odd;
      }
      inside[j * nx + i] = +odd;
    }
  // the pillow: Δf = -w inside, 0 outside (over-relaxed Gauss-Seidel), scaled to 1 at its top. w = e^(g·p) leans the
  // top towards the peak: g is nudged until the top lies there. One smooth field, however far off the middle the peak is.
  const size = (cells * h) / 2;
  // the peak in the face's plane, kept `margin` (of the face's half size) from the rim: nearer, the surface turns too steep to fill
  const fromRim = (x: number, y: number) => Math.min(...rim.map(([u, v]) => Math.hypot(x - u, y - v)));
  const f = new Float64Array(nx * ny);
  const w = new Float64Array(nx * ny);
  const solve = (gx: number, gy: number, its: number) => {
    for (let k = 0; k < w.length; k++) w[k] = Math.exp(gx * X(k % nx) + gy * Y(Math.floor(k / nx)));
    for (let it = 0; it < its; it++)
      for (let k = 0; k < f.length; k++)
        if (inside[k]) f[k] += 1.9 * ((f[k - 1] + f[k + 1] + f[k - nx] + f[k + nx] + h * h * w[k]) / 4 - f[k]);
  };
  const topOf = () => f.reduce((best, v, k) => (v > f[best] ? k : best), 0);
  let [gx, gy] = [0, 0];
  solve(gx, gy, 4 * cells);
  // how far a face's box reaches from the face's plane, the way it bulges
  const reach = ({ bounds: [lo, hi] }: { bounds: [V3, V3] }) => Math.max(...[lo, hi].flatMap((a) => [lo, hi].flatMap((b) => [lo, hi].map((d) => dot(sub([a[0], b[1], d[2]], c), n) * Math.sign(amount)))));
  // the peak where asked; if no filling holds there, step by step nearer the middle
  const [wx, wy] = uv(add(c, s.peak));
  for (let pull = 1; pull > 0.1; pull *= 0.8) {
    let [px, py] = [wx * pull, wy * pull];
    for (let k = 0.95; fromRim(px, py) < margin * size && k > 0.05; k -= 0.05) [px, py] = [wx * pull * k, wy * pull * k];
    const face = attempt(px, py);
    if (face) return face;
  }
  throw new Error('the bulge surface could not be made');

  /** The filling for a peak at (px, py), or null if it did not hold. */
  function attempt(px: number, py: number): BRepFace | null {
    let top = topOf();
    for (let n = 0; n < 12 && Math.hypot(px - X(top % nx), py - Y(Math.floor(top / nx))) > h; n++) {
      // about how far the top moves per unit of tilt (an interval's: R² / 3), damped; kept from overflowing
      [gx, gy] = [gx + (1.5 / (size * size)) * (px - X(top % nx)), gy + (1.5 / (size * size)) * (py - Y(Math.floor(top / nx)))];
      const g = Math.hypot(gx, gy) * size;
      if (g > 30) [gx, gy] = [(gx * 30) / g, (gy * 30) / g];
      solve(gx, gy, cells);
      top = topOf();
    }
    const fmax = f[top] || 1;
    const field = (x: number, y: number) => {
      const [fi, fj] = [(x - x0) / h + 1, (y - y0) / h + 1];
      const [i, j] = [Math.floor(fi), Math.floor(fj)];
      if (i < 0 || j < 0 || i + 1 >= nx || j + 1 >= ny) return 0;
      const [a, b] = [fi - i, fj - j];
      const k = j * nx + i;
      return ((1 - a) * (1 - b) * f[k] + a * (1 - b) * f[k + 1] + (1 - a) * b * f[k + nx] + a * b * f[k + nx + 1]) / fmax;
    };
    const height = (x: number, y: number) => amount * rise(Math.max(0, Math.min(1, field(x, y))), fullness(s.fullness));
    const peak: [number, number] = [X(top % nx), Y(Math.floor(top / nx))];
    // the filling's points, and the top: first on an even grid over the face (`grid` across, kept off the rim), else on
    // `dirs` lines from the rim to the top, `rings` along each. OpenCascade's filling now and then ignores them (a flat
    // face back): tried again with other settings until its top is near the height
    // per try: lines (0: the grid), iterations, highest degree, most segments
    const tries = [
      [0, 3, 8, 12],
      [dirs, 3, 10, 30],
      [32, 2, 8, 9],
      [24, 2, 8, 20],
    ];
    const step = Math.max(1, Math.round(cells / grid));
    for (const [count, iterations, degree, segments] of tries) {
      const fill = new oc.BRepOffsetAPI_MakeFilling(3, 15, iterations, false, 1e-5, 1e-4, 0.01, 0.1, degree, segments);
      for (const e of edges) fill.Add(e.wrapped, oc.GeomAbs_Shape.GeomAbs_C0, true);
      if (!count)
        for (let j = 0; j < ny; j += step)
          for (let i = 0; i < nx; i += step)
            if (inside[j * nx + i] && fromRim(X(i), Y(j)) > step * h && Math.hypot(X(i) - peak[0], Y(j) - peak[1]) > step * h) fill.Add(new oc.gp_Pnt(...at(X(i), Y(j), height(X(i), Y(j)))));
      for (let k = 0; k < count; k++) {
        const r = rim[Math.floor((k * rim.length) / count)];
        for (let q = 1; q < rings; q++) {
          const [x, y] = [r[0] + (peak[0] - r[0]) * (q / rings), r[1] + (peak[1] - r[1]) * (q / rings)];
          fill.Add(new oc.gp_Pnt(...at(x, y, height(x, y))));
        }
      }
      fill.Add(new oc.gp_Pnt(...at(...peak, amount)));
      fill.Build(new oc.Message_ProgressRange());
      if (!fill.IsDone()) continue;
      const out = cast(fill.Shape()) as BRepFace;
      if (Math.abs(reach(out.boundingBox as { bounds: [V3, V3] }) - Math.abs(amount)) < 0.2 * Math.abs(amount)) return out;
      out.delete();
    }
    return null;
  }
}

/**
 * A round face bulged, turned again around its axis: the peak's part along the axis (from the face's middle) is where
 * it bulges most, its distance from the axis less the radius how far (out: the radius grows, a hole widens).
 */
function bulgeRound(shape: Shape3D | null, s: Of<'bulge'>, on: Extract<Of<'bulge'>['on'], { kind: 'round' }>, steps = 40): Shape3D {
  if (!shape) throw new Error('nothing to bulge yet');
  const dir = norm(on.dir);
  const along = dot(s.peak, dir);
  const amount = Math.hypot(...sub(s.peak, scale(dir, along))) - on.r;
  if (Math.abs(amount) < 1e-6) throw new Error('the peak lies on the face: it needs a height');
  const mid = Math.max(0.01 * on.length, Math.min(0.99 * on.length, on.length / 2 + along));
  // the radius along the axis (z from `at`)
  const radius = (z: number) => on.r + amount * rise(z < mid ? z / mid : (on.length - z) / (on.length - mid), fullness(s.fullness));
  const pts = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * on.length).map((z): V3 => [radius(z), 0, z]);
  if (pts.some(([r]) => r <= 0)) throw new Error('the radius would reach 0');
  // the half outline in the XZ plane, its bulging side one smooth curve through the points (one face when turned)
  const side = makeBSplineApproximation(pts, { tolerance: 1e-3, degMax: 3 });
  const [top, bottom] = [pts[steps], pts[0]];
  const outline = assembleWire([side, makeLine(top, [0, 0, on.length]), makeLine([0, 0, on.length], [0, 0, 0]), makeLine([0, 0, 0], bottom)]);
  const vase = revolution(makeFace(outline), [0, 0, 0], [0, 0, 1]);
  const core = makeCylinder(on.r, on.length) as Shape3D;
  // into place: Z along the axis from `at`
  const place = (solid: Shape3D) => {
    const axis: V3 = [-dir[1], dir[0], 0]; // Z × dir
    const angle = (Math.acos(Math.max(-1, Math.min(1, dir[2]))) * 180) / Math.PI;
    const turned = Math.hypot(...axis) > 1e-9 ? solid.rotate(angle, [0, 0, 0], axis) : dir[2] < 0 ? solid.rotate(180, [0, 0, 0], [1, 0, 0]) : solid;
    return turned.translate(...on.at);
  };
  // a shaft: its round part becomes the vase; a hole: filled, then the vase cut out
  const between = joined(shape, place(core), on.shaft ? 'cut' : 'add');
  try {
    return joined(between, place(vase), on.shaft ? 'add' : 'cut');
  } finally {
    between.delete();
  }
}

/** `tool` joined to or cut from `shape` (none yet: `tool` itself); `tool` is used up. */
function joined(shape: Shape3D | null, tool: Shape3D, mode: 'add' | 'cut'): Shape3D {
  if (!shape) return tool;
  try {
    return mode === 'add' ? shape.fuse(tool) : shape.cut(tool);
  } finally {
    tool.delete();
  }
}

/** Keeps one side of the cutter (see `SplitFeature`): the body against a solid that fills that side far beyond it. */
function split(shape: Shape3D | null, s: Of<'split'>): Shape3D {
  if (!shape) throw new Error('nothing to cut yet');
  const b = shape.boundingBox;
  const far = 2 * (Math.hypot(b.width, b.height, b.depth) + Math.hypot(...b.center)) + 10;
  const kept = cutterSide(s.cutter, far);
  try {
    const out = s.side === 1 ? shape.intersect(kept) : shape.cut(kept);
    if (!out.faces.length) throw new Error('the cut keeps nothing of the body on this side');
    return out;
  } finally {
    kept.delete();
  }
}

/** The solid on the cutter's kept side (+1), `far` mm beyond everything: past a plane, left of a line, inside a shape, ball or cylinder. */
function cutterSide(c: Of<'split'>['cutter'], far: number): Shape3D {
  if (c.kind === 'shape') throw new Error('its cutting shape is not found');
  if (c.kind === 'sphere' || c.kind === 'cylinder') {
    const r = c.d / 2 + c.offset;
    if (r <= 0) throw new Error(`the ${c.kind === 'sphere' ? 'ball' : 'cylinder'} has no size`);
    return c.kind === 'sphere' ? makeSphere(r).translate(...c.c) : makeCylinder(r, c.h, c.c, c.dir);
  }
  if (c.kind === 'plane') {
    const f = cutPlane(c);
    return drawRectangle(2 * far, 2 * far).sketchOnPlane(new Plane(f.o, f.x, f.n)).extrude(far) as Shape3D;
  }
  const { frame: f, profile: p } = c;
  const line = p.kind === 'line' ? movedLine(p, c.offset) : null;
  return (line ? leftOf(line, far) : drawing(p)).sketchOnPlane(new Plane(add(f.o, scale(f.n, -far)), f.x, f.n)).extrude(2 * far) as Shape3D;
}

/** The region left of an open line (plane coordinates), its ends drawn on `far` mm and closed far to the left. */
function leftOf(line: { pts: [number, number][]; curves?: (Curve | null)[] }, far: number): Drawing {
  const unit = ([x, y]: [number, number]): [number, number] => [x / (Math.hypot(x, y) || 1), y / (Math.hypot(x, y) || 1)];
  const { pts, curves } = line;
  const n = pts.length - 1;
  const d0 = unit(sideDirs(pts[0], curves?.[0], pts[1])[0]);
  const d1 = unit(sideDirs(pts[n - 1], curves?.[n - 1], pts[n])[1]);
  const start: [number, number] = [pts[0][0] - d0[0] * far, pts[0][1] - d0[1] * far];
  const end: [number, number] = [pts[n][0] + d1[0] * far, pts[n][1] + d1[1] * far];
  return sidesDrawn(draw(start).lineTo(pts[0]), line).lineTo(end).lineTo([end[0] - d1[1] * far, end[1] + d1[0] * far]).lineTo([start[0] - d0[1] * far, start[1] + d0[0] * far]).close();
}

/**
 * What picked edges are now, as polylines. One stays where it was while an edge lies on it between a face it knew;
 * else it takes the edge that looks like it (straight along the same way between faces facing the same ways, or curved
 * beside a face facing the same way), if that one is clearly the nearest in place and length. `lost`: how many are neither. Left out ones (`skip`) are dropped.
 */
function pickedNow(shape: Shape3D, rule: Exclude<EdgeRule, string>, skip: V3[], tol = 0.05) {
  const edges = shape.edges;
  const faces = new Map<number, Shape3D['faces']>();
  // the faces meeting at each edge: known only once an edge has to be told apart
  const facesOf = (e: Edge) => {
    if (!faces.size) for (const f of shape.faces) for (const g of f.edges) faces.set(g.hashCode, [...(faces.get(g.hashCode) ?? []), f]);
    return faces.get(e.hashCode) ?? [];
  };
  const point = (e: Edge, t: number) => e.pointAt(t).toTuple() as V3;
  const normalsOf = (e: Edge) => facesOf(e).map((f) => f.normalAt(e.pointAt(0.5)).toTuple() as V3);
  const straight = (pts: V3[]) => pts.every((p) => Math.hypot(...cross(sub(p, pts[0]), norm(sub(pts.at(-1)!, pts[0])))) < tol);
  const facing = (a: V3, b: V3) => dot(norm(a), norm(b)) > 0.995;
  const lengthOf = (pts: V3[]) => pts.slice(1).reduce((sum, p, k) => sum + Math.hypot(...sub(p, pts[k])), 0);
  const lines: V3[][] = [];
  let lost = 0;
  rule.pts.forEach((pts, k) => {
    const line = pts.flat();
    if (skip.some((p) => toLine(p, line, false) < tol)) return;
    const on = edges.filter((e) => [0, 0.5, 1].every((t) => toLine(point(e, t), line, false) < tol));
    const want = rule.normals?.[k] ?? [];
    if (!want.length || on.some((e) => normalsOf(e).some((n) => want.some((w) => facing(n, w))))) return on.length ? void lines.push(pts) : void lost++;
    const [mid, along, curved, long] = [pts[pts.length >> 1], norm(sub(pts.at(-1)!, pts[0])), !straight(pts), lengthOf(pts)];
    const like = edges.flatMap((e) => {
      const sampled = Array.from({ length: 9 }, (_, i) => point(e, i / 8));
      if (!straight(sampled) !== curved || (!curved && Math.abs(dot(along, norm(sub(sampled[8], sampled[0])))) < 0.995)) return [];
      const normals = normalsOf(e);
      // a round face's normal turns along the edge: one face facing the same way is enough there
      if (!(curved ? want.some : want.every).call(want, (w) => normals.some((n) => facing(n, w)))) return [];
      return [{ sampled, far: Math.hypot(...sub(sampled[4], mid)) + Math.abs(lengthOf(sampled) - long) }];
    }).sort((a, b) => a.far - b.far);
    if (like.length && (like.length < 2 || like[1].far > like[0].far * 1.5 + 0.01)) lines.push(like[0].sampled);
    else if (on.length) lines.push(pts);
    else lost++;
  });
  return { lines, lost };
}

function finish(shape: Shape3D | null, s: Of<'finish'>, circles: Circle[], finishing?: Finishing, lostIn = finishing): Shape3D {
  if (!shape) throw new Error('nothing to finish yet');
  positive(s.size, s.mode === 'fillet' ? 'radius' : 'distance');
  const [[, , bottom], [, , top]] = shape.boundingBox.bounds;
  const now = typeof s.edges === 'object' ? pickedNow(shape, s.edges, s.skip) : null;
  if (now?.lost && lostIn) lostIn.lost = { ...lostIn.lost, [s.id]: now.lost };
  const rule = edgeRule(now ? { pts: now.lines } : s.edges, bottom, top, circles);
  const at = (e: Edge, t: number): V3 => e.pointAt(t).toTuple() as V3;
  const pick = (e: Edge) => rule(e) && !s.skip.some((p) => Math.hypot(...at(e, 0.5).map((v, k) => v - p[k])) < 0.01);
  const picked = shape.edges.filter(pick);
  const count = picked.length;
  if (!count) throw new Error(now ? 'the picked edges are gone' : `no edges match "${s.edges}"`);
  for (const e of picked) finishing?.edges.push({ feature: s.id, size: s.size, mid: at(e, 0.5), pts: Array.from({ length: 9 }, (_, i) => at(e, i / 8)) });
  const sized = (v: number) => (s.mode === 'fillet' ? shape.fillet((e) => (pick(e) ? v : null)) : shape.chamfer((e) => (pick(e) ? v : null)));
  try {
    return sized(s.size);
  } catch {
    // too big: the largest size that works (the gap halved 10 times), for clamping to
    let [lo, hi] = [0, s.size];
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      try {
        sized(mid).delete();
        lo = mid;
      } catch {
        hi = mid;
      }
    }
    throw new FeatureError(s.id, `${s.mode} on ${count} edges failed (size too large?${s.baked ? '' : ' Bake it to leave edges of later cuts sharp'})`, lo || undefined);
  }
}

function edgeRule(rule: EdgeRule, bottom: number, top: number, circles: Circle[], tol = 0.05): (e: Edge) => boolean {
  if (typeof rule === 'object') {
    // picked edges: its ends and middle lie on one of their polylines
    const lines = rule.pts.map((pts) => pts.flat());
    return (e) => lines.some((line) => [0, 0.5, 1].every((t) => toLine(e.pointAt(t).toTuple() as V3, line, false) < tol));
  }
  return (e) => {
    const [[x0, y0, z0], [x1, y1, z1]] = e.boundingBox.bounds;
    const vertical = x1 - x0 < EPS && y1 - y0 < EPS;
    if (vertical && circles.some(([cx, cy, r]) => Math.abs(Math.hypot(x0 - cx, y0 - cy) - r) < EPS)) return false;
    const at = (z: number) => Math.abs(z0 - z) < EPS && Math.abs(z1 - z) < EPS;
    switch (rule) {
      case 'all':
        return true;
      case 'vertical':
        return vertical;
      case 'top':
        return at(top);
      case 'bottom':
        return at(bottom);
    }
  };
}
