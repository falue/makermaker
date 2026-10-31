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
