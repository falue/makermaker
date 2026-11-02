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

/** A keyboard action: its name and place in the hotkey list, its default keys, and what it does. */
export interface Binding {
  name: string;
  order: number;
  default: Combo[];
  hint: string;
}

/**
 * Every keyboard action, in one place: every key the app reacts to must be listed here (the settings dialog shows
 * this list; a keyboard mapper will edit it later). App actions run from the app's key handler; tool keys act while a
 * tool, a move, a resize or a pick runs. Typed values (digits, units, expressions) and the drag modifiers (Ctrl snaps,
 * Alt free, Shift proportional) are not listed here yet.
 */
export const KEYS = {
  save: { name: 'Save', order: 10, default: [{ key: 's', mod: true }], hint: 'Save the design (a new version in the file)' },
  open: { name: 'Open', order: 11, default: [{ key: 'o', mod: true }], hint: 'Open a design file' },
  undo: { name: 'Undo', order: 20, default: [{ key: 'z', mod: true, shift: false }], hint: 'Undo the last step' },
  redo: { name: 'Redo', order: 21, default: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }], hint: 'Redo the step undone' },
  fit: { name: 'Fit', order: 30, default: [{ key: 'f' }], hint: 'Fit everything into the view' },
  cycle: { name: 'Next body under the pointer', order: 31, default: [{ key: 'tab', shift: false }], hint: 'Select the next body under the pointer (typing a size: Tab switches the side instead)' },
  cycleBack: { name: 'Previous body under the pointer', order: 32, default: [{ key: 'tab', shift: true }], hint: 'Select the previous body under the pointer' },
  rect: { name: 'Rectangle', order: 40, default: [{ key: 'r' }], hint: 'Draw a rectangle (and pull it up, or keep it flat)' },
  circle: { name: 'Circle', order: 41, default: [{ key: 'c' }], hint: 'Draw a circle (a cylinder when pulled)' },
  ngon: { name: 'Regular polygon', order: 42, default: [{ key: 'n' }], hint: 'Draw a regular polygon' },
  polygon: { name: 'Polygon', order: 43, default: [{ key: 'p' }], hint: 'Draw a polygon corner by corner (Esc: leave it open)' },
  line: { name: 'Line', order: 43.5, default: [{ key: 'l' }], hint: 'Draw a single line (never extruded); Ctrl-click: the next line from where the last one ended' },
  construction: { name: 'Construction', order: 43.8, default: [{ key: 'q' }], hint: 'Switch selected sketch objects to construction lines and back; the next ones are drawn the same' },
  sphere: { name: 'Sphere', order: 44, default: [{ key: 'o' }], hint: 'Draw a sphere from its centre' },
  sketch: { name: 'New sketch', order: 45, default: [{ key: 's' }], hint: 'A new sketch on a face or a base plane' },
  extrude: { name: 'Extrude', order: 46, default: [{ key: 'e' }], hint: 'Pull shapes or areas, or push and pull a face' },
  group: { name: 'Group', order: 50, default: [{ key: 'g', mod: true, shift: false }], hint: 'Group the selection (nothing selected: the objects clicked next)' },
  ungroup: { name: 'Ungroup', order: 51, default: [{ key: 'g', mod: true, shift: true }], hint: 'Ungroup the selected group; its contents stay where they are' },
  duplicate: { name: 'Duplicate', order: 52, default: [{ key: 'd', mod: true }], hint: 'Duplicate the selection (or the selected shapes)' },
  delete: { name: 'Delete', order: 53, default: [{ key: 'delete' }, { key: 'backspace' }], hint: 'Delete the selection, or the selected part of a fillet' },
  deselect: { name: 'Deselect', order: 54, default: [{ key: 'escape' }], hint: 'Clear the selection; in sketch mode leave the sketch' },
  moveX: { name: 'Move along X', order: 55, default: [{ key: 'x' }], hint: 'A field at the pointer: type a distance, Enter moves the selection that far along X' },
  moveY: { name: 'Move along Y', order: 56, default: [{ key: 'y' }], hint: 'A field at the pointer: type a distance, Enter moves the selection that far along Y' },
  moveZ: { name: 'Move along Z', order: 57, default: [{ key: 'z' }], hint: 'A field at the pointer: type a distance, Enter moves the selection that far along Z' },
  nudgeLeft: { name: 'Nudge left', order: 60, default: [{ key: 'arrowleft' }], hint: 'Move 1 mm along the axis nearest to left on screen (Shift: 10 mm)' },
  nudgeRight: { name: 'Nudge right', order: 61, default: [{ key: 'arrowright' }], hint: 'Move 1 mm along the axis nearest to right on screen (Shift: 10 mm)' },
  nudgeUp: { name: 'Nudge up', order: 62, default: [{ key: 'arrowup' }], hint: 'Move 1 mm along the axis nearest to up on screen (Shift: 10 mm)' },
  nudgeDown: { name: 'Nudge down', order: 63, default: [{ key: 'arrowdown' }], hint: 'Move 1 mm along the axis nearest to down on screen (Shift: 10 mm)' },
  confirm: { name: 'Confirm', order: 70, default: [{ key: 'enter' }], hint: 'While a tool, move or pick runs: finish it (also: apply a waiting boolean or group)' },
  cancel: { name: 'Cancel', order: 71, default: [{ key: 'escape' }], hint: 'While a tool, move or pick runs: stop it and put things back' },
  otherSide: { name: 'Other side', order: 72, default: [{ key: 'tab' }], hint: 'Typing a size: switch between width and height (or the number of sides)' },
  erase: { name: 'Erase', order: 73, default: [{ key: 'backspace' }], hint: "Remove the last typed character (or a polygon's last corner)" },
  moreSnaps: { name: 'More snap points', order: 75, default: [{ key: 'a', shift: false }], hint: 'Drawing, pointer on a line: one more evenly spaced snap point along it (a circle: around it)' },
  fewerSnaps: { name: 'Fewer snap points', order: 76, default: [{ key: 'a', shift: true }], hint: 'Drawing, pointer on a line: one snap point fewer along it' },
  fixGuide: { name: 'Fix guide line', order: 77, default: [{ key: 'g' }], hint: 'Drawing, pointer on a guide line (or the line it extends): it stays until G again or sketch mode ends' },
  pullPicked: { name: 'Pull picked areas', order: 74, default: [{ key: 'e' }], hint: 'Picking areas: pull the picked ones (as Confirm does)' },
} satisfies Record<string, Binding>;

export type Action = keyof typeof KEYS;

/** Whether `e` is one of `action`'s keys. */
export function pressed(e: KeyboardEvent, action: Action): boolean {
  return (KEYS[action].default as Combo[]).some(
    (c) => e.key.toLowerCase() === c.key && !!c.mod === (e.metaKey || e.ctrlKey) && !!c.alt === e.altKey && (c.shift === undefined || c.shift === e.shiftKey),
  );
}

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/** Ctrl (a Mac: ⌘) adds to or removes from a selection; on a Mac Ctrl picks a face, elsewhere Alt does. */
export const toggles = (e: MouseEvent) => e.shiftKey || e.metaKey || (!MAC && e.ctrlKey);
export const picksFace = (e: MouseEvent) => (MAC ? e.ctrlKey && !e.metaKey : e.altKey);
const NAMES: Record<string, string> = { escape: 'Esc', enter: '↵', tab: 'Tab', backspace: '⌫', delete: 'Del', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', ' ': 'Space' };

/** A key combination as shown to people: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere. */
export function comboText(c: Combo) {
  const key = NAMES[c.key] ?? c.key.toUpperCase();
  return MAC ? `${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.mod ? '⌘' : ''}${key}` : [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+');
}
