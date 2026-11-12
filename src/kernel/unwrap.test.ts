import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { makeBox, makeCylinder, makeSphere, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBody, type BuildFeature } from './build';
import { loopArea } from './flatten';
import { unwrap } from './unwrap';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));
beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

/** Everything a body unwraps into: how many nets, their area (outlines less holes), folds, and its worst stretch. */
function unwrapped(shape: Shape3D) {
  const { pieces, stretch } = unwrap(shape);
  shape.delete();
  const cuts = pieces.flatMap((p) => p.cuts);
  const area = cuts.filter((c) => !c.mark && !c.open).reduce((n, c) => n + (c.hole ? -1 : 1) * Math.abs(loopArea(c.pts)), 0);
  return { nets: pieces.length, area, folds: cuts.filter((c) => c.mark).length, open: cuts.filter((c) => c.open && !c.mark).length, stretch };
}

describe('unwrap', () => {
  it('unwraps a box into one net of its six faces, five folds, its true area', () => {
    const u = unwrapped(makeBox([0, 0, 0], [40, 30, 20]));
    expect(u).toMatchObject({ nets: 1, folds: 5, open: 0, stretch: 0 });
    expect(u.area).toBeCloseTo(2 * (40 * 30 + 40 * 20 + 30 * 20), 3);
  });
  it('rolls a cylinder out: its side and both ends at their true area, no stretch', () => {
    // its ends cannot hinge on its side (round there, straight here): three pieces
    const u = unwrapped(makeCylinder(10, 30));
    expect(u).toMatchObject({ nets: 3, folds: 0, open: 0, stretch: 0 });
    // meshed to 0.05 mm: the chords lose a little of the round
    expect(u.area).toBeCloseTo(2 * Math.PI * 10 * 30 + 2 * Math.PI * 100, -1);
  });
  it('rolls a cone (a revolved slant) out round its apex at its true area', () => {
    const profile = { id: 'q', kind: 'polygon', pts: [[0, 0], [15, 0], [5, 20], [0, 20]], r: 0, rot: 0 };
    const cone = buildBody([{ id: 'r', type: 'revolve', plane: { kind: 'base', axis: 'xy', offset: 0 }, profiles: [profile], axis: { at: [0, 0], dir: [0, 1] }, angle: 360, mode: 'add' } as unknown as BuildFeature]);
    const u = unwrapped(cone);
    expect(u).toMatchObject({ nets: 3, open: 0, stretch: 0 });
    const slant = Math.hypot(10, 20);
    expect(u.area).toBeCloseTo(Math.PI * (15 + 5) * slant + Math.PI * (225 + 25), -1);
  });
  it('flattens a sphere with stretch, at its true area', () => {
    const u = unwrapped(makeSphere(15));
    expect(u).toMatchObject({ nets: 1, open: 0 });
    expect(u.stretch).toBeGreaterThan(0.05);
    // the mesh's flat triangles lose a little of the round
    expect(Math.abs(u.area / (4 * Math.PI * 225) - 1)).toBeLessThan(0.01);
  });
});
