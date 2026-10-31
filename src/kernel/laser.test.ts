import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BuildFeature } from './build';
import { laserSvg } from './laser';

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
    expect(svg.match(/M/g)?.length).toBe(2); // the outline and the hole, each one closed path
  });
});
