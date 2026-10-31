import * as THREE from 'three';

let squircle: THREE.CanvasTexture | null = null;

/** A white squircle (|x|⁴ + |y|⁴ = 1) on transparent ground, the shape of every point marker. */
function squircleTexture(px = 64) {
  if (squircle) return squircle;
  const c = Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = c.getContext('2d')!;
  const r = px / 2 - 2;
  g.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    g.lineTo(px / 2 + r * Math.sign(cos) * Math.abs(cos) ** 0.5, px / 2 + r * Math.sign(sin) * Math.abs(sin) ** 0.5);
  }
  g.fillStyle = '#fff';
  g.fill();
  squircle = new THREE.CanvasTexture(c);
  return squircle;
}

/** Screen-size squircle markers (handles, snap points), drawn over everything. */
export function marks(points: THREE.Vector3[], color: number, size = 10) {
  return new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, map: squircleTexture(), transparent: true, alphaTest: 0.5 }),
  );
}
