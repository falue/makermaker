import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { measureVolume, setOC } from 'replicad';
import { beforeAll, describe, expect, it } from 'vitest';
import { STILL } from '../doc/frames';
import { areasOf, buildBody, FeatureError, meshBody, type BooleanBuild, type BuildFeature, type Finishing } from './build';

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

  it('cuts a real thread into a shaft and into a hole', () => {
    const shaft = { id: 'c', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 20, mode: 'add', through: false } as BuildFeature;
    const plain = built([shaft]);
    const m10 = built([shaft, { id: 't', type: 'thread', at: [0, 0, 0], dir: [0, 0, 1], r: 5, inside: false, size: 'M10', d: 10, pitch: 1.5, length: 20, modeled: true } as BuildFeature]);
    expect(m10.faces).toBeGreaterThan(plain.faces); // the groove's flanks
    expect(m10.box.width).toBeCloseTo(10, 1);
    plain.done();
    m10.done();
    const nut = built([base(30, 8), { id: 'h', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'circle', x: 0, y: 0, d: 8.4 }], depth: 8, mode: 'cut', through: true } as BuildFeature, { id: 't', type: 'thread', at: [0, 0, 0], dir: [0, 0, 1], r: 4.2, inside: true, size: 'M10', d: 10, pitch: 1.25, length: 8, modeled: true } as BuildFeature]);
    expect(nut.faces).toBeGreaterThan(8);
    nut.done();
  }, 60000);

  it('a thread in a block whose upright edges are rounded (unbaked): the fillet takes the block\'s four, not the groove\'s', () => {
    const block = { id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 30, h: 20, r: 0, rot: 0 }, { id: 'c', kind: 'circle', x: 0, y: 0, d: 6.6468 }], depth: 10, mode: 'add', through: false } as BuildFeature;
    const fillet = { id: 'f', type: 'finish', mode: 'fillet', size: 3, edges: 'vertical', enabled: true, baked: false, skip: [] } as BuildFeature;
    const thread = { id: 't', type: 'thread', at: [0, 0, 10], dir: [0, 0, -1], r: 3.3234, inside: true, size: 'M8', d: 8, pitch: 1.25, length: 10, modeled: true } as BuildFeature;
    const finishing: Finishing = { base: null, edges: [] };
    const shape = buildBody([block, fillet, thread], finishing);
    expect(finishing.edges).toHaveLength(4);
    shape.delete();
    finishing.base?.delete();
  }, 60000);

  it('a fillet too big for some edges holds those at the largest they take, the others as asked (as sketch corners)', () => {
    // a slab whose corner is cut by a 2 mm slanted side: its two upright edges there take far less than 8 mm
    const slab = { id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'polygon', pts: [[0, 0], [40, 0], [40, 20], [2, 20], [0, 18]], r: 0, rot: 0 }], depth: 5, mode: 'add', through: false } as BuildFeature;
    const fillet = { id: 'f', type: 'finish', mode: 'fillet', size: 8, edges: 'vertical', enabled: true, baked: false, skip: [] } as BuildFeature;
    const finishing: Finishing = { base: null, edges: [] };
    const shape = buildBody([slab, fillet], finishing);
    const volume = measureVolume(shape);
    shape.delete();
    finishing.base?.delete();
    const capped = finishing.capped?.f ?? [];
    expect(capped).toHaveLength(2); // the two beside the short side
    for (const c of capped) {
      expect(c.max).toBeGreaterThan(0);
      expect(c.max).toBeLessThan(8);
      expect(c.normals).toHaveLength(2); // its two faces, as a picked edge stores them
    }
    expect(finishing.edges.filter((e) => e.size === 8)).toHaveLength(3); // the other three corners as asked
    const full = 40 * 20 - 2; // the outline's area (the cut corner a 2 × 2 half square)
    expect(volume).toBeLessThan(full * 5 - 3 * 8 * 8 * (1 - Math.PI / 4) * 5 + 1); // three 8 mm roundings at least
  }, 120000);

  it('a fillet far too big on a thin plate holds its edges to sound sizes, never a broken solid reaching out (Frosted plate, R 32)', async () => {
    const { getOC } = await import('replicad');
    const plate = { id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 40, h: 40, r: 0, rot: 0 }], depth: 4, mode: 'add', through: false } as BuildFeature;
    const fillet = { id: 'f', type: 'finish', mode: 'fillet', size: 32, edges: 'all', enabled: true, baked: false, skip: [] } as BuildFeature;
    const finishing: Finishing = { base: null, edges: [] };
    let shape;
    try {
      shape = buildBody([plate, fillet], finishing);
    } catch (e) {
      expect(e).toBeInstanceOf(FeatureError); // too big even edge by edge: an error, not a broken body
      return;
    } finally {
      finishing.base?.delete();
    }
    const check = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true, false, false);
    expect(check.IsValid()).toBe(true);
    check.delete();
    const [lo, hi] = shape.boundingBox.bounds;
    expect(lo.every((v, k) => v > [-20, -20, 0][k] - 1e-3) && hi.every((v, k) => v < [20, 20, 4][k] + 1e-3)).toBe(true);
    expect(finishing.edges.every((e) => e.size <= 20 + 1e-9)).toBe(true); // no edge rounder than half the plate
    shape.delete();
  }, 300000);

  it('a cosmetic thread leaves the solid as it is and is drawn at its other Ø; a hole for one takes the tap drill', async () => {
    const { cosmeticOf } = await import('./build');
    const { boreFor } = await import('../doc/threads');
    const hole = { id: 'h', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'circle', x: 0, y: 0, d: boreFor(10, 1.5, true, false) }], depth: 8, mode: 'cut', through: true } as BuildFeature;
    const thread = { id: 't', type: 'thread', at: [0, 0, 0], dir: [0, 0, 1], r: 4.25, inside: true, size: 'M10', d: 10, pitch: 1.5, length: 8, modeled: false } as BuildFeature;
    expect(boreFor(10, 1.5, true, false)).toBeCloseTo(8.5, 9); // M10: the 8.5 drill
    expect(boreFor(10, 1.5, true, true)).toBeCloseTo(10 - 2 * 0.625 * 0.8660254 * 1.5, 9);
    const plain = built([base(30, 8), hole]);
    const cosmetic = built([base(30, 8), hole, thread]);
    expect(cosmetic.faces).toBe(plain.faces);
    plain.done();
    cosmetic.done();
    // its lines on the major Ø (a hole's), from 0 to 8 along z
    const lines = cosmeticOf([thread]);
    expect(lines.length).toBe((2 * 48 + 4) * 6);
    for (let i = 0; i < lines.length; i += 3) {
      expect(Math.hypot(lines[i], lines[i + 1])).toBeCloseTo(5, 6);
      expect([0, 8].some((z) => Math.abs(lines[i + 2] - z) < 1e-9)).toBe(true);
    }
    expect(cosmeticOf([{ ...thread, modeled: true } as BuildFeature])).toHaveLength(0);
  });

  it('bulges a flat face, a shaft and sketch shapes', () => {
    const bulge = (on: object, peak: number[], fullness = 1) => ({ id: 'b', type: 'bulge', on, fullness, peak }) as unknown as BuildFeature;
    // the plate's top (z 4) domed 10 mm: its rim stays, the peak reaches 14
    const domed = built([base(60), bulge({ kind: 'face', at: [0, 0, 4] }, [0, 0, 10])]);
    expect(domed.faces).toBe(6);
    expect(domed.box.bounds[1][2]).toBeCloseTo(14, 0);
    expect(domed.box.width).toBeCloseTo(60, 3);
    domed.done();
    // the peak far off the middle: it leans there (kept a little from the rim), no spikes above it, nothing below the rim
    for (const [x, y] of [[20, 10], [-25, 0], [12, -24]]) {
      const leaning = built([base(60), bulge({ kind: 'face', at: [0, 0, 4] }, [x, y, 10])]);
      expect(leaning.box.bounds[1][2]).toBeLessThan(15); // a little over near the rim, where it is steep
      expect(leaning.box.bounds[1][2]).toBeGreaterThan(13);
      expect(leaning.box.bounds[0][2]).toBeGreaterThan(-0.01);
      leaning.done();
    }
    // on a side face (its edges come in any order and direction): an even dome, still on the face
    const side = built([base(40, 30), bulge({ kind: 'face', at: [20, 0, 15] }, [10, 0, 0])]);
    expect(side.box.bounds[1][0]).toBeCloseTo(30, 0);
    expect(side.box.bounds[0][2]).toBeGreaterThan(-0.01);
    expect(side.box.bounds[1][2]).toBeLessThan(30.01);
    side.done();
    // pointy (-4: the smooth surface rounds its tip a little) and flat topped (4) reach about the same peak
    for (const k of [-4, 4]) {
      const shaped = built([base(60), bulge({ kind: 'face', at: [0, 0, 4] }, [0, 0, 10], k)]);
      expect(Math.abs(shaped.box.bounds[1][2] - 14)).toBeLessThan(1);
      shaped.done();
    }
    const dented = built([base(60, 20), bulge({ kind: 'face', at: [0, 0, 20] }, [0, 0, -5])]);
    expect(dented.box.bounds[1][2]).toBeCloseTo(20, 3); // the rim stays at the top
    dented.done();
    // a shaft Ø 10, 20 long, swelling 3 mm in its middle
    const shaft = { id: 'c', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 20, mode: 'add', through: false } as BuildFeature;
    const vase = built([shaft, bulge({ kind: 'round', at: [0, 0, 0], dir: [0, 0, 1], r: 5, length: 20, shaft: true }, [8, 0, 0])]);
    expect(vase.box.width).toBeCloseTo(16, 0);
    expect(vase.faces).toBe(3); // one smooth side: quick to mesh
    // a face with a hole: the dome joined, the hole drilled on through it (bottom, 4 sides, dome, the hole's wall)
    const holed = built([...plate(100), bulge({ kind: 'face', at: [0, 0, 4] }, [0, 0, 10])]);
    expect(holed.faces).toBe(7);
    expect(holed.box.bounds[1][2]).toBeCloseTo(14, 0);
    holed.done();
    expect(vase.box.bounds[1][2]).toBeCloseTo(20, 3);
    vase.done();
    const down = built([shaft, bulge({ kind: 'round', at: [0, 0, 20], dir: [0, 0, -1], r: 5, length: 20, shaft: true }, [8, 0, 0])]);
    expect(down.box.width).toBeCloseTo(16, 0);
    down.done();
    // a sketch circle Ø 30 on the ground: a dome 8 high of its own
    const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
    const own = built([bulge({ kind: 'frame', frame, profiles: [{ id: 'k', kind: 'circle', x: 0, y: 0, d: 30 }] }, [0, 0, 8])]);
    expect(own.box.bounds.map((b) => +b[2].toFixed(1))).toEqual([0, 8]);
    expect(own.box.width).toBeCloseTo(30, 0);
    own.done();
  }, 60000);

  it('cuts two overlapping bodies into interlocking fingers', async () => {
    const { measureVolume } = await import('replicad');
    // an upright sheet 4 thick over the plate's end (x 46..50): their overlap 60 long along y, 7 fingers
    const sheet: BuildFeature = { id: 's', type: 'extrude', plane: ground, profiles: [{ id: 'q', kind: 'rect', x: 48, y: 0, w: 4, h: 60, r: 0, rot: 0 }], depth: 40, mode: 'add', through: false };
    const fingers = (features: BuildFeature[], first: boolean) => ({ id: 'f', type: 'fingers', features, place: { offset: [0, 0, 0], axis: [0, 0, 1], angle: 0 }, count: 7, width: 0, first }) as BuildFeature;
    const slice = (60 / 7) * 4 * 4;
    const plate = buildBody([base(100), fingers([sheet], true)]);
    expect(measureVolume(plate)).toBeCloseTo(100 * 60 * 4 - 3 * slice, 0); // fingers 2, 4, 6 given up
    plate.delete();
    const upright = buildBody([sheet, fingers([base(100)], false)]);
    expect(measureVolume(upright)).toBeCloseTo(4 * 60 * 40 - 4 * slice, 0); // fingers 1, 3, 5, 7 given up
    upright.delete();
    // exactly 7 long from the low end (y -30): 8 whole and 4 left; the first gives up the 2nd, 4th, 6th and 8th
    const exact = (from?: number[]) => ({ ...(fingers([sheet], true) as object), width: 7, ...(from ? { from } : {}) }) as BuildFeature;
    const even = buildBody([base(100), exact()]);
    expect(measureVolume(even)).toBeCloseTo(100 * 60 * 4 - 4 * 7 * 16, 0);
    even.delete();
    // from y 0 both ways: -30..-28, -28..-21, …, 0..7, …, 28..30; it gives up the odd ones counted from 0: 2 + 4 × 7 long
    const centred = buildBody([base(100), exact([48, 0, 2])]);
    expect(measureVolume(centred)).toBeCloseTo(100 * 60 * 4 - (2 + 4 * 7) * 16, 0);
    centred.delete();
    // the sheet standing on the plate, only touching: it grows through the plate's 4
    const on = (features: BuildFeature[], first: boolean, z: number) => ({ ...(fingers(features, first) as object), place: { offset: [0, 0, z], axis: [0, 0, 1], angle: 0 } }) as BuildFeature;
    const under = buildBody([base(100), on([sheet], true, 4)]);
    expect(measureVolume(under)).toBeCloseTo(100 * 60 * 4 - 3 * slice, 0);
    under.delete();
    const grown = buildBody([sheet, on([base(100)], false, -4)]);
    expect(measureVolume(grown)).toBeCloseTo(4 * 60 * 40 + 7 * slice - 4 * slice, 0);
    grown.delete();
    expect(() => buildBody([sheet, on([base(100)], false, -5)])).toThrow();
    // meeting only along an edge (the sheet beside the plate's end, on top of it): both grow into the corner between them
    const at = (features: BuildFeature[], first: boolean, d: number) => ({ ...(fingers(features, first) as object), place: { offset: [d, 0, d], axis: [0, 0, 1], angle: 0 } }) as BuildFeature;
    const plateEdge = buildBody([base(100), at([sheet], true, 4)]);
    expect(measureVolume(plateEdge)).toBeCloseTo(100 * 60 * 4 + 7 * slice - 3 * slice, 0);
    plateEdge.delete();
    const sheetEdge = buildBody([sheet, at([base(100)], false, -4)]);
    expect(measureVolume(sheetEdge)).toBeCloseTo(4 * 60 * 40 + 7 * slice - 4 * slice, 0);
    sheetEdge.delete();
    // the sheet reaching only 2 into the plate: it grows the other 2 through it
    const partly = buildBody([sheet, on([base(100)], false, -2)]);
    expect(measureVolume(partly)).toBeCloseTo(4 * 60 * 40 + 4 * 60 * 2 - 4 * slice, 0);
    partly.delete();
    const plateOf = buildBody([base(100), on([sheet], true, 2)]);
    expect(measureVolume(plateOf)).toBeCloseTo(100 * 60 * 4 - 3 * slice, 0);
    plateOf.delete();
    // a clearance of 1: each cut 0.5 wider on both sides (not past the overlap's ends): a gap of 1 between fingers
    const loose = (features: BuildFeature[], first: boolean) => ({ ...(fingers(features, first) as object), clearance: 1 }) as BuildFeature;
    const plateLoose = buildBody([base(100), loose([sheet], true)]);
    expect(measureVolume(plateLoose)).toBeCloseTo(100 * 60 * 4 - 3 * (slice + 16), 0);
    plateLoose.delete();
    const uprightLoose = buildBody([sheet, loose([base(100)], false)]);
    expect(measureVolume(uprightLoose)).toBeCloseTo(4 * 60 * 40 - 4 * slice - 3 * 16, 0);
    uprightLoose.delete();
  });

  it('keeps one piece of a body in separate pieces, in order along x', async () => {
    const { measureVolume } = await import('replicad');
    // two blocks apart in one extrusion: 10 wide at x -20, 20 wide at x 20
    const two: BuildFeature = { id: 't', type: 'extrude', plane: ground, profiles: [{ id: 'a', kind: 'rect', x: 20, y: 0, w: 20, h: 10, r: 0, rot: 0 }, { id: 'b', kind: 'rect', x: -20, y: 0, w: 10, h: 10, r: 0, rot: 0 }], depth: 10, mode: 'add', through: false };
    const piece = (index: number) => ({ id: 'p', type: 'piece', index }) as BuildFeature;
    const whole = buildBody([two]);
    expect(whole.solids.length).toBe(2);
    whole.delete();
    for (const [k, volume] of [[0, 1000], [1, 2000]]) {
      const one = buildBody([two, piece(k)]);
      expect(measureVolume(one)).toBeCloseTo(volume, 3);
      one.delete();
    }
    expect(() => buildBody([two, piece(2)])).toThrow();
  });

  it('drafts a flat face about its hinge', async () => {
    const { measureVolume } = await import('replicad');
    // the plate's x 30 side (60 × 4 tall), hinged at its bottom: 5° in takes a wedge 4 tall, 4 tan 5° deep
    const draft = (angle: number) => ({ id: 'd', type: 'draft', at: [30, 0, 2], n: [1, 0, 0], axis: { at: [30, -30, 0], dir: [0, 1, 0] }, angle }) as BuildFeature;
    const wedge = 0.5 * 4 * 4 * Math.tan((5 * Math.PI) / 180) * 60;
    for (const [angle, sign] of [[5, -1], [-5, 1], [0, 0]]) {
      const drafted = buildBody([base(60), draft(angle)]);
      expect(measureVolume(drafted)).toBeCloseTo(60 * 60 * 4 + sign * wedge, 1);
      drafted.delete();
    }
  });

  it('pushes and pulls any flat face', () => {
    const push = (distance: number) => ({ id: 'p', type: 'push', at: [30, 0, 2], n: [1, 0, 0], distance }) as BuildFeature;
    const out = built([base(60), push(5)]);
    expect(out.box.width).toBeCloseTo(65, 3);
    expect(out.faces).toBe(6); // glued on: still a box
    out.done();
    const into = built([base(60), push(-5)]);
    expect(into.box.width).toBeCloseTo(55, 3);
    into.done();
  });

  it('mirrors a body across a plane', () => {
    const m = built([base(100), { id: 'm', type: 'mirror', o: [60, 0, 0], n: [1, 0, 0] } as BuildFeature]);
    expect(m.box.bounds[0][0]).toBeCloseTo(70, 3); // -50..50 mirrored at x = 60: 70..170
    m.done();
  });

  it('hollows a body to walls, its top left open', () => {
    const box = built([base(100, 20), { id: 'h', type: 'shell', thickness: 2, open: [[0, 0, 20]] } as BuildFeature]);
    expect(box.box.width).toBeCloseTo(100, 3); // the walls go inside: the outside stays
    expect(box.faces).toBe(11); // 5 outside, 5 inside, the rim on top
    box.done();
    const closed = built([base(100, 20), { id: 'h', type: 'shell', thickness: 2, open: [] } as BuildFeature]);
    expect(closed.faces).toBe(12); // 6 outside, 6 inside: hollow, closed
    expect(closed.box.width).toBeCloseTo(100, 3);
    closed.done();
  });

  it('hollows a chamfered body with its chamfers inside too, and a bulged one', () => {
    const chamfer = { id: 'c', type: 'finish', mode: 'chamfer', size: 6, edges: 'vertical', enabled: true, baked: false, skip: [] } as BuildFeature;
    const shell = { id: 'h', type: 'shell', thickness: 2, open: [[0, 0, 20]] } as BuildFeature;
    const box = built([base(100, 20), chamfer, shell]);
    expect(box.faces).toBe(11 + 8); // 4 chamfers outside, 4 inside
    box.done();
    // a domed top, hollowed (closed) and joined with a box
    const dome = { id: 'b', type: 'bulge', on: { kind: 'face', at: [0, 0, 20], mid: [0, 0, 20] }, fullness: 1, peak: [0, 0, 10] } as unknown as BuildFeature;
    const hollow = built([base(100, 20), dome, { id: 'h', type: 'shell', thickness: 2, open: [[0, 0, 0]] } as BuildFeature]);
    expect(hollow.box.bounds[1][2]).toBeCloseTo(30, 0);
    hollow.done();
  }, 60000);

  it('sweeps a circle along a bent line', () => {
    const ground = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
    const pipe = built([{ id: 'w', type: 'sweep', profile: { id: 'c', kind: 'circle', x: 50, y: 50, d: 6 }, path: { frame: ground, profile: { id: 'l', kind: 'line', pts: [[0, 0], [40, 0], [40, 30]] } } } as BuildFeature]);
    expect(pipe.box.width).toBeCloseTo(43, 0); // the line's 40 plus the tube's radius beyond its corner
    expect(pipe.box.depth).toBeCloseTo(6, 1);
    pipe.done();
  });

  it('revolves shapes around a line in their plane, and lofts through shapes', () => {
    // a 10 × 30 rectangle 10 to 20 mm right of the y axis, turned all the way around it: a ring Ø 40, 30 high (along y)
    const ring = built([{ id: 'r', type: 'revolve', plane: ground, profiles: [{ id: 'q', kind: 'rect', x: 15, y: 0, w: 10, h: 30, r: 0, rot: 0 }], axis: { at: [0, 0], dir: [0, 1] }, angle: 360, mode: 'add' } as BuildFeature]);
    expect(ring.box.width).toBeCloseTo(40, 1);
    expect(ring.box.height).toBeCloseTo(30, 1);
    ring.done();
    // a square 20 wide on the ground to a circle Ø 10 20 mm above it
    const at = (z: number) => ({ o: [0, 0, z], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] });
    const tower = built([{ id: 'l', type: 'loft', sections: [{ frame: at(0), profile: { id: 'a', kind: 'rect', x: 0, y: 0, w: 20, h: 20, r: 0, rot: 0 } }, { frame: at(20), profile: { id: 'b', kind: 'circle', x: 0, y: 0, d: 10 } }], ruled: false } as BuildFeature]);
    expect(tower.box.bounds.map((b) => +b[2].toFixed(3) + 0)).toEqual([0, 20]);
    expect(tower.box.width).toBeCloseTo(20, 1);
    tower.done();
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
    // a ball of Ø 20 grown by 5 at the plate's middle: inside it a disc Ø 30, outside the plate with a hole
    const ball = (side: 1 | -1) => ({ id: 's', type: 'split', cutter: { kind: 'sphere', c: [0, 0, 0], d: 20, offset: 5 }, side }) as BuildFeature;
    const inner = built([base(100), ball(1)]);
    expect(inner.box.width).toBeCloseTo(30, 1);
    inner.done();
    const outer = built([base(100), ball(-1)]);
    expect(outer.box.width).toBeCloseTo(100, 3);
    outer.done();
    // a cylinder Ø 20 up through the plate: inside it a disc Ø 20, as thick as the plate
    const pin = built([base(100), { id: 's', type: 'split', cutter: { kind: 'cylinder', c: [0, 0, -10], dir: [0, 0, 1], h: 30, d: 20, offset: 0 }, side: 1 } as BuildFeature]);
    expect(pin.box.width).toBeCloseTo(20, 1);
    expect(pin.box.bounds.map((b) => +b[2].toFixed(3))).toEqual([0, 4]);
    pin.done();
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

  it('finds a pushed face far from the origin by a point only as exact as the view has it (Float32)', () => {
    const block: BuildFeature = { id: 'b', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 5000.3, y: 0, w: 20, h: 20, r: 0, rot: 0 }], depth: 10, mode: 'add', through: false };
    // its right side at x 5010.3, the picked point as the view's triangles give it
    const at: [number, number, number] = [Math.fround(5010.3), Math.fround(2.1), Math.fround(4.7)];
    const shape = buildBody([block, { id: 'p', type: 'push', at, n: [1, 0, 0], distance: 5 } as BuildFeature]);
    const volume = measureVolume(shape);
    shape.delete();
    expect(volume).toBeCloseTo(25 * 20 * 10, 1);
  });

  it('rounds each corner by its own radius, one too big clamped there without failing', () => {
    const shape = buildBody([{ id: 'r', type: 'extrude', plane: ground, profiles: [{ id: 'p', kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: 0, rot: 0, rs: [0, 5, 50, 0] }], depth: 1, mode: 'add', through: false } as BuildFeature]);
    const volume = measureVolume(shape);
    shape.delete();
    const cut = (r: number) => r * r * (1 - Math.PI / 4); // what rounding a right angle takes
    expect(volume).toBeCloseTo(800 - cut(5) - cut(9.99), 1);
  });

  it('chamfers a corner below 0, as long along each side as asked', () => {
    const shape = buildBody([{ id: 'r', type: 'extrude', plane: ground, profiles: [{ id: 'p', kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: 0, rot: 0, rs: [-4, 0, 0, 0] }], depth: 1, mode: 'add', through: false } as BuildFeature]);
    const volume = measureVolume(shape);
    shape.delete();
    expect(volume).toBeCloseTo(800 - (4 * 4) / 2, 3); // the corner's triangle gone
    const all = buildBody([{ id: 'r', type: 'extrude', plane: ground, profiles: [{ id: 'p', kind: 'rect', x: 0, y: 0, w: 40, h: 20, r: -2, rot: 0 }], depth: 1, mode: 'add', through: false } as BuildFeature]);
    expect(measureVolume(all)).toBeCloseTo(800 - 4 * 2, 3); // one R for all, below 0: every corner
    all.delete();
  });

  it('extrudes areas sharing a curved side together (lamp2.mmk: a drop beside a circle, closed by a tangent)', () => {
    const shapes = [
      { id: 'c', kind: 'circle' as const, x: -20, y: 20, d: 24 },
      { id: 't', kind: 'line' as const, pts: [[-15.5612, 31.1489], [25, 15]] as [number, number][] },
      { id: 'b', kind: 'line' as const, pts: [[25, 15], [-20, 8]] as [number, number][], curves: [{ c1: [10, 12.6667] as [number, number], c2: [-5, 10.3333] as [number, number] }] },
    ];
    const areas = areasOf(shapes).map((a) => ({ in: a.in, out: a.out, at: a.at }));
    const shape = buildBody([{ id: 'x', type: 'extrude', plane: ground, profiles: shapes, areas, depth: 10, mode: 'add', through: false } as BuildFeature]);
    const volume = measureVolume(shape);
    shape.delete();
    expect(volume).toBeCloseTo(7857.7, 0); // the circle (π · 12² · 10), the drop and a sliver where the bezier dips in
  });

  it('extrudes a circle and the spike two lines close on it, one of them tangent (failed2.mmk)', () => {
    const shapes = [
      { id: 'c', kind: 'circle' as const, x: 0, y: 0, d: 41.4005 },
      { id: 'a', kind: 'line' as const, pts: [[-7.2653, 19.3834], [-41.5688, 64.9056]] as [number, number][] },
      { id: 't', kind: 'line' as const, pts: [[-19.7896, -6.0723], [-41.5688, 64.9056]] as [number, number][] },
    ];
    const areas = areasOf(shapes).map((a) => ({ in: a.in, out: a.out, at: a.at }));
    expect(areas).toHaveLength(2); // the circle, the spike
    const shape = buildBody([{ id: 'x', type: 'extrude', plane: ground, profiles: shapes, areas, depth: 27.5, mode: 'add', through: false } as BuildFeature]);
    const [volume, faces] = [measureVolume(shape), shape.faces.length];
    shape.delete();
    expect(volume).toBeCloseTo(53850.67, 0); // (circle 1346.17 + spike 612.03) · 27.5
    expect(faces).toBe(5); // one solid: no wall left inside along the arc they share
  });

  it('a single line crossing itself twice closes two areas, both extruded (failed2.mmk, its second state)', () => {
    const line = { id: 'l', kind: 'line' as const, pts: [[-43, -35.5], [-75.406023, 14.400899], [-54.258265, 20.464921], [-64.604015, -2.232734], [-41.187796, -10.989484], [-51.101506, -23.024775], [-59.048942, -32.673001]] as [number, number][] };
    const areas = areasOf([line]);
    expect(areas).toHaveLength(2); // the two loops
    const flat = areas.reduce((sum, a) => {
      let n = 0;
      for (let k = 0; k + 5 < a.tris.length; k += 6) n += Math.abs((a.tris[k + 2] - a.tris[k]) * (a.tris[k + 5] - a.tris[k + 1]) - (a.tris[k + 4] - a.tris[k]) * (a.tris[k + 3] - a.tris[k + 1])) / 2;
      return sum + n;
    }, 0);
    const shape = buildBody([{ id: 'x', type: 'extrude', plane: ground, profiles: [line], areas: areas.map((a) => ({ in: a.in, out: a.out, at: a.at })), depth: 10, mode: 'add', through: false } as BuildFeature]);
    const volume = measureVolume(shape);
    shape.delete();
    expect(volume).toBeCloseTo(flat * 10, 1); // the triangles in float32
  });

  it('a line across a circle leaves two true half discs; a line across an arch leaves its arc', () => {
    const half = (shapes: Parameters<typeof areasOf>[0], pick: (at: [number, number]) => boolean) => {
      const areas = areasOf(shapes).filter((a) => pick(a.at!)).map((a) => ({ in: a.in, out: a.out, at: a.at }));
      const shape = buildBody([{ id: 'x', type: 'extrude', plane: ground, profiles: shapes, areas, depth: 10, mode: 'add', through: false } as BuildFeature]);
      const volume = measureVolume(shape);
      shape.delete();
      return volume;
    };
    const across = { id: 'l', kind: 'line' as const, pts: [[-20, 0], [20, 0]] as [number, number][] };
    expect(half([{ id: 'c', kind: 'circle', x: 0, y: 0, d: 20 }, across], (at) => at[1] > 0)).toBeCloseTo((Math.PI * 100 * 10) / 2, 3);
    // an arch (radius 10) over a floor at y 2: the circle's segment above it
    const arch = { id: 'a', kind: 'line' as const, pts: [[-10, 0], [10, 0]] as [number, number][], curves: [{ mid: [0, 10] as [number, number] }] };
    const floor = { id: 'b', kind: 'line' as const, pts: [[-20, 2], [20, 2]] as [number, number][] };
    const segment = 100 * Math.acos(0.2) - 2 * Math.sqrt(96);
    expect(half([arch, floor], (at) => at[1] > 2)).toBeCloseTo(segment * 10, 3);
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

  it('a coat left off a flat side of a rounded block leaves it flat', () => {
    const block: BuildFeature = { id: 'e', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 30, h: 20, r: 3, rot: 0 }], depth: 10, mode: 'add', through: false };
    const shape = buildBody([block, { id: 'c', type: 'coat', thickness: 3, corners: 'sharp', exclude: [{ at: [15, 0, 5], n: [1, 0, 0] }] }]);
    const [lo, hi] = shape.boundingBox.bounds;
    shape.delete();
    expect(hi[0]).toBeCloseTo(15, 3);
    expect(lo[0]).toBeCloseTo(-18, 3);
    expect(hi[1]).toBeCloseTo(13, 3);
  });
  it('a cut along a joint takes all the tool goes through', () => {
    const pin: BuildFeature[] = [{ id: 'p', type: 'extrude', plane: ground, profiles: [{ id: 'c', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 20, mode: 'add', through: false }];
    const slab = base(100);
    const left = (sweep: BooleanBuild['sweep']) => {
      const shape = buildBody([slab, { id: 'b', type: 'boolean', op: 'subtract', features: pin, place: { ...STILL, offset: [20, 0, -5] }, sweep }]);
      const v = measureVolume(shape);
      shape.delete();
      return v;
    };
    const whole = 100 * 60 * 4;
    const slid = (30 * 10 + Math.PI * 25) * 4;
    const turned = ((Math.PI / 4) * (25 * 25 - 15 * 15) + Math.PI * 25) * 4;
    expect(Math.abs(whole - left({ kind: 'slider', at: [0, 0, 0], dir: [-1, 0, 0], amount: 30 }) - slid) / slid).toBeLessThan(0.005);
    expect(Math.abs(whole - left({ kind: 'hinge', at: [0, 0, 0], dir: [0, 0, 1], amount: 90 }) - turned) / turned).toBeLessThan(0.005);
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

describe('loft', () => {
  const section = (z: number, d: number) => ({ frame: { o: [0, 0, z], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, profile: { id: `c${z}`, kind: 'circle', x: 0, y: 0, d } });
  const shell = { id: 's', type: 'shell', thickness: 1.5, open: [[0, 0, -70]] } as unknown as BuildFeature;

  it('can be hollowed whichever way its shapes were picked', () => {
    for (const sections of [[section(-6, 36), section(-70, 120)], [section(-70, 120), section(-6, 36)]]) {
      const shape = buildBody([{ id: 'l', type: 'loft', sections, ruled: false } as unknown as BuildFeature, shell]);
      expect(shape.faces.length).toBeGreaterThan(3); // walls, inside and out, and the rim
      shape.delete();
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

  describe('after an edit', () => {
    const at = (x: number, z: number) => [[x, -30, z], [x, 0, z], [x, 30, z]] as [number, number, number][];
    // the edge along the block's right top, picked on the first block
    const right = (x: number, z: number): BuildFeature => ({ id: 'p', type: 'finish', mode: 'chamfer', size: 1, edges: { pts: [at(x, z)], normals: [[[1, 0, 0], [0, 0, 1]]] }, enabled: true, baked: false, skip: [] });
    const finishedAt = (features: BuildFeature[]) => {
      const finishing: Finishing = { base: null, edges: [] };
      const shape = buildBody(features, finishing);
      const m = meshBody(shape, finishing);
      shape.delete();
      finishing.base?.delete();
      return { mids: finishing.edges.map((e) => e.mid.map((v) => +v.toFixed(3))), lost: m.lostEdges, faces: m.faces.length / 2 };
    };

    it('a taller block: the edge is found where it went', () => {
      const r = finishedAt([base(40, 10), right(20, 4)]);
      expect(r.mids).toEqual([[20, 0, 10]]);
      expect(r.lost).toEqual({});
      expect(r.faces).toBe(7);
    });

    it('a wider block: the edge is found where it went', () => {
      expect(finishedAt([base(70, 4), right(20, 4)]).mids).toEqual([[35, 0, 4]]);
    });

    it('a longer block: the edge is found though its length changed', () => {
      const longer: BuildFeature = { ...base(40), profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 40, h: 100, r: 0, rot: 0 }] } as BuildFeature;
      expect(finishedAt([longer, right(20, 4)]).mids).toEqual([[20, 0, 4]]);
    });

    it('an edge that stayed stays, a face behind it may change', () => {
      const r = finishedAt([base(40), right(20, 4)]);
      expect(r.mids).toEqual([[20, 0, 4]]);
    });

    it('two edges just as near: it says so instead of guessing', () => {
      // a slot through the top leaves edges looking the same on both sides of where the picked one was
      const slot: BuildFeature = { id: 's', type: 'extrude', plane: { kind: 'base', axis: 'xy', offset: 0 }, profiles: [{ id: 'q', kind: 'rect', x: 0, y: 0, w: 10, h: 70, r: 0, rot: 0 }], depth: 0, mode: 'cut', through: true } as BuildFeature;
      expect(() => buildBody([base(40), slot, right(7.5, 4)])).toThrow('picked edges are gone'); // x -5 and x 20 look like it, 12.5 away each
    });

    it('a wider round edge is found though a cut split it and a hole looks alike', () => {
      const round = (d: number): BuildFeature => ({ id: 'd', type: 'extrude', plane: { kind: 'base', axis: 'xy', offset: 0 }, profiles: [{ id: 'c', kind: 'circle', x: 0, y: 0, d }, { id: 'i', kind: 'circle', x: 0, y: 0, d: 10 }], depth: 10, mode: 'add', through: false } as BuildFeature);
      const notch: BuildFeature = { id: 'n', type: 'extrude', plane: { kind: 'base', axis: 'xy', offset: 0 }, profiles: [{ id: 'q', kind: 'rect', x: 0, y: 65, w: 10, h: 10, r: 0, rot: 0 }], depth: 0, mode: 'cut', through: true } as BuildFeature;
      const rim = Array.from({ length: 65 }, (_, k) => [55 * Math.cos((k * Math.PI) / 32), 55 * Math.sin((k * Math.PI) / 32), 10] as [number, number, number]);
      const finish: BuildFeature = { id: 'p', type: 'finish', mode: 'fillet', size: 1, edges: { pts: [rim], normals: [[[0, 0, 1], [-1, 0, 0]]] }, enabled: true, baked: false, skip: [] };
      const r = finishedAt([round(130), notch, finish]);
      expect(r.lost).toEqual({});
      expect(Math.hypot(r.mids[0][0], r.mids[0][1])).toBeCloseTo(65, 1); // the rim, not the hole
    });

    it('one of several lost: the others are finished, the lost one counted', () => {
      const two = { ...right(20, 4), edges: { pts: [at(20, 4), at(99, 99)], normals: [[[1, 0, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, 1]]] } } as BuildFeature;
      // the second: along y between faces no edge along y has
      const r = finishedAt([base(40), two]);
      expect(r.mids).toEqual([[20, 0, 4]]);
      expect(r.lost).toEqual({ p: 1 });
    });

    it('a left out edge stays out when picked again by the same line', () => {
      expect(() => buildBody([base(40), { ...right(20, 4), skip: [[20, 0, 4]] } as BuildFeature])).toThrow('picked edges are gone');
    });
  });
});

describe('curved sides', () => {
  const on = (profile: unknown, depth = 10): BuildFeature => ({ id: 'e', type: 'extrude', plane: ground, profiles: [profile], depth, mode: 'add', through: false }) as BuildFeature;
  const volume = (features: BuildFeature[]) => {
    const shape = buildBody(features);
    const faces = shape.faces.length;
    const v = measureVolume(shape);
    shape.delete();
    return { faces, v };
  };

  it('extrudes a true arc: a half disc is one round face, not many', () => {
    const { faces, v } = volume([on({ id: 'p', kind: 'polygon', pts: [[-10, 0], [10, 0]], curves: [null, { mid: [0, 10] }], r: 0, rot: 0 })]);
    expect(faces).toBe(4);
    expect(v).toBeCloseTo((Math.PI * 100 * 10) / 2, 1);
  });

  it('extrudes a closed shape whose last side curves back to its start', () => {
    const { faces } = volume([on({ id: 'p', kind: 'polygon', pts: [[0, 0], [30, 0], [30, 30]], curves: [null, null, { c1: [10, 30], c2: [0, 10] }], r: 0, rot: 0 })]);
    expect(faces).toBe(5);
  });

  it('turns a curved shape as a whole', () => {
    const p = { id: 'p', kind: 'polygon', pts: [[-10, 0], [10, 0]], curves: [null, { mid: [0, 10] }], r: 0 };
    const shape = buildBody([on({ ...p, rot: 180 })]);
    expect(shape.boundingBox.bounds[0][1]).toBeLessThan(-9);
    shape.delete();
  });

  it('sweeps along a line with an arc and a bezier curve', () => {
    const path = { id: 'l', kind: 'line', pts: [[0, 0], [20, 0], [40, 20], [60, 20]], curves: [null, { c1: [30, 0], c2: [40, 10] }, { mid: [50, 25] }] };
    const shape = buildBody([{ id: 's', type: 'sweep', profile: { id: 'c', kind: 'circle', x: 0, y: 0, d: 4 }, path: { frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, profile: path } } as unknown as BuildFeature]);
    expect(shape.boundingBox.bounds[1][0]).toBeGreaterThan(55);
    shape.delete();
  });

  it('cuts along a curved line, exact and moved aside', () => {
    const box = on({ id: 'r', kind: 'rect', x: 0, y: 0, w: 40, h: 40, r: 0, rot: 0 });
    const cut = (offset: number) => ({ id: 'c', type: 'split', side: 1, cutter: { kind: 'frame', frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] }, offset, profile: { id: 'l', kind: 'line', pts: [[-30, 0], [30, 0]], curves: [{ c1: [-10, 20], c2: [10, 20] }] } } }) as unknown as BuildFeature;
    const exact = volume([box, cut(0)]);
    expect(exact.faces).toBe(6);
    expect(exact.v).toBeLessThan(16000);
    expect(volume([box, cut(3)]).v).toBeGreaterThan(0);
  });

  it('an area closed by crossing lines is built from true curves: one round face, not many', () => {
    const arch = { id: 'a', kind: 'line', pts: [[-10, 0], [10, 0]], curves: [{ mid: [0, 10] }] };
    const floor = { id: 'b', kind: 'line', pts: [[-20, 2], [20, 2]] };
    const { faces, v } = volume([{ id: 'e', type: 'extrude', plane: ground, profiles: [arch, floor], areas: [{ in: [], out: [], at: [0, 5] }], depth: 10, mode: 'add', through: false } as unknown as BuildFeature]);
    expect(faces).toBe(4);
    const chord = 2 * Math.sqrt(100 - 4);
    expect(v).toBeCloseTo(10 * (100 * Math.acos(0.2) - 2 * (chord / 2)), 0);
  });

  it('revolves and lofts a curved outline', () => {
    const half = { id: 'p', kind: 'polygon', pts: [[10, 0], [30, 0]], curves: [null, { mid: [20, 10] }], r: 0, rot: 0 };
    const ring = buildBody([{ id: 'r', type: 'revolve', plane: ground, profiles: [half], axis: { at: [0, 0], dir: [0, 1] }, angle: 360, mode: 'add' } as unknown as BuildFeature]);
    expect(ring.boundingBox.bounds[1][0]).toBeCloseTo(30, 0);
    ring.delete();
    const at = (z: number) => ({ o: [0, 0, z], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] });
    const up = buildBody([{ id: 'l', type: 'loft', sections: [{ frame: at(0), profile: { ...half, pts: [[-10, 0], [10, 0]], curves: [null, { mid: [0, 10] }] } }, { frame: at(20), profile: { id: 'c', kind: 'circle', x: 0, y: 3, d: 8 } }], ruled: false } as unknown as BuildFeature]);
    expect(up.boundingBox.bounds[1][2]).toBeCloseTo(20, 1);
    up.delete();
  });

  it('finds areas where a closed curved shape overlaps another', () => {
    const areas = areasOf([{ id: 'a', kind: 'polygon', pts: [[-10, 0], [10, 0]], curves: [null, { mid: [0, 10] }], r: 0, rot: 0 }, { id: 'b', kind: 'rect', x: 0, y: 0, w: 8, h: 8, r: 0, rot: 0 }]);
    expect(areas.length).toBe(3);
  });
});

describe('corners beside curved sides', () => {
  it('a rounded or chamfered corner beside an arc or a bezier: the sketch outline as the kernel builds it (area = volume of 1 mm)', async () => {
    const { area } = await import('../doc/profiles');
    const shape = (r: number) => ({ id: 'q', kind: 'polygon' as const, pts: [[0, 0], [40, 0], [40, 30], [0, 30]] as [number, number][], curves: [null, { c1: [50, 10], c2: [55, 20] }, { mid: [20, 38] }, null], r, rot: 0 }) as unknown as Parameters<typeof areasOf>[0][number];
    for (const r of [2, 5, -2, -4]) {
      const p = shape(r);
      const solid = buildBody([{ id: 'x', type: 'extrude', plane: ground, profiles: [p], depth: 1, mode: 'add', through: false } as BuildFeature]);
      const volume = measureVolume(solid);
      solid.delete();
      expect(area(p), `r ${r}`).toBeCloseTo(volume, 5);
    }
  });
});

describe('curved sides in finishes', () => {
  // a rounded end on a box: two tangent seams, two real corners
  const rounded = (r = 0): BuildFeature => ({
    id: 'c',
    type: 'extrude',
    plane: ground,
    profiles: [{ id: 'p', kind: 'polygon', pts: [[0, 0], [30, 0], [30, 20], [0, 20]], curves: [null, { mid: [40, 10] }, null, null], r, rot: 0 }],
    depth: 10,
    mode: 'add',
    through: false,
  });
  it('the vertical rule takes real corners, not the seams', () => {
    const finishing: Finishing = { base: null, edges: [] };
    const shape = buildBody([rounded(), { id: 'f', type: 'finish', mode: 'fillet', size: 2, edges: 'vertical', enabled: true, baked: false, skip: [] } as BuildFeature], finishing);
    expect(finishing.edges.length).toBe(2);
    expect(finishing.edges.every((e) => e.mid[0] < 1)).toBe(true);
    shape.delete();
  });
  it('a corner radius rounds the corners of a curved polygon', () => {
    const [sharp, round] = [rounded(), rounded(2)].map((f) => buildBody([f]));
    expect(measureVolume(round)).toBeLessThan(measureVolume(sharp));
    expect(measureVolume(sharp) - measureVolume(round)).toBeLessThan(40);
    sharp.delete();
    round.delete();
  });
});

describe('coat', () => {
  const coat = (extra: object = {}): BuildFeature => ({ id: 'k', type: 'coat', thickness: 1, corners: 'sharp', exclude: [], ...extra } as BuildFeature);
  const cube: BuildFeature = { id: 'c', type: 'extrude', plane: ground, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 5, h: 5, r: 0, rot: 0 }], depth: 5, mode: 'add', through: false };
  const bounds = (s: { boundingBox: { bounds: number[][] } }) => s.boundingBox.bounds.flat().map((v) => +v.toFixed(3));
  it('sharp: a 5 mm cube and 1 mm is a 7 mm cube', () => {
    const s = buildBody([cube, coat()]);
    expect(measureVolume(s)).toBeCloseTo(343, 3);
    expect(bounds(s)).toEqual([-3.5, -3.5, -1, 3.5, 3.5, 6]);
    s.delete();
  });
  it('round: the same outside, less in the corners', () => {
    const s = buildBody([cube, coat({ corners: 'round' })]);
    expect(measureVolume(s)).toBeCloseTo(326.31, 1);
    s.delete();
  });
  it('as a skin: only what it adds, hollow where the body was; an excluded face left open', () => {
    expect(measureVolume(buildBody([cube, coat({ skin: true })]))).toBeCloseTo(7 ** 3 - 5 ** 3, 3);
    expect(measureVolume(buildBody([cube, coat({ skin: true, exclude: [{ at: [0, 0, 5], n: [0, 0, 1] }] })]))).toBeCloseTo(7 * 7 * 6 - 5 ** 3, 3);
    expect(measureVolume(buildBody([cube, coat({ skin: true, corners: 'round' })]))).toBeLessThan(7 ** 3 - 5 ** 3);
  });
  it('a flat face excluded stays where it is, clicked on it or on the coat over it', () => {
    for (const at of [[0, 0, 5], [0, 0, 6]]) {
      const s = buildBody([cube, coat({ exclude: [{ at, n: [0, 0, 1] }] })]);
      expect(bounds(s)).toEqual([-3.5, -3.5, -1, 3.5, 3.5, 5]);
      expect(measureVolume(s)).toBeCloseTo(49 * 6, 3);
      s.delete();
    }
  });
  it('too much says so', () => {
    const holed: BuildFeature = { ...cube, profiles: [{ id: 'r', kind: 'rect', x: 0, y: 0, w: 60, h: 40, r: 0, rot: 0 }, { id: 'h', kind: 'circle', x: 0, y: 0, d: 20 }], depth: 20 } as BuildFeature;
    expect(() => buildBody([holed, coat({ thickness: 12, corners: 'round' })])).toThrow(/cannot grow/);
  });
});
