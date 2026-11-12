import type { Resolved } from '../doc/resolve';
import type { Profile } from '../doc/types';
import type { AreaMesh, BuildFeature } from './build';
import type { ClashAsk, ClashResult } from './clash';
import type { Exact } from './exact';
import type { MeasureAnswer, MeasureAsk } from './measure';
import type { Cut } from '../io/cutfile';
import type { BodyResult, ExportBody, ExportFile, ExportFormat, PrintCheck, Request, Response, Unfolded } from './worker';
import { stepsKey } from './key';

type BuildPart = Extract<Request, { kind: 'build' }>['bodies'][number];
/** A geometry worker, the bodies it builds now, and its results so far (a linked copy takes its source's). */
type Shard = { worker: Worker; building: Set<string>; built: Map<string, BodyResult> };

/** The size of the STEP files in a body's steps (reading them takes most of a STEP body's build). */
const stepSize = (features: BuildFeature[]): number =>
  features.reduce((n, f) => n + (f.type === 'step' ? f.data.length : f.type === 'boolean' || f.type === 'fingers' ? stepSize(f.features) : 0), 0);

/**
 * Builds bodies in several geometry workers, skipping bodies whose features did not change since the last send. Each
 * body is kept by the worker that built it (its solid, for measuring; its earlier steps, for a quick rebuild) and goes
 * back there; new ones go to any free worker, the biggest first. While a body is built, only its newest features wait,
 * so fast edits (scrubbing) do not pile up.
 */
export class Kernel {
  /** `?workers=N`: exactly N workers (to compare, see scripts/bench-open.mjs). */
  private readonly fixed = Number(new URLSearchParams(location.search).get('workers')) || 0;
  /** Workers from the start; at most (one core left for the page), started once this many bodies wait. */
  private readonly least = this.fixed || 2;
  private readonly most = this.fixed || Math.min(Math.max((navigator.hardwareConcurrency || 2) - 1, 2), 4);
  private readonly growAt = 8;
  private shards: Shard[] = [];
  private owner = new Map<string, Shard>();
  private sent = new Map<string, string>();
  private waiting = new Map<string, BuildPart>();
  /** Answers awaited from the workers, by request id. */
  private asked = new Map<number, (answer: Response) => void>();
  private nextAsk = 0;
  private tolerance = 0.05;
  private idlers: (() => void)[] = [];
  /** Clash checks asked for, and the last one stopped. */
  private clashRun = 0;
  private clashStop = 0;
  private onResults: (results: BodyResult[], done: boolean) => void;
  private onExact: (results: { id: string; exact: Exact | null }[]) => void;

  /**
   * `onResults`: bodies as they get built, in several lots for a long build; `done`: the last lot, with nothing waiting
   * to be sent after it. `onExact`: their exact numbers, shortly after (none for a body built again meanwhile).
   */
  constructor(onResults: (results: BodyResult[], done: boolean) => void, onExact: (results: { id: string; exact: Exact | null }[]) => void) {
    this.onResults = onResults;
    this.onExact = onExact;
    while (this.shards.length < this.least) this.spawn();
  }

