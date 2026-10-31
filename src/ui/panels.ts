import { displayText, fmt, isPlain, UNITS } from '../doc/expr';
import { getIn, setIn } from '../doc/resolve';
import { ex, newFinish } from '../doc/sample';
import type { BasePlane, Doc, EdgeRule, Expr, Part, Profile, Step, Unit } from '../doc/types';
import type { ToolKind } from '../viewer/sketch';

export interface UIContext {
  doc: Doc;
  selected: string[];
  exprErrors: Map<string, string>;
  kernelErrors: Map<string, { stepId: string; error: string }>;
  title: string;
  dirty: boolean;
  status: string;
  tool: ToolKind | null;
  /** Replaces the hint bar text while a tool runs. */
  hint: string | null;
  notify(message: string): void;
  paramValue(name: string): string;
  commit(doc: Doc): void;
  /** `live`: replaces the current undo step (scrubbing). */
  setValue(path: string[], value: unknown, live?: boolean): void;
  select(id: string | null, add?: boolean): void;
  startTool(kind: ToolKind): void;
  newDoc(): void;
  open(): void;
  save(): void;
  undo(): void;
  redo(): void;
}

const $ = (id: string) => document.getElementById(id)!;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

/** Set while panels are rebuilt, so blur from removed inputs does not commit. */
let rendering = false;

/** Rebuilds all panels, keeping focus and unsaved typing in the active field. */
export function renderUI(ctx: UIContext) {
  const active = document.activeElement as HTMLInputElement | null;
  const path = active?.dataset?.path;
  const typing = active?.dataset.dirty ? { value: active.value, from: active.selectionStart, to: active.selectionEnd } : null;
  rendering = true;
  $('topbar').replaceChildren(...topbar(ctx));
  $('left').replaceChildren(...left(ctx));
  $('right').replaceChildren(...right(ctx));
  $('hint').innerHTML = (ctx.hint ?? hint(ctx.selected.length)).replace(/\[(.+?)\]/g, '<kbd>$1</kbd>');
  rendering = false;
  const el = path && document.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`);
  if (!el) return;
  el.focus();
  if (!typing) return el.select();
  el.value = typing.value;
  el.dataset.dirty = '1';
  el.setSelectionRange(typing.from, typing.to);
}

/** Text input that commits on Enter or blur and reverts on Escape. */
function input(path: string, shown: string, apply: (text: string) => void, error?: string) {
  const el = h('input', { value: shown, spellcheck: false });
  el.dataset.path = path;
  if (error) {
    el.classList.add('invalid');
    el.title = error;
  }
  const commit = () => {
    if (rendering) return;
    delete el.dataset.dirty;
    const text = el.value.trim();
    if (text && text !== shown) apply(text);
    else el.value = shown;
  };
  el.oninput = () => (el.dataset.dirty = '1');
  el.onblur = commit;
  el.onkeydown = (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') {
      el.value = shown;
      el.blur();
    }
  };
  return el;
}

/** Expression input; dragging the label of a number scrubs it (Shift: fine). */
function exprField(ctx: UIContext, path: string, label: string, raw = false) {
  const keys = path.split('.');
  const x = getIn(ctx.doc, keys) as Expr;
  const u = ctx.doc.units;
  const shown = raw ? x.e : displayText(x, u);
  const el = input(path, shown, (e) => ctx.setValue(keys, { e, u }), ctx.exprErrors.get(path));
  if (!el.title && !isPlain(x.e) && x.u !== u) el.title = `plain numbers in ${x.u}`;
  const name = h('span', {}, label);
  // a number with an optional unit (`12`, `4mm`) keeps its unit while scrubbed
  const num = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)\s*$/i.exec(shown);
  const unit = (num?.[2] || u) as Unit;
  if (num && unit in UNITS) {
    const step = { mm: 0.5, cm: 0.05, m: 0.0005, in: 0.02, ft: 0.002 }[unit]; // per px, as in incase
    /** Scrubs once the pointer moved more than `threshold` px sideways; a press without that is a `click`. */
    const press = (e: PointerEvent, threshold: number, click: () => void) => {
      e.preventDefault();
      const base = parseFloat(num[1]);
      let origin: number | null = null;
      let last = shown;
      // on window: the panels are rebuilt while scrubbing
      const move = (m: PointerEvent) => {
        if (origin === null) {
          if (Math.abs(m.clientX - e.clientX) <= threshold) return;
          origin = m.clientX;
          document.body.classList.add('scrubbing');
        }
        const text = fmt(base + Math.round((m.clientX - origin) / (m.shiftKey ? 10 : 1)) * step) + num[2];
        if (text === last) return;
        ctx.setValue(keys, { e: text, u }, last !== shown);
        last = text;
      };
      const end = () => {
        removeEventListener('pointermove', move);
        document.body.classList.remove('scrubbing');
        if (origin === null) click();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', end, { once: true });
    };
    name.className = 'scrub';
    name.onpointerdown = (e) => press(e, 0, () => {});
    // in the field: drag scrubs, a click edits (once focused, the field takes text selection as usual)
    el.classList.add('scrub');
    el.onpointerdown = (e) =>
      document.activeElement !== el &&
      press(e, 3, () => {
        const field = document.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`);
        field?.focus();
        field?.select();
      });
  }
  return h('label', { className: 'field' }, name, el);
}

