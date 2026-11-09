import { zipSync, strToU8 } from 'fflate';
import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { exportSTEP, getOC, setOC, type Shape3D } from 'replicad';
import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import type { Place } from '../doc/frames';
import { dxfOf, svgOf } from '../io/cutfile';
import { laserCuts, withKerf } from './laser';
import { clashes, type ClashAsk, type ClashResult } from './clash';
import { answer, Solid, type MeasureAnswer, type MeasureAsk } from './measure';
import { exactOf, type Exact } from './exact';
import { areasOf, buildBody, cosmeticOf, dropBase, loadImports, meshBody, placeShape, FeatureError, type AreaMesh, type BaseCache, type BuildFeature, type BodyMesh, type Finishing } from './build';
import { solidChecks } from './exact';

/**
 * export: one file per body: stl (binary, placed in the world) or svg / dxf (laser cuts of a flat face: `face`, else
 * its biggest; `kerf` allowed for); step and 3mf: one file with every body as a named part, placed in the world.
 * check: for 3D printing, whether each body is closed, manifold and sound, and its size.
 */
export type ExportFile = { name: string; data: ArrayBuffer };
export type ExportFormat = 'stl' | '3mf' | 'svg' | 'dxf' | 'step';
export type ExportBody = { name: string; color: string; features: BuildFeature[]; place: Place; face?: { at: V3; n: V3 }; kerf?: number };
export type PrintCheck = { name: string; closed: boolean; manifold: boolean; sound: boolean; size: V3; error?: string };
type V3 = [number, number, number];
export type Request =
  | { kind: 'build'; bodies: { id: string; features: BuildFeature[] }[]; tolerance: number }
  | { kind: 'areas'; id: number; shapes: Resolved<Profile>[] }
  | { kind: 'export'; format: ExportFormat; id: number; bodies: ExportBody[] }
  | { kind: 'check'; id: number; bodies: ExportBody[] }
  | { kind: 'measure'; id: number; asks: MeasureAsk[] }
  | { kind: 'clash'; id: number; ask: ClashAsk }
  | { kind: 'stopClash' }
  | { kind: 'forget'; bodies: string[] };
export type BodyResult = { id: string; mesh: BodyMesh } | { id: string; error: string; featureId: string; max?: number };
export type Response =
  | { kind: 'build'; results: BodyResult[]; done: boolean }
  | { kind: 'areas'; id: number; areas: AreaMesh[] }
  | { kind: 'export'; id: number; files: ExportFile[]; failed: string[] }
  | { kind: 'check'; id: number; results: PrintCheck[] }
  | { kind: 'measure'; id: number; answers: MeasureAnswer[] }
  | { kind: 'clash'; id: number; result: ClashResult }
  | { kind: 'exact'; results: { id: string; exact: Exact | null }[] };

const PRINT = { tolerance: 0.01, angularTolerance: 0.1 };

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

