import type { BuildStep } from './build';
import type { BuildRequest, PartResult } from './worker';

/** Sends parts to the geometry worker, skipping parts whose steps did not change since the last send. */
export class Kernel {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private sent = new Map<string, string>();

  constructor(onResult: (r: PartResult) => void) {
    this.worker.onmessage = ({ data }: MessageEvent<PartResult[]>) => data.forEach(onResult);
  }

  build(parts: { id: string; steps: BuildStep[] }[]) {
    const ids = new Set(parts.map((p) => p.id));
    for (const id of this.sent.keys()) if (!ids.has(id)) this.sent.delete(id);
    const changed = parts.filter((p) => {
      const key = JSON.stringify(p.steps);
      if (this.sent.get(p.id) === key) return false;
      this.sent.set(p.id, key);
      return true;
    });
    if (changed.length) this.worker.postMessage({ parts: changed } satisfies BuildRequest);
  }
}
