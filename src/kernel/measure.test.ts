import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { drawCircle, drawRoundedRectangle, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { answer, Solid, type SolidMeasure } from './measure';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));
beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const noPlace = { angle: 0, axis: [0, 0, 1] as [number, number, number], offset: [0, 0, 0] as [number, number, number] };
const cylinder = (d = 50, h = 10) => new Solid(drawCircle(d / 2).sketchOnPlane().extrude(h) as Shape3D);
const round = (v: number[]) => v.map((x) => +x.toFixed(6));

describe('measuring the real solid', () => {
  it('a circle rim is its true length, not the sum of straight pieces', () => {
    const s = cylinder();
    const rim = s.edges.flatMap((e, edge) => (e.geomType === 'CIRCLE' && Math.abs(e.startPoint.z) < 1e-9 ? [edge] : []));
    const total = rim.reduce((n, edge) => n + (answer(s, { of: 'edge', body: 'b', edge }) as number), 0);
    expect(total).toBeCloseTo(Math.PI * 50, 6);
    s.delete();
  });
  it('volume, surface and box are true', () => {
    const s = cylinder();
    const m = answer(s, { of: 'solid', body: 'b', place: noPlace }) as SolidMeasure;
    expect(m.volume).toBeCloseTo((Math.PI * 2500 * 10) / 4, 6);
    expect(m.area).toBeCloseTo(Math.PI * 50 * 10 + (2 * Math.PI * 2500) / 4, 6);
    expect(round(m.min)).toEqual([-25, -25, 0]);
    expect(round(m.max)).toEqual([25, 25, 10]);
    s.delete();
  });
  it('the box follows the place', () => {
    const s = cylinder();
    const m = answer(s, { of: 'solid', body: 'b', place: { angle: 90, axis: [1, 0, 0], offset: [100, 0, 0] } }) as SolidMeasure;
    expect(round(m.min)).toEqual([75, -10, -25]);
    expect(round(m.max)).toEqual([125, 0, 25]);
    expect(s.edges.length).toBeGreaterThan(0); // the kept solid is untouched
    s.delete();
  });
  it('a point near a round face lands on the real surface', () => {
    const s = cylinder();
    const side = s.faces.findIndex((f) => f.geomType === 'CYLINDRE');
    const p = answer(s, { of: 'point', body: 'b', face: side, near: [24.97, 1, 5] }) as number[];
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(25, 6);
    expect(p[2]).toBeCloseTo(5, 6);
    s.delete();
  });
  it('a point near a round edge lands on the real edge', () => {
    const s = cylinder();
    const rim = s.edges.findIndex((e) => e.geomType === 'CIRCLE' && Math.abs(e.startPoint.z) < 1e-9);
    const p = answer(s, { of: 'point', body: 'b', edge: rim, near: [24.97, 1, 0.01] }) as number[];
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(25, 6);
    expect(p[2]).toBeCloseTo(0, 6);
    s.delete();
  });
  it('a flat round face: its true size and area, turned any way', () => {
    const s = new Solid(drawRoundedRectangle(60, 40, 8).sketchOnPlane().extrude(20) as Shape3D);
    const top = s.faces.findIndex((f) => f.geomType === 'PLANE' && Math.abs(f.pointOnSurface(0.5, 0.5).z - 20) < 1e-9);
    expect(answer(s, { of: 'face', body: 'b', face: top })).toBeCloseTo(60 * 40 - (4 - Math.PI) * 64, 6);
    expect(round(answer(s, { of: 'sides', body: 'b', face: top, u: [1, 0, 0], n: [0, 0, 1] }) as number[]).slice(0, 2)).toEqual([60, 40]);
    expect(round(answer(s, { of: 'sides', body: 'b', face: top, u: [0, 1, 0], n: [0, 0, -1] }) as number[]).slice(0, 2)).toEqual([40, 60]);
    s.delete();
  });
  it('an edge asked of a part that is not there: null', () => {
    const s = cylinder();
    expect(answer(s, { of: 'edge', body: 'b', edge: 999 })).toBeNull();
    s.delete();
  });
});
