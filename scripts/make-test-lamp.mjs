// Writes testdata/desk-lamp.mmk: a desk lamp on a plinth that uses nearly every feature. Schema changed: update it here.
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

let next = 0;
const id = () => `lamp${(next++).toString(36).padStart(4, '0')}`;
const ex = (e) => ({ e: String(e), u: 'mm' });
const unturned = () => ({ rx: ex(0), ry: ex(0), rz: ex(0) });
const rect = (x, y, w, h, r = 0) => ({ id: id(), kind: 'rect', x: ex(x), y: ex(y), w: ex(w), h: ex(h), r: ex(r), rot: ex(0) });
const circle = (x, y, d) => ({ id: id(), kind: 'circle', x: ex(x), y: ex(y), d: ex(d) });
const base = (axis, offset = 0) => ({ kind: 'base', axis, offset: ex(offset) });
const extrude = (plane, profiles, depth, more = {}) => ({ id: id(), type: 'extrude', source: { kind: 'own', plane, profiles }, depth: ex(depth), mode: 'add', through: false, ...more });
const body = (name, color, group, at, features, more = {}) => ({ id: id(), name, group, rotation: unturned(), link: null, color, visible: true, position: at.map(ex), features, ...more });
const sketch = (name, group, plane, shapes) => ({ id: id(), name, group, plane, shapes, groups: [], visible: true });
const group = (name, parent, origin = { kind: 'parent' }) => ({ id: id(), name, parent, visible: true, origin });
const joint = (name, kind, parent, children, at, dir, min, max, value) => ({ id: id(), name, kind, parent, children, axis: { at, dir }, min: ex(min), max: ex(max), value: ex(value), speed: ex(1) });
const material = (name, color, look) => ({ id: id(), name, color, bump: 0.2, reflection: 0, translucency: 0, glow: '#000000', glowStrength: 0, ...look });

const glow = material('Warm glow', '#fff0d0', { glow: '#ffb060', glowStrength: 0.9 });
const smoked = material('Smoked glass', '#3a4248', { translucency: 0.7, bump: 0.05, reflection: 0.4 });

const lamp = group('Desk lamp', null, { kind: 'custom', position: [-50, 10, 30].map(ex), rotation: unturned() });
const screws = group('Screws', lamp.id);
const arm = group('Arm', lamp.id);
const head = group('Head', arm.id, { kind: 'custom', position: ['arm_l', 0, 182].map(ex), rotation: unturned() });
const tray = group('Pen tray', null);

// the plinth: a drawer's opening cut in from the front, its front top edge picked for a chamfer (it follows plinth_w)
const plinthBase = extrude(base('xy'), [rect(0, 0, 'plinth_w', 160)], 30);
const plinth = body('Plinth', '#a9773f', null, [0, 0, 0], [
  plinthBase,
  extrude(base('xz', -81), [rect(0, 15, 140, 18)], 70, { back: ex(70), mode: 'cut' }),
  { id: id(), type: 'finish', mode: 'chamfer', size: ex(3), edges: { pts: [[[-120, -80, 30], [0, -80, 30], [120, -80, 30]]], normals: [[[0, -1, 0], [0, 0, 1]]] }, enabled: true, baked: false, skip: [] },
], { material: 'wood' });

// the drawer: hollowed, sliding out on a joint
const drawer = body('Drawer', '#b5a13f', null, [0, -45, 7], [extrude(base('xy'), [rect(0, 0, 136, 68)], 16), { id: id(), type: 'shell', thickness: ex(2), open: [[0, 0, 16]] }], { material: 'brass' });
const knob = body('Drawer knob', '#565b61', null, [0, -80, 15], [{ id: id(), type: 'sphere', x: ex(0), y: ex(0), z: ex(0), d: ex(9) }], { material: 'steel' });

// a pen tray: two boards in a box joint
const [fingerA, fingerB] = [id(), id()];
const boardA = body('Tray board A', '#a9773f', tray.id, [70, 50, 30], [extrude(base('xy'), [rect(0, 0, 80, 4)], 30)], { material: 'wood' });
const boardB = body('Tray board B', '#a9773f', tray.id, [108, 73, 30], [extrude(base('xy'), [rect(0, 0, 4, 50)], 30)], { material: 'wood' });
boardA.features.push({ id: fingerA, type: 'fingers', body: boardB.id, count: ex(5), width: ex(0), from: null, first: true });
boardB.features.push({ id: fingerB, type: 'fingers', body: boardA.id, count: ex(5), width: ex(0), from: null, first: false });

// a paperweight: a side pushed out, the top domed; a wedge: one side drafted
const paperweight = body('Paperweight', '#d7e8ef', null, [50, -40, 30], [
  extrude(base('xy'), [rect(0, 0, 40, 40)], 6),
  { id: id(), type: 'push', at: [20, 0, 3], n: [1, 0, 0], distance: ex(4) },
  { id: id(), type: 'bulge', on: { kind: 'face', at: [0, 0, 6], mid: [2, 0, 6], half: [22, 20, 0], n: [0, 0, 1] }, fullness: ex(1), peak: [ex(0), ex(0), ex(7)] },
], { material: smoked.id });
const wedge = body('Wedge', '#c8322d', null, [95, -40, 30], [
  extrude(base('xy'), [rect(0, 0, 30, 40)], 20),
  { id: id(), type: 'draft', at: [15, 0, 10], n: [1, 0, 0], axis: { at: [15, 0, 0], dir: [0, 1, 0] }, angle: ex(12) },
], { material: 'red' });

