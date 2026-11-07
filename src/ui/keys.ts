/**
 * A key with the modifiers it needs: `key` as `KeyboardEvent.key` in lower case; `mod`: ⌘ or Ctrl; `shift`: must be
 * down (true) or up (false), either when left out; `alt`: must be down when true, else up.
 */
export interface Combo {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** The chapters of the hotkey list, in order. */
export const CHAPTERS = ['File', 'Edit', 'View', 'Draw', 'Drawing aids', 'Shape', 'Move', 'Organize', 'While a tool runs'] as const;

/** A keyboard action: its chapter, name and place in the hotkey list, its default keys, and what it does. */
export interface Binding {
  chapter: (typeof CHAPTERS)[number];
  name: string;
  order: number;
  default: Combo[];
  hint: string;
}

/**
 * Every keyboard action, in one place: every key the app reacts to must be listed here (the settings dialog shows
 * this list; a keyboard mapper will edit it later). App actions run from the app's key handler; tool keys act while a
 * tool, a move, a resize or a pick runs. Typed values (digits, units, expressions) are not listed; the modifiers'
 * roles are in `MODS`.
 */
export const KEYS = {
  save: { chapter: 'File', name: 'Save', order: 10, default: [{ key: 's', mod: true }], hint: 'Save the design (a new version in the file)' },
  open: { chapter: 'File', name: 'Open', order: 11, default: [{ key: 'o', mod: true }], hint: 'Open a design file' },
  undo: { chapter: 'Edit', name: 'Undo', order: 20, default: [{ key: 'z', mod: true, shift: false }], hint: 'Undo the last step' },
  redo: { chapter: 'Edit', name: 'Redo', order: 21, default: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }], hint: 'Redo the step undone' },
  terminal: { chapter: 'View', name: 'Python terminal', order: 29, default: [], hint: 'Open or close the Python terminal and its scripts (no key by default)' },
  fit: { chapter: 'View', name: 'Fit', order: 30, default: [{ key: 'f' }], hint: 'Move the camera back or forth, as it looks now, until everything is in view' },
  home: { chapter: 'View', name: 'Home', order: 30.5, default: [{ key: 'h' }], hint: 'Everything framed from the front-right corner' },
  lookAtFace: { chapter: 'View', name: 'Look at face', order: 30.7, default: [], hint: 'The camera looks straight at the face last clicked on a selected body, else at the face clicked next (no key by default)' },
  cycle: { chapter: 'View', name: 'Next body under the pointer', order: 31, default: [{ key: 'tab', shift: false }], hint: 'Select the next body under the pointer (typing a size: Tab switches the side instead)' },
  cycleBack: { chapter: 'View', name: 'Previous body under the pointer', order: 32, default: [{ key: 'tab', shift: true }], hint: 'Select the previous body under the pointer' },
  rect: { chapter: 'Draw', name: 'Rectangle', order: 40, default: [{ key: 'r' }], hint: 'Draw a rectangle (and pull it up, or keep it flat)' },
  circle: { chapter: 'Draw', name: 'Circle', order: 41, default: [{ key: 'c' }], hint: 'Draw a circle (a cylinder when pulled)' },
  ngon: { chapter: 'Draw', name: 'Regular polygon', order: 42, default: [{ key: 'n' }], hint: 'Draw a regular polygon' },
  line: { chapter: 'Draw', name: 'Line', order: 43.5, default: [{ key: 'l' }], hint: 'Draw lines; again (or Alt): the next mode: one line per two clicks, free polygon, bezier curves, round arcs. Enter or Esc finishes a line, a click on its start closes it' },
  construction: { chapter: 'Draw', name: 'Construction', order: 43.8, default: [{ key: 'q' }], hint: 'Switch selected sketch objects to construction lines and back; the next ones are drawn the same' },
  sphere: { chapter: 'Draw', name: 'Sphere', order: 44, default: [{ key: 'o' }], hint: 'Draw a sphere from its centre' },
  sketch: { chapter: 'Draw', name: 'New sketch', order: 45, default: [{ key: 's' }], hint: 'A new sketch on a face or a base plane' },
  extrude: { chapter: 'Shape', name: 'Extrude', order: 46, default: [{ key: 'e' }], hint: 'Pull shapes or areas, or push and pull a face' },
  joint: { chapter: 'Organize', name: 'Joint', order: 50.5, default: [{ key: 'j' }], hint: 'A hinge or slider: a parent that stays, objects that move, an axis, limits' },
  rotate: { chapter: 'Move', name: 'Rotate', order: 54.9, default: [{ key: 'w' }], hint: 'Turn the selection around an axis through a pivot: the pointer, typed degrees, X / Y / Z, Set axis or Pivot' },
  revolve: { chapter: 'Shape', name: 'Revolve', order: 46.2, default: [{ key: 'u' }], hint: 'Turn closed sketch shapes around a line or edge in their plane into a new body' },
  loft: { chapter: 'Shape', name: 'Loft', order: 46.4, default: [{ key: 'k' }], hint: 'A new body through closed sketch shapes of several sketches, clicked in order' },
  group: { chapter: 'Organize', name: 'Group', order: 50, default: [{ key: 'g', mod: true, shift: false }], hint: 'Group the selection (nothing selected: the objects clicked next)' },
  ungroup: { chapter: 'Organize', name: 'Ungroup', order: 51, default: [{ key: 'g', mod: true, shift: true }], hint: 'Ungroup the selected group; its contents stay where they are' },
  duplicate: { chapter: 'Organize', name: 'Duplicate', order: 52, default: [{ key: 'd', mod: true }], hint: 'Duplicate the selection (or the selected shapes)' },
  copy: { chapter: 'Organize', name: 'Copy', order: 52.2, default: [{ key: 'c', mod: true }], hint: 'Take a copy of the selection (bodies, sketches or shapes) for Paste' },
  cut: { chapter: 'Organize', name: 'Cut', order: 52.3, default: [{ key: 'x', mod: true }], hint: 'Take the selection away for Paste (Paste puts it back as it was)' },
  paste: { chapter: 'Organize', name: 'Paste', order: 52.4, default: [{ key: 'v', mod: true }], hint: 'Copies of what Copy took, as Duplicate makes them; after Cut what it took, as it was (nothing taken: click what to copy)' },
  delete: { chapter: 'Organize', name: 'Delete', order: 53, default: [{ key: 'delete' }, { key: 'backspace' }], hint: 'Delete the selection, or the selected part of a fillet' },
  deselect: { chapter: 'Edit', name: 'Deselect', order: 54, default: [{ key: 'escape' }], hint: 'Clear the selection; in sketch mode leave the sketch' },
  selectAll: { chapter: 'Edit', name: 'Select all', order: 54.2, default: [{ key: 'a', mod: true }], hint: 'Select all bodies (in sketch mode: all shapes of the sketch); in a field: all its text' },
  toggleVisible: { chapter: 'View', name: 'Hide / show', order: 54.5, default: [{ key: 'v' }], hint: 'Hide the selected bodies, sketches and groups, or show them again' },
  move: { chapter: 'Move', name: 'Move', order: 54.8, default: [{ key: 'm' }], hint: 'Fields at the pointer for X, Y and Z at once (the cursor in X): type distances, Enter moves the selection (nothing selected: click what moves)' },
  moveX: { chapter: 'Move', name: 'Move along X', order: 55, default: [{ key: 'x' }], hint: 'A field at the pointer: type a distance along X (X / Y / Z or Tab in it switch the axis), Enter moves the selection by all of them' },
  moveY: { chapter: 'Move', name: 'Move along Y', order: 56, default: [{ key: 'y' }], hint: 'A field at the pointer: type a distance along Y (X / Y / Z or Tab in it switch the axis), Enter moves the selection by all of them' },
  moveZ: { chapter: 'Move', name: 'Move along Z', order: 57, default: [{ key: 'z' }], hint: 'A field at the pointer: type a distance along Z (X / Y / Z or Tab in it switch the axis), Enter moves the selection by all of them' },
  nudgeLeft: { chapter: 'Move', name: 'Nudge left', order: 60, default: [{ key: 'arrowleft' }], hint: 'Move 1 mm along the axis nearest to left on screen (Shift: 10 mm)' },
  nudgeRight: { chapter: 'Move', name: 'Nudge right', order: 61, default: [{ key: 'arrowright' }], hint: 'Move 1 mm along the axis nearest to right on screen (Shift: 10 mm)' },
  nudgeUp: { chapter: 'Move', name: 'Nudge up', order: 62, default: [{ key: 'arrowup' }], hint: 'Move 1 mm along the axis nearest to up on screen (Shift: 10 mm)' },
  nudgeDown: { chapter: 'Move', name: 'Nudge down', order: 63, default: [{ key: 'arrowdown' }], hint: 'Move 1 mm along the axis nearest to down on screen (Shift: 10 mm)' },
  confirm: { chapter: 'While a tool runs', name: 'Confirm', order: 70, default: [{ key: 'enter' }], hint: 'While a tool, move or pick runs: finish it (also: apply a waiting boolean or group)' },
  cancel: { chapter: 'While a tool runs', name: 'Cancel', order: 71, default: [{ key: 'escape' }], hint: 'While a tool, move or pick runs: stop it and put things back' },
  otherSide: { chapter: 'While a tool runs', name: 'Other side', order: 72, default: [{ key: 'tab' }], hint: 'Typing a size: switch between width and height (or the number of sides)' },
  erase: { chapter: 'While a tool runs', name: 'Erase', order: 73, default: [{ key: 'backspace' }], hint: "Remove the last typed character (or a line's last point)" },
  moreSnaps: { chapter: 'Drawing aids', name: 'More snap points', order: 75, default: [{ key: 'a', shift: false }], hint: 'Drawing, pointer on a line: one more evenly spaced snap point along it (a circle: around it)' },
  fewerSnaps: { chapter: 'Drawing aids', name: 'Fewer snap points', order: 76, default: [{ key: 'a', shift: true }], hint: 'Drawing, pointer on a line: one snap point fewer along it' },
  baseline: { chapter: 'Drawing aids', name: 'Measure angle from', order: 78, default: [{ key: 'b' }], hint: 'Drawing a line, pointer on a straight line or edge: its angle counts from that line (again, or off a line: from the X axis)' },
  fixGuide: { chapter: 'Drawing aids', name: 'Fix guide line', order: 77, default: [{ key: 'g' }], hint: 'Drawing, pointer on a point: X and Y guides through it (again: they go). Drawing, pointer on a guide line (or the line it extends): it stays until G again or sketch mode ends' },
  toObject: { chapter: 'Shape', name: 'To object', order: 78, default: [{ key: 't' }], hint: 'Pulling (before typing a size): click a corner, edge or face, the pull reaches it' },
  measureValue: { chapter: 'Shape', name: 'Distance measure', order: 78.5, default: [{ key: 'd' }], hint: 'Open the Distance measure tool, again: close it. Where T (to object) works: it opens, what you were doing waits; its Use puts the value measured at the cursor, to go on typing, or press T or this again' },
  pullPicked: { chapter: 'Shape', name: 'Pull picked areas', order: 74, default: [{ key: 'e' }], hint: 'Picking areas: pull the picked ones (as Confirm does)' },
} satisfies Record<string, Binding>;

