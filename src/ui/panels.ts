import { displayText, fmt, isPlain, UNITS } from '../doc/expr';
import { getIn, setIn } from '../doc/resolve';
import { ex, newFinish } from '../doc/sample';
import { tree, type Row } from '../doc/groups';
import type { BasePlane, Body, BooleanOp, Doc, EdgeRule, Expr, Feature, Group, Profile, Unit } from '../doc/types';
import type { Align } from '../doc/profiles';
import type { ToolKind } from '../viewer/sketch';
import { icon, tool } from './icons';

export interface UIContext {
  doc: Doc;
  selected: string[];
  exprErrors: Map<string, string>;
  kernelErrors: Map<string, { featureId: string; error: string }>;
  title: string;
  dirty: boolean;
  status: string;
  /** Selected shapes of the selected sketch. */
  shapes: string[];
  /** The active tool, as named in the toolbar (a shape kind, 'extrude', 'sketch', 'boolean', ...). */
  active: string | null;
  /** Replaces the hint bar text while a tool runs. */
  hint: string | null;
  autosave: boolean;
  notify(message: string): void;
  paramValue(name: string): string;
  commit(doc: Doc): void;
  /** `live`: replaces the current undo step (scrubbing). */
  setValue(path: string[], value: unknown, live?: boolean): void;
  /** `how`: true toggles the object, 'range' selects from the last selected one in its list to it. */
  select(id: string | null, how?: Pick): void;
  /** Object list rows switched from how they start: groups folded, bodies unfolded (showing their sketches). */
  toggled: Set<string>;
  toggleFold(id: string): void;
  /** Puts objects into a group (null: the top level). */
  moveInto(ids: string[], group: string | null): void;
  /** A new group around the selection. */
  group(): void;
  /** The body shown alone (its eye was Ctrl-clicked), if any. */
  isolated: string | null;
  /** Shows only this body; again (or for the isolated body) shows what was shown before. */
  isolate(id: string): void;
  /** Shows a body in a colour without changing the document (while the colour picker is open). */
  previewColor(id: string, color: string): void;
  startTool(kind: ToolKind): void;
  /** Pulls the selected shapes (or all) of the selected sketch. */
  extrude(): void;
  /** The sketch in sketch mode. */
  sketching: string | null;
  /** Pick a plane for a new sketch, enter sketch mode on a sketch, leave it, stop the sketch tool. */
  newSketch(): void;
  editSketch(sketch: string): void;
  exitSketch(): void;
  stopTool(): void;
  pickShape(sketch: string, shape: string, how: Pick): void;
  /** Turns the camera to look straight at a sketch. */
  lookAt(sketch: string): void;
  /** Lines up (or spaces evenly) the selected shapes of the selected sketch. */
  align(how: Align): void;
  /** Joins, cuts or intersects the selected bodies: the first keeps the result. */
  boolean(op: BooleanOp): void;
  toggleAutosave(): void;
  toggleTheme(): void;
  /** Downloads STL files of the selected (else shown) bodies. */
  exportPrint(): void;
  /** Downloads the view as a PNG; nice: path traced. */
  renderImage(): void;
  renderNice(): void;
  /** Reference point of a shape's fields (-1, 0, 1 per own axis): X / Y measure it, sizes and turns keep it. */
  shapeRef(shape: string): [number, number];
  setShapeRef(shape: string, ref: [number, number]): void;
  /** The shape's width and height change together. */
  linkSize(shape: string): boolean;
  toggleLinkSize(shape: string): void;
  /** The shape at `path`: its reference point and own size (mm); `centred`: the reference point is its stored centre. */
  measure(path: string[]): { x: number; y: number; w: number; h: number; centred: boolean };
  transformShape(path: string[], field: ShapeField, value: Expr, live: boolean): void;
  duplicate(): void;
  remove(): void;
  newDoc(): void;
  open(): void;
  save(): void;
  undo(): void;
  redo(): void;
}

const $ = (id: string) => document.getElementById(id)!;

