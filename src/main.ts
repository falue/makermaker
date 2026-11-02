import { zipSync } from 'fflate';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import './style.css';
import { evalLength, fmt, isPlain, UNITS } from './doc/expr';
import { toBuild } from './doc/expand';
import { BASE, capFrame, frames, placed as inWorld, placeFrame, scale, toWorld, unplaced, type Frame, type Place } from './doc/frames';
import { History } from './doc/history';
import { alignment, area, bounds, corners, type Align } from './doc/profiles';
import { getIn, paramLookup, resolve, setIn, UNITLESS, type Resolved } from './doc/resolve';
import { ex, newId, sampleDoc, unturned } from './doc/sample';
import { faceAt, pushed, sideFrame } from './doc/pull';
import { contents, ownerOf, tree, whose, within } from './doc/groups';
import { chainOf, unitAt } from './doc/shapegroups';
import type { Body, BooleanOp, Doc, Expr, ExtrudeSource, Feature, Group, Profile, RenderShot, Sketch, SketchPlacement, Unit } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, type Version } from './io/design';
import { extents, meshBody, objKind, parseObj, parseStl, toBase64 } from './io/mesh';
import type { BuildFeature } from './kernel/build';
import { Kernel } from './kernel/client';
import { renderUI, type Pick, type RenderJob, type ShapeField, type UIContext } from './ui/panels';
import { sectionControls } from './ui/sections';
import { loadSettings, openSettings } from './ui/settings';
import { pressed, type Action } from './ui/keys';
import { installCompletion } from './ui/complete';
import { installTooltips } from './ui/tooltip';
import { SketchTool, type Cap, type Drawn, type DrawnProfile, type SketchResult, type Target, type ToolHost, type ToolKind, type ViewSketch } from './viewer/sketch';
import { anchorAt, moved as shifted, placed, sizedTo, sizeOf, turnedTo } from './viewer/shapes';
import { Viewer, type FinishPick, type PickedFace, type PickedPart, type Vec3 } from './viewer/viewer';

const tips = installTooltips();
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
/** A face or edge picked with Ctrl-click, with its area (mm²) or length (mm). */
let pickedPart: PickedPart | null = null;
/** Other work going on, shown with the same bar (e.g. "Snapshot"). */
const busy = new Set<string>();
let toolHint: string | null = null;
/** The selected part of a fillet / chamfer (Del leaves that edge out; the whole finish: deletes it). */
let finishSel: FinishPick | null = null;
/** A face pick running for the extrude tool (E, then a face). */
let extrudePick = false;
/** A tool picked before its objects: its toolbar name, and what clicking a body does (Enter applies booleans). */
let pending: { tool: 'boolean' | 'delete' | 'duplicate' | 'group'; pick(id: string): void; apply?(): void } | null = null;
let autosave = localStorage.getItem('makermaker.autosave') === 'on';
let autosaveTimer = 0;
/** The body shown alone, and what was visible before (bodies and sketches by id). */
let isolated: { body: string; before: Map<string, boolean> } | null = null;

const len = (mm: number, typed?: string) => ex(typed ?? fmt(mm / UNITS[history.current.units]), history.current.units);

