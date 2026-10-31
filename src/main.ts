import './style.css';
import { fmt, UNITS } from './doc/expr';
import { History } from './doc/history';
import { paramLookup, resolve, setIn } from './doc/resolve';
import { ex, newId, sampleDoc } from './doc/sample';
import type { Doc, Part } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, type Version } from './io/design';
import type { BuildStep } from './kernel/build';
import { Kernel } from './kernel/client';
import { renderUI, type UIContext } from './ui/panels';
import { sectionControls } from './ui/sections';
import { Viewer, type Vec3 } from './viewer/viewer';

const history = new History<Doc>(sampleDoc());
let selected: string[] = history.current.parts.slice(0, 1).map((p) => p.id);
let exprErrors = new Map<string, string>();
const kernelErrors = new Map<string, { stepId: string; error: string }>();
/** Resolved part positions in mm, from the last update. */
const positions = new Map<string, Vec3>();
let file: { name: string; handle?: FileSystemFileHandle; versions: Version[]; saved: Doc } = {
  name: `untitled${EXTENSION}`,
  versions: [],
  saved: history.current,
};
let status = '';

const viewer = new Viewer(document.getElementById('viewport')!, {
  select,
  move: place,
  projection: render,
});

sectionControls(document.getElementById('viewport')!, (axis, from, to, inverted) => viewer.setSection(axis, from, to, inverted));

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
  doc.parts.forEach((p, i) => {
    const position = resolve(p.position, lookup, `parts.${i}.position`, exprErrors);
    if (position.every(Number.isFinite)) {
      positions.set(p.id, position);
      viewer.setPosition(p.id, position);
    }
    const before = exprErrors.size;
    const steps = resolve(p.steps, lookup, `parts.${i}.steps`, exprErrors);
    if (exprErrors.size === before) builds.push({ id: p.id, steps });
  });
  const ids = new Set(doc.parts.map((p) => p.id));
  for (const id of kernelErrors.keys()) if (!ids.has(id)) kernelErrors.delete(id);
  for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id);
  selected = selected.filter((id) => ids.has(id));
  viewer.select(selected);
  viewer.retain(ids);
  kernel.build(builds);
  render();
}

function commit(next: Doc) {
  history.push(next);
  update();
}

/** `add`: toggles the part in the selection; null clears it (unless adding). */
function select(id: string | null, add = false) {
  if (id === null) selected = add ? selected : [];
  else if (!add) selected = [id];
  else selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  viewer.select(selected);
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

function remove() {
  commit({ ...history.current, parts: history.current.parts.filter((p) => !selected.includes(p.id)) });
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
    kernelErrors,
    title: file.name,
    dirty: doc !== file.saved,
    status,
    orthographic: viewer.isOrthographic,
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
    setOrthographic(on) {
      viewer.setOrthographic(on);
      render();
    },
    fit: () => viewer.fit(),
    newDoc() {
      load(sampleDoc(), { name: `untitled${EXTENSION}`, versions: [] });
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
