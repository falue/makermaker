import type { Resolved } from './resolve';
import type { BasePlane, Step } from './types';

export type V3 = [number, number, number];

/** Sketch plane: origin, in-plane axes x and y, normal n = x × y (part-local). */
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

/** Sketch frame per extrude step; a step on a missing (or later, or through-cut) step's face gets none. */
export function frames(steps: Resolved<Step>[]): Map<string, Frame> {
  const out = new Map<string, Frame>();
  for (const s of steps) {
    if (s.type !== 'extrude') continue;
    const p = s.plane;
    if (p.kind === 'base') {
      const b = BASE[p.axis];
      out.set(s.id, { ...b, o: scale(b.n, p.offset) });
      continue;
    }
    const of = steps.find((t) => t.id === p.step);
    const f = out.get(p.step);
    if (f && of?.type === 'extrude' && !of.through) out.set(s.id, { ...f, o: add(f.o, scale(f.n, of.depth)) });
  }
  return out;
}

/** End face of an extrude step: its frame moved along the normal by its depth. */
export const capFrame = (f: Frame, depth: number): Frame => ({ ...f, o: add(f.o, scale(f.n, depth)) });
