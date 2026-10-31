export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** User-entered expression; bare numbers mean unit `u`, the display unit at entry time. */
export interface Expr {
  e: string;
  u: Unit;
}

export type BasePlane = 'xy' | 'xz' | 'yz';

/** Where an extrusion's shapes lie (body-local): a base plane of the body, or the end face of an earlier extrude feature. */
export type SketchPlane = { kind: 'base'; axis: BasePlane; offset: Expr } | { kind: 'cap'; feature: string };

/** Where a sketch object lies: a base plane (world), or the end face of a body's extrude feature (moves with the body). */
export type SketchPlacement = { kind: 'base'; axis: BasePlane; offset: Expr } | { kind: 'cap'; body: string; feature: string };

/**
 * A shape in sketch plane coordinates: rect, circle and regular polygon (`ngon`: `sides` corners on diameter `d`)
 * centred on x, y; polygon corners in mm. `rot` (degrees) turns rect and ngon around their centre and a polygon around
 * the centre of its corners.
 */
export type Profile = (
  | { id: string; kind: 'rect'; x: Expr; y: Expr; w: Expr; h: Expr; r: Expr; rot: Expr }
  | { id: string; kind: 'circle'; x: Expr; y: Expr; d: Expr }
  | { id: string; kind: 'ngon'; x: Expr; y: Expr; d: Expr; sides: Expr; rot: Expr }
  | { id: string; kind: 'polygon'; pts: [number, number][]; r: Expr; rot: Expr }
) & {
  /** A help line: drawn dashed, snapped to, never extruded. */
  help?: boolean;
};

/** Editable 2D geometry: shapes on one plane. Extrusions can use its shapes and follow their changes. */
export interface Sketch {
  id: string;
  name: string;
  plane: SketchPlacement;
  shapes: Profile[];
  visible: boolean;
}

export type EdgeRule = 'all' | 'top' | 'bottom' | 'vertical';

/** An area of a sketch: inside all `in` shapes and outside all `out` shapes (shape ids). */
export interface Area {
  in: string[];
  out: string[];
}

/**
 * Shapes taken from a sketch (linked; `areas`: only these areas of them, else shapes inside shapes are holes), or kept
 * in the feature itself (own; an unlinked copy).
 */
export type ExtrudeSource =
  | { kind: 'sketch'; sketch: string; shapes: string[]; areas?: Area[] }
  | { kind: 'own'; plane: SketchPlane; profiles: Profile[]; areas?: Area[] };

export type FinishFeature = { id: string; type: 'finish'; mode: 'fillet' | 'chamfer'; size: Expr; edges: EdgeRule; enabled: boolean };

/** A ball with diameter `d` centred on x, y, z (body coordinates). */
export type SphereFeature = { id: string; type: 'sphere'; x: Expr; y: Expr; z: Expr; d: Expr };

export type Feature =
  /** Shapes pushed along the plane normal by `depth` (negative: the other way), or through everything. */
  | { id: string; type: 'extrude'; source: ExtrudeSource; depth: Expr; mode: 'add' | 'cut'; through: boolean }
  | SphereFeature
  | FinishFeature;

/** A plane given directly (body-local): a sketch on another body's face. */
export type FramePlane = { kind: 'frame'; o: [number, number, number]; x: [number, number, number]; y: [number, number, number]; n: [number, number, number] };

/** An extrusion with its plane and shapes at hand, as the kernel builds it. */
export type ExtrudeIn = {
  id: string;
  type: 'extrude';
  plane: SketchPlane | FramePlane;
  profiles: Profile[];
  areas?: Area[];
  depth: Expr;
  mode: 'add' | 'cut';
  through: boolean;
};
export type BuildIn = ExtrudeIn | SphereFeature | FinishFeature;

export interface Body {
  id: string;
  name: string;
  /** Display colour (#rrggbb). */
  color: string;
  visible: boolean;
  position: [Expr, Expr, Expr];
  features: Feature[];
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
  schema: 4;
  units: Unit;
  params: Record<string, Expr>;
  bodies: Body[];
  sketches: Sketch[];
  sections: Section[];
}
