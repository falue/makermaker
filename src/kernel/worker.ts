import { zipSync, strToU8 } from 'fflate';
import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { deserializeShape, exportSTEP, getOC, setOC, type Shape3D } from 'replicad';
import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import { placed, type Place } from '../doc/frames';
import { dxfOf, sheetOf, sheetSvg, type Cut, type Label } from '../io/cutfile';
import { legend, type Anchor } from './legend';
import { laserPart, withKerf } from './laser';
import { unwrap, type UnwrapPiece } from './unwrap';
import { clashes, type ClashAsk, type ClashResult } from './clash';
import { answer, Solid, type MeasureAnswer, type MeasureAsk } from './measure';
import { exactSteps, type Exact } from './exact';
import { areasOf, buildBody, cosmeticOf, dropBase, loadImports, meshBody, placeShape, unplaceShape, FeatureError, type AreaMesh, type BaseCache, type BuildFeature, type BodyMesh, type Finishing } from './build';
import { solidChecks } from './exact';
import { stepsKey } from './key';

/**
 * export: one file per body: stl (binary, placed in the world) or svg / dxf (laser cuts of a flat face: `face`, else
 * its biggest; `kerf` allowed for); step and 3mf: one file with every body as a named part, placed in the world.
 * check: for 3D printing, whether each body is closed, manifold and sound, and its size.
 * share: solids of this worker's bodies as text, for a clash check in another worker (its `extra`).
 */
export type ExportFile = { name: string; data: ArrayBuffer };
export type ExportFormat = 'stl' | '3mf' | 'svg' | 'dxf' | 'step';
export type ExportBody = { name: string; /** shown on a laser sheet (`name`: for a file) */ label?: string; color: string; features: BuildFeature[]; place: Place; face?: { at: V3; n: V3 }; kerf?: number };
/** A body unwrapped (see `unwrap`); `error`: why it could not be. */
export type Unwrapped = { name: string; pieces: UnwrapPiece[]; stretch: number; error?: string };
export type PrintCheck = { name: string; closed: boolean; manifold: boolean; sound: boolean; size: V3; error?: string };
type V3 = [number, number, number];
/** A solid as text, for the bodies `ids` (linked copies share one). */
type Shared = { ids: string[]; brep: string };
export type Request =
  | { kind: 'build'; bodies: { id: string; features: BuildFeature[] }[]; tolerance: number }
  | { kind: 'areas'; id: number; shapes: Resolved<Profile>[] }
  | { kind: 'export'; format: ExportFormat; id: number; bodies: ExportBody[]; around?: Pick<ExportBody, 'features' | 'place'>[] }
  | { kind: 'check'; id: number; bodies: ExportBody[] }
  | { kind: 'unwrap'; id: number; bodies: Pick<ExportBody, 'name' | 'features'>[] }
  | { kind: 'laser'; id: number; bodies: ExportBody[]; around?: Pick<ExportBody, 'features' | 'place'>[] }
  | { kind: 'legend'; id: number; bodies: Pick<ExportBody, 'features' | 'place'>[]; anchors: (Anchor & { body: number })[] }
  | { kind: 'measure'; id: number; asks: MeasureAsk[] }
  | { kind: 'clash'; id: number; ask: ClashAsk; extra: Shared[] }
  | { kind: 'share'; id: number; bodies: string[] }
  | { kind: 'stopClash' }
  | { kind: 'forget'; bodies: string[] };
export type BodyResult = { id: string; mesh: BodyMesh } | { id: string; error: string; featureId: string; max?: number };
/** `twin`: built as body `twin` of the same build (a linked copy), mesh and all: the client copies its result. */
export type Built = BodyResult | { id: string; twin: string };
export type Response =
  | { kind: 'build'; results: Built[]; done: boolean }
  | { kind: 'areas'; id: number; areas: AreaMesh[] }
  | { kind: 'export'; id: number; files: ExportFile[]; failed: string[] }
  | { kind: 'check'; id: number; results: PrintCheck[] }
  | { kind: 'unwrap'; id: number; results: Unwrapped[] }
  | { kind: 'laser'; id: number; pieces: Piece[]; failed: string[] }
  | { kind: 'legend'; id: number; piece: Piece | null }
  | { kind: 'measure'; id: number; answers: MeasureAnswer[] }
  | { kind: 'clash'; id: number; result: ClashResult }
  | { kind: 'share'; id: number; solids: Shared[] }
  | { kind: 'exact'; results: { id: string; exact: Exact | null }[] };

