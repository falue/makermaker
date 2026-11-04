import type { PyodideInterface } from 'pyodide';
import { icon } from './icons';

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

/** A saved script. */
type Script = { id: string; name: string; text: string };

/** The scripts, kept in this browser for every design; the first time, two to start from. */
const STORE = 'makermaker.scripts';
const STARTERS: Omit<Script, 'id'>[] = [
  { name: 'Row of boxes', text: "# five boxes, each taller\nfor k in range(5):\n    cad.box(20, 20, 10 + k * 10, at=[k * 30, 0, 0], name=f'Box {k + 1}')\n" },
  { name: 'Ring of cylinders', text: "import math\n\ncount = 8\nfor k in range(count):\n    a = 2 * math.pi * k / count\n    cad.cylinder(diameter=12, height=30, at=[60 * math.cos(a), 60 * math.sin(a), 0], name=f'Post {k + 1}')\n" },
];
function loadScripts(): Script[] {
  try {
    const kept = localStorage.getItem(STORE);
    if (kept) return JSON.parse(kept);
  } catch {
    // none kept
  }
  return STARTERS.map((s, k) => ({ ...s, id: `starter${k}` }));
}

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
    if (open) (current ? editorText : input).focus(), load();
    changed();
  };

  // the scripts: every change kept at once
  let scripts = loadScripts();
  let current: Script | null = null;
  const keep = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(scripts));
    } catch {
      print('The scripts could not be kept in this browser.', 'terminal-error');
    }
  };
  const freeName = (name: string, except?: Script) => {
    const taken = (n: string) => scripts.some((s) => s !== except && s.name === n);
    if (!taken(name)) return name;
    let k = 2;
    while (taken(`${name} ${k}`)) k++;
    return `${name} ${k}`;
  };
  const markOpen = () => {
    for (const row of list.querySelectorAll<HTMLElement>('.script-row')) row.classList.toggle('on', row.dataset.id === current?.id);
  };
  const play = async (s: Script) => {
    const py = python ?? (await load());
    print(`▶ ${s.name}`, 'terminal-echo');
    batched(py, '_run', s.text);
    changed();
  };
  const open = (s: Script | null) => {
    current = s;
    editor.hidden = !s;
    if (s) {
      editorName.textContent = s.name;
      editorText.value = s.text;
      editorText.focus();
    } else input.focus();
    markOpen();
  };
  editorBar.append(
    editorName,
    button('play', 'Run this script (⌘ or Ctrl + Enter): one undo step', () => current && void play(current)),
    button('close', 'Close the editor: the script stays', () => open(null)),
  );
  editorText.oninput = () => {
    if (!current) return;
    current.text = editorText.value;
    keep();
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
    const end = (save: boolean) => {
      if (done) return;
      done = true;
      const name = field.value.trim();
      if (save && name) {
        s.name = freeName(name, s);
        keep();
        if (current === s) editorName.textContent = s.name;
      }
      showList();
    };
    field.onblur = () => end(true);
    field.onclick = (e) => e.stopPropagation();
    field.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') end(true);
      else if (e.key === 'Escape') end(false);
    };
    label.replaceWith(field);
    field.select();
  };
  const showList = () => {
    list.replaceChildren(
      ...scripts.map((s) => {
        const label = Object.assign(document.createElement('span'), { className: 'script-name', textContent: s.name });
        const row = Object.assign(document.createElement('div'), { className: 'script-row', title: 'Click: Edit · double-click: Rename', onclick: () => open(s), ondblclick: () => renameIn(s, label) });
        row.dataset.id = s.id;
        const stop = (act: () => void) => (e: MouseEvent) => (e.stopPropagation(), act());
        row.append(
          label,
          button('play', 'Run: one undo step', stop(() => void play(s))),
          button('edit', 'Rename', stop(() => renameIn(s, label))),
          button('save', 'Download as a .py file', stop(() => {
            const url = URL.createObjectURL(new Blob([s.text], { type: 'text/x-python' }));
            Object.assign(document.createElement('a'), { href: url, download: `${s.name}.py` }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })),
          button('delete', 'Delete (Undo comes in its place)', stop(() => {
            const at = scripts.indexOf(s);
            scripts = scripts.filter((x) => x !== s);
            keep();
            if (current === s) open(null);
            const gone = Object.assign(document.createElement('div'), { className: 'script-row gone' });
            gone.append(Object.assign(document.createElement('span'), { className: 'script-name', textContent: `${s.name} deleted` }), Object.assign(document.createElement('button'), {
              textContent: 'Undo',
              title: 'Click: Bring it back',
              onclick: () => {
                scripts.splice(Math.min(at, scripts.length), 0, s);
                keep();
                showList();
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
  const upload = async (files: Iterable<File>) => {
    let last: Script | null = null;
    for (const f of files) {
      last = { id: crypto.randomUUID(), name: freeName(f.name.replace(/\.py$/i, '')), text: await f.text() };
      scripts.push(last);
    }
    if (!last) return;
    keep();
    showList();
    open(last);
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
  head.append(button('import', 'Upload .py files (or drop them on this list)', () => picker.click()));
  head.append(button('new', 'New script', () => {
    const s: Script = { id: crypto.randomUUID(), name: freeName('New script'), text: '' };
    scripts.push(s);
    keep();
    showList();
    open(s);
  }));
  showList();
  return { toggle, isOpen: () => !box.hidden };
}
