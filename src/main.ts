import { zipSync } from 'fflate';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import './style.css';
import { evalLength, evalQuantity, fmt, inName, isPlain, UNITS } from './doc/expr';
import { followSizes, sideNow, sized } from './doc/sizes';
import { toBuild } from './doc/expand';
import { add, BASE, capFrame, cross, cutPlane, dot, extent, frames, moved, norm, placed as inWorld, placeFrame, scale, sub, toWorld, unplaced, type Frame, type Place, type V3 } from './doc/frames';
import { History } from './doc/history';
import { alignment, area, beside, bounds, centre, bakeTurn, closedLoop, curved, flattened, grown, mapPoints, offsetPath, type Align } from './doc/profiles';
import { pieces } from './doc/arrangement';
import { fitting, THREADS, type ThreadSize } from './doc/threads';
import { closeButton, icon } from './ui/icons';
import { axisHtml } from './ui/axes';
import { jointed } from './doc/joints';
import { workFrame } from './doc/workplane';
import type { Lookup } from './doc/expr';
import { getIn, paramLookup, resolve, setIn, UNITLESS, type Resolved } from './doc/resolve';
import { readStep, stepObjects } from './io/step';
import { changeLook, dropMaterial, effectiveLight, lookOf, newMaterialFor, plainLook, setLook } from './doc/materials';
import { dropPhoto, keepPhoto, loadPhotos } from './ui/photolibrary';
import { fromMtlx, toMtlx } from './io/materials';
import { openMaterials } from './ui/materials';
import { ex, newId, sampleDoc, unturned } from './doc/sample';
import { faceAt, pushed, sideFrame } from './doc/pull';
import { carrierOf, contents, onFaceOf, ownersOf, rank, sourceSketch, tree, unlinkedFrom, whose, within } from './doc/groups';
import { chainOf, unitAt } from './doc/shapegroups';
import type { CoatFeature } from './doc/types';
import type { Area, Body, BulgeFeature, DraftFeature, FingersFeature, ImageRef, Joint, Material, PhotoSphere, WorkPlane, BooleanOp, Curve, Doc, Expr, ExtrudeSource, Feature, Group, Profile, SideSize, RenderShot, Sketch, SketchPlacement, SplitFeature, Unit } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, versionDate, type Version } from './io/design';
import { pairKey, type ClashAsk, type ClashHit } from './kernel/clash';
import type { MeasureAsk, SolidMeasure } from './kernel/measure';
import { extents, meshBody, objKind, parse3mf, parseGlb, parseObj, parseStl, toBase64, type MeshPart } from './io/mesh';
import { dxfShapes, svgShapes, type Shape2 } from './io/vector';
import { coatAsBody, describe as describeCommands, runCommand, shared, type Args } from './api/commands';
import type { AreaMesh, BuildFeature } from './kernel/build';
import { Kernel } from './kernel/client';
import type { ExportBody, ExportFormat, PrintCheck } from './kernel/worker';
import { COPY_TIP, measureButton, renderUI, scrub, toObjectButton, wantsT, type Measure, type ObjectAlign, type Pick, type RenderJob, type ShapeField, type UIContext } from './ui/panels';
import { sectionControls } from './ui/sections';
import { loadSettings, openSettings } from './ui/settings';
import { pythonTerminal } from './ui/terminal';
import { MAC, pressed, role, roleKeyName, type Action, comboText, keysOf } from './ui/keys';
import { caret, installCompletion } from './ui/complete';
import { installTooltips } from './ui/tooltip';
import { drawer } from './ui/drawer';
import { keepInside } from './ui/inside';
import { BUILT_IN_PHOTOS } from './ui/photospheres';
import { ANGLE_STEPS, SketchTool, uvOf, type Cap, type Drawn, type DrawnProfile, type SketchResult, type Target, type ToolHost, type ToolKind, type ViewSketch } from './viewer/sketch';
import { anchorAt, moved as shifted, placed, rotated, sizedTo, sizeOf, turnedTo } from './viewer/shapes';
import type { ExtrudeTool, FaceItem } from './viewer/extrude';
import { alongEdge, Viewer, type FinishPick, type PartRef, type PickedFace, type PickedPart, type TurnAxis, type Vec3 } from './viewer/viewer';

// over the 3D view, the pointer's note stays inside it
const tips = installTooltips(500, () => document.getElementById('viewport')!.getBoundingClientRect(), (text) => {
  if (text === pointerNote) return;
  pointerNote = text;
  showNote();
});
/** Other keys for what the pointer is on now (from the pointer's note), shown with the tool's note in the top bar. */
let pointerNote: string | null = null;
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
/** By body and finish: how many picked edges its last build could not find. */
const lostEdges = new Map<string, Record<string, number>>();
const savedTheme = localStorage.getItem('makermaker.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
const history = new History<Doc>(sampleDoc(), 200, followSizes);
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
  if (k === 'planes' && at === 'offset') {
    const w = doc.planes[+i];
    return (p) => p.clone().sub(new Vector3(...w.o)).dot(new Vector3(...w.n));
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
/** What a click on the top bar's message does (null: nothing). */
let statusAction: (() => void) | null = null;
/** An unsaved design offers once to be saved with autosave on, after this many undo steps. */
const OFFER_AFTER = 10;
let offered = false;
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
/** The extrude tool while it runs (picking faces and sketch areas, or pulling them). */
let extruding: ExtrudeTool | null = null;
/** Counts tool starts: an extrude tool still loading its areas sees whether another tool started meanwhile. */
let extrudeRun = 0;
/** A tool picked before its objects: its toolbar name, and what clicking a body does (Enter applies booleans). */
let pending: { tool: 'boolean' | 'delete' | 'duplicate' | 'hide' | 'group' | 'move' | 'cut' | 'joint' | 'shell'; pick(id: string, how: Pick): void; apply?(): void } | null = null;
/** On only for a design saved to a file (a new one starts with it off; an opened one as last switched). */
let autosave = false;
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

/** What was picked in the 3D view shows in the left column: its groups open, its row scrolled to, smoothly. */
function revealInList(id: string | null) {
  const doc = history.current;
  const object = id ? (doc.bodies.find((b) => b.id === id) ?? doc.sketches.find((x) => x.id === id)) : undefined;
  if (!object) return;
  for (let g = doc.groups.find((x) => x.id === object.group); g; g = doc.groups.find((x) => x.id === g!.parent)) folded.delete(g.id);
  render();
  document.querySelector(`#left [data-id="${CSS.escape(id!)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const viewer = new Viewer(document.getElementById('viewport')!, {
  select(id, add) {
    select(id, add);
    if (id && selected.includes(id)) revealInList(id);
  },
  placeImage(id, o, width) {
    const i = history.current.images.findIndex((im) => im.id === id);
    if (i < 0) return;
    const im = history.current.images[i];
    commit(setIn(history.current, ['images', String(i)], { ...im, width: width ?? im.width, frame: { ...im.frame, o } }));
  },
  move: place,
  pickShape,
  setShapes,
  length,
  number,
  askSolids: (asks) => kernel.measure(asks),
  meshOnly: (body) => meshOnly(body),
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
  dragFinish,
  dragEdges(body, edges) {
    const before = history.current;
    const i = stepsOf(before, body);
    if (i < 0) return;
    // the edges in body coordinates (the finish runs there), as polylines
    const pl = bodyPlace(body);
    const pts = edges.map((segs) => [segs[0][0], ...segs.map((s) => s[1])].map((v) => unplaced(pl, v.toArray()).map((x) => +x.toFixed(4)) as [number, number, number]));
    const normals = edges.map((segs) => {
      const [a, b] = segs[segs.length >> 1];
      return viewer.facesAt(body, a.clone().lerp(b, 0.5)).map((n) => unplaced(pl, n.toArray(), true).map((x) => +x.toFixed(4)) as [number, number, number]);
    });
    const id = newId();
    // sizes stop at the largest the kernel found to fit (learnt while dragging)
    const apply = (mm: number) =>
      setIn(before, ['bodies', String(i), 'features'], [...before.bodies[i].features, { id, type: 'finish', mode: mm >= 0 ? 'fillet' : 'chamfer', size: len(Math.max(Math.abs(clamped(id, mm)), 0.1)), edges: { pts, normals }, enabled: true, baked: false, skip: [] } satisfies Feature]);
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
        label: (mm, typed) => `${mm >= 0 ? 'Fillet' : 'Chamfer'} ${typed === undefined ? Math.abs(mm).toFixed(2) : caret(typed)}`,
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
// what lies under the pointer lights its row in the list (orange) for the moment
viewer.onHover = (id) => {
  for (const el of document.querySelectorAll('#left .item.hot')) el.classList.remove('hot');
  if (id) document.querySelector(`#left .item[data-id="${CSS.escape(id)}"]`)?.classList.add('hot');
  if (pending) viewer.lightBodies(id && picks(id) ? [id] : []); // a waiting tool: what a click takes
};

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
  viewer.setLight(effectiveLight(settings.light));
}
applySettings();

const kernel = new Kernel((results, done) => {
  viewer.holdFit(!done);
  const here = new Set(history.current.bodies.map((p) => p.id));
  for (const r of results) {
    for (const id of reading.get(r.id)?.steps ?? []) readSteps.add(id);
    reading.delete(r.id);
    if (!here.has(r.id)) continue; // deleted while it was built
    if ('mesh' in r) {
      kernelErrors.delete(r.id);
      lostEdges.set(r.id, r.mesh.lostEdges);
      viewer.setBody(r.id, r.mesh);
    } else {
      kernelErrors.set(r.id, r); // the viewer keeps the last valid geometry
      if (r.max) clampFinish(r.id, r.featureId, r.max);
    }
  }
  if (done) viewer.holdFit(false);
  render();
});

kernel.setTolerance(settings.meshDetail);

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
    // a linked copy: its source's steps (errors shown at the source), then its own
    const k = p.link ? doc.bodies.findIndex((b) => b.id === p.link) : -1;
    const shared = k >= 0 ? resolve(doc.bodies[k].features, lookup, `bodies.${k}.features`, exprErrors) : [];
    const resolved = [...shared, ...resolve(p.features, lookup, `bodies.${i}.features`, exprErrors)];
    return exprErrors.size === before ? [{ id: p.id, resolved, at: bodyPlace(p.id) }] : [];
  });
  viewer.placed();
  const resolvedOf = new Map(pending.map((b) => [b.id, b.resolved]));
  // joints still playing stay where they are in their motion (another one stopping saves and redraws everything)
  if (playing.size) placeJoints(playingValues());
  // work planes: moved along their normal by their offset; shown green (a rectangle around what they cover), drawing tools take them
  const workRects = new Map<string, [number, number, number, number]>();
  const workFrames = new Map(
    doc.planes.map((w, i) => {
      const num = (v: number) => (Number.isFinite(v) ? v : 0);
      const [d, t] = [resolve(w.offset, lookup, `planes.${i}.offset`, exprErrors), resolve(w.turn, lookup, `planes.${i}.turn`, exprErrors)].map(num);
      const points = w.points.map((p, k) => resolve(p, lookup, `planes.${i}.points.${k}`, exprErrors).map(num) as V3);
      const frame = workFrame({ o: w.o, x: w.x, y: w.y, n: w.n }, d, t, w.axis, points);
      // along an edge, before its point: a square on the edge
      const [a, b] = w.mode === 'edge' && !points.length && w.hull.length === 2 ? w.hull : [];
      const square = a && b ? [1, -1].map((k) => add(scale(add(a, b), 0.5), scale(frame.y, (k * Math.hypot(...sub(b, a))) / 2))) : [];
      workRects.set(w.id, planeRect(frame, [...w.hull, ...square, ...points], doc.units, w.rect && { rect: w.rect, keep: points }));
      return [w.id, frame] as const;
    }),
  );
  viewer.setWorkPlanes(doc.planes.filter((w) => w.visible).map((w) => ({ id: w.id, name: w.name, frame: workFrames.get(w.id)!, rect: workRects.get(w.id)!, selected: selected.includes(w.id) })));
  showImages();
  /** A placement's frame in the world; undefined while its body is not built (or its face is gone). */
  const worldFrame = (p: Resolved<SketchPlacement>): Frame | undefined => {
    if (p.kind === 'base') return { ...BASE[p.axis], o: scale(BASE[p.axis].n, p.offset) };
    if (p.kind === 'plane') return { o: p.o, x: p.x, y: p.y, n: p.n };
    if (p.kind === 'work') return workFrames.get(p.plane);
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
      // a face of this body: in its coordinates; any other face or plane: in those of its group (moved by its joint),
      // so the body still moves away from it freely by its own position and turn
      const faceOf = (p: Exclude<Resolved<SketchPlacement>, { kind: 'base' }>) => {
        const f = worldFrame(p);
        return f && placeFrame((p.kind === 'cap' || p.kind === 'side') && p.body === id ? at : toPlace(parentPlace(id)), f, true);
      };
      const built = new Map<string, BuildFeature>();
      for (const s of resolved) {
        if (s.type === 'boolean' || s.type === 'fingers' || s.type === 'mesh') continue; // meshes are shown as they are; booleans and box joints take other bodies (below)
        const b = toBuild(s, id, sketches, faceOf, cutterFrame);
        if (b === null) return true; // wait for the other body
        if (typeof b === 'string') return (progress = true), linkErrors.set(id, { featureId: s.id, error: `Cannot build: ${b}` }), false;
        built.set(s.id, b);
      }
      progress = true;
      own.set(id, built);
      const list = [...built.values()].filter((f) => f.type !== 'boolean' && f.type !== 'fingers');
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
  // `bare`: without its box joints (what a box joint with it takes: they would need each other)
  const fullOf = (id: string, path: string[] = [], bare = false): BuildFeature[] | string => {
    const done = full.get(bare ? `${id} bare` : id);
    if (done) return done;
    if (path.includes(id)) return 'bodies cut or join each other in a circle';
    const parts = own.get(id);
    if (!parts) return 'its tool body cannot be built';
    const out: BuildFeature[] = [];
    for (const s of resolvedOf.get(id)!) {
      if (s.type === 'mesh' || (bare && s.type === 'fingers')) continue;
      if (s.type === 'fingers') {
        // the other body as it sits by this one; the first's count and width count for both
        if (!doc.bodies.some((b) => b.id === s.body)) continue; // its partner was deleted
        const other = fullOf(s.body, [...path, id], true);
        if (typeof other === 'string') return other;
        const lead = s.first ? s : (resolvedOf.get(s.body)?.find((f) => f.type === 'fingers' && f.body === id) as typeof s | undefined) ?? s;
        const relative = (bodyPlaces.get(id) ?? new Matrix4()).clone().invert().multiply(bodyPlaces.get(s.body) ?? new Matrix4());
        const from = lead.from && (new Vector3(...lead.from).applyMatrix4((bodyPlaces.get(id) ?? new Matrix4()).clone().invert()).toArray() as V3);
        out.push({ id: s.id, type: 'fingers', features: other, place: toPlace(relative), count: Math.max(1, lead.count), width: Math.max(0, lead.width), ...(from ? { from } : {}), first: s.first });
        continue;
      }
      if (s.type !== 'boolean') {
        out.push(parts.get(s.id)!);
        continue;
      }
      if (!doc.bodies.some((b) => b.id === s.body)) return 'its tool body was deleted';
      if (resolvedOf.get(s.body)?.some((f) => f.type === 'mesh')) return 'a mesh body cannot be a tool body yet';
      const tool = fullOf(s.body, [...path, id]);
      if (typeof tool === 'string') return tool;
      // as the tool sits by the body it belongs to (a linked copy: by its source, so the copy is cut the same)
      const owner = doc.bodies.find((b) => b.id === id)?.link ?? id;
      const relative = (bodyPlaces.get(owner) ?? new Matrix4()).clone().invert().multiply(bodyPlaces.get(s.body) ?? new Matrix4());
      const grow = s.grow ? { grow: s.grow } : {};
      const joint = s.along ? doc.joints.find((j) => j.id === s.along) : undefined;
      const way = joint && jointWay(doc, joint);
      if (way) {
        // from the joint's start, in this body's coordinates; a body that moves itself sees the tool go the other way round
        const home = way.from.get(owner) ?? new Matrix4();
        const moves = !home.equals(way.to.get(owner) ?? home);
        const back = home.clone().invert();
        const dir = new Vector3(...way.sweep.dir).transformDirection(back).multiplyScalar(moves ? -1 : 1).toArray();
        const sweep = { ...way.sweep, at: new Vector3(...way.sweep.at).applyMatrix4(back).toArray(), dir };
        out.push({ id: s.id, type: 'boolean', op: s.op, features: tool, place: toPlace(back.multiply(way.from.get(s.body) ?? new Matrix4())), ...grow, sweep });
      } else out.push({ id: s.id, type: 'boolean', op: s.op, features: tool, place: toPlace(relative), ...grow });
    }
    full.set(bare ? `${id} bare` : id, out);
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
    // (a carried sketch off a base plane lies in its carrier's group's coordinates, as the carrier's extrusion does)
    const carried = (c: string, f: Frame) => placeFrame(bodyPlace(c), p.kind === 'base' ? f : placeFrame(toPlace(parentPlace(c)), f, true));
    const frame = world && (carrier && bodyPlaces.has(carrier) ? carried(carrier, world) : p.kind === 'base' ? placeFrame(toPlace(groupPlace(s.group)), world) : world);
    return frame ? [{ id: s.id, color: palette[i % palette.length], frame, placement: p, shapes: r.shapes, groups: s.groups }] : [];
  });
  viewer.setCustomSections(
    doc.sections.flatMap((c, i) => {
      const offset = resolve(c.offset, lookup, `sections.${i}.offset`, exprErrors);
      const turn = c.turn ? resolve(c.turn, lookup, `sections.${i}.turn`, exprErrors) : 0;
      if (!c.enabled || !Number.isFinite(offset) || !Number.isFinite(turn)) return [];
      const n = new Vector3(...c.normal);
      const x = new Vector3(0, 0, 1).cross(n);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      const f = cutPlane({ o: c.origin, x: x.normalize().toArray(), n: c.normal, turn, axis: c.axis ?? null, offset });
      return [{ point: f.o, normal: f.n }];
    }),
  );
  const ids = new Set(doc.bodies.map((p) => p.id));
  for (const id of kernelErrors.keys()) if (!ids.has(id)) kernelErrors.delete(id);
  for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id), bodyPlaces.delete(id);
  selected = selected.filter((id) => ids.has(id) || [...doc.sketches, ...doc.groups, ...doc.planes, ...doc.images].some((o) => o.id === id));
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
  viewer.setPhotos([...BUILT_IN_PHOTOS, ...allPhotos()]);
  viewer.setLooks(doc.bodies.map((b) => ({ ...b, look: lookOf(doc, b), visible: b.visible && !hideAll.objects && shownIn(b.group), owner: owner.get(b.id), cutter: owner.has(b.id), outlined: b.visible && !hideAll.objects && shownIn(b.group) && doc.bodies.some((o) => o.features.some((f) => f.type === 'boolean' && f.body === b.id && f.free)) })));
  viewer.select(contents(doc, selected), groupKept(doc));
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
  viewer.listOrder = tree(doc, new Set()).flatMap((r) => (r.kind === 'body' ? [r.id] : []));
  kernel.build(builds);
  scheduleAutosave();
  offerAutosave();
  render();
}

function commit(next: Doc) {
  history.push(follow(history.current, next));
  update();
  clashAgain?.();
}

/** Tool bodies stick to their owner: an owner moved from `before` to `next` takes those that did not move themselves along. */
function follow(before: Doc, next: Doc): Doc {
  const owner = ownersOf(next);
  if (!owner.size && !next.joints.length) return next;
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
  // a joint's parent moved: what it moves goes along by as much in the world (else they would swing around an axis
  // that left them); each counts the move in its own group's (turned) coordinates
  const turnOf = (m: Matrix4) => new Matrix4().extractRotation(m);
  for (const j of next.joints) {
    const d = by(j.parent);
    if (!d || still(d) || !d.every(Number.isFinite)) continue;
    const world = new Vector3(...d).applyMatrix4(turnOf(parentPlace(j.parent)));
    const shift = (id: string) => {
      if (!still(by(id))) return; // moved itself
      const local = world.clone().applyMatrix4(turnOf(parentPlace(id)).invert()).toArray();
      const i = out.bodies.findIndex((b) => b.id === id);
      if (i >= 0) {
        const p = at(out, id)!;
        out = setIn(out, ['bodies', String(i), 'position'], out.bodies[i].position.map((x, k) => plus(x, p[k], local[k])));
        return drag(id, local, new Set([id]));
      }
      const g = out.groups.findIndex((x) => x.id === id);
      const o = out.groups[g]?.origin;
      if (o?.kind === 'custom') {
        const p = resolve(o.position, paramLookup(out.params), '', new Map()) as Vec3;
        out = setIn(out, ['groups', String(g), 'origin', 'position'], o.position.map((x, k) => plus(x, p[k], local[k])));
      } else if (o) for (const b of contents(out, [id])) if (out.bodies.some((x) => x.id === b)) shift(b);
    };
    j.children.forEach(shift);
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
  const lists = [bodies, ...(['boolean', 'group', 'cut', 'joint', 'shell'].includes(pending.tool) ? [] : [sketches]), ...(['move', 'joint'].includes(pending.tool) ? [groups] : [])];
  return lists.some((list) => list.some((o) => o.id === id));
}

/**
 * `how`: true toggles the object (body or sketch), 'range' selects a range of its list; null clears the selection
 * (unless adding). Selecting something else leaves sketch mode.
 */
function select(id: string | null, how: Pick = false) {
  rendersOpen = false; // choosing something shows it, not the renders
  viewer.lightSketch(null); // a list row's hover light: the row may be redrawn before the pointer leaves it
  viewer.dropPicked(); // picked faces and edges start over
  if (finishSel) viewer.setFinishMark((finishSel = null));
  if (id && picks(id)) return pending!.pick(id, how);
  // Extrude picking: a sketch chosen in the list adds its shapes (inner ones holes), or drops them
  if (extruding?.picking() && id && history.current.sketches.some((s) => s.id === id)) return void (extruding.pickSketch(id) || fail('Nothing to extrude in that sketch'));
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
      if (key === 'pts') next.pts = roundPts(v as [number, number][]);
      else if (key === 'curves') next.curves = roundCurves(v as (Curve | null)[]);
      else if (typeof v === 'number' && Math.abs(v - (old[key] as number)) > 1e-9) next[key] = UNITLESS.includes(key) ? ex(fmt(v)) : len(v, typed[key as 'w']);
    }
    if (q.kind === 'polygon' || q.kind === 'line') next.sizes = sizesAfter(q, old as unknown as DrawnProfile, u.profile);
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
    if ((copy.kind === 'polygon' || copy.kind === 'line') && (m.kind === 'polygon' || m.kind === 'line')) return { ...copy, pts: roundPts(m.pts), ...(m.curves ? { curves: roundCurves(m.curves) } : {}) };
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
    toolHint = `Click the body that keeps the result · then the ones to ${{ union: 'join', subtract: 'cut it', intersect: 'intersect' }[op]} · [Enter] applies · [Esc] cancels`;
    return showSelection();
  }
  const [target, ...tools] = ids;
  // a linked copy's boolean goes to its source's steps, so every copy gets it: the tools move by the source, as they lie by the copy
  const owner = doc.bodies[stepsOf(doc, target)].id;
  const by = owner === target ? null : bodyPlaces.get(owner)!.clone().multiply(bodyPlaces.get(target)!.clone().invert());
  const bodies = doc.bodies.map((b) => {
    if (tools.includes(b.id)) return { ...b, visible: op === 'subtract', ...(by ? placementIn(parentPlace(b.id), by.clone().multiply(bodyPlaces.get(b.id)!)) : {}) }; // cutters show as red outlines
    if (b.id !== owner) return b;
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

const showImages = () => viewer.setImages(history.current.images.filter((im) => im.visible).map((im) => ({ ...im, selected: selected.includes(im.id) })));

function showSelection() {
  clashAgain?.();
  showImages();
  viewer.select(contents(history.current, selected), groupKept(history.current));
  viewer.setSketches(viewer.sketches, activeSketch(), shapeSel);
  render();
}

/** Objects of one group selected (not in sketch mode): that group's contents stay, the rest fades; else null. */
function groupOf(doc: Doc) {
  const objects = [...doc.bodies, ...doc.sketches].filter((o) => selected.includes(o.id));
  const g = objects[0]?.group;
  return g && !sketching && objects.length === selected.length && objects.every((o) => o.group === g) ? new Set(contents(doc, [g])) : null;
}

/** What stays solid while a group's objects are selected: its contents and the bodies whose eye showed them fully (they reset when it ends). */
function groupKept(doc: Doc) {
  if (clashXray) return new Set<string>(); // all see-through: only the overlaps stand out
  const kept = groupOf(doc);
  if (!kept && !sketching) solid = new Set();
  return kept && new Set([...kept, ...solid]);
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
  if (selectedImages().length) commit({ ...history.current, images: history.current.images.map((im) => (selected.includes(im.id) ? { ...im, frame: { ...im.frame, o: im.frame.o.map((v, k) => v + by[k]) as Vec3 } } : im)) });
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
  // read from the view's triangles or flattened curves: see the panel's info icon
  const about = (mm: number, power = 1) => `~${num(mm, power)}`;
  if (pickedPart?.kind === 'face') {
    const n = pickedPart.count ?? 1;
    return { title: n > 1 ? 'Faces' : 'Face', rows: n > 1 ? [['Area', about(pickedPart.size, 2)], ['Faces', String(n)]] : [['Area', about(pickedPart.size, 2)]] };
  }
  if (pickedPart) {
    const n = pickedPart.count ?? 1;
    const rows: [string, string][] = [['Length', about(pickedPart.size)]];
    if (n > 1) rows.push(['Edges', String(n)]);
    if (pickedPart.diameter) rows.push(['Ø', about(pickedPart.diameter)]);
    return { title: pickedPart.diameter ? 'Circle' : n > 1 ? 'Edges' : 'Edge', rows };
  }
  const lookup = paramLookup(doc.params);
  const s = doc.sketches.find((x) => x.id === activeSketch());
  if (s) {
    const shapes = resolve(s, lookup, '', new Map()).shapes.filter((q) => !shapeSel.length || shapeSel.includes(q.id));
    if (shapes.length !== 1) return { title: shapeSel.length ? `${shapes.length} shapes` : s.name, rows: [['Shapes', String(shapes.length)]] }; // (areas would count holes too)
    const q = shapes[0];
    const [w, h] = sizeOf(q);
    const bent = curved(q); // its outline flattened
    const val = bent ? about : num;
    const rows: [string, string][] = q.kind === 'circle' ? [['Ø', num(q.d)]] : [['Size', `${val(w)} × ${val(h)}`]];
    rows.push(q.kind === 'line' ? ['Length', val(flattened(q).reduce((n, [x, y], i, f) => n + (i ? Math.hypot(x - f[i - 1][0], y - f[i - 1][1]) : 0), 0))] : ['Area', val(area(q), 2)]);
    return { title: q.kind[0].toUpperCase() + q.kind.slice(1), rows };
  }
  const ids = contents(doc, selected).filter((id) => doc.bodies.some((b) => b.id === id));
  const m = ids.flatMap((id) => viewer.measure(id) ?? []);
  if (!m.length) return null;
  const box = m.reduce((b, x) => b.union(x.box), new Box3());
  const size = box.getSize(new Vector3());
  // L / W / H along x / y / z: hovering one shows it on the box
  const rows: [string, string, Measure?][] = [['L', about(size.x), 0], ['W', about(size.y), 1], ['H', about(size.z), 2]];
  const b = ids.length === 1 && doc.bodies.find((x) => x.id === ids[0]);
  if (b) {
    const at = positions.get(b.id);
    const turn = resolve(b.rotation, lookup, '', new Map());
    if (at) rows.push(['Position', at.map((v) => num(v)).join(', '), 'at']);
    rows.push(['Rotation', `${fmt(turn.rx)}°, ${fmt(turn.ry)}°, ${fmt(turn.rz)}°`]);
  }
  rows.push(['Volume', about(m.reduce((n, x) => n + x.volume, 0), 3)], ['Surface', about(m.reduce((n, x) => n + x.area, 0), 2)]);
  return { title: b ? b.name : `${ids.length} bodies`, rows, box, at: b ? positions.get(b.id) : undefined };
}

/** The largest sizes found for finishes that were too big (by feature id and kind, `id fillet`): drags stop there. */
const finishMax = new Map<string, number>();
/** A finish size `mm` (fillet positive, chamfer negative) cut to the largest known to fit, a hair under it. */
const clamped = (feature: string, v: number) => Math.sign(v) * Math.min(Math.abs(v), Math.floor((finishMax.get(`${feature} ${v >= 0 ? 'fillet' : 'chamfer'}`) ?? Infinity) * 100) / 100);

/** A finish too big for its edges: its size becomes the largest that works (in the same undo step). */
function clampFinish(body: string, feature: string, max: number) {
  const doc = history.current;
  const i = stepsOf(doc, body);
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
  const single = /^\s*-\s*(\$?[A-Za-z_]\w*|\d+\.?\d*|\.\d+)\s*$/.exec(value.e);
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
function moveAlong(first: number, all = false, start: Vec3 = [0, 0, 0], made?: { sources: string[]; copies: string[] }) {
  if (selected.length && selectedImages().length === selected.length) return moveImages();
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
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  document.body.append(box);
  // at the top of the view as the other panels (again whenever the fields grow)
  const inView = new ResizeObserver(() => atTop(box));
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
      box.insertBefore(cell(letter, input), next?.parentElement ?? toObject); // in X Y Z order, the button last
      fields[k] = input;
    }
    fields[k]!.focus();
    if (fields[k]!.value && fields[k]!.value === fields[k]!.dataset.start) fields[k]!.select(); // untouched: typing replaces it
  };
  const keys = (e: KeyboardEvent, input: HTMLInputElement) => {
    const k = (['moveX', 'moveY', 'moveZ'] as const).findIndex((a) => pressed(e, a));
    const typingName = inName(input.value.slice(0, input.selectionStart ?? 0));
    if (k >= 0 && !typingName) return e.preventDefault(), open(k);
    // T (as X / Y / Z): the To object button
    if (pressed(e, 'toObject') && !typingName) return e.preventDefault(), toObject.click();
    // Tab (a completion took it already): the next axis' field (Shift: the previous), added if needed; leaving would cancel
    if (e.key === 'Tab') return e.preventDefault(), open((fields.indexOf(input) + (e.shiftKey ? 2 : 1)) % 3);
    if (pressed(e, 'cancel')) return close();
    if (pressed(e, 'confirm')) confirm();
  };
  /** Enter or ✓: moves (or copies) by all the fields. */
  const confirm = () => {
    const b = by();
    if (!b) return show();
    close();
    if (copy.checked) copyMoved(b, linked.checked);
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
  }, 'Click a corner, edge or face: the selection moves along this axis until its nearest side reaches it', measureField);
  const copy = Object.assign(document.createElement('input'), { type: 'checkbox', onchange: () => ((linkedLabel.hidden = !copy.checked), show(), last?.focus()) });
  const copyLabel = Object.assign(document.createElement('label'), { title: 'Leave the selection where it is and move a copy of it' });
  copyLabel.append(copy, 'Copy');
  // linked (off first): copies share their source's steps (editing one edits all); just duplicated ones change at once
  const linked = Object.assign(document.createElement('input'), {
    type: 'checkbox',
    onchange: () => {
      if (made) history.replace(relinked(history.current, made.sources, made.copies, linked.checked)), update();
      last?.focus();
    },
  });
  const linkedLabel = Object.assign(document.createElement('label'), { title: 'Copies are linked copies: they share their steps, editing one edits all of them', hidden: !made });
  linkedLabel.append(linked, 'Linked');
  // copies made already (Duplicate, paste): no Copy; Linked only while their sources are there
  box.append(toObject, ...(made ? [] : [copyLabel]), ...(made && !made.sources.length ? [] : [linkedLabel]), panelButton('✓', 'Move it (Enter); Esc leaves it', () => confirm()));
  if (all) [2, 1, 0].forEach(open); // all three, then the cursor goes to `first`
  open(first);
  show();
}

/** Where the selection reaches along `axis` (world mm, without the move preview): bodies' boxes, or the moved shapes' outlines. */
/** How far a point lies from the nearest side of the selection's box (mm). */
const nearestSide = (p: Vector3) => Math.min(...[0, 1, 2].flatMap((k) => (extentAlong(k) ?? []).map((v) => Math.abs(p.getComponent(k) - v))));

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

/** Copies are made linked (sharing their source's steps): the Linked checkboxes of copy-move, Duplicate, Mirror and Pattern (this session). */
let linkedCopies = false;

