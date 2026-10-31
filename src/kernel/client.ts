import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import type { AreaMesh, BuildStep } from './build';
import type { PartResult, Request, Response } from './worker';

type BuildPart = Extract<Request, { kind: 'build' }>['parts'][number];

/**
 * Sends parts to the geometry worker, skipping parts whose steps did not change since the last send.
 * While a build runs, only the newest steps per part wait, so fast edits (scrubbing) do not pile up.
 */
export class Kernel {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private sent = new Map<string, string>();
  private busy = false;
  private waiting = new Map<string, BuildPart>();
  private asked = new Map<number, (areas: AreaMesh[]) => void>();
  private nextAsk = 0;

  constructor(onResult: (r: PartResult) => void) {
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      if (data.kind === 'areas') {
        this.asked.get(data.id)?.(data.areas);
        return this.asked.delete(data.id);
      }
      data.results.forEach(onResult);
      this.busy = false;
      if (this.waiting.size) this.send([...this.waiting.values()]);
      this.waiting.clear();
    };
  }

  /** The areas of overlapping shapes (see `areasOf`). */
  areas(shapes: Resolved<Profile>[]): Promise<AreaMesh[]> {
    const id = this.nextAsk++;
    this.worker.postMessage({ kind: 'areas', id, shapes } satisfies Request);
    return new Promise((done) => this.asked.set(id, done));
  }

  build(parts: { id: string; steps: BuildStep[] }[]) {
    const ids = new Set(parts.map((p) => p.id));
    for (const id of this.sent.keys()) if (!ids.has(id)) this.sent.delete(id);
    for (const id of this.waiting.keys()) if (!ids.has(id)) this.waiting.delete(id);
    const changed = parts.filter((p) => {
      const key = JSON.stringify(p.steps);
      if (this.sent.get(p.id) === key) return false;
      this.sent.set(p.id, key);
      return true;
    });
    if (!changed.length) return;
    if (this.busy) for (const p of changed) this.waiting.set(p.id, p);
    else this.send(changed);
  }

  private send(parts: BuildPart[]) {
    this.busy = true;
    this.worker.postMessage({ kind: 'build', parts } satisfies Request);
  }
}
