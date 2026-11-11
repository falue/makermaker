// Converts native CAD files to STEP with cadmpeg; a run blocks this thread until it is done.
import { convert, load } from 'cadmpeg.wasm';
import wasmUrl from 'cadmpeg.wasm/cadmpeg.wasm?url';

load(wasmUrl);

onmessage = async ({ data: f }: MessageEvent<File>) => {
  try {
    const { data, report } = await convert(f.name, new Uint8Array(await f.arrayBuffer()), 'step');
    const losses = [...report.decode_report.losses, ...report.export.losses].filter((l) => l.severity !== 'info');
    postMessage({ step: new TextDecoder().decode(data), losses });
  } catch (err) {
    postMessage({ error: (err as Error).message });
  }
};
