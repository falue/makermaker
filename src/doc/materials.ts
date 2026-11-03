import type { Body, Doc, Group, Light, Material, MaterialLook } from './types';

/** How a body is drawn. `bump`: strength of its bumps, 0 to 1 (`MaterialLook.bump` is the whole slider). */
export interface Look {
  color: string;
  roughness: number;
  bump: number;
  metalness: number;
  translucency: number;
  glow: string;
  glowStrength: number;
  overlay?: MaterialLook['overlay'];
}

export const DEFAULT_LIGHT: Light = { sunHeight: 53, sunAround: -63, sun: 2, sunColor: '#ffffff', ambient: 2, ambientColor: '#ffffff' };

/** Mirror to matte over the slider's first half, matte to bumpy over the second. */
export const toLook = (m: MaterialLook): Look => ({
  color: m.color,
  roughness: Math.min(1, m.bump * 2),
  bump: Math.max(0, m.bump * 2 - 1),
  metalness: m.reflection,
  translucency: m.translucency,
  glow: m.glow,
  glowStrength: m.glowStrength,
  ...(m.overlay ? { overlay: m.overlay } : {}),
});

/** A plain look of a colour: what a body without a material has. */
export const plainLook = (color: string): MaterialLook => ({ color, bump: 0.35, reflection: 0, translucency: 0, glow: '#ffffff', glowStrength: 0 });

const standard = (id: string, name: string, color: string, look: Partial<MaterialLook> = {}): Material => ({ ...plainLook(color), id: `std-${id}`, name, ...look });

/** The materials every file has, in the dialog's sections; they are never saved in it. */
export const STANDARD_SECTIONS: [string, Material[]][] = [
  [
    'Standard',
    [
      standard('metal', 'Metal', '#c9ccd1', { bump: 0.15, reflection: 1 }),
      standard('white', 'Plastic, white', '#f2f2ee', { bump: 0.2 }),
      standard('red', 'Plastic, red', '#c8322d', { bump: 0.2 }),
      standard('yellow', 'Plastic, yellow', '#e8b818', { bump: 0.2 }),
      standard('black', 'Plastic, black', '#1c1c1e', { bump: 0.2 }),
      standard('dark-grey', 'Plastic, dark grey', '#3a3b3e', { bump: 0.2 }),
      standard('wood', 'Wood', '#a9773f', { bump: 0.65 }),
    ],
  ],
  [
    'Transparent',
    [
      standard('glass', 'Glass', '#f4f8f8', { bump: 0, translucency: 0.95 }),
      standard('frosted', 'Glass frosted', '#eef3f4', { bump: 0.35, translucency: 0.85 }),
    ],
  ],
  [
    'Specials',
    [
      standard('lamp', 'Lamp', '#fff4dc', { bump: 0.3, glow: '#ffe2b0', glowStrength: 0.8 }),
      standard('grid-metric', 'Grid 10 × 10 cm', '#808080', { bump: 0.4, overlay: 'metric' }),
      standard('grid-imperial', 'Grid 1 × 1 ft', '#808080', { bump: 0.4, overlay: 'imperial' }),
    ],
  ],
];
export const STANDARD_MATERIALS = STANDARD_SECTIONS.flatMap(([, list]) => list);

export const findMaterial = (doc: Doc, id?: string) => (id ? (STANDARD_MATERIALS.find((m) => m.id === id) ?? doc.materials.find((m) => m.id === id)) : undefined);

const lookHere = (doc: Doc, x: Body | Group) => x.ownLook ?? findMaterial(doc, x.material);

/** What a body or group looks like by what is set on it or the nearest of its groups; none: nothing is. */
export function setLook(doc: Doc, x: Body | Group): MaterialLook | undefined {
  const here = lookHere(doc, x);
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
  const { material: _, ownLook: __, ...rest } = x;
  return rest as T;
};

/** Bodies and groups `ids` get a material (none: their group's, else their own colour); a one-off they had goes. */
export const assignMaterial = (doc: Doc, ids: string[], material?: string) => withObjects(doc, ids, (x) => (material ? { ...bare(x), material } : bare(x)));

/** Each of `ids` changes its look by `patch`, for itself alone: a one-off, starting from how it looks now. */
export const editOneOff = (doc: Doc, ids: string[], patch: Partial<MaterialLook>) =>
  withObjects(doc, ids, (x) => ({ ...x, ownLook: { ...(setLook(doc, x) ?? plainLook('color' in x ? x.color : '#d8c3a0')), ...patch } }));

/** The look of `ids`' first as a new material of the file, which all of them then use. */
export function saveOneOff(doc: Doc, ids: string[], id: string, name = `Material ${doc.materials.length + 1}`) {
  const first = [...doc.bodies, ...doc.groups].find((x) => ids.includes(x.id));
  const look = first && setLook(doc, first);
  if (!look) return doc;
  const { color, bump, reflection, translucency, glow, glowStrength, overlay } = look;
  const material: Material = { id, name, color, bump, reflection, translucency, glow, glowStrength, ...(overlay ? { overlay } : {}) };
  return assignMaterial({ ...doc, materials: [...doc.materials, material] }, ids, id);
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