/** The last good solid of each body, for measuring (without its mesh: the view has that). */
const solids = new Map<string, Solid>();
/** Each body's solid before its last steps (see `BaseCache`). */
const bases = new Map<string, BaseCache>();

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
      solids.get(id)?.delete();
      solids.delete(id);
      const base = bases.get(id);
      if (base) dropBase(base);
      bases.delete(id);
    }
    return;
  }
  if (data.kind === 'clash') {
    [checking, stopCheck] = [true, false];
    const result = await clashes(solids, data.ask, () => stopCheck);
    checking = false;
    later.splice(0).forEach(take);
    const transfer = [...result.hits, ...result.zones, ...result.sweeps].flatMap((m) => [m.vertices.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]);
    return postMessage({ kind: 'clash', id: data.id, result } satisfies Response, { transfer });
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
  if (data.kind === 'export') {
    for (const b of data.bodies) await loadImports(b.features);
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
    for (const { name, features, place, face, kerf } of data.bodies) {
      if (data.format === 'svg' || data.format === 'dxf') {
        try {
          const cuts = withKerf(laserCuts(features, face), kerf ?? 0);
          files.push({ name, data: new TextEncoder().encode(data.format === 'svg' ? svgOf(cuts) : dxfOf(cuts)).buffer as ArrayBuffer });
        } catch (e) {
          failed.push(`${name} (${e instanceof Error ? e.message : `OpenCascade error ${e}`})`);
        }
        continue;
      }
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
  let results: BodyResult[] = [];
  let sent = performance.now();
  const send = (done: boolean) => {
    const transfer = results.flatMap((r) => ('mesh' in r ? Object.values(r.mesh).flatMap((a) => (ArrayBuffer.isView(a) ? [a.buffer as ArrayBuffer] : [])) : []));
    postMessage({ kind: 'build', results, done } satisfies Response, { transfer });
    results = [];
    sent = performance.now();
  };
  const build = ({ id, features }: Extract<Request, { kind: 'build' }>['bodies'][number]): BodyResult => {
    try {
      const finishing: Finishing = { base: null, edges: [] };
      if (!bases.has(id)) bases.set(id, {});
      const shape = buildBody(features, finishing, bases.get(id));
      try {
        const mesh = { ...meshBody(shape, finishing, tolerance, false), cosmetic: cosmeticOf(features) };
        getOC().BRepTools.Clean(shape.wrapped, true);
        solids.get(id)?.delete();
        solids.set(id, new Solid(shape));
        return { id, mesh };
      } catch (err) {
        shape.delete();
        throw err;
      } finally {
        finishing.base?.delete();
      }
    } catch (err) {
      return err instanceof FeatureError ? { id, error: err.message, featureId: err.featureId, max: err.max } : { id, error: String(err), featureId: '' };
    }
  };
  // the same steps (linked copies: their source's) are built once: the others get a copy of its mesh and solid
  const made = new Map<string, { id: string; result: BodyResult }>();
  const keys = data.bodies.map((b) => JSON.stringify(b.features, (k, v) => (k === 'data' ? undefined : v)));
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
    const solid = twin && solids.get(twin.id);
    if (twin && solid) {
      solids.get(b.id)?.delete();
      solids.set(b.id, new Solid(solid.shape.clone()));
    }
    const result = twin && (solid || 'error' in twin.result) ? { ...structuredClone(twin.result), id: b.id } : build(b);
    // kept before it is sent: sending hands its arrays over
    if (!twin && twice.has(key)) made.set(key, { id: b.id, result: structuredClone(result) });
    if ('mesh' in result && result.mesh.later) {
      const own = { id: b.id, solid: solids.get(b.id)! };
      const group = twin && dueOf.get(key);
      if (group) group.to.push(own);
      else {
        const d = { solid: own.solid, later: result.mesh.later, to: [own] };
        due.push(d);
        if (twice.has(key)) dueOf.set(key, d);
      }
    }
    results.push(result);
    if (performance.now() - sent > 400) send(false);
  }
  send(true);
  // the exact numbers after all meshes (a change shows sooner); none for a body built again or gone meanwhile (its
  // solid replaced): a new build gets in between, as the worker lets messages in every so often
  let exacts: { id: string; exact: Exact | null }[] = [];
  await new Promise((next) => setTimeout(next, 60)); // a drag's next build gets in first: these wait till it rests
  let [posted, paused] = [performance.now(), performance.now()];
  for (const d of due) {
    if (performance.now() - paused > 30) await new Promise((next) => setTimeout(next)), (paused = performance.now());
    if (solids.get(d.to[0].id) !== d.solid) continue;
    const exact = exactOf(d.solid.shape, d.later.faces, d.later.edges);
    exacts.push(...d.to.filter((t) => solids.get(t.id) === t.solid).map((t) => ({ id: t.id, exact })));
    if (performance.now() - posted < 400) continue;
    postMessage({ kind: 'exact', results: exacts } satisfies Response);
    [exacts, posted] = [[], performance.now()];
  }
  if (exacts.length) postMessage({ kind: 'exact', results: exacts } satisfies Response);
};
