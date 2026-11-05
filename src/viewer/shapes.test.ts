import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { anchorAt, ballAcross, ballOnFour, ballOnThree, ballsInCorner, placed, sizedTo, turnedTo } from './shapes';

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
