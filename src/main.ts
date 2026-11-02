import { zipSync } from 'fflate';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import './style.css';
import { evalLength, evalQuantity, fmt, isPlain, UNITS } from './doc/expr';
import { toBuild } from './doc/expand';
import { BASE, capFrame, cutPlane, extent, frames, moved, placed as inWorld, placeFrame, scale, toWorld, unplaced, type Frame, type Place, type V3 } from './doc/frames';
import { History } from './doc/history';
import { alignment, area, beside, bounds, centre, closedLoop, corners, type Align } from './doc/profiles';
import { pieces } from './doc/arrangement';
import { icon } from './ui/icons';
import { jointed } from './doc/joints';
import type { Lookup } from './doc/expr';
import { getIn, paramLookup, resolve, setIn, UNITLESS, type Resolved } from './doc/resolve';
import { ex, newId, sampleDoc, unturned } from './doc/sample';
import { faceAt, pushed, sideFrame } from './doc/pull';
import { carrierOf, contents, onFaceOf, ownersOf, rank, sourceSketch, tree, whose, within } from './doc/groups';
import { chainOf, unitAt } from './doc/shapegroups';
import type { Area, Body, Joint, BooleanOp, Doc, Expr, ExtrudeSource, Feature, Group, Profile, RenderShot, Sketch, SketchPlacement, SplitFeature, Unit } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, type Version } from './io/design';
import { extents, meshBody, objKind, parseObj, parseStl, toBase64 } from './io/mesh';
import type { BuildFeature } from './kernel/build';
import { Kernel } from './kernel/client';
import { renderUI, scrub, toObjectButton, wantsT, type Measure, type Pick, type RenderJob, type ShapeField, type UIContext } from './ui/panels';
import { sectionControls } from './ui/sections';
import { loadSettings, openSettings } from './ui/settings';
import { MAC, pressed, type Action } from './ui/keys';
import { installCompletion } from './ui/complete';
import { installTooltips } from './ui/tooltip';
import { keepInside } from './ui/inside';
import { ANGLE_STEPS, SketchTool, uvOf, type Cap, type Drawn, type DrawnProfile, type SketchResult, type Target, type ToolHost, type ToolKind, type ViewSketch } from './viewer/sketch';
import { anchorAt, moved as shifted, placed, rotated, sizedTo, sizeOf, turnedTo } from './viewer/shapes';
import { Viewer, type FinishPick, type PickedFace, type PickedPart, type TurnAxis, type Vec3 } from './viewer/viewer';

// over the 3D view, the pointer's note stays inside it
const tips = installTooltips(500, () => document.getElementById('viewport')!.getBoundingClientRect());
// a calculation's result: turns in degrees, sides and scales bare, else lengths in the document's units
installCompletion(
  () => Object.keys(history.current.params),
  (text, field) => {
    if (!text.trim() || isPlain(text)) return null;
    const mm = length(text);
    if (mm === null || !Number.isFinite(mm)) return null;
    const u = history.current.units;
    const path = field.dataset.path ?? '';
    const v = fmt(+(mm / UNITS[u]).toFixed(4));
    return /\.(rot|rx|ry|rz)$/.test(path) ? `${v}°` : /\.(sides|scale)$/.test(path) ? v : `${v} ${u}`;
  },
);
let settings = loadSettings();
const savedTheme = localStorage.getItem('makermaker.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
const history = new History<Doc>(sampleDoc());
/** Selected objects (bodies and sketches) and, inside a single selected sketch, its selected shapes. */
let selected: string[] = history.current.bodies.slice(0, 1).map((p) => p.id);
let shapeSel: string[] = [];
/** The sketch in sketch mode: shapes drawn into it stay flat. */
let sketching: string | null = null;
/** The open sub-groups of the sketch group in sketch mode, outermost first (none: the sketch group itself). */
let sketchPath: string[] = [];
/** Bodies shown fully in sketch mode (the others are see-through), by their eye. */
let solid = new Set<string>();
/** What the running tool does: one shape then pull, sketch mode, pulling shapes, or picking a plane for a new sketch. */
let toolMode: 'direct' | 'draw' | 'pull' | 'plane' | null = null;
let exprErrors = new Map<string, string>();
const kernelErrors = new Map<string, { featureId: string; error: string }>();
/** Bodies that cannot be built because of a linked sketch, from the last update. */
let linkErrors = new Map<string, { featureId: string; error: string }>();
/** Resolved body positions in mm, from the last update. */
const positions = new Map<string, Vec3>();
/** World placements from the last update: group origins (a body's position counts from its group's), bodies. */
const groupPlaces = new Map<string, Matrix4>();
const bodyPlaces = new Map<string, Matrix4>();
const groupPlace = (id: string | null) => groupPlaces.get(id ?? '') ?? new Matrix4();
/** Own placements from the last update: a group's origin in its parent, a body's position and turn in its group. */
const ownPlaces = new Map<string, Matrix4>();
/** What a body's position or a group's origin counts from in the world: its group's origin, moved by its joint. */
const parentPlace = (id: string) => (bodyPlaces.get(id) ?? groupPlace(id)).clone().multiply((ownPlaces.get(id) ?? new Matrix4()).clone().invert());
/** Joints left still in the last update, and why. */
let jointProblems: string[] = [];

/**
 * What To object measures for the value at `path` (mm, at a clicked world point): a body's position or a group's origin
 * along its axis (its origin there), a section's offset (it goes through the point), a sketch's or own shapes' base
 * plane offset (the plane goes through it); null: nothing.
 */
function measureAt([k, i, ...rest]: string[]): ((p: Vector3) => number) | null {
  const doc = history.current;
  const at = rest.join('.');
  const axis = +(rest.at(-1) ?? 0);
  const local = (frame: Matrix4) => (p: Vector3) => p.clone().applyMatrix4(frame.clone().invert());
  if (k === 'bodies' && at.match(/^position\.\d$/)) return (p) => local(parentPlace(doc.bodies[+i].id))(p).getComponent(axis);
  if (k === 'groups' && at.match(/^origin\.position\.\d$/)) return (p) => local(parentPlace(doc.groups[+i].id))(p).getComponent(axis);
  if (k === 'sections' && at === 'offset') {
    const s = doc.sections[+i];
    const n = new Vector3(...s.normal).normalize();
    return (p) => p.clone().sub(new Vector3(...s.origin)).dot(n);
  }
  const s = k === 'sketches' && at === 'plane.offset' ? doc.sketches[+i] : undefined;
  if (s?.plane.kind === 'base') {
    const n = new Vector3(...BASE[s.plane.axis].n);
    return (p) => local(groupPlace(s.group))(p).dot(n);
  }
  const f = k === 'bodies' && at.match(/^features\.\d+\.source\.plane\.offset$/) ? doc.bodies[+i].features[+rest[1]] : undefined;
  if (f?.type === 'extrude' && f.source.kind === 'own' && f.source.plane.kind === 'base') {
    const n = new Vector3(...BASE[f.source.plane.axis].n);
    return (p) => local(bodyPlaces.get(doc.bodies[+i].id) ?? new Matrix4())(p).dot(n);
  }
  return null;
}

/** Where a joint is now: degrees (hinge) or mm (slider); 0 while its value is no number. */
function jointValue(j: Joint, lookup: Lookup) {
  try {
    return evalLength(j.value, lookup);
  } catch {
    return 0;
  }
}

/** A rigid matrix as a turn around an axis, then a move. */
function toPlace(m: Matrix4): Place {
  const [offset, q] = [new Vector3(), new Quaternion()];
  m.decompose(offset, q, new Vector3());
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  const angle = (2 * Math.acos(Math.min(1, q.w)) * 180) / Math.PI;
  return { axis: s < 1e-9 ? [0, 0, 1] : [q.x / s, q.y / s, q.z / s], angle: s < 1e-9 ? 0 : angle, offset: offset.toArray() };
}

/** A turn in degrees around X, then Y, then Z (of the parent) as a quaternion. */
const turnOf = (r: { rx: number; ry: number; rz: number }) => {
  const rad = (v: number) => (v * Math.PI) / 180;
  return new Quaternion().setFromEuler(new Euler(rad(r.rx), rad(r.ry), rad(r.rz), 'ZYX'));
};

/** Where body `id` sits in the world. */
const bodyPlace = (id: string) => toPlace(bodyPlaces.get(id) ?? new Matrix4());
/** Imported meshes shown in the viewer, per body: which feature at which scale. */
const shownMeshes = new Map<string, string>();
/** Build features per body (tool bodies inside), from the last update. */
const built = new Map<string, BuildFeature[]>();
/** A sketch placement's world frame, as of the last update. */
let frameOf: (p: Resolved<SketchPlacement>) => Frame | undefined = () => undefined;

/**
 * Where shapes drawn on a body face go: an extrusion's end face or straight side face (they follow it), else, if the
 * face is flat, a fixed plane on it (x as level as possible).
 */
function placeOn(face: PickedFace, flat: boolean): Omit<Target, 'sketch'> | null {
  const features = built.get(face.body ?? '');
  const out = face.normal.clone().negate().toArray();
  const pl = bodyPlace(face.body ?? '');
  const hit = features && faceAt(features, unplaced(pl, face.point.toArray()), unplaced(pl, out, true));
  const owner = hit && history.current.bodies.find((b) => b.features.some((f) => f.id === hit.feature))?.id;
  const placement: Resolved<SketchPlacement> | null =
    !hit || !owner ? null : hit.kind === 'cap' ? { kind: 'cap', body: owner, feature: hit.feature } : hit.edge >= 0 ? { kind: 'side', body: owner, feature: hit.feature, shape: hit.shape, edge: hit.edge, flip: hit.rate < 0 } : null;
  const frame = placement && frameOf(placement);
  if (placement && frame) return { placement, frame, body: face.body ?? null, name: 'this face' };
  if (!flat) return null;
  const n = new Vector3(...out);
  const x = new Vector3(0, 0, 1).cross(n);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const plane = { o: face.point.toArray(), x: x.toArray(), y: n.clone().cross(x).toArray(), n: out };
  return { placement: { kind: 'plane', ...plane }, frame: plane, body: face.body ?? null, name: 'this face' };
}
let file: { name: string; handle?: FileSystemFileHandle; versions: Version[]; saved: Doc } = {
  name: `untitled${EXTENSION}`,
  versions: [],
  saved: history.current,
};
let status = '';
let statusError = false;
/** Bodies whose STEP files the kernel reads now (shown with a progress bar), and the STEP features read already. */
const reading = new Map<string, { name: string; steps: string[] }>();
const readSteps = new Set<string>();
/** Faces or edges picked with Alt-click, with their area (mm²) or length (mm). */
let pickedPart: PickedPart | null = null;
/** Other work going on, shown with the same bar (e.g. "Snapshot"). */
const busy = new Set<string>();
let toolHint: string | null = null;
/** The selected part of a fillet / chamfer (Del leaves that edge out; the whole finish: deletes it). */
let finishSel: FinishPick | null = null;
/** A face pick running for the extrude tool (E, then a face). */
let extrudePick = false;
/** A tool picked before its objects: its toolbar name, and what clicking a body does (Enter applies booleans). */
let pending: { tool: 'boolean' | 'delete' | 'duplicate' | 'hide' | 'group' | 'move' | 'cut' | 'joint'; pick(id: string, how: Pick): void; apply?(): void } | null = null;
let autosave = localStorage.getItem('makermaker.autosave') === 'on';
let autosaveTimer = 0;
/** The body shown alone, and what was visible before (bodies and sketches by id). */
let isolated: { body: string; before: Map<string, boolean> } | null = null;
/** All bodies or all sketches hidden for now (the list titles' eyes); their own eyes stay as they are. */
const hideAll = { objects: false, sketches: false };

const len = (mm: number, typed?: string) => ex(typed ?? fmt(mm / UNITS[history.current.units]), history.current.units);

/** A typed length in mm, or null if invalid. */
function length(text: string) {
  try {
    return evalLength({ e: text, u: history.current.units }, paramLookup(history.current.params));
  } catch {
    return null;
  }
}

/** A typed plain number (an angle), or null if invalid or a length. */
function number(text: string) {
  try {
    const q = evalQuantity({ e: text, u: history.current.units }, paramLookup(history.current.params));
    return q.dim === 0 ? q.v : null;
  } catch {
    return null;
  }
}

const viewer = new Viewer(document.getElementById('viewport')!, {
  select,
  move: place,
  pickShape,
  setShapes,
  length,
  placeOn,
  touched() {
    if (!rendersOpen) return;
    rendersOpen = false; // choosing something in the view shows it, not the renders
    render();
  },
  pickFinish(sel) {
    finishSel = sel;
    viewer.setFinishMark(sel);
    render();
  },
  format: (mm) => `${fmt(mm / UNITS[history.current.units])} ${history.current.units}`,
  dragFinish(body, feature, at) {
    const before = history.current;
    const i = before.bodies.findIndex((b) => b.id === body);
    const j = before.bodies[i]?.features.findIndex((f) => f.id === feature) ?? -1;
    const f = before.bodies[i]?.features[j];
    if (f?.type !== 'finish') return;
    // fillets count up from 0, chamfers down: dragging past 0 turns one into the other
    const mm = evalLength(f.size, paramLookup(before.params));
    const start = f.mode === 'fillet' ? mm : -mm;
    for (const kind of ['fillet', 'chamfer']) finishMax.delete(`${feature} ${kind}`); // learnt again while dragging
    const apply = (d: number) => {
      const v = clamped(feature, start + d);
      const mode = v >= 0 ? 'fillet' : 'chamfer';
      const size = mode === f.mode ? plus(f.size, mm, Math.max(Math.abs(v), 0.1) - mm) : len(Math.max(Math.abs(v), 0.1)); // same kind: the expression stays
      return setIn(before, ['bodies', String(i), 'features', String(j)], { ...f, mode, size });
    };
    let pushed = false;
    viewer.startFacePull(
      toolHost,
      viewer.screenDir(0, 1).toArray(),
      at,
      (d, phase) => {
        if (phase === 'cancel') {
          if (pushed) history.undo();
          stopTool();
          return update();
        }
        if (pushed || Math.abs(d) >= 0.1) {
          if (pushed) history.replace(apply(d));
          else history.push(apply(d));
          pushed = true;
          update();
        }
        if (phase === 'done') stopTool(), render();
      },
      {
        hint: 'Drag up: bigger, down: smaller (past 0 a fillet turns into a chamfer and back) · [Shift] coarse · [Ctrl] precise · type a change · release or [Enter]: done · [Esc] puts it back',
        label: (d, typed) => {
          const v = clamped(feature, start + d);
          return `${v >= 0 ? 'Fillet' : 'Chamfer'} ${typed === undefined ? Math.abs(v).toFixed(2) : `${typed}▏`}`;
        },
        endOnUp: true,
      },
    );
  },
  dragEdges(body, edges) {
    const before = history.current;
    const i = before.bodies.findIndex((b) => b.id === body);
    if (i < 0) return;
    // the edges in body coordinates (the finish runs there), as polylines
    const pl = bodyPlace(body);
    const pts = edges.map((segs) => [segs[0][0], ...segs.map((s) => s[1])].map((v) => unplaced(pl, v.toArray()).map((x) => +x.toFixed(4)) as [number, number, number]));
    const id = newId();
    // sizes stop at the largest the kernel found to fit (learnt while dragging)
    const apply = (mm: number) =>
      setIn(before, ['bodies', String(i), 'features'], [...before.bodies[i].features, { id, type: 'finish', mode: mm >= 0 ? 'fillet' : 'chamfer', size: len(Math.max(Math.abs(clamped(id, mm)), 0.1)), edges: { pts }, enabled: true, baked: false, skip: [] } satisfies Feature]);
    const [a, b] = edges[0][Math.floor(edges[0].length / 2)];
    let pushed = false;
    viewer.startFacePull(
      toolHost,
      viewer.screenDir(0, 1).toArray(),
      a.clone().lerp(b, 0.5),
      (mm, phase) => {
        if (phase === 'cancel') {
          if (pushed) history.undo();
          stopTool();
          return update();
        }
        if (pushed || Math.abs(mm) >= 0.1) {
          if (pushed) history.replace(apply(mm));
          else history.push(apply(mm));
          pushed = true;
          update();
        }
        if (phase === 'done') stopTool(), render();
      },
      {
        hint: 'Drag up: fillet, down: chamfer · [Shift] coarse · [Ctrl] precise · type a size (minus: chamfer) · release or [Enter]: done · [Esc] puts it back',
        label: (mm, typed) => `${mm >= 0 ? 'Fillet' : 'Chamfer'} ${typed === undefined ? Math.abs(mm).toFixed(2) : `${typed}▏`}`,
        endOnUp: true,
      },
    );
  },
  enterShape(sketch, shape) {
    const s = history.current.sketches.find((x) => x.id === sketch);
    const q = s?.shapes.find((x) => x.id === shape);
    if (!s || !q) return;
    if (pending?.tool === 'move') return pickShape(sketch, shape, false); // that shape moves, without entering
    if (picks(sketch)) return select(sketch);
    if (sketching !== sketch) enterSketch(sketch, null, true);
    sketchPath = chainOf(s, q.group);
    [selected, shapeSel] = [[sketch], [shape]];
    showSelection();
  },
  pickedPart(part) {
    pickedPart = part;
    render();
  },
});

const sections = sectionControls(
  document.getElementById('viewport')!,
  (axis, from, to, inverted) => viewer.setSection(axis, from, to, inverted),
  newSection,
);
viewer.onBounds = sections.bounds;

/** The settings of this browser, in the view. */
function applySettings() {
  viewer.minStep = settings.minStep;
  viewer.minAngle = settings.minAngle;
  SketchTool.guideMs = settings.guideMs;
  viewer.setAO(settings.ao);
  viewer.setBackdrop(settings.background);
}
applySettings();

const kernel = new Kernel((r) => {
  for (const id of reading.get(r.id)?.steps ?? []) readSteps.add(id);
  reading.delete(r.id);
  if (!history.current.bodies.some((p) => p.id === r.id)) return render(); // deleted while it was built
  if ('mesh' in r) {
    kernelErrors.delete(r.id);
    viewer.setBody(r.id, r.mesh);
  } else {
    kernelErrors.set(r.id, r); // the viewer keeps the last valid geometry
    if (r.max) clampFinish(r.id, r.featureId, r.max);
  }
  render();
});

/** Resolves expressions, moves bodies, and rebuilds bodies whose features changed and resolved cleanly. */
function update() {
  const doc = history.current;
  const lookup = paramLookup(doc.params);
  exprErrors = new Map();
  for (const name of Object.keys(doc.params))
    try {
      lookup(name);
    } catch (err) {
      exprErrors.set(`params.${name}`, (err as Error).message);
    }
  const builds: { id: string; features: BuildFeature[] }[] = [];
  const caps: Cap[] = [];
  // sketches with an invalid value are left out, so their extrusions wait like bodies with one
  const sketches = new Map(
    doc.sketches.flatMap((s, i) => {
      const before = exprErrors.size;
      const resolved = resolve(s, lookup, `sketches.${i}`, exprErrors);
      return exprErrors.size === before ? [[s.id, resolved] as const] : [];
    }),
  );
  linkErrors = new Map();
  // own placements (a custom group origin moved and turned in its parent's, a body's position and turn in its group),
  // then everything in the world with the joints where they are now
  ownPlaces.clear();
  const fine = (v: number) => (Number.isFinite(v) ? v : 0);
  const deg = (v: number) => (fine(v) * Math.PI) / 180;
  doc.groups.forEach((g, i) => {
    if (g.origin.kind !== 'custom') return;
    const at = `groups.${i}.origin`;
    const [x, y, z] = resolve(g.origin.position, lookup, `${at}.position`, exprErrors).map(fine);
    const r = resolve(g.origin.rotation, lookup, `${at}.rotation`, exprErrors);
    // degrees around the parent's X, then Y, then Z
    ownPlaces.set(g.id, new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(deg(r.rx), deg(r.ry), deg(r.rz), 'ZYX')), new Vector3(1, 1, 1)));
  });
  const still = new Set<string>(); // bodies whose position or turn is no number: they stay where they were
  doc.bodies.forEach((p, i) => {
    const local = resolve(p.position, lookup, `bodies.${i}.position`, exprErrors);
    const turned = resolve(p.rotation, lookup, `bodies.${i}.rotation`, exprErrors);
    if (local.every(Number.isFinite) && [turned.rx, turned.ry, turned.rz].every(Number.isFinite)) ownPlaces.set(p.id, new Matrix4().compose(new Vector3(...local), turnOf(turned), new Vector3(1, 1, 1)));
    else still.add(p.id);
  });
  const { placed, problems } = jointed(doc, ownPlaces, (j) => jointValue(j, lookup));
  jointProblems = problems;
  groupPlaces.clear();
  for (const g of doc.groups) groupPlaces.set(g.id, placed.get(g.id)!);
  const shownIn = (id: string | null) => {
    for (const seen = new Set<string>(); id && !seen.has(id); ) {
      const g = doc.groups.find((q) => q.id === id);
      if (!g) break;
      if (!g.visible) return false;
      seen.add(id);
      id = g.parent;
    }
    return true;
  };
  // 1: own features (sketches on other bodies' faces wait for those faces; faces never depend on booleans)
  const own = new Map<string, Map<string, BuildFeature>>();
  let pending = doc.bodies.flatMap((p, i) => {
    if (!still.has(p.id)) {
      const m = placed.get(p.id)!;
      bodyPlaces.set(p.id, m);
      const [at, turn] = [new Vector3(), new Quaternion()];
      m.decompose(at, turn, new Vector3());
      positions.set(p.id, at.toArray());
      viewer.setPlacement(p.id, at, turn);
    }
    const before = exprErrors.size;
    const resolved = resolve(p.features, lookup, `bodies.${i}.features`, exprErrors);
    return exprErrors.size === before ? [{ id: p.id, resolved, at: bodyPlace(p.id) }] : [];
  });
  const resolvedOf = new Map(pending.map((b) => [b.id, b.resolved]));
  /** A placement's frame in the world; undefined while its body is not built (or its face is gone). */
  const worldFrame = (p: Resolved<SketchPlacement>): Frame | undefined => {
    if (p.kind === 'base') return { ...BASE[p.axis], o: scale(BASE[p.axis].n, p.offset) };
    if (p.kind === 'plane') return { o: p.o, x: p.x, y: p.y, n: p.n };
    if (p.kind === 'cap') return caps.find((c) => c.body === p.body && c.feature === p.feature)?.frame;
    const parts = own.get(p.body);
    const f = parts && sideFrame([...parts.values()], p.feature, p.shape, p.edge, p.flip);
    return f && placeFrame(bodyPlace(p.body), f);
  };
  frameOf = worldFrame;
  for (let progress = true; pending.length && progress; ) {
    progress = false;
    pending = pending.filter(({ id, resolved, at }) => {
      // a sketch on this body's own face is unplaced into its coordinates; one elsewhere counts in them as it is (as base
      // planes do): the body moves away from it freely, and its sketch is shown moved along
      // a cutting sketch where it is in the world (a base-plane one placed by its group), in this body's coordinates
      const cutterFrame = (sk: Resolved<Sketch>) => {
        const w = sk.plane.kind === 'base' ? placeFrame(toPlace(groupPlace(sk.group)), worldFrame(sk.plane)!) : worldFrame(sk.plane);
        return w && placeFrame(at, w, true);
      };
      const faceOf = (p: Exclude<Resolved<SketchPlacement>, { kind: 'base' }>) => {
        const f = worldFrame(p);
        return f && (p.kind !== 'plane' && p.body === id ? placeFrame(at, f, true) : f);
      };
      const built = new Map<string, BuildFeature>();
      for (const s of resolved) {
        if (s.type === 'boolean' || s.type === 'mesh') continue; // meshes are shown as they are
        const b = toBuild(s, id, sketches, faceOf, cutterFrame);
        if (b === null) return true; // wait for the other body
        if (typeof b === 'string') return (progress = true), linkErrors.set(id, { featureId: s.id, error: `Cannot build: ${b}` }), false;
        built.set(s.id, b);
      }
      progress = true;
      own.set(id, built);
      const list = [...built.values()].filter((f) => f.type !== 'boolean');
      const plan = frames(list);
      for (const s of list) {
        const f = plan.get(s.id);
        if (s.type === 'extrude' && f && !s.through) caps.push({ body: id, feature: s.id, frame: placeFrame(at, capFrame(f, s.depth)) });
      }
      return false;
    });
  }
  for (const { id, resolved } of pending) linkErrors.set(id, { featureId: resolved[0]?.id ?? '', error: "Cannot build: its sketch's face is gone, or sketches lie on each other's faces in a circle" });
  // 2: booleans take their tool bodies' full features, placed as the tool sits in the body's coordinates
  built.clear();
  const full = new Map<string, BuildFeature[] | string>();
  const fullOf = (id: string, path: string[] = []): BuildFeature[] | string => {
    const done = full.get(id);
    if (done) return done;
    if (path.includes(id)) return 'bodies cut or join each other in a circle';
    const parts = own.get(id);
    if (!parts) return 'its tool body cannot be built';
    const out: BuildFeature[] = [];
    for (const s of resolvedOf.get(id)!) {
      if (s.type === 'mesh') continue;
      if (s.type !== 'boolean') {
        out.push(parts.get(s.id)!);
        continue;
      }
      if (!doc.bodies.some((b) => b.id === s.body)) return 'its tool body was deleted';
      if (resolvedOf.get(s.body)?.some((f) => f.type === 'mesh')) return 'a mesh body cannot be a tool body yet';
      const tool = fullOf(s.body, [...path, id]);
      if (typeof tool === 'string') return tool;
      const relative = (bodyPlaces.get(id) ?? new Matrix4()).clone().invert().multiply(bodyPlaces.get(s.body) ?? new Matrix4());
      out.push({ id: s.id, type: 'boolean', op: s.op, features: tool, place: toPlace(relative) });
    }
    full.set(id, out);
    return out;
  };
  for (const id of own.keys()) {
    // an imported mesh skips the kernel: the viewer shows it as it is (again when it or its scale changed)
    const mesh = resolvedOf.get(id)?.find((f) => f.type === 'mesh');
    if (mesh) {
      const key = `${mesh.id} ${mesh.scale}`;
      if (shownMeshes.get(id) !== key && mesh.scale > 0) viewer.setBody(id, meshBody(mesh.vertices, mesh.triangles, mesh.scale)), shownMeshes.set(id, key);
      continue;
    }
    const features = fullOf(id);
    if (typeof features === 'string') linkErrors.set(id, { featureId: resolvedOf.get(id)?.find((f) => f.type === 'boolean')?.id ?? '', error: `Cannot build: ${features}` });
    else builds.push({ id, features }), built.set(id, features);
  }
  // sketches in the world: base planes as they are, face sketches with their body
  const palette = [0x3b6fd8, 0x9b4dca, 0x0f9d8a, 0x5a8f29, 0xc2417a, 0x8a6d3b];
  const shown: ViewSketch[] = doc.sketches.flatMap((s, i) => {
    const r = sketches.get(s.id);
    const p = r?.plane;
    if (!r || !p || !s.visible || (hideAll.sketches && s.id !== sketching) || !shownIn(s.group)) return [];
    // a sketch moves with the body that extrudes it (its extrusion lies in that body's coordinates), else a base-plane one with its group
    const carrier = carrierOf(doc, s.id);
    const world = worldFrame(p);
    const frame = world && (carrier && bodyPlaces.has(carrier) ? placeFrame(bodyPlace(carrier), world) : p.kind === 'base' ? placeFrame(toPlace(groupPlace(s.group)), world) : world);
    return frame ? [{ id: s.id, color: palette[i % palette.length], frame, placement: p, shapes: r.shapes, groups: s.groups }] : [];
  });
  viewer.setCustomSections(
    doc.sections.flatMap((c, i) => {
      const offset = resolve(c.offset, lookup, `sections.${i}.offset`, exprErrors);
      return c.enabled && Number.isFinite(offset) ? [{ point: c.origin.map((v, k) => v + c.normal[k] * offset) as Vec3, normal: c.normal }] : [];
    }),
  );
  const ids = new Set(doc.bodies.map((p) => p.id));
  for (const id of kernelErrors.keys()) if (!ids.has(id)) kernelErrors.delete(id);
  for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id), bodyPlaces.delete(id);
  selected = selected.filter((id) => ids.has(id) || [...doc.sketches, ...doc.groups].some((o) => o.id === id));
  if (isolated && !ids.has(isolated.body)) isolated = null;
  const shapes = doc.sketches.find((s) => s.id === activeSketch())?.shapes ?? [];
  shapeSel = shapeSel.filter((id) => shapes.some((q) => q.id === id));
  const owner = ownersOf(doc);
  // sphere centres snap like corners; their outlines give guides
  viewer.setSpheres(
    doc.bodies.flatMap((b) =>
      b.visible && !hideAll.objects && shownIn(b.group) ? (resolvedOf.get(b.id) ?? []).flatMap((f) => (f.type === 'sphere' ? [{ center: new Vector3(...inWorld(bodyPlace(b.id), [f.x, f.y, f.z])), r: f.d / 2, body: b.id }] : [])) : [],
    ),
  );
  viewer.setLooks(doc.bodies.map((b) => ({ ...b, visible: b.visible && !hideAll.objects && shownIn(b.group), owner: owner.get(b.id), cutter: doc.bodies.some((o) => o.features.some((f) => f.type === 'boolean' && f.body === b.id)) })));
  viewer.select(contents(doc, selected));
  viewer.setSketches(shown, activeSketch(), shapeSel);
  const drawn = shown.find((s) => s.id === sketching);
  if (sketching && !drawn) exitSketch();
  else viewer.setSketchGrid(drawn?.frame ?? null);
  viewer.retain(ids);
  // STEP files not read yet: a progress bar until their body comes back
  const stepsOf = (fs: BuildFeature[]): Extract<BuildFeature, { type: 'step' }>[] => fs.flatMap((f) => (f.type === 'step' ? [f] : f.type === 'boolean' ? stepsOf(f.features) : []));
  for (const b of builds) {
    const fresh = stepsOf(b.features).filter((s) => !readSteps.has(s.id));
    if (fresh.length) reading.set(b.id, { name: fresh.map((s) => s.source).join(', '), steps: fresh.map((s) => s.id) });
  }
  kernel.build(builds);
  scheduleAutosave();
  render();
}

