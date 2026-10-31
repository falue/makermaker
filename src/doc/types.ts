export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** User-entered expression; bare numbers mean unit `u`, the display unit at entry time. */
export interface Expr {
  e: string;
  u: Unit;
}

export type BasePlane = 'xy' | 'xz' | 'yz';

/** Where a sketch lies: a base plane of the part, or the end face of an earlier extrude step. */
export type SketchPlane = { kind: 'base'; axis: BasePlane; offset: Expr } | { kind: 'cap'; step: string };

/** In sketch plane coordinates; rect and circle are centred on x, y; polygon corners in mm. */
export type Profile =
  | { id: string; kind: 'rect'; x: Expr; y: Expr; w: Expr; h: Expr; r: Expr }
  | { id: string; kind: 'circle'; x: Expr; y: Expr; d: Expr }
  | { id: string; kind: 'polygon'; pts: [number, number][]; r: Expr };

export type EdgeRule = 'all' | 'top' | 'bottom' | 'vertical';

export type Step =
  /** Profiles pushed along the plane normal by `depth` (negative: the other way), or through everything. */
  | { id: string; type: 'extrude'; plane: SketchPlane; profiles: Profile[]; depth: Expr; mode: 'add' | 'cut'; through: boolean }
  | { id: string; type: 'finish'; mode: 'fillet' | 'chamfer'; size: Expr; edges: EdgeRule; enabled: boolean };

export interface Part {
  id: string;
  name: string;
  position: [Expr, Expr, Expr];
  steps: Step[];
}

/** Custom section plane (world coordinates): keeps the side `normal` points to, cut at `origin` moved `offset` along it. */
export interface Section {
  id: string;
  name: string;
  origin: [number, number, number];
  normal: [number, number, number];
  offset: Expr;
  enabled: boolean;
}

export interface Doc {
  schema: 2;
  units: Unit;
  params: Record<string, Expr>;
  parts: Part[];
  sections: Section[];
}
