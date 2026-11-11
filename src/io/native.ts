/** Native CAD files cadmpeg turns into STEP. */
export const NATIVE = ['.f3d', '.f3z', '.sldprt', '.catpart', '.ipt', '.iam', '.prt', '.3dm', '.igs', '.iges', '.sat', '.sab', '.smt', '.smb', '.fcstd', '.pvz', '.usd', '.usda', '.usdc', '.usdz'];

type Loss = { severity: 'warning' | 'error'; message: string };

let worker: Worker | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** A native CAD file as STEP text, with what did not come across; one at a time, in its own worker (loaded on first use). */
export function nativeToStep(f: File): Promise<{ step: string; losses: Loss[] }> {
  const run = queue.then(
    () =>
      new Promise<{ step: string; losses: Loss[] }>((done, fail) => {
        worker ??= new Worker(new URL('./cadmpegWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => ('error' in data ? fail(new Error(data.error)) : done(data));
        worker.onerror = (e) => fail(new Error(e.message || 'the converter stopped'));
        worker.postMessage(f);
      }),
  );
  queue = run.catch(() => {});
  return run;
}