  private spawn() {
    const shard: Shard = { worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), building: new Set(), built: new Map() };
    shard.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      if (data.kind === 'exact') return this.onExact(data.results);
      if (data.kind !== 'build') {
        this.asked.get(data.id)?.(data);
        return this.asked.delete(data.id);
      }
      // a linked copy's result is its source's, the same mesh (the view shares it)
      const results = data.results.map((r) => {
        const full = 'twin' in r ? { ...shard.built.get(r.twin)!, id: r.id } : r;
        shard.built.set(r.id, full);
        return full;
      });
      if (data.done) {
        shard.building.clear();
        shard.built.clear();
        this.pump();
      }
      const done = data.done && !this.busy();
      this.onResults(results, done);
      if (done) this.idlers.splice(0).forEach((go) => go());
    };
    this.shards.push(shard);
  }

  private busy() {
    return this.waiting.size > 0 || this.shards.some((s) => s.building.size);
  }

  /** When all that was sent is built. */
  idle() {
    return new Promise<void>((done) => (this.busy() ? this.idlers.push(done) : done()));
  }

  /** How closely bodies are meshed for the view (mm); all build anew at the next `build`. */
  setTolerance(mm: number) {
    this.tolerance = mm;
    this.sent.clear();
  }

  /** The areas of overlapping shapes (see `areasOf`). */
  async areas(shapes: Resolved<Profile>[]): Promise<AreaMesh[]> {
    const answer = await this.ask(this.shards[0], { kind: 'areas', id: this.nextAsk++, shapes });
    return answer.kind === 'areas' ? answer.areas : [];
  }

  /**
   * The files of an export (see the worker's export), and the names of the bodies that could not be made. Exports and
   * checks build anew, all in the first worker: STEP files the other workers read, it reads again (once). `around`:
   * bodies a laser cut must stay out of besides `bodies`.
   */
  async export(format: ExportFormat, bodies: ExportBody[], around: Pick<ExportBody, 'features' | 'place'>[] = []): Promise<{ files: ExportFile[]; failed: string[] }> {
    const answer = await this.ask(this.shards[0], { kind: 'export', format, id: this.nextAsk++, bodies, around });
    return answer.kind === 'export' ? answer : { files: [], failed: [] };
  }

  /** The laser pieces of `bodies`, as an export would cut them (see the worker's `laserPieces`): for a preview. */
  async laser(bodies: ExportBody[], around: Pick<ExportBody, 'features' | 'place'>[] = []): Promise<{ pieces: { name: string; cuts: Cut[] }[]; failed: string[] }> {
    const answer = await this.ask(this.shards[0], { kind: 'laser', id: this.nextAsk++, bodies, around });
    return answer.kind === 'laser' ? answer : { pieces: [], failed: [] };
  }

  /** Each body unfolded into flat nets (see the worker's `unfold`). */
  async unfold(bodies: Pick<ExportBody, 'name' | 'features'>[]): Promise<Unfolded[]> {
    const answer = await this.ask(this.shards[0], { kind: 'unfold', id: this.nextAsk++, bodies });
    return answer.kind === 'unfold' ? answer.results : [];
  }

  /** For 3D printing: whether each body is closed, manifold and sound, and its size. */
  async check(bodies: ExportBody[]): Promise<PrintCheck[]> {
    const answer = await this.ask(this.shards[0], { kind: 'check', id: this.nextAsk++, bodies });
    return answer.kind === 'check' ? answer.results : [];
  }

  /** What the real solids say (see `MeasureAsk`); null where a body has none, or no such part. Each worker answers for its own. */
  async measure(asks: MeasureAsk[]): Promise<MeasureAnswer[]> {
    const out: MeasureAnswer[] = asks.map(() => null);
    const by = new Map<Shard, number[]>();
    asks.forEach((a, i) => {
      const s = this.owner.get(a.body);
      if (s) by.set(s, [...(by.get(s) ?? []), i]);
    });
    await Promise.all(
      [...by].map(async ([s, at]) => {
        const answer = await this.ask(s, { kind: 'measure', id: this.nextAsk++, asks: at.map((i) => asks[i]) });
        if (answer.kind === 'measure') at.forEach((i, k) => (out[i] = answer.answers[k]));
      }),
    );
    return out;
  }

  /** Overlaps and clearances of the bodies (see `ClashAsk`): in the worker that keeps most of them, the others' solids copied there. */
  async clash(ask: ClashAsk): Promise<ClashResult> {
    const run = ++this.clashRun;
    const by = new Map<Shard, string[]>();
    for (const { id } of ask.bodies) {
      const s = this.owner.get(id);
      if (s) by.set(s, [...(by.get(s) ?? []), id]);
    }
    const home = [...by].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? this.shards[0];
    const copies = await Promise.all([...by].filter(([s]) => s !== home).map(([s, bodies]) => this.ask(s, { kind: 'share', id: this.nextAsk++, bodies })));
    if (this.clashStop >= run) return { hits: [], zones: [], sweeps: [], failed: [], stopped: true }; // stopped while copying
    const extra = copies.flatMap((c) => (c.kind === 'share' ? c.solids : []));
    const answer = await this.ask(home, { kind: 'clash', id: this.nextAsk++, ask, extra });
    return answer.kind === 'clash' ? answer.result : { hits: [], zones: [], sweeps: [], failed: [] };
  }

  /** Ends a check under way: it answers with what it found so far. */
  stopClash() {
    this.clashStop = this.clashRun;
    for (const s of this.shards) s.worker.postMessage({ kind: 'stopClash' } satisfies Request);
  }

  private ask(shard: Shard, request: Extract<Request, { id: number }>): Promise<Response> {
    shard.worker.postMessage(request);
    return new Promise((done) => this.asked.set(request.id, done));
  }

  build(bodies: { id: string; features: BuildFeature[] }[]) {
    const ids = new Set(bodies.map((p) => p.id));
    const gone = new Map<Shard, string[]>();
    for (const id of this.sent.keys()) {
      if (ids.has(id)) continue;
      this.sent.delete(id);
      const s = this.owner.get(id);
      if (s) gone.set(s, [...(gone.get(s) ?? []), id]);
      this.owner.delete(id);
    }
    for (const [s, list] of gone) s.worker.postMessage({ kind: 'forget', bodies: list } satisfies Request);
    for (const id of this.waiting.keys()) if (!ids.has(id)) this.waiting.delete(id);
    for (const p of bodies) {
      const key = stepsKey(p.features);
      if (this.sent.get(p.id) === key) continue;
      this.sent.set(p.id, key);
      this.waiting.set(p.id, p);
    }
    this.pump();
  }

  /**
   * Hands waiting bodies to free workers, never one still being built: a worker takes what it keeps (it read their
   * STEP files already), then new bodies, the biggest first, in lots of about a quarter of each one's share. Bodies
   * with the same steps (linked copies) go together: the worker builds them once (one kept elsewhere moves along).
   */
  private pump() {
    const units = new Map<string, BuildPart[]>();
    for (const p of this.waiting.values()) {
      if (this.shards.some((s) => s.building.has(p.id))) continue;
      const key = this.sent.get(p.id) ?? '';
      units.set(key, [...(units.get(key) ?? []), p]);
    }
    if (!units.size) return;
    if (this.waiting.size >= this.growAt) while (this.shards.length < this.most) this.spawn();
    // the size of its steps (without STEP text) and of its STEP files: roughly what it takes to build
    const queue = [...units].map(([key, parts]) => ({ parts, cost: key.length + stepSize(parts[0].features) })).sort((a, b) => b.cost - a.cost);
    const lot = queue.reduce((n, u) => n + u.cost, 0) / (this.shards.length * 4);
    for (const shard of this.shards.filter((s) => !s.building.size)) {
      const kept = (u: (typeof queue)[number]) => u.parts.some((p) => this.owner.get(p.id) === shard);
      const take = [...queue.filter(kept), ...queue.filter((u) => u.parts.every((p) => !this.owner.has(p.id)))];
      const parts: BuildPart[] = [];
      let cost = 0;
      for (const u of take) {
        if (parts.length && cost + u.cost > lot) break;
        parts.push(...u.parts);
        cost += u.cost;
        queue.splice(queue.indexOf(u), 1);
      }
      if (!parts.length) continue;
      const moved = new Map<Shard, string[]>();
      for (const { id } of parts) {
        const old = this.owner.get(id);
        if (old && old !== shard) moved.set(old, [...(moved.get(old) ?? []), id]);
        this.owner.set(id, shard);
        shard.building.add(id);
        this.waiting.delete(id);
      }
      for (const [s, ids] of moved) s.worker.postMessage({ kind: 'forget', bodies: ids } satisfies Request);
      shard.worker.postMessage({ kind: 'build', bodies: parts, tolerance: this.tolerance } satisfies Request);
    }
  }
}
