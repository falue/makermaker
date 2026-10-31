/**
 * The background gradient around the horizon, as the camera sees it: for each picture row the elevation of the ray
 * through it decides the colour (bottom below `band`° down, top above `band`° up, a smooth blend between). `pitch`:
 * the camera's elevation (radians, up positive); `tanHalf`: tangent of half its vertical field of view. The camera
 * has no roll (z stays up), so a row has one colour.
 */
export function drawSky(g: CanvasRenderingContext2D, width: number, height: number, pitch: number, tanHalf: number, top: string, bottom: string, band = 25) {
  const [a, b] = [rgb(bottom), rgb(top)];
  const edge = (band * Math.PI) / 180;
  for (let y = 0; y < height; y++) {
    const ndc = 1 - ((y + 0.5) / height) * 2; // 1 at the top row
    const up = Math.sin(pitch) + Math.cos(pitch) * ndc * tanHalf;
    const elevation = Math.asin(up / Math.hypot(1, ndc * tanHalf));
    const t = Math.min(1, Math.max(0, (elevation + edge) / (2 * edge)));
    const k = t * t * (3 - 2 * t); // smoothstep
    g.fillStyle = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
    g.fillRect(0, y, width, 1);
  }
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
