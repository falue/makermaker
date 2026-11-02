import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { STILL } from '../doc/frames';
import { areasOf, buildBody, FeatureError, meshBody, type BuildFeature, type Finishing } from './build';

const wasm = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'));

beforeAll(async () => setOC(await init({ wasmBinary: wasm })), 60_000);

const ground = { kind: 'base', axis: 'xy', offset: 0 } as const;
const base = (w: number, depth = 4): BuildFeature => ({
  id: 'base',
  type: 'extrude',
  plane: ground,
  profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w, h: 60, r: 0, rot: 0 }],
  depth,
  mode: 'add',
  through: false,
});
const hole: BuildFeature = {
  id: 'h1',
  type: 'extrude',
  plane: ground,
  profiles: [{ id: 'c', kind: 'circle', x: 20, y: 10, d: 5 }],
  depth: 0,
  mode: 'cut',
  through: true,
};
const plate = (w: number, ...more: BuildFeature[]): BuildFeature[] => [base(w), hole, ...more];
const corners: BuildFeature = { id: 'f1', type: 'finish', mode: 'fillet', size: 6, edges: 'vertical', enabled: true, baked: false, skip: [] };

const built = (features: BuildFeature[]) => {
  const shape = buildBody(features);
  const info = { faces: shape.faces.length, box: shape.boundingBox };
  return { ...info, done: () => shape.delete() };
};

