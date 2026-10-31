import { centre, type DrawnProfile } from '../doc/profiles';

type UV = [number, number];

/** A resize handle pushes the edge (or corner) in direction (sx, sy) of the shape's own frame; the rotate handle turns it. */
export type Handle = { kind: 'resize'; sx: number; sy: number } | { kind: 'rotate' };

const rad = (deg: number) => (deg * Math.PI) / 180;
const turn = ([x, y]: UV, deg: number): UV => [x * Math.cos(rad(deg)) - y * Math.sin(rad(deg)), x * Math.sin(rad(deg)) + y * Math.cos(rad(deg))];
const rotOf = (p: DrawnProfile) => (p.kind === 'circle' ? 0 : p.rot);

/** Point in the shape's own frame: around its centre, unturned. */
function local(p: DrawnProfile, [u, v]: UV): UV {
  const [cx, cy] = centre(p);
  return turn([u - cx, v - cy], -rotOf(p));
}

/** Half sizes of the shape in its own frame, and the offset of that box from the centre (polygons are not centred). */
function box(p: DrawnProfile): { half: UV; mid: UV } {
  if (p.kind === 'rect') return { half: [p.w / 2, p.h / 2], mid: [0, 0] };
  if (p.kind === 'circle' || p.kind === 'ngon') return { half: [p.d / 2, p.d / 2], mid: [0, 0] };
  const [cx, cy] = centre(p);
  const xs = p.pts.map(([x]) => x - cx);
  const ys = p.pts.map(([, y]) => y - cy);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { half: [(x1 - x0) / 2, (y1 - y0) / 2], mid: [(x0 + x1) / 2, (y0 + y1) / 2] };
}

/** Handles in plane coordinates; the rotate handle sits `reach` mm beyond the top edge (none for circles). */
export function handlesOf(p: DrawnProfile, reach: number): { at: UV; handle: Handle }[] {
  const [cx, cy] = centre(p);
  const { half, mid } = box(p);
  const at = (lx: number, ly: number): UV => {
    const [x, y] = turn([mid[0] + lx, mid[1] + ly], rotOf(p));
    return [cx + x, cy + y];
  };
  const round = p.kind === 'circle' || p.kind === 'ngon'; // resized evenly: edge handles only
  const dirs = round ? [[1, 0], [0, 1], [-1, 0], [0, -1]] : [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const out: { at: UV; handle: Handle }[] = dirs.map(([sx, sy]) => ({ at: at(sx * half[0], sy * half[1]), handle: { kind: 'resize', sx, sy } }));
  if (p.kind !== 'circle') out.push({ at: at(0, half[1] + reach), handle: { kind: 'rotate' } });
  return out;
}

export interface ResizeOptions {
  /** From the middle instead of the opposite edge. */
  alt: boolean;
  /** Keep proportions. */
  shift: boolean;
  /** Sizes land on this step. */
  step: number;
  /** Exact sizes typed for the own x / y axis (mm). */
  typed: [number | undefined, number | undefined];
}

/**
 * The shape resized by dragging `h` from `q0` to `q` (plane coordinates), as in incase: the opposite edge stays
 * (Alt: the middle), Shift keeps proportions (led by a typed axis, else the one that changed most).
 */
export function resized(p: DrawnProfile, h: { sx: number; sy: number }, q0: UV, q: UV, o: ResizeOptions): DrawnProfile {
  const { half, mid } = box(p);
  const full: UV = [half[0] * 2, half[1] * 2];
  const dir: UV = [h.sx, h.sy];
  const [a0, a] = [local(p, q0), local(p, q)];
  const raw = (k: number) => full[k] + (o.alt ? 2 : 1) * dir[k] * (a[k] - a0[k]);
  const sized = (k: number) => o.typed[k] ?? (dir[k] ? Math.max(o.step, Math.round(raw(k) / o.step) * o.step) : full[k]);
  let size: UV = [sized(0), sized(1)];
  const round = p.kind === 'circle' || p.kind === 'ngon';
  if (o.shift || round) {
    const change = (k: number) => (dir[k] ? Math.abs(raw(k) / (full[k] || 1) - 1) : -1);
    const lead = o.typed[0] !== undefined ? 0 : o.typed[1] !== undefined ? 1 : change(0) >= change(1) ? 0 : 1;
    const k = full[lead] ? size[lead] / full[lead] : 1;
    size = lead === 0 ? [size[0], full[1] * k] : [full[0] * k, size[1]];
  }
  // the box centre moves by half the growth towards the dragged side (not with Alt, not on undragged axes)
  const grow = (k: number) => (o.alt || (!dir[k] && !round) ? 0 : (dir[k] * (size[k] - full[k])) / 2);
  const [gx, gy] = turn([grow(0), grow(1)], rotOf(p));
  const [cx, cy] = centre(p);
  if (p.kind === 'rect') return { ...p, x: cx + gx, y: cy + gy, w: size[0], h: size[1] };
  if (p.kind === 'circle' || p.kind === 'ngon') return { ...p, x: cx + gx, y: cy + gy, d: size[dir[0] ? 0 : 1] };
  // polygon: scale its corners in its own frame around the anchor, then store them unturned around their new centre
  const anchor = (k: number) => mid[k] - (o.alt ? 0 : dir[k] * half[k]);
  const scaled = p.pts.map((pt) => {
    const l = local(p, pt);
    const s = l.map((v, k) => (full[k] ? anchor(k) + (v - anchor(k)) * (size[k] / full[k]) : v)) as UV;
    const [x, y] = turn(s, p.rot);
    return [cx + x, cy + y] as UV;
  });
  const n = scaled.length;
  const c: UV = [scaled.reduce((t, s) => t + s[0], 0) / n, scaled.reduce((t, s) => t + s[1], 0) / n];
  return { ...p, pts: scaled.map(([x, y]) => turn([x - c[0], y - c[1]], -p.rot).map((v, k) => v + c[k]) as UV) };
}

/** The shape turned by `deg` around its centre. */
export const rotated = (p: DrawnProfile, deg: number): DrawnProfile => (p.kind === 'circle' ? p : { ...p, rot: p.rot + deg });

/** The shape shifted by (du, dv). */
export function moved(p: DrawnProfile, du: number, dv: number): DrawnProfile {
  if (p.kind === 'polygon') return { ...p, pts: p.pts.map(([x, y]) => [x + du, y + dv]) };
  return { ...p, x: p.x + du, y: p.y + dv };
}

/** Width and height in the shape's own frame (circles: the diameter twice). */
export function sizeOf(p: DrawnProfile): UV {
  const { half } = box(p);
  return [half[0] * 2, half[1] * 2];
}

/** Angle in degrees of plane point `q` around the shape's centre. */
export function angleAt(p: DrawnProfile, [u, v]: UV) {
  const [cx, cy] = centre(p);
  return (Math.atan2(v - cy, u - cx) * 180) / Math.PI;
}

