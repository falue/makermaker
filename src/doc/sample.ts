import type { Doc, Expr, Body, Group, Joint, Profile, Sketch, Feature, Unit, Material, WorkPlane } from './types';

export const ex = (e: string | number, u: Unit = 'mm'): Expr => ({ e: String(e), u });

export const newId = () => crypto.randomUUID().slice(0, 8);

/** No turn. */
export const unturned = () => ({ rx: ex(0), ry: ex(0), rz: ex(0) });

export const newFinish = (u: Unit): Feature => ({
  id: newId(),
  type: 'finish',
  mode: 'fillet',
  size: ex(1, u),
  edges: 'top',
  enabled: true,
  baked: false,
  skip: [],
});

const rect = (w: number, h: number): Profile => ({ id: newId(), kind: 'rect', x: ex(0), y: ex(0), w: ex(w), h: ex(h), r: ex(0), rot: ex(0) });
const circle = (x: number, y: number, d: number): Profile => ({ id: newId(), kind: 'circle', x: ex(x), y: ex(y), d: ex(d) });
const ground = { kind: 'base', axis: 'xy', offset: ex(0) } as const;
/** A body pulled up from own shapes on its ground plane. */
const solid = (name: string, color: string, at: [number, number, number], profiles: Profile[], depth: number | string, group: string | null = null): Body => ({
  id: newId(),
  name,
  group,
  rotation: unturned(),
  link: null,
  color,
  visible: true,
  position: [ex(at[0]), ex(at[1]), ex(at[2])],
  features: [{ id: newId(), type: 'extrude', source: { kind: 'own', plane: ground, profiles }, depth: ex(depth), mode: 'add', through: false }],
});

/** A test piece for a group's own origin: turned around all three axes, a box and a pin inside (selecting one: grid, origin and view cube follow it). */
function turnedGroup(): { group: Group; bodies: Body[] } {
  const group: Group = { id: newId(), name: 'Turned group', parent: null, visible: true, origin: { kind: 'custom', position: [ex(0), ex(-210), ex(40)], rotation: { rx: ex(20), ry: ex(30), rz: ex(40) } } };
  return { group, bodies: [solid('Turned box', '#a9c4d8', [0, 0, 0], [rect(40, 30)], 20, group.id), solid('Turned pin', '#e3d48f', [12, 0, 20], [circle(0, 0, 10)], 25, group.id)] };
}

/** Test pieces for single-edge finishes: a block with one vertical edge chamfered, one with one top edge rounded. */
function edgeTests(): Body[] {
  const one = (mode: 'fillet' | 'chamfer', size: number, pts: [number, number, number][]) => ({ id: newId(), type: 'finish' as const, mode, size: ex(size), edges: { pts: [pts] }, enabled: true, baked: false, skip: [] });
  const block = (name: string, color: string, x: number, finish: ReturnType<typeof one>): Body => {
    const b = solid(name, color, [x, -90, 0], [rect(40, 30)], 20);
    return { ...b, features: [...b.features, finish] };
  };
  return [
    block('One chamfered edge', '#c9b8e8', -40, one('chamfer', 4, [[20, -15, 0], [20, -15, 20]])),
    block('One rounded edge', '#b8dcc8', 20, one('fillet', 5, [[-20, -15, 20], [20, -15, 20]])),
  ];
}

/** A test piece for bulges: a plate whose top is domed (its card edits the amount, curve and peak). */
function bulgeTest(): Body {
  const plate = solid('Domed plate', '#a9c4d8', [-160, -60, 0], [rect(40, 30)], 4);
  const dome = { id: newId(), type: 'bulge' as const, on: { kind: 'face' as const, at: [0, 0, 4] as [number, number, number], mid: [0, 0, 4] as [number, number, number], half: [30, 30, 0] as [number, number, number], n: [0, 0, 1] as [number, number, number] }, fullness: ex(1), peak: [ex(0), ex(0), ex(8)] as [Expr, Expr, Expr] };
  return { ...plate, features: [...plate.features, dome] };
}

