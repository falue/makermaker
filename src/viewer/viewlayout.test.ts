import { expect, it } from 'vitest';
import { borders, dragged, newViewLayout, panes } from './viewlayout';

it('one view fills the area; two lie side by side; three: the main one beside a stack', () => {
  const l = newViewLayout();
  expect(panes(1, l)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
  expect(borders(1, l)).toEqual([]);
  expect(panes(2, l)).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }]);
  expect(panes(3, l).map((p) => [p.x, p.y, p.h])).toEqual([[0, 0, 1], [0.5, 0, 0.5], [0.5, 0.5, 0.5]]);
});

it('four views are a 2 x 2 grid, its rows moving together', () => {
  let l = newViewLayout();
  expect(panes(4, l).map((p) => [p.x, p.y])).toEqual([[0, 0], [0, 0.5], [0.5, 0], [0.5, 0.5]]);
  const row = borders(4, l).filter((b) => b.kind === 'row');
  expect(row).toHaveLength(2);
  l = dragged(l, row[0], 0.3);
  expect(panes(4, l).map((p) => p.y)).toEqual([0, 0.3, 0, 0.3]);
});

it('a dragged border stops short of what lies beside it, and of the edges', () => {
  let l = dragged(newViewLayout(), { kind: 'column', at: 0.5 }, 0.99);
  expect(l.x).toBe(0.9);
  const first = borders(5, l).find((b) => b.kind === 'row' && b.k === 3 && b.i === 0)!;
  l = dragged(l, first, 0.99); // the next border lies at 2/3
  expect(l.rows[3][0]).toBeCloseTo(2 / 3 - 0.1);
  expect(dragged(l, first, -1).rows[3][0]).toBeCloseTo(0.1);
});

it('saved rows that do not fit are ignored', () => {
  const l = { x: 0.4, rows: { 3: [0.2] } };
  expect(panes(4, l).length).toBe(4);
  expect(panes(4, l)[2].h).toBe(0.5);
  expect(panes(5, l).filter((p) => p.x === 0.4).map((p) => +p.h.toFixed(4))).toEqual([0.3333, 0.3333, 0.3333]);
});