export type Action = keyof typeof KEYS;

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** The keys set in Settings → Hotkeys, by action, and the modifier for each role (left out: the defaults); kept in this browser. */
const STORE = 'makermaker.keys';
type Custom = { keys: Partial<Record<Action, Combo[]>>; roles: Partial<Record<Role, Modifier>> };
let custom: Custom = { keys: {}, roles: {} };
try {
  custom = { ...custom, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') };
} catch {
  // none kept
}
const keep = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(custom));
  } catch {
    // not kept this time
  }
};

/** `action`'s keys now: as set in Settings, else its defaults. */
export const keysOf = (action: Action): Combo[] => custom.keys[action] ?? KEYS[action].default;

/** Sets `action`'s keys (null: back to its defaults). */
export function setKeys(action: Action, combos: Combo[] | null) {
  if (combos) custom.keys[action] = combos;
  else delete custom.keys[action];
  keep();
}

/** Every key and modifier role back to its default. */
export function resetKeys() {
  custom = { keys: {}, roles: {} };
  keep();
}

/** The key a key event means: as typed (so a layout's own letters count), but its physical letter or digit while Alt types a special character (⌥A: å on a Mac). */
export function keyOf(e: KeyboardEvent) {
  const typed = e.key.toLowerCase();
  if (!e.altKey || /^[a-z0-9]$/.test(typed)) return typed;
  return e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code.startsWith('Digit') ? e.code.slice(5) : typed;
}

