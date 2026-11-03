import { assembleWire, basicFaceExtrusion, cast, draw, drawCircle, drawRectangle, FaceFinder, makeBSplineApproximation, makeFace, makeLine, revolution, drawRoundedRectangle, getOC, importSTEP, makeCylinder, makePolygon, makeSolid, makeSphere, measureArea, Vector, Plane, type Drawing, type Edge, type Face as BRepFace, type Shape3D, type Sketch } from 'replicad';
import { add, cross, cutPlane, dot, extent, frames, norm, scale, sub, toWorld, type Frame, type Place } from '../doc/frames';
import { beside, centre, corners, nesting } from '../doc/profiles';
import { lineFaceAt, lineFaces, type Face } from '../doc/arrangement';
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

/**
 * Features run in order, except unbaked finishes: they run last, so they also finish edges of later booleans (and
 * mirrors after them, so finishes keep their picked edges). A baked finish stays in place: a later boolean cuts through it. `finishing` gets what the unbaked ones did.
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
      if (s.type === 'split') apply(s.id, (cur) => split(cur, s));
      if (s.type === 'revolve') apply(s.id, (cur) => revolve(cur, s, plan.get(s.id)));
      if (s.type === 'loft') apply(s.id, (cur) => loft(cur, s));
      if (s.type === 'sweep') apply(s.id, (cur) => sweep(cur, s));
      if (s.type === 'shell') apply(s.id, (cur) => shell(cur, s));
      if (s.type === 'thread') apply(s.id, (cur) => thread(cur, s));
      if (s.type === 'bulge') apply(s.id, (cur) => bulge(cur, s));
      if (s.type === 'finish' && s.enabled && s.baked) apply(s.id, (cur) => finish(cur, s, circles));
    }
    if (!shape) throw new FeatureError(features[0]?.id ?? '', 'a body needs an added extrusion');
    if (finishing) finishing.base = (shape as Shape3D).clone();
    for (const s of features) if (s.type === 'finish' && s.enabled && !s.baked) apply(s.id, (cur) => finish(cur, s, circles, finishing));
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

/** A face as a drawing: its outline, its holes cut out. */
function faceDrawing(f: Face): Drawing {
  const poly = (pts: [number, number][]) => pts.slice(1).reduce((pen, pt) => pen.lineTo(pt), draw(pts[0])).close();
  return f.holes.reduce((d, h) => d.cut(poly(h)), poly(f.outer));
}

/** The picked areas together. */
function areaDrawing(ps: Resolved<Profile>[], areas: Area[]): Drawing {
  const byId = new Map(ps.map((p) => [p.id, p]));
  const lined = (at: [number, number]) => {
    const f = lineFaceAt(ps, at);
    if (!f) throw new Error('a picked area is no longer closed by its lines');
    return faceDrawing(f);
  };
  const d = areas.map((a) => (a.at ? lined(a.at) : area(byId, a))).reduce((x, y) => x.fuse(y));
  if (!filled(d)) throw new Error('the picked areas are empty');
  return d;
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
  const { faces, uses } = lineFaces(ps);
  const lined = faces.map((f): AreaMesh => ({ in: f.in, out: [], at: f.at, uses, tris: triangles(faceDrawing(f)) }));
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
  if (!s.through && s.depth === 0 && !s.back) throw new Error('depth must not be 0');
  const outline = s.areas ? areaDrawing(s.profiles, s.areas) : combine(s.profiles);
  // span along the normal; through: beyond the body on both sides
  const bounds = shape?.boundingBox;
  const far = bounds ? Math.hypot(bounds.width, bounds.height, bounds.depth) + Math.hypot(...f.o) + 1 : 0;
  const [from, to] = s.through ? [-far, far] : extent(s.depth, s.back);
  const tool = outline.sketchOnPlane(new Plane(add(f.o, scale(f.n, from)), f.x, f.n)).extrude(to - from) as Shape3D;
  for (const p of s.profiles) addCircles(p, f, circles);
  return joined(shape, tool, s.mode);
}

