/* Chooser card thumbnails: hero-1.png (~1 MB each) -> hero-thumb.webp at card
   width. Uses the Chrome already driving the harnesses, so no image dependency
   enters the repo. Rerun after refreshing any hero.
   usage: node tools/make-thumbs.mjs [width]   (default 640) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = +(process.argv[2] || 640);
const coursesDir = path.join(ROOT, 'apps/golf/public/courses');

const heroes = fs.readdirSync(coursesDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => path.join(coursesDir, d.name, 'hero-1.png'))
  .filter(f => fs.existsSync(f));
if (!heroes.length) { console.error('no hero-1.png files found'); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const hero of heroes) {
  const png = fs.readFileSync(hero);
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  const webpB64 = await page.evaluate(async ([src, w]) => {
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = src; });
    const scale = Math.min(1, w / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.82).split(',')[1];
  }, [dataUrl, WIDTH]);
  const out = path.join(path.dirname(hero), 'hero-thumb.webp');
  fs.writeFileSync(out, Buffer.from(webpB64, 'base64'));
  const kb = n => (fs.statSync(n).size / 1024).toFixed(0);
  console.log(`${path.relative(ROOT, out)}  ${kb(hero)} kB -> ${kb(out)} kB`);
}
await browser.close();
