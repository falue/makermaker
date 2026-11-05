import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import type { AreaMesh, BuildFeature } from './build';
import type { MeasureAnswer, MeasureAsk } from './measure';
import type { BodyResult, ExportBody, ExportFile, ExportFormat, PrintCheck, Request, Response } from './worker';

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
  private tolerance = 0.05;

  /** `onResults`: bodies as they get built, in several lots for a long build; `done`: the last lot of a send. */
  constructor(onResults: (results: BodyResult[], done: boolean) => void) {
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      if (data.kind !== 'build') {
        this.asked.get(data.id)?.(data);
        return this.asked.delete(data.id);
      }
      onResults(data.results, data.done);
      if (!data.done) return;
      this.busy = false;
      if (this.waiting.size) this.send([...this.waiting.values()]);
      this.waiting.clear();
      if (!this.busy) this.idlers.splice(0).forEach((done) => done());
    };
  }

  private idlers: (() => void)[] = [];
  /** When all that was sent is built. */
  idle() {
    return new Promise<void>((done) => (this.busy ? this.idlers.push(done) : done()));
  }

  /** How closely bodies are meshed for the view (mm); all build anew at the next `build`. */
  setTolerance(mm: number) {
    this.tolerance = mm;
    this.sent.clear();
  }

  /** The areas of overlapping shapes (see `areasOf`). */
  async areas(shapes: Resolved<Profile>[]): Promise<AreaMesh[]> {
    const answer = await this.ask({ kind: 'areas', id: this.nextAsk++, shapes });
    return answer.kind === 'areas' ? answer.areas : [];
  }

  /** The files of an export (see the worker's export), and the names of the bodies that could not be made. */
  async export(format: ExportFormat, bodies: ExportBody[]): Promise<{ files: ExportFile[]; failed: string[] }> {
    const answer = await this.ask({ kind: 'export', format, id: this.nextAsk++, bodies });
    return answer.kind === 'export' ? answer : { files: [], failed: [] };
  }

  /** For 3D printing: whether each body is closed, manifold and sound, and its size. */
  async check(bodies: ExportBody[]): Promise<PrintCheck[]> {
    const answer = await this.ask({ kind: 'check', id: this.nextAsk++, bodies });
    return answer.kind === 'check' ? answer.results : [];
  }

  /** What the real solids say (see `MeasureAsk`); null where a body has none, or no such part. */
  async measure(asks: MeasureAsk[]): Promise<MeasureAnswer[]> {
    const answer = await this.ask({ kind: 'measure', id: this.nextAsk++, asks });
    return answer.kind === 'measure' ? answer.answers : asks.map(() => null);
  }

  private ask(request: Extract<Request, { id: number }>): Promise<Response> {
    this.worker.postMessage(request);
    return new Promise((done) => this.asked.set(request.id, done));
  }

  build(bodies: { id: string; features: BuildFeature[] }[]) {
    const ids = new Set(bodies.map((p) => p.id));
    const gone = [...this.sent.keys()].filter((id) => !ids.has(id));
    for (const id of gone) this.sent.delete(id);
    if (gone.length) this.worker.postMessage({ kind: 'forget', bodies: gone } satisfies Request);
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
    this.worker.postMessage({ kind: 'build', bodies, tolerance: this.tolerance } satisfies Request);
  }
}
