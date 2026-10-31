import { Vector3 } from 'three';
import './style.css';
import { evalLength, fmt, UNITS } from './doc/expr';
import { toBuild } from './doc/expand';
import { BASE, capFrame, frames, moved, scale } from './doc/frames';
import { History } from './doc/history';
import { alignment, bounds, type Align } from './doc/profiles';
import { paramLookup, resolve, setIn, UNITLESS } from './doc/resolve';
import { ex, newId, sampleDoc } from './doc/sample';
import type { Doc, ExtrudeSource, Body, Profile, Sketch, SketchPlacement, Feature } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, type Version } from './io/design';
import type { BuildFeature } from './kernel/build';
import { Kernel } from './kernel/client';
import { renderUI, type UIContext } from './ui/panels';
import { sectionControls } from './ui/sections';
import { installTooltips } from './ui/tooltip';
import type { Cap, Drawn, DrawnProfile, SketchResult, Target, ToolHost, ToolKind, ViewSketch } from './viewer/sketch';
import { moved as shifted } from './viewer/shapes';
import { Viewer, type Vec3 } from './viewer/viewer';

installTooltips();
const history = new History<Doc>(sampleDoc());
/** Selected objects (bodies and sketches) and, inside a single selected sketch, its selected shapes. */
let selected: string[] = history.current.bodies.slice(0, 1).map((p) => p.id);
let shapeSel: string[] = [];
/** The sketch in sketch mode: shapes drawn into it stay flat. */
let sketching: string | null = null;
/** What the running tool does: one shape then pull, sketch mode, pulling shapes, or picking a plane for a new sketch. */
let toolMode: 'direct' | 'draw' | 'pull' | 'plane' | null = null;
let exprErrors = new Map<string, string>();
const kernelErrors = new Map<string, { featureId: string; error: string }>();
/** Bodies that cannot be built because of a linked sketch, from the last update. */
let linkErrors = new Map<string, { featureId: string; error: string }>();
/** Resolved body positions in mm, from the last update. */
const positions = new Map<string, Vec3>();
let file: { name: string; handle?: FileSystemFileHandle; versions: Version[]; saved: Doc } = {
  name: `untitled${EXTENSION}`,
  versions: [],
  saved: history.current,
};
let status = '';
let toolHint: string | null = null;
let autosave = localStorage.getItem('makermaker.autosave') === 'on';
let autosaveTimer = 0;

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
  format: (mm) => `${fmt(mm / UNITS[history.current.units])} ${history.current.units}`,
});

const sectionPicking = sectionControls(
  document.getElementById('viewport')!,
  (axis, from, to, inverted) => viewer.setSection(axis, from, to, inverted),
  newSection,
);