function commit(next: Doc) {
  history.push(follow(history.current, next));
  update();
}

/** Tool bodies stick to their owner: an owner moved from `before` to `next` takes those that did not move themselves along. */
function follow(before: Doc, next: Doc): Doc {
  const owner = ownersOf(next);
  if (!owner.size) return next;
  const at = (doc: Doc, id: string) => {
    const b = doc.bodies.find((q) => q.id === id);
    return b && (resolve(b.position, paramLookup(doc.params), '', new Map()) as Vec3);
  };
  const by = (id: string) => {
    const [p, q] = [at(before, id), at(next, id)];
    return p && q && (q.map((v, k) => v - p[k]) as Vec3);
  };
  const still = (v: Vec3 | undefined) => !v || v.every((x) => !(Math.abs(x) > 1e-9));
  let out = next;
  const drag = (id: string, d: Vec3, seen: Set<string>) => {
    for (const [tool, o] of owner) {
      // a tool drawn on its owner's face goes along with that face already
      if (o !== id || seen.has(tool) || !still(by(tool)) || onFaceOf(next, tool, id)) continue;
      seen.add(tool);
      const i = out.bodies.findIndex((b) => b.id === tool);
      const p = at(out, tool)!;
      out = setIn(out, ['bodies', String(i), 'position'], out.bodies[i].position.map((x, k) => plus(x, p[k], d[k])));
      drag(tool, d, seen);
    }
  };
  for (const b of next.bodies) {
    const d = by(b.id);
    if (d && !still(d) && d.every(Number.isFinite)) drag(b.id, d, new Set([b.id]));
  }
  return out;
}

/** The selected sketch, if it is the only selection. */
function activeSketch() {
  return selected.length === 1 && history.current.sketches.some((s) => s.id === selected[0]) ? selected[0] : null;
}

/** Ranges (and toggles) run from the last selected item of `list` to `id`, the first one staying first. */
function picked(sel: string[], list: string[], id: string, how: Pick) {
  if (!how) return [id];
  const anchor = how === 'range' ? sel.findLast((x) => list.includes(x)) : undefined;
  if (!anchor) return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
  const [a, b] = [list.indexOf(anchor), list.indexOf(id)];
  const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
  return [...sel.filter((x) => !range.includes(x)), ...(a <= b ? range : range.reverse())];
}

/** Whether a waiting tool takes the object clicked (instead of selecting or entering it): bodies; sketches unless for a boolean or group; groups to move. */
function picks(id: string) {
  if (!pending) return false;
  const { bodies, sketches, groups } = history.current;
  const lists = [bodies, ...(['boolean', 'group', 'cut', 'joint'].includes(pending.tool) ? [] : [sketches]), ...(['move', 'joint'].includes(pending.tool) ? [groups] : [])];
  return lists.some((list) => list.some((o) => o.id === id));
}

/**
 * `how`: true toggles the object (body or sketch), 'range' selects a range of its list; null clears the selection
 * (unless adding). Selecting something else leaves sketch mode.
 */
function select(id: string | null, how: Pick = false) {
  rendersOpen = false; // choosing something shows it, not the renders
  viewer.dropPicked(); // picked faces and edges start over
  if (finishSel) viewer.setFinishMark((finishSel = null));
  if (id && picks(id)) return pending!.pick(id, how);
  // while picking areas, a sketch chosen in the list gets all its areas picked
  if (toolMode === 'pull' && sketching && id && history.current.sketches.some((s) => s.id === id)) {
    if (id !== sketching) enterSketch(id);
    return void extrudeAreas(true);
  }
  // Extrude waiting for a face: a sketch chosen instead pulls its shapes
  if (extrudePick && id && history.current.sketches.some((s) => s.id === id)) {
    viewer.cancelFacePick();
    if (sketching) exitSketch();
    [selected, shapeSel] = [[id], []];
    return extrude();
  }
  if (sketching && id !== sketching) exitSketch();
  const doc = history.current;
  // ranges run within the object list or within the sketch list
  const list = doc.sketches.some((s) => s.id === id) ? doc.sketches.map((s) => s.id) : tree(doc, folded).map((r) => r.id);
  if (id === null) selected = how ? selected : [];
  else selected = picked(selected, list, id, how);
  shapeSel = [];
  showSelection();
}

/** A clicked sketch shape: selects its sketch and the shape (`how`: toggles it, or a range of the sketch's shapes). */
function pickShape(sketch: string, shape: string, how: Pick) {
  if (sketching && sketch !== sketching) exitSketch();
  if (activeSketch() !== sketch) [selected, shapeSel] = [[sketch], []];
  const s = history.current.sketches.find((x) => x.id === sketch);
  if (!s) return;
  // a shape in a sub-group that is not open picks the whole sub-group (a shape outside the open one closes it)
  let unit = unitAt(s, shape, sketching === sketch ? (sketchPath.at(-1) ?? null) : null);
  if (!unit) [sketchPath, unit] = [[], unitAt(s, shape, null)];
  const ids = unit!.shapes;
  if (how === true) shapeSel = ids.every((id) => shapeSel.includes(id)) ? shapeSel.filter((id) => !ids.includes(id)) : [...shapeSel, ...ids.filter((id) => !shapeSel.includes(id))];
  else shapeSel = how === 'range' ? picked(shapeSel, s.shapes.map((q) => q.id), shape, how) : ids;
  // X / Y / Z waiting: a plain click opens the field for the shapes picked
  if (pending?.tool === 'move' && !how) return pending.pick(sketch, false);
  showSelection();
}

/**
 * ⌘G in sketch mode: the selected shapes (and sub-groups wholly selected) go into a new sub-group of the open one;
 * ⇧⌘G (`apart`) dissolves the selected sub-group into its parent.
 */
function groupShapes(apart = false) {
  const doc = history.current;
  const k = doc.sketches.findIndex((x) => x.id === sketching);
  const s = doc.sketches[k];
  if (!s || !shapeSel.length) return;
  const level = sketchPath.at(-1) ?? null;
  // the selection as units at the open level: whole sub-groups, else single shapes
  const units = [...new Map(shapeSel.flatMap((id) => (unitAt(s, id, level) ? [unitAt(s, id, level)!] : [])).map((u) => [u.group ?? u.shapes[0], u])).values()];
  if (apart) {
    const g = units.length === 1 ? s.groups.find((x) => x.id === units[0].group) : undefined;
    if (!g) return fail('Select one sub-group (all its shapes) to ungroup');
    return commit(setIn(doc, ['sketches', String(k)], { ...s, groups: s.groups.filter((x) => x !== g).map((x) => (x.parent === g.id ? { ...x, parent: g.parent } : x)), shapes: s.shapes.map((q) => (q.group === g.id ? { ...q, group: g.parent ?? undefined } : q)) }));
  }
  const g = { id: newId(), name: `Group ${s.groups.length + 1}`, parent: level };
  const groups = new Set(units.flatMap((u) => (u.group ? [u.group] : [])));
  const loose = new Set(units.flatMap((u) => (u.group ? [] : u.shapes)));
  commit(setIn(doc, ['sketches', String(k)], { ...s, groups: [...s.groups.map((x) => (groups.has(x.id) ? { ...x, parent: g.id } : x)), g], shapes: s.shapes.map((q) => (loose.has(q.id) ? { ...q, group: g.id } : q)) }));
}

/**
 * Dragged shapes: writes only the values that changed, as plain numbers in the display unit (typed sizes as typed,
 * turns in degrees); the other values keep their expressions. One undo step.
 */
function setShapes(sketch: string, updates: { id: string; profile: DrawnProfile }[], typed: Partial<Record<'w' | 'h' | 'd', string>> = {}) {
  commit(withShapes(history.current, sketch, updates, typed));
}

/** The sketch's shapes changed to `updates` (mm); values that did not change keep their expressions. */
function withShapes(doc: Doc, sketch: string, updates: { id: string; profile: DrawnProfile }[], typed: Partial<Record<'w' | 'h' | 'd', string>> = {}) {
  const k = doc.sketches.findIndex((s) => s.id === sketch);
  if (k < 0) return doc;
  const lookup = paramLookup(doc.params);
  const shapes = doc.sketches[k].shapes.map((q) => {
    const u = updates.find((x) => x.id === q.id);
    if (!u) return q;
    const old = resolve(q, lookup, '', new Map()) as Record<string, unknown>;
    const next = { ...q } as Record<string, unknown>;
    for (const [key, v] of Object.entries(u.profile)) {
      if (key === 'pts') next.pts = (v as [number, number][]).map(([x, y]) => [+fmt(x), +fmt(y)]);
      else if (typeof v === 'number' && Math.abs(v - (old[key] as number)) > 1e-9) next[key] = UNITLESS.includes(key) ? ex(fmt(v)) : len(v, typed[key as 'w']);
    }
    return next as Profile;
  });
  return setIn(doc, ['sketches', String(k), 'shapes'], shapes);
}

/** The selected sketch with its selected shapes resolved (mm), if any. */
function selectedShapes() {
  const doc = history.current;
  const s = doc.sketches.find((x) => x.id === activeSketch());
  if (!s || !shapeSel.length) return null;
  const r = resolve(s, paramLookup(doc.params), '', new Map());
  return { id: s.id, source: s, shapes: r.shapes.filter((q) => shapeSel.includes(q.id)) };
}

function alignShapes(how: Align) {
  const sel = selectedShapes();
  if (!sel || sel.shapes.length < 2) return;
  const by = alignment(sel.shapes.map(bounds), how);
  setShapes(sel.id, sel.shapes.map((q, i) => ({ id: q.id, profile: shifted(q, ...by[i]) })));
}

/** Arrow keys on shapes: `step` mm along the sketch axis nearest to the arrow's screen direction (`dir`, world). */
function nudgeShapes(dir: Vector3, step: number) {
  const sel = selectedShapes();
  const f = viewer.sketches.find((v) => v.id === sel?.id)?.frame;
  if (!sel || !f) return;
  const [a, b] = [f.x, f.y].map((v) => dir.dot(new Vector3(...v)));
  const [du, dv] = Math.abs(a) >= Math.abs(b) ? [Math.sign(a) * step, 0] : [0, Math.sign(b) * step];
  setShapes(sel.id, sel.shapes.map((q) => ({ id: q.id, profile: shifted(q, du, dv) })));
}

/** Copies the selected shapes `offset` mm right and down in their sketch, keeping their expressions, and selects the copies. */
function duplicateShapes(offset = 10) {
  const sel = selectedShapes();
  if (sel) addShapes(sel.id, sel.source.shapes.filter((q) => shapeSel.includes(q.id)), offset);
}

/** Copies of shapes `sources` added to sketch `sketch`, moved `offset` mm right and down (expressions kept), and selected. */
function addShapes(sketch: string, sources: Profile[], offset: number) {
  const doc = history.current;
  const lookup = paramLookup(doc.params);
  const copies = sources.map((src): Profile => {
    const m = shifted(resolve(src, lookup, '', new Map()), offset, -offset);
    const copy = { ...structuredClone(src), id: newId() };
    if ((copy.kind === 'polygon' || copy.kind === 'line') && (m.kind === 'polygon' || m.kind === 'line')) return { ...copy, pts: m.pts.map(([x, y]) => [+fmt(x), +fmt(y)]) };
    return m.kind === 'polygon' || m.kind === 'line' || copy.kind === 'polygon' || copy.kind === 'line' ? copy : offset ? { ...copy, x: len(m.x), y: len(m.y) } : copy;
  });
  [selected, shapeSel] = [[sketch], copies.map((c) => c.id)];
  commit({ ...doc, sketches: doc.sketches.map((s) => (s.id === sketch ? { ...s, shapes: [...s.shapes, ...copies] } : s)) });
}

/**
 * Joins, cuts or intersects: the first selected body keeps the result, the others become its tool bodies (owned by it,
 * editable; cutters show as red outlines, others hide). The boolean comes last, so it cuts through finishes made
 * before it (they are baked under it).
 */
function applyBoolean(op: BooleanOp) {
  const doc = history.current;
  const ids = selected.filter((id) => doc.bodies.some((b) => b.id === id));
  if (ids.length < 2) {
    // tool first: clicked bodies join the selection, Enter applies
    [selected, shapeSel] = [ids, []];
    pending = {
      tool: 'boolean',
      pick(id) {
        selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
        showSelection();
      },
      apply() {
        cancelPending();
        applyBoolean(op);
      },
    };
    toolHint = `Click the body that keeps the result, then the ones to ${{ union: 'join', subtract: 'cut it', intersect: 'intersect' }[op]} · [Enter] applies · [Esc] cancels`;
    return showSelection();
  }
  const [target, ...tools] = ids;
  const bodies = doc.bodies.map((b) => {
    if (tools.includes(b.id)) return { ...b, visible: op === 'subtract' }; // cutters show as red outlines
    if (b.id !== target) return b;
    return { ...b, features: [...b.features, ...tools.map((body): Feature => ({ id: newId(), type: 'boolean', op, body }))] };
  });
  [selected, shapeSel] = [[target], []];
  commit({ ...doc, bodies });
}

/** Shows only body `id` (its tool bodies stay as they are); for the isolated body: shows what was shown before. */
function isolate(id: string) {
  const doc = history.current;
  if (isolated?.body === id) {
    const { before } = isolated;
    isolated = null;
    const back = <T extends { id: string; visible: boolean }>(o: T) => ({ ...o, visible: before.get(o.id) ?? o.visible });
    return commit({ ...doc, bodies: doc.bodies.map(back), sketches: doc.sketches.map(back) });
  }
  const before = isolated?.before ?? new Map([...doc.bodies, ...doc.sketches].map((o) => [o.id, o.visible]));
  isolated = { body: id, before };
  const owner = ownersOf(doc);
  const mine = (b: string) => {
    for (const seen = new Set<string>(); !seen.has(b); b = owner.get(b) ?? b) if (seen.add(b), b === id) return true;
    return false;
  };
  commit({
    ...doc,
    bodies: doc.bodies.map((b) => ({ ...b, visible: mine(b.id) ? (b.id === id || b.visible) : false })),
    sketches: doc.sketches.map((s) => ({ ...s, visible: false })),
  });
}

function showSelection() {
  viewer.select(contents(history.current, selected));
  viewer.setSketches(viewer.sketches, activeSketch(), shapeSel);
  render();
}

/** Writes new positions (mm) as plain numbers in the display unit; untouched axes keep their expressions. */
function place(moves: { id: string; position: Vec3 }[]) {
  commit(withPlaces(history.current, moves));
}

/** The bodies moved to world positions. */
function withPlaces(doc: Doc, moves: { id: string; position: Vec3 }[]) {
  let next = doc;
  for (const { id, position } of moves) {
    const i = doc.bodies.findIndex((p) => p.id === id);
    const before = positions.get(id);
    if (i < 0 || !before) continue;
    // in the group's (turned, jointed) coordinates: axes whose local value changed are written
    const toLocal = parentPlace(id).invert();
    const [now, was] = [position, before].map((p) => new Vector3(...p).applyMatrix4(toLocal).toArray());
    now.forEach((v, k) => {
      if (Math.abs(v - was[k]) > 1e-9) next = setIn(next, ['bodies', String(i), 'position', String(k)], ex(fmt(v / UNITS[doc.units]), doc.units));
    });
  }
  return next;
}

function nudge(by: Vec3) {
  place(selected.flatMap((id) => {
    const p = positions.get(id);
    return p ? [{ id, position: p.map((v, k) => v + by[k]) as Vec3 }] : [];
  }));
}