/** A typed length in mm, or null if invalid. */
function length(text: string) {
  try {
    return evalLength({ e: text, u: history.current.units }, paramLookup(history.current.params));
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
        hint: 'Drag up: bigger, down: smaller (past 0 a fillet turns into a chamfer and back) · [Ctrl] snaps · type a change · release or [Enter]: done · [Esc] puts it back',
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
        hint: 'Drag up: fillet, down: chamfer · [Ctrl] snaps · type a size (minus: chamfer) · release or [Enter]: done · [Esc] puts it back',
        label: (mm, typed) => `${mm >= 0 ? 'Fillet' : 'Chamfer'} ${typed === undefined ? Math.abs(mm).toFixed(2) : `${typed}▏`}`,
        endOnUp: true,
      },
    );
  },
  enterShape(sketch, shape) {
    const s = history.current.sketches.find((x) => x.id === sketch);
    const q = s?.shapes.find((x) => x.id === shape);
    if (!s || !q) return;
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
  // group origins in the world (a custom origin is moved and turned in its parent's) and whether groups are shown
  groupPlaces.clear();
  const groupAt = (id: string | null, seen: string[] = []): Matrix4 => {
    const i = doc.groups.findIndex((g) => g.id === id);
    const g = doc.groups[i];
    if (!g || seen.includes(g.id)) return new Matrix4();
    const done = groupPlaces.get(g.id);
    if (done) return done;
    const m = groupAt(g.parent, [...seen, g.id]).clone();
    if (g.origin.kind === 'custom') {
      const at = `groups.${i}.origin`;
      const fine = (v: number) => (Number.isFinite(v) ? v : 0);
      const [x, y, z] = resolve(g.origin.position, lookup, `${at}.position`, exprErrors).map(fine);
      const r = resolve(g.origin.rotation, lookup, `${at}.rotation`, exprErrors);
      const deg = (v: number) => (fine(v) * Math.PI) / 180;
      // degrees around the parent's X, then Y, then Z
      m.multiply(new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(deg(r.rx), deg(r.ry), deg(r.rz), 'ZYX')), new Vector3(1, 1, 1)));
    }
    groupPlaces.set(g.id, m);
    return m;
  };
  doc.groups.forEach((g) => groupAt(g.id));
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
    const local = resolve(p.position, lookup, `bodies.${i}.position`, exprErrors);
    const turned = resolve(p.rotation, lookup, `bodies.${i}.rotation`, exprErrors);
    if (local.every(Number.isFinite) && [turned.rx, turned.ry, turned.rz].every(Number.isFinite)) {
      const m = groupAt(p.group).clone().multiply(new Matrix4().compose(new Vector3(...local), turnOf(turned), new Vector3(1, 1, 1)));
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
      const faceOf = (p: Exclude<Resolved<SketchPlacement>, { kind: 'base' }>) => {
        const f = worldFrame(p);
        return f && placeFrame(at, f, true);
      };
      const built = new Map<string, BuildFeature>();
      for (const s of resolved) {
        if (s.type === 'boolean' || s.type === 'mesh') continue; // meshes are shown as they are
        const b = toBuild(s, id, sketches, faceOf);
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
    if (!r || !p || !s.visible || !shownIn(s.group)) return [];
    // a base-plane sketch moves with the body that extrudes it (its extrusion lies in that body's coordinates), else with its group
    const owner = p.kind === 'base' ? ownerOf(doc, s.id) : null;
    const frame = p.kind === 'base' ? placeFrame(owner && bodyPlaces.has(owner) ? bodyPlace(owner) : toPlace(groupAt(s.group)), worldFrame(p)!) : worldFrame(p);
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
      b.visible && shownIn(b.group) ? (resolvedOf.get(b.id) ?? []).flatMap((f) => (f.type === 'sphere' ? [{ center: new Vector3(...inWorld(bodyPlace(b.id), [f.x, f.y, f.z])), r: f.d / 2 }] : [])) : [],
    ),
  );
  viewer.setLooks(doc.bodies.map((b) => ({ ...b, visible: b.visible && shownIn(b.group), owner: owner.get(b.id), cutter: doc.bodies.some((o) => o.features.some((f) => f.type === 'boolean' && f.body === b.id)) })));
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

