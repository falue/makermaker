import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { getOC, setOC, measureVolume, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBody, type BuildFeature } from './build';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));

beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const ground = { kind: 'base', axis: 'xy', offset: 0 } as const;
const f = (o: object) => o as unknown as BuildFeature;
const box = (w = 40, depth = 20) => f({ id: 'b', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w, h: w, r: 0, rot: 0 }], depth, mode: 'add', through: false });
const sheet = f({ id: 's', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'rect', x: 18, y: 0, w: 4, h: 40, r: 0, rot: 0 }], depth: 30, mode: 'add', through: false });
const fingers = f({ id: 'j', type: 'fingers', features: [sheet], place: { offset: [0, 0, 0], axis: [0, 0, 1], angle: 0 }, count: 5, width: 0, first: true });
const bulge = f({ id: 'u', type: 'bulge', on: { kind: 'face', at: [0, 0, 20], mid: [0, 0, 20] }, fullness: 1, peak: [0, 0, 8] });
const shell = f({ id: 'h', type: 'shell', thickness: 2, open: [[0, 0, 0]] });
const draft = f({ id: 'd', type: 'draft', at: [20, 0, 10], n: [1, 0, 0], axis: { at: [20, -20, 0], dir: [0, 1, 0] }, angle: 8 });
const at = (z: number) => ({ o: [0, 0, z], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] });

/** Bodies made every way there is, alone and combined (the build step input of each). */
const zoo: Record<string, BuildFeature[]> = {
  box: [box()],
  filleted: [box(), f({ id: 'f', type: 'finish', mode: 'fillet', size: 4, edges: 'vertical', enabled: true, baked: false, skip: [] })],
  chamfered: [box(), f({ id: 'f', type: 'finish', mode: 'chamfer', size: 3, edges: 'top', enabled: true, baked: false, skip: [] })],
  shelled: [box(), f({ id: 'h', type: 'shell', thickness: 2, open: [[0, 0, 20]] })],
  bulged: [box(), bulge],
  drafted: [box(), draft],
  jointed: [box(), fingers],
  // shelled, box jointed and bulged at once
  monster: [box(), bulge, fingers, shell],
  revolved: [f({ id: 'r', type: 'revolve', plane: ground, profiles: [{ id: 'q', kind: 'rect', x: 12, y: 0, w: 10, h: 30, r: 0, rot: 0 }], axis: { at: [0, 0], dir: [0, 1] }, angle: 360, mode: 'add' })],
  // revolved, then drafted on a flat face of it is not possible: a revolve with a flat end drafted instead
  swept: [f({ id: 'w', type: 'sweep', profile: { id: 'c', kind: 'circle', x: 0, y: 0, d: 8 }, path: { frame: ground, profile: { id: 'l', kind: 'line', pts: [[-20, 0], [10, 0], [10, 25]] } } })],
  lofted: [f({ id: 'l', type: 'loft', sections: [{ frame: at(0), profile: { id: 'a', kind: 'rect', x: 0, y: 0, w: 30, h: 30, r: 0, rot: 0 } }, { frame: at(25), profile: { id: 'b', kind: 'circle', x: 0, y: 0, d: 14 } }], ruled: false })],
  threaded: [f({ id: 'c', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 25, mode: 'add', through: false }), f({ id: 't', type: 'thread', at: [0, 0, 0], dir: [0, 0, 1], r: 5, inside: false, size: 'M10', d: 10, pitch: 1.5, length: 25, modeled: true })],
  ball: [f({ id: 'o', type: 'sphere', x: 0, y: 0, z: 10, d: 30 })],
  split: [box(), f({ id: 'p', type: 'split', cutter: { kind: 'plane', o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0], turn: 30, axis: null, offset: 5 }, side: 1 })],
  mirrored: [box(), f({ id: 'm', type: 'mirror', o: [25, 0, 0], n: [1, 0, 0] })],
};

/** Whether OpenCascade finds the solid sound (its geometry checked too). */
function valid(s: Shape3D) {
  const oc = getOC();
  const check = new oc.BRepCheck_Analyzer(s.wrapped, true, false, false);
  try {
    return check.IsValid();
  } finally {
    check.delete();
  }
}

describe('booleans', () => {
  it('builds every kind of body soundly', () => {
    for (const [name, features] of Object.entries(zoo)) {
      const shape = buildBody(features);
      expect(valid(shape), `${name} is not a sound solid`).toBe(true);
      shape.delete();
    }
  }, 300_000);

  // a row per body, each on a fresh OpenCascade (hundreds of cuts in one would run out of memory)
  for (const a of Object.keys(zoo))
    it(`cuts ${a} with every other body, overlapping, into a sound solid`, async () => {
      setOC(await init({ wasmBinary: wasm }));
      const whole = buildBody(zoo[a]);
      const volume = measureVolume(whole);
      whole.delete();
      const failed: string[] = [];
      for (const b of Object.keys(zoo)) {
        if (a === b) continue;
        // the cutter moved off a little, so the two overlap partly; the body's finishes as they were, cut through (baked)
        const body = zoo[a].map((x) => (x.type === 'finish' ? { ...x, baked: true } : x));
        try {
          const cut = buildBody([...body, f({ id: 'x', type: 'boolean', op: 'subtract', features: zoo[b], place: { offset: [9, 7, 6], axis: [0, 0, 1], angle: 20 } })]);
          const v = measureVolume(cut);
          if (!valid(cut) || !(v > 0) || v > volume + 1e-3) failed.push(`${a} − ${b}: ${valid(cut) ? '' : 'unsound, '}${v.toFixed(1)} of ${volume.toFixed(1)}`);
          cut.delete();
        } catch (e) {
          failed.push(`${a} − ${b}: ${(e as Error).message}`);
        }
      }
      expect(failed).toEqual([]);
    }, 300_000);
});
