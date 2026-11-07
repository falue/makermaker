import { describe, expect, it } from 'vitest';
import { alignment, bounds, closedLoop, cornerLimits, cornerRadii, inside, roundedOutline } from './profiles';

describe('profiles', () => {
  it('finds the loop lines close, either way round', () => {
    const lines = [
      { id: 'a', pts: [[0, 0], [10, 0]] as [number, number][] },
      { id: 'b', pts: [[10, 10], [10, 0]] as [number, number][] }, // drawn backwards
      { id: 'c', pts: [[10, 10], [0, 10], [0, 0.0004]] as [number, number][] }, // a polyline, its end a hair off
      { id: 'd', pts: [[50, 50], [60, 60]] as [number, number][] },
    ];
    expect(closedLoop(lines, 'c')).toEqual({ ids: ['c', 'a', 'b'], pts: [[10, 10], [0, 10], [0, 0.0004], [10, 0]] });
    expect(closedLoop(lines, 'd')).toBeNull();
    expect(closedLoop(lines.slice(0, 2), 'a')).toBeNull();
  });

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

describe('cornerRadii', () => {
  const rect = (r: number, rs?: number[]) => ({ kind: 'rect' as const, x: 0, y: 0, w: 40, h: 20, r, rot: 0, ...(rs ? { rs } : {}) });
  it('gives every corner R, or each its own', () => {
    expect(cornerRadii(rect(3))).toEqual([3, 3, 3, 3]);
    expect(cornerRadii(rect(3, [0, 5, 2, 1]))).toEqual([0, 5, 2, 1]);
  });
  it('clamps a radius too big for its corner there only (half the shorter side beside it)', () => {
    const [a, b, c, d] = cornerRadii(rect(0, [0, 5, 50, 0]));
    expect([a, b, d]).toEqual([0, 5, 0]);
    expect(c).toBeCloseTo(9.99, 6); // 10 (half of 20) kept a hair short
  });
  it('a polygon corner of 90° and one of 45° take what their sides allow', () => {
    const tri = { kind: 'polygon' as const, pts: [[0, 0], [10, 0], [0, 10]] as [number, number][], r: 100, rot: 0 };
    const [right, , sharp] = cornerRadii(tri);
    expect(right).toBeCloseTo(0.999 * 5, 6); // 90°: as far as it reaches
    expect(sharp).toBeCloseTo(0.999 * 5 * Math.tan(Math.PI / 8), 6); // 45°: its turn of 135° halved
  });
});


describe('roundedOutline', () => {
  it('rounds each corner as the kernel does: a square of 10 with R 2 keeps its box, its corner points lie 2 in', () => {
    const pts = roundedOutline({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, r: 2, rot: 0 }, 4);
    expect(pts).toHaveLength(20);
    const xs = pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-5, 9);
    expect(Math.max(...xs)).toBeCloseTo(5, 9);
    // the arc's middle at the corner: on the circle of 2 round (3, 3)
    const mid = pts[2];
    expect(Math.hypot(mid[0] + 3, mid[1] + 3)).toBeCloseTo(2, 9);
  });
});

describe('chamfered corners', () => {
  it('a corner below 0 is a chamfer of that length, at most half the shorter side beside it', () => {
    const rect = { kind: 'rect' as const, x: 0, y: 0, w: 40, h: 20, r: 0, rot: 0, rs: [-3, -50, 2, 0] };
    const [a, b, c, d] = cornerRadii(rect);
    expect([a, c, d]).toEqual([-3, 2, 0]);
    expect(b).toBeCloseTo(-9.99, 6);
    expect(cornerLimits(rect)[0].round).toBeCloseTo(10, 9);
    expect(cornerLimits(rect)[0].bevel).toBeCloseTo(10, 9);
    // the chamfered corner (bottom left) cut straight across: 3 up its left side, 3 along its bottom
    expect(roundedOutline(rect, 4).slice(0, 2)).toEqual([[-20, -7], [-17, -10]]);
    // only chamfers: drawn too
    expect(roundedOutline({ ...rect, rs: undefined, r: -2 })).toHaveLength(8);
  });
});

