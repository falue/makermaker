import * as THREE from 'three';
import type { Look } from '../doc/materials';

/** The bump pattern repeats every this many mm (bodies carry it, at any zoom the same size). */
const TILE = 24;

let pattern: THREE.DataTexture | null = null;

/** In-place FFT of `n` complex values (`re`, `im`) `stride` apart from `at`, turning by the table (`cos`, `sin` of 2πk/n, signed). */
function fft(re: Float64Array, im: Float64Array, n: number, at: number, stride: number, cos: Float64Array, sin: Float64Array) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i >= j) continue;
    const a = at + i * stride;
    const b = at + j * stride;
    let t = re[a];
    re[a] = re[b];
    re[b] = t;
    t = im[a];
    im[a] = im[b];
    im[b] = t;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = n / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const c = cos[k * step];
        const s = sin[k * step];
        const a = at + (i + k) * stride;
        const b = a + (len / 2) * stride;
        const x = re[b] * c - im[b] * s;
        const y = re[b] * s + im[b] * c;
        re[b] = re[a] - x;
        im[b] = im[a] - y;
        re[a] += x;
        im[a] += y;
      }
  }
}

/** An `n` × `n` grid mirrored on its diagonal, in place. */
function transpose(a: Float64Array, n: number) {
  for (let y = 0; y < n; y++)
    for (let x = y + 1; x < n; x++) {
      const t = a[x + y * n];
      a[x + y * n] = a[y + x * n];
      a[y + x * n] = t;
    }
}

/** A 2D FFT of an `n` × `n` grid: rows, then columns as rows of it mirrored (memory read in order); `sign` -1 forward, 1 inverse (unscaled). */
function fft2(re: Float64Array, im: Float64Array, n: number, sign: number) {
  const cos = Float64Array.from({ length: n / 2 }, (_, k) => Math.cos((2 * Math.PI * k) / n));
  const sin = Float64Array.from({ length: n / 2 }, (_, k) => sign * Math.sin((2 * Math.PI * k) / n));
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < n; y++) fft(re, im, n, y * n, 1, cos, sin);
    transpose(re, n);
    transpose(im, n);
  }
}

/**
 * A seamless normal map of a rough surface, made once, shared by all bumpy materials. Real ground and blasted surfaces
 * are fractal: their heights' spectrum falls as f^-2(H+1). White noise is shaped to that in frequency space, between
 * waves of TILE / 4 mm and about 0.25 mm, and its slopes taken there exactly (times i·2πf): periodic by construction.
 */
function bumpMap() {
  if (pattern) return pattern;
  const [n, H, low, high] = [512, 0.7, 4, 96]; // px; roughness exponent; waves per tile where it starts and fades
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const re = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) re[i] = random() - 0.5;
  const im = new Float64Array(n * n);
  fft2(re, im, n, -1);
  // both slopes in one inverse: i·kx·h + i·(i·ky·h), each real, the first lands in re, the second in im
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const kx = x <= n / 2 ? x : x - n;
      const ky = y <= n / 2 ? y : y - n;
      const f2 = kx * kx + ky * ky;
      // (f² / (f² + low²))² · f^-(H+1) · e^-(f / high)²
      const a = x === n / 2 || y === n / 2 || f2 === 0 ? 0 : (f2 / (f2 + low * low)) ** 2 * Math.exp(-0.5 * (H + 1) * Math.log(f2) - f2 / (high * high));
      const i = x + y * n;
      const hr = re[i] * a;
      const hi = im[i] * a;
      re[i] = -kx * hi - ky * hr;
      im[i] = kx * hr - ky * hi;
    }
  fft2(re, im, n, 1);
  let sum = 0;
  for (let i = 0; i < n * n; i++) sum += re[i] * re[i] + im[i] * im[i];
  const k = 0.5 / Math.sqrt(sum / (n * n)); // slopes 0.5 on average (before the bump strength)
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const x = -re[i] * k;
    const y = -im[i] * k;
    const l = 127.5 / Math.sqrt(x * x + y * y + 1);
    data[i * 4] = 127.5 + x * l;
    data[i * 4 + 1] = 127.5 + y * l;
    data[i * 4 + 2] = 127.5 + l;
    data[i * 4 + 3] = 255;
  }
  pattern = new THREE.DataTexture(data, n, n);
  Object.assign(pattern, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, anisotropy: 4, needsUpdate: true });
  return pattern;
}