/** A test piece for booleans: a block with a ball cut into its corner, a cylinder cut through it and a polygon joined on another corner (shown under it in the list). */
function cutTest(): Body[] {
  const ball: Body = { ...solid('Cut ball', '#d9a98f', [115, -110, 25], [], 0), features: [{ id: newId(), type: 'sphere', x: ex(0), y: ex(0), z: ex(0), d: ex(24) }] };
  const pipe = solid('Cut cylinder', '#a8c0dc', [90, -90, -5], [circle(0, 0, 12)], 35);
  // a 20 × 20 × 30 polygon on the block's back right corner, joined
  const square: Profile = { id: newId(), kind: 'polygon', pts: [[-10, -10], [10, -10], [10, 10], [-10, 10]], r: ex(0), rot: ex(0) };
  const post = { ...solid('Join polygon', '#b8d4a8', [115, -70, 0], [square], 30), visible: false }; // as the boolean tool leaves join tools
  const block = solid('Cut block', '#e0c9a0', [90, -90, 0], [rect(50, 40)], 25);
  const op = (tool: Body, op: 'subtract' | 'union') => ({ id: newId(), type: 'boolean' as const, op, body: tool.id });
  return [{ ...block, features: [...block.features, op(ball, 'subtract'), op(pipe, 'subtract'), op(post, 'union')] }, ball, pipe, post];
}

/** Test pieces for Interference and clearance: two overlapping, two 0.05 mm apart, an arm on a hinge that hits a post as it turns. */
function clashTests(): { bodies: Body[]; joint: Joint } {
  const y = 240;
  const base = solid('Hinge base', '#d0b0b0', [60, y, 0], [rect(16, 16)], 10);
  const arm = solid('Hinge arm', '#d09090', [100, y, 10], [rect(60, 8)], 6);
  const joint: Joint = { id: newId(), name: 'Arm hinge', kind: 'hinge', parent: base.id, children: [arm.id], axis: { at: [0, 0, 0], dir: [0, 0, 1] }, min: ex(0), max: ex(90), value: ex(0), speed: ex(1) };
  return {
    bodies: [
      solid('Overlap A', '#d0b0b0', [-120, y, 0], [rect(30, 30)], 20),
      solid('Overlap B', '#d09090', [-100, y, 8], [rect(30, 30)], 20),
      solid('Gap A', '#b0d0b0', [-40, y, 0], [rect(20, 20)], 20),
      solid('Gap B: 0.05 mm away', '#90d090', [-19.95, y, 0], [rect(20, 20)], 20),
      base,
      arm,
      solid('In the arm\'s way', '#c08080', [60 + 60 * Math.cos(0.7), y + 60 * Math.sin(0.7), 0], [rect(10, 10)], 30),
    ],
    joint,
  };
}

/** `body` with its upright edges filleted by `size` (a body rounds by fillets, not by its shape's corner radius). */
const rounded = (body: Body, size: number): Body => ({ ...body, features: [...body.features, { ...(newFinish('mm') as Extract<Feature, { type: 'finish' }>), size: ex(size), edges: 'vertical' }] });

/** Test pieces for Coat: a 5 mm cube (coated by 1 mm it is 7 mm), a rounded block with a hole. */
function coatTests(): Body[] {
  const coated = (body: Body, corners: 'sharp' | 'round'): Body => ({ ...body, features: [...body.features, { id: newId(), type: 'coat', thickness: ex(1), corners, exclude: [] }] });
  return [coated(solid('Coat: cube, sharp', '#9fd0c0', [-60, 110, 0], [rect(5, 5)], 5), 'sharp'), coated(solid('Coat: cube, round', '#9fd0c0', [-40, 110, 0], [rect(5, 5)], 5), 'round'), rounded(solid('Coat me: block with a hole', '#9fd0c0', [0, 110, 0], [rect(30, 20), circle(0, 0, 8)], 10), 3)];
}

/** Test pieces for Entangle: a cap and its post, moving as one. */
function attachTest(): { bodies: Body[]; joint: Joint } {
  const post = solid('Entangle: post', '#d6b98c', [50, 110, 0], [rect(10, 10)], 20);
  const cap = solid('Entangle: cap', '#8cb4d6', [50, 110, 20], [rect(14, 14)], 3);
  const z = ex(0);
  return { bodies: [post, cap], joint: { id: newId(), name: 'Entanglement 1', kind: 'attach', parent: post.id, children: [cap.id], axis: { at: [0, 0, 20], dir: [0, 0, 1] }, min: z, max: z, value: z, speed: ex(1) } };
}

