import type { PyodideInterface } from 'pyodide';
import { icon } from './icons';
import { canUseFolders, cleanName, listScripts, recallFolder, rememberFolder, removeScript, writeScript, type Script } from '../io/scriptFolder';

/** What the terminal's `cad` module reaches in the app (see `cad` in main). */
export interface TerminalApi {
  commands(): { name: string; doc: string; params: { name: string; doc: string; optional?: boolean }[] }[];
  run(name: string, args: Record<string, unknown>): unknown;
  /** Runs `step`; what its commands did is one undo step and one build, or dropped when it returns false (the result: dropped anything). */
  batch(step: () => boolean): boolean;
  select(ids: string[]): void;
  selection(): string[];
  undo(): void;
  redo(): void;
}

const PRELUDE = `
import codeop, json, re, rlcompleter, sys, traceback, types
import makermaker_bridge as _bridge

cad = types.ModuleType('cad', 'The modelling commands. cad.commands() lists them, help(cad.box) tells about one.')

def _command(name, doc, params):
    names = [p['name'] for p in params]
    def run(*args, **kw):
        if len(args) > len(names):
            raise TypeError(f'{name}: takes {", ".join(names) or "nothing"}')
        return json.loads(_bridge.run(name, json.dumps({**dict(zip(names, args)), **kw})))
    run.__name__ = name
    run.__qualname__ = 'cad.' + name
    lines = [f"  {p['name']}{' (optional)' if p.get('optional') else ''}: {p['doc']}" for p in params]
    run.__doc__ = doc + ('\\n\\n' + '\\n'.join(lines) if lines else '')
    return run

_list = json.loads(_bridge.commands())
for _c in _list:
    setattr(cad, _c['name'], _command(_c['name'], _c['doc'], _c['params']))
cad.commands = lambda: [_c['name'] for _c in _list]
cad.select = lambda *ids: _bridge.select(json.dumps(ids))
cad.selection = lambda: json.loads(_bridge.selection())
cad.undo = _bridge.undo
cad.redo = _bridge.redo
sys.modules['cad'] = cad

_ns = {'__name__': '__main__', 'cad': cad}
_completer = rlcompleter.Completer(_ns)

def _report():
    kind, error, tb = sys.exc_info()
    frames = [f for f in traceback.extract_tb(tb) if f.filename == '<cad>']
    # a command's complaint, as it is
    message = [re.sub(r'^.*JsException: Error: ', '', m) for m in traceback.format_exception_only(kind, error)]
    sys.stderr.write(''.join(traceback.format_list(frames) + message))

def _step(source):
    """Runs what was typed: 'more' if it goes on, 'error' if it failed, else 'done'."""
    try:
        try:
            code = codeop.compile_command(source, '<cad>', 'single')
        except SyntaxError:
            code = compile(source, '<cad>', 'exec')  # several statements at once, pasted
        if code is None:
            return 'more'
        exec(code, _ns)
        return 'done'
    except BaseException:
        _report()
        return 'error'

def _run(source):
    """Runs a whole script: 'error' if it failed, else 'done'."""
    try:
        exec(compile(source, '<cad>', 'exec'), _ns)
        return 'done'
    except BaseException:
        _report()
        return 'error'

def _complete(word):
    found = []
    while (name := _completer.complete(word, len(found))) is not None:
        found.append(name)
    return json.dumps(found)
`;

/** Written into an empty folder when it is first chosen. */
const STARTERS: Script[] = [
  { name: 'Row of boxes', text: "# five boxes, each taller\nfor k in range(5):\n    cad.box(20, 20, 10 + k * 10, at=[k * 30, 0, 0], name=f'Box {k + 1}')\n" },
  { name: 'Ring of cylinders', text: "import math\n\ncount = 8\nfor k in range(count):\n    a = 2 * math.pi * k / count\n    cad.cylinder(diameter=12, height=30, at=[60 * math.cos(a), 60 * math.sin(a), 0], name=f'Post {k + 1}')\n" },
];
/** Where scripts were kept in the browser before: moved into the first folder chosen. */
const OLD_STORE = 'makermaker.scripts';

/**
 * The Python terminal, a drawer in `parent`: its tab in `tabs`, open across the view, lifting the other drawers
 * (`--drawers-up`). Pyodide loads when first opened. Two columns: the terminal (`cad` is the command API; Enter runs,
 * typing on when unfinished), beside it the script being edited; and the scripts. A script runs as one undo step.
 */
