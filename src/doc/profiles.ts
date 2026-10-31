import type { Resolved } from './resolve';
import type { Profile } from './types';

/** A profile in mm, without id (resolved profiles fit too). */
export type DrawnProfile = Resolved<Profile> extends infer P ? (P extends unknown ? Omit<P, 'id'> : never) : never;
type P = DrawnProfile;

/** The rect's or polygon's corners, turned by `rot`; a circle has none. */
export function corners(p: P): [number, number][] {
  if (p.kind === 'circle') return [];
  const pts: [number, number][] =
    p.kind === 'rect'
      ? [
          [p.x - p.w / 2, p.y - p.h / 2],
          [p.x + p.w / 2, p.y - p.h / 2],
          [p.x + p.w / 2, p.y + p.h / 2],
          [p.x - p.w / 2, p.y + p.h / 2],
        ]
      : p.pts;
  if (!p.rot) return pts;
  const [cx, cy] = centre(p);
  const a = (p.rot * Math.PI) / 180;
  return pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
}

/** Bounding box in plane coordinates: [minX, minY, maxX, maxY]. */
export function bounds(p: P): [number, number, number, number] {
  if (p.kind === 'circle') return [p.x - p.d / 2, p.y - p.d / 2, p.x + p.d / 2, p.y + p.d / 2];
  const pts = corners(p);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Shifts that line the boxes up (left, centre, right, top, middle, bottom) or space them evenly (distribute: equal gaps). */
export function alignment(boxes: [number, number, number, number][], how: Align): [number, number][] {
  const [x0, y0, x1, y1] = [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...boxes.map((b) => b[k])));
  const axis = how === 'left' || how === 'centerX' || how === 'right' || how === 'distributeX' ? 0 : 1;
  const lo = (b: (typeof boxes)[number]) => b[axis];
  const hi = (b: (typeof boxes)[number]) => b[axis + 2];
  const shift = (d: number): [number, number] => (axis ? [0, d] : [d, 0]);
  if (how === 'distributeX' || how === 'distributeY') {
    const order = boxes.map((_, i) => i).sort((a, b) => lo(boxes[a]) - lo(boxes[b]));
    const gap = ((axis ? y1 - y0 : x1 - x0) - boxes.reduce((s, b) => s + hi(b) - lo(b), 0)) / (boxes.length - 1);
    const out: [number, number][] = boxes.map(() => [0, 0]);
    let at = axis ? y0 : x0;
    for (const i of order) {
      out[i] = shift(at - lo(boxes[i]));
      at += hi(boxes[i]) - lo(boxes[i]) + gap;
    }
    return out;
  }
  const [min, max] = axis ? [y0, y1] : [x0, x1];
  return boxes.map((b) => {
    if (how === 'left' || how === 'bottom') return shift(min - lo(b));
    if (how === 'right' || how === 'top') return shift(max - hi(b));
    return shift((min + max) / 2 - (lo(b) + hi(b)) / 2);
  });
}

export type Align = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY';

export function area(p: P): number {
  if (p.kind === 'rect') return p.w * p.h;
  if (p.kind === 'circle') return (Math.PI * p.d * p.d) / 4;
  return Math.abs(p.pts.reduce((s, [x, y], i) => s + x * p.pts[(i + 1) % p.pts.length][1] - p.pts[(i + 1) % p.pts.length][0] * y, 0)) / 2;
}

/** Rect and circle: their centre; polygon: the centre of its corners (unchanged by turning). */
export function centre(p: P): [number, number] {
  if (p.kind !== 'polygon') return [p.x, p.y];
  const n = p.pts.length;
  return [p.pts.reduce((s, q) => s + q[0], 0) / n, p.pts.reduce((s, q) => s + q[1], 0) / n];
}

export function inside(p: P, u: number, v: number): boolean {
  if (p.kind === 'circle') return Math.hypot(u - p.x, v - p.y) <= p.d / 2;
  const pts = corners(p);
  let odd = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/** How many larger profiles contain each profile's centre: even adds material, odd makes a hole. */
export function nesting(ps: P[]): number[] {
  return ps.map((p) => {
    const [u, v] = centre(p);
    const a = area(p);
    return ps.filter((q) => q !== p && area(q) > a && inside(q, u, v)).length;
  });
}
