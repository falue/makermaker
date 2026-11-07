import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { anchorAt, ballAcross, ballOnFour, ballOnThree, ballsInCorner, placed, sizedTo, bezierCurve, circleCurve, tangentAlong, tangentFrom, turnedTo } from './shapes';

const rect = { kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: 0, rot: 0 } as const;

describe('reference point', () => {
  it('measures and places from the chosen point', () => {
    expect(anchorAt(rect, [-1, 1])).toEqual([-20, 10]);
    expect(placed(rect, [-1, -1], [0, 0])).toMatchObject({ x: 20, y: 10 });
  });

  it('resizes and turns around it', () => {
    expect(sizedTo(rect, [-1, 0], [50, 20])).toMatchObject({ x: 5, w: 50 });
    expect(sizedTo(rect, [0, 0], [50, 30])).toMatchObject({ x: 0, y: 0, w: 50, h: 30 });
    const t = turnedTo(rect, [-1, -1], 90);
    expect(anchorAt(t, [-1, -1]).map((v) => +v.toFixed(9))).toEqual([-20, -10]);
    expect(sizedTo({ kind: 'circle', x: 0, y: 0, d: 10 }, [1, 0], [20, 20])).toMatchObject({ x: -5, d: 20 });
  });
});

describe('balls', () => {
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const round = (b: { center: Vector3; d: number }) => [...b.center.toArray(), b.d].map((x) => +x.toFixed(6) + 0);
  it('two points across', () => expect(round(ballAcross(v(0, 0, 0), v(0, 0, 10)))).toEqual([0, 0, 5, 10]));
  it('three points: the smallest, tilted too; on one line none', () => {
    expect(round(ballOnThree(v(5, 1, 3), v(-5, 1, 3), v(0, 6, 3))!)).toEqual([0, 1, 3, 10]);
    const c = ballOnThree(v(5, 0, 0), v(0, 5, 0), v(0, 0, 5))!;
    expect(c.center.toArray().map((x) => +x.toFixed(6))).toEqual([5 / 3, 5 / 3, 5 / 3].map((x) => +x.toFixed(6)));
    expect(ballOnThree(v(0, 0, 0), v(1, 1, 1), v(2, 2, 2))).toBeNull();
  });
  it('four points: the one ball; in one plane none', () => {
    expect(round(ballOnFour(v(5, 0, 0), v(-5, 0, 0), v(0, 5, 0), v(0, 0, 5))!)).toEqual([0, 0, 0, 10]);
    expect(ballOnFour(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(1, 1, 0))).toBeNull();
  });
  it('three planes: the centre rides their corner; parallel ones have none', () => {
    const corner = ballsInCorner([{ at: v(1, 0, 0), n: v(1, 0, 0) }, { at: v(0, 2, 0), n: v(0, 1, 0) }, { at: v(0, 0, 3), n: v(0, 0, 1) }])!;
    expect(corner.at.toArray()).toEqual([1, 2, 3]);
    expect(corner.along.toArray()).toEqual([1, 1, 1]);
    expect(ballsInCorner([{ at: v(0, 0, 0), n: v(1, 0, 0) }, { at: v(5, 0, 0), n: v(1, 0, 0) }, { at: v(0, 0, 0), n: v(0, 0, 1) }])).toBeNull();
  });
});

describe('tangent from a curve', () => {
  const circle = circleCurve([10, 5], 4);
  const off = (at: number[], dir: number) => Math.abs((10 - at[0]) * Math.sin(dir) - (5 - at[1]) * Math.cos(dir));

  it('a circle: touches on the side clicked, wherever the pointer goes', () => {
    for (const to of [[30, 9], [-20, 9], [30, -7], [-3, 14]] as [number, number][]) {
      const t = tangentFrom(circle, [10, 9], 0.25, to);
      expect(Math.hypot(t.at[0] - 10, t.at[1] - 5)).toBeCloseTo(4, 9);
      expect(off(t.at, t.dir)).toBeCloseTo(4, 9);
      expect(t.at[1]).toBeGreaterThan(5);
      expect(Math.atan2(to[1] - t.at[1], to[0] - t.at[0])).toBeCloseTo(t.dir, 7);
    }
    expect(tangentFrom(circle, [10, 1], 0.75, [30, 1]).at[1]).toBeCloseTo(1, 9);
  });

  it('a pointer inside stays where it is, along the circle', () => {
    const t = tangentFrom(circle, [10, 9], 0.25, [12, 6]);
    expect(t.t).toBe(0.25);
    expect(t.dir).toBeCloseTo(0, 9);
    expect(tangentFrom(circle, [10, 9], 0.25, [8, 6]).dir).toBeCloseTo(Math.PI, 9);
  });

  it('a short arc: on it while a tangent reaches, else it stays', () => {
    const arc = circleCurve([0, 0], 10, Math.PI / 3, (2 * Math.PI) / 3); // the top sixth
    const t = tangentFrom(arc, [0, 10], 0.5, [30, 10]);
    expect(t.at[0]).toBeCloseTo(0, 7);
    expect(t.at[1]).toBeCloseTo(10, 7);
    const beyond = tangentFrom(arc, [0, 10], 0.1, [10, -30]); // touches the circle off the arc
    expect(beyond.t).toBe(0.1);
    const [nx, ny] = beyond.at;
    expect(Math.cos(beyond.dir) * nx + Math.sin(beyond.dir) * ny).toBeCloseTo(0, 9);
  });

  it('a bezier: the line runs along the curve where it touches', () => {
    const b = bezierCurve([0, 0], [10, 20], [30, 20], [40, 0]);
    const t = tangentFrom(b, [20, 15], 0.5, [60, 25]);
    const d = b.dir(t.t);
    expect(Math.abs(Math.cos(t.dir) * d[1] - Math.sin(t.dir) * d[0]) / Math.hypot(...d)).toBeCloseTo(0, 9);
    expect(Math.atan2(25 - t.at[1], 60 - t.at[0])).toBeCloseTo(t.dir, 7);
  });

  it('a bezier: every tangent point from a point, even two within a hair', () => {
    // an S turning at t = 29/51: from a point far along its tangent there, just off it, two tangents touch within a
    // hair of it, inside one 96th (a search for sign changes in 96ths found none)
    const s = bezierCurve([0, 0], [10, 12], [20, -5], [30, 0]);
    const [m, d0] = [s.at(29 / 51), s.dir(29 / 51)];
    const to: [number, number] = [m[0] + d0[0] * 50 - d0[1] * 1e-4, m[1] + d0[1] * 50 + d0[0] * 1e-4];
    const ts = s.from(to);
    expect(ts).toHaveLength(2);
    expect(ts[1] - ts[0]).toBeLessThan(1 / 96);
    for (const t of ts) {
      const [p, d] = [s.at(t), s.dir(t)];
      expect(Math.abs((p[0] - to[0]) * d[1] - (p[1] - to[1]) * d[0]) / (Math.hypot(...d) * Math.hypot(p[0] - to[0], p[1] - to[1]))).toBeLessThan(1e-12);
    }
  });

  it('a direction set: where it runs that way, the nearest; none on a short arc', () => {
    const top = circle.at(tangentAlong(circle, 0.5, [10, 9])!);
    expect(off(top, 0.5)).toBeCloseTo(4, 9);
    expect(top[1]).toBeGreaterThan(5);
    expect(tangentAlong(circleCurve([0, 0], 10, Math.PI / 3, (2 * Math.PI) / 3), Math.PI / 2, [0, 10])).toBeNull();
  });
});