const PRINT = { tolerance: 0.01, angularTolerance: 0.1 };

/** A sheet's piece: its name, cuts and texts (a key's numbers). */
export type Piece = { name: string; cuts: Cut[]; notes?: Label[] };

/** The key drawing of `shapes` (placed) as one more piece, named Key; none when it cannot be drawn. */
function keyPiece(shapes: Shape3D[], anchors: Anchor[]): Piece[] {
  try {
    const key = legend(shapes, anchors);
    return key ? [{ name: 'Key', ...key }] : [];
  } catch {
    return [];
  }
}

/**
 * The laser pieces of `bodies`, named (their label), kerf allowed for; more than one numbered, with a key drawing of
 * them and the numbers on their faces (the last piece); the others (and `around`) in the world, for what a straight cut would push
 * into. Those that cannot be made go into `failed`, with why.
 */
function laserPieces(bodies: ExportBody[], others: Pick<ExportBody, 'features' | 'place'>[] = [], failed: string[]) {
  const world = [...bodies, ...others].map(({ features, place }) => {
    try {
      return placeShape(buildBody(features), place);
    } catch {
      return null;
    }
  });
  // `s` in body i's coordinates (a copy)
  const into = (s: Shape3D, i: number) => unplaceShape(s.clone(), bodies[i].place);
  const near = (all: (Shape3D | null)[], i: number) => all.flatMap((s, j) => (s && j !== i ? [into(s, i)] : []));
  // twice: first each one's own sides, then each makes room for what the others' laser parts still push into it
  const lasered: (Shape3D | null)[] = [];
  const pieces: Piece[] = [];
  const anchors: Anchor[] = [];
  for (const pass of [0, 1])
    bodies.forEach(({ name, label, features, place, face, kerf }, i) => {
      const [around, parts] = [near(world, i), pass ? near(lasered, i) : []];
      try {
        const { cuts, solid, anchor } = laserPart(features, face, around, parts);
        if (pass) {
          const n = pieces.length + 1;
          pieces.push({ name: label ?? name, cuts: withKerf(cuts, kerf ?? 0) });
          anchors.push({ n, at: placed(place, anchor.at), dir: placed(place, anchor.dir, true) });
          solid.delete();
        }
        else lasered.push(placeShape(solid, place));
      } catch (e) {
        if (pass) failed.push(`${label ?? name} (${e instanceof Error ? e.message : `OpenCascade error ${e}`})`);
        else lasered.push(null);
      } finally {
        for (const s of [...around, ...parts]) s.delete();
      }
    });
  // numbered, with a key drawing, when there is more than one
  const key = pieces.length > 1 ? keyPiece(world.slice(0, bodies.length).filter((s): s is Shape3D => !!s), anchors) : [];
  for (const s of [...world, ...lasered]) s?.delete();
  return { pieces: [...(pieces.length > 1 ? pieces.map((p, i) => ({ ...p, name: `${i + 1} ${p.name}` })) : pieces), ...key] };
}

/** A placed body's triangles for printing, its points merged where they meet (to 0.01 µm). */
function printMesh(shape: Shape3D) {
  const m = shape.mesh(PRINT);
  const index = new Map<string, number>();
  const points: number[] = [];
  const remap = Array.from({ length: m.vertices.length / 3 }, (_, i) => {
    const key = [0, 1, 2].map((k) => Math.round(m.vertices[3 * i + k] * 1e5)).join();
    if (!index.has(key)) index.set(key, points.push(m.vertices[3 * i], m.vertices[3 * i + 1], m.vertices[3 * i + 2]) / 3 - 1);
    return index.get(key)!;
  });
  return { points, triangles: m.triangles.map((v) => remap[v]) };
}

