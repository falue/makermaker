import { Matrix4, Vector3 } from 'three';
import { ownersOf } from './groups';
import type { Doc, Joint } from './types';

/**
 * Where groups and bodies are in the world with joints moved to `value(joint)` (degrees or mm): each object's own
 * placement in its group (`local`: groups' origins, bodies' position and turn) under its group's, and a joint's
 * children moved on top, around or along the axis as their parent is placed (so joints on moved parents chain).
 * `problems`: what was left unmoved (a child in two joints, joints or groups that place each other in a circle).
 */
export function jointed(doc: Doc, local: Map<string, Matrix4>, value: (j: Joint) => number) {
  const placed = new Map<string, Matrix4>();
  const problems: string[] = [];
  const jointOf = new Map<string, Joint>();
  for (const j of doc.joints)
    for (const c of j.children)
      if (jointOf.has(c)) problems.push(`${nameOf(doc, c)} is moved by two joints: only "${jointOf.get(c)!.name}" moves it`);
      else jointOf.set(c, j);
  // a boolean's tool bodies move with their owner (else the cut would shift inside it)
  const owner = ownersOf(doc);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [owned, by] of owner) if (jointOf.has(by) && !jointOf.has(owned)) jointOf.set(owned, jointOf.get(by)!), (grew = true);
  }
  const parentOf = (id: string) => doc.bodies.find((b) => b.id === id)?.group ?? doc.groups.find((g) => g.id === id)?.parent ?? null;
  const busy = new Set<string>();
  const at = (id: string | null): Matrix4 => {
    if (!id) return new Matrix4();
    const done = placed.get(id);
    if (done) return done;
    if (busy.has(id)) {
      problems.push(`${nameOf(doc, id)} is placed by joints or groups in a circle (a joint moving its own parent?): left still`);
      return new Matrix4();
    }
    busy.add(id);
    const m = at(parentOf(id)).clone().multiply(local.get(id) ?? new Matrix4());
    const j = jointOf.get(id);
    if (j) m.premultiply(motion(j, at(j.parent), value(j)));
    busy.delete(id);
    placed.set(id, m);
    return m;
  };
  for (const o of [...doc.groups, ...doc.bodies]) at(o.id);
  return { placed, problems };
}

/** How a joint at `v` moves its children in the world, its parent placed at `parent`. */
export function motion(j: Joint, parent: Matrix4, v: number): Matrix4 {
  if (j.kind === 'attach') return new Matrix4();
  const at = new Vector3(...j.axis.at).applyMatrix4(parent);
  const dir = new Vector3(...j.axis.dir).transformDirection(parent);
  if (j.kind === 'slider') return new Matrix4().makeTranslation(dir.multiplyScalar(v));
  return new Matrix4().makeTranslation(at).multiply(new Matrix4().makeRotationAxis(dir, (v * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(at.negate()));
}

/** `joints` without objects `gone`: they leave as parts; a joint whose parent or every part went goes. */
export const jointsWithout = (joints: Joint[], gone: Set<string>) =>
  joints.flatMap((j) => {
    const children = j.children.filter((c) => !gone.has(c));
    return gone.has(j.parent) || !children.length ? [] : [children.length === j.children.length ? j : { ...j, children }];
  });

/** A new attach: `parent` and `children` move as one, anchored at `at` (the parent's coordinates). */
export const attach = (doc: Doc, id: string, parent: string, children: string[], at: [number, number, number]): Joint => ({
  id,
  name: `Entanglement ${doc.joints.filter((j) => j.kind === 'attach').length + 1}`,
  kind: 'attach',
  parent,
  children,
  axis: { at, dir: [0, 0, 1] },
  min: { e: '0', u: 'mm' },
  max: { e: '0', u: 'mm' },
  value: { e: '0', u: 'mm' },
  speed: { e: '1', u: 'mm' },
});

const nameOf = (doc: Doc, id: string) => [...doc.bodies, ...doc.groups].find((o) => o.id === id)?.name ?? '?';
