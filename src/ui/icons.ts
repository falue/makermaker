// Stroke icons on a 24 grid, in the style of incase: one file each in ./icons (bundled with the app). Parts with
// class="faint" (and dashed ones) show in a lighter grey on toolbar buttons.
const ICONS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('./icons/*.svg', { query: '?raw', import: 'default', eager: true })).map(([path, svg]) => [path.slice('./icons/'.length, -'.svg'.length), svg]),
);

/** An icon's file name, without .svg. */
export type IconName = string;

export const icon = (name: IconName) => ICONS[name];

/** Square icon button (incase's toolbar style); `on` marks an active mode. */
export function tool(name: IconName, title: string, onclick: () => void, on = false, disabled = false) {
  return Object.assign(document.createElement('button'), { className: `tool${on ? ' on' : ''}`, title, innerHTML: icon(name), onclick, disabled });
}

/** How a dialog or panel closes: this icon, top right of its head. */
export function closeButton(title: string, onclick: () => void) {
  return Object.assign(document.createElement('button'), { className: 'icon', innerHTML: icon('close'), title, onclick });
}

/** A button that deletes something: the red trash icon. */
export function deleteButton(title: string, onclick: (e: MouseEvent) => void) {
  return Object.assign(document.createElement('button'), { className: 'icon danger', innerHTML: icon('delete'), title, onclick });
}