/**
 * A body of three steps, for its cards: a block, a pocket cut into its top (on top of Extrude 1) and a tab added on
 * the front plane, 20 out (Offset) where the block's front face is.
 */
function stepsTest(): Body {
  const block = solid('Three steps', '#c8c0a8', [230, 0, 0], [rect(50, 40)], 20);
  const pocket = { id: newId(), type: 'extrude' as const, source: { kind: 'own' as const, plane: { kind: 'cap' as const, feature: block.features[0].id }, profiles: [circle(0, 0, 20)] }, depth: ex(-8), mode: 'cut' as const, through: false };
  const tab = { id: newId(), type: 'extrude' as const, source: { kind: 'own' as const, plane: { kind: 'base' as const, axis: 'xz' as const, offset: ex(20) }, profiles: [{ ...rect(20, 10), y: ex(10) }] }, depth: ex(10), mode: 'add' as const, through: false };
  return { ...block, features: [...block.features, pocket, tab] };
}

/** A test piece for the cut tool: a block with a zig-zag line across it on the ground (cut along it, or by a plane). */
function splitTest(): { body: Body; sketch: Sketch } {
  const line: Profile = { id: newId(), kind: 'line', pts: [[-165, -10], [-145, 8], [-130, -8], [-112, 10], [-95, -2]] };
  const sketch: Sketch = { id: newId(), name: 'Cut line', group: null, groups: [], plane: { kind: 'base', axis: 'xy', offset: ex(0) }, shapes: [line], visible: true };
  return { body: solid('Cut me', '#c4b5e0', [-130, 0, 0], [rect(50, 40)], 30), sketch };
}

/**
 * Test pieces for loft, revolve and sweep: a square on the ground with a circle 40 mm above it (loft through them), on
 * the front plane a vase's half outline beside a construction line (revolve it around that line), and a bent line with
 * a small circle (sweep the circle along it).
 */
function shapeTests(): Sketch[] {
  const sketch = (name: string, plane: Sketch['plane'], shapes: Profile[]): Sketch => ({ id: newId(), name, group: null, groups: [], plane, shapes, visible: true });
  const square: Profile = { id: newId(), kind: 'rect', x: ex(-130), y: ex(90), w: ex(30), h: ex(30), r: ex(0), rot: ex(0) };
  const vase: Profile = { id: newId(), kind: 'polygon', pts: [[-165, 0], [-150, 0], [-152, 10], [-158, 25], [-155, 40], [-165, 40]], r: ex(0), rot: ex(0) };
  const axis: Profile = { id: newId(), kind: 'line', pts: [[-165, -5], [-165, 45]], construction: true };
  return [
    sketch('Loft base', { kind: 'base', axis: 'xy', offset: ex(0) }, [square]),
    sketch('Loft top', { kind: 'base', axis: 'xy', offset: ex(40) }, [circle(-130, 90, 16)]),
    sketch('Revolve me', { kind: 'base', axis: 'xz', offset: ex(-60) }, [vase, axis]),
    // a bent path 10 mm above the ground and a small circle to sweep along it (a pipe)
    sketch('Sweep path', { kind: 'base', axis: 'xy', offset: ex(10) }, [{ id: newId(), kind: 'line', pts: [[-60, -160], [-20, -160], [0, -140], [0, -120]] }]),
    // a 3D line on the ground: along x, 30 up, along y (sweep the profile along it: a pipe through all three axes)
    sketch('Sweep path 3D', { kind: 'base', axis: 'xy', offset: ex(0) }, [{ id: newId(), kind: 'line', pts: [[-60, -200], [-20, -200], [-20, -200], [-20, -180]], z: [0, 0, 30, 30] }]),
    // a closed line of a straight side, a bezier curve and a round arc (extrude it); a bent line with curves (sweep along it)
    sketch('Curved outline', { kind: 'base', axis: 'xy', offset: ex(0) }, [{ id: newId(), kind: 'polygon', pts: [[-200, 60], [-170, 60], [-170, 90]], curves: [null, { c1: [-160, 70], c2: [-160, 80] }, { mid: [-196, 84] }], r: ex(0), rot: ex(0) }]),
    sketch('Sweep profile', { kind: 'base', axis: 'xy', offset: ex(0) }, [circle(-80, -175, 8)]),
  ];
}

