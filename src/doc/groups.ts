import type { Doc } from './types';

export type Row = { id: string; kind: 'group' | 'body' | 'sketch'; depth: number };

/** The group an object is in, if that group exists (else none: the object shows at the top level). */
export const parentOf = (doc: Doc, group: string | null) => (group && doc.groups.some((g) => g.id === group) ? group : null);

/** The object list in order: per level its groups (each followed by its contents unless folded), bodies, sketches. */
export function tree(doc: Doc, folded: Set<string>): Row[] {
  const out: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const g of doc.groups)
      if (parentOf(doc, g.parent) === parent) {
        out.push({ id: g.id, kind: 'group', depth });
        if (!folded.has(g.id)) walk(g.id, depth + 1);
      }
    for (const b of doc.bodies) if (parentOf(doc, b.group) === parent) out.push({ id: b.id, kind: 'body', depth });
    for (const s of doc.sketches) if (parentOf(doc, s.group) === parent) out.push({ id: s.id, kind: 'sketch', depth });
  };
  walk(null, 0);
  return out;
}

/** Group `id` and all groups inside it. */
export function within(doc: Doc, id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of doc.groups)
      if (g.parent && out.has(g.parent) && !out.has(g.id)) {
        out.add(g.id);
        grew = true;
      }
  }
  return out;
}

/** `ids` with every selected group replaced by the bodies and sketches inside it (all the way down). */
export function contents(doc: Doc, ids: string[]): string[] {
  const groups = new Set(ids.filter((id) => doc.groups.some((g) => g.id === id)).flatMap((id) => [...within(doc, id)]));
  const inside = [...doc.bodies, ...doc.sketches].filter((o) => o.group && groups.has(o.group)).map((o) => o.id);
  return [...new Set([...ids.filter((id) => !groups.has(id)), ...inside])];
}
