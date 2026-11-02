import { describe, expect, it } from 'vitest';
import { chainOf, shapesIn, unitAt } from './shapegroups';

// a, b in sub-group G; c in G's sub-group H; d directly in the sketch group
const s = {
  groups: [
    { id: 'G', name: 'G', parent: null },
    { id: 'H', name: 'H', parent: 'G' },
  ],
  shapes: [{ id: 'a', group: 'G' }, { id: 'b', group: 'G' }, { id: 'c', group: 'H' }, { id: 'd' }],
};

describe('shape groups', () => {
  it('chains sub-groups outermost first', () => expect(chainOf(s, 'H')).toEqual(['G', 'H']));
  it('lists nested shapes', () => expect(shapesIn(s, 'G')).toEqual(['a', 'b', 'c']));
  it('picks the sub-group at the sketch group level', () => expect(unitAt(s, 'c', null)).toEqual({ group: 'G', shapes: ['a', 'b', 'c'] }));
  it('picks the inner sub-group inside G', () => expect(unitAt(s, 'c', 'G')).toEqual({ group: 'H', shapes: ['c'] }));
  it('picks single shapes inside their own group', () => expect(unitAt(s, 'a', 'G')).toEqual({ group: null, shapes: ['a'] }));
  it('a loose shape is itself', () => expect(unitAt(s, 'd', null)).toEqual({ group: null, shapes: ['d'] }));
  it('nothing outside the open group', () => expect(unitAt(s, 'd', 'G')).toBeNull());
});
