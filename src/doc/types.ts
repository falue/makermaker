export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** What a side of a line or polygon was told, its points following when a parameter changes: length, angle in degrees from `base` (radians), an arc's diameter. */
export type SideSize = { l?: Expr; deg?: Expr; base?: number; d?: Expr };

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
  | { kind: 'plane'; o: [number, number, number]; x: [number, number, number]; y: [number, number, number]; n: [number, number, number] }
  | { kind: 'work'; plane: string };

/** How a side bends, in plane coordinates (mm): a bezier curve's two handles, or a round arc through `mid`. */
export type Curve = { c1: [number, number]; c2: [number, number] } | { mid: [number, number] };

/**
 * A shape in sketch plane coordinates: rect, circle and regular polygon (`ngon`: `sides` corners on diameter `d`)
 * centred on x, y; polygon corners in mm; `line`: an open line through its points (mm), never extruded. `rot` (degrees) turns rect and ngon around their centre and a polygon around
 * the centre of its corners. `curves`: per side (from each point to the next; a polygon's last back to its first) how it bends: null straight.
 */
export type Profile = (
  | { id: string; kind: 'rect'; x: Expr; y: Expr; w: Expr; h: Expr; r: Expr; rot: Expr }
  | { id: string; kind: 'circle'; x: Expr; y: Expr; d: Expr }
  | { id: string; kind: 'ngon'; x: Expr; y: Expr; d: Expr; sides: Expr; rot: Expr }
  | { id: string; kind: 'polygon'; pts: [number, number][]; curves?: (Curve | null)[]; sizes?: (SideSize | null)[]; r: Expr; rot: Expr }
  | { id: string; kind: 'line'; pts: [number, number][]; curves?: (Curve | null)[]; sizes?: (SideSize | null)[] }
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
/** Picked edges: polylines where they were picked and, per polyline, the normals of the faces that met there: they find the edge again when an edit moves it. */
export type EdgeRule = 'all' | 'top' | 'bottom' | 'vertical' | { pts: [number, number, number][][]; normals?: [number, number, number][][] };

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
/**
 * `free`: its tool body was dragged elsewhere in the object list: it is listed there, and stays a tool in every other way.
 * `linked`: the other body stays an ordinary body, seen and moved on its own, and this one is cut where it is.
 * `grow`: the tool counts this much bigger all round, so a gap stays: a clearance.
 * `along`: all that joint's way Min to Max counts, so the two pass each other, wherever the joint is now.
 */
export type BooleanFeature = { id: string; type: 'boolean'; op: BooleanOp; body: string; free?: boolean; linked?: boolean; grow?: Expr; along?: string };
export type BooleanOp = 'union' | 'subtract' | 'intersect';

/**
 * An imported mesh (stays a mesh: no CAD operations on it yet): triangles as base64 data, `vertices` float32 xyz and
 * `triangles` uint32 corner indices (z up), times `scale`; `source`: the file it came from.
 */
/** A mesh read from a file: base64 float xyz `vertices`, uint32 `triangles`, `uvs` (float u, v per vertex: where its material's picture lies) if it had a texture. */
export type MeshFeature = { id: string; type: 'mesh'; source: string; vertices: string; triangles: string; uvs?: string; scale: Expr };

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
/**
 * The body made thicker all round by `thickness`, its corners `sharp` (a box stays a box) or `round` (the same distance
 * everywhere); flat faces `exclude`d stay where they are (a point on or over one, and its outward normal, body-local).
 * `skin`: only what it adds is left, hollow where the body was.
 */
export type CoatFeature = { id: string; type: 'coat'; thickness: Expr; corners: 'sharp' | 'round'; exclude: { at: [number, number, number]; n: [number, number, number] }[]; skin?: boolean };

/** The body mirrored across a plane (body-local: through `o`, normal `n`). */
export type MirrorFeature = { id: string; type: 'mirror'; o: [number, number, number]; n: [number, number, number] };

/**
 * A real thread (body-local): along `dir` from `at` (the middle of a hole's or shaft's end), `length` long, on the
 * round surface of radius `r` (a hole's: `inside`, cut outward into its wall; a shaft's: cut inward), with the ISO
 * basic profile of major diameter `d` and `pitch` per turn; `size`: the listed size it was set from (see threads.ts).
 */
export type ThreadFeature = { id: string; type: 'thread'; at: [number, number, number]; dir: [number, number, number]; r: number; inside: boolean; size: string; d: Expr; pitch: Expr; length: Expr };

/**
 * A face bulged out smoothly (or dented in), its rim kept: a flat face through body point `at` (`mid`: its middle, `half`: half its size along x / y / z, `n`: its
 * outward normal), a
 * round one (body-local axis from `at` along `dir`, radius `r`, `length` long; `shaft`: material inside, else a hole),
 * or closed sketch shapes (a solid of its own on their plane). `peak` is the high point (x, y, z) from the face's
 * middle (body-local): its part along the face's normal is the height (negative: a dent), the rest moves it across the
 * face (a round face: along its axis; its distance from the axis, less the radius, is the height). `fullness` sets the
 * curve, -4 (pointy) to 4 (flat topped): 0 a pillow, 1 a dome.
 */
export type BulgeFeature = {
  id: string;
  type: 'bulge';
  on: { kind: 'face'; at: [number, number, number]; mid: [number, number, number]; half: [number, number, number]; n: [number, number, number] } | { kind: 'round'; at: [number, number, number]; dir: [number, number, number]; r: number; length: number; shaft: boolean } | { kind: 'sketch'; sketch: string; shapes: string[] };
  fullness: Expr;
  peak: [Expr, Expr, Expr];
};

/**
 * A box joint with another body: where the two overlap is cut into `count` fingers across its longest side (`width`
 * set above 0: fingers exactly that long from the overlap's low end, the rest at the other end; `from` set: from that
 * point (world) both ways), every other one taken from each body, so they interlock. Both bodies have one; the `first`
 * keeps the first finger, and its count, width, point and `clearance` (the gap between mating fingers, half from each side; none: 0) count for both.
 */
export type FingersFeature = { id: string; type: 'fingers'; body: string; count: Expr; width: Expr; from: [number, number, number] | null; first: boolean; clearance?: Expr };

/** Any flat face (body point `at` on it, outward normal `n`, body-local) pushed or pulled `distance` along `n`: the face extruded and joined, or cut in. */
export type PushFeature = { id: string; type: 'push'; at: [number, number, number]; n: [number, number, number]; distance: Expr };

/**
 * A flat face (body point `at` on it, outward normal `n`, body-local) drafted: turned `angle` degrees about its hinge
 * (a line in its plane from `axis.at` along `axis.dir`), its far side inward (negative: outward).
 */
export type DraftFeature = { id: string; type: 'draft'; at: [number, number, number]; n: [number, number, number]; axis: { at: [number, number, number]; dir: [number, number, number] }; angle: Expr };

/**
 * A body in separate pieces (solids, after a cut or a boolean) keeps only piece `index`: the pieces in the order of
 * their boxes' middles along x, then y, then z.
 */
export type PieceFeature = { id: string; type: 'piece'; index: number };

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
  | CoatFeature
  | MirrorFeature
  | ThreadFeature
  | BulgeFeature
  | PushFeature
  | DraftFeature
  | FingersFeature
  | PieceFeature;

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
/** A bulge with sketch shapes on their frame (body-local), as the kernel builds it. */
export type BulgeIn = Omit<BulgeFeature, 'on'> & { on: Exclude<BulgeFeature['on'], { kind: 'sketch' }> | { kind: 'frame'; frame: Omit<FramePlane, 'kind'>; profiles: Profile[] } };
export type BuildIn = ExtrudeIn | SphereFeature | FinishFeature | StepFeature | SplitIn | RevolveIn | LoftIn | SweepIn | ShellFeature | CoatFeature | MirrorFeature | ThreadFeature | BulgeIn | PushFeature | DraftFeature | PieceFeature;

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
  /**
   * A linked copy: the body whose steps it shares (editing them edits all its copies); its own `features` come after
   * them (a mirror, say). Null: its own design.
   */
  link: string | null;
  /** Its place among its group's groups and bodies in the object list (none: after the groups, as listed). */
  order?: number;
  /** Its material (none: its group's, else its own colour). */
  material?: string;
}

