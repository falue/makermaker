import { cast, getOC, measureArea, measureLength, measureVolume, type Edge, type Face, type Shape3D, type Vector } from 'replicad';

type V3 = [number, number, number];

/**
 * A face's surface, exact (body coordinates): a plane (a point on it, its outward normal), a cylinder (a point on its
 * axis, the axis, radius; `shaft`: material inside), a sphere, else free; on a body of not too many faces also its
 * area and centre of mass (`mid`).
 */
export type ExactFace = ({ kind: 'plane'; at: V3; n: V3 } | { kind: 'cylinder'; at: V3; dir: V3; r: number; shaft: boolean } | { kind: 'sphere'; c: V3; r: number } | { kind: 'free' }) & { area?: number; mid?: V3 };

/** An edge's curve, exact (body coordinates), from end `a` to end `b`: a line, a circle or arc (centre, axis, radius, the point half way along it), an ellipse, else a curve; and its length. */
export type ExactEdge = ({ kind: 'line' } | { kind: 'circle'; c: V3; n: V3; r: number; mid: V3 } | { kind: 'ellipse'; c: V3; n: V3; x: V3; major: number; minor: number } | { kind: 'curve' }) & { a: V3; b: V3; length: number };

/** A body's exact data with its mesh: per mesh face group and edge group (in their order), its volume and area, and its tight box (null: too many faces to find it fast; the mesh's stands in). */
export interface Exact {
  faces: ExactFace[];
  edges: ExactEdge[];
  volume: number;
  area: number;
  box: [V3, V3] | null;
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
 * The faces or edges of `shape` by hash code (what the mesh groups carry as their ids), in one pass: replicad's
 * `faces` / `edges` compare each one with all before it, which a big import takes minutes for.
 */
function byHash<T extends Face | Edge>(shape: Shape3D, kind: 'face' | 'edge'): Map<number, T> {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer(shape.wrapped, kind === 'face' ? oc.TopAbs_ShapeEnum.TopAbs_FACE : oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const out = new Map<number, T>();
  try {
    for (; explorer.More(); explorer.Next()) {
      const id = oc.ReplicadShapeHasher.HashCode(explorer.Current(), 2147483647); // as replicad's `hashCode`
      if (!out.has(id)) out.set(id, cast(explorer.Current()) as T);
    }
  } finally {
    explorer.delete();
  }
  return out;
}

/**
 * The exact data of `shape` for the mesh groups it was meshed into (`faceIds`, `edgeIds`: their ids, the faces' and
 * edges' hash codes); null for a body of more than `most` faces (the mesh stands in, as for an imported mesh).
 */
export function exactOf(shape: Shape3D, faceIds: number[], edgeIds: number[], most = 20000, boxed = 1000): Exact | null {
  if (faceIds.length > most) return null;
  const oc = getOC();
  const faces = byHash<Face>(shape, 'face');
  const edges = byHash<Edge>(shape, 'edge');
  // the tight box takes seconds on thousands of faces (6 s on 8000): only below `boxed`
  let corners: [V3, V3] | null = null;
  if (faceIds.length <= boxed) {
    const box = new oc.Bnd_Box();
    oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
    corners = [read(box.CornerMin()), read(box.CornerMax())];
    box.delete();
  }
  const measured = faceIds.length <= boxed;
  return {
    faces: faceIds.map((id) => ({ ...faceOf(faces.get(id)), ...(measured ? measuredFace(faces.get(id)) : {}) })),
    edges: edgeIds.map((id) => edgeOf(edges.get(id))),
    volume: measureVolume(shape),
    area: measureArea(shape),
    box: corners,
  };
}

/** A face's area and centre of mass, in one go (empty for none). */
function measuredFace(f: Face | undefined): { area?: number; mid?: V3 } {
  if (!f) return {};
  const oc = getOC();
  const props = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(f.wrapped, props, 1e-7, true);
  const out = { area: props.Mass(), mid: read(props.CentreOfMass()) };
  props.delete();
  return out;
}

function faceOf(f: Face | undefined): ExactFace {
  if (!f) return { kind: 'free' };
  const type = f.geomType;
  if (type === 'PLANE') {
    const at = f.pointOnSurface(0.5, 0.5);
    return { kind: 'plane', at: v3(at), n: v3(f.normalAt(at)) };
  }
  if (type !== 'CYLINDRE' && type !== 'SPHERE') return { kind: 'free' };
  const surface = new (getOC().BRepAdaptor_Surface)(f.wrapped, false);
  try {
    if (type === 'SPHERE') {
      const s = surface.Sphere();
      const out: ExactFace = { kind: 'sphere', c: read(s.Location()), r: s.Radius() };
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
    return { kind: 'cylinder', at, dir, r, shaft: out[0] * n.x + out[1] * n.y + out[2] * n.z > 0 };
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
      const out: ExactEdge = { kind: 'circle', c: read(c.Location()), n: read(ax.Direction()), r: c.Radius(), mid: v3(e.pointAt(0.5)), ...ends };
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

/**
 * Whether a solid is closed (every edge on two faces; a seam twice on its one) and manifold (no edge on more than two),
 * from its own faces and edges, not a mesh of it.
 */
export function solidChecks(shape: Shape3D) {
  const oc = getOC();
  const uses = new Map<number, number>();
  const faces = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; faces.More(); faces.Next()) {
    const edges = new oc.TopExp_Explorer(faces.Current(), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; edges.More(); edges.Next()) {
      if (oc.BRep_Tool.Degenerated(oc.TopoDS.Edge(edges.Current()))) continue; // a sphere's pole
      const id = oc.ReplicadShapeHasher.HashCode(edges.Current(), 2147483647);
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
    edges.delete();
  }
  faces.delete();
  const counts = [...uses.values()];
  return { closed: counts.length > 0 && counts.every((n) => n >= 2), manifold: counts.every((n) => n <= 2) };
}
