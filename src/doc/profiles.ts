import type { Resolved } from './resolve';
import type { Profile } from './types';

/** A profile in mm, without id (resolved profiles fit too). */
export type DrawnProfile = Resolved<Profile> extends infer P ? (P extends unknown ? Omit<P, 'id'> : never) : never;
type P = DrawnProfile;

export function area(p: P): number {
  if (p.kind === 'rect') return p.w * p.h;
  if (p.kind === 'circle') return (Math.PI * p.d * p.d) / 4;
  return Math.abs(p.pts.reduce((s, [x, y], i) => s + x * p.pts[(i + 1) % p.pts.length][1] - p.pts[(i + 1) % p.pts.length][0] * y, 0)) / 2;
}

export function centre(p: P): [number, number] {
  if (p.kind !== 'polygon') return [p.x, p.y];
  const n = p.pts.length;
  return [p.pts.reduce((s, q) => s + q[0], 0) / n, p.pts.reduce((s, q) => s + q[1], 0) / n];
}

export function inside(p: P, u: number, v: number): boolean {
  if (p.kind === 'rect') return Math.abs(u - p.x) <= p.w / 2 && Math.abs(v - p.y) <= p.h / 2;
  if (p.kind === 'circle') return Math.hypot(u - p.x, v - p.y) <= p.d / 2;
  let odd = false;
  for (let i = 0, j = p.pts.length - 1; i < p.pts.length; j = i++) {
    const [xi, yi] = p.pts[i];
    const [xj, yj] = p.pts[j];
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
