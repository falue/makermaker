export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** User-entered expression; bare numbers mean unit `u`, the display unit at entry time. */
export interface Expr {
  e: string;
  u: Unit;
}

export type BasePlane = 'xy' | 'xz' | 'yz';

/** Where an extrusion's shapes lie (part-local): a base plane of the part, or the end face of an earlier extrude step. */
export type SketchPlane = { kind: 'base'; axis: BasePlane; offset: Expr } | { kind: 'cap'; step: string };

/** Where a sketch object lies: a base plane (world), or the end face of a part's extrude step (moves with the part). */
export type SketchPlacement = { kind: 'base'; axis: BasePlane; offset: Expr } | { kind: 'cap'; part: string; step: string };

/**
 * A shape in sketch plane coordinates: rect and circle centred on x, y; polygon corners in mm. `rot` (degrees) turns a
 * rect around its centre and a polygon around the centre of its corners.
 */
export type Profile =
  | { id: string; kind: 'rect'; x: Expr; y: Expr; w: Expr; h: Expr; r: Expr; rot: Expr }
  | { id: string; kind: 'circle'; x: Expr; y: Expr; d: Expr }
  | { id: string; kind: 'polygon'; pts: [number, number][]; r: Expr; rot: Expr };

/** A 2D drawing: shapes on one plane. Extrusions can use its shapes and follow their changes. */
export interface Sketch {
  id: string;
  name: string;
  plane: SketchPlacement;
  shapes: Profile[];
  visible: boolean;
}

export type EdgeRule = 'all' | 'top' | 'bottom' | 'vertical';

/** Shapes taken from a sketch (linked), or kept in the step itself (own; an unlinked copy). */
export type ExtrudeSource = { kind: 'sketch'; sketch: string; shapes: string[] } | { kind: 'own'; plane: SketchPlane; profiles: Profile[] };

export type FinishStep = { id: string; type: 'finish'; mode: 'fillet' | 'chamfer'; size: Expr; edges: EdgeRule; enabled: boolean };

export type Step =
  /** Shapes pushed along the plane normal by `depth` (negative: the other way), or through everything. */
  | { id: string; type: 'extrude'; source: ExtrudeSource; depth: Expr; mode: 'add' | 'cut'; through: boolean }
  | FinishStep;

/** An extrusion with its plane and shapes at hand, as the kernel builds it. */
export type ExtrudeIn = { id: string; type: 'extrude'; plane: SketchPlane; profiles: Profile[]; depth: Expr; mode: 'add' | 'cut'; through: boolean };
export type BuildIn = ExtrudeIn | FinishStep;

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
  schema: 3;
  units: Unit;
  params: Record<string, Expr>;
  parts: Part[];
  sketches: Sketch[];
  sections: Section[];
}
