import { draw, drawCircle, drawRectangle, drawRoundedRectangle, importSTEP, makeCylinder, makeSphere, Plane, type Drawing, type Edge, type Shape3D, type Sketch } from 'replicad';
import { add, cutPlane, extent, frames, scale, toWorld, type Frame, type Place } from '../doc/frames';
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
      if (s.type === 'split') apply(s.id, (cur) => split(cur, s));
      if (s.type === 'revolve') apply(s.id, (cur) => revolve(cur, s, plan.get(s.id)));
      if (s.type === 'loft') apply(s.id, (cur) => loft(cur, s));
      if (s.type === 'sweep') apply(s.id, (cur) => sweep(cur, s));
      if (s.type === 'shell') apply(s.id, (cur) => shell(cur, s));
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

/** The body hollowed to walls `thickness` thick inside it, the faces through the `open` points taken away. */
function shell(shape: Shape3D | null, s: Of<'shell'>): Shape3D {
  if (!shape) throw new Error('nothing to hollow yet');
  if (!s.open.length) throw new Error('pick a face to leave open');
  if (!(s.thickness > 0)) throw new Error('the wall thickness must be greater than 0');
  return shape.shell(s.thickness, (f) => f.either(s.open.map((p) => (g: typeof f) => g.containsPoint(p))));
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