// the lamp's foot: threaded for the post, notched for the cable (a hidden tool body), its rim picked for a fillet
const notch = body('Cable notch', '#888888', lamp.id, [0, 'base_d/2', -1], [extrude(base('xy'), [rect(0, 0, 14, 16)], 7)], { visible: false });
const rim = Array.from({ length: 65 }, (_, k) => [55 * Math.cos((k * Math.PI) / 32), 55 * Math.sin((k * Math.PI) / 32), 12].map((v) => +v.toFixed(4)));
const footBase = extrude(base('xy'), [circle(0, 0, 'base_d')], 12);
const foot = body('Foot', '#565b61', lamp.id, [0, 0, 0], [
  footBase,
  { ...extrude({ kind: 'cap', feature: footBase.id }, [circle(0, 0, 10.2)], -10), mode: 'cut' },
  { id: id(), type: 'thread', at: [0, 0, 12], dir: [0, 0, -1], r: 5.1, inside: true, size: 'M12', d: ex(12), pitch: ex(1.75), length: ex(10) },
  { id: id(), type: 'boolean', op: 'subtract', body: notch.id },
  { id: id(), type: 'finish', mode: 'fillet', size: ex(2), edges: { pts: [rim], normals: [[[0, 0, 1], [-1, 0, 0]]] }, enabled: true, baked: false, skip: [] },
], { material: 'steel' });

// six screws: one and its linked copies around the foot
const screw = body('Screw', '#b5a13f', screws.id, [42, 0, 12], [extrude(base('xy'), [{ id: id(), kind: 'ngon', x: ex(0), y: ex(0), d: ex(8), sides: ex(6), rot: ex(0) }], 3)], { material: 'brass' });
const copies = [1, 2, 3, 4, 5].map((k) => {
  const a = (k * Math.PI) / 3;
  return body(`Screw ${k + 1}`, '#b5a13f', screws.id, [+(42 * Math.cos(a)).toFixed(3), +(42 * Math.sin(a)).toFixed(3), 12], [], { link: screw.id, rotation: { ...unturned(), rz: ex(k * 60) }, material: 'brass' });
});

// the post: threaded stem, then the tube
const stem = extrude(base('xy'), [circle(0, 0, 12)], 10);
const post = body('Post', '#17171a', lamp.id, [0, 0, 2], [
  stem,
  extrude({ kind: 'cap', feature: stem.id }, [circle(0, 0, 14)], 'post_h'),
  { id: id(), type: 'thread', at: [0, 0, 0], dir: [0, 0, 1], r: 6, inside: false, size: 'M12', d: ex(12), pitch: ex(1.75), length: ex(10) },
], { material: 'pom-black' });

// the arm: a slotted plate and its linked mirror image, a pin, a counterweight cut at an angle
const plate = body('Arm plate', '#565b61', arm.id, [0, 9, 182], [
  extrude(base('xz'), [rect('(arm_l-50)/2', 0, 'arm_l+64', 14, 6.9)], 1.5, { back: ex(1.5) }),
  extrude(base('xz'), [circle(40, 0, 7), circle(80, 0, 7), circle(120, 0, 7)], 0, { mode: 'cut', through: true }),
], { material: 'steel' });
const plateCopy = body('Arm plate mirrored', '#565b61', arm.id, [0, 9, 182], [{ id: id(), type: 'mirror', o: [0, -9, 0], n: [0, 1, 0] }], { link: plate.id, material: 'steel' });
const pin = body('Hinge pin', '#b5a13f', arm.id, [0, 0, 182], [extrude(base('xz'), [circle(0, 0, 6)], 12, { back: ex(12) })], { material: 'brass' });
const weight = body('Counterweight', '#b5a13f', arm.id, [-42, 0, 182], [
  extrude(base('xz'), [circle(0, 0, 34)], 7, { back: ex(7) }),
  { id: id(), type: 'split', cutter: { kind: 'plane', o: [-9, 0, 0], x: [0, 1, 0], n: [1, 0, 0], turn: ex(20), axis: null, offset: ex(0) }, side: 1 },
], { material: 'brass' });

