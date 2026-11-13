import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { evalLength, fmt, isPlain, UNITS, type Lookup } from './expr';
import { BASE, placeFrame, scale, type Place } from './frames';
import { carrierOf, within } from './groups';
import { jointed } from './joints';
import { paramLookup, resolve } from './resolve';
import { ex } from './sample';
import type { Body, Doc, Expr, Group, Joint, Unit } from './types';

/** A turn in degrees around X, then Y, then Z (of the parent) as a quaternion. */
export const turnOf = (r: { rx: number; ry: number; rz: number }) => {
  const rad = (v: number) => (v * Math.PI) / 180;
  return new Quaternion().setFromEuler(new Euler(rad(r.rx), rad(r.ry), rad(r.rz), 'ZYX'));
};

/** A rigid matrix as a turn around an axis, then a move. */
export function toPlace(m: Matrix4): Place {
  const [offset, q] = [new Vector3(), new Quaternion()];
  m.decompose(offset, q, new Vector3());
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  const angle = (2 * Math.acos(Math.min(1, q.w)) * 180) / Math.PI;
  return { axis: s < 1e-9 ? [0, 0, 1] : [q.x / s, q.y / s, q.z / s], angle: s < 1e-9 ? 0 : angle, offset: offset.toArray() };
}

/** Where a joint is now: degrees (hinge) or mm (slider); 0 while its value is no number. */
export function jointValue(j: Joint, lookup: Lookup) {
  try {
    return evalLength(j.value, lookup);
  } catch {
    return 0;
  }
}

/** A placement matrix as a position (mm) and a turn (degrees around X, then Y, then Z), as bodies and group origins store them. */
export function placementOf(m: Matrix4) {
  const [at, q] = [new Vector3(), new Quaternion()];
  m.decompose(at, q, new Vector3());
  const e = new Euler().setFromQuaternion(q, 'ZYX');
  const deg = (r: number) => (r * 180) / Math.PI;
  return { at: at.toArray(), turn: { rx: deg(e.x), ry: deg(e.y), rz: deg(e.z) } };
}

/** An angle (degrees, as stored) changed by `by`: a plain number stays one, an expression gets `+ by`. */
export function turnedBy(x: Expr, deg: number, by: number): Expr {
  if (Math.abs(by) < 1e-9) return x;
  return isPlain(x.e) ? { e: fmt(deg + by), u: x.u } : { e: `${x.e} ${by < 0 ? '-' : '+'} ${fmt(Math.abs(by))}`, u: x.u };
}

/** A length `x` (`mm` now) changed by `by` mm: a plain number stays one (in `units`), an expression gets `+ by` (`ply` becomes `ply + 5`). */
export function lengthBy(x: Expr, mm: number, by: number, units: Unit): Expr {
  if (Math.abs(by) < 1e-9) return x;
  return isPlain(x.e) ? ex(fmt((mm + by) / UNITS[units]), units) : { e: `${x.e} ${by < 0 ? '-' : '+'} ${fmt(Math.abs(by) / UNITS[x.u])}`, u: x.u };
}

/**
 * Own placements in `doc`: a custom group origin moved and turned in its parent's, a body's position and turn in its
 * group; bad values into `errors`. `still`: the bodies whose position or turn is no number.
 */
export function localPlaces(doc: Doc, lookup: Lookup, errors = new Map<string, string>()) {
  const own = new Map<string, Matrix4>();
  const fine = (v: number) => (Number.isFinite(v) ? v : 0);
  doc.groups.forEach((g, i) => {
    if (g.origin.kind !== 'custom') return;
    const at = `groups.${i}.origin`;
    const [x, y, z] = resolve(g.origin.position, lookup, `${at}.position`, errors).map(fine);
    const r = resolve(g.origin.rotation, lookup, `${at}.rotation`, errors);
    own.set(g.id, new Matrix4().compose(new Vector3(x, y, z), turnOf({ rx: fine(r.rx), ry: fine(r.ry), rz: fine(r.rz) }), new Vector3(1, 1, 1)));
  });
  const still = new Set<string>();
  doc.bodies.forEach((p, i) => {
    const local = resolve(p.position, lookup, `bodies.${i}.position`, errors);
    const turned = resolve(p.rotation, lookup, `bodies.${i}.rotation`, errors);
    if (local.every(Number.isFinite) && [turned.rx, turned.ry, turned.rz].every(Number.isFinite)) own.set(p.id, new Matrix4().compose(new Vector3(...local), turnOf(turned), new Vector3(1, 1, 1)));
    else still.add(p.id);
  });
  return { own, still };
}

