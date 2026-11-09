import type { Body, Doc, Group, Light, Material, MaterialLook, RenderLight } from './types';

/** How a body is drawn. `bump`: strength of its bumps, 0 to 1 (`MaterialLook.bump` is the whole slider). */
export interface Look {
  color: string;
  roughness: number;
  bump: number;
  metalness: number;
  translucency: number;
  glow: string;
  glowStrength: number;
  glowReach?: number;
  overlay?: MaterialLook['overlay'];
  image?: string;
  /** In renders, when not the same as in the 3D view. */
  render?: Look;
}

export const DEFAULT_LIGHT: Light = { sunHeight: 53, sunAround: -63, sun: 2, sunColor: '#ffffff', ambient: 2, ambientColor: '#ffffff', followCamera: false, cameraOn: false, cameraLight: 1, standard: false };

/** A document's render light until it sets its own: the 3D view's, no haze. */
export const DEFAULT_RENDER_LIGHT: RenderLight = { ...DEFAULT_LIGHT, same: true, haze: 0, fog: 0 };

/** A light as it works: the standard one if it is set to that. */
export const effectiveLight = (l: Light): Light => (l.standard ? DEFAULT_LIGHT : l);

/** Directions (unit) to the sun and to the camera, `toCamera` being from what it looks at to it. */
export function lightDirections(l: Light, toCamera: [number, number, number]) {
  const around = (Math.atan2(toCamera[1], toCamera[0]) * 180) / Math.PI + 45;
  return { sun: sunDirection(l.followCamera ? { ...l, sunAround: around } : l), camera: toCamera };
}

/** Mirror to matte over the slider's first half, matte to bumpy over the second. */
export function toLook({ render, ...m }: MaterialLook): Look {
  return { ...drawn(m), ...(render ? { render: drawn({ ...m, ...render }) } : {}) };
}

const drawn = (m: MaterialLook): Look => ({
  color: m.color,
  roughness: Math.min(1, m.bump * 2),
  bump: Math.max(0, m.bump * 2 - 1),
  metalness: m.reflection,
  translucency: m.translucency,
  glow: m.glow,
  glowStrength: m.glowStrength,
  ...(m.glowReach ? { glowReach: m.glowReach } : {}),
  ...(m.overlay ? { overlay: m.overlay } : {}),
  ...(m.image ? { image: m.image } : {}),
});

/** A plain look of a colour: what a body without a material has (roughness 0.5: a little shine). */
export const plainLook = (color: string): MaterialLook => ({ color, bump: 0.25, reflection: 0, translucency: 0, glow: '#ffffff', glowStrength: 0 });

const standard = (id: string, name: string, color: string, look: Partial<MaterialLook> = {}): Material => ({ ...plainLook(color), id: `std-${id}`, name, ...look });

/** The materials every file has, in the dialog's sections; they are never saved in it. */
export const STANDARD_SECTIONS: [string, Material[]][] = [
  [
    'Standard',
    [
      standard('steel', 'Steel', '#565b61', { bump: 0.15, reflection: 1 }),
      standard('bronze', 'Bronze', '#8c6239', { bump: 0.15, reflection: 1 }),
      standard('brass', 'Brass', '#b5a13f', { bump: 0.15, reflection: 1 }),
      standard('white', 'Plastic, white', '#f2f2ee', { bump: 0.2 }),
      standard('red', 'Plastic, red', '#c8322d', { bump: 0.2 }),
      standard('yellow', 'Plastic, yellow', '#e8b818', { bump: 0.2 }),
      standard('black', 'Plastic, black', '#1c1c1e', { bump: 0.2 }),
      standard('light-grey', 'Plastic, light grey', '#b9bbbe', { bump: 0.2 }),
      standard('dark-grey', 'Plastic, dark grey', '#3a3b3e', { bump: 0.2 }),
      standard('pom-black', 'POM-C black', '#17171a', { bump: 0.05 }), // roughness 0.1: 90% shiny
      standard('wood', 'Wood', '#a9773f', { bump: 0.65 }),
    ],
  ],
  [
    'Transparent',
    [
      standard('glass', 'Glass', '#f4f8f8', { bump: 0, translucency: 0.95 }),
      standard('frosted', 'Glass frosted', '#eef3f4', { bump: 0.35, translucency: 0.85 }),
      standard('wax', 'Wax', '#f3e6c8', { bump: 0.15, translucency: 0.35 }), // cream, a little see-through and shiny
    ],
  ],
  [
    'Specials',
    [
      standard('lamp', 'Lamp', '#fff4dc', { bump: 0.3, glow: '#ffe2b0', glowStrength: 0.8 }),
      standard('amber-light', 'Amber light', '#332211', { bump: 0.2, glow: '#ff9a3c', glowStrength: 0.6 }),
      // LEDs: a mirror surface in their own colour, glowing a little, lighting only what is close
      standard('led-white', 'LED white', '#ffffff', { bump: 0, reflection: 0.85, glow: '#ffffff', glowStrength: 0.05, glowReach: 60 }),
      standard('led-green', 'LED green', '#22c55e', { bump: 0, reflection: 0.85, glow: '#22c55e', glowStrength: 0.05, glowReach: 60 }),
      standard('led-red', 'LED red', '#ef2b2b', { bump: 0, reflection: 0.85, glow: '#ef2b2b', glowStrength: 0.05, glowReach: 60 }),
      standard('led-orange', 'LED orange', '#ff8a1f', { bump: 0, reflection: 0.85, glow: '#ff8a1f', glowStrength: 0.05, glowReach: 60 }),
      standard('grid-metric', 'Grid 10 × 10 cm', '#808080', { bump: 0.4, overlay: 'metric' }),
      standard('grid-imperial', 'Grid 1 × 1 ft', '#808080', { bump: 0.4, overlay: 'imperial' }),
    ],
  ],
];
export const STANDARD_MATERIALS = STANDARD_SECTIONS.flatMap(([, list]) => list);

