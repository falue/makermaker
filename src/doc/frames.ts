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
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));

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

/** Sketch frame per extrude or revolve feature; a feature on a missing (or later, or through-cut) feature's face gets none. */
export function frames(features: Resolved<BuildIn>[]): Map<string, Frame> {
  const out = new Map<string, Frame>();
  for (const s of features) {
    if (s.type !== 'extrude' && s.type !== 'revolve') continue;
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

/** The span an extrusion takes along its normal: from its sketch plane to `depth`, and `back` mm behind the plane. */
export function extent(depth: number, back = 0): [number, number] {
  const behind = -(Math.sign(depth) || 1) * back;
  return [Math.min(0, depth, behind), Math.max(0, depth, behind)];
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

/** A cut plane's frame: moved `offset` along its normal, turned `turn` degrees around `axis` (none: its x through its moved `o`). */
export function cutPlane(c: { o: V3; x: V3; n: V3; turn: number; axis: { at: V3; dir: V3 } | null; offset: number }): Frame {
  const { at, dir } = c.axis ?? { at: add(c.o, scale(c.n, c.offset)), dir: c.x };
  const k = scale(dir, 1 / Math.hypot(...dir));
  const [x, n] = [turned(c.x, k, c.turn), turned(c.n, k, c.turn)];
  const o = add(at, turned(add(add(c.o, scale(c.n, c.offset)), scale(at, -1)), k, c.turn)); // the moved point turned around the axis line
  const y: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  return { o, x, y, n };
}