/** Shapes turned around their axis (in their plane), joined to or cut from the body. */
function revolve(shape: Shape3D | null, s: Of<'revolve'>, f: Frame | undefined): Shape3D {
  if (!f) throw new Error('sketch plane lost: the face it was on is gone');
  if (!shape && s.mode === 'cut') throw new Error('nothing to cut yet');
  if (!s.profiles.length) throw new Error('no profile to revolve');
  if (!s.angle) throw new Error('the angle must not be 0');
  const outline = s.areas ? areaDrawing(s.profiles, s.areas) : combine(s.profiles);
  const dir = add(scale(f.x, s.axis.dir[0]), scale(f.y, s.axis.dir[1]));
  const tool = outline.sketchOnPlane(new Plane(f.o, f.x, f.n)).revolve(dir, { origin: toWorld(f, ...s.axis.at), angle: Math.max(-360, Math.min(360, s.angle)) }) as Shape3D;
  return joined(shape, tool, s.mode);
}

/** A solid through its shapes in order, joined to the body (the first one makes it). */
function loft(shape: Shape3D | null, s: Of<'loft'>): Shape3D {
  if (s.sections.length < 2) throw new Error('a loft needs two shapes or more');
  const [first, ...rest] = s.sections.map(({ frame: f, profile }) => drawing(profile).sketchOnPlane(new Plane(f.o, f.x, f.n)) as Sketch);
  return joined(shape, first.loftWith(rest, { ruled: s.ruled }), 'add');
}