/**
 * Gives a body's mesh texture coordinates in mm / TILE, each triangle projected along its own normal's main axis (one
 * corner shared by triangles looking along different axes is doubled, so no triangle smears across two projections;
 * `userData.weld`: each corner's original, for what finds neighbours by corners).
 */
export function boxUv(geometry: THREE.BufferGeometry) {
  if (geometry.attributes.uv) return;
  const p = geometry.attributes.position;
  const xyz = p.array;
  const index = geometry.index?.array ?? Uint32Array.from({ length: p.count }, (_, i) => i);
  const weld: number[] = Array.from({ length: p.count }, (_, i) => i);
  const axisOf: number[] = Array.from({ length: p.count }, () => -1); // grows with the copies
  const copies = new Map<number, number>(); // corner * 3 + axis: its copy
  const out = new Uint32Array(index.length);
  for (let t = 0; t < index.length; t += 3) {
    const o = index[t] * 3;
    const q = index[t + 1] * 3;
    const r = index[t + 2] * 3;
    const ux = xyz[q] - xyz[o];
    const uy = xyz[q + 1] - xyz[o + 1];
    const uz = xyz[q + 2] - xyz[o + 2];
    const vx = xyz[r] - xyz[o];
    const vy = xyz[r + 1] - xyz[o + 1];
    const vz = xyz[r + 2] - xyz[o + 2];
    const x = Math.abs(uy * vz - uz * vy);
    const y = Math.abs(uz * vx - ux * vz);
    const z = Math.abs(ux * vy - uy * vx);
    const axis = z >= x && z >= y ? 2 : y >= x ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const v = index[t + k];
      if (axisOf[v] < 0 || axisOf[v] === axis) {
        axisOf[v] = axis;
        out[t + k] = v;
        continue;
      }
      let copy = copies.get(v * 3 + axis);
      if (copy === undefined) copies.set(v * 3 + axis, (copy = weld.push(v) - 1));
      out[t + k] = copy;
    }
  }
  for (const [key, copy] of copies) axisOf[copy] = key % 3;
  // the copies appended: every attribute of the corner they double
  if (copies.size) {
    for (const [name, attr] of Object.entries(geometry.attributes) as [string, THREE.BufferAttribute][]) {
      const size = attr.itemSize;
      const grown = new (attr.array.constructor as Float32ArrayConstructor)(weld.length * size);
      grown.set(attr.array as Float32Array);
      for (let i = p.count; i < weld.length; i++) for (let j = 0; j < size; j++) grown[i * size + j] = (attr.array as Float32Array)[weld[i] * size + j];
      geometry.setAttribute(name, new THREE.BufferAttribute(grown, size, attr.normalized));
    }
    geometry.setIndex(new THREE.BufferAttribute(out, 1));
    geometry.userData.weld = Uint32Array.from(weld);
  }
  const all = geometry.attributes.position.array;
  const uv = new Float32Array(axisOf.length * 2);
  for (let i = 0; i < axisOf.length; i++) {
    // along z: x, y; along y: x, z; along x: y, z
    const axis = axisOf[i] < 0 ? 2 : axisOf[i];
    uv[i * 2] = all[i * 3 + (axis === 0 ? 1 : 0)] / TILE;
    uv[i * 2 + 1] = all[i * 3 + (axis === 2 ? 1 : 2)] / TILE;
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
