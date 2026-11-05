import { getOC, makeVertex, measureArea, measureVolume, type AnyShape, type Edge, type Face, type Shape3D } from 'replicad';
import type { Place } from '../doc/frames';
import { placeShape } from './build';

type V3 = [number, number, number];

/**
 * What can be asked of a body's real solid; everything the Distance measure and `cad.measure` tell comes from here, not
 * from the triangles in the view. `edge` and `face` number the solid's parts as the mesh's groups do; points are in the
 * body's own coordinates.
 */
export type MeasureAsk =
  | { of: 'edge'; body: string; edge: number }
  | { of: 'face'; body: string; face: number }
  /** A flat face's size along `u` and across it (`n`: its normal). */
  | { of: 'sides'; body: string; face: number; u: V3; n: V3 }
  /** The point of an edge or face nearest `near`. */
  | { of: 'point'; body: string; edge?: number; face?: number; near: V3 }
  /** An edge's middle (`near`: where the mesh has it, for curves whose middle is not simply half way along their parameter). */
  | { of: 'middle'; body: string; edge: number; near: V3 }
  /** Volume and surface, and the box in the world when placed so. */
  | { of: 'solid'; body: string; place: Place };

export type SolidMeasure = { volume: number; area: number; min: V3; max: V3 };
export type MeasureAnswer = number | V3 | SolidMeasure | null;

/** A built body kept for measuring (its parts listed once asked for). */
export class Solid {
  private edgeList: Edge[] | null = null;
  private faceList: Face[] | null = null;
  constructor(readonly shape: Shape3D) {}
  get edges() {
    return (this.edgeList ??= this.shape.edges);
  }
  get faces() {
    return (this.faceList ??= this.shape.faces);
  }
  delete() {
    for (const part of [...(this.edgeList ?? []), ...(this.faceList ?? [])]) part.delete();
    this.shape.delete();
  }
}

/** The real box of a shape: from its surfaces, not from a mesh. */
function trueBox(shape: AnyShape): { min: V3; max: V3 } {
  const oc = getOC();
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
  const [lo, hi] = [box.CornerMin(), box.CornerMax()];
  const out = { min: [lo.X(), lo.Y(), lo.Z()] as V3, max: [hi.X(), hi.Y(), hi.Z()] as V3 };
  lo.delete();
  hi.delete();
  box.delete();
  return out;
}

const nearest = (part: AnyShape, near: V3): V3 => {
  const oc = getOC();
  const vertex = makeVertex(near);
  const tool = new oc.BRepExtrema_DistShapeShape();
  tool.LoadS1(vertex.wrapped);
  tool.LoadS2(part.wrapped);
  tool.Perform();
  const p = tool.PointOnShape2(1);
  const out: V3 = [p.X(), p.Y(), p.Z()];
  p.delete();
  tool.delete();
  vertex.delete();
  return out;
};

const DEG = 180 / Math.PI;
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => a.map((v) => v / (Math.hypot(...a) || 1)) as V3;
/** `v` turned by `deg` around unit `axis`. */
const turned = (v: V3, axis: V3, deg: number): V3 => {
  const [c, s] = [Math.cos(deg / DEG), Math.sin(deg / DEG)];
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [0, 1, 2].map((i) => v[i] * c + k[i] * s + axis[i] * d) as V3;
};

/** A copy of `face` lying flat with `u` along X: its true box is then its size along `u` and across. */
function sidesOf(face: Face, u: V3, n: V3): [number, number] {
  let copy = face.clone();
  let along = unit(u);
  const z: V3 = [0, 0, 1];
  const tilt = unit(cross(unit(n), z));
  const tiltDeg = Math.acos(Math.max(-1, Math.min(1, dot(unit(n), z)))) * DEG;
  if (tiltDeg > 1e-9) {
    const axis: V3 = Math.hypot(...cross(unit(n), z)) > 1e-9 ? tilt : [1, 0, 0];
    copy = copy.rotate(tiltDeg, [0, 0, 0], axis);
    along = turned(along, axis, tiltDeg);
  }
  const spin = Math.atan2(along[1], along[0]) * DEG;
  if (Math.abs(spin) > 1e-9) copy = copy.rotate(-spin, [0, 0, 0], z);
  const { min, max } = trueBox(copy);
  copy.delete();
  return [max[0] - min[0], max[1] - min[1]];
}

/** The answer to `ask` from `solid`; null: it has no such part. */
export function answer(solid: Solid, ask: MeasureAsk): MeasureAnswer {
  switch (ask.of) {
    case 'edge':
      return solid.edges[ask.edge]?.length ?? null;
    case 'face': {
      const face = solid.faces[ask.face];
      return face ? measureArea(face) : null;
    }
    case 'sides': {
      const face = solid.faces[ask.face];
      return face ? (sidesOf(face, ask.u, ask.n).concat(0) as V3) : null;
    }
    case 'point': {
      const part = ask.edge !== undefined ? solid.edges[ask.edge] : ask.face !== undefined ? solid.faces[ask.face] : null;
      return part ? nearest(part, ask.near) : null;
    }
    case 'middle': {
      const edge = solid.edges[ask.edge];
      if (!edge) return null;
      if (edge.geomType !== 'LINE' && edge.geomType !== 'CIRCLE') return nearest(edge, ask.near);
      return edge.pointAt(0.5).toTuple() as V3;
    }
    case 'solid': {
      const placed = placeShape(solid.shape.clone(), ask.place);
      const out = { volume: measureVolume(solid.shape), area: measureArea(solid.shape), ...trueBox(placed) };
      placed.delete();
      return out;
    }
  }
}
