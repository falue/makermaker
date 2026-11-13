import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { makeBox, makeCylinder, setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { legend, view } from './legend';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));
beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v)) as [number, number, number];
const dot = (a: number[], b: number[]) => a.reduce((n, x, i) => n + x * b[i], 0);

describe('legend', () => {
  it('sees a box from its front right top corner: three edges meet at the near corner, the far one is hidden', () => {
    const box = makeBox([0, 0, 0], [40, 30, 20]);
    const { lines, x, y } = view(box, unit([1, -1, 1]));
    box.delete();
    expect(lines).toHaveLength(9);
    const at = (p: number[]) => [dot(p, x), dot(p, y)];
    const ends = (p: number[]) => lines.filter((l) => [l[0], l.at(-1)!].some((q) => Math.hypot(q[0] - at(p)[0], q[1] - at(p)[1]) < 1e-6)).length;
    expect(ends([40, 0, 20])).toBe(3);
    expect(ends([0, 30, 0])).toBe(0);
  });
  it('draws where faces meet smoothly, and seams', () => {
    // a cylinder seen from above the side, its seam toward the eye: its two rims (the far half of the bottom one hidden), two outlines and the seam
    const can = makeCylinder(10, 30).rotate(-45, [0, 0, 0], [0, 0, 1]);
    const seen = view(can, unit([1, -1, 1]));
    can.delete();
    const straight = seen.lines.filter((l) => l.length === 2);
    expect(straight).toHaveLength(3);
    // a box with rounded upright edges: 15 sharp edges and 2 outlines, and the 4 borders of its rounds seen
    const box = makeBox([0, 0, 0], [40, 30, 20]).fillet(5, (e) => e.inDirection('Z'));
    const round = view(box, unit([1, -1, 1]));
    box.delete();
    expect(round.lines).toHaveLength(21);
  });
  it('puts each number in the view its face looks toward: on the face where there is room, else beside it with a line', () => {
    const box = makeBox([0, 0, 0], [40, 30, 20]);
    const key = legend([box], [
      { n: 1, at: [20, 15, 20], dir: [0, 0, 1] },
      { n: 2, at: [20, 15, 0], dir: [0, 0, -1] },
    ])!;
    box.delete();
    expect(key.notes.map((t) => t.text)).toEqual(['1', 'from the front, above', '2', 'from behind, below']);
    expect(key.cuts.every((c) => c.key)).toBe(true);
    // number 1 in the left view, 2 in the right one; both on their faces, no lines to them
    const [one, two] = ['1', '2'].map((t) => key.notes.find((l) => l.text === t)!.at[0]);
    expect(one).toBeLessThan(two);
    expect(key.cuts.filter((c) => c.circle)).toHaveLength(2);
    // a face too small for its circle: beside the view, a line and a dot at the face
    const small = makeBox([0, 0, 0], [4, 3, 2]);
    const tight = legend([small], [{ n: 1, at: [2, 1.5, 2], dir: [0, 0, 1] }])!;
    small.delete();
    expect(tight.cuts.filter((c) => c.circle)).toHaveLength(2);
    expect(tight.cuts.filter((c) => c.open && c.pts.length === 2 && !c.circle).length).toBeGreaterThan(9);
  });
  it('dots the circle of a number whose face does not show in its view', () => {
    const outer = makeBox([0, 0, 0], [40, 30, 20]);
    const inner = makeBox([2, 2, 2], [38, 28, 18]);
    const hollow = outer.cut(inner);
    [outer, inner].forEach((s) => s.delete());
    const key = legend([hollow], [
      { n: 1, at: [20, 15, 20], dir: [0, 0, 1] },
      { n: 2, at: [20, 15, 2], dir: [0, 0, 1] }, // the floor inside: behind the lid
    ])!;
    hollow.delete();
    // 1 in a whole circle, 2 in 8 dashes (a line's dot at the face is a small circle)
    expect(key.cuts.filter((c) => c.circle?.r === 3)).toHaveLength(1);
    expect(key.cuts.filter((c) => c.open && c.pts.length === 2 && Math.hypot(c.pts[1][0] - c.pts[0][0], c.pts[1][1] - c.pts[0][1]) < 2)).toHaveLength(8);
  });
});

