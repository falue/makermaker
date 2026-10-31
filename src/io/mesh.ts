import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BodyMesh } from '../kernel/build';

/** Bytes as base64 (for meshes stored in the document). */
export function toBase64(bytes: ArrayBufferView) {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;

/** An OBJ file's triangles, merged into one indexed mesh, turned from y up to z up. */
export function parseObj(text: string): { vertices: Float32Array; triangles: Uint32Array } {
  const parts: THREE.BufferGeometry[] = [];
  new OBJLoader().parse(text).traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = new THREE.BufferGeometry().setAttribute('position', (o.geometry as THREE.BufferGeometry).getAttribute('position').clone());
    parts.push(g.applyMatrix4(o.matrixWorld));
  });
  if (!parts.length) throw new Error('no triangles in this OBJ file');
  const all = new Float32Array(parts.reduce((n, g) => n + g.attributes.position.array.length, 0));
  parts.reduce((at, g) => (all.set(g.attributes.position.array, at), at + g.attributes.position.array.length), 0);
  const merged = mergeVertices(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(all, 3)));
  merged.rotateX(Math.PI / 2); // y up → z up
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
  };
}