/** ⌘A: all bodies with their eye on (tool bodies come with their owners), in sketch mode all shapes of the sketch. */
function selectAll() {
  const doc = history.current;
  const s = doc.sketches.find((x) => x.id === sketching);
  if (s) [selected, shapeSel] = [[s.id], s.shapes.map((q) => q.id)];
  else {
    const owner = ownersOf(doc);
    [selected, shapeSel] = [doc.bodies.filter((b) => b.visible && !owner.has(b.id)).map((b) => b.id), []];
  }
  showSelection();
}

/**
 * The info panel's rows for what is selected: a picked edge (length) or face (area); sketch shapes (size, Ø, area, a
 * line's length); bodies (box size; one body: position and turn; volume and surface area from their triangles).
 */
function infoOf(): { title: string; rows: [string, string, Measure?][]; box?: Box3; at?: Vec3 } | null {
  const doc = history.current;
  const u = doc.units;
  // areas and volumes one unit up (mm → cm², cm³), else the numbers get long
  const up: Record<Unit, [string, number]> = { mm: ['cm', 10], cm: ['dm', 100], m: ['m', 1000], in: ['ft', 304.8], ft: ['ft', 304.8] };
  const num = (mm: number, power = 1) => {
    const [name, size] = power === 1 ? [u, UNITS[u]] : up[u];
    return `${fmt(+(mm / size ** power).toFixed(3))} ${name}${power === 2 ? '²' : power === 3 ? '³' : ''}`;
  };
  if (pickedPart?.kind === 'face') {
    const n = pickedPart.count ?? 1;
    return { title: n > 1 ? 'Faces' : 'Face', rows: n > 1 ? [['Area', num(pickedPart.size, 2)], ['Faces', String(n)]] : [['Area', num(pickedPart.size, 2)]] };
  }
  if (pickedPart) {
    const n = pickedPart.count ?? 1;
    const rows: [string, string][] = [['Length', num(pickedPart.size)]];
    if (n > 1) rows.push(['Edges', String(n)]);
    if (pickedPart.diameter) rows.push(['Ø', num(pickedPart.diameter)]);
    return { title: pickedPart.diameter ? 'Circle' : n > 1 ? 'Edges' : 'Edge', rows };
  }
  const lookup = paramLookup(doc.params);
  const s = doc.sketches.find((x) => x.id === activeSketch());
  if (s) {
    const shapes = resolve(s, lookup, '', new Map()).shapes.filter((q) => !shapeSel.length || shapeSel.includes(q.id));
    if (shapes.length !== 1) return { title: shapeSel.length ? `${shapes.length} shapes` : s.name, rows: [['Shapes', String(shapes.length)]] }; // (areas would count holes too)
    const q = shapes[0];
    const [w, h] = sizeOf(q);
    const pts = corners(q);
    const rows: [string, string][] = q.kind === 'circle' ? [['Ø', num(q.d)]] : [['Size', `${num(w)} × ${num(h)}`]];
    rows.push(q.kind === 'line' ? ['Length', num(pts.slice(1).reduce((n, [x, y], i) => n + Math.hypot(x - pts[i][0], y - pts[i][1]), 0))] : ['Area', num(area(q), 2)]);
    return { title: q.kind[0].toUpperCase() + q.kind.slice(1), rows };
  }
  const ids = contents(doc, selected).filter((id) => doc.bodies.some((b) => b.id === id));
  const m = ids.flatMap((id) => viewer.measure(id) ?? []);
  if (!m.length) return null;
  const box = m.reduce((b, x) => b.union(x.box), new Box3());
  const size = box.getSize(new Vector3());
  // L / W / H along x / y / z: hovering one shows it on the box
  const rows: [string, string, Measure?][] = [['L', num(size.x), 0], ['W', num(size.y), 1], ['H', num(size.z), 2]];
  const b = ids.length === 1 && doc.bodies.find((x) => x.id === ids[0]);
  if (b) {
    const at = positions.get(b.id);
    const turn = resolve(b.rotation, lookup, '', new Map());
    if (at) rows.push(['Position', at.map((v) => num(v)).join(', '), 'at']);
    rows.push(['Rotation', `${fmt(turn.rx)}°, ${fmt(turn.ry)}°, ${fmt(turn.rz)}°`]);
  }
  rows.push(['Volume', num(m.reduce((n, x) => n + x.volume, 0), 3)], ['Surface', num(m.reduce((n, x) => n + x.area, 0), 2)]);
  return { title: b ? b.name : `${ids.length} bodies`, rows, box, at: b ? positions.get(b.id) : undefined };
}

/** The largest sizes found for finishes that were too big (by feature id and kind, `id fillet`): drags stop there. */
const finishMax = new Map<string, number>();
/** A finish size `mm` (fillet positive, chamfer negative) cut to the largest known to fit, a hair under it. */
const clamped = (feature: string, v: number) => Math.sign(v) * Math.min(Math.abs(v), Math.floor((finishMax.get(`${feature} ${v >= 0 ? 'fillet' : 'chamfer'}`) ?? Infinity) * 100) / 100);

/** A finish too big for its edges: its size becomes the largest that works (in the same undo step). */
function clampFinish(body: string, feature: string, max: number) {
  const doc = history.current;
  const i = doc.bodies.findIndex((b) => b.id === body);
  const j = doc.bodies[i]?.features.findIndex((f) => f.id === feature) ?? -1;
  const f = doc.bodies[i]?.features[j];
  if (f?.type !== 'finish') return;
  finishMax.set(`${feature} ${f.mode}`, max);
  const size = Math.floor(max * 100) / 100; // a hair under the limit
  if (!(size > 0) || size >= evalLength(f.size, paramLookup(doc.params))) return;
  history.replace(setIn(doc, ['bodies', String(i), 'features', String(j), 'size'], len(size)));
  update();
  notify(`${f.mode === 'fillet' ? 'Fillet' : 'Chamfer'} set to ${fmt(size / UNITS[doc.units])} ${doc.units}: the largest that fits`);
}

/**
 * A fillet / chamfer size set (`path`, `value`): below 0 the finish turns into the other kind, the size positive; beyond
 * the largest size known to fit it is cut to that.
 */
function finishSize(doc: Doc, path: string[], value: Expr): Doc {
  const [k, i, f, j, field] = path;
  const feature = k === 'bodies' && f === 'features' && field === 'size' ? doc.bodies[+i]?.features[+j] : undefined;
  if (feature?.type !== 'finish') return doc;
  let mm: number;
  try {
    mm = evalLength(value, paramLookup(doc.params));
  } catch {
    return doc;
  }
  const mode = mm < 0 ? (feature.mode === 'fillet' ? 'chamfer' : 'fillet') : feature.mode;
  // beyond the largest size found to fit (typed or scrubbed): that size instead
  const max = Math.abs(clamped(feature.id, mode === 'fillet' ? Math.abs(mm) : -Math.abs(mm)));
  if (max < Math.abs(mm)) return setIn(doc, ['bodies', i, 'features', j], { ...feature, mode, size: len(max) });
  if (!(mm < 0)) return doc;
  // `-3` / `-ply` lose their minus, longer expressions are wrapped
  const single = /^\s*-\s*([A-Za-z_]\w*|\d+\.?\d*|\.\d+)\s*$/.exec(value.e);
  const size = { ...value, e: single ? single[1] : `-(${value.e})` };
  return setIn(doc, ['bodies', i, 'features', j], { ...feature, mode, size });
}

/** V: the selected bodies, sketches and groups switch between hidden and shown (one step). */
function toggleVisible() {
  const doc = history.current;
  const flip = <T extends { id: string; visible: boolean }>(list: T[]) => list.map((o) => (selected.includes(o.id) ? { ...o, visible: !o.visible } : o));
  commit({ ...doc, bodies: flip(doc.bodies), sketches: flip(doc.sketches), groups: flip(doc.groups) });
}

/**
 * X / Y / Z: a field at the pointer takes a distance (expressions, units) along that axis; X / Y / Z in it (or Tab:
 * the next axis) add or go to that axis' field (always in X Y Z order), unless in the middle of a name, or where a name could start and a
 * parameter starts with the letter (then it is typed: Tab completes the name). While typing the selection shows moved; Enter moves it by all of them,
 * Esc or leaving cancels all. `all` (M): all three fields at once, X first, starting at `start` (mm; selected, so
 * typing replaces them). Copy: the selection stays (shown whole, not as a ghost) and a copy of it moves.
 */
function moveAlong(first: number, all = false, start: Vec3 = [0, 0, 0]) {
  if (!selected.length) {
    // tool first: a click picks what moves and opens the field; Shift / ⌘ clicks collect several, Enter then
    pending = {
      tool: 'move',
      pick(id, how) {
        if (how) return (selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]), showSelection();
        if (!selected.includes(id)) selected = [...selected, id];
        cancelPending();
        showSelection();
        moveAlong(first, all, start);
      },
      apply() {
        cancelPending();
        render();
        if (selected.length) moveAlong(first, all, start);
      },
    };
    toolHint = `Click what to move${all ? '' : ` along ${'XYZ'[first]}`} · Shift / ${MAC ? '⌘' : 'Ctrl'}-click several, then [Enter] · [Esc] cancels`;
    return render();
  }
  const fields: (HTMLInputElement | null)[] = [null, null, null];
  const box = Object.assign(document.createElement('div'), { className: 'axis-move' });
  const at = viewer.pointer() ?? { x: innerWidth / 2, y: innerHeight / 2 };
  document.body.append(box);
  // hanging from the pointer, inside the 3D view (again whenever the fields grow)
  const inView = new ResizeObserver(() => {
    const r = viewer.el.getBoundingClientRect();
    keepInside(box, at.x + 14, at.y + 14, false, [r.left, r.top, r.right, r.bottom]);
  });
  inView.observe(box);
  /** The move so far (null: a value is not a distance); empty axes stay. */
  const by = () => {
    const mm = fields.map((f) => (f?.value.trim() ? length(f.value) : 0));
    return mm.includes(null) ? null : new Vector3(...(mm as number[]));
  };
  const show = () => {
    for (const f of fields) f?.classList.toggle('invalid', !!f.value.trim() && length(f.value) === null);
    const b = by();
    const m = b && sketchMove(b);
    viewer.previewMove(b ?? new Vector3(), m?.updates ?? [], m?.across ?? null);
    viewer.ghostsWhole(copy.checked);
    // the gizmo at the selection's middle, moved along; a spoke dragged writes its axis' field
    if (middle)
      viewer.showGizmo({
        at: middle.clone().add(b ?? new Vector3()),
        axis: last ? fields.indexOf(last) : first,
        value: (k) => (fields[k]?.value.trim() ? (length(fields[k]!.value) ?? 0) : 0),
        set: (k, mm) => {
          const text = fmt(mm / UNITS[history.current.units]);
          if (fields[k] ? fields[k]!.value === text || (!mm && !fields[k]!.value.trim()) : !mm) return; // unchanged, or an axis not used
          if (!fields[k]) open(k);
          fields[k]!.value = text;
          show();
        },
      });
  };
  const spans = [0, 1, 2].map(extentAlong);
  const middle = spans.every(Boolean) ? new Vector3(...spans.map((s) => (s![0] + s![1]) / 2)) : null;
  let closed = false; // removing the box fires focusout: close once
  let last: HTMLInputElement | null = null; // the field typed in last
  let target = false; // waiting for a click: "To object"
  const close = () => {
    if (closed) return;
    closed = true;
    inView.disconnect();
    box.remove();
    removeEventListener('pointerup', refocus, true);
    tips.cursorTip(null);
    viewer.cancelFacePick();
    viewer.previewMove(null);
    viewer.showGizmo(null);
    viewer.aiming = null;
    viewer.aimAt(null);
  };
  // the view keeps turning meanwhile: a click in it does not select (it only picks for "To object"), the field gets focus back
  const refocus = () => setTimeout(() => !closed && !box.contains(document.activeElement) && last?.focus());
  addEventListener('pointerup', refocus, true);
  const watch = () =>
    viewer.pickFace((face) => {
      if (closed) return;
      if (target) reach(face?.snap);
      watch();
    }, true);
  watch();
  /** "To object": the selection moves along the field's axis until its nearest side reaches `p` (none: the value from before aiming). */
  let before = '';
  const reachTo = (p?: Vector3) => {
    const k = Math.max(0, fields.indexOf(last));
    const span = extentAlong(k);
    if (!fields[k]) return;
    const t = p?.getComponent(k);
    const side = t === undefined || !span ? null : t >= span[1] ? span[1] : t <= span[0] ? span[0] : Math.abs(t - span[0]) < Math.abs(t - span[1]) ? span[0] : span[1];
    fields[k]!.value = t === undefined || side === null ? before : fmt((t - side) / UNITS[history.current.units]);
    show();
  };
  /** The click: that point, and aiming ends. */
  const reach = (p?: Vector3) => {
    target = false;
    viewer.aiming = null;
    viewer.aimAt(null);
    box.classList.remove('targeting');
    tips.cursorTip(null);
    reachTo(p);
  };
  const open = (k: number) => {
    if (!fields[k]) {
      const name = 'XYZ'[k];
      // all three at once (M): they start at their start value, selected, so typing replaces it
      const input = Object.assign(document.createElement('input'), { spellcheck: false, placeholder: `0 ${history.current.units}`, value: all ? fmt(start[k] / UNITS[history.current.units]) : '' });
      input.dataset.start = input.value;
      input.dataset.complete = '';
      input.dataset.grow = '90'; // px at least; wider for long text and its result
      input.oninput = show;
      input.onfocus = () => (last = input);
      input.onkeydown = (e) => keys(e, input);
      const next = fields.slice(k + 1).find(Boolean);
      const letter = Object.assign(document.createElement('span'), { className: `axis-${name.toLowerCase()}`, textContent: name });
      box.insertBefore(letter, next?.previousSibling ?? toObject); // in X Y Z order, the button last
      box.insertBefore(input, next?.previousSibling ?? toObject);
      fields[k] = input;
    }
    fields[k]!.focus();
    if (fields[k]!.value && fields[k]!.value === fields[k]!.dataset.start) fields[k]!.select(); // untouched: typing replaces it
  };
  const keys = (e: KeyboardEvent, input: HTMLInputElement) => {
    const k = (['moveX', 'moveY', 'moveZ'] as const).findIndex((a) => pressed(e, a));
    const before = input.value.slice(0, input.selectionStart ?? 0);
    const word = before.match(/[A-Za-z_]\w*$/)?.[0];
    // a name could start here and one starts with the letter: typed, Tab completes it
    const name = !/[\w.]$/.test(before) && Object.keys(history.current.params).some((p) => p.startsWith(e.key));
    if (k >= 0 && (!word || word in UNITS) && !name) return e.preventDefault(), open(k);
    // T (as X / Y / Z): the To object button
    if (pressed(e, 'toObject') && (!word || word in UNITS) && !name) return e.preventDefault(), toObject.click();
    // Tab (a completion took it already): the next axis' field (Shift: the previous), added if needed; leaving would cancel
    if (e.key === 'Tab') return e.preventDefault(), open((fields.indexOf(input) + (e.shiftKey ? 2 : 1)) % 3);
    if (pressed(e, 'cancel')) return close();
    if (!pressed(e, 'confirm')) return;
    const b = by();
    if (!b) return show();
    close();
    if (copy.checked) copyMoved(b);
    else moveBy(b);
  };
  // focus moving between the fields (or into the view) stays; to another field or button elsewhere it cancels
  box.addEventListener('focusout', (e) => (!e.relatedTarget || box.contains(e.relatedTarget as Node) ? undefined : close()));
  const toObject = toObjectButton(() => {
    target = true;
    before = last?.value ?? '';
    // the selection shows moved to what a click reaches, the pointer's note says what it is
    viewer.aiming = (s) => (tips.cursorTip([s?.what, 'Click a corner, edge or face to move to'].filter(Boolean).join('\n')), reachTo(s?.at));
    box.classList.add('targeting');
    last?.focus();
    viewer.aiming(viewer.aimHere());
  }, 'Click a corner, edge or face: the selection moves along this axis until its nearest side reaches it');
  const copy = Object.assign(document.createElement('input'), { type: 'checkbox', onchange: () => (show(), last?.focus()) });
  const copyLabel = Object.assign(document.createElement('label'), { title: 'Leave the selection where it is and move a copy of it' });
  copyLabel.append(copy, 'Copy');
  box.append(toObject, copyLabel);
  if (all) [2, 1].forEach(open); // Z and Y open behind X
  open(first);
  show();
}

/** Where the selection reaches along `axis` (world mm, without the move preview): bodies' boxes, or the moved shapes' outlines. */
function extentAlong(axis: number): [number, number] | null {
  const doc = history.current;
  const s = doc.sketches.find((x) => x.id === activeSketch());
  const f = viewer.sketches.find((v) => v.id === s?.id)?.frame;
  if (s && f) {
    const shapes = resolve(s, paramLookup(doc.params), '', new Map()).shapes.filter((q) => !shapeSel.length || shapeSel.includes(q.id));
    const at = shapes.flatMap((q) => {
      const [x0, y0, x1, y1] = bounds(q);
      return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([u, v]) => toWorld(f, u, v)[axis]);
    });
    return at.length ? [Math.min(...at), Math.max(...at)] : null;
  }
  const boxes = contents(doc, selected).flatMap((id) => viewer.measure(id)?.box ?? []);
  if (!boxes.length) return null;
  const box = boxes.reduce((a, b) => a.clone().union(b));
  const shift = viewer.moved().getComponent(axis); // the preview's offset
  return [box.min.getComponent(axis) - shift, box.max.getComponent(axis) - shift];
}

/**
 * The selected sketch moved by `by` (world, mm): its shapes within its plane (the selected ones, else all; all when
 * it moves across too), and across it (`d` along its normal `n`): a base-plane or free-plane sketch with the bodies
 * extruded from it, one on a face with the body carrying it, or off the face onto a free plane if no body has it
 * (`across`: what the preview moves; null: none or it cannot). Null: no sketch selected, or hidden.
 */
function sketchMove(by: Vector3) {
  const doc = history.current;
  const s = doc.sketches.find((x) => x.id === activeSketch());
  const f = viewer.sketches.find((v) => v.id === s?.id)?.frame;
  if (!s || !f) return null;
  const n = new Vector3(...f.n);
  const d = Math.abs(by.dot(n)) > 1e-9 ? by.dot(n) : 0;
  const [du, dv] = [f.x, f.y].map((v) => by.dot(new Vector3(...v)));
  const flat = Math.abs(du) > 1e-9 || Math.abs(dv) > 1e-9;
  const shapes = flat ? resolve(s, paramLookup(doc.params), '', new Map()).shapes.filter((q) => d || !shapeSel.length || shapeSel.includes(q.id)) : [];
  const carrier = carrierOf(doc, s.id);
  const onFace = s.plane.kind === 'cap' || s.plane.kind === 'side';
  const users = doc.bodies.filter((b) => b.features.some((x) => sourceSketch(x) === s.id)).map((b) => b.id);
  // on a face with no body of its own it leaves the face; extruded by the body it lies on, it stays
  const bodies = onFace ? (carrier ? [carrier] : users.length ? null : []) : users;
  return { sketch: s, frame: f, n, d, carrier, users, updates: shapes.map((q) => ({ id: q.id, profile: shifted(q, du, dv) })), across: d && bodies ? { sketch: s.id, by: n.clone().multiplyScalar(d), bodies } : null };
}

/**
 * Moves the selection by `by` (world, mm): bodies, or a sketch (see `sketchMove`): across its plane the whole sketch
 * goes, selected shapes or not.
 */
function moveBy(by: Vector3) {
  if (!activeSketch()) return nudge(by.toArray());
  const m = sketchMove(by);
  if (!m) return fail('The sketch is hidden: show it to move it');
  const { sketch, frame, n, d, carrier, users } = m;
  const doc = history.current;
  let next = m.updates.length ? withShapes(doc, sketch.id, m.updates) : doc;
  if (d) {
    const k = doc.sketches.indexOf(sketch);
    const p = sketch.plane;
    if (p.kind === 'base') next = setIn(next, ['sketches', String(k), 'plane', 'offset'], plus(p.offset, resolve(p.offset, paramLookup(doc.params), '', new Map()), d));
    else if (carrier && positions.has(carrier)) next = withPlaces(next, [{ id: carrier, position: new Vector3(...positions.get(carrier)!).addScaledVector(n, d).toArray() }]);
    else if (p.kind === 'plane') next = setIn(next, ['sketches', String(k), 'plane', 'o'], new Vector3(...p.o).addScaledVector(n, d).toArray());
    else if (!users.length) next = setIn(next, ['sketches', String(k), 'plane'], { kind: 'plane', ...frame, o: new Vector3(...frame.o).addScaledVector(n, d).toArray() });
    else return fail('A sketch extruded by the body it lies on stays on its face');
    shapeSel = []; // the whole sketch went
  }
  commit(next);
}

/** Moves a copy of the selection by `by` (one undo step): shapes in their sketch, else bodies and sketches. */
function copyMoved(by: Vector3) {
  const before = history.current;
  const sketch = activeSketch();
  moveBy(by);
  const moved = history.current;
  if (moved === before) return;
  if (sketch && shapeSel.length) {
    // the moved shapes come back as new ones beside the originals (a move across the plane took the whole sketch)
    const k = before.sketches.findIndex((s) => s.id === sketch);
    const copies = moved.sketches[k].shapes.filter((q) => shapeSel.includes(q.id)).map((q) => ({ ...q, id: newId() }));
    shapeSel = copies.map((q) => q.id);
    history.replace(setIn(before, ['sketches', String(k), 'shapes'], [...before.sketches[k].shapes, ...copies]));
  } else {
    const { bodies, sketches } = copiesOf(moved.bodies.filter((b) => selected.includes(b.id)), moved.sketches.filter((s) => selected.includes(s.id)), ' copy');
    selected = [...bodies, ...sketches].map((c) => c.id);
    history.replace({ ...before, bodies: [...before.bodies, ...bodies], sketches: [...before.sketches, ...sketches] });
  }
  update();
}

/**
 * What ⌘C or ⌘X took (as they were then: ⌘X deletes them): the selected bodies and sketches, or the selected shapes of
 * the selected sketch; `cut`: pasted back as they were (names, places), else as Duplicate copies.
 */
let copied: { bodies: Body[]; sketches: Sketch[]; shapes: { sketch: string; profiles: Profile[] } | null; cut: boolean } | null = null;

/** ⌘C / ⌘X: takes the selection (⌘X deletes it). */
function copy(cut: boolean) {
  if (!selected.length) return;
  const doc = history.current;
  const sketch = activeSketch();
  const shapes = sketch && shapeSel.length ? { sketch, profiles: structuredClone(doc.sketches.find((x) => x.id === sketch)!.shapes.filter((q) => shapeSel.includes(q.id))) } : null;
  const take = <T extends { id: string }>(list: T[]) => (shapes ? [] : structuredClone(list.filter((o) => selected.includes(o.id))));
  copied = { bodies: take(doc.bodies), sketches: take(doc.sketches), shapes, cut };
  if (cut) remove();
}