/** Whether `e` is one of `action`'s keys. */
export function pressed(e: KeyboardEvent, action: Action): boolean {
  return keysOf(action).some((c) => keyOf(e) === c.key && !!c.mod === (e.metaKey || e.ctrlKey) && !!c.alt === e.altKey && (c.shift === undefined || c.shift === e.shiftKey));
}

/** A combination from a key event (null: a modifier alone, still being held). */
export function comboOf(e: KeyboardEvent): Combo | null {
  if (['shift', 'control', 'alt', 'meta'].includes(e.key.toLowerCase())) return null;
  return { key: keyOf(e), ...(e.metaKey || e.ctrlKey ? { mod: true } : {}), ...(e.altKey ? { alt: true } : {}), shift: e.shiftKey };
}

/** Whether two combinations can be the same key press. */
export const sameCombo = (a: Combo, b: Combo) => a.key === b.key && !!a.mod === !!b.mod && !!a.alt === !!b.alt && (a.shift === undefined || b.shift === undefined || a.shift === b.shift);

/** A modifier key. */
export type Modifier = 'shift' | 'ctrl' | 'alt' | 'meta';
export const MODIFIER_NAMES: Record<Modifier, string> = { shift: 'Shift', ctrl: 'Ctrl', alt: MAC ? '⌥ Alt' : 'Alt', meta: MAC ? '⌘' : 'Win' };

