import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { makeBox, setOC, type Shape3D } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { clashes, pairKey } from './clash';
import { Solid } from './measure';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));
beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const box = (w = 10) => new Solid(makeBox([-w / 2, -w / 2, 0], [w / 2, w / 2, w]) as Shape3D);
const place = (x = 0, y = 0, angle = 0) => ({ axis: [0, 0, 1] as [number, number, number], angle, offset: [x, y, 0] as [number, number, number] });
const noJoints = { motions: [], ignore: [] };
const along = (amount: number) => ({ kind: 'slider' as const, at: [0, 0, 0] as [number, number, number], dir: [1, 0, 0] as [number, number, number], amount });
const world = () => new Map([['a', box()], ['b', box()]]);

describe('clashes', () => {
  it('overlap: the shared part, whatever is asked about', () => {
    const r = clashes(world(), { bodies: [{ id: 'a', place: place() }, { id: 'b', place: place(5) }], of: ['a'], clearance: 0, ...noJoints });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].volume).toBeCloseTo(500, 3);
    expect(r.hits[0].vertices.length).toBeGreaterThan(0);
    expect(r.zones).toHaveLength(0);
  });
  it('touching is not an overlap', () => {
    expect(clashes(world(), { bodies: [{ id: 'a', place: place() }, { id: 'b', place: place(10) }], of: ['a', 'b'], clearance: 0, ...noJoints }).hits).toHaveLength(0);
  });
  it('clearance: a gap smaller than it counts, with the real distance; a bigger one does not', () => {
    const near = clashes(world(), { bodies: [{ id: 'a', place: place() }, { id: 'b', place: place(10.05) }], of: ['a'], clearance: 0.1, ...noJoints });
    expect(near.hits).toHaveLength(1);
    expect(near.hits[0].closest).toBeCloseTo(0.05, 6);
    expect(near.zones.map((z) => z.id)).toEqual(['a']);
    expect(clashes(world(), { bodies: [{ id: 'a', place: place() }, { id: 'b', place: place(10.2) }], of: ['a'], clearance: 0.1, ...noJoints }).hits).toHaveLength(0);
  });
  it('a pair ignored stays out; only what is asked about counts', () => {
    const bodies = [{ id: 'a', place: place() }, { id: 'b', place: place(5) }];
    expect(clashes(world(), { bodies, of: ['a'], clearance: 0, motions: [], ignore: [pairKey('a', 'b')] }).hits).toHaveLength(0);
    const three = new Map([['a', box()], ['b', box()], ['c', box()]]);
    const r = clashes(three, { bodies: [...bodies, { id: 'c', place: place(5, 5) }], of: ['c'], clearance: 0, motions: [], ignore: [] });
    expect(r.hits.map((h) => pairKey(h.a, h.b)).sort()).toEqual([pairKey('a', 'c'), pairKey('b', 'c')].sort());
  });
  it('a joint moving: found at the first position it hits, what moves together not against itself', () => {
    const steps = [0, 10, 20, 30].map((value) => ({ value, places: { a: place(value) } }));
    const r = clashes(world(), { bodies: [{ id: 'a', place: place() }, { id: 'b', place: place(25) }], of: ['a'], clearance: 0, motions: [{ joint: 'j', sweep: along(30), steps }], ignore: [] });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ joint: 'j', value: 20 });
    expect(r.hits[0].indices.length).toBeGreaterThan(0);
    expect(r.sweeps.map((z) => z.id)).toEqual(['a']);
  });
  it('a clearance also applies through the motion', () => {
    const steps = [0, 14.95].map((value) => ({ value, places: { a: place(value) } }));
    const r = clashes(world(), { bodies: [{ id: 'a', place: place() }, { id: 'b', place: place(25) }], of: ['a'], clearance: 0.1, motions: [{ joint: 'j', sweep: along(14.95), steps }], ignore: [] });
    expect(r.hits[0]).toMatchObject({ joint: 'j', value: 14.95 });
    expect(r.hits[0].closest).toBeCloseTo(0.05, 6);
  });
  it('a thin part between two steps is still found: the whole way counts', () => {
    const thin = new Map([['a', box()], ['t', new Solid(makeBox([-0.1, -5, 0], [0.1, 5, 10]) as Shape3D)]]);
    const steps = [0, 30].map((value) => ({ value, places: { a: place(value) } }));
    const r = clashes(thin, { bodies: [{ id: 'a', place: place() }, { id: 't', place: place(15) }], of: ['a'], clearance: 0, motions: [{ joint: 'j', sweep: along(30), steps }], ignore: [] });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].joint).toBe('j');
    expect(r.hits[0].indices.length).toBeGreaterThan(0);
  });
  it('a hinge: what the arm passes on its way, in place', () => {
    const arm = new Solid(makeBox([20, -3, 0], [60, 3, 6]) as Shape3D);
    const post = new Solid(makeBox([-3, -3, 0], [3, 3, 30]) as Shape3D);
    const steps = [0, 45, 90].map((value) => ({ value, places: { a: place(0, 0, value) } }));
    const sweep = { kind: 'hinge' as const, at: [0, 0, 0] as [number, number, number], dir: [0, 0, 1] as [number, number, number], amount: 90 };
    const r = clashes(new Map([['a', arm], ['p', post]]), { bodies: [{ id: 'a', place: place() }, { id: 'p', place: place(40 * Math.cos(0.7), 40 * Math.sin(0.7)) }], of: ['a'], clearance: 0, motions: [{ joint: 'j', sweep, steps }], ignore: [] });
    expect(r.hits).toHaveLength(1);
    const zs = r.hits[0].vertices.filter((_, k) => k % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(6, 3); // as high as the arm, up the post
  });
});