export type Pick = boolean | 'range';
export type ShapeField = 'x' | 'y' | 'w' | 'h' | 'd' | 'rot';

/** A list click as in file lists: Shift a range, ⌘ / Ctrl toggles. Ctrl-click on macOS (a context menu click) toggles too. */
function listItem(className: string, pick: (how: Pick) => void, ...children: (Node | string)[]) {
  return h('button', {
    className,
    onclick: (e) => pick(e.shiftKey ? 'range' : e.metaKey || e.ctrlKey),
    oncontextmenu: (e) => (e.preventDefault(), pick(true)),
  }, ...children);
}

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
  $('hint').innerHTML = (ctx.hint ?? (ctx.sketching ? SKETCH_HINT : hint(ctx.selected.length, ctx.shapes.length))).replace(/\[(.+?)\]/g, '<kbd>$1</kbd>');
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

/**
 * Expression input for the value at `path`; dragging the label of a number scrubs it (Shift: fine). `own`: a value
 * that is not stored as it is shown (path only names the field), with its setter and error.
 */
function exprField(ctx: UIContext, path: string, label: string, raw = false, own?: { value: Expr; set: (x: Expr, live: boolean) => void; error?: string }) {
  const keys = path.split('.');
  const x = own?.value ?? (getIn(ctx.doc, keys) as Expr);
  const set = own?.set ?? ((v: Expr, live: boolean) => ctx.setValue(keys, v, live));
  const u = ctx.doc.units;
  const shown = raw ? x.e : displayText(x, u);
  const el = input(path, shown, (e) => set({ e, u }, false), own ? own.error : ctx.exprErrors.get(path));
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
        set({ e: text, u }, last !== shown);
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

/** GitHub's mark (Octicons, MIT). */
const GITHUB =
  '<svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

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
    tool('print', 'Export for 3D print: one STL per selected body (else all shown ones), as placed in the world; several come zipped', ctx.exportPrint),
    tool('render', 'Snapshot: the bodies as a PNG with a transparent background, twice the screen resolution (no grid, sketches or selection)', ctx.renderImage),
    tool('renderNice', 'Render nice: path traced (soft light, shadows), twice the screen resolution; takes a while, Esc cancels', ctx.renderNice),
    tool('theme', 'Light / dark', ctx.toggleTheme),
    h('a', { className: 'link', href: 'https://github.com/falue/makermaker', target: '_blank', rel: 'noopener', title: 'Source code on GitHub', innerHTML: GITHUB }),
    h('a', { className: 'link', href: 'https://buymeacoffee.com/falue', target: '_blank', rel: 'noopener', title: 'Support MAKERMAKER' }, '☕ Buy me a coffee'),
  ];
}

/** Left of the 3D view (incase's toolbar). */
function toolbar(ctx: UIContext): Node[] {
  const shapes = [
    ['rect', 'Rectangle (R)'],
    ['circle', 'Circle (C)'],
    ['ngon', 'Regular polygon (N)'],
    ['polygon', 'Polygon (P)'],
  ] as const;
  const on = (name: string) => ctx.active === name;
  if (ctx.sketching)
    return [
      tool('select', 'Select and edit shapes (Esc stops sketching)', ctx.stopTool, !ctx.active),
      ...shapes.map(([kind, title]) => tool(kind, `${title}: draw into the sketch`, () => ctx.startTool(kind), on(kind))),
      h('hr'),
      tool('extrude', 'Extrude (E): pull the selected shapes, or the whole sketch', ctx.extrude, on('extrude')),
      tool('finish', 'Leave the sketch (Esc)', ctx.exitSketch),
    ];
  return [
    tool('sketch', 'New sketch (S): click a face or empty space, or a face first, then this; then draw shapes on it', ctx.newSketch, on('sketch')),
    ...shapes.map(([kind, title]) => tool(kind, `${title}: draw one and pull it up (a click or Esc keeps it flat and starts sketching)`, () => ctx.startTool(kind), on(kind))),
    tool('sphere', 'Sphere (O): drag from its centre on a face or the ground', () => ctx.startTool('sphere'), on('sphere')),
    tool('extrude', 'Extrude (E): pull the selected shapes or the whole selected sketch; else push or pull a face (clicked before or after)', ctx.extrude, on('extrude')),
    h(
      'div',
      { className: 'flyout-at' },
      tool('boolean', 'Boolean: join, cut or intersect bodies (selected before or clicked after; the first keeps the result)', () => {
        flyout = !flyout;
        renderUI(ctx);
      }, flyout || on('boolean')),
      ...(flyout ? [h('div', { className: 'flyout' }, ...booleanTools(ctx, () => (flyout = false)))] : []),
    ),
    h('hr'),
    tool('duplicate', 'Duplicate (⌘D): the selection, or the body clicked next', ctx.duplicate, on('duplicate')),
    tool('delete', 'Delete (Del): the selection, or the body clicked next', ctx.remove, on('delete')),
  ];
}

