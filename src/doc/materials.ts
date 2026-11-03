import type { Body, Doc, Light, Material } from './types';

/** How a body looks: its material's look, or its own colour. */
export interface Look {
  color: string;
  roughness: number;
  bump: number;
  translucency: number;
  glow: string;
  glowStrength: number;
}

export const DEFAULT_LIGHT: Light = { sunHeight: 53, sunAround: -63, sun: 2, sunColor: '#ffffff', ambient: 2, ambientColor: '#ffffff' };

/** A body's material: its own, else the nearest of its groups'. */
export function materialOf(doc: Doc, body: Body): Material | undefined {
  const find = (id?: string) => doc.materials.find((m) => m.id === id);
  const own = find(body.material);
  if (own) return own;
  for (let g = doc.groups.find((x) => x.id === body.group); g; g = doc.groups.find((x) => x.id === g!.parent)) {
    const m = find(g.material);
    if (m) return m;
  }
}

export function lookOf(doc: Doc, body: Body): Look {
  const m = materialOf(doc, body);
  if (!m) return { color: body.color, roughness: 0.7, bump: 0, translucency: 0, glow: '#000000', glowStrength: 0 };
  return { color: m.color, roughness: 0.2 + 0.6 * m.bump, bump: m.bump, translucency: m.translucency, glow: m.glow, glowStrength: m.glowStrength };
}

/** The document without the material; what used it falls back to its group or its own colour. */
export function dropMaterial(doc: Doc, id: string): Doc {
  const off = <T extends { material?: string }>(x: T): T => {
    if (x.material !== id) return x;
    const { material: _, ...rest } = x;
    return rest as T;
  };
  return { ...doc, materials: doc.materials.filter((m) => m.id !== id), bodies: doc.bodies.map(off), groups: doc.groups.map(off) };
}

/** Unit vector towards the sun. */
export function sunDirection(l: Light): [number, number, number] {
  const [h, a] = [(l.sunHeight * Math.PI) / 180, (l.sunAround * Math.PI) / 180];
  return [Math.cos(h) * Math.cos(a), Math.cos(h) * Math.sin(a), Math.sin(h)];
}
