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

/**
 * The triangles of mesh `o` in its world, added to `all`; a mirroring transform keeps the faces facing out. `uvs`: its
 * texture coordinates too, v upward (`flipV`: a glTF texture has it downward).
 */
function addTriangles(o: THREE.Mesh, all: number[], uvs?: number[], flipV = false) {
  const v = new THREE.Vector3();
  const { index, attributes } = o.geometry as THREE.BufferGeometry;
  const flip = o.matrixWorld.determinant() < 0;
  const count = (index ?? attributes.position).count;
  for (let i = 0; i + 2 < count; i += 3)
    for (const k of flip ? [0, 2, 1] : [0, 1, 2]) {
      const at = index ? index.getX(i + k) : i + k;
      v.fromBufferAttribute(attributes.position as THREE.BufferAttribute, at).applyMatrix4(o.matrixWorld);
      all.push(v.x, v.y, v.z);
      if (uvs) uvs.push(attributes.uv.getX(at), flipV ? 1 - attributes.uv.getY(at) : attributes.uv.getY(at));
    }
}

/** Triangle corners as a mesh, corners within `weld` (file units) shared (not where their texture coordinates differ). */
function shared(all: number[], uvs?: number[], weld = 1e-4) {
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(all), 3));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  return mergeVertices(g, weld);
}

/**
 * A mesh's picture (its material's texture) as a data URL and the material's name: set by the reader (`userData.picture`),
 * else drawn from the loaded texture (in a browser only); none without a texture.
 */
function pictureOf(o: THREE.Mesh): { url: string; name: string } | null {
  if (o.userData.picture) return o.userData.picture;
  const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
  const image = material?.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!image?.width || typeof document === 'undefined' || !o.geometry.attributes.uv) return null;
  const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return { url: canvas.toDataURL('image/png'), name: material.name };
}

/** All meshes under `root` as one, in its world, corners shared. */
function merged(root: THREE.Object3D, kind: string) {
  root.updateMatrixWorld(true);
  const all: number[] = [];
  root.traverse((o) => o instanceof THREE.Mesh && addTriangles(o, all));
  if (!all.length) throw new Error(`no triangles in this ${kind} file`);
  return shared(all);
}

/**
 * A part of an imported file: its name and colour (#rrggbb) as the file has them (none: '', null), its triangles, and
 * the groups (sub-assemblies) it lies in, outermost first (`id` tells two of the same name apart).
 */
export type MeshPart = { name: string; color: string | null; vertices: Float32Array; triangles: Uint32Array; in?: { id: string; name: string }[]; uvs?: Float32Array; picture?: { url: string; name: string } | null };

/** A mesh's colour: its vertices' on average, else its material's; a texture alone tells none. */
function colorOf(o: THREE.Mesh) {
  const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
  const colors = o.geometry.attributes.color;
  if (colors) {
    const sum = [0, 0, 0];
    for (let i = 0; i < colors.count; i++) [colors.getX(i), colors.getY(i), colors.getZ(i)].forEach((c, k) => (sum[k] += c));
    return `#${new THREE.Color(sum[0] / colors.count, sum[1] / colors.count, sum[2] / colors.count).getHexString()}`;
  }
  return material?.color && !material.map ? `#${material.color.getHexString()}` : null;
}

/**
 * The meshes under `root` as parts, in its world, corners within `weld` (file units) shared. All white: no colours
 * in the file. Very many: one per colour, as a body each would be too heavy to work with (`most`).
 */
function partsOf(root: THREE.Object3D, kind: string, weld = 1e-4, most = 200): (Omit<MeshPart, 'vertices' | 'triangles'> & { g: THREE.BufferGeometry })[] {
  root.updateMatrixWorld(true);
  const found: { name: string; color: string | null; all: number[]; in: { id: string; name: string }[]; uvs?: number[]; picture: { url: string; name: string } | null }[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const all: number[] = [];
    const picture = pictureOf(o);
    const uvs = picture ? [] : undefined;
    const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
    addTriangles(o, all, uvs, material?.map?.flipY === false);
    let name = '';
    for (let p: THREE.Object3D | null = o; p && p !== root && !name; p = p.parent) name = p.name;
    const chain: { id: string; name: string }[] = [];
    for (let p = o.parent; p && p !== root; p = p.parent) chain.unshift({ id: p.uuid, name: p.name });
    if (all.length) found.push({ name, color: picture ? null : colorOf(o), all, in: chain, uvs, picture });
  });
  if (!found.length) throw new Error(`no triangles in this ${kind} file`);
  if (found.every((f) => f.color === '#ffffff')) found.forEach((f) => (f.color = null));
  let parts = found;
  if (found.length > most) {
    const byLook = new Map<string, (typeof found)[number]>();
    for (const f of found) {
      const key = `${f.color} ${f.picture?.url}`;
      const in_ = byLook.get(key);
      if (in_) for (const [to, from] of [[in_.all, f.all], [in_.uvs, f.uvs]]) for (const x of from ?? []) to!.push(x);
      else byLook.set(key, { ...f, name: '', in: [], all: [...f.all], uvs: f.uvs && [...f.uvs] });
    }
    parts = [...byLook.values()];
  }
  return parts.map(({ all, uvs, ...f }) => ({ ...f, g: shared(all, uvs, weld) }));
}

const meshOf = (g: THREE.BufferGeometry) => ({ vertices: g.attributes.position.array as Float32Array, triangles: new Uint32Array(g.index!.array), ...(g.attributes.uv ? { uvs: g.attributes.uv.array as Float32Array } : {}) });