/** The boolean flyout of the toolbar is open. */
let flyout = false;

function booleanTools(ctx: UIContext, picked = () => {}) {
  const ops: [BooleanOp, string][] = [
    ['union', 'Join: one body from all of them'],
    ['subtract', 'Cut: the others cut the first'],
    ['intersect', 'Intersect: only where all of them overlap'],
  ];
  return ops.map(([op, title]) => tool(op, title, () => (picked(), ctx.boolean(op))));
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
  // while a body is isolated the others grey out; their eyes still show or hide them
  const dimmed = (id: string) => (ctx.isolated && ctx.isolated !== id ? ' dimmed' : '');
  const eye = (path: string[], on: boolean) =>
    h('button', { className: 'icon', title: on ? 'Hide' : 'Show', innerHTML: icon(on ? 'eye' : 'eyeOff'), onclick: () => ctx.commit(setIn(doc, path, !on)) });
  // rows can be dragged (with the rest of the selection) onto a group, or onto the header for the top level
  const dragged = (id: string) => (ctx.selected.includes(id) ? ctx.selected : [id]);
  const dropOn = (el: HTMLElement, group: string | null) => {
    el.ondragover = (e) => (e.preventDefault(), el.classList.add('drop'));
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => {
      e.preventDefault();
      ctx.moveInto(JSON.parse(e.dataTransfer!.getData('text/plain')), group);
    };
  };
  const row = (id: string, depth: number, ...cells: HTMLElement[]) => {
    const el = h('div', { className: `listed${dimmed(id)}`, draggable: true }, ...cells);
    el.style.paddingLeft = `${depth * 14}px`;
    el.ondragstart = (e) => e.dataTransfer!.setData('text/plain', JSON.stringify(dragged(id)));
    return el;
  };
  const fold = ({ id, open }: Row) => (open === undefined ? h('span', { className: 'fold-space' }) : button(open ? '▾' : '▸', () => ctx.toggleFold(id), open ? 'Fold' : 'Unfold'));
  const selectedClass = (id: string) => `item${ctx.selected.includes(id) ? ' selected' : ''}`;
  const rows = tree(doc, ctx.toggled).map((r) => {
    const { id, kind, depth } = r;
    if (kind === 'group') {
      const i = doc.groups.findIndex((g) => g.id === id);
      const g = doc.groups[i];
      const el = row(id, depth, fold(r), listItem(`${selectedClass(id)} group`, (how) => ctx.select(id, how), g.name), button('⚙', () => ctx.select(id), 'Group settings: name, origin'), eye(['groups', String(i), 'visible'], g.visible));
      dropOn(el, id);
      return el;
    }
    if (kind === 'sketch') {
      const i = doc.sketches.findIndex((q) => q.id === id);
      const sk = doc.sketches[i];
      return row(id, depth, fold(r), listItem(selectedClass(id), (how) => ctx.select(id, how), h('span', { className: 'kind', innerHTML: icon('sketch') }), sk.name), eye(['sketches', String(i), 'visible'], sk.visible));
    }
    const i = doc.bodies.findIndex((q) => q.id === id);
    const p = doc.bodies[i];
    const swatch = h('span', { className: 'swatch' });
    swatch.style.background = p.color;
    const look = eye(['bodies', String(i), 'visible'], p.visible);
    look.title += ' (Ctrl-click: show only this body)';
    // Ctrl-click on macOS is a context menu click: both isolate
    const isolate = (e: MouseEvent) => (e.preventDefault(), ctx.isolate(p.id));
    look.oncontextmenu = isolate;
    look.onclick = (e) => (e.ctrlKey || e.metaKey || ctx.isolated === p.id ? isolate(e) : ctx.commit(setIn(doc, ['bodies', String(i), 'visible'], !p.visible)));
    if (ctx.isolated === p.id) Object.assign(look, { className: 'icon isolated', title: 'Shown alone: click to show the others again', innerHTML: icon('isolate') });
    return row(id, depth, fold(r), listItem(selectedClass(id), (how) => ctx.select(id, how), swatch, p.name), look);
  });
  const head = h('div', { className: 'tree-head' }, h('h3', {}, 'Objects'), button('+ Group', ctx.group, 'New group (⌘G): around the selected objects, or empty'));
  dropOn(head, null);
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

  const none = doc.bodies.length ? [] : [h('p', { className: 'hint' }, 'Draw a shape (R, C, P) to start a body.')];
  return [head, ...rows, ...none, h('h3', {}, 'Parameters'), ...params, addParam];
}

