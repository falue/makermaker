import { assignMaterial, changeLook, findMaterial } from '../doc/materials';
import { listedAfter, ownersOf } from '../doc/groups';
import { attach, jointsWithout } from '../doc/joints';
import { ex, newId, unturned } from '../doc/sample';
import type { Body, CoatFeature, Curve, Doc, Expr, Feature, Group, MaterialLook, Profile, Sketch, Unit } from '../doc/types';

/**
 * The CAD command API: every modelling command as a pure step from one document to the next, described well enough
 * for scripts and LLM tools to call (names, what each does, its parameters). The app runs them as undo steps (see
 * `cad` in main); `run` here stays free of the view and the kernel. Lengths are millimetres, angles degrees; a value
 * may also be an expression string (`'2*$ply'`).
 */
export type Param = { name: string; type: 'number' | 'boolean' | 'string' | 'id' | 'ids' | 'point2' | 'point3' | 'points2' | 'points3' | 'curves' | 'enum'; doc: string; optional?: true; values?: readonly string[] };
export type Args = Record<string, unknown>;
export type Result = { doc: Doc; result?: unknown };
export interface Command {
  doc: string;
  params: Param[];
  run(doc: Doc, args: Args): Result;
}

const len = (v: unknown): Expr => ex(typeof v === 'number' ? +v.toFixed(6) : String(v ?? 0));
const deg = len;
const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : v === undefined ? fallback : Number(v));
const xyz = (v: unknown): [number, number, number] => (Array.isArray(v) ? [num(v[0]), num(v[1]), num(v[2])] : [0, 0, 0]);

/** The command's input checked against its parameters: a missing one that is needed, or a wrong type, throws. */
function check(name: string, c: Command, args: Args) {
  for (const p of c.params) {
    const v = args[p.name];
    if (v === undefined) {
      if (!p.optional) throw new Error(`${name}: "${p.name}" is needed (${p.doc})`);
      continue;
    }
    const bad =
      (p.type === 'number' && typeof v !== 'number' && typeof v !== 'string') ||
      (p.type === 'boolean' && typeof v !== 'boolean') ||
      ((p.type === 'string' || p.type === 'id') && typeof v !== 'string') ||
      (p.type === 'ids' && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) ||
      (p.type === 'enum' && !p.values!.includes(v as string)) ||
      ((p.type === 'point2' || p.type === 'point3') && !(Array.isArray(v) && v.length === (p.type === 'point2' ? 2 : 3)));
    if (bad) throw new Error(`${name}: "${p.name}" should be ${p.type === 'enum' ? `one of ${p.values!.join(', ')}` : `a ${p.type}`}`);
  }
}

const palette = ['#d8c3a0', '#a9c4d8', '#b8cfa1', '#d9a98f', '#c7b3dc', '#e3d48f'];

/** A coat as a body of its own beside body `i`, a skin around it: with its own steps, or `linked`, sharing those of the body and attached to it; the id it got. */
export function coatAsBody(doc: Doc, i: number, coat: CoatFeature, linked = false) {
  const { material: _, ...o } = doc.bodies[i];
  const steps = linked ? (o.link ? o.features : []) : [...(doc.bodies.find((b) => b.id === o.link)?.features ?? []), ...o.features];
  // new ids throughout, also where one step names another
  const own: Feature[] = JSON.parse(steps.reduce((text, f) => text.replaceAll(f.id, newId()), JSON.stringify(steps)));
  const body: Body = { ...structuredClone(o), id: newId(), name: `${o.name} coat`, color: palette.filter((c) => c !== o.color)[doc.bodies.length % 5], link: linked ? (o.link ?? o.id) : null, features: [...own, { ...coat, skin: true }], order: undefined };
  const joints = linked ? [...doc.joints, attach(doc, newId(), o.id, [body.id], [0, 0, 0])] : doc.joints;
  return { doc: listedAfter({ ...doc, bodies: [...doc.bodies, body], joints }, [[o.id, body.id]]), id: body.id };
}

/** A box joint's fingers for an overlap `long` by `thick`: each about five thicknesses long, rounded up to an odd number so both ends match, 3 at least. */
export function fingersFor(long: number, thick: number) {
  const n = Math.ceil(long / (5 * thick) - 1e-9);
  return Math.max(3, n % 2 ? n : n + 1);
}