/** Where a body's shape edits go (its index): a linked copy's source, so all its copies change too; else the body. */
function stepsOf(doc: Doc, body: string) {
  const id = doc.bodies.find((b) => b.id === body)?.link ?? body;
  return doc.bodies.findIndex((b) => b.id === id);
}

/** One linked copy gets its own steps (its source's, then its own): editing it no longer edits the others, and it leaves them in the list. */
function unlinkCopy(id: string) {
  const doc = history.current;
  const i = doc.bodies.findIndex((b) => b.id === id);
  const src = doc.bodies.find((b) => b.id === doc.bodies[i]?.link);
  if (src) commit(setIn(doc, ['bodies', String(i)], { ...doc.bodies[i], link: null, features: [...structuredClone(src.features), ...doc.bodies[i].features] }));
}

/**
 * Breaks a body's links (asked first): its linked copies in its group get all its steps and go, with it, into a new group of its
 * name (in its place in the list); copies elsewhere just get their steps. One undo step.
 */
function breakLinks(source: string) {
  const doc = history.current;
  const src = doc.bodies.find((b) => b.id === source);
  const count = doc.bodies.filter((b) => b.link === source).length;
  if (!src || !confirm(`Break the links of "${src.name}"? Its ${count} linked cop${count === 1 ? 'y gets' : 'ies get'} their own steps (editing one no longer edits the others); they go with it into a new group "${src.name}".`)) return;
  const group: Group = { id: newId(), name: src.name, parent: src.group, visible: true, origin: { kind: 'parent' }, ...(src.order !== undefined ? { order: src.order } : {}) };
  const bodies = doc.bodies.map((b) => {
    if (b.id !== source && b.link !== source) return b;
    const own = b.link === source ? { link: null, features: [...structuredClone(src.features), ...b.features] } : {};
    return { ...b, ...own, ...(b.group === src.group ? { group: group.id, order: undefined } : {}) };
  });
  selected = [group.id];
  commit({ ...doc, bodies, groups: [...doc.groups, group] });
}

/** Copies `copies` of bodies `sources` (pairwise) made linked copies of them (`on`), or independent with all their steps. */
function relinked(doc: Doc, sources: string[], copies: string[], on: boolean): Doc {
  return {
    ...doc,
    bodies: doc.bodies.map((b) => {
      const src = doc.bodies.find((x) => x.id === sources[copies.indexOf(b.id)]);
      if (!src) return b;
      const shared = doc.bodies.find((x) => x.id === src.link)?.features ?? [];
      return on ? { ...b, link: src.link ?? src.id, features: structuredClone(src.link ? src.features : []) } : { ...b, link: null, features: structuredClone([...shared, ...src.features]) };
    }),
  };
}

/** Moves a copy of the selection by `by` (one undo step): shapes in their sketch, else bodies and sketches (`linked`: linked copies). */
function copyMoved(by: Vector3, linked: boolean) {
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
    const { bodies, sketches } = copiesOf(moved.bodies.filter((b) => selected.includes(b.id)), moved.sketches.filter((s) => selected.includes(s.id)), ' copy', linked);
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
  // as Duplicate: no Copy in the move fields; Linked while the bodies copied from are there (not after ⌘X)
  const copies = copiesOf(copied.bodies, copied.sketches, cut ? '' : ' copy');
  const there = cut ? [] : copied.bodies.filter((b) => doc.bodies.some((x) => x.id === b.id));
  placeCopies(copies, cut ? [0, 0, 0] : [5, 5, 0], { sources: there.map((b) => b.id), copies: copies.bodies.filter((_, k) => there.includes(copied!.bodies[k])).map((b) => b.id) });
}

/**
 * Cut (toolbar): the selected bodies, else the one clicked next (selected, so outlined), then a face or empty
 * space (a straight cut on that face's plane, or the base plane facing you) or the outline of a sketch line or shape
 * (cut along it, linked); then `cutPanel`, and from there on again with what came of it, until Esc. Chunk A keeps the
 * side the cutter faces (a face's: into the body, a line's left, a shape's inside), chunk B the other.
 */
function cutTool(note = '') {
  const doc = history.current;
  const bodies = selected.filter((id) => doc.bodies.some((b) => b.id === id));
  if (!bodies.length) {
    pending = { tool: 'cut', pick: (id) => (cancelPending(), (selected = [id]), showSelection(), cutTool()) };
    toolHint = 'Click the body to cut · [Esc] cancels';
    return render();
  }
  [selected, shapeSel] = [bodies, []];
  showSelection();
  toolHint = note + 'Click where to cut · [Esc] done · a face, work plane or empty space: straight, on its plane · a sketch line or shape: along it · a ball or cylinder: along its surface · [Esc] cancels';
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    if (!face) return render();
    const each = (cutter: (pl: ReturnType<typeof bodyPlace>) => SplitFeature['cutter']) => cutPanel(bodies, new Map(bodies.map((b) => [b, cutter(bodyPlace(b))])));
    if (face.sketch?.shape) return each(() => ({ kind: 'shape', sketch: face.sketch!.id, shape: face.sketch!.shape!, offset: len(0) }));
    // another body that is a ball or a cylinder (one circle pulled): along its surface
    const other = !bodies.includes(face.body!) ? doc.bodies.find((b) => b.id === face.body)?.features : undefined;
    const [solid] = other?.length === 1 ? (built.get(face.body!) ?? []) : [];
    const there = bodyPlace(face.body!);
    if (other?.[0].type === 'sphere') {
      const { x, y, z } = resolve(other[0], paramLookup(doc.params), '', new Map());
      const d = other[0].d;
      return each((pl) => ({ kind: 'sphere', c: unplaced(pl, inWorld(there, [x, y, z])), d: structuredClone(d), offset: len(0) }));
    }
    const pulled = solid?.type === 'extrude' && solid.mode === 'add' && !solid.through && solid.profiles.length === 1 ? solid : null;
    const circle = pulled?.profiles[0];
    const f = pulled && frames([pulled]).get(pulled.id);
    if (pulled && circle?.kind === 'circle' && f) {
      const [from, to] = extent(pulled.depth, pulled.back);
      const c = inWorld(there, toWorld(moved(f, scale(f.n, from)), circle.x, circle.y));
      return each((pl) => ({ kind: 'cylinder', c: unplaced(pl, c), dir: unplaced(pl, inWorld(there, f.n, true), true), h: to - from, d: len(circle.d), offset: len(0) }));
    }
    // on the face clicked (its normal into the body), or the plane facing you
    const n = face.normal.clone().normalize();
    const x = new Vector3(0, 0, 1).cross(n);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    each((pl) => ({ kind: 'plane', o: unplaced(pl, face.point.toArray()), x: unplaced(pl, x.toArray(), true), n: unplaced(pl, n.toArray(), true), turn: ex(0), axis: null, offset: len(0) }));
  }, false, true, null, true);
}

/** While a cut is set up: its chunk B, not listed until the cut is kept. */
let cutting: { chunks: string[] } | null = null;
/** What the last cut kept: the next one starts with it. */
let cutKeep: 'both' | 'A' | 'B' = 'both';

/**
 * The cut being set up, on `bodies` (their cutters in their own coordinates), shown as it will be: each body (chunk A: the side the cutter faces, into the body from a face,
 * a line's left, a shape's, ball's or cylinder's inside) and its copy (chunk B, the other side, its own colour, not listed yet) cut, the
 * one to be deleted see-through red, the cutting surface red and half see-through, a bit larger than the body. A panel at
 * the top middle of the view has the offset from the plane, face or line (from 0, the cursor in it; T or To object:
 * click a point it goes through), a plane's turn around its axis (dashed; Set axis: click an edge, line or circle),
 * each field scrubbed by dragging its label sideways, and what stays (as the last cut, Keep both first). ✓ or Enter keeps
 * it (one undo step), all that came of it selected, and the next cut can start; a body it does not cross stays as it was.
 * Esc leaves the bodies as they were.
 */
function cutPanel(bodies: string[], cutters: Map<string, SplitFeature['cutter']>) {
  const body = bodies[0];
  const cutter = cutters.get(body)!;
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  document.body.append(box);
  const u = history.current.units;
  const lookup = paramLookup(history.current.params);
  const values = { offset: '0', turn: '0' };
  let axis: { at: V3; dir: V3 } | null = null; // body-local; none: the plane's own x
  let picking = false; // waiting for To object or Set axis: Esc ends only that
  const whole = bodies.reduce((box, b) => { const m = viewer.measure(b)?.box; return m ? box.union(m) : box; }, new Box3()); // before the cut: the surface's size and place
  let keep = cutKeep;
  /** The cutter of `b` with the values typed, if they are valid. */
  const current = (b = body): SplitFeature['cutter'] | null => {
    if (length(values.offset) === null || length(values.turn) === null) return null;
    const offset = { e: values.offset, u };
    const c = cutters.get(b)!;
    // the axis is kept as the first body has it
    const own = axis && { at: unplaced(bodyPlace(b), inWorld(bodyPlace(body), axis.at)), dir: unplaced(bodyPlace(b), inWorld(bodyPlace(body), axis.dir, true), true) };
    return c.kind === 'plane' ? { ...c, offset, turn: { e: values.turn, u: 'mm' }, axis: own } : { ...c, offset };
  };
  // the chunks: each body (A) and its copy (B) right after it, in one undo step
  const doc0 = history.current;
  const split = (b: string, side: 1 | -1): Feature => ({ id: newId(), type: 'split', cutter: structuredClone(current(b)!), side });
  const parts = bodies.map((b, k) => {
    const from = doc0.bodies.find((x) => x.id === b)!;
    const [copy] = copiesOf([from], [], ' B').bodies;
    // a linked copy's cut goes to its source's steps: every copy is cut (B: the clicked one's other side only)
    return { body: b, from, a: doc0.bodies[stepsOf(doc0, b)].id, chunk: { ...copy, color: newBody(doc0.bodies.length + 1 + k, []).color, features: [...copy.features, split(b, -1)] } as Body };
  });
  const ofA = (id: string) => parts.find((q) => q.a === id);
  history.push({ ...doc0, bodies: doc0.bodies.flatMap((x) => {
    const own = ofA(x.id) ? { ...x, features: [...x.features, split(ofA(x.id)!.body, 1)] } : x;
    return [own, ...parts.filter((q) => q.body === x.id).map((q) => q.chunk)];
  }) });
  const chunkIds = parts.map((q) => q.chunk.id);
  cutting = { chunks: chunkIds };
  [selected, shapeSel] = [bodies, []];
  const hint = `Cut${bodies.length > 1 ? ` ${bodies.length} bodies` : ''}: set the offset, pick what stays · type or scrub it, T: to object${cutter.kind === 'plane' ? ' · the turn (Set axis: what it turns around)' : ''} · [Enter] cuts, then the next · [Esc] leaves them as they were`;
  toolHint = hint;
  /** The chunks cut by the cutter as typed, those to be deleted see-through red; the cutting surface shown. */
  const show = () => {
    const c = current();
    if (c) {
      const doc = history.current;
      const next = doc.bodies.map((x) => {
        const chunk = parts.find((q) => q.chunk.id === x.id);
        const part = chunk ?? ofA(x.id);
        if (!part) return x;
        const cut = structuredClone(x.features.at(-1)!);
        if (cut.type === 'split') cut.cutter = structuredClone(current(part.body)!);
        // B alone stays: it is the body as it was named and coloured
        const look = chunk ? (keep === 'B' ? { name: chunk.from.name, color: chunk.from.color } : { name: chunk.chunk.name, color: chunk.chunk.color }) : {};
        return { ...x, ...look, features: [...x.features.slice(0, -1), cut] };
      });
      history.replace({ ...doc, bodies: next });
      update();
    }
    viewer.setDropped(keep === 'A' ? chunkIds : keep === 'B' ? bodies : []);
    surface(c);
  };
  /** A plane's axis in the world: the one set, else its own x through its point. */
  const axisOf = (c: SplitFeature['cutter'] & { kind: 'plane' }, f: Frame): TurnAxis =>
    c.axis
      ? { at: new Vector3(...inWorld(bodyPlace(body), c.axis.at)), dir: new Vector3(...inWorld(bodyPlace(body), c.axis.dir, true)).normalize(), what: '' }
      : { at: new Vector3(...f.o), dir: new Vector3(...f.x), what: '' };
  /** The cutting surface: a plane as a square a bit larger than the body, a line as a band along it through the body. */
  const surface = (c: SplitFeature['cutter'] | null) => {
    if (!c || whole.isEmpty()) return;
    const size = whole.getSize(new Vector3()).length() * 0.6;
    const mid = whole.getCenter(new Vector3());
    const at = (f: Frame, u0: number, v0: number) => new Vector3(...toWorld(f, u0, v0));
    if (c.kind === 'plane') {
      const f = placeFrame(bodyPlace(body), cutPlane(resolve(c, lookup, '', new Map()) as Parameters<typeof cutPlane>[0]));
      const n = new Vector3(...f.n);
      const g: Frame = { ...f, o: mid.clone().addScaledVector(n, -mid.clone().sub(new Vector3(...f.o)).dot(n)).toArray() }; // the body's middle on the plane
      if (!picking) viewer.showAxis(axisOf(c, f), mid, size * 1.2);
      angles?.show();
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
    const pts = q.kind === 'line' ? beside(flattened(q), resolve(c.offset, lookup, '', new Map()) as number) : [...flattened(q), flattened(q)[0]];
    const n = new Vector3(...s.frame.n);
    // the band reaches through the body along the sketch's normal
    const h = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new Vector3(k & 1 ? whole.max.x : whole.min.x, k & 2 ? whole.max.y : whole.min.y, k & 4 ? whole.max.z : whole.min.z).sub(new Vector3(...s.frame.o)).dot(n));
    const [lo, hi] = [Math.min(...h) - size * 0.1, Math.max(...h) + size * 0.1];
    const lift = (p: [number, number], k: number) => at(s.frame, ...p).addScaledVector(n, k);
    viewer.showCut(pts.slice(1).map((p, k) => [lift(pts[k], lo), lift(p, lo), lift(p, hi), lift(pts[k], hi)]));
  };
  const fields: HTMLInputElement[] = [];
  let angles: ReturnType<typeof angleControl> | null = null;
  const field = (label: string, get: () => string, set: (t: string) => void) => {
    const input = Object.assign(document.createElement('input'), { value: get(), spellcheck: false });
    input.dataset.complete = '';
    const apply = () => {
      input.classList.toggle('invalid', length(input.value || '0') === null);
      set(input.value || '0');
      show();
    };
    input.oninput = apply;
    // T: To object, as X / Y / Z in the move fields
    input.onkeydown = (e) => {
      if (wantsT(e, input)) e.preventDefault(), aim();
    };
    const name = Object.assign(document.createElement('span'), { textContent: label });
    scrub(name, input, () => input.value, u, settings.minStep, (text) => ((input.value = text), apply()), () => (input.focus(), input.select()));
    fields.push(input);
    return [name, input];
  };
  /** "To object": the next click sets the offset so the cut goes through that point (shown while aiming). */
  const aim = () => {
    const before = values.offset;
    angles?.disarm();
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
        const along = flattened(line);
        along.slice(1).forEach(([bx, by], i) => {
          const [ax, ay] = along[i];
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
    angles?.disarm();
    picking = true;
    toolHint = 'Click what the plane turns around · an edge or line, or a circle (its centre) · [Esc] keeps the axis';
    render();
    const mid = whole.getCenter(new Vector3());
    const size = (whole.getSize(new Vector3()).length() || 100) * 0.72;
    viewer.pickAxis(
      (a) => {
        picking = false;
        tips.cursorTip(null);
        toolHint = hint;
        if (a) axis = { at: unplaced(bodyPlace(body), a.at.toArray()), dir: unplaced(bodyPlace(body), a.dir.toArray(), true) };
        show();
        render();
        if (a) angles?.arm();
        else fields[1].focus(), fields[1].select();
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
    keep = cutKeep = k;
    choices.forEach((btn) => btn.classList.toggle('on', btn.dataset.keep === k));
    show();
  };
  /** Kept: the chunks to be deleted go, the others stay and are listed, a body the cut does not cross stays whole, and the next cut can start; else everything as it was. */
  const finish = async (ok: boolean) => {
    viewer.aiming = null;
    angles?.end();
    viewer.cancelFacePick(); // a pick under way ends first: it shows the cut once more
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    viewer.showCut(null);
    viewer.showAxis(null);
    viewer.setDropped([]);
    if (!ok || !current()) {
      [toolHint, cutting] = [null, null];
      return undo();
    }
    await kernel.idle();
    const crossed = parts.filter((q) => !kernelErrors.has(q.chunk.id) && !kernelErrors.has(q.body));
    const doc = history.current;
    const gone = new Set([...parts.filter((q) => !crossed.includes(q)).map((q) => q.chunk.id), ...crossed.map((q) => (keep === 'A' ? q.chunk.id : keep === 'B' ? q.body : ''))]);
    // an uncrossed body loses its cut again, unless a crossed linked copy shares it
    const bare = new Set(parts.filter((q) => !crossed.some((o) => o.a === q.a)).map((q) => q.a));
    const left = doc.bodies.filter((x) => !gone.has(x.id)).map((x) => (bare.has(x.id) ? { ...x, features: x.features.slice(0, -1) } : x));
    [toolHint, cutting] = [null, null];
    history.replace({ ...doc, bodies: left });
    selected = parts.flatMap((q) => (!crossed.includes(q) ? [q.body] : keep === 'both' ? [q.body, q.chunk.id] : [keep === 'A' ? q.body : q.chunk.id]));
    update();
    const missed = parts.length - crossed.length;
    cutTool(missed ? `Not crossed, left as ${missed === 1 ? 'it was' : 'they were'}: ${missed === 1 ? 'one body' : `${missed} bodies`} · ` : '');
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || (!pressed(e, 'confirm') && !pressed(e, 'cancel'))) return; // the view's Esc ending a pick
    e.stopImmediatePropagation();
    e.preventDefault();
    if (picking && pressed(e, 'cancel')) viewer.cancelFacePick();
    else void finish(pressed(e, 'confirm'));
  };
  const offsetField = field('Offset', () => values.offset, (t) => (values.offset = t));
  const turnField = cutter.kind === 'plane' ? field('Turn °', () => values.turn, (t) => (values.turn = t)) : [];
  angles =
    cutter.kind === 'plane'
      ? angleControl({
          input: fields[1],
          idle: () => !picking,
          axis: () => {
            const c = current();
            if (c?.kind !== 'plane' || whole.isEmpty()) return null;
            // from the plane unturned, on the body's side of the axis
            const f = placeFrame(bodyPlace(body), cutPlane(resolve({ ...c, turn: ex(0) }, lookup, '', new Map()) as Parameters<typeof cutPlane>[0]));
            const a = axisOf(c, f);
            const mid = whole.getCenter(new Vector3());
            const at = a.at.clone().addScaledVector(a.dir, mid.clone().sub(a.at).dot(a.dir));
            const zero = new Vector3(...f.n).cross(a.dir);
            if (zero.lengthSq() < 1e-9) zero.set(...f.x);
            zero.normalize();
            if (zero.dot(mid.clone().sub(at)) < 0) zero.negate();
            return { at, dir: a.dir, zero };
          },
        })
      : null;
  box.append(
    cell(...offsetField, toObjectButton(aim, 'Click a corner, edge or face: the cut goes through it', measureField)),
    ...(cutter.kind === 'plane'
      ? [cell(...turnField, angles!.buttons()), Object.assign(document.createElement('button'), { className: 'set-axis', textContent: 'Set axis', title: 'Click an edge or line (the plane turns around it) or a circle (around its centre)', onclick: setAxis })]
      : []),
    segmented,
    panelButton('✓', 'Click: Cut, then the next cut can start (Enter); Esc leaves the bodies as they were', () => void finish(true)),
  );
  choose(keep);
  atTop(box);
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
    }, false, true);
  }
  toolHint = "Revolve: click the axis · a sketch line or a body edge in the shapes' plane · [Esc] cancels";
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
  Object.assign(input.dataset, { complete: '', noMeasure: '' });
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
  scrub(label, input, () => input.value, 'mm', settings.minStep, (text) => (set(text), angles.show()), () => (input.focus(), input.select()));
  const angles = angleControl({
    input,
    axis: () => {
      // around the axis, from the shapes' middle
      const s = viewer.sketches.find((k) => k.id === sketch);
      if (!s) return null;
      const [x, y] = [new Vector3(...s.frame.x), new Vector3(...s.frame.y)];
      const dir = x.multiplyScalar(axis.dir[0]).add(y.multiplyScalar(axis.dir[1])).normalize();
      const start = new Vector3(...toWorld(s.frame, ...axis.at));
      const boxes = s.shapes.filter((q) => shapes.includes(q.id)).map(bounds);
      const mid = new Vector3(...toWorld(s.frame, (Math.min(...boxes.map((b) => b[0])) + Math.max(...boxes.map((b) => b[2]))) / 2, (Math.min(...boxes.map((b) => b[1])) + Math.max(...boxes.map((b) => b[3]))) / 2));
      const at = start.clone().addScaledVector(dir, mid.clone().sub(start).dot(dir));
      const zero = mid.sub(at);
      if (zero.lengthSq() < 1e-9) zero.set(...s.frame.n).cross(dir);
      return { at, dir, zero: zero.normalize() };
    },
  });
  input.addEventListener('input', () => angles.show());
  const finish = (ok: boolean) => {
    angles.end();
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    toolHint = null;
    if (!ok) return undo();
    render();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || (!pressed(e, 'confirm') && !pressed(e, 'cancel'))) return; // the view's Esc ending a turn
    e.stopImmediatePropagation();
    e.preventDefault();
    finish(pressed(e, 'confirm'));
  };
  box.append(cell(label, input, angles.buttons()), panelButton('✓', 'Keep it (Enter); Esc leaves nothing', () => finish(true)));
  document.body.append(box);
  atTop(box);
  toolHint = 'Type or scrub the angle, or turn it with its button · [Enter] keeps it · [Esc] leaves nothing';
  render();
  angles.show();
  setTimeout(() => (input.focus(), input.select()));
  addEventListener('keydown', keys, { capture: true });
}

/** What angle steps a pointer turn has, for hints. */
const angleKeys = () => `[Shift] ${SketchTool.angleStep}° steps, [A] / [Shift A] finer / coarser, [Ctrl] ${settings.minAngle}°`;

/**
 * The one way to change an angle, around `axis` (null: none now; `zero`: where 0° lies, else where the pointer starts):
 * the orange arc and value, the steps as rays (Shift, a while after A / Shift A), digits into `input` from anywhere,
 * T: two clicks give the angle. `arm`: the pointer turns it until a click (Esc: back to before; `click` false: the tool
 * takes the click itself). `change` applies a text (default: as if typed); `idle` false: a pick of the tool's is on.
 */
function angleControl(o: { input: HTMLInputElement; axis: () => { at: Vector3; dir: Vector3; zero?: Vector3 } | null; change?: (text: string) => void; idle?: () => boolean; stepped?: () => void; aimed?: () => void }) {
  const { input } = o;
  input.dataset.noMeasure = ''; // an angle, not a length
  const change = o.change ?? ((text: string) => ((input.value = text), input.dispatchEvent(new Event('input', { bubbles: true }))));
  const read = () => (length(input.value || '0') ?? 0) / UNITS[history.current.units]; // degrees: the number as typed, not a length
  let [armed, picks, ended, shift, raysUntil] = [false, false, false, false, 0];
  let turn: { last: number; base: number; total: number; at: Vector3 } | null = null;
  let [before, stopped, hintBefore] = ['0', null as string | null, null as string | null];
  const show = () => {
    const t = !ended && (o.idle?.() ?? true) && o.axis();
    const from = t && (t.zero ? t.at.clone().addScaledVector(t.zero, 30) : turn?.at);
    viewer.showTicks(t && from ? { at: t.at, dir: t.dir, from, step: SketchTool.angleStep, angle: read(), rays: shift || performance.now() < raysUntil } : null);
  };
  const disarm = () => {
    armed = false;
    if (hintBefore !== null) [toolHint, hintBefore] = [hintBefore, null];
    if (!picks) return;
    picks = false;
    viewer.cancelFacePick();
    render();
  };
  const arm = (click = true) => {
    disarm();
    [armed, turn, stopped] = [true, null, null];
    input.blur();
    input.parentElement?.addEventListener('pointerdown', disarm, { capture: true, once: true });
    if (!click) return;
    viewer.cancelFacePick();
    [picks, before, hintBefore] = [true, input.value, toolHint];
    toolHint = `Move around the axis to turn · click keeps it · ${angleKeys()} · [Esc] puts it back`;
    render();
    viewer.pickFace((face) => {
      if (!picks) return;
      picks = armed = false;
      if (!face) stopped = before; // Esc, if its key says so below
      if (hintBefore !== null) [toolHint, hintBefore] = [hintBefore, null];
      render();
    }, true);
  };
  /** Two clicks, where something is now and where it should go: their angle around the axis goes in at the cursor. */
  const aim = () => {
    const t = o.axis();
    if (!t) return;
    disarm();
    viewer.cancelFacePick();
    const picked: Vector3[] = [];
    const hint = toolHint;
    const done = () => ((viewer.aiming = null), viewer.aimAt(null), tips.cursorTip(null), (toolHint = hint), o.aimed?.(), render());
    const next = () => {
      viewer.aiming = (a) => tips.cursorTip([a?.what, `To object: click where it ${picked.length ? 'goes' : 'is now'}`].filter(Boolean).join('\n'));
      viewer.aiming(viewer.aimHere());
      viewer.pickFace((face) => {
        if (ended) return;
        if (!face?.snap) return done();
        picked.push(face.snap);
        if (picked.length < 2) return next();
        const [a, b] = picked.map((p) => p.clone().sub(t.at).projectOnPlane(t.dir));
        const deg = (Math.atan2(a.clone().cross(b).dot(t.dir), a.dot(b)) * 180) / Math.PI;
        input.focus();
        input.setRangeText(fmt(deg), input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
        change(input.value);
        done();
      }, true);
    };
    toolHint = 'To object: click where it is now, then where it goes · their angle goes into the field · [Esc] cancels';
    render();
    next();
  };
  // the pointer around the axis, as the line tool turns a line: counter-clockwise on screen is positive seen from the axis' tip
  const move = (e: PointerEvent) => {
    const t = armed && !e.buttons && o.axis();
    if (!t) return;
    const r = viewer.el.getBoundingClientRect();
    const [x, y] = viewer.toScreen(t.at);
    const now = (Math.atan2(-(e.clientY - r.top - y), e.clientX - r.left - x) * 180) / Math.PI;
    if (!turn) {
      const at = viewer.pointOnPlane(e, t.at, t.dir);
      if (!at || at.distanceTo(t.at) < 1e-6) return;
      turn = { last: now, base: t.zero ? read() : 0, total: 0, at };
    }
    const sign = t.dir.dot(viewer.screenDir(1, 0).cross(viewer.screenDir(0, 1))) >= 0 ? 1 : -1;
    turn.total += ((now - turn.last + 540) % 360 - 180) * sign;
    turn.last = now;
    const whole = Math.max(-360, Math.min(360, turn.base + turn.total));
    turn.total = whole - turn.base;
    const step = role(e, 'constrain') ? SketchTool.angleStep : role(e, 'precise') ? settings.minAngle : 1;
    const text = fmt(Math.round(whole / step) * step);
    if (text !== input.value) change(text);
    show();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === roleKeyName('constrain')) return (shift = e.type === 'keydown'), show();
    if (e.type !== 'keydown') return;
    if (e.defaultPrevented) {
      if (stopped !== null && pressed(e, 'cancel')) change(stopped); // the view's Esc ended the turn
      stopped = null;
      return;
    }
    stopped = null;
    const typing = document.activeElement instanceof HTMLInputElement;
    const stop = () => (e.preventDefault(), e.stopImmediatePropagation());
    if (o.axis() && (document.activeElement === input ? wantsT(e, input) : !typing && pressed(e, 'toObject'))) return stop(), aim();
    if (!typing && o.axis() && /^[\d.-]$/.test(e.key) && !e.metaKey && !e.ctrlKey) return disarm(), (input.value = ''), input.focus(); // the key lands there
    const step = !typing ? (pressed(e, 'moreSnaps') ? 1 : pressed(e, 'fewerSnaps') ? -1 : 0) : 0;
    if (!step) return;
    stop();
    SketchTool.angleStep = ANGLE_STEPS[Math.min(ANGLE_STEPS.length - 1, Math.max(0, ANGLE_STEPS.indexOf(SketchTool.angleStep) + step))];
    raysUntil = performance.now() + 1500;
    setTimeout(show, 1600);
    show();
    o.stepped?.();
  };
  const typed = (e: Event) => e.isTrusted && disarm();
  input.addEventListener('input', typed);
  for (const type of ['keydown', 'keyup'] as const) addEventListener(type, keys, { capture: true });
  viewer.el.addEventListener('pointermove', move);
  return {
    show,
    arm,
    disarm,
    aim,
    armed: () => armed,
    /** Turning starts afresh at the pointer. */
    restart: () => (turn = null),
    end() {
      stopped = null;
      disarm();
      ended = true;
      input.removeEventListener('input', typed);
      for (const type of ['keydown', 'keyup'] as const) removeEventListener(type, keys, { capture: true });
      viewer.el.removeEventListener('pointermove', move);
      viewer.showTicks(null);
    },
    /** T and the pointer turn, in the field's cell. */
    buttons() {
      const tools = Object.assign(document.createElement('span'), { className: 'to-tools' });
      const turning = Object.assign(panelButton('', 'Click: turn it with the pointer', () => arm()), { className: 'to-object', innerHTML: icon('rotate') });
      tools.append(toObjectButton(aim, 'Click where something is now, then where it should go: their angle goes into the field'), turning);
      return tools;
    },
  };
}

/**
 * A panel at the top middle of the view with value fields, each scrubbed by its label; T or To object: a click's value
 * (`reach`, in mm, or degrees when `raw`) goes in where the cursor is, to calculate on with it (several values: they
 * replace this field's and those before it, a point's X / Y / Z, say); `int`: whole numbers (scrubbed in 1s; typed
 * decimals go when the field is left); `step`: its scrub step per px; `title`: what label and field say on hover.
 * `change` gets the texts as typed (live, valid ones), `finish` whether to keep them (Enter or ✓; Esc: not).
 */
function valuePanel(fields: { label: string; value: string; reach?: (p: Vector3) => number | number[]; raw?: boolean; int?: boolean; step?: number; title?: string }[], change: (texts: string[]) => void, finish: (ok: boolean) => void, hint: string, extra: HTMLElement[] = []) {
  const u = history.current.units;
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  const inputs = fields.map((f) => Object.assign(document.createElement('input'), { value: f.value, spellcheck: false }));
  let last = inputs[0];
  const valid = (k: number) => (fields[k].int ? Number.isFinite(Number(inputs[k].value || '0')) : length(inputs[k].value || '0') !== null);
  const emit = () => inputs.every((_, k) => valid(k)) && change(inputs.map((i) => i.value || '0'));
  const aim = (k = inputs.indexOf(last)) => {
    const f = fields[k];
    if (!f.reach) return;
    const field = inputs[k];
    viewer.aiming = (a) => tips.cursorTip([a?.what, 'To object: click, its value goes into the field'].filter(Boolean).join('\n'));
    viewer.aiming(viewer.aimHere());
    viewer.pickFace((face) => {
      viewer.aiming = null;
      viewer.aimAt(null);
      tips.cursorTip(null);
      field.focus();
      if (!face?.snap) return;
      const v = f.reach!(face.snap);
      const text = (x: number) => fmt(f.raw ? x : x / UNITS[u]);
      if (Array.isArray(v)) v.forEach((x, j) => (inputs[k - v.length + 1 + j].value = text(x)));
      else field.setRangeText(text(v), field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end');
      emit();
    }, true);
  };
  const cells = fields.flatMap((f, k) => {
    const input = inputs[k];
    input.dataset.complete = '';
    if (f.raw) input.dataset.noMeasure = ''; // an angle, not a length
    input.oninput = () => (input.classList.toggle('invalid', !valid(k)), emit());
    input.onfocus = () => (last = input);
    if (f.int) input.onblur = () => input.value !== '' && valid(k) && String(Math.round(Number(input.value))) !== input.value && ((input.value = String(Math.round(Number(input.value)))), emit());
    input.onkeydown = (e) => {
      if (f.reach && wantsT(e, input)) e.preventDefault(), aim(k);
    };
    const label = Object.assign(document.createElement('span'), { innerHTML: axisHtml(f.label) });
    if (f.title) label.title = input.title = f.title;
    scrub(label, input, () => input.value, f.raw ? 'mm' : u, settings.minStep, (text) => ((input.value = text), input.dispatchEvent(new Event('input', { bubbles: true }))), () => (input.focus(), input.select()), f.int, undefined, f.step);
    // To object right after the field it fills; label, field and button wrap together
    const tools = f.reach ? [toObjectButton(() => aim(k), 'Click a point: its value goes into the field', f.raw ? undefined : measureField)] : f.raw ? [] : [measureButton(measureField)];
    return [cell(label, input, ...tools)];
  });
  const end = (ok: boolean) => {
    viewer.aiming = null;
    viewer.cancelFacePick();
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    toolHint = null;
    finish(ok);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || (!pressed(e, 'confirm') && !pressed(e, 'cancel'))) return; // the view's Esc ending a pick
    e.stopImmediatePropagation();
    e.preventDefault();
    end(pressed(e, 'confirm'));
  };
  box.append(...extra, ...cells, panelButton('✓', 'Keep it (Enter); Esc drops it', () => end(true)));
  document.body.append(box);
  atTop(box);
  toolHint = hint;
  render();
  setTimeout(() => (inputs[0].focus(), inputs[0].select()));
  addEventListener('keydown', keys, { capture: true });
  return { end, inputs };
}

