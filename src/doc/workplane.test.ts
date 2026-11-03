import { describe, expect, it } from 'vitest';
import { workFrame } from './workplane';
import type { Frame, V3 } from './frames';

const ground: Frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
const on = (f: Frame, p: V3) => (p[0] - f.o[0]) * f.n[0] + (p[1] - f.o[1]) * f.n[1] + (p[2] - f.o[2]) * f.n[2];

describe('work planes', () => {
  it('turns around its axis and lifts by its offset', () => {
    const f = workFrame(ground, 5, 90, null, []);
    expect(f.n.map((v) => +v.toFixed(6))).toEqual([0, -1, 0]); // ground turned 90° around x
    expect(f.o.map((v) => +v.toFixed(6))).toEqual([0, -5, 0]);
  });

  it('passes through one, two or three points', () => {
    const one = workFrame(ground, 0, 0, null, [[0, 10, 10]]);
    expect(on(one, [0, 10, 10])).toBeCloseTo(0, 6);
    expect(on(one, [50, 0, 0])).toBeCloseTo(0, 6); // still through its axis (its own x)
    const two = workFrame(ground, 0, 0, null, [[0, 0, 0], [10, 0, 10]]);
    for (const p of [[0, 0, 0], [10, 0, 10]] as V3[]) expect(on(two, p)).toBeCloseTo(0, 6);
    expect(two.n[2]).toBeGreaterThan(0.5); // still facing up mostly
    expect(two.x.map((v) => +v.toFixed(6))).toEqual([0.707107, 0, 0.707107]); // from the first point to the second
    const three = workFrame(ground, 0, 0, null, [[0, 0, 5], [10, 0, 5], [0, 10, 5]]);
    expect(three.n.map((v) => +v.toFixed(6))).toEqual([0, 0, 1]);
    expect(three.o[2]).toBeCloseTo(5, 6);
  });
});
