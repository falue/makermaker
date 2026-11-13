import { cast, getOC, type Face, type Shape3D } from 'replicad';
import type { TopAbs_ShapeEnum, TopoDS_Edge, TopoDS_Shape } from 'replicad-opencascadejs';
import type { Cut } from '../io/cutfile';
import { facingOut, lscm, netLines, nets, stretchOf, type FlatFace, type P2 } from './flatten';

/**
 * One net of a body: its outline cut (red) and folds (green marks), y down; each face's loops and stretch, for a
 * preview; `anchor`: a point well inside its biggest face and the way that face looks (body coordinates), for a key.
 */
export type UnwrapPiece = { cuts: Cut[]; faces: { loops: P2[][]; stretch: number }[]; anchor: { at: V3; dir: V3 } };

type V3 = [number, number, number];

/** Which faces of a hollow solid (one with a closed cavity) are unwrapped: its outside, the cavity's walls, or both. */
export type Side = 'outside' | 'inside' | 'both';

/** The parts of `of` of a kind (solids, shells, faces), as found. */
function partsOf(of: TopoDS_Shape, kind: TopAbs_ShapeEnum) {
  const oc = getOC();
  const out: TopoDS_Shape[] = [];
  const explorer = new oc.TopExp_Explorer(of, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) out.push(explorer.Current());
  explorer.delete();
  return out;
}

/**
 * `shape`'s faces on `side` (none given: a hollow one's inside, else all); `hollow`: a solid of it has a cavity (a shell
 * besides its outer one, the biggest).
 */
function facesOn(shape: Shape3D, side?: Side): { faces: Face[]; hollow: boolean; side: Side } {
  const { TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE } = getOC().TopAbs_ShapeEnum;
  const solids = partsOf(shape.wrapped, TopAbs_SOLID).map((solid) =>
    partsOf(solid, TopAbs_SHELL).map((s) => {
      const [lo, hi] = cast(s).boundingBox.bounds;
      return { s, size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
    }),
  );
  const hollow = solids.some((shells) => shells.length > 1);
  const on = side ?? (hollow ? 'inside' : 'outside');
  if (!solids.length) return { faces: shape.faces, hollow, side: on };
  const faces = solids.flatMap((shells) => {
    const outer = shells.reduce((a, b) => (b.size > a.size ? b : a));
    return shells.filter((x) => on === 'both' || (x === outer) === (on === 'outside')).flatMap((x) => partsOf(x.s, TopAbs_FACE).map((f) => cast(f) as Face));
  });
  return { faces, hollow, side: on };
}

/** A face's area, and its biggest triangle's middle and outward normal (unit): a point well inside it. */
function inside({ pts, tris }: FlatFace) {
  let best = { at: [0, 0, 0] as V3, dir: [0, 0, 1] as V3, area: -1, total: 0 };
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((i) => [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]);
    const [u, v] = [b.map((x, k) => x - a[k]), c.map((x, k) => x - a[k])];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const area = Math.hypot(n[0], n[1], n[2]) / 2;
    best.total += area;
    if (area > best.area) best = { ...best, at: a.map((x, k) => (x + b[k] + c[k]) / 3) as V3, dir: n.map((x) => x / (2 * area)) as V3, area };
  }
  return best;
}

/** How fine faces are meshed to be flattened: mm off the true face at most, and radians per step round a curve. */
const MESH = { linear: 0.05, angular: 0.2 };

/**
 * A solid unwrapped into flat nets at 1:1, seen from outside: flat faces as they are, cylinders and cones rolled out
 * exactly (their surface parameters are lengths and angles), other faces by least squares conformal maps (`lscm`),
 * stretched a little; joined along shared edges where they lie flat without overlapping (`nets`). Of a hollow solid
 * only the faces on `side` (see `facesOn`). `stretch`: the worst face's (0.05: 5 %); `hollow`: it has a cavity.
 */