const bodyOf = (doc: Doc, id: unknown) => {
  const i = doc.bodies.findIndex((b) => b.id === id);
  if (i < 0) throw new Error(`no body "${String(id)}"`);
  return i;
};
const sketchOf = (doc: Doc, id: unknown) => {
  const i = doc.sketches.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`no sketch "${String(id)}"`);
  return i;
};
const withBody = (doc: Doc, i: number, b: Body): Doc => ({ ...doc, bodies: doc.bodies.map((x, k) => (k === i ? b : x)) });

/** A new body from `features`, at `at` (mm), named `name` (else "Body n"). */
function addBody(doc: Doc, features: Feature[], at: unknown, name: unknown): Result {
  const n = doc.bodies.length;
  const [x, y, z] = xyz(at);
  const body: Body = { id: newId(), name: typeof name === 'string' ? name : `Body ${n + 1}`, group: null, rotation: unturned(), color: palette[n % palette.length], visible: true, position: [len(x), len(y), len(z)], features, link: null };
  return { doc: { ...doc, bodies: [...doc.bodies, body] }, result: body.id };
}

/** A shape added to sketch `args.sketch`. */
function addShape(doc: Doc, args: Args, shape: Profile): Result {
  const i = sketchOf(doc, args.sketch);
  const s = doc.sketches[i];
  return { doc: { ...doc, sketches: doc.sketches.map((x, k) => (k === i ? { ...s, shapes: [...s.shapes, shape] } : x)) }, result: shape.id };
}

/** An extrusion of its own on the ground, centred on the body's origin. */
const pulled = (profile: Profile, depth: unknown): Feature => ({ id: newId(), type: 'extrude', source: { kind: 'own', plane: { kind: 'base', axis: 'xy', offset: ex(0) }, profiles: [profile] }, depth: len(depth), mode: 'add', through: false });
const rect = (x: unknown, y: unknown, w: unknown, h: unknown, r: unknown = 0): Profile => ({ id: newId(), kind: 'rect', x: len(x), y: len(y), w: len(w), h: len(h), r: len(r), rot: ex(0) });
const circle = (x: unknown, y: unknown, d: unknown): Profile => ({ id: newId(), kind: 'circle', x: len(x), y: len(y), d: len(d) });
const pts2 = (v: unknown) => (Array.isArray(v) ? v.map((p) => [num(p[0]), num(p[1])] as [number, number]) : []);
/** Per side how it bends: null straight, {c1, c2} a bezier curve's handles, {mid} a round arc through that point. */
const curvesOf = (v: unknown) => (Array.isArray(v) && v.some(Boolean) ? { curves: v as (Curve | null)[] } : {});
const curves: Param = { name: 'curves', type: 'curves', doc: 'per side from each point to the next: null straight, {c1: [x, y], c2: [x, y]} a bezier curve, {mid: [x, y]} a round arc through that point', optional: true };
const at3: Param = { name: 'at', type: 'point3', doc: 'where its origin goes, [x, y, z] mm', optional: true };
const named: Param = { name: 'name', type: 'string', doc: 'its name in the list', optional: true };

