import type { PyodideInterface } from 'pyodide';

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

def _complete(word):
    found = []
    while (name := _completer.complete(word, len(found))) is not None:
        found.append(name)
    return json.dumps(found)
`;

/** The Python terminal: at the bottom of `parent`, Pyodide loaded when first opened. `cad` is the command API; Enter runs, typing on when unfinished. */
export function pythonTerminal(parent: HTMLElement, api: TerminalApi, changed: () => void) {
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
  box.append(grip, scroll);
  parent.append(box);

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
  const run = async () => {
    const py = python ?? (await load());
    const source = input.value;
    // a blank last line ends a block
    const text = /\n\s*$/.test(source) ? `${source.trimEnd()}\n` : source;
    if (!text.trim()) return;
    const step = py.globals.get('_step');
    let state = '';
    print(source.split('\n').map((l, k) => `${k ? '...' : '>>>'} ${l}`).join('\n'), 'terminal-echo');
    const dropped = api.batch(() => {
      state = step(text);
      return state !== 'error';
    });
    if (dropped) print('Nothing was changed: it failed before its end.', 'terminal-note');
    step.destroy();
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
  grip.onpointerdown = (down) => {
    grip.setPointerCapture(down.pointerId);
    const start = box.offsetHeight;
    grip.onpointermove = (m) => (box.style.height = `${Math.max(80, Math.min(parent.clientHeight - 40, start + down.clientY - m.clientY))}px`);
    grip.onpointerup = () => (grip.onpointermove = grip.onpointerup = null);
  };

  const toggle = (open = box.hidden) => {
    box.hidden = !open;
    if (open) input.focus(), load();
    changed();
  };
  return { toggle, isOpen: () => !box.hidden };
}
