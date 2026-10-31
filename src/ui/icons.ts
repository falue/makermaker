// Stroke icons on a 24 grid, in the style of incase.
const ICONS = {
  new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
  open: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  autosave: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><path d="M12 8v4l3 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  ngon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/>',
  help: '<path d="M4 20L20 4" stroke-dasharray="3 3"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M12 4v-2M12 22v-2" stroke-dasharray="1 2"/>',
  circle: '<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/>',
  polygon: '<path d="M4 18l3-12 9-2 4 9-7 7z"/>',
  sketch: '<path d="M3 17l9 4 9-4-9-4z"/><path d="M15 3l3 3-6 6H9V9z"/>',
  select: '<path d="M6 3l12 9-6 1-3 6z"/>',
  finish: '<path d="M5 12l5 5 9-10"/>',
  extrude: '<path d="M4 17l8 4 8-4-8-4z"/><path d="M12 15V3M8 7l4-4 4 4"/>',
  look: '<rect x="4" y="4" width="16" height="16" rx="1"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" opacity=".35"/><path d="M4 4l16 16"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  delete: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  left: '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
  centerX: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  right: '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
  top: '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
  centerY: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  bottom: '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
  distributeX: '<path d="M3 4v16M21 4v16"/><rect x="6" y="8" width="3" height="8" rx="1"/><rect x="15" y="8" width="3" height="8" rx="1"/><rect x="10.5" y="8" width="3" height="8" rx="1"/>',
  distributeY: '<path d="M4 3h16M4 21h16"/><rect x="8" y="6" width="8" height="3" rx="1"/><rect x="8" y="15" width="8" height="3" rx="1"/><rect x="8" y="10.5" width="8" height="3" rx="1"/>',
  unlink: '<path d="M15 9l3-3a3 3 0 0 0-4.2-4.2l-3 3M9 15l-3 3a3 3 0 0 0 4.2 4.2l3-3M4 8h3M8 4v3M20 16h-3M16 20v-3"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  section: '<path d="M4 20L20 4"/><path d="M4 12l8-8M12 20l8-8" stroke-dasharray="2 2"/>',
};

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

/** Square icon button (incase's toolbar style); `on` marks an active mode. */
export function tool(name: IconName, title: string, onclick: () => void, on = false, disabled = false) {
  return Object.assign(document.createElement('button'), { className: `tool${on ? ' on' : ''}`, title, innerHTML: icon(name), onclick, disabled });
}
