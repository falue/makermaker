import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { create } from 'openskp';
import { extents, objKind, parseGlb, parseObj, parseSkp, parseStl } from './mesh';

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
  // one triangle, 1 m wide along x and 2 m up along y; `extra`: over the plain file
  const glb = (extra: object = {}) => {
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
      ...extra,
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
    const [{ vertices, triangles }] = await parseGlb(glb());
    expect(triangles.length).toBe(3);
    const [x, y, z] = extents(vertices);
    expect([x, y, z].map((v) => +v.toFixed(5))).toEqual([1, 0, 2]);
  });
  it('keeps its parts, their names and colours; all white is no colour', async () => {
    expect((await parseGlb(glb()))[0].color).toBeNull();
    const parts = await parseGlb(
      glb({
        scenes: [{ nodes: [0, 1] }],
        nodes: [{ mesh: 0, name: 'Arm' }, { mesh: 1, name: 'Leg' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }, { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] } }],
      }),
    );
    expect(parts.map((p) => [p.name, p.color])).toEqual([['Arm', '#ff0000'], ['Leg', '#0000ff']]);
  });
});

describe('SketchUp import', () => {
  it('reads a box placed as a component, in metres, z up, with its colour', async () => {
    // 10 × 20 × 30 inches, red, placed 100 inches along x
    const skp = create();
    const red = skp.addMaterial('Red', [255, 0, 0, 255]);
    const box = skp.addComponentDefinition('Box', (d) => {
      const [x, y, z] = [10, 20, 30];
      const c = (i: number, j: number, k: number): [number, number, number] => [i * x, j * y, k * z];
      for (const f of [
        [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
        [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
        [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
        [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
        [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
        [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
      ])
        d.addFace(f, { material: red });
    });
    skp.addInstance(box, { translation: [100, 0, 0] });
    const bytes = skp.toBytes();
    const parts = await parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const vertices = parts.flatMap((p) => [...p.vertices]);
    expect(extents(vertices).map((v) => +(v / 0.0254).toFixed(3))).toEqual([10, 20, 30]);
    expect(Math.min(...vertices.filter((_, i) => i % 3 === 0)) / 0.0254).toBeCloseTo(100, 3);
    expect(parts.reduce((n, p) => n + p.triangles.length / 3, 0)).toBe(12);
    expect(parts[0].color).toBe('#ff0000');
    expect(parts[0].name).toBe('Box');
  });
  it('keeps its components inside each other, each placement apart', async () => {
    // two tables, each a component of two legs
    const skp = create();
    const leg = skp.addComponentDefinition('Leg', (d) => d.addFace([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]));
    const table = skp.addComponentDefinition('Table', (d) => [0, 10].forEach((x) => d.addInstance(leg, { translation: [x, 0, 0] })));
    [0, 50].forEach((x) => skp.addInstance(table, { translation: [x, 0, 0] }));
    const bytes = skp.toBytes();
    const parts = await parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(parts.map((p) => [p.name, ...(p.in ?? []).map((g) => g.name)])).toEqual(Array(4).fill(['Leg', 'Table', 'Leg']));
    const tables = parts.map((p) => p.in![0].id);
    expect(new Set(tables).size).toBe(2);
    expect(tables[0]).toBe(tables[1]);
    expect(Math.min(...parts[2].vertices.filter((_, i) => i % 3 === 0)) / 0.0254).toBeCloseTo(50, 3);
  });
});
