import { expect, it } from 'vitest';
import { assignMaterial, changeLook, dropMaterial, findMaterial, lookOf, newMaterialFor, plainLook, setLook, STANDARD_MATERIALS, sunDirection, toLook, DEFAULT_LIGHT, effectiveLight, lightDirections } from './materials';
import type { Body, Doc, Group, Material } from './types';

const material = (id: string): Material => ({ ...plainLook('#112233'), id, name: id, bump: 0.75, translucency: 0.25, glow: '#ff0000', glowStrength: 0.5 });
const group = (id: string, parent: string | null, m?: string): Group => ({ id, name: id, parent, visible: true, origin: { kind: 'parent' }, ...(m ? { material: m } : {}) });
const body = (extra: Partial<Body>) => ({ id: 'b', color: '#abcdef', group: null, ...extra }) as Body;
const doc = (groups: Group[], bodies: Body[]) => ({ materials: [material('a'), material('b')], groups, bodies }) as unknown as Doc;

it('a body without a material keeps its colour', () => {
  const d = doc([], [body({})]);
  expect(lookOf(d, d.bodies[0])).toMatchObject({ color: '#abcdef', roughness: 0.5, bump: 0, metalness: 0, translucency: 0, glowStrength: 0 });
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

it('every file has the standard materials', () => {
  const d = doc([], [body({ material: 'std-wood' })]);
  expect(findMaterial(d, 'std-wood')?.name).toBe('Wood');
  expect(lookOf(d, d.bodies[0]).color).toBe('#a9773f');
  expect(STANDARD_MATERIALS.map((m) => m.name)).toEqual(['Steel', 'Bronze', 'Brass', 'Plastic, white', 'Plastic, red', 'Plastic, yellow', 'Plastic, black', 'Plastic, light grey', 'Plastic, dark grey', 'POM-C black', 'Wood', 'Glass', 'Glass frosted', 'Wax', 'Lamp', 'Amber light', 'LED white', 'LED green', 'LED red', 'LED orange', 'Grid 10 × 10 cm', 'Grid 1 × 1 ft']);
});

it('changing a standard material makes a copy in the file, under its name; the standard one stays', () => {
  const d = doc([], [{ ...body({ material: 'std-wood' }), name: 'Pin' }]);
  const next = changeLook(d, ['b'], { color: '#010203' }, 'new');
  expect(next.materials.at(-1)).toMatchObject({ id: 'new', name: 'Wood copy', color: '#010203', bump: 0.65 });
  expect(next.bodies[0].material).toBe('new');
  expect(findMaterial(next, 'std-wood')?.color).toBe('#a9773f');
  const again = changeLook({ ...next, bodies: [{ ...next.bodies[0], material: 'std-wood' }] }, ['b'], { color: '#040506' }, 'newer');
  expect(again.materials.at(-1)?.name).toBe('Wood copy 2');
});

it('a material of the file is changed, not copied, everywhere it is used', () => {
  const shared = doc([], [{ ...body({ material: 'a' }), name: 'Pin' }, body({ id: 'c', material: 'a' })]);
  const next = changeLook(shared, ['b'], { color: '#010203' }, 'new');
  expect(next.materials).toHaveLength(2);
  expect(next.materials[0].color).toBe('#010203');
  expect(next.bodies.map((x) => x.material)).toEqual(['a', 'a']);
});

it('without a material of its own: a new one named after the object, for all selected', () => {
  const start = doc([], [{ ...body({}), name: 'Pin' }, { ...body({ id: 'c' }), name: 'Nut' }]);
  const next = changeLook(start, ['b', 'c'], { color: '#010203' }, 'new');
  expect(next.bodies.map((x) => x.material)).toEqual(['new', 'new']);
  expect(next.materials.at(-1)?.name).toBe('Pin');
});

it('objects with different materials get a new one together', () => {
  const start = doc([], [body({ material: 'a' }), body({ id: 'c', material: 'b' })]);
  const next = changeLook(start, ['b', 'c'], { color: '#010203' }, 'new');
  expect(next.materials.map((m) => m.color)).toEqual(['#112233', '#112233', '#010203']);
  expect(next.bodies.map((x) => x.material)).toEqual(['new', 'new']);
  expect(newMaterialFor(next, ['b'], 'newer').materials.at(-1)?.name).toBe(`${next.materials.at(-1)?.name} copy`);
});

it('picking a material; none takes it away', () => {
  const d = doc([], [body({})]);
  const picked = assignMaterial(d, ['b'], 'a');
  expect(picked.bodies[0].material).toBe('a');
  expect('material' in assignMaterial(picked, ['b']).bodies[0]).toBe(false);
});

it('dropping a material clears what used it', () => {
  const d = dropMaterial(doc([group('g', null, 'a')], [body({ material: 'a' }), body({ id: 'c', material: 'b' })]), 'a');
  expect(d.materials.map((m) => m.id)).toEqual(['b']);
  expect(d.groups[0].material).toBeUndefined();
  expect(d.bodies.map((b) => b.material)).toEqual([undefined, 'b']);
});

it('a sun that follows the camera stands behind it, 45° to its side, at its own height', () => {
  const { sun } = lightDirections({ ...DEFAULT_LIGHT, followCamera: true, sunHeight: 0 }, [1, 0, 0]);
  expect(sun[0]).toBeCloseTo(Math.SQRT1_2);
  expect(sun[1]).toBeCloseTo(Math.SQRT1_2);
  expect(sun[2]).toBeCloseTo(0);
  expect(lightDirections({ ...DEFAULT_LIGHT, sunAround: 0, sunHeight: 0 }, [0, 1, 0]).sun[0]).toBeCloseTo(1);
});

it('a standard light leaves its own values aside', () => {
  expect(effectiveLight({ ...DEFAULT_LIGHT, sun: 7, standard: true }).sun).toBe(DEFAULT_LIGHT.sun);
  expect(effectiveLight({ ...DEFAULT_LIGHT, sun: 7 }).sun).toBe(7);
});

it('the sun stands where its angles say', () => {
  const [x, y, z] = sunDirection({ ...DEFAULT_LIGHT, sunHeight: 90 });
  expect([x, y].every((v) => Math.abs(v) < 1e-9)).toBe(true);
  expect(z).toBeCloseTo(1);
  expect(sunDirection({ ...DEFAULT_LIGHT, sunHeight: 0, sunAround: 0 })[0]).toBeCloseTo(1);
});

it('a material goes to the whole linked family: the source and every linked copy', () => {
  const d = doc([], [body({ id: 'src' }), body({ id: 'c1', link: 'src' }), body({ id: 'c2', link: 'src' }), body({ id: 'other' })]);
  const fromCopy = assignMaterial(d, ['c1'], 'a');
  expect(fromCopy.bodies.map((b) => b.material)).toEqual(['a', 'a', 'a', undefined]);
  expect(assignMaterial(fromCopy, ['src']).bodies.map((b) => b.material)).toEqual([undefined, undefined, undefined, undefined]);
});
