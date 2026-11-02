import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import type { AreaMesh, BuildFeature } from './build';
import type { BodyResult, ExportFile, Request, Response } from './worker';

type BuildPart = Extract<Request, { kind: 'build' }>['bodies'][number];

/**
 * Sends bodies to the geometry worker, skipping bodies whose features did not change since the last send.
 * While a build runs, only the newest features per body wait, so fast edits (scrubbing) do not pile up.
 */
export class Kernel {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private sent = new Map<string, string>();
  private busy = false;
  private waiting = new Map<string, BuildPart>();
  /** Answers awaited from the worker, by request id. */
  private asked = new Map<number, (answer: Response) => void>();
  private nextAsk = 0;

  constructor(onResult: (r: BodyResult) => void) {
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      if (data.kind !== 'build') {
        this.asked.get(data.id)?.(data);
        return this.asked.delete(data.id);
      }
      data.results.forEach(onResult);
      this.busy = false;
      if (this.waiting.size) this.send([...this.waiting.values()]);
      this.waiting.clear();
    };
  }

  /** The areas of overlapping shapes (see `areasOf`). */
  async areas(shapes: Resolved<Profile>[]): Promise<AreaMesh[]> {
    const answer = await this.ask({ kind: 'areas', id: this.nextAsk++, shapes });
    return answer.kind === 'areas' ? answer.areas : [];
  }

  /** One file per body (see the worker's export), and the names of those that could not be made. */
  async export(format: 'stl' | 'svg' | 'step', bodies: Extract<Request, { kind: 'export' }>['bodies']): Promise<{ files: ExportFile[]; failed: string[] }> {
    const answer = await this.ask({ kind: 'export', format, id: this.nextAsk++, bodies });
    return answer.kind === 'export' ? answer : { files: [], failed: [] };
  }

  private ask(request: Extract<Request, { id: number }>): Promise<Response> {
    this.worker.postMessage(request);
    return new Promise((done) => this.asked.set(request.id, done));
  }

  build(bodies: { id: string; features: BuildFeature[] }[]) {
    const ids = new Set(bodies.map((p) => p.id));
    for (const id of this.sent.keys()) if (!ids.has(id)) this.sent.delete(id);
    for (const id of this.waiting.keys()) if (!ids.has(id)) this.waiting.delete(id);
    const changed = bodies.filter((p) => {
      const key = JSON.stringify(p.features, (k, v) => (k === 'data' ? undefined : v)); // a STEP file's text never changes (megabytes)
      if (this.sent.get(p.id) === key) return false;
      this.sent.set(p.id, key);
      return true;
    });
    if (!changed.length) return;
    if (this.busy) for (const p of changed) this.waiting.set(p.id, p);
    else this.send(changed);
  }

  private send(bodies: BuildPart[]) {
    this.busy = true;
    this.worker.postMessage({ kind: 'build', bodies } satisfies Request);
  }
}
