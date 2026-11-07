import type { Body as DocBody, Doc, Feature } from './types';

/** The sketch a feature takes its shapes from (an extrusion's or revolve's), if any. */
export const sourceSketch = (f: Feature) => ((f.type === 'extrude' || f.type === 'revolve') && f.source.kind === 'sketch' ? f.source.sketch : null);

/** A row of the object list; `open`: a group shown unfolded (true) or folded (false). */
export type Row = { id: string; kind: 'group' | 'body'; depth: number; open?: boolean };

/** The group an object is in, if that group exists (else none: the object shows at the top level). */
export const parentOf = (doc: Doc, group: string | null) => (group && doc.groups.some((g) => g.id === group) ? group : null);

/** Sketches that belong to a body: those it extrudes or revolves, and those lying on its faces. */
export const sketchesOf = (doc: Doc, body: string) => doc.sketches.filter((s) => ownerOf(doc, s.id) === body);

/** The body a sketch belongs to: the first that extrudes or revolves it, else the one whose face it lies on. */
export function ownerOf(doc: Doc, sketch: string): string | null {
  const user = doc.bodies.find((b) => b.features.some((f) => sourceSketch(f) === sketch));
  const p = doc.sketches.find((s) => s.id === sketch)?.plane;
  const on = p && (p.kind === 'cap' || p.kind === 'side') && doc.bodies.some((b) => b.id === p.body) ? p.body : null;
  return user?.id ?? on;
}

/** The body a sketch moves along with: the first that extrudes or revolves it, unless the sketch lies on that body's own face. */
export function carrierOf(doc: Doc, sketch: string): string | null {
  const user = doc.bodies.find((b) => b.features.some((f) => sourceSketch(f) === sketch));
  const p = doc.sketches.find((s) => s.id === sketch)?.plane;
  return user && p && !((p.kind === 'cap' || p.kind === 'side') && p.body === user.id) ? user.id : null;
}

/** Whether body `tool` is extruded from a sketch lying on a face of body `on`. */
export function onFaceOf(doc: Doc, tool: string, on: string): boolean {
  const planes = doc.bodies.find((b) => b.id === tool)?.features.flatMap((f) => (sourceSketch(f) ?? [])).map((id) => doc.sketches.find((s) => s.id === id)?.plane);
  return !!planes?.some((p) => (p?.kind === 'cap' || p?.kind === 'side') && p.body === on);
}

/** Whose a sketch is, in words: the body extruded from it, the body it lies on, or none (a free sketch). */
export function whose(doc: Doc, sketch: string): string {
  const owner = doc.bodies.find((b) => b.id === ownerOf(doc, sketch));
  if (!owner) return 'A free sketch: it belongs to no object (nothing is extruded from it, it lies on no face)';
  const extruded = owner.features.some((f) => sourceSketch(f) === sketch);
  return extruded ? `Belongs to ${owner.name}, which is extruded from it` : `Belongs to ${owner.name}: it lies on its face`;
}

/** The object list in order (sketches have their own list): per level its groups, each followed by its contents unless folded, then its bodies. */
/** Where a group or body sits among its siblings in the object list: its `order`, else groups first, then bodies, each as listed. */
export function rank(doc: Doc, id: string): number {
  const g = doc.groups.findIndex((x) => x.id === id);
  if (g >= 0) return doc.groups[g].order ?? g - 1e6;
  const b = doc.bodies.findIndex((x) => x.id === id);
  return doc.bodies[b]?.order ?? b;
}

/**
 * `doc` with each new body of `made` ([body it came from, new body]) listed right after the body it came from (after
 * the ones made of it before), when both are in the same group; that level numbered anew.
 */
