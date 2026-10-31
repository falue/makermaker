import { Vector3 } from 'three';
import './style.css';
import { evalLength, fmt, UNITS } from './doc/expr';
import { toBuild } from './doc/expand';
import { BASE, capFrame, frames, moved, scale } from './doc/frames';
import { History } from './doc/history';
import { paramLookup, resolve, setIn } from './doc/resolve';
import { ex, newId, sampleDoc } from './doc/sample';
import type { Doc, Part, Profile, Sketch, SketchPlacement, Step } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, type Version } from './io/design';
import type { BuildStep } from './kernel/build';
import { Kernel } from './kernel/client';
import { renderUI, type UIContext } from './ui/panels';
import { sectionControls } from './ui/sections';
import type { Cap, Drawn, SketchResult, Target, ToolHost, ToolKind, ViewSketch } from './viewer/sketch';
import { Viewer, type Vec3 } from './viewer/viewer';

const history = new History<Doc>(sampleDoc());
/** Selected objects (parts and sketches) and, inside a single selected sketch, its selected shapes. */
let selected: string[] = history.current.parts.slice(0, 1).map((p) => p.id);
let shapeSel: string[] = [];
let exprErrors = new Map<string, string>();
const kernelErrors = new Map<string, { stepId: string; error: string }>();
/** Parts that cannot be built because of a linked sketch, from the last update. */
let linkErrors = new Map<string, { stepId: string; error: string }>();
/** Resolved part positions in mm, from the last update. */
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
  length,
  format: (mm) => `${fmt(mm / UNITS[history.current.units])} ${history.current.units}`,
});

sectionControls(
  document.getElementById('viewport')!,
  (axis, from, to, inverted) => viewer.setSection(axis, from, to, inverted),
  newSection,
);

const kernel = new Kernel((r) => {
  if (!history.current.parts.some((p) => p.id === r.id)) return; // deleted while it was built
  if ('mesh' in r) {
    kernelErrors.delete(r.id);
    viewer.setPart(r.id, r.mesh);
  } else kernelErrors.set(r.id, r); // the viewer keeps the last valid geometry
  render();
});

/** Resolves expressions, moves parts, and rebuilds parts whose steps changed and resolved cleanly. */
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
  const builds: { id: string; steps: BuildStep[] }[] = [];
  const caps: Cap[] = [];
  // sketches with an invalid value are left out, so their extrusions wait like parts with one
  const sketches = new Map(
    doc.sketches.flatMap((s, i) => {
      const before = exprErrors.size;
      const resolved = resolve(s, lookup, `sketches.${i}`, exprErrors);
      return exprErrors.size === before ? [[s.id, resolved] as const] : [];
    }),
  );
  linkErrors = new Map();
  doc.parts.forEach((p, i) => {
    const position = resolve(p.position, lookup, `parts.${i}.position`, exprErrors);
    if (position.every(Number.isFinite)) {
      positions.set(p.id, position);
      viewer.setPosition(p.id, position);
    }
    const before = exprErrors.size;
    const resolved = resolve(p.steps, lookup, `parts.${i}.steps`, exprErrors);
    if (exprErrors.size !== before) return;
    const steps: BuildStep[] = [];
    for (const s of resolved) {
      const built = toBuild(s, p.id, sketches);
      if (typeof built === 'string') return linkErrors.set(p.id, { stepId: s.id, error: `Cannot build: ${built}` });
      steps.push(built);
    }
    builds.push({ id: p.id, steps });
    const plan = frames(steps);
    for (const s of steps) {
      const f = plan.get(s.id);
      if (s.type === 'extrude' && f && !s.through) caps.push({ part: p.id, step: s.id, frame: moved(capFrame(f, s.depth), positions.get(p.id) ?? [0, 0, 0]) });
    }
  });
  viewer.caps = caps;
  // sketches in the world: base planes as they are, face sketches with their part
  const shown: ViewSketch[] = doc.sketches.flatMap((s) => {
    const r = sketches.get(s.id);
    const p = r?.plane;
    if (!r || !p || !s.visible) return [];
    const frame = p.kind === 'base' ? { ...BASE[p.axis], o: scale(BASE[p.axis].n, p.offset) } : caps.find((c) => c.part === p.part && c.step === p.step)?.frame;
    return frame ? [{ id: s.id, frame, placement: p, shapes: r.shapes }] : [];
  });
  viewer.setCustomSections(
    doc.sections.flatMap((c, i) => {
      const offset = resolve(c.offset, lookup, `sections.${i}.offset`, exprErrors);
      return c.enabled && Number.isFinite(offset) ? [{ point: c.origin.map((v, k) => v + c.normal[k] * offset) as Vec3, normal: c.normal }] : [];
    }),
  );
  const ids = new Set(doc.parts.map((p) => p.id));
  for (const id of kernelErrors.keys()) if (!ids.has(id)) kernelErrors.delete(id);
  for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id);
  selected = selected.filter((id) => ids.has(id) || doc.sketches.some((s) => s.id === id));
  const shapes = doc.sketches.find((s) => s.id === activeSketch())?.shapes ?? [];
  shapeSel = shapeSel.filter((id) => shapes.some((q) => q.id === id));
  viewer.select(selected);
  viewer.setSketches(shown, activeSketch(), shapeSel);
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

