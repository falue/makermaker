export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** User-entered expression; bare numbers mean unit `u`, the display unit at entry time. */
export interface Expr {
  e: string;
  u: Unit;
}

export type Profile = { kind: 'rect'; w: Expr; h: Expr; r: Expr } | { kind: 'circle'; d: Expr };

export type EdgeRule = 'all' | 'top' | 'bottom' | 'vertical';

export type Step =
  | { id: string; type: 'extrude'; profile: Profile; depth: Expr }
  | { id: string; type: 'hole'; x: Expr; y: Expr; d: Expr }
  | { id: string; type: 'finish'; mode: 'fillet' | 'chamfer'; size: Expr; edges: EdgeRule; enabled: boolean };

export interface Part {
  id: string;
  name: string;
  position: [Expr, Expr, Expr];
  /** steps[0] is the base extrusion. */
  steps: Step[];
}

export interface Doc {
  schema: 1;
  units: Unit;
  params: Record<string, Expr>;
  parts: Part[];
}