/** A world placement as the position and Rotation X° / Y° / Z° of something whose position counts from `parent`. */
function placementIn(parent: Matrix4, world: Matrix4) {
  const [at, q] = [new Vector3(), new Quaternion()];
  parent.clone().invert().multiply(world).decompose(at, q, new Vector3());
  const e = new Euler().setFromQuaternion(q, 'ZYX');
  const deg = (r: number) => ex(fmt((r * 180) / Math.PI));
  return { position: at.toArray().map((v) => len(v)) as [Expr, Expr, Expr], rotation: { rx: deg(e.x), ry: deg(e.y), rz: deg(e.z) } };
}

/** A panel (cut, rotate, joint, values, move) at the top of the view, below its switches, centred left of the view cube (`cube` px); its contents wrap rather than reach under it. */
function atTop(box: HTMLElement, cube = 120) {
  const r = viewer.el.getBoundingClientRect();
  // between the view's left edge and the view cube; too wide, its contents wrap
  const [from, to] = [r.left + 8, r.right - cube];
  box.style.maxWidth = `${to - from}px`;
  keepInside(box, from + (to - from - box.offsetWidth) / 2, r.top + 44, false, [r.left, r.top, r.right, r.bottom]);
}

/** A panel field's parts (label, input, To object button) as one box: the label inside, the button joined. */
function cell(...parts: HTMLElement[]) {
  const el = Object.assign(document.createElement('span'), { className: 'cell' });
  el.append(...parts);
  return el;
}

/** A panel button; ✓ (keep it) is filled green. */
function panelButton(text: string, title: string, onclick: () => void) {
  return Object.assign(document.createElement('button'), { textContent: text, title, onclick, className: text === '✓' ? 'ok' : '' });
}

/** A checkbox with its words, for the panels. */
function checkbox(label: string, title: string, on: boolean, change: (on: boolean) => void) {
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on, onchange: () => change(box.checked) });
  const el = Object.assign(document.createElement('label'), { className: 'check', title });
  el.append(box, label);
  return el;
}

/**
 * Pattern: copies of the selected bodies (or those clicked next, Enter), live, one undo step. Around: an axis clicked
 * first (as Rotate's: an edge, line, circle or point; Set axis picks another), Count (with the original, whole) over
 * Angle ° (360: evenly all the way round), the copies turned with it or only moved. Grid: X / Y / Z pcs (whole), their
 * spacing as the gap between copies or Overall (from the first's start to the last's end: switching fills it in), T:
 * the last copy's far side at a clicked point, and a turn per copy (each further copy turns that much more around its
 * middle).
 */
function patternTool(mode: 'around' | 'grid' = 'grid') {
  const sources = selected.filter((id) => history.current.bodies.some((b) => b.id === id));
  if (!sources.length) {
    const picked: string[] = [];
    pending = {
      tool: 'shell',
      pick(id) {
        picked.splice(0, picked.length, ...(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]));
        selected = [...picked];
        showSelection();
      },
      apply() {
        cancelPending();
        if (picked.length) patternTool(mode);
        else render();
      },
    };
    toolHint = 'Pattern: click the bodies to repeat · again: not · then [Enter] · [Esc] cancels';
    return render();
  }
  if (mode === 'around') {
    toolHint = 'Pattern around: click the axis · an edge or line, a circle (its centre) or a point (Z through it) · [Esc] cancels';
    render();
    return viewer.pickAxis(
      (a) => {
        tips.cursorTip(null);
        viewer.showAxis(null);
        toolHint = null;
        if (a) patternPanel(sources, 'around', a);
        else render();
      },
      (a) => (tips.cursorTip(a ? `${a.what}\nClick: copies go round it` : null), viewer.showAxis(a, a?.at, 60)),
    );
  }
  patternPanel(sources, 'grid');
}

function patternPanel(sources: string[], mode: 'around' | 'grid', axis?: TurnAxis) {
  const doc0 = history.current;
  const u = UNITS[doc0.units];
  const start = new Map(sources.map((id) => [id, bodyPlaces.get(id)!.clone()]));
  const box = sources.reduce((b, id) => b.union(viewer.measure(id)?.box ?? new Box3()), new Box3());
  const [size, middle] = [box.getSize(new Vector3()), box.getCenter(new Vector3())];
  let [turnCopies, overall] = [true, false];
  let texts: string[] = [];
  /** The copies' world placements for these values: per copy (the original left out) and source. */
  const placements = (v: number[]): Matrix4[][] => {
    const out: Matrix4[][] = [];
    if (mode === 'around' && axis) {
      const [count, angle] = [Math.max(1, Math.round(v[0])), v[1]];
      const step = Math.abs(angle) >= 360 ? angle / count : angle / Math.max(1, count - 1);
      for (let k = 1; k < count; k++) {
        const turn = new Matrix4().makeTranslation(axis.at).multiply(new Matrix4().makeRotationAxis(axis.dir, (k * step * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(axis.at.clone().negate()));
        // not turned: only moved where their middle goes
        const moved = turnCopies ? turn : new Matrix4().makeTranslation(middle.clone().applyMatrix4(turn).sub(middle));
        out.push(sources.map((id) => moved.clone().multiply(start.get(id)!)));
      }
      return out;
    }
    const counts = [0, 1, 2].map(pcs);
    const steps = [0, 1, 2].map((k) => way(k) * (overall ? (v[3 + k] - size.getComponent(k)) / Math.max(1, counts[k] - 1) : size.getComponent(k) + v[3 + k]));
    let index = 0;
    for (let z = 0; z < counts[2]; z++)
      for (let y = 0; y < counts[1]; y++)
        for (let x = 0; x < counts[0]; x++) {
          if (!index++) continue;
          const spin = new Matrix4().makeTranslation(middle).multiply(new Matrix4().makeRotationZ((((index - 1) * v[6]) * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(middle.clone().negate()));
          const move = new Matrix4().makeTranslation(x * steps[0], y * steps[1], z * steps[2]).multiply(spin);
          out.push(sources.map((id) => move.clone().multiply(start.get(id)!)));
        }
    return out;
  };
  const apply = () => {
    // counts and degrees as numbers, the spacings as lengths (mm)
    const v = texts.map((t, i) => (mode === 'grid' && i >= 3 && i < 6 ? (length(t) ?? 0) : Number(t) || 0));
    const copies = placements(v).flatMap((worlds, k) => {
      const { bodies } = copiesOf(doc0.bodies.filter((b) => sources.includes(b.id)), [], ` ${k + 2}`, linkedCopies);
      return bodies.map((b, n) => ({ ...b, ...placementIn(parentPlace(sources[n]), worlds[n]) }));
    });
    const next = { ...doc0, bodies: [...doc0.bodies, ...copies] };
    if (history.current === doc0) history.push(next);
    else history.replace(next);
    update();
  };
  const change = (t: string[]) => ((texts = t), apply());
  const switcher = Object.assign(document.createElement('span'), { className: 'segmented' });
  (['grid', 'around'] as const).forEach((k) => {
    const b = Object.assign(document.createElement('button'), { textContent: k === 'grid' ? 'Grid' : 'Around', className: k === mode ? 'on' : '', onclick: () => k !== mode && (panel.end(false), patternTool(k)) });
    switcher.append(b);
  });
  /** How many along axis `k`, and which way (negative: the other way). */
  const pcs = (k: number) => Math.max(1, Math.abs(Math.round(Number(texts[k]) || 1)));
  const way = (k: number) => (Math.round(Number(texts[k]) || 1) < 0 ? -1 : 1);
  /** How far from the selection's start a point lies along axis `k` (mm): the gap, or overall, that ends the last copy there. */
  const reach = (k: number) => (p: Vector3) => {
    const d = way(k) > 0 ? p.getComponent(k) - box.min.getComponent(k) : box.max.getComponent(k) - p.getComponent(k);
    return [overall ? d : pcs(k) > 1 ? (d - pcs(k) * size.getComponent(k)) / (pcs(k) - 1) : 0]; // replaces the field's value
  };
  const fields =
    mode === 'around'
      ? [{ label: 'Count', value: '6', raw: true, int: true }, { label: 'Angle °', value: '360', raw: true }]
      : [
          ...['X', 'Y', 'Z'].map((a, k) => ({ label: `${a} pcs`, value: k ? '1' : '3', raw: true, int: true, title: `${a} pcs: how many along ${a} (negative: the other way)` })),
          ...['X', 'Y', 'Z'].map((a, k) => ({ label: a, value: fmt(5 / u), reach: reach(k), title: `${a} gap: between the copies` })),
          { label: 'Turn °', value: '0', raw: true },
        ];
  const link = checkbox('Linked', 'The copies are linked copies: they share their steps, editing one edits all of them', linkedCopies, (on) => ((linkedCopies = on), apply()));
  // around: another axis, the values kept
  const setAxis = panelButton('Set axis', 'Click another axis: an edge or line, a circle (its centre) or a point (Z through it)', () => {
    toolHint = 'Pattern around: click the new axis · [Esc] keeps this one';
    render();
    viewer.pickAxis(
      (a) => {
        tips.cursorTip(null);
        viewer.showAxis(null);
        toolHint = null;
        if (a) (axis = a), apply(), angles?.show();
        render();
      },
      (a) => (tips.cursorTip(a ? `${a.what}\nClick: copies go round it` : null), viewer.showAxis(a, a?.at, 60)),
    );
  });
  const extra =
    mode === 'around'
      ? [switcher, link, checkbox('Turn copies', 'Copies turn with the pattern (else only move)', true, (on) => ((turnCopies = on), apply())), setAxis]
      : [switcher, link, checkbox('Overall', 'The spacing fields are the whole size from the first copy\'s start to the last one\'s end, not the gap between copies', false, (on) => {
          overall = on;
          panel.inputs.slice(3, 6).forEach((input, k) => {
            const label = input.previousElementSibling as HTMLElement;
            label.title = input.title = `${'XYZ'[k]} ${on ? "overall: from the first copy's start to the last one's end" : 'gap: between the copies'}`;
            // the same spacing, written the other way: overall = pcs × size + (pcs − 1) × gap
            const [n, s, v] = [pcs(k), size.getComponent(k), length(input.value || '0') ?? 0];
            input.value = fmt((on ? n * s + (n - 1) * v : n > 1 ? (v - n * s) / (n - 1) : 0) / u);
          });
          panel.inputs[3].dispatchEvent(new Event('input'));
        })];
  const panel = valuePanel(fields, change, (ok) => (angles?.end(), ok ? render() : history.current !== doc0 ? undo() : render()), mode === 'around' ? 'Pattern around: how many, over how many degrees · counting the original · [Enter] keeps them · [Esc] leaves nothing' : 'Pattern grid: counts and gaps · along X / Y / Z, the gap between copies (or Overall), a turn per copy · [Enter] keeps them · [Esc] leaves nothing', extra);
  texts = fields.map((f) => f.value);
  // around: the sweep, from the selection's middle; grid: each copy's turn, while it is in use
  const turnField = panel.inputs[mode === 'around' ? 1 : 6];
  const angles = angleControl({
    input: turnField,
    axis: () => {
      if (mode === 'grid') return document.activeElement === turnField || (Number(turnField.value) || 0) !== 0 ? { at: box.getCenter(new Vector3()), dir: new Vector3(0, 0, 1), zero: new Vector3(1, 0, 0) } : null;
      if (!axis) return null;
      const mid = box.getCenter(new Vector3());
      const at = axis.at.clone().addScaledVector(axis.dir, mid.clone().sub(axis.at).dot(axis.dir));
      const zero = mid.sub(at);
      if (zero.lengthSq() < 1e-9) zero.set(axis.dir.z > 0.9 ? 1 : 0, 0, axis.dir.z > 0.9 ? 0 : 1).cross(axis.dir);
      return { at, dir: axis.dir, zero: zero.normalize() };
    },
  });
  turnField.parentElement!.append(angles.buttons());
  turnField.addEventListener('input', angles.show);
  turnField.addEventListener('focus', angles.show);
  turnField.addEventListener('blur', angles.show);
  apply();
  angles.show();
}

/**
 * Mirror: selected sketch shapes across a line or edge clicked next (mirrored copies beside them); else the selected
 * bodies (or those clicked next, Enter) across a face clicked next (empty space: the base plane facing you): mirrored
 * copies as new bodies (a Mirror step ends each). One undo step; Esc leaves nothing.
 */
function mirrorTool() {
  const sketch = activeSketch();
  const frame = viewer.sketches.find((v) => v.id === sketch)?.frame;
  if (sketch && frame && shapeSel.length) {
    toolHint = 'Mirror: click the line or edge to mirror across · [Esc] cancels';
    render();
    return viewer.pickAxis(
      (a) => {
        tips.cursorTip(null);
        viewer.showAxis(null);
        toolHint = null;
        if (!a) return render();
        const [pu, pv] = uvOf(frame, a.at);
        const [du, dv] = [a.dir.dot(new Vector3(...frame.x)), a.dir.dot(new Vector3(...frame.y))];
        const l = Math.hypot(du, dv);
        if (l < 0.5) return fail("The line has to lie in the sketch's plane");
        const [ux, uy] = [du / l, dv / l];
        const flip = ([x, y]: [number, number]): [number, number] => {
          const k = (x - pu) * ux + (y - pv) * uy;
          return [+fmt(2 * (pu + k * ux) - x), +fmt(2 * (pv + k * uy) - y)];
        };
        const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
        const doc = history.current;
        const k = doc.sketches.findIndex((s) => s.id === sketch);
        const shown = viewer.sketches.find((v) => v.id === sketch)!.shapes;
        const copies = doc.sketches[k].shapes.filter((q) => shapeSel.includes(q.id)).map((q): Profile => {
          const p = shown.find((x) => x.id === q.id)!;
          const id = newId();
          if (p.kind === 'line' || p.kind === 'polygon') return { ...q, id, ...((q as { sizes?: (SideSize | null)[] }).sizes ? { sizes: (q as { sizes: (SideSize | null)[] }).sizes.map((z) => z && (({ deg: _d, base: _b, ...keep }) => keep)(z)) } : {}), ...(p.kind === 'polygon' ? { rot: ex(0) } : {}), ...(({ pts, curves }) => ({ pts, ...(curves ? { curves } : {}) }))(mapPoints(bakeTurn(p), flip)) } as Profile;
          const [x, y] = flip([p.x, p.y]);
          const rot = p.kind === 'rect' ? { rot: ex(fmt(2 * deg - p.rot)) } : p.kind === 'ngon' ? { rot: ex(fmt(2 * deg - p.rot - 180)) } : {};
          return { ...q, id, x: len(x), y: len(y), ...rot } as Profile;
        });
        shapeSel = copies.map((q) => q.id);
        commit(setIn(doc, ['sketches', String(k), 'shapes'], [...doc.sketches[k].shapes, ...copies]));
      },
      (a) => (tips.cursorTip(a ? `${a.what}\nClick: mirror across it` : null), viewer.showAxis(a, a?.at, 60)),
    );
  }
  const bodies = selected.filter((id) => history.current.bodies.some((b) => b.id === id));
  if (!bodies.length) {
    const picked: string[] = [];
    pending = {
      tool: 'shell',
      pick(id) {
        picked.splice(0, picked.length, ...(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]));
        selected = [...picked];
        showSelection();
      },
      apply() {
        cancelPending();
        if (picked.length) mirrorTool();
        else render();
      },
    };
    toolHint = 'Mirror: click the bodies to mirror · again: not · then [Enter] · or select sketch shapes first · [Esc] cancels';
    return render();
  }
  toolHint = 'Mirror: click the face to mirror across · empty space: the base plane facing you · [Esc] cancels';
  render();
  const option = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel' });
  option.append(checkbox('Linked', 'The mirrored copies are linked copies: they share their steps, editing one edits all of them', linkedCopies, (on) => (linkedCopies = on)));
  document.body.append(option);
  atTop(option);
  viewer.pickFace((face) => {
    option.remove();
    toolHint = null;
    if (!face) return render();
    const doc = history.current;
    const sources = doc.bodies.filter((b) => bodies.includes(b.id));
    const { bodies: copies } = copiesOf(sources, [], ' mirrored', linkedCopies);
    const made = copies.map((c, i) => {
      // the plane in the copy's coordinates: those of the body it was copied from
      const pl = bodyPlace(sources[i].id);
      return { ...c, features: [...c.features, { id: newId(), type: 'mirror' as const, o: unplaced(pl, face.point.toArray()), n: unplaced(pl, face.normal.toArray(), true) }] };
    });
    selected = made.map((b) => b.id);
    commit({ ...doc, bodies: [...doc.bodies, ...made] });
  });
}

/**
 * Thread: the round face of a hole or a shaft clicked: a real thread (ISO basic profile) cut into it from its end
 * nearest the click, all along it. A panel: Metric / Imperial (as the document's units first), the size (the one
 * fitting the face first: a shaft by its diameter, a hole by its tap drill), which fills Ø and Pitch (both editable),
 * and the length (T: to a point). Live, one undo step; Esc leaves nothing.
 */
function threadTool() {
  toolHint = 'Thread: click a round face · of a hole or a shaft · [Esc] cancels';
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    const round = face?.round;
    if (!face?.body || !round) return face ? fail("Click a round face: a hole's wall or a shaft's side") : render();
    const body = face.body;
    // from the end nearest the click, into the face
    const far = face.point.clone().sub(round.at).dot(round.dir) > round.length / 2;
    const [start, dir] = far ? [round.at.clone().addScaledVector(round.dir, round.length), round.dir.clone().negate()] : [round.at.clone(), round.dir.clone()];
    const doc = history.current;
    const u = UNITS[doc.units];
    let system: ThreadSize['system'] = ['in', 'ft'].includes(doc.units) ? 'imperial' : 'metric';
    let size = fitting(2 * round.r, !round.shaft, system);
    const i = stepsOf(doc, body);
    const pl = bodyPlace(body);
    const feature: Feature = { id: newId(), type: 'thread', at: unplaced(pl, start.toArray()), dir: unplaced(pl, dir.toArray(), true), r: round.r, inside: !round.shaft, size: size.name, d: len(size.d), pitch: len(size.pitch), length: len(round.length) };
    [selected, shapeSel] = [[body], []];
    commit(setIn(doc, ['bodies', String(i), 'features'], [...doc.bodies[i].features, feature]));
    const j = history.current.bodies[i].features.length - 1;
    const path = ['bodies', String(i), 'features', String(j)];
    const write = ([d, p, l]: string[]) => {
      const f = getIn(history.current, path) as Feature;
      history.replace(setIn(history.current, path, { ...f, size: size.name, d: { e: d, u: doc.units }, pitch: { e: p, u: doc.units }, length: { e: l, u: doc.units } }));
      update();
    };
    // the size list (of the chosen system) fills Ø and Pitch
    const pick = Object.assign(document.createElement('select'), { title: 'The thread size: fills Ø and Pitch' });
    const fill = () => {
      panel.inputs[0].value = fmt(size.d / u);
      panel.inputs[1].value = fmt(size.pitch / u);
      panel.inputs[0].dispatchEvent(new Event('input'));
    };
    const options = () => pick.replaceChildren(...THREADS.filter((t) => t.system === system).map((t) => Object.assign(document.createElement('option'), { value: t.name, textContent: t.name, selected: t.name === size.name })));
    pick.onchange = () => ((size = THREADS.find((t) => t.name === pick.value)!), fill());
    const systems = Object.assign(document.createElement('span'), { className: 'segmented' });
    for (const k of ['metric', 'imperial'] as const) {
      const b = Object.assign(document.createElement('button'), { textContent: k === 'metric' ? 'Metric' : 'Imperial', className: k === system ? 'on' : '' });
      b.onclick = () => {
        system = k;
        [...systems.children].forEach((x) => x.classList.toggle('on', x === b));
        size = fitting(2 * round.r, !round.shaft, system);
        options();
        fill();
      };
      systems.append(b);
    }
    options();
    const panel = valuePanel(
      [
        { label: 'Ø', value: fmt(size.d / u) },
        { label: 'Pitch', value: fmt(size.pitch / u) },
        { label: 'Length', value: fmt(round.length / u), reach: (p) => p.clone().sub(start).dot(dir) },
      ],
      write,
      (ok) => (ok ? render() : undo()),
      `Thread ${round.shaft ? 'on a shaft' : 'in a hole'} Ø ${fmt(2 * round.r)} mm: pick its size · or type Ø and pitch · its length (T: to a point) · [Enter] keeps it · [Esc] leaves nothing`,
      [systems, pick],
    );
  });
}

/**
 * Bulge: a face bulged out smoothly, its rim kept (flat: domed; round: swelling along its axis), or closed sketch
 * shapes domed into a body of their own. What is selected (a face picked with Alt-click or last clicked on a selected
 * body; a sketch's selected shapes), else what is clicked next. A panel: Amount (T: to a point), the curve (a preset
 * or Fullness), the peak's X / Y / Z from the face's middle (T: to a point, all three). Live, one undo step.
 */
function bulgeTool() {
  const sketch = activeSketch();
  if (sketch && shapeSel.length) return bulgeOn({ sketch, shapes: shapeSel });
  const last = viewer.lastFaceItem();
  const face = viewer.pickedFaceItems()[0] ?? (last && selected.includes(last.body) ? last : null);
  if (face) return viewer.dropPicked(), bulgeOn(face);
  toolHint = 'Bulge: click a face or sketch shape · a flat face domes, a round one swells · a closed sketch shape: a dome of its own · [Esc] cancels';
  render();
  viewer.pickFace(
    (picked) => {
      toolHint = null;
      if (picked?.sketch) return bulgeOn({ sketch: picked.sketch.id, shapes: [picked.sketch.shape] });
      if (picked?.item) return bulgeOn(picked.item);
      render();
    },
    false,
    true,
  );
}

/**
 * Draft: a flat face (Alt-picked, or clicked next) turned about its hinge (its bottom side first), its far side
 * inward; then its panel (see `draftPanel`).
 */
function draftTool() {
  const last = viewer.lastFaceItem();
  const face = viewer.pickedFaceItems()[0] ?? (last && selected.includes(last.body) ? last : null);
  if (face) return viewer.dropPicked(), draftOn(face);
  toolHint = 'Draft: click the face to draft (a flat one) · [Esc] cancels';
  render();
  viewer.pickFace((picked) => {
    toolHint = null;
    if (picked?.item) return draftOn(picked.item);
    render();
  });
}

/** A new draft on a flat face, 5° about its lowest side, then its panel. */
function draftOn(face: FaceItem) {
  const { corners } = viewer.faceSize(face);
  if (!corners) return fail('Only flat faces can be drafted');
  // the hinge: the side of its smallest rectangle lowest down (world)
  const sides = corners.map((c, k): [Vector3, Vector3] => [c, corners[(k + 1) % 4]]);
  const [a, b] = sides.reduce((low, s) => (s[0].z + s[1].z < low[0].z + low[1].z - 1e-6 ? s : low));
  const doc = history.current;
  const pl = bodyPlace(face.body);
  const i = stepsOf(doc, face.body);
  const feature: Feature = { id: newId(), type: 'draft', at: unplaced(pl, face.point.toArray()), n: unplaced(pl, face.n.toArray(), true), axis: { at: unplaced(pl, a.toArray()), dir: unplaced(pl, b.clone().sub(a).toArray(), true) }, angle: ex('5') };
  [selected, shapeSel] = [[face.body], []];
  commit(setIn(doc, ['bodies', String(i), 'features'], [...doc.bodies[i].features, feature]));
  draftPanel(doc.bodies[i].id, feature.id, true);
}

/**
 * A draft's panel: Angle ° (the orange indicator at its hinge; also dragging its body up and down, Shift in angle
 * steps, A / Shift A finer / coarser) and Set axis (an edge or line: the hinge, laid into the face's plane; while
 * picking it the draft is off). Live; `fresh`: Esc leaves nothing, else Esc puts it back.
 */
function draftPanel(body: string, id: string, fresh = false, degPerPx = 0.2) {
  const doc0 = history.current;
  const i = doc0.bodies.findIndex((b) => b.id === body);
  const j = doc0.bodies[i]?.features.findIndex((f) => f.id === id) ?? -1;
  if (doc0.bodies[i]?.features[j]?.type !== 'draft') return;
  const path = ['bodies', String(i), 'features', String(j)];
  const now = () => getIn(history.current, path) as DraftFeature;
  const pl = bodyPlace(body);
  const change = (next: Doc) => {
    if (fresh || history.current !== doc0) history.replace(next);
    else history.push(next);
    update();
  };
  const setAngle = (e: string, doc = history.current) => setIn(doc, [...path, 'angle'], { e, u: 'mm' });
  let picking = false;
  // the angle at the hinge: from the face as it was, turning inward
  const hinge = () => {
    const f = now();
    const [n, h] = [new Vector3(...inWorld(pl, f.n, true)).normalize(), new Vector3(...inWorld(pl, f.axis.dir, true)).normalize()];
    const at = new Vector3(...inWorld(pl, f.axis.at));
    const d = n.clone().cross(h);
    if (d.dot(new Vector3(...inWorld(pl, f.at)).sub(at)) < 0) d.negate();
    // turned about the hinge the way that tips the face inward, so the angle reads as typed
    if (h.clone().cross(d).dot(n) > 0) h.negate();
    return { at, dir: h, zero: d };
  };
  const ticks = () => {
    const { at, dir } = hinge();
    viewer.showAxis({ at, dir, what: '' }, at, 40);
    angles.show();
  };
  // a press on the body: dragging up turns the face further, down back (a press elsewhere still turns the view)
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || picking || angles.armed() || !(e.target instanceof HTMLCanvasElement) || viewer.hit(e)?.object.userData.bodyId !== body) return;
    e.stopPropagation();
    const field = panel.inputs[0];
    field.blur();
    const [y0, a0] = [e.clientY, Number(field.value) || 0];
    const move = (m: PointerEvent) => {
      m.stopPropagation();
      const step = role(m, 'constrain') ? SketchTool.angleStep : role(m, 'precise') ? settings.minAngle : 1;
      const text = fmt(Math.round((a0 + (y0 - m.clientY) * degPerPx) / step) * step);
      if (text === field.value || !field.isConnected) return; // Esc or Enter while dragging ended the panel
      field.value = text;
      change(setAngle(text));
      ticks();
    };
    const up = (u: PointerEvent) => {
      u.stopPropagation();
      removeEventListener('pointermove', move, { capture: true });
      removeEventListener('pointerup', up, { capture: true });
    };
    addEventListener('pointermove', move, { capture: true });
    addEventListener('pointerup', up, { capture: true });
  };
  const setAxis = panelButton('Set axis', 'Click an edge or line: the hinge it turns about (laid into the face)', () => {
    if (picking) return;
    angles.disarm();
    picking = true;
    const kept = now().angle.e;
    change(setAngle('0'));
    viewer.showTicks(null);
    viewer.pickAxis(
      (a) => {
        picking = false;
        tips.cursorTip(null);
        const f = now();
        const typed = panel.inputs[0].value || '0';
        const back = setAngle(length(typed) !== null ? typed : kept);
        if (!a) change(back);
        else {
          // laid into the face's plane
          const n = new Vector3(...f.n).normalize();
          const [p, d] = [new Vector3(...unplaced(pl, a.at.toArray())), new Vector3(...unplaced(pl, a.dir.toArray(), true))];
          p.addScaledVector(n, -p.clone().sub(new Vector3(...f.at)).dot(n));
          d.addScaledVector(n, -d.dot(n));
          if (d.lengthSq() < 1e-6) (fail('That stands square to the face: pick one along it'), change(back));
          else change(setIn(back, [...path, 'axis'], { at: p.toArray(), dir: d.normalize().toArray() }));
        }
        ticks();
      },
      (a) => (tips.cursorTip(a ? `${a.what}\nClick: the draft turns about it` : null), viewer.showAxis(a, a?.at, 60)),
    );
  });
  const panel = valuePanel(
    [{ label: 'Angle °', value: now().angle.e, raw: true, step: 0.1, title: 'Angle °: how far the face turns about its hinge, inward (negative: outward)' }],
    ([t]) => (change(setAngle(t)), !picking && ticks()),
    (ok) => {
      removeEventListener('pointerdown', press, { capture: true });
      angles.end();
      viewer.showAxis(null);
      if (ok || !(fresh || history.current !== doc0)) render();
      else undo();
    },
    'Draft: drag the body up / down or type the angle (inward; negative: outward) · [Shift] angle steps, [A] / [Shift A] finer / coarser, [Ctrl] precise · Set axis: the hinge it turns about (its bottom side first) · [Enter] keeps it · [Esc] ' + (fresh ? 'leaves nothing' : 'puts it back'),
    [setAxis],
  );
  const angles = angleControl({ input: panel.inputs[0], axis: hinge, idle: () => !picking });
  panel.inputs[0].parentElement!.append(angles.buttons());
  addEventListener('pointerdown', press, { capture: true });
  ticks();
}

/** Bulges a face or sketch shapes (see `bulgeTool`): a new bulge, its peak 10 mm out (a round face: half its radius), then its panel. */
function bulgeOn(on: FaceItem | { sketch: string; shapes: string[] }) {
  const doc = history.current;
  const base = { id: newId(), type: 'bulge' as const, fullness: ex('1') };
  const peak = (v: Vector3 | number[]) => (Array.isArray(v) ? v : v.toArray()).map((x) => len(x)) as BulgeFeature['peak'];
  let i: number;
  if ('sketch' in on) {
    const s = viewer.sketches.find((v) => v.id === on.sketch);
    const shapes = s?.shapes.filter((q) => on.shapes.includes(q.id) && !q.construction && q.kind !== 'line') ?? [];
    if (!s || !shapes.length) return fail('Bulge needs closed sketch shapes');
    const feature: BulgeFeature = { ...base, on: { kind: 'sketch', sketch: s.id, shapes: shapes.map((q) => q.id) }, peak: peak(new Vector3(...s.frame.n).multiplyScalar(10)) };
    const sk = doc.sketches.find((k) => k.id === s.id)!;
    const body = newBody(doc.bodies.length, [feature], sk.plane.kind === 'base' ? sk.group : null);
    body.name = `Bulge ${doc.bodies.filter((b) => b.features.some((x) => x.type === 'bulge')).length + 1}`;
    i = doc.bodies.length;
    [selected, shapeSel] = [[body.id], []];
    commit({ ...doc, bodies: [...doc.bodies, body] });
  } else {
    if (on.finish) return fail('Bulge works on flat and round faces, not on fillets or chamfers');
    const pl = bodyPlace(on.body);
    const r = on.round;
    let feature: BulgeFeature;
    if (r) {
      // out towards where it was clicked: a shaft swells, a hole narrows
      const w = on.point.clone().sub(r.at);
      const out = w.sub(r.dir.clone().multiplyScalar(w.dot(r.dir))).normalize();
      feature = { ...base, on: { kind: 'round', at: unplaced(pl, r.at.toArray()), dir: unplaced(pl, r.dir.toArray(), true), r: r.r, length: r.length, shaft: r.shaft }, peak: peak(unplaced(pl, out.multiplyScalar(r.r * (r.shaft ? 1.5 : 0.5)).toArray(), true)) };
    } else feature = { ...base, on: { kind: 'face', at: unplaced(pl, on.point.toArray()), mid: unplaced(pl, viewer.faceCentre(on).toArray()), half: viewer.faceHalf(on), n: unplaced(pl, on.n.toArray(), true) }, peak: peak(unplaced(pl, on.n.clone().multiplyScalar(10).toArray(), true)) };
    i = stepsOf(doc, on.body);
    [selected, shapeSel] = [[on.body], []];
    commit(setIn(doc, ['bodies', String(i), 'features'], [...doc.bodies[i].features, feature]));
  }
  bulgePanel(history.current.bodies[i].id, history.current.bodies[i].features.at(-1)!.id, true);
}

