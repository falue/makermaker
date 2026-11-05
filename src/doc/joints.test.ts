import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { attach, jointed, jointsWithout } from './joints';
import { sampleDoc } from './sample';
import type { Joint } from './types';

describe('jointed', () => {
  it('moves the children of a joint around its axis as their parent is placed, and reports two joints on one child', () => {
    const doc = sampleDoc();
    const [plate, disc, pin] = doc.bodies;
    const at = (x: number) => new Matrix4().makeTranslation(x, 0, 0);
    const local = new Map([[plate.id, at(100)], [disc.id, at(110)], [pin.id, at(30)]]);
    // a hinge on the plate along its local y through x = 10: the disc turns half way around it
    const hinge: Joint = { id: 'j', name: 'Lid', kind: 'hinge', parent: plate.id, children: [disc.id], axis: { at: [10, 0, 0], dir: [0, 1, 0] }, min: { e: '0', u: 'mm' }, max: { e: '180', u: 'mm' }, value: { e: '180', u: 'mm' }, speed: { e: '1', u: 'mm' } };
    const slide: Joint = { ...hinge, id: 's', name: 'Slide', kind: 'slider', children: [disc.id, pin.id], axis: { at: [0, 0, 0], dir: [1, 0, 0] } };
    const { placed, problems } = jointed({ ...doc, joints: [hinge, slide] }, local, (j) => (j.kind === 'hinge' ? 180 : 5));
    // the axis is at x = 110 in the world; the disc at 110 stays on it, turned around
    expect(new Vector3().setFromMatrixPosition(placed.get(disc.id)!).x).toBeCloseTo(110);
    expect(new Vector3(1, 0, 0).transformDirection(placed.get(disc.id)!).x).toBeCloseTo(-1);
    expect(new Vector3().setFromMatrixPosition(placed.get(pin.id)!).x).toBeCloseTo(35); // slid 5 along x
    expect(problems).toHaveLength(1);
  });
});

describe('attach', () => {
  it('does not move what it holds, wherever its value', () => {
    const doc = sampleDoc();
    const [plate, disc] = doc.bodies;
    const local = new Map([[plate.id, new Matrix4().makeTranslation(100, 0, 0)], [disc.id, new Matrix4().makeTranslation(110, 0, 0)]]);
    const j = attach(doc, 'a', plate.id, [disc.id], [0, 0, 0], true);
    const { placed } = jointed({ ...doc, joints: [j] }, local, () => 90);
    expect(new Vector3().setFromMatrixPosition(placed.get(disc.id)!).x).toBeCloseTo(110);
  });
  it('objects gone: they leave it; its parent or last part gone: it goes', () => {
    const j = attach(sampleDoc(), 'a', 'p', ['c', 'd'], [0, 0, 0], false);
    expect(jointsWithout([j], new Set(['c']))).toMatchObject([{ children: ['d'] }]);
    expect(jointsWithout([j], new Set(['c', 'd']))).toEqual([]);
    expect(jointsWithout([j], new Set(['p']))).toEqual([]);
  });
});
