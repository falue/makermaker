import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { importSTEP, setOC } from 'replicad';
import { beforeAll, expect, it } from 'vitest';

beforeAll(async () => setOC(await init({ wasmBinary: readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm')) })), 60_000);

it('reads a STEP cube in mm', async () => {
  const shape = await importSTEP(new Blob([readFileSync(new URL('../io/fixtures/cube50.step', import.meta.url))]));
  const box = shape.boundingBox;
  expect([box.width, box.height, box.depth].map((v) => Math.round(v * 1000) / 1000)).toEqual([50, 50, 50]);
  shape.delete();
});
