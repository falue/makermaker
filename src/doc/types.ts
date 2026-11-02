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
 * centred on x, y; polygon corners in mm; `line`: an open line through its points (mm), never extruded. `rot` (degrees) turns rect and ngon around their centre and a polygon around
 * the centre of its corners.
 */
export type Profile = (
  | { id: string; kind: 'rect'; x: Expr; y: Expr; w: Expr; h: Expr; r: Expr; rot: Expr }
  | { id: string; kind: 'circle'; x: Expr; y: Expr; d: Expr }
  | { id: string; kind: 'ngon'; x: Expr; y: Expr; d: Expr; sides: Expr; rot: Expr }
  | { id: string; kind: 'polygon'; pts: [number, number][]; r: Expr; rot: Expr }
  | { id: string; kind: 'line'; pts: [number, number][] }
) & {
  /** A construction line: drawn dashed, snapped to, never extruded. */
  construction?: boolean;
  /** The sub-group of its sketch group it is in (none: directly in the sketch group). */
  group?: string;
};

/** A group of shapes inside a sketch group; `parent`: the sub-group it is in (null: directly in the sketch group). */
export type ShapeGroup = { id: string; name: string; parent: string | null };

/**
 * A sketch group: shapes on one plane, in nested sub-groups (`groups`). Extrusions can use its shapes and follow their
 * changes.
 */
export interface Sketch {
  id: string;
  name: string;
  /** The group of objects it is in (null: none). */
  group: string | null;
  plane: SketchPlacement;
  shapes: Profile[];
  groups: ShapeGroup[];
  visible: boolean;
}

/** Which edges a finish takes: by rule, or picked ones (`pts`: per edge, points along it in body coordinates). */
export type EdgeRule = 'all' | 'top' | 'bottom' | 'vertical' | { pts: [number, number, number][][] };

/**
 * An area of a sketch: inside all `in` shapes and outside all `out` shapes (shape ids); with `at`: the face that lines
 * (and the shapes they reach) enclose around that point (see `lineFaces`).
 */
export interface Area {
  in: string[];
  out: string[];
  at?: [number, number];
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

/**
 * An imported mesh (stays a mesh: no CAD operations on it yet): triangles as base64 data, `vertices` float32 xyz and
 * `triangles` uint32 corner indices (z up), times `scale`; `source`: the file it came from.
 */
export type MeshFeature = { id: string; type: 'mesh'; source: string; vertices: string; triangles: string; scale: Expr };

/** A solid read from a STEP file (`data`: the file's text, in mm); `source`: the file it came from. */
export type StepFeature = { id: string; type: 'step'; source: string; data: string };

/** Shapes turned `angle` degrees around `axis`, a line in their sketch plane (through `at` along `dir`, plane coordinates). */
export type RevolveFeature = { id: string; type: 'revolve'; source: ExtrudeSource; axis: { at: [number, number]; dir: [number, number] }; angle: Expr; mode: 'add' | 'cut' };

/** A solid through closed sketch shapes in order (`ruled`: straight between them, else smooth). */
export type LoftFeature = { id: string; type: 'loft'; sections: { sketch: string; shape: string }[]; ruled: boolean };

/** A closed sketch shape (`profile`, its middle on the path's start, square to it) swept along a line or shape outline (`path`). */
export type SweepFeature = { id: string; type: 'sweep'; profile: { sketch: string; shape: string }; path: { sketch: string; shape: string } };

/** Hollows the body to walls `thickness` thick, its faces at `open` (body points on them) taken away. */
export type ShellFeature = { id: string; type: 'shell'; thickness: Expr; open: [number, number, number][] };

/** The body mirrored across a plane (body-local: through `o`, normal `n`). */
export type MirrorFeature = { id: string; type: 'mirror'; o: [number, number, number]; n: [number, number, number] };

export type Feature =
  /** Shapes pushed along the plane normal by `depth` (negative: the other way), or through everything. */
  /** `back`: how far it also reaches behind its sketch plane (none: 0). */
  | { id: string; type: 'extrude'; source: ExtrudeSource; depth: Expr; back?: Expr; mode: 'add' | 'cut'; through: boolean }
  | SphereFeature
  | BooleanFeature
  | FinishFeature
  | MeshFeature
  | StepFeature
  | SplitFeature
  | RevolveFeature
  | LoftFeature
  | SweepFeature
  | ShellFeature
  | MirrorFeature;

/**
 * A cut: keeps one side (`side` 1: where the cutter's normal points, a line's left, a closed shape's inside; -1: the
 * other) of a plane (body-local through `o`, normal `n`, `x` along it; moved `offset` along its normal, then turned
 * `turn` degrees around `axis`: a line through `at` along `dir`, none: its own x through its moved `o`), of a sketch shape cut straight through along its sketch's normal (linked;
 * a line moved `offset` to its left), or of a ball or cylinder (side 1: its inside; body-local, a ball centred on `c`,
 * a cylinder from `c` `h` mm along `dir`; diameter `d`, its radius grown by `offset`).
 */
export interface SplitFeature {
  id: string;
  type: 'split';
  cutter: { kind: 'plane'; o: [number, number, number]; x: [number, number, number]; n: [number, number, number]; turn: Expr; axis: { at: [number, number, number]; dir: [number, number, number] } | null; offset: Expr } | { kind: 'shape'; sketch: string; shape: string; offset: Expr } | { kind: 'sphere'; c: [number, number, number]; d: Expr; offset: Expr } | { kind: 'cylinder'; c: [number, number, number]; dir: [number, number, number]; h: number; d: Expr; offset: Expr };
  side: 1 | -1;
}

/** A cut as the kernel builds it: a plane, or a shape on a frame (body-local), with the side kept. */
export type SplitIn = {
  id: string;
  type: 'split';
  cutter: SplitFeature['cutter'] | { kind: 'frame'; frame: { o: [number, number, number]; x: [number, number, number]; y: [number, number, number]; n: [number, number, number] }; profile: Profile; offset: Expr };
  side: 1 | -1;
};

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
  back?: Expr;
  mode: 'add' | 'cut';
  through: boolean;
};
/** A revolve with its plane and shapes at hand, as the kernel builds it. */
export type RevolveIn = Omit<RevolveFeature, 'source'> & { plane: SketchPlane | FramePlane; profiles: Profile[]; areas?: Area[] };
/** A loft with each shape on its frame (body-local), as the kernel builds it. */
export type LoftIn = { id: string; type: 'loft'; sections: { frame: Omit<FramePlane, 'kind'>; profile: Profile }[]; ruled: boolean };
/** A sweep with its path on its frame (body-local), as the kernel builds it. */
export type SweepIn = { id: string; type: 'sweep'; profile: Profile; path: { frame: Omit<FramePlane, 'kind'>; profile: Profile } };
export type BuildIn = ExtrudeIn | SphereFeature | FinishFeature | StepFeature | SplitIn | RevolveIn | LoftIn | SweepIn | ShellFeature | MirrorFeature;