/**
 * A bulge's panel: its peak X / Y / Z from the face's middle (T: a clicked point, all three) and Fullness (-4 pointy,
 * 0 a pillow, 1 a dome, 4 flat topped). Live; `fresh` (just made): Esc leaves nothing, else Esc puts it back.
 */
function bulgePanel(body: string, id: string, fresh = false) {
  const doc0 = history.current;
  const i = doc0.bodies.findIndex((b) => b.id === body);
  const j = doc0.bodies[i]?.features.findIndex((f) => f.id === id) ?? -1;
  const feature = doc0.bodies[i]?.features[j];
  if (feature?.type !== 'bulge') return;
  const path = ['bodies', String(i), 'features', String(j)];
  const u = doc0.units;
  const pl = bodyPlace(body);
  // the face's middle (world), from which the peak counts
  const on = resolve(feature.on, paramLookup(doc0.params), '', new Map()) as BulgeFeature['on'];
  let middle: Vector3;
  if (on.kind === 'face') middle = new Vector3(...inWorld(pl, on.mid));
  else if (on.kind === 'round') middle = new Vector3(...inWorld(pl, on.at)).addScaledVector(new Vector3(...unplaced(pl, on.dir, true)).normalize(), on.length / 2);
  else {
    const s = viewer.sketches.find((v) => v.id === on.sketch);
    const shapes = s?.shapes.filter((q) => on.shapes.includes(q.id)) ?? [];
    middle = shapes.reduce((sum, q) => sum.add(new Vector3(...toWorld(s!.frame, ...centre(q)))), new Vector3()).divideScalar(Math.max(1, shapes.length));
  }
  // To object: only the height goes to the clicked point (across the face; a round face: how far from its axis)
  const local = (v: Vector3) => new Vector3(...unplaced(pl, v.toArray(), true));
  const axis = on.kind === 'round' ? new Vector3(...on.dir).normalize() : null;
  const normal = on.kind === 'face' ? new Vector3(...on.n) : on.kind === 'sketch' ? local(new Vector3(...(viewer.sketches.find((v) => v.id === on.sketch)?.frame.n ?? [0, 0, 1]))) : null;
  const reach = (p: Vector3) => {
    const q = local(p.clone().sub(middle));
    const now = new Vector3(...panel.inputs.slice(0, 3).map((i) => length(i.value || '0') ?? 0));
    if (!axis) return now.addScaledVector(normal!, q.dot(normal!) - now.dot(normal!)).toArray();
    const along = now.dot(axis);
    const out = now.clone().addScaledVector(axis, -along);
    if (out.lengthSq() < 1e-12) out.copy(new Vector3(1, 0, 0).cross(axis).lengthSq() > 1e-6 ? new Vector3(1, 0, 0).cross(axis) : new Vector3(0, 1, 0).cross(axis));
    return axis.clone().multiplyScalar(along).addScaledVector(out.normalize(), q.clone().addScaledVector(axis, -q.dot(axis)).length()).toArray();
  };
  const write = (texts: string[]) => {
    // across a flat face: kept within half its size (the height not), in the fields too
    if (on.kind === 'face')
      for (let k = 0; k < 3; k++) {
        const mm = Number(texts[k]) * UNITS[u];
        if (Math.abs(on.n[k]) < 0.1 && Math.abs(mm) > on.half[k]) panel.inputs[k].value = texts[k] = fmt((Math.sign(mm) * on.half[k]) / UNITS[u]);
      }
    const [x, y, z] = texts;
    let k = texts[3];
    // fullness kept between -4 and 4, in its field too
    const full = Number(k);
    if (Number.isFinite(full) && Math.abs(full) > 4) panel.inputs[3].value = k = String(Math.sign(full) * 4);
    const next = setIn(history.current, path, { ...(getIn(history.current, path) as BulgeFeature), peak: [x, y, z].map((e) => ({ e, u })) as BulgeFeature['peak'], fullness: { e: k, u: 'mm' } });
    if (fresh || history.current !== doc0) history.replace(next);
    else history.push(next);
    update();
  };
  const panel = valuePanel(
    [
      ...(['X', 'Y', 'Z'] as const).map((a, k) => ({ label: a, value: feature.peak[k].e, title: `Peak ${a}: the high point from the face's middle (across the face: its height)`, ...(k === 2 ? { reach } : {}) })),
      { label: 'Fullness', value: feature.fullness.e, raw: true, step: 0.01, title: 'Fullness: -4 pointy, 0 a pillow, 1 a dome, 4 flat topped' },
    ],
    write,
    (ok) => (ok ? render() : fresh || history.current !== doc0 ? undo() : render()),
    'Bulge: where its peak is · X / Y / Z from the middle; across the face: its height (negative: a dent) · T: the height to a point · Fullness: -4 pointy, 0 pillow, 1 dome, 4 flat top · [Enter] keeps it · [Esc] ' + (fresh ? 'leaves nothing' : 'puts it back'),
  );
}

/**
 * Offset / Shell: the selected sketch shapes get new outlines a distance outside them (negative: inside; a line moves
 * to its left); else a body (selected, or clicked next) is hollowed: its faces clicked one by one are left open
 * (Enter), then its wall thickness. Both live, one undo step; Esc leaves nothing.
 */
function offsetTool() {
  const sketch = activeSketch();
  if (sketch && shapeSel.length) return offsetShapes(sketch);
  const body = selected.find((id) => history.current.bodies.some((b) => b.id === id));
  if (!body) {
    pending = { tool: 'shell', pick: (id) => (cancelPending(), (selected = [id]), showSelection(), offsetTool()) };
    toolHint = 'Offset: select sketch shapes first · or click a body to hollow it (shell) · [Esc] cancels';
    return render();
  }
  // the shell shows at once (closed, 2 mm walls); each face clicked opens live; one undo step
  const doc0 = history.current;
  const i = stepsOf(doc0, body);
  const path = ['bodies', String(i), 'features', String(doc0.bodies[i].features.length)];
  const open: [number, number, number][] = [];
  commit(setIn(doc0, ['bodies', String(i), 'features'], [...doc0.bodies[i].features, { id: newId(), type: 'shell' as const, thickness: len(2), open }]));
  let ended = false;
  const keys = (e: KeyboardEvent) => pressed(e, 'confirm') && (e.stopImmediatePropagation(), e.preventDefault(), walls());
  const stop = () => ((ended = true), removeEventListener('keydown', keys, { capture: true }), viewer.cancelFacePick());
  const next = () => {
    toolHint = `Shell: click the faces to leave open · ${open.length} so far; none: closed, hollow inside · [Enter] then the wall thickness · [Esc] leaves nothing`;
    render();
    viewer.pickFace((face) => {
      if (ended) return;
      if (!face) return stop(), (toolHint = null), undo();
      if (face.body === body) {
        open.push(unplaced(bodyPlace(body), face.point.toArray()));
        history.replace(setIn(history.current, [...path, 'open'], [...open]));
        update();
      }
      next();
    });
  };
  const walls = () => {
    stop();
    const u = history.current.units;
    valuePanel([{ label: 'Wall', value: fmt(2 / UNITS[u]), reach: nearestSide, title: 'Wall: how thick · T: the distance from a point to the nearest side of the body' }], ([t]) => (history.replace(setIn(history.current, [...path, 'thickness'], { e: t, u })), update()), (ok) => (ok ? render() : undo()), 'Shell: the wall thickness · type or scrub it · [Enter] keeps it · [Esc] leaves nothing');
  };
  addEventListener('keydown', keys, { capture: true });
  next();
}

/** The Interference and clearance panel at work: everything see-through; a change to the design checks again. */
let clashXray = false;
let clashAgain: (() => void) | null = null;
let clashClose: (() => void) | null = null;

/** Joint `j` from Min to Max, the others where they are: where things are along it, its way in the world. Null: it has no way. */
function jointWay(doc: Doc, j: Joint) {
  const lookup = paramLookup(doc.params);
  const value = (e: Expr) => (j.kind === 'hinge' ? evalQuantity(e, lookup).v : evalLength(e, lookup));
  const [lo, hi] = [value(j.min), value(j.max)];
  if (!(hi > lo)) return null;
  const at = (v: number) => jointed(doc, ownPlaces, (x) => (x === j ? v : jointValue(x, lookup))).placed;
  const [from, to] = [at(lo), at(hi)];
  const parent = from.get(j.parent) ?? new Matrix4();
  const sweep = { kind: j.kind, at: new Vector3(...j.axis.at).applyMatrix4(parent).toArray(), dir: new Vector3(...j.axis.dir).transformDirection(parent).toArray(), amount: hi - lo };
  return { lo, hi, at, from, to, sweep };
}

/**
 * What to check: `ids` (null: everything) against all shown bodies, grown by `clearance`; joints through Min to Max.
 * Tool bodies are skipped (their cuts count), hidden bodies and meshes are left out (`left`: how many).
 */
function clashAsk(doc: Doc, ids: string[] | null, clearance: number, joints: boolean, ignore: Iterable<string>): { ask: ClashAsk; left: number } {
  const owners = ownersOf(doc);
  const usable = doc.bodies.filter((b) => b.visible && !owners.has(b.id) && !meshOnly(b.id));
  const of = ids ? contents(doc, ids).filter((id) => usable.some((b) => b.id === id)) : usable.map((b) => b.id);
  const motions = !joints
    ? []
    : doc.joints.flatMap((j) => {
        const way = jointWay(doc, j);
        if (!way) return [];
        const { lo, hi, at, from, to, sweep } = way;
        const movers = usable.filter((b) => from.get(b.id) && to.get(b.id) && !from.get(b.id)!.equals(to.get(b.id)!));
        if (!movers.length) return [];
        const n = Math.min(60, Math.max(2, Math.ceil((hi - lo) / (j.kind === 'hinge' ? 3 : 1))));
        const steps = Array.from({ length: n + 1 }, (_, k) => lo + ((hi - lo) * k) / n).map((v) => {
          const placed = at(v);
          return { value: v, places: Object.fromEntries(movers.map((b) => [b.id, toPlace(placed.get(b.id)!)])) };
        });
        return [{ joint: j.id, sweep, steps }];
      });
  return { ask: { bodies: usable.map((b) => ({ id: b.id, place: bodyPlace(b.id) })), of, clearance, motions, ignore: [...ignore] }, left: doc.bodies.filter((b) => !owners.has(b.id) && !usable.includes(b)).length };
}

/**
 * Interference and clearance, one tool: a floating panel, checking at once and whenever something changes. Clearance 0
 * finds real overlaps; above it each checked body also shows its zone in green, what reaches into it in red (the same
 * thing, further out). Selected bodies against all, or everything against everything; joints one at a time over their
 * whole way Min to Max, whatever their position now: the space they go through in orange, what is in it in red.
 */
function clashTool() {
  if (clashClose) return clashClose();
  const u = () => history.current.units;
  const state = { clearance: '0', scope: (selected.length ? 'selected' : 'all') as 'selected' | 'all', joints: true, xray: true, cutWide: true };
  let clearanceNow = 0;
  const ignore = new Set<string>();
  let run = 0;
  let timer = 0;
  let hits: ClashHit[] = [];
  let lit: number | null = null;
  const box = Object.assign(document.createElement('div'), { className: 'clash-panel', onmousedown: (e: MouseEvent) => e.stopPropagation() });
  const head = Object.assign(document.createElement('div'), { className: 'head' });
  head.append(Object.assign(document.createElement('h3'), { textContent: 'Interference and clearance' }), closeButton('Close (Esc)', () => clashClose?.()));
  const clearance = Object.assign(document.createElement('input'), { className: 'number', value: state.clearance, spellcheck: false, title: `0: real overlaps only. Above it: also what comes this close (${u()})` });
  Object.assign(clearance.dataset, { complete: '', noMeasure: '' });
  clearance.oninput = () => {
    state.clearance = clearance.value;
    soon();
  };
  const label = (text: string, ...els: HTMLElement[]) => {
    const l = Object.assign(document.createElement('label'), { className: 'clash-field' });
    l.append(Object.assign(document.createElement('span'), { textContent: text }), ...els);
    return l;
  };
  const scope = Object.assign(document.createElement('select'), { title: 'What is checked: against all shown bodies, or everything against everything', onchange: () => ((state.scope = scope.value as 'selected' | 'all'), soon()) });
  scope.append(new Option('Selected', 'selected', false, state.scope === 'selected'), new Option('Everything', 'all', false, state.scope === 'all'));
  const check = (text: string, on: boolean, title: string, change: (v: boolean) => void) => {
    const l = Object.assign(document.createElement('label'), { className: 'check', title });
    const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on, onchange: () => change(c.checked) });
    l.append(c, text);
    return l;
  };
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  row.append(
    label('Clearance', clearance),
    scope,
    check('Joints', state.joints, 'Each joint one at a time, its whole way Min to Max, wherever it is now', (v) => ((state.joints = v), soon())),
    check('X-ray', state.xray, 'Everything see-through, so overlaps stand out', (v) => {
      clashXray = state.xray = v;
      showSelection();
    }),
    check('Cut with clearance', state.cutWide, 'Cut … leaves the clearance as a gap. Off: the other body exactly as it is', (v) => (state.cutWide = v)),
  );
  const note = Object.assign(document.createElement('p'), { className: 'hint' });
  const list = Object.assign(document.createElement('div'), { className: 'clash-list' });
  const stopCheck = Object.assign(panelButton('Stop', 'Click: Stop checking: what it found so far stays', () => kernel.stopClash()), { hidden: true });
  box.append(head, row, note, stopCheck, list);
  document.body.append(box);
  const name = (id: string) => history.current.bodies.find((b) => b.id === id)?.name ?? '?';
  const jointName = (id?: string) => history.current.joints.find((j) => j.id === id);
  const size = (mm3: number) => `${fmt(+(mm3 / UNITS[u()] ** 3).toFixed(3))} ${u()}³`;
  const distance = (mm: number) => `${fmt(+(mm / UNITS[u()]).toFixed(4))} ${u()}`;
  const said = (h: ClashHit) => {
    const j = jointName(h.joint);
    const where = j ? ` · ${j.name}${h.value === undefined ? ' on its way' : ` from ${fmt(+h.value.toFixed(1))}${j.kind === 'hinge' ? '°' : ' mm'}`}` : '';
    const how = j && h.closest === undefined ? 'in the way' : h.closest === undefined ? `overlap ${size(h.volume)}` : h.closest > 1e-4 ? `only ${distance(h.closest)} apart` : 'touching or overlapping';
    return { pair: `${name(h.a)} ↔ ${name(h.b)}`, how: `${how}${where}` };
  };
  const light = (k: number | null) => {
    lit = k;
    viewer.lightClash(k);
    for (const [i, r] of [...list.children].entries()) r.classList.toggle('lit', i === k);
  };
  /** Cuts one body by the other, where they are or all along `along`; the other stays an ordinary body. */
  const cutFrom = (target: string, by: string, along?: string) => {
    const doc = history.current;
    const grow = state.cutWide && clearanceNow > 0 ? { grow: { e: state.clearance, u: u() } } : {};
    commit({ ...doc, bodies: doc.bodies.map((b) => (b.id === target ? { ...b, features: [...b.features, { id: newId(), type: 'boolean' as const, op: 'subtract' as const, body: by, linked: true, ...grow, ...(along ? { along } : {}) }] } : b)) });
  };
  const draw = () => {
    viewer.lightBodies([]); // its button may go under the pointer
    list.replaceChildren(
      ...hits.map((h, k) => {
        const r = Object.assign(document.createElement('div'), { className: 'clash-row', onmouseenter: () => light(k), onmouseleave: () => light(null) });
        const { pair, how } = said(h);
        const words = Object.assign(document.createElement('span'), { className: 'clash-words' });
        words.append(Object.assign(document.createElement('b'), { textContent: pair }), Object.assign(document.createElement('small'), { textContent: how }));
        r.append(words);
        const way = (target: string, by: string) =>
          h.joint ? `Click: Cut all ${name(by)} goes through on its joint's way, Min to Max, out of ${name(target)}; ${name(by)} stays as it is` : `Click: Cut ${name(by)} out of ${name(target)}, where it is; ${name(by)} stays as it is`;
        const cutButton = (target: string, by: string) =>
          Object.assign(panelButton(`Cut ${name(target)}`, way(target, by), () => cutFrom(target, by, h.joint)), { onmouseenter: () => viewer.lightBodies([target]), onmouseleave: () => viewer.lightBodies([]) });
        const actions = Object.assign(document.createElement('div'), { className: 'segmented clash-actions' });
        if (h.joint || h.volume > 0) actions.append(cutButton(h.a, h.b), cutButton(h.b, h.a));
        actions.append(panelButton('Ignore', 'Click: Leave this pair out while the panel is open (fits made to overlap, a thread, say)', () => (ignore.add(pairKey(h.a, h.b)), soon())));
        r.append(actions);
        return r;
      }),
    );
  };
  const check_ = async () => {
    const mine = ++run;
    const c = length(state.clearance || '0');
    clearance.classList.toggle('invalid', c === null || c < 0);
    if (c === null || c < 0) return;
    if (!stopCheck.hidden) kernel.stopClash(); // the one under way is out of date
    stopCheck.hidden = false;
    busy.add('Checking');
    render();
    await kernel.idle();
    const doc = history.current;
    const { ask, left } = clashAsk(doc, state.scope === 'all' ? null : selected, c, state.joints, ignore);
    const of = ask.of;
    const result = of.length ? await kernel.clash(ask) : { hits: [], zones: [], sweeps: [], failed: [] };
    if (mine !== run || !box.isConnected) return;
    busy.delete('Checking');
    stopCheck.hidden = true;
    hits = result.hits;
    viewer.showClashes(hits, result.zones, result.sweeps);
    clearanceNow = c;
    note.textContent = [
      result.stopped ? `Stopped: ${hits.length} found so far` : !of.length ? 'Select the bodies to check, or check Everything.' : hits.length ? `${hits.length} found` : c ? `All clear: nothing within ${distance(c)}` : 'All clear: no overlaps',
      left ? `${left} left out (hidden, or a mesh)` : '',
      result.failed.length ? `Could not grow ${result.failed.map(name).join(', ')} by that much` : '',
    ].filter(Boolean).join(' · ');
    draw();
    render();
  };
  const soon = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void check_(), 250);
  };
  // the overlaps in the view: hovered they say what they are, a click finds them in the list
  const over = (e: PointerEvent) => {
    if (e.buttons || !(e.target instanceof HTMLCanvasElement)) return;
    const k = viewer.clashAt(e);
    if (k !== lit) light(k);
    if (k !== null && hits[k]) {
      const { pair, how } = said(hits[k]);
      tips.cursorTip(`${pair}\n${how}`);
    } else tips.cursorTip(null);
  };
  const press = (e: PointerEvent) => {
    if (e.button !== 0 || !(e.target instanceof HTMLCanvasElement)) return;
    const k = viewer.clashAt(e);
    if (k === null) return;
    e.stopPropagation();
    addEventListener('pointerup', (u) => u.stopPropagation(), { capture: true, once: true });
    list.children[k]?.scrollIntoView({ block: 'nearest' });
    light(k);
  };
  const keys = (e: KeyboardEvent) => {
    if (!pressed(e, 'cancel')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    clashClose?.();
  };
  addEventListener('pointermove', over, { capture: true });
  addEventListener('pointerdown', press, { capture: true });
  addEventListener('keydown', keys, { capture: true });
  clashClose = () => {
    kernel.stopClash();
    run++;
    clearTimeout(timer);
    box.remove();
    removeEventListener('pointermove', over, { capture: true });
    removeEventListener('pointerdown', press, { capture: true });
    removeEventListener('keydown', keys, { capture: true });
    tips.cursorTip(null);
    viewer.showClashes([], []);
    busy.delete('Checking');
    [clashAgain, clashClose, clashXray] = [null, null, false];
    showSelection();
  };
  clashAgain = soon;
  clashXray = true;
  showSelection();
  soon();
}

/** Coat: the body (selected, or clicked next) gets a coat, 1 mm at first, shown at once; its panel has the rest. */
function coatTool() {
  const body = selected.find((id) => history.current.bodies.some((b) => b.id === id));
  if (!body) {
    pending = { tool: 'shell', pick: (id) => (cancelPending(), (selected = [id]), showSelection(), coatTool()) };
    toolHint = 'Coat: click a body · [Esc] cancels';
    return render();
  }
  const doc = history.current;
  const i = stepsOf(doc, body);
  const id = newId();
  commit(setIn(doc, ['bodies', String(i), 'features'], [...doc.bodies[i].features, { id, type: 'coat' as const, thickness: len(1), corners: 'sharp' as const, exclude: [] }]));
  coatPanel(body, id, true);
}

/** A coat's floating panel, live, one undo step: thickness, corners, the flat faces it leaves where they are. Esc: as before. */
function coatPanel(body: string, feature: string, isNew = false) {
  /** The body it coats when it is a new body of its own, made here (reopened later: none). */
  let source: string | null = null;
  const now = () => {
    const i = history.current.bodies.findIndex((b) => b.id === body);
    const k = history.current.bodies[i]?.features.findIndex((f) => f.id === feature) ?? -1;
    const f = history.current.bodies[i]?.features[k];
    return f?.type === 'coat' ? { i, k, f } : null;
  };
  let changed = isNew;
  const set = (patch: Partial<CoatFeature>) => {
    const c = now();
    if (!c) return;
    const next = setIn(history.current, ['bodies', String(c.i), 'features', String(c.k)], { ...c.f, ...patch });
    if (changed) history.replace(next);
    else history.push(next);
    changed = true;
    update();
    faces.textContent = patch.exclude ? faceWord() : faces.textContent;
  };
  const start = now();
  if (!start) return;
  const faceWord = () => {
    const n = now()?.f.exclude.length ?? 0;
    return n ? `${n} excluded` : '';
  };
  const corners = Object.assign(document.createElement('select'), { title: 'Sharp: a box stays a box. Round: the same distance everywhere', onchange: () => (picking ? viewer.cancelFacePick() : 0, set({ corners: corners.value as CoatFeature['corners'] })) });
  corners.append(new Option('Sharp corners', 'sharp', false, start.f.corners === 'sharp'), new Option('Round corners', 'round', false, start.f.corners === 'round'));
  const faces = Object.assign(document.createElement('span'), { className: 'hint', textContent: faceWord() });
  // moves the coat onto a linked copy (a skin around the body, which stays as it is) and back
  const toBody = (on: boolean) => {
    if (picking) viewer.cancelFacePick();
    const c = now();
    if (!c) return;
    const doc = history.current;
    const { skin: _, ...coat } = c.f;
    const made = on ? coatAsBody(setIn(doc, ['bodies', String(c.i), 'features'], doc.bodies[c.i].features.filter((f) => f.id !== feature)), c.i, coat) : null;
    const back = () => {
      const i = doc.bodies.findIndex((b) => b.id === source);
      const d = setIn(doc, ['bodies', String(i), 'features'], [...doc.bodies[i].features, coat]);
      return { ...d, bodies: d.bodies.filter((b) => b.id !== body) };
    };
    const next = made ? made.doc : back();
    [source, body] = made ? [body, made.id] : [null, source!];
    selected = [body];
    if (changed) history.replace(next);
    else history.push(next);
    changed = true;
    showSelection();
    update();
  };
  const asBody = checkbox('New body', start.f.skin ? 'This coat is a body of its own' : 'Click: Make the coat a body of its own, hollow around this one, which stays as it is', !!start.f.skin, toBody);
  asBody.querySelector('input')!.disabled = !!start.f.skin;
  // while picking: no coat to see past, the real faces to click, nothing else changes until it ends
  let picking = false;
  const facesButton = panelButton('Select faces to exclude', 'Click: Show the body without its coat, then click flat faces that stay where they are (again: back)', () => (picking ? viewer.cancelFacePick() : void pickFaces()));
  const pickFaces = async () => {
    const c = now();
    if (!c) return;
    picking = true;
    facesButton.textContent = 'Done with faces';
    facesButton.title = 'Click: Show the coat again';
    let chosen = c.f.exclude.flatMap((e) => ({ ...e, item: null as FaceItem | null }));
    history.replace(setIn(history.current, ['bodies', String(c.i), 'features', String(c.k)], { ...c.f, thickness: len(0) }));
    changed = true;
    update();
    await kernel.idle();
    await new Promise(requestAnimationFrame);
    chosen = chosen.map((e) => ({ ...e, item: viewer.faceItemAt(body, e.at, e.n) }));
    const next = () => {
      viewer.markFaces(chosen.flatMap((e) => e.item ?? []));
      toolHint = 'Coat: click flat faces to exclude: they stay where they are · again: back · [Esc] shows the coat again';
      render();
      viewer.pickFace((face) => {
        if (!face) {
          picking = false;
          viewer.markFaces([]);
          facesButton.textContent = 'Select faces to exclude';
          facesButton.title = 'Click: Show the body without its coat, then click flat faces that stay where they are (again: back)';
          toolHint = hint;
          set({ thickness: { e: panel.inputs[0].value || '0', u: history.current.units }, exclude: chosen.map(({ at, n }) => ({ at, n })) });
          return render();
        }
        if (face.body === body || face.body === source) {
          const pl = bodyPlace(body);
          const at = unplaced(pl, face.point.toArray());
          const n = unplaced(pl, face.normal.clone().negate().toArray(), true);
          const v = (q: Vec3) => new Vector3(...q);
          const same = (e: { at: Vec3; n: Vec3 }) => v(e.n).dot(v(n)) > 0.999 && Math.abs(v(at).sub(v(e.at)).dot(v(n))) <= 1e-3;
          chosen = chosen.some(same) ? chosen.filter((e) => !same(e)) : [...chosen, { at, n, item: face.item ?? null }];
          faces.textContent = chosen.length ? `${chosen.length} excluded` : '';
        }
        next();
      });
    };
    next();
  };
  const hint = 'Coat: how thick, live · sharp or round corners · faces to exclude · new body: a skin around it · [Enter] keeps it · [Esc] drops it';
  const panel = valuePanel(
    [{ label: 'Thickness', value: start.f.thickness.e, title: 'How much thicker, on all sides' }],
    ([t]) => picking || set({ thickness: { e: t, u: history.current.units } }),
    (ok) => {
      if (!ok && source) selected = [source]; // the new body goes with Esc
      if (ok || !changed) render();
      else undo();
    },
    hint,
    [corners, asBody, facesButton, faces],
  );
}

/** Offset of the selected shapes of `sketch`: new outlines beside them (see `offsetTool`), the distance live. */
function offsetShapes(sketch: string) {
  const doc0 = history.current;
  const k = doc0.sketches.findIndex((s) => s.id === sketch);
  const shown = viewer.sketches.find((v) => v.id === sketch)!.shapes.filter((q) => shapeSel.includes(q.id));
  const sources = doc0.sketches[k].shapes.filter((q) => shapeSel.includes(q.id));
  const ids = sources.map(() => newId());
  const made = (d: number): Profile[] =>
    sources.map((q, n) => {
      const p = shown.find((x) => x.id === q.id)!;
      const id = ids[n];
      if (q.kind === 'rect' && p.kind === 'rect') return { ...q, id, w: len(p.w + 2 * d), h: len(p.h + 2 * d), r: len(Math.max(0, p.r + d)) };
      if (q.kind === 'circle' && p.kind === 'circle') return { ...q, id, d: len(Math.max(0.01, p.d + 2 * d)) };
      if (q.kind === 'ngon' && p.kind === 'ngon') return { ...q, id, d: len(Math.max(0.01, p.d + (2 * d) / Math.cos(Math.PI / p.sides))) };
      if ((q.kind === 'polygon' && p.kind === 'polygon') || (q.kind === 'line' && p.kind === 'line')) {
        if (curved(p)) {
          const { pts, curves } = offsetPath(p, d);
          return { ...q, id, pts: roundPts(pts), curves: roundCurves(curves) } as Profile;
        }
      }
      if (q.kind === 'polygon' && p.kind === 'polygon') return { ...q, id, pts: roundPts(grown(p.pts, d)) };
      if (q.kind === 'line' && p.kind === 'line') return { ...q, id, pts: roundPts(beside(p.pts, d)) };
      return { ...q, id };
    });
  const apply = (d: number) => {
    const next = setIn(doc0, ['sketches', String(k), 'shapes'], [...doc0.sketches[k].shapes, ...made(d)]);
    if (history.current === doc0) history.push(next);
    else history.replace(next);
    update();
  };
  shapeSel = ids;
  apply(2);
  valuePanel([{ label: 'Offset', value: fmt(2 / UNITS[doc0.units]) }], ([t]) => apply(length(t) ?? 0), (ok) => (ok ? render() : undo()), 'Offset: how far outside · type or scrub it; negative: inside, a line: to its left · [Enter] keeps them · [Esc] leaves nothing');
}

/**
 * Box joint: two overlapping bodies (selected, or clicked next) cut each other into interlocking fingers across the
 * overlap's longest side, for gluing sheets; then its panel (see `fingersPanel`).
 */
function boxJoint() {
  const doc = history.current;
  const ids = selected.filter((id) => doc.bodies.some((b) => b.id === id));
  if (ids.length !== 2) {
    const picked: string[] = ids.slice(0, 1);
    pending = {
      tool: 'boolean',
      pick(id) {
        picked.splice(0, picked.length, ...(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]));
        selected = [...picked];
        showSelection();
        if (picked.length === 2) cancelPending(), boxJoint();
      },
    };
    toolHint = 'Box joint: click the two bodies that overlap · [Esc] cancels';
    return render();
  }
  const [a, b] = ids;
  const [fa, fb] = [newId(), newId()];
  const step = (body: string, first: boolean, id: string): Feature => ({ id, type: 'fingers', body, count: ex('7'), width: len(0), from: null, first });
  commit({ ...doc, bodies: doc.bodies.map((x) => (x.id === a ? { ...x, features: [...x.features, step(b, true, fa)] } : x.id === b ? { ...x, features: [...x.features, step(a, false, fb)] } : x)) });
  fingersPanel(a, fa, true);
}

/**
 * A box joint's panel, on the step that holds its values for both bodies (the first's; `id` of either leads there):
 * Fingers (1 or more, equal ones) or Finger length (above 0: exactly that long, from the overlap's low end or From a
 * point clicked, both ways; the count then empties); each shows what the other makes. Live; `fresh`: Esc leaves
 * nothing, else Esc puts it back.
 */
function fingersPanel(body: string, id: string, fresh = false) {
  const doc0 = history.current;
  const mine = doc0.bodies.find((b) => b.id === body)?.features.find((f) => f.id === id);
  if (mine?.type !== 'fingers') return;
  // the first's step holds the values
  const [owner, partner] = mine.first ? [body, mine.body] : [mine.body, body];
  const i = doc0.bodies.findIndex((b) => b.id === owner);
  const j = doc0.bodies[i]?.features.findIndex((f) => f.type === 'fingers' && f.body === partner && f.first) ?? -1;
  if (j < 0) return;
  const path = ['bodies', String(i), 'features', String(j)];
  const now = () => getIn(history.current, path) as FingersFeature;
  const u = doc0.units;
  const change = (next: Doc) => {
    if (fresh || history.current !== doc0) history.replace(next);
    else history.push(next);
    update();
  };
  // the overlap's longest side (mm), from the two bodies' boxes
  const span = () => {
    const [a, b] = [viewer.measure(owner)?.box, viewer.measure(partner)?.box];
    const o = a && b && a.clone().intersect(b);
    return o && !o.isEmpty() ? Math.max(...o.getSize(new Vector3()).toArray()) : 0;
  };
  const lengthOf = (n: number) => fmt(span() / Math.max(1, n) / UNITS[u]);
  const f0 = now();
  const byLength = (length(f0.width.e) ?? 0) > 0;
  let last = [byLength ? '' : f0.count.e, byLength ? f0.width.e : lengthOf(Number(f0.count.e) || 1)];
  const write = () => {
    const [n, w] = [panel.inputs[0], panel.inputs[1]];
    // never below 1 finger or a length of 0
    if (n.value !== '' && Number(n.value) < 1) n.value = '1';
    if ((length(w.value || '0') ?? 0) < 0) w.value = '0';
    if (w.value !== last[1] && (length(w.value || '0') ?? 0) > 0) {
      // a length counts: the count empties
      n.value = '';
      change(setIn(history.current, [...path, 'width'], { e: w.value, u }));
    } else if (n.value !== last[0] && n.value !== '') {
      // a count: the length shows what it makes
      w.value = lengthOf(Number(n.value));
      change(setIn(setIn(history.current, [...path, 'count'], ex(n.value)), [...path, 'width'], len(0)));
    }
    last = [n.value, w.value];
  };
  const fromButton = panelButton('From point', 'Fingers of the length set count from a point clicked, both ways (else from the overlap\'s low end)', () => {
    viewer.aiming = (a) => tips.cursorTip(a ? `${a.what}\nClick: the fingers count from here` : null);
    viewer.pickFace((p) => {
      viewer.aiming = null;
      viewer.aimAt(null);
      tips.cursorTip(null);
      if (p?.snap) change(setIn(history.current, [...path, 'from'], p.snap.toArray()));
      status();
    }, true);
  });
  const clearFrom = panelButton('×', 'Count from the overlap\'s low end again', () => (change(setIn(history.current, [...path, 'from'], null)), status()));
  const status = () => {
    const from = now().from;
    fromButton.textContent = from ? 'From: point' : 'From point';
    clearFrom.hidden = !from;
    viewer.showMeasureLine(from && new Vector3(...from));
  };
  const panel = valuePanel(
    [
      { label: 'Fingers', value: last[0], raw: true, int: true, title: 'Fingers: how many, all as long, across the overlap' },
      { label: 'Finger length', value: last[1], title: 'Finger length: each exactly this long, from the low end (or From a point), the rest at the end(s)' },
    ],
    write,
    (ok) => {
      viewer.showMeasureLine(null);
      if (ok || !(fresh || history.current !== doc0)) render();
      else undo();
    },
    'Box joint: how many fingers · or a finger length (exact; the count empties) · From point: the fingers count from there · [Enter] keeps it · [Esc] ' + (fresh ? 'leaves nothing' : 'puts it back'),
    [fromButton, clearFrom],
  );
  status();
}

