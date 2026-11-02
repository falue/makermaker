import { draw, drawCircle, drawRoundedRectangle, importSTEP, makeSphere, Plane, type Drawing, type Edge, type Shape3D } from 'replicad';
import { add, frames, scale, toWorld, type Frame, type Place } from '../doc/frames';
import { centre, corners, nesting } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BooleanOp, BuildIn, EdgeRule, Profile } from '../doc/types';

/** A boolean with its tool body's features at hand, placed as the tool body sits in this body's coordinates. */
export type BooleanBuild = { id: string; type: 'boolean'; op: BooleanOp; features: BuildFeature[]; place: Place };
export type BuildFeature = Resolved<BuildIn> | BooleanBuild;
type Of<T extends BuildFeature['type']> = Extract<BuildFeature, { type: T }>;

export interface BodyMesh {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  /** Per B-rep face: start and count in `indices`. */
  faces: Uint32Array;
  /** B-rep vertices (edge ends), xyz, each once: snap points. */
  corners: Float32Array;
  /** Per B-rep edge: start and count of its points in `edges` (segment pairs). */
  edgeGroups: Uint32Array;
  /** Per B-rep edge: 1 if an unbaked finish made it. */
  finishEdges: Uint8Array;
  /** Per B-rep face: the index in `finishes` of the finished edge it rounds or chamfers, else -1. */
  finishFaces: Int32Array;
  /** Edges unbaked finishes worked on: the feature and a point on the edge (its middle; `skip` takes these). */
  finishes: { feature: string; mid: V3 }[];
}

type V3 = [number, number, number];

/** What unbaked finishes start from and which edges they work on (sampled points), filled by `buildBody`. */
export interface Finishing {
  base: Shape3D | null;
  edges: { feature: string; size: number; mid: V3; pts: V3[] }[];
}

export class FeatureError extends Error {
  constructor(
    readonly featureId: string,
    message: string,
  ) {
    super(message);
  }
}

/** [cx, cy, r] of vertical cylindrical faces; their seam and tangent lines are never finished. */
type Circle = [number, number, number];

const EPS = 1e-3;

/**
 * Features run in order, except unbaked finishes: they run last, so they also finish edges of later booleans. A baked
 * finish stays in place: a later boolean cuts through it. `finishing` gets what the unbaked ones did.
 */
