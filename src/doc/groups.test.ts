import { describe, expect, it } from 'vitest';
import { contents, listedAfter, sketchesOf, tree } from './groups';
import { sampleDoc } from './sample';
import type { Doc } from './types';

const doc = (): Doc => {
  const d = sampleDoc();
  return {
    ...d,
    groups: [
      { id: 'a', name: 'A', parent: null, visible: true, origin: { kind: 'parent' } },
      { id: 'b', name: 'B', parent: 'a', visible: true, origin: { kind: 'parent' } },
    ],
    bodies: d.bodies.slice(0, 2).map((b, i) => ({ ...b, id: `p${i}`, group: i ? 'b' : 'gone' })),
  };
};

describe('groups', () => {
  it('lists groups with their contents; a missing group counts as none', () => {
    const rows = tree(doc(), new Set()).map((r) => `${r.depth}:${r.id}`);
    expect(rows.slice(0, 4)).toEqual(['0:a', '1:b', '2:p1', '0:p0']);
    expect(tree(doc(), new Set(['a'])).map((r) => r.id).slice(0, 2)).toEqual(['a', 'p0']);
  });

  it('lists linked copies under their source (folded first), those in another group where they are', () => {
    const d = sampleDoc();
    const src = d.bodies[0];
    const copy = (id: string, group: string | null) => ({ ...src, id, link: src.id, features: [], group });
    const linked = { ...d, groups: [{ id: 'g', name: 'G', parent: null, visible: true, origin: { kind: 'parent' as const } }], bodies: [...d.bodies, copy('c1', src.group), copy('c2', 'g')] };
    const rows = (open: string[]) => tree(linked, new Set(open)).map((r) => `${r.depth}:${r.id}`);
    expect(rows([])).not.toContain('0:c1');
    expect(rows([])).toContain('1:c2'); // in its own group
    expect(tree(linked, new Set()).find((r) => r.id === src.id)?.open).toBe(false);
    const open = rows([src.id]);
    expect(open[open.indexOf(`0:${src.id}`) + 1]).toBe('1:c1');
  });

  it('keeps sketches out of the object list; a body knows its sketches', () => {
    const d = sampleDoc();
    expect(tree(d, new Set()).some((r) => d.sketches.some((s) => s.id === r.id))).toBe(false);
    expect(sketchesOf(d, d.bodies[0].id).map((s) => s.name)).toEqual(['Plate outline']);
  });

  it('expands groups into what is inside', () => {
    expect(contents(doc(), ['a'])).toEqual(['p1']);
  });
});

describe('listedAfter', () => {
  it('puts each new body right after the one it came from, in its group, copies of one in the order made', () => {
    const doc = sampleDoc();
    const top = doc.bodies.filter((b) => b.group === null);
    const [a, b] = [top[0], top[1]];
    const copy = (from: typeof a, id: string) => ({ ...from, id, order: undefined });
    const next = listedAfter({ ...doc, bodies: [...doc.bodies, copy(a, 'a2'), copy(a, 'a3'), copy(b, 'b2')] }, [[a.id, 'a2'], [a.id, 'a3'], [b.id, 'b2']]);
    const rows = tree(next, new Set()).filter((r) => r.depth === 0 && r.kind === 'body').map((r) => r.id);
    expect(rows.slice(rows.indexOf(a.id), rows.indexOf(a.id) + 5)).toEqual([a.id, 'a2', 'a3', b.id, 'b2']);
  });
});