export interface Body {
  id: string;
  name: string;
  /** The group it is in (null: none); its position counts from the group's origin. */
  group: string | null;
  /** Its own turn about its origin, degrees around the group's X, then Y, then Z. */
  rotation: { rx: Expr; ry: Expr; rz: Expr };
  /** Display colour (#rrggbb). */
  color: string;
  visible: boolean;
  position: [Expr, Expr, Expr];
  features: Feature[];
  /** Its place among its group's groups and bodies in the object list (none: after the groups, as listed). */
  order?: number;
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
  /** Its place among its parent's groups and bodies in the object list (none: first, as listed). */
  order?: number;
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
 * A background around the horizon: colour stops from straight up (`at` 0) to straight down (`at` 1), blended over
 * `band` degrees above and below the horizon (looking further up or down shows only the end colours). One colour:
 * solid, and renders get a floor of it that catches the shadows.
 */
export interface Backdrop {
  stops: { color: string; at: number }[];
  band: number;
}

/** A nice render: when, from where, on which background, and a small picture taken when it was asked for. */
export interface RenderShot {
  id: string;
  at: string;
  camera: CameraState;
  background: Backdrop;
  /** PNG data URL, about 320 px wide. */
  thumbnail: string;
  /** Small data URLs of its pictures, newest first (rendered again: the older ones stay below); `nice`: path traced, else a snapshot. */
  results: { at: string; preview: string; nice: boolean }[];
}

/**
 * A joint: `parent` (a body or group) stays, `children` (bodies or groups) move with it and along the joint: a hinge
 * turns them around `axis`, a slider moves them along it (a line through `at` along `dir`, in the parent's
 * coordinates); `value` (degrees or mm, between `min` and `max`) is where they are now, and modelling happens there;
 * playing it runs from `min` to `max` `speed` times as fast as the play time set in Settings.
 */
export interface Joint {
  id: string;
  name: string;
  kind: 'hinge' | 'slider';
  parent: string;
  children: string[];
  axis: { at: [number, number, number]; dir: [number, number, number] };
  min: Expr;
  max: Expr;
  value: Expr;
  speed: Expr;
}

export interface Doc {
  schema: 13;
  units: Unit;
  params: Record<string, Expr>;
  bodies: Body[];
  sketches: Sketch[];
  groups: Group[];
  sections: Section[];
  joints: Joint[];
  /** Renders (snapshots and nice ones), newest first. */
  renders: RenderShot[];
}
