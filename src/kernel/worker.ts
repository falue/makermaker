import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import { areasOf, buildPart, meshPart, StepError, type AreaMesh, type BuildStep, type PartMesh } from './build';

export type Request = { kind: 'build'; parts: { id: string; steps: BuildStep[] }[] } | { kind: 'areas'; id: number; shapes: Resolved<Profile>[] };
export type PartResult = { id: string; mesh: PartMesh } | { id: string; error: string; stepId: string };
export type Response = { kind: 'build'; results: PartResult[] } | { kind: 'areas'; id: number; areas: AreaMesh[] };

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
  const results = data.parts.map(({ id, steps }): PartResult => {
    try {
      const shape = buildPart(steps);
      try {
        return { id, mesh: meshPart(shape) };
      } finally {
        shape.delete();
      }
    } catch (err) {
      return err instanceof StepError ? { id, error: err.message, stepId: err.stepId } : { id, error: String(err), stepId: '' };
    }
  });
  const transfer = results.flatMap((r) => ('mesh' in r ? Object.values(r.mesh).map((a) => a.buffer) : []));
  postMessage({ kind: 'build', results } satisfies Response, { transfer });
};