/**
 * Test pieces for joints: a box with a lid on a hinge along its back top edge (opens 0–110°; the lid a group: plate,
 * handle and a lip inside the box, swinging together), and a cabinet with a drawer that slides out of its open front
 * (0–35 mm), and a propeller spinning endlessly on a post (a revolve, 30 turns a minute).
 */
function jointTests(): { bodies: Body[]; groups: Group[]; joints: Joint[] } {
  const hollow = (name: string, color: string, at: [number, number, number], w: number, h: number, depth: number, hole: Profile, holeDepth: number): Body => {
    const b = solid(name, color, at, [rect(w, h)], depth);
    const cut = { id: newId(), type: 'extrude' as const, source: { kind: 'own' as const, plane: { kind: 'cap' as const, feature: b.features[0].id }, profiles: [hole] }, depth: ex(-holeDepth), mode: 'cut' as const, through: false };
    return { ...b, features: [...b.features, cut] };
  };
  const box = hollow('Hinge box', '#d6b98c', [-40, 150, 0], 40, 30, 20, rect(36, 26), 16);
  const lid: Group = { id: newId(), name: 'Hinge lid', parent: null, visible: true, origin: { kind: 'parent' } };
  const plate = solid('Lid plate', '#c9a46e', [-40, 150, 20], [rect(40, 30)], 3, lid.id);
  const handle = solid('Lid handle', '#b08a55', [-40, 137, 23], [rect(14, 4)], 4, lid.id);
  const lip = { ...hollow('Lid lip', '#b08a55', [-40, 150, 17], 34, 24, 3, rect(30, 20), 3), group: lid.id };
  // the cabinet open at the front (-y): its inside cut from the top down to 4 mm above the floor
  const opening: Profile = { id: newId(), kind: 'rect', x: ex(0), y: ex(-2), w: ex(42), h: ex(38), r: ex(0), rot: ex(0) };
  const cabinet = hollow('Slide cabinet', '#a9bfd6', [40, 150, 0], 50, 40, 30, opening, 26);
  const drawer = solid('Slide drawer', '#c3d6a9', [40, 148, 5], [rect(40, 36)], 18);
  const post = solid('Spin post', '#b9b9c4', [-110, 340, 0], [circle(0, 0, 10)], 14);
  const propeller = solid('Spin propeller', '#e0a05a', [-110, 340, 14], [rect(50, 8)], 3);
  const deg = (v: number) => ex(v);
  const joints: Joint[] = [
    // along the back top edge, turning the lid's front up (-x: right-handed)
    { id: newId(), name: 'Hinge 1', kind: 'hinge', parent: box.id, children: [lid.id], axis: { at: [0, 15, 20], dir: [-1, 0, 0] }, min: deg(0), max: deg(110), value: deg(0), speed: ex(1) },
    { id: newId(), name: 'Slider 1', kind: 'slider', parent: cabinet.id, children: [drawer.id], axis: { at: [0, -20, 10], dir: [0, -1, 0] }, min: ex(0), max: ex(35), value: ex(0), speed: ex(1) },
    { id: newId(), name: 'Revolve 1', kind: 'revolve', parent: post.id, children: [propeller.id], axis: { at: [0, 0, 0], dir: [0, 0, 1] }, min: deg(0), max: deg(360), value: deg(0), speed: ex(30) },
  ];
  return { bodies: [box, plate, handle, lip, cabinet, drawer, post, propeller], groups: [lid], joints };
}

/** Test pieces for finger joints: two 4 mm boards meeting at a corner, overlapping in a 4 × 4 × 40 column. */
function fingerTests(): Body[] {
  return [solid('Joint board A', '#d8c3a5', [120, 132, 0], [rect(60, 4)], 40), solid('Joint board B', '#c4b08f', [148, 150, 0], [rect(4, 40)], 40)];
}

/**
 * A test piece for linked copies: a block with a pocket and its linked copy beside it (the copy shares its steps: edit
 * the pocket in either, both change).
 */
