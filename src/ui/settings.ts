/** Settings of this browser (not of the document). */
export interface Settings {
  /** Ambient occlusion in the 3D view. */
  ao: boolean;
  /** Background of the 3D view and of new renders: the theme's grey, or a gradient from top to bottom of the picture. */
  background: { mode: 'solid' | 'gradient'; top: string; bottom: string };
}

const KEY = 'makermaker.settings';
const DEFAULTS: Settings = { ao: false, background: { mode: 'solid', top: '#fafafa', bottom: '#c9ccd2' } };

export function loadSettings(): Settings {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  return { ...DEFAULTS, ...saved, background: { ...DEFAULTS.background, ...saved.background } };
}

/** The settings dialog: changes apply and are saved at once; × or Esc closes it. */
export function openSettings(settings: Settings, changed: (next: Settings) => void) {
  const make = (tag: string, props: object = {}, ...children: (Node | string)[]) => {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  };
  const input = (props: object) => make('input', props) as HTMLInputElement;
  let s = settings;
  const set = (next: Settings, redraw = true) => {
    s = next;
    localStorage.setItem(KEY, JSON.stringify(s));
    changed(s);
    if (redraw) draw();
  };
  const body = make('div', { className: 'body' });
  const draw = () => {
    const ao = input({ type: 'checkbox', checked: s.ao, onchange: () => set({ ...s, ao: ao.checked }) });
    const bg = s.background;
    const mode = (value: Settings['background']['mode'], label: string) =>
      make('label', { className: 'check' }, input({ type: 'radio', name: 'bg', checked: bg.mode === value, onchange: () => set({ ...s, background: { ...bg, mode: value } }) }), label);
    const colour = (key: 'top' | 'bottom', label: string) => {
      const el = input({ type: 'color', value: bg[key], className: 'color' });
      el.oninput = () => set({ ...s, background: { ...s.background, [key]: el.value } }, false); // a redraw would close the picker
      return make('label', { className: 'check' }, el, label);
    };
    body.replaceChildren(
      make('h3', {}, '3D view'),
      make('label', { className: 'check' }, ao, 'Ambient occlusion (soft shadows in corners; off while a section cuts)'),
      make('h3', {}, 'Background'),
      make('p', { className: 'hint' }, 'Of the 3D view, and of new renders (each render keeps its own).'),
      make('div', { className: 'row' }, mode('solid', 'Solid (the theme grey)'), mode('gradient', 'Gradient')),
      ...(bg.mode === 'gradient' ? [make('div', { className: 'row' }, colour('top', 'Top'), colour('bottom', 'Bottom'))] : []),
    );
  };
  draw();
  const close = () => {
    removeEventListener('keydown', esc, { capture: true });
    dialog.remove();
  };
  const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopImmediatePropagation(), close());
  const dialog = make(
    'div',
    {
      className: 'settings',
      // a click beside the box closes it (no value returned: false would cancel clicks inside)
      onclick: (e: MouseEvent) => {
        if (e.target === dialog) close();
      },
    },
    make('div', { className: 'box' }, make('div', { className: 'head' }, make('h2', {}, 'Settings'), make('button', { className: 'icon', textContent: '×', title: 'Close', onclick: close })), body),
  );
  addEventListener('keydown', esc, { capture: true });
  document.body.append(dialog);
}
