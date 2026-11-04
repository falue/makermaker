import { loadPyodide } from 'pyodide';
import { describe, runCommand } from '../api/commands';
import type { Doc } from '../doc/types';

/**
 * Python off the page's thread, so an endless loop can be stopped. Commands are pure steps from one document to the
 * next, so `cad` runs them here on the design as it was when the run began; the page takes the outcome at its end.
 */
export type ToPython = { kind: 'init'; indexURL: string } | { kind: 'run'; fn: '_step' | '_run'; text: string; doc?: Doc; selection: string[] } | { kind: 'complete'; word: string };
export type FromPython =
  | { kind: 'out'; text: string; error: boolean }
  | { kind: 'ready'; version: string }
  | { kind: 'found'; names: string[] }
  /** `doc`: changed; `selection`: changed; `moves`: undo (below 0) or redo steps past the run's start. */
  | { kind: 'done'; state: string; doc?: Doc; selection?: string[]; moves: number; failedAfterChange: boolean };

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

const post = (message: FromPython) => postMessage(message);

// Output goes out in bursts, so `while True: print(1)` cannot drown the page.
const OUT_EVERY = 50; // ms
const OUT_LINES = 2000;
let lines: string[] = [];
let linesError = false;
let lastOut = 0;
const flush = () => {
  if (lines.length) post({ kind: 'out', text: lines.join('\n'), error: linesError });
  lines = [];
  lastOut = performance.now();
};
const out = (text: string, error: boolean) => {
  if (error !== linesError) flush();
  linesError = error;
  lines.push(text);
  if (lines.length > OUT_LINES) lines.splice(0, lines.length - OUT_LINES);
  if (performance.now() - lastOut > OUT_EVERY) flush();
};

// One run: its documents (undo and redo walk them), its selection, and steps past its start.
let base: Doc;
let steps: Doc[] = [];
let at = 0;
let selection: string[] = [];
let moves = 0;

const bridge = {
  commands: () => JSON.stringify(describe()),
  run(name: string, args: string) {
    if (moves) throw new Error(`${name}: cad.undo / cad.redo left this run's start: go on in the next run`);
    const from = steps[at];
    const { doc, result } = runCommand(from, name, JSON.parse(args));
    if (doc !== from) {
      steps = [...steps.slice(0, at + 1), doc];
      at++;
      if (typeof result === 'string' && [...doc.bodies, ...doc.sketches, ...doc.groups].some((o) => o.id === result)) selection = [result];
    }
    return JSON.stringify(result ?? null);
  },
  select: (ids: string) => void (selection = JSON.parse(ids)),
  selection: () => JSON.stringify(selection),
  undo() {
    if (at > 0 && !moves) at--;
    else moves--;
  },
  redo() {
    if (moves < 0) moves++;
    else if (at < steps.length - 1) at++;
    else moves++;
  },
};

let python: Awaited<ReturnType<typeof loadPyodide>>;
let ready: Promise<void>;

const load = async (indexURL: string) => {
  python = await loadPyodide({ indexURL });
  python.setStdout({ batched: (text) => out(text, false) });
  python.setStderr({ batched: (text) => out(text, true) });
  python.registerJsModule('makermaker_bridge', bridge);
  python.runPython(PRELUDE);
  post({ kind: 'ready', version: python.runPython('sys.version.split()[0]') });
};

onmessage = async ({ data }: MessageEvent<ToPython>) => {
  if (data.kind === 'init') return void (ready = load(data.indexURL));
  await ready;
  const fn = python.globals.get(data.kind === 'run' ? data.fn : '_complete');
  if (data.kind === 'complete') {
    post({ kind: 'found', names: JSON.parse(fn(data.word)) });
    return fn.destroy();
  }
  base = data.doc ?? base;
  [steps, at, moves] = [[base], 0, 0];
  const before = (selection = data.selection);
  const state: string = fn(data.text);
  fn.destroy();
  flush();
  const changed = steps[at] !== base;
  if (state === 'error') post({ kind: 'done', state, moves: 0, failedAfterChange: changed });
  else post({ kind: 'done', state, moves, failedAfterChange: false, ...(changed ? { doc: steps[at] } : {}), ...(selection !== before ? { selection } : {}) });
};