/** The triangles of an OBJ file, corners shared; y up is turned to z up unless `zUp`. */
export function parseObj(text: string, zUp = false): { vertices: Float32Array; triangles: Uint32Array } {
  const g = merged(new OBJLoader().parse(text), 'OBJ');
  if (!zUp) g.rotateX(Math.PI / 2); // y up → z up
  return meshOf(g);
}

/** How near corners of a file in metres are shared: 1 µm (Float32 keeps about that on a 10 m model). */
const METRES = 1e-6;

/** A GLB's parts, corners shared. glTF is y up, in metres (the unit to show them in). */
export async function parseGlb(data: ArrayBuffer): Promise<MeshPart[]> {
  const { scene } = await new GLTFLoader().parseAsync(data, '');
  return partsOf(scene, 'GLB', METRES).map(({ g, ...p }) => ({ ...p, ...meshOf(g.rotateX(Math.PI / 2)) }));
}

/**
 * A SketchUp file's parts (openskp, loaded when first needed): what is placed, as SketchUp shows it (hidden faces left
 * out, each face once), in metres, named and coloured as there, in its components and groups.
 */
export async function parseSkp(data: ArrayBuffer): Promise<MeshPart[]> {
  const { buildScene } = await import('openskp');
  const scene = buildScene(data, { respectEdgeVisibility: true, frontSideOnly: true });
  // the placed components and groups as a tree; each mesh goes to its instance, found by its path and place (in order)
  const root = new THREE.Group();
  const nodes: { path: string; at: number[]; group: THREE.Group }[] = [];
  const walk = (n: (typeof scene)['sceneHierarchy'], path: string, into: THREE.Group) => {
    for (const c of n.children ?? []) {
      const group = Object.assign(new THREE.Group(), { name: c.name || c.definitionName });
      into.add(group);
      nodes.push({ path: `${path} / ${c.name}`, at: c.positionMm, group });
      walk(c, `${path} / ${c.name}`, group);
    }
  };
  walk(scene.sceneHierarchy, scene.sceneHierarchy.name, root);
  let from = 0;
  for (const p of scene.glbPrimitives) {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p.positions, 3)).setIndex(new THREE.BufferAttribute(p.indices, 1));
    const look = scene.gltfMaterials[p.materialIndex] as { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } } } | undefined;
    const c = look?.pbrMetallicRoughness?.baseColorFactor;
    const texture = scene.textures[look?.pbrMetallicRoughness?.baseColorTexture?.index ?? -1];
    if (texture) g.setAttribute('uv', new THREE.BufferAttribute(p.uvs, 2));
    const m = scene.meshIndex[p.geomName];
    const mine = (n: (typeof nodes)[number]) => !!m && n.path === m.path && n.at.every((v, k) => Math.abs(v - m.positionMm[k]) < 1e-3);
    const k = nodes.findIndex((n, i) => i >= from && mine(n));
    const at = k >= 0 ? k : nodes.findIndex(mine);
    if (at >= 0) from = at;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial(c ? { color: new THREE.Color(c[0], c[1], c[2]) } : {}));
    if (texture) Object.assign(mesh.userData, { picture: { url: `data:${texture.mimeType};base64,${toBase64(texture.data)}`, name: look?.name ?? '' } });
    (nodes[at]?.group ?? root).add(mesh);
  }
  return partsOf(root, 'SketchUp', METRES).map(({ g, ...p }) => ({ ...p, ...meshOf(g.rotateX(Math.PI / 2)) }));
}

const UNITS_3MF: Record<string, Unit> = { millimeter: 'mm', centimeter: 'cm', meter: 'm', inch: 'in', foot: 'ft' };

/** A 3MF's parts as placed on its build plate, corners shared (z up), and the file's unit. */
export function parse3mf(data: ArrayBuffer): { parts: MeshPart[]; unit: Unit } {
  const found = partsOf(new ThreeMFLoader().parse(data), '3MF');
  const files = unzipSync(new Uint8Array(data), { filter: (f) => /\.model$/i.test(f.name) });
  const named = /<model\b[^>]*\bunit="(\w+)"/.exec(strFromU8(Object.values(files)[0] ?? new Uint8Array()))?.[1] ?? 'millimeter';
  if (named === 'micron') found.forEach(({ g }) => g.scale(0.001, 0.001, 0.001));
  return { parts: found.map(({ g, ...p }) => ({ ...p, ...meshOf(g) })), unit: UNITS_3MF[named] ?? 'mm' };
}

/** The triangles of an STL file (binary or text; z up, as STL usually is), corners shared. */
export function parseStl(data: ArrayBuffer): { vertices: Float32Array; triangles: Uint32Array } {
  const g = new STLLoader().parse(data);
  if (!g.attributes.position?.count) throw new Error('no triangles in this STL file');
  const merged = mergeVertices(new THREE.BufferGeometry().setAttribute('position', g.getAttribute('position')));
  return { vertices: merged.attributes.position.array as Float32Array, triangles: new Uint32Array(merged.index!.array) };
}

/** A stored mesh as the viewer shows it, `scale` times its size: smooth normals, edges where faces bend more than 30°, its texture coordinates if any. */
export function meshBody(vertices: string, triangles: string, scale: number, uvs?: string): BodyMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fromBase64(vertices)), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(fromBase64(triangles)), 1));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(fromBase64(uvs)), 2));
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
    corners: new Float64Array(),
    edgeGroups: new Uint32Array(Array.from({ length: segments }, (_, i) => [i * 2, 2]).flat()),
    finishEdges: new Uint8Array(segments),
    finishFaces: new Int32Array(1).fill(-1),
    finishes: [],
    lostEdges: {},
    capped: {},
    ...(uvs ? { uvs: g.attributes.uv.array as Float32Array } : {}),
  };
}
