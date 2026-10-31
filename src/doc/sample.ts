import type { Doc, Expr, Body, Profile, Sketch, Feature, Unit } from './types';

export const ex = (e: string | number, u: Unit = 'mm'): Expr => ({ e: String(e), u });

export const newId = () => crypto.randomUUID().slice(0, 8);

export const newFinish = (u: Unit): Feature => ({
  id: newId(),
  type: 'finish',
  mode: 'fillet',
  size: ex(1, u),
  edges: 'top',
  enabled: true,
  baked: false,
  skip: [],
});

const rect = (w: number, h: number): Profile => ({ id: newId(), kind: 'rect', x: ex(0), y: ex(0), w: ex(w), h: ex(h), r: ex(0), rot: ex(0) });
const circle = (x: number, y: number, d: number): Profile => ({ id: newId(), kind: 'circle', x: ex(x), y: ex(y), d: ex(d) });
const ground = { kind: 'base', axis: 'xy', offset: ex(0) } as const;
/** A body pulled up from own shapes on its ground plane. */
const solid = (name: string, color: string, at: [number, number, number], profiles: Profile[], depth: number | string, group: string | null = null): Body => ({
  id: newId(),
  name,
  group,
  color,
  visible: true,
  position: [ex(at[0]), ex(at[1]), ex(at[2])],
  features: [{ id: newId(), type: 'extrude', source: { kind: 'own', plane: ground, profiles }, depth: ex(depth), mode: 'add', through: false }],
});

/**
 * A playground: a plate drawn as a sketch (the holes are circles inside the rectangle), a disc built from own shapes,
 * and overlapping pieces to try booleans on: a pin through the plate, a block over its back edge with a ball on its
 * corner (both in a group), a hex nut sunk into the disc, and a free sketch on the front plane that no body uses yet.
 */
export function sampleDoc(): Doc {
  const outline: Sketch = {
    id: newId(),
    name: 'Plate outline',
    group: null,
    plane: { kind: 'base', axis: 'xy', offset: ex(0) },
    shapes: [rect(120, 80), circle(-45, -25, 5), circle(45, -25, 5), circle(45, 25, 5), circle(-45, 25, 5)],
    visible: true,
  };
  const plate: Body = {
    id: newId(),
    name: 'Plate',
    group: null,
    color: '#d8c3a0',
    visible: true,
    position: [ex(0), ex(0), ex(0)],
    features: [
      { id: newId(), type: 'extrude', source: { kind: 'sketch', sketch: outline.id, shapes: outline.shapes.map((s) => s.id) }, depth: ex('ply'), mode: 'add', through: false },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(8), edges: 'vertical', enabled: true, baked: false, skip: [] },
      { id: newId(), type: 'finish', mode: 'chamfer', size: ex(0.8), edges: 'top', enabled: true, baked: false, skip: [] },
    ],
  };
  const base = newId();
  const disc: Body = {
    id: newId(),
    name: 'Disc',
    group: null,
    color: '#a9c4d8',
    visible: true,
    position: [ex(110), ex(0), ex(0)],
    features: [
      { id: base, type: 'extrude', source: { kind: 'own', plane: { kind: 'base', axis: 'xy', offset: ex(0) }, profiles: [circle(0, 0, 50)] }, depth: ex('2 * ply'), mode: 'add', through: false },
      { id: newId(), type: 'extrude', source: { kind: 'own', plane: { kind: 'cap', feature: base }, profiles: [circle(0, 0, 8)] }, depth: ex(-4), mode: 'cut', through: false },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(2), edges: 'top', enabled: true, baked: false, skip: [] },
    ],
  };
  const corner = { id: newId(), name: 'Corner pieces', parent: null, visible: true, origin: { kind: 'parent' } as const };
  const pin = solid('Pin', '#c7b3dc', [30, 0, -10], [circle(0, 0, 16)], 30);
  const block = solid('Block', '#b8cfa1', [-30, 40, 0], [rect(50, 30)], 25, corner.id);
  const ball: Body = {
    id: newId(),
    name: 'Ball',
    group: corner.id,
    color: '#d9a98f',
    visible: true,
    position: [ex(-5), ex(55), ex(25)],
    features: [{ id: newId(), type: 'sphere', x: ex(0), y: ex(0), z: ex(0), d: ex(36) }],
  };
  const nut = solid('Hex nut', '#e3d48f', [110, 0, 4], [{ id: newId(), kind: 'ngon', x: ex(0), y: ex(0), d: ex(30), sides: ex(6), rot: ex(0) }, circle(0, 0, 14)], 10);
  return {
    schema: 7,
    units: 'mm',
    params: { ply: ex('4mm') },
    bodies: [plate, disc, pin, block, ball, nut],
    sketches: [
      outline,
      {
        id: newId(),
        name: 'Free sketch',
        group: null,
        plane: { kind: 'base', axis: 'xz', offset: ex(60) },
        shapes: [circle(-20, 20, 24), { ...rect(50, 30), construction: true }],
        visible: true,
      },
    ],
    groups: [corner],
    sections: [],
    renders: [],
    renderBackground: { top: '#f4f4f2', bottom: '#f4f4f2', floor: true },
  };
}