/**
 * What each modifier means, in one place (Settings → Hotkeys changes them). At a click it changes what is picked,
 * while moving how things move.
 */
export const MODS = {
  add: { key: 'shift', when: 'click', name: 'Add', hint: 'Adds to the selection or takes away (in lists: a range)' },
  addOne: { key: MAC ? 'meta' : 'ctrl', when: 'click', name: 'Add one, isolate', hint: 'In lists adds one or takes it away; on an eye shows only that body' },
  parts: { key: 'alt', when: 'click', name: 'Faces and edges', hint: 'Picks a face or an edge instead of the body (with Shift: more of them)' },
  tangent: { key: 'ctrl', when: 'click', name: 'Tangent', hint: 'Line tool: a click on a circle, arc or curve starts a line tangent to it (a right click does too)' },
  constrain: { key: 'shift', when: 'moving', name: 'Constrain', hint: 'Square, keeps proportions, 15° turns, ten times bigger steps' },
  precise: { key: 'ctrl', when: 'moving', name: 'Precise', hint: 'Steps of the minimum step (Settings → General)' },
  centre: { key: 'alt', when: 'moving', name: 'From the centre', hint: 'Draws and resizes from the centre (with the others too)' },
} satisfies Record<string, { key: Modifier; when: 'click' | 'moving'; name: string; hint: string }>;

export type Role = keyof typeof MODS;

/** The modifier `role` uses now: as set in Settings, else its default. */
export const roleKey = (r: Role): Modifier => custom.roles[r] ?? MODS[r].key;

/** Sets the modifier for `role`. */
export function setRole(r: Role, m: Modifier) {
  if (m === MODS[r].key) delete custom.roles[r];
  else custom.roles[r] = m;
  keep();
}

/** What a mouse or key event tells of the modifiers held. */
export type ModEvent = { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };

/** Whether `role`'s modifier is held in `e`. */
export const role = (e: ModEvent, r: Role) => e[`${roleKey(r)}Key`];

/** The KeyboardEvent key of `role`'s modifier ('Shift', 'Control' …), to follow it being pressed and let go. */
export const roleKeyName = (r: Role) => ({ shift: 'Shift', ctrl: 'Control', alt: 'Alt', meta: 'Meta' })[roleKey(r)];

/** Adds one in lists, isolates on an eye. */
export const mod = (e: MouseEvent) => role(e, 'addOne');
/** A click that adds to the selection or takes away. */
export const toggles = (e: MouseEvent) => role(e, 'add') || mod(e);
/** A click that picks a face or an edge. */
export const picksFace = (e: MouseEvent) => role(e, 'parts');
const NAMES: Record<string, string> = { escape: 'Esc', enter: '↵', tab: 'Tab', backspace: '⌫', delete: 'Del', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', ' ': 'Space' };

/** A key combination as shown to people: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere. */
export function comboText(c: Combo) {
  const key = NAMES[c.key] ?? c.key.toUpperCase();
  return MAC ? `${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.mod ? '⌘' : ''}${key}` : [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+');
}
