import { describe, expect, it } from 'vitest';
import { dxfOf, sheetOf, sheetSvg, sketchCuts, svgOf, type Cut } from './cutfile';

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
    const at = dxf.indexOf('POLYLINE');
    expect(dxf[at + dxf.slice(at).indexOf('70') + 1]).toBe('0'); // flag 70: open
    expect(dxf.filter((l) => l === 'VERTEX')).toHaveLength(3);
  });
  it('lays pieces out on one sheet, each named over its top left, 1 pt lines, the names in black', () => {
    const square = (w: number): Cut[] => [{ hole: false, pts: [[0, 0], [w, 0], [w, w], [0, w]], curves: [null, null, null, null] }];
    const sheet = sheetOf([{ name: 'small', cuts: square(10) }, { name: 'big & tall', cuts: square(30) }]);
    const [cuts, labels] = [sheet.flatMap((p) => p.cuts), sheet.map((p) => p.label)];
    expect(labels.map((l) => l.text)).toEqual(['big & tall', 'small']); // tallest first
    const box = (c: Cut) => [Math.min(...c.pts.map((p) => p[0])), Math.min(...c.pts.map((p) => p[1])), Math.max(...c.pts.map((p) => p[0])), Math.max(...c.pts.map((p) => p[1]))];
    const [a, b] = cuts.map(box);
    expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(true); // apart
    labels.forEach((l, i) => {
      const [x0, y0] = box(cuts[i]);
      expect(l.at[0]).toBeCloseTo(x0, 6); // at its left
      expect(l.at[1]).toBeLessThan(y0); // over its top (y down)
    });
    expect(Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3])).toBeGreaterThanOrEqual(20 - 1e-9); // 20 mm apart at least
    // each piece a group of its cuts and its name
    const svg = sheetSvg(sheet);
    expect(svg).toContain('stroke-width="0.3528"');
    expect(svg).toMatch(/<g id="big_tall">\s*<g fill="none" stroke="#ff0000"[^>]*>\s*<path[^>]*\/>\s*<\/g>\s*<text[^>]*fill="#000000">big &amp; tall<\/text>\s*<\/g>/);
    expect(svg.match(/<g id=/g)).toHaveLength(2);
    expect(dxfOf(cuts, labels)).toMatch(/\nTEXT\n8\nLABEL\n62\n7\n/);
  });
  it("draws a key's folds green, on the key's layer", () => {
    const line = (y: number): Cut => ({ hole: false, pts: [[0, y], [10, y]], curves: [null, null], open: true, key: true });
    const cuts = [line(0), { ...line(5), mark: true }];
    const svg = svgOf(cuts);
    expect(svg.match(/stroke="#00ff00"[^]*?<\/g>/)![0]).toContain('M0 5');
    expect(svg.match(/stroke="#000000"[^]*?<\/g>/)![0]).not.toContain('M0 5');
    const dxf = dxfOf(cuts).split('\n');
    const polylines = dxf.flatMap((v, i) => (v === 'POLYLINE' ? [[dxf[i + 2], dxf[i + 4]]] : []));
    expect(polylines).toEqual([['KEY', '7'], ['KEY', '3']]);
  });
});