/**
 * Measure: each point clicked is measured from the one before (along X / Y / Z, and straight; the first on an edge:
 * that edge's length), an orange line between them; Alt-click marks an edge (its length) or a face (its area; flat:
 * its sides too), Shift Alt adds or drops more of that kind (their total). Hovering marks what a click takes. The
 * values in a panel at the top of the view; a click on one copies it. Goes on until Esc.
 */
/**
 * Distance measure. With `use` another tool or field waits for it: a click on a length measured hands it over (mm) and ends this tool.
 */
/** A body that is a mesh: its triangles are all there is. */
const meshOnly = (body: string) => !!history.current.bodies.find((b) => b.id === body)?.features.some((f) => f.type === 'mesh');

function measureTool(use?: (mm: number) => void, done?: () => void) {
  // Every value here comes from the real solid (`kernel.measure`, see MeasureAsk) as soon as it answers: anything new this tool measures has to as well. Only what no solid has shows with ~.
  const u = history.current.units;
  let last: { at: Vector3; about: boolean } | null = null;
  let edges: [Vector3, Vector3][][] = [];
  let faces: FaceItem[] = [];
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel measure' });
  box.onmousedown = (e) => e.preventDefault(); // the field waiting for the value keeps the focus
  // each value's button by its label, and the line in the view it belongs to: hovering either lights both
  const buttons = new Map<string, HTMLButtonElement>();
  const light = (key: string | null) => {
    viewer.lightMeasureLeg(key);
    for (const [k, b] of buttons) b.classList.toggle('lit', k === key);
  };
  // [label, mm (an area: mm²), an area?, about only?]
  const show = (items: [string, number, boolean?, boolean?][], note = '') => {
    buttons.clear();
    box.replaceChildren(
      ...(note ? [Object.assign(document.createElement('span'), { className: 'hint', textContent: note })] : []),
      ...items.map(([label, mm, area, about]) => {
        const text = area ? `${fmt(+(mm / UNITS[u] ** 2).toFixed(4))} ${u}²` : `${fmt(+(mm / UNITS[u]).toFixed(4))} ${u}`;
        const shownText = `${about ? '~' : ''}${text}`;
        const shown = axisHtml(`${label} ${shownText}`);
        // waiting field: the value goes straight in; else copied: the button says so for a moment (the top bar shows the tool's hint)
        const b = use && !area
          ? panelButton('', `Use ${text}: it goes in the field`, () => (close(), use(mm)))
          : panelButton('', 'Click: copy', () => void navigator.clipboard.writeText(text).then(() => ((b.textContent = 'Copied ✓'), setTimeout(() => (b.innerHTML = shown), 1000))));
        b.innerHTML = shown;
        b.onmouseenter = () => light(label);
        b.onmouseleave = () => light(null);
        buttons.set(label, b);
        return b;
      }),
    );
  };
  // at the top of the view, under the panel of what waits for it
  const place = () => {
    atTop(box);
    const waiting = [...document.querySelectorAll('.axis-move:not(.measure)')].at(-1);
    if (use && waiting) box.style.top = `${waiting.getBoundingClientRect().bottom + 6}px`;
  };
  // what the solids answered, by part
  const edgeLengths = new Map<[Vector3, Vector3][], number>();
  const faceAreas = new Map<string, number>();
  const faceSides = new Map<string, [number, number]>();
  const faceKey = (f: FaceItem) => `${f.body} ${f.index}`;
  const long = (segs: [Vector3, Vector3][]) => edgeLengths.get(segs) ?? segs.reduce((n, [a, b]) => n + a.distanceTo(b), 0);
  const showParts = () => {
    if (edges.length) {
      const about = edges.some((e) => !edgeLengths.has(e));
      return show(edges.length > 1 ? [[`${edges.length} edges`, edges.reduce((n, e) => n + long(e), 0), false, about]] : [['Edge', long(edges[0]), false, about]]);
    }
    const area = (f: FaceItem) => faceAreas.get(faceKey(f)) ?? viewer.faceSize(f).area;
    const about = faces.some((f) => !faceAreas.has(faceKey(f)) && !meshOnly(f.body));
    if (faces.length > 1) return show([[`${faces.length} faces`, faces.reduce((n, f) => n + area(f), 0), true, about]]);
    const sides = faceSides.get(faceKey(faces[0])) ?? viewer.faceSize(faces[0]).sides;
    show([['Area', area(faces[0]), true, about], ...(sides ? ([['L', sides[0], false, about], ['B', sides[1], false, about]] as [string, number, boolean, boolean][]) : [])]);
  };
  /** Asks the solid for a part just picked, then shows the true values. */
  const askEdge = async (segs: [Vector3, Vector3][], ref?: PartRef) => {
    if (!ref) return;
    const [length] = await kernel.measure([{ of: 'edge', body: ref.body, edge: ref.edge! }]);
    const mesh = segs.reduce((n, [a, b]) => n + a.distanceTo(b), 0);
    if (typeof length === 'number' && Math.abs(length - mesh) < 1 + mesh * 0.05) edgeLengths.set(segs, length);
    else if (meshOnly(ref.body)) edgeLengths.set(segs, mesh);
  };
  const askFace = async (f: FaceItem) => {
    const mesh = viewer.faceSize(f);
    const asks: MeasureAsk[] = [{ of: 'face', body: f.body, face: f.index }];
    if (mesh.sides) asks.push({ of: 'sides', body: f.body, face: f.index, u: viewer.dirToBody(f.body, mesh.x!).toArray(), n: viewer.dirToBody(f.body, mesh.n!).toArray() });
    const [area, sides] = await kernel.measure(asks);
    if (typeof area === 'number') faceAreas.set(faceKey(f), area);
    if (Array.isArray(sides)) faceSides.set(faceKey(f), [sides[0], sides[1]]);
  };
  const refreshParts = () => box.isConnected && (edges.length || faces.length) && (showParts(), place());
  // Esc ends this only, not what waits for it; so does its own key, outside a field
  const keys = (e: KeyboardEvent) => {
    if (!pressed(e, 'cancel') && (!pressed(e, 'measureValue') || e.target instanceof HTMLInputElement)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
  };
  addEventListener('keydown', keys, { capture: true });
  // the measurement's lines in the view: hovered as its buttons are, a press does what its button does
  const legAt = (e: PointerEvent) => {
    const k = e.target instanceof HTMLCanvasElement && viewer.el.contains(e.target) && !e.altKey && !e.shiftKey ? viewer.measureLegAt(e) : null;
    if (!k) return null;
    // a corner, a middle or a centre there is the next point, as usual
    const what = viewer.aimAt(e)?.what;
    return what && !what.startsWith('on ') ? null : k;
  };
  let onLeg: string | null = null;
  const legHover = (e: PointerEvent) => {
    const k = e.buttons ? null : legAt(e);
    if (k !== onLeg) {
      light((onLeg = k));
      (e.target as HTMLElement).style.cursor = k ? 'pointer' : '';
      if (!k) tips.cursorTip(null);
    }
    if (!k) return;
    e.stopPropagation(); // what a click takes is not marked meanwhile
    viewer.aimAt(null);
    tips.cursorTip(`Click: ${use ? 'Use' : 'Copy'} ${k}`);
  };
  const legPress = (e: PointerEvent) => {
    const k = e.button === 0 ? legAt(e) : null;
    if (!k) return;
    e.stopPropagation();
    e.preventDefault();
    addEventListener('pointerup', (u) => u.stopPropagation(), { capture: true, once: true });
    buttons.get(k)?.click();
  };
  addEventListener('pointermove', legHover, { capture: true });
  addEventListener('pointerdown', legPress, { capture: true });
  const hintBefore = toolHint;
  const close = () => {
    if (!box.isConnected) return; // ending the pick comes back here
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    removeEventListener('pointermove', legHover, { capture: true });
    removeEventListener('pointerdown', legPress, { capture: true });
    viewer.el.querySelector('canvas')!.style.cursor = '';
    viewer.cancelFacePick();
    viewer.aiming = null;
    viewer.aimAt(null);
    tips.cursorTip(null);
    viewer.showMeasureLine(null);
    viewer.showMeasured([], []);
    toolHint = use ? hintBefore : null;
    done?.();
    render();
  };
  const pick = () =>
    viewer.pickFace(
      (face) => {
        if (!face) return close();
        const part = face.part;
        if (part) {
          // a part marked: the points start over; Shift adds (or drops) one of the same kind
          [last, faces] = [null, 'edge' in part ? [] : faces];
          if ('edge' in part) {
            const same = (x: [Vector3, Vector3][]) => x.length === part.edge.length && x[0][0].distanceTo(part.edge[0][0]) < 1e-6;
            edges = !face.adds ? [part.edge] : edges.some(same) ? edges.filter((x) => !same(x)) : [...edges, part.edge];
          } else {
            const same = (f: FaceItem) => f.mesh === part.face.mesh && f.index === part.face.index;
            edges = [];
            faces = !face.adds ? [part.face] : faces.some(same) ? faces.filter((f) => !same(f)) : [...faces, part.face];
          }
          viewer.showMeasureLine(null);
          viewer.showMeasured(edges, faces);
          if (edges.length || faces.length) showParts();
          else show([], 'Click a point, or Alt-click an edge or face');
          void ('edge' in part ? askEdge(part.edge, part.ref) : askFace(part.face)).then(refreshParts);
        } else if (face.snap) {
          const point = { at: face.snap, about: !!face.about };
          const from = last;
          if (edges.length || faces.length) [edges, faces] = [[], []], viewer.showMeasured([], []);
          if (from) {
            const d = point.at.clone().sub(from.at);
            const values: Record<string, number> = { X: Math.abs(d.x), Y: Math.abs(d.y), Z: Math.abs(d.z), L: d.length() };
            show(viewer.showMeasureLine(from.at, point.at)!.map((k) => [k, values[k], false, point.about || from.about]));
          } else {
            viewer.showMeasureLine(point.at);
            show(face.edge ? [['Edge', face.edge.length, false, true]] : [], 'Click the next point');
            const ref = face.edge?.ref;
            if (ref)
              void kernel.measure([{ of: 'edge', body: ref.body, edge: ref.edge! }]).then(([length]) => {
                if (typeof length === 'number' && box.isConnected && last === point) (show([['Edge', length]], 'Click the next point'), place());
              });
          }
          last = point;
        }
        place();
        pick();
      },
      true,
      false,
      'alt',
    );
  toolHint = `Distance measure: click points (each from the one before) · [Alt]-click an edge or face, [Shift] [Alt] adds more (their total) · ${use ? 'click a value or its line in the view: it goes in, back to where you were' : 'click a value or its line in the view: copy'} · [Esc] ${use ? 'goes back' : 'stops'}`;
  viewer.aiming = (a) => tips.cursorTip(a?.what ?? null);
  show([], 'Click a point, or Alt-click an edge or face');
  document.body.append(box);
  place();
  render();
  pick();
}

/** What a click on a work plane's first pick makes, by what it lands on. */
const planeAim = (what: string) => (what === 'on face' || what === 'on work plane' ? 'a plane on this face' : alongEdge(what) ? 'a plane along this edge (a straight one)' : 'a plane through this point and two more');

/**
 * Work plane: the first thing picked sets how it is made (selected before, or clicked after; hovering marks the snap
 * a click takes): a face (Alt-picked, or clicked inside it): on it; a straight edge: along it, then a point it passes
 * through or a turn around it; a point (a corner, an edge's middle, a sketch point …): through it and two more; a
 * sketch selected: on its plane; empty space: the base plane facing you. Then its panel (see `planePanel`).
 */
function planeTool() {
  const sketch = viewer.sketches.find((v) => v.id === activeSketch());
  if (sketch) return newPlane(sketch.frame, 'face', sketchHull(sketch));
  const [edge, face] = [viewer.pickedEdgeLine(), viewer.pickedFaceItems()[0]];
  if (edge || face) viewer.dropPicked();
  if (edge) return edgePlane(edge.at, edge.to);
  if (face) return facePlane(face);
  toolHint = 'Work plane: click a face (on it), a straight edge (along it) or a point (through it and two more) · empty space: the base plane facing you · or select a sketch, or Alt-click a face or edge first · [Esc] cancels';
  viewer.aiming = (a) => tips.cursorTip(a ? `${a.what}\nClick: ${planeAim(a.what)}` : null);
  render();
  viewer.pickFace((p) => {
    [viewer.aiming, toolHint] = [null, null];
    viewer.aimAt(null);
    tips.cursorTip(null);
    if (!p) return render();
    if (p.plane) return onPlane(p.plane);
    if (p.what && alongEdge(p.what) && p.line) return edgePlane(p.line.at, p.line.to);
    if (p.what === 'on face' && p.item) return facePlane(p.item);
    if (p.snap) return pointsPlane(p.snap);
    // empty space: the base plane square to the axis looked along most, facing you
    const look = viewer.looking();
    const k = [0, 1, 2].reduce((best, c) => (Math.abs(look.getComponent(c)) > Math.abs(look.getComponent(best)) ? c : best), 0);
    const n = new Vector3().setComponent(k, -Math.sign(look.getComponent(k)) || 1);
    newPlane(frameOn(new Vector3(), n), 'face', []);
  }, true, false, 'lit', true);
}

/** A work plane on another one: its frame as it lies now, covering its rectangle. */
function onPlane(id: string) {
  const w = viewer.workPlanes.find((x) => x.id === id);
  if (!w) return;
  const [u0, v0, u1, v1] = w.rect;
  newPlane({ ...w.frame }, 'face', [toWorld(w.frame, u0, v0), toWorld(w.frame, u1, v1)]);
}

/** A frame at `o` with normal `n`, its x level (square to Z; looking along Z: X). */
function frameOn(o: Vector3, n: Vector3, x = new Vector3(0, 0, 1).cross(n)): Frame {
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  return { o: o.toArray(), x: x.toArray(), y: n.clone().cross(x).toArray(), n: n.toArray() };
}

/** The corners of a sketch's shapes' boxes (world): what a plane on it covers. */
function sketchHull(s: { frame: Frame; shapes: DrawnProfile[] }): V3[] {
  return s.shapes.flatMap((q) => {
    const [u0, v0, u1, v1] = bounds(q);
    return [toWorld(s.frame, u0, v0), toWorld(s.frame, u1, v1)];
  });
}

/**
 * A work plane's rectangle in its own coordinates (u0, v0, u1, v1): around `pts` (world, laid onto it), each side a
 * tenth of its length out, at least `margin` units; `fixed` (its sides dragged): that `rect`, grown to keep the
 * `keep` points on it; neither: a square `half` mm out from its origin.
 */
function planeRect(f: Frame, pts: V3[], u: Unit, fixed: { rect: [number, number, number, number]; keep: V3[] } | null = null, margin = 5, half = 60): [number, number, number, number] {
  const box = (q: V3[]) => {
    const [us, vs] = [q.map((p) => dot(sub(p, f.o), f.x)), q.map((p) => dot(sub(p, f.o), f.y))];
    return [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  };
  if (fixed) {
    const [k0, k1, l0, l1] = box(fixed.keep);
    const r = fixed.rect;
    return [Math.min(r[0], k0), Math.min(r[1], l0), Math.max(r[2], k1), Math.max(r[3], l1)];
  }
  if (!pts.length) return [-half, -half, half, half];
  const [u0, u1, v0, v1] = box(pts);
  const out = (lo: number, hi: number) => Math.max(0.1 * (hi - lo), margin * UNITS[u]);
  return [u0 - out(u0, u1), v0 - out(v0, v1), u1 + out(u0, u1), v1 + out(v0, v1)];
}

/** A work plane on a face: its middle, its x along the face's long side, covering the face (curved: where clicked, covering nothing). */
function facePlane(f: FaceItem) {
  const { corners, x } = viewer.faceSize(f);
  const n = f.n.clone().normalize();
  if (!corners) return newPlane(frameOn(f.point, n), 'face', []);
  newPlane(frameOn(viewer.faceCentre(f), n, x!.clone()), 'face', corners.map((c) => c.toArray()));
}

/** A work plane along an edge from `at` to `to`, facing up as far as it can (a vertical edge: the front), turning around it. */
function edgePlane(at: Vector3, to: Vector3) {
  const x = to.clone().sub(at).normalize();
  const up = Math.abs(x.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, -1, 0);
  const n = up.addScaledVector(x, -up.dot(x)).normalize();
  newPlane(frameOn(at, n, x), 'edge', [at.toArray(), to.toArray()], { at: at.toArray(), dir: x.toArray() });
}

/** A work plane through point `p` (facing you so far), two more to click. */
function pointsPlane(p: Vector3) {
  newPlane(frameOn(p, viewer.looking().negate()), 'points', [], null, [p]);
}

/** A new work plane on `base` (world; `axis`: what it turns around), selected, its panel open. */
function newPlane(base: Frame, mode: WorkPlane['mode'], hull: V3[], axis: WorkPlane['axis'] = null, points: Vector3[] = []) {
  const doc = history.current;
  const plane: WorkPlane = { id: newId(), name: `Plane ${doc.planes.length + 1}`, ...base, offset: len(0), turn: ex('0'), axis, points: points.map((p) => p.toArray().map((v) => len(v)) as [Expr, Expr, Expr]), mode, hull, rect: null, visible: true };
  selected = [plane.id];
  commit({ ...doc, planes: [...doc.planes, plane] });
  planePanel(plane.id, true);
}

/**
 * A work plane's panel: how it is made (Face · Edge + point · 3 points; switching picks that anew), Offset (T: a
 * point's distance), Turn ° once it has an axis (on a face: Set axis; along an edge: the edge, until a point is
 * clicked), and the points it passes through (along an edge: one, a new one replaces it; 3 points: a fourth drops the
 * first), picked right away where the mode takes them. Live; `fresh`: Esc leaves nothing, else Esc puts it back.
 */
function planePanel(id: string, fresh = false) {
  const doc0 = history.current;
  const i = doc0.planes.findIndex((w) => w.id === id);
  const w = doc0.planes[i];
  if (!w) return;
  const u = doc0.units;
  const at = (key: keyof WorkPlane) => ['planes', String(i), key];
  const change = (next: Doc) => {
    if (fresh || history.current !== doc0) history.replace(next);
    else history.push(next);
    update();
  };
  const now = () => history.current.planes[i];
  const setPlane = (next: Partial<WorkPlane>) => change(setIn(history.current, ['planes', String(i)], { ...now(), ...next }));
  const hint = "Work plane: its offset (T: a point's distance, type on, e.g. /2 for halfway) · the mode above picks it anew · [Enter] keeps it · [Esc] " + (fresh ? 'leaves nothing' : 'puts it back');
  // one pick at a time: `take` gets each click (true: picking goes on); the snap a click takes shows while hovering (`lit`: a face or edge lit whole)
  let picking: string | null = null;
  const pick = (what: string, tip: string, take: (p: PickedFace) => boolean, lit = false) => {
    angles.disarm();
    viewer.cancelFacePick();
    picking = what;
    toolHint = `Work plane: ${tip} · [Esc] stops`;
    viewer.aiming = (a) => tips.cursorTip(a ? `${a.what}\nClick: ${tip}` : null);
    status();
    const next = () =>
      viewer.pickFace((p) => {
        if (picking !== what) return;
        if (p && take(p)) return status(), next();
        [picking, viewer.aiming, toolHint] = [null, null, hint];
        viewer.aimAt(null);
        tips.cursorTip(null);
        status();
      }, true, false, lit ? 'lit' : null);
    next();
  };
  const point = (p: Vector3) => p.toArray().map((v) => len(v)) as [Expr, Expr, Expr];
  const pickPoints = () =>
    pick('points', now().mode === 'edge' ? 'a point it passes through (turns around the edge to it)' : 'points it passes through (three; a fourth drops the first)', (p) => {
      if (!p.snap) return true; // empty space: nothing to pass through
      setPlane({ points: now().mode === 'edge' ? [point(p.snap)] : [...now().points, point(p.snap)].slice(-3) });
      return now().mode !== 'edge';
    });
  const modes: [WorkPlane['mode'], string, string][] = [
    ['face', 'Face', 'On a face: click one'],
    ['edge', 'Edge + point', 'Along a straight edge: click one, then a point it passes through, or type a turn'],
    ['points', '3 points', 'Through three points: click them'],
  ];
  const switcher = Object.assign(document.createElement('span'), { className: 'segmented' });
  const modeButtons = modes.map(([m, label, title]) =>
    Object.assign(document.createElement('button'), {
      textContent: label,
      title,
      onclick: () => {
        if (m === 'points') return setPlane({ mode: 'points', points: [], hull: [], axis: null, turn: ex('0'), rect: null }), pickPoints();
        pick(m, m === 'face' ? 'a face it lies on' : 'a straight edge it runs along', (p) => {
          if (m === 'face' && p.what === 'on face' && p.item) {
            const { corners, x } = viewer.faceSize(p.item);
            setPlane({ ...frameOn(corners ? viewer.faceCentre(p.item) : p.item.point, p.item.n.clone().normalize(), x?.clone()), mode: 'face', hull: corners?.map((c) => c.toArray()) ?? [], axis: null, points: [], turn: ex('0'), rect: null });
            return false;
          }
          if (m === 'edge' && p.line) {
            const d = p.line.to.clone().sub(p.line.at).normalize();
            const up = Math.abs(d.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, -1, 0);
            setPlane({ ...frameOn(p.line.at, up.addScaledVector(d, -up.dot(d)).normalize(), d), mode: 'edge', hull: [p.line.at.toArray(), p.line.to.toArray()], axis: { at: p.line.at.toArray(), dir: d.toArray() }, points: [], turn: ex('0'), rect: null });
            setTimeout(pickPoints); // then its point, after this pick ends
            return false;
          }
          return true; // not that kind: click again
        }, true);
      },
    }),
  );
  switcher.append(...modeButtons);
  const pointsButton = panelButton('Points', 'Click points the plane passes through', () => (picking === 'points' ? viewer.cancelFacePick() : pickPoints()));
  const clear = panelButton('Clear', 'Leave the points out', () => (setPlane({ points: [] }), status()));
  const setAxis = panelButton('Set axis', 'Click an edge or line: it turns around that (then Turn °)', () => {
    angles.disarm();
    viewer.cancelFacePick();
    viewer.pickAxis(
      (a) => {
        tips.cursorTip(null);
        viewer.showAxis(null);
        if (a) setPlane({ axis: { at: a.at.toArray(), dir: a.dir.toArray() } });
        status();
        render();
        if (a) angles.arm();
      },
      (a) => (tips.cursorTip(a ? `${a.what}\nClick: it turns around it` : null), viewer.showAxis(a, a?.at, 60)),
    );
  });
  const panel = valuePanel(
    [
      // To object: the offset that brings the plane, as it lies now (turned, through its points), through the point
      { label: 'Offset', value: w.offset.e, reach: (p) => {
          const f = viewer.workPlanes.find((x) => x.id === id)?.frame;
          const d = length(panel.inputs[0].value || '0') ?? 0;
          return f ? d + p.clone().sub(new Vector3(...f.o)).dot(new Vector3(...f.n)) : d;
        } },
      { label: 'Turn °', value: w.turn.e, raw: true, title: 'Turn °: around its axis' },
    ],
    ([o, t]) => (change(setIn(setIn(history.current, at('offset'), { e: o, u }), at('turn'), { e: t, u: 'mm' })), marks()),
    (ok) => {
      [picking, viewer.aiming] = [null, null];
      angles.end();
      viewer.cancelFacePick();
      viewer.aimAt(null);
      tips.cursorTip(null);
      viewer.editPlane(null);
      viewer.showAxis(null);
      if (ok || !(fresh || history.current !== doc0)) render();
      else undo();
    },
    hint,
    [switcher, setAxis, pointsButton, clear],
  );
  const [offsetCell, turnCell] = panel.inputs.map((x) => x.closest('.cell') as HTMLElement);
  // modes, Offset, Set axis, Turn, then the points
  offsetCell.after(setAxis, turnCell, pointsButton, clear);
  const angles = angleControl({
    input: panel.inputs[1],
    // from the plane as made (it shows while Turn does)
    axis: () => {
      const p = now();
      if (!p.axis || turnCell.style.display === 'none') return null;
      const [dir, o] = [new Vector3(...p.axis.dir).normalize(), new Vector3(...p.o)];
      const start = new Vector3(...p.axis.at);
      const zero = new Vector3(...p.n).cross(dir);
      if (zero.lengthSq() < 1e-9) zero.set(...p.x);
      return { at: start.addScaledVector(dir, o.clone().sub(start).dot(dir)), dir, zero: zero.normalize() };
    },
  });
  turnCell.append(angles.buttons());
  /** While it is edited: what it was made from marked (the face's outline, the edge, its points; its axis dashed), its sides dragged to size it, and its turn's angle. */
  function marks() {
    const p = now();
    const lookup = paramLookup(history.current.params);
    const pts = p.points.map((q) => new Vector3(...q.map((e) => resolve(e, lookup, '', new Map()))));
    const hull = p.hull.map((h) => new Vector3(...h));
    const lines = hull.length > 2 ? hull.map((h, k): [Vector3, Vector3] => [h, hull[(k + 1) % hull.length]]) : hull.length === 2 ? [[hull[0], hull[1]] as [Vector3, Vector3]] : [];
    viewer.editPlane({ id, lines, points: pts, resize: (rect) => setPlane({ rect }) });
    viewer.showAxis(p.axis && p.mode === 'face' ? { at: new Vector3(...p.axis.at), dir: new Vector3(...p.axis.dir).normalize(), what: '' } : null, new Vector3(...p.o), 60);
    angles.show();
  }
  function status() {
    const p = now();
    modeButtons.forEach((b, k) => b.classList.toggle('on', modes[k][0] === p.mode));
    turnCell.style.display = p.mode !== 'points' && p.axis && !p.points.length ? '' : 'none';
    setAxis.hidden = p.mode !== 'face';
    pointsButton.hidden = p.mode === 'face';
    pointsButton.textContent = p.mode === 'edge' ? 'Point' : `Points (${p.points.length})`;
    pointsButton.classList.toggle('on', picking === 'points');
    clear.hidden = !p.points.length;
    marks();
    render();
  }
  status();
  if (w.mode !== 'face' && w.points.length < (w.mode === 'edge' ? 1 : 3)) pickPoints();
}

/**
 * Sweep: a line or shape outline clicked (the path, any sketch), then the outline of a closed sketch shape (the
 * profile): a new body, the profile's middle on the path's start, square to it. Linked to both; Esc leaves nothing.
 */
function sweepTool() {
  const pick = (hint: string, done: (at: { sketch: string; shape: string }) => void) => {
    toolHint = hint;
    render();
    viewer.pickFace((face) => {
      toolHint = null;
      const q = face?.sketch?.shape;
      if (!face?.sketch || !q) return render();
      done({ sketch: face.sketch.id, shape: q });
    }, false, true);
  };
  pick('Sweep: click the path · the line or shape outline it runs along · [Esc] cancels', (path) =>
    pick('Sweep: click the profile · the outline of a closed shape to sweep along the path · [Esc] cancels', (profile) => {
      const doc = history.current;
      const body = newBody(doc.bodies.length, [{ id: newId(), type: 'sweep', profile, path }]);
      [selected, shapeSel] = [[body.id], []];
      commit({ ...doc, bodies: [...doc.bodies, body] });
    }),
  );
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
    toolHint = `Loft: click the outlines in order · closed sketch shapes, one per sketch (${picked.length} so far) · [Enter] keeps it · [Esc] cancels`;
    render();
    viewer.pickFace((face) => {
      if (ended) return;
      if (!face) return finish(false);
      const at = face.sketch;
      if (at?.shape && !picked.some((q) => q.sketch === at.id)) picked.push({ sketch: at.id, shape: at.shape }), show();
      next();
    }, false, true);
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
  if (selected.length && selectedImages().length === selected.length) return turnImages();
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
  // a joint's parent takes what it moves along (and they their tool bodies)
  for (const j of doc0.joints) if (ids.includes(j.parent)) for (const c of j.children) if (!ids.includes(c)) ids.push(c);
  for (const [owned, by] of owner) if (ids.includes(by) && !ids.includes(owned)) ids.push(owned);
  const start = new Map(ids.map((id) => [id, (bodyPlaces.get(id) ?? groupPlace(id)).clone()]));
  const parents = new Map(ids.map((id) => [id, parentPlace(id)]));
  const shapes = sketch && frame ? viewer.sketches.find((v) => v.id === sketch)!.shapes.filter((q) => !shapeSel.length || shapeSel.includes(q.id)) : [];
  /** The document turned `angle` degrees. */
  const turned = (angle: number): Doc => {
    const at = pivot ?? middle;
    if (frame && sketch) {
      const [pu, pv] = uvOf(frame, at);
      const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
      const around = ([u, v]: [number, number]): [number, number] => [pu + (u - pu) * c - (v - pv) * s, pv + (u - pu) * s + (v - pv) * c];
      return withShapes(doc0, sketch, shapes.map((q) => {
        if (q.kind === 'line') return { id: q.id, profile: mapPoints(q, around) };
        const [m, n] = [centre(q), around(centre(q))];
        return { id: q.id, profile: shifted(rotated(q, angle), n[0] - m[0], n[1] - m[1]) };
      }));
    }
    const turn = new Matrix4().makeTranslation(at).multiply(new Matrix4().makeRotationAxis(dir, (angle * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(at.clone().negate()));
    let next = doc0;
    for (const id of ids) {
      const { position, rotation } = placementIn(parents.get(id)!, turn.clone().multiply(start.get(id)!));
      const i = next.bodies.findIndex((b) => b.id === id);
      if (i >= 0) next = setIn(setIn(next, ['bodies', String(i), 'rotation'], rotation), ['bodies', String(i), 'position'], position);
      const g = next.groups.findIndex((x) => x.id === id);
      if (g >= 0) next = setIn(next, ['groups', String(g), 'origin'], { kind: 'custom', position, rotation });
    }
    return next;
  };
  let angle = 0;
  let typed = false; // a typed angle: the pointer no longer turns it
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
    angles.show();
    lightAxis();
  };
  /** The axis switch: X / Y / Z when it lies along that world axis, else Set axis (also while picking one). */
  const lightAxis = () => {
    const k = mode === 'axis' || !pivot ? -1 : [0, 1, 2].findIndex((i) => Math.abs(dir.getComponent(i)) > 0.9999);
    axisSwitch.forEach((b, i) => b.classList.toggle('on', i - 1 === k));
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
  const angles = angleControl({
    input,
    axis: () => pivot && { at: pivot, dir },
    change: (text) => fromField(text),
    stepped: () => mode === 'turn' && turnHint(),
    aimed: () => turnPick(),
  });
  const label = Object.assign(document.createElement('span'), { textContent: 'Turn °' });
  scrub(label, input, () => input.value, 'mm', settings.minAngle, (text) => ((typed = true), angles.disarm(), (input.value = text), fromField(text)), () => (input.focus(), input.select()));
  const button = panelButton;
  /** Around world axis `k` through the point (none yet: the selection's middle). */
  const along = (k: number) => {
    [dir, pivot, typed] = [new Vector3().setComponent(k, 1), pivot ?? middle, false];
    apply(0);
    turnPick();
  };
  /** Turning: waits for the click that keeps it (a drag turns the view; a click on its point takes the next axis); Esc puts it back. */
  const turnPick = () => {
    mode = 'turn';
    lightAxis();
    if (!typed) angles.arm(false);
    turnHint();
    viewer.pickFace((face) => {
      if (ended || mode !== 'turn') return;
      const at = viewer.pointer();
      const r = viewer.el.getBoundingClientRect();
      const [x, y] = viewer.toScreen(pivot!);
      // its point clicked again: Z, then X, then Y through it
      if (face && point && !frame && at && Math.hypot(at.x - r.left - x, at.y - r.top - y) < 14) {
        dir = new Vector3().setComponent((dir.z ? 0 : dir.x ? 1 : 2), 1);
        typed = false;
        apply(0);
        return turnPick();
      }
      finish(!!face);
    }, true);
  };
  const turnHint = () => {
    toolHint = `Move around the axis to turn, or type degrees · ${angleKeys()}${point ? ' · click its point again: the next axis' : ''} · click or [Enter] keeps it · [Esc] puts it back`;
    render();
  };
  /** To object: two clicks; their angle around the axis goes into Turn ° (to calculate on). */
  const aimAngle = () => {
    if (!pivot) return;
    mode = 'aim'; // before ending the turn's pick: that pick then does nothing
    angles.aim();
  };
  /** The next click sets the axis (in a sketch: the point it turns around). */
  const setAxis = () => {
    mode = 'axis'; // before ending the turn's pick: that pick then does nothing
    angles.disarm();
    viewer.cancelFacePick();
    viewer.showTicks(null);
    lightAxis();
    toolHint = frame
      ? 'Rotate: click the point it turns around · a corner, a circle: its centre · [Esc] ' + (pivot ? 'keeps the axis' : 'cancels')
      : 'Rotate: click the axis · an edge or line, a circle (its centre), or a point (Z through it; again: X, then Y) · [Esc] ' + (pivot ? 'keeps the axis' : 'cancels');
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
    angles.end();
    viewer.showPoint(null);
    viewer.showAxis(null);
    tips.cursorTip(null);
    toolHint = null;
    if (!ok && history.current !== doc0) return undo();
    render();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // the view's Esc ending a pick
    const axis = (['moveX', 'moveY', 'moveZ'] as const).findIndex((a) => pressed(e, a));
    if (axis >= 0 && !frame) along(axis);
    else if (pressed(e, 'confirm')) finish(true);
    else if (pressed(e, 'cancel')) (mode === 'turn' || !pivot ? finish(false) : viewer.cancelFacePick());
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const axisButton = (a: number) => Object.assign(button('', `Around the world ${'XYZ'[a]} axis through its point (${'XYZ'[a]})`, () => along(a)), { innerHTML: axisHtml('XYZ'[a]) });
  // one of them is the axis: Set axis (one picked) or X / Y / Z
  const axisSwitch = [button('Set axis', 'Click an edge or line, a circle (its centre) or a point (Z through it; again: X, then Y)', setAxis), ...(frame ? [] : [0, 1, 2].map(axisButton))];
  const switcher = Object.assign(document.createElement('span'), { className: 'segmented' });
  switcher.append(...axisSwitch);
  box.append(
    cell(label, input, toObjectButton(aimAngle, 'Click where something is now, then where it should go: their angle goes into Turn °')),
    switcher,
    button('✓', 'Keep it (Enter or a click in the view); Esc puts it back', () => finish(true)),
  );
  document.body.append(box);
  atTop(box);
  addEventListener('keydown', keys, { capture: true });
  setAxis();
}

/**
 * How Align (as in incase) moves the selected bodies, groups (as one) and whole sketches, by their boxes in the world:
 * their min, middle or max along an axis onto that of all of them, equal gaps along it (the outermost stay), or their
 * middles onto the first one's. Each one's shift, the box of all, and the planes they line up on; a string: why not.
 */
function alignPlan(how: ObjectAlign) {
  const doc = history.current;
  const units = selected.filter((id) => [...doc.bodies, ...doc.groups, ...doc.sketches].some((o) => o.id === id));
  const boxOf = (id: string) => {
    const box = new Box3();
    const s = viewer.sketches.find((v) => v.id === id);
    if (s) for (const q of s.shapes) for (const [u, v] of corners2(bounds(q))) box.expandByPoint(new Vector3(...toWorld(s.frame, u, v)));
    for (const b of contents(doc, [id])) {
      const m = doc.bodies.some((x) => x.id === b) && viewer.measure(b);
      if (m) box.union(m.box);
    }
    return box.isEmpty() ? null : box;
  };
  const boxes = units.map(boxOf);
  if (units.length < 2 || boxes.some((b) => !b)) return 'Select two shown objects or more to align them';
  const all = boxes.reduce((a, b) => a!.clone().union(b!), boxes[0]!)!;
  const k = 'XYZ'.indexOf(how.at(-1)!);
  const lo = (b: Box3) => b.min.getComponent(k);
  const hi = (b: Box3) => b.max.getComponent(k);
  const mid = (b: Box3) => (lo(b) + hi(b)) / 2;
  const shifts = boxes.map(() => new Vector3());
  let planes: { k: number; at: number }[];
  if (how === 'first') {
    const c = boxes[0]!.getCenter(new Vector3());
    boxes.forEach((b, i) => shifts[i].copy(c.clone().sub(b!.getCenter(new Vector3()))));
    planes = [0, 1, 2].map((a) => ({ k: a, at: c.getComponent(a) }));
  } else if (how.startsWith('spread')) {
    const gap = (hi(all) - lo(all) - boxes.reduce((n, b) => n + hi(b!) - lo(b!), 0)) / (units.length - 1);
    let at = lo(all);
    for (const i of boxes.map((_, i) => i).sort((i, j) => lo(boxes[i]!) - lo(boxes[j]!))) {
      shifts[i].setComponent(k, at - lo(boxes[i]!));
      at += hi(boxes[i]!) - lo(boxes[i]!) + gap;
    }
    planes = [{ k, at: lo(all) }, { k, at: hi(all) }];
  } else {
    boxes.forEach((b, i) => shifts[i].setComponent(k, how.startsWith('min') ? lo(all) - lo(b!) : how.startsWith('max') ? hi(all) - hi(b!) : mid(all) - mid(b!)));
    planes = [{ k, at: how.startsWith('min') ? lo(all) : how.startsWith('max') ? hi(all) : mid(all) }];
  }
  return { units, shifts, all, planes };
}

/** Hovering an align choice: the objects shown where it moves them (translucent copies where they are) and the planes they line up on; null: back. */
function previewAlign(how: ObjectAlign | null) {
  const plan = how && alignPlan(how);
  if (!plan || typeof plan === 'string') return viewer.previewMove(null), viewer.showAlignPlanes([]);
  const doc = history.current;
  const each = new Map(plan.units.flatMap((id, i) => contents(doc, [id]).map((b) => [b, plan.shifts[i]] as const)));
  const shapes = plan.units.flatMap((id, i) => {
    const s = viewer.sketches.find((v) => v.id === id);
    const [du, dv] = s ? [plan.shifts[i].dot(new Vector3(...s.frame.x)), plan.shifts[i].dot(new Vector3(...s.frame.y))] : [0, 0];
    return s ? s.shapes.map((q) => ({ id: q.id, profile: shifted(q, du, dv) })) : [];
  });
  viewer.previewMove(new Vector3(), shapes, null, 0.25, each);
  viewer.showAlignPlanes(plan.planes, plan.all);
}

/** Align (see `alignPlan`): one undo step. */
function alignObjects(how: ObjectAlign) {
  previewAlign(null);
  const plan = alignPlan(how);
  if (typeof plan === 'string') return fail(plan);
  const doc = history.current;
  let next = doc;
  plan.units.forEach((id, i) => {
    const by = plan.shifts[i];
    if (by.lengthSq() < 1e-12) return;
    const s = viewer.sketches.find((v) => v.id === id);
    if (s) {
      // a whole sketch: its shapes along its plane, a base plane's offset across it
      const [du, dv] = [by.dot(new Vector3(...s.frame.x)), by.dot(new Vector3(...s.frame.y))];
      next = withShapes(next, id, s.shapes.map((q) => ({ id: q.id, profile: shifted(q, du, dv) })));
      const k2 = next.sketches.findIndex((x) => x.id === id);
      const p = next.sketches[k2].plane;
      if (p.kind === 'base') next = setIn(next, ['sketches', String(k2), 'plane', 'offset'], plus(p.offset, resolve(p.offset, paramLookup(doc.params), '', new Map()), by.dot(new Vector3(...s.frame.n))));
    }
    next = withPlaces(next, contents(doc, [id]).flatMap((b) => (positions.has(b) ? [{ id: b, position: new Vector3(...positions.get(b)!).add(by).toArray() }] : [])));
  });
  commit(next);
}

/** The corners of a 2D box (x0, y0, x1, y1). */
const corners2 = ([x0, y0, x1, y1]: number[]): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

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
    toolHint = 'Joint: click the object that stays · a body or group · [Esc] cancels';
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
    toolHint = 'Joint: click the objects that move · again: not · then [Enter] · [Esc] cancels';
    return render();
  }
  toolHint = 'Joint: click its axis · an edge or line, or a circle or round edge (through its centre, square to it) · [Esc] cancels';
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

/**
 * A hinge at rest: its axis in the world, the direction its moving part lies in at 0 (its own X / Y / Z nearest to its
 * middle's), and how far that middle is from the axis; null: a slider, or nothing of it is shown.
 */
function hingeRest(j: Joint) {
  if (j.kind !== 'hinge') return null;
  const axis = jointAxis(j);
  const moving = contents(history.current, j.children).filter((x) => history.current.bodies.some((b) => b.id === x));
  const ref = moving.map((x) => viewer.measure(x)?.box.getCenter(new Vector3())).find(Boolean);
  if (!ref) return null;
  const v = jointValue(j, paramLookup(history.current.params));
  const back = (u: Vector3) => u.applyAxisAngle(axis.dir, (-v * Math.PI) / 180);
  const middle = ref.clone().sub(axis.at).projectOnPlane(axis.dir);
  const zero = back(middle.clone()).normalize();
  const own = bodyPlaces.get(j.children[0]) ?? groupPlace(j.children[0]);
  const axes = [0, 1, 2].flatMap((k) => {
    const a = back(new Vector3().setComponent(k, 1).transformDirection(own)).projectOnPlane(axis.dir);
    return a.lengthSq() > 1e-6 ? [a.normalize(), a.clone().negate()] : [];
  });
  return { axis, zero: axes.reduce((best, a) => (a.dot(zero) > best.dot(zero) ? a : best), axes[0] ?? zero), r: Math.max(middle.length(), 10) };
}

/** A hinge's angle drawn as a drawn line's: from its rest direction to `v` degrees, ticks every 15° (null: gone). */
function showHinge(j: Joint | null, v = 0) {
  const rest = j && hingeRest(j);
  viewer.showTicks(rest && { at: rest.axis.at, dir: rest.axis.dir, from: rest.axis.at.clone().addScaledVector(rest.zero, rest.r), step: 15, angle: v });
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
    showHinge(now(), jointValue(now(), lookup));
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
      if (key !== 'speed' && wantsT(e, input)) e.preventDefault(), aim();
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
      // from its rest direction (a lid's middle sits a little above its hinge, a block's beside the edge it turns on)
      const from = hingeRest(j)!.zero;
      const to = p.clone().sub(axis.at).projectOnPlane(axis.dir);
      return (Math.atan2(from.clone().cross(to).dot(axis.dir), from.dot(to)) * 180) / Math.PI;
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
    showHinge(null);
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
  const button = panelButton;
  box.append(
    segmented,
    cell(minLabel, minInput),
    cell(maxLabel, maxInput, toObjectButton(aim, 'Click a point: the min or max (the last one typed in) points the moving part at it, or reaches it (T)', measureField)),
    cell(speedLabel, speedInput),
    button('⇄ Invert', 'Turn or move the other way round', () => write({ axis: { ...now().axis, dir: now().axis.dir.map((v) => -v) as [number, number, number] } })),
    button('▶ Play', 'Play it once from its min to its max to see it (where it is now stays)', () => start(id, false)),
    button('✓', 'Keep the changes (Enter); Esc drops them', () => finish(true)),
  );
  choose(now().kind);
  document.body.append(box);
  atTop(box);
  viewer.showAxis(jointAxis(now()), jointAxis(now()).at, 60);
  toolHint = `${now().name}: set up the joint · hinge or slider, its limits (T: to a point), speed, direction · [Enter] keeps it · [Esc] ${fresh ? 'removes the joint' : 'drops the changes'}`;
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
const jointsDrawer = drawer('Joint animation', 'right', jointsBox);
// the drawers at the bottom right, side by side
const rightDrawers = Object.assign(document.createElement('div'), { className: 'drawers-right' });
rightDrawers.append(jointsDrawer);
viewer.el.append(rightDrawers);
// open, the joints sit under the tabs: the tabs ride on top of them
const liftTabs = () => rightDrawers.style.setProperty('--joints-up', jointsDrawer.classList.contains('open') ? `${jointsBox.offsetHeight}px` : '0px');
new ResizeObserver(liftTabs).observe(jointsBox);
new MutationObserver(liftTabs).observe(jointsDrawer, { attributes: true, attributeFilter: ['class'] });
let jointsKey = '';
/**
 * Joints playing: their phase (0 → 1 from min to max, 1 → 2 back), where a single play stops (1 or 2), the last
 * frame's time, and whether where it stops is kept (else it only showed it: the edit panel's Play).
 */
const playing = new Map<string, { phase: number; end: number; last: number; keep: boolean }>();
/** Joints that play back and forth (this session). */
const repeating = new Set<string>();
function renderJoints() {
  const doc = history.current;
  const key = JSON.stringify([doc.joints.map((j) => [j.id, j.name, j.kind, j.min, j.max]), jointProblems, [...playing.keys()], [...repeating], doc.units]);
  if (key !== jointsKey) {
    jointsKey = key;
    jointsDrawer.hidden = !doc.joints.length;
    jointsBox.replaceChildren(...doc.joints.map(jointRow), ...jointProblems.map((p) => Object.assign(document.createElement('p'), { className: 'error', title: COPY_TIP, textContent: p })));
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
    showHinge(history.current.joints.find((x) => x.id === j.id)!, jointValue(history.current.joints.find((x) => x.id === j.id)!, paramLookup(history.current.params)));
  };
  const name = Object.assign(document.createElement('input'), { className: 'joint-name', value: j.name, spellcheck: false, title: 'Its name' });
  name.onchange = () => commit(setIn(history.current, ['joints', String(at(j.id)), 'name'], name.value || j.name));
  const slider = Object.assign(document.createElement('input'), { type: 'range', min: String(Math.min(lo, hi)), max: String(Math.max(lo, hi)), step: 'any', title: 'Where it is now: drag to move it (model there)' });
  slider.dataset.joint = j.id;
  slider.oninput = () => setValue(fmt(j.kind === 'hinge' ? +slider.value : +slider.value / UNITS[doc.units]));
  slider.onchange = () => ((dragging = false), showHinge(null));
  const now = Object.assign(document.createElement('input'), { className: 'now', spellcheck: false, title: 'Where it is now (degrees or a length)' });
  Object.assign(now.dataset, { joint: j.id, complete: '', noMeasure: '' });
  now.oninput = () => length(now.value) !== null && setValue(now.value);
  now.onchange = () => ((dragging = false), showHinge(null));
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

/** Plays joint `id` from where it is to its max (standing at its max: back to its min); `keep`: it stays where it stops. */
function start(id: string, keep = true) {
  const j = history.current.joints.find((x) => x.id === id);
  if (!j) return;
  const [lo, hi] = jointRange(j);
  const s = hi === lo ? 0 : Math.min(1, Math.max(0, (jointValue(j, paramLookup(history.current.params)) - lo) / (hi - lo)));
  // the phase whose eased position is s, going up (at the max: going down)
  // a preview plays from its min to its max
  const down = keep && s > 0.999;
  const phase = !keep ? 0 : down ? 1 : Math.acos(1 - 2 * s) / Math.PI;
  playing.set(id, { phase, end: down ? 2 : 1, last: performance.now(), keep });
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

/** The joints playing, where they are now (without moving them on). */
function playingValues() {
  const doc = history.current;
  return new Map([...playing].flatMap(([id, p]) => {
    const j = doc.joints.find((x) => x.id === id);
    return j ? [[id, eased(j, p.phase)] as const] : [];
  }));
}

/** Places the bodies in the view with joints at `values` (the others where they are saved); nothing is rebuilt or written. */
function placeJoints(values: Map<string, number>) {
  const doc = history.current;
  const lookup = paramLookup(doc.params);
  const { placed } = jointed(doc, ownPlaces, (j) => values.get(j.id) ?? jointValue(j, lookup));
  for (const b of doc.bodies) {
    const m = placed.get(b.id);
    if (!m || !bodyPlaces.has(b.id)) continue;
    const [at, turn] = [new Vector3(), new Quaternion()];
    m.decompose(at, turn, new Vector3());
    viewer.setPlacement(b.id, at, turn);
  }
  viewer.placed(false);
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
    if ((!repeating.has(id) || !p.keep) && p.phase >= p.end) {
      if (p.keep) pause(id, jointRange(j, lookup)[p.end === 1 ? 1 : 0]);
      else playing.delete(id); // a preview: back to where it is
      continue;
    }
    p.phase %= 2; // back and forth: smooth at both ends
    values.set(id, eased(j, p.phase));
    showValue(id, values.get(id)!);
  }
  placeJoints(values);
  if (playing.size) requestAnimationFrame(animate);
  else renderJoints(); // the sliders and fields back to where the joints are
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
  viewer.lightBodies([]);
  toolHint = null;
}

/** Deletes the selected part of a finish, the selected shapes of the selected sketch, else the selected bodies and sketches (not while faces or edges are picked). */
function remove() {
  if (!selected.length) return pickFor('delete', remove);
  if (pickedPart && !finishSel) return fail('Picked faces and edges are not deleted: Esc lets them go, then Del deletes the body');
  const doc = history.current;
  if (finishSel) {
    // a part of a finish: its edge is left out (its last picked edge: the finish goes); the whole finish: it goes
    const { body, feature, mid } = finishSel;
    viewer.setFinishMark((finishSel = null));
    const last = (f: Extract<Feature, { type: 'finish' }>) => typeof f.edges === 'object' && f.edges.pts.length - f.skip.length <= 1;
    const steps = doc.bodies[stepsOf(doc, body)]?.id; // a linked copy's finish is its source's
    const bodies = doc.bodies.map((b) =>
      b.id !== steps ? b : { ...b, features: b.features.flatMap((f) => (f.id !== feature || f.type !== 'finish' ? [f] : mid && !last(f) ? [{ ...f, skip: [...f.skip, mid] }] : [])) },
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
  const kept = unlinkedFrom(doc, gone); // linked copies of what goes take over its steps
  const bodies = kept.bodies.filter((b) => !gone.has(b.id)).map((b) => ({ ...b, features: b.features.filter((f) => (f.type !== 'boolean' && f.type !== 'fingers') || !gone.has(f.body)) }));
  commit({ ...doc, bodies, sketches: doc.sketches.filter((s) => !gone.has(s.id)), groups: doc.groups.filter((g) => !groups.has(g.id)), planes: doc.planes.filter((w) => !gone.has(w.id)), images: doc.images.filter((im) => !gone.has(im.id)) });
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

/** Group tool: ungroups a single selected group, groups the selection (groups too), or (nothing selected) groups the objects clicked next on Enter. */
function groupTool() {
  const doc = history.current;
  // in sketch mode: shapes into a sub-group, or one sub-group selected apart
  if (sketching && shapeSel.length) {
    const s = doc.sketches.find((x) => x.id === sketching)!;
    const u = unitAt(s, shapeSel[0], sketchPath.at(-1) ?? null);
    return groupShapes(!!u?.group && u.shapes.length === shapeSel.length && u.shapes.every((id) => shapeSel.includes(id)));
  }
  // ungroup only a single selected group; several objects (groups too) get grouped
  if (selected.length === 1 && doc.groups.some((g) => g.id === selected[0])) return ungroup();
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
/** Tool bodies dragged in the list: listed there from now on, under their body again if dragged back there (`under`: the body they were dropped by). */
function listedElsewhere(doc: Doc, ids: string[], under?: string): Doc {
  const owner = ownersOf(doc);
  const tools = ids.filter((id) => owner.has(id));
  if (!tools.length) return doc;
  const back = (id: string) => owner.get(id) === under;
  return {
    ...doc,
    bodies: doc.bodies.map((b) => ({
      ...b,
      // its eye starts off: hidden until selected, as under its body
      visible: tools.includes(b.id) && !back(b.id) ? false : tools.includes(b.id) ? true : b.visible,
      features: b.features.map((f) => {
        if (f.type !== 'boolean' || !tools.includes(f.body) || owner.get(f.body) !== b.id) return f;
        const { free: _, ...rest } = f;
        return b.id === under ? rest : { ...rest, free: true };
      }),
    })),
  };
}

function arrange(ids: string[], target: string, where: 'before' | 'after' | 'into') {
  if (ids.includes(target)) return;
  const owners = ownersOf(history.current);
  let doc = listedElsewhere(history.current, ids, owners.get(target) ?? (where === 'after' ? target : undefined));
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
  const { doc, id, ids, made } = withSketched(history.current, r);
  if (made) [selected, shapeSel] = [made, []];
  else [selected, shapeSel] = [[id], ids];
  commit(doc);
  return id;
}

/** `doc` with a drawn shape added to its sketch (a new one if needed) or pulled shapes and areas: the sketch, the shapes, the bodies made (null: none pulled). */
function withSketched(doc: Doc, r: SketchResult): { doc: Doc; id: string; ids: string[]; made: string[] | null } {
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
      const polygon: Profile = { id: newId(), kind: 'polygon', pts: loop.pts, ...(loop.curves ? { curves: loop.curves } : {}), r: len(0), rot: ex('0'), ...(profile.group ? { group: profile.group } : {}) };
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
    return { doc: { ...doc, sketches, bodies, joints }, id, ids, made: made.map((b) => b.id) };
  }
  return { doc: { ...doc, sketches, bodies, joints }, id, ids, made: null };
}

function profileOf(drawn: Drawn): Profile {
  const profile = shapeOf(drawn);
  return drawConstruction ? { ...profile, construction: true } : profile;
}

const roundPts = (pts: [number, number][]) => pts.map(([x, y]) => [+fmt(x), +fmt(y)] as [number, number]);
const roundCurves = (curves: (Curve | null)[]) => curves.map((c) => (!c ? null : 'c1' in c ? { c1: roundPts([c.c1])[0], c2: roundPts([c.c2])[0] } : { mid: roundPts([c.mid])[0] }));

function shapeOf({ profile: p, typed: t, sides }: Drawn): Profile {
  const id = newId();
  if (p.kind === 'rect') return { id, kind: 'rect', x: len(p.x), y: len(p.y), w: len(p.w, t.w), h: len(p.h, t.h), r: len(p.r), rot: ex(fmt(p.rot)) };
  if (p.kind === 'circle') return { id, kind: 'circle', x: len(p.x), y: len(p.y), d: len(p.d, t.d) };
  if (p.kind === 'ngon') return { id, kind: 'ngon', x: len(p.x), y: len(p.y), d: len(p.d, t.d), sides: ex(fmt(p.sides)), rot: ex(fmt(p.rot)) };
  const u = history.current.units;
  const asked = (text: string | undefined) => (text === undefined ? {} : { e: text, u });
  const sizes = sides?.map((c) =>
    !c ? null : { ...(c.l !== undefined ? { l: asked(c.l) as Expr } : {}), ...(c.d !== undefined ? { d: asked(c.d) as Expr } : {}), ...(c.deg !== undefined ? { deg: ex(c.deg), base: c.base } : {}) },
  );
  const path = { pts: roundPts(p.pts), ...(p.curves ? { curves: roundCurves(p.curves) } : {}), ...(sizes?.some(Boolean) ? { sizes } : {}) };
  return p.kind === 'line' ? { id, kind: 'line', ...path } : { id, kind: 'polygon', ...path, r: len(p.r), rot: ex(fmt(p.rot)) };
}

function stopTool() {
  viewer.stopTool();
  extruding = null;
  extrudeRun++;
  toolMode = null;
  toolHint = null;
}

const toolHost: ToolHost = {
  ball(ball) {
    addSphere(ball);
    stopTool(); // else the tool's start again would be its next mode
    startTool('sphere');
  },
  measure: (use, done) => measureTool(use, done),
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
      toolHost.ball(result.sphere);
      return;
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
    else void startExtrude();
  },
  hint(text) {
    toolHint = text;
    render();
  },
  cursorTip: (text, more) => tips.cursorTip(text, more),
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
  return { id: newId(), name: `Body ${count + 1}`, group, rotation: unturned(), color: palette[count % palette.length], visible: true, position: [len(0), len(0), len(0)], features, link: null };
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
  // the same tool again (its button or key): its next drawing mode
  if (viewer.activeTool === kind && viewer.nextDrawMode()) return;
  if (kind === 'sphere' && sketching) exitSketch();
  const s = viewer.sketches.find((v) => v.id === sketching);
  if (s) viewer.startTool(kind, toolHost, { kind: 'draw', target: { ...targetOf(s), body: null } });
  else viewer.startTool(kind, toolHost);
  toolMode = s ? 'draw' : 'direct';
  render();
}

/** `x` (`mm` now) changed by `by` mm: a plain number stays one, an expression gets `+ by` (`ply` becomes `ply + 5`). */
function plus(x: Expr, mm: number, by: number): Expr {
  if (Math.abs(by) < 1e-9) return x;
  return isPlain(x.e) ? len(mm + by) : { e: `${x.e} ${by < 0 ? '-' : '+'} ${fmt(Math.abs(by) / UNITS[x.u])}`, u: x.u };
}

/** A line's or polygon's sides' sizes after it changed from `old` to `next` (mm): as expressions, `+ delta`; an angle no longer right goes. */
function sizesAfter(shape: Extract<Profile, { pts: unknown }>, old: DrawnProfile, next: DrawnProfile) {
  if (!shape.sizes || !('pts' in old) || !('pts' in next) || old.pts.length !== next.pts.length) return undefined;
  return shape.sizes.map((s, i) => {
    if (!s) return null;
    const [a, b] = [sideNow(old, i), sideNow(next, i)];
    const { deg, base, ...out } = s;
    if (out.l) out.l = plus(out.l, a.l, b.l - a.l);
    if (out.d && a.d !== null && b.d !== null) out.d = plus(out.d, a.d, b.d - a.d);
    return deg && Math.abs(a.dir - b.dir) < 1e-3 ? { ...out, deg, base } : out;
  });
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
    else if (key === 'pts') out.pts = roundPts(v as [number, number][]);
    else if (key === 'curves') out.curves = roundCurves(v as (Curve | null)[]);
    else if (typeof v === 'number' && !UNITLESS.includes(key)) out[key] = plus(out[key] as Expr, was[key] as number, v - (was[key] as number));
  if (shape.kind === 'polygon' || shape.kind === 'line') out.sizes = sizesAfter(shape, old, next);
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

/** A size of a line's or polygon's side set (`d`: an arc's, moving as its middle handle does; a free arc stays at least as wide as its ends): its points follow, the formula stays. */
function setSide(path: string[], side: number, key: 'l' | 'deg' | 'd', value: Expr, live: boolean) {
  const doc = history.current;
  const shape = getIn(doc, path) as Extract<Profile, { pts: unknown }>;
  const sizes = Array.from({ length: shape.pts.length }, (_, k) => shape.sizes?.[k] ?? null);
  sizes[side] = { ...sizes[side], [key]: value };
  const errors = new Map<string, string>();
  const asked = resolve({ ...shape, sizes }, paramLookup(doc.params), '', errors) as unknown as Extract<DrawnProfile, { pts: unknown }>;
  if (errors.size) return fail([...errors.values()][0]);
  if (key !== 'deg' && !(asked.sizes![side]![key]! > 0)) return fail(`${key === 'd' ? 'A diameter' : 'A length'} above 0`);
  const next = sized(asked);
  // a plain number it could not reach: what it reached
  const reached = sideNow(next, side).d;
  if (key === 'd' && reached !== null && isPlain(value.e)) sizes[side] = { ...sizes[side], d: len(reached) };
  const changed = setIn(doc, path, { ...shape, sizes, pts: roundPts(next.pts), ...(next.curves ? { curves: roundCurves(next.curves) } : {}) });
  if (live) history.replace(changed);
  else history.push(changed);
  update();
}

/** The reference point is the stored centre: X / Y fields then edit the stored expressions. */
const centred = (p: DrawnProfile, ref: [number, number]) => !ref[0] && !ref[1] && p.kind !== 'polygon' && p.kind !== 'line';

/** Drags a finish's size from `at` (up: bigger; past 0 a fillet turns into a chamfer and back); release or a click ends it. */
function dragFinish(body: string, feature: string, at: Vector3) {
  const before = history.current;
  const i = stepsOf(before, body);
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
      hint: 'Drag up: bigger, down: smaller · past 0 a fillet turns into a chamfer and back · [Shift] coarse · [Ctrl] precise · type a change · release or [Enter]: done · [Esc] puts it back',
      label: (d, typed) => {
        const v = clamped(feature, start + d);
        return `${v >= 0 ? 'Fillet' : 'Chamfer'} ${typed === undefined ? Math.abs(v).toFixed(2) : caret(typed)}`;
      },
      endOnUp: true,
    },
  );
}

/**
 * How a face pushes or pulls `doc` by `mm` along its outward normal: an end face changes its extrusion's depth, a side
 * moves that side of its shape (in the sketch, if linked); values keep their expressions. Any other flat face gets a
 * Push / pull step. Null: a round face or a finish's.
 */
function facePull(doc: Doc, face: FaceItem): ((d: Doc, mm: number) => Doc) | null {
  const features = built.get(face.body);
  const pl = bodyPlace(face.body);
  const pull = facePullOnly(doc, face, features, pl);
  if (!pull) return null;
  // the finishes' picked edges on that face go along with it
  const [at, n, i] = [unplaced(pl, face.point.toArray()), norm(unplaced(pl, face.n.toArray(), true)), stepsOf(doc, face.body)];
  return (d, mm) => movedEdges(pull(d, mm), i, at, n, mm);
}

/**
 * The finishes of body `i` with their picked edges (and left out edges) where a face moved: their points on its plane
 * (through `at`, square to `n`, body coordinates) moved `mm` along `n`; a straight edge stays straight between its ends.
 */
function movedEdges(doc: Doc, i: number, at: V3, n: V3, mm: number, tol = 0.01): Doc {
  const move = (p: V3): V3 => (Math.abs(dot(sub(p, at), n)) < tol ? add(p, scale(n, mm)) : p);
  const straight = (pts: V3[]) => pts.length < 3 || pts.every((p) => Math.hypot(...cross(sub(p, pts[0]), norm(sub(pts.at(-1)!, pts[0])))) < tol);
  const line = (pts: V3[]): V3[] => {
    const [a, b] = [move(pts[0]), move(pts.at(-1)!)];
    return straight(pts) ? pts.map((_, k) => add(a, scale(sub(b, a), k / (pts.length - 1 || 1)))) : pts.map(move);
  };
  const features = doc.bodies[i].features.map((f) => (f.type === 'finish' && typeof f.edges === 'object' ? { ...f, edges: { ...f.edges, pts: f.edges.pts.map(line) }, skip: f.skip.map(move) } : f));
  return setIn(doc, ['bodies', String(i), 'features'], features);
}

/** How pulling a face (`face`) by mm changes the document, edges aside (see `facePull`); null: it cannot be pulled. */
function facePullOnly(doc: Doc, face: FaceItem, features: BuildFeature[] | undefined, pl: Place): ((d: Doc, mm: number) => Doc) | null {
  // any other flat face: a Push / pull step of its own (in the steps it belongs to: a linked copy's source's)
  const push = () => {
    if (face.round || face.finish) return null;
    const [i, id] = [stepsOf(doc, face.body), newId()];
    const step = (mm: number): Feature => ({ id, type: 'push', at: unplaced(pl, face.point.toArray()), n: unplaced(pl, face.n.toArray(), true), distance: len(mm) });
    return (d: Doc, mm: number) => setIn(d, ['bodies', String(i), 'features'], [...d.bodies[i].features, step(mm)]);
  };
  const hit = features && faceAt(features, unplaced(pl, face.point.toArray()), unplaced(pl, face.n.toArray(), true));
  if (!hit) return push();
  const bi = doc.bodies.findIndex((b) => b.features.some((f) => f.id === hit.feature));
  const fi = doc.bodies[bi]?.features.findIndex((f) => f.id === hit.feature) ?? -1;
  const feature = doc.bodies[bi]?.features[fi];
  if (feature?.type !== 'extrude') return push();
  const lookup = paramLookup(doc.params);
  const featurePath = ['bodies', String(bi), 'features', String(fi)];
  if (hit.kind === 'cap') {
    // the end face changes the depth, the face behind the plane how far it reaches back
    const key = hit.back ? 'back' : 'depth';
    const value = feature[key] ?? len(0);
    const mm0 = resolve(value, lookup, '', new Map()) as number;
    return (d, mm) => setIn(d, [...featurePath, key], plus(value, mm0, mm * hit.rate));
  }
  const src = feature.source;
  const k = src.kind === 'sketch' ? doc.sketches.findIndex((s) => s.id === src.sketch) : -1;
  const list = src.kind === 'sketch' ? (doc.sketches[k]?.shapes ?? []) : src.profiles;
  const j = list.findIndex((q) => q.id === hit.shape);
  if (j < 0) return null;
  const path = src.kind === 'sketch' ? ['sketches', String(k), 'shapes', String(j)] : [...featurePath, 'source', 'profiles', String(j)];
  const old = resolve(list[j], lookup, '', new Map()) as DrawnProfile;
  return (d, mm) => setIn(d, path, rewrite(list[j], old, pushed(old, hit.edge, mm * hit.rate)));
}

/** Areas of the shown sketches by id, kept while their shapes stay the same. */
const areaCache = new Map<string, { key: string; areas: AreaMesh[] }>();

async function areasOf(s: ViewSketch) {
  const shapes = s.shapes.filter((q) => !q.construction);
  const key = JSON.stringify(shapes);
  const kept = areaCache.get(s.id);
  if (kept?.key === key) return kept.areas;
  const areas = shapes.length ? await kernel.areas(shapes) : [];
  areaCache.set(s.id, { key, areas });
  return areas;
}

/** A shown sketch as the place to draw or pull on. */
const targetOf = (s: ViewSketch, name = 'the sketch'): Target => ({ sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name });

/**
 * Extrude: picks faces of extrusions and areas of the shown sketches, then pulls them all by one distance (one undo
 * step): each sketch's areas become new bodies, each face pushes or pulls its extrusion. `faces`, or `sketch` (all its
 * areas), are picked already and pull at once; `focus`: the sketch in sketch mode. The tool stays on until Esc.
 */
async function startExtrude(start: { faces?: FaceItem[]; sketch?: string; shapes?: string[]; focus?: string } = {}) {
  stopTool();
  const run = extrudeRun;
  const groups = await Promise.all(viewer.sketches.map(async (s) => ({ target: targetOf(s), areas: await areasOf(s), picked: new Set<number>() })));
  if (run !== extrudeRun) return; // another tool started meanwhile
  const notPulled = 'Only flat faces can be pushed or pulled (a round one: Bulge it)';
  const accept = (f: FaceItem) => !!facePull(history.current, f) || (fail(notPulled), false);
  // the faces pull live: from the document before, as built then
  let pulls: { before: Doc; by: ((d: Doc, mm: number) => Doc)[] } | null = null;
  const pulledFaces = (faces: FaceItem[], mm: number) => {
    pulls ??= { before: history.current, by: faces.map((f) => facePull(history.current, f)!) };
    return pulls.by.reduce((d, by) => by(d, mm), pulls.before);
  };
  const undoLive = () => {
    if (pulls && history.current !== pulls.before) (history.undo(), update());
    pulls = null;
  };
  extruding = viewer.startExtrude(
    toolHost,
    {
      accept,
      live(faces, mm) {
        const was = pulls;
        const next = pulledFaces(faces, mm);
        if (was) history.replace(next);
        else history.push(next);
        update();
      },
      cancel: undoLive,
      resize: (f) => (stopTool(), dragFinish(f.body, f.finish!, f.point)),
      done(r) {
        if (!r) return stopTool(), render();
        let doc = r.faces.length ? pulledFaces(r.faces, r.depth) : history.current;
        undoLive(); // the faces' live step: replaced by the whole pull
        const made: string[] = [];
        for (const g of r.groups) {
          const out = withSketched(doc, { ...g, depth: r.depth, depthTyped: r.depthTyped, back: r.back, backTyped: r.backTyped, mode: 'add' });
          doc = out.doc;
          made.push(...(out.made ?? []));
        }
        if (made.length) [selected, shapeSel] = [made, []];
        commit(doc);
        if (sketching) exitSketch(); // an extrusion finishes the sketch
        void startExtrude();
      },
    },
    groups.filter((g) => g.areas.length),
    (start.faces ?? []).filter(accept),
    start.focus,
  );
  if (start.sketch && !extruding.pickSketch(start.sketch, start.shapes)) fail('Nothing to extrude there: closed shapes or faces lines enclose');
  toolMode = 'pull';
  render();
}

/** Sketch mode on a sketch: R / C / P draw flat into it (`kind` starts one); `look` turns the camera to its plane, its shapes in the middle. */
function enterSketch(id: string, kind: ToolKind | null = null, look = false) {
  const s = viewer.sketches.find((v) => v.id === id);
  if (!s) return fail('Show the sketch to draw on it');
  if (sketching !== id) sketchPath = [];
  sketching = id;
  [selected, shapeSel] = [[id], shapeSel];
  if (look) {
    const box = new Box3().setFromPoints(sketchHull(s).map((p) => new Vector3(...p)));
    viewer.lookAlong(new Vector3(...s.frame.n), box.isEmpty() ? undefined : box.getCenter(new Vector3()));
  }
  viewer.setSketchGrid(s.frame);
  showSelection();
  if (kind) startTool(kind);
}

/** Leaves sketch mode; a sketch left empty (and used by no body) goes, in the same undo step. */
function exitSketch() {
  const doc = history.current;
  const left = doc.sketches.find((x) => x.id === sketching);
  const empty = left && !left.shapes.length && !doc.bodies.some((b) => b.features.some((f) => sourceSketch(f) === left.id));
  sketching = null;
  sketchPath = [];
  solid = new Set();
  SketchTool.dropGuides();
  stopTool();
  viewer.setSketchGrid(null);
  if (!empty) return render();
  selected = selected.filter((id) => id !== left.id);
  history.replace({ ...doc, sketches: doc.sketches.filter((x) => x !== left) });
  update();
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
 * E: picks what is selected, to pull on Enter (more can be picked first): faces picked with Alt-click, a sketch's
 * selected shapes or all of them (inner ones holes; in sketch mode the view turns from flat at once), the face last
 * clicked on a selected body. With nothing selected it waits for picks.
 */
function extrude() {
  const faces = viewer.pickedFaceItems();
  if (faces.length) viewer.dropPicked();
  const id = activeSketch();
  const s = id ? viewer.sketches.find((v) => v.id === id) : undefined;
  if (id && !s) return fail('Show the sketch to extrude it');
  if (s && sketching) viewer.unflatten(new Vector3(...s.frame.n));
  const last = id || faces.length ? null : viewer.lastFaceItem();
  void startExtrude({ faces: faces.length ? faces : last && selected.includes(last.body) ? [last] : [], sketch: s?.id, shapes: shapeSel, focus: sketching ?? undefined });
}

/** Picks a face; a section lies on it, removing the side towards the camera. */
function newSection() {
  toolHint = 'Section: click a face · empty space: the base plane facing you · it removes what is in front · [Esc] cancels';
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
  }, false, false, null, true);
}

/** The next click sets what a custom section turns around (shown while hovering); Esc keeps it. */
function sectionAxis(i: number) {
  toolHint = 'Click what the section turns around · an edge or line, or a circle (its centre) · [Esc] keeps it';
  render();
  const id = history.current.sections[i].id;
  viewer.pickAxis(
    (a) => {
      toolHint = null;
      tips.cursorTip(null);
      viewer.showAxis(null);
      const doc = history.current;
      if (a) commit({ ...doc, sections: doc.sections.map((c) => (c.id === id ? { ...c, axis: { at: a.at.toArray(), dir: a.dir.toArray() } } : c)) });
      else render();
    },
    (a) => {
      tips.cursorTip(a ? `${a.what}\nClick: the section turns around it` : null);
      viewer.showAxis(a, a?.at, 100);
    },
  );
}

function setMaterialOf(ids: string[], material: string | undefined) {
  commit(runCommand(history.current, 'material', { ids, ...(material ? { material } : {}) }).doc);
}

/** The selection's bodies and groups. */
const lookTargets = () => [...history.current.bodies, ...history.current.groups].filter((x) => selected.includes(x.id));

/** The materials dialog on the selection; `fresh`: it gets a new material of the file first. */
function materialsDialog(fresh = false) {
  const ids = () => lookTargets().map((x) => x.id);
  /** A change: one undo step for a whole drag. */
  const put = (next: Doc, live: boolean) => {
    if (live) history.replace(next);
    else history.push(next);
    update();
  };
  if (fresh && ids().length) put(newMaterialFor(history.current, ids(), newId()), false);
  openMaterials({
    saved: () => history.current.materials,
    target() {
      const list = lookTargets();
      return list.length > 1 ? `${list.length} objects` : (list[0]?.name ?? null);
    },
    current() {
      const [first] = lookTargets();
      return { material: first?.material, look: setLook(history.current, first) ?? plainLook('color' in first ? first.color : '#d8c3a0') };
    },
    assign: (material) => setMaterialOf(ids(), material),
    changeLook: (patch, live) => put(changeLook(history.current, ids(), patch, newId()), live),
    add(look) {
      const id = newId();
      commit({ ...history.current, materials: [...history.current.materials, { ...(look ?? plainLook('#d8c3a0')), id, name: `Material ${history.current.materials.length + 1}` }] });
      return id;
    },
    edit: (id, patch, live) => put({ ...history.current, materials: history.current.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }, live),
    remove: (id) => commit(dropMaterial(history.current, id)),
    async importFile(f) {
      // one that is there already, name and look, comes in once
      const same = ({ id: _, ...m }: Material) => JSON.stringify(Object.entries(m).sort());
      const known = new Set(history.current.materials.map(same));
      const fresh = fromMtlx(await f.text()).filter((m) => !known.has(same(m)));
      commit({ ...history.current, materials: [...history.current.materials, ...fresh] });
      notify(`Imported ${fresh.length} new material${fresh.length === 1 ? '' : 's'} from ${f.name}`);
    },
    exportFile: () => download(new Blob([toMtlx(history.current.materials)], { type: 'application/xml' }), `${project()}_materials.mtlx`),
    light: renderLight,
  });
}

/** The photo spheres added in this browser, for every design (see `photolibrary`). */
let library: PhotoSphere[] = [];
void loadPhotos().then((photos) => {
  library = photos;
  update();
});
/** Those of this document and of this browser. */
const allPhotos = () => [...history.current.photos, ...library.filter((p) => !history.current.photos.some((x) => x.id === p.id))];

function settingsDialog(start?: 'light-render') {
  openSettings(
    settings,
    (next) => {
      const remesh = next.meshDetail !== settings.meshDetail;
      settings = next;
      applySettings();
      if (remesh) {
        kernel.setTolerance(next.meshDetail);
        update();
      }
    },
    {
      units: () => history.current.units,
      setUnits: (units) => commit({ ...history.current, units }),
      photos: allPhotos,
      addPhoto,
      removePhoto(id) {
        library = library.filter((p) => p.id !== id);
        void dropPhoto(id);
        commit({ ...history.current, photos: history.current.photos.filter((p) => p.id !== id) });
      },
    },
    start,
  );
}

/** The light renders take. */
const renderLight = () => effectiveLight(settings.renderLight.same ? settings.light : settings.renderLight);

/** Keeps a photo sphere in the document, its long side at most 4096 px (it travels with every saved version). */
async function addPhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, 4096 / bitmap.width);
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * k), height: Math.round(bitmap.height * k) });
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (Math.abs(bitmap.width / bitmap.height - 2) > 0.1) notify(`${file.name} is not about 2:1: a photo sphere covers all around, so this one looks stretched`);
  bitmap.close();
  const photo: PhotoSphere = { id: newId(), name: file.name.replace(/\.[^.]*$/, ''), data: canvas.toDataURL('image/jpeg', 0.85) };
  commit({ ...history.current, photos: [...history.current.photos, photo] });
  library = [...library, photo];
  await keepPhoto(photo);
  return photo.id;
}

/** Autosave writes in place a moment after the last change, a version only every `every` ms; it needs a file handle. */
function scheduleAutosave(delay = 1500, every = 5 * 60_000) {
  clearTimeout(autosaveTimer);
  if (!autosave || !file.handle || history.current === file.saved) return;
  autosaveTimer = window.setTimeout(
    () =>
      run(async () => {
        const doc = history.current;
        const last = file.versions.at(-1);
        const versions = !last || Date.now() - versionDate(last).getTime() > every ? addVersion(file.versions, doc) : file.versions;
        await saveFile(pack(doc, versions), file.name, file.handle);
        file = { ...file, saved: doc, versions };
        notify(`Autosaved ${new Date().toLocaleTimeString()}`);
      }),
    delay,
  );
}

// closing or reloading with unsaved changes: the browser asks first, in its own words
addEventListener('beforeunload', (e) => {
  if (history.current !== file.saved) e.preventDefault();
});

/**
 * The versions saved in the file, newest first: a click shows one (in the view, one undo step), Enter or Restore keeps
 * it, Esc or the close button goes back. Each save keeps one, autosave one every few minutes.
 */
let versionsClose: (() => void) | null = null;
function versionsPanel() {
  if (versionsClose) return versionsClose();
  stopTool();
  if (sketching) exitSketch();
  const box = Object.assign(document.createElement('div'), { className: 'clash-panel', onmousedown: (e: MouseEvent) => e.stopPropagation() });
  const head = Object.assign(document.createElement('div'), { className: 'head' });
  head.append(Object.assign(document.createElement('h3'), { textContent: 'Versions' }), closeButton('Back to now (Esc)', () => close(false)));
  const list = Object.assign(document.createElement('div'), { className: 'version-list' });
  const keep = Object.assign(panelButton('Restore this version', 'Click: Keep the version shown: one undo step, your last state stays in the undo', () => close(true)), { hidden: true });
  let shown: Version | null = null;
  let pushed = false;
  const pluralOf = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const row = (v: Version | null, when: string, what: string, title: string) => {
    const b = Object.assign(document.createElement('button'), { className: 'version', title, onclick: () => show(v, b) });
    b.append(Object.assign(document.createElement('b'), { textContent: when }), Object.assign(document.createElement('small'), { textContent: what }));
    return b;
  };
  const show = (v: Version | null, el: HTMLElement) => {
    if (v === shown) return;
    if (!v) {
      undo();
      pushed = false;
    } else {
      if (pushed) history.replace(v.doc);
      else history.push(v.doc);
      pushed = true;
    }
    shown = v;
    [selected, shapeSel] = [[], []];
    for (const c of list.children) c.classList.toggle('on', c === el);
    keep.hidden = !v;
    update();
  };
  const dated = (v: Version) => versionDate(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const counts = (d: Doc) => `${pluralOf(d.bodies.length, 'body').replace('bodys', 'bodies')}, ${pluralOf(d.sketches.length, 'sketch').replace('sketchs', 'sketches')}`;
  const now = row(null, 'Now', counts(history.current), 'Click: Back to where you are now');
  now.classList.add('on');
  list.append(now, ...[...file.versions].reverse().map((v) => row(v, dated(v), counts(v.doc), 'Click: Show this version')));
  const note = Object.assign(document.createElement('p'), { className: 'hint', textContent: file.versions.length ? 'Click one to see it. Nothing changes until you restore it.' : 'None yet: each save keeps a version, autosave one every few minutes.' });
  box.append(head, note, list, keep);
  document.body.append(box);
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || (!pressed(e, 'cancel') && !(pressed(e, 'confirm') && shown))) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close(pressed(e, 'confirm'));
  };
  addEventListener('keydown', keys, { capture: true });
  const close = (kept: boolean) => {
    if (pushed && !kept) undo();
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    versionsClose = null;
    notify(kept ? `Restored the version of ${dated(shown!)}. Undo brings the other back` : '');
    render();
  };
  versionsClose = () => close(false);
  render();
}

