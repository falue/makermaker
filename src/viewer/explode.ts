import * as THREE from 'three';
import { ownersOf } from '../doc/groups';
import type { Doc } from '../doc/types';

/**
 * What an exploded view moves apart: a group (its children spread along its own axes, `turn`) or a body with its tool
 * bodies (`bodies`, moved as one).
 */
export type ExplodeNode = { turn: THREE.Quaternion; children: ExplodeNode[]; bodies: string[] };

/** The document as explode moves it: the top level (world axes) holding groups and bodies; `turnOf`: a group's turn in the world. */
export function explodeTree(doc: Doc, turnOf: (group: string) => THREE.Quaternion): ExplodeNode {
  const owners = ownersOf(doc);
  // a tool body goes with the body it shapes (that one's owner, if it has one, and so on)
  const top = (id: string) => {
    for (const seen = new Set<string>(); owners.has(id) && !seen.has(id); ) seen.add(id), (id = owners.get(id)!);
    return id;
  };
  const tools = new Map<string, string[]>();
  for (const b of doc.bodies) if (owners.has(b.id)) tools.set(top(b.id), [...(tools.get(top(b.id)) ?? []), b.id]);
  const groups = new Set(doc.groups.map((g) => g.id));
  const node = (parent: string | null, turn: THREE.Quaternion): ExplodeNode => ({
    turn,
    bodies: [],
    children: [
      ...doc.groups.filter((g) => g.parent === parent).map((g) => node(g.id, turnOf(g.id))),
      ...doc.bodies.filter((b) => !owners.has(b.id) && (b.group && groups.has(b.group) ? b.group : null) === parent).map((b) => ({ turn, children: [], bodies: [b.id, ...(tools.get(b.id) ?? [])] })),
    ],
  });
  return node(null, new THREE.Quaternion());
}

/** How many levels deep `root` can explode (1: its own children only). */
export function explodeDepth(root: ExplodeNode): number {
  const down = (n: ExplodeNode): number => (n.children.length ? 1 + Math.max(...n.children.map(down)) : 0);
  return Math.max(1, down(root));
}

/**
 * Each body's shift (world) with `root` exploded `amount` (0 to 1) along each of its axes (`depth` levels deep): along
 * an axis a node's children line up by their middles, each `gap` × their mean size after the one before, the row's
 * middle staying where it was; deeper levels spread first, the level above lines up their spread boxes. The axes add up.
 * `boxOf`: a body's box (world; null: not shown).
 */
export function exploded(root: ExplodeNode, boxOf: (id: string) => THREE.Box3 | null, amount: [number, number, number], depth: number, gap = 0.5) {
  const out = new Map<string, THREE.Vector3>();
  amount.forEach((t, axis) => {
    if (t <= 0) return;
    for (const [id, v] of spread(root, boxOf, axis, depth, gap)) out.set(id, (out.get(id) ?? new THREE.Vector3()).addScaledVector(v, t));
  });
  return out;
}

/** The shifts of `node`'s bodies fully exploded along its `axis`, `depth` levels deep (see `exploded`). */
function spread(node: ExplodeNode, boxOf: (id: string) => THREE.Box3 | null, axis: number, depth: number, gap: number): Map<string, THREE.Vector3> {
  const dir = new THREE.Vector3().setComponent(axis, 1).applyQuaternion(node.turn);
  const parts = node.children.flatMap((c) => {
    const shifts = depth > 1 ? spread(c, boxOf, axis, depth - 1, gap) : new Map<string, THREE.Vector3>();
    const ids = bodiesOf(c);
    // its extent along `dir`: of its bodies' box corners, each shifted as spread inside it
    const along = ids.flatMap((id) => {
      const b = boxOf(id);
      if (!b) return [];
      const s = shifts.get(id);
      return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).add(s ?? new THREE.Vector3()).dot(dir));
    });
    return along.length ? [{ ids, shifts, lo: Math.min(...along), hi: Math.max(...along) }] : [];
  });
  const out = new Map<string, THREE.Vector3>();
  for (const p of parts) for (const [id, v] of p.shifts) out.set(id, v.clone());
  if (parts.length < 2) return out;
  parts.sort((a, b) => a.lo + a.hi - (b.lo + b.hi));
  const room = (gap * parts.reduce((sum, p) => sum + p.hi - p.lo, 0)) / parts.length;
  const length = parts.reduce((sum, p) => sum + p.hi - p.lo, 0) + room * (parts.length - 1);
  let at = (Math.min(...parts.map((p) => p.lo)) + Math.max(...parts.map((p) => p.hi))) / 2 - length / 2;
  for (const p of parts) {
    const by = dir.clone().multiplyScalar(at - p.lo);
    for (const id of p.ids) out.set(id, (out.get(id) ?? new THREE.Vector3()).add(by));
    at += p.hi - p.lo + room;
  }
  return out;
}

const bodiesOf = (n: ExplodeNode): string[] => [...n.bodies, ...n.children.flatMap(bodiesOf)];
