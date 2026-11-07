import { describe, expect, it } from 'vitest';
import { arcOf, area, bakeTurn, bounds, closedLoop, edgeDistance, flattened, inside, mapPoints, nesting, ontoArcThrough, outlineLength, segPoints, segments, sideDirs, sidesOf, offsetPath } from './profiles';
import { centreMoved, controlMoved, isSmooth, pointHandles, pointMoved, smoothToggled } from '../viewer/shapes';
import { followSizes, sized } from './sizes';
import type { Curve, Doc } from './types';

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

  describe('tangents stay when a point moves', () => {
    const k = Math.SQRT1_2 * 10;
    // along x, a quarter arc up, straight up
    const fillet = { kind: 'line' as const, pts: [[0, 0], [10, 0], [20, 10], [20, 30]] as UV[], curves: [null, { mid: [10 + k, 10 - k] }, null] as (Curve | null)[] };
    const smoothAll = (p: typeof fillet | ReturnType<typeof pointMoved>, ...at: number[]) => at.forEach((i) => expect(isSmooth(p, i)).toBe(true));

    it('the start of the line before a fillet: the fillet follows, its end sliding up its side', () => {
      const q = pointMoved(fillet, 0, [0, -5]);
      smoothAll(q, 1, 2);
      expect(q.pts[1]).toEqual([10, 0]);
      expect(q.pts[3]).toEqual([20, 30]);
      expect(q.pts[2][0]).toBeCloseTo(20);
    });
    it('the arc\'s own start: tangent to both sides still', () => {
      const q = pointMoved(fillet, 1, [8, -3]);
      smoothAll(q, 1, 2);
      expect(q.pts[1]).toEqual([8, -3]);
      expect(q.pts[2][0]).toBeCloseTo(20);
    });
    it('arcs running on from each other stay so, in turn', () => {
      // along x, a quarter up, then a quarter on to the left: radius 10 both, turning the same way
      const chain = { kind: 'line' as const, pts: [[0, 0], [10, 0], [20, 10], [10, 20]] as UV[], curves: [null, { mid: [10 + k, 10 - k] }, { mid: [10 + k, 10 + k] }] as (Curve | null)[] };
      smoothAll(chain, 1, 2);
      smoothAll(pointMoved(chain, 0, [0, -5]), 1, 2);
    });
    it('a point between two arcs: both stay tangent there', () => {
      const r = 10;
      const a: UV[] = [[0, 0], [r, r], [2 * r, 2 * r]];
      const s = { kind: 'line' as const, pts: a, curves: [{ mid: [r * Math.SQRT1_2, r * (1 - Math.SQRT1_2)] }, { mid: [r + r * (1 - Math.SQRT1_2), r + r * Math.SQRT1_2] }] as Curve[] };
      smoothAll(s as never, 1);
      smoothAll(pointMoved(s, 1, [12, 8]), 1);
    });
    it('a corner stays a corner', () => {
      const corner = { kind: 'line' as const, pts: [[0, 0], [10, 0], [10, 10]] as UV[], curves: [null, null] as (Curve | null)[] };
      expect(isSmooth(pointMoved(corner, 1, [12, 3]), 1)).toBe(false);
    });
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

  describe('an arc\'s middle', () => {
    // straight along x to (10, 0), then a quarter arc to the left, radius 10, middle at (10, 10)
    const k = Math.SQRT1_2 * 10;
    const after = { kind: 'line' as const, pts: [[0, 0], [10, 0], [20, 10]] as UV[], curves: [null, { mid: [10 + k, 10 - k] }] as (Curve | null)[] };

    it('is a handle', () => {
      const h = pointHandles(after).find((x) => x.handle.kind === 'centre')!;
      expect(h.at[0]).toBeCloseTo(10);
      expect(h.at[1]).toBeCloseTo(10);
    });

    it('moves square to the line before it: still tangent, its angle kept, the end moving', () => {
      const q = centreMoved(after, 1, [99, 20]); // only its y counts
      expect(q.pts[1]).toEqual([10, 0]);
      expect(q.pts[2][0]).toBeCloseTo(30);
      expect(q.pts[2][1]).toBeCloseTo(20);
      expect(isSmooth(q, 1)).toBe(true);
    });

    it('takes a typed radius, on the step otherwise', () => {
      expect(centreMoved(after, 1, [0, 0], 5).pts[2][0]).toBeCloseTo(15);
      expect(centreMoved(after, 1, [10, 13], undefined, 5).pts[2][0]).toBeCloseTo(25);
    });

    it('with no tangent: square to its chord, both ends staying', () => {
      const free = { kind: 'line' as const, pts: [[-10, 0], [10, 0]] as UV[], curves: [{ mid: [0, 10] }] as Curve[] };
      const q = centreMoved(free, 0, [50, 10]); // the middle above the chord: a smaller bulge, on the same side
      expect(q.pts).toEqual(free.pts);
      const m = (q.curves![0] as { mid: UV }).mid;
      expect(m[0]).toBeCloseTo(0);
      expect(m[1]).toBeCloseTo(Math.hypot(10, 10) + 10);
      const low = centreMoved(free, 0, [0, -5], 20);
      expect((low.curves![0] as { mid: UV }).mid[1]).toBeCloseTo(20 - Math.sqrt(300));
    });
  });

  it('a line end has nothing to toggle', () => {
    expect(smoothToggled(s, 0)).toEqual(s);
  });
});

