import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BuildFeature } from './build';
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