const kernel = new Kernel((r) => {
  if (!history.current.bodies.some((p) => p.id === r.id)) return; // deleted while it was built
  if ('mesh' in r) {
    kernelErrors.delete(r.id);
    viewer.setBody(r.id, r.mesh);
  } else kernelErrors.set(r.id, r); // the viewer keeps the last valid geometry
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
  // bodies whose sketches lie on other bodies' faces wait until those bodies are built
  let pending = doc.bodies.flatMap((p, i) => {
    const position = resolve(p.position, lookup, `bodies.${i}.position`, exprErrors);
    if (position.every(Number.isFinite)) {
      positions.set(p.id, position);
      viewer.setPosition(p.id, position);
    }
    const before = exprErrors.size;
    const resolved = resolve(p.features, lookup, `bodies.${i}.features`, exprErrors);
    return exprErrors.size === before ? [{ id: p.id, resolved, at: positions.get(p.id) ?? ([0, 0, 0] as Vec3) }] : [];
  });
  for (let progress = true; pending.length && progress; ) {
    progress = false;
    pending = pending.filter(({ id, resolved, at }) => {
      const faceOf = (body: string, feature: string) => {
        const c = caps.find((q) => q.body === body && q.feature === feature);
        return c && moved(c.frame, scale(at, -1));
      };
      const features: BuildFeature[] = [];
      for (const s of resolved) {
        const built = toBuild(s, id, sketches, faceOf);
        if (built === null) return true; // wait for the other body
        if (typeof built === 'string') return (progress = true), linkErrors.set(id, { featureId: s.id, error: `Cannot build: ${built}` }), false;
        features.push(built);
      }
      progress = true;
      builds.push({ id, features });
      const plan = frames(features);
      for (const s of features) {
        const f = plan.get(s.id);
        if (s.type === 'extrude' && f && !s.through) caps.push({ body: id, feature: s.id, frame: moved(capFrame(f, s.depth), at) });
      }
      return false;
    });
  }
  for (const { id, resolved } of pending) linkErrors.set(id, { featureId: resolved[0]?.id ?? '', error: "Cannot build: its sketch's face is gone, or bodies depend on each other in a circle" });
  viewer.caps = caps;
  // sketches in the world: base planes as they are, face sketches with their body
  const palette = [0x3b6fd8, 0x9b4dca, 0x0f9d8a, 0x5a8f29, 0xc2417a, 0x8a6d3b];
  const shown: ViewSketch[] = doc.sketches.flatMap((s, i) => {
    const r = sketches.get(s.id);
    const p = r?.plane;
    if (!r || !p || !s.visible) return [];
    const frame = p.kind === 'base' ? { ...BASE[p.axis], o: scale(BASE[p.axis].n, p.offset) } : caps.find((c) => c.body === p.body && c.feature === p.feature)?.frame;
    return frame ? [{ id: s.id, color: palette[i % palette.length], frame, placement: p, shapes: r.shapes }] : [];
  });
  viewer.setCustomSections(
    doc.sections.flatMap((c, i) => {
      const offset = resolve(c.offset, lookup, `sections.${i}.offset`, exprErrors);
      return c.enabled && Number.isFinite(offset) ? [{ point: c.origin.map((v, k) => v + c.normal[k] * offset) as Vec3, normal: c.normal }] : [];
    }),
  );
  const ids = new Set(doc.bodies.map((p) => p.id));
  for (const id of kernelErrors.keys()) if (!ids.has(id)) kernelErrors.delete(id);
  for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id);
  selected = selected.filter((id) => ids.has(id) || doc.sketches.some((s) => s.id === id));
  const shapes = doc.sketches.find((s) => s.id === activeSketch())?.shapes ?? [];
  shapeSel = shapeSel.filter((id) => shapes.some((q) => q.id === id));
  viewer.setLooks(doc.bodies);
  viewer.select(selected);
  viewer.setSketches(shown, activeSketch(), shapeSel);
  const drawn = shown.find((s) => s.id === sketching);
  if (sketching && !drawn) exitSketch();
  else viewer.setSketchGrid(drawn?.frame ?? null);
  viewer.retain(ids);
  kernel.build(builds);
  scheduleAutosave();
  render();
}

function commit(next: Doc) {
  history.push(next);
  update();
}

/** The selected sketch, if it is the only selection. */
function activeSketch() {
  return selected.length === 1 && history.current.sketches.some((s) => s.id === selected[0]) ? selected[0] : null;
}

/** `add`: toggles the object (body or sketch) in the selection; null clears it (unless adding). Selecting something else leaves sketch mode. */
function select(id: string | null, add = false) {
  if (sketching && id !== sketching) exitSketch();
  if (id === null) selected = add ? selected : [];
  else if (!add) selected = [id];
  else selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  shapeSel = [];
  showSelection();
}

/** A clicked sketch shape: selects its sketch and the shape (`add`: toggles it). */
function pickShape(sketch: string, shape: string, add: boolean) {
  if (sketching && sketch !== sketching) exitSketch();
  if (activeSketch() !== sketch) [selected, shapeSel] = [[sketch], []];
  shapeSel = !add ? [shape] : shapeSel.includes(shape) ? shapeSel.filter((s) => s !== shape) : [...shapeSel, shape];
  showSelection();
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
    if (copy.kind === 'polygon' && m.kind === 'polygon') return { ...copy, pts: m.pts.map(([x, y]) => [+fmt(x), +fmt(y)]) };
    return m.kind === 'polygon' || copy.kind === 'polygon' ? copy : { ...copy, x: len(m.x), y: len(m.y) };
  });
  const doc = history.current;
  shapeSel = copies.map((c) => c.id);
  commit({ ...doc, sketches: doc.sketches.map((s) => (s.id === sel.id ? { ...s, shapes: [...s.shapes, ...copies] } : s)) });
}

