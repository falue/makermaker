import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { makeBox, setOC } from 'replicad';
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
  it('puts each number beside the view its face looks toward, a circle and a line to it', () => {
    const box = makeBox([0, 0, 0], [40, 30, 20]);
    const key = legend([box], [
      { n: 1, at: [20, 15, 20], dir: [0, 0, 1] },
      { n: 2, at: [20, 15, 0], dir: [0, 0, -1] },
    ])!;
    box.delete();
    expect(key.notes.map((t) => t.text)).toEqual(['1', 'from the front, above', '2', 'from behind, below']);
    expect(key.cuts.every((c) => c.key)).toBe(true);
    // number 1 in the left view, 2 in the right one
    const [one, two] = ['1', '2'].map((t) => key.notes.find((l) => l.text === t)!.at[0]);
    expect(one).toBeLessThan(two);
  });
});
