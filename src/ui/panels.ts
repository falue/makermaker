import { displayText, fmt, isPlain, UNITS } from '../doc/expr';
import { getIn, setIn } from '../doc/resolve';
import { ex, newFinish } from '../doc/sample';
import { ownerOf, sketchesOf, tree, whose, type Row } from '../doc/groups';
import { shapesIn } from '../doc/shapegroups';
import { backdropCss, twoColours } from '../viewer/sky';
import type { BasePlane, Body, BooleanOp, Doc, Expr, Feature, Group, Joint, Profile, Unit } from '../doc/types';
import type { Align } from '../doc/profiles';
import type { ToolKind } from '../viewer/sketch';
import { axisHtml } from './axes';
import { icon, tool } from './icons';
import { MAC, mod, pressed } from './keys';

export interface UIContext {
  doc: Doc;
  selected: string[];
  exprErrors: Map<string, string>;
  kernelErrors: Map<string, { featureId: string; error: string }>;
  title: string;
  dirty: boolean;
  status: string;
  /** STEP files the kernel reads now. */
  busy: string[];
  /** Selected shapes of the selected sketch. */
  shapes: string[];
  /** The active tool, as named in the toolbar (a shape kind, 'extrude', 'sketch', 'boolean', ...). */
  active: string | null;
  /** Replaces the hint bar text while a tool runs. */
  hint: string | null;
  autosave: boolean;
  /** A refusal in the top bar, in red. */
  notify(message: string): void;
  statusError: boolean;
  /** The smallest step values move in (mm; Settings → General). */
  minStep: number;
  /** Measurements of the selection, for the info panel (null: nothing to measure). */
  info: { title: string; rows: [string, string, Measure?][] } | null;
  /** Shows a measure of the selection in the view: one box side (axis 0 / 1 / 2) or its position ('at'); null: none. */
  showMeasure(what: Measure | null): void;
  /** In sketch mode: bodies shown fully (their eye switched them back); the others are see-through. */
  solid: Set<string>;
  setSolid(ids: string[], on: boolean): void;
  paramValue(name: string): string;
  commit(doc: Doc): void;
  /** `live`: replaces the current undo step (scrubbing). */
  setValue(path: string[], value: unknown, live?: boolean): void;
  /** `how`: true toggles the object, 'range' selects from the last selected one in its list to it. */
  select(id: string | null, how?: Pick): void;
  /** New sketch objects are drawn as construction lines or not, as the last object switched. */
  setDrawConstruction(on: boolean): void;
  /** Folded groups in the object list, and folded lists (`list:objects`, `list:sketches`, `list:params`). */
  folded: Set<string>;
  /** All bodies or all sketches hidden for now, their eyes kept. */
  hideAll: { objects: boolean; sketches: boolean };
  toggleHideAll(list: 'objects' | 'sketches'): void;
  toggleFold(group: string): void;
  /** Puts objects into a group (null: the top level). */
  moveInto(ids: string[], group: string | null): void;
  /** Groups the selection, or ungroups a selected group (nothing selected: waits for clicked objects). */
  groupTool(): void;
  /** M: the move fields for X, Y and Z (nothing selected: click what moves first). */
  moveTool(): void;
  /** Cut a body in two (see `cutTool` in main). */
  cutTool(): void;
  revolveTool(): void;
  sweepTool(): void;
  offsetTool(): void;
  rotateTool(): void;
  /** Aligns the selected objects (bodies, groups as one, whole sketches) by their boxes; see `alignObjects` in main. */
  alignObjects(how: ObjectAlign): void;
  jointTool(): void;
  /** Lights a joint's moving objects (null: the selection again). */
  showJoint(joint: string | null): void;
  /**
   * To object for the value at `path`: the next click's value (in the display unit) is handed to `insert`, to go into
   * the field where the cursor is; false: that value has none.
   */
  reach(path: string[], insert: (text: string) => void): boolean;
  /** A joint's edit panel (the one it was made in). */
  editJoint(joint: string): void;
  /** A joint's range in words: `0–110°`, `0–35 mm`. */
  jointRange(joint: Joint): string;
  loftTool(): void;
  /** Whether a group is selected (the group tool then ungroups). */
  groupSelected: boolean;
  /** Moves objects before or after another one (into its group), or into a group. */
  arrange(ids: string[], target: string, where: 'before' | 'after' | 'into'): void;
  /** The body shown alone (its eye was ⌘ / Ctrl-clicked), if any. */
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
  /** Sketch mode on the sketch (selected), looking at its plane. */
  editSketch(sketch: string): void;
  exitSketch(): void;
  stopTool(): void;
  pickShape(sketch: string, shape: string, how: Pick): void;
  /** Shapes of a sketch group picked together (a sub-group's row); `how` as for one shape. */
  pickShapes(sketch: string, ids: string[], how: Pick): void;
  /** Turns the camera to look straight at a sketch. */
  lookAt(sketch: string): void;
  /** Lines up (or spaces evenly) the selected shapes of the selected sketch. */
  align(how: Align): void;
  /** Joins, cuts or intersects the selected bodies: the first keeps the result. */
  boolean(op: BooleanOp): void;
  toggleAutosave(): void;
  toggleTheme(): void;
  /** Imports a mesh file (OBJ) as a body. */
  importFile(): void;
  /** Downloads STL files (3D print) or SVG outlines (laser) of the selected (else shown) bodies. */
  exportPrint(): void;
  exportLaser(): void;
  /** Snapshot: downloads the view as a PNG (and keeps it in the renders). */
  renderImage(): void;
  openSettings(): void;
  /** Nice renders: the panel (open: it replaces the right column), this session's jobs, and what can be done. */
  renders: {
    open: boolean;
    jobs: Map<string, RenderJob>;
    toggle(): void;
    /** Renders the view now (a thumbnail at once, the picture when its turn comes). */
    shoot(): void;
    again(id: string): void;
    cancel(id: string): void;
    download(id: string): void;
    useView(id: string): void;
  };
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
/** What an info row shows in the view while hovered: a box side along an axis, or the position. */
export type Measure = 0 | 1 | 2 | 'at';

/** A nice render in this session: waiting, rendering (on `canvas`, `done` 0..1), done (`image`, `url`) or failed. */
export interface RenderJob {
  state: 'waiting' | 'rendering' | 'done' | 'failed';
  done: number;
  canvas?: HTMLCanvasElement;
  image?: Blob;
  url?: string;
  error?: string;
  cancel?: boolean;
  /** Rendered again: saves itself when done. */
  again?: boolean;
}
export type ShapeField = 'x' | 'y' | 'w' | 'h' | 'd' | 'rot';

/** A list click as in file lists: Shift a range, ⌘ / Ctrl toggles. Ctrl-click on macOS (a context menu click) toggles too. */
/** A boolean's tool body freed: the booleans using it go, and it shows as a normal body again. */
const freed = (doc: Doc, tool: string): Doc => ({
  ...doc,
  bodies: doc.bodies.map((b) => (b.id === tool ? { ...b, visible: true } : { ...b, features: b.features.filter((f) => f.type !== 'boolean' || f.body !== tool) })),
});

/** The last eye clicked (its list and row) and what it switched to: a Shift-click on another eye applies that to the rows between. */
let lastEye: { list: 'objects' | 'sketches' | 'solid'; id: string; on: boolean } | null = null;

/** The list row whose name is edited in place (its id). */
let renaming: string | null = null;

/** A list row's button; while its name is edited, a plain box (an input cannot sit in a button). */
function listItem(id: string, className: string, pick: (how: Pick) => void, ...children: (Node | string)[]) {
  if (renaming === id) return h('div', { className }, ...children);
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

/**
 * A press that takes the focus from a field holds rebuilding the panels until it ends: the field saves on blur, and a
 * rebuild in between would replace the button under the pointer, so the click would not count.
 */
let holding = false;
/** The rebuild held back (a rebuild by the click itself makes it unneeded). */
let waiting: UIContext | null = null;
addEventListener('pointerdown', (e) => (holding = document.activeElement instanceof HTMLInputElement && e.target !== document.activeElement), { capture: true });
const release = () => {
  if (!holding) return;
  holding = false;
  setTimeout(() => waiting && renderUI(waiting)); // after the click
};
addEventListener('pointerup', release, { capture: true });
addEventListener('pointercancel', release, { capture: true });

/** Rebuilds all panels, keeping focus and unsaved typing in the active field. */
export function renderUI(ctx: UIContext) {
  if (holding) return void (waiting = ctx);
  waiting = null;
  const active = document.activeElement as HTMLInputElement | null;
  const path = active?.dataset?.path ?? (renaming ? `list.${renaming}` : undefined); // a name just clicked gets the focus
  const typing = active?.dataset.dirty ? { value: active.value, from: active.selectionStart, to: active.selectionEnd } : null;
  rendering = true;
  $('topbar').replaceChildren(...topbar(ctx));
  $('toolbar').replaceChildren(...toolbar(ctx));
  $('custom-sections').replaceChildren(...customSections(ctx));
  $('left').replaceChildren(...left(ctx));
  $('right').replaceChildren(...right(ctx));
  $('hint').innerHTML = axisHtml(ctx.hint ?? (ctx.sketching ? SKETCH_HINT : hint(ctx.selected.length, ctx.shapes.length))).replace(/\[(.+?)\]/g, '<kbd>$1</kbd>');
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
    if (pressed(e, 'confirm')) commit();
    else if (pressed(e, 'cancel')) {
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
  el.dataset.complete = ''; // parameter names
  if (!el.title && !isPlain(x.e) && x.u !== u) el.title = `plain numbers in ${x.u}`;
  // T (To object): the clicked point's value goes in where the cursor is, to calculate on with it; Enter keeps it
  el.addEventListener('keydown', (e) => {
    if (!wantsT(e, el, ctx.doc.params)) return;
    const reaching = ctx.reach(keys, (text) => {
      const field = document.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`) ?? el;
      field.focus();
      field.setRangeText(text, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end');
    });
    if (reaching) e.preventDefault();
  });
  const name = h('span', { innerHTML: axisHtml(label) });
  scrub(name, el, () => shown, u, ctx.minStep, (e, live) => set({ e, u }, live), () => {
    // the field may be rebuilt meanwhile: the one there now
    const field = document.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`);
    field?.focus();
    field?.select();
  });
  return h('label', { className: 'field' }, name, el);
}

/**
 * Scrubbing (as in incase): dragging `label`, or the `field` while it is not focused, sideways changes its number (a
 * plain one, or with a unit, `text()` at the press; else nothing) by a step per px for its unit (Shift ×10, Ctrl
 * `minStep` mm), handing each new text to `set` (`live` after the first); a press on the field without dragging calls
 * `click` (to edit it). The pointer hides and is not stopped by the screen edge meanwhile.
 */
export function scrub(label: HTMLElement, field: HTMLInputElement, text: () => string, u: Unit, minStep: number, set: (text: string, live: boolean) => void, click: () => void) {
  // a number with an optional unit (`12`, `4mm`) keeps its unit while scrubbed; an expression is not scrubbed
  const number = (shown: string) => {
    const num = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)\s*$/i.exec(shown);
    return num && (!num[2] || num[2] in UNITS) ? num : null;
  };
  const press = (e: PointerEvent, threshold: number, onClick: () => void) => {
    const shown = text();
    const num = number(shown);
    if (!num) return; // the field takes the press as usual
    const unit = (num[2] || u) as Unit;
    e.preventDefault();
    const step = { mm: 0.5, cm: 0.05, m: 0.0005, in: 0.02, ft: 0.002 }[unit]; // per px, as in incase
    const base = parseFloat(num[1]);
    let travel: number | null = null; // px moved since scrubbing began
    let last = shown;
    // on window: the panels are rebuilt while scrubbing
    const move = (m: PointerEvent) => {
      if (travel === null) {
        if (Math.abs(m.clientX - e.clientX) <= threshold) return;
        travel = 0;
        document.body.classList.add('scrubbing');
        // the pointer hides and the screen edge no longer stops it (on body: the field is rebuilt meanwhile)
        Promise.resolve(document.body.requestPointerLock()).catch(() => {});
      } else travel += m.movementX;
      // per px: Shift ten times more, Ctrl the minimum step (Settings → General)
      const per = m.ctrlKey ? minStep / UNITS[unit] : m.shiftKey ? step * 10 : step;
      const next = fmt(base + Math.round(travel) * per) + num[2];
      if (next === last) return;
      set(next, last !== shown);
      last = next;
    };
    const end = () => {
      removeEventListener('pointermove', move);
      document.body.classList.remove('scrubbing');
      if (document.pointerLockElement === document.body) document.exitPointerLock();
      if (travel === null) onClick();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end, { once: true });
  };
  if (number(text())) label.classList.add('scrub'), field.classList.add('scrub');
  label.onpointerdown = (e) => press(e, 0, () => {});
  // in the field: drag scrubs, a click edits (once focused, the field takes text selection as usual)
  field.onpointerdown = (e) => document.activeElement !== field && press(e, 3, click);
}

function select<T extends string>(value: T, options: Record<T, string>, onChange: (v: T) => void) {
  const el = h('select', { onchange: () => onChange(el.value as T) });
  for (const [v, label] of Object.entries(options) as [T, string][]) el.append(h('option', { value: v, selected: v === value }, label));
  return el;
}

/** Whether T pressed in `input` means To object: not in the middle of a name, nor where a parameter starting with t could begin. */
export function wantsT(e: KeyboardEvent, input: HTMLInputElement, params: Record<string, unknown>) {
  if (!pressed(e, 'toObject')) return false;
  const before = input.value.slice(0, input.selectionStart ?? 0);
  const word = before.match(/[A-Za-z_]\w*$/)?.[0];
  const name = !/[\w.]$/.test(before) && Object.keys(params).some((p) => p.startsWith(e.key));
  return (!word || word in UNITS) && !name;
}

/** The To object button, the same everywhere: its icon and words (T does the same where it is offered). */
export function toObjectButton(onclick: () => void, title: string) {
  return h('button', { className: 'to-object', innerHTML: `${icon('target')}<span>To object</span>`, title: `${title} (T)`, onclick });
}

/** A one-character label (×, ⇄, ✎) makes an icon button: no outline. */
const button = (label: string, onclick: () => void, title = '') => h('button', { onclick, title, className: label.length === 1 ? 'icon' : '' }, label);

/** GitHub's mark (Octicons, MIT). */
const GITHUB =
  '<svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

function topbar(ctx: UIContext): Node[] {
  return [
    h('strong', {}, 'MAKERMAKER'),
    tool('settings', 'Settings: units, ambient occlusion, background', ctx.openSettings),
    tool('new', 'New', ctx.newDoc),
    tool('open', 'Open (⌘O, or drop a file)', ctx.open),
    tool('save', 'Save (⌘S)', ctx.save),
    tool('import', 'Import STEP, STL or OBJ (or drop the file): STEP becomes a solid body, STL and OBJ stay meshes', ctx.importFile),
    tool('autosave', `Autosave ${ctx.autosave ? 'on' : 'off'}: saves into the file a moment after each change`, ctx.toggleAutosave, ctx.autosave),
    tool('undo', 'Undo (⌘Z)', ctx.undo),
    tool('redo', 'Redo (⇧⌘Z)', ctx.redo),
    h('span', { className: 'title' }, ctx.title + (ctx.dirty ? ' •' : '')),
    ...(ctx.busy.length ? [h('span', { className: 'busy' }, ctx.busy.join(', '), h('span', { className: 'bar' }))] : []),
    h('span', { className: `status${ctx.statusError && ctx.status ? ' error' : ''}` }, ctx.status),
    tool('print', 'Export for 3D print: one STL per selected body (else all shown ones), as placed in the world; several come zipped', ctx.exportPrint),
    tool('laser', 'Export for the laser: one SVG per selected body (else all shown ones), the outline of its biggest flat face at 1:1, without fillets and chamfers; several come zipped', ctx.exportLaser),
    tool('render', 'Snapshot: the bodies as a PNG with a transparent background, twice the screen resolution (no grid, sketches or selection); it also lands in the renders, ready to be rendered nicely', ctx.renderImage),
    tool('renderNice', 'Render nice: the renders panel (path traced pictures of saved views)', ctx.renders.toggle, ctx.renders.open),
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
    ['line', 'Line (L): a single line, never extruded'],
  ] as const;
  const on = (name: string) => ctx.active === name;
  if (ctx.sketching)
    return [
      tool('select', 'Select and edit shapes (Esc stops sketching)', ctx.stopTool, !ctx.active),
      ...shapes.map(([kind, title]) => tool(kind, `${title}: draw into the sketch`, () => ctx.startTool(kind), on(kind))),
      h('hr'),
      tool('extrude', 'Extrude (E): pull the selected shapes, or the whole sketch', ctx.extrude, on('extrude')),
      tool('offset', 'Offset: the selected shapes get outlines a distance outside (negative: inside; a line moves to its left)', ctx.offsetTool),
      tool('finish', 'Leave the sketch (Esc)', ctx.exitSketch),
    ];
  return [
    tool('sketch', 'New sketch (S): click a face or empty space, or a face first, then this; then draw shapes on it', ctx.newSketch, on('sketch')),
    ...shapes.map(([kind, title]) => tool(kind, `${title}: draw one and pull it up (a click or Esc keeps it flat and starts sketching)`, () => ctx.startTool(kind), on(kind))),
    tool('sphere', 'Sphere (O): drag from its centre on a face or the ground', () => ctx.startTool('sphere'), on('sphere')),
    h('hr'), // drawing above, shaping below
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
    tool('move', 'Move (M): type distances along X, Y and Z (Tab: the next); the selection, or what is clicked next', ctx.moveTool, on('move')),
    tool('rotate', 'Rotate (W): turn the selection (or what is clicked next) around an axis clicked next: an edge, line, circle or point', ctx.rotateTool),
    h(
      'div',
      { className: 'flyout-at' },
      tool('align', 'Align the selected objects by their boxes (bodies, groups as one, whole sketches); 2 or more, distribute 3 or more', () => {
        alignOpen = !alignOpen;
        renderUI(ctx);
      }, alignOpen),
      ...(alignOpen ? [h('div', { className: 'flyout align-menu' }, ...alignTools(ctx))] : []),
    ),
    tool('revolve', 'Revolve (U): closed sketch shapes (selected, or the outline clicked next) turned around a line or edge in their plane', ctx.revolveTool),
    tool('offset', 'Offset / Shell: selected sketch shapes get outlines a distance outside (or inside); a body (selected, or clicked next) is hollowed to walls, the faces clicked left open', ctx.offsetTool),
    tool('sweep', 'Sweep: the outline of a closed sketch shape clicked (the profile), then a line or shape outline (the path it runs along)', ctx.sweepTool),
    tool('loft', 'Loft (K): a body through closed sketch shapes of several sketches, their outlines clicked in order (Enter)', ctx.loftTool),
    tool('cut', 'Cut: a body (selected, or clicked next) in two along a face\'s plane (turn and move it) or a sketch line or shape; keep both or delete one side', ctx.cutTool, on('cut')),
    h('hr'), // shaping above, organizing below
    tool(ctx.groupSelected ? 'ungroup' : 'group', ctx.groupSelected ? 'Ungroup (⇧⌘G): the contents move to the group\'s parent, staying where they are' : 'Group (⌘G): the selection, or the objects clicked next (Enter groups them)', ctx.groupTool, on('group')),
    tool('joint', 'Joint (J): a parent that stays (body or group), the objects that move, an axis (an edge, line or circle), hinge or slider with limits', ctx.jointTool),
    tool('duplicate', 'Duplicate (⌘D): the selection, or the body clicked next', ctx.duplicate, on('duplicate')),
    tool('delete', 'Delete (Del): the selection, or the body clicked next', ctx.remove, on('delete')),
  ];
}

/** The boolean flyout of the toolbar is open. */
let flyout = false;
/** The align menu of the toolbar is open. */
let alignOpen = false;

/** How objects align: their box's min, middle or max along an axis onto all of theirs, equal gaps, or onto the first one's middle. */
export type ObjectAlign = `${'min' | 'mid' | 'max' | 'spread'}${'X' | 'Y' | 'Z'}` | 'first';

function alignTools(ctx: UIContext) {
  const n = ctx.selected.length;
  const item = (how: ObjectAlign, label: string, title: string) =>
    h('button', { className: 'menu-item', textContent: label, title, disabled: n < (how.startsWith('spread') ? 3 : 2), onclick: () => ((alignOpen = false), ctx.alignObjects(how)) });
  return (['X', 'Y', 'Z'] as const).flatMap((a) => [
    item(`min${a}`, `${a} min`, `Their lowest ${a} onto the lowest of all`),
    item(`mid${a}`, `${a} middle`, `Their middles onto the middle of all along ${a}`),
    item(`max${a}`, `${a} max`, `Their highest ${a} onto the highest of all`),
    item(`spread${a}`, `${a} distribute`, `Equal gaps along ${a}; the outermost stay (3 or more)`),
  ]).concat(item('first', 'Middle on first', 'Their middles onto the middle of the first selected'));
}

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
  // while a body is isolated the others grey out (their eyes still show or hide them), all of a list while it is hidden
  const dimmed = (id: string, list: 'objects' | 'sketches' = 'objects') => ((ctx.isolated && ctx.isolated !== id) || ctx.hideAll[list] ? ' dimmed' : '');
  const order = { objects: tree(doc, ctx.folded).map((r) => r.id), sketches: doc.sketches.map((s) => s.id) };
  /** Shows or hides bodies, sketches and groups by id (one step). */
  const setShown = (ids: string[], on: boolean) => {
    const set = <T extends { id: string; visible: boolean }>(list: T[]) => list.map((o) => (ids.includes(o.id) ? { ...o, visible: on } : o));
    ctx.commit({ ...doc, bodies: set(doc.bodies), sketches: set(doc.sketches), groups: set(doc.groups) });
  };
  /** An eye switched to `on`; with Shift, every row from the last eye clicked in its list to this one goes the way that one went. */
  const eyeClick = (list: 'objects' | 'sketches' | 'solid', id: string, on: boolean, e: MouseEvent, apply: (ids: string[], on: boolean) => void) => {
    const rows = order[list === 'sketches' ? 'sketches' : 'objects'];
    if (e.shiftKey && lastEye?.list === list && rows.includes(lastEye.id)) {
      const [a, b] = [rows.indexOf(lastEye.id), rows.indexOf(id)].sort((x, y) => x - y);
      return apply(rows.slice(a, b + 1), lastEye.on);
    }
    lastEye = { list, id, on };
    apply([id], on);
  };
  const eye = (list: 'objects' | 'sketches', id: string, on: boolean) =>
    h('button', { className: 'icon', title: `${on ? 'Hide' : 'Show'} (Shift-click another eye: the same for all rows between)`, innerHTML: icon(on ? 'eye' : 'eyeOff'), onclick: (e) => eyeClick(list, id, !on, e, setShown) });
  // rows can be dragged (with the rest of the selection): the upper or lower half of a row puts them before or after
  // it (in its group), the middle of a group row into the group, the header to the end of the top level
  const dragged = (id: string) => (ctx.selected.includes(id) ? ctx.selected : [id]);
  const row = (id: string, depth: number, group: boolean, ...cells: HTMLElement[]) => {
    const el = h('div', { className: `listed${dimmed(id)}`, draggable: renaming !== id }, ...cells);
    el.dataset.id = id;
    el.style.paddingLeft = `${depth * 22}px`; // a level: the chevron's width, so contents line up under the group name
    el.ondragstart = (e) => e.dataTransfer!.setData('text/plain', JSON.stringify(dragged(id)));
    const where = (e: DragEvent) => {
      const r = el.getBoundingClientRect();
      const at = (e.clientY - r.top) / r.height;
      return group && at > 0.25 && at < 0.75 ? 'into' : at < 0.5 ? 'before' : 'after';
    };
    const clear = () => el.classList.remove('drop', 'drop-before', 'drop-after');
    el.ondragover = (e) => {
      e.preventDefault();
      clear();
      el.classList.add(where(e) === 'into' ? 'drop' : `drop-${where(e)}`);
    };
    el.ondragleave = clear;
    el.ondrop = (e) => {
      e.preventDefault();
      clear();
      ctx.arrange(JSON.parse(e.dataTransfer!.getData('text/plain')), id, where(e));
    };
    return el;
  };
  // only groups fold: a chevron that turns down when open; other rows start at the left
  // a group folds with a chevron, a body with booleans with the boolean icon
  const fold = ({ id, open, kind }: Row) => {
    if (open === undefined) return [];
    const tools = doc.bodies.find((o) => o.id === id)?.features.filter((f) => f.type === 'boolean').length ?? 0;
    const title = kind === 'body' ? `${open ? 'Hide' : 'Show'} its ${tools} boolean tool bod${tools === 1 ? 'y' : 'ies'}` : open ? 'Fold' : 'Unfold';
    return [h('button', { className: `icon fold${kind === 'body' ? ' bool' : ''}${open ? ' open' : ''}`, innerHTML: icon(kind === 'body' ? 'boolean' : 'chevron'), title, onclick: () => ctx.toggleFold(id) })];
  };
  /**
   * A row's name: a plain click on the name of the only selected row edits it in place (Enter or leaving the field
   * saves it, Esc keeps it); `at`: where the name is stored.
   */
  const nameOf = (id: string, name: string, at: string[]) => {
    const only = ctx.selected.length === 1 && ctx.selected[0] === id;
    if (renaming !== id)
      return h('span', { className: 'name', textContent: name, onclick: (e) => only && !(e.shiftKey || e.metaKey || e.ctrlKey) && (renaming = id) });
    const el = input(`list.${id}`, name, (text) => ((renaming = null), ctx.commit(setIn(doc, at, text))));
    el.className = 'rename';
    el.addEventListener('blur', () => !rendering && renaming === id && ((renaming = null), renderUI(ctx)));
    return el;
  };
  const sketchIcon = () => h('span', { className: 'kind', innerHTML: icon('sketch') });
  /** A joint's parent or moving object: the joint icon (hovered, its moving objects light; a click selects it to edit the joint). */
  const jointMark = (id: string) => {
    const j = doc.joints.find((x) => x.parent === id || x.children.includes(id));
    if (!j) return [];
    const parent = j.parent === id;
    const el = h('button', { className: `icon joint${parent ? ' parent' : ''}`, innerHTML: icon('joint'), title: `${j.name}: ${parent ? 'stays, the others move' : 'moves'} (${j.kind}) · hover: what moves · click: edit it`, onclick: () => ctx.editJoint(j.id) });
    // hovered: what stays and what moves light in the list (in two colours) and in the view
    const light = (on: boolean) => {
      for (const r of document.querySelectorAll<HTMLElement>('#left .listed[data-id]')) {
        r.classList.toggle('joint-static', on && r.dataset.id === j.parent);
        r.classList.toggle('joint-moving', on && j.children.includes(r.dataset.id!));
      }
      ctx.showJoint(on ? j.id : null);
    };
    el.onmouseenter = () => light(true);
    el.onmouseleave = () => light(false);
    return [el];
  };
  const selectedClass = (id: string) => `item${ctx.selected.includes(id) ? ' selected' : ''}`;
  const rows = tree(doc, ctx.folded).map((r) => {
    const { id, kind, depth } = r;
    if (kind === 'group') {
      const i = doc.groups.findIndex((g) => g.id === id);
      const g = doc.groups[i];
      // its fold arrow where a body has its colour, so names line up
      const chevron = h('span', { className: `fold${r.open ? ' open' : ''}`, innerHTML: icon('chevron'), title: r.open ? 'Fold' : 'Unfold', onclick: (e) => (e.stopPropagation(), ctx.toggleFold(id)) });
      // a plain click also folds or unfolds it (not the click that starts renaming it)
      const pick = (how: Pick) => (!how && renaming !== id && ctx.toggleFold(id), ctx.select(id, how));
      return row(id, depth, true, listItem(id, `${selectedClass(id)} group`, pick, chevron, nameOf(id, g.name, ['groups', String(i), 'name'])), button('⚙', () => ctx.select(id), 'Group settings: name, origin'), ...jointMark(id), eye('objects', id, g.visible));
    }
    const i = doc.bodies.findIndex((q) => q.id === id);
    const p = doc.bodies[i];
    const swatch = h('span', { className: 'swatch' });
    swatch.style.background = p.color;
    const look = eye('objects', p.id, p.visible);
    look.title += ` · ${MAC ? '⌘' : 'Ctrl'}-click: show only this body`;
    const isolate = (e: MouseEvent) => (e.preventDefault(), ctx.isolate(p.id));
    look.onclick = (e) => (mod(e) || ctx.isolated === p.id ? isolate(e) : eyeClick('objects', p.id, !p.visible, e, setShown));
    if (ctx.isolated === p.id) Object.assign(look, { className: 'icon isolated', title: 'Shown alone: click to show the others again', innerHTML: icon('isolate') });
    // a sketch group open: shown bodies are see-through; the eye switches one to fully shown and back (V still hides)
    else if (ctx.sketching && p.visible) {
      const full = ctx.solid.has(p.id);
      Object.assign(look, { innerHTML: icon(full ? 'eye' : 'eyeFaded'), title: full ? 'Shown fully: click to make it see-through again' : 'See-through while the sketch group is open: click to show it fully', onclick: (e: MouseEvent) => eyeClick('solid', p.id, !full, e, ctx.setSolid) });
    }
    // its sketches have their own list: this button draws into the (first) one
    const own = sketchesOf(doc, p.id);
    const bools = fold(r); // an owner of tool bodies: the red boolean button folds them, where a group has its ⚙
    const sketch = own.length
      ? [h('button', { className: 'icon', innerHTML: icon('sketch'), title: `Based on sketch: ${own.map((q) => q.name).join(', ')}`, onclick: () => ctx.editSketch(own[0].id) })]
      : bools.length ? [] : [h('span', { className: 'fold-space' })];
    // a boolean's tool body: the op, and whose
    const user = doc.bodies.find((o) => o.features.some((f) => f.type === 'boolean' && f.body === id));
    const op = user?.features.find((f) => f.type === 'boolean' && f.body === id);
    // a boolean's tool body: the op as a button in the eye's place (whose; a click frees it)
    const tool =
      op?.type === 'boolean'
        ? h('button', { className: 'icon tool-op', innerHTML: icon(op.op), title: `${{ union: 'Joined to', subtract: 'Cuts', intersect: 'Intersects' }[op.op]} ${user!.name} · click: free it from the boolean`, onclick: () => ctx.commit(freed(doc, id)) })
        : look;
    return row(id, depth, false, listItem(id, selectedClass(id), (how) => ctx.select(id, how), swatch, nameOf(id, p.name, ['bodies', String(i), 'name'])), ...sketch, ...bools, ...jointMark(id), tool);
  });
  // sketches: their own list, each with the body it belongs to
  const sketchRows = doc.sketches.map((sk, i) => {
    const owner = doc.bodies.find((b) => b.id === ownerOf(doc, sk.id));
    // a plain click draws into it: sketch mode, looking at its plane
    const item = listItem(sk.id, selectedClass(sk.id), (how) => (how === false ? ctx.editSketch(sk.id) : ctx.select(sk.id, how)), sketchIcon(), nameOf(sk.id, sk.name, ['sketches', String(i), 'name']));
    item.title = `${whose(doc, sk.id)} · click to draw into it`;
    // its body, like a body's sketch button: a click selects it
    const body = owner
      ? h('button', { className: 'icon', innerHTML: icon('body'), title: `Object derived: ${owner.name}`, onclick: () => ctx.select(owner.id) })
      : h('span', { className: 'fold-space' });
    return h('div', { className: `listed${dimmed(sk.id, 'sketches')}` }, item, body, eye('sketches', sk.id, sk.visible));
  });
  /** A list's title: a click folds it; objects and sketches have an eye that hides all of them for now (their eyes stay). */
  const heading = (key: 'objects' | 'sketches' | 'params', label: string, kind?: Parameters<typeof icon>[0]) => {
    const open = !ctx.folded.has(`list:${key}`);
    const title = h('h3', { className: 'fold-head', title: open ? 'Fold' : 'Unfold', onclick: () => ctx.toggleFold(`list:${key}`) }, h('span', { className: `fold${open ? ' open' : ''}`, innerHTML: icon('chevron') }), ...(kind ? [h('span', { className: 'kind', innerHTML: icon(kind) })] : []), label);
    const hidden = key !== 'params' && ctx.hideAll[key];
    const all = key === 'params' ? [] : [h('button', { className: 'icon', innerHTML: icon(hidden ? 'eyeOff' : 'eye'), title: hidden ? 'Show them again as they were' : 'Hide all for now (each eye stays as it is)', onclick: () => ctx.toggleHideAll(key) })];
    return { open, head: h('div', { className: 'tree-head' }, title, ...all) };
  };
  const { open: objectsOpen, head } = heading('objects', 'Objects', 'body');
  const sketchList = heading('sketches', 'Sketch groups');
  const paramList = heading('params', 'Parameters');
  head.ondragover = (e) => (e.preventDefault(), head.classList.add('drop'));
  head.ondragleave = () => head.classList.remove('drop');
  head.ondrop = (e) => (e.preventDefault(), ctx.moveInto(JSON.parse(e.dataTransfer!.getData('text/plain')), null));
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
  addParam.dataset.complete = '';

  const none = doc.bodies.length ? [] : [h('p', { className: 'hint' }, 'Draw a shape (R, C, P) to start a body.')];
  return [
    head,
    ...(objectsOpen ? [...rows, ...none] : []),
    sketchList.head,
    ...(sketchList.open ? sketchRows : []),
    paramList.head,
    ...(paramList.open ? [...params, addParam] : []),
  ];
}

function right(ctx: UIContext): Node[] {
  if (ctx.renders.open) return rendersPanel(ctx);
  // renders going on while the panel is closed: a status row on top
  const busy = ctx.doc.renders.filter((r) => ['waiting', 'rendering'].includes(ctx.renders.jobs.get(r.id)?.state ?? ''));
  const now = busy.map((r) => ctx.renders.jobs.get(r.id)!).find((j) => j.state === 'rendering');
  const status = busy.length
    ? [h('button', { className: 'render-status', onclick: ctx.renders.toggle, title: 'Show the renders' }, `Rendering${busy.length > 1 ? ` (${busy.length} queued)` : ''}: ${Math.floor((now?.done ?? 0) * 100)} %`)]
    : [];
  // a row with a measure shows it in the view while hovered
  const infoRow = ([k, v, what]: [string, string, Measure?]) => {
    const cells = [h('dt', {}, k), h('dd', {}, v)];
    if (what !== undefined) for (const c of cells) Object.assign(c, { className: 'measures', onmouseenter: () => ctx.showMeasure(what), onmouseleave: () => ctx.showMeasure(null) });
    return cells;
  };
  const info = ctx.info ? [h('section', { className: 'info' }, h('h3', {}, `Info · ${ctx.info.title}`), h('dl', {}, ...ctx.info.rows.flatMap(infoRow)))] : [];
  return [...status, ...selectionPanel(ctx), ...info];
}

/**
 * Nice renders: background for the next one, Render this view, and the renders, newest first: picture (live while
 * rendering, else the result or the thumbnail taken when it was asked for), when and how, and what can be done.
 */

/**
 * Renders, newest first (snapshots and nice ones): picture (live while rendering, else the result or the thumbnail
 * taken when it was asked for), its background (changeable for the next render of that view), when and how, and
 * what can be done. New renders take the background of the settings.
 */
function rendersPanel(ctx: UIContext): Node[] {
  const { doc, renders } = ctx;
  const shots = doc.renders.map((shot, i) => {
    const job = renders.jobs.get(shot.id);
    const picture = job?.canvas ?? h('img', { src: job?.url ?? shot.results[0]?.preview ?? shot.thumbnail, alt: 'Render' });
    picture.style.background = backdropCss(shot.background);
    // rendered more than once: the older results below, newest first
    const older = shot.results.slice(job?.canvas ? 0 : 1).map((r) => h('img', { src: r.preview, title: `${r.nice ? 'Rendered' : 'Snapshot'} ${new Date(r.at).toLocaleString()}` }));
    const c = shot.camera;
    const how = `${c.ortho ? 'Ortho' : `Persp ${Math.round(c.fov)}°`} · ${c.size[0]} × ${c.size[1]} px`;
    const last = shot.results[0];
    const state = !job
      ? last
        ? `${last.nice ? 'Rendered' : 'Snapshot'} ${new Date(last.at).toLocaleString()}`
        : 'Not rendered yet'
      : job.state === 'waiting'
        ? 'Waiting'
        : job.state === 'rendering'
          ? `Rendering ${Math.floor(job.done * 100)} %`
          : job.state === 'done'
            ? 'Done'
            : job.error ?? 'Failed';
    const bar = job?.state === 'rendering' ? [h('div', { className: 'track' }, Object.assign(h('div', { className: 'fill' }), { style: `width:${job.done * 100}%` }))] : [];
    const busy = job?.state === 'waiting' || job?.state === 'rendering';
    const nice = shot.results.some((r) => r.nice);
    const actions = [
      ...(job?.state === 'done' ? [button('Download', () => renders.download(shot.id), 'Save the picture')] : []),
      ...(busy ? [button('Cancel', () => renders.cancel(shot.id))] : [button(nice ? 'Render again' : 'Render nice', () => renders.again(shot.id), 'Render this view nicely with the model as it is now (saves itself)')]),
      button('Use view', () => renders.useView(shot.id), 'Turn the 3D view to this camera'),
      button('×', () => ctx.commit({ ...doc, renders: doc.renders.filter((r) => r !== shot) }), 'Delete this render'),
    ];
    // its background, for the next render of this view: picking a colour makes it two colours (the ends of its stops)
    const stops = shot.background.stops;
    const ends = { top: stops[0].color, bottom: stops[stops.length - 1].color };
    const colour = (key: 'top' | 'bottom', title: string) => {
      const el = h('input', { type: 'color', value: ends[key], title, className: 'color' });
      el.onchange = () => {
        const next = { ...ends, [key]: el.value };
        ctx.commit(setIn(doc, ['renders', String(i), 'background'], twoColours(next.top, next.bottom)));
      };
      return el;
    };
    return h(
      'section',
      { className: 'render' },
      h('div', { className: 'picture' }, picture),
      ...bar,
      ...(older.length ? [h('div', { className: 'older' }, ...older)] : []),
      h('div', { className: 'listed' }, h('span', { className: 'hint' }, `${new Date(shot.at).toLocaleString()} · ${how}`)),
      h(
        'div',
        { className: 'listed' },
        h('strong', {}, state),
        h('span', { className: 'backdrop-pick', title: 'Background of the next render of this view: above and below the horizon (the same twice: solid)' }, colour('top', 'Above the horizon'), colour('bottom', 'Below')),
      ),
      h('div', { className: 'row actions' }, ...actions),
    );
  });
  return [
    h('div', { className: 'head' }, h('h3', {}, 'Renders'), button('×', renders.toggle, 'Close the renders')),
    h('button', { className: 'primary wide', onclick: renders.shoot, title: 'Render the view as it is now; renders queue up' }, 'Render this view'),
    h('p', { className: 'hint' }, 'Each render keeps its camera and background (new ones take the background of the settings): Render again renders the same view with the model as it is now and saves itself. Snapshots land here too. Full pictures stay until the page reloads; small copies are saved in the file.'),
    ...shots,
  ];
}

function selectionPanel(ctx: UIContext): Node[] {
  const n = ctx.selected.length;
  if (n > 1)
    return [
      h('p', { className: 'hint' }, `${n} bodies selected: drag, nudge, duplicate or delete them together; select one to edit it.`),
      h('h3', {}, 'Boolean'),
      h('p', { className: 'hint' }, 'The first selected body keeps the result; the others become its tool bodies: they move with it and stay editable (selected, they show as red outlines).'),
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
  // a boolean's tool body: whose, and a way out
  const user = ctx.doc.bodies.find((o) => o.features.some((f) => f.type === 'boolean' && f.body === body.id));
  const freeing = user
    ? [h('div', { className: 'row' }, h('span', { className: 'hint' }, `A tool body of ${user.name}`), button('Free from boolean', () => ctx.commit(freed(ctx.doc, body.id)), 'Remove the booleans that use it: it becomes a normal body again'))]
    : [];

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
    ...freeing,
    h('h3', {}, 'Position'),
    h('div', { className: 'row' }, ...['X', 'Y', 'Z'].map((l, k) => exprField(ctx, `${at}.position.${k}`, l))),
    h('h3', {}, 'Rotation'),
    // degrees: shown as typed, never unit-converted
    h('div', { className: 'row' }, ...(['rx', 'ry', 'rz'] as const).map((k) => exprField(ctx, `${at}.rotation.${k}`, `${k[1].toUpperCase()}°`, true))),
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
    ...jointCards(ctx, body.id),
  ];
}

/** The joints `id` stays in or moves by: name, range, what moves; Edit opens the panel it was made in. */
function jointCards(ctx: UIContext, id: string): Node[] {
  const nameOf = (o: string) => [...ctx.doc.bodies, ...ctx.doc.groups].find((x) => x.id === o)?.name ?? '?';
  return ctx.doc.joints.flatMap((j) => {
    if (j.parent !== id && !j.children.includes(id)) return [];
    const remove = button('×', () => ctx.commit({ ...ctx.doc, joints: ctx.doc.joints.filter((x) => x !== j) }), 'Delete the joint: what it moved goes back to where it is without it');
    return [
      h(
        'section',
        { className: 'joint-card' },
        h('h4', {}, h('span', {}, j.name, h('span', { className: 'range' }, ` ${ctx.jointRange(j)}`)), button('Edit', () => ctx.editJoint(j.id), 'Kind, limits, speed, direction'), remove),
        h('p', { className: 'hint' }, `${nameOf(j.parent)} stays; ${j.children.map(nameOf).join(', ')} ${j.children.length > 1 ? 'move' : 'moves'}. Model them where they are now; play and scrub in the view's joints box.`),
      ),
    ];
  });
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
    ...jointCards(ctx, g.id),
  ];
}

const SKETCH_HINT =
  'Sketch group: [R] [C] [P] draw shapes (they stay flat) · click a shape to select it (a sub-group: all of it), double-click opens its sub-group · [⌘G] groups shapes, [⇧⌘G] ungroups · [X] [Y] [Z] move by a typed distance · [E] extrude · [Esc] up a level or leaves';

function hint(selected: number, shapes: number) {
  if (shapes)
    return 'Drag to move in the sketch plane · [X] [Y] [Z] move by a typed distance · handles resize ([Alt] from the middle, [Shift] keep proportions, type a size, [Tab] other side) · round handle turns ([Shift] 15°) · [E] extrude · [Del] delete';
  if (selected > 1)
    return 'Drag to move them all (the direction picks X, Y or Z; [Shift] coarse, [Ctrl] precise) · [X] [Y] [Z] move by a typed distance · [Shift] / [⌘]-click adds or removes · [arrows] nudge ([Shift] ×10) · [V] hide · [Del] delete · [⌘D] duplicate · [Esc] deselect';
  if (selected)
    return 'Drag to move (the direction picks X, Y or Z; [Shift] coarse, [Ctrl] precise) · [X] [Y] [Z] move by a typed distance · [Alt]-click a face or edge ([Shift] adds more; double right-click an edge: its loop) · [Shift] / [⌘]-click selects more · [arrows] nudge · [V] hide · [Del] delete · [⌘D] duplicate';
  return 'Drag a body to move it · [Alt]-click a face or edge picks it · [Tab] next body under the pointer · [F] fit · drag to orbit, right-drag, scroll sideways or [Shift] wheel to pan, wheel to zoom · drag a field label to scrub ([Shift] fine) · [⌘Z] undo';
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
  const kinds = { rect: 'Rectangle', circle: 'Circle', ngon: 'Regular polygon', polygon: 'Polygon', line: 'Line' };
  // in sketch mode with shapes selected, only those show
  const only = ctx.sketching === s.id && ctx.shapes.length > 0;
  const shapeRow = (q: (typeof s.shapes)[number], depth: number) => {
    const j = s.shapes.indexOf(q);
    const name = listItem(q.id, `item${ctx.shapes.includes(q.id) ? ' selected' : ''}`, (how) => ctx.pickShape(s.id, q.id, how), kinds[q.kind]);
    const drop = button('×', () => set({ shapes: s.shapes.filter((r) => r !== q) }), 'Delete this shape');
    const box = h('input', { type: 'checkbox', checked: !!q.construction });
    // the next objects are drawn as this one now is
    box.onchange = () => (ctx.setDrawConstruction(box.checked), set({ shapes: s.shapes.map((r) => (r === q ? { ...r, construction: box.checked } : r)) }));
    const construction = h('label', { className: 'check', title: 'Construction line: dashed, snapped to, never extruded' }, box, 'Construction');
    const row = h('div', { className: 'listed' }, name, construction, drop);
    row.style.paddingLeft = `${depth * 22}px`;
    // fields and reference diamond only for selected shapes
    return h('div', { className: 'shape' }, row, ...(ctx.shapes.includes(q.id) ? shapeFields(ctx, `${at}.shapes.${j}`, q) : []));
  };
  // sub-groups first, then the shapes, per level; a group row picks all its shapes and folds
  const level = (parent: string | null, depth: number): Node[] => [
    ...s.groups
      .filter((g) => g.parent === parent)
      .flatMap((g) => {
        const ids = shapesIn(s, g.id);
        const picked = ids.length > 0 && ids.every((id) => ctx.shapes.includes(id));
        const open = !ctx.folded.has(g.id);
        const chevron = h('button', { className: `icon fold${open ? ' open' : ''}`, innerHTML: icon('chevron'), title: open ? 'Fold' : 'Unfold', onclick: () => ctx.toggleFold(g.id) });
        const row = h('div', { className: 'listed' }, chevron, listItem(g.id, `item group${picked ? ' selected' : ''}`, (how) => ctx.pickShapes(s.id, ids, how), `${g.name} (${ids.length})`));
        row.style.paddingLeft = `${depth * 22}px`;
        return [row, ...(open ? level(g.id, depth + 1) : [])];
      }),
    ...s.shapes.filter((q) => (q.group ?? null) === parent).map((q) => shapeRow(q, depth)),
  ];
  // in sketch mode with shapes selected, only those show
  const shapes = only ? s.shapes.filter((q) => ctx.shapes.includes(q.id)).map((q) => shapeRow(q, 0)) : level(null, 0);
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
      // shown or hidden: its eye in the list
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
  const link = tool('link', ctx.linkSize(p.id) ? 'Width and height change together: click to unlink' : 'Link width and height: they change together', () => ctx.toggleLinkSize(p.id), ctx.linkSize(p.id));
  const [w, hh] = p.kind === 'rect' ? [stored('w'), stored('h')] : [mm(m.w), mm(m.h)];
  if (p.kind === 'line') return [row(...pos), row(tf('w', 'W', w), link, tf('h', 'H', hh))]; // no corners to round, no turn of its own
  const rot = tf('rot', 'Turn °', stored('rot'), true); // degrees: shown as typed, never unit-converted
  if (p.kind === 'ngon') return [row(...pos, rot), row(tf('d', 'Ø', stored('d')), pf('sides', 'Sides', true))];
  return [row(...pos, rot), row(tf('w', 'W', w), link, tf('h', 'H', hh), pf('r', 'R'))];
}

/** Illustrator's reference point locator for one shape: which point of its box X / Y give, and which point stays when sizing or turning. */
function refGrid(ctx: UIContext, shape: string) {
  const [rx, ry] = ctx.shapeRef(shape);
  const cells = [1, 0, -1].flatMap((sy) => [-1, 0, 1].map((sx) => h('button', { className: `cell${rx === sx && ry === sy ? ' on' : ''}`, onclick: () => ctx.setShapeRef(shape, [sx, sy]) })));
  return h('div', { className: 'ref-grid', title: 'Reference diamond: X / Y measure this point of the shape; changing size or turn keeps it in place' }, ...cells);
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
      // how far it reaches behind its sketch plane (left out: 0)
      const back = exprField(ctx, `${at}.back`, 'Back', false, { value: feature.back ?? { e: '0', u: ctx.doc.units }, set: (x, live) => ctx.setValue([...at.split('.'), 'back'], x, live), error: ctx.exprErrors.get(`${at}.back`) });
      back.title = 'How far it also reaches behind its sketch plane (Alt while pulling: as far as the depth)';
      const reach = [
        ...(feature.through ? [] : [f('depth', 'Depth'), back]),
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
      const drop = button('×', () => ctx.commit(freed(ctx.doc, feature.body)), 'Remove: the tool body becomes a body of its own');
      return h('section', {}, h('div', { className: 'listed boolean' }, op, h('span', { className: 'hint' }, 'with'), tool, drop));
    }
    case 'mesh': {
      const triangles = Math.floor((feature.triangles.length * 3) / 4 / 12); // base64 → bytes → 3 uint32 per triangle
      return h(
        'section',
        {},
        h('h4', {}, 'Mesh', remove),
        h('p', { className: 'hint' }, `Imported from ${feature.source} · ${triangles} triangles · a mesh: no CAD operations on it yet`),
        h('div', { className: 'row' }, exprField(ctx, `${at}.scale`, 'Scale', true)),
      );
    }
    case 'step':
      return h('section', {}, h('h4', {}, 'STEP solid', remove), h('p', { className: 'hint' }, `Imported from ${feature.source}`));
    case 'split': {
      // which side stays; a plane's turn and offset, a ball's or cylinder's size, or the shape it cuts along
      const c = feature.cutter;
      const side = select(String(feature.side) as '1' | '-1', { '1': 'Cut: keep side A', '-1': 'Cut: keep side B' }, (v) => setFeature({ ...feature, side: v === '1' ? 1 : -1 }));
      const sketch = c.kind === 'shape' ? ctx.doc.sketches.find((k) => k.id === c.sketch) : undefined;
      const shape = sketch?.shapes.find((q) => c.kind === 'shape' && q.id === c.shape);
      const what =
        c.kind === 'plane'
          ? h('div', { className: 'row' }, f('cutter.offset', 'Offset'), exprField(ctx, `${at}.cutter.turn`, 'Turn °', true))
          : c.kind === 'sphere' || c.kind === 'cylinder'
            ? h('div', { className: 'row' }, f('cutter.d', c.kind === 'sphere' ? 'Ball Ø' : 'Cylinder Ø'), f('cutter.offset', 'Offset'))
            : h('div', { className: 'row' }, h('span', { className: 'hint' }, shape ? `Along ${sketch!.name}: ${shape.kind}` : 'Its cutting shape was deleted'), ...(shape?.kind === 'line' ? [f('cutter.offset', 'Offset')] : []));
      return h('section', {}, h('h4', {}, side, remove), what);
    }
    case 'revolve': {
      const mode = select(feature.mode, { add: 'Revolve: add', cut: 'Revolve: cut' }, (m) => setFeature({ ...feature, mode: m }));
      const src = feature.source;
      const sketch = src.kind === 'sketch' ? ctx.doc.sketches.find((k) => k.id === src.sketch) : undefined;
      return h('section', {}, h('h4', {}, mode, remove), h('div', { className: 'row' }, f('angle', 'Angle °'), h('span', { className: 'hint' }, sketch ? `From ${sketch.name}` : 'Its sketch was deleted')));
    }
    case 'shell':
      return h('section', {}, h('h4', {}, 'Shell', remove), h('div', { className: 'row' }, f('thickness', 'Wall'), h('span', { className: 'hint' }, `${feature.open.length} face${feature.open.length === 1 ? '' : 's'} open`)));
    case 'sweep': {
      const name = (q: { sketch: string }) => ctx.doc.sketches.find((k) => k.id === q.sketch)?.name ?? '?';
      return h('section', {}, h('h4', {}, 'Sweep', remove), h('p', { className: 'hint' }, `${name(feature.profile)} along ${name(feature.path)} (linked: editing either changes it)`));
    }
    case 'loft': {
      const ruled = h('input', { type: 'checkbox', checked: feature.ruled });
      ruled.onchange = () => setFeature({ ...feature, ruled: ruled.checked });
      const names = feature.sections.map((q) => ctx.doc.sketches.find((k) => k.id === q.sketch)?.name ?? '?');
      return h('section', {}, h('h4', {}, 'Loft', remove), h('div', { className: 'row' }, h('span', { className: 'hint' }, `Through ${names.join(' → ')}`), h('label', { className: 'check', title: 'Straight between the shapes, else smooth' }, ruled, 'Ruled')));
    }
    case 'sphere':
      return h('section', {}, h('h4', {}, 'Sphere', remove), h('div', { className: 'row' }, f('x', 'X'), f('y', 'Y'), f('z', 'Z'), f('d', 'Ø')));
    case 'finish': {
      const enabled = h('input', { type: 'checkbox', checked: feature.enabled, title: 'Enabled' });
      enabled.onchange = () => setFeature({ ...feature, enabled: enabled.checked });
      const mode = select(feature.mode, { fillet: 'Fillet', chamfer: 'Chamfer' }, (m) => setFeature({ ...feature, mode: m }));
      // picked edges (dragged on the body) keep their pick; a rule can replace it
      const rules = { all: 'All edges', top: 'Top edges', bottom: 'Bottom edges', vertical: 'Vertical edges' };
      const picked = typeof feature.edges === 'object' ? feature.edges.pts.length : 0;
      const edges =
        typeof feature.edges === 'object'
          ? select<keyof typeof rules | 'picked'>('picked', { picked: `Picked edges (${picked})`, ...rules }, (r) => r !== 'picked' && setFeature({ ...feature, edges: r }))
          : select<keyof typeof rules>(feature.edges, rules, (r) => setFeature({ ...feature, edges: r }));
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