/** `add`: toggles the object (part or sketch) in the selection; null clears it (unless adding). */
function select(id: string | null, add = false) {
  if (id === null) selected = add ? selected : [];
  else if (!add) selected = [id];
  else selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  shapeSel = [];
  showSelection();
}

/** A clicked sketch shape: selects its sketch and the shape (`add`: toggles it). */
function pickShape(sketch: string, shape: string, add: boolean) {
  if (activeSketch() !== sketch) [selected, shapeSel] = [[sketch], []];
  shapeSel = !add ? [shape] : shapeSel.includes(shape) ? shapeSel.filter((s) => s !== shape) : [...shapeSel, shape];
  showSelection();
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
    const i = doc.parts.findIndex((p) => p.id === id);
    const before = positions.get(id);
    if (i < 0 || !before) continue;
    position.forEach((v, k) => {
      if (Math.abs(v - before[k]) > 1e-9)
        next = setIn(next, ['parts', String(i), 'position', String(k)], ex(fmt(v / UNITS[doc.units]), doc.units));
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

/** Deletes the selected shapes of the selected sketch, else the selected parts and sketches. */
function remove() {
  const doc = history.current;
  const sketch = activeSketch();
  if (sketch && shapeSel.length) {
    const gone = shapeSel;
    shapeSel = [];
    return commit({ ...doc, sketches: doc.sketches.map((s) => (s.id === sketch ? { ...s, shapes: s.shapes.filter((q) => !gone.includes(q.id)) } : s)) });
  }
  commit({ ...doc, parts: doc.parts.filter((p) => !selected.includes(p.id)), sketches: doc.sketches.filter((s) => !selected.includes(s.id)) });
}

/** Before the finishing steps, so the list reads in build order. */
const beforeFinish = (steps: Step[], step: Step) => {
  const at = steps.findIndex((s) => s.type === 'finish');
  return at < 0 ? [...steps, step] : steps.toSpliced(at, 0, step);
};

/**
 * A tool result: a drawn shape joins its sketch (a new sketch if needed); pulled shapes become an extrusion linked to
 * them, on the part whose face the sketch lies on, else as a new part. One undo step.
 */
function sketched(r: SketchResult) {
  const doc = history.current;
  const t = r.target;
  let sketches = doc.sketches;
  let parts = doc.parts;
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
    const step: Step = { id: newId(), type: 'extrude', source: { kind: 'sketch', sketch: id, shapes: ids }, depth: len(r.depth, r.depthTyped), mode: r.mode, through: false };
    if (t.part) {
      parts = parts.map((p) => (p.id === t.part ? { ...p, steps: beforeFinish(p.steps, step) } : p));
      selected = [t.part];
    } else {
      const part: Part = { id: newId(), name: `Part ${parts.length + 1}`, position: [len(0), len(0), len(0)], steps: [step] };
      parts = [...parts, part];
      selected = [part.id];
    }
    shapeSel = [];
  } else [selected, shapeSel] = [[id], ids];
  commit({ ...doc, sketches, parts });
}

function profileOf({ profile: p, typed: t }: Drawn): Profile {
  const id = newId();
  if (p.kind === 'rect') return { id, kind: 'rect', x: len(p.x), y: len(p.y), w: len(p.w, t.w), h: len(p.h, t.h), r: len(p.r), rot: ex(fmt(p.rot)) };
  if (p.kind === 'circle') return { id, kind: 'circle', x: len(p.x), y: len(p.y), d: len(p.d, t.d) };
  return { id, kind: 'polygon', pts: p.pts.map(([x, y]) => [+fmt(x), +fmt(y)]), r: len(p.r), rot: ex(fmt(p.rot)) };
}

const toolHost: ToolHost = {
  length,
  done(result) {
    // a flat shape keeps the drawing tool going; anything else ends it
    if (!result || result.depth || !viewer.activeTool) {
      viewer.stopTool();
      toolHint = null;
    }
    if (result) sketched(result);
    else render();
  },
  hint(text) {
    toolHint = text;
    render();
  },
};

function startTool(kind: ToolKind) {
  viewer.startTool(kind, toolHost);
  render();
}

/** E: pulls the selected shapes of the selected sketch, or all of its shapes. */
function extrude() {
  const id = activeSketch();
  const s = viewer.sketches.find((v) => v.id === id);
  if (!s) return notify(id ? 'Show the sketch to extrude it' : 'Select a sketch or some of its shapes to extrude');
  const target: Target = { sketch: s.id, placement: s.placement, frame: s.frame, part: s.placement.kind === 'cap' ? s.placement.part : null, name: 'its sketch' };
  viewer.startPull(toolHost, target, shapeSel.length ? shapeSel : s.shapes.map((q) => q.id));
  render();
}

/** Picks a face; a section lies on it, removing the side towards the camera. */
function newSection() {
  toolHint = 'Click a face: the new section lies on it and removes what is in front · [Esc] cancels';
  render();
  viewer.pickFace((face) => {
    toolHint = null;
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

/** Copies the selected parts 10 mm to the right and back and selects the copies. */
function duplicate(offset = 10) {
  const doc = history.current;
  const copies = doc.parts
    .filter((p) => selected.includes(p.id))
    .map((p): Part => {
      const [x, y] = positions.get(p.id) ?? [0, 0];
      const at = (v: number) => ex(fmt((v + offset) / UNITS[doc.units]), doc.units);
      return {
        ...structuredClone(p),
        id: newId(),
        name: `${p.name} copy`,
        position: [at(x), at(y), p.position[2]],
        steps: p.steps.map((s) => ({ ...structuredClone(s), id: newId() })),
      };
    });
  selected = copies.map((c) => c.id);
  commit({ ...doc, parts: [...doc.parts, ...copies] });
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
    pickShape,
    lookAt(sketch) {
      const s = viewer.sketches.find((v) => v.id === sketch);
      if (s) viewer.lookAlong(new Vector3(...s.frame.n));
    },
    toggleAutosave: () => run(toggleAutosave),
    duplicate: () => duplicate(),
    remove,
    newDoc() {
      load({ schema: 3, units: history.current.units, params: {}, parts: [], sketches: [], sections: [] }, { name: `untitled${EXTENSION}`, versions: [] });
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
  toolHint = null;
  viewer.stopTool();
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

const TOOL_KEYS: Record<string, ToolKind> = { r: 'rect', c: 'circle', p: 'polygon' };

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
  else if (e.key === 'Tab') viewer.cycle(e.shiftKey ? -1 : 1);
  else if (selected.length && arrows[e.key]) {
    // nudges along the world axis nearest to the arrow's screen direction
    const [x, y] = arrows[e.key];
    nudge(viewer.screenAxis(x, y).multiplyScalar(e.shiftKey ? 10 : 1).toArray());
  } else if (selected.length && (e.key === 'Delete' || e.key === 'Backspace')) remove();
  else if (selected.length && e.key === 'Escape') select(null);
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