function linkTest(): Body[] {
  const block = solid('Linked original', '#b8cfa1', [-40, 340, 0], [rect(30, 30)], 15);
  const pocket: Feature = { id: newId(), type: 'extrude', source: { kind: 'own', plane: { kind: 'cap', feature: block.features[0].id }, profiles: [circle(0, 0, 14)] }, depth: ex(-6), mode: 'cut', through: false };
  const original = { ...block, features: [...block.features, pocket] };
  return [original, { ...solid('Linked copy', '#b8cfa1', [0, 340, 0], [], 15), link: original.id, features: [] }];
}

/**
 * Test pieces for the laser export: two 4 mm boards finger jointed at a corner (as Joint board A and B, joined), and a
 * 6 mm sheet with one side bevelled 30° (a draft: the export shows it from its face, the angle as a blue line).
 */
function laserTests(): Body[] {
  const a = solid('Jointed board A', '#d8c3a5', [80, 322, 0], [rect(60, 4)], 40);
  const b = solid('Jointed board B', '#c4b08f', [108, 340, 0], [rect(4, 40)], 40);
  const fingers = (other: string, first: boolean): Feature => ({ id: newId(), type: 'fingers', body: other, count: ex(5), width: ex(0), from: null, first, clearance: ex(0) });
  const sheet = solid('Bevelled sheet', '#c7a26b', [180, 340, 0], [rect(60, 40)], 6);
  const bevel: Feature = { id: newId(), type: 'draft', at: [30, 0, 3], n: [1, 0, 0], axis: { at: [30, -20, 0], dir: [0, 1, 0] }, angle: ex(30) };
  return [
    { ...a, features: [...a.features, fingers(b.id, true)] },
    { ...b, features: [...b.features, fingers(a.id, false)] },
    { ...sheet, features: [...sheet.features, bevel] },
  ];
}

/** A test piece for the unfold export: a lamp shade (a cone cut off, revolved), rolled out exactly round its apex. */
function unfoldTest(): Body {
  const shade: Profile = { id: newId(), kind: 'polygon', pts: [[0, 0], [22, 0], [12, 30], [0, 30]], r: ex(0), rot: ex(0) };
  return { ...solid('Unfold me: lamp shade', '#f2e2b8', [-110, 410, 0], [], 0), features: [{ id: newId(), type: 'revolve', source: { kind: 'own', plane: { kind: 'base', axis: 'xz', offset: ex(0) }, profiles: [shade] }, axis: { at: [0, 0], dir: [0, 1] }, angle: ex(360), mode: 'add' }] };
}

/** A test piece for work planes: one along a 60 mm edge, turned 30° around it, free of the other pieces. */
function slantedPlane(): WorkPlane {
  const at: [number, number, number] = [-130, 150, 20];
  return { id: newId(), name: 'Slanted plane', o: at, x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1], offset: ex(0), turn: ex(30), axis: { at, dir: [1, 0, 0] }, points: [], mode: 'edge', hull: [at, [-70, 150, 20]], rect: null, visible: true };
}

/** A design with nothing in it. */
export const emptyDoc = (units: Unit = 'mm'): Doc => ({ schema: 32, units, params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], planes: [], images: [], materials: [], photos: [], renders: [] });

/**
 * A playground: a plate drawn as a sketch (the holes are circles inside the rectangle), a disc built from own shapes,
 * and overlapping pieces to try booleans on: a pin through the plate, a block over its back edge with a ball on its
 * corner (both in a group), a hex nut sunk into the disc, a free sketch on the front plane that no body uses yet, and
 * test pieces for newer features (finishes, booleans, cuts, loft and revolve, joints, a slanted work plane, linked
 * copies, laser export).
 */
