import { describe, expect, it } from 'vitest';
import { anchorAt, placed, sizedTo, turnedTo } from './shapes';

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
