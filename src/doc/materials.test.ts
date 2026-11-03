import { expect, it } from 'vitest';
import { dropMaterial, lookOf, materialOf, sunDirection, DEFAULT_LIGHT } from './materials';
import { ex } from './sample';
import type { Body, Doc, Group, Material } from './types';

const material = (id: string): Material => ({ id, name: id, color: '#112233', bump: 0.5, translucency: 0.25, glow: '#ff0000', glowStrength: 0.5, thickness: ex('') });
const group = (id: string, parent: string | null, m?: string): Group => ({ id, name: id, parent, visible: true, origin: { kind: 'parent' }, ...(m ? { material: m } : {}) });
const body = (extra: Partial<Body>) => ({ id: 'b', color: '#abcdef', group: null, ...extra }) as Body;
const doc = (groups: Group[], bodies: Body[]) => ({ materials: [material('a'), material('b')], groups, bodies }) as unknown as Doc;

it('a body without a material keeps its colour', () => {
  const d = doc([], [body({})]);
  expect(lookOf(d, d.bodies[0])).toMatchObject({ color: '#abcdef', bump: 0, translucency: 0, glowStrength: 0 });
});

it('a group gives its contents a default, the nearest wins, a body its own first', () => {
  const groups = [group('top', null, 'a'), group('mid', 'top'), group('low', 'mid', 'b')];
  expect(materialOf(doc(groups, []), body({ group: 'mid' }))?.id).toBe('a');
  expect(materialOf(doc(groups, []), body({ group: 'low' }))?.id).toBe('b');
  expect(materialOf(doc(groups, []), body({ group: 'low', material: 'a' }))?.id).toBe('a');
});

it('a look comes from the material', () => {
  const d = doc([], [body({ material: 'a' })]);
  expect(lookOf(d, d.bodies[0])).toEqual({ color: '#112233', roughness: 0.5, bump: 0.5, translucency: 0.25, glow: '#ff0000', glowStrength: 0.5 });
});

it('dropping a material clears what used it', () => {
  const d = dropMaterial(doc([group('g', null, 'a')], [body({ material: 'a' }), body({ id: 'c', material: 'b' })]), 'a');
  expect(d.materials.map((m) => m.id)).toEqual(['b']);
  expect(d.groups[0].material).toBeUndefined();
  expect(d.bodies.map((b) => b.material)).toEqual([undefined, 'b']);
});

it('the sun stands where its angles say', () => {
  const [x, y, z] = sunDirection({ ...DEFAULT_LIGHT, sunHeight: 90 });
  expect([x, y].every((v) => Math.abs(v) < 1e-9)).toBe(true);
  expect(z).toBeCloseTo(1);
  expect(sunDirection({ ...DEFAULT_LIGHT, sunHeight: 0, sunAround: 0 })[0]).toBeCloseTo(1);
});