function showSelection() {
  viewer.select(selected);
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
    position.forEach((v, k) => {
      if (Math.abs(v - before[k]) > 1e-9)
        next = setIn(next, ['bodies', String(i), 'position', String(k)], ex(fmt(v / UNITS[doc.units]), doc.units));
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

/** Deletes the selected shapes of the selected sketch, else the selected bodies and sketches. */
function remove() {
  const doc = history.current;
  const sketch = activeSketch();
  if (sketch && shapeSel.length) {
    const gone = shapeSel;
    shapeSel = [];
    return commit({ ...doc, sketches: doc.sketches.map((s) => (s.id === sketch ? { ...s, shapes: s.shapes.filter((q) => !gone.includes(q.id)) } : s)) });
  }
  commit({ ...doc, bodies: doc.bodies.filter((p) => !selected.includes(p.id)), sketches: doc.sketches.filter((s) => !selected.includes(s.id)) });
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
    const plane: SketchPlacement = t.placement.kind === 'base' ? { ...t.placement, offset: len(t.placement.offset) } : t.placement;
    const fresh: Sketch = { id: newId(), name: `Sketch ${sketches.length + 1}`, plane, shapes: [], visible: true };
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
    const body = newBody(bodies.length, [feature]);
    bodies = [...bodies, body];
    selected = [body.id];
    shapeSel = [];
  } else [selected, shapeSel] = [[id], ids];
  commit({ ...doc, sketches, bodies });
  return id;
}

function profileOf({ profile: p, typed: t }: Drawn): Profile {
  const id = newId();
  if (p.kind === 'rect') return { id, kind: 'rect', x: len(p.x), y: len(p.y), w: len(p.w, t.w), h: len(p.h, t.h), r: len(p.r), rot: ex(fmt(p.rot)) };
  if (p.kind === 'circle') return { id, kind: 'circle', x: len(p.x), y: len(p.y), d: len(p.d, t.d) };
  if (p.kind === 'ngon') return { id, kind: 'ngon', x: len(p.x), y: len(p.y), d: len(p.d, t.d), sides: ex(fmt(p.sides)), rot: ex(fmt(p.rot)) };
  return { id, kind: 'polygon', pts: p.pts.map(([x, y]) => [+fmt(x), +fmt(y)]), r: len(p.r), rot: ex(fmt(p.rot)) };
}

function stopTool() {
  viewer.stopTool();
  toolMode = null;
  toolHint = null;
}

const toolHost: ToolHost = {
  length,
  /**
   * In sketch mode a shape stays flat and the tool goes on. A direct shape left flat enters sketch mode on its
   * sketch; a picked plane gets a new sketch. Esc in sketch mode only stops the tool.
   */
  done(result) {
    const [was, kind] = [toolMode, viewer.activeTool];
    if (!result) return stopTool(), render();
    if (result.sphere) {
      stopTool();
      return addSphere(result.sphere);
    }
    if (was === 'plane') {
      stopTool();
      return newSketch(result.target);
    }
    const id = sketched(result);
    if (was === 'draw') return;
    stopTool();
    if (was === 'direct' && !result.depth) enterSketch(id, kind);
    else if (sketching) exitSketch(); // an extrusion finishes the sketch
    else render();
  },
  hint(text) {
    toolHint = text;
    render();
  },
};

/** The `count`-th body at the origin, with a colour from a small palette. */
function newBody(count: number, features: Feature[], palette = ['#d8c3a0', '#a9c4d8', '#b8cfa1', '#d9a98f', '#c7b3dc', '#e3d48f']): Body {
  return { id: newId(), name: `Body ${count + 1}`, color: palette[count % palette.length], visible: true, position: [len(0), len(0), len(0)], features };
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

async function extrudeAreas() {
  const s = viewer.sketches.find((v) => v.id === sketching);
  if (!s) return;
  stopTool();
  const areas = await kernel.areas(s.shapes);
  if (!areas.length) return notify('Nothing to extrude yet: draw a shape first');
  viewer.startAreas(toolHost, { sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name: 'the sketch' }, areas);
  toolMode = 'pull';
  render();
}

/** Sketch mode on a sketch: R / C / P draw flat into it (`kind` starts one); `look` turns the camera to its plane. */
function enterSketch(id: string, kind: ToolKind | null = null, look = false) {
  const s = viewer.sketches.find((v) => v.id === id);
  if (!s) return notify('Show the sketch to draw on it');
  sketching = id;
  [selected, shapeSel] = [[id], shapeSel];
  if (look) viewer.lookAlong(new Vector3(...s.frame.n));
  viewer.setSketchGrid(s.frame);
  showSelection();
  if (kind) startTool(kind);
}

function exitSketch() {
  sketching = null;
  stopTool();
  viewer.setSketchGrid(null);
  render();
}

/** New sketch: pick a top face or empty space (the base plane facing the camera). */
function startNewSketch() {
  if (sketching) exitSketch();
  viewer.startTool(null, toolHost, { kind: 'plane' });
  toolMode = 'plane';
  render();
}

/** An empty sketch where the plane was picked, in sketch mode, the camera looking at it. */
function newSketch(t: Target) {
  const doc = history.current;
  const plane: SketchPlacement = t.placement.kind === 'base' ? { ...t.placement, offset: len(t.placement.offset) } : t.placement;
  const sketch: Sketch = { id: newId(), name: `Sketch ${doc.sketches.length + 1}`, plane, shapes: [], visible: true };
  commit({ ...doc, sketches: [...doc.sketches, sketch] });
  enterSketch(sketch.id, 'rect', true);
}

/** E: in sketch mode picks areas of the sketch to pull; else pulls the selected shapes of the selected sketch, or all of them. */
function extrude() {
  if (sketching) return void extrudeAreas();
  const id = activeSketch();
  const s = viewer.sketches.find((v) => v.id === id);
  if (!s) return notify(id ? 'Show the sketch to extrude it' : 'Select a sketch or some of its shapes to extrude');
  const target: Target = { sketch: s.id, placement: s.placement, frame: s.frame, body: s.placement.kind === 'cap' ? s.placement.body : null, name: 'its sketch' };
  viewer.startPull(toolHost, target, shapeSel.length ? shapeSel : s.shapes.map((q) => q.id));
  toolMode = 'pull';
  render();
}

/** Picks a face; a section lies on it, removing the side towards the camera. */
function newSection() {
  toolHint = 'Click a face (or empty space: the base plane facing you): the new section lies on it and removes what is in front · [Esc] cancels';
  sectionPicking(true);
  render();
  viewer.pickFace((face) => {
    toolHint = null;
    sectionPicking(false);
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
    return notify('Autosave needs a Chromium browser');
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
      const [x, y] = positions.get(p.id) ?? [0, 0];
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

function render() {
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
    shapes: shapeSel,
    tool: viewer.activeTool,
    hint: toolHint,
    autosave,
    notify,
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
      const next = setIn(history.current, path, value);
      if (live) history.replace(next);
      else history.push(next);
      update();
    },
    select,
    startTool,
    extrude,
    sketching,
    newSketch: startNewSketch,
    editSketch: (id) => enterSketch(id, null, true),
    exitSketch,
    stopTool: () => (stopTool(), render()),
    align: alignShapes,
    pickShape,
    lookAt(sketch) {
      const s = viewer.sketches.find((v) => v.id === sketch);
      if (s) viewer.lookAlong(new Vector3(...s.frame.n));
    },
    toggleAutosave: () => run(toggleAutosave),
    duplicate: () => (shapeSel.length ? duplicateShapes() : duplicate()),
    remove,
    newDoc() {
      load({ schema: 4, units: history.current.units, params: {}, bodies: [], sketches: [], sections: [] }, { name: `untitled${EXTENSION}`, versions: [] });
    },
    open: () => run(openDesign),
    save: () => run(save),
    undo: () => undo(),
    redo: () => undo(true),
  };
  renderUI(ctx);
}

function notify(message: string) {
  status = message;
  render();
}

async function run(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (err) {
    notify((err as Error).message);
  }
}

function load(doc: Doc, f: Omit<typeof file, 'saved'>) {
  history.reset(doc);
  file = { ...f, saved: doc };
  selected = [];
  status = '';
  sketching = null;
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

const TOOL_KEYS: Record<string, ToolKind> = { r: 'rect', c: 'circle', n: 'ngon', p: 'polygon', o: 'sphere' };

addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  const plain = !mod && !e.altKey;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (mod && key === 's') run(save);
  else if (mod && key === 'o') run(openDesign);
  else if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  else if (mod && key === 'z') undo(e.shiftKey);
  else if (mod && key === 'y') undo(true);
  else if (plain && key === 'f') viewer.fit();
  else if (plain && TOOL_KEYS[key]) startTool(TOOL_KEYS[key]);
  else if (plain && key === 'e') extrude();
  else if (plain && key === 's') startNewSketch();
  else if (sketching && e.key === 'Escape') exitSketch();
  else if (e.key === 'Tab') viewer.cycle(e.shiftKey ? -1 : 1);
  else if (shapeSel.length && arrows[e.key]) {
    const [x, y] = arrows[e.key];
    nudgeShapes(viewer.screenDir(x, y), e.shiftKey ? 10 : 1);
  } else if (selected.length && arrows[e.key]) {
    // nudges along the world axis nearest to the arrow's screen direction
    const [x, y] = arrows[e.key];
    nudge(viewer.screenAxis(x, y).multiplyScalar(e.shiftKey ? 10 : 1).toArray());
  } else if (selected.length && (e.key === 'Delete' || e.key === 'Backspace')) remove();
  else if (selected.length && e.key === 'Escape') select(null);
  else if (shapeSel.length && mod && key === 'd') duplicateShapes();
  else if (selected.length && mod && key === 'd') duplicate();
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
  run(async () => {
    const handle = await pending;
    if (handle instanceof FileSystemFileHandle) loadFile(await readHandle(handle));
    else if (f) loadFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  });
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

update();
