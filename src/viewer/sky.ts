import * as THREE from 'three';
import type { Backdrop } from '../doc/types';

/**
 * Sky presets: every third hour of the "sky gradients" CodePen by billyysea (CSS stops: `at` 0 straight up, 1
 * straight down), blended over a wide band around the horizon.
 */
export const SKIES: [string, Backdrop][] = (
  [
    ['Midnight', [['#00000c', 0]]],
    ['3 am', [['#020111', 0.1], ['#3a3a52', 1]]],
    ['6 am', [['#4a4969', 0], ['#7072ab', 0.5], ['#cd82a0', 1]]],
    ['9 am', [['#94c5f8', 0.01], ['#a6e6ff', 0.7], ['#b1b5ea', 1]]],
    ['Noon', [['#90dffe', 0], ['#38a3d1', 1]]],
    ['3 pm', [['#2473ab', 0], ['#1e528e', 0.7], ['#5b7983', 1]]],
    ['6 pm', [['#154277', 0], ['#576e71', 0.3], ['#e1c45e', 0.7], ['#b26339', 1]]],
    ['9 pm', [['#010a10', 0.3], ['#59230b', 0.8], ['#2f1107', 1]]],
  ] as [string, [string, number][]][]
).map(([name, stops]) => [name, { stops: stops.map(([color, at]) => ({ color, at })), band: 25 }]);

/** A two-colour background: top above the horizon, bottom below, changing sharply at it. */
export const twoColours = (top: string, bottom: string): Backdrop => ({
  stops: [
    { color: top, at: 0 },
    { color: bottom, at: 1 },
  ],
  band: 4,
});

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The colour at `at` (0 top .. 1 bottom) between a backdrop's stops. */
function colourAt(b: Backdrop, at: number) {
  const s = b.stops;
  const i = s.findIndex((x) => x.at >= at);
  if (i <= 0) return rgb(s[i < 0 ? s.length - 1 : 0].color);
  const [p, q] = [s[i - 1], s[i]];
  const k = (at - p.at) / (q.at - p.at || 1);
  const [a, c] = [rgb(p.color), rgb(q.color)];
  return a.map((v, j) => Math.round(v + (c[j] - v) * k));
}

/**
 * Ortho has no horizon: where (NDC, up positive) the ground (z 0) crosses the screen plane through `at` (the point
 * looked at), so a level view fades there; tilted, the fade moves off as in perspective. Perspective: 0 (its horizon
 * lies far off).
 */
export function groundShift(camera: THREE.Camera, at: THREE.Vector3) {
  if (!(camera instanceof THREE.OrthographicCamera)) return 0;
  camera.updateMatrixWorld(); // as it is now, not as last drawn
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  if (up.z < 0.1) return 0; // looking almost straight up or down: off the picture anyway
  return at.clone().addScaledVector(up, -at.z / up.z).project(camera).y;
}

/**
 * The background around the horizon as the camera sees it: for each picture row the elevation of the ray through it
 * picks the colour (the band of the backdrop spans the stops). `pitch`: the camera's elevation (radians, up
 * positive); `tanHalf`: tangent of half its vertical field of view. The camera has no roll (z stays up), so a row has
 * one colour.
 */
export function drawSky(g: CanvasRenderingContext2D, width: number, height: number, pitch: number, tanHalf: number, b: Backdrop, shift = 0) {
  const edge = (b.band * Math.PI) / 180;
  for (let y = 0; y < height; y++) {
    const ndc = 1 - ((y + 0.5) / height) * 2 - shift; // 1 at the top row; ortho: counted from the ground's line (`groundShift`)
    const up = Math.sin(pitch) + Math.cos(pitch) * ndc * tanHalf;
    const elevation = Math.asin(up / Math.hypot(1, ndc * tanHalf));
    const t = Math.min(1, Math.max(0, (elevation + edge) / (2 * edge)));
    g.fillStyle = `rgb(${colourAt(b, 1 - t * t * (3 - 2 * t)).join(',')})`; // smoothstep, 1 - : stops run top to bottom
    g.fillRect(0, y, width, 1);
  }
}

/** A backdrop as a CSS background (a preview: the stops over the whole height). */
export const backdropCss = (b: Backdrop) =>
  b.stops.length === 1 ? b.stops[0].color : `linear-gradient(${b.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ')})`;
