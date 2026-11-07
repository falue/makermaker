import { describe, expect, it } from 'vitest';
import { pieces } from './arrangement';

describe('pieces', () => {
  it('keeps overlapping, touching and nested shapes together and the rest apart', () => {
    const rect = (id: string, x: number, w = 10) => ({ id, kind: 'rect' as const, x, y: 0, w, h: 10, r: 0, rot: 0 });
    const hole = { id: 'h', kind: 'circle' as const, x: 0, y: 0, d: 4 };
    const cross = { id: 'x', kind: 'rect' as const, x: 0, y: 0, w: 2, h: 30, r: 0, rot: 0 }; // crosses a without a corner inside
    const sorted = (g: string[][]) => g.map((p) => p.sort().join('')).sort();
    expect(sorted(pieces([rect('a', 0), hole, cross, rect('b', 10), rect('c', 40)]))).toEqual(['abhx', 'c']); // b touches a's side
  });
});
