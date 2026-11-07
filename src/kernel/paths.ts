type V3 = [number, number, number];

/** Points along a free edge and its unit directions there (see `pathOf` in exact.ts); pure, the main thread reads it. */
export type EdgePath = { pts: V3[]; dirs: V3[] };

/** The cubic from `p` to `q` leaving and arriving along unit `dp`, `dq` (handles a third of the chord), at `t`. */
export function hermite(p: V3, dp: V3, q: V3, dq: V3, t: number): V3 {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 3;
  const [c1, c2] = [[p[0] + dp[0] * l, p[1] + dp[1] * l, p[2] + dp[2] * l], [q[0] - dq[0] * l, q[1] - dq[1] * l, q[2] - dq[2] * l]];
  return [0, 1, 2].map((k) => (1 - t) ** 3 * p[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t ** 2 * c2[k] + t ** 3 * q[k]) as V3;
}

/** The point of a path nearest `q`: the nearest of its pieces' (each its cubic, searched then narrowed). */
export function nearestOnPath({ pts, dirs }: EdgePath, q: V3): V3 {
  const far = (p: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  let best: V3 = pts[0];
  for (let i = 0; i + 1 < pts.length; i++) {
    const at = (t: number) => hermite(pts[i], dirs[i], pts[i + 1], dirs[i + 1], t);
    let k = 0;
    for (let j = 1; j <= 8; j++) if (far(at(j / 8)) < far(at(k / 8))) k = j;
    let [lo, hi] = [Math.max(0, k - 1) / 8, Math.min(8, k + 1) / 8];
    for (let n = 0; n < 50; n++) {
      const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
      if (far(at(m1)) < far(at(m2))) hi = m2;
      else lo = m1;
    }
    const p = at((lo + hi) / 2);
    if (far(p) < far(best)) best = p;
  }
  return best;
}

/** The point of a path farthest along `w` (a top of it), its pieces searched then narrowed. */
export function farthestOnPath({ pts, dirs }: EdgePath, w: V3): V3 {
  const along = (p: V3) => p[0] * w[0] + p[1] * w[1] + p[2] * w[2];
  let best: V3 = pts[0];
  for (let i = 0; i + 1 < pts.length; i++) {
    const at = (t: number) => hermite(pts[i], dirs[i], pts[i + 1], dirs[i + 1], t);
    let [lo, hi] = [0, 1];
    for (let n = 0; n < 50; n++) {
      const [m1, m2] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3];
      if (along(at(m1)) > along(at(m2))) hi = m2;
      else lo = m1;
    }
    for (const p of [at((lo + hi) / 2), pts[i + 1]]) if (along(p) > along(best)) best = p;
  }
  return best;
}
