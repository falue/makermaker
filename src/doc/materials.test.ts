import { expect, it } from 'vitest';
import { assignMaterial, dropMaterial, editOneOff, findMaterial, lookOf, plainLook, saveOneOff, setLook, STANDARD_MATERIALS, sunDirection, toLook, DEFAULT_LIGHT } from './materials';
import type { Body, Doc, Group, Material } from './types';

const material = (id: string): Material => ({ ...plainLook('#112233'), id, name: id, bump: 0.75, translucency: 0.25, glow: '#ff0000', glowStrength: 0.5 });
const group = (id: string, parent: string | null, m?: string): Group => ({ id, name: id, parent, visible: true, origin: { kind: 'parent' }, ...(m ? { material: m } : {}) });
const body = (extra: Partial<Body>) => ({ id: 'b', color: '#abcdef', group: null, ...extra }) as Body;
const doc = (groups: Group[], bodies: Body[]) => ({ materials: [material('a'), material('b')], groups, bodies }) as unknown as Doc;

it('a body without a material keeps its colour', () => {
  const d = doc([], [body({})]);
  expect(lookOf(d, d.bodies[0])).toMatchObject({ color: '#abcdef', roughness: 0.7, bump: 0, metalness: 0, translucency: 0, glowStrength: 0 });
});

it('the slider runs from mirror over matte to bumpy', () => {
  const at = (bump: number) => toLook({ ...plainLook('#fff'), bump });
  expect(at(0)).toMatchObject({ roughness: 0, bump: 0 });
  expect(at(0.5)).toMatchObject({ roughness: 1, bump: 0 });
  expect(at(1)).toMatchObject({ roughness: 1, bump: 1 });
});

it('a group gives its contents a default, the nearest wins, a body its own first', () => {
  const groups = [group('top', null, 'a'), group('mid', 'top'), group('low', 'mid', 'b')];
  const of = (b: Body) => setLook(doc(groups, []), b) as Material;
  expect(of(body({ group: 'mid' })).id).toBe('a');
  expect(of(body({ group: 'low' })).id).toBe('b');
  expect(of(body({ group: 'low', material: 'a' })).id).toBe('a');
});

it('every file has the standard materials, and a one-off beats them', () => {
  const d = doc([], [body({ material: 'std-wood' })]);
  expect(findMaterial(d, 'std-wood')?.name).toBe('Wood');
  expect(lookOf(d, d.bodies[0]).color).toBe('#a9773f');
  expect(STANDARD_MATERIALS.map((m) => m.name)).toEqual(['Metal', 'Plastic, white', 'Plastic, red', 'Plastic, yellow', 'Plastic, black', 'Plastic, dark grey', 'Wood', 'Glass', 'Glass frosted', 'Lamp', 'Grid 10 × 10 cm', 'Grid 1 × 1 ft']);
  const own = editOneOff(d, ['b'], { color: '#010203' });
  expect(own.bodies[0].ownLook).toMatchObject({ color: '#010203', bump: 0.65 });
  expect(lookOf(own, own.bodies[0]).color).toBe('#010203');
  expect(findMaterial(own, 'std-wood')?.color).toBe('#a9773f');
});

it('one click makes a one-off a material of the file, for all that had it', () => {
  const start = doc([], [body({}), body({ id: 'c' })]);
  const own = editOneOff(start, ['b', 'c'], { color: '#010203' });
  const saved = saveOneOff(own, ['b', 'c'], 'new');
  expect(saved.materials.at(-1)).toMatchObject({ id: 'new', name: 'Material 3', color: '#010203' });
  expect(saved.bodies.map((b) => [b.material, b.ownLook])).toEqual([['new', undefined], ['new', undefined]]);
});

it('picking a material drops a one-off; none takes both away', () => {
  const own = editOneOff(doc([], [body({})]), ['b'], { color: '#010203' });
  const picked = assignMaterial(own, ['b'], 'a');
  expect(picked.bodies[0].material).toBe('a');
  expect(picked.bodies[0].ownLook).toBeUndefined();
  expect('material' in assignMaterial(picked, ['b']).bodies[0]).toBe(false);
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
