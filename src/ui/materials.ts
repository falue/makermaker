import { STANDARD_SECTIONS, toLook } from '../doc/materials';
import type { Light, Material, MaterialLook } from '../doc/types';
import { MaterialPreview, PREVIEW_SCENE } from '../viewer/preview';
import { closeButton } from './icons';
import { pressed } from './keys';

/** What the materials dialog needs of the app. */
export interface MaterialsHost {
  /** The materials saved in the file. */
  saved(): Material[];
  /** What is selected (bodies and groups), as a name; none: only saved materials can be edited. */
  target(): string | null;
  /** How the selection looks now, and its material's id if it has its own. */
  current(): { material?: string; look: MaterialLook };
  assign(material?: string): void;
  /** The selection's look changes, nothing else's: see `changeLook`; `live`: not the first of a drag (one undo step). */
  changeLook(patch: Partial<MaterialLook>, live: boolean): void;
  /** A new material of the file; its id. */
  add(look?: MaterialLook): string;
  edit(id: string, patch: Partial<MaterialLook> | { name: string }, live: boolean): void;
  remove(id: string): void;
  /** Reads a MaterialX file into the file's materials. */
  importFile(file: File): Promise<void>;
  exportFile(): void;
  light(): Light;
}

/** Pictures of the standard materials, made by scripts/render-material-previews.mjs: they never change by themselves. */
const SHIPPED = Object.fromEntries(
  Object.entries(import.meta.glob<string>('./material-previews/*.jpg', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [/([^/]+)\.jpg$/.exec(path)![1], url]),
);

const THUMBS = 'makermaker.materialThumbnails';
const OPEN_SECTIONS = 'makermaker.materialSections';
const KEEP = 300;

/** Small pictures by look and light: they stay in this browser, not in design files. */
function thumbnails() {
  const saved = JSON.parse(localStorage.getItem(THUMBS) ?? '{}') as Record<string, string>;
  return {
    get: (key: string) => saved[key],
    set(key: string, url: string) {
      if (Object.keys(saved).length >= KEEP) for (const k of Object.keys(saved)) delete saved[k];
      saved[key] = url;
      localStorage.setItem(THUMBS, JSON.stringify(saved));
    },
  };
}

/**
 * The materials dialog: the list on the left (a click gives it to what is selected), on the right the teapot and
 * the sliders. On a standard material the first move makes a copy in the file; a material of the file changes,
 * everywhere it is used. ✎ edits a material of the file without selecting it. All live; × or Esc closes.
 */
export function openMaterials(host: MaterialsHost, startEditing?: string) {
  const make = (tag: string, props: object = {}, ...children: (Node | string)[]) => {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  };
  const preview = new MaterialPreview();
  const cache = thumbnails();
  // nothing selected: the file's first material, so the right side shows something
  let editing = startEditing ?? (host.target() ? null : (host.saved()[0]?.id ?? null));
  const search = make('input', { className: 'mat-search', placeholder: 'Search materials', title: 'Shows the materials with this in their name', oninput: () => drawList() }) as HTMLInputElement;
  const folded = new Set<string>(JSON.parse(localStorage.getItem(OPEN_SECTIONS) ?? '[]'));
  const list = make('div', { className: 'mat-list' });
  /** Which look the sliders change when renders have their own. */
  let tab: 'view' | 'render' = 'view';
  // the picture: the 3D view's left of the slider, the rendered one right of it; only the tab's while renders have their own look
  const split = make('input', { type: 'range', min: '0', max: '100', step: '0.1', value: '50', title: 'Left: as in the 3D view. Right: rendered', oninput: () => placeSplit() }) as HTMLInputElement;
  const [left, right] = [make('span', { className: 'left', textContent: '3D view' }), make('span', { className: 'right', textContent: 'Rendered' })];
  const placeSplit = () => {
    const only = editedLook()?.render ? tab : null;
    preview.viewCanvas.style.clipPath = only === 'view' ? 'none' : only === 'render' ? 'inset(0 100% 0 0)' : `inset(0 ${100 - +split.value}% 0 0)`;
    [split.hidden, left.hidden, right.hidden] = [!!only, only === 'render', only === 'view'];
  };
  const compare = make('div', { className: 'mat-compare' }, preview.canvas, preview.viewCanvas, left, right, split);
  const side = make('div', { className: 'mat-edit' });

  const editedLook = (): MaterialLook | undefined => (editing ? host.saved().find((m) => m.id === editing) : host.target() ? host.current().look : undefined);
  const showPreview = () => {
    const look = editedLook();
    if (!look) return;
    const shipped = !editing ? SHIPPED[host.current().material ?? ''] : undefined;
    preview.show(toLook(look), host.light(), shipped);
  };

  const thumb = (look: MaterialLook) => {
    const light = host.light();
    const { color, bump, reflection, translucency, glow, glowStrength, overlay, render } = look;
    const key = JSON.stringify([PREVIEW_SCENE, color, bump, reflection, translucency, glow, glowStrength, overlay, render, light]);
    const img = make('img', { className: 'mat-thumb', alt: '', ...(cache.get(key) ? { src: cache.get(key) } : {}) }) as HTMLImageElement;
    if (!cache.get(key))
      void preview.thumbnail(toLook(look), light).then((url) => {
        cache.set(key, url);
        img.src = url;
      });
    return img;
  };

  const drawList = () => {
    const now = host.target() ? host.current() : null;
    const row = (m: Material, buttons: Node[] = []) =>
      make(
        'div',
        {
          className: `mat-row${now?.material === m.id ? ' on' : ''}${editing === m.id ? ' editing' : ''}`,
          title: host.target() ? `Give ${m.name} to ${host.target()}` : host.saved().includes(m) ? `Edit ${m.name}` : m.name,
          onclick: () => {
            if (host.target()) (editing = null), host.assign(m.id);
            else if (host.saved().includes(m)) editing = m.id; // nothing selected: a material of the file gets edited
            else return;
            drawAll();
          },
        },
        SHIPPED[m.id] ? make('img', { className: 'mat-thumb', alt: '', src: SHIPPED[m.id] }) : thumb(m),
        make('span', { className: 'name', textContent: m.name }),
        ...buttons,
      );
    const button = (text: string, title: string, click: () => void) =>
      make('button', {
        textContent: text,
        title,
        onclick: (e: Event) => {
          e.stopPropagation();
          click();
        },
      });
    const saved = host.saved();
    const importer = make('input', { type: 'file', accept: '.mtlx', hidden: true }) as HTMLInputElement;
    importer.onchange = async () => {
      const file = importer.files?.[0];
      if (!file) return;
      await host.importFile(file);
      drawAll();
    };
    const wanted = search.value.trim().toLowerCase();
    const matches = (m: Material) => m.name.toLowerCase().includes(wanted);
    /** A section's heading (a click folds it) and its rows; while searching, open, and gone if nothing matches. */
    const section = (name: string, rows: Node[]) => {
      if (wanted && !rows.length) return [];
      const open = wanted || !folded.has(name);
      const head = make('h3', {
        className: `mat-section${open ? ' open' : ''}`,
        title: open ? 'Fold' : 'Unfold',
        onclick: () => {
          if (!folded.delete(name)) folded.add(name);
          localStorage.setItem(OPEN_SECTIONS, JSON.stringify([...folded]));
          drawList();
        },
      }, name);
      return [head, ...(open ? rows : [])];
    };
    list.replaceChildren(
      ...section('In this file', saved.filter(matches).map((m) =>
        row(m, [
          button('✎', 'Edit this material, for everything using it', () => {
            editing = editing === m.id ? null : m.id;
            drawAll();
          }),
          button('×', 'Delete this material: what uses it goes back to its group or its own colour', () => {
            if (editing === m.id) editing = null;
            host.remove(m.id);
            drawAll();
          }),
        ]),
      )),
      ...STANDARD_SECTIONS.flatMap(([name, materials]) => section(name, materials.filter(matches).map((m) => row(m)))),
      make(
        'div',
        { className: 'mat-actions' },
        button('+ New', 'A new material in this file', () => {
          editing = host.add();
          drawAll();
        }),
        button('Import', 'Add the materials of a MaterialX file (.mtlx)', () => importer.click()),
        ...(saved.length ? [button('Export', "Save this file's materials as a MaterialX file (.mtlx)", host.exportFile)] : []),
        importer,
      ),
    );
  };

  const drawSide = () => {
    const look = editedLook();
    const target = host.target();
    const saved = editing ? host.saved().find((m) => m.id === editing) : undefined;
    /** A change of what is edited; the list shows a material that appears by it, the sliders stay: one may be held. */
    const change = (patch: Partial<MaterialLook>, live: boolean) => {
      const before = !editing && host.current().material;
      if (editing) host.edit(editing, patch, live);
      else host.changeLook(patch, live);
      showPreview();
      if (!editing && host.current().material !== before) drawList();
    };
    // the tab's look: the render's own while it has one
    const own = tab === 'render' && look?.render;
    const shown = look && own ? { ...look, ...own } : look;
    /** A change of the tab's look. */
    const put = (patch: Partial<NonNullable<MaterialLook['render']>>, live: boolean) => {
      const render = tab === 'render' && editedLook()?.render;
      change(render ? { render: { ...render, ...patch } } : patch, live);
    };
    const same = make('input', {
      type: 'checkbox',
      checked: !look?.render,
      onchange: () => {
        const { color, bump, reflection, translucency, glow, glowStrength, overlay } = editedLook()!;
        // its own: a copy of the 3D view's to start from, edited next
        change({ render: same.checked ? undefined : { color, bump, reflection, translucency, glow, glowStrength, ...(overlay ? { overlay } : {}) } }, false);
        tab = same.checked ? 'view' : 'render';
        drawAll();
      },
    }) as HTMLInputElement;
    const tabButton = (name: typeof tab, label: string) => make('button', { className: tab === name ? 'on' : '', textContent: label, onclick: () => ((tab = name), drawSide()) });
    const slider = (key: 'bump' | 'reflection' | 'translucency' | 'glowStrength', label: string, title: string, left = '', right = '') => {
      const el = make('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(shown![key]), title }) as HTMLInputElement;
      let live = false;
      el.oninput = () => (put({ [key]: +el.value }, live), (live = true));
      el.onchange = () => {
        live = false;
        drawList(); // its picture
      };
      return make('div', { className: 'row light' }, make('span', { textContent: label }), ...(left ? [make('small', { textContent: left })] : []), el, ...(right ? [make('small', { textContent: right })] : []));
    };
    const colour = (key: 'color' | 'glow', title: string) => {
      const el = make('input', { type: 'color', value: shown![key], title, className: 'color' }) as HTMLInputElement;
      let live = false;
      el.oninput = () => (put({ [key]: el.value }, live), (live = true));
      el.onchange = () => {
        live = false;
        drawList();
      };
      return el;
    };
    // the glow's reach, 20 mm to 2 m on a log scale; the right end: no limit
    const reach = () => {
      const el = make('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(shown!.glowReach ? Math.log(shown!.glowReach / 20) / Math.log(100) : 1), title: 'How far the glow lights the bodies around it, fading out on the way (right end: no limit)' }) as HTMLInputElement;
      let live = false;
      el.oninput = () => (put({ glowReach: +el.value >= 1 ? undefined : Math.round(20 * 100 ** +el.value) }, live), (live = true));
      el.onchange = () => (live = false);
      return make('div', { className: 'row light' }, make('span', { textContent: 'Reach' }), make('small', { textContent: 'near' }), el, make('small', { textContent: 'far' }));
    };
    const overlay = make(
      'select',
      {
        title: 'Drawn over its colour',
        onchange: () => {
          const v = (overlay as HTMLSelectElement).value;
          put({ overlay: v === 'metric' || v === 'imperial' ? v : undefined }, false);
          drawList();
        },
      },
      ...[['', 'None'], ['metric', 'Grid 10 × 10 cm, lines every 1 cm'], ['imperial', 'Grid 1 × 1 ft, lines every 1 in']].map(([value, textContent]) => make('option', { value, textContent, selected: (shown?.overlay ?? '') === value })),
    );
    side.replaceChildren(
      compare,
      ...(!look
        ? [make('p', { className: 'hint', textContent: 'Select a body or group to give it a material, or edit a saved one with ✎.' })]
        : [
            saved
              ? make('input', {
                  className: 'mat-name',
                  value: saved.name,
                  title: 'Its name',
                  onchange: (e: Event) => {
                    host.edit(saved.id, { name: (e.target as HTMLInputElement).value }, false);
                    drawList();
                  },
                })
              : make('h3', { className: 'mat-title', textContent: `Custom material for object: ${target}` }),
            ...(saved ? [make('p', { className: 'hint', textContent: 'Changes everything that uses this material.' })] : []),
            make('label', { className: 'check', title: 'Off: renders get a look of their own, edited in its tab' }, same, 'Renders use the same settings as the 3D view'),
            ...(look.render ? [make('div', { className: 'tabs' }, tabButton('view', '3D view'), tabButton('render', 'Rendering'))] : []),
            make('div', { className: 'row light' }, make('span', { textContent: 'Colour' }), colour('color', 'Its colour')),
            slider('bump', 'Surface', 'From a mirror over matte to bumpy', 'mirror', 'bumpy'),
            slider('reflection', 'Reflection', 'How much it mirrors what is around it, like metal'),
            slider('translucency', 'See-through', 'Solid to clear'),
            make('div', { className: 'row light' }, make('span', { textContent: 'Glow' }), (slider('glowStrength', '', 'How strong it glows: it lights what is around').querySelector('input') as HTMLElement), colour('glow', 'Colour of the glow')),
            reach(),
            make('div', { className: 'row light' }, make('span', { textContent: 'Overlay' }), overlay),
          ]),
    );
    placeSplit();
    showPreview();
  };

  const drawAll = () => {
    drawList();
    drawSide();
  };

  const close = () => {
    removeEventListener('keydown', esc, { capture: true });
    preview.dispose();
    dialog.remove();
  };
  const esc = (e: KeyboardEvent) => pressed(e, 'cancel') && (e.stopImmediatePropagation(), close());
  const dialog = make(
    'div',
    {
      className: 'settings materials',
      onclick: (e: MouseEvent) => {
        if (e.target === dialog) close();
      },
    },
    make('div', { className: 'box' }, make('div', { className: 'head' }, make('h2', {}, 'Materials'), closeButton('Close (Esc)', close)), make('div', { className: 'mat-columns' }, make('div', { className: 'mat-left' }, search, list), side)),
  );
  addEventListener('keydown', esc, { capture: true });
  document.body.append(dialog);
  drawAll();
}
