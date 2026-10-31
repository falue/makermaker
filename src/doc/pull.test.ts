import { describe, expect, it } from 'vitest';
import type { BuildFeature } from '../kernel/build';
import { faceAt, pushed, sideFrame } from './pull';

const ground = { kind: 'base', axis: 'xy', offset: 0 } as const;
const plate: BuildFeature = { id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: 0, rot: 0 }], depth: 4, mode: 'add', through: false };
const hole: BuildFeature = { id: 'h', type: 'extrude', plane: ground, profiles: [{ id: 'c', kind: 'circle', x: 10, y: 0, d: 6 }], depth: 0, mode: 'cut', through: true };

describe('faceAt', () => {
  it('finds end faces and sides', () => {
    expect(faceAt([plate], [0, 0, 4], [0, 0, 1])).toEqual({ kind: 'cap', feature: 'p', rate: 1 });
    expect(faceAt([plate], [0, 0, 0], [0, 0, -1])).toBeNull();
    expect(faceAt([plate], [20, 3, 2], [1, 0, 0])).toEqual({ kind: 'side', feature: 'p', shape: 'r', edge: 1, rate: 1 });
    expect(faceAt([plate], [-5, -10, 2], [0, -1, 0])).toMatchObject({ edge: 0, rate: 1 });
  });

  it('pulling a hole wall outwards shrinks the hole, also through a boolean tool body', () => {
    expect(faceAt([plate, hole], [13, 0, 2], [-1, 0, 0])).toMatchObject({ shape: 'c', edge: -1, rate: -1 });
    const tool: BuildFeature = { id: 'b', type: 'boolean', op: 'subtract', offset: [5, 0, 0], features: [{ ...hole, id: 't', through: false, mode: 'add', depth: 4 }] };
    expect(faceAt([plate, tool], [18, 0, 2], [-1, 0, 0])).toMatchObject({ feature: 't', rate: -1 });
  });
});

describe('pushed', () => {
  it('moves one rect side, keeping the opposite one', () => {
    expect(pushed({ kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: 0, rot: 0 }, 1, 5)).toMatchObject({ x: 2.5, w: 45, h: 20 });
    expect(pushed({ kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: 0, rot: 90 }, 1, 4)).toMatchObject({ y: 2, w: 44 });
  });

  it('moves both corners of a polygon side', () => {
    const p = pushed({ kind: 'polygon', pts: [[0, 0], [10, 0], [0, 10]], r: 0, rot: 0 }, 0, 2);
    expect(p.kind === 'polygon' && p.pts).toEqual([[0, -2], [10, -2], [0, 10]]);
  });
});

describe('sideFrame', () => {
  it('stands on a rect side, pointing out', () => {
    const f = sideFrame([plate], 'p', 'r', 0); // the bottom side (y = -10), from (-20, -10) to (20, -10)
    const clean = (v: number[]) => v.map((k) => k + 0); // no -0
    expect([f!.o, f!.x, f!.y, f!.n].map(clean)).toEqual([[-20, -10, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0]]);
  });
});
