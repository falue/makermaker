import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BodyMesh } from '../kernel/build';
import type { Unit } from '../doc/types';

/** Bytes as base64 (for meshes stored in the document). */
export function toBase64(bytes: ArrayBufferView) {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;

/** An OBJ file's probable unit and up axis (OBJ stores neither): Autodesk's exporter (Fusion) writes cm and z up, others mostly mm and y up. */
export function objKind(text: string) {
  const autodesk = text.slice(0, 500).includes('Autodesk ATF');
  return { unit: autodesk ? 'cm' : 'mm', zUp: autodesk } as const;
}

/** A mesh's size along x, y, z. */
export function extents(vertices: ArrayLike<number>): [number, number, number] {
  return [0, 1, 2].map((k) => {
    let [lo, hi] = [Infinity, -Infinity];
    for (let i = k; i < vertices.length; i += 3) [lo, hi] = [Math.min(lo, vertices[i]), Math.max(hi, vertices[i])];
    return hi - lo;
  }) as [number, number, number];
}

/** All meshes under `root` as one, in its world, corners shared; a mirroring transform keeps the faces facing out. */
function merged(root: THREE.Object3D, kind: string) {
  root.updateMatrixWorld(true);
  const all: number[] = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const { index, attributes } = o.geometry as THREE.BufferGeometry;
    const flip = o.matrixWorld.determinant() < 0;
    const count = (index ?? attributes.position).count;
    for (let i = 0; i + 2 < count; i += 3)
      for (const k of flip ? [0, 2, 1] : [0, 1, 2]) {
        v.fromBufferAttribute(attributes.position as THREE.BufferAttribute, index ? index.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
        all.push(v.x, v.y, v.z);
      }
  });
  if (!all.length) throw new Error(`no triangles in this ${kind} file`);
  return mergeVertices(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(all), 3)));
}

const meshOf = (g: THREE.BufferGeometry) => ({ vertices: g.attributes.position.array as Float32Array, triangles: new Uint32Array(g.index!.array) });

/** The triangles of an OBJ file, corners shared; y up is turned to z up unless `zUp`. */
export function parseObj(text: string, zUp = false): { vertices: Float32Array; triangles: Uint32Array } {
  const g = merged(new OBJLoader().parse(text), 'OBJ');
  if (!zUp) g.rotateX(Math.PI / 2); // y up → z up
  return meshOf(g);
}

/** A GLB's triangles, all its meshes as one, corners shared. glTF is y up, in metres (the unit to show them in). */
export async function parseGlb(data: ArrayBuffer) {
  const { scene } = await new GLTFLoader().parseAsync(data, '');
  return meshOf(merged(scene, 'GLB').rotateX(Math.PI / 2));
}

const UNITS_3MF: Record<string, Unit> = { millimeter: 'mm', centimeter: 'cm', meter: 'm', inch: 'in', foot: 'ft' };

/** A 3MF's triangles as placed on its build plate, all objects as one, corners shared (z up), and the file's unit. */
export function parse3mf(data: ArrayBuffer) {
  const g = merged(new ThreeMFLoader().parse(data), '3MF');
  const files = unzipSync(new Uint8Array(data), { filter: (f) => /\.model$/i.test(f.name) });
  const named = /<model\b[^>]*\bunit="(\w+)"/.exec(strFromU8(Object.values(files)[0] ?? new Uint8Array()))?.[1] ?? 'millimeter';
  if (named === 'micron') g.scale(0.001, 0.001, 0.001);
  return { ...meshOf(g), unit: UNITS_3MF[named] ?? 'mm' };
}

/** The triangles of an STL file (binary or text; z up, as STL usually is), corners shared. */
export function parseStl(data: ArrayBuffer): { vertices: Float32Array; triangles: Uint32Array } {
  const g = new STLLoader().parse(data);
  if (!g.attributes.position?.count) throw new Error('no triangles in this STL file');
  const merged = mergeVertices(new THREE.BufferGeometry().setAttribute('position', g.getAttribute('position')));
  return { vertices: merged.attributes.position.array as Float32Array, triangles: new Uint32Array(merged.index!.array) };
}

/** A stored mesh as the viewer shows it, `scale` times its size: smooth normals, edges where faces bend more than 30°. */
export function meshBody(vertices: string, triangles: string, scale: number): BodyMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fromBase64(vertices)), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(fromBase64(triangles)), 1));
  g.scale(scale, scale, scale);
  g.computeVertexNormals();
  const edges = new THREE.EdgesGeometry(g, 30).attributes.position.array as Float32Array;
  const segments = edges.length / 6;
  return {
    vertices: g.attributes.position.array as Float32Array,
    normals: g.attributes.normal.array as Float32Array,
    indices: g.index!.array as Uint32Array,
    edges,
    faces: new Uint32Array([0, g.index!.count]), // one face
    corners: new Float32Array(),
    edgeGroups: new Uint32Array(Array.from({ length: segments }, (_, i) => [i * 2, 2]).flat()),
    finishEdges: new Uint8Array(segments),
    finishFaces: new Int32Array(1).fill(-1),
    finishes: [],
    lostEdges: {},
  };
}
