import './style.css';
import { fmt, UNITS } from './doc/expr';
import { History } from './doc/history';
import { paramLookup, resolve } from './doc/resolve';
import { sampleDoc } from './doc/sample';
import type { Doc } from './doc/types';
import { openFile, readHandle, saveFile, type OpenedFile } from './io/access';
import { addVersion, EXTENSION, pack, unpack, type Version } from './io/design';
import type { BuildStep } from './kernel/build';
import { Kernel } from './kernel/client';
import { renderUI, type UIContext } from './ui/panels';
import { Viewer } from './viewer/viewer';

const viewer = new Viewer(document.getElementById('viewport')!);
const history = new History<Doc>(sampleDoc());
let selected: string | null = history.current.parts[0]?.id ?? null;
let exprErrors = new Map<string, string>();
const kernelErrors = new Map<string, { stepId: string; error: string }>();
let file: { name: string; handle?: FileSystemFileHandle; versions: Version[]; saved: Doc } = {
  name: `untitled${EXTENSION}`,
  versions: [],
  saved: history.current,
};
let status = '';

const kernel = new Kernel((r) => {
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
    if (position.every(Number.isFinite)) viewer.setPosition(p.id, position);
    const before = exprErrors.size;
    const steps = resolve(p.steps, lookup, `parts.${i}.steps`, exprErrors);
    if (exprErrors.size === before) builds.push({ id: p.id, steps });
  });
  const ids = new Set(doc.parts.map((p) => p.id));
  for (const id of kernelErrors.keys()) if (!ids.has(id)) kernelErrors.delete(id);
  viewer.retain(ids);
  kernel.build(builds);
  render();
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
    notify,
    paramValue(name) {
      try {
        const q = lookup(name);
        return q.dim === 0 ? fmt(q.v) : q.dim === 1 ? `${fmt(q.v / UNITS[doc.units])} ${doc.units}` : '';
      } catch {
        return '';
      }
    },
    commit(next) {
      history.push(next);
      update();
    },
    select(id) {
      selected = id;
      viewer.select(id);
      render();
    },
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
  selected = doc.parts[0]?.id ?? null;
  viewer.select(selected);
  status = '';
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
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();
  const inField = e.target instanceof HTMLInputElement;
  if (key === 's') run(save);
  else if (key === 'o') run(openDesign);
  else if (key === 'z' && !inField) undo(e.shiftKey);
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

viewer.onPick = (id) => {
  selected = id;
  viewer.select(id);
  render();
};

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

viewer.select(selected);
update();
