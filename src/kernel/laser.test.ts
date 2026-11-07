import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BuildFeature } from './build';
import { area, bounds } from '../doc/profiles';
import { dxfOf, laserCuts, laserSvg, withKerf } from './laser';

beforeAll(async () => setOC(await init({ wasmBinary: readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm')) })), 60_000);

const ground = { kind: 'base', axis: 'xy', offset: 0 } as const;

describe('laserSvg', () => {
  it('draws the biggest flat face with its holes at 1:1, without finishes', () => {
    const plate: BuildFeature[] = [
      { id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 60, r: 0, rot: 0 }, { id: 'c', kind: 'circle', x: 20, y: 10, d: 10 }], depth: 4, mode: 'add', through: false },
      { id: 'f', type: 'finish', mode: 'chamfer', size: 1, edges: 'top', enabled: true, baked: false, skip: [] },
    ];
    const svg = laserSvg(plate);
    expect(svg).toContain('width="104mm" height="64mm"'); // 2 mm margin around 100 x 60
    expect(svg.match(/M/g)?.length).toBe(1); // the outline, one closed path
    expect(svg).toMatch(/<circle cx="[-\d.]+" cy="[-\d.]+" r="5"\/>/); // the hole kept a circle
  });

  it('takes a picked face, allows for the kerf and writes DXF', () => {
    const block: BuildFeature[] = [{ id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 60, r: 0, rot: 0 }, { id: 'c', kind: 'circle', x: 20, y: 10, d: 10 }], depth: 30, mode: 'add', through: false }];
    // its x 50 side: 60 × 30, no hole
    const side = laserCuts(block, { at: [50, 0, 15], n: [1, 0, 0] });
    expect(side.length).toBe(1);
    const xs = side[0].pts.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 3);
    // kerf 0.2: the outline 0.1 out each side, the hole 0.1 smaller in radius
    const cut = withKerf(laserCuts(block), 0.2);
    const ox = cut[0].pts.map((p) => p[0]);
    expect(Math.max(...ox) - Math.min(...ox)).toBeCloseTo(100.2, 3);
    expect(cut[1].circle!.r).toBeCloseTo(4.9, 3);
    const dxf = dxfOf(cut);
    expect(dxf).toContain('CIRCLE');
    expect(dxf.match(/VERTEX/g)?.length).toBe(4);
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});

describe('curved outlines', () => {
  const plate: BuildFeature[] = [{ id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'polygon', pts: [[-20, 0], [20, 0]], curves: [null, { mid: [0, 20] }], r: 0, rot: 0 }], depth: 3, mode: 'add', through: false }];

  it('an arc stays an arc: in SVG an A, in DXF a bulge', () => {
    const [cut] = laserCuts(plate);
    expect(cut.pts).toHaveLength(2);
    expect(area({ kind: 'polygon', pts: cut.pts, curves: cut.curves, r: 0, rot: 0 })).toBeCloseTo(200 * Math.PI, 6);
    expect(laserSvg(plate)).toMatch(/A20 20 0 0 [01] /);
    expect(dxfOf([cut])).toMatch(/\n42\n-?1\n/); // a half circle: bulge ±1
    // the kerf on the true arc: 0.1 out, still a half disc
    const [k] = withKerf([cut], 0.2);
    expect(bounds({ kind: 'polygon', pts: k.pts, curves: k.curves, r: 0, rot: 0 })[2]).toBeCloseTo(20.1, 6);
  });

  it('rounded corners of a finished plate show; its chamfered top edges do not shrink it', () => {
    const rounded: BuildFeature[] = [
      { id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 60, r: 0, rot: 0 }], depth: 4, mode: 'add', through: false },
      { id: 'f', type: 'finish', mode: 'fillet', size: 5, edges: 'vertical', enabled: true, baked: false, skip: [] },
      { id: 'g', type: 'finish', mode: 'chamfer', size: 1, edges: 'top', enabled: true, baked: false, skip: [] },
    ];
    const [cut] = laserCuts(rounded);
    expect(area({ kind: 'polygon', pts: cut.pts, curves: cut.curves, r: 0, rot: 0 })).toBeCloseTo(6000 - (4 - Math.PI) * 25, 3);
  });
});

describe('loops', () => {
  it('chains edges OpenCascade lists out of order: an upright board with a slot and a hole', () => {
    const ext = (id: string, x: number, w: number, h: number, depth: number, z: number) => ({ id, type: 'extrude', plane: { ...ground, offset: z }, profiles: [{ id: `${id}p`, kind: 'rect', x, y: 0, w, h, r: 0, rot: 0 }], depth, mode: 'add', through: false }) as BuildFeature;
    const cut = (id: string, z: number, depth: number) => ({ id, type: 'boolean', op: 'subtract', features: [ext(`${id}b`, -10, 4, 10, depth, z)], place: { offset: [0, 0, 0], axis: [0, 0, 1], angle: 0 } }) as unknown as BuildFeature;
    // 60 × 40 standing, a slot 4 × 19 up from the bottom, a hole 4 × 10 above it
    const [outline, hole] = laserCuts([ext('a', 0, 60, 4, 40, 0), cut('s', -1, 20), cut('h', 26, 10)]);
    const area = (pts: [number, number][]) => Math.abs(pts.reduce((t, [x, y], i) => t + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)) / 2;
    expect(area(outline.pts)).toBeCloseTo(60 * 40 - 4 * 19, 3);
    expect(area(hole.pts)).toBeCloseTo(4 * 10, 3);
  });
});

describe('free-form edges as arcs', () => {
  it('a bezier side cut as arcs within 1 µm: the area right, the DXF all bulges', () => {
    const plate: BuildFeature[] = [{ id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'polygon', pts: [[0, 0], [40, 0]], curves: [null, { c1: [40, 30], c2: [0, 10] }], r: 0, rot: 0 }], depth: 3, mode: 'add', through: false }];
    const [cut] = laserCuts(plate);
    expect(cut.curves.filter(Boolean).length).toBeGreaterThan(2);
    const exact = area({ kind: 'polygon', pts: [[0, 0], [40, 0]], curves: [null, { c1: [40, 30], c2: [0, 10] }], r: 0, rot: 0 });
    expect(area({ kind: 'polygon', pts: cut.pts, curves: cut.curves, r: 0, rot: 0 })).toBeCloseTo(exact, 2);
    const dxf = dxfOf([cut]);
    expect(dxf.match(/VERTEX/g)!.length).toBe(cut.pts.length);
    // a bezier written straight into the DXF also turns into arcs
    const written = dxfOf([{ hole: false, pts: [[0, 0], [40, 0]], curves: [null, { c1: [40, -30], c2: [0, -10] }] }]);
    expect(written.match(/\n42\n/g)!.length).toBeGreaterThan(2);
  });
});