/** ⌘V: copies of what ⌘C or ⌘X took, as Duplicate makes them (after ⌘X: as they were, in place); nothing taken: pick what to copy. */
function paste() {
  if (!copied) return pickFor('duplicate', duplicate);
  const doc = history.current;
  const { shapes, cut } = copied;
  if (shapes) {
    if (!doc.sketches.some((x) => x.id === shapes.sketch)) return fail('The sketch the shapes came from is gone');
    return addShapes(shapes.sketch, shapes.profiles, cut ? 0 : 10);
  }
  placeCopies(copiesOf(copied.bodies, copied.sketches, cut ? '' : ' copy'), cut ? [0, 0, 0] : [5, 5, 0]);
}

/**
 * Cut (toolbar): a body (the selected one, else the one clicked next; selected, so outlined), then a face or empty
 * space (a straight cut on that face's plane, or the base plane facing you) or the outline of a sketch line or shape
 * (cut along it, linked); then `cutPanel`. Chunk A keeps the side the cutter faces (a face's: into the body, a line's
 * left, a shape's inside), chunk B the other.
 */
function cutTool() {
  const doc = history.current;
  const body = selected.find((id) => doc.bodies.some((b) => b.id === id));
  if (!body) {
    pending = { tool: 'cut', pick: (id) => (cancelPending(), (selected = [id]), showSelection(), cutTool()) };
    toolHint = 'Click the body to cut · [Esc] cancels';
    return render();
  }
  [selected, shapeSel] = [[body], []];
  showSelection();
  toolHint = 'Click a face or empty space (a straight cut on its plane), a sketch line or shape (cut along it), or a ball or cylinder (cut along its surface) · [Esc] cancels';
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    if (!face) return render();
    const pl = bodyPlace(body);
    if (face.sketch?.shape) return cutPanel(body, { kind: 'shape', sketch: face.sketch.id, shape: face.sketch.shape, offset: len(0) });
    // another body that is a ball or a cylinder (one circle pulled): along its surface
    const other = face.body !== body ? doc.bodies.find((b) => b.id === face.body)?.features : undefined;
    const [solid] = other?.length === 1 ? (built.get(face.body!) ?? []) : [];
    const there = bodyPlace(face.body!);
    if (other?.[0].type === 'sphere') {
      const { x, y, z } = resolve(other[0], paramLookup(doc.params), '', new Map());
      return cutPanel(body, { kind: 'sphere', c: unplaced(pl, inWorld(there, [x, y, z])), d: structuredClone(other[0].d), offset: len(0) });
    }
    const pulled = solid?.type === 'extrude' && solid.mode === 'add' && !solid.through && solid.profiles.length === 1 ? solid : null;
    const circle = pulled?.profiles[0];
    const f = pulled && frames([pulled]).get(pulled.id);
    if (pulled && circle?.kind === 'circle' && f) {
      const [from, to] = extent(pulled.depth, pulled.back);
      const c = inWorld(there, toWorld(moved(f, scale(f.n, from)), circle.x, circle.y));
      return cutPanel(body, { kind: 'cylinder', c: unplaced(pl, c), dir: unplaced(pl, inWorld(there, f.n, true), true), h: to - from, d: len(circle.d), offset: len(0) });
    }
    // on the face clicked (its normal into the body), or the plane facing you
    const n = face.normal.clone().normalize();
    const x = new Vector3(0, 0, 1).cross(n);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    cutPanel(body, { kind: 'plane', o: unplaced(pl, face.point.toArray()), x: unplaced(pl, x.toArray(), true), n: unplaced(pl, n.toArray(), true), turn: ex(0), axis: null, offset: len(0) });
  }, false, 'outlines');
}

/** While a cut is set up: its chunk B, not listed until the cut is kept. */
let cutting: { chunk: string } | null = null;

/**
 * The cut being set up, shown as it will be: the body (chunk A: the side the cutter faces, into the body from a face,
 * a line's left, a shape's, ball's or cylinder's inside) and its copy (chunk B, the other side, its own colour, not listed yet) cut, the
 * one to be deleted see-through red, the cutting surface red and half see-through, a bit larger than the body. A panel at
 * the top middle of the view has the offset from the plane, face or line (from 0, the cursor in it; T or To object:
 * click a point it goes through), a plane's turn around its axis (dashed; Set axis: click an edge, line or circle),
 * each field scrubbed by dragging its label sideways, and what stays (Delete B first). ✓ or Enter keeps it (one undo
 * step), Esc leaves the body as it was.
 */
function cutPanel(body: string, cutter: SplitFeature['cutter']) {
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  document.body.append(box);
  const r = viewer.el.getBoundingClientRect();
  const u = history.current.units;
  const lookup = paramLookup(history.current.params);
  const values = { offset: '0', turn: '0' };
  let axis: { at: V3; dir: V3 } | null = null; // body-local; none: the plane's own x
  let picking = false; // waiting for To object or Set axis: Esc ends only that
  const whole = viewer.measure(body)?.box.clone(); // the body before the cut: the surface's size and place
  let keep: 'both' | 'A' | 'B' = 'A';
  /** The cutter with the values typed, if they are valid. */
  const current = (): SplitFeature['cutter'] | null => {
    if (length(values.offset) === null || length(values.turn) === null) return null;
    const offset = { e: values.offset, u };
    return cutter.kind === 'plane' ? { ...cutter, offset, turn: { e: values.turn, u: 'mm' }, axis } : { ...cutter, offset };
  };
  // the chunks: the body (A) and its copy (B) right after it, in one undo step
  const doc0 = history.current;
  const i = doc0.bodies.findIndex((x) => x.id === body);
  const split = (side: 1 | -1): Feature => ({ id: newId(), type: 'split', cutter: structuredClone(current()!), side });
  const [copy] = copiesOf([doc0.bodies[i]], [], ' B').bodies;
  const chunkB: Body = { ...copy, color: newBody(doc0.bodies.length + 1, []).color, features: [...copy.features, split(-1)] };
  history.push({ ...doc0, bodies: [...doc0.bodies.slice(0, i), { ...doc0.bodies[i], features: [...doc0.bodies[i].features, split(1)] }, chunkB, ...doc0.bodies.slice(i + 1)] });
  cutting = { chunk: chunkB.id };
  [selected, shapeSel] = [[body], []];
  const hint = 'Type or scrub the offset (T: to object)' + (cutter.kind === 'plane' ? ' and the turn (Set axis: what it turns around)' : '') + ', pick what stays · [Enter] cuts · [Esc] leaves the body as it was';
  toolHint = hint;
  /** Both chunks cut by the cutter as typed, the one to be deleted see-through red; the cutting surface shown. */
  const show = () => {
    const c = current();
    if (c) {
      const doc = history.current;
      const bodies = doc.bodies.map((x) => {
        if (x.id !== body && x.id !== chunkB.id) return x;
        const cut = structuredClone(x.features.at(-1)!);
        if (cut.type === 'split') cut.cutter = structuredClone(c);
        // B alone stays: it is the body as it was named and coloured
        const look = x.id === chunkB.id ? (keep === 'B' ? { name: doc0.bodies[i].name, color: doc0.bodies[i].color } : { name: chunkB.name, color: chunkB.color }) : {};
        return { ...x, ...look, features: [...x.features.slice(0, -1), cut] };
      });
      history.replace({ ...doc, bodies });
      update();
    }
    viewer.setDropped(keep === 'A' ? [chunkB.id] : keep === 'B' ? [body] : []);
    surface(c);
  };
  /** A plane's axis in the world: the one set, else its own x through its point. */
  const axisOf = (c: SplitFeature['cutter'] & { kind: 'plane' }, f: Frame): TurnAxis =>
    c.axis
      ? { at: new Vector3(...inWorld(bodyPlace(body), c.axis.at)), dir: new Vector3(...inWorld(bodyPlace(body), c.axis.dir, true)).normalize(), what: '' }
      : { at: new Vector3(...f.o), dir: new Vector3(...f.x), what: '' };
  /** The cutting surface: a plane as a square a bit larger than the body, a line as a band along it through the body. */
  const surface = (c: SplitFeature['cutter'] | null) => {
    if (!c || !whole) return;
    const size = whole.getSize(new Vector3()).length() * 0.6;
    const mid = whole.getCenter(new Vector3());
    const at = (f: Frame, u0: number, v0: number) => new Vector3(...toWorld(f, u0, v0));
    if (c.kind === 'plane') {
      const f = placeFrame(bodyPlace(body), cutPlane(resolve(c, lookup, '', new Map()) as Parameters<typeof cutPlane>[0]));
      const n = new Vector3(...f.n);
      const g: Frame = { ...f, o: mid.clone().addScaledVector(n, -mid.clone().sub(new Vector3(...f.o)).dot(n)).toArray() }; // the body's middle on the plane
      if (!picking) viewer.showAxis(axisOf(c, f), mid, size * 1.2);
      return viewer.showCut([[at(g, -size, -size), at(g, size, -size), at(g, size, size), at(g, -size, size)]]);
    }
    if (c.kind === 'sphere' || c.kind === 'cylinder') {
      const { c: o, d, offset } = resolve(c, lookup, '', new Map());
      const dir = c.kind === 'cylinder' ? new Vector3(...inWorld(bodyPlace(body), c.dir, true)) : undefined;
      return viewer.showCut({ at: new Vector3(...inWorld(bodyPlace(body), o)), r: Math.max(d / 2 + offset, 0), dir, h: c.kind === 'cylinder' ? c.h : 0 });
    }
    const s = viewer.sketches.find((k) => k.id === c.sketch);
    const q = s?.shapes.find((k) => k.id === c.shape);
    if (!s || !q) return viewer.showCut(null);
    const pts = q.kind === 'line' ? beside(q.pts, resolve(c.offset, lookup, '', new Map()) as number) : [...corners(q), corners(q)[0]];
    const n = new Vector3(...s.frame.n);
    // the band reaches through the body along the sketch's normal
    const h = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new Vector3(k & 1 ? whole.max.x : whole.min.x, k & 2 ? whole.max.y : whole.min.y, k & 4 ? whole.max.z : whole.min.z).sub(new Vector3(...s.frame.o)).dot(n));
    const [lo, hi] = [Math.min(...h) - size * 0.1, Math.max(...h) + size * 0.1];
    const lift = (p: [number, number], k: number) => at(s.frame, ...p).addScaledVector(n, k);
    viewer.showCut(pts.slice(1).map((p, k) => [lift(pts[k], lo), lift(p, lo), lift(p, hi), lift(pts[k], hi)]));
  };
  const fields: HTMLInputElement[] = [];
  const field = (label: string, get: () => string, set: (t: string) => void) => {
    const input = Object.assign(document.createElement('input'), { value: get(), spellcheck: false });
    input.dataset.complete = '';
    const apply = () => {
      input.classList.toggle('invalid', length(input.value || '0') === null);
      set(input.value || '0');
      show();
    };
    input.oninput = apply;
    // T: To object, as X / Y / Z in the move fields (typed in the middle of a name, or where a parameter with t could start)
    input.onkeydown = (e) => {
      const before = input.value.slice(0, input.selectionStart ?? 0);
      const word = before.match(/[A-Za-z_]\w*$/)?.[0];
      const name = !/[\w.]$/.test(before) && Object.keys(history.current.params).some((p) => p.startsWith(e.key));
      if (pressed(e, 'toObject') && (!word || word in UNITS) && !name) e.preventDefault(), aim();
    };
    const name = Object.assign(document.createElement('span'), { textContent: label });
    scrub(name, input, () => input.value, u, settings.minStep, (text) => ((input.value = text), apply()), () => (input.focus(), input.select()));
    fields.push(input);
    return [name, input];
  };
  /** "To object": the next click sets the offset so the cut goes through that point (shown while aiming). */
  const aim = () => {
    const before = values.offset;
    picking = true;
    const through = (p?: Vector3) => {
      const c = current();
      const s = c?.kind === 'shape' ? viewer.sketches.find((k) => k.id === c.sketch) : undefined;
      const line = s?.shapes.find((q) => c?.kind === 'shape' && q.id === c.shape && q.kind === 'line');
      const frame = (mm: number) => placeFrame(bodyPlace(body), cutPlane(resolve({ ...c!, offset: len(mm) }, lookup, '', new Map()) as Parameters<typeof cutPlane>[0]));
      if (p && c?.kind === 'plane') {
        // how far each mm of offset moves the turned plane along its normal (a set axis: 1)
        const [f0, f1] = [frame(0), frame(1)];
        const n = new Vector3(...f0.n);
        const per = new Vector3(...f1.o).sub(new Vector3(...f0.o)).dot(n);
        values.offset = Math.abs(per) > 1e-6 ? fmt(p.clone().sub(new Vector3(...f0.o)).dot(n) / per / UNITS[u]) : before;
      } else if (p && (c?.kind === 'sphere' || c?.kind === 'cylinder')) {
        // a ball or cylinder: grown or shrunk to reach the point (a cylinder: its distance from the axis)
        const { c: o, d } = resolve(c, lookup, '', new Map());
        const v = p.clone().sub(new Vector3(...inWorld(bodyPlace(body), o)));
        if (c.kind === 'cylinder') v.projectOnPlane(new Vector3(...inWorld(bodyPlace(body), c.dir, true)));
        values.offset = fmt((v.length() - d / 2) / UNITS[u]);
      } else if (p && s && line?.kind === 'line') {
        // a line: the point's distance from it in the sketch's plane, on its left positive (the way the offset moves it)
        const [x, y] = uvOf(s.frame, p);
        let best: [number, number] = [Infinity, 0];
        line.pts.slice(1).forEach(([bx, by], i) => {
          const [ax, ay] = line.pts[i];
          const [dx, dy] = [bx - ax, by - ay];
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
          if (d < best[0]) best = [d, Math.sign(dx * (y - ay) - dy * (x - ax)) || 1];
        });
        values.offset = fmt((best[0] * best[1]) / UNITS[u]);
      } else values.offset = before;
      fields[0].value = values.offset;
      show();
    };
    viewer.aiming = (a) => (tips.cursorTip([a?.what, 'Click a corner, edge or face: the cut goes through it'].filter(Boolean).join('\n')), through(a?.at));
    viewer.aiming(viewer.aimHere());
    viewer.pickFace((face) => {
      picking = false;
      viewer.aiming = null;
      viewer.aimAt(null);
      tips.cursorTip(null);
      through(face?.snap);
      fields[0].focus();
    }, true);
  };
  /** Set axis: the next click on an edge, line or circle is what the plane turns around (shown while hovering). */
  const setAxis = () => {
    picking = true;
    toolHint = 'Click an edge or line (the plane turns around it) or a circle (around its centre) · [Esc] keeps the axis';
    render();
    const mid = whole?.getCenter(new Vector3());
    const size = (whole?.getSize(new Vector3()).length() ?? 100) * 0.72;
    viewer.pickAxis(
      (a) => {
        picking = false;
        tips.cursorTip(null);
        toolHint = hint;
        if (a) axis = { at: unplaced(bodyPlace(body), a.at.toArray()), dir: unplaced(bodyPlace(body), a.dir.toArray(), true) };
        show();
        render();
        fields[1].focus();
        fields[1].select();
      },
      (a) => {
        tips.cursorTip(a ? `${a.what}\nClick: the plane turns around it` : null);
        if (a) viewer.showAxis(a, mid, size);
        else show(); // the axis as it is
      },
    );
  };
  // what stays: one selector of three, the one picked coloured
  const choices = (['B', 'A', 'both'] as const).map((k) => {
    const btn = Object.assign(document.createElement('button'), { textContent: { B: 'Delete A', A: 'Delete B', both: 'Keep both' }[k], onclick: () => choose(k) });
    btn.dataset.keep = k;
    return btn;
  });
  const segmented = Object.assign(document.createElement('span'), { className: 'segmented' });
  segmented.append(...choices);
  const choose = (k: typeof keep) => {
    keep = k;
    choices.forEach((btn) => btn.classList.toggle('on', btn.dataset.keep === k));
    show();
  };
  /** Kept: the chunk to be deleted goes, the other (or both) stay and are listed; else everything as it was. */
  const finish = (ok: boolean) => {
    viewer.aiming = null;
    viewer.cancelFacePick(); // a pick under way ends first: it shows the cut once more
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    viewer.showCut(null);
    viewer.showAxis(null);
    viewer.setDropped([]);
    [toolHint, cutting] = [null, null];
    if (!ok || !current()) return undo();
    const drop = keep === 'A' ? chunkB.id : keep === 'B' ? body : null;
    const doc = history.current;
    history.replace({ ...doc, bodies: doc.bodies.filter((x) => x.id !== drop) });
    selected = keep === 'both' ? [body, chunkB.id] : [keep === 'A' ? body : chunkB.id];
    update();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || (!pressed(e, 'confirm') && !pressed(e, 'cancel'))) return; // the view's Esc ending a pick
    e.stopImmediatePropagation();
    e.preventDefault();
    if (picking && pressed(e, 'cancel')) viewer.cancelFacePick();
    else finish(pressed(e, 'confirm'));
  };
  box.append(
    ...field('Offset', () => values.offset, (t) => (values.offset = t)),
    toObjectButton(aim, 'Click a corner, edge or face: the cut goes through it'),
    ...(cutter.kind === 'plane'
      ? [...field('Turn °', () => values.turn, (t) => (values.turn = t)), Object.assign(document.createElement('button'), { textContent: 'Set axis', title: 'Click an edge or line (the plane turns around it) or a circle (around its centre)', onclick: setAxis })]
      : []),
    segmented,
    Object.assign(document.createElement('button'), { textContent: '✓', title: 'Cut (Enter); Esc leaves the body as it was', onclick: () => finish(true) }),
  );
  choose('A');
  // centred at the top of the view, below its switches; below the view cube where it would reach it
  const w = box.offsetWidth;
  const left = r.left + (r.width - w) / 2;
  keepInside(box, left, r.top + (left + w > r.right - 110 ? 150 : 44), false, [r.left, r.top, r.right, r.bottom]);
  // the offset, from 0: typing replaces it (after the click that picked the face has ended)
  setTimeout(() => (fields[0].focus(), fields[0].select()));
  addEventListener('keydown', keys, { capture: true });
}

/**
 * Revolve: closed shapes (the selected ones, all of the selected sketch's, or the one whose outline is clicked next)
 * turned around an axis clicked next (a sketch line or a body edge in their plane): a new body, shown at once; the
 * angle (360° first) typed or scrubbed live, Enter keeps it, Esc leaves nothing.
 */
function revolveTool() {
  const id = activeSketch();
  const s = viewer.sketches.find((v) => v.id === id);
  const shapes = s ? (shapeSel.length ? s.shapes.filter((q) => shapeSel.includes(q.id)) : s.shapes).filter((q) => !q.construction && q.kind !== 'line') : [];
  if (!s || !shapes.length) {
    toolHint = 'Revolve: click the outline of a closed sketch shape · [Esc] cancels';
    render();
    return viewer.pickFace((face) => {
      toolHint = null;
      if (!face?.sketch?.shape) return render();
      [selected, shapeSel] = [[face.sketch.id], [face.sketch.shape]];
      showSelection();
      revolveTool();
    }, false, 'outlines');
  }
  toolHint = "Revolve: click the axis, a sketch line or a body edge in the shapes' plane · [Esc] cancels";
  render();
  const f = s.frame;
  viewer.pickAxis(
    (a) => {
      tips.cursorTip(null);
      viewer.showAxis(null);
      toolHint = null;
      if (!a) return render();
      // the axis in the shapes' plane: it must not stand (nearly) square to it
      const [u, v] = [a.dir.dot(new Vector3(...f.x)), a.dir.dot(new Vector3(...f.y))];
      const l = Math.hypot(u, v);
      if (l < 0.5) return fail("The axis has to lie in the shapes' plane");
      revolvePanel(s.id, shapes.map((q) => q.id), { at: uvOf(f, a.at), dir: [u / l, v / l] });
    },
    (a) => (tips.cursorTip(a ? `${a.what}\nClick: the shapes turn around it` : null), viewer.showAxis(a, new Vector3(...f.o), 200)),
  );
}

/** The revolve being set up: its body shown, a panel at the top middle of the view with the angle; Enter keeps it, Esc leaves nothing. */
function revolvePanel(sketch: string, shapes: string[], axis: { at: [number, number]; dir: [number, number] }) {
  const doc = history.current;
  const feature: Feature = { id: newId(), type: 'revolve', source: { kind: 'sketch', sketch, shapes }, axis, angle: ex(360), mode: 'add' };
  const plane = doc.sketches.find((k) => k.id === sketch)!.plane;
  const body = newBody(doc.bodies.length, [feature], plane.kind === 'base' ? doc.sketches.find((k) => k.id === sketch)!.group : null);
  [selected, shapeSel] = [[body.id], []];
  commit({ ...doc, bodies: [...doc.bodies, body] });
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  const input = Object.assign(document.createElement('input'), { value: '360', spellcheck: false });
  const set = (text: string) => {
    input.value = text;
    const ok = length(text) !== null;
    input.classList.toggle('invalid', !ok);
    if (!ok) return;
    const now = history.current;
    const i = now.bodies.findIndex((b) => b.id === body.id);
    history.replace(setIn(now, ['bodies', String(i), 'features', '0', 'angle'], { e: text, u: 'mm' }));
    update();
  };
  input.oninput = () => set(input.value || '0');
  const label = Object.assign(document.createElement('span'), { textContent: 'Angle °' });
  scrub(label, input, () => input.value, 'mm', settings.minStep, set, () => (input.focus(), input.select()));
  const finish = (ok: boolean) => {
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    toolHint = null;
    if (!ok) return undo();
    render();
  };
  const keys = (e: KeyboardEvent) => (pressed(e, 'confirm') || pressed(e, 'cancel')) && (e.stopImmediatePropagation(), e.preventDefault(), finish(pressed(e, 'confirm')));
  box.append(label, input, Object.assign(document.createElement('button'), { textContent: '✓', title: 'Keep it (Enter); Esc leaves nothing', onclick: () => finish(true) }));
  document.body.append(box);
  const r = viewer.el.getBoundingClientRect();
  keepInside(box, r.left + (r.width - box.offsetWidth) / 2, r.top + 44, false, [r.left, r.top, r.right, r.bottom]);
  toolHint = 'Type or scrub the angle · [Enter] keeps it · [Esc] leaves nothing';
  render();
  setTimeout(() => (input.focus(), input.select()));
  addEventListener('keydown', keys, { capture: true });
}

/**
 * Loft: closed sketch shapes clicked in order (one per sketch, by their outline); from the second on the new body shows
 * through them. Enter keeps it, Esc leaves nothing.
 */