/** The profile (its middle on the path's start, square to it) swept along the path, joined to the body. */
function sweep(shape: Shape3D | null, s: Of<'sweep'>): Shape3D {
  const { frame: f, profile: path } = s.path;
  const p = s.profile;
  if (p.kind === 'line') throw new Error('the profile must be a closed shape');
  // the profile centred on its own origin: the path's start
  const [cx, cy] = centre(p);
  const centred = p.kind === 'polygon' ? { ...p, pts: p.pts.map(([x, y]) => [x - cx, y - cy] as [number, number]) } : { ...p, x: 0, y: 0 };
  let line = path.kind === 'line' ? draw(path.pts[0]) : null;
  if (line && path.kind === 'line') for (const q of path.pts.slice(1)) line = line.lineTo(q);
  const spine = (line ? line.done() : drawing(path)).sketchOnPlane(new Plane(f.o, f.x, f.n)) as Sketch;
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
  if (s.open.length) return shape.shell(s.thickness, (f) => f.either(s.open.map((p) => (g: typeof f) => g.containsPoint(p))));
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
 * A bulge's height (0 to 1) from `t` (0 at the rim, 1 at the peak) for fullness `k`: 0 soft (flat at both ends), 1 as
 * it comes, 2 a dome, more flatter topped (steeper at the rim); never vertical, so the surface stays smooth.
 */
export const rise = (t: number, k: number) => (k < 1 ? (1 - k) * t * t * (3 - 2 * t) + k * t : 1 - Math.pow(1 - t, k));

/**
 * A face bulged out (`amount` mm at its peak, negative: in), its rim kept. A flat face is replaced by a smooth surface
 * over its outer edges (OpenCascade's filling through points on `dirs` lines from the rim to the peak, `rings` per
 * line, at the curve's heights) and the solid sewn again; a round one is turned again around its axis with a bulging
 * profile; sketch shapes get a solid of their own: their face and a dome over it.
 */
function bulge(shape: Shape3D | null, s: Of<'bulge'>): Shape3D {
  if (!s.amount) throw new Error('the amount must not be 0');
  if (!(s.fullness >= 0)) throw new Error('the fullness must be 0 or more');
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
  const hit = new FaceFinder().containsPoint(on.at).find(shape).find((f) => f.geomType === 'PLANE');
  const i = hit ? faces.findIndex((f) => f.isSame(hit)) : -1;
  if (i < 0) throw new Error('its face is gone, or no longer flat');
  const face = faces[i];
  const n = face.normalAt(on.at).toTuple();
  const holes = (face.clone() as BRepFace).innerWires();
  if (!holes.length) return makeSolid([...faces.filter((_, j) => j !== i), dome(face, n, s)]) as unknown as Shape3D;
  // with holes: a dome over its outline joined (a dent: cut), then the holes drilled through it again
  const lid = makeSolid([dome(face.clone() as BRepFace, n, s), makeFace((face.clone() as BRepFace).outerWire())]) as unknown as Shape3D;
  // the lid lies on the face: glued along it (OpenCascade's common-face boolean)
  let out = s.amount > 0 ? shape.fuse(lid, { optimisation: 'commonFace' }) : shape.cut(lid, { optimisation: 'commonFace' });
  lid.delete();
  for (const w of holes) {
    const drill = basicFaceExtrusion(makeFace(w), new Vector(scale(n, Math.abs(s.amount) + 1))) as Shape3D;
    const next = joined(out, drill, 'cut');
    out.delete();
    out = next;
  }
  return out;
}

/**
 * The smooth surface over a flat face's outer edges, rising along `n` (see `bulge`). How high each point rises comes
 * from a pillow (Poisson's equation on a grid over the face, 0 at the rim: one smooth field, rounded towards corners,
 * no creases), its top shifted to the peak (each point reads the field nearer the middle, the more the higher it is),
 * then shaped by the curve. OpenCascade's filling passes through those heights on `dirs` lines from the rim to the peak.
 */
function dome(face: BRepFace, n: V3, s: Of<'bulge'>, cells = 60, dirs = 32, rings = 6): BRepFace {
  const oc = getOC();
  // the face's plane: u, v around its middle (read before its wire: that frees the face)
  const c = face.center.toTuple() as V3;
  const edges = face.outerWire().edges;
  const u = Math.abs(n[2]) < 0.9 ? norm(cross([0, 0, 1], n)) : norm(cross([0, 1, 0], n));
  const v = cross(n, u);
  const uv = (p: V3): [number, number] => [dot(sub(p, c), u), dot(sub(p, c), v)];
  const at = (x: number, y: number, h: number) => add(add(c, add(scale(u, x), scale(v, y))), scale(n, h));
  // the rim as a polygon (plane coordinates)
  const rim = edges.flatMap((e) => {
    const m = Math.max(4, Math.ceil(e.length / 2));
    return Array.from({ length: m }, (_, k) => uv(e.pointAt(k / m).toTuple() as V3));
  });
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
  // the pillow: Δf = -1 inside, 0 outside (over-relaxed Gauss-Seidel), scaled to 1 at its top
  const f = new Float64Array(nx * ny);
  for (let it = 0; it < 4 * cells; it++)
    for (let k = 0; k < f.length; k++)
      if (inside[k]) f[k] += 1.9 * ((f[k - 1] + f[k + 1] + f[k - nx] + f[k + nx] + h * h) / 4 - f[k]);
  let top = 0;
  for (let k = 0; k < f.length; k++) if (f[k] > f[top]) top = k;
  const fmax = f[top] || 1;
  const field = (x: number, y: number) => {
    const [fi, fj] = [(x - x0) / h + 1, (y - y0) / h + 1];
    const [i, j] = [Math.floor(fi), Math.floor(fj)];
    if (i < 0 || j < 0 || i + 1 >= nx || j + 1 >= ny) return 0;
    const [a, b] = [fi - i, fj - j];
    const k = j * nx + i;
    return ((1 - a) * (1 - b) * f[k] + a * (1 - b) * f[k + 1] + (1 - a) * b * f[k + nx] + a * b * f[k + nx + 1]) / fmax;
  };
  // the top moved to the peak: a point reads the field `shift` nearer its own top, the more the higher it is (the rim stays)
  const [px, py] = uv(add(c, s.peak));
  const shift = [px - X(top % nx), py - Y(Math.floor(top / nx))];
  const height = (x: number, y: number) => {
    let t = field(x, y);
    for (let k = 0; k < 6; k++) t = field(x - shift[0] * t, y - shift[1] * t);
    return s.amount * rise(Math.max(0, Math.min(1, t)), s.fullness);
  };
  // the filling's points: on `dirs` lines from the rim to the top, `rings` along each, and the top
  const fill = new oc.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 0.01, 0.1, 8, 9);
  for (const e of edges) fill.Add(e.wrapped, oc.GeomAbs_Shape.GeomAbs_C0, true);
  const peak: [number, number] = [px, py];
  for (let k = 0; k < dirs; k++) {
    const r = rim[Math.floor((k * rim.length) / dirs)];
    for (let q = 1; q < rings; q++) {
      const [x, y] = [r[0] + (peak[0] - r[0]) * (q / rings), r[1] + (peak[1] - r[1]) * (q / rings)];
      fill.Add(new oc.gp_Pnt(...at(x, y, height(x, y))));
    }
  }
  fill.Add(new oc.gp_Pnt(...at(px, py, height(px, py))));
  fill.Build(new oc.Message_ProgressRange());
  if (!fill.IsDone()) throw new Error('the bulge surface could not be made');
  const out = cast(fill.Shape()) as BRepFace;
  return out;
}

