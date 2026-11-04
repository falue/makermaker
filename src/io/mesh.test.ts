import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extents, objKind, parseGlb, parseObj, parseStl } from './mesh';

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

describe('GLB', () => {
  // one triangle, 1 m wide along x and 2 m up along y
  const glb = () => {
    const bin = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]);
    const json = JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    });
    const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
    const out = new ArrayBuffer(12 + 8 + text.length + 8 + 36);
    const d = new DataView(out);
    [0x46546c67, 2, out.byteLength, text.length, 0x4e4f534a].forEach((v, i) => d.setUint32(i * 4, v, true));
    new Uint8Array(out, 20).set(text);
    d.setUint32(20 + text.length, 36, true);
    d.setUint32(24 + text.length, 0x004e4942, true);
    new Uint8Array(out, 28 + text.length).set(new Uint8Array(bin.buffer));
    return out;
  };
  it('reads its triangles, y up turned to z up', async () => {
    const { vertices, triangles } = await parseGlb(glb());
    expect(triangles.length).toBe(3);
    const [x, y, z] = extents(vertices);
    expect([x, y, z].map((v) => +v.toFixed(5))).toEqual([1, 0, 2]);
  });
});
