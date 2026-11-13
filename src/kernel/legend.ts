import { cast, DistanceQuery, getOC, makeCompound, makeLine, ProjectionCamera, type Shape3D } from 'replicad';
import type { Cut, Label } from '../io/cutfile';

type V3 = [number, number, number];
type P2 = [number, number];

/** Where a piece's number points: a point on its face (world) and the way that face looks; `solid`: never dotted; `folds`: its fold lines (world), drawn green. */
export type Anchor = { n: number; at: V3; dir: V3; solid?: boolean; folds?: V3[][] };

/** The key drawing's look: its widest (mm), the gap between its views, the numbers' circles and text. */
const KEY = { width: 160, gap: 20, radius: 3, text: 3.2, margin: 10, dots: 16, dash: 1.2 };

const unit = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l) as V3;
};
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** How far `p` lies from the segment a–b. */
const gap = (p: P2, a: P2, b: P2) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * A view from `eye` (toward the viewer, world z up): its edges where they show (sharp edges, where faces meet smoothly,
 * seams, where a face meets itself, outlines), as polylines in its picture plane (x right, y up), with the frame they are in.
 */
export function view(shape: Shape3D, eye: V3) {
  const oc = getOC();
  const x = unit(cross([0, 0, 1], eye));
  const y = cross(eye, x);
  const camera = new ProjectionCamera([0, 0, 0], eye, x);
  const algo = new oc.HLRBRep_Algo();
  algo.Add(shape.wrapped, 0);
  const projector = new oc.HLRAlgo_Projector(camera.wrapped);
  algo.Projector(projector);
  algo.Update();
  algo.Hide();
  const shapes = new oc.HLRBRep_HLRToShape(algo);
  const lines: P2[][] = [];
  // sharp edges, smooth ones (tangent: Rg1), smoother still (RgN: seams, a surface split in two), outlines
  for (const part of [shapes.VCompound(), shapes.Rg1LineVCompound(), shapes.RgNLineVCompound(), shapes.OutLineVCompound()]) {
    if (part.IsNull()) continue;
    for (const edge of cast(part).edges) {
      oc.BRepLib.BuildCurves3d(edge.wrapped);
      const steps = edge.geomType === 'LINE' ? 1 : 24;
      lines.push(Array.from({ length: steps + 1 }, (_, k) => edge.pointAt(k / steps)).map((p) => [p.x, p.y] as P2));
      edge.delete();
    }
  }
  [shapes, projector, algo, camera].forEach((o) => o.delete());
  return { lines, x, y };
}

/** Whether nothing of the shape `query` measures lies between the anchor's point and the eye. */
function sees(query: DistanceQuery, a: Anchor, eye: V3) {
  // just off the face (its point may lie on a chord, inside a curved face), on toward the eye
  const from = a.at.map((v, i) => v + a.dir[i] * 0.3) as V3;
  const ray = makeLine(from, from.map((v, i) => v + eye[i] * 1e5) as V3);
  const d = query.distanceTo(ray);
  ray.delete();
  return d > 1e-3;
}

/**
 * A key drawing: the shapes (as placed in the world) seen from the front right above and from behind left below, hidden
 * edges left out, side by side, at most KEY.width wide; each anchor's number in a circle in the view its face looks
 * toward more: on the face where there is room, else beside the view with a line to the face; circle and line dotted
 * where the face does not show there (behind something; not a `solid` anchor); lines along an anchor's folds green. Lines and circles as key cuts, the numbers as notes; y down,
 * as the cut writers take them. Null when there is nothing to draw.
 */
