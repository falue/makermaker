import { cast, getOC, makeCompound, ProjectionCamera, type Shape3D } from 'replicad';
import type { Cut, Label } from '../io/cutfile';

type V3 = [number, number, number];
type P2 = [number, number];

/** Where a piece's number points: a point on its face (world) and the way that face looks. */
export type Anchor = { n: number; at: V3; dir: V3 };

/** The key drawing's look: its widest (mm), the gap between its views, the numbers' circles and text. */
const KEY = { width: 160, gap: 20, radius: 3, text: 3.2, margin: 10 };

const unit = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l) as V3;
};
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * A view from `eye` (toward the viewer, world z up): its edges where they show (sharp edges and outlines; no seams nor
 * where smooth faces meet), as polylines in its picture plane (x right, y up), with the frame they are in.
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
  for (const part of [shapes.VCompound(), shapes.OutLineVCompound()]) {
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

/**
 * A key drawing: the shapes (as placed in the world) seen from the front right above and from behind left below, hidden
 * edges left out, side by side, at most KEY.width wide; each anchor's number in a circle beside the view its face looks
 * toward more, a line from the circle to the face. Lines and circles as key cuts, the numbers as notes; y down, as the
 * cut writers take them. Null when there is nothing to draw.
 */
export function legend(shapes: Shape3D[], anchors: Anchor[]): { cuts: Cut[]; notes: Label[] } | null {
  if (!shapes.length) return null;
  const all = makeCompound(shapes) as Shape3D;
  const eyes: V3[] = [unit([1, -1, 1]), unit([-1, 1, -1])];
  const views = eyes.map((eye) => view(all, eye));
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
    for (const line of lines) cuts.push({ hole: false, pts: line.map(at), curves: line.map(() => null), open: true, key: true });
    // the numbers whose faces look this way more than the other, in a column at the side they are nearer to
    const mine = anchors.filter((a) => dot(a.dir, eyes[k]) >= dot(a.dir, eyes[1 - k]));
    const placed = mine.map((a) => ({ n: a.n, p: at([dot(a.at, x), dot(a.at, y)]) }));
    const mid = left + KEY.margin + ((x1 - x0) * scale) / 2;
    for (const side of [-1, 1]) {
      const column = placed.filter((a) => (a.p[0] < mid ? -1 : 1) === side).sort((a, b) => a.p[1] - b.p[1]);
      const cx = side < 0 ? left + KEY.margin / 2 - KEY.radius : left + KEY.margin + (x1 - x0) * scale + KEY.margin / 2 + KEY.radius;
      let last = -Infinity;
      for (const a of column) {
        const cy = Math.max(a.p[1], last + 2 * KEY.radius + 1);
        last = cy;
        const away = Math.hypot(a.p[0] - cx, a.p[1] - cy) || 1;
        const edge: P2 = [cx + ((a.p[0] - cx) / away) * KEY.radius, cy + ((a.p[1] - cy) / away) * KEY.radius];
        cuts.push({ hole: false, pts: [edge, a.p], curves: [null, null], open: true, key: true });
        cuts.push({ hole: false, pts: [], curves: [], circle: { c: [cx, cy], r: KEY.radius }, key: true }, { hole: false, pts: [], curves: [], circle: { c: a.p, r: 0.5 }, key: true });
        const text = String(a.n);
        notes.push({ at: [cx - text.length * KEY.text * 0.3, cy + KEY.text * 0.36], text, size: KEY.text });
      }
    }
    notes.push({ at: [left + KEY.margin, KEY.text * 2.5], text: k ? 'from behind, below' : 'from the front, above', size: KEY.text });
    left += 2 * KEY.margin + (x1 - x0) * scale + KEY.gap;
  });
  return { cuts, notes };
}