export function pythonTerminal(parent: HTMLElement, tabs: HTMLElement, api: TerminalApi, changed: () => void) {
  const box = Object.assign(document.createElement('div'), { className: 'terminal', hidden: true });
  const grip = Object.assign(document.createElement('div'), { className: 'terminal-grip', title: 'Drag: the height of the terminal' });
  const output = Object.assign(document.createElement('pre'), { className: 'terminal-out' });
  const prompt = Object.assign(document.createElement('span'), { className: 'terminal-prompt', textContent: '>>>' });
  const input = Object.assign(document.createElement('textarea'), { spellcheck: false, rows: 1 });
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocorrect', 'off');
  const line = Object.assign(document.createElement('div'), { className: 'terminal-line' });
  line.append(prompt, input);
  const scroll = Object.assign(document.createElement('div'), { className: 'terminal-scroll', onclick: () => getSelection()?.isCollapsed && input.focus() });
  scroll.append(output, line);
  const button = (name: string, title: string, onclick: (e: MouseEvent) => void) => Object.assign(document.createElement('button'), { className: 'icon', innerHTML: icon(name), title, onclick });
  // the script being edited
  const editorName = Object.assign(document.createElement('span'), { className: 'script-title' });
  const editorText = Object.assign(document.createElement('textarea'), { spellcheck: false, className: 'script-text' });
  const editorBar = Object.assign(document.createElement('div'), { className: 'script-bar' });
  const editor = Object.assign(document.createElement('div'), { className: 'script-editor', hidden: true });
  editor.append(editorBar, editorText);
  const main = Object.assign(document.createElement('div'), { className: 'terminal-main' });
  main.append(editor, scroll);
  // the scripts
  const list = Object.assign(document.createElement('div'), { className: 'script-list' });
  const side = Object.assign(document.createElement('div'), { className: 'scripts' });
  const head = Object.assign(document.createElement('div'), { className: 'scripts-head' });
  head.append(Object.assign(document.createElement('span'), { textContent: 'Scripts' }));
  side.append(head, list);
  const cols = Object.assign(document.createElement('div'), { className: 'terminal-cols' });
  cols.append(main, side);
  box.append(grip, cols);
  parent.append(box);
  const drawerEl = Object.assign(document.createElement('div'), { className: 'drawer' });
  drawerEl.append(Object.assign(document.createElement('button'), { className: 'drawer-tab', innerHTML: `${icon('chevron')}<span>Python terminal</span>`, title: 'Show or hide the Python terminal (I)', onclick: () => toggle() }));
  tabs.prepend(drawerEl);

  const print = (text: string, kind = '') => {
    const part = Object.assign(document.createElement('span'), { className: kind, textContent: text.endsWith('\n') ? text : `${text}\n` });
    output.append(part);
    scroll.scrollTop = scroll.scrollHeight;
  };
  const fit = () => {
    input.rows = input.value.split('\n').length;
    prompt.textContent = input.value.includes('\n') ? '...' : '>>>';
    scroll.scrollTop = scroll.scrollHeight;
  };

  let python: PyodideInterface | null = null;
  let loading: Promise<PyodideInterface> | null = null;
  const load = () =>
    (loading ??= (async () => {
      print('Loading Python…', 'terminal-note');
      const { loadPyodide } = await import('pyodide');
      const py = await loadPyodide({ indexURL: new URL('pyodide/', document.baseURI).href });
      py.setStdout({ batched: (text) => print(text) });
      py.setStderr({ batched: (text) => print(text, 'terminal-error') });
      py.registerJsModule('makermaker_bridge', {
        commands: () => JSON.stringify(api.commands()),
        run: (name: string, args: string) => JSON.stringify(api.run(name, JSON.parse(args)) ?? null),
        select: (ids: string) => api.select(JSON.parse(ids)),
        selection: () => JSON.stringify(api.selection()),
        undo: api.undo,
        redo: api.redo,
      });
      py.runPython(PRELUDE);
      print(`Python ${py.runPython('sys.version.split()[0]')} · cad is ready: cad.box(80, 60, 40) · cad.commands() lists all · help(cad.box) tells about one`, 'terminal-note');
      python = py;
      changed();
      return py;
    })());

  const past: string[] = [];
  let back = 0;
  /** Runs `text` through Python's `fn` as one undo step; its state. */
  const batched = (py: PyodideInterface, fn: string, text: string) => {
    const step = py.globals.get(fn);
    let state = '';
    const dropped = api.batch(() => {
      state = step(text);
      return state !== 'error';
    });
    if (dropped) print('Nothing was changed: it failed before its end.', 'terminal-note');
    step.destroy();
    return state;
  };
  const run = async () => {
    const py = python ?? (await load());
    const source = input.value;
    // a blank last line ends a block
    const text = /\n\s*$/.test(source) ? `${source.trimEnd()}\n` : source;
    if (!text.trim()) return;
    print(source.split('\n').map((l, k) => `${k ? '...' : '>>>'} ${l}`).join('\n'), 'terminal-echo');
    const state = batched(py, '_step', text);
    if (state === 'more') {
      output.lastChild?.remove(); // not run yet
      const indent = source.match(/(?:^|\n)( *)[^\n]*$/)?.[1] ?? '';
      input.value = `${source}\n${indent}${source.trimEnd().endsWith(':') ? '    ' : ''}`;
      return fit();
    }
    past.push(source);
    back = past.length;
    input.value = '';
    fit();
    changed();
  };
  const complete = () => {
    if (!python) return;
    const end = input.selectionStart;
    const word = input.value.slice(0, end).match(/[\w.]+$/)?.[0];
    if (!word) return input.setRangeText('    ', end, end, 'end'), fit();
    const fn = python.globals.get('_complete');
    const found: string[] = JSON.parse(fn(word));
    fn.destroy();
    if (!found.length) return;
    const same = found.reduce((a, b) => {
      let k = 0;
      while (k < a.length && a[k] === b[k]) k++;
      return a.slice(0, k);
    });
    input.setRangeText(same.slice(word.length), end, end, 'end');
    if (found.length > 1) print(found.join('  '), 'terminal-note');
  };
  input.onkeydown = (e) => {
    const firstLine = !input.value.slice(0, input.selectionStart).includes('\n');
    const lastLine = !input.value.slice(input.selectionEnd).includes('\n');
    if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(), run();
    else if (e.key === 'Tab') e.preventDefault(), complete();
    else if (e.key === 'Escape') toggle(false);
    else if (e.key === 'ArrowUp' && firstLine && back > 0) e.preventDefault(), (input.value = past[--back]), fit();
    else if (e.key === 'ArrowDown' && lastLine && back < past.length) e.preventDefault(), (input.value = past[++back] ?? ''), fit();
    else if (e.key === 'l' && e.ctrlKey) e.preventDefault(), output.replaceChildren();
    else return void setTimeout(fit);
    e.stopPropagation();
  };
  input.oninput = fit;
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
    if (open) (current ? editorText : input).focus(), load(), void start();
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
    const py = python ?? (await load());
    await flush();
    print(`▶ ${s.name}`, 'terminal-echo');
    batched(py, '_run', s.text);
    changed();
  };
  const open = (s: Script | null) => {
    void flush();
    current = s;
    editor.hidden = !s;
    if (s) {
      editorName.textContent = s.name;
      editorText.value = s.text;
      editorText.focus();
    } else input.focus();
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
      if (editorText.value !== again.text) {
        const at = editorText.selectionStart;
        editorText.value = again.text;
        editorText.setSelectionRange(at, at);
      }
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
    if (started) return void rescan();
    started = true;
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
  editorText.oninput = () => {
    if (!current) return;
    current.text = editorText.value;
    unsaved = current;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flush(), 400);
  };
  editorText.onkeydown = (e) => {
    const at = editorText.selectionStart;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) current && void play(current);
    else if (e.key === 'Enter') {
      const before = editorText.value.slice(0, at);
      const last = before.slice(before.lastIndexOf('\n') + 1);
      editorText.setRangeText(`\n${last.match(/^ */)![0]}${last.trimEnd().endsWith(':') ? '    ' : ''}`, at, editorText.selectionEnd, 'end');
      editorText.dispatchEvent(new Event('input'));
    } else if (e.key === 'Tab') {
      editorText.setRangeText('    ', at, editorText.selectionEnd, 'end');
      editorText.dispatchEvent(new Event('input'));
    } else if (e.key === 'Escape') toggle(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
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
  head.append(folderButton, button('import', 'Upload .py files into the folder (or drop them on this list)', () => picker.click()));
  head.append(button('new', 'New script', async () => {
    if (!(await needFolder())) return;
    const s: Script = { name: freeName('New script'), text: '' };
    await writeScript(dir!, s).catch(failed);
    scripts.push(s);
    await rescan();
    open(scripts.find((x) => x.name === s.name) ?? null);
  }));

  return { toggle, isOpen: () => !box.hidden };
}
