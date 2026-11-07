import { getOC, measureArea, measureLength, measureVolume, type Edge, type Face, type Shape3D, type Vector } from 'replicad';

type V3 = [number, number, number];

/** A face's surface, exact (body coordinates): a plane (a point on it, its outward normal), a cylinder (a point on its axis, the axis, radius; `shaft`: material inside), a sphere, else free; and its area. */
export type ExactFace = ({ kind: 'plane'; at: V3; n: V3 } | { kind: 'cylinder'; at: V3; dir: V3; r: number; shaft: boolean } | { kind: 'sphere'; c: V3; r: number } | { kind: 'free' }) & { area: number };

/** An edge's curve, exact (body coordinates), from end `a` to end `b`: a line, a circle or arc (centre, axis, radius), an ellipse, else a curve; and its length. */
export type ExactEdge = ({ kind: 'line' } | { kind: 'circle'; c: V3; n: V3; r: number } | { kind: 'ellipse'; c: V3; n: V3; x: V3; major: number; minor: number } | { kind: 'curve' }) & { a: V3; b: V3; length: number };

/** A body's exact data with its mesh: per mesh face group and edge group (in their order), and its volume, area and tight box. */
export interface Exact {
  faces: ExactFace[];
  edges: ExactEdge[];
  volume: number;
  area: number;
  box: [V3, V3];
}

type Gp = { X(): number; Y(): number; Z(): number; delete(): void };
const v3 = (p: Vector): V3 => [p.x, p.y, p.z];
/** An OpenCascade point or direction read and freed. */
const read = (p: Gp): V3 => {
  const out: V3 = [p.X(), p.Y(), p.Z()];
  p.delete();
  return out;
};

/**
 * The exact data of `shape` for the mesh groups it was meshed into (`faceIds`, `edgeIds`: their ids, the faces' and
 * edges' hash codes); null for a body of more than `most` faces (a big import: the mesh stands in, as before).
 */
export function exactOf(shape: Shape3D, faceIds: number[], edgeIds: number[], most = 3000): Exact | null {
  if (faceIds.length > most) return null;
  const oc = getOC();
  const faces = new Map(shape.faces.map((f) => [f.hashCode, f]));
  const edges = new Map(shape.edges.map((e) => [e.hashCode, e]));
  const box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
  const corners: [V3, V3] = [read(box.CornerMin()), read(box.CornerMax())];
  box.delete();
  return {
    faces: faceIds.map((id) => faceOf(faces.get(id))),
    edges: edgeIds.map((id) => edgeOf(edges.get(id))),
    volume: measureVolume(shape),
    area: measureArea(shape),
    box: corners,
  };
}

function faceOf(f: Face | undefined): ExactFace {
  if (!f) return { kind: 'free', area: 0 };
  const area = measureArea(f);
  const type = f.geomType;
  if (type === 'PLANE') {
    const at = f.pointOnSurface(0.5, 0.5);
    return { kind: 'plane', at: v3(at), n: v3(f.normalAt(at)), area };
  }
  if (type !== 'CYLINDRE' && type !== 'SPHERE') return { kind: 'free', area };
  const surface = new (getOC().BRepAdaptor_Surface)(f.wrapped, false);
  try {
    if (type === 'SPHERE') {
      const s = surface.Sphere();
      const out: ExactFace = { kind: 'sphere', c: read(s.Location()), r: s.Radius(), area };
      s.delete();
      return out;
    }
    const c = surface.Cylinder();
    const ax = c.Axis();
    const [at, dir, r] = [read(ax.Location()), read(ax.Direction()), c.Radius()];
    ax.delete();
    c.delete();
    // a shaft when its outward normal points away from the axis
    const p = f.pointOnSurface(0.5, 0.5);
    const n = f.normalAt(p);
    const t = (p.x - at[0]) * dir[0] + (p.y - at[1]) * dir[1] + (p.z - at[2]) * dir[2];
    const out = [p.x - at[0] - t * dir[0], p.y - at[1] - t * dir[1], p.z - at[2] - t * dir[2]];
    return { kind: 'cylinder', at, dir, r, shaft: out[0] * n.x + out[1] * n.y + out[2] * n.z > 0, area };
  } finally {
    surface.delete();
  }
}

function edgeOf(e: Edge | undefined): ExactEdge {
  if (!e) return { kind: 'curve', a: [0, 0, 0], b: [0, 0, 0], length: 0 };
  const ends = { a: v3(e.startPoint), b: v3(e.endPoint), length: measureLength(e) };
  const type = e.geomType;
  if (type === 'LINE') return { kind: 'line', ...ends };
  if (type !== 'CIRCLE' && type !== 'ELLIPSE') return { kind: 'curve', ...ends };
  const curve = new (getOC().BRepAdaptor_Curve)(e.wrapped);
  try {
    if (type === 'CIRCLE') {
      const c = curve.Circle();
      const ax = c.Axis();
      const out: ExactEdge = { kind: 'circle', c: read(c.Location()), n: read(ax.Direction()), r: c.Radius(), ...ends };
      ax.delete();
      c.delete();
      return out;
    }
    const el = curve.Ellipse();
    const [ax, xa] = [el.Axis(), el.XAxis()];
    const out: ExactEdge = { kind: 'ellipse', c: read(el.Location()), n: read(ax.Direction()), x: read(xa.Direction()), major: el.MajorRadius(), minor: el.MinorRadius(), ...ends };
    ax.delete();
    xa.delete();
    el.delete();
    return out;
  } finally {
    curve.delete();
  }
}
