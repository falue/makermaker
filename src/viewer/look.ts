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

const overlays = new Map<string, THREE.CanvasTexture>();

/** A measuring grid as a texture: thick lines every 10 cm (imperial: foot), thin ones every 1 cm (inch), repeating. */
function overlayMap(kind: 'metric' | 'imperial') {
  const known = overlays.get(kind);
  if (known) return known;
  const { major, minor } = kind === 'metric' ? { major: 100, minor: 10 } : { major: 304.8, minor: 25.4 };
  const size = 2048;
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const cells = Math.round(major / minor);
  g.fillStyle = '#9aa0a8';
  for (let i = 0; i < cells; i++) {
    const at = (i / cells) * size;
    g.fillRect(at, 0, 2, size);
    g.fillRect(0, at, size, 2);
  }
  g.fillStyle = '#1c1c1e';
  g.fillRect(0, 0, 10, size);
  g.fillRect(0, 0, size, 10);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  map.repeat.setScalar(TILE / major); // texture coordinates count in TILE mm
  overlays.set(kind, map);
  return map;
}

/** Whether a look needs a mesh's texture coordinates (`boxUv`). */
export const needsUv = (l: Look) => l.bump > 0 || !!l.overlay || !!l.image;

const pictures = new Map<string, THREE.Texture>();
/** Called when a picture has loaded (the view draws again). */
export const pictureLoaded = new Set<() => void>();

/** A material's picture (a data URL) as a repeating texture, loaded once. */
function pictureMap(url: string) {
  let t = pictures.get(url);
  if (!t) {
    t = new THREE.TextureLoader().load(url, () => pictureLoaded.forEach((f) => f()));
    Object.assign(t, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.SRGBColorSpace, anisotropy: 4 });
    pictures.set(url, t);
  }
  return t;
}

/** Dresses a body's material in the 3D view; see-through there is plain opacity. `around`: what a reflecting one mirrors. */
export function applyLook(m: THREE.MeshStandardMaterial, l: Look, around: THREE.Texture | null = null) {
  m.color.set(l.color);
  m.roughness = l.roughness;
  m.metalness = l.metalness;
  m.emissive.set(l.glow);
  m.emissiveIntensity = l.glowStrength * 10;
  const [normal, map, transparent] = [l.bump > 0 ? bumpMap() : null, l.image ? pictureMap(l.image) : l.overlay ? overlayMap(l.overlay) : null, l.translucency > 0];
  if (m.normalMap !== normal || m.map !== map || m.transparent !== transparent || m.envMap !== around) m.needsUpdate = true;
  m.normalMap = normal;
  m.map = map;
  m.envMap = around;
  m.normalScale.setScalar(strength(l.bump));
  m.transparent = transparent;
  m.opacity = 1 - 0.8 * l.translucency;
}

/** A geometry's bounding sphere, worked out when first asked for. */
export const sphereOf = (g: THREE.BufferGeometry) => g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere!);

/**
 * The light a glowing look gives off from the middle of a body (`radius`: of its bounding sphere), the same in the 3D
 * view and in renders: a faint glow up to many times the sun's light at its own size away, fading with distance
 * (1 / distance), gone at its reach. `k` scales it all.
 */
export function glowLight(l: Look, radius: number, light = new THREE.PointLight(), k = 2) {
  light.color.set(l.glow);
  light.intensity = k * (200 ** l.glowStrength - 1) * radius;
  light.distance = l.glowReach ?? 0;
  light.decay = 1;
  return light;
}

/**
 * The look for the path tracer (its own for renders if it has one): light really passes through and bends. A glowing
 * one casts no shadow, so its `glowLight` from inside gets out.
 */
export function renderMaterial(look: Look) {
  const l = look.render ?? look;
  const m = new THREE.MeshPhysicalMaterial({
    color: l.color,
    roughness: l.roughness,
    metalness: l.metalness,
    emissive: l.glow,
    emissiveIntensity: l.glowStrength * 20,
    transmission: l.translucency,
    ior: 1.5,
    map: l.image ? pictureMap(l.image) : l.overlay ? overlayMap(l.overlay) : null,
    normalMap: l.bump > 0 ? bumpMap() : null,
    normalScale: new THREE.Vector2(strength(l.bump), strength(l.bump)),
  });
  return Object.assign(m, { castShadow: !(l.glowStrength > 0) }); // read by the path tracer
}
