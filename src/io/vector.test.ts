import { describe, expect, it } from 'vitest';
import { area, bounds } from '../doc/profiles';
import { dxfShapes, svgShapes, type Shape2 } from './vector';

const outline = (q: Shape2 | undefined) => (q && q.kind !== 'circle' ? { ...q, r: 0, rot: 0 } : { kind: 'polygon' as const, pts: [] as [number, number][], r: 0, rot: 0 });

describe('svgShapes', () => {
  it('reads a drawing 1:1 in mm, y up: a rectangle, a hole, a curve', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
      <!-- a comment -->
      <g transform="translate(10 10)">
        <rect x="0" y="0" width="100" height="40"/>
        <circle cx="20" cy="20" r="10"/>
      </g>
      <path d="M 0 90 C 50 60 150 60 200 90"/>
      <text x="5" y="5">label</text>
    </svg>`;
    const shapes = svgShapes(svg);
    const circle = shapes.find((s) => s.kind === 'circle');
    expect(circle).toEqual({ kind: 'circle', x: 15, y: -15, d: 10 }); // 2 units = 1 mm; y down becomes y up
    const rect = shapes.find((s) => s.kind === 'polygon');
    expect(rect?.kind === 'polygon' && rect.pts.length).toBe(4);
    const xs = rect?.kind === 'polygon' ? rect.pts.map((p) => p[0]) : [];
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 6);
    // the curve stays one bezier
    const curve = shapes.find((s) => s.kind === 'line');
    expect(curve).toEqual({ kind: 'line', pts: [[0, -45], [100, -45]], curves: [{ c1: [25, -30], c2: [75, -30] }] });
  });

  it('chains loose lines into a closed polygon', () => {
    const svg = `<svg width="10mm" height="10mm" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="0"/><line x1="10" y1="10" x2="10" y2="0"/><line x1="10" y1="10" x2="0" y2="10"/><line x1="0" y1="10" x2="0" y2="0"/></svg>`;
    const shapes = svgShapes(svg);
    expect(shapes.length).toBe(1);
    expect(shapes[0].kind).toBe('polygon');
  });
});

describe('dxfShapes', () => {
  const dxf = (units: number, entities: (string | number)[]) => [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...entities, 0, 'ENDSEC', 0, 'EOF'].join('\n');
  it('reads lines, circles, arcs and bulged polylines in their units', () => {
    const text = dxf(5, [
      0, 'CIRCLE', 8, '0', 10, 1, 20, 2, 30, 0, 40, 0.5,
      0, 'LWPOLYLINE', 8, '0', 90, 4, 70, 1, 10, 0, 20, 0, 10, 4, 20, 0, 42, 1, 10, 4, 20, 2, 10, 0, 20, 2,
      0, 'ARC', 8, '0', 10, 10, 20, 10, 40, 1, 50, 0, 51, 90,
    ]);
    const shapes = dxfShapes(text);
    expect(shapes.find((s) => s.kind === 'circle')).toEqual({ kind: 'circle', x: 10, y: 20, d: 10 }); // cm to mm
    // 40 × 20 mm with a half round end (bulge 1) reaching 10 mm out: a true arc
    const slot = outline(shapes.find((s) => s.kind === 'polygon'));
    expect(bounds(slot)[2]).toBeCloseTo(50, 9);
    expect(area(slot)).toBeCloseTo(800 + 50 * Math.PI, 9);
    const arc = shapes.find((s) => s.kind === 'line');
    expect(arc?.kind === 'line' && arc.curves?.[0] && 'mid' in arc.curves[0] && arc.curves[0].mid[0]).toBeCloseTo(100 + 10 * Math.SQRT1_2, 9);
  });
});

describe('curves kept', () => {
  it('a rounded rect, an ellipse and an arc path arrive with true arcs or cubics', () => {
    const svg = `<svg width="100mm" height="100mm" viewBox="0 0 100 100">
      <rect x="0" y="0" width="40" height="20" rx="5"/>
      <ellipse cx="70" cy="70" rx="20" ry="10"/>
      <path d="M 0 60 A 10 10 0 0 1 20 60"/>
    </svg>`;
    const shapes = svgShapes(svg);
    const rect = outline(shapes.find((q) => q.kind === 'polygon' && q.pts.length === 8 && !q.curves?.every(Boolean)));
    expect(area(rect)).toBeCloseTo(800 - (4 - Math.PI) * 25, 9);
    const ellipse = outline(shapes.find((q) => q.kind === 'polygon' && q.pts.length === 8 && !!q.curves?.every(Boolean)));
    expect(area(ellipse)).toBeCloseTo(Math.PI * 200, 2); // eight cubics: within 1e-5
    expect(bounds(outline(shapes.find((q) => q.kind === 'line')))[1]).toBeCloseTo(-60, 9); // the half circle's top, y up
  });

  it('a DXF B-spline becomes its exact cubic pieces', () => {
    const dxf = [0, 'SECTION', 2, 'ENTITIES', 0, 'SPLINE', 71, 3, ...[0, 0, 0, 0, 1, 2, 2, 2, 2].flatMap((k) => [40, k]), ...[[0, 0], [10, 20], [20, -10], [30, 20], [40, 0]].flatMap(([x, y]) => [10, x, 20, y]), 0, 'ENDSEC', 0, 'EOF'].join('\n');
    const [line] = dxfShapes(dxf);
    expect(line.kind === 'line' && line.pts).toEqual([[0, 0], [20, 5], [40, 0]]);
    expect(line.kind === 'line' && line.curves).toEqual([{ c1: [10, 20], c2: [15, 5] }, { c1: [25, 5], c2: [30, 20] }]);
  });

  it('a weighted (rational) DXF spline, a quarter circle, arrives as true arcs on that circle', () => {
    const w = Math.SQRT1_2;
    const dxf = [0, 'SECTION', 2, 'ENTITIES', 0, 'SPLINE', 71, 2, ...[0, 0, 0, 1, 1, 1].flatMap((k) => [40, k]), ...[1, w, 1].flatMap((k) => [41, k]), ...[[10, 0], [10, 10], [0, 10]].flatMap(([x, y]) => [10, x, 20, y]), 0, 'ENDSEC', 0, 'EOF'].join('\n');
    const [line] = dxfShapes(dxf);
    expect(line.kind === 'line' && line.curves?.every((c) => c && 'mid' in c)).toBe(true);
    const pts = line.kind === 'line' ? [...line.pts, ...line.curves!.map((c) => (c as { mid: [number, number] }).mid)] : [];
    for (const q of pts) expect(Math.hypot(...q)).toBeCloseTo(10, 6);
  });
});

