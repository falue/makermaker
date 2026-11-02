import { describe, expect, it } from 'vitest';
import { faces, inFace, lineFaces } from './arrangement';

type UV = [number, number];
const line = (...pts: UV[]) => ({ pts, closed: false });
const area = (pts: UV[]) => Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2);
// four lines crossing at the corners of a 10 × 10 square, each sticking out 2 mm
const square = [line([-2, 0], [12, 0]), line([10, -2], [10, 12]), line([12, 10], [-2, 10]), line([0, 12], [0, -2])];

describe('faces', () => {
  it('finds what crossing lines enclose, ignoring the ends that stick out', () => {
    const found = faces(square);
    expect(found).toHaveLength(1);
    expect(area(found[0].outer)).toBeCloseTo(100);
  });

  it('a line across splits the face', () => {
    const found = faces([...square, line([-3, 4], [13, 4])]);
    expect(found.map((f) => +area(f.outer).toFixed(6)).sort((a, b) => a - b)).toEqual([40, 60]);
  });

  it('an unconnected outline inside is a hole of the face around it', () => {
    const found = faces([...square, { pts: [[4, 4], [6, 4], [6, 6], [4, 6]] as UV[], closed: true }]);
    const big = found.find((f) => area(f.outer) > 50)!;
    expect(big.holes).toHaveLength(1);
    expect(inFace(big, [5, 5])).toBe(false);
    expect(inFace(big, [2, 2])).toBe(true);
  });
});

describe('lineFaces', () => {
  it('cuts a rectangle a line crosses, and leaves shapes no line reaches alone', () => {
    const rect = { id: 'r', kind: 'rect' as const, x: 0, y: 0, w: 20, h: 10, r: 0, rot: 0 };
    const cut = { id: 'l', kind: 'line' as const, pts: [[0, -8], [0, 8]] as UV[] };
    const far = { id: 'c', kind: 'circle' as const, x: 100, y: 0, d: 10 };
    const { faces: found, uses } = lineFaces([rect, cut, far]);
    expect(uses.sort()).toEqual(['l', 'r']);
    expect(found).toHaveLength(2);
    expect(found.every((f) => f.in.includes('r') && inFace(f, f.at))).toBe(true);
  });
});
