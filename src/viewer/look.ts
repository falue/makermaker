import * as THREE from 'three';
import type { Look } from '../doc/materials';

/** The bump pattern repeats every this many mm (bodies carry it, at any zoom the same size). */
const TILE = 12;

let pattern: THREE.DataTexture | null = null;

/** A seamless normal map of soft noise: made once, shared by all bumpy materials. */
function bumpMap() {
  if (pattern) return pattern;
  const size = 256;
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const layer = (cells: number) => {
    const grid = Float32Array.from({ length: cells * cells }, random);
    return (x: number, y: number) => {
      const [u, v] = [(x / size) * cells, (y / size) * cells];
      const [i, j] = [Math.floor(u), Math.floor(v)];
      const at = (a: number, b: number) => grid[(a % cells) + (b % cells) * cells];
      const [s, t] = [smooth(u - i), smooth(v - j)];
      return (at(i, j) * (1 - s) + at(i + 1, j) * s) * (1 - t) + (at(i, j + 1) * (1 - s) + at(i + 1, j + 1) * s) * t;
    };
  };
  const [big, fine] = [layer(16), layer(32)];
  const height = (x: number, y: number) => big((x + size) % size, (y + size) % size) + 0.5 * fine((x + size) % size, (y + size) % size);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = new THREE.Vector3((height(x - 1, y) - height(x + 1, y)) * 3, (height(x, y - 1) - height(x, y + 1)) * 3, 1).normalize();
      data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], (x + y * size) * 4);
    }
  pattern = new THREE.DataTexture(data, size, size);
  Object.assign(pattern, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, anisotropy: 4, needsUpdate: true });
  return pattern;
}

/** Gives a body's mesh texture coordinates in mm / TILE, each point projected along its normal's main axis. */
export function boxUv(geometry: THREE.BufferGeometry) {
  if (geometry.attributes.uv) return;
  const { position: p, normal: n } = geometry.attributes;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)];
    const [ax, ay, az] = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
    const [a, b] = az >= ax && az >= ay ? [x, y] : ay >= ax ? [x, z] : [y, z];
    uv[i * 2] = a / TILE;
    uv[i * 2 + 1] = b / TILE;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const strength = (bump: number) => bump * 1.5;

/** Dresses a body's material in the 3D view; see-through there is plain opacity. */
export function applyLook(m: THREE.MeshStandardMaterial, l: Look) {
  m.color.set(l.color);
  m.roughness = l.roughness;
  m.emissive.set(l.glow);
  m.emissiveIntensity = l.glowStrength * 2;
  const [map, transparent] = [l.bump > 0 ? bumpMap() : null, l.translucency > 0];
  if (m.normalMap !== map || m.transparent !== transparent) m.needsUpdate = true;
  m.normalMap = map;
  m.normalScale.setScalar(strength(l.bump));
  m.transparent = transparent;
  m.opacity = 1 - 0.8 * l.translucency;
}

/** The same look for the path tracer: light really passes through and bends, glow lights what is around. */
export function renderMaterial(l: Look) {
  return new THREE.MeshPhysicalMaterial({
    color: l.color,
    roughness: l.roughness,
    emissive: l.glow,
    emissiveIntensity: l.glowStrength * 4,
    transmission: l.translucency,
    ior: 1.5,
    normalMap: l.bump > 0 ? bumpMap() : null,
    normalScale: new THREE.Vector2(strength(l.bump), strength(l.bump)),
  });
}