/** A 3MF file (millimetres) of placed bodies, each its own named object. */
function threeMf(parts: { name: string; points: number[]; triangles: number[] }[]) {
  const esc = (t: string) => t.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const objects = parts.map((p, i) => {
    const vs = Array.from({ length: p.points.length / 3 }, (_, k) => `<vertex x="${p.points[3 * k]}" y="${p.points[3 * k + 1]}" z="${p.points[3 * k + 2]}"/>`).join('');
    const ts = Array.from({ length: p.triangles.length / 3 }, (_, k) => `<triangle v1="${p.triangles[3 * k]}" v2="${p.triangles[3 * k + 1]}" v3="${p.triangles[3 * k + 2]}"/>`).join('');
    return `<object id="${i + 1}" name="${esc(p.name)}" type="model"><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>${objects.join('')}</resources>
<build>${parts.map((_, i) => `<item objectid="${i + 1}"/>`).join('')}</build>
</model>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
  });
}

const ready = init({ locateFile: () => wasmUrl }).then(setOC);

/** The last good solid of each body, for measuring (without its mesh: the view has that); linked copies share one. */
const solids = new Map<string, Solid>();
const users = new Map<Solid, number>();
/** Body `id`'s solid is `solid` now (none: forgotten); one no body has any more is freed. */
function keepSolid(id: string, solid?: Solid) {
  const old = solids.get(id);
  if (solid) solids.set(id, solid), users.set(solid, (users.get(solid) ?? 0) + 1);
  else solids.delete(id);
  if (!old) return;
  const left = users.get(old)! - 1;
  if (left) users.set(old, left);
  else users.delete(old), old.delete();
}
/** Each body's solid before its last steps (see `BaseCache`). */
const bases = new Map<string, BaseCache>();

/** Builds running, and when the last one ended: exact numbers wait till builds rest (see `exactsWait`). */
let building = 0;
let built = 0;
const exactsWait = 150;
/** Builds still working out exact numbers; the last done marks 'exacts done' (for DevTools and scripts/bench-open.mjs). */
let exacting = 0;

/** A check runs in turns; only a stop gets in meanwhile (a build would take its solids away). */
let checking = false;
let stopCheck = false;
type Job = Exclude<Request, { kind: 'stopClash' }>;
const later: Job[] = [];
const take = (data: Job) => {
  if (checking) later.push(data);
  else void handle(data);
};

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  await ready;
  if (data.kind === 'stopClash') stopCheck = true;
  else take(data);
};

async function handle(data: Job) {
  if (data.kind === 'forget') {
    for (const id of data.bodies) {
      keepSolid(id);
      const base = bases.get(id);
      if (base) dropBase(base);
      bases.delete(id);
    }
    return;
  }
  if (data.kind === 'clash') {
    [checking, stopCheck] = [true, false];
    const extra = data.extra.map(({ ids, brep }) => [ids, new Solid(deserializeShape(brep) as Shape3D)] as const);
    const result = await clashes(new Map([...solids, ...extra.flatMap(([ids, solid]) => ids.map((id) => [id, solid] as const))]), data.ask, () => stopCheck);
    for (const [, solid] of extra) solid.delete();
    checking = false;
    later.splice(0).forEach(take);
    const transfer = [...result.hits, ...result.zones, ...result.sweeps].flatMap((m) => [m.vertices.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]);
    return postMessage({ kind: 'clash', id: data.id, result } satisfies Response, { transfer });
  }
  if (data.kind === 'share') {
    const by = new Map<Solid, string[]>();
    for (const id of data.bodies) {
      const solid = solids.get(id);
      if (solid) by.set(solid, [...(by.get(solid) ?? []), id]);
    }
    return postMessage({ kind: 'share', id: data.id, solids: [...by].map(([solid, ids]) => ({ ids, brep: solid.shape.serialize() })) } satisfies Response);
  }
  if (data.kind === 'measure') {
    const answers = data.asks.map((ask) => {
      const solid = solids.get(ask.body);
      try {
        return solid ? answer(solid, ask) : null;
      } catch {
        return null;
      }
    });
    return postMessage({ kind: 'measure', id: data.id, answers } satisfies Response);
  }
  if (data.kind === 'areas') {
    let areas: AreaMesh[] = [];
    try {
      areas = areasOf(data.shapes);
    } catch {
      // invalid shapes have no areas
    }
    return postMessage({ kind: 'areas', id: data.id, areas } satisfies Response, { transfer: areas.map((a) => a.tris.buffer) });
  }
  if (data.kind === 'check') {
    for (const b of data.bodies) await loadImports(b.features);
    const results = data.bodies.map(({ name, features, place }): PrintCheck => {
      let shape: Shape3D | undefined;
      try {
        shape = placeShape(buildBody(features), place);
        const check = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true, false, false);
        const sound = check.IsValid();
        check.delete();
        const [lo, hi] = shape.boundingBox.bounds;
        return { name, ...solidChecks(shape), sound, size: [0, 1, 2].map((k) => hi[k] - lo[k]) as V3 };
      } catch (e) {
        return { name, closed: false, manifold: false, sound: false, size: [0, 0, 0], error: (e as Error).message };
      } finally {
        shape?.delete();
      }
    });
    return postMessage({ kind: 'check', id: data.id, results } satisfies Response);
  }
  if (data.kind === 'laser') {
    for (const b of [...data.bodies, ...(data.around ?? [])]) await loadImports(b.features);
    const failed: string[] = [];
    return postMessage({ kind: 'laser', id: data.id, ...laserPieces(data.bodies, data.around, failed), failed } satisfies Response);
  }
  if (data.kind === 'legend') {
    for (const b of data.bodies) await loadImports(b.features);
    // anchors given in their body's coordinates
    const shapes = data.bodies.flatMap(({ features, place }) => {
      try {
        return [placeShape(buildBody(features), place)];
      } catch {
        return [];
      }
    });
    const anchors = data.anchors.map(({ n, body, at, dir }) => ({ n, at: placed(data.bodies[body].place, at), dir: placed(data.bodies[body].place, dir, true) }));
    const piece = keyPiece(shapes, anchors)[0] ?? null;
    for (const s of shapes) s.delete();
    return postMessage({ kind: 'legend', id: data.id, piece } satisfies Response);
  }
  if (data.kind === 'unwrap') {
    for (const b of data.bodies) await loadImports(b.features);
    const results = data.bodies.map(({ name, features }): Unwrapped => {
      let shape: Shape3D | undefined;
      try {
        shape = buildBody(features);
        return { name, ...unwrap(shape) };
      } catch (e) {
        return { name, pieces: [], stretch: 0, error: e instanceof Error ? e.message : `OpenCascade error ${e}` };
      } finally {
        shape?.delete();
      }
    });
    return postMessage({ kind: 'unwrap', id: data.id, results } satisfies Response);
  }
  if (data.kind === 'export') {
    for (const b of [...data.bodies, ...(data.around ?? [])]) await loadImports(b.features);
    const files: ExportFile[] = [];
    const failed: string[] = [];
    if (data.format === '3mf') {
      const parts: { name: string; points: number[]; triangles: number[] }[] = [];
      for (const { name, features, place } of data.bodies) {
        let shape: Shape3D | undefined;
        try {
          shape = placeShape(buildBody(features), place);
          parts.push({ name, ...printMesh(shape) });
        } catch {
          failed.push(name);
        } finally {
          shape?.delete();
        }
      }
      if (parts.length) files.push({ name: 'model', data: threeMf(parts).buffer as ArrayBuffer });
      return postMessage({ kind: 'export', id: data.id, files, failed } satisfies Response, { transfer: files.map((f) => f.data) });
    }
    if (data.format === 'step') {
      const parts: { shape: Shape3D; name: string; color: string }[] = [];
      for (const { name, color, features, place } of data.bodies)
        try {
          parts.push({ shape: placeShape(buildBody(features), place), name, color });
        } catch {
          failed.push(name);
        }
      if (parts.length) files.push({ name: 'model', data: await exportSTEP(parts, { unit: 'mm' }).arrayBuffer() });
      for (const p of parts) p.shape.delete();
      return postMessage({ kind: 'export', id: data.id, files, failed } satisfies Response, { transfer: files.map((f) => f.data) });
    }
    if (data.format === 'svg' || data.format === 'dxf') {
      const { pieces } = laserPieces(data.bodies, data.around, failed);
      if (pieces.length) {
        const sheet = sheetOf(pieces);
        const text = data.format === 'svg' ? sheetSvg(sheet) : dxfOf(sheet.flatMap((p) => p.cuts), sheet.flatMap((p) => [p.label, ...p.notes]));
        files.push({ name: 'sheet', data: new TextEncoder().encode(text).buffer as ArrayBuffer });
      }
      return postMessage({ kind: 'export', id: data.id, files, failed } satisfies Response, { transfer: files.map((f) => f.data) });
    }
    for (const { name, features, place } of data.bodies) {
      let shape;
      try {
        shape = placeShape(buildBody(features), place);
        files.push({ name, data: await (shape.blobSTL({ binary: true, ...PRINT }) as Blob).arrayBuffer() });
      } catch {
        failed.push(name);
      } finally {
        shape?.delete();
      }
    }
    return postMessage({ kind: 'export', id: data.id, files, failed } satisfies Response, { transfer: files.map((f) => f.data) });
  }
  // a long build shows as it goes: what is ready goes out every so often
  const { tolerance } = data;
  const start = performance.now();
  building++;
  let results: Built[] = [];
  let sent = performance.now();
  const send = (done: boolean) => {
    const transfer = results.flatMap((r) => ('mesh' in r ? Object.values(r.mesh).flatMap((a) => (ArrayBuffer.isView(a) ? [a.buffer as ArrayBuffer] : [])) : []));
    postMessage({ kind: 'build', results, done } satisfies Response, { transfer });
    results = [];
    sent = performance.now();
  };
  const build = ({ id, features }: Extract<Request, { kind: 'build' }>['bodies'][number]): BodyResult => {
    const finishing: Finishing = { bases: [], edges: [] };
    try {
      if (!bases.has(id)) bases.set(id, {});
      const shape = buildBody(features, finishing, bases.get(id));
      try {
        const mesh = { ...meshBody(shape, finishing, tolerance, false), cosmetic: cosmeticOf(features) };
        getOC().BRepTools.Clean(shape.wrapped, true);
        keepSolid(id, new Solid(shape));
        return { id, mesh };
      } catch (err) {
        shape.delete();
        throw err;
      }
    } catch (err) {
      return err instanceof FeatureError ? { id, error: err.message, featureId: err.featureId, max: err.max } : { id, error: String(err), featureId: '' };
    } finally {
      for (const b of finishing.bases) b.delete();
    }
  };
  // the same steps (linked copies: their source's) are built once: the others share its solid, and the client its mesh
  const made = new Map<string, string>();
  const keys = data.bodies.map((b) => stepsKey(b.features));
  const [seen, twice] = [new Set<string>(), new Set<string>()];
  for (const k of keys) (seen.has(k) ? twice : seen).add(k);
  // exact numbers still to work out: from a solid, for it and its twins (each with the solid it got)
  type Due = { solid: Solid; later: NonNullable<BodyMesh['later']>; to: { id: string; solid: Solid }[] };
  const due: Due[] = [];
  const dueOf = new Map<string, Due>();
  for (const [i, b] of data.bodies.entries()) {
    await loadImports(b.features);
    const key = keys[i];
    const twin = made.get(key);
    let result: Built;
    if (twin) {
      const solid = solids.get(twin);
      if (solid) keepSolid(b.id, solid);
      result = { id: b.id, twin };
      dueOf.get(key)?.to.push({ id: b.id, solid: solids.get(b.id)! });
    } else {
      result = build(b);
      if (twice.has(key)) made.set(key, b.id);
      if ('mesh' in result && result.mesh.later) {
        const d = { solid: solids.get(b.id)!, later: result.mesh.later, to: [{ id: b.id, solid: solids.get(b.id)! }] };
        due.push(d);
        if (twice.has(key)) dueOf.set(key, d);
      }
    }
    results.push(result);
    if (performance.now() - sent > 400) send(false);
  }
  send(true);
  [building, built] = [building - 1, performance.now()];
  // timings, only the latest kept: a mark 'exacts done' tells all of this and before is done
  performance.clearMeasures('build');
  performance.clearMarks('exacts done');
  performance.measure('build', { start });
  exacting++;
  // the exact numbers after all meshes (a change shows sooner), in steps; none for a body built again or gone meanwhile
  // (its solid replaced: dropped midway). A new build (the next lot, a drag's next step) goes first: these go on once
  // builds rested `exactsWait` ms, and let messages in every so often
  let exacts: { id: string; exact: Exact | null }[] = [];
  let [posted, paused] = [performance.now(), 0];
  for (const d of due) {
    const steps = exactSteps(d.solid.shape, d.later.faces, d.later.edges);
    let exact: Exact | null | undefined;
    for (let step; exact === undefined; ) {
      while (building || performance.now() - built < exactsWait || performance.now() - paused > 30) await new Promise((next) => setTimeout(next)), (paused = performance.now());
      if (solids.get(d.to[0].id) !== d.solid) break;
      if ((step = steps.next()).done) exact = step.value;
    }
    if (exact === undefined) continue;
    exacts.push(...d.to.filter((t) => solids.get(t.id) === t.solid).map((t) => ({ id: t.id, exact })));
    if (performance.now() - posted < 400) continue;
    postMessage({ kind: 'exact', results: exacts } satisfies Response);
    [exacts, posted] = [[], performance.now()];
  }
  if (exacts.length) postMessage({ kind: 'exact', results: exacts } satisfies Response);
  if (--exacting === 0) performance.mark('exacts done');
};
