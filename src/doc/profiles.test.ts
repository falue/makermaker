import { describe, expect, it } from 'vitest';
import { alignment, bounds, inside } from './profiles';

describe('profiles', () => {
  it('turns rects for bounds and inside tests', () => {
    const r = { kind: 'rect' as const, x: 0, y: 0, w: 20, h: 10, r: 0, rot: 90 };
    expect(bounds(r).map((v) => +v.toFixed(6))).toEqual([-5, -10, 5, 10]);
    expect(inside(r, 0, 8)).toBe(true);
    expect(inside(r, 8, 0)).toBe(false);
  });

  it('aligns and distributes boxes', () => {
    const boxes: [number, number, number, number][] = [
      [0, 0, 10, 10],
      [30, 5, 40, 25],
      [12, 0, 16, 4],
    ];
    expect(alignment(boxes, 'left')).toEqual([[0, 0], [-30, 0], [-12, 0]]);
    expect(alignment(boxes, 'top')).toEqual([[0, 15], [0, 0], [0, 21]]);
    // total width 40, boxes 10 + 10 + 4 = 24: gaps of 8
    expect(alignment(boxes, 'distributeX')).toEqual([[0, 0], [0, 0], [6, 0]]);
  });
});
