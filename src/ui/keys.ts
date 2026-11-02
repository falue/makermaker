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
  fit: { chapter: 'View', name: 'Fit', order: 30, default: [{ key: 'f' }], hint: 'Move the camera back or forth, as it looks now, until everything is in view' },
  home: { chapter: 'View', name: 'Home', order: 30.5, default: [{ key: 'h' }], hint: 'Everything framed from the front-right corner' },
  cycle: { chapter: 'View', name: 'Next body under the pointer', order: 31, default: [{ key: 'tab', shift: false }], hint: 'Select the next body under the pointer (typing a size: Tab switches the side instead)' },
  cycleBack: { chapter: 'View', name: 'Previous body under the pointer', order: 32, default: [{ key: 'tab', shift: true }], hint: 'Select the previous body under the pointer' },
  rect: { chapter: 'Draw', name: 'Rectangle', order: 40, default: [{ key: 'r' }], hint: 'Draw a rectangle (and pull it up, or keep it flat)' },
  circle: { chapter: 'Draw', name: 'Circle', order: 41, default: [{ key: 'c' }], hint: 'Draw a circle (a cylinder when pulled)' },
  ngon: { chapter: 'Draw', name: 'Regular polygon', order: 42, default: [{ key: 'n' }], hint: 'Draw a regular polygon' },
  polygon: { chapter: 'Draw', name: 'Polygon', order: 43, default: [{ key: 'p' }], hint: 'Draw a polygon corner by corner (Esc: leave it open)' },
  line: { chapter: 'Draw', name: 'Line', order: 43.5, default: [{ key: 'l' }], hint: 'Draw a single line (never extruded); hold ⌘ (else Ctrl) after one: the next starts where it ended' },
  construction: { chapter: 'Draw', name: 'Construction', order: 43.8, default: [{ key: 'q' }], hint: 'Switch selected sketch objects to construction lines and back; the next ones are drawn the same' },
  sphere: { chapter: 'Draw', name: 'Sphere', order: 44, default: [{ key: 'o' }], hint: 'Draw a sphere from its centre' },
  sketch: { chapter: 'Draw', name: 'New sketch', order: 45, default: [{ key: 's' }], hint: 'A new sketch on a face or a base plane' },
  extrude: { chapter: 'Shape', name: 'Extrude', order: 46, default: [{ key: 'e' }], hint: 'Pull shapes or areas, or push and pull a face' },
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
  erase: { chapter: 'While a tool runs', name: 'Erase', order: 73, default: [{ key: 'backspace' }], hint: "Remove the last typed character (or a polygon's last corner)" },
  moreSnaps: { chapter: 'Drawing aids', name: 'More snap points', order: 75, default: [{ key: 'a', shift: false }], hint: 'Drawing, pointer on a line: one more evenly spaced snap point along it (a circle: around it)' },
  fewerSnaps: { chapter: 'Drawing aids', name: 'Fewer snap points', order: 76, default: [{ key: 'a', shift: true }], hint: 'Drawing, pointer on a line: one snap point fewer along it' },
  baseline: { chapter: 'Drawing aids', name: 'Measure angle from', order: 78, default: [{ key: 'b' }], hint: 'Drawing a line or polygon side, pointer on a straight line or edge: its angle counts from that line (again, or off a line: from the X axis)' },
  fixGuide: { chapter: 'Drawing aids', name: 'Fix guide line', order: 77, default: [{ key: 'g' }], hint: 'Drawing, pointer on a guide line (or the line it extends): it stays until G again or sketch mode ends' },
  toObject: { chapter: 'Shape', name: 'To object', order: 78, default: [{ key: 't' }], hint: 'Pulling (before typing a size): click a corner, edge or face, the pull reaches it' },
  pullPicked: { chapter: 'Shape', name: 'Pull picked areas', order: 74, default: [{ key: 'e' }], hint: 'Picking areas: pull the picked ones (as Confirm does)' },
} satisfies Record<string, Binding>;

export type Action = keyof typeof KEYS;

/** Whether `e` is one of `action`'s keys. */
export function pressed(e: KeyboardEvent, action: Action): boolean {
  return (KEYS[action].default as Combo[]).some(
    (c) => e.key.toLowerCase() === c.key && !!c.mod === (e.metaKey || e.ctrlKey) && !!c.alt === e.altKey && (c.shift === undefined || c.shift === e.shiftKey),
  );
}

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * What each modifier means, in one place (the settings list them; a mapper will change them later). At a click it
 * changes what is picked, while moving how things move.
 */
export const MODS = [
  { key: 'Shift', when: 'click', name: 'Add', hint: 'Adds to the selection or takes away (in lists: a range)' },
  { key: MAC ? '⌘' : 'Ctrl', when: 'click', name: 'Add one, isolate, go on', hint: 'In lists adds one or takes it away; on an eye shows only that body; with the line tool: the next line from the last end' },
  { key: 'Alt', when: 'click', name: 'Faces and edges', hint: 'Picks a face or an edge instead of the body (with Shift: more of them)' },
  { key: 'Shift', when: 'moving', name: 'Constrain', hint: 'Square, keeps proportions, 15° turns, ten times bigger steps' },
  { key: 'Ctrl', when: 'moving', name: 'Precise', hint: 'Steps of the minimum step (Settings → General)' },
  { key: 'Alt', when: 'moving', name: 'From the centre', hint: 'Draws and resizes from the centre (with the others too)' },
] as const;

/** ⌘ on a Mac, else Ctrl: adds one in lists, isolates on an eye, goes on with the line tool. */
export const mod = (e: MouseEvent) => (MAC ? e.metaKey : e.ctrlKey);
/** A click that adds to the selection or takes away. */
export const toggles = (e: MouseEvent) => e.shiftKey || mod(e);
/** A click that picks a face or an edge. */
export const picksFace = (e: MouseEvent) => e.altKey;
const NAMES: Record<string, string> = { escape: 'Esc', enter: '↵', tab: 'Tab', backspace: '⌫', delete: 'Del', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', ' ': 'Space' };

/** A key combination as shown to people: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere. */
export function comboText(c: Combo) {
  const key = NAMES[c.key] ?? c.key.toUpperCase();
  return MAC ? `${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.mod ? '⌘' : ''}${key}` : [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+');
}