export function buildBody(features: BuildFeature[], finishing?: Finishing): Shape3D {
  const plan = frames(features.filter((f) => f.type !== 'boolean'));
  const circles: Circle[] = [];
  let shape: Shape3D | null = null;
  const apply = (id: string, fn: (s: Shape3D | null) => Shape3D) => {
    const next = run(id, () => fn(shape));
    shape?.delete();
    shape = next;
  };
  try {
    for (const s of features) {
      if (s.type === 'extrude') apply(s.id, (cur) => extrude(cur, s, plan.get(s.id), circles));
      if (s.type === 'sphere') apply(s.id, (cur) => sphere(cur, s));
      if (s.type === 'step') apply(s.id, (cur) => step(cur, s));
      if (s.type === 'boolean') apply(s.id, (cur) => boolean(cur, s));
      if (s.type === 'finish' && s.enabled && s.baked) apply(s.id, (cur) => finish(cur, s, circles));
    }
    if (!shape) throw new FeatureError(features[0]?.id ?? '', 'a body needs an added extrusion');
    if (finishing) finishing.base = (shape as Shape3D).clone();
    for (const s of features) if (s.type === 'finish' && s.enabled && !s.baked) apply(s.id, (cur) => finish(cur, s, circles, finishing));
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

/** The mesh of a body; `finishing` (from `buildBody`) marks the edges and faces its unbaked finishes made. */
export function meshBody(shape: Shape3D, finishing?: Finishing): BodyMesh {
  const opts = { tolerance: 0.02, angularTolerance: 0.1 };
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
    corners: new Float32Array([...ends.values()].flat()),
    edgeGroups: new Uint32Array(e.edgeGroups.flatMap((g) => [g.start, g.count])),
    finishEdges,
    finishFaces,
    finishes: finishing?.edges.map(({ feature, mid }) => ({ feature, mid })) ?? [],
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
      if (p.r < 0 || p.r * 2 >= Math.min(p.w, p.h)) throw new Error('corner radius must be between 0 and half the shorter side');
      return drawRoundedRectangle(p.w, p.h, p.r).rotate(p.rot).translate(p.x, p.y);
    case 'circle':
      positive(p.d, 'diameter');
      return drawCircle(p.d / 2).translate(p.x, p.y);
    case 'ngon':
      positive(p.d, 'diameter');
      if (!(p.sides >= 3)) throw new Error('a regular polygon needs 3 sides');
      return corners(p).slice(1).reduce((pen, pt) => pen.lineTo(pt), draw(corners(p)[0])).close();
    case 'line':
      throw new Error('an open line cannot be extruded');
    case 'polygon': {
      if (p.pts.length < 3) throw new Error('a polygon needs 3 corners');
      if (p.r < 0) throw new Error('corner radius must not be negative');
      const closed = p.pts.slice(1).reduce((pen, pt) => pen.lineTo(pt), draw(p.pts[0])).close();
      return (p.r > 0 ? closed.fillet(p.r) : closed).rotate(p.rot, centre(p));
    }
  }
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

/** The picked areas together. */
function areaDrawing(ps: Resolved<Profile>[], areas: Area[]): Drawing {
  const byId = new Map(ps.map((p) => [p.id, p]));
  const d = areas.map((a) => area(byId, a)).reduce((x, y) => x.fuse(y));
  if (!filled(d)) throw new Error('the picked areas are empty');
  return d;
}

/** A drawing's areas, as triangles in its plane (x, y per corner). */
export interface AreaMesh extends Area {
  tris: Float32Array;
}

/**
 * Splits overlapping shapes into areas: each area lies inside some shapes and outside the others (an even/odd
 * independent overlay), with triangles to show and pick it.
 */
export function areasOf(ps: Resolved<Profile>[]): AreaMesh[] {
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
  const faces = (d.sketchOnPlane('XY') as unknown as { faces(): Shape3D }).faces();
  const m = faces.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
  const out = new Float32Array(m.triangles.length * 2);
  m.triangles.forEach((v, i) => out.set([m.vertices[v * 3], m.vertices[v * 3 + 1]], i * 2));
  return out;
}

/** Cylindrical faces standing on an XY-parallel plane (circles, rounded corners), for the edge rules. */
function addCircles(p: Resolved<Profile>, f: Frame, circles: Circle[]) {
  if (Math.abs(Math.abs(f.n[2]) - 1) > EPS) return;
  const at = (u: number, v: number, r: number) => {
    const [x, y] = toWorld(f, u, v);
    circles.push([x, y, r]);
  };
  if (p.kind === 'circle') at(p.x, p.y, p.d / 2);
  if (p.kind === 'rect' && p.r > 0)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) at(p.x + sx * (p.w / 2 - p.r), p.y + sy * (p.h / 2 - p.r), p.r);
}

/** Joins, cuts or intersects with the tool body (built here from its features). */
function boolean(shape: Shape3D | null, s: Of<'boolean'>): Shape3D {
  const built = buildBody(s.features);
  const tool = placeShape(built, s.place);
  try {
    if (!shape) {
      if (s.op !== 'union') throw new Error('nothing to cut or intersect yet');
      return tool.clone();
    }
    return s.op === 'union' ? shape.fuse(tool) : s.op === 'subtract' ? shape.cut(tool) : shape.intersect(tool);
  } finally {
    tool.delete();
  }
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
  if (!s.through && s.depth === 0) throw new Error('depth must not be 0');
  const outline = s.areas ? areaDrawing(s.profiles, s.areas) : combine(s.profiles);
  // span along the normal; through: beyond the body on both sides
  const bounds = shape?.boundingBox;
  const far = bounds ? Math.hypot(bounds.width, bounds.height, bounds.depth) + Math.hypot(...f.o) + 1 : 0;
  const [from, to] = s.through ? [-far, far] : [Math.min(0, s.depth), Math.max(0, s.depth)];
  const tool = outline.sketchOnPlane(new Plane(add(f.o, scale(f.n, from)), f.x, f.n)).extrude(to - from) as Shape3D;
  for (const p of s.profiles) addCircles(p, f, circles);
  if (!shape) return tool;
  try {
    return s.mode === 'add' ? shape.fuse(tool) : shape.cut(tool);
  } finally {
    tool.delete();
  }
}

function finish(shape: Shape3D | null, s: Of<'finish'>, circles: Circle[], finishing?: Finishing): Shape3D {
  if (!shape) throw new Error('nothing to finish yet');
  positive(s.size, s.mode === 'fillet' ? 'radius' : 'distance');
  const [[, , bottom], [, , top]] = shape.boundingBox.bounds;
  const rule = edgeRule(s.edges, bottom, top, circles);
  const at = (e: Edge, t: number): V3 => e.pointAt(t).toTuple() as V3;
  const pick = (e: Edge) => rule(e) && !s.skip.some((p) => Math.hypot(...at(e, 0.5).map((v, k) => v - p[k])) < 0.01);
  const picked = shape.edges.filter(pick);
  const count = picked.length;
  if (!count) throw new Error(`no edges match "${s.edges}"`);
  for (const e of picked) finishing?.edges.push({ feature: s.id, size: s.size, mid: at(e, 0.5), pts: Array.from({ length: 9 }, (_, i) => at(e, i / 8)) });
  const size = (e: Edge) => (pick(e) ? s.size : null);
  try {
    return s.mode === 'fillet' ? shape.fillet(size) : shape.chamfer(size);
  } catch {
    throw new Error(`${s.mode} on ${count} edges failed (size too large?${s.baked ? '' : ' Bake it to leave edges of later cuts sharp'})`);
  }
}

function edgeRule(rule: EdgeRule, bottom: number, top: number, circles: Circle[]): (e: Edge) => boolean {
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