/** Once per unsaved design, after some undo steps: a click on the note saves it and turns autosave on. */
function offerAutosave() {
  if (offered || autosave || file.handle || history.steps < OFFER_AFTER) return;
  offered = true;
  notify('Save this design and turn autosave on? Click here', false, () => ((status = ''), (statusAction = null), void toggleAutosave()));
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
  const sources = doc.bodies.filter((p) => selected.includes(p.id));
  const copies = copiesOf(sources, doc.sketches.filter((s) => selected.includes(s.id)), ' copy');
  placeCopies(copies, [5, 5, 0], { sources: sources.map((b) => b.id), copies: copies.bodies.map((b) => b.id) });
}

/**
 * Copies of bodies and sketches with new ids throughout, named with `suffix`; a copied body extruded from a copied
 * sketch is linked to that copy (its shapes and areas too). `linked`: the bodies are linked copies (sharing their
 * source's steps, keeping only their own); else a linked body's copy gets all its steps.
 */
function copiesOf(bodies: Body[], sketches: Sketch[], suffix: string, linked = false) {
  const doc = history.current;
  const shared = (b: Body) => doc.bodies.find((s) => s.id === b.link)?.features ?? [];
  bodies = bodies.map((b) => (linked ? { ...b, link: b.link ?? b.id, features: b.link ? b.features : [] } : { ...b, link: null, features: [...shared(b), ...b.features] }));
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
      if (c.type === 'sweep') return { ...c, profile: { sketch: renamed(c.profile.sketch), shape: renamed(c.profile.shape) }, path: { sketch: renamed(c.path.sketch), shape: renamed(c.path.shape) } };
      if (c.type === 'bulge') return c.on.kind === 'sketch' ? { ...c, on: { ...c.on, sketch: renamed(c.on.sketch), shapes: c.on.shapes.map(renamed) } } : c;
      if (c.type !== 'extrude' && c.type !== 'revolve') return c;
      const src = c.source;
      if (src.kind === 'own') return src.plane.kind === 'cap' ? { ...c, source: { ...src, plane: { ...src.plane, feature: renamed(src.plane.feature) } } } : c;
      return { ...c, source: { ...src, sketch: renamed(src.sketch), shapes: src.shapes.map(renamed), areas: src.areas?.map((a) => ({ ...a, in: a.in.map(renamed), out: a.out.map(renamed) })) } };
    }),
  }));
  return { bodies: bodyCopies, sketches: sketchCopies };
}

