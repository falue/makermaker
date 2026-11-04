import type { Doc } from '../doc/types';
import { icon } from './icons';
import type { PythonField } from './pythonField';
import type { FromPython, ToPython } from './pythonWorker';
import { canUseFolders, cleanName, listScripts, recallFolder, rememberFolder, removeScript, writeScript, type Script } from '../io/scriptFolder';

/** What the terminal reaches in the app (see `terminalApi` in main). */
export interface TerminalApi {
  doc(): Doc;
  selection(): string[];
  /** A run's outcome, taken unless the design changed since `start` (then false). */
  apply(start: Doc, outcome: { doc?: Doc; selection?: string[]; moves: number }): boolean;
}

/** Written into an empty folder when it is first chosen. */
const STARTERS: Script[] = [
  { name: 'Row of boxes', text: "# five boxes, each taller\nfor k in range(5):\n    cad.box(20, 20, 10 + k * 10, at=[k * 30, 0, 0], name=f'Box {k + 1}')\n" },
  { name: 'Ring of cylinders', text: "import math\n\ncount = 8\nfor k in range(count):\n    a = 2 * math.pi * k / count\n    cad.cylinder(diameter=12, height=30, at=[60 * math.cos(a), 60 * math.sin(a), 0], name=f'Post {k + 1}')\n" },
];
/** Where scripts were kept in the browser before: moved into the first folder chosen. */
const OLD_STORE = 'makermaker.scripts';

/**
 * The Python terminal, a drawer in `parent`: its tab in `tabs`, open across the view, lifting the other drawers
 * (`--drawers-up`). Pyodide loads in a worker when first opened. Two columns: the terminal (`cad` is the command API; Enter runs,
 * typing on when unfinished), beside it the script being edited, both in Monaco (colours, Tab completes); and the scripts. A script runs as one undo step.
 */