/** A round face bulged: its radius grows by the curve along its axis (peak: `peak` along it from the middle), turned around the axis. */
function bulgeRound(shape: Shape3D | null, s: Of<'bulge'>, on: Extract<Of<'bulge'>['on'], { kind: 'round' }>, steps = 40): Shape3D {
  if (!shape) throw new Error('nothing to bulge yet');
  const dir = scale(on.dir, 1 / Math.hypot(...on.dir));
  const mid = Math.max(0.01 * on.length, Math.min(0.99 * on.length, on.length / 2 + s.peak[0] * dir[0] + s.peak[1] * dir[1] + s.peak[2] * dir[2]));
  // the radius along the axis (z from `at`): a shaft grows outward, a hole closes in
  const radius = (z: number) => on.r + (on.shaft ? 1 : -1) * s.amount * rise(z < mid ? z / mid : (on.length - z) / (on.length - mid), s.fullness);
  const pts = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * on.length).map((z): V3 => [radius(z), 0, z]);
  if (pts.some(([r]) => r <= 0)) throw new Error('the hole would close up');
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
  return (p.kind === 'line' ? leftOf(beside(p.pts, c.offset), far) : drawing(p)).sketchOnPlane(new Plane(add(f.o, scale(f.n, -far)), f.x, f.n)).extrude(2 * far) as Shape3D;
}

/** The region left of an open line (plane coordinates), its ends drawn on `far` mm and closed far to the left. */
function leftOf(pts: [number, number][], far: number): Drawing {
  const unit = (a: [number, number], b: [number, number]): [number, number] => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const [d0, d1] = [unit(pts[0], pts[1]), unit(pts.at(-2)!, pts.at(-1)!)];
  const start: [number, number] = [pts[0][0] - d0[0] * far, pts[0][1] - d0[1] * far];
  const end: [number, number] = [pts.at(-1)![0] + d1[0] * far, pts.at(-1)![1] + d1[1] * far];
  const ring = [start, ...pts, end, [end[0] - d1[1] * far, end[1] + d1[0] * far], [start[0] - d0[1] * far, start[1] + d0[0] * far]] as [number, number][];
  return ring.slice(1).reduce((pen, pt) => pen.lineTo(pt), draw(ring[0])).close();
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
  if (!count) throw new Error(typeof s.edges === 'object' ? 'the picked edges are gone' : `no edges match "${s.edges}"`);
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