/** Adds copies (see `copiesOf`), selects them and opens the move fields at `start` (mm), to type where they go. */
function placeCopies({ bodies, sketches }: ReturnType<typeof copiesOf>, start: Vec3, made?: { sources: string[]; copies: string[] }) {
  const doc = history.current;
  selected = [...bodies, ...sketches].map((c) => c.id);
  commit({ ...doc, bodies: [...doc.bodies, ...bodies], sketches: [...doc.sketches, ...sketches] });
  if (selected.length) moveAlong(0, true, start, made);
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

/** The rotation field in use (focused or scrubbed): its path. */
let rotationField: string | null = null;

/** The orange indicator for the rotation field in use: its turn, after those that come later in the order X, Y, Z. */
function showRotationField() {
  const m = rotationField?.match(/^(bodies|groups)\.(\d+)\.(?:origin\.)?rotation\.r([xyz])$/);
  const doc = history.current;
  const owner = m && doc[m[1] as 'bodies' | 'groups'][Number(m[2])];
  if (!m || !owner) return viewer.showTicks(null);
  const lookup = paramLookup(doc.params);
  const r = 'rotation' in owner ? owner.rotation : owner.origin.kind === 'custom' ? owner.origin.rotation : null;
  if (!r) return viewer.showTicks(null);
  const [rx, ry, rz] = [r.rx, r.ry, r.rz].map((x) => evalLength(x, lookup) / UNITS[x.u]); // degrees: the numbers as typed
  if (![rx, ry, rz].every(Number.isFinite)) return viewer.showTicks(null);
  const rad = Math.PI / 180;
  const k = 'xyz'.indexOf(m[3]);
  // while typing: what stands in the field, not yet in the document
  const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.path === rotationField ? length(document.activeElement.value) : null;
  const before = new Quaternion().setFromRotationMatrix(parentPlace(owner.id));
  if (k < 2) before.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz * rad));
  if (k < 1) before.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry * rad));
  const unit = (i: number) => new Vector3().setComponent(i, 1).applyQuaternion(before);
  const at = new Vector3().setFromMatrixPosition(bodyPlaces.get(owner.id) ?? groupPlace(owner.id));
  viewer.showTicks({ at, dir: unit(k), from: at.clone().addScaledVector(unit((k + 1) % 3), 30), step: SketchTool.angleStep, angle: typing === null ? [rx, ry, rz][k] : typing / UNITS[doc.units] });
}

{
  const pathOf = (t: EventTarget | null) => (t instanceof Element ? (t.closest('label.field')?.querySelector('input') ?? t.closest('input'))?.dataset.path : undefined);
  const use = (path: string | undefined) => {
    const next = path && /\.rotation\.r[xyz]$/.test(path) ? path : null;
    if (next === rotationField) return;
    rotationField = next;
    showRotationField();
  };
  addEventListener('focusin', (e) => use(pathOf(e.target)));
  addEventListener('input', () => rotationField && showRotationField());
  addEventListener('focusout', () => use(undefined));
  addEventListener('pointerdown', (e) => pathOf(e.target) && use(pathOf(e.target)), { capture: true });
  addEventListener('pointerup', () => setTimeout(() => !document.activeElement?.closest('label.field') && use(undefined)));
}

