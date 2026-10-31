export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** User-entered expression; bare numbers mean unit `u`, the display unit at entry time. */
export interface Expr {
  e: string;
  u: Unit;
}

export type BasePlane = 'xy' | 'xz' | 'yz';

/** Where an extrusion's shapes lie (body-local): a base plane of the body, or the end face of an earlier extrude feature. */
export type SketchPlane = { kind: 'base'; axis: BasePlane; offset: Expr } | { kind: 'cap'; feature: string };

/**
 * Where a sketch object lies: a base plane (world); the end face of a body's extrude feature, or the side face made by
 * straight side `edge` of one of its shapes (`flip`: the face looks into the shape, a hole wall; both move with the
 * body and follow the feature); or a fixed plane in the
 * world (any other flat face; x, y in the plane, n = x × y).
 */
export type SketchPlacement =
  | { kind: 'base'; axis: BasePlane; offset: Expr }
  | { kind: 'cap'; body: string; feature: string }
  | { kind: 'side'; body: string; feature: string; shape: string; edge: number; flip: boolean }
  | { kind: 'plane'; o: [number, number, number]; x: [number, number, number]; y: [number, number, number]; n: [number, number, number] };

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
  /** A construction line: drawn dashed, snapped to, never extruded. */
  construction?: boolean;
};

/** Editable 2D geometry: shapes on one plane. Extrusions can use its shapes and follow their changes. */
export interface Sketch {
  id: string;
  name: string;
  /** The group it is in (null: none). */
  group: string | null;
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

/**
 * Rounds or chamfers the edges its rule picks, except `skip` (body points on edges taken out one by one). Unbaked it
 * runs last, so it also finishes edges made later (by booleans); baked it stays where it is in the list.
 */
export type FinishFeature = { id: string; type: 'finish'; mode: 'fillet' | 'chamfer'; size: Expr; edges: EdgeRule; enabled: boolean; baked: boolean; skip: [number, number, number][] };

/** A ball with diameter `d` centred on x, y, z (body coordinates). */
export type SphereFeature = { id: string; type: 'sphere'; x: Expr; y: Expr; z: Expr; d: Expr };

/** Joins, cuts or intersects with another body (the tool body: stays editable, normally hidden). */
export type BooleanFeature = { id: string; type: 'boolean'; op: BooleanOp; body: string };
export type BooleanOp = 'union' | 'subtract' | 'intersect';

export type Feature =
  /** Shapes pushed along the plane normal by `depth` (negative: the other way), or through everything. */
  | { id: string; type: 'extrude'; source: ExtrudeSource; depth: Expr; mode: 'add' | 'cut'; through: boolean }
  | SphereFeature
  | BooleanFeature
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
  /** The group it is in (null: none); its position counts from the group's origin. */
  group: string | null;
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

/**
 * Groups organise bodies, sketches and other groups. `origin` parent: contents count from the parent's origin;
 * custom: from `position` (in the parent), turned by `rotation` (degrees around the parent's X, then Y, then Z), so
 * contents are edited unturned. Hiding a group hides its contents without changing their own eyes.
 */
export interface Group {
  id: string;
  name: string;
  parent: string | null;
  visible: boolean;
  origin: { kind: 'parent' } | { kind: 'custom'; position: [Expr, Expr, Expr]; rotation: { rx: Expr; ry: Expr; rz: Expr } };
}

/** A camera as it was: enough to render the same picture again with newer model data. */
export interface CameraState {
  ortho: boolean;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /** Perspective: vertical field of view (degrees); ortho: visible height (mm). */
  fov: number;
  height: number;
  /** Picture size in px. */
  size: [number, number];
}

/**
 * A render's background: a sky fading from `bottom` straight down to `top` straight up, the horizon halfway (the same
 * colour twice: plain); `floor`: a floor of the colour at the horizon catches the shadows (and hides the lower sky).
 */
export interface Backdrop {
  top: string;
  bottom: string;
  floor: boolean;
}

/** A nice render: when, from where, on which background, and a small picture taken when it was asked for. */
export interface RenderShot {
  id: string;
  at: string;
  camera: CameraState;
  background: Backdrop;
  /** PNG data URL, about 320 px wide. */
  thumbnail: string;
  /** Small JPEG data URLs of finished renders, newest first (rendered again: the older ones stay below). */
  results: { at: string; preview: string }[];
}

export interface Doc {
  schema: 7;
  units: Unit;
  params: Record<string, Expr>;
  bodies: Body[];
  sketches: Sketch[];
  groups: Group[];
  sections: Section[];
  /** Nice renders, newest first, and the background the next one gets. */
  renders: RenderShot[];
  renderBackground: Backdrop;
}
