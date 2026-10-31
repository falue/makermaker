import { draw, drawCircle, drawRoundedRectangle, Plane, type Drawing, type Edge, type Shape3D } from 'replicad';
import { add, frames, scale, toWorld, type Frame } from '../doc/frames';
import { centre, nesting } from '../doc/profiles';
import type { Resolved } from '../doc/resolve';
import type { Area, BuildIn, EdgeRule, Profile } from '../doc/types';

export type BuildStep = Resolved<BuildIn>;
type Of<T extends BuildStep['type']> = Extract<BuildStep, { type: T }>;

export interface PartMesh {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
  /** Per B-rep face: start and count in `indices`. */
  faces: Uint32Array;
  /** B-rep vertices (edge ends), xyz, each once: snap points. */
  corners: Float32Array;
}

export class StepError extends Error {
  constructor(
    readonly stepId: string,
    message: string,
  ) {
    super(message);
  }
}

/** [cx, cy, r] of vertical cylindrical faces; their seam and tangent lines are never finished. */
type Circle = [number, number, number];

const EPS = 1e-3;

/** Extrusions run in order; finishing steps always run last, as the final layer. */
export function buildPart(steps: BuildStep[]): Shape3D {
  const plan = frames(steps);
  const circles: Circle[] = [];
  let shape: Shape3D | null = null;
  const apply = (id: string, fn: (s: Shape3D | null) => Shape3D) => {
    const next = run(id, () => fn(shape));
    shape?.delete();
    shape = next;
  };
  try {
    for (const s of steps) if (s.type === 'extrude') apply(s.id, (cur) => extrude(cur, s, plan.get(s.id), circles));
    if (!shape) throw new StepError(steps[0]?.id ?? '', 'a part needs an added extrusion');
    for (const s of steps) if (s.type === 'finish' && s.enabled) apply(s.id, (cur) => finish(cur!, s, circles));
  } catch (err) {
    (shape as Shape3D | null)?.delete();
    throw err;
  }
  return shape;
}

export function meshPart(shape: Shape3D): PartMesh {
  const opts = { tolerance: 0.02, angularTolerance: 0.1 };
  const m = shape.mesh(opts);
  const e = shape.meshEdges(opts);
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
  };
}

function run<T>(stepId: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw err instanceof StepError ? err : new StepError(stepId, err instanceof Error ? err.message : 'geometry operation failed');
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
  let parts: { in: string[]; out: string[]; d: Drawing }[] = [];
  let all: Drawing | null = null;
  const seen: string[] = [];
  for (const p of ps) {
    const d = drawing(p);
    const next: typeof parts = [];
    for (const r of parts) {
      const both = r.d.clone().intersect(d.clone());
      if (filled(both)) next.push({ in: [...r.in, p.id], out: r.out, d: both });
      const rest = r.d.clone().cut(d.clone());
      if (filled(rest)) next.push({ in: r.in, out: [...r.out, p.id], d: rest });
    }
    const fresh = all ? d.clone().cut(all.clone()) : d.clone();
    if (filled(fresh)) next.push({ in: [p.id], out: [...seen], d: fresh });
    all = all ? all.fuse(d) : d;
    seen.push(p.id);
    parts = next;
  }
  // later shapes count as outside too: an area keeps its place when shapes are added
  return parts.map((r) => ({ in: r.in, out: seen.filter((id) => !r.in.includes(id)), tris: triangles(r.d) }));
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

function extrude(shape: Shape3D | null, s: Of<'extrude'>, f: Frame | undefined, circles: Circle[]): Shape3D {
  if (!f) throw new Error('sketch plane lost: the face it was on is gone');
  if (!shape && s.mode === 'cut') throw new Error('nothing to cut yet');
  if (!s.profiles.length) throw new Error('no profile to extrude');
  if (!s.through && s.depth === 0) throw new Error('depth must not be 0');
  const outline = s.areas ? areaDrawing(s.profiles, s.areas) : combine(s.profiles);
  // span along the normal; through: beyond the part on both sides
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

function finish(shape: Shape3D, s: Of<'finish'>, circles: Circle[]): Shape3D {
  positive(s.size, s.mode === 'fillet' ? 'radius' : 'distance');
  const [[, , bottom], [, , top]] = shape.boundingBox.bounds;
  const pick = edgeRule(s.edges, bottom, top, circles);
  const count = shape.edges.filter(pick).length;
  if (!count) throw new Error(`no edges match "${s.edges}"`);
  const size = (e: Edge) => (pick(e) ? s.size : null);
  try {
    return s.mode === 'fillet' ? shape.fillet(size) : shape.chamfer(size);
  } catch {
    throw new Error(`${s.mode} on ${count} edges failed (size too large?)`);
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
