import { drawCircle, drawRoundedRectangle, makeCylinder, type Edge, type Shape3D } from 'replicad';
import type { Resolved } from '../doc/resolve';
import type { EdgeRule, Step } from '../doc/types';

export type BuildStep = Resolved<Step>;
type Of<T extends BuildStep['type']> = Extract<BuildStep, { type: T }>;

export interface PartMesh {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  edges: Float32Array;
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

/** Holes run after the base; finishing steps always run last, as the final layer. */
export function buildPart(steps: BuildStep[]): Shape3D {
  const [base, ...rest] = steps;
  if (base?.type !== 'extrude') throw new StepError(base?.id ?? '', 'a part must start with an extrusion');
  const circles: Circle[] = [];
  let shape = run(base.id, () => extrude(base, circles));
  const apply = (id: string, fn: () => Shape3D) => {
    const next = run(id, fn);
    shape.delete();
    shape = next;
  };
  try {
    for (const s of rest) if (s.type === 'hole') apply(s.id, () => hole(shape, s, base.depth, circles));
    for (const s of rest)
      if (s.type === 'finish' && s.enabled) apply(s.id, () => finish(shape, s, base.depth, circles));
  } catch (err) {
    shape.delete();
    throw err;
  }
  return shape;
}

export function meshPart(shape: Shape3D): PartMesh {
  const opts = { tolerance: 0.02, angularTolerance: 0.1 };
  const m = shape.mesh(opts);
  return {
    vertices: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    edges: new Float32Array(shape.meshEdges(opts).lines),
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

function extrude(s: Of<'extrude'>, circles: Circle[]): Shape3D {
  positive(s.depth, 'depth');
  const p = s.profile;
  if (p.kind === 'circle') {
    positive(p.d, 'diameter');
    circles.push([0, 0, p.d / 2]);
    return drawCircle(p.d / 2).sketchOnPlane('XY').extrude(s.depth) as Shape3D;
  }
  positive(p.w, 'width');
  positive(p.h, 'height');
  if (p.r < 0 || p.r * 2 >= Math.min(p.w, p.h)) throw new Error('corner radius must be between 0 and half the shorter side');
  if (p.r > 0)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) circles.push([sx * (p.w / 2 - p.r), sy * (p.h / 2 - p.r), p.r]);
  return drawRoundedRectangle(p.w, p.h, p.r).sketchOnPlane('XY').extrude(s.depth) as Shape3D;
}

function hole(shape: Shape3D, s: Of<'hole'>, depth: number, circles: Circle[]): Shape3D {
  positive(s.d, 'diameter');
  circles.push([s.x, s.y, s.d / 2]);
  const tool = makeCylinder(s.d / 2, depth + 2, [s.x, s.y, -1]);
  try {
    return shape.cut(tool);
  } finally {
    tool.delete();
  }
}

function finish(shape: Shape3D, s: Of<'finish'>, depth: number, circles: Circle[]): Shape3D {
  positive(s.size, s.mode === 'fillet' ? 'radius' : 'distance');
  const pick = edgeRule(s.edges, depth, circles);
  const count = shape.edges.filter(pick).length;
  if (!count) throw new Error(`no edges match "${s.edges}"`);
  const size = (e: Edge) => (pick(e) ? s.size : null);
  try {
    return s.mode === 'fillet' ? shape.fillet(size) : shape.chamfer(size);
  } catch {
    throw new Error(`${s.mode} on ${count} edges failed (size too large?)`);
  }
}

function edgeRule(rule: EdgeRule, depth: number, circles: Circle[]): (e: Edge) => boolean {
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
        return at(depth);
      case 'bottom':
        return at(0);
    }
  };
}
