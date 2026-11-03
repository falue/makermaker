// Renders the pictures of the standard materials into src/ui/material-previews (they are committed).
// With `npm run dev` running on port 5173: npx -p playwright node scripts/render-material-previews.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const url = process.argv[2] ?? 'http://localhost:5173/';
await page.goto(url);
await page.waitForTimeout(5000);
const ids = await page.evaluate(async () => (await import('/src/doc/materials.ts')).STANDARD_MATERIALS.map((m) => m.id));

// A fresh page per picture: after a few long ones in a row the graphics context gets lost, and pictures come out black.
const render = async (id) => {
  await page.goto(url);
  await page.waitForTimeout(3000);
  return page.evaluate(async (id) => {
    const [{ MaterialPreview }, m] = await Promise.all([import('/src/viewer/preview.ts'), import('/src/doc/materials.ts')]);
    const preview = new MaterialPreview();
    const url = await preview.thumbnail(m.toLook(m.STANDARD_MATERIALS.find((x) => x.id === id)), m.DEFAULT_LIGHT, { width: 640, samples: 250, scale: 1, quality: 0.86 });
    preview.dispose();
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 24 });
    const g = canvas.getContext('2d');
    g.drawImage(image, 0, 0, 32, 24);
    const { data } = g.getImageData(0, 0, 32, 24);
    return { url, brightness: data.reduce((sum, v, i) => (i % 4 === 3 ? sum : sum + v), 0) / ((data.length / 4) * 3) };
  }, id);
};

// all written at the end: a file landing in src/ reloads every page of the dev server, open designs too
const pictures = new Map();
for (const id of ids) {
  let picture = await render(id);
  for (let tries = 0; picture.brightness < 5 && tries < 3; tries++) picture = await render(id);
  if (picture.brightness < 5) throw new Error(`${id} came out black`);
  pictures.set(id, picture.url);
  console.log(id, Math.round(picture.brightness));
}
for (const [id, picture] of pictures) writeFileSync(new URL(`../src/ui/material-previews/${id}.jpg`, import.meta.url), Buffer.from(picture.split(',')[1], 'base64'));
await browser.close();
