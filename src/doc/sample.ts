import type { Doc, Expr, Part, Profile, SketchPlane, Step, Unit } from './types';

export const ex = (e: string | number, u: Unit = 'mm'): Expr => ({ e: String(e), u });

export const newId = () => crypto.randomUUID().slice(0, 8);

export const newFinish = (u: Unit): Step => ({
  id: newId(),
  type: 'finish',
  mode: 'fillet',
  size: ex(1, u),
  edges: 'top',
  enabled: true,
});

const ground: SketchPlane = { kind: 'base', axis: 'xy', offset: ex(0) };
const rect = (w: number, h: number): Profile => ({ id: newId(), kind: 'rect', x: ex(0), y: ex(0), w: ex(w), h: ex(h), r: ex(0) });
const circle = (x: number, y: number, d: number): Profile => ({ id: newId(), kind: 'circle', x: ex(x), y: ex(y), d: ex(d) });

export function sampleDoc(): Doc {
  const plate: Part = {
    id: newId(),
    name: 'Plate',
    position: [ex(0), ex(0), ex(0)],
    steps: [
      { id: newId(), type: 'extrude', plane: ground, profiles: [rect(120, 80)], depth: ex('ply'), mode: 'add', through: false },
      {
        id: newId(),
        type: 'extrude',
        plane: ground,
        profiles: [circle(-45, -25, 5), circle(45, -25, 5), circle(45, 25, 5), circle(-45, 25, 5)],
        depth: ex(0),
        mode: 'cut',
        through: true,
      },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(8), edges: 'vertical', enabled: true },
      { id: newId(), type: 'finish', mode: 'chamfer', size: ex(0.8), edges: 'top', enabled: true },
    ],
  };
  const base = newId();
  const disc: Part = {
    id: newId(),
    name: 'Disc',
    position: [ex(110), ex(0), ex(0)],
    steps: [
      { id: base, type: 'extrude', plane: ground, profiles: [circle(0, 0, 50)], depth: ex('2 * ply'), mode: 'add', through: false },
      { id: newId(), type: 'extrude', plane: { kind: 'cap', step: base }, profiles: [circle(0, 0, 8)], depth: ex(-4), mode: 'cut', through: false },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(2), edges: 'top', enabled: true },
    ],
  };
  return { schema: 2, units: 'mm', params: { ply: ex('4mm') }, parts: [plate, disc] };
}
