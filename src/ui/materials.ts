import { STANDARD_MATERIALS, toLook } from '../doc/materials';
import type { Light, Material, MaterialLook } from '../doc/types';
import { MaterialPreview } from '../viewer/preview';
import { pressed } from './keys';

/** What the materials dialog needs of the app. */
export interface MaterialsHost {
  /** The materials saved in the file. */
  saved(): Material[];
  /** What is selected (bodies and groups), as a name; none: only saved materials can be edited. */
  target(): string | null;
  /** How the selection looks now: its material's id if it has one, and whether that look is a one-off. */
  current(): { material?: string; oneOff: boolean; look: MaterialLook };
  assign(material?: string): void;
  /** The selection's look changes for itself alone; `live`: not the first of a drag (one undo step). */
  editOneOff(patch: Partial<MaterialLook>, live: boolean): void;
  /** Its one-off becomes a material of the file; its id. */
  saveOneOff(): string;
  /** A new material of the file; its id. */
  add(look?: MaterialLook): string;
  edit(id: string, patch: Partial<MaterialLook> | { name: string }, live: boolean): void;
  remove(id: string): void;
  /** Reads a MaterialX file into the file's materials. */
  importFile(file: File): Promise<void>;
  exportFile(): void;
  light(): Light;
}

const THUMBS = 'makermaker.materialThumbnails';
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
 * the sliders. These change the selection alone (a one-off, saved as a material with one click); ✎ on a saved material
 * edits that one, for everything using it. All live; × or Esc closes.
 */
export function openMaterials(host: MaterialsHost, startEditing?: string) {
  const make = (tag: string, props: object = {}, ...children: (Node | string)[]) => {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  };
  const preview = new MaterialPreview();
  const cache = thumbnails();
  let editing = startEditing ?? null;
  const list = make('div', { className: 'mat-list' });
  const side = make('div', { className: 'mat-edit' });

  const editedLook = (): MaterialLook | undefined => (editing ? host.saved().find((m) => m.id === editing) : host.target() ? host.current().look : undefined);
  const showPreview = () => {
    const look = editedLook();
    if (look) preview.show(toLook(look), host.light());
  };

  const thumb = (look: MaterialLook) => {
    const light = host.light();
    const { color, bump, reflection, translucency, glow, glowStrength, raster } = look;
    const key = JSON.stringify([color, bump, reflection, translucency, glow, glowStrength, raster, light]);
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
          className: `mat-row${now?.material === m.id && !now.oneOff ? ' on' : ''}${editing === m.id ? ' editing' : ''}`,
          title: host.target() ? `Give ${m.name} to ${host.target()}` : m.name,
          onclick: () => {
            if (!host.target()) return;
            editing = null;
            host.assign(m.id);
            drawAll();
          },
        },
        thumb(m),
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
    list.replaceChildren(
      ...(now?.oneOff && !editing
        ? [make('h3', {}, 'One-off'), make('div', { className: 'mat-row on', title: 'A look for this alone' }, thumb(now.look), make('span', { className: 'name', textContent: host.target()! }))]
        : []),
      make('h3', {}, 'Standard'),
      ...STANDARD_MATERIALS.map((m) => row(m)),
      make('h3', {}, 'In this file'),
      ...saved.map((m) =>
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
      ),
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
    /** A change of what is edited; the list shows a new one-off when it appears. */
    const change = (patch: Partial<MaterialLook>, live: boolean) => {
      const wasOneOff = !editing && host.current().oneOff;
      if (editing) host.edit(editing, patch, live);
      else host.editOneOff(patch, live);
      showPreview();
      // a one-off has begun: not the sliders anew, one may be held
      if (!editing && !wasOneOff) {
        drawList();
        saveSlot.replaceChildren(saveButton());
      }
    };
    const saveButton = () =>
      make('button', {
        className: 'primary wide',
        textContent: 'Save as material',
        title: 'Keep this look in the file, under a name, for other objects too',
        onclick: () => {
          editing = host.saveOneOff();
          drawAll();
        },
      });
    const saveSlot = make('div', {}, ...(!saved && look && host.current().oneOff ? [saveButton()] : []));
    const slider = (key: 'bump' | 'reflection' | 'translucency' | 'glowStrength', label: string, title: string, left = '', right = '') => {
      const el = make('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(look![key]), title }) as HTMLInputElement;
      let live = false;
      el.oninput = () => (change({ [key]: +el.value }, live), (live = true));
      el.onchange = () => {
        live = false;
        drawList(); // its picture
      };
      return make('div', { className: 'row light' }, make('span', { textContent: label }), ...(left ? [make('small', { textContent: left })] : []), el, ...(right ? [make('small', { textContent: right })] : []));
    };
    const colour = (key: 'color' | 'glow', title: string) => {
      const el = make('input', { type: 'color', value: look![key], title, className: 'color' }) as HTMLInputElement;
      let live = false;
      el.oninput = () => (change({ [key]: el.value }, live), (live = true));
      el.onchange = () => {
        live = false;
        drawList();
      };
      return el;
    };
    const raster = make(
      'select',
      {
        title: 'A measuring grid on it',
        onchange: () => {
          const v = (raster as HTMLSelectElement).value;
          change({ raster: v === 'metric' || v === 'imperial' ? v : undefined }, false);
          drawList();
        },
      },
      ...[['', 'None'], ['metric', '10 × 10 cm, lines every 1 cm'], ['imperial', '1 × 1 ft, lines every 1 in']].map(([value, textContent]) => make('option', { value, textContent, selected: (look?.raster ?? '') === value })),
    );
    side.replaceChildren(
      preview.canvas,
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
              : make('p', { className: 'hint', textContent: `Only for ${target}. Everything here changes it alone.` }),
            ...(saved ? [make('p', { className: 'hint', textContent: 'Changes everything that uses this material.' })] : []),
            make('div', { className: 'row light' }, make('span', { textContent: 'Colour' }), colour('color', 'Its colour')),
            slider('bump', 'Surface', 'From a mirror over matte to bumpy', 'mirror', 'bumpy'),
            slider('reflection', 'Reflection', 'How much it mirrors what is around it, like metal'),
            slider('translucency', 'See-through', 'Solid to clear'),
            make('div', { className: 'row light' }, make('span', { textContent: 'Glow' }), (slider('glowStrength', '', 'How strong it glows (in renders it lights what is around)').querySelector('input') as HTMLElement), colour('glow', 'Colour of the glow')),
            make('div', { className: 'row light' }, make('span', { textContent: 'Grid' }), raster),
            saveSlot,
          ]),
    );
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
    make('div', { className: 'box' }, make('div', { className: 'head' }, make('h2', {}, 'Materials'), make('button', { className: 'icon', textContent: '×', title: 'Close (Esc)', onclick: () => close() })), make('div', { className: 'mat-columns' }, list, side)),
  );
  addEventListener('keydown', esc, { capture: true });
  document.body.append(dialog);
  drawAll();
}