function loftTool() {
  const picked: { sketch: string; shape: string }[] = [];
  let body: string | null = null;
  let ended = false;
  const show = () => {
    if (picked.length < 2) return;
    const doc = history.current;
    const feature: Feature = { id: newId(), type: 'loft', sections: [...picked], ruled: false };
    if (!body) {
      const made = newBody(doc.bodies.length, [feature]);
      [body, selected, shapeSel] = [made.id, [made.id], []];
      history.push({ ...doc, bodies: [...doc.bodies, made] });
    } else history.replace({ ...doc, bodies: doc.bodies.map((b) => (b.id === body ? { ...b, features: [feature] } : b)) });
    update();
  };
  const finish = (ok: boolean) => {
    if (ended) return;
    ended = true;
    removeEventListener('keydown', keys, { capture: true });
    viewer.cancelFacePick();
    toolHint = null;
    if (!ok && body) return undo();
    render();
  };
  const next = () => {
    toolHint = `Loft: click the outlines of closed sketch shapes in order, one per sketch (${picked.length} so far) · [Enter] keeps it · [Esc] cancels`;
    render();
    viewer.pickFace((face) => {
      if (ended) return;
      if (!face) return finish(false);
      const at = face.sketch;
      if (at?.shape && !picked.some((q) => q.sketch === at.id)) picked.push({ sketch: at.id, shape: at.shape }), show();
      next();
    }, false, 'outlines');
  };
  const keys = (e: KeyboardEvent) => pressed(e, 'confirm') && (e.stopImmediatePropagation(), e.preventDefault(), finish(picked.length > 1));
  addEventListener('keydown', keys, { capture: true });
  next();
}

/**
 * Rotate (W): the selection (or what is clicked next) turns around an axis clicked next: an edge or line (around it),
 * a circle or round edge (around its centre, square to it), or a point (Z through it; clicking it again: X, then Y);
 * in a sketch the click only sets the point it turns around (in its plane). Then the pointer turns it as the line tool
 * turns a line (1° steps, Shift the angle step shown as ticks, A / Shift A finer / coarser, Ctrl the minimum angle); a
 * click keeps it. A panel at the top middle of the view: Turn ° (typed or scrubbed; typed, the pointer leaves it),
 * X / Y / Z (that world axis through the point), Set axis. Enter or ✓ keeps it (one undo step), Esc puts it back.
 */
