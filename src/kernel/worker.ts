import init from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import { buildPart, meshPart, StepError, type BuildStep, type PartMesh } from './build';

export interface BuildRequest {
  parts: { id: string; steps: BuildStep[] }[];
}
export type PartResult = { id: string; mesh: PartMesh } | { id: string; error: string; stepId: string };

const ready = init({ locateFile: () => wasmUrl }).then(setOC);

self.onmessage = async ({ data }: MessageEvent<BuildRequest>) => {
  await ready;
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
  postMessage(results, { transfer });
};
