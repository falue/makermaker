// Times opening a design: dropped into the page, until the loader is gone and until all exact numbers are in (the
// geometry workers' 'exacts done' mark), the median of a few runs, per number of geometry workers (`?workers=N`;
// "auto": the app's own choice).
// With `npm run dev` running on port 5173: npx -p playwright node scripts/bench-open.mjs <file.mmk> [auto,1,2,4] [runs] [url]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { chromium } from 'playwright';

const [file, counts = 'auto,1,2,3,4', runs = '3', url = 'http://localhost:5173/'] = process.argv.slice(2);
if (!file) throw new Error('usage: bench-open.mjs <file.mmk> [auto,1,2,4] [runs] [url]');
const data = readFileSync(file).toString('base64');
const name = basename(file);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

/** Per geometry worker: when its exact numbers were all in (epoch ms), null while not. */
const exactsDone = (page) =>
  Promise.all(
    page.workers().map((w) =>
      w.evaluate(() => {
        const done = performance.getEntriesByName('exacts done').at(-1);
        const built = performance.getEntriesByName('build').length > 0;
        return built || done ? (done ? performance.timeOrigin + done.startTime : null) : undefined; // undefined: not a geometry worker
      }),
    ),
  ).then((all) => all.filter((t) => t !== undefined));

async function once(workers) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(workers === 'auto' ? url : `${url}?workers=${workers}`);
  await page.waitForTimeout(3000); // the start design builds
  const opening = `Opening ${name}`;
  const t0 = await page.evaluate(({ data, name }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name));
    dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 800, clientY: 500 }));
    return performance.timeOrigin + performance.now();
  }, { data, name });
  await page.waitForFunction((t) => document.body.innerText.includes(t), opening, { polling: 20 });
  await page.waitForFunction((t) => !document.body.innerText.includes(t), opening, { polling: 20, timeout: 600_000 });
  const open = Date.now() - t0;
  let ends = [];
  while (!(ends = await exactsDone(page)).length || ends.includes(null)) await page.waitForTimeout(200);
  const exact = Math.max(...ends) - t0;
  await page.close();
  return { open, exact, shards: ends.length };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(name);
for (const workers of counts.split(',')) {
  const all = [];
  for (let r = 0; r < +runs; r++) all.push(await once(workers));
  console.log(`workers ${workers.padEnd(4)} (${all[0].shards} running): loader gone ${s(median(all.map((x) => x.open)))}, exact numbers ${s(median(all.map((x) => x.exact)))}`);
}
await browser.close();
