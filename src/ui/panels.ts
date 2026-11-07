import { displayText, fmt, inName, isPlain, negated, UNITS } from '../doc/expr';
import { fitting, THREADS } from '../doc/threads';
import { getIn, paramLookup, resolve, setIn } from '../doc/resolve';
import { lookOf, setLook, STANDARD_SECTIONS } from '../doc/materials';
import { ex, newFinish } from '../doc/sample';
import { freed, ownerOf, ownersOf, sketchesOf, tree, whose, type Row } from '../doc/groups';
import { shapesIn } from '../doc/shapegroups';
import { backdropCss, twoColours } from '../viewer/sky';
import { ASPECTS, shotCamera } from '../viewer/render';
import type { Body, BooleanOp, Doc, Expr, Feature, Group, Joint, Material, PhotoSphere, Profile, RenderTo, Unit } from '../doc/types';
import { arcOf, bounds, type Align, type DrawnProfile } from '../doc/profiles';
import type { ToolKind } from '../viewer/sketch';
import type { CappedEdge } from '../kernel/build';
import { axisHtml, sizeHtml } from './axes';
import { BUILT_IN_PHOTOS } from './photospheres';
import { closeButton, deleteButton, icon, tool, type IconName } from './icons';
import { MAC, mod, pressed, role, toggles } from './keys';
import { rocket } from './rocket';

/** On error notes (a click copies them: see main). */
export const COPY_TIP = 'Copy warning';

