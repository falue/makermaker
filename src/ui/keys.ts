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

/**
 * Every keyboard action with its default keys, in one place (a keyboard mapper will edit these later). App actions
 * run from the app's key handler; tool keys act while a tool, a move, a resize or a pick runs. Typed values (digits,
 * units, expressions) and the drag modifiers (Ctrl snaps, Alt free, Shift proportional) are not listed here yet.
 */
export const KEYS = {
  // file and history
  save: [{ key: 's', mod: true }],
  open: [{ key: 'o', mod: true }],
  undo: [{ key: 'z', mod: true, shift: false }],
  redo: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }],
  // view
  fit: [{ key: 'f' }],
  /** The next (or previous) body under the last click. */
  cycle: [{ key: 'tab', shift: false }],
  cycleBack: [{ key: 'tab', shift: true }],
  // tools
  rect: [{ key: 'r' }],
  circle: [{ key: 'c' }],
  ngon: [{ key: 'n' }],
  polygon: [{ key: 'p' }],
  sphere: [{ key: 'o' }],
  extrude: [{ key: 'e' }],
  sketch: [{ key: 's' }],
  group: [{ key: 'g', mod: true, shift: false }],
  ungroup: [{ key: 'g', mod: true, shift: true }],
  // the selection
  duplicate: [{ key: 'd', mod: true }],
  delete: [{ key: 'delete' }, { key: 'backspace' }],
  /** Clears the selection; in sketch mode leaves it. */
  deselect: [{ key: 'escape' }],
  /** Nudge 1 mm along the axis nearest to the arrow on screen; with Shift 10 mm. */
  nudgeLeft: [{ key: 'arrowleft' }],
  nudgeRight: [{ key: 'arrowright' }],
  nudgeUp: [{ key: 'arrowup' }],
  nudgeDown: [{ key: 'arrowdown' }],
  // while a tool, move, resize or pick runs
  confirm: [{ key: 'enter' }],
  cancel: [{ key: 'escape' }],
  /** Typing a size: switch to the other side (width / height, or the number of sides). */
  otherSide: [{ key: 'tab' }],
  /** Removes the last typed character (or a polygon's last corner). */
  erase: [{ key: 'backspace' }],
  /** Picking areas: pull the picked ones (as confirm does). */
  pullPicked: [{ key: 'e' }],
} satisfies Record<string, Combo[]>;

export type Action = keyof typeof KEYS;

/** Whether `e` is one of `action`'s keys. */
export function pressed(e: KeyboardEvent, action: Action): boolean {
  return (KEYS[action] as Combo[]).some(
    (c) => e.key.toLowerCase() === c.key && !!c.mod === (e.metaKey || e.ctrlKey) && !!c.alt === e.altKey && (c.shift === undefined || c.shift === e.shiftKey),
  );
}
