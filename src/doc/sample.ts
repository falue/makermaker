import type { Doc, Expr, Part, Step, Unit } from './types';

export const ex = (e: string | number, u: Unit = 'mm'): Expr => ({ e: String(e), u });

const newId = () => crypto.randomUUID().slice(0, 8);

export const newHole = (u: Unit): Step => ({ id: newId(), type: 'hole', x: ex(0, u), y: ex(0, u), d: ex(5, 'mm') });

export const newFinish = (u: Unit): Step => ({
  id: newId(),
  type: 'finish',
  mode: 'fillet',
  size: ex(1, u),
  edges: 'top',
  enabled: true,
});

export function newPart(name: string, u: Unit): Part {
  return {
    id: newId(),
    name,
    position: [ex(0, u), ex(0, u), ex(0, u)],
    steps: [{ id: newId(), type: 'extrude', profile: { kind: 'rect', w: ex(100), h: ex(60), r: ex(0) }, depth: ex('ply') }],
  };
}

export function sampleDoc(): Doc {
  const plate: Part = {
    id: newId(),
    name: 'Plate',
    position: [ex(0), ex(0), ex(0)],
    steps: [
      { id: newId(), type: 'extrude', profile: { kind: 'rect', w: ex(120), h: ex(80), r: ex(0) }, depth: ex('ply') },
      ...[
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([sx, sy]): Step => ({ id: newId(), type: 'hole', x: ex(`${sx * 45}`), y: ex(`${sy * 25}`), d: ex(5) })),
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(8), edges: 'vertical', enabled: true },
      { id: newId(), type: 'finish', mode: 'chamfer', size: ex(0.8), edges: 'top', enabled: true },
    ],
  };
  const disc: Part = {
    id: newId(),
    name: 'Disc',
    position: [ex(110), ex(0), ex(0)],
    steps: [
      { id: newId(), type: 'extrude', profile: { kind: 'circle', d: ex(50) }, depth: ex('2 * ply') },
      { id: newId(), type: 'hole', x: ex(0), y: ex(0), d: ex(8) },
      { id: newId(), type: 'finish', mode: 'fillet', size: ex(2), edges: 'top', enabled: true },
    ],
  };
  return { schema: 1, units: 'mm', params: { ply: ex('4mm') }, parts: [plate, disc] };
}