function select<T extends string>(value: T, options: Record<T, string>, onChange: (v: T) => void) {
  const el = h('select', { onchange: () => onChange(el.value as T) });
  for (const [v, label] of Object.entries(options) as [T, string][]) el.append(h('option', { value: v, selected: v === value }, label));
  return el;
}

const button = (label: string, onclick: () => void, title = '') => h('button', { onclick, title }, label);

function topbar(ctx: UIContext): Node[] {
  return [
    h('strong', {}, 'MAKERMAKER'),
    button('New', ctx.newDoc),
    button('Open', ctx.open, 'Cmd+O, or drop a file'),
    button('Save', ctx.save, 'Cmd+S'),
    button('Undo', ctx.undo, 'Cmd+Z'),
    button('Redo', ctx.redo, 'Cmd+Shift+Z'),
    h(
      'span',
      { className: 'segmented' },
      ...([
        ['rect', 'Rectangle', 'R'],
        ['circle', 'Circle', 'C'],
        ['polygon', 'Polygon', 'P'],
      ] as const).map(([kind, label, key]) =>
        h('button', { className: ctx.tool === kind ? 'on' : '', title: `Draw a ${label.toLowerCase()} and pull it up (${key})`, onclick: () => ctx.startTool(kind) }, label),
      ),
    ),
    select(
      ctx.doc.units,
      Object.fromEntries(Object.keys(UNITS).map((u) => [u, u])) as Record<Unit, string>,
      (units) => ctx.commit({ ...ctx.doc, units }),
    ),
    h('span', { className: 'title' }, ctx.title + (ctx.dirty ? ' •' : '')),
    h('span', { className: 'status' }, ctx.status),
  ];
}

const RESERVED = new Set([...Object.keys(UNITS), 'pi', 'sqrt', 'abs', 'min', 'max']);

function left(ctx: UIContext): Node[] {
  const { doc } = ctx;
  const parts = doc.parts.map((p) =>
    h(
      'button',
      { className: `item${ctx.selected.includes(p.id) ? ' selected' : ''}`, onclick: (e) => ctx.select(p.id, e.shiftKey) },
      p.name,
    ),
  );
  const params = Object.keys(doc.params).map((name) =>
    h(
      'div',
      { className: 'param' },
      exprField(ctx, `params.${name}`, name, true),
      h('span', { className: 'value' }, ctx.paramValue(name)),
      button('×', () => {
        const { [name]: _, ...rest } = doc.params;
        ctx.commit({ ...doc, params: rest });
      }, 'Delete parameter'),
    ),
  );
  const addParam = input('new-param', '', (text) => {
    const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(text);
    const name = m?.[1];
    if (!m || !name || RESERVED.has(name) || Object.hasOwn(doc.params, name)) {
      return ctx.notify(m ? `"${name}" is reserved or exists` : 'use: name = expression');
    }
    ctx.commit({ ...doc, params: { ...doc.params, [name]: { e: m[2], u: doc.units } } });
  });
  addParam.placeholder = 'name = expression';

  const none = doc.parts.length ? [] : [h('p', { className: 'hint' }, 'Draw a shape (R, C, P) to start a part.')];
  return [h('h3', {}, 'Parts'), ...parts, ...none, h('h3', {}, 'Parameters'), ...params, addParam];
}

function right(ctx: UIContext): Node[] {
  const n = ctx.selected.length;
  if (n > 1)
    return [h('p', { className: 'hint' }, `${n} parts selected: drag, nudge, duplicate or delete them together; select one to edit it.`)];
  const i = ctx.doc.parts.findIndex((p) => p.id === ctx.selected[0]);
  if (i < 0) return [h('p', { className: 'hint' }, 'Select a part.')];
  const part = ctx.doc.parts[i];
  const at = `parts.${i}`;
  const setPart = (next: Part) => ctx.commit(setIn(ctx.doc, ['parts', String(i)], next));
  const failure = ctx.kernelErrors.get(part.id);

  return [
    h(
      'div',
      { className: 'head' },
      input(`${at}.name`, part.name, (name) => setPart({ ...part, name })),
      button('Delete', () => {
        ctx.commit({ ...ctx.doc, parts: ctx.doc.parts.filter((p) => p.id !== part.id) });
        ctx.select(null);
      }),
    ),
    h('h3', {}, 'Position'),
    h('div', { className: 'row' }, ...['X', 'Y', 'Z'].map((l, k) => exprField(ctx, `${at}.position.${k}`, l))),
    ...part.steps.map((step, j) => {
      const card = stepCard(ctx, part, step, `${at}.steps.${j}`, setPart);
      if (failure && (failure.stepId === step.id || (!failure.stepId && j === 0)))
        card.append(h('p', { className: 'error' }, failure.error));
      return card;
    }),
    h(
      'div',
      { className: 'row' },
      button('+ Fillet', () => setPart({ ...part, steps: [...part.steps, newFinish(ctx.doc.units)] })),
    ),
  ];
}

