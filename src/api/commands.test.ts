import { describe, expect, it } from 'vitest';
import type { Doc } from '../doc/types';
import { COMMANDS, describe as tools, runCommand } from './commands';

const empty = (): Doc => ({ schema: 26, units: 'mm', params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], planes: [], images: [], renders: [] });

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
  it('makes a plate from a sketch, a box cut out of it, a hole and a fillet', () => {
    const { doc, results } = script([
      ['parameter', { name: 'ply', value: '4mm' }],
      ['sketch', { plane: 'xy' }],
      ['rectangle', (r) => ({ sketch: r[1], x: 0, y: 0, width: 100, height: 60 })],
      ['extrude', (r) => ({ sketch: r[1], depth: 'ply', name: 'Plate' })],
      ['box', { width: 20, depth: 20, height: 10, at: [30, 0, 0] }],
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
    expect(doc.params.ply.e).toBe('4mm');
    const listed = runCommand(doc, 'list').result as { bodies: { name: string }[] };
    expect(listed.bodies.map((b) => b.name)).toEqual(['Plate', 'Body 2']);
  });

  it('says what is wrong with bad input', () => {
    expect(() => runCommand(empty(), 'cube')).toThrow(/no command "cube"/);
    expect(() => runCommand(empty(), 'box', { width: 10, depth: 10 })).toThrow(/"height" is needed/);
    expect(() => runCommand(empty(), 'sketch', { plane: 'xz2' })).toThrow(/one of xy, xz, yz/);
    expect(() => runCommand(empty(), 'fillet', { id: 'nope', size: 2, edges: 'all' })).toThrow(/no body "nope"/);
  });

  it('describes every command for scripts and LLM tools', () => {
    const list = tools();
    expect(list.length).toBe(Object.keys(COMMANDS).length);
    for (const t of list) expect(t.doc.length).toBeGreaterThan(10);
  });
});
