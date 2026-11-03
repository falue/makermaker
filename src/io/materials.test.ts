import { expect, it } from 'vitest';
import { STANDARD_MATERIALS } from '../doc/materials';
import { fromMtlx, toMtlx } from './materials';

it('materials come back from their MaterialX file', () => {
  const list = [...STANDARD_MATERIALS, { ...STANDARD_MATERIALS[0], id: 'x', name: 'Odd "name" & <co>' }];
  const back = fromMtlx(toMtlx(list));
  const noId = ({ id: _, ...m }: (typeof list)[number]) => m;
  expect(back.map(noId)).toEqual(list.map(noId));
  expect(new Set(back.map((m) => m.id)).size).toBe(list.length);
});

it('reads a file from another program, as far as it says', () => {
  const [m] = fromMtlx(`<?xml version="1.0"?><materialx version="1.38"><standard_surface name="Gold" type="surfaceshader">
    <input name="base_color" type="color3" value="0.9, 0.7, 0.2"/><input name="metalness" type="float" value="1"/><input name="specular_roughness" type="float" value="0.3"/>
  </standard_surface></materialx>`);
  expect(m).toMatchObject({ name: 'Gold', color: '#e6b333', reflection: 1, bump: 0.15, translucency: 0, glowStrength: 0 });
});

it('a file without materials says so', () => {
  expect(() => fromMtlx('<materialx></materialx>')).toThrow('No materials');
});