function right(ctx: UIContext): Node[] {
  const n = ctx.selected.length;
  if (n > 1)
    return [
      h('p', { className: 'hint' }, `${n} bodies selected: drag, nudge, duplicate or delete them together; select one to edit it.`),
      h('h3', {}, 'Boolean'),
      h('p', { className: 'hint' }, 'The first selected body keeps the result; the others become its tool bodies: they move with it and stay editable (cutters show as red outlines).'),
      h('div', { className: 'aligns' }, ...booleanTools(ctx)),
    ];
  const k = ctx.doc.sketches.findIndex((s) => s.id === ctx.selected[0]);
  if (k >= 0) return sketchPanel(ctx, k);
  const gi = ctx.doc.groups.findIndex((g) => g.id === ctx.selected[0]);
  if (gi >= 0) return groupPanel(ctx, gi);
  const i = ctx.doc.bodies.findIndex((p) => p.id === ctx.selected[0]);
  if (i < 0) return [h('p', { className: 'hint' }, 'Select a body or a sketch.')];
  const body = ctx.doc.bodies[i];
  const at = `bodies.${i}`;
  const setBody = (next: Body) => ctx.commit(setIn(ctx.doc, ['bodies', String(i)], next));
  const failure = ctx.kernelErrors.get(body.id);

  return [
    h(
      'div',
      { className: 'head' },
      input(`${at}.name`, body.name, (name) => setBody({ ...body, name })),
      h('input', {
        type: 'color',
        value: body.color,
        title: 'Colour',
        className: 'color',
        // the panel is not rebuilt while picking: that would close the picker
        oninput: (e) => ctx.previewColor(body.id, (e.target as HTMLInputElement).value),
        onchange: (e) => setBody({ ...body, color: (e.target as HTMLInputElement).value }),
      }),
      button('Delete', ctx.remove, 'Delete the body (with its cutters)'),
    ),
    h('h3', {}, 'Position'),
    h('div', { className: 'row' }, ...['X', 'Y', 'Z'].map((l, k) => exprField(ctx, `${at}.position.${k}`, l))),
    ...body.features.map((feature, j) => {
      const card = featureCard(ctx, body, feature, `${at}.features.${j}`, setBody);
      if (failure && (failure.featureId === feature.id || (!failure.featureId && j === 0)))
        card.append(h('p', { className: 'error' }, failure.error));
      return card;
    }),
    h(
      'div',
      { className: 'row' },
      button('+ Fillet', () => setBody({ ...body, features: [...body.features, newFinish(ctx.doc.units)] })),
    ),
  ];
}