/** Where everything of `doc` is: `own` (see `localPlaces`) and `world` (groups and bodies, joints where they are now). */
export function placesOf(doc: Doc) {
  const lookup = paramLookup(doc.params);
  const { own } = localPlaces(doc, lookup);
  return { own, world: jointed(doc, own, (j) => jointValue(j, lookup)).placed };
}

/**
 * `doc` with group `id`'s origin at `to` (world), its contents staying where they are in the world: its bodies and
 * sub-groups of their own origin re-placed in it (also those of sub-groups counting from it), its joints' axes and
 * anchors with it, its free base-plane sketches pinned where they are (a body's sketch moves with its body). `origin`:
 * what the group stores (else `to` as numbers).
 */
export function originTo(doc: Doc, id: string, to: Matrix4, origin?: Group['origin']): Doc {
  const lookup = paramLookup(doc.params);
  const { own, world } = placesOf(doc);
  const frame = world.get(id) ?? new Matrix4();
  const by = to.clone().invert().multiply(frame); // from the old origin's coordinates into the new one's
  // the groups whose contents count from this origin
  const same = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of doc.groups) if (g.origin.kind === 'parent' && g.parent && same.has(g.parent) && !same.has(g.id)) (same.add(g.id), (grew = true));
  }
  const moved = <T>(of: string, change: (now: ReturnType<typeof placementOf>, next: ReturnType<typeof placementOf>) => T) => {
    const m = own.get(of);
    return m ? change(placementOf(m), placementOf(by.clone().multiply(m))) : null;
  };
  const bodies = doc.bodies.map((b) => {
    if (!b.group || !same.has(b.group)) return b;
    return (
      moved(b.id, (now, next) => {
        const local = resolve(b.position, lookup, '', new Map());
        const turn = resolve(b.rotation, lookup, '', new Map());
        return {
          ...b,
          position: b.position.map((x, k) => lengthBy(x, local[k], next.at[k] - now.at[k], doc.units)) as Body['position'],
          rotation: { rx: turnedBy(b.rotation.rx, turn.rx, next.turn.rx - turn.rx), ry: turnedBy(b.rotation.ry, turn.ry, next.turn.ry - turn.ry), rz: turnedBy(b.rotation.rz, turn.rz, next.turn.rz - turn.rz) },
        };
      }) ?? b
    );
  });
  const groups = doc.groups.map((g) => {
    if (g.id === id) {
      const parent = frame.clone().multiply((own.get(id) ?? new Matrix4()).clone().invert());
      const { at, turn } = placementOf(parent.invert().multiply(to));
      return { ...g, origin: origin ?? { kind: 'custom' as const, position: at.map((v) => ex(fmt(v / UNITS[doc.units]), doc.units)) as [Expr, Expr, Expr], rotation: { rx: ex(fmt(turn.rx)), ry: ex(fmt(turn.ry)), rz: ex(fmt(turn.rz)) } } };
    }
    if (g.origin.kind !== 'custom' || !g.parent || !same.has(g.parent)) return g;
    const o = g.origin;
    return (
      moved(g.id, (now, next) => ({
        ...g,
        origin: { ...o, position: o.position.map((x, k) => lengthBy(x, now.at[k], next.at[k] - now.at[k], doc.units)) as [Expr, Expr, Expr], rotation: { rx: turnedBy(o.rotation.rx, now.turn.rx, next.turn.rx - now.turn.rx), ry: turnedBy(o.rotation.ry, now.turn.ry, next.turn.ry - now.turn.ry), rz: turnedBy(o.rotation.rz, now.turn.rz, next.turn.rz - now.turn.rz) } },
      })) ?? g
    );
  });
  const sketches = doc.sketches.map((sk) => {
    if (sk.plane.kind !== 'base' || !sk.group || !same.has(sk.group) || carrierOf(doc, sk.id)) return sk;
    const plane = resolve(sk.plane, lookup, '', new Map());
    const { o, x, y, n } = placeFrame(toPlace(world.get(sk.group) ?? new Matrix4()), { ...BASE[plane.axis], o: scale(BASE[plane.axis].n, plane.offset) });
    return { ...sk, plane: { kind: 'plane' as const, o, x, y, n } };
  });
  const joints = doc.joints.map((j) =>
    same.has(j.parent) ? { ...j, axis: { at: new Vector3(...j.axis.at).applyMatrix4(by).toArray(), dir: new Vector3(...j.axis.dir).transformDirection(by).toArray() } } : j,
  );
  return { ...doc, bodies, groups, sketches, joints };
}

