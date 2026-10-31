import type { Resolved } from './resolve';
import type { BasePlane, BuildIn } from './types';

export type V3 = [number, number, number];

/** Sketch plane: origin, in-plane axes x and y, normal n = x × y (body-local). */
export interface Frame {
  o: V3;
  x: V3;
  y: V3;
  n: V3;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Base planes: xz is the front (normal towards the viewer, -y), yz the right side (normal +x). */
export const BASE: Record<BasePlane, Frame> = {
  xy: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
  xz: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] },
  yz: { o: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] },
};

export const toWorld = (f: Frame, u: number, v: number): V3 => add(f.o, add(scale(f.x, u), scale(f.y, v)));

export const toPlane = (f: Frame, p: V3): [number, number] => {
  const d: V3 = [p[0] - f.o[0], p[1] - f.o[1], p[2] - f.o[2]];
  return [dot(d, f.x), dot(d, f.y)];
};

export const moved = (f: Frame, by: V3): Frame => ({ ...f, o: add(f.o, by) });

/** Sketch frame per extrude feature; a feature on a missing (or later, or through-cut) feature's face gets none. */
export function frames(features: Resolved<BuildIn>[]): Map<string, Frame> {
  const out = new Map<string, Frame>();
  for (const s of features) {
    if (s.type !== 'extrude') continue;
    const p = s.plane;
    if (p.kind === 'frame') {
      out.set(s.id, { o: p.o, x: p.x, y: p.y, n: p.n });
      continue;
    }
    if (p.kind === 'base') {
      const b = BASE[p.axis];
      out.set(s.id, { ...b, o: scale(b.n, p.offset) });
      continue;
    }
    const of = features.find((t) => t.id === p.feature);
    const f = out.get(p.feature);
    if (f && of?.type === 'extrude' && !of.through) out.set(s.id, { ...f, o: add(f.o, scale(f.n, of.depth)) });
  }
  return out;
}

/** End face of an extrude feature: its frame moved along the normal by its depth. */
export const capFrame = (f: Frame, depth: number): Frame => ({ ...f, o: add(f.o, scale(f.n, depth)) });

/** A rigid placement: turned by `angle` degrees around `axis` (unit, through the origin), then moved by `offset`. */
export interface Place {
  axis: V3;
  angle: number;
  offset: V3;
}

export const STILL: Place = { axis: [0, 0, 1], angle: 0, offset: [0, 0, 0] };

/** `v` turned by `deg` degrees around unit `axis` (Rodrigues). */
export function turned(v: V3, axis: V3, deg: number): V3 {
  if (!deg) return v;
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const k = dot(axis, v) * (1 - c);
  const [x, y, z] = axis;
  return [v[0] * c + (y * v[2] - z * v[1]) * s + x * k, v[1] * c + (z * v[0] - x * v[2]) * s + y * k, v[2] * c + (x * v[1] - y * v[0]) * s + z * k];
}

/** A point given in placed coordinates, in the outer ones (`direction`: only turned). */
export const placed = (pl: Place, p: V3, direction = false): V3 => {
  const t = turned(p, pl.axis, pl.angle);
  return direction ? t : add(t, pl.offset);
};

/** A point given in the outer coordinates, in placed ones (`direction`: only turned back). */
export const unplaced = (pl: Place, p: V3, direction = false): V3 => turned(direction ? p : add(p, scale(pl.offset, -1)), pl.axis, -pl.angle);

/** A frame given in placed coordinates, in the outer ones; `back`: the other way. */
export function placeFrame(pl: Place, f: Frame, back = false): Frame {
  const map = back ? unplaced : placed;
  return { o: map(pl, f.o), x: map(pl, f.x, true), y: map(pl, f.y, true), n: map(pl, f.n, true) };
}
