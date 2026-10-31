import { describe, expect, it } from 'vitest';
import { toBuild } from './expand';
import type { Resolved } from './resolve';
import type { Feature, Sketch } from './types';

const sketch = (helpCircle: boolean): Resolved<Sketch> => ({
  id: 's',
  name: 'S',
  group: null,
  visible: true,
  plane: { kind: 'base', axis: 'xy', offset: 0 },
  shapes: [
    { id: 'r', kind: 'rect', x: 0, y: 0, w: 10, h: 10, r: 0, rot: 0, help: true },
    { id: 'c', kind: 'circle', x: 0, y: 0, d: 4, help: helpCircle },
  ],
});
const linked: Resolved<Feature> = { id: 'f', type: 'extrude', source: { kind: 'sketch', sketch: 's', shapes: ['r', 'c'] }, depth: 3, mode: 'add', through: false };

describe('toBuild', () => {
  it('leaves help lines out of linked extrusions', () => {
    const built = toBuild(linked, 'b', new Map([['s', sketch(false)]]), () => undefined);
    expect(typeof built === 'object' && built?.type === 'extrude' && built.profiles.map((p) => p.id)).toEqual(['c']);
  });

  it('reports a sketch of help lines only', () => {
    expect(toBuild(linked, 'b', new Map([['s', sketch(true)]]), () => undefined)).toMatch('help lines');
  });
});
