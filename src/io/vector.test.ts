import { describe, expect, it } from 'vitest';
import { dxfShapes, svgShapes } from './vector';

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
    const curve = shapes.find((s) => s.kind === 'line');
    expect(curve?.kind === 'line' && curve.pts.length).toBeGreaterThan(8);
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
    const outline = shapes.find((s) => s.kind === 'polygon');
    // 40 × 20 mm with a half round end (bulge 1) reaching 10 mm out
    const xs = outline?.kind === 'polygon' ? outline.pts.map((p) => p[0]) : [];
    expect(Math.max(...xs)).toBeCloseTo(50, 1);
    expect(shapes.some((s) => s.kind === 'line')).toBe(true);
  });
});
