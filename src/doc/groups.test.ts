import { describe, expect, it } from 'vitest';
import { contents, tree } from './groups';
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

  it('expands groups into what is inside', () => {
    expect(contents(doc(), ['a'])).toEqual(['p1']);
  });
});