function rotateTool() {
  if (!selected.length) {
    pending = { tool: 'move', pick: (id) => (cancelPending(), (selected = [id]), showSelection(), rotateTool()) };
    toolHint = 'Rotate: click what to turn · [Esc] cancels';
    return render();
  }
  const doc0 = history.current;
  const sketch = activeSketch();
  const frame = viewer.sketches.find((v) => v.id === sketch)?.frame;
  const spans = [0, 1, 2].map(extentAlong);
  const middle = spans.every(Boolean) ? new Vector3(...spans.map((r) => (r![0] + r![1]) / 2)) : new Vector3();
  // none until clicked: nothing turns before
  let pivot: Vector3 | null = null;
  let dir = frame ? new Vector3(...frame.n) : new Vector3(0, 0, 1);
  let point = false; // the axis goes through a clicked point: clicking it again takes the next world axis
  // what turns: in a sketch its shapes (all, or the selected ones), else bodies with their tool bodies and groups, not twice inside a turned group
  const owner = ownersOf(doc0);
  const inTurned = (group: string | null): boolean => !!group && (selected.includes(group) || inTurned(doc0.groups.find((g) => g.id === group)?.parent ?? null));
  const ids = selected.filter((id) => !doc0.bodies.some((b) => b.id === id && inTurned(b.group)) && !doc0.groups.some((g) => g.id === id && inTurned(g.parent)));
  for (const [owned, by] of owner) if (ids.includes(by) && !ids.includes(owned)) ids.push(owned);
  const start = new Map(ids.map((id) => [id, (bodyPlaces.get(id) ?? groupPlace(id)).clone()]));
  const parents = new Map(ids.map((id) => [id, parentPlace(id)]));
  const shapes = sketch && frame ? viewer.sketches.find((v) => v.id === sketch)!.shapes.filter((q) => !shapeSel.length || shapeSel.includes(q.id)) : [];
  const deg = (r: number) => +fmt((r * 180) / Math.PI);
  /** The document turned `angle` degrees. */
  const turned = (angle: number): Doc => {
    const at = pivot ?? middle;
    if (frame && sketch) {
      const [pu, pv] = uvOf(frame, at);
      const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
      const around = ([u, v]: [number, number]): [number, number] => [pu + (u - pu) * c - (v - pv) * s, pv + (u - pu) * s + (v - pv) * c];
      return withShapes(doc0, sketch, shapes.map((q) => {
        if (q.kind === 'line') return { id: q.id, profile: { ...q, pts: q.pts.map(around) } };
        const [m, n] = [centre(q), around(centre(q))];
        return { id: q.id, profile: shifted(rotated(q, angle), n[0] - m[0], n[1] - m[1]) };
      }));
    }
    const turn = new Matrix4().makeTranslation(at).multiply(new Matrix4().makeRotationAxis(dir, (angle * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(at.clone().negate()));
    let next = doc0;
    for (const id of ids) {
      const local = parents.get(id)!.clone().invert().multiply(turn).multiply(start.get(id)!);
      const [at, q] = [new Vector3(), new Quaternion()];
      local.decompose(at, q, new Vector3());
      const e = new Euler().setFromQuaternion(q, 'ZYX');
      const rotation = { rx: ex(deg(e.x)), ry: ex(deg(e.y)), rz: ex(deg(e.z)) };
      const position = at.toArray().map((v) => len(v)) as [Expr, Expr, Expr];
      const i = next.bodies.findIndex((b) => b.id === id);
      if (i >= 0) next = setIn(setIn(next, ['bodies', String(i), 'rotation'], rotation), ['bodies', String(i), 'position'], position);
      const g = next.groups.findIndex((x) => x.id === id);
      if (g >= 0) next = setIn(next, ['groups', String(g), 'origin'], { kind: 'custom', position, rotation });
    }
    return next;
  };
  let angle = 0;
  let typed = false; // a typed angle: the pointer no longer turns it
  let from: { screen: number; at: Vector3 } | null = null; // where the pointer started turning it
  let mode: 'turn' | 'axis' | 'aim' = 'axis';
  let ended = false;
  const apply = (a: number) => {
    angle = a;
    input.value = fmt(a);
    if (history.current !== doc0) history.replace(turned(a));
    else history.push(turned(a));
    update();
    marks();
  };
  const marks = () => {
    viewer.showPoint(pivot);
    viewer.showAxis(pivot && { at: pivot, dir, what: '' }, pivot ?? undefined, 60);
    viewer.showTicks(pivot && from ? { at: pivot, dir, from: from.at, step: SketchTool.angleStep, angle } : null);
  };
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  const input = Object.assign(document.createElement('input'), { value: '0', spellcheck: false });
  input.dataset.complete = '';
  const fromField = (text: string) => {
    const v = length(text || '0');
    input.classList.toggle('invalid', v === null);
    if (v !== null && pivot) apply(v / UNITS[doc0.units]); // degrees: the number as typed, not a length
  };
  input.oninput = () => ((typed = true), fromField(input.value));
  const label = Object.assign(document.createElement('span'), { textContent: 'Turn °' });
  scrub(label, input, () => input.value, 'mm', settings.minAngle, (text) => ((typed = true), (input.value = text), fromField(text)), () => (input.focus(), input.select()));
  const button = (text: string, title: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, title, onclick });
  /** Around world axis `k` through the point (none yet: the selection's middle). */
  const along = (k: number) => {
    [dir, pivot, from] = [new Vector3().setComponent(k, 1), pivot ?? middle, null];
    apply(0);
    turnPick();
  };
  /** Turning: waits for the click that keeps it (a drag turns the view; a click on its point takes the next axis); Esc puts it back. */
  const turnPick = () => {
    mode = 'turn';
    toolHint = `Move the pointer around the axis to turn (Shift: ${SketchTool.angleStep}° steps, A / Shift A finer / coarser, Ctrl: ${settings.minAngle}°) or type degrees${point ? ' · click its point again: the next axis' : ''} · click or [Enter] keeps it · [Esc] puts it back`;
    render();
    viewer.pickFace((face) => {
      if (ended || mode !== 'turn') return;
      const at = viewer.pointer();
      const r = viewer.el.getBoundingClientRect();
      const [x, y] = viewer.toScreen(pivot!);
      // its point clicked again: Z, then X, then Y through it
      if (face && point && !frame && at && Math.hypot(at.x - r.left - x, at.y - r.top - y) < 14) {
        dir = new Vector3().setComponent((dir.z ? 0 : dir.x ? 1 : 2), 1);
        from = null;
        typed = false;
        apply(0);
        return turnPick();
      }
      finish(!!face);
    }, true);
  };
  /** To object: two clicks, where something is now and where it should go; their angle around the axis goes into Turn ° (to calculate on). */
  const aimAngle = () => {
    if (!pivot) return;
    mode = 'aim'; // before ending the turn's pick: that pick then does nothing
    viewer.cancelFacePick();
    const picks: Vector3[] = [];
    const done = () => ((viewer.aiming = null), viewer.aimAt(null), tips.cursorTip(null));
    const next = () => {
      viewer.aiming = (a) => tips.cursorTip([a?.what, `To object: click where it ${picks.length ? 'goes' : 'is now'}`].filter(Boolean).join('\n'));
      viewer.aiming(viewer.aimHere());
      viewer.pickFace((face) => {
        if (ended) return;
        if (!face?.snap) return done(), turnPick();
        picks.push(face.snap);
        if (picks.length < 2) return next();
        done();
        const [a, b] = picks.map((p) => p.clone().sub(pivot!).projectOnPlane(dir));
        const deg = (Math.atan2(a.clone().cross(b).dot(dir), a.dot(b)) * 180) / Math.PI;
        input.focus();
        input.setRangeText(fmt(deg), input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
        typed = true;
        fromField(input.value);
        turnPick();
      }, true);
    };
    toolHint = 'To object: click where something is now, then where it should go: their angle goes into Turn ° · [Esc] cancels';
    render();
    next();
  };
  /** The next click sets the axis (in a sketch: the point it turns around). */
  const setAxis = () => {
    mode = 'axis'; // before ending the turn's pick: that pick then does nothing
    viewer.cancelFacePick();
    viewer.showTicks(null);
    toolHint = frame
      ? 'Rotate: click the point it turns around (a corner, a circle: its centre) · [Esc] ' + (pivot ? 'keeps the axis' : 'cancels')
      : 'Rotate: click the axis, an edge or line, a circle (its centre), or a point (Z through it; again: X, then Y) · [Esc] ' + (pivot ? 'keeps the axis' : 'cancels');
    render();
    viewer.pickAxis(
      (a) => {
        tips.cursorTip(null);
        if (!a && !pivot) return finish(false);
        if (a) {
          point = a.what.includes('Z through');
          // in a sketch: the point only (it turns in its plane)
          if (frame) pivot = new Vector3(...toWorld(frame, ...uvOf(frame, a.at)));
          else [pivot, dir] = [a.at.clone().addScaledVector(a.dir, middle.clone().sub(a.at).dot(a.dir)), a.dir.clone()];
          if (point && !frame) pivot = a.at.clone();
          from = null;
        }
        apply(angle);
        turnPick();
      },
      (a) => (tips.cursorTip(a ? `${a.what}\nClick: it turns around it` : null), a ? viewer.showAxis(a, a.at, 60) : marks()),
    );
  };
  const finish = (ok: boolean) => {
    if (ended) return;
    ended = true;
    viewer.aiming = null;
    viewer.cancelFacePick();
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    viewer.el.removeEventListener('pointermove', move);
    viewer.showPoint(null);
    viewer.showAxis(null);
    viewer.showTicks(null);
    tips.cursorTip(null);
    toolHint = null;
    if (!ok && history.current !== doc0) return undo();
    render();
  };
  // the pointer around the axis, as the line tool turns a line: counter-clockwise on screen is positive seen from the axis' tip
  const move = (e: PointerEvent) => {
    if (mode !== 'turn' || typed || e.buttons || !pivot) return;
    const r = viewer.el.getBoundingClientRect();
    const [x, y] = viewer.toScreen(pivot);
    const now = Math.atan2(-(e.clientY - r.top - y), e.clientX - r.left - x);
    if (!from) {
      const at = viewer.pointOnPlane(e, pivot, dir);
      if (!at || at.distanceTo(pivot) < 1e-6) return;
      from = { screen: now, at };
    }
    const sign = dir.dot(viewer.screenDir(1, 0).cross(viewer.screenDir(0, 1))) >= 0 ? 1 : -1;
    const raw = ((((now - from.screen) * 180) / Math.PI) * sign + 540) % 360 - 180;
    const step = e.shiftKey ? SketchTool.angleStep : e.ctrlKey ? settings.minAngle : 1;
    const a = Math.round(raw / step) * step;
    tips.cursorTip(`${fmt(a)}°`);
    if (a !== angle) apply(a);
    else marks();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // the view's Esc ending a pick
    if (pivot && mode === 'turn' && (document.activeElement === input ? wantsT(e, input, doc0.params) : pressed(e, 'toObject'))) return e.preventDefault(), e.stopImmediatePropagation(), aimAngle();
    // typing degrees goes into the field (the key lands there)
    if (pivot && /^[\d.-]$/.test(e.key) && document.activeElement !== input && !e.metaKey && !e.ctrlKey) return (input.value = ''), input.focus();
    const axis = (['moveX', 'moveY', 'moveZ'] as const).findIndex((a) => pressed(e, a));
    const step = pressed(e, 'moreSnaps') ? 1 : pressed(e, 'fewerSnaps') ? -1 : 0;
    if (axis >= 0 && !frame) along(axis);
    else if (step && document.activeElement !== input) {
      SketchTool.angleStep = ANGLE_STEPS[Math.min(ANGLE_STEPS.length - 1, Math.max(0, ANGLE_STEPS.indexOf(SketchTool.angleStep) + step))];
      marks();
      if (mode === 'turn') turnPick();
    } else if (pressed(e, 'confirm')) finish(true);
    else if (pressed(e, 'cancel')) (mode === 'turn' || !pivot ? finish(false) : viewer.cancelFacePick());
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  box.append(
    label,
    input,
    ...(frame ? [] : [0, 1, 2].map((a) => button('XYZ'[a], `Around the world ${'XYZ'[a]} axis through its point (${'XYZ'[a]})`, () => along(a)))),
    button('Set axis', 'Click an edge or line, a circle (its centre) or a point (Z through it; again: X, then Y)', setAxis),
    toObjectButton(aimAngle, 'Click where something is now, then where it should go: their angle goes into Turn °'),
    button('✓', 'Keep it (Enter or a click in the view); Esc puts it back', () => finish(true)),
  );
  document.body.append(box);
  const r = viewer.el.getBoundingClientRect();
  const w = box.offsetWidth;
  const left = r.left + (r.width - w) / 2;
  keepInside(box, left, r.top + (left + w > r.right - 110 ? 150 : 44), false, [r.left, r.top, r.right, r.bottom]);
  addEventListener('keydown', keys, { capture: true });
  viewer.el.addEventListener('pointermove', move);
  setAxis();
}

/**
 * Joint (J): the parent that stays (the first selected body or group, or the one clicked), then what moves (the other
 * selected ones, or those clicked; Enter), then the axis (an edge or line, or a circle's or round edge's centre, square
 * to it): the joint is made (a hinge, 0–180°) and its edit panel opens.
 */
function jointTool() {
  const isObject = (id: string) => history.current.bodies.some((b) => b.id === id) || history.current.groups.some((g) => g.id === id);
  const [parent, ...children] = selected.filter(isObject);
  if (!parent) {
    pending = { tool: 'joint', pick: (id) => (cancelPending(), (selected = [id]), showSelection(), jointTool()) };
    toolHint = 'Joint: click the object that stays (a body or group) · [Esc] cancels';
    return render();
  }
  if (!children.length) {
    const moving: string[] = [];
    pending = {
      tool: 'joint',
      pick(id) {
        if (id === parent) return;
        moving.splice(0, moving.length, ...(moving.includes(id) ? moving.filter((x) => x !== id) : [...moving, id]));
        selected = [parent, ...moving];
        showSelection();
      },
      apply() {
        cancelPending();
        if (moving.length) jointTool();
        else render();
      },
    };
    toolHint = 'Joint: click the objects that move (again: not), then [Enter] · [Esc] cancels';
    return render();
  }
  toolHint = 'Joint: click its axis, an edge or line (or a circle or round edge: through its centre, square to it) · [Esc] cancels';
  render();
  viewer.pickAxis(
    (a) => {
      tips.cursorTip(null);
      viewer.showAxis(null);
      toolHint = null;
      if (!a) return render();
      const doc = history.current;
      // the axis in the parent's coordinates: it moves with the parent
      const back = (bodyPlaces.get(parent) ?? groupPlace(parent)).clone().invert();
      const joint: Joint = {
        id: newId(),
        name: `Hinge ${doc.joints.filter((j) => j.kind === 'hinge').length + 1}`,
        kind: 'hinge',
        parent,
        children,
        axis: { at: a.at.clone().applyMatrix4(back).toArray(), dir: a.dir.clone().transformDirection(back).toArray() },
        min: ex(0),
        max: ex(180),
        value: ex(0),
        speed: ex(1),
      };
      selected = [parent];
      commit({ ...doc, joints: [...doc.joints, joint] });
      jointPanel(joint.id, true, a.length);
    },
    (a) => (tips.cursorTip(a ? `${a.what}\nClick: the joint's axis` : null), viewer.showAxis(a, a?.at, 60)),
  );
}

/** A joint's axis in the world, as its parent is placed now. */
function jointAxis(j: Joint) {
  const parent = bodyPlaces.get(j.parent) ?? groupPlace(j.parent);
  return { at: new Vector3(...j.axis.at).applyMatrix4(parent), dir: new Vector3(...j.axis.dir).transformDirection(parent).normalize(), what: '' };
}

/** Its min and max as numbers (degrees or mm). */
function jointRange(j: Joint, lookup = paramLookup(history.current.params)): [number, number] {
  return [j.min, j.max].map((x) => {
    try {
      return evalLength(x, lookup);
    } catch {
      return 0;
    }
  }) as [number, number];
}

/** Its range in words, shown grey after its name: `0–110°`, `0–35 mm`. */
function rangeText(j: Joint) {
  const u = history.current.units;
  const [lo, hi] = jointRange(j).map((v) => (j.kind === 'hinge' ? fmt(v) : fmt(v / UNITS[u])));
  return j.kind === 'hinge' ? `${lo}–${hi}°` : `${lo}–${hi} ${u}`;
}

/**
 * A joint's edit panel at the top middle of the view (`fresh`: just made; Esc then removes it): Hinge or Slider, Min and
 * Max (each scrubbed by its label; changing one shows the joint there; T or To object: click a point, the moving part
 * points at it or reaches it), Speed (times the play time in Settings), Invert (the other way round). Enter or ✓ keeps
 * the changes (one undo step), Esc drops them. `reach`: the axis edge's length (a new slider's max).
 */
function jointPanel(id: string, fresh: boolean, reach = 50) {
  const doc0 = history.current;
  const lookup = paramLookup(doc0.params);
  const u = doc0.units;
  let changed = fresh; // a fresh joint is already one undo step: changes join it
  const now = () => history.current.joints.find((j) => j.id === id)!;
  const write = (next: Partial<Joint>) => {
    const k = history.current.joints.findIndex((j) => j.id === id);
    const doc = setIn(history.current, ['joints', String(k)], { ...now(), ...next });
    if (changed) history.replace(doc);
    else history.push(doc), (changed = true);
    update();
    viewer.showAxis(jointAxis(now()), jointAxis(now()).at, 60);
  };
  // values as typed: degrees as numbers (never unit-converted), lengths in the document's unit
  const expr = (text: string): Expr => ({ e: text, u: now().kind === 'hinge' ? 'mm' : u });
  const shown = (x: Expr) => x.e;
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  const fields = new Map<'min' | 'max' | 'speed', HTMLInputElement>();
  let last: 'min' | 'max' = 'max';
  const field = (key: 'min' | 'max' | 'speed') => {
    const input = Object.assign(document.createElement('input'), { value: shown(now()[key]), spellcheck: false });
    input.dataset.complete = '';
    const set = (text: string) => {
      input.value = text;
      const ok = length(text || '0') !== null;
      input.classList.toggle('invalid', !ok);
      if (!ok) return;
      const x = key === 'speed' ? { e: text || '1', u: 'mm' as Unit } : expr(text || '0');
      write(key === 'speed' ? { speed: x } : { [key]: x, value: x }); // a limit changed: the joint shows there
    };
    input.oninput = () => set(input.value);
    input.onfocus = () => key !== 'speed' && (last = key);
    input.onkeydown = (e) => {
      const before = input.value.slice(0, input.selectionStart ?? 0);
      const word = before.match(/[A-Za-z_]\w*$/)?.[0];
      if (key !== 'speed' && pressed(e, 'toObject') && (!word || word in UNITS)) e.preventDefault(), aim();
    };
    const label = Object.assign(document.createElement('span'), { className: 'scrub-label' });
    scrub(label, input, () => input.value, now().kind === 'hinge' || key === 'speed' ? 'mm' : u, key === 'speed' ? 0.01 : settings.minStep, (text) => set(text), () => (input.focus(), input.select()));
    fields.set(key, input);
    return [label, input] as const;
  };
  const [minLabel, minInput] = field('min');
  const [maxLabel, maxInput] = field('max');
  const [speedLabel, speedInput] = field('speed');
  speedLabel.textContent = 'Speed ×';
  const labels = () => {
    const deg = now().kind === 'hinge' ? ' °' : '';
    [minLabel.textContent, maxLabel.textContent] = [`Min${deg}`, `Max${deg}`];
  };
  /** To object: the next click sets the min or max (the last one typed in) to point the moving part at it, or reach it. */
  const aim = () => {
    const key = last;
    const at = (p: Vector3) => {
      const j = now();
      const axis = jointAxis(j);
      const moving = contents(history.current, j.children).filter((x) => history.current.bodies.some((b) => b.id === x));
      const ref = moving.map((x) => viewer.measure(x)?.box.getCenter(new Vector3())).find(Boolean);
      const v = jointValue(j, lookup);
      if (!ref) return v;
      if (j.kind === 'slider') return v + p.clone().sub(ref).dot(axis.dir);
      const [from, to] = [ref.clone().sub(axis.at).projectOnPlane(axis.dir), p.clone().sub(axis.at).projectOnPlane(axis.dir)];
      return v + (Math.atan2(from.clone().cross(to).dot(axis.dir), from.dot(to)) * 180) / Math.PI;
    };
    const text = (v: number) => fmt(now().kind === 'hinge' ? v : v / UNITS[u]);
    viewer.aiming = (a) => tips.cursorTip([a?.what, `Click: the ${key} points the moving part at it`].filter(Boolean).join('\n'));
    viewer.aiming(viewer.aimHere());
    viewer.pickFace((face) => {
      viewer.aiming = null;
      viewer.aimAt(null);
      tips.cursorTip(null);
      if (face?.snap) {
        const t = text(at(face.snap));
        fields.get(key)!.value = t;
        write({ [key]: expr(t), value: expr(t) });
      }
      fields.get(key)!.focus();
    }, true);
  };
  const choices = (['hinge', 'slider'] as const).map((k) => {
    const b = Object.assign(document.createElement('button'), { textContent: k === 'hinge' ? 'Hinge' : 'Slider', title: k === 'hinge' ? 'Turns around the axis' : 'Moves along the axis', onclick: () => choose(k) });
    b.dataset.kind = k;
    return b;
  });
  const choose = (k: Joint['kind']) => {
    const j = now();
    if (k !== j.kind) {
      const [lo, hi] = k === 'hinge' ? ['0', '180'] : ['0', fmt(reach / UNITS[u])];
      const auto = /^(Hinge|Slider) \d+$/.test(j.name); // a name it was given: kept
      const kind = k === 'hinge' ? 'Hinge' : 'Slider';
      const x = (t: string): Expr => ({ e: t, u: k === 'hinge' ? 'mm' : u });
      write({ kind: k, min: x(lo), max: x(hi), value: x(lo), ...(auto ? { name: `${kind} ${history.current.joints.filter((o) => o.kind === k).length + 1}` } : {}) });
      [minInput.value, maxInput.value] = [lo, hi];
    }
    choices.forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
    labels();
  };
  const segmented = Object.assign(document.createElement('span'), { className: 'segmented' });
  segmented.append(...choices);
  const finish = (ok: boolean) => {
    viewer.aiming = null;
    viewer.cancelFacePick();
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    viewer.showAxis(null);
    toolHint = null;
    if (!ok && changed) return undo();
    render();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // the view's Esc ending a pick
    if (!pressed(e, 'confirm') && !pressed(e, 'cancel')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    finish(pressed(e, 'confirm'));
  };
  const button = (text: string, title: string, onclick: () => void) => Object.assign(document.createElement('button'), { textContent: text, title, onclick });
  box.append(
    segmented,
    minLabel,
    minInput,
    maxLabel,
    maxInput,
    toObjectButton(aim, 'Click a point: the min or max (the last one typed in) points the moving part at it, or reaches it (T)'),
    speedLabel,
    speedInput,
    button('⇄ Invert', 'Turn or move the other way round', () => write({ axis: { ...now().axis, dir: now().axis.dir.map((v) => -v) as [number, number, number] } })),
    button('✓', 'Keep the changes (Enter); Esc drops them', () => finish(true)),
  );
  choose(now().kind);
  document.body.append(box);
  const r = viewer.el.getBoundingClientRect();
  const w = box.offsetWidth;
  const left = r.left + (r.width - w) / 2;
  keepInside(box, left, r.top + (left + w > r.right - 110 ? 150 : 44), false, [r.left, r.top, r.right, r.bottom]);
  viewer.showAxis(jointAxis(now()), jointAxis(now()).at, 60);
  toolHint = `${now().name}: hinge or slider, its limits (T: to a point), speed, direction · [Enter] keeps it · [Esc] ${fresh ? 'removes the joint' : 'drops the changes'}`;
  render();
  setTimeout(() => (maxInput.focus(), maxInput.select()));
  addEventListener('keydown', keys, { capture: true });
}

/**
 * The joints box at the bottom right of the view (while there are joints): per joint its name (edited in place) with its
 * range in grey, ✎ its edit panel; ▶ / ❚❚ plays from where it is to its max and pauses (the pose stays: modelling
 * happens there), Repeat plays back and forth smoothly instead; the slider and the Now field follow it and set where it
 * is (either pauses it). Joints left still are reported below.
 */
const jointsBox = Object.assign(document.createElement('div'), { className: 'joints-box' });
viewer.el.append(jointsBox);
let jointsKey = '';
/** Joints playing: their phase (0 → 1 from min to max; repeating 1 → 2 back) and the last frame's time. */
const playing = new Map<string, { phase: number; last: number }>();
/** Joints that play back and forth (this session). */
const repeating = new Set<string>();
function renderJoints() {
  const doc = history.current;
  const key = JSON.stringify([doc.joints.map((j) => [j.id, j.name, j.kind, j.min, j.max]), jointProblems, [...playing.keys()], [...repeating], doc.units]);
  if (key !== jointsKey) {
    jointsKey = key;
    jointsBox.hidden = !doc.joints.length;
    jointsBox.replaceChildren(...doc.joints.map(jointRow), ...jointProblems.map((p) => Object.assign(document.createElement('p'), { className: 'error', textContent: p })));
  }
  // the sliders and fields show where the joints are now (not the one being typed in)
  const lookup = paramLookup(doc.params);
  for (const j of doc.joints) if (!playing.has(j.id)) showValue(j.id, jointValue(j, lookup), j.value.e);
}

/** A joint's slider and Now field at `v` (degrees or mm; `text`: as typed). */
function showValue(id: string, v: number, text?: string) {
  const j = history.current.joints.find((x) => x.id === id);
  const slider = jointsBox.querySelector<HTMLInputElement>(`input[type=range][data-joint="${id}"]`);
  const field = jointsBox.querySelector<HTMLInputElement>(`input.now[data-joint="${id}"]`);
  if (slider) slider.value = String(v);
  if (field && document.activeElement !== field) field.value = text ?? fmt(j?.kind === 'slider' ? v / UNITS[history.current.units] : v);
}

function jointRow(j: Joint) {
  const doc = history.current;
  const [lo, hi] = jointRange(j);
  const at = (id: string) => history.current.joints.findIndex((x) => x.id === id);
  /** Where it is now, written (one undo step per drag or typing); it stops playing. */
  let dragging = false;
  const setValue = (text: string) => {
    playing.delete(j.id);
    const k = at(j.id);
    const next = setIn(history.current, ['joints', String(k)], { ...history.current.joints[k], value: { e: text, u: j.kind === 'hinge' ? 'mm' : doc.units } });
    if (dragging) history.replace(next);
    else history.push(next), (dragging = true);
    update();
  };
  const name = Object.assign(document.createElement('input'), { className: 'joint-name', value: j.name, spellcheck: false, title: 'Its name' });
  name.onchange = () => commit(setIn(history.current, ['joints', String(at(j.id)), 'name'], name.value || j.name));
  const slider = Object.assign(document.createElement('input'), { type: 'range', min: String(Math.min(lo, hi)), max: String(Math.max(lo, hi)), step: 'any', title: 'Where it is now: drag to move it (model there)' });
  slider.dataset.joint = j.id;
  slider.oninput = () => setValue(fmt(j.kind === 'hinge' ? +slider.value : +slider.value / UNITS[doc.units]));
  slider.onchange = () => (dragging = false);
  const now = Object.assign(document.createElement('input'), { className: 'now', spellcheck: false, title: 'Where it is now (degrees or a length)' });
  now.dataset.joint = j.id;
  now.oninput = () => length(now.value) !== null && setValue(now.value);
  now.onchange = () => (dragging = false);
  const nowLabel = Object.assign(document.createElement('span'), { textContent: j.kind === 'hinge' ? '°' : doc.units });
  scrub(nowLabel, now, () => now.value, j.kind === 'hinge' ? 'mm' : doc.units, settings.minStep, (text) => ((now.value = text), setValue(text)), () => (now.focus(), now.select()));
  const on = playing.has(j.id);
  const play = Object.assign(document.createElement('button'), { className: `icon${on ? ' on' : ''}`, innerHTML: icon(on ? 'pause' : 'play'), title: on ? 'Pause (it stays there)' : 'Play to the max (Repeat: back and forth)' });
  play.onclick = () => (on ? pause(j.id) : start(j.id));
  const repeat = Object.assign(document.createElement('button'), { className: `icon${repeating.has(j.id) ? ' on' : ''}`, innerHTML: icon('loop'), title: 'Repeat: play back and forth until paused' });
  repeat.onclick = () => (repeating.has(j.id) ? repeating.delete(j.id) : repeating.add(j.id), render());
  const edit = Object.assign(document.createElement('button'), { className: 'icon', innerHTML: icon('edit'), title: 'Edit the joint: kind, limits, speed, direction', onclick: () => jointPanel(j.id, false) });
  const row = Object.assign(document.createElement('div'), { className: 'joint-row' });
  row.append(name, Object.assign(document.createElement('span'), { className: 'range', textContent: rangeText(j) }), edit, play, repeat, slider, now, nowLabel);
  return row;
}

/** Plays joint `id` from where it is (from its min again when it stands at its max and does not repeat). */
function start(id: string) {
  const j = history.current.joints.find((x) => x.id === id);
  if (!j) return;
  const [lo, hi] = jointRange(j);
  const s = hi === lo ? 0 : Math.min(1, Math.max(0, (jointValue(j, paramLookup(history.current.params)) - lo) / (hi - lo)));
  // the phase whose eased position is s (going up)
  const phase = !repeating.has(id) && s > 0.999 ? 0 : Math.acos(1 - 2 * s) / Math.PI;
  playing.set(id, { phase, last: performance.now() });
  if (playing.size === 1) requestAnimationFrame(animate);
  render();
}

/** Stops joint `id` where it is now: that is where it stays (one undo step). */
function pause(id: string, at?: number) {
  const p = playing.get(id);
  playing.delete(id);
  const doc = history.current;
  const k = doc.joints.findIndex((x) => x.id === id);
  if (!p || k < 0) return render();
  const j = doc.joints[k];
  const v = at ?? eased(j, p.phase);
  commit(setIn(doc, ['joints', String(k), 'value'], { e: fmt(j.kind === 'hinge' ? v : v / UNITS[doc.units]), u: j.kind === 'hinge' ? 'mm' : doc.units }));
}

/** Where a joint is at `phase` (0 min, 1 max, 2 min again), easing in and out. */
function eased(j: Joint, phase: number) {
  const [lo, hi] = jointRange(j);
  const t = phase % 2 > 1 ? 2 - (phase % 2) : phase % 2;
  return lo + (hi - lo) * (0.5 - 0.5 * Math.cos(Math.PI * t));
}

/** One frame of the joints playing: their objects moved in the view only; at its max a joint that does not repeat stops. */
function animate(now: number) {
  const doc = history.current;
  const lookup = paramLookup(doc.params);
  const values = new Map<string, number>();
  for (const [id, p] of playing) {
    const j = doc.joints.find((x) => x.id === id);
    if (!j) {
      playing.delete(id);
      continue;
    }
    let speed = 1;
    try {
      speed = evalLength(j.speed, lookup) || 1;
    } catch {
      /* not a number: speed 1 */
    }
    p.phase += (now - p.last) / 1000 / Math.max(0.1, settings.jointSeconds / speed);
    p.last = now;
    if (!repeating.has(id) && p.phase >= 1) {
      pause(id, jointRange(j, lookup)[1]);
      continue;
    }
    p.phase %= 2; // back and forth: smooth at both ends
    values.set(id, eased(j, p.phase));
    showValue(id, values.get(id)!);
  }
  const { placed } = jointed(doc, ownPlaces, (j) => values.get(j.id) ?? jointValue(j, lookup));
  for (const b of doc.bodies) {
    const m = placed.get(b.id);
    if (!m || !bodyPlaces.has(b.id)) continue;
    const [at, turn] = [new Vector3(), new Quaternion()];
    m.decompose(at, turn, new Vector3());
    viewer.setPlacement(b.id, at, turn);
  }
  viewer.render();
  if (playing.size) requestAnimationFrame(animate);
}

/** Tool first: the next clicked body gets `act`. */
function pickFor(tool: 'delete' | 'duplicate' | 'hide', act: () => void) {
  pending = {
    tool,
    pick(id) {
      cancelPending();
      selected = [id];
      act();
    },
  };
  toolHint = `Click a body or sketch to ${tool} it · [Esc] cancels`;
  render();
}

function cancelPending() {
  pending = null;
  toolHint = null;
}

/** Deletes the selected shapes of the selected sketch, else the selected bodies and sketches. */
function remove() {
  if (!selected.length) return pickFor('delete', remove);
  const doc = history.current;
  if (finishSel) {
    // a part of a finish: its edge is left out; the whole finish: it goes
    const { body, feature, mid } = finishSel;
    viewer.setFinishMark((finishSel = null));
    const bodies = doc.bodies.map((b) =>
      b.id !== body ? b : { ...b, features: b.features.flatMap((f) => (f.id !== feature || f.type !== 'finish' ? [f] : mid ? [{ ...f, skip: [...f.skip, mid] }] : [])) },
    );
    return commit({ ...doc, bodies });
  }
  const sketch = activeSketch();
  if (sketch && shapeSel.length) {
    const gone = shapeSel;
    shapeSel = [];
    return commit({ ...doc, sketches: doc.sketches.map((s) => (s.id === sketch ? { ...s, shapes: s.shapes.filter((q) => !gone.includes(q.id)) } : s)) });
  }
  // a group goes with its contents, owned tool bodies with their owner; a deleted tool body takes its boolean along
  const owner = ownersOf(doc);
  const groups = new Set(selected.filter((id) => doc.groups.some((g) => g.id === id)).flatMap((id) => [...within(doc, id)]));
  const gone = new Set([...selected, ...contents(doc, selected)]);
  for (const id of gone) for (const [tool, o] of owner) if (o === id) gone.add(tool);
  const bodies = doc.bodies.filter((b) => !gone.has(b.id)).map((b) => ({ ...b, features: b.features.filter((f) => f.type !== 'boolean' || !gone.has(f.body)) }));
  commit({ ...doc, bodies, sketches: doc.sketches.filter((s) => !gone.has(s.id)), groups: doc.groups.filter((g) => !groups.has(g.id)) });
}

/** Folded groups in the object list. */
const folded = new Set<string>();

/**
 * `doc` with objects put into a group (null: the top level) whose origin is at `target` (world mm). Bodies keep their
 * place in the world (their positions now count from that origin); a group cannot go into itself.
 */
function movedInto(doc: Doc, ids: string[], group: string | null, target: Matrix4 = groupPlace(group)): Doc {
  const lookup = paramLookup(doc.params);
  const bodies = doc.bodies.map((b) => {
    if (!ids.includes(b.id) || b.group === group) return b;
    const local = resolve(b.position, lookup, '', new Map());
    const now = new Vector3(...local).applyMatrix4(groupPlace(b.group)).applyMatrix4(target.clone().invert()).toArray();
    return { ...b, group, position: b.position.map((x, k) => plus(x, local[k], now[k] - local[k])) as Body['position'] };
  });
  const sketches = doc.sketches.map((s) => (ids.includes(s.id) ? { ...s, group } : s));
  const groups = doc.groups.map((g) => (ids.includes(g.id) && !(group && within(doc, g.id).has(group)) ? { ...g, parent: group } : g));
  // a joint's part put into a group beside the joint's other part: the group becomes that part (all in it moves with
  // it); its axis then counts in the group's coordinates
  const level = (id: string) => bodies.find((b) => b.id === id)?.group ?? groups.find((g) => g.id === id)?.parent ?? null;
  const beside = groups.find((g) => g.id === group)?.parent ?? null;
  const into = (id: string, others: string[]) => !!group && ids.includes(id) && others.every((o) => !ids.includes(o) && level(o) === beside);
  const joints = doc.joints.map((j) => {
    const children = [...new Set(j.children.map((c) => (into(c, [j.parent]) ? group! : c)))];
    if (!into(j.parent, j.children)) return { ...j, children };
    const to = target.clone().invert().multiply(bodyPlaces.get(j.parent) ?? groupPlace(j.parent));
    const axis = { at: new Vector3(...j.axis.at).applyMatrix4(to).toArray(), dir: new Vector3(...j.axis.dir).transformDirection(to).toArray() };
    return { ...j, parent: group!, children, axis };
  });
  return { ...doc, bodies, sketches, groups, joints };
}

/** Group tool: ungroups a selected group, groups the selection, or (nothing selected) groups the objects clicked next on Enter. */
function groupTool() {
  const doc = history.current;
  // in sketch mode: shapes into a sub-group, or one sub-group selected apart
  if (sketching && shapeSel.length) {
    const s = doc.sketches.find((x) => x.id === sketching)!;
    const u = unitAt(s, shapeSel[0], sketchPath.at(-1) ?? null);
    return groupShapes(!!u?.group && u.shapes.length === shapeSel.length && u.shapes.every((id) => shapeSel.includes(id)));
  }
  if (selected.some((id) => doc.groups.some((g) => g.id === id))) return ungroup();
  if (selected.length) return groupSelection();
  pending = {
    tool: 'group',
    pick(id) {
      selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      showSelection();
    },
    apply() {
      cancelPending();
      if (selected.length) groupSelection();
    },
  };
  toolHint = 'Click the objects to group · [Enter] groups them · [Esc] cancels';
  render();
}

/** A group's origin that places it at world matrix `m` inside a parent at world matrix `parent`. */
function originAt(m: Matrix4, parent: Matrix4): Group['origin'] {
  const local = parent.clone().invert().multiply(m);
  if (local.equals(new Matrix4())) return { kind: 'parent' };
  const [at, turn] = [new Vector3(), new Quaternion()];
  local.decompose(at, turn, new Vector3());
  const r = new Euler().setFromQuaternion(turn, 'ZYX');
  const deg = (v: number) => ex(fmt((v * 180) / Math.PI));
  return { kind: 'custom', position: at.toArray().map((v) => len(v)) as [Expr, Expr, Expr], rotation: { rx: deg(r.x), ry: deg(r.y), rz: deg(r.z) } };
}

/** Ungroups the selected groups (⇧⌘G): their contents move to each group's parent, staying where they are; the groups go. */
function ungroup() {
  let doc = history.current;
  const groups = doc.groups.filter((g) => selected.includes(g.id));
  const freed: string[] = [];
  for (const g of groups) {
    const bodiesAndSketches = [...doc.bodies, ...doc.sketches].filter((o) => o.group === g.id).map((o) => o.id);
    const children = doc.groups.filter((q) => q.parent === g.id);
    doc = movedInto(doc, bodiesAndSketches, g.parent);
    // groups inside keep their place: their origin now counts from the new parent
    doc = { ...doc, groups: doc.groups.map((q) => (children.includes(q) ? { ...q, parent: g.parent, origin: originAt(groupPlace(q.id), groupPlace(g.parent)) } : q)) };
    freed.push(...bodiesAndSketches, ...children.map((q) => q.id));
  }
  [selected, shapeSel] = [freed.filter((id) => !doc.sketches.some((s) => s.id === id)), []];
  commit({ ...doc, groups: doc.groups.filter((g) => !groups.includes(g)) });
}

/** Moves objects before or after another one in its list (into that one's group), or into a group; they stay in place. */
function arrange(ids: string[], target: string, where: 'before' | 'after' | 'into') {
  if (ids.includes(target)) return;
  let doc = history.current;
  const parent = where === 'into' ? target : (doc.groups.find((g) => g.id === target)?.parent ?? doc.bodies.find((b) => b.id === target)?.group ?? null);
  doc = movedInto(doc, ids, parent);
  if (where !== 'into') {
    // that level's groups and bodies in their places, the moved ones right before or after the target, numbered anew
    const level = [...doc.groups.filter((g) => g.parent === parent), ...doc.bodies.filter((b) => b.group === parent)].map((o) => o.id).sort((a, b) => rank(doc, a) - rank(doc, b));
    const rest = level.filter((id) => !ids.includes(id));
    const i = rest.indexOf(target) + (where === 'after' ? 1 : 0);
    const order = new Map([...rest.slice(0, i), ...level.filter((id) => ids.includes(id)), ...rest.slice(i)].map((id, k) => [id, k]));
    const numbered = <T extends { id: string; order?: number }>(list: T[]) => list.map((o) => (order.has(o.id) ? { ...o, order: order.get(o.id) } : o));
    doc = { ...doc, bodies: numbered(doc.bodies), groups: numbered(doc.groups) };
  }
  commit(doc);
}

/** A new group around the selection (⌘G), in the group they share; empty when nothing is selected. */
function groupSelection() {
  const doc = history.current;
  const parents = new Set([
    ...[...doc.bodies, ...doc.sketches].filter((o) => selected.includes(o.id)).map((o) => o.group),
    ...doc.groups.filter((g) => selected.includes(g.id)).map((g) => g.parent),
  ]);
  const parent = parents.size === 1 ? [...parents][0] : null;
  // named after the first object picked, in its place in the list
  const first = [...doc.bodies, ...doc.groups, ...doc.sketches].find((o) => o.id === selected[0]);
  const group: Group = { id: newId(), name: first?.name ?? `Group ${doc.groups.length + 1}`, parent, visible: true, origin: { kind: 'parent' }, order: first && rank(doc, first.id) };
  const ids = selected;
  [selected, shapeSel] = [[group.id], []];
  commit(movedInto({ ...doc, groups: [...doc.groups, group] }, ids, group.id, groupPlace(parent)));
}

/**
 * A tool result: a drawn shape joins its sketch (a new sketch if needed); pulled shapes become a new body extruded
 * from them (linked). One undo step.
 */
function sketched(r: SketchResult): string {
  const doc = history.current;
  const t = r.target;
  let sketches = doc.sketches;
  let bodies = doc.bodies;
  let joints = doc.joints;
  let id = t.sketch;
  if (!id) {
    const fresh = sketchAt(t, sketches.length);
    sketches = [...sketches, fresh];
    id = fresh.id;
  }
  let ids = r.shapes ?? [];
  if (r.drawn) {
    const profile = profileOf(r.drawn);
    sketches = sketches.map((s) => (s.id === id ? { ...s, shapes: [...s.shapes, profile] } : s));
    ids = [profile.id];
    // a line that closes a loop with others: they become one polygon, which can be extruded
    const shapes = sketches.find((s) => s.id === id)!.shapes;
    const loop = profile.kind === 'line' && !profile.construction && closedLoop(shapes.flatMap((q) => (q.kind === 'line' && !q.construction ? [q] : [])), profile.id);
    if (loop) {
      const polygon: Profile = { id: newId(), kind: 'polygon', pts: loop.pts, r: len(0), rot: ex('0'), ...(profile.group ? { group: profile.group } : {}) };
      sketches = sketches.map((s) => (s.id === id ? { ...s, shapes: [...shapes.filter((q) => !loop.ids.includes(q.id)), polygon] } : s));
      ids = [polygon.id];
    }
  }
  if (r.depth || r.back) {
    // always new bodies, one per piece of shapes that do not overlap or touch: joining one to the body it was drawn on is
    // a boolean, done explicitly later
    const back = r.back ? { back: len(r.back, r.backTyped) } : {};
    const sketch = sketches.find((s) => s.id === id)!;
    const lookup = paramLookup(doc.params);
    const shown = sketch.shapes.filter((q) => ids.includes(q.id) && q.kind !== 'line').map((q) => resolve(q, lookup, '', new Map()) as DrawnProfile & { id: string });
    const parts = pieces(shown);
    // picked areas: each with the piece of its first shape (areas that lines enclose stay together)
    const areaParts = new Map<number, Area[]>();
    for (const a of r.areas ?? []) {
      const k = a.at || !a.in.length ? -1 : parts.findIndex((p) => p.includes(a.in[0]));
      (areaParts.get(k) ?? areaParts.set(k, []).get(k)!).push(a);
    }
    const made = (r.areas ? [...areaParts.values()].map((areas) => ({ shapes: ids, areas })) : parts.map((shapes) => ({ shapes, areas: undefined }))).map(({ shapes, areas }, k): Body => {
      const source: ExtrudeSource = { kind: 'sketch', sketch: id, shapes, areas };
      const feature: Feature = { id: newId(), type: 'extrude', source, depth: len(r.depth, r.depthTyped), ...back, mode: 'add', through: false };
      // on a base plane the body shares the sketch's group (so both count from the same origin)
      return newBody(bodies.length + k, [feature], sketch.plane.kind === 'base' ? sketch.group : null);
    });
    // drawn on a moving part of a joint: they move with it (beside it in the joint, or in its moving group)
    const on = sketch.plane.kind === 'cap' || sketch.plane.kind === 'side' ? sketch.plane.body : null;
    const joint = on && doc.joints.find((j) => j.children.includes(on));
    const host = doc.bodies.find((b) => b.id === on);
    if (joint) joints = doc.joints.map((j) => (j === joint ? { ...j, children: [...j.children, ...made.map((b) => b.id)] } : j));
    else if (host?.group && doc.joints.some((j) => j.children.some((c) => within(doc, c).has(host.group!)))) made.forEach((b) => (b.group = host.group));
    bodies = [...bodies, ...made];
    selected = made.map((b) => b.id);
    shapeSel = [];
  } else [selected, shapeSel] = [[id], ids];
  commit({ ...doc, sketches, bodies, joints });
  return id;
}

function profileOf(drawn: Drawn): Profile {
  const profile = shapeOf(drawn);
  return drawConstruction ? { ...profile, construction: true } : profile;
}

function shapeOf({ profile: p, typed: t }: Drawn): Profile {
  const id = newId();
  if (p.kind === 'rect') return { id, kind: 'rect', x: len(p.x), y: len(p.y), w: len(p.w, t.w), h: len(p.h, t.h), r: len(p.r), rot: ex(fmt(p.rot)) };
  if (p.kind === 'circle') return { id, kind: 'circle', x: len(p.x), y: len(p.y), d: len(p.d, t.d) };
  if (p.kind === 'ngon') return { id, kind: 'ngon', x: len(p.x), y: len(p.y), d: len(p.d, t.d), sides: ex(fmt(p.sides)), rot: ex(fmt(p.rot)) };
  const pts = p.pts.map(([x, y]) => [+fmt(x), +fmt(y)] as [number, number]);
  return p.kind === 'line' ? { id, kind: 'line', pts } : { id, kind: 'polygon', pts, r: len(p.r), rot: ex(fmt(p.rot)) };
}

function stopTool() {
  viewer.stopTool();
  toolMode = null;
  toolHint = null;
}

const toolHost: ToolHost = {
  length,
  number,
  lengthText: (mm) => `${+(mm / UNITS[history.current.units]).toFixed(2)}${history.current.units}`,
  /**
   * Tools stay on until Esc: in sketch mode a shape stays flat and the tool goes on; a direct shape left flat enters
   * sketch mode on its sketch, a pulled one starts the tool again; after a pull (E) the next face can be picked. A
   * picked plane gets a new sketch.
   */
  done(result) {
    const [was, kind] = [toolMode, viewer.activeTool];
    if (!result) return stopTool(), render();
    if (result.sphere) {
      addSphere(result.sphere);
      return startTool('sphere');
    }
    if (was === 'plane') {
      stopTool();
      return newSketch(result.target);
    }
    const id = sketched(result);
    if (was === 'draw') return;
    stopTool();
    if (was === 'direct' && !result.depth && !result.back) return enterSketch(id, kind);
    if (sketching) exitSketch(); // an extrusion finishes the sketch
    if (was === 'direct' && kind) startTool(kind);
    else pickFaceToPull();
  },
  hint(text) {
    toolHint = text;
    render();
  },
  cursorTip: (text) => tips.cursorTip(text),
  cursorTipRect: () => tips.cursorTipRect(),
  construction: () => drawConstruction,
};

/** New sketch objects are drawn as construction lines (follows the last switch of an object, or the X key). */
let drawConstruction = false;

/** Switches what new sketch objects are drawn as; with sketch objects selected, they switch to it too. */
function toggleConstruction() {
  drawConstruction = !drawConstruction;
  const doc = history.current;
  const k = doc.sketches.findIndex((s) => s.id === activeSketch());
  if (k >= 0 && shapeSel.length) commit(setIn(doc, ['sketches', String(k), 'shapes'], doc.sketches[k].shapes.map((q) => (shapeSel.includes(q.id) ? { ...q, construction: drawConstruction } : q))));
  else notify(drawConstruction ? 'The next shapes are construction lines' : 'The next shapes are normal shapes');
}

/** The `count`-th body at the origin (of `group`), with a colour from a small palette. */
function newBody(count: number, features: Feature[], group: string | null = null, palette = ['#d8c3a0', '#a9c4d8', '#b8cfa1', '#d9a98f', '#c7b3dc', '#e3d48f']): Body {
  return { id: newId(), name: `Body ${count + 1}`, group, rotation: unturned(), color: palette[count % palette.length], visible: true, position: [len(0), len(0), len(0)], features };
}

/** A new, empty sketch at a picked target (the `count`-th sketch). */
function sketchAt(t: Target, count: number): Sketch {
  const plane: SketchPlacement = t.placement.kind === 'base' ? { ...t.placement, offset: len(t.placement.offset) } : t.placement;
  return { id: newId(), name: `Sketch ${count + 1}`, group: null, plane, shapes: [], groups: [], visible: true };
}

/** A sphere body centred where it was drawn. */
function addSphere({ center, d, typed }: NonNullable<SketchResult['sphere']>) {
  const doc = history.current;
  const sphere: Feature = { id: newId(), type: 'sphere', x: len(center[0]), y: len(center[1]), z: len(center[2]), d: len(d, typed) };
  const body = newBody(doc.bodies.length, [sphere]);
  [selected, shapeSel] = [[body.id], []];
  commit({ ...doc, bodies: [...doc.bodies, body] });
}

/** R / C / N / P: in sketch mode into its sketch (flat), else one shape that is pulled right away. O: a sphere (not in sketch mode). */
function startTool(kind: ToolKind) {
  if (kind === 'sphere' && sketching) exitSketch();
  const s = viewer.sketches.find((v) => v.id === sketching);
  if (s) viewer.startTool(kind, toolHost, { kind: 'draw', target: { sketch: s.id, placement: s.placement, frame: s.frame, body: null, name: 'the sketch' } });
  else viewer.startTool(kind, toolHost);
  toolMode = s ? 'draw' : 'direct';
  render();
}

/** `x` (`mm` now) changed by `by` mm: a plain number stays one, an expression gets `+ by` (`ply` becomes `ply + 5`). */
function plus(x: Expr, mm: number, by: number): Expr {
  if (Math.abs(by) < 1e-9) return x;
  return isPlain(x.e) ? len(mm + by) : { e: `${x.e} ${by < 0 ? '-' : '+'} ${fmt(Math.abs(by) / UNITS[x.u])}`, u: x.u };
}

/**
 * `shape` changed from `old` to `next` (mm): `keep` values are written as typed, other changed lengths keep their
 * expressions (`+ delta`), corners are plain numbers.
 */
function rewrite(shape: Profile, old: DrawnProfile, next: DrawnProfile, keep: Record<string, Expr> = {}): Profile {
  const out = { ...shape } as Record<string, unknown>;
  const was = old as Record<string, unknown>;
  for (const [key, v] of Object.entries(next))
    if (keep[key]) out[key] = keep[key];
    else if (key === 'pts') out.pts = (v as [number, number][]).map(([x, y]) => [+fmt(x), +fmt(y)]);
    else if (typeof v === 'number' && !UNITLESS.includes(key)) out[key] = plus(out[key] as Expr, was[key] as number, v - (was[key] as number));
  return out as Profile;
}

/** Per shape (by id): the reference point of its fields (-1, 0, 1 per own axis; default the centre), and whether its width and height change together. */
const shapeRefs = new Map<string, [number, number]>();
viewer.shapeRefs = shapeRefs;
const linkedSizes = new Set<string>();
const refOf = (id: string) => shapeRefs.get(id) ?? [0, 0];

/**
 * A shape field typed or scrubbed (the shape at `path`): X / Y place the reference point, size and turn keep it
 * where it is; `live`: replaces the current undo step.
 */
function transformShape(path: string[], field: ShapeField, value: Expr, live: boolean) {
  const doc = history.current;
  const shape = getIn(doc, path) as Profile;
  const lookup = paramLookup(doc.params);
  const errors = new Map<string, string>();
  const v = resolve(value, lookup, field, errors) as number;
  if (errors.size) return fail(errors.get(field)!);
  const old = resolve(shape, lookup, '', new Map()) as DrawnProfile;
  const [w, h] = sizeOf(old);
  const ref = refOf(shape.id);
  const linkSize = linkedSizes.has(shape.id);
  let next: DrawnProfile;
  const keep: Record<string, Expr> = { [field]: value };
  if (field === 'x' || field === 'y') {
    const at = anchorAt(old, ref);
    at[field === 'x' ? 0 : 1] = v;
    next = placed(old, ref, at);
    if (!centred(old, ref)) delete keep[field]; // the stored centre is not what was typed
  } else if (field === 'rot') next = turnedTo(old, ref, v);
  else {
    const size: [number, number] = field === 'd' ? [v, v] : field === 'w' ? [v, linkSize && w ? (h * v) / w : h] : [linkSize && h ? (w * v) / h : w, v];
    next = sizedTo(old, ref, size);
  }
  const changed = setIn(doc, path, rewrite(shape, old, next, keep));
  if (live) history.replace(changed);
  else history.push(changed);
  update();
}

/** The reference point is the stored centre: X / Y fields then edit the stored expressions. */
const centred = (p: DrawnProfile, ref: [number, number]) => !ref[0] && !ref[1] && p.kind !== 'polygon' && p.kind !== 'line';

/**
 * Pushes or pulls a face live (one undo step): an end face changes its extrusion's depth, a side moves that side of
 * its shape (in the sketch, if linked). Values keep their expressions.
 */
function pullFace(face: PickedFace) {
  const features = built.get(face.body ?? '');
  const pl = bodyPlace(face.body ?? '');
  const hit = features && faceAt(features, unplaced(pl, face.point.toArray()), unplaced(pl, face.normal.clone().negate().toArray(), true));
  if (!hit) return fail('Only faces made by extrusions can be pushed or pulled so far');
  const before = history.current;
  const bi = before.bodies.findIndex((b) => b.features.some((f) => f.id === hit.feature));
  const fi = before.bodies[bi]?.features.findIndex((f) => f.id === hit.feature) ?? -1;
  const feature = before.bodies[bi]?.features[fi];
  if (feature?.type !== 'extrude') return;
  const lookup = paramLookup(before.params);
  const featurePath = ['bodies', String(bi), 'features', String(fi)];
  let apply: (mm: number) => Doc;
  if (hit.kind === 'cap') {
    // the end face changes the depth, the face behind the plane how far it reaches back
    const key = hit.back ? 'back' : 'depth';
    const value = feature[key] ?? len(0);
    const mm0 = resolve(value, lookup, '', new Map()) as number;
    apply = (mm) => setIn(before, [...featurePath, key], plus(value, mm0, mm * hit.rate));
  } else {
    const src = feature.source;
    const k = src.kind === 'sketch' ? before.sketches.findIndex((s) => s.id === src.sketch) : -1;
    const list = src.kind === 'sketch' ? (before.sketches[k]?.shapes ?? []) : src.profiles;
    const j = list.findIndex((q) => q.id === hit.shape);
    if (j < 0) return;
    const path = src.kind === 'sketch' ? ['sketches', String(k), 'shapes', String(j)] : [...featurePath, 'source', 'profiles', String(j)];
    const old = resolve(list[j], lookup, '', new Map()) as DrawnProfile;
    apply = (mm) => setIn(before, path, rewrite(list[j], old, pushed(old, hit.edge, mm * hit.rate)));
  }
  let pushedOnce = false;
  viewer.startFacePull(toolHost, face.normal.clone().negate().toArray(), face.point, (mm, phase) => {
    if (phase === 'cancel') {
      if (pushedOnce) history.undo();
      stopTool();
      update();
      return pickFaceToPull(); // the tool stays on: Esc again stops it
    }
    if (pushedOnce) history.replace(apply(mm));
    else history.push(apply(mm));
    pushedOnce = true;
    update();
    if (phase === 'done') (stopTool(), pickFaceToPull());
  });
  toolMode = 'pull';
  render();
}

/** The extrude tool waiting for a face of an extrusion to push or pull (Esc stops it). */
function pickFaceToPull() {
  toolHint = 'Click a face of an extrusion to push or pull it, an area of a sketch to pull it (Shift-click: pick it and more), or a sketch in the list to pull all its shapes · [Esc] stops';
  extrudePick = true;
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    extrudePick = false;
    // a sketch's area clicked: its areas to pick, that one picked already (as the sketch first, then E)
    if (face?.sketch) return enterSketch(face.sketch.id), void extrudeAreas(false, face.sketch);
    if (face?.body) pullFace(face);
    else render(); // empty space: the tool just ends
  }, false, 'areas');
}

/** Picks areas of the sketch in sketch mode to pull; `all`: all of them picked already, `first`: a click whose area (or shape) is. */
async function extrudeAreas(all = false, first?: { at: MouseEvent; shape?: string }) {
  const s = viewer.sketches.find((v) => v.id === sketching);
  if (!s) return;
  stopTool();
  const areas = await kernel.areas(s.shapes.filter((q) => !q.construction));
  if (!areas.length) return fail('Nothing to extrude yet: draw a shape first');
  viewer.startAreas(toolHost, { sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name: 'the sketch' }, areas, all, first);
  toolMode = 'pull';
  render();
}

/** Sketch mode on a sketch: R / C / P draw flat into it (`kind` starts one); `look` turns the camera to its plane. */
function enterSketch(id: string, kind: ToolKind | null = null, look = false) {
  const s = viewer.sketches.find((v) => v.id === id);
  if (!s) return fail('Show the sketch to draw on it');
  if (sketching !== id) sketchPath = [];
  sketching = id;
  [selected, shapeSel] = [[id], shapeSel];
  if (look) viewer.lookAlong(new Vector3(...s.frame.n));
  viewer.setSketchGrid(s.frame);
  showSelection();
  if (kind) startTool(kind);
}

function exitSketch() {
  sketching = null;
  sketchPath = [];
  solid = new Set();
  SketchTool.dropGuides();
  stopTool();
  viewer.setSketchGrid(null);
  render();
}

/** New sketch: on the face clicked before (on a selected body), else pick a face or empty space (the base plane facing the camera). */
function startNewSketch() {
  if (sketching) exitSketch();
  const placed = viewer.lastTarget();
  if (placed) return newSketch({ sketch: null, ...placed });
  viewer.startTool(null, toolHost, { kind: 'plane' });
  toolMode = 'plane';
  render();
}

/** An empty sketch where the plane was picked, in sketch mode, the camera looking at it. */
function newSketch(t: Target) {
  const doc = history.current;
  const sketch = sketchAt(t, doc.sketches.length);
  commit({ ...doc, sketches: [...doc.sketches, sketch] });
  enterSketch(sketch.id, 'rect', true);
}

/**
 * E: in sketch mode picks areas of the sketch to pull; with a sketch selected pulls its selected shapes (or all);
 * else pulls an extrusion's end face: the face last clicked on the selected body, or one clicked next.
 */
function extrude() {
  if (sketching) return void extrudeAreas();
  if (!activeSketch()) {
    const last = viewer.lastFace;
    if (last?.body && selected.includes(last.body)) return pullFace(last);
    return pickFaceToPull();
  }
  const id = activeSketch();
  const s = viewer.sketches.find((v) => v.id === id);
  if (!s) return fail(id ? 'Show the sketch to extrude it' : 'Select a sketch or some of its shapes to extrude');
  // lines in it: what they enclose are areas, all of them picked to pull
  if (!shapeSel.length && s.shapes.some((q) => q.kind === 'line' && !q.construction)) return enterSketch(s.id), void extrudeAreas(true);
  const target: Target = { sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name: 'its sketch' };
  const ids = (shapeSel.length ? s.shapes.filter((q) => shapeSel.includes(q.id)) : s.shapes).filter((q) => !q.construction && q.kind !== 'line').map((q) => q.id);
  if (!ids.length) return fail('Construction lines and open lines are not extruded: pick other shapes');
  viewer.startPull(toolHost, target, ids);
  toolMode = 'pull';
  render();
}

/** Picks a face; a section lies on it, removing the side towards the camera. */
function newSection() {
  toolHint = 'Click a face (or empty space: the base plane facing you): the new section lies on it and removes what is in front · [Esc] cancels';
  sections.picking(true);
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    sections.picking(false);
    if (!face) return render();
    const doc = history.current;
    const section = {
      id: newId(),
      name: `Section ${doc.sections.length + 1}`,
      origin: face.point.toArray(),
      normal: face.normal.toArray(),
      offset: len(0),
      enabled: true,
    };
    commit({ ...doc, sections: [...doc.sections, section] });
  });
}

