import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extents, objKind, parseObj, parseStl } from './mesh';

// a 50 × 50 × 50 mm cube exported from Fusion 360 (z up, standing on the ground)
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe('mesh import sizes', () => {
  it('reads an STL in mm', () => {
    const data = fixture('cube50.stl');
    const { vertices } = parseStl(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    expect(extents(vertices)).toEqual([50, 50, 50]);
  });

  it('takes a Fusion OBJ as cm and z up', () => {
    const text = fixture('cube50.obj').toString();
    const kind = objKind(text);
    expect(kind).toEqual({ unit: 'cm', zUp: true });
    const { vertices } = parseObj(text, kind.zUp);
    expect(extents(vertices).map((v) => v * 10)).toEqual([50, 50, 50]);
    // still standing on the ground: z from 0 up
    expect(Math.min(...Array.from(vertices).filter((_, i) => i % 3 === 2))).toBe(0);
  });
});