/** Custom section plane (world coordinates): keeps the side `normal` points to, cut at `origin` moved `offset` along it, turned `turn` degrees around `axis` (none: a line in the plane through that point). */
export interface Section {
  id: string;
  name: string;
  origin: [number, number, number];
  normal: [number, number, number];
  offset: Expr;
  turn?: Expr;
  axis?: { at: [number, number, number]; dir: [number, number, number] } | null;
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
  /** The material of its contents that have none of their own. */
  material?: string;
}

/**
 * What a surface looks like. `bump`: mirror (0) over matte (0.5) to bumpy (1); `reflection`: how much it mirrors what
 * is around it, in its colour, like metal; `translucency` and `glowStrength` run 0 to 1. `overlay`: a measuring grid on it.
 * `image`: a picture on it (a data URL; an imported texture), tinted by `color`, where a mesh's UVs put it, else every 12 mm.
 */
export interface MaterialLook {
  color: string;
  bump: number;
  reflection: number;
  translucency: number;
  glow: string;
  glowStrength: number;
  overlay?: 'metric' | 'imperial';
  image?: string;
}

/** A look with a name, saved in the file. */
export interface Material extends MaterialLook {
  id: string;
  name: string;
}

/**
 * The sun (degrees above the horizon and around Z from +X; three's light intensity) and the light from all around.
 * `followCamera`: the sun stays behind the camera, 45° to its side, `sunAround` unused. `cameraOn`: a light from the
 * camera too, `cameraLight` strong. `standard`: all this is left aside for `DEFAULT_LIGHT`.
 */
export interface Light {
  sunHeight: number;
  sunAround: number;
  sun: number;
  sunColor: string;
  ambient: number;
  ambientColor: string;
  followCamera: boolean;
  cameraOn: boolean;
  cameraLight: number;
  standard: boolean;
}

