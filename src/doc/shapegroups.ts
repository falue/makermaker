import type { ShapeGroup } from './types';

type Grouped = { groups: ShapeGroup[]; shapes: { id: string; group?: string }[] };

/** The sub-groups from the sketch group down to `group`, outermost first (none: `group` is unset). */
export function chainOf(s: Grouped, group?: string | null): string[] {
  const out: string[] = [];
  for (let g = group; g; g = s.groups.find((x) => x.id === g)?.parent) out.unshift(g);
  return out;
}

/** Whether the shape lies in sub-group `group`, nested too (null: the sketch group itself, so always). */
export const inGroup = (s: Grouped, shape: { group?: string }, group: string | null) => !group || chainOf(s, shape.group).includes(group);

/** The shapes in sub-group `group`, nested ones included. */
export const shapesIn = (s: Grouped, group: string | null) => s.shapes.filter((q) => inGroup(s, q, group)).map((q) => q.id);

/**
 * What a click on a shape picks while sub-group `level` is open (null: the sketch group): its sub-group directly
 * inside `level` (all its shapes), else the shape itself; null when the shape lies outside `level`.
 */
export function unitAt(s: Grouped, shape: string, level: string | null): { group: string | null; shapes: string[] } | null {
  const q = s.shapes.find((x) => x.id === shape);
  if (!q || !inGroup(s, q, level)) return null;
  const chain = chainOf(s, q.group);
  const below = chain[level ? chain.indexOf(level) + 1 : 0];
  return below ? { group: below, shapes: shapesIn(s, below) } : { group: null, shapes: [shape] };
}
