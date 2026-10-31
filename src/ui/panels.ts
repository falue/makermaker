import { displayText, isPlain, UNITS } from '../doc/expr';
import { getIn, setIn } from '../doc/resolve';
import { ex, newFinish, newHole, newPart } from '../doc/sample';
import type { Doc, EdgeRule, Expr, Part, Profile, Step, Unit } from '../doc/types';

export interface UIContext {
  doc: Doc;
  selected: string | null;
  exprErrors: Map<string, string>;
  kernelErrors: Map<string, { stepId: string; error: string }>;
  title: string;
  dirty: boolean;
  status: string;
  notify(message: string): void;
  paramValue(name: string): string;
  commit(doc: Doc): void;
  select(id: string | null): void;
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

function exprField(ctx: UIContext, path: string, label: string, raw = false) {
  const keys = path.split('.');
  const x = getIn(ctx.doc, keys) as Expr;
  const el = input(
    path,
    raw ? x.e : displayText(x, ctx.doc.units),
    (e) => ctx.commit(setIn(ctx.doc, keys, { e, u: ctx.doc.units })),
    ctx.exprErrors.get(path),
  );
  if (!el.title && !isPlain(x.e) && x.u !== ctx.doc.units) el.title = `plain numbers in ${x.u}`;
  return h('label', { className: 'field' }, h('span', {}, label), el);
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
    h('button', { className: `item${p.id === ctx.selected ? ' selected' : ''}`, onclick: () => ctx.select(p.id) }, p.name),
  );
  const addPart = button('+ Part', () => {
    const part = newPart(`Part ${doc.parts.length + 1}`, doc.units);
    ctx.commit({ ...doc, parts: [...doc.parts, part] });
    ctx.select(part.id);
  });

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

  return [h('h3', {}, 'Parts'), ...parts, addPart, h('h3', {}, 'Parameters'), ...params, addParam];
}

function right(ctx: UIContext): Node[] {
  const i = ctx.doc.parts.findIndex((p) => p.id === ctx.selected);
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
      button('+ Hole', () => setPart({ ...part, steps: [...part.steps, newHole(ctx.doc.units)] })),
      button('+ Fillet', () => setPart({ ...part, steps: [...part.steps, newFinish(ctx.doc.units)] })),
    ),
  ];
}

function stepCard(ctx: UIContext, part: Part, step: Step, at: string, setPart: (p: Part) => void) {
  const setStep = (next: Step) => setPart({ ...part, steps: part.steps.map((s) => (s === step ? next : s)) });
  const remove = button('×', () => setPart({ ...part, steps: part.steps.filter((s) => s !== step) }), 'Remove');
  const f = (key: string, label: string) => exprField(ctx, `${at}.${key}`, label);

  switch (step.type) {
    case 'extrude': {
      const p = step.profile;
      const kind = select(p.kind, { rect: 'Rectangle', circle: 'Circle' }, (k) => {
        const profile: Profile =
          k === p.kind ? p : p.kind === 'rect' ? { kind: 'circle', d: p.w } : { kind: 'rect', w: p.d, h: p.d, r: ex(0, ctx.doc.units) };
        setStep({ ...step, profile });
      });
      const dims =
        p.kind === 'rect'
          ? [f('profile.w', 'Width'), f('profile.h', 'Height'), f('profile.r', 'Corner')]
          : [f('profile.d', 'Diameter')];
      return h('section', {}, h('h4', {}, 'Base ', kind), h('div', { className: 'row' }, ...dims, f('depth', 'Depth')));
    }
    case 'hole':
      return h(
        'section',
        {},
        h('h4', {}, 'Hole', remove),
        h('div', { className: 'row' }, f('x', 'X'), f('y', 'Y'), f('d', 'Diameter')),
      );
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