describe('buildBody', () => {
  it('keeps a rule-based fillet on the corners when the base width changes', () => {
    for (const w of [100, 140]) {
      const raw = built(plate(w));
      const filleted = built(plate(w, corners));
      // 4 corner fillets add 4 cylindrical faces; the hole seam is not touched
      expect(filleted.faces).toBe(raw.faces + 4);
      expect(filleted.box.width).toBeCloseTo(w, 3);
      raw.done();
      filleted.done();
    }
  });

  it('lists each body corner once', async () => {
    const { meshBody } = await import('./build');
    const shape = buildBody([base(100)]);
    expect(meshBody(shape).corners.length).toBe(8 * 3);
    shape.delete();
  });

  it('skips disabled finishes', () => {
    const raw = built(plate(100));
    const off = built(plate(100, { ...corners, enabled: false }));
    expect(off.faces).toBe(raw.faces);
    raw.done();
    off.done();
  });

  it('adds a boss on the top face that follows the base depth', () => {
    const boss: BuildFeature = {
      id: 'boss',
      type: 'extrude',
      plane: { kind: 'cap', feature: 'base' },
      profiles: [{ id: 'b', kind: 'circle', x: 0, y: 0, d: 20 }],
      depth: 10,
      mode: 'add',
      through: false,
    };
    for (const depth of [4, 8]) {
      const b = built([base(100, depth), boss]);
      expect(b.box.depth).toBeCloseTo(depth + 10, 3);
      b.done();
    }
  });

  it('reaches behind its sketch plane by `back`', () => {
    const both = built([{ ...base(100, 4), back: 6 } as BuildFeature]);
    const [[, , bottom], [, , top]] = both.box.bounds;
    expect([bottom, top].map((v) => +v.toFixed(3))).toEqual([-6, 4]);
    both.done();
    const down = built([{ ...base(100, -4), back: 6 } as BuildFeature]); // pulled down: back reaches up
    expect(down.box.bounds.map((b) => +b[2].toFixed(3))).toEqual([-4, 6]);
    down.done();
  });

  it('cuts a body by a plane, turned, or along a line, keeping either side', () => {
    const plane = (side: 1 | -1, turn = 0, axis: { at: number[]; dir: number[] } | null = null) =>
      ({ id: 's', type: 'split', cutter: { kind: 'plane', o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0], turn, axis, offset: 10 }, side }) as BuildFeature;
    const right = built([base(100), plane(1)]);
    expect(right.box.width).toBeCloseTo(40, 3); // x from 10 to 50
    right.done();
    const left = built([base(100), plane(-1)]);
    expect(left.box.width).toBeCloseTo(60, 3);
    left.done();
    const turned = built([base(100), plane(1, 30, { at: [0, 0, 0], dir: [0, 0, 1] })]); // turned 30° around Z: a slanted cut across the plate
    expect(turned.box.width).toBeGreaterThan(40);
    turned.done();
    // a zig-zag line across the plate (y from -30 to 30), along y: its left is -x
    const zig = { id: 'z', kind: 'line' as const, pts: [[0, -40], [5, -10], [-5, 10], [0, 40]] as [number, number][] };
    const line = (side: 1 | -1) => ({ id: 's', type: 'split', cutter: { kind: 'frame', frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, profile: zig, offset: 0 }, side }) as BuildFeature;
    const west = built([base(100), line(1)]);
    const [[x0], [x1]] = west.box.bounds;
    expect(x0).toBeCloseTo(-50, 3);
    expect(x1).toBeGreaterThan(0);
    expect(x1).toBeLessThan(5.01);
    west.done();
    // a straight line along y moved 5 mm to its left (-x): the west part ends there
    const straight = { id: 'y', kind: 'line' as const, pts: [[0, -40], [0, 40]] as [number, number][] };
    const moved = built([base(100), { id: 's', type: 'split', cutter: { kind: 'frame', frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, profile: straight, offset: 5 }, side: 1 } as BuildFeature]);
    expect(moved.box.bounds[1][0]).toBeCloseTo(-5, 3);
    moved.done();
  });

  it('cuts a blind pocket into the top face', () => {
    const pocket: BuildFeature = {
      id: 'pocket',
      type: 'extrude',
      plane: { kind: 'cap', feature: 'base' },
      profiles: [{ id: 'p', kind: 'polygon', pts: [[-10, -10], [10, -10], [0, 10]], r: 0, rot: 0 }],
      depth: -2,
      mode: 'cut',
      through: false,
    };
    const raw = built([base(100)]);
    const cut = built([base(100), pocket]);
    expect(cut.faces).toBe(raw.faces + 4); // 3 walls and the floor
    expect(cut.box.depth).toBeCloseTo(4, 3);
    raw.done();
    cut.done();
  });

  it('makes shapes inside other shapes holes (even-odd)', () => {
    const plateWithHole: BuildFeature = {
      ...(base(100) as Extract<BuildFeature, { type: 'extrude' }>),
      profiles: [
        { id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 60, r: 0, rot: 0 },
        { id: 'c', kind: 'circle', x: 0, y: 0, d: 20 },
      ],
    };
    const raw = built([base(100)]);
    const holed = built([plateWithHole]);
    expect(holed.faces).toBeGreaterThan(raw.faces); // the hole wall (the 2D cut may split it in two)
    raw.done();
    holed.done();
  });

  it('finds the areas lines close, a line across splitting them, and extrudes one', () => {
    const l = (id: string, ...pts: [number, number][]) => ({ id, kind: 'line' as const, pts });
    const shapes = [l('a', [-2, 0], [12, 0]), l('b', [10, -2], [10, 12]), l('c', [12, 10], [-2, 10]), l('d', [0, 12], [0, -2]), l('e', [-3, 4], [13, 4])];
    const areas = areasOf(shapes);
    expect(areas).toHaveLength(2);
    const lower = areas.find((a) => a.at![1] < 4)!;
    const body = built([{ id: 'x', type: 'extrude', plane: ground, profiles: shapes, areas: [{ in: [], out: [], at: lower.at }], depth: 5, mode: 'add', through: false } as BuildFeature]);
    expect(body.box.width).toBeCloseTo(10, 3);
    expect(body.box.height).toBeCloseTo(4, 3);
    body.done();
  });

  it('splits overlapping shapes into areas and extrudes only the picked ones', async () => {
    const { areasOf } = await import('./build');
    const rect = { id: 'r', kind: 'rect' as const, x: 0, y: 0, w: 20, h: 10, r: 0, rot: 0 };
    const disc = { id: 'c', kind: 'circle' as const, x: 10, y: 0, d: 8 };
    const areas = areasOf([rect, disc]);
    expect(areas.map((a) => `${a.in.join('+')}|${a.out.join('+')}`).sort()).toEqual(['c|r', 'r+c|', 'r|c']);
    const lens = areas.find((a) => a.in.length === 2)!;
    const feature: BuildFeature = { id: 'x', type: 'extrude', plane: ground, profiles: [rect, disc], areas: [{ in: lens.in, out: lens.out }], depth: 3, mode: 'add', through: false };
    const b = built([feature]);
    expect(b.box.width).toBeCloseTo(4, 3); // the lens: from x 6 to 10
    expect(b.box.height).toBeCloseTo(8, 3);
    b.done();
  });

  it('joins, cuts and intersects with a tool body', () => {
    const pin: BuildFeature[] = [{ id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'c', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 20, mode: 'add', through: false }];
    const slab = base(100); // 100 x 60 x 4 at the origin
    const cut = built([slab, { id: 'b', type: 'boolean', op: 'subtract', features: pin, place: { ...STILL, offset: [0, 0, -5] } }]);
    const plain = built([slab]);
    expect(cut.faces).toBeGreaterThan(plain.faces); // the hole wall
    const both = built([slab, { id: 'b', type: 'boolean', op: 'intersect', features: pin, place: { ...STILL, offset: [0, 0, -5] } }]);
    expect(both.box.width).toBeCloseTo(10, 2); // only the overlap: a 10 mm disc, 4 mm thick
    expect(both.box.depth).toBeCloseTo(4, 2);
    [cut, plain, both].forEach((x) => x.done());
  });

  it('an unbaked finish also finishes later cuts; a baked one is cut through; skipped edges stay sharp', () => {
    const pin: BuildFeature[] = [{ id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'c', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 20, mode: 'add', through: false }];
    const cut: BuildFeature = { id: 'b', type: 'boolean', op: 'subtract', features: pin, place: { ...STILL, offset: [0, 0, -5] } };
    const top: BuildFeature = { id: 't', type: 'finish', mode: 'chamfer', size: 1, edges: 'top', enabled: true, baked: false, skip: [] };
    const unbaked = built([base(100), top, cut]);
    const baked = built([base(100), { ...top, baked: true }, cut]);
    expect(unbaked.faces).toBe(baked.faces + 1); // the hole's top edge is chamfered only when unbaked
    const skipped = built([base(100), { ...top, skip: [[0, 30, 4]] }, cut]); // the middle of the back top edge
    expect(skipped.faces).toBe(unbaked.faces - 1);
    [unbaked, baked, skipped].forEach((x) => x.done());
  });

  it('marks the faces and edges an unbaked finish made', () => {
    const finishing: Finishing = { base: null, edges: [] };
    const shape = buildBody([base(100), corners], finishing);
    const m = meshBody(shape, finishing);
    expect(m.finishes.length).toBe(4); // the vertical corner edges
    expect([...m.finishFaces].filter((k) => k >= 0).length).toBe(4); // one round face each
    expect([...m.finishEdges].filter(Boolean).length).toBe(8); // their tangent edges
    shape.delete();
    finishing.base?.delete();
  });

  it('builds regular polygons and spheres', () => {
    const hex: BuildFeature = { id: 'h', type: 'extrude', plane: ground, profiles: [{ id: 'n', kind: 'ngon', x: 0, y: 0, d: 20, sides: 6, rot: 0 }], depth: 5, mode: 'add', through: false };
    const prism = built([hex]);
    expect(prism.faces).toBe(8);
    expect(prism.box.height).toBeCloseTo(20, 3); // a corner points up (+y)
    prism.done();
    const ball = built([{ id: 's', type: 'sphere', x: 0, y: 0, z: 7, d: 14 }]);
    expect(ball.box.depth).toBeCloseTo(14, 2);
    ball.done();
  });

  it('reports a sketch plane whose feature is gone', () => {
    const orphan: BuildFeature = { ...hole, id: 'o', plane: { kind: 'cap', feature: 'gone' } };
    expect(() => buildBody([base(100), orphan])).toThrow(/sketch plane lost/);
  });

  it('reports the failing feature instead of guessing', () => {
    try {
      buildBody(plate(100, { ...corners, size: 40 }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FeatureError);
      expect((err as FeatureError).featureId).toBe('f1');
    }
  });
});

describe('picked edges', () => {
  // a 40 × 60 × 4 block: one vertical edge picked by points along it
  const edge = (x: number, y: number) => [[x, y, 0], [x, y, 2], [x, y, 4]] as [number, number, number][];
  const one = (mode: 'fillet' | 'chamfer', at = edge(20, 30)): BuildFeature => ({ id: 'p', type: 'finish', mode, size: 2, edges: { pts: [at] }, enabled: true, baked: false, skip: [] });

  it('chamfers only the picked edge', () => {
    const b = built([base(40), one('chamfer')]);
    expect(b.faces).toBe(7); // the box's 6 faces and one chamfer
    b.done();
  });

  it('fillets only the picked edge', () => {
    const b = built([base(40), one('fillet')]);
    expect(b.faces).toBe(7);
    b.done();
  });

  it('reports picked edges that are gone', () => {
    const gone = one('fillet', edge(99, 99));
    expect(() => buildBody([base(40), gone])).toThrow('picked edges are gone');
  });
});