/** Autosave writes in place (no history snapshot) a moment after the last change; it needs a file handle. */
function scheduleAutosave(delay = 1500) {
  clearTimeout(autosaveTimer);
  if (!autosave || !file.handle || history.current === file.saved) return;
  autosaveTimer = window.setTimeout(
    () =>
      run(async () => {
        const doc = history.current;
        await saveFile(pack(doc, file.versions), file.name, file.handle);
        file = { ...file, saved: doc };
        notify(`Autosaved ${new Date().toLocaleTimeString()}`);
      }),
    delay,
  );
}

async function toggleAutosave() {
  autosave = !autosave;
  if (autosave && !window.showSaveFilePicker) {
    autosave = false;
    return fail('Autosave needs a Chromium browser');
  }
  if (autosave && !file.handle) await save(); // asks where to save once
  if (!file.handle) autosave = false;
  localStorage.setItem('makermaker.autosave', autosave ? 'on' : 'off');
  scheduleAutosave();
  render();
}

/**
 * Copies the selected bodies and sketches in place and selects the copies; the move fields open at 5, 5, 0 mm (the
 * copies show moved there, the originals as ghosts), to type where the copies go.
 */
function duplicate() {
  const doc = history.current;
  placeCopies(copiesOf(doc.bodies.filter((p) => selected.includes(p.id)), doc.sketches.filter((s) => selected.includes(s.id)), ' copy'), [5, 5, 0]);
}

/**
 * Copies of bodies and sketches with new ids throughout, named with `suffix`; a copied body extruded from a copied
 * sketch is linked to that copy (its shapes and areas too).
 */
function copiesOf(bodies: Body[], sketches: Sketch[], suffix: string) {
  const ids = new Map<string, string>(); // old id → new, for bodies, their features, sketches, their shapes and sub-groups
  const fresh = (id: string) => ids.get(id) ?? ids.set(id, newId()).get(id)!;
  const renamed = (id: string) => ids.get(id) ?? id;
  for (const p of bodies) [p.id, ...p.features.map((f) => f.id)].forEach(fresh);
  const sketchCopies = sketches.map((s): Sketch => ({
    ...structuredClone(s),
    id: fresh(s.id),
    name: `${s.name}${suffix}`,
    plane: 'body' in s.plane ? { ...s.plane, body: renamed(s.plane.body), feature: renamed(s.plane.feature) } : s.plane, // on a copied body's face: on the copy's
    groups: s.groups.map((g) => ({ ...g, id: fresh(g.id), parent: g.parent && fresh(g.parent) })),
    shapes: s.shapes.map((q) => ({ ...structuredClone(q), id: fresh(q.id), group: q.group && fresh(q.group) })),
  }));
  const bodyCopies = bodies.map((p): Body => ({
    ...structuredClone(p),
    id: renamed(p.id),
    name: `${p.name}${suffix}`,
    features: p.features.map((f): Feature => {
      const c = { ...structuredClone(f), id: renamed(f.id) };
      if (c.type === 'boolean') return { ...c, body: renamed(c.body) };
      if (c.type === 'split' && c.cutter.kind === 'shape') return { ...c, cutter: { ...c.cutter, sketch: renamed(c.cutter.sketch), shape: renamed(c.cutter.shape) } };
      if (c.type === 'loft') return { ...c, sections: c.sections.map((q) => ({ sketch: renamed(q.sketch), shape: renamed(q.shape) })) };
      if (c.type !== 'extrude' && c.type !== 'revolve') return c;
      const src = c.source;
      if (src.kind === 'own') return src.plane.kind === 'cap' ? { ...c, source: { ...src, plane: { ...src.plane, feature: renamed(src.plane.feature) } } } : c;
      return { ...c, source: { ...src, sketch: renamed(src.sketch), shapes: src.shapes.map(renamed), areas: src.areas?.map((a) => ({ ...a, in: a.in.map(renamed), out: a.out.map(renamed) })) } };
    }),
  }));
  return { bodies: bodyCopies, sketches: sketchCopies };
}

/** Adds copies (see `copiesOf`), selects them and opens the move fields at `start` (mm), to type where they go. */
function placeCopies({ bodies, sketches }: ReturnType<typeof copiesOf>, start: Vec3) {
  const doc = history.current;
  selected = [...bodies, ...sketches].map((c) => c.id);
  commit({ ...doc, bodies: [...doc.bodies, ...bodies], sketches: [...doc.sketches, ...sketches] });
  if (selected.length) moveAlong(0, true, start);
}

/** Sketch mode's open sub-group: the view fades the rest and shows the way down (when it changed). */
let focused = '';
function syncFocus() {
  const s = history.current.sketches.find((x) => x.id === sketching);
  if (s) sketchPath = sketchPath.filter((id) => s.groups.some((g) => g.id === id)); // sub-groups undone meanwhile
  const doc = history.current;
  const names = s ? sketchPath.map((id) => s.groups.find((g) => g.id === id)?.name ?? '?') : [];
  // the sketch group, then the open sub-groups; each says what it is and how to get back to it
  const crumbs = s
    ? [
        { label: `Sketch: ${s.name}`, title: `${whose(doc, s.id)} · ${names.length ? 'click to go back to it' : 'Esc leaves it'}` },
        ...names.map((name, i) => ({ label: name, title: `Sub-group of ${i ? names[i - 1] : s.name} · ${i < names.length - 1 ? 'click to go back to it' : 'Esc goes up a level'}` })),
      ]
    : [];
  const key = `${sketching} ${sketchPath.join()} ${[...solid].join()} ${crumbs.map((c) => c.title).join('›')}`;
  if (key === focused) return;
  focused = key;
  viewer.setFocus(s ? { sketch: s.id, group: sketchPath.at(-1) ?? null, solid } : null, crumbs, (level) => {
    sketchPath = sketchPath.slice(0, level);
    shapeSel = [];
    showSelection();
  });
}