function render() {
  if (rotationField) showRotationField();
  viewer.el.classList.toggle('picking', !!pending); // objects to pick: crosshair
  syncFocus();
  const info = infoOf();
  const doc = history.current;
  const lookup = paramLookup(doc.params);
  const ctx: UIContext = {
    // a cut being set up: its new chunk is not listed until the cut is kept
    doc: cutting ? { ...doc, bodies: doc.bodies.filter((b) => !cutting!.chunks.includes(b.id)) } : doc,
    selected,
    exprErrors,
    kernelErrors: new Map([...kernelErrors, ...linkErrors]),
    lostEdges: (body, feature) => lostEdges.get(body)?.[feature] ?? 0,
    title: file.name,
    dirty: doc !== file.saved,
    status,
    busy: [...new Set([...reading].filter(([id]) => doc.bodies.some((b) => b.id === id)).map(([, r]) => `Reading ${r.name}`)), ...busy],
    shapes: shapeSel,
    active: pending?.tool ?? (toolMode === 'pull' && !viewer.activeTool ? 'extrude' : toolMode === 'plane' ? 'sketch' : viewer.activeTool),
    // the tool's own notes show in the top bar (see showNote); the footer has the hints for what is selected
    hint:
      (finishSel
        ? `${finishSel.mid ? 'A part of a finish' : 'A whole finish'} · drag it to resize (past 0: the other kind) · [Del] ${finishSel.mid ? 'leaves this edge out' : 'deletes it'} · double-click selects the whole finish`
        : pickedPart?.kind === 'edge'
          ? 'Drag a picked edge up: fillet, down: chamfer · [Alt]-click another edge ([Shift]: more), double-click: its tangent chain (a circle, a rounded outline) · [Esc] deselect'
          : null),
    autosave,
    notify: fail,
    statusError,
    info,
    minStep: settings.minStep,
    showMeasure: (what) => (what === 'at' ? viewer.showPoint(info?.at ? new Vector3(...info.at) : null) : viewer.showMeasure(what === null ? null : (info?.box ?? null), what ?? 0)),
    solid,
    grouped: groupOf(history.current),
    setSolid(ids, on) {
      solid = new Set(on ? [...solid, ...ids] : [...solid].filter((x) => !ids.includes(x)));
      showSelection();
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
    setSide,
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
    moveInto: (ids, group) => commit(movedInto(listedElsewhere(history.current, ids), ids, group)),
    groupTool,
    moveTool: () => moveAlong(0, true),
    cutTool: () => cutTool(),
    revolveTool,
    sweepTool,
    planeTool,
    drawOn(id) {
      const doc = history.current;
      const sketch: Sketch = { id: newId(), name: `Sketch ${doc.sketches.length + 1}`, group: null, plane: { kind: 'work', plane: id }, shapes: [], groups: [], visible: true };
      commit({ ...doc, sketches: [...doc.sketches, sketch] });
      enterSketch(sketch.id, null, true);
    },
    offsetTool,
    clashTool,
    coatTool,
    sectionAxis,
    coatEdit: (body, feature) => coatPanel(body, feature),
    mirrorTool,
    patternTool: () => patternTool(),
    threadTool,
    rotateTool,
    alignObjects,
    previewAlign,
    jointTool,
    editJoint: (id) => jointPanel(id, false),
    moveJointEnd(id, from, to) {
      const doc = history.current;
      const k = doc.joints.findIndex((x) => x.id === id);
      const j = doc.joints[k];
      if (!j || to === j.parent || j.children.includes(to)) return fail('That object is already part of this joint');
      if (from !== j.parent) return commit(setIn(doc, ['joints', String(k), 'children'], j.children.map((c) => (c === from ? to : c))));
      // a new parent: the axis stays where it is in the world, counted in the new parent's coordinates
      const { at, dir } = jointAxis(j);
      const back = (bodyPlaces.get(to) ?? groupPlace(to)).clone().invert();
      commit(setIn(doc, ['joints', String(k)], { ...j, parent: to, axis: { at: at.applyMatrix4(back).toArray(), dir: dir.transformDirection(back).toArray() } }));
    },
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
    lightSketch: (id) => viewer.lightSketch(id),
    lightPlane: (id) => viewer.lightPlane(id),
    lightImage: (id) => viewer.lightImage(id),
    calibrate,
    editPlane: (id) => planePanel(id),
    measureTool: () => measureTool(),
    boxJoint,
    editBulge: bulgePanel,
    editFingers: fingersPanel,
    lightBodies: (ids) => viewer.lightBodies(ids ? contents(history.current, ids) : []),
    breakLinks,
    unlinkCopy,
    showJoint(id) {
      const j = history.current.joints.find((x) => x.id === id);
      if (j) viewer.select(contents(history.current, j.children));
      else showSelection();
    },
    loftTool,
    bulgeTool,
    draftTool,
    editDraft: draftPanel,
    groupSelected: selected.length === 1 && doc.groups.some((g) => g.id === selected[0]),
    arrange,
    select,
    isolated: isolated?.body ?? null,
    isolate,
    previewColor: (id, color) => viewer.previewColor(id, color),
    setMaterialOf,
    openMaterials: materialsDialog,
    startTool,
    extrude,
    sketching,
    newSketch: startNewSketch,
    editSketch(id) {
      const pulling = extruding?.picking(); // Extrude first: the sketch gets pulled instead
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
    versions: versionsPanel,
    importFile: pickImport,
    exportPrint: () => void exportPanel('print'),
    exportLaser: () => void exportPanel('laser'),
    exportStep: () => run(() => exportBodies('step')),
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
    openSettings: () => settingsDialog(),
    terminal: { toggle: () => terminal.toggle(), open: terminal.isOpen() },
    openRenderLight: () => settingsDialog('light-render'),
    photos: allPhotos,
    duplicate: () => (shapeSel.length ? duplicateShapes() : selected.length ? duplicate() : pickFor('duplicate', duplicate)),
    remove,
    newDoc() {
      load({ schema: 32, units: history.current.units, params: {}, bodies: [], sketches: [], groups: [], sections: [], joints: [], planes: [], images: [], materials: [], photos: [], renders: [] }, { name: `untitled${EXTENSION}`, versions: [] });
    },
    open: () => run(openDesign),
    save: () => run(save),
    undo: () => undo(),
    redo: () => undo(true),
  };
  renderUI(ctx);
  renderJoints();
  showNote();
}

/**
 * Exports one file per selected body (else per shown body), several as one ZIP; tool bodies are left out (their cuts
 * and joins are in their owners). stl: for 3D print, placed as in the world; svg: for the laser, the outline of the
 * body's biggest flat face at 1:1 without fillets and chamfers.
 */
/** The bodies an export takes: the selected ones (groups: their bodies), else all shown; tool bodies are part of their owner. */
function exportable() {
  const doc = history.current;
  const tools = new Set(ownersOf(doc).keys());
  const chosen = contents(doc, selected).filter((id) => doc.bodies.some((b) => b.id === id));
  return doc.bodies.filter((b) => (chosen.length ? chosen.includes(b.id) : b.visible) && !tools.has(b.id) && built.has(b.id));
}

/** Exports bodies (default: `exportable`) as files (`extra`: a laser face and kerf per body). */
async function exportBodies(format: ExportFormat, bodies = exportable(), extra: (b: Body) => Partial<ExportBody> = () => ({})) {
  if (!bodies.length) return fail('Nothing to export: select bodies that build (tool bodies are part of their owner)');
  const taken = new Map<string, number>();
  const nameOf = (b: Body) => {
    const base = b.name.replace(/[^\w.-]+/g, '_') || 'body';
    const n = (taken.get(base) ?? 0) + 1;
    taken.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  };
  const { files, failed } = await kernel.export(format, bodies.map((b) => ({ name: nameOf(b), color: lookOf(history.current, b).color, features: built.get(b.id)!, place: bodyPlace(b.id), ...extra(b) })));
  const type = { stl: 'model/stl', '3mf': 'model/3mf', step: 'model/step', svg: 'image/svg+xml', dxf: 'image/vnd.dxf' }[format];
  if ((format === 'step' || format === '3mf') && files.length) download(new Blob([files[0].data], { type }), `${project()}.${format}`);
  else if (files.length === 1) download(new Blob([files[0].data], { type }), `${files[0].name}.${format}`);
  else if (files.length) download(new Blob([zipSync(Object.fromEntries(files.map((f) => [`${f.name}.${format}`, new Uint8Array(f.data)])))]), `${project()}_${format}.zip`);
  notify(`Exported ${format === 'step' || format === '3mf' ? `${bodies.length - failed.length} bodies as one ${format.toUpperCase()} file` : `${files.length} ${format.toUpperCase()} file${files.length === 1 ? '' : 's'}`}${failed.length ? `; could not make: ${failed.join(', ')}` : ''}`, failed.length > 0);
}

/** The export panels' choices, this session. */
const exportChoice = { laser: 'svg' as 'svg' | 'dxf', print: 'stl' as 'stl' | '3mf', kerf: '0' };

/**
 * Laser or 3D print export: a panel at the top lists the bodies it takes (see `exportable`), each ticked (untick to
 * leave it out; hovering a row lights it). Laser: per body the face to cut (its biggest flat one, or one clicked),
 * the kerf, SVG or DXF. Print: per body whether it is closed, manifold and sound, its size; STL or 3MF. Export (Enter)
 * makes the files.
 */
async function exportPanel(kind: 'laser' | 'print') {
  const bodies = exportable();
  if (!bodies.length) return fail('Nothing to export: select bodies that build (tool bodies are part of their owner)');
  const doc = history.current;
  const on = new Set(bodies.map((b) => b.id));
  const faces = new Map<string, { at: Vec3; n: Vec3 }>();
  const box = Object.assign(document.createElement('div'), { className: 'axis-move cut-panel export-panel' });
  const close = () => {
    box.remove();
    removeEventListener('keydown', keys, { capture: true });
    viewer.lightBodies([]);
    viewer.cancelFacePick();
    toolHint = null;
    render();
  };
  const go = () => {
    const chosen = bodies.filter((b) => on.has(b.id));
    close();
    if (kind === 'print') return void run(() => exportBodies(exportChoice.print, chosen));
    const kerf = length(exportChoice.kerf) ?? 0;
    void run(() => exportBodies(exportChoice.laser, chosen, (b) => ({ face: faces.get(b.id), kerf })));
  };
  const keys = (e: KeyboardEvent) => {
    if (e.defaultPrevented || (!pressed(e, 'confirm') && !pressed(e, 'cancel'))) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (pressed(e, 'confirm')) go();
    else close();
  };
  // the checks for printing, filled in when they come
  const checks = new Map<string, PrintCheck>();
  const rows = () =>
    bodies.map((b) => {
      const tick = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on.has(b.id), onchange: () => (tick.checked ? on.add(b.id) : on.delete(b.id)) });
      const row = Object.assign(document.createElement('label'), { className: 'export-row', onmouseenter: () => viewer.lightBodies([b.id]), onmouseleave: () => viewer.lightBodies([]) });
      row.append(tick, Object.assign(document.createElement('span'), { className: 'name', textContent: b.name }));
      if (kind === 'laser') {
        const picked = faces.get(b.id);
        const faceButton = panelButton(picked ? 'Face: picked' : 'Face: auto', 'The face cut out: its biggest flat one (auto), or click one of it', () => {
          toolHint = `Laser: click the face of ${b.name} to cut out · [Esc] keeps it as it was`;
          render();
          viewer.pickFace((p) => {
            toolHint = 'Laser: untick what stays out · Face: which face is cut · [Enter] exports · [Esc] cancels';
            if (p?.item?.body === b.id) {
              const pl = bodyPlace(b.id);
              faces.set(b.id, { at: unplaced(pl, p.item.point.toArray()), n: unplaced(pl, p.item.n.toArray(), true) });
            } else if (p) fail(`That is not a face of ${b.name}`);
            draw();
          });
        });
        row.append(faceButton, ...(picked ? [panelButton('×', 'Back to its biggest flat face', () => (faces.delete(b.id), draw()))] : []));
      } else {
        const c = checks.get(b.id);
        const [x, y, z] = (c?.size ?? [0, 0, 0]).map((v) => fmt(+(v / UNITS[doc.units]).toFixed(1)));
        const problems = c ? [!c.closed && 'not closed', !c.manifold && 'not manifold', !c.sound && 'unsound', c.size.some((v) => v > 0 && v < 1) && 'under 1 mm: units?', c.size.some((v) => v > 1000) && 'over 1 m: units?', c.error].filter(Boolean) : [];
        row.append(Object.assign(document.createElement('span'), { className: problems.length ? 'check bad' : 'check', textContent: !c ? 'checking …' : problems.length ? problems.join(' · ') : `✓ closed, manifold · ${x} × ${y} × ${z} ${doc.units}` }));
      }
      return row;
    });
  const segmented = <T extends string>(choices: [T, string][], now: () => T, set: (v: T) => void) => {
    const el = Object.assign(document.createElement('span'), { className: 'segmented' });
    el.append(...choices.map(([v, label]) => Object.assign(document.createElement('button'), { textContent: label, className: now() === v ? 'on' : '', onclick: () => (set(v), draw()) })));
    return el;
  };
  const draw = () => {
    const kerf = Object.assign(document.createElement('input'), { value: exportChoice.kerf, title: 'Kerf: how wide the beam cuts; the outline moves out by half, holes in, so the part comes out true', oninput: () => (exportChoice.kerf = kerf.value) });
    Object.assign(kerf.dataset, { complete: '', noMeasure: '' });
    const options =
      kind === 'laser'
        ? [cell(Object.assign(document.createElement('span'), { textContent: 'Kerf' }), kerf), segmented([['svg', 'SVG'], ['dxf', 'DXF']], () => exportChoice.laser, (v) => (exportChoice.laser = v))]
        : [segmented([['stl', 'STL'], ['3mf', '3MF']], () => exportChoice.print, (v) => (exportChoice.print = v))];
    box.replaceChildren(Object.assign(document.createElement('div'), { className: 'export-rows' }), ...options, panelButton('Export', 'Export the ticked ones (Enter)', go));
    box.firstElementChild!.append(...rows());
    atTop(box);
  };
  toolHint = kind === 'laser' ? 'Laser: untick what stays out · Face: which face is cut · [Enter] exports · [Esc] cancels' : '3D print: untick what stays out · each is checked: closed, manifold, sound, its size · [Enter] exports · [Esc] cancels';
  document.body.append(box);
  draw();
  render();
  addEventListener('keydown', keys, { capture: true });
  if (kind === 'print') {
    const results = await kernel.check(bodies.map((b) => ({ name: b.id, color: b.color, features: built.get(b.id)!, place: bodyPlace(b.id) })));
    for (const r of results) checks.set(r.name, r);
    if (box.isConnected) draw();
  }
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
  // a photo sphere of this browser goes with the render into the file
  const from = library.find((p) => p.id === shot.background.photo?.id);
  commit({ ...doc, photos: from && !doc.photos.some((p) => p.id === from.id) ? [...doc.photos, from] : doc.photos, renders: [shot, ...doc.renders] });
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
        const image = await viewer.renderNice(shot.camera, shot.background, renderLight(), settings.renderLight, 256, {
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
 * Imports a mesh file's triangles as a mesh body at the origin (it stays a mesh). Most have no unit: `unit` is the
 * guess or what the file says, and a dialog lets it be changed while the body shows at that size.
 */
function importMesh(name: string, parts: MeshPart[], unit: Unit = 'mm') {
  const doc = history.current;
  const title = name.replace(/\.[^.]*$/, '');
  const group: Group | null = parts.length > 1 ? { id: newId(), name: title, parent: null, visible: true, origin: { kind: 'parent' } } : null;
  const bodies = parts.map((p, k) => {
    const mesh: Feature = { id: newId(), type: 'mesh', source: name, vertices: toBase64(p.vertices), triangles: toBase64(p.triangles), scale: ex(fmt(UNITS[unit])) };
    const body = newBody(doc.bodies.length + k, [mesh], group?.id ?? null);
    return { ...body, name: group ? p.name || `Part ${k + 1}` : title, ...(p.color ? { color: p.color } : {}) };
  });
  [selected, shapeSel] = [group ? [group.id] : [bodies[0].id], []];
  commit({ ...doc, groups: group ? [...doc.groups, group] : doc.groups, bodies: [...doc.bodies, ...bodies] });
  notify(`Imported ${name}: ${group ? `${parts.length} parts, ` : ''}${parts.reduce((n, p) => n + p.triangles.length, 0) / 3} triangles`);
  const all = new Float32Array(parts.reduce((n, p) => n + p.vertices.length, 0));
  parts.reduce((at, p) => (all.set(p.vertices, at), at + p.vertices.length), 0);
  meshUnits(bodies.map((b) => b.id), extents(all), unit);
}

/**
 * The size of an imported mesh (its file has no unit), all its parts as one: a small dialog with the units (its numbers are mm, cm …) and
 * its size along X, Y and Z: typing one scales it so, the others follow. The bodies show at each size as it is set (the
 * import's undo step, rewritten). ✓, Enter or Esc closes it.
 */
function meshUnits(bodies: string[], size: Vec3, unit: Unit) {
  const box = Object.assign(document.createElement('div'), { className: 'mesh-units' });
  const buttons = (['mm', 'cm', 'm', 'in'] as Unit[]).map((u) => Object.assign(document.createElement('button'), { textContent: u, onclick: () => scaleTo(UNITS[u]) }));
  const fields = size.map((_, k) => Object.assign(document.createElement('input'), { className: 'number', spellcheck: false, title: `Its size along ${'XYZ'[k]} (the others follow)` }));
  fields.forEach((f) => Object.assign(f.dataset, { complete: '', noMeasure: '' }));
  fields.forEach((f, k) => (f.oninput = () => {
    const mm = length(f.value);
    if (mm && mm > 0 && size[k] > 0) scaleTo(mm / size[k], k);
  }));
  const close = () => (box.remove(), removeEventListener('keydown', keys, { capture: true }));
  const keys = (e: KeyboardEvent) => (pressed(e, 'confirm') || pressed(e, 'cancel')) && (e.stopImmediatePropagation(), e.preventDefault(), close());
  /** Scales the body by `s` (mm per file unit); the sizes show, but not in the field typed into (`typed`). */
  const scaleTo = (s: number, typed?: number) => {
    const doc = history.current;
    const scaled = bodies.reduce((d, id) => {
      const i = d.bodies.findIndex((b) => b.id === id);
      return i < 0 ? d : setIn(d, ['bodies', String(i), 'features', '0', 'scale'], ex(fmt(s)));
    }, doc);
    if (scaled === doc && !doc.bodies.some((b) => bodies.includes(b.id))) return close();
    history.replace(scaled);
    update();
    buttons.forEach((b) => b.classList.toggle('on', Math.abs(UNITS[b.textContent as Unit] - s) < 1e-9));
    fields.forEach((f, k) => k !== typed && (f.value = fmt((size[k] * s) / UNITS[history.current.units])));
  };
  const axis = (k: number) => Object.assign(document.createElement('span'), { className: `axis-${'xyz'[k]}`, textContent: 'XYZ'[k] });
  const text = (t: string) => Object.assign(document.createElement('span'), { textContent: t });
  box.append(text('The file has no unit. Its numbers are'), ...buttons, text('or its size'), ...fields.flatMap((f, k) => [axis(k), f]), panelButton('✓', 'Done (Enter)', close));
  scaleTo(UNITS[unit]);
  document.body.append(box);
  addEventListener('keydown', keys, { capture: true });
}

/**
 * Imports a STEP file at the origin (in mm, as the file says); the kernel reads it. An assembly or several solids: its
 * groups, bodies and materials. One solid, or what `readStep` cannot place: one body.
 */
function importStep(name: string, data: string) {
  const doc = history.current;
  const tree = readStep(data);
  if (tree && (tree.children.length || tree.parts.length > 1)) {
    let count = doc.bodies.length;
    const made = stepObjects(tree, name, doc.materials, (features, group) => newBody(count++, features, group));
    for (const id of made.folded) folded.add(id);
    [selected, shapeSel] = [[made.root], []];
    commit({ ...doc, bodies: [...doc.bodies, ...made.bodies], groups: [...doc.groups, ...made.groups], materials: [...doc.materials, ...made.materials] });
    return notify(`Imported ${name}: ${made.bodies.length} bodies in ${made.groups.length} groups, ${made.materials.length} new materials`);
  }
  const step: Feature = { id: newId(), type: 'step', source: name, data };
  const body = { ...newBody(doc.bodies.length, [step]), name: name.replace(/\.[^.]*$/, '') };
  [selected, shapeSel] = [[body.id], []];
  commit({ ...doc, bodies: [...doc.bodies, body] });
}

const PICTURES = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
/** A field's value measured instead of typed (D, or the button by To object): goes in at the cursor. */
function measureInto(field: HTMLInputElement) {
  measureTool((mm) => {
    field.focus();
    field.setRangeText(fmt(+(mm / UNITS[history.current.units]).toFixed(4)), field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    render();
  });
}

/** The value field last in use, for the Measure button beside To object. */
let lastField: HTMLInputElement | null = null;
addEventListener('focusin', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.closest('.axis-move:not(.measure)')) lastField = e.target;
});
const measureField = () => lastField?.isConnected && measureInto(lastField);

// D in a value field, where T would work (not in the middle of a name, nor where a parameter could begin): measure it
addEventListener(
  'keydown',
  (e) => {
    const field = e.target;
    if (!(field instanceof HTMLInputElement) || field.dataset.noMeasure !== undefined || !('complete' in field.dataset) || !wantsT(e, field, 'measureValue')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    measureInto(field);
  },
  { capture: true },
);

const IMPORTS = ['.step', '.stp', '.stl', '.obj', '.3mf', '.glb', '.svg', '.dxf', ...PICTURES];

/**
 * Imports a file by its extension; false: not one it takes. STEP and meshes become bodies; SVG and DXF a sketch,
 * 1:1, and pictures an image to calibrate: on what lies at client point `at` (a work plane, a flat face, else the
 * ground; none: the ground at the origin), a drawing centred there.
 */
function importFile(f: File, at?: { x: number; y: number }) {
  const ext = f.name.toLowerCase().match(/\.[^.]*$/)?.[0] ?? '';
  if (!IMPORTS.includes(ext)) return false;
  const ground = { placement: { kind: 'base', axis: 'xy', offset: 0 } as const, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] } as Frame, body: null, name: 'the ground', point: null };
  const target = (at && viewer.dropTarget(at.x, at.y)) ?? ground;
  run(() =>
    loading(f.name, async () => {
      try {
        await read();
      } catch (err) {
        throw new Error(`${f.name} could not be imported, it may be damaged: ${(err as Error).message}`);
      }
    }),
  );
  return true;

  async function read() {
    if (ext === '.svg' || ext === '.dxf') return importDrawing(f.name, ext === '.svg' ? svgShapes(await f.text()) : dxfShapes(await f.text()), target);
    if (PICTURES.includes(ext)) return importPicture(f, target.frame, target.point);
    const plain = (mesh: { vertices: Float32Array; triangles: Uint32Array }): MeshPart[] => [{ ...mesh, name: '', color: null }];
    if (ext === '.stl') return importMesh(f.name, plain(parseStl(await f.arrayBuffer())));
    if (ext === '.glb') return importMesh(f.name, await parseGlb(await f.arrayBuffer()), 'm');
    if (ext === '.3mf') {
      const { parts, unit } = parse3mf(await f.arrayBuffer());
      return importMesh(f.name, parts, unit);
    }
    if (ext !== '.obj') return importStep(f.name, await f.text());
    const text = await f.text();
    const kind = objKind(text);
    importMesh(f.name, plain(parseObj(text, kind.zUp)), kind.unit);
  }
}

/** A drawing's shapes as a new sketch on `target`, 1:1, its middle at `target.point` (none: its own origin there). */
function importDrawing(name: string, shapes: Shape2[], target: { placement: Target['placement']; frame: Frame; body: string | null; name: string; point: Vector3 | null }) {
  if (!shapes.length) return fail(`${name}: nothing drawn in it that a sketch takes`);
  const xs = shapes.flatMap((q) => (q.kind === 'circle' ? [q.x - q.d / 2, q.x + q.d / 2] : q.pts.map((p) => p[0])));
  const ys = shapes.flatMap((q) => (q.kind === 'circle' ? [q.y - q.d / 2, q.y + q.d / 2] : q.pts.map((p) => p[1])));
  const [u, v] = target.point ? uvOf(target.frame, target.point) : [0, 0];
  const [dx, dy] = target.point ? [u - (Math.min(...xs) + Math.max(...xs)) / 2, v - (Math.min(...ys) + Math.max(...ys)) / 2] : [0, 0];
  const r = (x: number) => +fmt(x);
  const doc = history.current;
  const sketch = { ...sketchAt({ sketch: null, ...target }, doc.sketches.length), name: name.replace(/\.[^.]*$/, '') };
  sketch.shapes = shapes.map((q): Profile => (q.kind === 'circle' ? { id: newId(), kind: 'circle', x: len(q.x + dx), y: len(q.y + dy), d: len(q.d) } : q.kind === 'polygon' ? { id: newId(), kind: 'polygon', pts: q.pts.map(([x, y]) => [r(x + dx), r(y + dy)]), r: len(0), rot: ex('0') } : { id: newId(), kind: 'line', pts: q.pts.map(([x, y]) => [r(x + dx), r(y + dy)]) }));
  [selected, shapeSel] = [[sketch.id], []];
  commit({ ...doc, sketches: [...doc.sketches, sketch] });
  notify(`${name}: ${shapes.length} shape${shapes.length === 1 ? '' : 's'} as sketch "${sketch.name}" on ${target.name}, 1:1`);
}

/** A picture as an image on `frame`, its middle at `point` (none: the frame's origin), 100 mm wide until calibrated. */
async function importPicture(f: File, frame: Frame, point: Vector3 | null) {
  const data = await new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.readAsDataURL(f);
  });
  const doc = history.current;
  const image: ImageRef = { id: newId(), name: f.name.replace(/\.[^.]*$/, ''), data, frame: { ...frame, o: point ? point.toArray() : frame.o }, width: 100, opacity: 1, key: null, tolerance: 0.1, visible: true };
  [selected, shapeSel] = [[image.id], []];
  commit({ ...doc, images: [...doc.images, image] });
  calibrate(image.id);
}

/**
 * Calibrating an image: click two points on it, then type their real distance: it grows or shrinks about the first.
 * Enter or ✓ keeps it, Esc leaves it as it was.
 */
function calibrate(id: string) {
  const doc0 = history.current;
  const i = doc0.images.findIndex((im) => im.id === id);
  const im = doc0.images[i];
  if (!im) return;
  const [o, n] = [new Vector3(...im.frame.o), new Vector3(...im.frame.n)];
  const onPicture = () => {
    const p = viewer.pointer();
    return p && viewer.pointOnPlane({ clientX: p.x, clientY: p.y } as MouseEvent, o, n);
  };
  const pts: Vector3[] = [];
  const u = doc0.units;
  const [fx, fy] = [new Vector3(...im.frame.x), new Vector3(...im.frame.y)];
  // on the guide lines through the first point when near them
  const snapped = (p: Vector3 | null | undefined) => {
    if (!p || !pts[0]) return p;
    const by = p.clone().sub(pts[0]);
    const reach = viewer.reachAt(p);
    const [dx, dy] = [by.dot(fx), by.dot(fy)];
    return pts[0].clone().addScaledVector(fx, Math.abs(dx) < reach ? 0 : dx).addScaledVector(fy, Math.abs(dy) < reach ? 0 : dy);
  };
  const end = () => {
    viewer.aiming = null;
    viewer.cancelFacePick();
    viewer.showMeasureLine(null);
    viewer.showCrossGuides(null);
    tips.cursorTip(null);
    removeEventListener('keydown', skip, { capture: true });
  };
  // Enter: this step is done, the picture stays as it is
  const skip = (e: KeyboardEvent) => {
    if (!pressed(e, 'confirm')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    end();
    toolHint = null;
    render();
  };
  addEventListener('keydown', skip, { capture: true });
  const pick = () =>
    viewer.pickFace((face) => {
      const p = face && snapped(onPicture());
      if (!face) return end(), (toolHint = null), render();
      if (!p) return pick();
      pts.push(p);
      viewer.showMeasureLine(pts[0], pts[1] ?? null);
      if (pts.length === 1) viewer.showCrossGuides(p, fx, fy);
      if (pts.length < 2) return pick();
      end();
      // the distance as it is now; typing the real one scales the image about the first point
      const now = pts[0].distanceTo(pts[1]);
      valuePanel(
        [{ label: 'Distance', value: fmt(+(now / UNITS[u]).toFixed(3)), title: 'Distance: how far apart the two points really are' }],
        ([t]) => {
          const real = length(t);
          if (!real || real <= 0) return;
          const k = real / now;
          const next = { ...im, width: im.width * k, frame: { ...im.frame, o: pts[0].clone().add(o.clone().sub(pts[0]).multiplyScalar(k)).toArray() as Vec3 } };
          const doc = setIn(history.current, ['images', String(i)], next);
          if (history.current === doc0) history.push(doc);
          else history.replace(doc);
          update();
        },
        (ok) => (ok ? render() : history.current !== doc0 ? undo() : render()),
        'Calibrate: the real distance between the two points · [Enter] keeps it · [Esc] leaves it as it was',
      );
    }, true);
  viewer.aiming = () => {
    viewer.aimAt(null);
    const p = snapped(onPicture());
    viewer.showMeasureLine(pts[0] ?? p, pts[0] ? p : null);
    tips.cursorTip(pts.length ? 'Click the second point' : 'Click a point on the picture whose distance to another you know');
  };
  toolHint = 'Calibrate: click two points on the picture whose distance you know · then type it · [Enter] skips, it stays as it is';
  render();
  pick();
}

const selectedImages = () => history.current.images.filter((im) => selected.includes(im.id));

/** The selected images, each changed from how it was at the start of a tool, one undo step; Esc puts them back. */
function imagePanel(fields: Parameters<typeof valuePanel>[0], change: (im: ImageRef, values: string[]) => ImageRef | null, hint: string, done = () => {}) {
  const doc0 = history.current;
  valuePanel(
    fields,
    (values) => {
      const doc = { ...doc0, images: doc0.images.map((im) => (selected.includes(im.id) ? (change(im, values) ?? im) : im)) };
      if (history.current === doc0) history.push(doc);
      else history.replace(doc);
      update();
    },
    (ok) => (done(), ok ? render() : history.current !== doc0 ? undo() : render()),
    hint,
  );
}

/** Move on images: X / Y / Z distances, live. */
function moveImages() {
  const u = history.current.units;
  const label = (k: number) => 'XYZ'[k];
  imagePanel(
    [0, 1, 2].map((k) => ({ label: label(k), value: '0', title: `How far along ${label(k)}, in ${u}` })),
    (im, values) => {
      const by = values.map((t) => length(t));
      return by.every((v) => v !== null) ? { ...im, frame: { ...im.frame, o: im.frame.o.map((v, k) => v + by[k]!) as Vec3 } } : null;
    },
    'Move the picture: X, Y, Z · [Enter] keeps it · [Esc] puts it back · or drag it in the view',
  );
}

/** Rotate on images: each turns about its middle, in its plane, the angle shown as for a line. */
function turnImages() {
  const [first] = selectedImages();
  const [at, n, x] = [new Vector3(...first.frame.o), new Vector3(...first.frame.n), new Vector3(...first.frame.x)];
  imagePanel(
    [{ label: 'Turn °', value: '0', raw: true, title: 'Degrees, around its middle' }],
    (im, [t]) => {
      const angle = Number(t);
      if (!Number.isFinite(angle)) return null;
      const rad = (angle * Math.PI) / 180;
      const axis = new Vector3(...im.frame.n);
      const turned = (v: Vec3) => new Vector3(...v).applyAxisAngle(axis, rad).toArray() as Vec3;
      return { ...im, frame: { ...im.frame, x: turned(im.frame.x), y: turned(im.frame.y) } };
    },
    `Rotate the picture around its middle: move the pointer, or type · ${angleKeys()} · click or [Enter] keeps it · [Esc] puts it back`,
    () => angles.end(),
  );
  // as Rotate does for bodies: the pointer turns it at once, the same arc and steps
  const input = document.querySelector<HTMLInputElement>('.axis-move:not(.measure) input')!;
  const angles = angleControl({ input, axis: () => ({ at, dir: n, zero: x }) });
  angles.arm();
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

/** A note in the top bar (`error`: something was refused or failed, shown in red; `action`: what a click on it does). */
function notify(message: string, error = false, action: (() => void) | null = null) {
  status = message;
  statusError = error;
  statusAction = action;
  render();
  // an error shows a while, then the tool's note again
  if (error) setTimeout(() => status === message && statusError && ((statusError = false), (status = ''), render()), 5000);
}

/**
 * The top bar's note: an error (red), else the tool's hint (green: its first part big, the rest and the pointer's
 * other keys small below), else the last message.
 */
function showNote() {
  const el = document.querySelector<HTMLElement>('#topbar .status');
  if (!el) return;
  const note = [toolHint, pointerNote].filter(Boolean).join(' · ');
  const [text, kind] = statusError && status ? [status, 'error'] : note ? [note, 'note'] : [status, ''];
  const html = (t: string) => axisHtml(t).replace(/\[(.+?)\]/g, '<kbd>$1</kbd>');
  const [head, ...rest] = kind === 'note' ? text.split(' · ') : [text];
  const action = !kind && statusAction;
  el.className = `status${kind ? ` ${kind}` : action ? ' offer' : ''}`;
  el.onclick = action || null;
  el.title = text.replaceAll(' · ', '\n') + (kind === 'error' ? `\n${COPY_TIP}` : ''); // cut short when long: all of it on hover
  el.innerHTML = rest.length ? `<b>${html(head)}</b><small>${html(rest.join(' · '))}</small>` : html(head);
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
  autosave = !!f.handle && localStorage.getItem('makermaker.autosave') === 'on';
  offered = false;
  selected = [];
  status = '';
  statusAction = null;
  sketching = null;
  isolated = null;
  stopTool();
  viewer.setSketchGrid(null);
  viewer.fitNext();
  update();
}

function loadFile({ name, bytes, handle }: OpenedFile) {
  try {
    const { doc, versions } = unpack(bytes);
    load(doc, { name, handle, versions });
  } catch (err) {
    throw new Error(`${name} could not be opened: ${(err as Error).message}`);
  }
}

/** The top bar's loader while a file is read and what it brought is built. */
async function loading<T>(name: string, task: () => Promise<T> | T) {
  const label = `Opening ${name}`;
  busy.add(label);
  render();
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); // the bar shows before the work blocks
  try {
    const out = await task();
    await kernel.idle();
    return out;
  } finally {
    busy.delete(label);
    render();
  }
}

async function openDesign() {
  const f = await openFile();
  if (f) await loading(f.name, () => loadFile(f));
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
  else if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  else if (pressed(e, 'terminal')) terminal.toggle();
  else if (pressed(e, 'moreSnaps') || pressed(e, 'fewerSnaps')) notify(`${comboText(keysOf('moreSnaps')[0])} / ${comboText(keysOf('fewerSnaps')[0])} split a line into more or fewer snap points: with a drawing tool, the Distance measure or To object on, put the pointer on the line`);
  else if (pressed(e, 'measureValue')) measureTool();
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
  else if (axis >= 0) (e.preventDefault(), moveAlong(axis, true)); // all three fields, the cursor in this one (the key is not typed into it)
  else if (pressed(e, 'move')) (e.preventDefault(), moveAlong(0, true));
  // arrows: 1 mm, Shift 10, Ctrl the minimum step
  else if (shapeSel.length && arrow) nudgeShapes(viewer.screenDir(...arrow), role(e, 'precise') ? settings.minStep : role(e, 'constrain') ? 10 : 1);
  // nudges along the world axis nearest to the arrow's screen direction
  else if (selected.length && arrow) nudge(viewer.screenAxis(...arrow).multiplyScalar(role(e, 'precise') ? settings.minStep : role(e, 'constrain') ? 10 : 1).toArray());
  else if (pressed(e, 'selectAll')) selectAll();
  // nothing selected: the next click picks what it acts on
  else if (pressed(e, 'toggleVisible')) selected.length ? toggleVisible() : pickFor('hide', toggleVisible);
  else if (pressed(e, 'delete')) remove();
  else if (selected.length && pressed(e, 'deselect')) select(null);
  else if (pressed(e, 'duplicate')) shapeSel.length ? duplicateShapes() : selected.length ? duplicate() : pickFor('duplicate', duplicate);
  else if (pressed(e, 'copy')) copy(false);
  else if (pressed(e, 'cut')) copy(true);
  // a file in the clipboard goes to the 'paste' event; it comes right after this key if there is one
  else if (pressed(e, 'paste')) return void (pasteSoon = window.setTimeout(paste, 60));
  else if (pressed(e, 'ungroup')) sketching && shapeSel.length ? groupShapes(true) : ungroup();
  else if (pressed(e, 'group')) sketching && shapeSel.length ? groupShapes() : groupTool();
  else return;
  e.preventDefault();
});

/**
 * The command API at work in the app (see src/api/commands.ts): each command one undo step, and what it made
 * selected. `window.makermaker` in the browser console (scripts and LLM tools will go through it).
 */
const cad = {
  /** Every command: its name, what it does, its parameters. */
  commands: describeCommands,
  /** Runs a command; its result (a new object's id, or what `list` tells). */
  run(name: string, args: Args = {}) {
    const from = history.current;
    const { doc, result } = runCommand(from, name, args);
    if (doc === from) return result;
    if (typeof result === 'string' && [...doc.bodies, ...doc.sketches, ...doc.groups].some((o) => o.id === result)) [selected, shapeSel] = [[result], []];
    commit(doc);
    return result;
  },
  select(ids: string[]) {
    [selected, shapeSel] = [ids, []];
    showSelection();
  },
  selection: () => [...selected],
  undo: () => undo(),
  redo: () => undo(true),
};
(window as unknown as { makermaker: typeof cad }).makermaker = cad;

const terminal = pythonTerminal(
  viewer.el,
  rightDrawers,
  {
    doc: () => history.current,
    selection: cad.selection,
    apply(start, { doc, selection, moves }) {
      if (history.current !== start) return false;
      if (doc) commit(shared(start, doc));
      for (let k = 0; k < Math.abs(moves); k++) undo(moves > 0);
      if (selection) cad.select(selection);
      render();
      return true;
    },
    async measures() {
      await kernel.idle();
      const bodies = history.current.bodies;
      const placeOf = (id: string) => {
        const [offset, turn] = [new Vector3(), new Quaternion()];
        (bodyPlaces.get(id) ?? new Matrix4()).decompose(offset, turn, new Vector3());
        const half = Math.acos(Math.min(1, Math.abs(turn.w)));
        const axis = half > 1e-9 ? new Vector3(turn.x, turn.y, turn.z).normalize().multiplyScalar(Math.sign(turn.w) || 1) : new Vector3(0, 0, 1);
        return { angle: (2 * half * 180) / Math.PI, axis: axis.toArray(), offset: offset.toArray() };
      };
      const real = await kernel.measure(bodies.map((b) => ({ of: 'solid', body: b.id, place: placeOf(b.id) })));
      return Object.fromEntries(
        bodies.flatMap((b, k) => {
          const solid = real[k] as SolidMeasure | null;
          if (solid) return [[b.id, { volume: solid.volume, min: solid.min, max: solid.max }]];
          const m = viewer.measure(b.id); // a mesh: its triangles are all there is
          return m ? [[b.id, { volume: m.volume, min: m.box.min.toArray(), max: m.box.max.toArray() }]] : [];
        }),
      );
    },
    stopCheck: () => kernel.stopClash(),
    async check({ ids, clearance, joints }) {
      await kernel.idle();
      const doc = history.current;
      const { ask } = clashAsk(doc, ids, clearance, joints, []);
      const { hits } = ask.of.length ? await kernel.clash(ask) : { hits: [] };
      const name = (id?: string) => [...doc.bodies, ...doc.joints].find((o) => o.id === id)?.name;
      return hits.map((h) => ({ a: h.a, b: h.b, a_name: name(h.a), b_name: name(h.b), volume: h.volume, closest: h.closest ?? null, joint: h.joint ?? null, joint_name: name(h.joint) ?? null, value: h.value ?? null }));
    },
    async snapshots(shots) {
      busy.add('Snapshots');
      render();
      await kernel.idle();
      await new Promise((done) => requestAnimationFrame(done)); // what the build brought is in the view
      try {
        const files: Record<string, Uint8Array> = {};
        for (const { ids, from, name } of shots) files[`${project()}_${name.replace(/[\\/:*?"<>|]/g, '-')}.png`] = new Uint8Array(await (await viewer.snapshotOf(ids, from)).arrayBuffer());
        // several as one zip: browsers stop a burst of downloads
        const names = Object.keys(files);
        if (names.length === 1) download(new Blob([files[names[0]] as BlobPart], { type: 'image/png' }), names[0]);
        else download(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), `${project()}_snapshots.zip`);
      } finally {
        busy.delete('Snapshots');
        render();
      }
    },
  },
  () => render(),
);

let pasteSoon = 0;
// ⌘V with a file in the clipboard (a picture copied elsewhere): imported where the pointer is
addEventListener('paste', (e) => {
  const f = e.clipboardData?.files[0];
  if (!f || (e.target as HTMLElement).closest?.('input, textarea')) return;
  clearTimeout(pasteSoon);
  e.preventDefault();
  const name = f.name.includes('.') ? f : new File([f], `pasted.${f.type.split('/')[1] ?? 'png'}`, { type: f.type });
  if (!importFile(name, viewer.pointer() ?? undefined)) fail(`${f.name} is not a file that can be imported`);
});

addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  // only readable during the event, so all of it now
  const dropped = [...(e.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file').map((item) => ({ folder: !!item.webkitGetAsEntry?.()?.isDirectory, file: item.getAsFile(), handle: item.getAsFileSystemHandle?.() }));
  const at = { x: e.clientX, y: e.clientY };
  run(async () => {
    const scripts: FileSystemFileHandle[] = [];
    for (const { folder, file: f, handle } of dropped) {
      const name = f?.name ?? 'That';
      if (folder) fail(`"${name}" is a folder, and a folder cannot be opened or imported here. Drop files, or drop a folder of Python scripts on the Scripts list in the terminal.`);
      else if (!f) fail(`${name} could not be read.`);
      else if (/\.py$/i.test(f.name)) {
        const h = await handle;
        if (h instanceof FileSystemFileHandle) scripts.push(h);
        else fail(`${f.name}: Python scripts as files need Chrome or Edge.`);
      } else if (importFile(f, at)) continue;
      else if (f.name.toLowerCase().endsWith(EXTENSION)) {
        await loading(f.name, async () => {
          const h = await handle;
          loadFile(h instanceof FileSystemFileHandle ? await readHandle(h) : { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        });
      } else fail(`${f.name}: this kind of file cannot be opened or imported. These can: ${EXTENSION.slice(1).toUpperCase()}, STEP, STL, OBJ, 3MF, GLB, SVG, DXF, pictures, Python scripts.`);
    }
    if (scripts.length) await terminal.addFiles(scripts);
  });
});

// a click on an error note copies all of it
addEventListener(
  'click',
  (e) => {
    const el = (e.target as Element).closest?.('#topbar .status.error, p.error, span.error, .terminal-error');
    if (!el) return;
    const bar = el.matches('#topbar .status');
    navigator.clipboard.writeText(bar ? status : (el.textContent ?? '').trim()).then(
      () => notify('Copied the message'),
      () => fail('The browser did not allow copying'),
    );
  },
  { capture: true },
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

update();