export function pythonTerminal(parent: HTMLElement, tabs: HTMLElement, api: TerminalApi, changed: () => void) {
  const box = Object.assign(document.createElement('div'), { className: 'terminal', hidden: true });
  const grip = Object.assign(document.createElement('div'), { className: 'terminal-grip', title: 'Drag: the height of the terminal' });
  const output = Object.assign(document.createElement('pre'), { className: 'terminal-out' });
  const prompt = Object.assign(document.createElement('span'), { className: 'terminal-prompt', textContent: '>>>' });
  const line = Object.assign(document.createElement('div'), { className: 'terminal-line' });
  const stopButton = Object.assign(document.createElement('button'), { className: 'icon', innerHTML: icon('stop'), title: 'Click: Stop Python (Ctrl C): nothing changes, its variables are gone', hidden: true, onclick: () => stop() });
  line.append(prompt, stopButton);
  const scroll = Object.assign(document.createElement('div'), { className: 'terminal-scroll', onclick: () => getSelection()?.isCollapsed && input?.focus() });
  scroll.append(output, line);
  const button = (name: string, title: string, onclick: (e: MouseEvent) => void) => Object.assign(document.createElement('button'), { className: 'icon', innerHTML: icon(name), title, onclick });
  // the script being edited
  const editorName = Object.assign(document.createElement('span'), { className: 'script-title' });
  const editorBar = Object.assign(document.createElement('div'), { className: 'script-bar' });
  const editor = Object.assign(document.createElement('div'), { className: 'script-editor', hidden: true });
  editor.append(editorBar);
  // the panes: what is kept in this browser, and the borders between them, dragged as the view's
  const panes = (() => {
    try {
      return JSON.parse(localStorage.getItem('makermaker.terminalPanes') ?? '{}') as { closed?: boolean; editor?: number; scripts?: number };
    } catch {
      return {};
    }
  })();
  const keep = () => {
    try {
      localStorage.setItem('makermaker.terminalPanes', JSON.stringify(panes));
    } catch {
      // only a convenience
    }
  };
  const paneBorder = (title: string, from: () => number, to: (px: number) => void, sign: 1 | -1) => {
    const border = Object.assign(document.createElement('div'), { className: 'view-border column terminal-border', title });
    border.onpointerdown = (down) => {
      border.setPointerCapture(down.pointerId);
      border.classList.add('dragged');
      const start = from();
      border.onpointermove = (m) => (to(start + sign * (m.clientX - down.clientX)), layout());
      border.onpointerup = () => {
        border.onpointermove = border.onpointerup = null;
        border.classList.remove('dragged');
        keep();
      };
    };
    return border;
  };
  const editorBorder = paneBorder('Drag: the width of the script', () => editor.offsetWidth, (px) => (panes.editor = Math.max(160, Math.min(main.clientWidth - 160, px))), 1);
  const main = Object.assign(document.createElement('div'), { className: 'terminal-main' });
  main.append(editor, editorBorder, scroll);
  // the scripts
  const list = Object.assign(document.createElement('div'), { className: 'script-list' });
  const side = Object.assign(document.createElement('div'), { className: 'scripts' });
  const head = Object.assign(document.createElement('div'), { className: 'scripts-head' });
  head.append(Object.assign(document.createElement('span'), { textContent: 'Scripts' }));
  side.append(head, list);
  const cols = Object.assign(document.createElement('div'), { className: 'terminal-cols' });
  const scriptsBorder = paneBorder('Drag: the width of the scripts', () => side.offsetWidth, (px) => (panes.scripts = Math.max(120, Math.min(cols.clientWidth - 200, px))), -1);
  cols.append(main, scriptsBorder, side);
  /** The panes as they are now: no prompt and no script open leaves the scripts all the room. */
  const layout = () => {
    const open = !editor.hidden;
    scroll.hidden = !!panes.closed;
    editorBorder.hidden = !!panes.closed || !open;
    main.hidden = scriptsBorder.hidden = !!panes.closed && !open;
    editor.style.flex = panes.editor && !panes.closed ? `0 0 ${panes.editor}px` : '1';
    side.style.flex = main.hidden ? '1' : `0 0 ${panes.scripts ?? 220}px`;
    promptButton.classList.toggle('on', !panes.closed);
    promptButton.title = panes.closed ? 'Click: Open the Python prompt' : 'Click: Close the Python prompt: scripts stay';
  };
  const showPrompt = (show: boolean) => {
    panes.closed = !show;
    keep();
    layout();
    if (show) input?.focus();
  };
  box.append(grip, cols);
  parent.append(box);
  const drawerEl = Object.assign(document.createElement('div'), { className: 'drawer' });
  drawerEl.append(Object.assign(document.createElement('button'), { className: 'drawer-tab', innerHTML: `${icon('chevron')}<span>Python terminal</span>`, title: 'Show or hide the Python terminal (I)', onclick: () => toggle() }));
  tabs.prepend(drawerEl);

  const print = (text: string, kind = '') => {
    if (kind === 'terminal-error' && panes.closed) showPrompt(true); // never unseen
    const part = Object.assign(document.createElement('span'), { className: kind, textContent: text.endsWith('\n') ? text : `${text}\n` });
    output.append(part);
    if (output.childElementCount > 500) output.firstElementChild!.remove();
    scroll.scrollTop = scroll.scrollHeight;
  };
  /** The prompt and the script being edited, once Monaco is there. */
  let input: PythonField | null = null;
  let editorText: PythonField | null = null;
  const fit = () => {
    prompt.textContent = input!.value.includes('\n') ? '...' : '>>>';
    scroll.scrollTop = scroll.scrollHeight;
  };

  let worker: Worker | null = null;
  let ready = false;
  /** The design the worker holds, so an unchanged one is not sent again. */
  let sent: Doc | null = null;
  let running: ((m: Extract<FromPython, { kind: 'done' }>) => void) | null = null;
  let onFound: ((names: string[]) => void) | null = null;
  /** What Python knows for a dotted word; nothing before it is ready or while it runs. */
  const known = (word: string) =>
    new Promise<string[]>((done) => {
      onFound?.([]);
      if (!ready || running) return done([]);
      onFound = (names) => ((onFound = null), done(names));
      tell({ kind: 'complete', word });
    });
  let stopSoon = 0;
  const load = () => {
    if (worker) return worker;
    print('Loading Python…', 'terminal-note');
    worker = new Worker(new URL('./pythonWorker.ts', import.meta.url), { type: 'module' });
    worker.onerror = (e) => print(`Python: ${e.message}`, 'terminal-error');
    worker.onmessage = ({ data }: MessageEvent<FromPython>) => {
      if (data.kind === 'out') print(data.text, data.error ? 'terminal-error' : '');
      else if (data.kind === 'found') onFound?.(data.names);
      else if (data.kind === 'done') running?.(data);
      else {
        ready = true;
        print(`Python ${data.version} · cad is ready: cad.box(80, 60, 40) · cad.commands() lists all · help(cad.box) tells about one`, 'terminal-note');
        changed();
      }
    };
    tell({ kind: 'init', indexURL: new URL('pyodide/', document.baseURI).href });
    return worker;
  };
  const tell = (message: ToPython) => worker!.postMessage(message);
  const idle = () => {
    running = null;
    clearTimeout(stopSoon);
    stopButton.hidden = true;
  };
  /** Ends what runs: the worker goes, and Python's variables with it. */
  const stop = () => {
    if (!running) return;
    worker!.terminate();
    [worker, ready, sent] = [null, false, null];
    onFound?.([]);
    idle();
    print('Stopped: nothing was changed, Python starts over.', 'terminal-note');
    load();
  };

  const past: string[] = [];
  let back = 0;
  /** Runs `text` through Python's `fn` as one undo step; its state. */
  const batched = (fn: '_step' | '_run', text: string) =>
    new Promise<string>((done) => {
      load();
      const start = api.doc();
      tell({ kind: 'run', fn, text, selection: api.selection(), ...(start === sent ? {} : { doc: start }) });
      sent = start;
      stopSoon = window.setTimeout(() => {
        stopButton.hidden = false;
        if (panes.closed) showPrompt(true); // its Stop
      }, 300);
      running = (m) => {
        idle();
        if (m.failedAfterChange) print('Nothing was changed: it failed before its end.', 'terminal-note');
        else if (m.state !== 'error' && (m.doc || m.selection || m.moves) && !api.apply(start, m)) print('The design changed while this ran: nothing was changed. Run it again.', 'terminal-note');
        done(m.state);
      };
    });
  const run = async () => {
    if (running) return;
    const source = input!.value;
    // a blank last line ends a block
    const text = /\n\s*$/.test(source) ? `${source.trimEnd()}\n` : source;
    if (!text.trim()) return;
    print(source.split('\n').map((l, k) => `${k ? '...' : '>>>'} ${l}`).join('\n'), 'terminal-echo');
    const state = await batched('_step', text);
    if (state === 'more') {
      output.lastChild?.remove(); // not run yet
      const indent = source.match(/(?:^|\n)( *)[^\n]*$/)?.[1] ?? '';
      input!.value = `${source}\n${indent}${source.trimEnd().endsWith(':') ? '    ' : ''}`;
      input!.toEnd();
      return fit();
    }
    past.push(source);
    back = past.length;
    if (input!.value === source) input!.value = '';
    fit();
    changed();
  };
  /** Both fields, made when the drawer first opens (Monaco loads then). */
  const fields = async () => {
    const { pythonCompletion, pythonField } = await import('./pythonField');
    pythonCompletion(known);
    const prompted = (input = pythonField('python-prompt', true));
    line.insertBefore(prompted.el, stopButton);
    prompted.onHeight((px) =>
      requestAnimationFrame(() => {
        prompted.el.style.height = `${px}px`;
        scroll.scrollTop = scroll.scrollHeight;
      }),
    );
    prompted.onChange(fit);
    prompted.onKey((e) => {
      const { first, last, noSelection, suggesting, before } = prompted.state();
      if (e.key === 'c' && e.ctrlKey && running && noSelection) stop();
      else if (e.key === 'Enter' && !e.shiftKey) void run();
      else if (e.key === 'Tab' && !suggesting && /[\w.]$/.test(before)) prompted.suggest();
      else if (e.key === 'Escape' && !suggesting) toggle(false);
      else if (e.key === 'ArrowUp' && !suggesting && first && back > 0) ((prompted.value = past[--back]), prompted.toEnd(), fit());
      else if (e.key === 'ArrowDown' && !suggesting && last && back < past.length) ((prompted.value = past[++back] ?? ''), prompted.toEnd(), fit());
      else if (e.key === 'l' && e.ctrlKey) output.replaceChildren();
      else return false;
      return true;
    });
    const script = (editorText = pythonField('script-text'));
    editor.append(script.el);
    script.onChange(() => {
      if (!current) return;
      current.text = script.value;
      unsaved = current;
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void flush(), 400);
    });
    script.onKey((e) => {
      if (e.key === 'c' && e.ctrlKey && running && script.state().noSelection) stop();
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) current && void play(current);
      else if (e.key === 'Escape' && !script.state().suggesting) toggle(false);
      else return false;
      return true;
    });
  };
  /** The other drawers ride on top of the terminal. */
  const lift = () => parent.style.setProperty('--drawers-up', box.hidden ? '0px' : `${box.offsetHeight}px`);
  grip.onpointerdown = (down) => {
    grip.setPointerCapture(down.pointerId);
    const start = box.offsetHeight;
    grip.onpointermove = (m) => {
      box.style.height = `${Math.max(120, Math.min(parent.clientHeight - 60, start + down.clientY - m.clientY))}px`;
      lift();
    };
    grip.onpointerup = () => (grip.onpointermove = grip.onpointerup = null);
  };

  const toggle = (open = box.hidden) => {
    box.hidden = !open;
    drawerEl.classList.toggle('open', open);
    lift();
    if (open) load(), void start();
    else void flush();
    changed();
  };

  // the scripts: files in a folder, written a moment after typing stops
  let dir: FileSystemDirectoryHandle | null = null;
  /** The folder remembered, its permission still to be given (that takes a click). */
  let waiting: FileSystemDirectoryHandle | null = null;
  let scripts: Script[] = [];
  let current: Script | null = null;
  let unsaved: Script | null = null;
  let saveTimer = 0;
  const failed = (err: unknown) => print(`Scripts folder: ${(err as Error).message}`, 'terminal-error');
  const flush = async () => {
    clearTimeout(saveTimer);
    const s = unsaved;
    unsaved = null;
    if (s && dir) await writeScript(dir, s).catch(failed);
  };
  const freeName = (name: string, except?: Script) => {
    const taken = (n: string) => scripts.some((s) => s !== except && s.name.toLowerCase() === n.toLowerCase());
    if (!taken(name)) return name;
    let k = 2;
    while (taken(`${name} ${k}`)) k++;
    return `${name} ${k}`;
  };
  const markOpen = () => {
    for (const row of list.querySelectorAll<HTMLElement>('.script-row')) row.classList.toggle('on', row.dataset.name === current?.name);
  };
  const play = async (s: Script) => {
    if (running) return print('Python is still running: wait, or stop it.', 'terminal-note');
    await flush();
    print(`▶ ${s.name}`, 'terminal-echo');
    await batched('_run', s.text);
    changed();
  };
  const open = (s: Script | null) => {
    void flush();
    current = s;
    editor.hidden = !s;
    layout();
    if (s) {
      editorName.textContent = s.name;
      editorText!.value = s.text;
      editorText!.focus();
    } else if (!panes.closed) input!.focus();
    markOpen();
  };
  /** The folder read again: changes made elsewhere show, also in the editor. */
  const rescan = async () => {
    if (!dir) return showList();
    await flush();
    scripts = await listScripts(dir).catch((err) => (failed(err), scripts));
    const again = current && scripts.find((s) => s.name === current!.name);
    if (current && !again) open(null);
    else if (again) {
      current = again;
      if (editorText!.value !== again.text) editorText!.value = again.text;
    }
    showList();
  };
  /** A folder in use: what the browser kept moves into it; empty, it gets the starters. */
  const connect = async (folder: FileSystemDirectoryHandle, chosen: boolean) => {
    dir = folder;
    waiting = null;
    scripts = await listScripts(folder).catch((err) => (failed(err), []));
    if (chosen) {
      await rememberFolder(folder);
      let moving: Script[] = [];
      try {
        moving = JSON.parse(localStorage.getItem(OLD_STORE) ?? '[]');
      } catch {
        // nothing readable to move
      }
      if (!moving.length && !scripts.length) moving = STARTERS;
      for (const s of moving) {
        const script = { name: freeName(cleanName(s.name)), text: s.text };
        await writeScript(folder, script);
        scripts.push(script);
      }
      localStorage.removeItem(OLD_STORE);
    }
    await rescan();
  };
  const choose = async () => {
    const folder = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'makermaker-scripts' }).catch(() => null); // cancelled: stays as it is
    if (!folder) return false;
    await flush();
    open(null);
    await connect(folder, true);
    return true;
  };
  /** The remembered folder again, by a click. */
  const reopen = async () => {
    if (waiting && (await waiting.requestPermission({ mode: 'readwrite' })) === 'granted') await connect(waiting, false);
    return !!dir;
  };
  /** A folder to work in: asked for now, if there is none. */
  const needFolder = async () => !!dir || (waiting ? reopen() : choose());
  let started = false;
  const start = async () => {
    if (started) return (current ? editorText : panes.closed ? null : input)?.focus(), void rescan();
    started = true;
    await fields();
    (panes.closed ? side : input!).focus();
    const kept = canUseFolders() ? await recallFolder().catch(() => undefined) : undefined;
    if (kept && (await kept.queryPermission({ mode: 'readwrite' })) === 'granted') await connect(kept, false);
    else {
      waiting = kept ?? null;
      showList();
    }
  };
  addEventListener('focus', () => !box.hidden && void rescan());
  addEventListener('pagehide', () => void flush());
  editorBar.append(
    editorName,
    button('play', 'Run this script (⌘ or Ctrl + Enter): one undo step', () => current && void play(current)),
    button('close', 'Close the editor: the script stays', () => open(null)),
  );
  const renameIn = (s: Script, label: HTMLElement) => {
    const field = Object.assign(document.createElement('input'), { value: s.name, spellcheck: false, className: 'script-rename' });
    let done = false;
    const end = async (save: boolean) => {
      if (done) return;
      done = true;
      const name = freeName(cleanName(field.value), s);
      if (save && name && name !== s.name && dir) {
        await flush();
        try {
          await writeScript(dir, { name, text: s.text });
          await removeScript(dir, s.name);
          s.name = name;
          if (current === s) editorName.textContent = name;
        } catch (err) {
          failed(err);
        }
      }
      showList();
    };
    field.onblur = () => void end(true);
    field.onclick = (e) => e.stopPropagation();
    field.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void end(true);
      else if (e.key === 'Escape') void end(false);
    };
    label.replaceWith(field);
    field.select();
  };
  /** Instead of the list while there is no folder: what to do about it. */
  const noFolder = () => {
    const note = Object.assign(document.createElement('p'), { className: 'hint script-note' });
    if (!canUseFolders()) return [Object.assign(note, { textContent: 'Scripts are files in a folder on disk: this browser cannot open folders, Chrome and Edge can.' })];
    note.textContent = waiting ? `Your scripts are in "${waiting.name}".` : 'Scripts are .py files in a folder on disk.';
    return [note, Object.assign(document.createElement('button'), { textContent: waiting ? `Open "${waiting.name}"` : 'Choose a folder', title: waiting ? 'Click: Allow this folder again' : 'Click: Pick the folder', onclick: () => void needFolder() })];
  };
  const showList = () => {
    folderButton.hidden = !canUseFolders();
    folderButton.title = dir ? `Scripts folder: ${dir.name} · Click: Choose another` : 'Choose a folder for the scripts';
    headName.textContent = dir ? `Scripts · ${dir.name}` : 'Scripts';
    if (!dir) return list.replaceChildren(...noFolder());
    list.replaceChildren(
      ...scripts.map((s) => {
        const label = Object.assign(document.createElement('span'), { className: 'script-name', textContent: s.name });
        const row = Object.assign(document.createElement('div'), { className: 'script-row', title: 'Click: Edit · double-click: Rename', onclick: () => open(s), ondblclick: () => renameIn(s, label) });
        row.dataset.name = s.name;
        const stop = (act: () => void) => (e: MouseEvent) => (e.stopPropagation(), act());
        row.append(
          label,
          button('play', 'Run: one undo step', stop(() => void play(s))),
          button('edit', 'Rename', stop(() => renameIn(s, label))),
          button('save', 'Download a copy of this .py file', stop(() => {
            const url = URL.createObjectURL(new Blob([s.text], { type: 'text/x-python' }));
            Object.assign(document.createElement('a'), { href: url, download: `${s.name}.py` }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })),
          button('delete', 'Delete the file (Undo comes in its place)', stop(async () => {
            if (current === s) open(null);
            await flush();
            await removeScript(dir!, s.name).catch(failed);
            scripts = scripts.filter((x) => x !== s);
            const gone = Object.assign(document.createElement('div'), { className: 'script-row gone' });
            gone.append(Object.assign(document.createElement('span'), { className: 'script-name', textContent: `${s.name} deleted` }), Object.assign(document.createElement('button'), {
              textContent: 'Undo',
              title: 'Click: Bring it back',
              onclick: async () => {
                await writeScript(dir!, s).catch(failed);
                await rescan();
              },
            }));
            row.replaceWith(gone);
          })),
        );
        return row;
      }),
    );
    markOpen();
  };
  /** Text files become scripts, named after them; the last one opens. */
  const upload = async (files: File[]) => {
    if (!files.length || !(await needFolder())) return;
    let last = '';
    for (const f of files) {
      const s = { name: freeName(cleanName(f.name)), text: await f.text() };
      await writeScript(dir!, s).catch(failed);
      scripts.push(s);
      last = s.name;
    }
    await rescan();
    open(scripts.find((s) => s.name === last) ?? null);
  };
  const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.py,text/x-python,text/plain', multiple: true, hidden: true });
  picker.onchange = () => {
    void upload([...(picker.files ?? [])]); // a copy: clearing the field empties its list
    picker.value = '';
  };
  side.append(picker);
  side.ondragover = (e) => (e.preventDefault(), e.stopPropagation());
  // dropped here they are scripts, not something to import into the design
  side.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    void upload([...(e.dataTransfer?.files ?? [])]);
  };
  const headName = head.firstElementChild as HTMLElement;
  const folderButton = button('open', 'Choose a folder for the scripts', () => void choose());
  const promptButton = button('terminal', '', () => showPrompt(!!panes.closed));
  head.append(promptButton, folderButton, button('import', 'Upload .py files into the folder (or drop them on this list)', () => picker.click()));
  head.append(button('new', 'New script', async () => {
    if (!(await needFolder())) return;
    const s: Script = { name: freeName('New script'), text: '' };
    await writeScript(dir!, s).catch(failed);
    scripts.push(s);
    await rescan();
    open(scripts.find((x) => x.name === s.name) ?? null);
  }));

  layout();

  return { toggle, isOpen: () => !box.hidden };
}