export interface UIContext {
  doc: Doc;
  selected: string[];
  exprErrors: Map<string, string>;
  kernelErrors: Map<string, { featureId: string; error: string }>;
  lostEdges: (body: string, feature: string) => number;
  /** A finish's edges held at the largest size they take (last build). */
  capped: (body: string, feature: string) => CappedEdge[];
  /** Gives a finish's held edges steps of their own (see main's `splitCapped`). */
  splitCapped(body: string, feature: string): void;
  terminal: { toggle(): void; open: boolean };
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
  /** The list of saved versions. */
  versions(): void;
  /** A refusal in the top bar, in red. */
  notify(message: string): void;
  /** Good news in the top bar, green as a tool's note. */
  cheer(message: string): void;
  statusError: boolean;
  /** The smallest step values move in (mm; Settings → General). */
  minStep: number;
  /** Measurements of the selection, for the info panel (null: nothing to measure). */
  info: { title: string; rows: [string, string, Measure?][]; note?: string } | null;
  /** Shows a measure of the selection in the view: one box side (axis 0 / 1 / 2) or its position ('at'); null: none. */
  showMeasure(what: Measure | null): void;
  /** A sketch shape's corner `i` (below 0: all) marked in the view (its R field hovered or typed in); null: none. */
  showCorner(path: string[] | null, i: number): void;
  /** What a length (an expression too) comes to, mm; null: it cannot be worked out. */
  lengthOf(x: Expr): number | null;
  /** Hovering a size field: that size drawn on its shape or body (see main's showSize); null: none. */
  showSize(keys: string[] | null, what?: 'w' | 'h' | 'd' | 'depth'): void;
  /** In sketch mode or while a group's objects are selected: bodies shown fully (their eye switched them back); the others are see-through. */
  solid: Set<string>;
  /** A group's objects selected: that group's contents (the rest fades); else null. */
  grouped: Set<string> | null;
  setSolid(ids: string[], on: boolean): void;
  paramValue(name: string): string;
  commit(doc: Doc): void;
  /** `live`: replaces the current undo step (scrubbing). */
  setValue(path: string[], value: unknown, live?: boolean): void;
  /** A finish's size, below 0 the other kind; `from`: the kind the field showed (a drag past 0 goes on into the other kind). */
  setFinishSize(path: string[], value: Expr, from: 'fillet' | 'chamfer', live: boolean): void;
  /** `how`: true toggles the object, 'range' selects from the last selected one in its list to it. */
  select(id: string | null, how?: Pick): void;
  /** A list row plainly clicked again while it alone is selected: deselects it (a waiting tool takes it instead) and says so. */
  deselectAgain(id: string, how: Pick): boolean;
  /** The step of the selected body selected (its faces lit, its row open in History); null: none. */
  selectedStep: string | null;
  /** Selects step `feature` of `body` (null: none). */
  selectStep(body: string, feature: string | null): void;
  /** Folds tool body `id` into its body's boolean step, or (false) lists it again; refused with a note when it cannot. */
  foldTool(id: string, fold: boolean): void;
  /** Folds every tool body of body `owner` that can fold. */
  foldAll(owner: string): void;
  /** Body `id`'s right-click menu at (x, y) (Fold, Unfold, Fold all); false: nothing to offer. */
  bodyMenu(id: string, x: number, y: number): boolean;
  /** Deletes step `feature` of `body` (a boolean's: a folded tool body goes with it, a listed one becomes free). */
  removeStep(body: string, feature: string): void;
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
  planeTool(): void;
  /** A new sketch on work plane `id`, opened. */
  drawOn(id: string): void;
  offsetTool(): void;
  /** Interference and clearance: the floating panel (again: closes). */
  clashTool(): void;
  /** The next click sets what custom section `i` turns around. */
  sectionAxis(i: number): void;
  /** Coat: a body (selected, or clicked next) made thicker all round. */
  coatTool(): void;
  /** A coat's floating panel. */
  coatEdit(body: string, feature: string): void;
  mirrorTool(): void;
  patternTool(): void;
  threadTool(): void;
  rotateTool(): void;
  /** Aligns the selected objects (bodies, groups as one, whole sketches) by their boxes; see `alignObjects` in main. */
  alignObjects(how: ObjectAlign): void;
  /** Hovering an align choice: what it would do, shown (null: back). */
  previewAlign(how: ObjectAlign | null): void;
  jointTool(): void;
  attachTool(): void;
  /** Lights a joint's moving objects (null: the selection again). */
  showJoint(joint: string | null): void;
  /** Lights a sketch's shapes in the view (hovered in the list; null: none). */
  lightSketch(id: string | null): void;
  /** An image hovered in the list: outlined orange in the view for the moment (null: none). */
  lightImage(id: string | null): void;
  /** Calibrating an image: two points clicked on it, their real distance typed. */
  calibrate(id: string): void;
  /** A work plane hovered in the list: orange in the view for the moment (null: none). */
  lightPlane(id: string | null): void;
  /** Opens a bulge's panel (`body` holds it). */
  editBulge(body: string, feature: string): void;
  /** A box joint's panel (either body's step). */
  editFingers(body: string, feature: string): void;
  /** Opens a work plane's panel. */
  editPlane(id: string): void;
  /** Measure: an edge's length or two points' distances (see main's measureTool). */
  measureTool(): void;
  /** Box joint: bodies that overlap or touch cut into interlocking fingers, each pair that meets (see main's boxJoint). */
  boxJoint(): void;
  /** Outlines objects orange in the view, a temporary mark (hovered in the list; groups: their contents; null: none). */
  lightBodies(ids: string[] | null): void;
  /** A body's linked copies become their own objects, together with it in a new group of its name. */
  breakLinks(source: string): void;
  /** One linked copy gets its own steps and leaves the others. */
  unlinkCopy(id: string): void;
  /**
   * To object for the value at `path`: the next click's value (in the display unit) is handed to `insert`, to go into
   * the field where the cursor is; false: that value has none.
   */
  reach(path: string[], insert: (text: string) => void): boolean;
  /** Hands joint `joint`'s role of `from` (what stays, or one that moves) to `to`. */
  moveJointEnd(joint: string, from: string, to: string): void;
  /** A joint's edit panel (the one it was made in). */
  editJoint(joint: string): void;
  /** A group's origin as `next` has it (its fields, or Parent's origin), its contents staying where they are; `live`: a scrub's step. */
  moveOrigin(group: string, next: Doc, live?: boolean): void;
  /** Picks a group's origin in the view (a face: Z out of it), its contents staying where they are. */
  pickOrigin(group: string): void;
  /** An attach ends: its objects move on their own. */
  breakAttach(joint: string): void;
  /** A joint's range in words: `0–110°`, `0–35 mm`. */
  jointRange(joint: Joint): string;
  loftTool(): void;
  /** Bulge: a face or closed sketch shapes domed (see main's bulgeTool). */
  bulgeTool(): void;
  /** Draft: a flat face turned about its hinge (see main's draftTool). */
  draftTool(): void;
  editDraft(body: string, feature: string): void;
  /** Opens a thread's panel. */
  editThread(body: string, feature: string): void;
  /** Whether a group is selected (the group tool then ungroups). */
  groupSelected: boolean;
  /** Moves objects before or after another one (into its group), or into a group. */
  arrange(ids: string[], target: string, where: 'before' | 'after' | 'into'): void;
  /** The body shown alone (its eye was ⌘ / Ctrl-clicked), if any. */
  isolated: string | null;
  /** Shows only this body; again (or for the isolated body) shows what was shown before. */
  isolate(id: string): void;
  /** Shows a body, or all bodies with a material, in a colour without changing the document (while the colour picker is open). */
  previewColor(id: string, color: string): void;
  /** Sets the material of bodies and groups (none: their group's, else their own colour). */
  setMaterialOf(ids: string[], material: string | undefined): void;
  /** The materials dialog; `fresh`: the selection gets a new material of the file first. */
  openMaterials(fresh?: boolean): void;
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
  exportStep(): void;
  /** Snapshot: downloads the view as a PNG (and keeps it in the renders). */
  renderImage(): void;
  openSettings(): void;
  /** Settings at the light of renders. */
  openRenderLight(): void;
  /** The photo spheres of this document and of this browser. */
  photos(): PhotoSphere[];
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
    /** Its versions in a gallery. */
    versions(id: string): void;
    /** Shown in a live render view (its camera and background; Save adds to it). */
    live(id: string): void;
    /** Where renders are saved (none: Downloads), whether writing there failed, whether this browser can pick folders, whether the document has a file next to which to save. */
    folder: { to: Doc['renderTo']; lost: boolean; can: boolean; saved: boolean };
    /** Save renders there from now on (none: Downloads); `pick`: pick another folder. */
    pickFolder(to?: RenderTo, pick?: boolean): void;
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
  /** Sets a size of side `side` of the line or polygon at `path`: its length, angle or an arc's diameter. */
  setSide(path: string[], side: number, key: 'l' | 'deg' | 'd', value: Expr, live: boolean): void;
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
/** The last eye clicked (its list and row) and what it switched to: a Shift-click on another eye applies that to the rows between. */
let lastEye: { list: 'objects' | 'sketches' | 'solid'; id: string; on: boolean } | null = null;

/** The list row whose name is edited in place (its id). */
let renaming: string | null = null;

let pairOut = 0;
let pairLit: ((id: string) => string | null) | null = null;
/** Paints the lit pair on the list rows (again after a redraw). */
function paintPair() {
  for (const r of document.querySelectorAll<HTMLElement>('#left .listed[data-id]')) {
    r.classList.remove('bool-tool', 'bool-target', 'joint-static', 'joint-moving');
    const c = pairLit?.(r.dataset.id!);
    if (c) r.classList.add(c);
  }
}
/** List rows lit as a pair (a boolean's sides, a joint's ends; `classOf` a row's class); null: out a second later, unless another pair lights first. */
function lightPair(classOf: typeof pairLit) {
  clearTimeout(pairOut);
  if (classOf) (pairLit = classOf), paintPair();
  else pairOut = window.setTimeout(() => ((pairLit = null), paintPair()), 1000);
}

/** A list row's button; while its name is edited, a plain box (an input cannot sit in a button). */
function listItem(id: string, className: string, pick: (how: Pick) => void, ...children: (Node | string)[]) {
  if (renaming === id) return h('div', { className }, ...children);
  const el = h('button', {
    className,
    onclick: (e) => pick(role(e, 'add') ? 'range' : role(e, 'addOne')),
    // right-click: a body's menu if it has one; Ctrl-click (macOS sends it as a right-click) toggles as ⌘-click does
    oncontextmenu: (e) => (e.preventDefault(), (!e.ctrlKey && menuOf?.(id, e.clientX, e.clientY)) || pick(true)),
  }, ...children);
  el.dataset.id = id; // the view lights it (see `onHover` in main)
  return el;
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
addEventListener('pointerdown', (e) => (holding = (e.target as HTMLElement).matches?.('input[type=range]') || (document.activeElement instanceof HTMLInputElement && e.target !== document.activeElement)), { capture: true });
const release = () => {
  if (!holding) return;
  holding = false;
  setTimeout(() => waiting && renderUI(waiting)); // after the click
};
addEventListener('pointerup', release, { capture: true });
addEventListener('pointercancel', release, { capture: true });

/** Rebuilds all panels, keeping focus and unsaved typing in the active field. */
/** The right-click menu list rows open (a body's; set with each render). */
let menuOf: UIContext['bodyMenu'] | null = null;

export function renderUI(ctx: UIContext) {
  if (holding) return void (waiting = ctx);
  waiting = null;
  menuOf = (id, x, y) => ctx.doc.bodies.some((b) => b.id === id) && ctx.bodyMenu(id, x, y);
  const active = document.activeElement as HTMLInputElement | null;
  const path = active?.dataset?.path ?? (renaming ? `list.${renaming}` : undefined); // a name just clicked gets the focus
  const typing = active?.dataset.dirty ? { value: active.value, from: active.selectionStart, to: active.selectionEnd } : null;
  rendering = true;
  $('topbar').replaceChildren(...topbar(ctx));
  $('toolbar').replaceChildren(...toolbar(ctx));
  $('editbar').replaceChildren(...editbar(ctx));
  $('custom-sections').replaceChildren(...customSections(ctx));
  // each list scrolls on its own: where it was stays across the rebuild
  const scrolled = new Map([...$('left').querySelectorAll<HTMLElement>('.list-body')].map((b) => [b.dataset.list, b.scrollTop]));
  $('left').replaceChildren(...left(ctx));
  for (const b of $('left').querySelectorAll<HTMLElement>('.list-body')) b.scrollTop = scrolled.get(b.dataset.list) ?? 0;
  paintPair();
  $('right').replaceChildren(...right(ctx));
  $('hint-text').innerHTML = axisHtml(ctx.hint ?? (ctx.sketching ? SKETCH_HINT : hint(ctx.selected.length, ctx.shapes.length))).replace(/\[(.+?)\]/g, '<kbd>$1</kbd>');
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
 * that is not stored as it is shown (path only names the field), with its setter and error; `perPx`: its scrub step.
 */
function exprField(ctx: UIContext, path: string, label: string, raw = false, own?: { value: Expr; set: (x: Expr, live: boolean) => void; error?: string }, perPx?: number) {
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
    if (!wantsT(e, el)) return;
    const reaching = ctx.reach(keys, (text) => {
      const field = document.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`) ?? el;
      field.focus();
      field.setRangeText(text, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end');
    });
    if (reaching) e.preventDefault();
  });
  const name = h('span', { innerHTML: sizeHtml(label) });
  scrub(name, el, () => shown, u, ctx.minStep, (e, live) => set({ e, u }, live), () => {
    // the field may be rebuilt meanwhile: the one there now
    const field = document.querySelector<HTMLInputElement>(`input[data-path="${CSS.escape(path)}"]`);
    field?.focus();
    field?.select();
  }, false, undefined, perPx);
  return h('label', { className: 'field' }, name, el);
}

/**
 * Scrubbing (as in incase): dragging `label`, or the `field` while it is not focused, sideways changes its number (a
 * plain one, or with a unit, `text()` at the press; else nothing) by a step per px for its unit (Shift ×10, Ctrl
 * `minStep` mm), handing each new text to `set` (`live` after the first); a press on the field without dragging calls
 * `click` (to edit it); `whole`: whole numbers, one per `wholePx` (Shift: ten); `perPx`: its own step per px. The pointer hides and is not stopped by
 * the screen edge meanwhile.
 */
export function scrub(label: HTMLElement, field: HTMLInputElement, text: () => string, u: Unit, minStep: number, set: (text: string, live: boolean) => void, click: () => void, whole = false, wholePx = 8, perPx?: number) {
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
    const step = perPx ?? { mm: 0.5, cm: 0.05, m: 0.0005, in: 0.02, ft: 0.002 }[unit]; // per px, as in incase
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
      const per = role(m, 'precise') ? minStep / UNITS[unit] : role(m, 'constrain') ? step * 10 : step;
      const next = whole ? String(Math.round(base + Math.trunc(travel / wholePx) * (role(m, 'constrain') ? 10 : 1))) : fmt(base + Math.round(travel) * per) + num[2];
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

/** Whether T (or `action`) pressed in `input` means that: not in the middle of a name. */
export function wantsT(e: KeyboardEvent, input: HTMLInputElement, action: 'toObject' | 'measureValue' = 'toObject') {
  return pressed(e, action) && !inName(input.value.slice(0, input.selectionStart ?? 0));
}

/** The To object button, the same everywhere: its icon and words (T does the same where it is offered). */
export function toObjectButton(onclick: () => void, title: string, measure?: () => void) {
  const target = h('button', { className: 'to-object', innerHTML: icon('target'), title: `T: to object · ${title}`, onclick });
  return measure ? h('span', { className: 'to-tools' }, target, measureButton(measure)) : target;
}

/** The Distance measure tool for a field (it keeps the focus): D does the same. */
export function measureButton(onclick: () => void) {
  return h('button', { className: 'to-object', innerHTML: icon('measure'), title: 'D: Distance measure · click a length there: it goes into this field', onmousedown: (e: Event) => e.preventDefault(), onclick });
}

/** A one-character label (×, ⇄, ✎) makes an icon button: no outline. */
const button = (label: string, onclick: () => void, title = '') => h('button', { onclick, title, className: label.length === 1 ? 'icon' : '' }, label);

function topbar(ctx: UIContext): Node[] {
  return [
    h('strong', {}, h('span', { className: 'logo', innerHTML: icon('logo') }), h('span', { className: 'wordmark', innerHTML: icon('makermaker') })),
    tool('new', 'New', ctx.newDoc),
    tool('open', 'Open (⌘O, or drop a file)', ctx.open),
    tool('save', 'Save (⌘S)', ctx.save),
    tool('import', 'Import (or drop the file where it should go): STEP becomes solid bodies with their groups, names, colours and materials, STL, OBJ, 3MF, GLB and SketchUp (SKP) meshes, SVG and DXF a sketch 1:1, a picture (PNG, JPG, WebP, GIF) an image to calibrate', ctx.importFile),
    tool('export', 'Export STEP: one file with the selected bodies (else all shown ones) as named, coloured parts, as placed in the world (for other CAD tools)', ctx.exportStep),
    tool('versions', 'Versions: go back in time: the saved versions of this file, shown with a click, restored if you like', ctx.versions),
    tool('terminal', 'Python terminal and scripts: model by typing, cad.box(80, 60, 40)', ctx.terminal.toggle, ctx.terminal.open),
    tool('undo', 'Undo (⌘Z)', ctx.undo),
    tool('redo', 'Redo (⇧⌘Z)', ctx.redo),
    h('span', { className: 'title' }, ctx.title + (ctx.dirty ? ' •' : '')),
    // the switch shows what is (a click asks for it: saving first may be cancelled)
    h('label', { className: 'autosave', title: 'Autosave: saves into the file a moment after each change' }, h('input', { type: 'checkbox', checked: ctx.autosave, onclick: (e: MouseEvent) => (e.preventDefault(), ctx.toggleAutosave()) }), 'Autosave'),
    ...(ctx.busy.length ? [h('span', { className: 'busy' }, ctx.busy.join(', '), h('span', { className: 'bar' }))] : []),
    h('span', { className: `status${ctx.statusError && ctx.status ? ' error' : ''}` }, ctx.status),
    tool('print', 'Export for 3D print: the selected bodies (else all shown ones), each checked (closed, manifold, sound, its size), as placed in the world: one STL each (several zipped) or one 3MF', ctx.exportPrint),
    tool('laser', 'Export for the laser: the selected bodies (else all shown ones) listed, switch any off; each the outline of a flat face (its biggest, or one clicked) at 1:1 without fillets and chamfers, kerf allowed for; SVG or DXF, several zipped', ctx.exportLaser),
    tool('render', 'Snapshot: the bodies as a PNG with a transparent background, twice the screen resolution (no grid, sketches or selection); it also lands in the renders, ready to be rendered nicely', ctx.renderImage),
    tool('renderNice', 'Render nice: the renders panel (path traced pictures of saved views)', ctx.renders.toggle, ctx.renders.open),
    tool('material', 'Materials: pick, change and save looks; import and export', () => ctx.openMaterials()),
    tool('theme', 'Light / dark', ctx.toggleTheme),
    tool('settings', 'Settings: units, ambient occlusion, background, light', ctx.openSettings),
  ];
}

const SHAPES = [
  ['rect', 'Rectangle (R)'],
  ['circle', 'Circle (C)'],
  ['ngon', 'Regular polygon (N)'],
  ['line', 'Line (L): lines, a free polygon, bezier curves and round arcs; closed, an area to extrude'],
] as const;

/** Left of the 3D view (incase's toolbar): sketching and making things, grouping, duplicating, deleting. */
/** Shapes with several drawing modes, and how to switch them. */
const MODED = ['rect', 'circle', 'ngon', 'line'];
const MODE_TIP = ' · again (or Alt): its next drawing mode';

function toolbar(ctx: UIContext): Node[] {
  const on = (name: string) => ctx.active === name;
  if (ctx.sketching)
    return [
      tool('select', 'Select and edit shapes (Esc stops sketching)', ctx.stopTool, !ctx.active),
      ...SHAPES.map(([kind, title]) => tool(kind, `${title}: draw into the sketch${MODED.includes(kind) ? MODE_TIP : ''}`, () => ctx.startTool(kind), on(kind))),
      rocket(ctx.cheer),
    ];
  return [
    tool('sketch', 'New sketch (S): click a face or empty space, or a face first, then this; then draw shapes on it', ctx.newSketch, on('sketch')),
    ...SHAPES.map(([kind, title]) => tool(kind, `${title}: draw one and pull it up (a click or Esc keeps it flat and starts sketching)${MODED.includes(kind) ? MODE_TIP : ''}`, () => ctx.startTool(kind), on(kind))),
    tool('sphere', 'Sphere (O): drag from its centre on a face or the ground · O or Alt again: two points across, three or four points, touching three planes', () => ctx.startTool('sphere'), on('sphere')),
    tool('plane', "Work plane: a green plane on a face clicked next (or the base plane facing you), moved by an offset (T: a point's distance, e.g. /2 for halfway); drawing tools draw on it", ctx.planeTool),
    h('hr'), // making above, organizing below
    tool(ctx.groupSelected ? 'ungroup' : 'group', ctx.groupSelected ? "Ungroup (⇧⌘G): the contents move to the group's parent, staying where they are" : 'Group (⌘G): the selection, or the objects clicked next (Enter groups them)', ctx.groupTool, on('group')),
    tool('duplicate', 'Duplicate (⌘D): the selection, or the body clicked next', ctx.duplicate, on('duplicate')),
    tool('delete', 'Delete (Del): the selection, or the body clicked next', ctx.remove, on('delete')),
    rocket(ctx.cheer),
  ];
}

/** Above the 3D view: the tools that edit things (shaping, moving, joints). */
function editbar(ctx: UIContext): Node[] {
  const on = (name: string) => ctx.active === name;
  if (ctx.sketching)
    return [
      tool('extrude', 'Extrude (E): the selected shapes, or the whole sketch, picked; click more, Enter pulls them', ctx.extrude, on('extrude')),
      tool('bulge', 'Bulge: the selected shapes (or the one clicked next) become a dome of their own', ctx.bulgeTool),
      tool('mirror', 'Mirror: the selected shapes across a line or edge clicked next: mirrored copies', ctx.mirrorTool),
      tool('offset', 'Offset: the selected shapes get outlines a distance outside (negative: inside; a line moves to its left)', ctx.offsetTool),
      h('hr'),
      Object.assign(tool('finish', 'Leave the sketch (Esc)', ctx.exitSketch), { className: 'tool ok' }),
    ];
  return [
    tool('extrude', 'Extrude (E): what is selected (shapes, a sketch, faces) is picked, Enter pulls it; or click a face or sketch shape (Shift-click: more, then Enter)', ctx.extrude, on('extrude')),
    tool('revolve', 'Revolve (U): closed sketch shapes (selected, or the outline clicked next) turned around a line or edge in their plane', ctx.revolveTool),
    tool('sweep', 'Sweep: a line or shape outline clicked (the path), then the outline of a closed sketch shape to run along it (the profile)', ctx.sweepTool),
    tool('loft', 'Loft (K): a body through closed sketch shapes of several sketches, their outlines clicked in order (Enter)', ctx.loftTool),
    tool('bulge', 'Bulge: a face swells out smoothly, its rim kept (flat: a dome, round: a vase), or closed sketch shapes become a dome; amount, curve and peak in a panel', ctx.bulgeTool),
    tool('draft', 'Draft: a flat face (Alt-picked, or clicked next) turns about its bottom side, 5° inward (Set axis: any edge as the hinge)', ctx.draftTool),
    h('hr'),
    h(
      'div',
      { className: 'flyout-at' },
      tool('boolean', 'Boolean: join, cut or intersect bodies (selected before or clicked after; the first keeps the result)', () => {
        flyout = !flyout;
        renderUI(ctx);
      }, flyout || on('boolean')),
      ...(flyout ? [h('div', { className: 'flyout menu' }, ...booleanMenu(ctx))] : []),
    ),
    tool('cut', "Cut: the selected bodies (else one clicked next) in two along a face's plane (turn and move it), a sketch line or shape, a ball or cylinder; keep both or delete one side", ctx.cutTool, on('cut')),
    tool('offset', 'Offset / Shell: selected sketch shapes get outlines a distance outside (or inside); a body (selected, or clicked next) is hollowed to walls, the faces clicked left open', ctx.offsetTool),
    tool('coat', 'Coat: a body (selected, or clicked next) made thicker all round, like paint', ctx.coatTool),
    tool('clash', 'Interference and clearance: where bodies overlap or come too close, also as their joints move', ctx.clashTool),
    tool('pattern', 'Pattern: copies of the selected bodies in a grid (counts, gap or overall size, a turn per copy) or around an axis (count, angle)', ctx.patternTool),
    tool('mirror', 'Mirror: selected bodies (or the ones clicked next, Enter) across a face clicked next (empty space: the base plane facing you): mirrored copies', ctx.mirrorTool),
    tool('thread', 'Thread: a round face of a hole or a shaft (Alt-picked, or clicked next): a thread cut into it (Modelled), or a pilot hole at tap-drill size with the thread only drawn (Pilot; a shaft: Plain), its size by the face\'s Ø first; the hole or shaft is resized to fit it', ctx.threadTool),
    h('hr'),
    tool('move', 'Move (M): type distances along X, Y and Z (Tab: the next); the selection, or what is clicked next', ctx.moveTool, on('move')),
    tool('rotate', 'Rotate (W): turn the selection (or what is clicked next) around an axis clicked next: an edge, line, circle or point', ctx.rotateTool),
    h(
      'div',
      { className: 'flyout-at' },
      tool('align', 'Align the selected objects by their boxes (bodies, groups as one, whole sketches); 2 or more, distribute 3 or more', () => {
        alignOpen = !alignOpen;
        renderUI(ctx);
      }, alignOpen),
      ...(alignOpen ? [h('div', { className: 'flyout menu align-menu' }, ...alignTools(ctx))] : []),
    ),
    tool('joint', 'Joint (J): a parent that stays (body or group), the objects that move, an axis (an edge, line or circle), hinge or slider with limits', ctx.jointTool),
    tool('attach', 'Attach: the selected objects (two or more) move and turn as one, at once; nothing selected: click them, then Enter', ctx.attachTool),
    tool('measure', 'Distance measure (D): click an edge (its length) or two points (how far apart along X / Y / Z, and straight); a click on a value copies it', ctx.measureTool),
  ];
}

/** The boolean flyout of the toolbar is open. */
let flyout = false;
// a click anywhere else closes the boolean and align menus
addEventListener('pointerdown', (e) => {
  if ((flyout || alignOpen) && !(e.target as Element).closest?.('.flyout-at')) {
    flyout = alignOpen = false;
    for (const m of document.querySelectorAll('.flyout-at .flyout')) m.remove();
    for (const b of document.querySelectorAll('.flyout-at > .tool.on')) b.classList.remove('on');
  }
}, true);
/** The align menu of the toolbar is open. */
let alignOpen = false;

/** How objects align: their box's min, middle or max along an axis onto all of theirs, equal gaps, or onto the first one's middle. */
export type ObjectAlign = `${'min' | 'mid' | 'max' | 'spread'}${'X' | 'Y' | 'Z'}` | 'first';

/** A row of a toolbar menu (as in incase): its icon and words; a click runs it and closes the menu. */
function menuItem(name: IconName, label: string, title: string, onclick: () => void, disabled = false) {
  return h('button', { className: 'menu-item', innerHTML: `${icon(name)}<span>${label}</span>`, title, disabled, onclick: () => ((flyout = alignOpen = false), onclick()) });
}

function alignTools(ctx: UIContext) {
  const n = ctx.selected.length;
  // per axis: the icons of incase's align menu (min, middle, max, distribute), the axis letter in its colour
  const icons: Record<'X' | 'Y' | 'Z', [IconName, IconName, IconName, IconName]> = { X: ['left', 'centerX', 'right', 'distributeX'], Y: ['bottom', 'centerY', 'top', 'distributeY'], Z: ['bottom', 'centerY', 'top', 'distributeY'] };
  const item = (how: ObjectAlign, name: IconName, label: string, title: string) =>
    Object.assign(menuItem(name, label, title, () => ctx.alignObjects(how), n < (how.startsWith('spread') ? 3 : 2)), { onmouseenter: () => ctx.previewAlign(how), onmouseleave: () => ctx.previewAlign(null) });
  return (['X', 'Y', 'Z'] as const).flatMap((a) => {
    const [lo, mid, hi, spread] = icons[a];
    const k = axisHtml(a);
    return [
      item(`min${a}`, lo, `${k} min`, `Their lowest ${a} onto the lowest of all`),
      item(`mid${a}`, mid, `${k} middle`, `Their middles onto the middle of all along ${a}`),
      item(`max${a}`, hi, `${k} max`, `Their highest ${a} onto the highest of all`),
      item(`spread${a}`, spread, `${k} distribute`, `Equal gaps along ${a}; the outermost stay (3 or more)`),
    ];
  }).concat(item('first', 'centerX', 'Middle on first', 'Their middles onto the middle of the first selected'));
}

/** The boolean menu's rows (as the align menu's). */
function booleanMenu(ctx: UIContext) {
  const ops: [BooleanOp, string, string][] = [
    ['union', 'Join', 'One body from all of them'],
    ['subtract', 'Cut', 'The others cut the first'],
    ['intersect', 'Intersect', 'Only where all of them overlap'],
  ];
  return [
    ...ops.map(([op, label, title]) => menuItem(op, label, title, () => ctx.boolean(op))),
    menuItem('fingers', 'Box joint', 'Bodies that overlap or touch cut into interlocking fingers (two, or a whole box: each pair that meets): for gluing sheets together', ctx.boxJoint),
  ];
}

function booleanTools(ctx: UIContext, picked = () => {}) {
  const ops: [BooleanOp, string][] = [
    ['union', 'Join: one body from all of them'],
    ['subtract', 'Cut: the others cut the first'],
    ['intersect', 'Intersect: only where all of them overlap'],
  ];
  return [...ops.map(([op, title]) => tool(op, title, () => (picked(), ctx.boolean(op)))), tool('fingers', 'Box joint: the bodies cut into interlocking fingers where they overlap or touch (several: each pair that meets)', () => (picked(), ctx.boxJoint()))];
}

/** Rows of the custom sections, in the section panel: on/off, name, offset, flip, delete; its turn and what it turns around. */
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
    const turnText = c.turn?.e.trim() ?? '0';
    // around its own line that line turns with the normal too, so the turn changes sign; around a set axis it does not
    const turnFlipped = c.axis || turnText === '0' ? turnText : isPlain(turnText) ? fmt(-parseFloat(turnText)) : `-(${turnText})`;
    const flip = button('⇄', () => set(i, { normal: c.normal.map((v) => -v) as typeof c.normal, offset: { ...c.offset, e: negated }, turn: { e: turnFlipped, u: doc.units } }), 'Keep the other side');
    const drop = deleteButton('Delete this section', () => ctx.commit({ ...doc, sections: doc.sections.filter((_, k) => k !== i) }));
    const turn = exprField(ctx, `sections.${i}.turn`, 'Turn °', true, { value: c.turn ?? { e: '0', u: doc.units }, set: (x, live) => ctx.setValue(['sections', String(i), 'turn'], x, live), error: ctx.exprErrors.get(`sections.${i}.turn`) });
    const axis = button('Set axis', () => ctx.sectionAxis(i), c.axis ? 'Click: Pick another line for it to turn around' : 'Click: Pick a line for it to turn around (now: a line in its plane)');
    return h('div', { className: 'custom' }, on, name, exprField(ctx, `sections.${i}.offset`, 'Offset'), flip, drop, h('div', { className: 'turn' }, turn, axis));
  });
}


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
    if (role(e, 'add') && lastEye?.list === list && rows.includes(lastEye.id)) {
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
    // hovered: it (a group: its contents; a body: its linked copies too) outlined orange in the view, and in the list and view
    // the boolean's other side: the body it cuts, or its tool bodies
    const tools = doc.bodies.find((b) => b.id === id)?.features.flatMap((f) => (f.type === 'boolean' ? [f.body] : [])) ?? [];
    const targets = doc.bodies.filter((b) => b.features.some((f) => f.type === 'boolean' && f.body === id)).map((b) => b.id);
    const pair = tools.length + targets.length > 0;
    const mark = (on: boolean) => pair && lightPair(on ? (r) => (tools.includes(r) ? 'bool-tool' : targets.includes(r) ? 'bool-target' : null) : null);
    el.onmouseenter = () => (ctx.lightBodies([id, ...doc.bodies.filter((b) => b.link === id).map((b) => b.id), ...tools, ...targets]), mark(true));
    el.onmouseleave = () => (ctx.lightBodies(null), mark(false));
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
      // a joint's or attach's end goes onto this object (all of it lit), objects between rows or into a group
      const onto = e.dataTransfer!.types.includes('application/x-joint') || where(e) === 'into';
      el.classList.add(onto ? 'drop' : `drop-${where(e)}`);
    };
    el.ondragleave = clear;
    el.ondrop = (e) => {
      e.preventDefault();
      clear();
      const joint = e.dataTransfer!.getData('application/x-joint');
      if (joint) {
        const { joint: j, from } = JSON.parse(joint) as { joint: string; from: string };
        return from !== id && ctx.moveJointEnd(j, from, id);
      }
      ctx.arrange(JSON.parse(e.dataTransfer!.getData('text/plain')), id, where(e));
    };
    return el;
  };
  // only groups fold: a chevron that turns down when open; other rows start at the left
  // a group folds with a chevron, a body with booleans with the boolean icon
  const fold = ({ id, open, kind }: Row) => {
    if (open === undefined) return [];
    const tools = doc.bodies.find((o) => o.id === id)?.features.filter((f) => f.type === 'boolean' && !f.free && !f.linked).length ?? 0;
    const copies = doc.bodies.filter((o) => o.link === id).length;
    // a body: its tool bodies (the boolean button) and linked copies (a chevron, as a group)
    const what = [tools ? `${tools} boolean tool bod${tools === 1 ? 'y' : 'ies'}` : '', copies ? `${copies} linked cop${copies === 1 ? 'y' : 'ies'}` : ''].filter(Boolean).join(' and ');
    const title = kind === 'body' ? `${open ? 'Hide' : 'Show'} its ${what}` : open ? 'Fold' : 'Unfold';
    const bool = kind === 'body' && tools > 0;
    return [h('button', { className: `icon fold${bool ? ' bool' : ''}${open ? ' open' : ''}`, innerHTML: icon(bool ? 'boolean' : 'chevron'), title, onclick: () => ctx.toggleFold(id) })];
  };
  /**
   * A row's name: a plain click on the name of the only selected row edits it in place (Enter or leaving the field
   * saves it, Esc keeps it); `at`: where the name is stored.
   */
  const nameOf = (id: string, name: string, at: string[]) => {
    const only = ctx.selected.length === 1 && ctx.selected[0] === id;
    if (renaming !== id)
      return h('span', { className: 'name', textContent: name, onclick: (e) => only && !toggles(e) && (renaming = id) });
    const el = input(`list.${id}`, name, (text) => ((renaming = null), ctx.commit(setIn(doc, at, text))));
    el.className = 'rename';
    el.addEventListener('blur', () => !rendering && renaming === id && ((renaming = null), renderUI(ctx)));
    return el;
  };
  const sketchIcon = () => h('span', { className: 'kind', innerHTML: icon('sketch') });
  /** A joint's parent or moving object: the joint icon, an attach's anchor (hovered, its moving objects light; a click selects it to edit the joint). */
  const jointMark = (id: string) => {
    const j = doc.joints.find((x) => x.parent === id || x.children.includes(id));
    if (!j) return [];
    const parent = j.parent === id;
    // an attach's icon breaks it, as a linked copy's unlinks
    const title = j.kind === 'attach' ? `${j.name}: moves as one with the others · hover: what goes along · click: break it (Undo brings it back) · drag onto another object: it takes this one's place` : `${j.name}: ${parent ? 'stays, the others move' : 'moves'} (${j.kind}) · hover: what moves · click: edit it · drag onto another object: it takes this one's place`;
    const el = h('button', { className: `icon joint${parent ? ' parent' : ''}`, innerHTML: icon(j.kind === 'attach' ? 'attach' : 'joint'), title, onclick: () => (j.kind === 'attach' ? ctx.breakAttach(j.id) : ctx.editJoint(j.id)) });
    // hovered: what stays and what moves light in the list (in two colours) and in the view
    const light = (on: boolean) => {
      lightPair(on ? (r) => (r === j.parent ? 'joint-static' : j.children.includes(r) ? 'joint-moving' : null) : null);
      ctx.showJoint(on ? j.id : null);
    };
    el.onmouseenter = () => light(true);
    el.onmouseleave = () => light(false);
    // dragged onto another row: that object takes this one's place in the joint
    el.draggable = true;
    el.ondragstart = (e) => {
      e.stopPropagation(); // not the row's own drag
      e.dataTransfer!.setData('application/x-joint', JSON.stringify({ joint: j.id, from: id }));
    };
    return [el];
  };
  /** A row's marks (sketch, joint, link …) in a column as wide in every row as the most any row has (`--marks`): names all as wide. */
  let most = 1;
  const marked = (marks: HTMLElement[]) => ((most = Math.max(most, marks.length)), h('span', { className: 'marks' }, ...marks));
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
      return row(id, depth, true, listItem(id, `${selectedClass(id)} group`, pick, chevron, nameOf(id, g.name, ['groups', String(i), 'name'])), marked(jointMark(id)), eye('objects', id, g.visible));
    }
    const i = doc.bodies.findIndex((q) => q.id === id);
    const p = doc.bodies[i];
    const swatch = h('span', { className: 'swatch' });
    swatch.style.background = lookOf(ctx.doc, p).color;
    const look = eye('objects', p.id, p.visible);
    look.title += ` · ${MAC ? '⌘' : 'Ctrl'}-click: show only this body`;
    const isolate = (e: MouseEvent) => (e.preventDefault(), ctx.isolate(p.id));
    look.onclick = (e) => (mod(e) || ctx.isolated === p.id ? isolate(e) : eyeClick('objects', p.id, !p.visible, e, setShown));
    if (ctx.isolated === p.id) Object.assign(look, { className: 'icon isolated', title: 'Shown alone: click to show the others again', innerHTML: icon('isolate') });
    // a sketch group open, or a group's objects selected: the others are see-through; the eye switches one to fully shown and back (V still hides)
    else if ((ctx.sketching || (ctx.grouped && !ctx.grouped.has(p.id))) && p.visible) {
      const full = ctx.solid.has(p.id);
      const when = ctx.sketching ? 'the sketch group is open' : 'its group is selected';
      Object.assign(look, { innerHTML: icon(full ? 'eye' : 'eyeFaded'), title: full ? 'Shown fully: click to make it see-through again' : `See-through while ${when}: click to show it fully`, onclick: (e: MouseEvent) => eyeClick('solid', p.id, !full, e, ctx.setSolid) });
    }
    // its sketches have their own list: this button draws into the (first) one
    const own = sketchesOf(doc, p.id);
    const bools = fold(r); // an owner of tool bodies: the red boolean button folds them
    const sketch = own.length ? [h('button', { className: 'icon', innerHTML: icon('sketch'), title: `Based on sketch: ${own.map((q) => q.name).join(', ')}`, onclick: () => ctx.editSketch(own[0].id) })] : [];
    // a boolean's tool body: the op, and whose
    const user = doc.bodies.find((o) => o.features.some((f) => f.type === 'boolean' && f.body === id && !f.linked));
    const op = user?.features.find((f) => f.type === 'boolean' && f.body === id && !f.linked);
    // a boolean's tool body: the op as a button in the eye's place (whose; a click frees it)
    const tool =
      op?.type === 'boolean'
        ? h('button', { className: 'icon tool-op', innerHTML: icon(op.op), title: `${{ union: 'Joined to', subtract: 'Cuts', intersect: 'Intersects' }[op.op]} ${user!.name} · click: free it from the boolean`, onclick: () => ctx.commit(freed(doc, id)) })
        : look;
    // listed on its own: its eye too (on: its outlines show all the time; off: only while selected)
    const toolEye = op?.type === 'boolean' && op.free ? [look] : [];
    // linked copies: the link mark on the copies; on their source a button that breaks the links
    const source = doc.bodies.find((b) => b.id === p.link);
    const copies = doc.bodies.filter((b) => b.link === p.id).map((b) => b.id);
    const linked = source
      ? [h('button', { className: 'icon linked-mark', innerHTML: icon('link'), title: `Linked copy of ${source.name}: it shares its steps (edits on any of them go to all) · click: unlink it (its own steps, on its own in the list)`, onclick: () => ctx.unlinkCopy(p.id) })]
      : copies.length
        ? [h('button', { className: 'icon linked-mark', innerHTML: icon('link'), title: `Its ${copies.length} linked cop${copies.length === 1 ? 'y shares' : 'ies share'} its steps · click: break the links (each its own object, together in a new group "${p.name}")`, onclick: () => ctx.breakLinks(p.id) })]
        : [];
    // a box joint: its button opens its panel
    const finger = p.features.find((f) => f.type === 'fingers');
    const joint = finger ? [h('button', { className: 'icon', innerHTML: icon('fingers'), title: `Box joint with ${doc.bodies.find((b) => b.id === (finger as { body: string }).body)?.name ?? 'a deleted body'}: click to edit it`, onclick: () => ctx.editFingers(p.id, finger.id) })] : [];
    const el = row(id, depth, false, listItem(id, selectedClass(id), (how) => ctx.deselectAgain(id, how) || ctx.select(id, how), swatch, nameOf(id, p.name, ['bodies', String(i), 'name'])), marked([...linked, ...joint, ...sketch, ...bools, ...jointMark(id)]), tool, ...toolEye);
    return el;
  });
  // sketches: their own list, each with the body it belongs to
  const sketchRows = doc.sketches.map((sk, i) => {
    const owner = doc.bodies.find((b) => b.id === ownerOf(doc, sk.id));
    // a plain click draws into it: sketch mode, looking at its plane
    const item = listItem(sk.id, selectedClass(sk.id), (how) => ctx.deselectAgain(sk.id, how) || (how === false ? ctx.editSketch(sk.id) : ctx.select(sk.id, how)), sketchIcon(), nameOf(sk.id, sk.name, ['sketches', String(i), 'name']));
    item.title = `${whose(doc, sk.id)} · click to draw into it`;
    item.onmouseenter = () => ctx.lightSketch(sk.id);
    item.onmouseleave = () => ctx.lightSketch(null);
    // its body, like a body's sketch button: a click selects it
    const body = marked(owner ? [h('button', { className: 'icon', innerHTML: icon('body'), title: `Object derived: ${owner.name}`, onclick: () => ctx.select(owner.id) })] : []);
    return h('div', { className: `listed${dimmed(sk.id, 'sketches')}` }, item, body, eye('sketches', sk.id, sk.visible));
  });
  /** A list's title: a click folds it; objects and sketches have an eye that hides all of them for now (their eyes stay). */
  const heading = (key: 'objects' | 'sketches' | 'params' | 'planes' | 'images', label: string, kind?: Parameters<typeof icon>[0]) => {
    const open = !ctx.folded.has(`list:${key}`);
    const title = h('h3', { className: 'fold-head', title: open ? 'Fold' : 'Unfold', onclick: () => ctx.toggleFold(`list:${key}`) }, h('span', { className: `fold${open ? ' open' : ''}`, innerHTML: icon('chevron') }), ...(kind ? [h('span', { className: 'kind', innerHTML: icon(kind) })] : []), label);
    const hidden = (key === 'objects' || key === 'sketches') && ctx.hideAll[key];
    const all = key !== 'objects' && key !== 'sketches' ? [] : [h('button', { className: 'icon', innerHTML: icon(hidden ? 'eyeOff' : 'eye'), title: hidden ? 'Show them again as they were' : 'Hide all for now (each eye stays as it is)', onclick: () => ctx.toggleHideAll(key) })];
    return { open, head: h('div', { className: 'tree-head' }, title, ...all) };
  };
  const { open: objectsOpen, head } = heading('objects', 'Objects', 'body');
  const sketchList = heading('sketches', 'Sketches', 'sketch');
  const paramList = heading('params', 'Parameters', 'param');
  const planeList = heading('planes', 'Work planes', 'plane');
  const imageList = heading('images', 'Images', 'image');
  const imageRows = doc.images.map((im, i) => {
    // a click on the one selected takes it off again
    const item = listItem(im.id, selectedClass(im.id), (how) => ctx.deselectAgain(im.id, how) || ctx.select(im.id, how), h('span', { className: 'kind', innerHTML: icon('image') }), nameOf(im.id, im.name, ['images', String(i), 'name']));
    item.onmouseenter = () => ctx.lightImage(im.id);
    item.onmouseleave = () => ctx.lightImage(null);
    const look = h('button', { className: 'icon', title: im.visible ? 'Hide' : 'Show', innerHTML: icon(im.visible ? 'eye' : 'eyeOff'), onclick: () => ctx.commit(setIn(doc, ['images', String(i), 'visible'], !im.visible)) });
    return h('div', { className: 'listed' }, item, look);
  });
  const planeRows = doc.planes.map((w, i) => {
    const item = listItem(w.id, selectedClass(w.id), (how) => ctx.deselectAgain(w.id, how) || ctx.select(w.id, how), h('span', { className: 'kind plane-swatch' }), nameOf(w.id, w.name, ['planes', String(i), 'name']));
    item.onmouseenter = () => ctx.lightPlane(w.id);
    item.onmouseleave = () => ctx.lightPlane(null);
    const edit = h('button', { className: 'icon', title: 'Edit it in its panel: how it is made, offset, turn, points, size', innerHTML: icon('edit'), onclick: () => ctx.editPlane(w.id) });
    const look = h('button', { className: 'icon', title: w.visible ? 'Hide' : 'Show', innerHTML: icon(w.visible ? 'eye' : 'eyeOff'), onclick: () => ctx.commit(setIn(doc, ['planes', String(i), 'visible'], !w.visible)) });
    return h('div', { className: 'listed' }, item, edit, look);
  });
  head.ondragover = (e) => (e.preventDefault(), head.classList.add('drop'));
  head.ondragleave = () => head.classList.remove('drop');
  head.ondrop = (e) => (e.preventDefault(), ctx.moveInto(JSON.parse(e.dataTransfer!.getData('text/plain')), null));
  const params = Object.keys(doc.params).map((name) =>
    h(
      'div',
      { className: 'param' },
      exprField(ctx, `params.${name}`, name, true),
      h('span', { className: 'value' }, ctx.paramValue(name)),
      deleteButton('Delete parameter', () => {
        const { [name]: _, ...rest } = doc.params;
        ctx.commit({ ...doc, params: rest });
      }),
    ),
  );
  const addParam = input('new-param', '', (text) => {
    const m = /^\$?([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(text); // its $ is added if left out
    const name = m && `$${m[1]}`;
    if (!m || !name || Object.hasOwn(doc.params, name)) {
      return ctx.notify(m ? `"${name}" exists` : 'use: $name = expression');
    }
    ctx.commit({ ...doc, params: { ...doc.params, [name]: { e: m[2], u: doc.units } } });
  });
  addParam.placeholder = '$name = expression';
  Object.assign(addParam.dataset, { complete: '', noMeasure: '' }); // a name is typed here: D is a letter

  const none = doc.bodies.length ? [] : [h('p', { className: 'hint' }, 'Draw a shape (R, C, L) to start a body.')];
  // a list: its heading always in reach, its contents scrolling below it
  const section = (key: string, title: Node, open: boolean, contents: Node[]) => {
    const body = h('div', { className: 'list-body' }, ...contents);
    body.dataset.list = key;
    body.style.setProperty('--marks', String(most));
    return h('div', { className: 'list-section' }, title, ...(open ? [body] : []));
  };
  return [
    section('objects', head, objectsOpen, [...rows, ...none]),
    section('sketches', sketchList.head, sketchList.open, sketchRows),
    ...(doc.planes.length ? [section('planes', planeList.head, planeList.open, planeRows)] : []),
    ...(doc.images.length ? [section('images', imageList.head, imageList.open, imageRows)] : []),
    section('params', paramList.head, paramList.open, [...params, addParam]),
  ];
}

function right(ctx: UIContext): Node[] {
  if (ctx.renders.open) return rendersPanel(ctx);
  // renders going on while the panel is closed: a status row on top
  const busy = ctx.doc.renders.filter((r) => ['waiting', 'rendering'].includes(ctx.renders.jobs.get(r.id)?.state ?? ''));
  const now = busy.find((r) => ctx.renders.jobs.get(r.id)!.state === 'rendering');
  const status = busy.length
    ? [h('button', { className: 'render-status', onclick: ctx.renders.toggle, title: 'Show the renders' }, `Rendering${busy.length > 1 ? ` (${busy.length} queued)` : ''}: `, now ? percent(now.id, ctx.renders.jobs.get(now.id)!.done) : '0 %')]
    : [];
  // a row with a measure shows it in the view while hovered
  const infoRow = ([k, v, what]: [string, string, Measure?]) => {
    const cells = [h('dt', { innerHTML: sizeHtml(k) }), h('dd', {}, v)];
    if (what !== undefined) for (const c of cells) Object.assign(c, { className: 'measures', onmouseenter: () => ctx.showMeasure(what), onmouseleave: () => ctx.showMeasure(null) });
    return cells;
  };
  const aboutTip = 'About: values with ~ are read from the triangles drawn in the view, so on curves they can be slightly off. The Distance measure reads the real geometry.';
  const aboutIcon = ctx.info?.rows.some((r) => r[1].startsWith('~')) ? [h('span', { className: 'info-about', title: aboutTip, innerHTML: icon('info') })] : [];
  const note = ctx.info?.note ? [h('p', { className: 'hint' }, ctx.info.note)] : [];
  const info = ctx.info ? [h('section', { className: 'info' }, h('h3', {}, `Info · ${ctx.info.title}`, ...aboutIcon), h('dl', {}, ...ctx.info.rows.flatMap(infoRow)), ...note)] : [];
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
    // not rendered yet: the thumbnail (the view's shape) cut to its Aspect from the middle
    if (!job && !shot.results.length && shot.aspect !== 'view') {
      const [a, b] = (shot.aspect ?? '16:9').split(':').map(Number);
      Object.assign(picture.style, { aspectRatio: `${a} / ${b}`, objectFit: 'cover', [a / b > 16 / 9 ? 'width' : 'height']: '100%' });
    }
    // rendered more than once: the older results below, newest first
    const older = shot.results.slice(job?.canvas ? 0 : 1).map((r) => h('img', { src: r.preview, title: `${r.nice ? 'Rendered' : 'Snapshot'} ${new Date(r.at).toLocaleString()}` }));
    const c = shotCamera(shot.camera, shot.aspect);
    const how = `${c.ortho ? 'Ortho' : `Persp ${Math.round(c.fov)}°`} · ${c.size[0]} × ${c.size[1]} px`;
    const aspect = select<string>(shot.aspect ?? '16:9', ASPECTS, (v) => ctx.commit(setIn(doc, ['renders', String(i), 'aspect'], v)));
    aspect.title = 'The shape of its picture (its next render)';
    const last = shot.results[0];
    const state = !job
      ? last
        ? `${last.nice ? 'Rendered' : 'Snapshot'} ${new Date(last.at).toLocaleString()}`
        : 'Not rendered yet'
      : job.state === 'waiting'
        ? 'Waiting'
        : job.state === 'rendering'
          ? h('span', {}, 'Rendering ', percent(shot.id, job.done))
          : job.state === 'done'
            ? 'Done'
            : job.error ?? 'Failed';
    const bar = job?.state === 'rendering' ? [h('div', { className: 'track' }, progressEl(h('div', { className: 'fill' }), shot.id, job.done))] : [];
    const busy = job?.state === 'waiting' || job?.state === 'rendering';
    const nice = shot.results.some((r) => r.nice);
    const main = [
      busy ? button('Cancel', () => renders.cancel(shot.id)) : Object.assign(button(nice ? 'Render again' : 'Render nice', () => renders.again(shot.id), 'Render this view nicely with the model as it is now (saves itself)'), { className: 'primary' }),
      ...(job?.state === 'done' ? [button('Download', () => renders.download(shot.id), 'Save the picture')] : []),
    ];
    const more = [
      button('Use view', () => renders.useView(shot.id), 'Turn the 3D view to this camera'),
      button('Live render', () => renders.live(shot.id), 'See it in a live render view with this camera and background: it renders again whenever something changes, Save adds a version here'),
      button('Versions', () => renders.versions(shot.id), 'All its pictures, newest first (with a render folder: every one saved there, full size)'),
    ];
    const remove = Object.assign(deleteButton('Delete this render', () => ctx.commit({ ...doc, renders: doc.renders.filter((r) => r !== shot) })), { className: 'icon danger remove' });
    // its photo sphere, for the next render of this view
    const spheres = [...BUILT_IN_PHOTOS, ...ctx.photos()];
    const photos = [
      h('div', { className: 'row' }, h('span', {}, 'Photo'), select(shot.background.photo?.id ?? '', { '': 'None', ...Object.fromEntries(spheres.map((p) => [p.id, p.name])) }, (id) => {
        const { photo: _, ...rest } = shot.background;
        ctx.commit(setIn(doc, ['renders', String(i), 'background'], id ? { ...rest, photo: { id, turn: shot.background.photo?.turn ?? 0 } } : rest));
      })),
      ...(shot.background.photo ? [h('div', { className: 'row light' }, h('span', {}, 'Turn'), turnSlider(ctx, i, shot.background.photo.turn))] : []),
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
      h('div', { className: 'picture', title: 'Click: Versions', onclick: () => renders.versions(shot.id) }, picture),
      ...bar,
      ...(older.length ? [h('div', { className: 'older' }, ...older)] : []),
      h('div', { className: 'listed' }, h('strong', {}, state), remove),
      h('div', { className: 'hint', title: `Made ${new Date(shot.at).toLocaleString()}` }, how),
      h('div', { className: 'row' }, h('span', {}, 'Aspect'), aspect),
      h('div', { className: 'row', title: 'Background of the next render of this view: above and below the horizon (the same twice: solid)' }, h('span', {}, 'Background'), h('span', { className: 'backdrop-pick' }, colour('top', 'Above the horizon'), colour('bottom', 'Below'))),
      ...photos,
      h('div', { className: 'row' }, h('span', {}, 'Light'), button('Edit…', ctx.openRenderLight, 'The light every render of this file takes: Settings, Light, Rendering')),
      h('div', { className: 'actions' }, ...main),
      h('div', { className: 'actions' }, ...more),
    );
  });
  return [
    h('div', { className: 'head' }, h('h3', {}, 'Renders'), closeButton('Close the renders', renders.toggle)),
    h('button', { className: 'primary wide', onclick: renders.shoot, title: 'Render the view as it is now; renders queue up' }, 'Render this view'),
    ...renderFolderRow(renders),
    h('p', { className: 'hint' }, 'Each render keeps its camera and background (new ones take the background of the settings), its light comes from Settings, Light, Rendering: Render again renders the same view with the model as it is now and saves itself (Save to: Downloads, or a folder keeping every version). Snapshots land here too. Full pictures stay until the page reloads; small copies are saved in the file.'),
    ...shots,
  ];
}

/** A render's progress, marked so `showRenderProgress` updates it in place. */
const progressEl = <T extends HTMLElement>(el: T, id: string, done: number) => ((el.dataset.progress = id), setProgress(el, done), el);
const percent = (id: string, done: number) => progressEl(h('span'), id, done);
const setProgress = (el: HTMLElement, done: number) => (el.classList.contains('fill') ? (el.style.width = `${done * 100}%`) : (el.textContent = `${Math.floor(done * 100)} %`));

/** A render's progress shown again in place: drawing the panel anew would close an open dropdown. */
export function showRenderProgress(id: string, done: number) {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-progress="${id}"]`)) setProgress(el, done);
}

/** Where finished renders go: Downloads, or a folder that keeps every version (next to the document, its ./renderings, or picked). */
function renderFolderRow(renders: UIContext['renders']) {
  if (!renders.folder.can) return [];
  const { to, lost, saved } = renders.folder;
  const unsaved = saved ? '' : ' (save the document first)';
  // lost: shown as such on top, so picking the same place again is a change
  const options = { ...(to && lost ? { lost: `${to.name}: missing, pick again` } : {}), downloads: 'Downloads', beside: `Next to the document${unsaved}`, renderings: `./renderings${unsaved}`, ...(to?.kind === 'picked' ? { picked: to.name } : {}), pick: 'Pick a folder…' };
  const list = select<string>(to && lost ? 'lost' : (to?.kind ?? 'downloads'), options, (v) => (v === 'pick' ? renders.pickFolder('picked', true) : renders.pickFolder(v === 'downloads' ? undefined : (v as RenderTo))));
  for (const o of list.options) o.disabled = !saved && (o.value === 'beside' || o.value === 'renderings');
  list.title = `Where finished renders are saved: Downloads (Render again and snapshots), or a folder that keeps every version of every render${to ? ` (now ${to.name})` : ''}. Next to the document and ./renderings ask once for the document's folder`;
  if (lost) list.classList.add('invalid');
  return [h('div', { className: 'row' }, h('span', { className: 'hint' }, 'Save to'), list)];
}

/** How far a render's photo sphere is turned, degrees. */
function turnSlider(ctx: UIContext, i: number, turn: number) {
  let live = false;
  const el = h('input', { type: 'range', min: '-180', max: '180', step: '1', value: String(turn), title: 'Turn the photo around, degrees' });
  el.oninput = () => (ctx.setValue(['renders', String(i), 'background', 'photo', 'turn'], +el.value, live), (live = true));
  el.onchange = () => (live = false);
  return el;
}

/**
 * The material of the selected bodies or groups: a list to pick from (`inherited`: what they get without one), New and
 * Edit open the materials dialog; looks are edited only there.
 */
function materialRows(ctx: UIContext, ids: string[], inherited: string, lead: HTMLElement[] = [], heading = true): Node[] {
  const { doc } = ctx;
  const objects = [...doc.bodies, ...doc.groups].filter((x) => ids.includes(x.id));
  const same = objects.every((x) => x.material === objects[0]?.material) ? objects[0]?.material : undefined;
  const option = (value: string, text: string) => h('option', { value, textContent: text, selected: value === (same ?? '') });
  const chapter = (label: string, materials: Material[]) => (materials.length ? [h('optgroup', { label }, ...materials.map((m) => option(m.id, m.name)))] : []);
  // the same chapters, in the same order, as the materials dialog
  const list = h('select', { title: 'Its material' }, option('', inherited), ...chapter('In this file', doc.materials), ...STANDARD_SECTIONS.flatMap(([name, materials]) => chapter(name, materials)), option('new', '+ New…'));
  list.onchange = () => (list.value === 'new' ? ctx.openMaterials(true) : ctx.setMaterialOf(ids, list.value || undefined));
  return [...(heading ? [h('h3', {}, 'Material')] : []), h('div', { className: 'row material' }, ...lead, list, tool('material', 'Edit material…', () => ctx.openMaterials()))];
}

/** An image's card: name, Delete; width (mm), opacity, a colour shown transparent (and how far off still counts), Calibrate. */
function imagePanel(ctx: UIContext, i: number): Node[] {
  const { doc } = ctx;
  const im = doc.images[i];
  const at = (key: string) => ['images', String(i), key];
  // sliders: live, one undo step per drag
  const slider = (key: 'opacity' | 'tolerance', title: string) => {
    let live = false;
    const el = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(im[key]), title });
    el.oninput = () => (ctx.setValue(at(key), +el.value, live), (live = true));
    el.onchange = () => (live = false);
    return el;
  };
  const width = h('input', { value: String(+im.width.toFixed(3)), title: 'Width in mm (Calibrate sets it from two points)' });
  width.onchange = () => +width.value > 0 && ctx.commit(setIn(doc, at('width'), +width.value));
  const colour = h('input', { type: 'color', value: im.key ?? '#ffffff', title: 'This colour is shown transparent', className: 'color' });
  colour.onchange = () => ctx.commit(setIn(doc, at('key'), colour.value));
  return [
    h('div', { className: 'head' }, input(`images.${i}.name`, im.name, (name) => ctx.commit(setIn(doc, at('name'), name))), deleteButton('Delete the image', () => ctx.commit({ ...doc, images: doc.images.filter((x) => x !== im) }))),
    h('div', { className: 'row' }, h('label', { className: 'field' }, h('span', {}, 'Width mm'), width), button('Calibrate', () => ctx.calibrate(im.id), 'Click two points on the picture, then type their real distance')),
    h('div', { className: 'row' }, ...[0, 1, 2].map((k) => {
      const el = h('input', { value: String(+im.frame.o[k].toFixed(3)), title: `Its middle along ${'XYZ'[k]}, mm` });
      el.onchange = () => Number.isFinite(+el.value) && ctx.commit(setIn(doc, ['images', String(i), 'frame', 'o', String(k)], +el.value));
      return h('label', { className: 'field' }, h('span', { innerHTML: axisHtml('XYZ'[k]) }), el);
    }), tool('rotate', 'Rotate it around its middle', ctx.rotateTool)),
    h('div', { className: 'row' }, h('span', {}, 'Opacity'), slider('opacity', 'How much it hides what lies behind it')),
    h('div', { className: 'row' }, h('span', {}, 'Transparent'), colour, ...(im.key ? [slider('tolerance', 'How far off the colour still turns transparent'), button('×', () => ctx.commit(setIn(doc, at('key'), null)), 'No colour transparent')] : [])),
    h('p', { className: 'hint' }, 'A picture to draw over, on the plane it was dropped on; a PNG keeps its own transparency. Drag it to move it, a corner to resize it (Alt: from its middle). Calibrate: two points on it and their real distance.'),
  ];
}

/** What a body without its own material gets, as the list's first entry. */
function inheritedLabel(ctx: UIContext, body: Body) {
  const bare = { ...body, material: undefined };
  const m = setLook(ctx.doc, bare) as Material | undefined;
  return m ? `From its group${m.name ? `: ${m.name}` : ''}` : 'Material: Colour only';
}

function selectionPanel(ctx: UIContext): Node[] {
  const n = ctx.selected.length;
  if (n > 1)
    return [
      h('p', { className: 'hint' }, `${n} bodies selected: drag, nudge, duplicate or delete them together; select one to edit it.`),
      ...materialRows(ctx, ctx.selected, 'From their groups'),
      h('h3', {}, 'Boolean'),
      h('p', { className: 'hint' }, 'The first selected body keeps the result; the others become its tool bodies: they move with it and stay editable (selected, they show as red outlines).'),
      h('div', { className: 'aligns' }, ...booleanTools(ctx)),
    ];
  const k = ctx.doc.sketches.findIndex((s) => s.id === ctx.selected[0]);
  if (k >= 0) return sketchPanel(ctx, k);
  const wi = ctx.doc.planes.findIndex((w) => w.id === ctx.selected[0]);
  if (wi >= 0) {
    const w = ctx.doc.planes[wi];
    return [
      h('div', { className: 'head' }, input(`planes.${wi}.name`, w.name, (name) => ctx.commit(setIn(ctx.doc, ['planes', String(wi), 'name'], name))), deleteButton('Delete the work plane (sketches on it lose their plane)', () => ctx.commit({ ...ctx.doc, planes: ctx.doc.planes.filter((x) => x !== w) }))),
      h('div', { className: 'row' }, exprField(ctx, `planes.${wi}.offset`, 'Offset'), ...(w.mode !== 'points' && w.axis && !w.points.length ? [exprField(ctx, `planes.${wi}.turn`, 'Turn °', true)] : []), button('✎', () => ctx.editPlane(w.id), 'Edit it in its panel: how it is made, offset, turn, points to pass through')),
      // the points it passes through, each editable
      ...w.points.map((_, k) =>
        h('div', { className: 'row' }, ...['X', 'Y', 'Z'].map((a, c) => exprField(ctx, `planes.${wi}.points.${k}.${c}`, `${a}${k + 1}`)), deleteButton('Leave this point out', () => ctx.commit(setIn(ctx.doc, ['planes', String(wi), 'points'], w.points.filter((__, j) => j !== k))))),
      ),
      h('div', { className: 'row' }, button('Draw on it', () => ctx.drawOn(w.id), 'A new sketch on it, opened (drawing tools also draw on it directly)')),
      h('p', { className: 'hint' }, `${{ face: 'On a face (✎: Set axis to turn it)', edge: w.points.length ? 'Along an edge, through a point' : 'Along an edge, turned around it (✎: click a point instead)', points: `Through ${w.points.length} of 3 points (✎: click more; a fourth drops the first)` }[w.mode]}; moved along its normal by Offset (T: a clicked point's distance, type on, e.g. /2 for halfway). Sketches on it follow it.`),
    ];
  }
  const ii = ctx.doc.images.findIndex((im) => im.id === ctx.selected[0]);
  if (ii >= 0) return imagePanel(ctx, ii);
  const gi = ctx.doc.groups.findIndex((g) => g.id === ctx.selected[0]);
  if (gi >= 0) return groupPanel(ctx, gi);
  const i = ctx.doc.bodies.findIndex((p) => p.id === ctx.selected[0]);
  if (i < 0) return [h('p', { className: 'hint' }, 'Select a body or a sketch.')];
  const body = ctx.doc.bodies[i];
  const at = `bodies.${i}`;
  const setBody = (next: Body) => ctx.commit(setIn(ctx.doc, ['bodies', String(i)], next));
  const failure = ctx.kernelErrors.get(body.id);
  // a boolean's tool body: whose, and a way out
  const user = ctx.doc.bodies.find((o) => o.features.some((f) => f.type === 'boolean' && f.body === body.id && !f.linked));
  const freeing = user
    ? [
        h(
          'div',
          { className: 'row' },
          h('span', { className: 'hint' }, `A tool body of ${user.name}`),
          button('Fold', () => ctx.foldTool(body.id, true), `Click: Fold it into ${user.name}'s step: it leaves the list, nothing is lost (History unfolds it)`),
          button('Free from boolean', () => ctx.commit(freed(ctx.doc, body.id)), 'Remove the booleans that use it: it becomes a normal body again'),
        ),
      ]
    : [];

  // a linked copy's steps are its source's: editing them edits all copies
  const si = ctx.doc.bodies.findIndex((b) => b.id === (body.link ?? body.id));
  const steps = ctx.doc.bodies[si];
  const setSteps = (next: Body) => ctx.commit(setIn(ctx.doc, ['bodies', String(si)], next));
  // a body with a material has that material's colour
  const colour = setLook(ctx.doc, body)
    ? []
    : [
        h('input', {
          type: 'color',
          value: body.color,
          title: 'Colour',
          className: 'color',
          // the panel is not rebuilt while picking: that would close the picker
          oninput: (e) => ctx.previewColor(body.id, (e.target as HTMLInputElement).value),
          onchange: (e) => setBody({ ...body, color: (e.target as HTMLInputElement).value }),
        }),
      ];
  const shape = dimensions(ctx, steps, si);
  const card = (feature: Feature, j: number) => featureCard(ctx, steps, feature, `bodies.${si}.features.${j}`, setSteps);
  return [
    h('div', { className: 'head' }, input(`${at}.name`, body.name, (name) => setBody({ ...body, name })), deleteButton('Delete the body (with its cutters)', ctx.remove)),
    ...freeing,
    ...linkedNote(ctx, body),
    // its first step as Dimensions (else its card)
    shape ?? card(steps.features[0], 0),
    placing(ctx, at),
    ...(failure ? [h('p', { className: 'error', title: COPY_TIP }, `${stepName(steps, steps.features.find((f) => f.id === failure.featureId) ?? steps.features[0])}: ${failure.error}`)] : []),
    ...finishRows(ctx, steps, si, setSteps),
    ...toolsRow(ctx, body),
    ...materialRows(ctx, [body.id], inheritedLabel(ctx, body), colour, false),
    history(ctx, steps, setSteps, card, body.id),
    // a linked copy's own steps after its source's (a mirror)
    ...(body.link ? body.features.map((f, j) => featureCard(ctx, body, f, `${at}.features.${j}`, setBody)) : []),
    ...jointCards(ctx, body.id),
  ];
}

/**
 * The size fields of shape `p` at `path`, as its card edits them: a rectangle's L and W as stored, a polygon's
 * measured, a circle's or regular polygon's Ø.
 */
function sizeFields(ctx: UIContext, path: string, p: Profile): HTMLElement[] {
  const u = ctx.doc.units;
  const mm = (v: number): Expr => ({ e: fmt(v / UNITS[u]), u });
  if (p.kind === 'circle' || p.kind === 'ngon') return [shapeField(ctx, path, 'd', 'Ø', p.d)];
  if (p.kind === 'rect') return [shapeField(ctx, path, 'w', 'L', p.w), shapeField(ctx, path, 'h', 'W', p.h)];
  const m = ctx.measure(path.split('.'));
  return [shapeField(ctx, path, 'w', 'L', mm(m.w)), shapeField(ctx, path, 'h', 'W', mm(m.h))];
}

/** One field of shape `p` at `path` (size, place or turn), set as its transform says (the reference point stays); a size hovered draws it. */
function shapeField(ctx: UIContext, path: string, field: ShapeField, label: string, value: Expr, raw = false) {
  const el = exprField(ctx, `${path}.@${field}`, label, raw, { value, set: (x, live) => ctx.transformShape(path.split('.'), field, x, live), error: ctx.exprErrors.get(`${path}.${field}`) });
  return field === 'w' || field === 'h' || field === 'd' ? sizeHover(ctx, el, path, field) : el;
}

/** A labelled row as the body's Dimensions, Position and Rotation: its name, then up to three fields. */
const labelled = (label: string, ...fields: HTMLElement[]) => h('div', { className: 'placing' }, h('span', {}, label), ...fields);

/**
 * A step's shape as the body's own fields: Dimensions (L W or Ø, a regular polygon's sides, then `more`: its H),
 * and with `place` Position (X Y in its plane) and Rotation (its turn).
 */
function shapeRows(ctx: UIContext, path: string, p: Profile, place: boolean, more: HTMLElement[] = []): HTMLElement[] {
  const m = ctx.measure(path.split('.'));
  const u = ctx.doc.units;
  const mm = (v: number): Expr => ({ e: fmt(v / UNITS[u]), u });
  const stored = (k: string) => (p as unknown as Record<string, Expr>)[k];
  const sizes = p.kind === 'ngon' ? [...sizeFields(ctx, path, p), exprField(ctx, `${path}.sides`, 'Sides', true)] : sizeFields(ctx, path, p);
  return [
    labelled('Dimensions', ...sizes, ...more),
    ...(place ? [labelled('Position', shapeField(ctx, path, 'x', 'X', m.centred ? stored('x') : mm(m.x)), shapeField(ctx, path, 'y', 'Y', m.centred ? stored('y') : mm(m.y)))] : []),
    // degrees: shown as typed, never unit-converted
    ...(place && 'rot' in p ? [labelled('Rotation', shapeField(ctx, path, 'rot', 'Turn °', stored('rot'), true))] : []),
  ];
}

/** A body with tool bodies still listed: how many, and Fold all. */
function toolsRow(ctx: UIContext, body: Body): Node[] {
  const tools = [...ownersOf(ctx.doc)].filter(([t, o]) => o === body.id && !ctx.doc.bodies.find((b) => b.id === t)?.folded);
  if (!tools.length) return [];
  return [h('div', { className: 'row toggle' }, h('span', {}, `Tool bodies (${tools.length} listed)`), button('Fold all', () => ctx.foldAll(body.id), 'Click: Fold its tool bodies into their steps: they leave the list, nothing is lost (Object history or right-click unfolds them)'))];
}

/** A body's one shape its first step extrudes (its own, or its sketch's) and where it is; null: none such. */
function mainShape(ctx: UIContext, steps: Body, k: number): { path: string; p: Profile } | null {
  const f = steps.features[0];
  if (f?.type !== 'extrude') return null;
  const src = f.source;
  if (src.kind === 'own') {
    const i = outerOf(ctx, src.profiles);
    return i >= 0 ? { path: `bodies.${k}.features.0.source.profiles.${i}`, p: src.profiles[i] } : null;
  }
  if (src.areas) return null;
  const si = ctx.doc.sketches.findIndex((x) => x.id === src.sketch);
  const shapes = src.shapes.map((id) => ctx.doc.sketches[si]?.shapes.find((q) => q.id === id)).filter((q): q is Profile => !!q);
  const i = shapes.length === src.shapes.length ? outerOf(ctx, shapes) : -1;
  return i >= 0 ? { path: `sketches.${si}.shapes.${ctx.doc.sketches[si].shapes.indexOf(shapes[i])}`, p: shapes[i] } : null;
}

/** The one shape the others lie in (holes in a plate), by their boxes; -1: none such. One shape alone is it. */
function outerOf(ctx: UIContext, ps: Profile[]): number {
  if (ps.length === 1) return 0;
  const boxes = ps.map((p) => (p.kind === 'line' ? null : bounds(resolve(p, paramLookup(ctx.doc.params), '', new Map()) as DrawnProfile)));
  return boxes.findIndex((b, i) => b && boxes.every((o, j) => j === i || (o && o[0] > b[0] && o[1] > b[1] && o[2] < b[2] && o[3] < b[3])));
}

/** A body's Dimensions from its first step: its one shape's L and W (or Ø) and H; null: it has none such (its card shows instead). */
function dimensions(ctx: UIContext, steps: Body, k: number): HTMLElement | null {
  const f = steps.features[0];
  const at = `bodies.${k}.features.0`;
  const row = (...fields: HTMLElement[]) => h('div', { className: 'placing dimensions' }, h('span', {}, 'Dimensions'), ...fields);
  if (f?.type === 'sphere') return row(exprField(ctx, `${at}.d`, 'Ø'));
  const shape = mainShape(ctx, steps, k);
  if (!shape || shape.p.kind === 'line') return null;
  return row(...sizeFields(ctx, shape.path, shape.p), sizeHover(ctx, exprField(ctx, `${at}.depth`, 'H'), at, 'depth'));
}

/** Its fillets and chamfers: a card with a wide button that adds one, then one row each. */
function finishRows(ctx: UIContext, steps: Body, k: number, setSteps: (b: Body) => void): Node[] {
  const list = steps.features.flatMap((f, j) => (f.type === 'finish' ? [{ f, j }] : []));
  // a new one takes edges no other has yet (top, vertical, bottom, then all)
  const taken = new Set(list.map(({ f }) => f.edges));
  const edges = (['top', 'vertical', 'bottom', 'all'] as const).find((r) => !taken.has(r)) ?? 'top';
  const add = h('button', { className: 'wide', onclick: () => setSteps({ ...steps, features: [...steps.features, { ...(newFinish(ctx.doc.units) as Extract<Feature, { type: 'finish' }>), edges }] }), title: 'Click: Add a fillet on edges no other has yet (a size below 0 makes it a chamfer)' }, '+ Fillets and chamfers…');
  return [
    h(
      'section',
      { className: 'finishes' },
      add,
      ...list.flatMap(({ f, j }) => {
        const setFeature = (next: Feature) => setSteps({ ...steps, features: steps.features.map((x) => (x === f ? next : x)) });
        const remove = deleteButton('Click: Remove it', () => setSteps({ ...steps, features: steps.features.filter((x) => x !== f) }));
        return finishParts(ctx, steps, f, `bodies.${k}.features.${j}`, setFeature, remove);
      }),
    ),
  ];
}

/**
 * A body's steps in order, folded first (open while one is selected): a row selects its step (its faces lit, its
 * card below it); dragged onto another it moves there (the first, the shape, stays first); the bin deletes it; a boolean's
 * row folds its tool body into it or unfolds it.
 */
function history(ctx: UIContext, body: Body, setBody: (b: Body) => void, card: (f: Feature, j: number) => HTMLElement, shown = body.id): HTMLElement {
  const key = `history:${body.id}`; // in `folded`: open
  const open = ctx.folded.has(key) || body.features.some((f) => f.id === ctx.selectedStep);
  const head = h('button', { className: `history-head${open ? ' open' : ''}`, title: open ? 'Click: Fold its steps away' : 'Click: Show its steps in order', onclick: () => ctx.toggleFold(key), innerHTML: icon('chevron') }, `Object history (${body.features.length} steps)`);
  if (!open) return h('section', { className: 'history' }, head);
  let dragged = -1;
  const move = (from: number, to: number) => {
    const list = [...body.features];
    list.splice(to, 0, ...list.splice(from, 1));
    setBody({ ...body, features: list });
  };
  const rows = body.features.map((f, j) => {
    const on = f.id === ctx.selectedStep;
    // a step with a panel of its own opens it (its faces lit); the others show their fields below
    const panel = toolOf(ctx, f);
    const open = () => (ctx.selectStep(shown, f.id), panel!(shown, f.id));
    const name = h('button', { className: `item${on ? ' on' : ''}`, title: panel ? 'Click: Edit it in its tool' : on ? 'Click: Close it' : 'Click: Select it: its faces lit, its fields below', onclick: () => (panel ? open() : ctx.selectStep(shown, on ? null : f.id)) }, stepName(body, f)); // lit on the body selected (a linked copy: not its source)
    const tool = f.type === 'boolean' ? ctx.doc.bodies.find((b) => b.id === f.body) : undefined;
    const fold = tool ? [button(tool.folded ? 'Unfold' : 'Fold', () => ctx.foldTool(tool.id, !tool.folded), tool.folded ? 'Click: List its tool body again, as an object of its own' : 'Click: Fold its tool body into this step: it leaves the list, nothing is lost')] : [];
    // the first step is the shape itself: it stays, and stays first
    const drop = j ? [deleteButton('Click: Delete this step', () => ctx.removeStep(shown, f.id))] : [];
    const row = h('div', { className: 'history-row', draggable: j > 0, ondragstart: () => (dragged = j), ondragover: (e) => j > 0 && e.preventDefault(), ondrop: () => dragged > 0 && j > 0 && dragged !== j && move(dragged, j) }, name, ...fold, ...drop);
    if (!on || panel) return row;
    // open: its card stands in its row, its title the row (click: close it)
    const shownCard = card(f, j);
    shownCard.classList.add('history-card');
    const title = shownCard.querySelector('h4');
    if (title) Object.assign(title, { title: 'Click: Close it', onclick: (e: MouseEvent) => e.target === title && ctx.selectStep(shown, null) });
    return shownCard;
  });
  return h('section', { className: 'history' }, head, ...rows);
}

/** The panel a step is edited in (its tool), if it has one. */
function toolOf(ctx: UIContext, f: Feature): ((body: string, id: string) => void) | null {
  return f.type === 'thread' ? ctx.editThread : f.type === 'bulge' ? ctx.editBulge : f.type === 'draft' ? ctx.editDraft : f.type === 'fingers' ? ctx.editFingers : null;
}

/** A linked copy: whose steps it shares (editing them edits all copies), and Unlink. */
function linkedNote(ctx: UIContext, body: Body): Node[] {
  const source = ctx.doc.bodies.find((b) => b.id === body.link);
  const followers = ctx.doc.bodies.filter((b) => b.link === body.id).length;
  if (followers) return [h('p', { className: 'hint linked' }, `${followers} linked cop${followers === 1 ? 'y follows' : 'ies follow'} its steps: editing them edits those too`)];
  if (!source) return [];
  const copies = ctx.doc.bodies.filter((b) => b.link === source.id).length;
  const unlink = button('Unlink', () => ctx.unlinkCopy(body.id), 'Its own copy of the steps: editing it no longer changes the others');
  return [h('div', { className: 'row linked' }, h('span', { className: 'hint' }, `Linked copy of ${source.name} (${copies + 1} alike): editing its steps edits all of them`), unlink)];
}

/** The joints `id` stays in or moves by: name, range, what moves; Edit opens the panel it was made in. */
function jointCards(ctx: UIContext, id: string): Node[] {
  const nameOf = (o: string) => [...ctx.doc.bodies, ...ctx.doc.groups].find((x) => x.id === o)?.name ?? '?';
  return ctx.doc.joints.flatMap((j) => {
    if (j.parent !== id && !j.children.includes(id)) return [];
    const remove = deleteButton('Delete the joint: what it moved goes back to where it is without it', () => ctx.commit({ ...ctx.doc, joints: ctx.doc.joints.filter((x) => x !== j) }));
    return [
      h(
        'section',
        { className: 'joint-card' },
        h('h4', {}, h('span', {}, j.name, h('span', { className: 'range' }, ` ${ctx.jointRange(j)}`)), button('Edit', () => ctx.editJoint(j.id), j.kind === 'attach' ? 'Its anchor' : 'Kind, limits, speed, direction'), remove),
        h('p', { className: 'hint' }, j.kind === 'attach' ? `${j.children.map(nameOf).join(', ')} ${j.children.length > 1 ? 'go' : 'goes'} along with ${nameOf(j.parent)}, and it with them: they move and turn as one.` : `${nameOf(j.parent)} stays; ${j.children.map(nameOf).join(', ')} ${j.children.length > 1 ? 'move' : 'moves'}. Model them where they are now; play and scrub in the view's joints box.`),
      ),
    ];
  });
}

/** A group: name, delete (with its contents), and its origin: the parent's, or a custom point its contents count from. */
function groupPanel(ctx: UIContext, i: number): Node[] {
  const g = ctx.doc.groups[i];
  const set = (next: Partial<Group>) => ctx.commit(setIn(ctx.doc, ['groups', String(i)], { ...g, ...next }));
  // a custom origin is picked in the view; either way the contents stay where they are
  const origin = select(g.origin.kind, { parent: "Parent's origin", custom: 'Custom origin' }, (kind) =>
    kind === 'custom' ? ctx.pickOrigin(g.id) : ctx.moveOrigin(g.id, setIn(ctx.doc, ['groups', String(i), 'origin'], { kind })),
  );
  const repick = h('button', { className: 'icon', innerHTML: icon('target'), title: 'Click: pick the origin in the view (a face: Z out of it); the contents stay', onclick: () => ctx.pickOrigin(g.id) });
  const keeping: UIContext = { ...ctx, setValue: (path, value, live) => ctx.moveOrigin(g.id, setIn(ctx.doc, path, value), live) }; // its fields move only the origin
  return [
    h('div', { className: 'head' }, input(`groups.${i}.name`, g.name, (name) => set({ name })), deleteButton('Delete the group with everything in it', ctx.remove)),
    ...materialRows(ctx, [g.id], 'None'),
    h('h3', {}, 'Origin'),
    h('div', { className: 'row' }, origin, ...(g.origin.kind === 'custom' ? [repick] : [])),
    ...(g.origin.kind === 'custom'
      ? [
          placing(keeping, `groups.${i}.origin`),
          h('p', { className: 'hint' }, 'Its contents count from this point, turned with it (degrees around X, then Y, then Z); inside, they are edited unturned. Changing it moves only the origin: the contents stay where they are.'),
        ]
      : [h('p', { className: 'hint' }, "Its contents count from the parent's origin.")]),
    ...groupContents(ctx, g.id),
    ...jointCards(ctx, g.id),
  ];
}

/** Everything in a group, its sub-groups' contents indented under them: a row selects it. */
function groupContents(ctx: UIContext, id: string): Node[] {
  const { doc } = ctx;
  const tools = ownersOf(doc); // tool bodies show under their body, not here
  const rows = (parent: string, depth: number): HTMLElement[] =>
    [
      ...doc.groups.filter((g) => g.parent === parent).map((g) => ({ id: g.id, name: g.name, kind: 'group', inner: true })),
      ...doc.bodies.filter((b) => b.group === parent && !tools.has(b.id)).map((b) => ({ id: b.id, name: b.name, kind: 'body', inner: false })),
      ...doc.sketches.filter((s) => s.group === parent).map((s) => ({ id: s.id, name: s.name, kind: 'sketch', inner: false })),
    ].flatMap((o) => {
      const row = h('div', { className: 'listed' }, listItem(o.id, 'item', (how) => ctx.select(o.id, how), h('span', { className: 'kind', innerHTML: icon(o.kind) }), o.name));
      row.style.paddingLeft = `${depth * 22}px`;
      return [row, ...(o.inner ? rows(o.id, depth + 1) : [])];
    });
  const list = rows(id, 0);
  return [h('h3', {}, `Contents (${list.length})`), ...(list.length ? list : [h('p', { className: 'hint' }, 'Nothing in it yet.')])];
}

const SKETCH_HINT =
  'Sketch group: [R] [C] [L] draw shapes (they stay flat) · click a shape to select it (a sub-group: all of it), double-click opens its sub-group · hover a line: drag its points, curve handles and arc middles · click an arc middle: type its diameter · click a curve handle: type its length, [Tab] its angle · double-click a point: smooth or sharp · [⌘G] groups shapes, [⇧⌘G] ungroups · [X] [Y] [Z] move by a typed distance · [E] extrude · [Esc] up a level or leaves';

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
      : [h('span', { className: 'hint' }, p.kind === 'plane' ? 'On a fixed plane (where a face was)' : p.kind === 'work' ? `On the work plane ${doc.planes.find((w) => w.id === p.plane)?.name ?? '(deleted)'}` : `On a face of ${doc.bodies.find((q) => q.id === p.body)?.name ?? 'a deleted body'}`)];
  const kinds = { rect: 'Rectangle', circle: 'Circle', ngon: 'Regular polygon', polygon: 'Polygon', line: 'Line' };
  const shapeRow = (q: (typeof s.shapes)[number], depth: number) => {
    const j = s.shapes.indexOf(q);
    const name = listItem(q.id, `item${ctx.shapes.includes(q.id) ? ' selected' : ''}`, (how) => ctx.pickShape(s.id, q.id, how), kinds[q.kind]);
    const drop = deleteButton('Delete this shape', () => set({ shapes: s.shapes.filter((r) => r !== q) }));
    const box = h('input', { type: 'checkbox', checked: !!q.construction, id: `construction-${q.id}` });
    // the next objects are drawn as this one now is
    box.onchange = () => (ctx.setDrawConstruction(box.checked), set({ shapes: s.shapes.map((r) => (r === q ? { ...r, construction: box.checked } : r)) }));
    const construction = h('label', { className: 'row toggle', title: 'Construction line: dashed, snapped to, never extruded' }, h('span', {}, 'Construction line'), box);
    const row = h('div', { className: 'listed' }, name, drop);
    row.style.paddingLeft = `${depth * 22}px`;
    // fields, reference diamond and the construction switch only for selected shapes
    return h('div', { className: 'shape' }, row, ...(ctx.shapes.includes(q.id) ? [...shapeFields(ctx, `${at}.shapes.${j}`, q), construction] : []));
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
  // all of them, sub-groups open as folded; the selected ones with their fields
  const shapes = level(null, 0);
  return [
    h(
      'div',
      { className: 'head' },
      input(`${at}.name`, s.name, (name) => set({ name })),
      deleteButton('Delete the sketch', () => {
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
    h('h3', {}, ctx.shapes.length ? `Shapes (${ctx.shapes.length} of ${s.shapes.length} selected)` : `Shapes (${s.shapes.length})`),
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
 * (degrees) around it, corner radius. Stored values show their expressions; measured ones show numbers. `place`
 * false: no X / Y / Turn and reference diamond (a body's only shape, at its origin: Position and Rotation place it).
 */
/** A shape's fields; `rounding`: its corner radii (a sketch's shapes; a body rounds by fillets instead). */
function shapeFields(ctx: UIContext, path: string, p: Profile, place = true, rounding = true): HTMLElement[] {
  const keys = path.split('.');
  const m = ctx.measure(keys);
  const u = ctx.doc.units;
  const stored = (k: string) => (p as unknown as Record<string, Expr>)[k];
  const mm = (v: number): Expr => ({ e: fmt(v / UNITS[u]), u });
  const tf = (field: ShapeField, label: string, value: Expr, raw = false) => shapeField(ctx, path, field, label, value, raw);
  const pf = (key: string, label: string, raw = false) => exprField(ctx, `${path}.${key}`, label, raw);
  const row = (...cells: HTMLElement[]) => h('div', { className: 'trio' }, ...cells);
  // its arcs' diameters, and the lengths and angles sides were given: formulas stay, the points follow
  const sideRows = p.kind === 'polygon' || p.kind === 'line' ? p.pts.flatMap((_, side) => {
    const c = p.curves?.[side];
    const arc = c && 'mid' in c ? arcOf(p.pts[side], c.mid, p.pts[(side + 1) % p.pts.length]) : null;
    const size = p.sizes?.[side];
    const set = (key: 'l' | 'deg' | 'd', label: string, value: Expr, raw = false) => exprField(ctx, `${path}.@side${side}${key}`, label, raw, { value, set: (x, live) => ctx.setSide(keys, side, key, x, live) });
    if (arc) return [set('d', `Ø ${side + 1}`, size?.d ?? mm(+(arc.r * 2).toFixed(3)))];
    return [...(size?.l ? [set('l', `L ${side + 1}`, size.l)] : []), ...(size?.deg ? [set('deg', `∠ ${side + 1}`, size.deg, true)] : [])];
  }) : [];
  const arcRows = Array.from({ length: Math.ceil(sideRows.length / 3) }, (_, k) => row(...sideRows.slice(k * 3, k * 3 + 3)));
  const shape = (...rows: HTMLElement[]) => [h('div', { className: 'shape-fields' }, ...(place ? [refGrid(ctx, p.id)] : []), h('div', {}, ...rows.filter((r) => r.childElementCount), ...arcRows))];
  const pos = place ? [tf('x', 'X', m.centred ? stored('x') : mm(m.x)), tf('y', 'Y', m.centred ? stored('y') : mm(m.y))] : [];
  if (p.kind === 'circle') return shape(row(...pos, tf('d', 'Ø', stored('d'))));
  const link = tool('link', ctx.linkSize(p.id) ? 'L and W change together: click to unlink' : 'Link L and W: they change together', () => ctx.toggleLinkSize(p.id), ctx.linkSize(p.id));
  const [w, hh] = p.kind === 'rect' ? [stored('w'), stored('h')] : [mm(m.w), mm(m.h)];
  if (p.kind === 'line') return shape(row(...pos), row(tf('w', 'L', w), link, tf('h', 'W', hh))); // no corners to round, no turn of its own
  const rot = place ? [tf('rot', 'Turn °', stored('rot'), true)] : []; // degrees: shown as typed, never unit-converted
  const radii = rounding ? cornerFields(ctx, path, p) : [];
  if (p.kind === 'ngon') return shape(row(...pos, ...rot), row(tf('d', 'Ø', stored('d')), pf('sides', 'Sides', true)), ...radii);
  return shape(row(...pos, ...rot), row(tf('w', 'L', w), link, tf('h', 'W', hh)), ...radii);
}

/**
 * Corner radii: one R for all corners; its chain broken, one R per corner (a rectangle's where they lie: top left,
 * top right, bottom left, bottom right). Each is clamped to what its corner takes (`cornerRadii`).
 */
function cornerFields(ctx: UIContext, path: string, p: Extract<Profile, { kind: 'rect' | 'ngon' | 'polygon' }>): HTMLElement[] {
  const keys = path.split('.');
  const zero: Expr = { e: '0', u: ctx.doc.units };
  const all = p.r ?? zero;
  const n = p.kind === 'rect' ? 4 : p.kind === 'polygon' ? p.pts.length : Math.max(3, Math.round(Number(p.sides.e) || 3));
  const chain = tool('link', p.rs ? 'Each corner its own R: click to give all one R' : 'One R for all corners: click to give each its own', () => ctx.setValue([...keys, 'rs'], p.rs ? undefined : Array.from({ length: n }, () => all)), !p.rs);
  // R a radius; stored below 0, C: a chamfer that long along each side, shown positive (typed below 0: the other kind;
  // a drag through 0 goes on into it, as it counts from the kind the field showed)
  const kind = (x: Expr) => ((ctx.lengthOf(x) ?? 0) < 0 ? 'C' : 'R'); // a formula by its value
  const field = (key: string, label: string, value: Expr) => {
    const c = kind(value) === 'C';
    const flip = (x: Expr): Expr => (c ? { ...x, e: negated(x.e) } : x);
    const el = exprField(ctx, `${path}.${key}`, label, false, { value: flip(value), set: (x, live) => ctx.setValue([...keys, ...key.split('.')], flip(x), live), error: ctx.exprErrors.get(`${path}.${key}`) });
    el.title = 'R: the corner rounded by this radius · C: chamfered, this long along each side · below 0: the other kind';
    return el;
  };
  // hovered or typed in: its corner (the one-for-all R: every corner) marked in the view
  const marked = (el: HTMLElement, i: number) => {
    const show = (on: boolean) => ctx.showCorner(on ? keys : null, i);
    return Object.assign(el, { onmouseenter: () => show(true), onmouseleave: () => !el.contains(document.activeElement) && show(false), onfocusin: () => show(true), onfocusout: () => show(false) });
  };
  if (!p.rs) return [h('div', { className: 'trio' }, marked(field('r', kind(all), all), -1), chain)];
  const one = (i: number) => marked(field(`rs.${i}`, `${kind(p.rs![i] ?? all)}${i + 1}`, p.rs![i] ?? all), i);
  // corners run bottom left, bottom right, top right, top left
  const cells = p.kind === 'rect' ? [3, 2, 0, 1].map(one) : Array.from({ length: n }, (_, i) => one(i));
  const rows = Array.from({ length: Math.ceil(cells.length / (p.kind === 'rect' ? 2 : 3)) }, (_, k) => (p.kind === 'rect' ? cells.slice(k * 2, k * 2 + 2) : cells.slice(k * 3, k * 3 + 3)));
  return rows.map((r, k) => h('div', { className: 'trio' }, ...r, ...(k ? [] : [chain])));
}

/** Illustrator's reference point locator for one shape: which point of its box X / Y give, and which point stays when sizing or turning. */
function refGrid(ctx: UIContext, shape: string) {
  const [rx, ry] = ctx.shapeRef(shape);
  const cells = [1, 0, -1].flatMap((sy) => [-1, 0, 1].map((sx) => h('button', { className: `cell${rx === sx && ry === sy ? ' on' : ''}`, onclick: () => ctx.setShapeRef(shape, [sx, sy]) })));
  return h('div', { className: 'ref-grid', title: 'Reference diamond: X / Y measure this point of the shape; changing size or turn keeps it in place' }, ...cells);
}

/** `el`, a size field: hovering it draws its size (see `showSize`) on what `path` leads to. */
function sizeHover<T extends HTMLElement>(ctx: UIContext, el: T, path: string, what: 'w' | 'h' | 'd' | 'depth') {
  return Object.assign(el, { onmouseenter: () => ctx.showSize(path.split('.'), what), onmouseleave: () => ctx.showSize(null) });
}

/** Position and Rotation under `at`: one block, three aligned columns. */
function placing(ctx: UIContext, at: string) {
  return h(
    'div',
    { className: 'placing' },
    h('span', {}, 'Position'),
    ...['X', 'Y', 'Z'].map((l, k) => exprField(ctx, `${at}.position.${k}`, l)),
    h('span', {}, 'Rotation'),
    // degrees: shown as typed, never unit-converted
    ...(['rx', 'ry', 'rz'] as const).map((k) => exprField(ctx, `${at}.rotation.${k}`, `${k[1].toUpperCase()}°`, true)),
  );
}

/**
 * An extrusion of its own shapes on a base plane with its Back folded in (plain numbers in one unit): H the whole
 * height, the plane moved back as far; else as it is.
 */
function backInto(f: Extract<Feature, { type: 'extrude' }>): Extract<Feature, { type: 'extrude' }> {
  const { back, depth, source } = f;
  if (!back || source.kind !== 'own' || source.plane.kind !== 'base') return f;
  const off = source.plane.offset;
  if (![back, depth, off].every((x) => isPlain(x.e) && x.u === depth.u)) return f;
  const s = Math.sign(Number(depth.e)) || 1;
  const sum = (a: Expr, by: number): Expr => ({ e: fmt(Number(a.e) + by), u: a.u });
  return { ...f, back: undefined, depth: sum(depth, s * Number(back.e)), source: { ...source, plane: { ...source.plane, offset: sum(off, -s * Number(back.e)) } } };
}

/**
 * A fillet's or chamfer's row: its size (below 0 it turns into the other kind), which edges, Bake, remove; then the
 * edges left out and picked edges lost. Switched off (older files): a box to switch it on again.
 */
function finishParts(ctx: UIContext, body: Body, feature: Extract<Feature, { type: 'finish' }>, at: string, setFeature: (f: Feature) => void, remove: HTMLElement): HTMLElement[] {
  const rules = { all: 'All edges', top: 'Top edges', bottom: 'Bottom edges', vertical: 'Vertical edges' };
  const picked = typeof feature.edges === 'object' ? feature.edges.pts.length : 0;
  const lost = ctx.lostEdges(body.id, feature.id);
  const held = ctx.capped(body.id, feature.id);
  const heldAt = [...new Set(held.map((c) => fmt(Math.floor(c.max * 100) / 100)))].join(', ');
  // picked edges (dragged on the body) keep their pick; a rule can replace it
  const edges =
    typeof feature.edges === 'object'
      ? select<keyof typeof rules | 'picked'>('picked', { picked: `Picked edges (${picked})`, ...rules }, (r) => r !== 'picked' && setFeature({ ...feature, edges: r }))
      : select<keyof typeof rules>(feature.edges, rules, (r) => setFeature({ ...feature, edges: r }));
  const bake = h(
    'button',
    {
      className: `bake${feature.baked ? ' on' : ''}`,
      title: feature.baked ? 'Baked: stays where it is, so later cuts go through it. Click: Unbake it (it finishes later cuts again)' : 'Click: Bake it: later cuts go through it instead of being finished too',
      onclick: () => setFeature({ ...feature, baked: !feature.baked }),
    },
    feature.baked ? 'Baked' : 'Bake',
  );
  const on = feature.enabled ? [] : [h('input', { type: 'checkbox', checked: false, title: 'Click: Switch it on again', onchange: () => setFeature({ ...feature, enabled: true }) })];
  return [
    h('div', { className: 'row finish' }, ...on, exprField(ctx, `${at}.size`, feature.mode === 'fillet' ? 'Radius' : 'Chamfer', false, { value: feature.size, set: (x, live) => ctx.setFinishSize(`${at}.size`.split('.'), x, feature.mode, live), error: ctx.exprErrors.get(`${at}.size`) }), edges, bake, remove),
    ...(feature.skip.length ? [h('div', { className: 'listed' }, h('span', { className: 'hint' }, `${feature.skip.length} edge${feature.skip.length > 1 ? 's' : ''} left out`), button('Restore', () => setFeature({ ...feature, skip: [] }), 'Click: Finish the left-out edges again'))] : []),
    ...(lost ? [h('p', { className: 'error', title: COPY_TIP }, `${lost} of ${picked} picked edges ${lost > 1 ? 'are' : 'is'} gone: an edit changed ${lost > 1 ? 'them' : 'it'} too much. Pick ${lost > 1 ? 'them' : 'it'} again.`)] : []),
    // edges that cannot take the size: held at the largest they take (orange on the body)
    ...(held.length
      ? [h('div', { className: 'listed capped' }, h('span', { className: 'hint' }, `${held.length} edge${held.length > 1 ? 's' : ''} held at ${heldAt} mm, the most ${held.length > 1 ? 'they take' : 'it takes'}`), button('Split off', () => ctx.splitCapped(body.id, feature.id), `Click: Give ${held.length > 1 ? 'them a step' : 'it a step'} of ${held.length > 1 ? 'their' : 'its'} own at that size, to change apart`))]
      : []),
  ];
}

/** A step's name as History lists it: the first extrusion Extrude, later ones Join or Cut (numbered), the rest by kind. */
function stepName(body: Body, f: Feature): string {
  const n = body.features.indexOf(f) + 1;
  if (f.type === 'extrude') return n === 1 ? 'Extrude' : `${f.mode === 'cut' ? 'Cut' : 'Join'} ${n}`;
  if (f.type === 'finish') return f.mode === 'fillet' ? 'Fillet' : 'Chamfer';
  if (f.type === 'boolean') return `${{ union: 'Join', subtract: 'Cut', intersect: 'Intersect' }[f.op]} ${n}`;
  return f.type[0].toUpperCase() + f.type.slice(1);
}

function featureCard(ctx: UIContext, body: Body, feature: Feature, at: string, setBody: (p: Body) => void) {
  const setFeature = (next: Feature) => setBody({ ...body, features: body.features.map((s) => (s === feature ? next : s)) });
  const remove = deleteButton('Remove', () => setBody({ ...body, features: body.features.filter((s) => s !== feature) }));
  const f = (key: string, label: string) => exprField(ctx, `${at}.${key}`, label);

  switch (feature.type) {
    case 'extrude': {
      const extrudes = body.features.filter((t) => t.type === 'extrude');
      const name = (t: (typeof extrudes)[number]) => stepName(body, t);
      const through = h('input', { type: 'checkbox', checked: feature.through });
      through.onchange = () => setFeature({ ...feature, through: through.checked });
      // how far it reaches behind its sketch plane (left out: 0)
      const back = exprField(ctx, `${at}.back`, 'Back', false, { value: feature.back ?? { e: '0', u: ctx.doc.units }, set: (x, live) => ctx.setValue([...at.split('.'), 'back'], x, live), error: ctx.exprErrors.get(`${at}.back`) });
      back.title = 'How far it also reaches behind its sketch plane (Alt while pulling: as far as the depth)';
      // a body's own shapes: Back only while it is not 0 (unlinking folds it into H and the plane's offset)
      const backShown = feature.source.kind === 'sketch' || !isPlain(feature.back?.e ?? '0') || Number(feature.back?.e ?? 0) !== 0;
      const reach = [
        ...(feature.through ? [] : [sizeHover(ctx, f('depth', 'H'), at, 'depth'), ...(backShown ? [back] : [])]),
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
        const unlink = () => plane && setFeature(backInto({ ...feature, source: { kind: 'own', plane, profiles: structuredClone(shapes), areas: src.areas } }));
        const link = sketch
          ? [
              h('button', { className: 'item', onclick: () => ctx.select(sketch.id), title: 'Select the sketch' }, `${sketch.name}: ${src.areas ? `${src.areas.length} areas` : `${shapes.length} of ${sketch.shapes.length} shapes`}`),
              ...(plane ? [tool('unlink', 'Unlink: copy the shapes into this feature, so the sketch no longer changes it', unlink)] : []),
            ]
          : [h('span', { className: 'error', title: COPY_TIP }, 'its sketch was deleted')];
        return h('section', {}, h('h4', {}, name(feature), remove), h('div', { className: 'listed' }, h('span', { className: 'hint' }, 'From'), ...link), h('div', { className: 'row reach' }, ...reach));
      }
      // its plane and offset are kept, not shown: where it stands comes from the body's place and the face it was drawn on
      const setSource = (next: Partial<typeof src>) => setFeature({ ...feature, source: { ...src, ...next } });
      // as the body's own fields: one shape takes H into its Dimensions, several each their rows, H after them
      const one = src.profiles.length === 1 && !feature.through;
      const profiles = src.profiles.map((p, k) => {
        const drop = deleteButton('Remove this shape', () => setSource({ profiles: src.profiles.filter((q) => q !== p) }));
        // the only shape, at the origin unturned: the body's Position and Rotation place it
        const alone = src.profiles.length === 1 && 'x' in p && [p.x, p.y, 'rot' in p ? p.rot : ex(0)].every((v) => isPlain(v.e) && Number(v.e) === 0);
        return h('div', { className: 'profile' }, ...shapeRows(ctx, `${at}.source.profiles.${k}`, p, !alone, one ? [reach[0]] : []), ...(src.profiles.length > 1 ? [drop] : []));
      });
      const rest = one ? reach.slice(1) : reach;
      return h('section', {}, h('h4', {}, name(feature), remove), ...profiles, ...(rest.length ? [h('div', { className: 'row reach' }, ...rest)] : []));
    }
    case 'boolean': {
      const other = ctx.doc.bodies.find((b) => b.id === feature.body);
      const op = select(feature.op, { union: 'Join', subtract: 'Cut', intersect: 'Intersect' }, (o) => setFeature({ ...feature, op: o }));
      const tool = other ? h('button', { className: 'item', onclick: () => ctx.select(other.id), title: 'Select the tool body' }, other.name) : h('span', { className: 'error', title: COPY_TIP }, 'its tool body was deleted');
      const drop = deleteButton('Remove: the tool body becomes a body of its own', () => ctx.commit(freed(ctx.doc, feature.body)));
      const grow = feature.grow ? [h('div', { className: 'row' }, f('grow', 'Clearance'))] : [];
      // folded: its tool body's own fields here (it is not listed to select)
      const ti = other?.folded ? ctx.doc.bodies.indexOf(other) : -1;
      if (ti >= 0) return h('section', {}, h('div', { className: 'listed boolean' }, op, h('span', { className: 'hint' }, 'folded'), button('Unfold', () => ctx.foldTool(other!.id, false), 'Click: List its tool body again, as an object of its own')), ...[dimensions(ctx, other!, ti)].filter((x): x is HTMLElement => !!x), placing(ctx, `bodies.${ti}`), ...grow);
      return h('section', {}, h('div', { className: 'listed boolean' }, op, h('span', { className: 'hint' }, feature.along ? `along ${ctx.doc.joints.find((j) => j.id === feature.along)?.name ?? 'a deleted joint'}, with` : 'with'), tool, drop), ...grow);
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
    case 'thread': {
      const kind = select(feature.inside ? 'hole' : 'shaft', { hole: 'Thread: in a hole', shaft: 'Thread: on a shaft' }, (v) => setFeature({ ...feature, inside: v === 'hole' }));
      // a listed size fills Ø and pitch; Metric / Imperial switches the list
      const system = THREADS.find((t) => t.name === feature.size)?.system ?? 'metric';
      const sizes = THREADS.filter((t) => t.system === system);
      // Custom: its own Ø and pitch, their fields shown only then
      const custom = !THREADS.some((t) => t.name === feature.size);
      const size = select(custom ? 'Custom' : feature.size, Object.fromEntries([...sizes.map((t) => [t.name, t.name]), ['Custom', 'Custom']]), (name) => {
        const t = THREADS.find((x) => x.name === name);
        setFeature(t ? { ...feature, size: name, d: { e: fmt(t.d / UNITS[ctx.doc.units]), u: ctx.doc.units }, pitch: { e: fmt(t.pitch / UNITS[ctx.doc.units]), u: ctx.doc.units } } : { ...feature, size: 'Custom' });
      });
      const units = select(system, { metric: 'Metric', imperial: 'Imperial' }, (v) => {
        const t = fitting(feature.r * 2, feature.inside, v);
        setFeature({ ...feature, size: t.name, d: { e: fmt(t.d / UNITS[ctx.doc.units]), u: ctx.doc.units }, pitch: { e: fmt(t.pitch / UNITS[ctx.doc.units]), u: ctx.doc.units } });
      });
      const modeled = select(feature.modeled ? 'modeled' : 'drawn', { modeled: 'Modelled', drawn: feature.inside ? 'Pilot' : 'Plain' }, (v) => setFeature({ ...feature, modeled: v === 'modeled' }));
      return h('section', {}, h('h4', {}, kind, remove), h('div', { className: 'row' }, modeled, units, size), h('div', { className: 'row' }, ...(custom ? [f('d', 'Ø'), f('pitch', 'Pitch')] : []), f('length', 'Length')), h('p', { className: 'hint' }, `On a round face Ø ${fmt(feature.r * 2)} mm · Modelled: cut into the solid; ${feature.inside ? 'Pilot: the tap-drill hole, the thread only drawn' : 'Plain: the shaft, the thread only drawn'}`));
    }
    case 'bulge': {
      const where = feature.on.kind === 'sketch' ? 'sketch shapes' : feature.on.kind === 'round' ? (feature.on.shaft ? 'a round shaft' : 'a round hole') : 'a flat face';
      return h(
        'section',
        {},
        h('h4', {}, 'Bulge', button('✎', () => ctx.editBulge(body.id, feature.id), 'Edit it in its panel (T: the peak to a point)'), remove),
        h('div', { className: 'row' }, ...['X', 'Y', 'Z'].map((l, k) => f(`peak.${k}`, l)), exprField(ctx, `${at}.fullness`, 'Fullness', true, undefined, 0.01)),
        h('p', { className: 'hint' }, `On ${where}: X / Y / Z, its peak from the middle (across the face: its height); Fullness -4 pointy to 4 flat topped`),
      );
    }
    case 'fingers': {
      const other = ctx.doc.bodies.find((b) => b.id === feature.body);
      const lead = feature.first ? null : other?.features.find((f) => f.type === 'fingers' && f.body === body.id);
      return h(
        'section',
        {},
        h('h4', {}, 'Box joint', button('✎', () => ctx.editFingers(body.id, feature.id), 'Edit it in its panel: fingers, finger length, clearance, from a point'), remove),
        ...(feature.first
          ? [h('div', { className: 'row' }, exprField(ctx, `${at}.count`, 'Fingers', true), f('width', 'Finger length'), exprField(ctx, `${at}.clearance`, 'Clearance', false, { value: feature.clearance ?? { e: '0', u: ctx.doc.units }, set: (x, live) => ctx.setValue([...at.split('.'), 'clearance'], x, live), error: ctx.exprErrors.get(`${at}.clearance`) }))]
          : []),
        h('p', { className: 'hint' }, other ? `With ${other.name}${lead ? ` (fingers set there)` : ''}; a finger length above 0 replaces the count (exact, from the low end or a point: ✎)` : 'Its partner was deleted: it does nothing'),
      );
    }
    case 'draft':
      return h(
        'section',
        {},
        h('h4', {}, 'Draft', button('✎', () => ctx.editDraft(body.id, feature.id), 'Edit it in its panel (Set axis: its hinge)'), remove),
        h('div', { className: 'row' }, exprField(ctx, `${at}.angle`, 'Angle °', true), h('span', { className: 'hint' }, 'a flat face turned about its hinge, inward (negative: outward)')),
      );
    case 'push':
      return h('section', {}, h('h4', {}, 'Push / pull', remove), h('div', { className: 'row' }, f('distance', 'Distance'), h('span', { className: 'hint' }, 'a flat face, out (negative: in)')));
    case 'mirror':
      return h('section', {}, h('h4', {}, 'Mirror', remove), h('p', { className: 'hint' }, 'Mirrored across the plane it was made with'));
    case 'piece':
      return h('section', {}, h('h4', {}, `Piece ${feature.index + 1}`, remove), h('p', { className: 'hint' }, 'It came apart: this body keeps this piece, the others are bodies of their own'));
    case 'shell':
      return h('section', {}, h('h4', {}, 'Shell', remove), h('div', { className: 'row' }, f('thickness', 'Wall'), h('span', { className: 'hint' }, feature.open.length ? `${feature.open.length} face${feature.open.length === 1 ? '' : 's'} open` : 'closed, hollow inside')));
    case 'coat':
      return h(
        'section',
        {},
        h('h4', {}, 'Coat', remove),
        h('div', { className: 'row' }, h('span', { className: 'hint' }, `${feature.thickness.e}, ${feature.corners} corners${feature.exclude.length ? `, ${feature.exclude.length} excluded` : ''}${feature.skin ? ', a skin around it' : ''}`), button('✎', () => ctx.coatEdit(body.id, feature.id), 'Change it')),
      );
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
    case 'finish':
      return h('section', { className: `${feature.enabled ? '' : 'disabled'}${feature.baked ? ' baked' : ''}` }, ...finishParts(ctx, body, feature, at, setFeature, remove));
  }
}
