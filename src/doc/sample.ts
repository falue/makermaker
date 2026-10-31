import type { Doc, Expr, Part, Profile, Sketch, Step, Unit } from './types';

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

const rect = (w: number, h: number): Profile => ({ id: newId(), kind: 'rect', x: ex(0), y: ex(0), w: ex(w), h: ex(h), r: ex(0), rot: ex(0) });
const circle = (x: number, y: number, d: number): Profile => ({ id: newId(), kind: 'circle', x: ex(x), y: ex(y), d: ex(d) });

/** A plate drawn as a sketch (the holes are circles inside the rectangle) and a disc built from own shapes. */
export function sampleDoc(): Doc {
  const drawing: Sketch = {
    id: newId(),
    name: 'Plate outline',
    plane: { kind: 'base', axis: 'xy', offset: ex(0) },
    shapes: [rect(120, 80), circle(-45, -25, 5), circle(45, -25, 5), circle(45, 25, 5), circle(-45, 25, 5)],
    visible: true,
  };
  const plate: Part = {
    id: newId(),
    name: 'Plate',
    position: [ex(0), ex(0), ex(0)],
    steps: [
      { id: newId(), type: 'extrude', source: { kind: 'sketch', sketch: drawing.id, shapes: drawing.shapes.map((s) => s.id) }, depth: ex('ply'), mode: 'add', through: false },
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
      { id: base, type: 'extrude', source: { kind: 'own', plane: { kind: 'base', axis: 'xy', offset: ex(0) }, profiles: [circle(0, 0, 50)] }, depth: ex('2 * ply'), mode: 'add', through: false },
      { id: newId(), type: 'extrude', source: { kind: 'own', plane: { kind: 'cap', step: base }, profiles: [circle(0, 0, 8)] }, depth: ex(-4), mode: 'cut', through: false },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(2), edges: 'top', enabled: true },
    ],
  };
  return { schema: 3, units: 'mm', params: { ply: ex('4mm') }, parts: [plate, disc], sketches: [drawing], sections: [] };
}