/** A group: name, delete (with its contents), and its origin: the parent's, or a custom point its contents count from. */
function groupPanel(ctx: UIContext, i: number): Node[] {
  const g = ctx.doc.groups[i];
  const set = (next: Partial<Group>) => ctx.commit(setIn(ctx.doc, ['groups', String(i)], { ...g, ...next }));
  const u = ctx.doc.units;
  const origin = select(g.origin.kind, { parent: "Parent's origin", custom: 'Custom origin' }, (kind) =>
    set({ origin: kind === 'custom' ? { kind, position: [ex(0, u), ex(0, u), ex(0, u)], rotation: { rx: ex(0), ry: ex(0), rz: ex(0) } } : { kind } }),
  );
  return [
    h('div', { className: 'head' }, input(`groups.${i}.name`, g.name, (name) => set({ name })), button('Delete', ctx.remove, 'Delete the group with everything in it')),
    h('h3', {}, 'Origin'),
    h('div', { className: 'row' }, origin),
    ...(g.origin.kind === 'custom'
      ? [
          h('div', { className: 'row' }, ...['X', 'Y', 'Z'].map((l, k) => exprField(ctx, `groups.${i}.origin.position.${k}`, l))),
          // degrees: shown as typed, never unit-converted
          h('div', { className: 'row' }, ...(['rx', 'ry', 'rz'] as const).map((k) => exprField(ctx, `groups.${i}.origin.rotation.${k}`, `${k[1].toUpperCase()}°`, true))),
          h('p', { className: 'hint' }, 'Its contents count from this point and turn with it (degrees around X, then Y, then Z); inside, they are edited unturned.'),
        ]
      : [h('p', { className: 'hint' }, "Its contents count from the parent's origin.")]),
  ];
}

const SKETCH_HINT =
  'Sketch: [R] [C] [P] draw shapes (they stay flat) · click a shape to select it, drag to move, handles resize and turn · right-drag turns the view · [E] extrude · [Esc] or ✓ leaves';

function hint(selected: number, shapes: number) {
  if (shapes)
    return 'Drag to move in the sketch plane (the direction picks the axis) · handles resize: [Alt] from the middle, [Shift] keep proportions, type a size, [Tab] other side · round handle turns ([Shift] 15°) · [E] extrude · [Del] delete';
  if (selected > 1)
    return 'Drag a body to move them all: the direction picks X, Y or Z · [Alt] free in the plane facing you · [Shift] / [⌘]-click adds or removes · [Ctrl] snaps · [arrows] nudge ([Shift] ×10) · [Del] delete · [⌘D] duplicate · [Esc] deselect · [⌘Z] undo';
  if (selected)
    return 'Drag to move: the direction picks X, Y or Z · [Alt] free in the plane facing you · [Ctrl] snaps · [Shift] / [⌘]-click selects more · [arrows] nudge ([Shift] ×10) · [Del] delete · [⌘D] duplicate · [Esc] deselect';
  return 'Drag a body to move it: the direction picks X, Y or Z · [Tab] next body under the click · [F] fit · drag to orbit, right-drag to pan, wheel to zoom · drag a field label to scrub ([Shift] fine) · [⌘Z] undo';
}

