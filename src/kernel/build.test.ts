import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBody, FeatureError, type BuildFeature } from './build';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));

beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const ground = { kind: 'base', axis: 'xy', offset: 0 } as const;
const base = (w: number, depth = 4): BuildFeature => ({
  id: 'base',
  type: 'extrude',
  plane: ground,
  profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w, h: 60, r: 0, rot: 0 }],
  depth,
  mode: 'add',
  through: false,
});
const hole: BuildFeature = {
  id: 'h1',
  type: 'extrude',
  plane: ground,
  profiles: [{ id: 'c', kind: 'circle', x: 20, y: 10, d: 5 }],
  depth: 0,
  mode: 'cut',
  through: true,
};
const plate = (w: number, ...more: BuildFeature[]): BuildFeature[] => [base(w), hole, ...more];
const corners: BuildFeature = { id: 'f1', type: 'finish', mode: 'fillet', size: 6, edges: 'vertical', enabled: true };

const built = (features: BuildFeature[]) => {
  const shape = buildBody(features);
  const info = { faces: shape.faces.length, box: shape.boundingBox };
  return { ...info, done: () => shape.delete() };
};

describe('buildBody', () => {
  it('keeps a rule-based fillet on the corners when the base width changes', () => {
    for (const w of [100, 140]) {
      const raw = built(plate(w));
      const filleted = built(plate(w, corners));
      // 4 corner fillets add 4 cylindrical faces; the hole seam is not touched
      expect(filleted.faces).toBe(raw.faces + 4);
      expect(filleted.box.width).toBeCloseTo(w, 3);
      raw.done();
      filleted.done();
    }
  });

  it('lists each body corner once', async () => {
    const { meshBody } = await import('./build');
    const shape = buildBody([base(100)]);
    expect(meshBody(shape).corners.length).toBe(8 * 3);
    shape.delete();
  });

  it('skips disabled finishes', () => {
    const raw = built(plate(100));
    const off = built(plate(100, { ...corners, enabled: false }));
    expect(off.faces).toBe(raw.faces);
    raw.done();
    off.done();
  });

  it('adds a boss on the top face that follows the base depth', () => {
    const boss: BuildFeature = {
      id: 'boss',
      type: 'extrude',
      plane: { kind: 'cap', feature: 'base' },
      profiles: [{ id: 'b', kind: 'circle', x: 0, y: 0, d: 20 }],
      depth: 10,
      mode: 'add',
      through: false,
    };
    for (const depth of [4, 8]) {
      const b = built([base(100, depth), boss]);
      expect(b.box.depth).toBeCloseTo(depth + 10, 3);
      b.done();
    }
  });

  it('cuts a blind pocket into the top face', () => {
    const pocket: BuildFeature = {
      id: 'pocket',
      type: 'extrude',
      plane: { kind: 'cap', feature: 'base' },
      profiles: [{ id: 'p', kind: 'polygon', pts: [[-10, -10], [10, -10], [0, 10]], r: 0, rot: 0 }],
      depth: -2,
      mode: 'cut',
      through: false,
    };
    const raw = built([base(100)]);
    const cut = built([base(100), pocket]);
    expect(cut.faces).toBe(raw.faces + 4); // 3 walls and the floor
    expect(cut.box.depth).toBeCloseTo(4, 3);
    raw.done();
    cut.done();
  });

  it('makes shapes inside other shapes holes (even-odd)', () => {
    const plateWithHole: BuildFeature = {
      ...(base(100) as Extract<BuildFeature, { type: 'extrude' }>),
      profiles: [
        { id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 60, r: 0, rot: 0 },
        { id: 'c', kind: 'circle', x: 0, y: 0, d: 20 },
      ],
    };
    const raw = built([base(100)]);
    const holed = built([plateWithHole]);
    expect(holed.faces).toBeGreaterThan(raw.faces); // the hole wall (the 2D cut may split it in two)
    raw.done();
    holed.done();
  });

  it('splits overlapping shapes into areas and extrudes only the picked ones', async () => {
    const { areasOf } = await import('./build');
    const rect = { id: 'r', kind: 'rect' as const, x: 0, y: 0, w: 20, h: 10, r: 0, rot: 0 };
    const disc = { id: 'c', kind: 'circle' as const, x: 10, y: 0, d: 8 };
    const areas = areasOf([rect, disc]);
    expect(areas.map((a) => `${a.in.join('+')}|${a.out.join('+')}`).sort()).toEqual(['c|r', 'r+c|', 'r|c']);
    const lens = areas.find((a) => a.in.length === 2)!;
    const feature: BuildFeature = { id: 'x', type: 'extrude', plane: ground, profiles: [rect, disc], areas: [{ in: lens.in, out: lens.out }], depth: 3, mode: 'add', through: false };
    const b = built([feature]);
    expect(b.box.width).toBeCloseTo(4, 3); // the lens: from x 6 to 10
    expect(b.box.height).toBeCloseTo(8, 3);
    b.done();
  });

  it('reports a sketch plane whose feature is gone', () => {
    const orphan: BuildFeature = { ...hole, id: 'o', plane: { kind: 'cap', feature: 'gone' } };
    expect(() => buildBody([base(100), orphan])).toThrow(/sketch plane lost/);
  });

  it('reports the failing feature instead of guessing', () => {
    try {
      buildBody(plate(100, { ...corners, size: 40 }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FeatureError);
      expect((err as FeatureError).featureId).toBe('f1');
    }
  });
});
