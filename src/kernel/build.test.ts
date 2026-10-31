import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPart, StepError, type BuildStep } from './build';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));

beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const plate = (w: number, finishes: BuildStep[] = []): BuildStep[] => [
  { id: 'base', type: 'extrude', profile: { kind: 'rect', w, h: 60, r: 0 }, depth: 4 },
  { id: 'h1', type: 'hole', x: 20, y: 10, d: 5 },
  ...finishes,
];
const corners: BuildStep = { id: 'f1', type: 'finish', mode: 'fillet', size: 6, edges: 'vertical', enabled: true };

describe('buildPart', () => {
  it('keeps a rule-based fillet on the corners when the base width changes', () => {
    for (const w of [100, 140]) {
      const raw = buildPart(plate(w));
      const filleted = buildPart(plate(w, [corners]));
      // 4 corner fillets add 4 cylindrical faces; the hole seam is not touched
      expect(filleted.faces.length).toBe(raw.faces.length + 4);
      expect(filleted.boundingBox.width).toBeCloseTo(w, 3);
      raw.delete();
      filleted.delete();
    }
  });

  it('skips disabled finishes', () => {
    const raw = buildPart(plate(100));
    const off = buildPart(plate(100, [{ ...corners, enabled: false }]));
    expect(off.faces.length).toBe(raw.faces.length);
    raw.delete();
    off.delete();
  });

  it('reports the failing step instead of guessing', () => {
    const tooBig: BuildStep = { ...corners, size: 40 };
    expect(() => buildPart(plate(100, [tooBig]))).toThrow(StepError);
    try {
      buildPart(plate(100, [tooBig]));
    } catch (err) {
      expect((err as StepError).stepId).toBe('f1');
    }
  });

  it('rejects invalid base dimensions on the base step', () => {
    const bad: BuildStep[] = [{ id: 'base', type: 'extrude', profile: { kind: 'circle', d: -1 }, depth: 4 }];
    expect(() => buildPart(bad)).toThrow(/diameter/);
  });
});
