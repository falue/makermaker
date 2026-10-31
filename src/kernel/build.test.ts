import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPart, StepError, type BuildStep } from './build';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));

beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const ground = { kind: 'base', axis: 'xy', offset: 0 } as const;
const base = (w: number, depth = 4): BuildStep => ({
  id: 'base',
  type: 'extrude',
  plane: ground,
  profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w, h: 60, r: 0 }],
  depth,
  mode: 'add',
  through: false,
});
const hole: BuildStep = {
  id: 'h1',
  type: 'extrude',
  plane: ground,
  profiles: [{ id: 'c', kind: 'circle', x: 20, y: 10, d: 5 }],
  depth: 0,
  mode: 'cut',
  through: true,
};
const plate = (w: number, ...more: BuildStep[]): BuildStep[] => [base(w), hole, ...more];
const corners: BuildStep = { id: 'f1', type: 'finish', mode: 'fillet', size: 6, edges: 'vertical', enabled: true };

const built = (steps: BuildStep[]) => {
  const shape = buildPart(steps);
  const info = { faces: shape.faces.length, box: shape.boundingBox };
  return { ...info, done: () => shape.delete() };
};

describe('buildPart', () => {
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

  it('skips disabled finishes', () => {
    const raw = built(plate(100));
    const off = built(plate(100, { ...corners, enabled: false }));
    expect(off.faces).toBe(raw.faces);
    raw.done();
    off.done();
  });

  it('adds a boss on the top face that follows the base depth', () => {
    const boss: BuildStep = {
      id: 'boss',
      type: 'extrude',
      plane: { kind: 'cap', step: 'base' },
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
    const pocket: BuildStep = {
      id: 'pocket',
      type: 'extrude',
      plane: { kind: 'cap', step: 'base' },
      profiles: [{ id: 'p', kind: 'polygon', pts: [[-10, -10], [10, -10], [0, 10]], r: 0 }],
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

  it('reports a sketch plane whose step is gone', () => {
    const orphan: BuildStep = { ...hole, id: 'o', plane: { kind: 'cap', step: 'gone' } };
    expect(() => buildPart([base(100), orphan])).toThrow(/sketch plane lost/);
  });

  it('reports the failing step instead of guessing', () => {
    try {
      buildPart(plate(100, { ...corners, size: 40 }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(StepError);
      expect((err as StepError).stepId).toBe('f1');
    }
  });
});