export function sampleDoc(): Doc {
  const split = splitTest();
  const hinged = jointTests();
  const clash = clashTests();
  const material = (name: string, color: string, look: Partial<Material>): Material => ({ id: newId(), name, color, bump: 0.2, reflection: 0, translucency: 0, glow: '#ffffff', glowStrength: 0, ...look });
  const frosted = material('Frosted acrylic', '#d7e8ef', { translucency: 0.8, bump: 0.35 });
  const glowing = material('Glowing resin', '#332211', { glow: '#ff9a3c', glowStrength: 0.6 });
  const rough = material('Rough plywood', '#c7a26b', { bump: 0.8 });
  const materialTests = [
    { ...solid('Frosted plate', '#ffffff', [160, -60, 0], [rect(40, 40)], 4), material: frosted.id },
    { ...solid('Glowing pin', '#ffffff', [160, 0, 0], [circle(0, 0, 16)], 30), material: glowing.id },
    { ...solid('Rough sheet 6 mm', '#ffffff', [160, 60, 0], [rect(40, 40)], 6), material: rough.id },
  ];
  const outline: Sketch = {
    id: newId(),
    name: 'Plate outline',
    group: null,
    groups: [],
    plane: { kind: 'base', axis: 'xy', offset: ex(0) },
    shapes: [rect(120, 80), circle(-45, -25, 5), circle(45, -25, 5), circle(45, 25, 5), circle(-45, 25, 5)],
    visible: true,
  };
  const plate: Body = {
    id: newId(),
    name: 'Plate',
    group: null,
    rotation: unturned(),
    link: null,
    color: '#d8c3a0',
    visible: true,
    position: [ex(0), ex(0), ex(0)],
    features: [
      { id: newId(), type: 'extrude', source: { kind: 'sketch', sketch: outline.id, shapes: outline.shapes.map((s) => s.id) }, depth: ex('$ply'), mode: 'add', through: false },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(8), edges: 'vertical', enabled: true, baked: false, skip: [] },
      { id: newId(), type: 'finish', mode: 'chamfer', size: ex(0.8), edges: 'top', enabled: true, baked: false, skip: [] },
    ],
  };
  const base = newId();
  const disc: Body = {
    id: newId(),
    name: 'Disc',
    group: null,
    rotation: unturned(),
    link: null,
    color: '#a9c4d8',
    visible: true,
    position: [ex(110), ex(0), ex(0)],
    features: [
      { id: base, type: 'extrude', source: { kind: 'own', plane: { kind: 'base', axis: 'xy', offset: ex(0) }, profiles: [circle(0, 0, 50)] }, depth: ex('2 * $ply'), mode: 'add', through: false },
      { id: newId(), type: 'extrude', source: { kind: 'own', plane: { kind: 'cap', feature: base }, profiles: [circle(0, 0, 8)] }, depth: ex(-4), mode: 'cut', through: false },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(2), edges: 'top', enabled: true, baked: false, skip: [] },
    ],
  };
  const corner = { id: newId(), name: 'A group of objects', parent: null, visible: true, origin: { kind: 'parent' } as const };
  const pin = solid('Pin', '#c7b3dc', [30, 0, -10], [circle(0, 0, 16)], 30);
  const block = solid('Block', '#b8cfa1', [-30, 40, 0], [rect(50, 30)], 25, corner.id);
  const ball: Body = {
    id: newId(),
    name: 'Ball',
    group: corner.id,
    rotation: unturned(),
    link: null,
    color: '#d9a98f',
    visible: true,
    position: [ex(-5), ex(55), ex(25)],
    features: [{ id: newId(), type: 'sphere', x: ex(0), y: ex(0), z: ex(0), d: ex(36) }],
  };
  const attached = attachTest();
  const turned = turnedGroup();
  const nut = solid('Hex nut', '#e3d48f', [110, 0, 4], [{ id: newId(), kind: 'ngon', x: ex(0), y: ex(0), d: ex(30), sides: ex(6), rot: ex(0) }, circle(0, 0, 14)], 10);
  return {
    schema: 32,
    units: 'mm',
    params: { $ply: ex('4mm') },
    bodies: [plate, disc, pin, block, ball, nut, ...materialTests, ...edgeTests(), ...cutTest(), split.body, ...hinged.bodies, bulgeTest(), ...fingerTests(), ...coatTests(), ...attached.bodies, ...clash.bodies, stepsTest(), ...turned.bodies, ...linkTest(), ...laserTests(), unfoldTest()],
    sketches: [
      outline,
      {
        id: newId(),
        name: 'Free sketch',
        group: null,
        groups: [],
        plane: { kind: 'base', axis: 'xz', offset: ex(60) },
        shapes: [circle(-20, 20, 24), { ...rect(50, 30), construction: true }],
        visible: true,
      },
      split.sketch,
      ...shapeTests(),
    ],
    groups: [corner, ...hinged.groups, turned.group],
    sections: [],
    joints: [...hinged.joints, clash.joint, attached.joint],
    planes: [slantedPlane()],
    images: [],
    materials: [frosted, glowing, rough],
    photos: [],
    renders: [],
  };
}
