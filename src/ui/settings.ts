import { UNITS } from '../doc/expr';
import { DEFAULT_LIGHT, effectiveLight, STANDARD_MATERIALS, toLook } from '../doc/materials';
import { MaterialPreview } from '../viewer/preview';
import type { Light, PhotoSphere, Unit } from '../doc/types';
import { lightRows } from './light';
import { BUILT_IN_PHOTOS } from './photospheres';
import { backdropCss, SKIES } from '../viewer/sky';
import { CHAPTERS, comboOf, comboText, KEYS, keysOf, MAC, MODIFIER_NAMES, MODS, pressed, resetKeys, roleKey, sameCombo, setKeys, setRole, type Action, type Binding, type Combo, type Modifier, type Role } from './keys';

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
  /** How long a joint plays from its min to its max at speed 1, in seconds. */
  jointSeconds: number;
  /** Background of the 3D view and of new renders: the theme's grey, two colours meeting sharply at the horizon, a sky preset (`sky`: its index), or a photo sphere of the open document (`turn`: degrees; another document without it: the grey). */
  background: { mode: 'solid' | 'colours' | 'sky' | 'photo'; top: string; bottom: string; sky: number; photo: string | null; turn: number };
  /** The light of the 3D view. */
  light: Light;
  /** The light of renders (`same`: the 3D view's instead), and their haze, 0 to 1: fast by depth, and real fog in the path tracer. */
  renderLight: Light & { same: boolean; haze: number; fog: number };
  /** How far (mm) the 3D view's surfaces may stray from the real ones. */
  meshDetail: number;
}

const KEY = 'makermaker.settings';
const DEFAULTS: Settings = { ao: false, minStep: 0.01, minAngle: 0.01, guideMs: 333, jointSeconds: 4, background: { mode: 'solid', top: '#fafafa', bottom: '#c9ccd2', sky: 4, photo: null, turn: 0 }, light: DEFAULT_LIGHT, renderLight: { ...DEFAULT_LIGHT, same: true, haze: 0, fog: 0 }, meshDetail: 0.05 };

export function loadSettings(): Settings {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
  return { ...DEFAULTS, ...saved, background: { ...DEFAULTS.background, ...saved.background }, light: { ...DEFAULTS.light, ...saved.light }, renderLight: { ...DEFAULTS.renderLight, ...saved.renderLight } };
}

/**
 * The settings dialog: changes apply and are saved at once; × or Esc closes it. `doc`: the open document's own
 * settings (its units, shown under General) and its photo spheres.
 */