export const findMaterial = (doc: Doc, id?: string) => (id ? (STANDARD_MATERIALS.find((m) => m.id === id) ?? doc.materials.find((m) => m.id === id)) : undefined);

/** What a body or group looks like by the material set on it or the nearest of its groups; none: nothing is. */
export function setLook(doc: Doc, x: Body | Group): MaterialLook | undefined {
  const here = findMaterial(doc, x.material);
  if (here) return here;
  const up = 'parent' in x ? x.parent : x.group;
  const group = doc.groups.find((g) => g.id === up);
  return group && setLook(doc, group);
}

export const lookOf = (doc: Doc, body: Body): Look => toLook(setLook(doc, body) ?? plainLook(body.color));

/** Bodies and groups `ids`, each with `change` applied. */
function withObjects(doc: Doc, ids: string[], change: <T extends Body | Group>(x: T) => T): Doc {
  const one = <T extends Body | Group>(x: T) => (ids.includes(x.id) ? change(x) : x);
  return { ...doc, bodies: doc.bodies.map(one), groups: doc.groups.map(one) };
}

const bare = <T extends Body | Group>(x: T): T => {
  const { material: _, ...rest } = x;
  return rest as T;
};

/** Bodies and groups `ids` get a material (none: their group's, else their own colour). */
/** `ids` with all of their bodies' linked family (the source and every linked copy of it): they share one material. */
const withLinked = (doc: Doc, ids: string[]) => {
  const sources = new Set(doc.bodies.filter((b) => ids.includes(b.id)).map((b) => b.link ?? b.id));
  return [...new Set([...ids, ...doc.bodies.filter((b) => sources.has(b.link ?? b.id)).map((b) => b.id)])];
};

/** Gives `ids` a material (none: their group's, else their own colour), linked copies of their bodies too. */
export const assignMaterial = (doc: Doc, ids: string[], material?: string) => withObjects(doc, withLinked(doc, ids), (x) => (material ? { ...bare(x), material } : bare(x)));

/** A name for a new material of the file, not taken yet. */
function freeName(doc: Doc, name: string) {
  const taken = new Set(doc.materials.map((m) => m.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}

/**
 * How the first of `ids` looks now, changed by `patch`, as a new material of the file, which they then use: "<its
 * material> copy" if it has one of its own, else named after it.
 */
export function newMaterialFor(doc: Doc, ids: string[], id: string, patch: Partial<MaterialLook> = {}): Doc {
  const first = [...doc.bodies, ...doc.groups].find((x) => ids.includes(x.id));
  if (!first) return doc;
  const { color, bump, reflection, translucency, glow, glowStrength, glowReach, overlay, render } = setLook(doc, first) ?? plainLook('color' in first ? first.color : '#d8c3a0');
  const source = findMaterial(doc, first.material);
  const material: Material = { color, bump, reflection, translucency, glow, glowStrength, ...(glowReach ? { glowReach } : {}), ...(overlay ? { overlay } : {}), ...(render ? { render } : {}), ...patch, id, name: freeName(doc, source ? `${source.name} copy` : first.name) };
  return assignMaterial({ ...doc, materials: [...doc.materials, material] }, ids, id);
}

/** Changes how `ids` look: a material of the file they share changes, everywhere it is used; else they get a new one (`id`). */
export function changeLook(doc: Doc, ids: string[], patch: Partial<MaterialLook>, id: string): Doc {
  const mine = [...doc.bodies, ...doc.groups].filter((x) => ids.includes(x.id));
  const material = mine[0]?.material;
  if (!doc.materials.some((m) => m.id === material) || mine.some((x) => x.material !== material)) return newMaterialFor(doc, ids, id, patch);
  return { ...doc, materials: doc.materials.map((m) => (m.id === material ? { ...m, ...patch } : m)) };
}

/** The document without the material; what used it falls back to its group or its own colour. */
export function dropMaterial(doc: Doc, id: string): Doc {
  const off = <T extends Body | Group>(x: T): T => (x.material === id ? bare(x) : x);
  return { ...doc, materials: doc.materials.filter((m) => m.id !== id), bodies: doc.bodies.map(off), groups: doc.groups.map(off) };
}

/** Unit vector towards the sun. */
export function sunDirection(l: Light): [number, number, number] {
  const [h, a] = [(l.sunHeight * Math.PI) / 180, (l.sunAround * Math.PI) / 180];
  return [Math.cos(h) * Math.cos(a), Math.cos(h) * Math.sin(a), Math.sin(h)];
}