/** Owner per tool body: the (first) body whose boolean uses it. */
function ownersOf(doc: Doc) {
  const out = new Map<string, string>();
  for (const b of doc.bodies) for (const f of b.features) if (f.type === 'boolean' && !out.has(f.body)) out.set(f.body, b.id);
  return out;
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
      if (o !== id || seen.has(tool) || !still(by(tool))) continue;
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

/**
 * `how`: true toggles the object (body or sketch), 'range' selects a range of its list; null clears the selection
 * (unless adding). Selecting something else leaves sketch mode.
 */
function select(id: string | null, how: Pick = false) {
  rendersOpen = false; // choosing something shows it, not the renders
  if (finishSel) viewer.setFinishMark((finishSel = null));
  if (pending && id && history.current.bodies.some((b) => b.id === id)) return pending.pick(id);
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
  const doc = history.current;
  const k = doc.sketches.findIndex((s) => s.id === sketch);
  if (k < 0) return;
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
  commit(setIn(doc, ['sketches', String(k), 'shapes'], shapes));
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
  if (!sel) return;
  const copies = sel.shapes.map((q): Profile => {
    const src = sel.source.shapes.find((x) => x.id === q.id)!;
    const m = shifted(q, offset, -offset);
    const copy = { ...structuredClone(src), id: newId() };
    if ((copy.kind === 'polygon' || copy.kind === 'line') && (m.kind === 'polygon' || m.kind === 'line')) return { ...copy, pts: m.pts.map(([x, y]) => [+fmt(x), +fmt(y)]) };
    return m.kind === 'polygon' || m.kind === 'line' || copy.kind === 'polygon' || copy.kind === 'line' ? copy : { ...copy, x: len(m.x), y: len(m.y) };
  });
  const doc = history.current;
  shapeSel = copies.map((c) => c.id);
  commit({ ...doc, sketches: doc.sketches.map((s) => (s.id === sel.id ? { ...s, shapes: [...s.shapes, ...copies] } : s)) });
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
  const doc = history.current;
  let next = doc;
  for (const { id, position } of moves) {
    const i = doc.bodies.findIndex((p) => p.id === id);
    const before = positions.get(id);
    if (i < 0 || !before) continue;
    // in the group's (turned) coordinates: axes whose local value changed are written
    const toLocal = groupPlace(doc.bodies[i].group).clone().invert();
    const [now, was] = [position, before].map((p) => new Vector3(...p).applyMatrix4(toLocal).toArray());
    now.forEach((v, k) => {
      if (Math.abs(v - was[k]) > 1e-9) next = setIn(next, ['bodies', String(i), 'position', String(k)], ex(fmt(v / UNITS[doc.units]), doc.units));
    });
  }
  commit(next);
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
function infoOf(): { title: string; rows: [string, string, number?][]; box?: Box3 } | null {
  const doc = history.current;
  const u = doc.units;
  // areas and volumes one unit up (mm → cm², cm³), else the numbers get long
  const up: Record<Unit, [string, number]> = { mm: ['cm', 10], cm: ['dm', 100], m: ['m', 1000], in: ['ft', 304.8], ft: ['ft', 304.8] };
  const num = (mm: number, power = 1) => {
    const [name, size] = power === 1 ? [u, UNITS[u]] : up[u];
    return `${fmt(+(mm / size ** power).toFixed(3))} ${name}${power === 2 ? '²' : power === 3 ? '³' : ''}`;
  };
  if (pickedPart?.kind === 'face') return { title: 'Face', rows: [['Area', num(pickedPart.size, 2)]] };
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
  const rows: [string, string, number?][] = [['L', num(size.x), 0], ['W', num(size.y), 1], ['H', num(size.z), 2]];
  const b = ids.length === 1 && doc.bodies.find((x) => x.id === ids[0]);
  if (b) {
    const at = positions.get(b.id);
    const turn = resolve(b.rotation, lookup, '', new Map());
    if (at) rows.push(['Position', at.map((v) => num(v)).join(', ')]);
    rows.push(['Rotation', `${fmt(turn.rx)}°, ${fmt(turn.ry)}°, ${fmt(turn.rz)}°`]);
  }
  rows.push(['Volume', num(m.reduce((n, x) => n + x.volume, 0), 3)], ['Surface', num(m.reduce((n, x) => n + x.area, 0), 2)]);
  return { title: b ? b.name : `${ids.length} bodies`, rows, box };
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
 * Esc or leaving cancels all.
 */
function moveAlong(first: number) {
  if (!selected.length) return fail('Select something to move first');
  const fields: (HTMLInputElement | null)[] = [null, null, null];
  const box = Object.assign(document.createElement('div'), { className: 'axis-move' });
  const at = viewer.pointer() ?? { x: innerWidth / 2, y: innerHeight / 2 };
  box.style.cssText = `left:${at.x + 14}px;top:${at.y + 14}px`;
  document.body.append(box);
  /** The move so far (null: a value is not a distance); empty axes stay. */
  const by = () => {
    const mm = fields.map((f) => (f?.value.trim() ? length(f.value) : 0));
    return mm.includes(null) ? null : new Vector3(...(mm as number[]));
  };
  const show = () => {
    for (const f of fields) f?.classList.toggle('invalid', !!f.value.trim() && length(f.value) === null);
    const b = by();
    viewer.previewMove(b ?? new Vector3(), b ? (shapeMoves(b)?.updates ?? []) : []);
  };
  let closed = false; // removing the box fires focusout: close once
  let last: HTMLInputElement | null = null; // the field typed in last
  let target = false; // waiting for a click: "To object"
  const close = () => {
    if (closed) return;
    closed = true;
    box.remove();
    removeEventListener('pointerup', refocus, true);
    tips.cursorTip(null);
    viewer.cancelFacePick();
    viewer.previewMove(null);
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
  /** "To object": the selection moves along the field's axis until its nearest side reaches the clicked point. */
  const reach = (p?: Vector3) => {
    target = false;
    box.classList.remove('targeting');
    tips.cursorTip(null);
    const k = Math.max(0, fields.indexOf(last));
    const span = extentAlong(k);
    if (!p || !span || !fields[k]) return;
    const t = p.getComponent(k);
    const side = t >= span[1] ? span[1] : t <= span[0] ? span[0] : Math.abs(t - span[0]) < Math.abs(t - span[1]) ? span[0] : span[1];
    fields[k]!.value = fmt((t - side) / UNITS[history.current.units]);
    show();
  };
  const open = (k: number) => {
    if (!fields[k]) {
      const name = 'XYZ'[k];
      const input = Object.assign(document.createElement('input'), { spellcheck: false, placeholder: `0 ${history.current.units}` });
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
  };
  const keys = (e: KeyboardEvent, input: HTMLInputElement) => {
    const k = (['moveX', 'moveY', 'moveZ'] as const).findIndex((a) => pressed(e, a));
    const before = input.value.slice(0, input.selectionStart ?? 0);
    const word = before.match(/[A-Za-z_]\w*$/)?.[0];
    // a name could start here and one starts with the letter: typed, Tab completes it
    const name = !/[\w.]$/.test(before) && Object.keys(history.current.params).some((p) => p.startsWith(e.key));
    if (k >= 0 && (!word || word in UNITS) && !name) return e.preventDefault(), open(k);
    // Tab (a completion took it already): the next axis' field (Shift: the previous), added if needed; leaving would cancel
    if (e.key === 'Tab') return e.preventDefault(), open((fields.indexOf(input) + (e.shiftKey ? 2 : 1)) % 3);
    if (pressed(e, 'cancel')) return close();
    if (!pressed(e, 'confirm')) return;
    const b = by();
    if (!b) return show();
    close();
    moveBy(b);
  };
  // focus moving between the fields (or into the view) stays; to another field or button elsewhere it cancels
  box.addEventListener('focusout', (e) => (!e.relatedTarget || box.contains(e.relatedTarget as Node) ? undefined : close()));
  const toObject = Object.assign(document.createElement('button'), {
    textContent: 'To object',
    title: 'Click a corner, edge or face: the selection moves along this axis until its nearest side reaches it',
    onclick: () => {
      target = true;
      box.classList.add('targeting');
      tips.cursorTip('Click a corner, edge or face to move to');
      last?.focus();
    },
  });
  box.append(toObject);
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

/** The selected sketch's shapes (the selected ones, else all) moved by `by` (world, mm) within its plane; null: no sketch selected, or across its plane. */
function shapeMoves(by: Vector3) {
  const doc = history.current;
  const s = doc.sketches.find((x) => x.id === activeSketch());
  const f = viewer.sketches.find((v) => v.id === s?.id)?.frame;
  if (!s || !f) return null;
  const [du, dv] = [f.x, f.y].map((v) => by.dot(new Vector3(...v)));
  if (Math.abs(du) < 1e-9 && Math.abs(dv) < 1e-9) return null;
  const shapes = resolve(s, paramLookup(doc.params), '', new Map()).shapes.filter((q) => !shapeSel.length || shapeSel.includes(q.id));
  return { sketch: s.id, updates: shapes.map((q) => ({ id: q.id, profile: shifted(q, du, dv) })) };
}

/** Moves the selection by `by` (world, mm): bodies, or shapes within their sketch plane (the selected ones, else all of the selected sketch). */
function moveBy(by: Vector3) {
  if (!activeSketch()) return nudge(by.toArray());
  const moves = shapeMoves(by);
  if (!moves) return fail('That axis runs across the sketch plane (or the sketch is hidden)');
  setShapes(moves.sketch, moves.updates);
}

/** Deletes the selected shapes of the selected sketch, else the selected bodies and sketches. */
/** Tool first: the next clicked body gets `act`. */
function pickFor(tool: 'delete' | 'duplicate', act: () => void) {
  pending = {
    tool,
    pick(id) {
      cancelPending();
      selected = [id];
      act();
    },
  };
  toolHint = `Click a body to ${tool} it · [Esc] cancels`;
  render();
}

function cancelPending() {
  pending = null;
  toolHint = null;
}

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
  return { ...doc, bodies, sketches, groups };
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
    // in the list of the target's kind: the moved ones right before or after it
    const place = <T extends { id: string }>(list: T[]) => {
      const moving = list.filter((o) => ids.includes(o.id));
      const rest = list.filter((o) => !ids.includes(o.id));
      const i = rest.findIndex((o) => o.id === target);
      return i < 0 || !moving.length ? list : [...rest.slice(0, i + (where === 'after' ? 1 : 0)), ...moving, ...rest.slice(i + (where === 'after' ? 1 : 0))];
    };
    doc = { ...doc, bodies: place(doc.bodies), groups: place(doc.groups) };
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
  const group: Group = { id: newId(), name: `Group ${doc.groups.length + 1}`, parent, visible: true, origin: { kind: 'parent' } };
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
  }
  if (r.depth) {
    // always a new body: joining it to the body it was drawn on is a boolean, done explicitly later
    const source: ExtrudeSource = { kind: 'sketch', sketch: id, shapes: ids, areas: r.areas };
    const feature: Feature = { id: newId(), type: 'extrude', source, depth: len(r.depth, r.depthTyped), mode: 'add', through: false };
    // on a base plane the body shares the sketch's group (so both count from the same origin)
    const sketch = sketches.find((s) => s.id === id)!;
    const body = newBody(bodies.length, [feature], sketch.plane.kind === 'base' ? sketch.group : null);
    bodies = [...bodies, body];
    selected = [body.id];
    shapeSel = [];
  } else [selected, shapeSel] = [[id], ids];
  commit({ ...doc, sketches, bodies });
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
    if (was === 'direct' && !result.depth) return enterSketch(id, kind);
    if (sketching) exitSketch(); // an extrusion finishes the sketch
    if (was === 'direct' && kind) startTool(kind);
    else pickFaceToPull();
  },
  hint(text) {
    toolHint = text;
    render();
  },
  cursorTip: (text) => tips.cursorTip(text),
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
    const depth = resolve(feature.depth, lookup, '', new Map()) as number;
    apply = (mm) => setIn(before, [...featurePath, 'depth'], plus(feature.depth, depth, mm * hit.rate));
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
  toolHint = 'Click a face of an extrusion to push or pull it, or a sketch in the list to pull all its shapes · [Esc] stops';
  extrudePick = true;
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    extrudePick = false;
    if (face) pullFace(face);
    else render();
  });
}

/** Picks areas of the sketch in sketch mode to pull; `all`: all of them picked already. */
async function extrudeAreas(all = false) {
  const s = viewer.sketches.find((v) => v.id === sketching);
  if (!s) return;
  stopTool();
  const areas = await kernel.areas(s.shapes.filter((q) => !q.construction && q.kind !== 'line'));
  if (!areas.length) return fail('Nothing to extrude yet: draw a shape first');
  viewer.startAreas(toolHost, { sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name: 'the sketch' }, areas, all);
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

/** Copies the selected bodies 10 mm to the right and back and selects the copies. */
function duplicate(offset = 10) {
  const doc = history.current;
  const copies = doc.bodies
    .filter((p) => selected.includes(p.id))
    .map((p): Body => {
      const [x, y] = resolve(p.position, paramLookup(doc.params), '', new Map());
      const at = (v: number) => ex(fmt((v + offset) / UNITS[doc.units]), doc.units);
      return {
        ...structuredClone(p),
        id: newId(),
        name: `${p.name} copy`,
        position: [at(x), at(y), p.position[2]],
        features: p.features.map((s) => ({ ...structuredClone(s), id: newId() })),
      };
    });
  selected = copies.map((c) => c.id);
  commit({ ...doc, bodies: [...doc.bodies, ...copies] });
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
    doc,
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
          ? 'Drag a picked edge up: fillet, down: chamfer · [Ctrl]-click another edge, double-click: its loop · [Esc] deselect'
          : null),
    autosave,
    notify: fail,
    statusError,
    info,
    showMeasure: (axis) => viewer.showMeasure(axis === null ? null : (info?.box ?? null), axis ?? 0),
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
    toggleFold(id) {
      if (!folded.delete(id)) folded.add(id);
      render();
    },
    moveInto: (ids, group) => commit(movedInto(history.current, ids, group)),
    groupTool,
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
      select(id);
      if (!pulling) enterSketch(id, null, true);
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
      load({ schema: 11, units: history.current.units, params: {}, bodies: [], sketches: [], groups: [], sections: [], renders: [] }, { name: `untitled${EXTENSION}`, versions: [] });
    },
    open: () => run(openDesign),
    save: () => run(save),
    undo: () => undo(),
    redo: () => undo(true),
  };
  renderUI(ctx);
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
 * The unit of an imported mesh (its file has none): a small dialog, the body showing at each unit's size as it is
 * picked (the import's undo step, rewritten). ✓, Enter or Esc closes it.
 */
function meshUnits(body: string, size: [number, number, number], unit: Unit) {
  const box = Object.assign(document.createElement('div'), { className: 'mesh-units' });
  const sizeText = Object.assign(document.createElement('span'), { className: 'size' });
  const buttons = (['mm', 'cm', 'm', 'in'] as Unit[]).map((u) => Object.assign(document.createElement('button'), { textContent: u, onclick: () => pick(u) }));
  const close = () => (box.remove(), removeEventListener('keydown', keys, { capture: true }));
  const keys = (e: KeyboardEvent) => (pressed(e, 'confirm') || pressed(e, 'cancel')) && (e.stopImmediatePropagation(), e.preventDefault(), close());
  const pick = (u: Unit) => {
    const doc = history.current;
    const i = doc.bodies.findIndex((b) => b.id === body);
    if (i < 0) return close();
    history.replace(setIn(doc, ['bodies', String(i), 'features', '0', 'scale'], ex(fmt(UNITS[u]))));
    update();
    show(u);
  };
  const show = (u: Unit) => {
    buttons.forEach((b) => b.classList.toggle('on', b.textContent === u));
    const d = history.current.units;
    sizeText.textContent = `${size.map((v) => fmt((v * UNITS[u]) / UNITS[d])).join(' × ')} ${d}`;
  };
  box.append(Object.assign(document.createElement('span'), { textContent: 'The file has no unit. Its numbers are' }), ...buttons, sizeText, Object.assign(document.createElement('button'), { className: 'done', textContent: '✓', title: 'Done (Enter)', onclick: close }));
  show(unit);
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
  else if (tool) startTool(tool);
  else if (pressed(e, 'construction')) toggleConstruction();
  else if (pressed(e, 'extrude')) extrude();
  else if (pressed(e, 'sketch')) startNewSketch();
  else if (sketching && pressed(e, 'deselect')) sketchPath.length ? ((sketchPath = sketchPath.slice(0, -1)), (shapeSel = []), showSelection()) : exitSketch(); // up one sub-group, else out
  else if (pressed(e, 'cycle')) viewer.cycle(1);
  else if (pressed(e, 'cycleBack')) viewer.cycle(-1);
  else if (axis >= 0) (e.preventDefault(), moveAlong(axis)); // the key is not typed into the field
  else if (shapeSel.length && arrow) nudgeShapes(viewer.screenDir(...arrow), e.shiftKey ? 10 : 1);
  // nudges along the world axis nearest to the arrow's screen direction
  else if (selected.length && arrow) nudge(viewer.screenAxis(...arrow).multiplyScalar(e.shiftKey ? 10 : 1).toArray());
  else if (pressed(e, 'selectAll')) selectAll();
  else if (selected.length && pressed(e, 'toggleVisible')) toggleVisible();
  else if (selected.length && pressed(e, 'delete')) remove();
  else if (selected.length && pressed(e, 'deselect')) select(null);
  else if (shapeSel.length && pressed(e, 'duplicate')) duplicateShapes();
  else if (selected.length && pressed(e, 'duplicate')) duplicate();
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