describe('offsetPath', () => {
  const slot = { kind: 'polygon' as const, pts: [[0, 0], [40, 0], [40, 20], [0, 20]] as [number, number][], curves: [null, { mid: [50, 10] as [number, number] }, null, { mid: [-10, 10] as [number, number] }], r: 0, rot: 0 };
  it('a slot: arcs round the same middles, sides moved out, in both directions of travel', () => {
    for (const shape of [slot, { ...slot, pts: [...slot.pts].reverse() as [number, number][], curves: [null, slot.curves[1], null, slot.curves[3]] }]) {
      const { pts, curves } = offsetPath(shape, 5);
      const ys = pts.map((q) => q[1]).sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(-5);
      expect(ys[3]).toBeCloseTo(25);
      const mids = curves.flatMap((c) => (c && 'mid' in c ? [c.mid[0]] : [])).sort((a, b) => a - b);
      expect(mids[0]).toBeCloseTo(-15);
      expect(mids[1]).toBeCloseTo(55);
    }
    const inner = offsetPath(slot, -5);
    expect(inner.curves[1] && 'mid' in inner.curves[1] && inner.curves[1].mid[0]).toBeCloseTo(45);
  });
  it('a line goes to its left', () => {
    const line = { kind: 'line' as const, pts: [[0, 0], [20, 0]] as [number, number][], curves: [{ c1: [5, 5] as [number, number], c2: [15, 5] as [number, number] }] };
    const { pts } = offsetPath(line, 2);
    expect(pts[0][1]).toBeGreaterThan(0);
    expect(pts[0][0]).toBeLessThan(0);
  });
  it('a corner between a line and an arc: they meet on the arc\'s circle', () => {
    const shape = { kind: 'polygon' as const, pts: [[0, 0], [20, 0], [0, 20]] as [number, number][], curves: [null, { mid: [14.1421, 14.1421] as [number, number] }, null], r: 0, rot: 0 };
    const { pts, curves } = offsetPath(shape, 2);
    expect(Math.hypot(...pts[1])).toBeCloseTo(22, 3);
    expect(pts[1][1]).toBeCloseTo(-2, 5);
    const c = curves[1]!;
    expect('mid' in c && Math.hypot(...c.mid)).toBeCloseTo(22, 3);
  });
});

describe('an arc tangent at both ends', () => {
  // a rounded corner: x axis, a quarter arc, then up
  const corner = { kind: 'line' as const, pts: [[0, 0], [20, 0], [30, 10], [30, 40]] as [number, number][], curves: [null, { mid: [20 + 10 * Math.SQRT1_2, 10 - 10 * Math.SQRT1_2] as [number, number] }, null] };
  it('slides its ends along both sides, as a fillet', () => {
    const q = centreMoved(corner, 1, [0, 0], 5);
    expect(q.pts[1][0]).toBeCloseTo(25);
    expect(q.pts[1][1]).toBeCloseTo(0);
    expect(q.pts[2][0]).toBeCloseTo(30);
    expect(q.pts[2][1]).toBeCloseTo(5);
    expect(isSmooth(q, 1)).toBe(true);
    expect(isSmooth(q, 2)).toBe(true);
    expect(q.pts[0]).toEqual([0, 0]);
    expect(q.pts[3]).toEqual([30, 40]);
  });
  it('stops where a side ends', () => {
    const q = centreMoved(corner, 1, [0, 0], 500);
    expect(q.pts[1][0]).toBeCloseTo(0);
    expect(q.pts[1][1]).toBeCloseTo(0);
  });
});