function render() {
  viewer.el.classList.toggle('picking', !!pending); // objects to pick: crosshair
  syncFocus();
  const info = infoOf();
  const doc = history.current;
  const lookup = paramLookup(doc.params);
  const ctx: UIContext = {
    // a cut being set up: its new chunk is not listed until the cut is kept
    doc: cutting ? { ...doc, bodies: doc.bodies.filter((b) => b.id !== cutting!.chunk) } : doc,
    selected,
    exprErrors,
    kernelErrors: new Map([...kernelErrors, ...linkErrors]),
    title: file.name,
    dirty: doc !== file.saved,
    status,
    busy: [...[...reading].filter(([id]) => doc.bodies.some((b) => b.id === id)).map(([, r]) => `Reading ${r.name}`), ...busy],
    shapes: shapeSel,
    active: pending?.tool ?? (extrudePick || (toolMode === 'pull' && !viewer.activeTool) ? 'extrude' : toolMode === 'plane' ? 'sketch' : viewer.activeTool),
    hint:
      toolHint ??
      (finishSel
        ? `${finishSel.mid ? 'A part of a finish' : 'A whole finish'} · drag it to resize (past 0: the other kind) · [Del] ${finishSel.mid ? 'leaves this edge out' : 'deletes it'} · double-click selects the whole finish`
        : pickedPart?.kind === 'edge'
          ? 'Drag a picked edge up: fillet, down: chamfer · [Alt]-click another edge ([Shift]: more), double right-click: its loop · [Esc] deselect'
          : null),
    autosave,
    notify: fail,
    statusError,
    info,
    minStep: settings.minStep,
    showMeasure: (what) => (what === 'at' ? viewer.showPoint(info?.at ? new Vector3(...info.at) : null) : viewer.showMeasure(what === null ? null : (info?.box ?? null), what ?? 0)),
    solid,
    setSolid(ids, on) {
      solid = new Set(on ? [...solid, ...ids] : [...solid].filter((x) => !ids.includes(x)));
      render();
    },
    paramValue(name) {
      try {
        const q = lookup(name);
        return q.dim === 0 ? fmt(q.v) : q.dim === 1 ? `${fmt(q.v / UNITS[doc.units])} ${doc.units}` : '';
      } catch {
        return '';
      }
    },
    commit,
    setValue(path, value, live = false) {
      const doc = setIn(history.current, path, value);
      const next = follow(history.current, value && typeof value === 'object' && 'e' in value ? finishSize(doc, path, value as Expr) : doc);
      if (live) history.replace(next);
      else history.push(next);
      update();
    },
    shapeRef: refOf,
    linkSize: (id) => linkedSizes.has(id),
    setShapeRef(id, r) {
      shapeRefs.set(id, r);
      showSelection(); // the viewer marks it
    },
    toggleLinkSize(id) {
      if (!linkedSizes.delete(id)) linkedSizes.add(id);
      render();
    },
    measure(path) {
      const shape = getIn(history.current, path) as Profile;
      const p = resolve(shape, lookup, '', new Map()) as DrawnProfile;
      const ref = refOf(shape.id);
      const [x, y] = anchorAt(p, ref);
      const [w, h] = sizeOf(p);
      return { x, y, w, h, centred: centred(p, ref) };
    },
    transformShape,
    setDrawConstruction(on) {
      drawConstruction = on;
    },
    folded,
    hideAll,
    toggleHideAll(list) {
      hideAll[list] = !hideAll[list];
      update();
    },
    toggleFold(id) {
      if (!folded.delete(id)) folded.add(id);
      render();
    },
    moveInto: (ids, group) => commit(movedInto(history.current, ids, group)),
    groupTool,
    moveTool: () => moveAlong(0, true),
    cutTool,
    revolveTool,
    rotateTool,
    jointTool,
    editJoint: (id) => jointPanel(id, false),
    reach(path, insert) {
      const measure = measureAt(path);
      if (!measure) return false;
      viewer.aiming = (a) => tips.cursorTip([a?.what, 'To object: click, its value goes into the field'].filter(Boolean).join('\n'));
      viewer.aiming(viewer.aimHere());
      viewer.pickFace((face) => {
        viewer.aiming = null;
        viewer.aimAt(null);
        tips.cursorTip(null);
        if (face?.snap) insert(fmt(measure(face.snap) / UNITS[history.current.units]));
      }, true);
      return true;
    },
    jointRange: rangeText,
    showJoint(id) {
      const j = history.current.joints.find((x) => x.id === id);
      if (j) viewer.select(contents(history.current, j.children));
      else showSelection();
    },
    loftTool,
    groupSelected: selected.some((id) => doc.groups.some((g) => g.id === id)),
    arrange,
    select,
    isolated: isolated?.body ?? null,
    isolate,
    previewColor: (id, color) => viewer.previewColor(id, color),
    startTool,
    extrude,
    sketching,
    newSketch: startNewSketch,
    editSketch(id) {
      const pulling = extrudePick; // Extrude first: the sketch gets pulled instead
      const picked = picks(id); // a waiting tool takes it
      select(id);
      if (!pulling && !picked) enterSketch(id, null, true);
    },
    exitSketch,
    stopTool: () => (stopTool(), render()),
    align: alignShapes,
    boolean: applyBoolean,
    pickShape,
    pickShapes(sketch, ids, how) {
      if (activeSketch() !== sketch) [selected, shapeSel] = [[sketch], []];
      shapeSel = how === true ? (ids.every((id) => shapeSel.includes(id)) ? shapeSel.filter((id) => !ids.includes(id)) : [...new Set([...shapeSel, ...ids])]) : ids;
      showSelection();
    },
    lookAt(sketch) {
      const s = viewer.sketches.find((v) => v.id === sketch);
      if (s) viewer.lookAlong(new Vector3(...s.frame.n));
    },
    toggleAutosave: () => run(toggleAutosave),
    importFile: pickImport,
    exportPrint: () => run(() => exportBodies('stl')),
    exportLaser: () => run(() => exportBodies('svg')),
    toggleTheme() {
      const theme = viewer.isDark ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('makermaker.theme', theme);
      viewer.applyTheme();
    },
    renders: {
      open: rendersOpen,
      jobs,
      toggle() {
        rendersOpen = !rendersOpen;
        render();
      },
      shoot: () => run(shoot),
      again(id) {
        jobs.set(id, { state: 'waiting', done: 0, again: true });
        render();
        run(renderQueue);
      },
      cancel(id) {
        const job = jobs.get(id);
        if (job?.state === 'waiting') Object.assign(job, { state: 'failed', error: 'Cancelled' });
        else if (job) job.cancel = true;
        render();
      },
      download: downloadRender,
      useView(id) {
        const shot = history.current.renders.find((r) => r.id === id);
        if (shot) viewer.setCameraState(shot.camera);
      },
    },
    renderImage: () => run(snapshot),
    openSettings: () =>
      openSettings(
        settings,
        (next) => {
          settings = next;
          applySettings();
        },
        { units: () => history.current.units, setUnits: (units) => commit({ ...history.current, units }) },
      ),
    duplicate: () => (shapeSel.length ? duplicateShapes() : selected.length ? duplicate() : pickFor('duplicate', duplicate)),
    remove,
    newDoc() {
      load({ schema: 13, units: history.current.units, params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], renders: [] }, { name: `untitled${EXTENSION}`, versions: [] });
    },
    open: () => run(openDesign),
    save: () => run(save),
    undo: () => undo(),
    redo: () => undo(true),
  };
  renderUI(ctx);
  renderJoints();
}

/**
 * Exports one file per selected body (else per shown body), several as one ZIP; tool bodies are left out (their cuts
 * and joins are in their owners). stl: for 3D print, placed as in the world; svg: for the laser, the outline of the
 * body's biggest flat face at 1:1 without fillets and chamfers.
 */
async function exportBodies(format: 'stl' | 'svg') {
  const doc = history.current;
  const tools = new Set(ownersOf(doc).keys());
  const chosen = contents(doc, selected).filter((id) => doc.bodies.some((b) => b.id === id));
  const bodies = doc.bodies.filter((b) => (chosen.length ? chosen.includes(b.id) : b.visible) && !tools.has(b.id) && built.has(b.id));
  if (!bodies.length) return fail('Nothing to export: select bodies that build (tool bodies are part of their owner)');
  const taken = new Map<string, number>();
  const nameOf = (b: Body) => {
    const base = b.name.replace(/[^\w.-]+/g, '_') || 'body';
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  };
  const { files, failed } = await kernel.export(format, bodies.map((b) => ({ name: nameOf(b), features: built.get(b.id)!, place: bodyPlace(b.id) })));
  const type = format === 'stl' ? 'model/stl' : 'image/svg+xml';
  if (files.length === 1) download(new Blob([files[0].data], { type }), `${files[0].name}.${format}`);
  else if (files.length) download(new Blob([zipSync(Object.fromEntries(files.map((f) => [`${f.name}.${format}`, new Uint8Array(f.data)])))]), `${project()}_${format}.zip`);
  notify(`Exported ${files.length} ${format.toUpperCase()} file${files.length === 1 ? '' : 's'}${failed.length ? `; could not make: ${failed.join(', ')}` : ''}`, failed.length > 0);
}

/** The right column shows the renders. */
let rendersOpen = false;
/** Renders of this session by shot id: waiting, rendering (the canvas it grows on), done (the picture) or failed. */
const jobs = new Map<string, RenderJob>();
let queueRunning = false;

/** A blob as a data URL. */
const dataUrl = (blob: Blob) =>
  new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.readAsDataURL(blob);
  });

/**
 * A new render of the view as it is: its camera and the background of the settings are saved with it (so it can be
 * rendered again with newer model data), and a small picture taken at once. Returns its id.
 */
async function newShot(results: RenderShot['results'] = []) {
  const shot: RenderShot = { id: newId(), at: new Date().toISOString(), camera: viewer.cameraState(), background: viewer.backdropColours(), thumbnail: await dataUrl(await viewer.thumbnail()), results };
  const doc = history.current;
  commit({ ...doc, renders: [shot, ...doc.renders] });
  return shot.id;
}

/** Render nice: a new render of the view, queued. */
async function shoot() {
  jobs.set(await newShot(), { state: 'waiting', done: 0 });
  render();
  await renderQueue();
}

/** Snapshot: downloads the view as a PNG and keeps it in the renders (without opening them), ready to be rendered nicely. */
async function snapshot() {
  busy.add('Snapshot');
  render();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); // the bar shows before the work blocks
  try {
    const image = await viewer.snapshot(2);
    download(image, `${project()}_snapshot.png`);
    await newShot([{ at: new Date().toISOString(), preview: await previewOf(image, 320, 'image/png'), nice: false }]);
  } finally {
    busy.delete('Snapshot');
    render();
  }
}

/** Renders the waiting shots one after another, oldest first; slower while the renders panel is closed. */
async function renderQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const shot = [...history.current.renders].reverse().find((r) => jobs.get(r.id)?.state === 'waiting');
      if (!shot) break;
      const job = jobs.get(shot.id)!;
      job.state = 'rendering';
      render();
      let shown = -1;
      try {
        const image = await viewer.renderNice(shot.camera, shot.background, 256, {
          show: (canvas) => ((job.canvas = canvas), render()),
          progress(done) {
            job.done = done;
            if (Math.floor(done * 100) !== shown) (shown = Math.floor(done * 100)), render();
          },
          cancelled: () => !!job.cancel || !history.current.renders.some((r) => r.id === shot.id),
          slow: () => !rendersOpen,
        });
        Object.assign(job, { state: 'done', image, url: URL.createObjectURL(image) });
        // a small copy goes into the document, so the result outlives the session (no undo step of its own)
        const preview = await previewOf(image);
        const doc = history.current;
        const i = doc.renders.findIndex((r) => r.id === shot.id);
        if (i >= 0) history.replace(setIn(doc, ['renders', String(i), 'results'], [{ at: new Date().toISOString(), preview, nice: true }, ...doc.renders[i].results].slice(0, 8)));
        if (job.again) downloadRender(shot.id);
      } catch (err) {
        Object.assign(job, { state: 'failed', error: (err as Error).message });
      }
      job.canvas = undefined;
      render();
    }
  } finally {
    queueRunning = false;
  }
}

/** Saves a finished render of this session as `<file>_render_<n>.png` (n counts from the oldest render). */
function downloadRender(id: string) {
  const image = jobs.get(id)?.image;
  const n = history.current.renders.length - history.current.renders.findIndex((r) => r.id === id);
  if (image) download(image, `${project()}_render_${n}.png`);
}

/** A small data URL of a picture, `width` px wide (JPEG; PNG keeps transparency). */
async function previewOf(image: Blob, width = 320, type = 'image/jpeg') {
  const bitmap = await createImageBitmap(image);
  const canvas = Object.assign(document.createElement('canvas'), { width, height: Math.round((bitmap.height * width) / bitmap.width) });
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(type, 0.8);
}

/**
 * Imports an OBJ or STL file's triangles as a mesh body at the origin (it stays a mesh). They have no unit: `unit` is
 * the guess, and a dialog lets it be changed while the body shows at that size.
 */
function importMesh(name: string, { vertices, triangles }: { vertices: Float32Array; triangles: Uint32Array }, unit: Unit = 'mm') {
  const doc = history.current;
  const mesh: Feature = { id: newId(), type: 'mesh', source: name, vertices: toBase64(vertices), triangles: toBase64(triangles), scale: ex(fmt(UNITS[unit])) };
  const body = { ...newBody(doc.bodies.length, [mesh]), name: name.replace(/\.[^.]*$/, '') };
  [selected, shapeSel] = [[body.id], []];
  commit({ ...doc, bodies: [...doc.bodies, body] });
  notify(`Imported ${name}: ${triangles.length / 3} triangles`);
  meshUnits(body.id, extents(vertices), unit);
}

/**
 * The size of an imported mesh (its file has no unit): a small dialog with the units (its numbers are mm, cm …) and
 * its size along X, Y and Z: typing one scales it so, the others follow. The body shows at each size as it is set (the
 * import's undo step, rewritten). ✓, Enter or Esc closes it.
 */
function meshUnits(body: string, size: Vec3, unit: Unit) {
  const box = Object.assign(document.createElement('div'), { className: 'mesh-units' });
  const buttons = (['mm', 'cm', 'm', 'in'] as Unit[]).map((u) => Object.assign(document.createElement('button'), { textContent: u, onclick: () => scaleTo(UNITS[u]) }));
  const fields = size.map((_, k) => Object.assign(document.createElement('input'), { className: 'number', spellcheck: false, title: `Its size along ${'XYZ'[k]} (the others follow)` }));
  fields.forEach((f, k) => (f.oninput = () => {
    const mm = length(f.value);
    if (mm && mm > 0 && size[k] > 0) scaleTo(mm / size[k], k);
  }));
  const close = () => (box.remove(), removeEventListener('keydown', keys, { capture: true }));
  const keys = (e: KeyboardEvent) => (pressed(e, 'confirm') || pressed(e, 'cancel')) && (e.stopImmediatePropagation(), e.preventDefault(), close());
  /** Scales the body by `s` (mm per file unit); the sizes show, but not in the field typed into (`typed`). */
  const scaleTo = (s: number, typed?: number) => {
    const doc = history.current;
    const i = doc.bodies.findIndex((b) => b.id === body);
    if (i < 0) return close();
    history.replace(setIn(doc, ['bodies', String(i), 'features', '0', 'scale'], ex(fmt(s))));
    update();
    buttons.forEach((b) => b.classList.toggle('on', Math.abs(UNITS[b.textContent as Unit] - s) < 1e-9));
    fields.forEach((f, k) => k !== typed && (f.value = fmt((size[k] * s) / UNITS[history.current.units])));
  };
  const axis = (k: number) => Object.assign(document.createElement('span'), { className: `axis-${'xyz'[k]}`, textContent: 'XYZ'[k] });
  const text = (t: string) => Object.assign(document.createElement('span'), { textContent: t });
  box.append(text('The file has no unit. Its numbers are'), ...buttons, text('or its size'), ...fields.flatMap((f, k) => [axis(k), f]), Object.assign(document.createElement('button'), { className: 'done', textContent: '✓', title: 'Done (Enter)', onclick: close }));
  scaleTo(UNITS[unit]);
  document.body.append(box);
  addEventListener('keydown', keys, { capture: true });
}

/** Imports a STEP file as a solid body at the origin (in mm, as the file says); the kernel reads it. */
function importStep(name: string, data: string) {
  const doc = history.current;
  const step: Feature = { id: newId(), type: 'step', source: name, data };
  const body = { ...newBody(doc.bodies.length, [step]), name: name.replace(/\.[^.]*$/, '') };
  [selected, shapeSel] = [[body.id], []];
  commit({ ...doc, bodies: [...doc.bodies, body] });
}

const IMPORTS = ['.step', '.stp', '.stl', '.obj'];

/** Imports a STEP, STL or OBJ file by its extension; false: not one of those. */
function importFile(f: File) {
  const ext = f.name.toLowerCase().match(/\.[^.]*$/)?.[0] ?? '';
  if (!IMPORTS.includes(ext)) return false;
  run(async () => {
    if (ext === '.stl') return importMesh(f.name, parseStl(await f.arrayBuffer()));
    if (ext !== '.obj') return importStep(f.name, await f.text());
    const text = await f.text();
    const kind = objKind(text);
    importMesh(f.name, parseObj(text, kind.zUp), kind.unit);
  });
  return true;
}

/** Asks for a file to import. */
function pickImport() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: IMPORTS.join(',') });
  input.onchange = () => input.files?.[0] && importFile(input.files[0]);
  input.click();
}

/** The open file's name without its extension. */
const project = () => file.name.replace(/\.[^.]*$/, '');

/** Saves `blob` as a download named `name`. */
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A note in the top bar (`error`: something was refused or failed, shown in red). */
function notify(message: string, error = false) {
  status = message;
  statusError = error;
  render();
}

const fail = (message: string) => notify(message, true);

async function run(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (err) {
    fail((err as Error).message);
  }
}

function load(doc: Doc, f: Omit<typeof file, 'saved'>) {
  history.reset(doc);
  file = { ...f, saved: doc };
  selected = [];
  status = '';
  sketching = null;
  isolated = null;
  stopTool();
  viewer.setSketchGrid(null);
  viewer.fitNext();
  update();
}

function loadFile({ name, bytes, handle }: OpenedFile) {
  const { doc, versions } = unpack(bytes);
  load(doc, { name, handle, versions });
}

async function openDesign() {
  const f = await openFile();
  if (f) loadFile(f);
}

function undo(redo = false) {
  if (redo ? history.redo() : history.undo()) update();
}

async function save() {
  const doc = history.current;
  const versions = addVersion(file.versions, doc);
  const saved = await saveFile(pack(doc, versions), file.name, file.handle);
  if (!saved) return;
  file = { ...saved, versions, saved: doc };
  notify(`Saved ${new Date().toLocaleTimeString()}`);
}

const TOOL_KEYS: [Action, ToolKind][] = [
  ['rect', 'rect'],
  ['circle', 'circle'],
  ['ngon', 'ngon'],
  ['polygon', 'polygon'],
  ['line', 'line'],
  ['sphere', 'sphere'],
];
/** Arrow actions and their screen direction. */
const NUDGES: [Action, [number, number]][] = [
  ['nudgeLeft', [-1, 0]],
  ['nudgeRight', [1, 0]],
  ['nudgeUp', [0, 1]],
  ['nudgeDown', [0, -1]],
];

// app shortcuts (their keys: KEYS in ui/keys); tools, moves and picks in the 3D view see keys first
addEventListener('keydown', (e) => {
  const tool = TOOL_KEYS.find(([a]) => pressed(e, a))?.[1];
  const arrow = NUDGES.find(([a]) => pressed(e, a))?.[1];
  const axis = (['moveX', 'moveY', 'moveZ'] as const).findIndex((a) => pressed(e, a));
  if (pressed(e, 'save')) run(save);
  else if (pressed(e, 'open')) run(openDesign);
  else if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  else if (pending && pressed(e, 'confirm')) pending.apply?.();
  else if (pending && pressed(e, 'cancel')) cancelPending(), render();
  else if (pressed(e, 'undo')) undo();
  else if (pressed(e, 'redo')) undo(true);
  else if (pressed(e, 'fit')) viewer.fit();
  else if (pressed(e, 'home')) viewer.home();
  else if (tool) startTool(tool);
  else if (pressed(e, 'construction')) toggleConstruction();
  else if (pressed(e, 'extrude')) extrude();
  else if (pressed(e, 'revolve')) revolveTool();
  else if (pressed(e, 'rotate')) rotateTool();
  else if (pressed(e, 'joint')) jointTool();
  else if (pressed(e, 'loft')) loftTool();
  else if (pressed(e, 'sketch')) startNewSketch();
  else if (sketching && pressed(e, 'deselect')) sketchPath.length ? ((sketchPath = sketchPath.slice(0, -1)), (shapeSel = []), showSelection()) : exitSketch(); // up one sub-group, else out
  else if (pressed(e, 'cycle')) viewer.cycle(1);
  else if (pressed(e, 'cycleBack')) viewer.cycle(-1);
  else if (axis >= 0) (e.preventDefault(), moveAlong(axis)); // the key is not typed into the field
  else if (pressed(e, 'move')) (e.preventDefault(), moveAlong(0, true));
  // arrows: 1 mm, Shift 10, Ctrl the minimum step
  else if (shapeSel.length && arrow) nudgeShapes(viewer.screenDir(...arrow), e.ctrlKey ? settings.minStep : e.shiftKey ? 10 : 1);
  // nudges along the world axis nearest to the arrow's screen direction
  else if (selected.length && arrow) nudge(viewer.screenAxis(...arrow).multiplyScalar(e.ctrlKey ? settings.minStep : e.shiftKey ? 10 : 1).toArray());
  else if (pressed(e, 'selectAll')) selectAll();
  // nothing selected: the next click picks what it acts on
  else if (pressed(e, 'toggleVisible')) selected.length ? toggleVisible() : pickFor('hide', toggleVisible);
  else if (pressed(e, 'delete')) remove();
  else if (selected.length && pressed(e, 'deselect')) select(null);
  else if (pressed(e, 'duplicate')) shapeSel.length ? duplicateShapes() : selected.length ? duplicate() : pickFor('duplicate', duplicate);
  else if (pressed(e, 'copy')) copy(false);
  else if (pressed(e, 'cut')) copy(true);
  else if (pressed(e, 'paste')) paste();
  else if (pressed(e, 'ungroup')) sketching && shapeSel.length ? groupShapes(true) : ungroup();
  else if (pressed(e, 'group')) sketching && shapeSel.length ? groupShapes() : groupTool();
  else return;
  e.preventDefault();
});

addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const item = e.dataTransfer?.items[0];
  if (!item) return;
  // DataTransfer items are only readable during the event, so request both now.
  const pending = item.getAsFileSystemHandle?.();
  const f = item.getAsFile();
  // a STEP, STL or OBJ file is imported into the design
  if (f && importFile(f)) return;
  run(async () => {
    const handle = await pending;
    if (handle instanceof FileSystemFileHandle) loadFile(await readHandle(handle));
    else if (f) loadFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  });
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

update();
