import { describe, expect, it } from 'vitest';
import { arcOf, area, bakeTurn, bounds, closedLoop, flattened, inside, mapPoints, sideDirs, sidesOf } from './profiles';
import { lineFaces } from './arrangement';
import { controlMoved, isSmooth, pointMoved, smoothToggled } from '../viewer/shapes';
import type { Curve } from './types';

type UV = [number, number];
const halfDisc = { kind: 'polygon' as const, pts: [[-10, 0], [10, 0]] as UV[], curves: [null, { mid: [0, 10] as UV }], r: 0, rot: 0 };

describe('curved sides', () => {
  it('finds an arc through three points, running through the middle', () => {
    const arc = arcOf([-10, 0], [0, 10], [10, 0])!;
    expect(arc.c[0]).toBeCloseTo(0);
    expect(arc.c[1]).toBeCloseTo(0);
    expect(arc.r).toBeCloseTo(10);
    expect(Math.abs(arc.a1 - arc.a0)).toBeCloseTo(Math.PI);
    expect(arcOf([0, 0], [1, 1], [2, 2])).toBeNull();
  });

  it('flattens: a half disc has its area, box and inside', () => {
    expect(area(halfDisc)).toBeCloseTo((Math.PI * 100) / 2, 0);
    const [x0, y0, x1, y1] = bounds(halfDisc);
    expect([x0, y0, x1]).toEqual([-10, 0, 10]);
    expect(y1).toBeCloseTo(10);
    expect(inside(halfDisc, 0, 9)).toBe(true);
    expect(inside(halfDisc, 9, 9)).toBe(false);
  });

  it('flattens a bezier curve through its ends, an open line too', () => {
    const line = { kind: 'line' as const, pts: [[0, 0], [30, 0]] as UV[], curves: [{ c1: [0, 20], c2: [30, 20] } as Curve] };
    const pts = flattened(line);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([30, 0]);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(15); // 3/4 of the handles' height
  });

  it('tells which way a side leaves and arrives', () => {
    const [out, into] = sideDirs([-10, 0], { mid: [0, 10] }, [10, 0]);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(1);
    expect(into[0]).toBeCloseTo(0);
    expect(into[1]).toBeCloseTo(-1);
  });

  it('moves and turns its handles with its points', () => {
    const moved = mapPoints(halfDisc, ([x, y]) => [x + 5, y]);
    expect(moved.curves![1]).toEqual({ mid: [5, 10] });
    const baked = bakeTurn({ ...halfDisc, rot: 180 });
    expect(baked.rot).toBe(0);
    expect(baked.pts[0][0]).toBeCloseTo(10);
    expect((baked.curves![1] as { mid: UV }).mid[1]).toBeCloseTo(-10);
  });

  it('joins lines into a loop with their curves, one drawn backwards', () => {
    const lines = [
      { id: 'a', pts: [[0, 0], [10, 0]] as UV[], curves: [{ c1: [2, 5], c2: [8, 5] } as Curve] },
      { id: 'b', pts: [[0, 0], [10, 0]] as UV[], curves: [{ c1: [3, -5], c2: [7, -5] } as Curve] },
    ];
    const loop = closedLoop(lines, 'a')!;
    expect(loop.ids).toEqual(['a', 'b']);
    expect(loop.pts).toEqual([[0, 0], [10, 0]]);
    expect(loop.curves).toEqual([{ c1: [2, 5], c2: [8, 5] }, { c1: [7, -5], c2: [3, -5] }]);
  });

  it('straight lines still need three corners to close', () => {
    expect(closedLoop([{ id: 'a', pts: [[0, 0], [10, 0]] }, { id: 'b', pts: [[10, 0], [0, 0]] }], 'a')).toBeNull();
  });

  it('a curved line and a straight one crossing it enclose a face', () => {
    const arch = { id: 'a', kind: 'line' as const, pts: [[-10, 0], [10, 0]] as UV[], curves: [{ mid: [0, 10] } as Curve] };
    const floor = { id: 'b', kind: 'line' as const, pts: [[-20, 2], [20, 2]] as UV[] };
    const { faces } = lineFaces([arch, floor]);
    expect(faces).toHaveLength(1);
    expect(faces[0].at[1]).toBeGreaterThan(2);
  });
});

describe('editing points and handles', () => {
  const s = { kind: 'line' as const, pts: [[0, 0], [10, 0], [20, 0]] as UV[], curves: [{ c1: [3, 3], c2: [7, -3] }, { c1: [13, 3], c2: [17, 3] }] as Curve[] };

  it('a point takes its handles along', () => {
    const q = pointMoved(s, 1, [10, 5]);
    expect(q.pts[1]).toEqual([10, 5]);
    expect(q.curves![0]).toEqual({ c1: [3, 3], c2: [7, 2] });
    expect(q.curves![1]).toEqual({ c1: [13, 8], c2: [17, 3] });
  });

  it('an arc keeps its shape when an end moves', () => {
    const q = pointMoved(halfDisc, 1, [30, 0]); // the chord twice as long
    const m = (q.curves![1] as { mid: UV } | null) ?? (q.curves![0] as { mid: UV });
    expect(m.mid[0]).toBeCloseTo(10);
    expect(m.mid[1]).toBeCloseTo(20);
  });

  it('a smooth point turns the handle across it, keeping its length', () => {
    expect(isSmooth(s, 1)).toBe(true);
    const q = controlMoved(s, 1, 'c1', [10, 8]);
    const c2 = (q.curves![0] as { c2: UV }).c2;
    expect(c2[0]).toBeCloseTo(10);
    expect(c2[1]).toBeCloseTo(-Math.hypot(3, 3));
  });

  it('double-click: smooth to sharp, and back', () => {
    const sharp = smoothToggled(s, 1);
    expect(isSmooth(sharp, 1)).toBe(false);
    expect(smoothToggled(sharp, 1).curves).toBeTruthy();
    const corner = { kind: 'polygon' as const, pts: [[0, 0], [10, 0], [10, 10]] as UV[], r: 0, rot: 0 };
    expect(isSmooth(smoothToggled(corner, 1), 1)).toBe(true);
    expect(sidesOf(smoothToggled(corner, 1))[0].length).toBeGreaterThan(2);
  });

  it('an arc stays an arc: only the bezier side turns', () => {
    const q = { kind: 'polygon' as const, pts: [[0, 0], [10, 0]] as UV[], curves: [{ c1: [2, 5], c2: [8, 5] }, { mid: [5, -20] }] as Curve[], r: 0, rot: 0 };
    const t = smoothToggled(q, 1);
    expect(t.curves![1]).toEqual({ mid: [5, -20] });
    expect(isSmooth(t, 1)).toBe(true);
  });

  it('a line end has nothing to toggle', () => {
    expect(smoothToggled(s, 0)).toEqual(s);
  });
});
