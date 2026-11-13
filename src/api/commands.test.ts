import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc/types';
import { COMMANDS, describe as tools, fingersFor, runCommand, shared } from './commands';

const empty = (): Doc => ({ schema: 32, units: 'mm', params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], planes: [], images: [], materials: [], photos: [], renders: [] });

/** Runs commands one after another, each on the last one's document; their results. */
function script(steps: [string, Record<string, unknown> | ((r: unknown[]) => Record<string, unknown>)][]) {
  let doc = empty();
  const results: unknown[] = [];
  for (const [name, args] of steps) {
    const out = runCommand(doc, name, typeof args === 'function' ? args(results) : args);
    doc = out.doc;
    results.push(out.result);
  }
  return { doc, results };
}

describe('commands', () => {
  it('draws a 3D line from points with z, straight only', () => {
    const { doc } = script([
      ['sketch', { plane: 'xy' }],
      ['line', (r) => ({ sketch: r[0], points: [[0, 0], [10, 0, 5], [10, 10, 5]] })],
      ['line', (r) => ({ sketch: r[0], points: [[0, 0], [10, 0]] })],
    ]);
    const [lifted, flat] = doc.sketches[0].shapes;
    expect(lifted.kind === 'line' && lifted.z).toEqual([0, 5, 5]);
    expect(flat.kind === 'line' && flat.z).toBeUndefined();
    expect(() => runCommand(doc, 'line', { sketch: doc.sketches[0].id, points: [[0, 0], [10, 0, 5]], curves: [{ mid: [5, 2] }] })).toThrow('straight sides only');
  });

  it('makes a plate from a sketch, a box cut out of it, a hole and a fillet', () => {
    const { doc, results } = script([
      ['parameter', { name: 'ply', value: '4mm' }],
      ['sketch', { plane: 'xy' }],
      ['rectangle', (r) => ({ sketch: r[1], x: 0, y: 0, width: 100, height: 60 })],
      ['extrude', (r) => ({ sketch: r[1], depth: '$ply', name: 'Plate' })],
      ['box', { length: 20, width: 20, height: 10, at: [30, 0, 0] }],
      ['boolean', (r) => ({ op: 'subtract', target: r[3], tools: [r[4]] })],
      ['hole', (r) => ({ id: r[3], x: -20, y: 0, diameter: 5 })],
      ['fillet', (r) => ({ id: r[3], size: 3, edges: 'vertical' })],
      ['move', (r) => ({ ids: [r[3]], by: [10, 0, 0] })],
    ]);
    const plate = doc.bodies.find((b) => b.id === results[3])!;
    expect(plate.name).toBe('Plate');
    expect(plate.features.map((f) => f.type)).toEqual(['extrude', 'boolean', 'extrude', 'finish']);
    expect(plate.position[0].e).toBe('10');
    expect(doc.bodies.find((b) => b.id === results[4])!.visible).toBe(true); // a cutter stays shown (as red outlines)
    expect(doc.params.$ply.e).toBe('4mm');
    const listed = runCommand(doc, 'list').result as { bodies: { name: string }[] };
    expect(listed.bodies.map((b) => b.name)).toEqual(['Plate', 'Body 2']);
  });

  it('says what is wrong with bad input', () => {
    expect(() => runCommand(empty(), 'cube')).toThrow(/no command "cube"/);
    expect(() => runCommand(empty(), 'box', { length: 10, width: 10 })).toThrow(/"height" is needed/);
    expect(() => runCommand(empty(), 'sketch', { plane: 'xz2' })).toThrow(/one of xy, xz, yz/);
    expect(() => runCommand(empty(), 'fillet', { id: 'nope', size: 2, edges: 'all' })).toThrow(/no body "nope"/);
  });

  it('describes every command for scripts and LLM tools', () => {
    const list = tools();
    expect(list.length).toBe(Object.keys(COMMANDS).length);
    for (const t of list) expect(t.doc.length).toBeGreaterThan(10);
  });
});

describe('shared', () => {
  it('reuses what did not change, also in a copy', () => {
    const old = { a: { b: [1, 2] }, c: { d: 'x' } };
    const next = structuredClone(old);
    expect(shared(old, next)).toBe(old);
    next.c.d = 'y';
    const out = shared(old, next);
    expect(out).not.toBe(old);
    expect(out.a).toBe(old.a);
    expect(out).toEqual(next);
  });
  it('notices removed keys and shorter arrays', () => {
    const old: { a?: number; l: number[] } = { a: 1, l: [1, 2] };
    expect(shared(old, { l: [1, 2] })).toEqual({ l: [1, 2] });
    expect(shared(old, { a: 1, l: [1] })).toEqual({ a: 1, l: [1] });
  });
});

