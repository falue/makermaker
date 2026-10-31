// Stroke icons on a 24 grid, in the style of incase.
const ICONS = {
  new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
  open: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  autosave: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><path d="M12 8v4l3 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M12 4v-2M12 22v-2" stroke-dasharray="1 2"/>',
  circle: '<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/>',
  polygon: '<path d="M4 18l3-12 9-2 4 9-7 7z"/>',
  sketch: '<path d="M3 17l9 4 9-4-9-4z"/><path d="M15 3l3 3-6 6H9V9z"/>',
  select: '<path d="M6 3l12 9-6 1-3 6z"/>',
  finish: '<path d="M5 12l5 5 9-10"/>',
  cancel: '<path d="M6 6l12 12M18 6L6 18"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  delete: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  section: '<path d="M4 20L20 4"/><path d="M4 12l8-8M12 20l8-8" stroke-dasharray="2 2"/>',
};

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

/** Square icon button (incase's toolbar style); `on` marks an active mode. */
export function tool(name: IconName, title: string, onclick: () => void, on = false, disabled = false) {
  return Object.assign(document.createElement('button'), { className: `tool${on ? ' on' : ''}`, title, innerHTML: icon(name), onclick, disabled });
}
