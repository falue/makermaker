import { UNITS } from '../doc/expr';
import type { Unit } from '../doc/types';
import { backdropCss, SKIES } from '../viewer/sky';
import { CHAPTERS, comboText, KEYS, MODS, pressed, type Binding } from './keys';

/** Settings of this browser (not of the document). */
export interface Settings {
  /** Ambient occlusion in the 3D view. */
  ao: boolean;
  /** The smallest step values move in when dragged precisely (Ctrl), in mm. */
  minStep: number;
  /** The smallest step angles move in when drawn precisely (Ctrl), in degrees. */
  minAngle: number;
  /** How long (ms) the pointer rests on a line or point while drawing before it gets guide lines. */
  guideMs: number;
  /** Background of the 3D view and of new renders: the theme's grey, two colours meeting sharply at the horizon, or a sky preset (`sky`: its index). */
  background: { mode: 'solid' | 'colours' | 'sky'; top: string; bottom: string; sky: number };
}

const KEY = 'makermaker.settings';
const DEFAULTS: Settings = { ao: false, minStep: 0.01, minAngle: 0.01, guideMs: 333, background: { mode: 'solid', top: '#fafafa', bottom: '#c9ccd2', sky: 4 } };

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
        // a positive number setting: its heading, what it does, its field
        const number = (key: 'minStep' | 'minAngle' | 'guideMs', title: string, hint: string) => {
          const field = input({ type: 'number', min: '0', step: 'any', value: String(s[key]), className: 'number' });
          field.onchange = () => +field.value > 0 && set({ ...s, [key]: +field.value }, false);
          return [make('h3', {}, title), make('p', { className: 'hint' }, hint), make('div', { className: 'row' }, field)];
        };
        const units = make('select', { onchange: () => (doc.setUnits(units.value as Unit), draw()) }, ...Object.keys(UNITS).map((u) => make('option', { value: u, selected: u === doc.units(), textContent: u }))) as HTMLSelectElement;
        return [
          make('h3', {}, 'Units'),
          make('p', { className: 'hint' }, "Of this document (saved in its file): how lengths show, and what plain numbers you type mean. Values keep the unit they were typed in."),
          make('div', { className: 'row' }, units),
          ...number('minStep', 'Minimum step', 'The smallest step a drag moves in while Ctrl is held (precise), in mm. Without Ctrl the step follows the zoom.'),
          ...number('minAngle', 'Minimum angle', 'The smallest step a drawn line turns in while Ctrl is held, in degrees. Without a key it turns in 1° steps.'),
          ...number('guideMs', 'Guide delay', 'How long the pointer rests on a line or a point while drawing before guide lines show, in milliseconds.'),
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
    [
      'Hotkeys',
      () => {
        // read from the key table: every key the app reacts to is listed there, by chapter
        const keys = (Object.values(KEYS) as Binding[]).sort((a, b) => a.order - b.order);
        const rows = CHAPTERS.flatMap((chapter) => [
          make('tr', { className: 'chapter' }, make('th', { colSpan: 3 }, chapter)),
          ...keys.filter((k) => k.chapter === chapter).map((k) => make('tr', { title: k.hint }, make('td', {}, k.name), make('td', {}, ...k.default.flatMap((c, i) => [...(i ? [' / '] : []), make('kbd', {}, comboText(c))])), make('td', { className: 'hint' }, k.hint))),
        ]);
        // the modifiers: what they mean at a click and while moving
        const mods = MODS.map((m) => make('tr', { title: m.hint }, make('td', {}, `${m.name} (${m.when})`), make('td', {}, make('kbd', {}, m.key)), make('td', { className: 'hint' }, m.hint)));
        return [
          make('h3', {}, 'Hotkeys'),
          make('p', { className: 'hint' }, 'The keys as they are set now (changing them comes later).'),
          make('table', { className: 'hotkeys' }, make('tbody', {}, ...rows)),
          make('h3', {}, 'Modifiers'),
          make('p', { className: 'hint' }, 'At a click they change what is picked; while moving, how things move. Without one, a drag moves in steps that follow the zoom.'),
          make('table', { className: 'hotkeys' }, make('tbody', {}, ...mods)),
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
  const esc = (e: KeyboardEvent) => pressed(e, 'cancel') && (e.stopImmediatePropagation(), close());
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