export function openSettings(settings: Settings, changed: (next: Settings) => void, doc: { units(): Unit; setUnits(units: Unit): void; photos(): PhotoSphere[]; addPhoto(file: File): Promise<string>; removePhoto(id: string): void }, start?: 'light-render') {
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
    showLight();
    if (redraw) draw();
  };
  const body = make('div', { className: 'body' });
  const nav = make('nav', { className: 'chapters' });
  /** How closely the view draws curves: applied when the slider is let go, as all bodies mesh anew. */
  const meshRows = () => {
    const value = make('span', {}, `${s.meshDetail} mm`);
    const slider = input({ type: 'range', min: '0.02', max: '0.12', step: '0.01', value: String(s.meshDetail), title: 'Left: finer curves, slower. Right: coarser curves, faster' });
    slider.oninput = () => (value.textContent = `${slider.value} mm`);
    slider.onchange = () => set({ ...s, meshDetail: +slider.value }, false);
    return [
      make('h3', {}, 'Mesh detail'),
      make('p', { className: 'hint' }, 'How far the 3D view may stray from the real curves. Smaller: rounder, slower. Your model and its exports stay exact; renders and the Info panel use this mesh, so they follow it a little.'),
      make('div', { className: 'row light' }, slider, value),
    ];
  };
  /** The document's photo spheres to pick from, adding one, and how far the shown one is turned. */
  const photoRows = () => {
    const bg = s.background;
    const add = input({ type: 'file', accept: 'image/*', hidden: true });
    add.onchange = async () => {
      const file = add.files?.[0];
      if (!file) return;
      set({ ...s, background: { ...s.background, photo: await doc.addPhoto(file) } });
    };
    const turn = input({ type: 'range', min: '-180', max: '180', step: '1', value: String(bg.turn), title: 'Turn the photo around, degrees' });
    turn.oninput = () => set({ ...s, background: { ...s.background, turn: +turn.value } }, false);
    const sphere = (p: { id: string }, picture: string, title: string) => {
      const el = make('button', { className: `sky photo${bg.photo === p.id ? ' on' : ''}`, title, onclick: () => set({ ...s, background: { ...bg, photo: p.id } }) });
      el.style.backgroundImage = `url(${picture})`;
      return el;
    };
    return [
      make(
        'div',
        { className: 'skies' },
        ...BUILT_IN_PHOTOS.map((p) => sphere(p, p.thumb, `${p.name}: click to show`)),
        ...doc.photos().map((p) => {
          const el = sphere(p, p.data, `${p.name}: click to show · × deletes it`);
          el.append(make('span', { className: 'drop', textContent: '×', onclick: (e: Event) => (e.stopPropagation(), doc.removePhoto(p.id), draw()) }));
          return el;
        }),
        make('button', { className: 'sky add', title: 'Add a photo sphere: an equirectangular picture, about 2:1 (saved in this document)', textContent: '+', onclick: () => add.click() }),
      ),
      add,
      make('div', { className: 'row light' }, make('span', {}, 'Turn'), turn),
    ];
  };
  let lightTab: 'view' | 'render' = start ? 'render' : 'view';
  let lightPreview: MaterialPreview | null = null;
  /** The light of renders on the teapot in steel. */
  const showLight = () => {
    const light = s.renderLight.same ? s.light : s.renderLight;
    lightPreview?.show(toLook(STANDARD_MATERIALS.find((m) => m.id === 'std-light-grey')!), effectiveLight(light), undefined, s.renderLight);
  };
  /** Chapters: the left column lists them, the right shows the open one. */
  const chapters: [string, () => Node[]][] = [
    [
      'General',
      () => {
        // a positive number setting: its heading, what it does, its field
        const number = (key: 'minStep' | 'minAngle' | 'guideMs' | 'jointSeconds', title: string, hint: string) => {
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
          ...number('jointSeconds', 'Joint play time', "How long a joint plays from its min to its max, in seconds; each joint's Speed (in its edit panel) makes it faster or slower."),
        ];
      },
    ],
    [
      '3D view',
      () => {
        const ao = input({ type: 'checkbox', checked: s.ao, onchange: () => set({ ...s, ao: ao.checked }) });
        const bg = s.background;
        const mode = (value: Settings['background']['mode'], label: string) =>
          make('label', { className: 'check' }, input({ type: 'radio', name: 'bg', checked: bg.mode === value, onchange: () => set({ ...s, background: { ...bg, mode: value, photo: value === 'photo' ? (bg.photo ?? BUILT_IN_PHOTOS[0].id) : bg.photo } }) }), label);
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
          make('div', { className: 'row wrap' }, mode('solid', 'Solid (the theme grey)'), mode('colours', 'Two colours'), mode('sky', 'Sky'), mode('photo', 'Photo sphere')),
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
          ...(bg.mode === 'photo' ? photoRows() : []),
          ...meshRows(),
        ];
      },
    ],
    [
      'Light',
      () => {
        const tab = (name: 'view' | 'render', label: string) => make('button', { className: lightTab === name ? 'on' : '', textContent: label, onclick: () => ((lightTab = name), draw()) });
        const standard = (l: Light, put: (next: Partial<Light>) => void) =>
          make('button', {
            className: l.standard ? 'on' : '',
            textContent: l.standard ? 'Standard light: on' : 'Use the standard light',
            title: 'All the settings below left aside for the standard light (they are kept)',
            onclick: () => put({ standard: !l.standard }),
          });
        const head = make('div', { className: 'segmented' }, tab('view', '3D view'), tab('render', 'Rendering'));
        if (lightTab === 'view') {
          const put = (patch: Partial<Light>) => set({ ...s, light: { ...s.light, ...patch } });
          return [
            head,
            make('div', { className: 'row' }, standard(s.light, put)),
            ...(s.light.standard ? [] : lightRows(s.light, (light, _, layout) => set({ ...s, light }, !!layout))),
          ];
        }
        const r = s.renderLight;
        const put = (patch: Partial<Settings['renderLight']>) => set({ ...s, renderLight: { ...s.renderLight, ...patch } });
        lightPreview ??= new MaterialPreview();
        lightPreview.canvas.className = 'light-preview';
        lightPreview.canvas.title = 'These settings on the teapot of the material pictures, in Plastic, light grey';
        showLight();
        const same = input({ type: 'checkbox', checked: r.same, onchange: () => put({ same: same.checked }) });
        const haze = (key: 'haze' | 'fog', label: string, title: string) => {
          const el = input({ type: 'range', min: '0', max: '1', step: '0.01', value: String(r[key]), title });
          el.oninput = () => set({ ...s, renderLight: { ...s.renderLight, [key]: +el.value } }, false);
          return make('div', { className: 'row light' }, make('span', {}, label), el);
        };
        return [
          head,
          lightPreview.canvas,
          make('p', { className: 'hint' }, 'Every render takes these when it runs. In renders a photo sphere lights the model too, instead of the ambient colour.'),
          make('label', { className: 'check' }, same, 'Same as 3D viewer'),
          ...(r.same
            ? []
            : [
                make('div', { className: 'row' }, standard(r, put)),
                ...(r.standard ? [] : lightRows(r, (light, _, layout) => set({ ...s, renderLight: { ...s.renderLight, ...light } }, !!layout))),
              ]),
          make('h3', {}, 'Haze'),
          haze('haze', 'Haze', 'Far things fade into haze. Fast, no grain'),
          haze('fog', 'Real fog', 'A fog in the path tracer: light scatters in it, the sun can make beams. For people with time: slower, and grainier'),
        ];
      },
    ],
    [
      'Hotkeys',
      () => {
        // every key the app reacts to (the key table), by chapter: a click on a key records a new one, × drops it, + adds one
        const keys = (Object.entries(KEYS) as [Action, Binding][]).sort((a, b) => a[1].order - b[1].order);
        const clash = (action: Action, c: Combo) =>
          keys.filter(([other, k]) => other !== action && (k.chapter === KEYS[action].chapter || k.chapter !== 'While a tool runs') && keysOf(other).some((o) => sameCombo(o, c))).map(([, k]) => k.name);
        /** A field that takes the next key press (with its modifiers) as `action`'s key number `n` (past the end: a new one); Esc alone stops. */
        const recorder = (action: Action, n: number, shown: string) => {
          const field = input({ value: shown, readOnly: true, className: 'key-rec', placeholder: 'Press keys …', title: 'Click, then press the keys (Esc: keep it as it was)' });
          field.onfocus = () => ((field.value = ''), field.classList.add('on'));
          field.onblur = () => ((field.value = shown), field.classList.remove('on'));
          field.onkeydown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Escape' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) return field.blur();
            const c = comboOf(e);
            if (!c) return; // a modifier alone: the key still to come
            const list = [...keysOf(action)];
            list[n] = c;
            setKeys(action, list);
            draw();
          };
          return field;
        };
        const rows = CHAPTERS.flatMap((chapter) => [
          make('tr', { className: 'chapter' }, make('th', { colSpan: 2 }, chapter)),
          ...keys
            .filter(([, k]) => k.chapter === chapter)
            .map(([action, k]) => {
              const combos = keysOf(action);
              const warn = combos.flatMap((c) => clash(action, c));
              return make(
                'tr',
                { title: k.hint },
                make('td', {}, k.name, ...(keysOf(action) !== k.default ? [make('span', { className: 'changed', title: 'Changed from its default' }, ' •')] : []), make('div', { className: 'hint' }, k.hint)),
                make(
                  'td',
                  {},
                  make(
                    'div',
                    { className: 'keys' },
                    ...combos.map((c, i) => make('span', { className: 'key' }, recorder(action, i, comboText(c)), make('button', { className: 'drop', textContent: '×', title: 'Drop this key', onclick: () => (setKeys(action, combos.filter((_, j) => j !== i)), draw()) }))),
                    make('button', {
                      className: 'add',
                      textContent: '+',
                      title: 'Add a key: click, then press it',
                      onclick: (e: Event) => {
                        const field = recorder(action, combos.length, '');
                        field.onblur = () => draw(); // none pressed: the + comes back
                        (e.target as HTMLElement).replaceWith(field);
                        field.focus();
                      },
                    }),
                  ),
                  ...(warn.length ? [make('div', { className: 'warn' }, `Also: ${[...new Set(warn)].join(', ')}`)] : []),
                ),
              );
            }),
        ]);
        // the modifiers: what they mean at a click and while moving, each switched to another
        const roles = Object.entries(MODS) as [Role, (typeof MODS)[Role]][];
        const modRows = roles.map(([r, m]) => {
          const now = roleKey(r);
          const warn = [
            ...roles.filter(([o, n]) => o !== r && n.when === m.when && roleKey(o) === now).map(([, n]) => `also ${n.name}`),
            ...(MAC && now === 'ctrl' && m.when === 'click' ? ['Ctrl-click is a right click on a Mac'] : []),
            ...(now === 'meta' && !MAC ? ['the Windows key opens the start menu'] : []),
          ];
          const choice = make('span', { className: 'segmented' }, ...(Object.keys(MODIFIER_NAMES) as Modifier[]).map((k) => make('button', { className: k === now ? 'on' : '', textContent: MODIFIER_NAMES[k], onclick: () => (setRole(r, k), draw()) })));
          return make('tr', { title: m.hint }, make('td', {}, `${m.name} (${m.when})`, make('div', { className: 'hint' }, m.hint)), make('td', {}, choice, ...(warn.length ? [make('div', { className: 'warn' }, `Careful: ${warn.join('; ')}`)] : [])));
        });
        return [
          make('h3', {}, 'Hotkeys'),
          make('p', { className: 'hint' }, 'Click a key and press the new one (with its modifiers); + adds one more, × drops one. Keys also used elsewhere are marked. They are kept in this browser.'),
          make('div', { className: 'row' }, make('button', { textContent: 'Reset to defaults', title: 'Every key and modifier back as it came', onclick: () => (resetKeys(), draw()) })),
          make('table', { className: 'hotkeys' }, make('tbody', {}, ...rows)),
          make('h3', {}, 'Modifiers'),
          make('p', { className: 'hint' }, 'At a click they change what is picked; while moving, how things move. Without one, a drag moves in steps that follow the zoom. Changing them can clash with the system or each other: the app warns, but lets you.'),
          make('table', { className: 'hotkeys' }, make('tbody', {}, ...modRows)),
        ];
      },
    ],
  ];
  // the chapter open and how far each is scrolled, remembered per browser
  const seen = 'makermaker.settings.seen';
  const last = JSON.parse(localStorage.getItem(seen) ?? '{}') as { open?: string; scrolled?: Record<string, number> };
  const scrolled = last.scrolled ?? {};
  let open = Math.max(0, chapters.findIndex(([name]) => name === (start ? 'Light' : last.open)));
  const remember = () => localStorage.setItem(seen, JSON.stringify({ open: chapters[open][0], scrolled }));
  const restore = () => (body.scrollTop = scrolled[chapters[open][0]] ?? 0);
  body.onscroll = () => {
    scrolled[chapters[open][0]] = body.scrollTop;
    remember();
  };
  const draw = () => {
    nav.replaceChildren(...chapters.map(([name], i) => make('button', { className: `chapter${i === open ? ' on' : ''}`, textContent: name, onclick: () => ((open = i), remember(), draw()) })));
    body.replaceChildren(...chapters[open][1]());
    restore();
  };
  draw();
  const close = () => {
    removeEventListener('keydown', esc, { capture: true });
    lightPreview?.dispose();
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
  restore();
}