export function legend(shapes: Shape3D[], anchors: Anchor[]): { cuts: Cut[]; notes: Label[] } | null {
  if (!shapes.length) return null;
  const all = makeCompound(shapes) as Shape3D;
  const eyes: V3[] = [unit([1, -1, 1]), unit([-1, 1, -1])];
  const views = eyes.map((eye) => view(all, eye));
  const query = new DistanceQuery(all);
  const hidden = new Set(anchors.filter((a) => !a.solid && !sees(query, a, dot(a.dir, eyes[0]) >= dot(a.dir, eyes[1]) ? eyes[0] : eyes[1])));
  query.delete();
  all.delete();
  // each view's box, then side by side, scaled to fit
  const boxes = views.map(({ lines }) => {
    const ps = lines.flat();
    return ps.length ? [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))] : [0, 0, 0, 0];
  });
  const width = boxes.reduce((n, b) => n + b[2] - b[0], 0);
  if (width <= 0) return null;
  const scale = Math.min(1, (KEY.width - KEY.gap - 4 * KEY.margin) / width);
  const cuts: Cut[] = [];
  const notes: Label[] = [];
  let left = 0;
  views.forEach(({ lines, x, y }, k) => {
    const [x0, y0, x1] = boxes[k];
    // picture plane → sheet: scaled, this view's left edge at `left`, y down
    const at = ([u, v]: P2): P2 => [left + KEY.margin + (u - x0) * scale, -(v - y0) * scale];
    // a line lying along a piece's fold (within the mesh's 0.05 mm): green, as the folds on the sheet
    const folds = anchors.flatMap((a) => a.folds ?? []).map((line) => line.map((p): P2 => [dot(p, x), dot(p, y)]));
    const segments = folds.flatMap((f) => f.slice(1).map((q, i) => [f[i], q]));
    const onFold = (line: P2[]) => line.every((p) => segments.some(([a, b]) => gap(p, a, b) < 0.1));
    for (const line of lines) cuts.push({ hole: false, pts: line.map(at), curves: line.map(() => null), open: true, key: true, ...(onFold(line) ? { mark: true } : {}) });
    // the numbers whose faces look this way more than the other: on the face where its circle stays clear of lines and
    // other circles, else in a column at the side they are nearer to, a line to the face
    const mine = anchors.filter((a) => dot(a.dir, eyes[k]) >= dot(a.dir, eyes[1 - k]));
    const placed = mine.map((a) => ({ a, p: at([dot(a.at, x), dot(a.at, y)]) }));
    const segs = cuts.slice(-lines.length).flatMap((c) => c.pts.slice(1).map((q, i) => [c.pts[i], q]));
    const circles: P2[] = [];
    const clear = (c: P2) => circles.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) > 2 * KEY.radius + 1) && segs.every(([a, b]) => gap(c, a, b) > KEY.radius + 0.5);
    const number = (a: Anchor, [cx, cy]: P2) => {
      circles.push([cx, cy]);
      if (!hidden.has(a)) cuts.push({ hole: false, pts: [], curves: [], circle: { c: [cx, cy], r: KEY.radius }, key: true });
      // dotted: every other of its arcs as a short line
      else
        for (let i = 0; i < KEY.dots; i += 2) {
          const pts = [i, i + 1].map((j): P2 => [cx + KEY.radius * Math.cos((j * 2 * Math.PI) / KEY.dots), cy + KEY.radius * Math.sin((j * 2 * Math.PI) / KEY.dots)]);
          cuts.push({ hole: false, pts, curves: [null, null], open: true, key: true });
        }
      const text = String(a.n);
      notes.push({ at: [cx - text.length * KEY.text * 0.3, cy + KEY.text * 0.36], text, size: KEY.text });
    };
    const aside = placed.filter((a) => !(clear(a.p) && (number(a.a, a.p), true)));
    const mid = left + KEY.margin + ((x1 - x0) * scale) / 2;
    for (const side of [-1, 1]) {
      const column = aside.filter((a) => (a.p[0] < mid ? -1 : 1) === side).sort((a, b) => a.p[1] - b.p[1]);
      const cx = side < 0 ? left + KEY.margin / 2 - KEY.radius : left + KEY.margin + (x1 - x0) * scale + KEY.margin / 2 + KEY.radius;
      let last = -Infinity;
      for (const a of column) {
        const cy = Math.max(a.p[1], last + 2 * KEY.radius + 1);
        last = cy;
        const away = Math.hypot(a.p[0] - cx, a.p[1] - cy) || 1;
        const edge: P2 = [cx + ((a.p[0] - cx) / away) * KEY.radius, cy + ((a.p[1] - cy) / away) * KEY.radius];
        // dotted where the face is hidden: dashes about KEY.dash long, as far apart, an odd count (from circle to face)
        const d = Math.hypot(a.p[0] - edge[0], a.p[1] - edge[1]);
        const steps = hidden.has(a.a) ? 2 * Math.round(d / KEY.dash / 2) + 1 : 1;
        const along = (t: number): P2 => [edge[0] + ((a.p[0] - edge[0]) * t) / steps, edge[1] + ((a.p[1] - edge[1]) * t) / steps];
        for (let i = 0; i < steps; i += 2) cuts.push({ hole: false, pts: [along(i), along(i + 1)], curves: [null, null], open: true, key: true });
        cuts.push({ hole: false, pts: [], curves: [], circle: { c: a.p, r: 0.5 }, key: true });
        number(a.a, [cx, cy]);
      }
    }
    notes.push({ at: [left + KEY.margin, KEY.text * 2.5], text: k ? 'from behind, below' : 'from the front, above', size: KEY.text });
    left += 2 * KEY.margin + (x1 - x0) * scale + KEY.gap;
  });
  return { cuts, notes };
}