/** A sketch: its plane, visibility, and shapes (click a label to select it, ⌘ / Ctrl toggles, Shift a range). */
function sketchPanel(ctx: UIContext, k: number): Node[] {
  const { doc } = ctx;
  const s = doc.sketches[k];
  const at = `sketches.${k}`;
  const set = (next: Partial<typeof s>) => ctx.commit(setIn(doc, ['sketches', String(k)], { ...s, ...next }));
  const p = s.plane;
  const where =
    p.kind === 'base'
      ? [select(p.axis, { xy: 'Ground (XY)', xz: 'Front (XZ)', yz: 'Right (YZ)' }, (axis) => set({ plane: { ...p, axis } })), exprField(ctx, `${at}.plane.offset`, 'Offset')]
      : [h('span', { className: 'hint' }, p.kind === 'plane' ? 'On a fixed plane (where a face was)' : `On a face of ${doc.bodies.find((q) => q.id === p.body)?.name ?? 'a deleted body'}`)];
  const show = h('input', { type: 'checkbox', checked: s.visible });
  show.onchange = () => set({ visible: show.checked });
  const kinds = { rect: 'Rectangle', circle: 'Circle', ngon: 'Regular polygon', polygon: 'Polygon' };
  // in sketch mode with shapes selected, only those show
  const only = ctx.sketching === s.id && ctx.shapes.length > 0;
  const shapes = s.shapes.flatMap((q, j) => {
    if (only && !ctx.shapes.includes(q.id)) return [];
    const name = listItem(`item${ctx.shapes.includes(q.id) ? ' selected' : ''}`, (how) => ctx.pickShape(s.id, q.id, how), kinds[q.kind]);
    const drop = button('×', () => set({ shapes: s.shapes.filter((r) => r !== q) }), 'Delete this shape');
    const box = h('input', { type: 'checkbox', checked: !!q.help });
    box.onchange = () => set({ shapes: s.shapes.map((r) => (r === q ? { ...r, help: box.checked } : r)) });
    const help = h('label', { className: 'check', title: 'Help line: dashed, snapped to, never extruded' }, box, 'Help');
    return [h('div', { className: 'shape' }, h('div', { className: 'listed' }, name, help, drop), ...shapeFields(ctx, `${at}.shapes.${j}`, q))];
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
      ...(ctx.sketching === s.id ? [] : [h('button', { onclick: () => ctx.editSketch(s.id), title: 'Draw more shapes into this sketch' }, 'Draw')]),
      tool('look', 'Look straight at the sketch', () => ctx.lookAt(s.id)),
      tool('extrude', 'Extrude (E): the selected shapes, or all', ctx.extrude),
    ),
    ...(ctx.shapes.length > 1 ? [alignRow(ctx)] : []),
    h('h3', {}, only ? `Selected shapes (${shapes.length} of ${s.shapes.length})` : `Shapes (${s.shapes.length})`),
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

/**
 * Fields of one shape at `path`, as in Illustrator's transform panel: X / Y of the reference point, size and turn
 * (degrees) around it, corner radius. Stored values show their expressions; measured ones show numbers.
 */
function shapeFields(ctx: UIContext, path: string, p: Profile): HTMLElement[] {
  const keys = path.split('.');
  const m = ctx.measure(keys);
  const u = ctx.doc.units;
  const stored = (k: string) => (p as unknown as Record<string, Expr>)[k];
  const mm = (v: number): Expr => ({ e: fmt(v / UNITS[u]), u });
  const tf = (field: ShapeField, label: string, value: Expr, raw = false) =>
    exprField(ctx, `${path}.@${field}`, label, raw, { value, set: (x, live) => ctx.transformShape(keys, field, x, live), error: ctx.exprErrors.get(`${path}.${field}`) });
  const pf = (key: string, label: string, raw = false) => exprField(ctx, `${path}.${key}`, label, raw);
  const row = (...cells: HTMLElement[]) => h('div', { className: 'row' }, ...cells);
  const pos = [refGrid(ctx, p.id), tf('x', 'X', m.centred ? stored('x') : mm(m.x)), tf('y', 'Y', m.centred ? stored('y') : mm(m.y))];
  if (p.kind === 'circle') return [row(...pos, tf('d', 'Ø', stored('d')))];
  const rot = tf('rot', '°', stored('rot'), true); // degrees: shown as typed, never unit-converted
  if (p.kind === 'ngon') return [row(...pos, rot), row(tf('d', 'Ø', stored('d')), pf('sides', 'Sides', true))];
  const link = tool('link', ctx.linkSize(p.id) ? 'Width and height change together: click to unlink' : 'Link width and height: they change together', () => ctx.toggleLinkSize(p.id), ctx.linkSize(p.id));
  const [w, hh] = p.kind === 'rect' ? [stored('w'), stored('h')] : [mm(m.w), mm(m.h)];
  return [row(...pos, rot), row(tf('w', 'W', w), link, tf('h', 'H', hh), pf('r', 'R'))];
}

/** Illustrator's reference point locator for one shape: which point of its box X / Y give, and which point stays when sizing or turning. */
function refGrid(ctx: UIContext, shape: string) {
  const [rx, ry] = ctx.shapeRef(shape);
  const cells = [1, 0, -1].flatMap((sy) => [-1, 0, 1].map((sx) => h('button', { className: `cell${rx === sx && ry === sy ? ' on' : ''}`, onclick: () => ctx.setShapeRef(shape, [sx, sy]) })));
  return h('div', { className: 'ref-grid', title: 'Reference point: X / Y measure it; changing size or turn keeps it in place' }, ...cells);
}

function featureCard(ctx: UIContext, body: Body, feature: Feature, at: string, setBody: (p: Body) => void) {
  const setFeature = (next: Feature) => setBody({ ...body, features: body.features.map((s) => (s === feature ? next : s)) });
  const remove = button('×', () => setBody({ ...body, features: body.features.filter((s) => s !== feature) }), 'Remove');
  const f = (key: string, label: string) => exprField(ctx, `${at}.${key}`, label);

  switch (feature.type) {
    case 'extrude': {
      const extrudes = body.features.filter((t) => t.type === 'extrude');
      const name = (t: (typeof extrudes)[number]) => `Extrude ${extrudes.indexOf(t) + 1}`;
      const mode = select(feature.mode, { add: 'Add', cut: 'Cut' }, (m) => setFeature({ ...feature, mode: m, through: m === 'cut' && feature.through }));
      const through = h('input', { type: 'checkbox', checked: feature.through });
      through.onchange = () => setFeature({ ...feature, through: through.checked });
      const reach = [
        ...(feature.through ? [] : [f('depth', 'Depth')]),
        ...(feature.mode === 'cut' ? [h('label', { className: 'check' }, through, 'Through')] : []),
      ];
      const src = feature.source;
      if (src.kind === 'sketch') {
        const sketch = ctx.doc.sketches.find((k) => k.id === src.sketch);
        const shapes = sketch ? src.shapes.flatMap((id) => sketch.shapes.filter((q) => q.id === id)) : [];
        // unlinking copies the shapes and the plane into the feature: the sketch no longer changes the body
        // (only planes a feature can hold: a base plane or this body's own end face)
        const p = sketch?.plane;
        const plane = p?.kind === 'base' ? p : p?.kind === 'cap' && p.body === body.id ? ({ kind: 'cap', feature: p.feature } as const) : null;
        const unlink = () => plane && setFeature({ ...feature, source: { kind: 'own', plane, profiles: structuredClone(shapes), areas: src.areas } });
        const link = sketch
          ? [
              h('button', { className: 'item', onclick: () => ctx.select(sketch.id), title: 'Select the sketch' }, `${sketch.name}: ${src.areas ? `${src.areas.length} areas` : `${shapes.length} of ${sketch.shapes.length} shapes`}`),
              ...(plane ? [tool('unlink', 'Unlink: copy the shapes into this feature, so the sketch no longer changes it', unlink)] : []),
            ]
          : [h('span', { className: 'error' }, 'its sketch was deleted')];
        return h('section', {}, h('h4', {}, name(feature), mode, remove), h('div', { className: 'listed' }, h('span', { className: 'hint' }, 'From'), ...link), h('div', { className: 'row' }, ...reach));
      }
      const planes: Record<string, string> = { xy: 'Ground (XY)', xz: 'Front (XZ)', yz: 'Right (YZ)' };
      for (const t of extrudes.slice(0, extrudes.indexOf(feature))) if (!t.through) planes[`cap:${t.id}`] = `On top of ${name(t)}`;
      const value = src.plane.kind === 'base' ? src.plane.axis : `cap:${src.plane.feature}`;
      planes[value] ??= 'Lost face';
      const offset = src.plane.kind === 'base' ? src.plane.offset : ex(0, ctx.doc.units);
      const setSource = (next: Partial<typeof src>) => setFeature({ ...feature, source: { ...src, ...next } });
      const plane = select(value, planes, (v) =>
        setSource({ plane: v.startsWith('cap:') ? { kind: 'cap', feature: v.slice(4) } : { kind: 'base', axis: v as BasePlane, offset } }),
      );
      const profiles = src.profiles.map((p, k) => {
        const drop = button('×', () => setSource({ profiles: src.profiles.filter((q) => q !== p) }), 'Remove this shape');
        return h('div', { className: 'profile' }, ...shapeFields(ctx, `${at}.source.profiles.${k}`, p), ...(src.profiles.length > 1 ? [drop] : []));
      });
      return h(
        'section',
        {},
        h('h4', {}, name(feature), mode, remove),
        h('div', { className: 'row' }, plane, ...(src.plane.kind === 'base' ? [f('source.plane.offset', 'Offset')] : [])),
        ...profiles,
        h('div', { className: 'row' }, ...reach),
      );
    }
    case 'boolean': {
      const other = ctx.doc.bodies.find((b) => b.id === feature.body);
      const op = select(feature.op, { union: 'Join', subtract: 'Cut', intersect: 'Intersect' }, (o) => setFeature({ ...feature, op: o }));
      const tool = other ? h('button', { className: 'item', onclick: () => ctx.select(other.id), title: 'Select the tool body' }, other.name) : h('span', { className: 'error' }, 'its tool body was deleted');
      // without the boolean the tool body is a body of its own again: shown
      const drop = button('×', () => ctx.commit({ ...ctx.doc, bodies: ctx.doc.bodies.map((b) => (b.id === body.id ? { ...b, features: b.features.filter((s) => s !== feature) } : b.id === feature.body ? { ...b, visible: true } : b)) }), 'Remove: the tool body becomes a body of its own');
      return h('section', {}, h('h4', {}, op, drop), h('div', { className: 'listed' }, h('span', { className: 'hint' }, 'with'), tool));
    }
    case 'sphere':
      return h('section', {}, h('h4', {}, 'Sphere', remove), h('div', { className: 'row' }, f('x', 'X'), f('y', 'Y'), f('z', 'Z'), f('d', 'Ø')));
    case 'finish': {
      const enabled = h('input', { type: 'checkbox', checked: feature.enabled, title: 'Enabled' });
      enabled.onchange = () => setFeature({ ...feature, enabled: enabled.checked });
      const mode = select(feature.mode, { fillet: 'Fillet', chamfer: 'Chamfer' }, (m) => setFeature({ ...feature, mode: m }));
      const edges = select<EdgeRule>(
        feature.edges,
        { all: 'All edges', top: 'Top edges', bottom: 'Bottom edges', vertical: 'Vertical edges' },
        (r) => setFeature({ ...feature, edges: r }),
      );
      const bake = h(
        'button',
        {
          className: `bake${feature.baked ? ' on' : ''}`,
          title: feature.baked
            ? 'Baked: stays where it is, so later cuts go through it. Click to unbake (it finishes later cuts again)'
            : 'Bake: later cuts go through it instead of being finished too',
          onclick: () => setFeature({ ...feature, baked: !feature.baked }),
        },
        feature.baked ? 'Baked' : 'Bake',
      );
      const skipped = feature.skip.length
        ? [h('div', { className: 'listed' }, h('span', { className: 'hint' }, `${feature.skip.length} edge${feature.skip.length > 1 ? 's' : ''} left out`), button('Restore', () => setFeature({ ...feature, skip: [] }), 'Finish the left-out edges again'))]
        : [];
      return h(
        'section',
        { className: `${feature.enabled ? '' : 'disabled'}${feature.baked ? ' baked' : ''}` },
        h('h4', {}, enabled, mode, bake, remove),
        h('div', { className: 'row' }, f('size', feature.mode === 'fillet' ? 'Radius' : 'Distance'), edges),
        ...skipped,
      );
    }
  }
}