export const COMMANDS: Record<string, Command> = {
  list: {
    doc: 'What the design holds: bodies (id, name, group, owner: the body a tool body cuts, position, steps), sketches (id, name, shapes), groups, work planes, images, parameters.',
    params: [],
    run: (doc, _a, owners = ownersOf(doc)) => ({
      doc,
      result: {
        units: doc.units,
        parameters: Object.fromEntries(Object.entries(doc.params).map(([k, v]) => [k, v.e])),
        bodies: doc.bodies.map((b) => ({ id: b.id, name: b.name, group: b.group, owner: owners.get(b.id) ?? null, position: b.position.map((p) => p.e), visible: b.visible, steps: b.features.map((f) => f.type) })),
        sketches: doc.sketches.map((s) => ({ id: s.id, name: s.name, plane: s.plane.kind, shapes: s.shapes.map((q) => ({ id: q.id, kind: q.kind })) })),
        groups: doc.groups.map((g) => ({ id: g.id, name: g.name, parent: g.parent })),
        planes: doc.planes.map((w) => ({ id: w.id, name: w.name })),
        images: doc.images.map((im) => ({ id: im.id, name: im.name, width: im.width })),
      },
    }),
  },
  box: {
    doc: 'A new box body: length (x) × width (y), pulled up height (z), centred on its origin at the bottom.',
    params: [{ name: 'length', type: 'number', doc: 'along x, mm' }, { name: 'width', type: 'number', doc: 'along y, mm' }, { name: 'height', type: 'number', doc: 'up, mm' }, { name: 'radius', type: 'number', doc: 'corner radius seen from above, mm', optional: true }, at3, named],
    run: (doc, a) => addBody(doc, [pulled(rect(0, 0, a.length, a.width, a.radius), a.height)], a.at, a.name),
  },
  cylinder: {
    doc: 'A new cylinder body standing up from its origin.',
    params: [{ name: 'diameter', type: 'number', doc: 'mm' }, { name: 'height', type: 'number', doc: 'mm' }, at3, named],
    run: (doc, a) => addBody(doc, [pulled(circle(0, 0, a.diameter), a.height)], a.at, a.name),
  },
  sphere: {
    doc: 'A new ball body centred on its origin.',
    params: [{ name: 'diameter', type: 'number', doc: 'mm' }, at3, named],
    run: (doc, a) => addBody(doc, [{ id: newId(), type: 'sphere', x: ex(0), y: ex(0), z: ex(0), d: len(a.diameter) }], a.at, a.name),
  },
  sketch: {
    doc: 'A new, empty sketch on a base plane (xy: the ground, xz: the front, yz: the side), moved `offset` along its normal.',
    params: [{ name: 'plane', type: 'enum', values: ['xy', 'xz', 'yz'], doc: 'the base plane' }, { name: 'offset', type: 'number', doc: 'mm along its normal', optional: true }, named],
    run: (doc, a) => {
      const s: Sketch = { id: newId(), name: typeof a.name === 'string' ? a.name : `Sketch ${doc.sketches.length + 1}`, group: null, plane: { kind: 'base', axis: a.plane as 'xy' | 'xz' | 'yz', offset: len(a.offset ?? 0) }, shapes: [], groups: [], visible: true };
      return { doc: { ...doc, sketches: [...doc.sketches, s] }, result: s.id };
    },
  },
  rectangle: {
    doc: 'A rectangle in a sketch, centred at x, y of its plane.',
    params: [{ name: 'sketch', type: 'id', doc: 'the sketch' }, { name: 'x', type: 'number', doc: 'centre, mm' }, { name: 'y', type: 'number', doc: 'centre, mm' }, { name: 'width', type: 'number', doc: 'mm' }, { name: 'height', type: 'number', doc: 'mm' }, { name: 'radius', type: 'number', doc: 'corner radius, mm', optional: true }],
    run: (doc, a) => addShape(doc, a, rect(a.x, a.y, a.width, a.height, a.radius)),
  },
  circle: {
    doc: 'A circle in a sketch.',
    params: [{ name: 'sketch', type: 'id', doc: 'the sketch' }, { name: 'x', type: 'number', doc: 'centre, mm' }, { name: 'y', type: 'number', doc: 'centre, mm' }, { name: 'diameter', type: 'number', doc: 'mm' }],
    run: (doc, a) => addShape(doc, a, circle(a.x, a.y, a.diameter)),
  },
  polygon: {
    doc: 'A closed shape in a sketch through its corners; its sides may curve.',
    params: [{ name: 'sketch', type: 'id', doc: 'the sketch' }, { name: 'points', type: 'points2', doc: 'corners [[x, y], …] mm, 3 or more (2 with a curve)' }, curves],
    run: (doc, a) => {
      if (pts2(a.points).length < (curvesOf(a.curves).curves ? 2 : 3)) throw new Error('polygon: 3 corners or more');
      return addShape(doc, a, { id: newId(), kind: 'polygon', pts: pts2(a.points), ...curvesOf(a.curves), r: ex(0), rot: ex(0) });
    },
  },
  line: {
    doc: 'An open line in a sketch through its points (never extruded on its own; lines closing areas are).',
    params: [{ name: 'sketch', type: 'id', doc: 'the sketch' }, { name: 'points', type: 'points2', doc: '[[x, y], …] mm, 2 or more' }, curves],
    run: (doc, a) => {
      if (pts2(a.points).length < 2) throw new Error('line: 2 points or more');
      return addShape(doc, a, { id: newId(), kind: 'line', pts: pts2(a.points), ...curvesOf(a.curves) });
    },
  },
  extrude: {
    doc: "A new body pulled from a sketch's closed shapes (all, or those named) by `depth` (negative: the other way); it stays linked to the sketch.",
    params: [{ name: 'sketch', type: 'id', doc: 'the sketch' }, { name: 'depth', type: 'number', doc: 'mm' }, { name: 'shapes', type: 'ids', doc: 'which shapes (all closed ones if left out)', optional: true }, named],
    run: (doc, a) => {
      const s = doc.sketches[sketchOf(doc, a.sketch)];
      const shapes = (a.shapes as string[] | undefined) ?? s.shapes.filter((q) => q.kind !== 'line' && !q.construction).map((q) => q.id);
      if (!shapes.length) throw new Error('extrude: the sketch has no closed shapes');
      return addBody(doc, [{ id: newId(), type: 'extrude', source: { kind: 'sketch', sketch: s.id, shapes }, depth: len(a.depth), mode: 'add', through: false }], [0, 0, 0], a.name);
    },
  },
  move: {
    doc: 'Moves bodies and groups by a distance (in their group’s coordinates; a group with all it holds).',
    params: [{ name: 'ids', type: 'ids', doc: 'the bodies and groups' }, { name: 'by', type: 'point3', doc: '[dx, dy, dz] mm' }],
    run: (doc, a) => {
      const by = xyz(a.by);
      const [bodies, groups] = [new Set<string>(), new Set<string>()];
      const take = (id: string) => {
        const g = doc.groups.find((x) => x.id === id);
        if (!g) return void (bodyOf(doc, id), bodies.add(id));
        if (g.origin.kind === 'custom') return void groups.add(id); // what it holds sits in its coordinates
        doc.bodies.filter((x) => x.group === id).forEach((x) => bodies.add(x.id));
        doc.groups.filter((x) => x.parent === id).forEach((x) => take(x.id));
      };
      (a.ids as string[]).forEach(take);
      const add = (e: Expr, d: number): Expr => (d ? ex(/^[-+]?[\d.]+$/.test(e.e) ? String(+(Number(e.e) + d).toFixed(6)) : `(${e.e})+${d}`, e.u) : e);
      const moved = (at: [Expr, Expr, Expr]) => at.map((e, k) => add(e, by[k])) as [Expr, Expr, Expr];
      return {
        doc: {
          ...doc,
          bodies: doc.bodies.map((b) => (bodies.has(b.id) ? { ...b, position: moved(b.position) } : b)),
          groups: doc.groups.map((g) => (groups.has(g.id) && g.origin.kind === 'custom' ? { ...g, origin: { ...g.origin, position: moved(g.origin.position) } } : g)),
        },
      };
    },
  },
  place: {
    doc: 'Puts a body at a position (in its group’s coordinates).',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'at', type: 'point3', doc: '[x, y, z] mm' }],
    run: (doc, a) => {
      const i = bodyOf(doc, a.id);
      const [x, y, z] = xyz(a.at);
      return { doc: withBody(doc, i, { ...doc.bodies[i], position: [len(x), len(y), len(z)] }) };
    },
  },
  rotate: {
    doc: 'Turns a body about its origin: degrees around X, then Y, then Z (replacing its turn).',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'x', type: 'number', doc: 'degrees', optional: true }, { name: 'y', type: 'number', doc: 'degrees', optional: true }, { name: 'z', type: 'number', doc: 'degrees', optional: true }],
    run: (doc, a) => {
      const i = bodyOf(doc, a.id);
      return { doc: withBody(doc, i, { ...doc.bodies[i], rotation: { rx: deg(a.x ?? 0), ry: deg(a.y ?? 0), rz: deg(a.z ?? 0) } }) };
    },
  },
  boolean: {
    doc: 'Joins, cuts or intersects: `target` keeps the result, `tools` become its tool bodies (cutters stay as red outlines, the others hide).',
    params: [{ name: 'op', type: 'enum', values: ['union', 'subtract', 'intersect'], doc: 'join, cut or intersect' }, { name: 'target', type: 'id', doc: 'the body that keeps the result' }, { name: 'tools', type: 'ids', doc: 'the bodies it is joined with, cut by or intersected with' }],
    run: (doc, a) => {
      const i = bodyOf(doc, a.target);
      const tools = a.tools as string[];
      tools.forEach((id) => bodyOf(doc, id));
      const op = a.op as 'union' | 'subtract' | 'intersect';
      const bodies = doc.bodies.map((b, k) =>
        tools.includes(b.id) ? { ...b, visible: op === 'subtract' } : k === i ? { ...b, features: [...b.features, ...tools.map((body): Feature => ({ id: newId(), type: 'boolean', op, body }))] } : b,
      );
      return { doc: { ...doc, bodies } };
    },
  },
  fillet: {
    doc: 'Rounds a body’s edges by rule (all, top, bottom, vertical); stays editable, runs last.',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'size', type: 'number', doc: 'radius, mm' }, { name: 'edges', type: 'enum', values: ['all', 'top', 'bottom', 'vertical'], doc: 'which edges' }],
    run: (doc, a) => finish(doc, a, 'fillet'),
  },
  chamfer: {
    doc: 'Bevels a body’s edges by rule (all, top, bottom, vertical); stays editable, runs last.',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'size', type: 'number', doc: 'distance, mm' }, { name: 'edges', type: 'enum', values: ['all', 'top', 'bottom', 'vertical'], doc: 'which edges' }],
    run: (doc, a) => finish(doc, a, 'chamfer'),
  },
  hole: {
    doc: 'A round hole down into a body from the top of its first extrusion, at x, y in that extrusion\u2019s plane (body coordinates for one on the ground); through all unless `depth`.',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'x', type: 'number', doc: 'mm' }, { name: 'y', type: 'number', doc: 'mm' }, { name: 'diameter', type: 'number', doc: 'mm' }, { name: 'depth', type: 'number', doc: 'mm (through if left out)', optional: true }],
    run: (doc, a) => {
      const i = bodyOf(doc, a.id);
      const first = doc.bodies[i].features.find((f) => f.type === 'extrude');
      if (!first) throw new Error('hole: the body has no extrusion to start from');
      const through = a.depth === undefined;
      const cut: Feature = { id: newId(), type: 'extrude', source: { kind: 'own', plane: { kind: 'cap', feature: first.id }, profiles: [circle(a.x, a.y, a.diameter)] }, depth: through ? ex(0) : len(-num(a.depth)), mode: 'cut', through };
      return { doc: withBody(doc, i, { ...doc.bodies[i], features: [...doc.bodies[i].features, cut] }), result: cut.id };
    },
  },
  shell: {
    doc: 'Hollows a body to walls `thickness` thick (inside it); the faces through the `open` points are left open.',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'thickness', type: 'number', doc: 'mm' }, { name: 'open', type: 'points3', doc: 'body points [[x, y, z], …] on faces to leave open', optional: true }],
    run: (doc, a) => {
      const i = bodyOf(doc, a.id);
      const open = Array.isArray(a.open) ? a.open.map(xyz) : [];
      const f: Feature = { id: newId(), type: 'shell', thickness: len(a.thickness), open };
      return { doc: withBody(doc, i, { ...doc.bodies[i], features: [...doc.bodies[i].features, f] }), result: f.id };
    },
  },
  coat: {
    doc: 'Makes a body thicker all round by `thickness`, like paint: sharp corners (a 5 mm cube and 1 mm: 7 mm) or round (the same distance everywhere). `newBody`: the body stays as it is, the coat becomes a body of its own, hollow around it (its id comes back); `linked`: sharing the steps of the body.',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'thickness', type: 'number', doc: 'mm' }, { name: 'corners', type: 'enum', values: ['sharp', 'round'], doc: 'sharp (the default) or round', optional: true }, { name: 'newBody', type: 'boolean', doc: 'a body of its own', optional: true }, { name: 'linked', type: 'boolean', doc: 'that body a linked copy', optional: true }],
    run: (doc, a) => {
      const i = bodyOf(doc, a.id);
      const f: CoatFeature = { id: newId(), type: 'coat', thickness: len(a.thickness), corners: a.corners === 'round' ? 'round' : 'sharp', exclude: [] };
      if (a.newBody) {
        const made = coatAsBody(doc, i, f, a.linked === true);
        return { doc: made.doc, result: made.id };
      }
      return { doc: withBody(doc, i, { ...doc.bodies[i], features: [...doc.bodies[i].features, f] }), result: f.id };
    },
  },
  group: {
    doc: 'Puts bodies and sketches into a new group (they stay where they are).',
    params: [{ name: 'ids', type: 'ids', doc: 'what goes in' }, named],
    run: (doc, a) => {
      const g: Group = { id: newId(), name: typeof a.name === 'string' ? a.name : `Group ${doc.groups.length + 1}`, parent: null, visible: true, origin: { kind: 'parent' } };
      const ids = a.ids as string[];
      const into = <T extends { id: string; group: string | null }>(o: T) => (ids.includes(o.id) ? { ...o, group: g.id } : o);
      return { doc: { ...doc, groups: [...doc.groups, g], bodies: doc.bodies.map(into), sketches: doc.sketches.map(into) }, result: g.id };
    },
  },
  attach: {
    doc: 'Attaches objects (bodies or groups) to one: they move and turn as one, whichever of them moves (its id comes back).',
    params: [{ name: 'id', type: 'id', doc: 'the body or group' }, { name: 'ids', type: 'ids', doc: 'what moves as one with it' }, { name: 'at', type: 'point3', doc: "its anchor, where it shows: [x, y, z] mm in that object's coordinates (its origin if left out)", optional: true }],
    run: (doc, a) => {
      const known = (id: unknown) => doc.bodies.some((b) => b.id === id) || doc.groups.some((g) => g.id === id);
      if (!known(a.id)) throw new Error(`no body or group "${String(a.id)}"`);
      const ids = (a.ids as string[]).filter((id) => id !== a.id);
      const missing = ids.find((id) => !known(id));
      if (missing || !ids.length) throw new Error(missing ? `no body or group "${missing}"` : 'nothing to attach');
      const j = attach(doc, newId(), a.id as string, ids, xyz(a.at));
      return { doc: { ...doc, joints: [...doc.joints, j] }, result: j.id };
    },
  },
  detach: {
    doc: 'Ends an attach: its objects move on their own again.',
    params: [{ name: 'id', type: 'id', doc: 'the attach' }],
    run: (doc, a) => {
      if (!doc.joints.some((j) => j.id === a.id && j.kind === 'attach')) throw new Error(`no attach "${String(a.id)}"`);
      return { doc: { ...doc, joints: doc.joints.filter((j) => j.id !== a.id) } };
    },
  },
  delete: {
    doc: 'Deletes bodies, sketches, work planes and images (a deleted tool body takes its boolean along).',
    params: [{ name: 'ids', type: 'ids', doc: 'what goes' }],
    run: (doc, a) => {
      const gone = new Set(a.ids as string[]);
      const bodies = doc.bodies.filter((b) => !gone.has(b.id)).map((b) => ({ ...b, features: b.features.filter((f) => (f.type !== 'boolean' && f.type !== 'fingers') || !gone.has(f.body)) }));
      return { doc: { ...doc, bodies, joints: jointsWithout(doc.joints, gone), sketches: doc.sketches.filter((s) => !gone.has(s.id)), planes: doc.planes.filter((w) => !gone.has(w.id)), images: doc.images.filter((im) => !gone.has(im.id)) } };
    },
  },
  rename: {
    doc: 'Renames a body, sketch, group, work plane or image.',
    params: [{ name: 'id', type: 'id', doc: 'what' }, { name: 'name', type: 'string', doc: 'its new name' }],
    run: (doc, a) => {
      const to = <T extends { id: string; name: string }>(o: T) => (o.id === a.id ? { ...o, name: a.name as string } : o);
      return { doc: { ...doc, bodies: doc.bodies.map(to), sketches: doc.sketches.map(to), groups: doc.groups.map(to), planes: doc.planes.map(to), images: doc.images.map(to) } };
    },
  },
  color: {
    doc: 'A body’s colour (#rrggbb).',
    params: [{ name: 'id', type: 'id', doc: 'the body' }, { name: 'color', type: 'string', doc: '#rrggbb' }],
    run: (doc, a) => {
      if (!/^#[\da-f]{6}$/i.test(a.color as string)) throw new Error('color: #rrggbb');
      const i = bodyOf(doc, a.id);
      return { doc: withBody(doc, i, { ...doc.bodies[i], color: a.color as string }) };
    },
  },
  material: {
    doc: 'Gives bodies or groups a material (one of the file, or a standard one such as std-wood; none: their group\'s, else their own colour).',
    params: [{ name: 'ids', type: 'ids', doc: 'the bodies and groups' }, { name: 'material', type: 'id', doc: 'its id', optional: true }],
    run: (doc, a) => {
      if (a.material !== undefined && !findMaterial(doc, a.material as string)) throw new Error(`material: no material "${a.material}"`);
      return { doc: assignMaterial(doc, a.ids as string[], a.material as string | undefined) };
    },
  },
  look: {
    doc: 'Changes the look of bodies or groups: a material of the file they share changes, everywhere it is used; else they get a new one of the file. Each value 0 to 1; colours #rrggbb. Returns the material.',
    params: [
      { name: 'ids', type: 'ids', doc: 'the bodies and groups' },
      { name: 'color', type: 'string', doc: '#rrggbb', optional: true },
      { name: 'bump', type: 'number', doc: 'mirror 0, matte 0.5, bumpy 1', optional: true },
      { name: 'reflection', type: 'number', doc: 'how much it mirrors, like metal', optional: true },
      { name: 'translucency', type: 'number', doc: 'solid 0, clear 1', optional: true },
      { name: 'glow', type: 'string', doc: '#rrggbb', optional: true },
      { name: 'glowStrength', type: 'number', doc: 'off 0', optional: true },
      { name: 'overlay', type: 'enum', values: ['metric', 'imperial'], doc: 'a measuring grid', optional: true },
    ],
    run: (doc, { ids, ...patch }) => {
      const next = changeLook(doc, ids as string[], patch as Partial<MaterialLook>, newId());
      return { doc: next, result: next.bodies.find((b) => (ids as string[]).includes(b.id))?.material };
    },
  },
  parameter: {
    doc: 'Sets a named parameter (a number with a unit, or an expression); any value may use it as $name.',
    params: [{ name: 'name', type: 'string', doc: 'a name (letters, digits, _); its $ is added' }, { name: 'value', type: 'string', doc: "e.g. '4mm' or '2*$ply'" }],
    run: (doc, a) => {
      if (!/^\$?[a-z_]\w*$/i.test(a.name as string)) throw new Error('parameter: a name of letters, digits and _');
      return { doc: { ...doc, params: { ...doc.params, [`$${(a.name as string).replace(/^\$/, '')}`]: { e: a.value as string, u: doc.units } } } };
    },
  },
  units: {
    doc: 'The units numbers are shown in (values keep their size).',
    params: [{ name: 'units', type: 'enum', values: ['mm', 'cm', 'm', 'in', 'ft'], doc: 'the display unit' }],
    run: (doc, a) => ({ doc: { ...doc, units: a.units as Unit } }),
  },
};

