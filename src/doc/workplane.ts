import { add, cross, dot, norm, scale, sub, type Frame, type V3 } from './frames';

/** Rotates `v` around the unit direction `k` by `a` radians (Rodrigues). */
const turned = (v: V3, k: V3, a: number): V3 => add(add(scale(v, Math.cos(a)), scale(cross(k, v), Math.sin(a))), scale(k, dot(k, v) * (1 - Math.cos(a))));

/**
 * A work plane's frame (world): its base frame, then through its points (one: turned around its axis until it passes
 * through it; two: through both, its normal as near the base's as that lets; three: through all three), else turned
 * `turn` degrees around its axis (none set: its own x through its origin); moved `offset` along its normal last. Its x
 * runs from the first point to the second (fewer: as near the base's as the plane lets).
 */
export function workFrame(base: Frame, offset: number, turn: number, axis: { at: V3; dir: V3 } | null, points: V3[]): Frame {
  const line = axis ? { at: axis.at, dir: norm(axis.dir) } : { at: base.o, dir: norm(base.x) };
  let [o, n] = [base.o, norm(base.n)];
  const facing = (v: V3) => (dot(v, n) < 0 ? scale(v, -1) : v); // the side the base faced
  const [p1, p2, p3] = points;
  if (p3) [o, n] = [p1, facing(norm(cross(sub(p2, p1), sub(p3, p1))))];
  else if (p2) {
    const d = norm(sub(p2, p1));
    const off = sub(n, scale(d, dot(n, d)));
    [o, n] = [p1, Math.hypot(...off) > 1e-9 ? norm(off) : norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]))];
  } else if (p1) {
    const w = cross(line.dir, sub(p1, line.at));
    if (Math.hypot(...w) > 1e-9) [o, n] = [line.at, facing(norm(w))];
  } else if (turn) {
    const a = (turn * Math.PI) / 180;
    [o, n] = [add(line.at, turned(sub(o, line.at), line.dir, a)), turned(n, line.dir, a)];
  }
  // x: from the first point to the second, else the base's laid into the plane (else any line in it)
  const lay = p2 ? sub(p2, p1) : sub(base.x, scale(n, dot(base.x, n)));
  const x = Math.hypot(...lay) > 1e-9 ? norm(lay) : norm(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return { o: add(o, scale(n, offset)), x, y: cross(n, x), n };
}