function hint(selected: number) {
  if (selected > 1)
    return 'Drag a part to move them all: the direction picks X, Y or Z · [Alt] free in the plane facing you · [Shift]-click adds or removes · [Ctrl] snaps · [arrows] nudge ([Shift] ×10) · [Del] delete · [⌘D] duplicate · [Esc] deselect · [⌘Z] undo';
  if (selected)
    return 'Drag to move: the direction picks X, Y or Z · [Alt] free in the plane facing you · [Ctrl] snaps · [Shift]-click selects more · [arrows] nudge ([Shift] ×10) · [Del] delete · [⌘D] duplicate · [Esc] deselect';
  return 'Drag a part to move it: the direction picks X, Y or Z · [Tab] next part under the click · [F] fit · drag to orbit, right-drag to pan, wheel to zoom · drag a field label to scrub ([Shift] fine) · [⌘Z] undo';
}

function stepCard(ctx: UIContext, part: Part, step: Step, at: string, setPart: (p: Part) => void) {
  const setStep = (next: Step) => setPart({ ...part, steps: part.steps.map((s) => (s === step ? next : s)) });
  const remove = button('×', () => setPart({ ...part, steps: part.steps.filter((s) => s !== step) }), 'Remove');
  const f = (key: string, label: string) => exprField(ctx, `${at}.${key}`, label);

  switch (step.type) {
    case 'extrude': {
      const u = ctx.doc.units;
      const extrudes = part.steps.filter((t) => t.type === 'extrude');
      const name = (t: (typeof extrudes)[number]) => `Extrude ${extrudes.indexOf(t) + 1}`;
      const planes: Record<string, string> = { xy: 'Ground (XY)', xz: 'Front (XZ)', yz: 'Right (YZ)' };
      for (const t of extrudes.slice(0, extrudes.indexOf(step))) if (!t.through) planes[`cap:${t.id}`] = `On top of ${name(t)}`;
      const value = step.plane.kind === 'base' ? step.plane.axis : `cap:${step.plane.step}`;
      planes[value] ??= 'Lost face';
      const offset = step.plane.kind === 'base' ? step.plane.offset : ex(0, u);
      const plane = select(value, planes, (v) =>
        setStep({ ...step, plane: v.startsWith('cap:') ? { kind: 'cap', step: v.slice(4) } : { kind: 'base', axis: v as BasePlane, offset } }),
      );
      const mode = select(step.mode, { add: 'Add', cut: 'Cut' }, (m) => setStep({ ...step, mode: m, through: m === 'cut' && step.through }));
      const through = h('input', { type: 'checkbox', checked: step.through });
      through.onchange = () => setStep({ ...step, through: through.checked });
      const reach = [
        ...(step.through ? [] : [f('depth', 'Depth')]),
        ...(step.mode === 'cut' ? [h('label', { className: 'check' }, through, 'Through')] : []),
      ];
      const profiles = step.profiles.map((p, k) => {
        const pf = (key: string, label: string) => f(`profiles.${k}.${key}`, label);
        const drop = button('×', () => setStep({ ...step, profiles: step.profiles.filter((q) => q !== p) }), 'Remove this shape');
        const fields: Record<Profile['kind'], () => HTMLElement[]> = {
          rect: () => [pf('x', 'X'), pf('y', 'Y'), pf('w', 'W'), pf('h', 'H'), pf('r', 'R')],
          circle: () => [pf('x', 'X'), pf('y', 'Y'), pf('d', 'Ø')],
          polygon: () => [h('span', { className: 'hint' }, `${p.kind === 'polygon' ? p.pts.length : 0} corners`), pf('r', 'R')],
        };
        return h('div', { className: 'row profile' }, ...fields[p.kind](), ...(step.profiles.length > 1 ? [drop] : []));
      });
      return h(
        'section',
        {},
        h('h4', {}, name(step), mode, remove),
        h('div', { className: 'row' }, plane, ...(step.plane.kind === 'base' ? [f('plane.offset', 'Offset')] : [])),
        ...profiles,
        h('div', { className: 'row' }, ...reach),
      );
    }
    case 'finish': {
      const enabled = h('input', { type: 'checkbox', checked: step.enabled, title: 'Enabled' });
      enabled.onchange = () => setStep({ ...step, enabled: enabled.checked });
      const mode = select(step.mode, { fillet: 'Fillet', chamfer: 'Chamfer' }, (m) => setStep({ ...step, mode: m }));
      const edges = select<EdgeRule>(
        step.edges,
        { all: 'All edges', top: 'Top edges', bottom: 'Bottom edges', vertical: 'Vertical edges' },
        (r) => setStep({ ...step, edges: r }),
      );
      return h(
        'section',
        { className: step.enabled ? '' : 'disabled' },
        h('h4', {}, enabled, mode, remove),
        h('div', { className: 'row' }, f('size', step.mode === 'fillet' ? 'Radius' : 'Distance'), edges),
      );
    }
  }
}