export function listedAfter(doc: Doc, made: [string, string][]): Doc {
  const groupOf = (id: string) => doc.bodies.find((b) => b.id === id)?.group;
  const mine = made.filter(([from, to]) => groupOf(from) !== undefined && groupOf(from) === groupOf(to));
  const order = new Map<string, number>();
  for (const parent of new Set(mine.map(([from]) => groupOf(from)!))) {
    const fresh = new Set(mine.map(([, to]) => to));
    const level = [...doc.groups.filter((g) => g.parent === parent), ...doc.bodies.filter((b) => b.group === parent && !fresh.has(b.id))].map((o) => o.id).sort((a, b) => rank(doc, a) - rank(doc, b));
    level.flatMap((id) => [id, ...mine.filter(([from]) => from === id).map(([, to]) => to)]).forEach((id, k) => order.set(id, k));
  }
  const numbered = <T extends { id: string; order?: number }>(list: T[]) => list.map((o) => (order.has(o.id) ? { ...o, order: order.get(o.id) } : o));
  return order.size ? { ...doc, bodies: numbered(doc.bodies), groups: numbered(doc.groups) } : doc;
}

export function tree(doc: Doc, folded: Set<string>): Row[] {
  const out: Row[] = [];
  // tool bodies listed under their body, but for those dragged elsewhere
  const owner = new Map([...ownersOf(doc)].filter(([tool, o]) => !doc.bodies.find((b) => b.id === o)?.features.some((f) => f.type === 'boolean' && f.body === tool && f.free)));
  // a linked copy in its source's group sits under the source
  const under = (b: DocBody) => !!b.link && doc.bodies.some((s) => s.id === b.link && s.group === b.group);
  // a body, then the tool bodies of its booleans and its linked copies under it, like a group's contents; these start
  // folded (`folded` holding the body means it is open)
  const body = (id: string, depth: number) => {
    const tools = doc.bodies.filter((t) => !t.folded && (owner.get(t.id) === id || (t.link === id && under(t))) && !out.some((r) => r.id === t.id));
    const open = tools.length ? folded.has(id) : undefined;
    out.push({ id, kind: 'body', depth, open });
    if (open) for (const t of tools) body(t.id, depth + 1);
  };
  // per level its groups and bodies in their places (see `rank`)
  const walk = (parent: string | null, depth: number) => {
    const groups = doc.groups.filter((g) => parentOf(doc, g.parent) === parent).map((g) => ({ id: g.id, group: true }));
    const bodies = doc.bodies.filter((b) => parentOf(doc, b.group) === parent && !owner.has(b.id) && !under(b) && !b.folded).map((b) => ({ id: b.id, group: false }));
    for (const { id, group } of [...groups, ...bodies].sort((a, b) => rank(doc, a.id) - rank(doc, b.id) || +b.group - +a.group)) {
      if (!group) {
        body(id, depth);
        continue;
      }
      const open = !folded.has(id);
      out.push({ id, kind: 'group', depth, open });
      if (open) walk(id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The body each boolean tool body belongs to (the first whose boolean uses it); a linked cut's other body is its own. */
export function ownersOf(doc: Doc) {
  const out = new Map<string, string>();
  for (const b of doc.bodies) for (const f of b.features) if (f.type === 'boolean' && !f.linked && !out.has(f.body)) out.set(f.body, b.id);
  return out;
}

/**
 * `doc` with bodies `gone` about to go: linked copies of them take over the steps (the first one keeps them, the others
 * link to it).
 */
export function unlinkedFrom(doc: Doc, gone: Set<string>): Doc {
  const heir = new Map<string, string>();
  const bodies = doc.bodies.map((b) => {
    if (!b.link || !gone.has(b.link) || gone.has(b.id)) return b;
    const first = heir.get(b.link);
    if (first) return { ...b, link: first };
    heir.set(b.link, b.id);
    const source = doc.bodies.find((s) => s.id === b.link)!;
    return { ...b, link: null, features: [...structuredClone(source.features), ...b.features] };
  });
  return { ...doc, bodies };
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

/** A boolean's tool body freed: the booleans using it go, and it is a normal body again (shown, no longer folded). */
export const freed = (doc: Doc, tool: string): Doc => ({
  ...doc,
  bodies: doc.bodies.map((b) => {
    if (b.id !== tool) return { ...b, features: b.features.filter((f) => f.type !== 'boolean' || f.body !== tool) };
    const { folded: _, ...free } = b;
    return { ...free, visible: true };
  }),
});