/**
 * A frame at `world` aligned to `target` along `axes` (0: X, 1: Y, 2: Z): one axis turned the least way that points it
 * as the target's (the turn around it kept), two or three: the target's turn. `move`: at the target's point, else at its own.
 */
export function alignedFrame(world: Matrix4, target: Matrix4, axes: number[], move: boolean): Matrix4 {
  const [at, q, to, tq] = [new Vector3(), new Quaternion(), new Vector3(), new Quaternion()];
  world.decompose(at, q, new Vector3());
  target.decompose(to, tq, new Vector3());
  let turn = tq;
  if (axes.length === 1) {
    const unit = (k: number) => new Vector3().setComponent(k, 1);
    const [from, want] = [unit(axes[0]).applyQuaternion(q), unit(axes[0]).applyQuaternion(tq)];
    // pointing the other way: half a turn around its next axis
    const by = from.dot(want) < -0.999999 ? new Quaternion().setFromAxisAngle(unit((axes[0] + 1) % 3).applyQuaternion(q), Math.PI) : new Quaternion().setFromUnitVectors(from, want);
    turn = by.multiply(q);
  }
  return new Matrix4().compose(move ? to : at, turn, new Vector3(1, 1, 1));
}

/** The groups with an origin of their own among `ids` and all groups inside them, outer ones first. */
export function ownOrigins(doc: Doc, ids: string[]) {
  const depth = (id: string) => {
    let n = 0;
    for (let g = doc.groups.find((x) => x.id === id), seen = new Set<string>(); g?.parent && !seen.has(g.id); seen.add(g.id), g = doc.groups.find((x) => x.id === g!.parent)) n++;
    return n;
  };
  const all = new Set(ids.filter((id) => doc.groups.some((g) => g.id === id)).flatMap((id) => [...within(doc, id)]));
  return doc.groups.filter((g) => all.has(g.id) && g.origin.kind === 'custom').sort((a, b) => depth(a.id) - depth(b.id)).map((g) => g.id);
}

/**
 * The new frames (world) of the groups with an origin of their own among `ids` and inside them, aligned along `axes`
 * to `target` (none: the drawing's axes, each origin where it is; given: also its point); those already so left out.
 */
export function alignedFrames(doc: Doc, ids: string[], axes: number[], target?: Matrix4) {
  const { world } = placesOf(doc);
  const out = new Map<string, Matrix4>();
  for (const id of ownOrigins(doc, ids)) {
    const was = world.get(id) ?? new Matrix4();
    const m = alignedFrame(was, target ?? new Matrix4(), axes, !!target);
    if (m.elements.some((v, k) => Math.abs(v - was.elements[k]) > 1e-6)) out.set(id, m);
  }
  return out;
}

/** `doc` with each group's origin at its frame in `frames` (world, outer groups first), all contents where they are. */
export function alignOrigins(doc: Doc, frames: Map<string, Matrix4>): Doc {
  for (const [id, frame] of frames) doc = originTo(doc, id, frame);
  return doc;
}
