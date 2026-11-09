import { describe, expect, it } from 'vitest';
import { dxfOf, sketchCuts, svgOf } from './cutfile';

describe('sketch drawings', () => {
  const shapes = [
    { kind: 'line' as const, pts: [[0, 0], [10, 0], [10, 5]] as [number, number][] },
    { kind: 'circle' as const, x: 20, y: 10, d: 6 },
    { kind: 'rect' as const, x: 0, y: 0, w: 4, h: 2, r: 0, rot: 0 },
    { kind: 'line' as const, pts: [[0, 0], [0, 9]] as [number, number][], construction: true },
  ];

  it('keeps lines open, circles whole, y down, and leaves construction lines out', () => {
    const cuts = sketchCuts(shapes);
    expect(cuts).toHaveLength(3);
    expect(cuts[0]).toMatchObject({ open: true, pts: [[0, -0], [10, -0], [10, -5]] });
    expect(cuts[1].circle).toEqual({ c: [20, -10], r: 3 });
    expect(cuts[2].open).toBeUndefined();
    expect(cuts[2].pts).toHaveLength(4);
  });

  it('writes an open line without closing it', () => {
    const [line] = sketchCuts(shapes);
    expect(svgOf([line])).toMatch(/<path d="M0 0L10 0L10 -5"\/>/);
    const dxf = dxfOf([line]).split('\n');
    expect(dxf[dxf.indexOf('POLYLINE') + 12]).toBe('0'); // flag 70: open
    expect(dxf.filter((l) => l === 'VERTEX')).toHaveLength(3);
  });
});