describe('move', () => {
  it('moves a group with what it holds, also a group inside it', () => {
    const body = (id: string, group: string | null) => ({ id, group, position: [{ e: '1', u: 'mm' }, { e: '0', u: 'mm' }, { e: '0', u: 'mm' }] });
    const doc = { ...empty(), bodies: [body('a', 'g'), body('b', 'h'), body('c', null)], groups: [{ id: 'g', parent: null, origin: { kind: 'parent' } }, { id: 'h', parent: 'g', origin: { kind: 'parent' } }] } as unknown as Doc;
    const next = runCommand(doc, 'move', { ids: ['g'], by: [5, 0, 0] }).doc;
    expect(next.bodies.map((b) => b.position[0].e)).toEqual(['6', '6', '1']);
  });
  it('writes the distance (mm) in each value\'s own unit', () => {
    const doc = { ...empty(), bodies: [{ id: 'a', group: null, position: [{ e: '1', u: 'in' }, { e: '2', u: 'cm' }, { e: '$h', u: 'mm' }] }] } as unknown as Doc;
    const next = runCommand(doc, 'move', { ids: ['a'], by: [25.4, 10, 5] }).doc;
    expect(next.bodies[0].position.map((p) => p.e)).toEqual(['2', '3', '($h)+5']);
  });
});

describe('finger joint fingers', () => {
  it('each about five thicknesses long, rounded up to an odd number, 3 at least', () => {
    expect(fingersFor(80, 5)).toBe(5); // 3.2: up to 5, 16 mm each
    expect(fingersFor(125, 5)).toBe(5); // exactly 5
    expect(fingersFor(150, 5)).toBe(7); // 6: the odd one above
    expect(fingersFor(300, 3)).toBe(21);
    expect(fingersFor(10, 5)).toBe(3);
  });
});

describe('coat', () => {
  const made = runCommand({ schema: 32, units: 'mm', params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], planes: [], images: [], materials: [], photos: [], renders: [] }, 'box', { length: 10, width: 10, height: 10 });
  it('as a new body: its own steps and the skin, the body itself as it was', () => {
    const out = runCommand(made.doc, 'coat', { id: made.result, thickness: 1, newBody: true });
    const [a, b] = out.doc.bodies;
    expect({ ...a, order: undefined }).toEqual({ ...made.doc.bodies[0], order: undefined });
    expect([a.order, b.order]).toEqual([0, 1]); // listed right after it
    expect(b).toMatchObject({ id: out.result, link: null });
    expect(b.features.map((f) => f.type)).toEqual([...a.features.map((f) => f.type), 'coat']);
    expect(b.features[0].id).not.toBe(a.features[0].id);
    expect(b.features.at(-1)).toMatchObject({ skin: true });
  });
  it('linked: only the skin, the steps shared, attached; not linked: none', () => {
    const out = runCommand(made.doc, 'coat', { id: made.result, thickness: 1, newBody: true, linked: true });
    expect(out.doc.bodies[1]).toMatchObject({ link: made.result, features: [{ type: 'coat', skin: true }] });
    expect(out.doc.joints).toMatchObject([{ kind: 'attach', parent: made.result, children: [out.result], name: 'Entanglement 1' }]);
    expect(runCommand(made.doc, 'coat', { id: made.result, thickness: 1, newBody: true }).doc.joints).toEqual([]);
  });
  it('deleting either takes the attach along', () => {
    const out = runCommand(made.doc, 'coat', { id: made.result, thickness: 1, newBody: true, linked: true });
    expect(runCommand(out.doc, 'delete', { ids: [out.result] }).doc.joints).toEqual([]);
    expect(runCommand(out.doc, 'delete', { ids: [made.result] }).doc.joints).toEqual([]);
  });
});

describe('attach', () => {
  it('attaches objects to one and detaches them; refuses what is not there', () => {
    let doc = runCommand({ schema: 32, units: 'mm', params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], planes: [], images: [], materials: [], photos: [], renders: [] }, 'box', { length: 10, width: 10, height: 10 }).doc;
    doc = runCommand(doc, 'box', { length: 5, width: 5, height: 5 }).doc;
    const [a, b] = doc.bodies.map((x) => x.id);
    const made = runCommand(doc, 'attach', { id: a, ids: [b], at: [0, 0, 10] });
    expect(made.doc.joints).toMatchObject([{ id: made.result, kind: 'attach', parent: a, children: [b], axis: { at: [0, 0, 10] } }]);
    expect(runCommand(made.doc, 'detach', { id: made.result }).doc.joints).toEqual([]);
    expect(() => runCommand(doc, 'attach', { id: a, ids: ['nope'] })).toThrow();
    expect(() => runCommand(doc, 'attach', { id: a, ids: [a] })).toThrow();
  });
});
