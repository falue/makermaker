import { UNITS } from '../doc/expr';
import type { Unit } from '../doc/types';
import { backdropCss, SKIES } from '../viewer/sky';

/** Settings of this browser (not of the document). */
export interface Settings {
  /** Ambient occlusion in the 3D view. */
  ao: boolean;
  /** Background of the 3D view and of new renders: the theme's grey, two colours meeting sharply at the horizon, or a sky preset (`sky`: its index). */
  background: { mode: 'solid' | 'colours' | 'sky'; top: string; bottom: string; sky: number };
}

const KEY = 'makermaker.settings';
const DEFAULTS: Settings = { ao: false, background: { mode: 'solid', top: '#fafafa', bottom: '#c9ccd2', sky: 4 } };

export function loadSettings(): Settings {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  return { ...DEFAULTS, ...saved, background: { ...DEFAULTS.background, ...saved.background } };
}

/**
 * The settings dialog: changes apply and are saved at once; × or Esc closes it. `doc`: the open document's own
 * settings (its units), shown under General.
 */
export function openSettings(settings: Settings, changed: (next: Settings) => void, doc: { units(): Unit; setUnits(units: Unit): void }) {
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
  const nav = make('nav', { className: 'chapters' });
  /** Chapters: the left column lists them, the right shows the open one. */
  const chapters: [string, () => Node[]][] = [
    [
      'General',
      () => {
        const units = make('select', { onchange: () => (doc.setUnits(units.value as Unit), draw()) }, ...Object.keys(UNITS).map((u) => make('option', { value: u, selected: u === doc.units(), textContent: u }))) as HTMLSelectElement;
        return [
          make('h3', {}, 'Units'),
          make('p', { className: 'hint' }, "Of this document (saved in its file): how lengths show, and what plain numbers you type mean. Values keep the unit they were typed in."),
          make('div', { className: 'row' }, units),
        ];
      },
    ],
    [
      '3D view',
      () => {
        const ao = input({ type: 'checkbox', checked: s.ao, onchange: () => set({ ...s, ao: ao.checked }) });
        const bg = s.background;
        const mode = (value: Settings['background']['mode'], label: string) =>
          make('label', { className: 'check' }, input({ type: 'radio', name: 'bg', checked: bg.mode === value, onchange: () => set({ ...s, background: { ...bg, mode: value } }) }), label);
        const colour = (key: 'top' | 'bottom', label: string) => {
          const el = input({ type: 'color', value: bg[key], className: 'color' });
          el.oninput = () => set({ ...s, background: { ...s.background, [key]: el.value } }, false); // a redraw would close the picker
          return make('label', { className: 'check' }, el, label);
        };
        return [
          make('h3', {}, 'Ambient occlusion'),
          make('label', { className: 'check' }, ao, 'Soft shadows in corners and creases'),
          make('h3', {}, 'Background'),
          make('p', { className: 'hint' }, 'Of the 3D view, and of new renders (each render keeps its own).'),
          make('div', { className: 'row' }, mode('solid', 'Solid (the theme grey)'), mode('colours', 'Two colours'), mode('sky', 'Sky')),
          ...(bg.mode === 'colours' ? [make('div', { className: 'row' }, colour('top', 'Above the horizon'), colour('bottom', 'Below'))] : []),
          ...(bg.mode === 'sky'
            ? [
                make(
                  'div',
                  { className: 'skies' },
                  ...SKIES.map(([name, b], i) => {
                    const el = make('button', { className: `sky${bg.sky === i ? ' on' : ''}`, title: name, onclick: () => set({ ...s, background: { ...bg, sky: i } }) });
                    el.style.background = backdropCss(b);
                    return el;
                  }),
                ),
              ]
            : []),
        ];
      },
    ],
  ];
  let open = 0;
  const draw = () => {
    nav.replaceChildren(...chapters.map(([name], i) => make('button', { className: `chapter${i === open ? ' on' : ''}`, textContent: name, onclick: () => ((open = i), draw()) })));
    body.replaceChildren(...chapters[open][1]());
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
    make('div', { className: 'box' }, make('div', { className: 'head' }, make('h2', {}, 'Settings'), make('button', { className: 'icon', textContent: '×', title: 'Close', onclick: close })), make('div', { className: 'columns' }, nav, body)),
  );
  addEventListener('keydown', esc, { capture: true });
  document.body.append(dialog);
}
