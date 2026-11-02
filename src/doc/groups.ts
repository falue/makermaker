import type { Doc } from './types';

/** A row of the object list; `open`: a group shown unfolded (true) or folded (false). */
export type Row = { id: string; kind: 'group' | 'body'; depth: number; open?: boolean };

/** The group an object is in, if that group exists (else none: the object shows at the top level). */
export const parentOf = (doc: Doc, group: string | null) => (group && doc.groups.some((g) => g.id === group) ? group : null);

/** Sketches that belong to a body: those it extrudes, and those lying on its faces. */
export const sketchesOf = (doc: Doc, body: string) => doc.sketches.filter((s) => ownerOf(doc, s.id) === body);

/** The body a sketch belongs to: the first that extrudes it, else the one whose face it lies on. */
export function ownerOf(doc: Doc, sketch: string): string | null {
  const user = doc.bodies.find((b) => b.features.some((f) => f.type === 'extrude' && f.source.kind === 'sketch' && f.source.sketch === sketch));
  const p = doc.sketches.find((s) => s.id === sketch)?.plane;
  const on = p && (p.kind === 'cap' || p.kind === 'side') && doc.bodies.some((b) => b.id === p.body) ? p.body : null;
  return user?.id ?? on;
}

/** The body a sketch moves along with: the first that extrudes it, unless the sketch lies on that body's own face. */
export function carrierOf(doc: Doc, sketch: string): string | null {
  const user = doc.bodies.find((b) => b.features.some((f) => f.type === 'extrude' && f.source.kind === 'sketch' && f.source.sketch === sketch));
  const p = doc.sketches.find((s) => s.id === sketch)?.plane;
  return user && p && !((p.kind === 'cap' || p.kind === 'side') && p.body === user.id) ? user.id : null;
}

/** Whether body `tool` is extruded from a sketch lying on a face of body `on`. */
export function onFaceOf(doc: Doc, tool: string, on: string): boolean {
  const planes = doc.bodies.find((b) => b.id === tool)?.features.flatMap((f) => (f.type === 'extrude' && f.source.kind === 'sketch' ? [f.source.sketch] : [])).map((id) => doc.sketches.find((s) => s.id === id)?.plane);
  return !!planes?.some((p) => (p?.kind === 'cap' || p?.kind === 'side') && p.body === on);
}

/** Whose a sketch is, in words: the body extruded from it, the body it lies on, or none (a free sketch). */
export function whose(doc: Doc, sketch: string): string {
  const owner = doc.bodies.find((b) => b.id === ownerOf(doc, sketch));
  if (!owner) return 'A free sketch: it belongs to no object (nothing is extruded from it, it lies on no face)';
  const extruded = owner.features.some((f) => f.type === 'extrude' && f.source.kind === 'sketch' && f.source.sketch === sketch);
  return extruded ? `Belongs to ${owner.name}, which is extruded from it` : `Belongs to ${owner.name}: it lies on its face`;
}

/** The object list in order (sketches have their own list): per level its groups, each followed by its contents unless folded, then its bodies. */
export function tree(doc: Doc, folded: Set<string>): Row[] {
  const out: Row[] = [];
  const owner = ownersOf(doc);
  // a body, then the tool bodies of its booleans under it, like a group's contents; owners start folded (`folded`
  // holding an owner means it is open)
  const body = (id: string, depth: number) => {
    const tools = doc.bodies.filter((t) => owner.get(t.id) === id && !out.some((r) => r.id === t.id));
    const open = tools.length ? folded.has(id) : undefined;
    out.push({ id, kind: 'body', depth, open });
    if (open) for (const t of tools) body(t.id, depth + 1);
  };
  const walk = (parent: string | null, depth: number) => {
    for (const g of doc.groups)
      if (parentOf(doc, g.parent) === parent) {
        const open = !folded.has(g.id);
        out.push({ id: g.id, kind: 'group', depth, open });
        if (open) walk(g.id, depth + 1);
      }
    for (const b of doc.bodies) if (parentOf(doc, b.group) === parent && !owner.has(b.id)) body(b.id, depth);
  };
  walk(null, 0);
  return out;
}

/** The body each boolean tool body belongs to (the first whose boolean uses it). */
export function ownersOf(doc: Doc) {
  const out = new Map<string, string>();
  for (const b of doc.bodies) for (const f of b.features) if (f.type === 'boolean' && !out.has(f.body)) out.set(f.body, b.id);
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
