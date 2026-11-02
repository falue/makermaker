import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { exportSTEP, setOC, type Shape3D } from 'replicad';
import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import type { Place } from '../doc/frames';
import { laserSvg } from './laser';
import { areasOf, buildBody, loadImports, meshBody, placeShape, FeatureError, type AreaMesh, type BuildFeature, type BodyMesh, type Finishing } from './build';

/**
 * export: one file per body: stl (binary, placed in the world) or svg (laser outline of its biggest flat face); step:
 * one file with every body as a named, coloured part, placed in the world.
 */
export type ExportFile = { name: string; data: ArrayBuffer };
export type Request =
  | { kind: 'build'; bodies: { id: string; features: BuildFeature[] }[] }
  | { kind: 'areas'; id: number; shapes: Resolved<Profile>[] }
  | { kind: 'export'; format: 'stl' | 'svg' | 'step'; id: number; bodies: { name: string; color: string; features: BuildFeature[]; place: Place }[] };
export type BodyResult = { id: string; mesh: BodyMesh } | { id: string; error: string; featureId: string; max?: number };
export type Response = { kind: 'build'; results: BodyResult[] } | { kind: 'areas'; id: number; areas: AreaMesh[] } | { kind: 'export'; id: number; files: ExportFile[]; failed: string[] };

const ready = init({ locateFile: () => wasmUrl }).then(setOC);

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  await ready;
  if (data.kind === 'areas') {
    let areas: AreaMesh[] = [];
    try {
      areas = areasOf(data.shapes);
    } catch {
      // invalid shapes have no areas
    }
    return postMessage({ kind: 'areas', id: data.id, areas } satisfies Response, { transfer: areas.map((a) => a.tris.buffer) });
  }
  if (data.kind === 'export') {
    for (const b of data.bodies) await loadImports(b.features);
    const files: ExportFile[] = [];
    const failed: string[] = [];
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
    for (const { name, features, place } of data.bodies) {
      if (data.format === 'svg') {
        try {
          files.push({ name, data: new TextEncoder().encode(laserSvg(features)).buffer as ArrayBuffer });
        } catch {
          failed.push(name);
        }
        continue;
      }
      let shape;
      try {
        shape = placeShape(buildBody(features), place);
        files.push({ name, data: await (shape.blobSTL({ binary: true, tolerance: 0.01, angularTolerance: 0.1 }) as Blob).arrayBuffer() });
      } catch {
        failed.push(name);
      } finally {
        shape?.delete();
      }
    }
    return postMessage({ kind: 'export', id: data.id, files, failed } satisfies Response, { transfer: files.map((f) => f.data) });
  }
  for (const b of data.bodies) await loadImports(b.features);
  const results = data.bodies.map(({ id, features }): BodyResult => {
    try {
      const finishing: Finishing = { base: null, edges: [] };
      const shape = buildBody(features, finishing);
      try {
        return { id, mesh: meshBody(shape, finishing) };
      } finally {
        shape.delete();
        finishing.base?.delete();
      }
    } catch (err) {
      return err instanceof FeatureError ? { id, error: err.message, featureId: err.featureId, max: err.max } : { id, error: String(err), featureId: '' };
    }
  });
  const transfer = results.flatMap((r) => ('mesh' in r ? Object.values(r.mesh).flatMap((a) => (ArrayBuffer.isView(a) ? [a.buffer] : [])) : []));
  postMessage({ kind: 'build', results } satisfies Response, { transfer });
};