// the head: a lofted shade hollowed and open below, a revolved finial, a glowing bulb
const shadeTop = sketch('Shade top', head.id, base('xy', -6), [circle(0, 0, 36)]);
const shadeRim = sketch('Shade rim', head.id, base('xy', -70), [circle(0, 0, 120)]);
const finialShape = { id: id(), kind: 'polygon', pts: [[0, -7], [9, -7], [6, -3], [4, 3], [0, 5]], r: ex(0), rot: ex(0) };
const finialSketch = sketch('Finial outline', head.id, base('xz'), [finialShape]);
const shade = body('Shade', '#3a4248', head.id, [0, 0, 0], [
  { id: id(), type: 'loft', sections: [{ sketch: shadeTop.id, shape: shadeTop.shapes[0].id }, { sketch: shadeRim.id, shape: shadeRim.shapes[0].id }], ruled: false },
  { id: id(), type: 'shell', thickness: ex(1.5), open: [[0, 0, -70]] },
], { material: smoked.id });
const finial = body('Finial', '#b5a13f', head.id, [0, 0, 0], [{ id: id(), type: 'revolve', source: { kind: 'sketch', sketch: finialSketch.id, shapes: [finialShape.id] }, axis: { at: [0, 0], dir: [0, 1] }, angle: ex(360), mode: 'add' }], { material: 'brass' });
const bulb = body('Bulb', '#fff0d0', head.id, [0, 0, 0], [{ id: id(), type: 'sphere', x: ex(0), y: ex(0), z: ex(-42), d: ex(44) }], { material: glow.id });

// the cable: a circle swept along a line, from the post down over the plinth's edge
const cablePath = sketch('Cable path', lamp.id, base('xz', 0), [{ id: id(), kind: 'line', pts: [[-7, 60], [-30, 30], [-55, 12], [-68, -30]] }]);
const cableProfile = sketch('Cable profile', lamp.id, base('xy', 0), [{ ...circle(-140, 0, 4), construction: false }]);
const cable = body('Cable', '#1c1c1e', lamp.id, [0, 0, 0], [{ id: id(), type: 'sweep', profile: { sketch: cableProfile.id, shape: cableProfile.shapes[0].id }, path: { sketch: cablePath.id, shape: cablePath.shapes[0].id } }], { material: 'black' });

// a slanted work plane along the plinth's back edge, a sign drawn on it
const at = [-110, 78, 30];
const slanted = { id: id(), name: 'Sign plane', o: at, x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1], offset: ex(0), turn: ex(65), axis: { at, dir: [1, 0, 0] }, points: [], mode: 'edge', hull: [at, [-30, 78, 30]], rect: null, visible: true };
const signSketch = sketch('Sign outline', null, { kind: 'work', plane: slanted.id }, [rect(40, 22, 70, 36, 4), circle(40, 22, 14)]);
const sign = body('Sign', '#e8b818', null, [0, 0, 0], [{ id: id(), type: 'extrude', source: { kind: 'sketch', sketch: signSketch.id, shapes: signSketch.shapes.map((q) => q.id) }, depth: ex(3), mode: 'add', through: false }], { material: 'yellow' });

// a drawing on the wall behind it, as a reference picture
const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="400"><rect width="520" height="400" fill="#10365c"/><g fill="none" stroke="#cfe6ff" stroke-width="3"><path d="M40 360H480M120 360V170L300 90"/><path d="M270 95l70 40-60 60z"/><circle cx="120" cy="170" r="10"/></g><text x="40" y="44" fill="#cfe6ff" font-family="monospace" font-size="24">DESK LAMP, REV 3</text></svg>`;
const image = { id: id(), name: 'Blueprint', data: `data:image/svg+xml;base64,${Buffer.from(drawing).toString('base64')}`, frame: { o: [0, 110, 130], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] }, width: 260, opacity: 0.6, key: null, tolerance: 0.1, visible: true };

const doc = {
  schema: 31,
  units: 'mm',
  params: { plinth_w: ex(240), base_d: ex(110), arm_l: ex(200), post_h: ex(170) },
  bodies: [plinth, drawer, knob, boardA, boardB, paperweight, wedge, sign, foot, notch, screw, ...copies, post, plate, plateCopy, pin, weight, shade, finial, bulb, cable],
  sketches: [shadeTop, shadeRim, finialSketch, cablePath, cableProfile, signSketch].map((k) => ({ ...k, visible: false })),
  groups: [lamp, screws, arm, head, tray],
  sections: [{ id: id(), name: 'Through the lamp', origin: [-50, 10, 0], normal: [0, 1, 0], offset: ex(0), enabled: false }],
  joints: [
    joint('Drawer slide', 'slider', plinth.id, [drawer.id, knob.id], [0, -80, 15], [0, -1, 0], 0, 60, 25),
    joint('Arm hinge', 'hinge', post.id, [arm.id], [0, 0, 180], [0, 1, 0], -60, 20, -28),
    joint('Head tilt', 'hinge', plate.id, [head.id], [200, -9, 0], [0, 1, 0], -40, 60, 28),
  ],
  planes: [slanted],
  images: [image],
  materials: [glow, smoked],
  photos: [],
  renders: [],
};

const out = new URL('../testdata/desk-lamp.mmk', import.meta.url);
writeFileSync(out, zipSync({ 'document.json': strToU8(JSON.stringify(doc, null, 2)) }));
console.log(`${doc.bodies.length} bodies, written to ${out.pathname}`);