/** A fillet or chamfer by rule on a body. */
function finish(doc: Doc, a: Args, mode: 'fillet' | 'chamfer'): Result {
  const i = bodyOf(doc, a.id);
  const f: Feature = { id: newId(), type: 'finish', mode, size: len(a.size), edges: a.edges as 'all' | 'top' | 'bottom' | 'vertical', enabled: true, baked: false, skip: [] };
  return { doc: withBody(doc, i, { ...doc.bodies[i], features: [...doc.bodies[i].features, f] }), result: f.id };
}

/** Runs command `name` on `doc` with `args` (checked first); unknown names and bad input throw with what is wrong. */
export function runCommand(doc: Doc, name: string, args: Args = {}): Result {
  const c = COMMANDS[name];
  if (!c) throw new Error(`no command "${name}" (there are: ${Object.keys(COMMANDS).join(', ')})`);
  check(name, c, args);
  return c.run(doc, args);
}

/** The commands as a list of tool descriptions (for scripts and LLMs): name, what it does, its parameters. */
export const describe = () => Object.entries(COMMANDS).map(([name, c]) => ({ name, doc: c.doc, params: c.params }));

/** `next`, a copy from a worker, reusing what is unchanged from `old`: history stays small, big meshes stay one string. */
export function shared<T>(old: T, next: T): T {
  if (old === next || typeof old !== 'object' || typeof next !== 'object' || !old || !next || Array.isArray(old) !== Array.isArray(next)) return next;
  const [a, b] = [old as Record<string, unknown>, next as Record<string, unknown>];
  const out = (Array.isArray(next) ? [] : {}) as Record<string, unknown>;
  const keys = Object.keys(b);
  let same = keys.length === Object.keys(a).length;
  for (const k of keys) {
    out[k] = shared(a[k], b[k]);
    same &&= out[k] === a[k];
  }
  return same ? old : (out as T);
}
