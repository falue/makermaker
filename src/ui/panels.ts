import { displayText, fmt, isPlain, UNITS } from '../doc/expr';
import { getIn, setIn } from '../doc/resolve';
import { ex, newFinish } from '../doc/sample';
import type { BasePlane, Doc, EdgeRule, Expr, Part, Profile, Step, Unit } from '../doc/types';
import type { Align } from '../doc/profiles';
import type { ToolKind } from '../viewer/sketch';
import { icon, tool } from './icons';

export interface UIContext {
  doc: Doc;
  selected: string[];
  exprErrors: Map<string, string>;
  kernelErrors: Map<string, { stepId: string; error: string }>;
  title: string;
  dirty: boolean;
  status: string;
  /** Selected shapes of the selected sketch. */
  shapes: string[];
  /** The running drawing tool. */
  tool: ToolKind | null;
  /** Replaces the hint bar text while a tool runs. */
  hint: string | null;
  autosave: boolean;
  notify(message: string): void;
  paramValue(name: string): string;
  commit(doc: Doc): void;
  /** `live`: replaces the current undo step (scrubbing). */
  setValue(path: string[], value: unknown, live?: boolean): void;
  select(id: string | null, add?: boolean): void;
  startTool(kind: ToolKind): void;
  /** Pulls the selected shapes (or all) of the selected sketch. */
  extrude(): void;
  pickShape(sketch: string, shape: string, add: boolean): void;
  /** Turns the camera to look straight at a sketch. */
  lookAt(sketch: string): void;
  /** Lines up (or spaces evenly) the selected shapes of the selected sketch. */
  align(how: Align): void;
  toggleAutosave(): void;
  duplicate(): void;
  remove(): void;
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
  $('toolbar').replaceChildren(...toolbar(ctx));
  $('custom-sections').replaceChildren(...customSections(ctx));
  $('left').replaceChildren(...left(ctx));
  $('right').replaceChildren(...right(ctx));
  $('hint').innerHTML = (ctx.hint ?? hint(ctx.selected.length, ctx.shapes.length)).replace(/\[(.+?)\]/g, '<kbd>$1</kbd>');
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

/** A one-character label (×, ⇄, ✎) makes an icon button: no outline. */
const button = (label: string, onclick: () => void, title = '') => h('button', { onclick, title, className: label.length === 1 ? 'icon' : '' }, label);

function topbar(ctx: UIContext): Node[] {
  return [
    h('strong', {}, 'MAKERMAKER'),
    tool('new', 'New', ctx.newDoc),
    tool('open', 'Open (⌘O, or drop a file)', ctx.open),
    tool('save', 'Save (⌘S)', ctx.save),
    tool('autosave', `Autosave ${ctx.autosave ? 'on' : 'off'}: saves into the file a moment after each change`, ctx.toggleAutosave, ctx.autosave),
    tool('undo', 'Undo (⌘Z)', ctx.undo),
    tool('redo', 'Redo (⇧⌘Z)', ctx.redo),
    select(
      ctx.doc.units,
      Object.fromEntries(Object.keys(UNITS).map((u) => [u, u])) as Record<Unit, string>,
      (units) => ctx.commit({ ...ctx.doc, units }),
    ),
    h('span', { className: 'title' }, ctx.title + (ctx.dirty ? ' •' : '')),
    h('span', { className: 'status' }, ctx.status),
  ];
}

/** Left of the 3D view (incase's toolbar). */
function toolbar(ctx: UIContext): Node[] {
  const shapes = [
    ['rect', 'Rectangle (R)'],
    ['circle', 'Circle (C)'],
    ['polygon', 'Polygon (P)'],
  ] as const;
  const none = !ctx.selected.length;
  const sketch = ctx.doc.sketches.some((s) => s.id === ctx.selected[0]) && ctx.selected.length === 1;
  return [
    ...shapes.map(([kind, title]) => tool(kind, `${title}: draw into a sketch, then pull it up (click or Esc keeps it flat)`, () => ctx.startTool(kind), ctx.tool === kind)),
    tool('extrude', 'Extrude (E): pull the selected shapes, or the whole selected sketch', ctx.extrude, false, !sketch),
    h('hr'),
    tool('duplicate', 'Duplicate (⌘D)', ctx.duplicate, false, none),
    tool('delete', 'Delete (Del)', ctx.remove, false, none),
  ];
}

/** Rows of the custom sections, in the section panel: on/off, name, offset, flip, delete. */
function customSections(ctx: UIContext): Node[] {
  const { doc } = ctx;
  const set = (i: number, next: Partial<(typeof doc.sections)[number]>) =>
    ctx.commit({ ...doc, sections: doc.sections.map((c, k) => (k === i ? { ...c, ...next } : c)) });
  return doc.sections.map((c, i) => {
    const on = h('input', { type: 'checkbox', checked: c.enabled, title: 'Show this section' });
    on.onchange = () => set(i, { enabled: on.checked });
    const name = input(`sections.${i}.name`, c.name, (text) => set(i, { name: text }));
    // flipping keeps the plane where it is: the offset turns with the normal
    const e = c.offset.e.trim();
    const negated = isPlain(e) ? fmt(-parseFloat(e)) : /^-\(.*\)$/.test(e) ? e.slice(2, -1) : `-(${e})`;
    const flip = button('⇄', () => set(i, { normal: c.normal.map((v) => -v) as typeof c.normal, offset: { ...c.offset, e: negated } }), 'Keep the other side');
    const drop = button('×', () => ctx.commit({ ...doc, sections: doc.sections.filter((_, k) => k !== i) }), 'Delete this section');
    return h('div', { className: 'custom' }, on, name, exprField(ctx, `sections.${i}.offset`, 'Offset'), flip, drop);
  });
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
  const sketches = doc.sketches.map((s, i) => {
    const eye = h('button', { className: 'icon', title: s.visible ? 'Hide' : 'Show', innerHTML: icon(s.visible ? 'eye' : 'eyeOff') });
    eye.onclick = () => ctx.commit(setIn(doc, ['sketches', String(i), 'visible'], !s.visible));
    const item = h('button', { className: `item${ctx.selected.includes(s.id) ? ' selected' : ''}`, onclick: (e) => ctx.select(s.id, e.shiftKey) }, s.name);
    return h('div', { className: 'listed' }, item, eye);
  });
  return [h('h3', {}, 'Parts'), ...parts, ...none, h('h3', {}, 'Sketches'), ...sketches, h('h3', {}, 'Parameters'), ...params, addParam];
}

function right(ctx: UIContext): Node[] {
  const n = ctx.selected.length;
  if (n > 1)
    return [h('p', { className: 'hint' }, `${n} parts selected: drag, nudge, duplicate or delete them together; select one to edit it.`)];
  const k = ctx.doc.sketches.findIndex((s) => s.id === ctx.selected[0]);
  if (k >= 0) return sketchPanel(ctx, k);
  const i = ctx.doc.parts.findIndex((p) => p.id === ctx.selected[0]);
  if (i < 0) return [h('p', { className: 'hint' }, 'Select a part or a sketch.')];
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

function hint(selected: number, shapes: number) {
  if (shapes)
    return 'Drag to move in the sketch plane (the direction picks the axis) · handles resize: [Alt] from the middle, [Shift] keep proportions, type a size, [Tab] other side · round handle turns ([Shift] 15°) · [E] extrude · [Del] delete';
  if (selected > 1)
    return 'Drag a part to move them all: the direction picks X, Y or Z · [Alt] free in the plane facing you · [Shift]-click adds or removes · [Ctrl] snaps · [arrows] nudge ([Shift] ×10) · [Del] delete · [⌘D] duplicate · [Esc] deselect · [⌘Z] undo';
  if (selected)
    return 'Drag to move: the direction picks X, Y or Z · [Alt] free in the plane facing you · [Ctrl] snaps · [Shift]-click selects more · [arrows] nudge ([Shift] ×10) · [Del] delete · [⌘D] duplicate · [Esc] deselect';
  return 'Drag a part to move it: the direction picks X, Y or Z · [Tab] next part under the click · [F] fit · drag to orbit, right-drag to pan, wheel to zoom · drag a field label to scrub ([Shift] fine) · [⌘Z] undo';
}

/** A sketch: its plane, visibility, and shapes (click a label to select it, Shift to add). */
function sketchPanel(ctx: UIContext, k: number): Node[] {
  const { doc } = ctx;
  const s = doc.sketches[k];
  const at = `sketches.${k}`;
  const set = (next: Partial<typeof s>) => ctx.commit(setIn(doc, ['sketches', String(k)], { ...s, ...next }));
  const p = s.plane;
  const where =
    p.kind === 'base'
      ? [select(p.axis, { xy: 'Ground (XY)', xz: 'Front (XZ)', yz: 'Right (YZ)' }, (axis) => set({ plane: { ...p, axis } })), exprField(ctx, `${at}.plane.offset`, 'Offset')]
      : [h('span', { className: 'hint' }, `On a face of ${doc.parts.find((q) => q.id === p.part)?.name ?? 'a deleted part'}`)];
  const show = h('input', { type: 'checkbox', checked: s.visible });
  show.onchange = () => set({ visible: show.checked });
  const kinds = { rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon' };
  const shapes = s.shapes.map((q, j) => {
    const name = h('button', { className: `item${ctx.shapes.includes(q.id) ? ' selected' : ''}`, onclick: (e) => ctx.pickShape(s.id, q.id, e.shiftKey) }, kinds[q.kind]);
    const drop = button('×', () => set({ shapes: s.shapes.filter((r) => r !== q) }), 'Delete this shape');
    return h('div', { className: 'shape' }, h('div', { className: 'listed' }, name, drop), h('div', { className: 'row' }, ...shapeFields(ctx, `${at}.shapes.${j}`, q)));
  });
  return [
    h(
      'div',
      { className: 'head' },
      input(`${at}.name`, s.name, (name) => set({ name })),
      button('Delete', () => {
        ctx.commit({ ...doc, sketches: doc.sketches.filter((q) => q !== s) });
        ctx.select(null);
      }),
    ),
    h('div', { className: 'row' }, ...where),
    h(
      'div',
      { className: 'row' },
      h('label', { className: 'check' }, show, 'Show'),
      tool('look', 'Look straight at the sketch', () => ctx.lookAt(s.id)),
      tool('extrude', 'Extrude (E): the selected shapes, or all', ctx.extrude),
    ),
    ...(ctx.shapes.length > 1 ? [alignRow(ctx)] : []),
    h('h3', {}, `Shapes (${s.shapes.length})`),
    ...shapes,
  ];
}

/** incase's align tools for two or more selected shapes (distribute: three or more). */
function alignRow(ctx: UIContext) {
  const aligns: [Align, string][] = [
    ['left', 'Align left'],
    ['centerX', 'Align centres horizontally'],
    ['right', 'Align right'],
    ['top', 'Align top'],
    ['centerY', 'Align centres vertically'],
    ['bottom', 'Align bottom'],
    ['distributeX', 'Space evenly horizontally'],
    ['distributeY', 'Space evenly vertically'],
  ];
  return h('div', { className: 'aligns' }, ...aligns.map(([how, title]) => tool(how, title, () => ctx.align(how), false, how.startsWith('distribute') && ctx.shapes.length < 3)));
}

/** Fields of one shape at `path`: position, size, corner radius, rotation (degrees). */
function shapeFields(ctx: UIContext, path: string, p: Profile): HTMLElement[] {
  const pf = (key: string, label: string) => exprField(ctx, `${path}.${key}`, label);
  if (p.kind === 'circle') return [pf('x', 'X'), pf('y', 'Y'), pf('d', 'Ø')];
  const rot = exprField(ctx, `${path}.rot`, '°', true); // degrees: shown as typed, never unit-converted
  if (p.kind === 'rect') return [pf('x', 'X'), pf('y', 'Y'), pf('w', 'W'), pf('h', 'H'), pf('r', 'R'), rot];
  return [h('span', { className: 'hint' }, `${p.pts.length} corners`), pf('r', 'R'), rot];
}

function stepCard(ctx: UIContext, part: Part, step: Step, at: string, setPart: (p: Part) => void) {
  const setStep = (next: Step) => setPart({ ...part, steps: part.steps.map((s) => (s === step ? next : s)) });
  const remove = button('×', () => setPart({ ...part, steps: part.steps.filter((s) => s !== step) }), 'Remove');
  const f = (key: string, label: string) => exprField(ctx, `${at}.${key}`, label);

  switch (step.type) {
    case 'extrude': {
      const extrudes = part.steps.filter((t) => t.type === 'extrude');
      const name = (t: (typeof extrudes)[number]) => `Extrude ${extrudes.indexOf(t) + 1}`;
      const mode = select(step.mode, { add: 'Add', cut: 'Cut' }, (m) => setStep({ ...step, mode: m, through: m === 'cut' && step.through }));
      const through = h('input', { type: 'checkbox', checked: step.through });
      through.onchange = () => setStep({ ...step, through: through.checked });
      const reach = [
        ...(step.through ? [] : [f('depth', 'Depth')]),
        ...(step.mode === 'cut' ? [h('label', { className: 'check' }, through, 'Through')] : []),
      ];
      const src = step.source;
      if (src.kind === 'sketch') {
        const sketch = ctx.doc.sketches.find((k) => k.id === src.sketch);
        const from = sketch ? `${sketch.name}: ${src.shapes.length} of ${sketch.shapes.length} shapes` : 'its sketch was deleted';
        return h('section', {}, h('h4', {}, name(step), mode, remove), h('p', { className: 'hint' }, `Linked to ${from}`), h('div', { className: 'row' }, ...reach));
      }
      const planes: Record<string, string> = { xy: 'Ground (XY)', xz: 'Front (XZ)', yz: 'Right (YZ)' };
      for (const t of extrudes.slice(0, extrudes.indexOf(step))) if (!t.through) planes[`cap:${t.id}`] = `On top of ${name(t)}`;
      const value = src.plane.kind === 'base' ? src.plane.axis : `cap:${src.plane.step}`;
      planes[value] ??= 'Lost face';
      const offset = src.plane.kind === 'base' ? src.plane.offset : ex(0, ctx.doc.units);
      const setSource = (next: Partial<typeof src>) => setStep({ ...step, source: { ...src, ...next } });
      const plane = select(value, planes, (v) =>
        setSource({ plane: v.startsWith('cap:') ? { kind: 'cap', step: v.slice(4) } : { kind: 'base', axis: v as BasePlane, offset } }),
      );
      const profiles = src.profiles.map((p, k) => {
        const drop = button('×', () => setSource({ profiles: src.profiles.filter((q) => q !== p) }), 'Remove this shape');
        return h('div', { className: 'row profile' }, ...shapeFields(ctx, `${at}.source.profiles.${k}`, p), ...(src.profiles.length > 1 ? [drop] : []));
      });
      return h(
        'section',
        {},
        h('h4', {}, name(step), mode, remove),
        h('div', { className: 'row' }, plane, ...(src.plane.kind === 'base' ? [f('source.plane.offset', 'Offset')] : [])),
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