describe('sides keep their formulas', () => {
  const ex2 = (e: string) => ({ e, u: 'mm' as const });
  const doc = (d: string) => ({ params: { $d: ex2(d) }, bodies: [], sketches: [{ shapes: [{ id: 'a', kind: 'line', pts: [[0, 0], [30, 0], [30, 10]], sizes: [{ l: ex2('$d*3') }, null] }, { id: 'b', kind: 'line', pts: [[0, 0], [10, 0], [20, 10]], curves: [null, { mid: [17.0711, 2.9289] }], sizes: [null, { d: ex2('$d*2') }] }, { id: 'c', kind: 'line', pts: [[0, 0], [10, 0]] }] }] }) as unknown as Doc;
  it('a side follows its length, what comes after it along; an arc its diameter', () => {
    const prev = doc('10');
    const next = followSizes({ ...prev, params: { $d: ex2('20') } }, prev);
    const [a, b, c] = next.sketches[0].shapes as unknown as { pts: UV[]; curves?: ({ mid: UV } | null)[] }[];
    expect(a.pts[1]).toEqual([60, 0]);
    expect(a.pts[2]).toEqual([60, 10]);
    expect(arcOf(b.pts[1], b.curves![1]!.mid, b.pts[2])!.r).toBeCloseTo(20, 2);
    expect(c).toBe(prev.sketches[0].shapes[2]);
  });
  it('a polygon keeps its form: a rectangle stays one, its last point stays', () => {
    const p = sized({ kind: 'polygon', pts: [[0, 0], [30, 0], [30, 10], [0, 10]], r: 0, rot: 0, sizes: [{ l: 50 }] } as Parameters<typeof sized>[0]);
    expect(p.pts).toEqual([[0, 0], [50, 0], [50, 10], [0, 10]]);
  });
  it('a bend after a changed side comes along unchanged', () => {
    const p = sized({ kind: 'line', pts: [[0, 0], [10, 0], [20, 0], [30, 10]], curves: [null, { c1: [12, 2], c2: [18, 2] }, { mid: [26, 2] }], sizes: [{ l: 15 }] } as Parameters<typeof sized>[0]);
    expect(p.pts).toEqual([[0, 0], [15, 0], [25, 0], [35, 10]]);
    expect(p.curves).toEqual([null, { c1: [17, 2], c2: [23, 2] }, { mid: [31, 2] }]);
  });
  it('nothing happens while the parameters stay', () => {
    const prev = doc('10');
    const next = { ...prev, bodies: [] };
    expect(followSizes(next, prev)).toBe(next);
  });
  it('an angle from its base', () => {
    const p = sized({ kind: 'line', pts: [[0, 0], [10, 0]], sizes: [{ l: 10, deg: 90, base: 0 }] } as Parameters<typeof sized>[0]);
    expect(p.pts[1][0]).toBeCloseTo(0);
    expect(p.pts[1][1]).toBeCloseTo(10);
  });
});

describe('onto the true curve', () => {
  it('a point on a chord goes onto the circle through its neighbours', () => {
    const at = (deg: number): UV => [25 * Math.cos((deg * Math.PI) / 180), 25 * Math.sin((deg * Math.PI) / 180)];
    const [a, b, c] = [at(0), at(5), at(10)];
    const on = ontoArcThrough(a, b, c, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    expect(Math.hypot(...on)).toBeCloseTo(25, 9);
  });
  it('three points in line: stays', () => {
    expect(ontoArcThrough([0, 0], [1, 0], [2, 0], [0.5, 0])).toEqual([0.5, 0]);
  });
});

describe('exact outlines', () => {
  const rounded = { kind: 'rect' as const, x: 0, y: 0, w: 40, h: 20, r: 5, rot: 0 };
  const hill = { kind: 'polygon' as const, pts: [[0, 0], [30, 0]] as UV[], curves: [{ c1: [0, -20], c2: [30, -20] } as Curve, null], r: 0, rot: 0 };
  const dense = (p: Parameters<typeof segments>[0]) => {
    const pts = segments(p).flatMap((g) => segPoints(g, 1e-6).slice(0, -1));
    return Math.abs(pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)) / 2;
  };

  it('areas: rounded corners taken off, arcs and beziers exact', () => {
    expect(area(rounded)).toBeCloseTo(800 - (4 - Math.PI) * 25, 9);
    expect(area(halfDisc)).toBeCloseTo(50 * Math.PI, 9);
    expect(area(hill)).toBeCloseTo(dense(hill), 4);
    expect(area({ ...rounded, r: -5 })).toBeCloseTo(800 - 4 * 12.5, 9); // chamfers
  });

  it('lengths along the true curve, not its chords', () => {
    expect(outlineLength({ kind: 'line', pts: [[-50, 0], [50, 0]], curves: [{ mid: [0, 50] }] })).toBeCloseTo(50 * Math.PI, 9);
    const pts = segPoints(segments(hill)[0], 1e-7);
    expect(outlineLength({ kind: 'line', pts: hill.pts, curves: [hill.curves[0]] })).toBeCloseTo(pts.reduce((n, q, i) => n + (i ? Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0), 6);
  });

  it('bounds, inside and distance on the true outline', () => {
    expect(bounds(halfDisc)).toEqual([-10, 0, 10, 10]);
    expect(bounds(hill)[1]).toBeCloseTo(-15, 9); // the bezier's lowest point: ¾ of its handles' depth
    expect(inside(rounded, 19.5, 9.5)).toBe(false); // cut off by the rounding
    expect(inside(rounded, 19, 0)).toBe(true);
    expect(inside(halfDisc, 0, 9.9999)).toBe(true);
    expect(inside(halfDisc, 7.072, 7.072)).toBe(false);
    expect(edgeDistance(rounded, 20, 10)).toBeCloseTo(5 * Math.SQRT2 - 5, 9);
  });

  it('a half disc in a rect is a hole even with its centre on its own edge', () => {
    expect(nesting([{ kind: 'rect', x: 0, y: 0, w: 40, h: 40, r: 0, rot: 0 }, { ...halfDisc, pts: [[-10, 0], [10, 0]] }])).toEqual([0, 1]);
    expect(nesting([{ kind: 'rect', x: 0, y: 20, w: 40, h: 40, r: 0, rot: 0 }, halfDisc])).toEqual([0, 1]);
  });
});