/** A picture of all around (equirectangular, about 2:1), as a data URL. */
export interface PhotoSphere {
  id: string;
  name: string;
  data: string;
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
 * solid, and renders get a floor of it that catches the shadows. `photo`: a photo sphere of the document instead,
 * turned by `turn` degrees (the stops show if it is gone).
 */
export interface Backdrop {
  stops: { color: string; at: number }[];
  band: number;
  photo?: { id: string; turn: number };
}

/** A nice render: when, from where, on which background, and a small picture taken when it was asked for. */
export interface RenderShot {
  id: string;
  at: string;
  camera: CameraState;
  background: Backdrop;
  /** PNG data URL, about 320 px wide. */
  thumbnail: string;
  /** Its number in the file's names (`<file>_render_<n>_<when>.png`), counting up from 1. */
  n?: number;
  /** Small data URLs of its pictures, newest first (rendered again: the older ones stay below); `nice`: path traced, else a snapshot. */
  results: { at: string; preview: string; nice: boolean }[];
}

/**
 * A work plane (world): its base frame (`o`, `x`, `y` in it, normal `n`: where it was made), then through its `points`
 * (one: turned around its axis until it passes through it; two: through both; three: through all three), else turned
 * `turn` degrees around its `axis` (null: its own x through `o`); moved `offset` along its normal last (see
 * `workFrame`). `mode` is how it was made: on a face, along an edge (its `axis`; then a point or a turn), or through
 * three points. Shown green: a rectangle around `hull` (world points: the face's corners, the edge's ends) and its
 * points, a margin on each side; `rect` once its sides were dragged (its own coordinates: u0, v0, u1, v1), grown only
 * to keep its points on it. Sketches go on it and follow it.
 */
export interface WorkPlane {
  id: string;
  name: string;
  o: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  n: [number, number, number];
  offset: Expr;
  turn: Expr;
  axis: { at: [number, number, number]; dir: [number, number, number] } | null;
  points: [Expr, Expr, Expr][];
  mode: 'face' | 'edge' | 'points';
  hull: [number, number, number][];
  rect: [number, number, number, number] | null;
  visible: boolean;
}

/**
 * A picture placed as a reference, on a plane (`frame`, world: its middle at the origin, its x along x), `width` mm
 * wide (its height from its pixels), seen through by `opacity`; `key`: a colour shown transparent (as far off as
 * `tolerance`, 0–1); a PNG's own transparency is kept. `data`: the file as a data URL.
 */
export interface ImageRef {
  id: string;
  name: string;
  data: string;
  frame: { o: [number, number, number]; x: [number, number, number]; y: [number, number, number]; n: [number, number, number] };
  width: number;
  opacity: number;
  key: string | null;
  tolerance: number;
  visible: boolean;
}

/**
 * A joint: `parent` (a body or group) stays, `children` (bodies or groups) move with it and along the joint: a hinge
 * turns them around `axis`, a slider moves them along it (a line through `at` along `dir`, in the parent's
 * coordinates); `value` (degrees or mm, between `min` and `max`) is where they are now, and modelling happens there;
 * playing it runs from `min` to `max` `speed` times as fast as the play time set in Settings. An attach does not move:
 * its parent and children move and turn as one, whichever of them moves; `axis.at` is its anchor, where it shows;
 * `min`, `max`, `value`, `speed` and `axis.dir` are unused.
 */
export interface Joint {
  id: string;
  name: string;
  kind: 'hinge' | 'slider' | 'attach';
  parent: string;
  children: string[];
  axis: { at: [number, number, number]; dir: [number, number, number] };
  min: Expr;
  max: Expr;
  value: Expr;
  speed: Expr;
}

export interface Doc {
  schema: 32;
  units: Unit;
  params: Record<string, Expr>;
  bodies: Body[];
  sketches: Sketch[];
  groups: Group[];
  sections: Section[];
  joints: Joint[];
  planes: WorkPlane[];
  images: ImageRef[];
  materials: Material[];
  photos: PhotoSphere[];
  /** Renders (snapshots and nice ones), newest first. */
  renders: RenderShot[];
  /** The light its renders take (none: the default one). */
  renderLight?: RenderLight;
  /** The folder its renders are saved to, by name (this browser remembers which one); none: Downloads. */
  renderFolder?: string;
  /** How it was looked at when saved (written only into the file, see main's `save`). */
  views?: Views;
}

/** The main camera, the extra views beside it (each: from where, its camera) and where their borders lie. */
export interface Views {
  camera: CameraState;
  layout: { x: number; rows: Record<number, number[]> };
  views: { kind: string; look?: { n: [number, number, number]; at: [number, number, number] }; ortho: boolean; position: [number, number, number]; target: [number, number, number]; height: number; zoom: number; live?: boolean }[];
}

/** The light of renders (`same`: the 3D view's instead), and their haze, 0 to 1: fast by depth, and real fog in the path tracer. */
export type RenderLight = Light & { same: boolean; haze: number; fog: number };
