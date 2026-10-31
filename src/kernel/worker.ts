import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import { areasOf, buildBody, meshBody, FeatureError, type AreaMesh, type BuildFeature, type BodyMesh } from './build';

export type Request = { kind: 'build'; bodies: { id: string; features: BuildFeature[] }[] } | { kind: 'areas'; id: number; shapes: Resolved<Profile>[] };
export type BodyResult = { id: string; mesh: BodyMesh } | { id: string; error: string; featureId: string };
export type Response = { kind: 'build'; results: BodyResult[] } | { kind: 'areas'; id: number; areas: AreaMesh[] };

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
  const results = data.bodies.map(({ id, features }): BodyResult => {
    try {
      const shape = buildBody(features);
      try {
        return { id, mesh: meshBody(shape) };
      } finally {
        shape.delete();
      }
    } catch (err) {
      return err instanceof FeatureError ? { id, error: err.message, featureId: err.featureId } : { id, error: String(err), featureId: '' };
    }
  });
  const transfer = results.flatMap((r) => ('mesh' in r ? Object.values(r.mesh).map((a) => a.buffer) : []));
  postMessage({ kind: 'build', results } satisfies Response, { transfer });
};
