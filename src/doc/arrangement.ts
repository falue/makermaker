import { bounds, inside, segments, segPoints, type DrawnProfile } from './profiles';

type UV = [number, number];
type Box = [number, number, number, number];

const cross = (a: UV, b: UV) => a[0] * b[1] - a[1] * b[0];
const sub = (a: UV, b: UV): UV => [a[0] - b[0], a[1] - b[1]];
const touch = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** The lines of a sketch and the closed shapes they reach (by bounding box, and on from those): what their faces need. */
export function lineUses(ps: (DrawnProfile & { id: string })[]): string[] {
  const boxes = ps.map((p) => bounds(p));
  const uses = new Set(ps.flatMap((p, i) => (p.kind === 'line' ? [i] : [])));
  for (let grew = uses.size > 0; grew; ) {
    grew = false;
    boxes.forEach((b, i) => !uses.has(i) && [...uses].some((k) => touch(b, boxes[k])) && (uses.add(i), (grew = true)));
  }
  return [...uses].map((i) => ps[i].id);
}

/**
 * Closed shapes in pieces that overlap or touch (pulled, each piece is one body): outlines (their true sides within
 * 1e-3 mm) that meet or cross, or one shape inside another (a hole in a plate), join theirs.
 */
export function pieces(ps: (DrawnProfile & { id: string })[], eps = 1e-6): string[][] {
  const outlines = ps.map((p) => segments(p).flatMap((g) => segPoints(g).slice(0, -1)));
  const boxes = ps.map((p) => bounds(p));
  const meet = (a: UV[], b: UV[]) =>
    a.some((p, i) => {
      const q = a[(i + 1) % a.length];
      return b.some((c, j) => {
        const d = b[(j + 1) % b.length];
        const [r, s] = [sub(q, p), sub(d, c)];
        const den = cross(r, s);
        if (Math.abs(den) < 1e-12) {
          // parallel: touching only on one line, where their spans along it overlap
          if (Math.abs(cross(sub(c, p), r)) > eps * Math.hypot(...r)) return false;
          const [t0, t1] = [c, d].map((x) => (sub(x, p)[0] * r[0] + sub(x, p)[1] * r[1]) / (r[0] ** 2 + r[1] ** 2 || 1));
          return Math.max(t0, t1) >= -eps && Math.min(t0, t1) <= 1 + eps;
        }
        const [t, u] = [cross(sub(c, p), s) / den, cross(sub(c, p), r) / den];
        return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps;
      });
    });
  const root = ps.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const near = a[0] <= b[2] + eps && b[0] <= a[2] + eps && a[1] <= b[3] + eps && b[1] <= a[3] + eps;
      if (near && (inside(ps[i], ...outlines[j][0]) || inside(ps[j], ...outlines[i][0]) || meet(outlines[i], outlines[j]))) root[find(i)] = find(j);
    }
  const groups = new Map<number, string[]>();
  ps.forEach((p, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(p.id));
  return [...groups.values()];
}