export function unwrap(shape: Shape3D, side?: Side): { pieces: UnwrapPiece[]; stretch: number; hollow: boolean; side: Side } {
  const oc = getOC();
  new oc.BRepMesh_IncrementalMesh(shape.wrapped, MESH.linear, false, MESH.angular, false).delete();
  // edges by hash code, told apart by IsSame: their key is shared by the faces on either side
  const known = new Map<number, TopoDS_Edge[]>();
  const keyOf = (edge: TopoDS_Edge) => {
    const hash = oc.ReplicadShapeHasher.HashCode(edge, 2147483647);
    const same = known.get(hash) ?? [];
    let i = same.findIndex((e) => e.IsSame(edge));
    if (i < 0) i = same.push(edge) - 1;
    known.set(hash, same);
    return hash * 64 + i;
  };
  const faces: FlatFace[] = [];
  const stretch: number[] = [];
  const { faces: chosen, hollow, side: on } = facesOn(shape, side);
  for (const face of chosen) {
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face.wrapped, loc, 0);
    if (!tri || tri.isNull()) {
      loc.delete();
      continue;
    }
    const trsf = loc.Transformation();
    const n = tri.NbNodes();
    const pts = new Float64Array(n * 3);
    const uv = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = tri.Node(i + 1);
      const q = p.Transformed(trsf);
      [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]] = [q.X(), q.Y(), q.Z()];
      p.delete();
      q.delete();
      if (!tri.HasUVNodes()) continue;
      const w = tri.UVNode(i + 1);
      [uv[2 * i], uv[2 * i + 1]] = [w.X(), w.Y()];
      w.delete();
    }
    // wound outward: a reversed face's triangles turned round
    const forward = face.wrapped.Orientation() === oc.TopAbs_Orientation.TopAbs_FORWARD;
    const tris = new Uint32Array(tri.NbTriangles() * 3);
    for (let t = 0; t < tris.length / 3; t++) {
      const k = tri.Triangle(t + 1);
      const [a, b, c] = [k.Value(1) - 1, k.Value(2) - 1, k.Value(3) - 1];
      tris.set(forward ? [a, b, c] : [b, a, c], 3 * t);
      k.delete();
    }
    const kind = face.geomType;
    const flat = new Float64Array(n * 2);
    if (tri.HasUVNodes() && (kind === 'PLANE' || kind === 'CYLINDRE' || kind === 'CONE')) {
      // a plane's parameters are lengths. A cylinder's and a cone's: an angle u round the axis, a length v along it,
      // the radius there r(v) = r0 + v·slope (slope: the sine of a cone's half angle; read off how fast u moves a point)
      const surface = new oc.BRepAdaptor_Surface(face.wrapped, true);
      const [p, du, dv] = [new oc.gp_Pnt(), new oc.gp_Vec(), new oc.gp_Vec()];
      const radius = (v: number) => (surface.D1(uv[0], v, p, du, dv), du.Magnitude());
      let [lo, hi] = [Infinity, -Infinity];
      for (let i = 0; i < n; i++) [lo, hi] = [Math.min(lo, uv[2 * i + 1]), Math.max(hi, uv[2 * i + 1])];
      const mid = (lo + hi) / 2;
      const slope = kind === 'CONE' ? (radius(mid + 0.5) - radius(mid - 0.5)) / 1 : 0;
      const r0 = radius(mid) - mid * slope;
      [surface, p, du, dv].forEach((x) => x.delete());
      for (let i = 0; i < n; i++) {
        const [u, v] = [uv[2 * i], uv[2 * i + 1]];
        if (kind === 'PLANE') [flat[2 * i], flat[2 * i + 1]] = [u, v];
        else if (kind === 'CYLINDRE') [flat[2 * i], flat[2 * i + 1]] = [r0 * u, v];
        else {
          // the cone rolled out round its apex: as far from it as along its side, the angle shrunk by the slope
          const s = v + r0 / slope;
          [flat[2 * i], flat[2 * i + 1]] = [s * Math.cos(u * slope), s * Math.sin(u * slope)];
        }
      }
    } else flat.set(lscm(pts, tris));
    facingOut(flat, tris);
    // its edges to other faces (not a seam, where it meets itself, nor a pole), by node along each
    const edges: FlatFace['edges'] = [];
    const explorer = new oc.TopExp_Explorer(face.wrapped, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; explorer.More(); explorer.Next()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      if (oc.BRep_Tool.Degenerated(edge) || oc.BRep_Tool.IsClosed(edge, face.wrapped)) continue;
      const poly = oc.BRep_Tool.PolygonOnTriangulation(edge, tri, loc);
      if (!poly || poly.isNull()) continue;
      edges.push({ key: keyOf(edge), nodes: Array.from({ length: poly.NbNodes() }, (_, i) => poly.Node(i + 1) - 1) });
    }
    explorer.delete();
    loc.delete();
    const flatFace = { pts, tris, flat, edges };
    faces.push(flatFace);
    stretch.push(kind === 'PLANE' || kind === 'CYLINDRE' || kind === 'CONE' ? 0 : stretchOf(flatFace));
  }
  for (const same of known.values()) for (const e of same) e.delete();
  const points = faces.map(inside);
  const pieces = nets(faces).map((island) => {
    const { loops, folds, regions } = netLines(island, faces);
    const cuts: Cut[] = [
      ...loops.map((l): Cut => ({ hole: l.hole, pts: l.pts, curves: l.pts.map(() => null), ...(l.closed ? {} : { open: true }) })),
      ...folds.map((pts): Cut => ({ hole: false, pts, curves: pts.map(() => null), open: true, mark: true })),
    ];
    const { at, dir } = points[island.faces.reduce((a, b) => (points[b.face].total > points[a.face].total ? b : a)).face];
    return { cuts, faces: regions.map((r) => ({ loops: r.loops, stretch: stretch[r.face] })), anchor: { at, dir } };
  });
  return { pieces, stretch: Math.max(0, ...stretch), hollow, side: on };
}
