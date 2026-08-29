/* Does the app boot every course in the manifest, and is each one the right
   course? Exits non-zero on any failure.

   usage: node tools/check-app.mjs [baseUrl]     (default http://127.0.0.1:8620)

   Per course, through the app's whole path -- manifest, pack fetch, integrity
   hash, decode, boot -- this asserts what check3d asserts for the pages:
     - the card the engine holds matches the build's card.json value for value
       (par, index, every tee distance -- the 90-144 values per course);
     - the HUD tee row shows the manifest's tee names, all of them;
     - the header names the course;
     - the deep-link grammar wrote ?bana= for non-default courses;
     - no page errors, and the frame is a picture (luminance gates).           */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8620';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--force-device-scale-factor=1'],
});

for (const c of manifest.courses) {
  console.log(`\n${c.slug}`);
  try {
    await checkCourse(c);
  } catch (e) {
    gate(false, `course check crashed: ${String(e).split('\n')[0].slice(0, 140)}`);
  }
}

async function checkCourse(c) {
  const build = { angso: 'angsobuild', norrfallsviken: 'nvgkbuild', puttom: 'puttombuild',
                  upsala: 'upsalabuild', johannesberg: 'johannesbergbuild' }[c.slug];
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, build, 'card.json'), 'utf8'));

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(`${BASE}/?bana=${c.slug}&det=1`, { waitUntil: 'load', timeout: 120000 });
  try { await page.waitForSelector('#boot.done', { timeout: 240000 }); }
  catch { gate(false, 'boot did not complete'); await page.close(); return; }

  gate(errs.length === 0, `no page errors${errs.length ? ' -- ' + errs[0] : ''}`);

  const got = await page.evaluate(() => ({
    holes: window.V3D.HOLES.map(h => ({ n: h.n, par: h.par, idx: h.idx, t: h.t })),
    teeLabels: [...document.querySelectorAll('#tees .tee i')].map(e => e.textContent),
    header: document.querySelector('.hd h1').textContent,
    title: document.title,
    url: location.search,
  }));

  let mism = 0, vals = 0;
  for (const ch of card.holes) {
    const h = got.holes.find(x => x.n === ch.n);
    vals += 2 + ch.t.length;
    if (!h || h.par !== ch.par) mism++;
    if (!h || h.idx !== ch.hcp) mism++;
    ch.t.forEach((v, i) => { if (!h || h.t[i] !== v) mism++; });
  }
  gate(mism === 0 && got.holes.length === 18, `card through the app: ${vals} values, ${mism} mismatches`);
  gate(JSON.stringify(got.teeLabels) === JSON.stringify(c.tees.names),
    `tee row shows [${got.teeLabels.join(', ')}]`);
  gate(got.header === c.name, `header says "${got.header}"`);
  gate(got.title === c.title, 'document title set from the manifest');
  const isDefault = c.slug === manifest.courses[0].slug;
  gate(isDefault ? !/bana=/.test(got.url) : got.url.includes(`bana=${c.slug}`),
    `deep link ${isDefault ? 'stays clean for the default course' : 'carries bana=' + c.slug}`);

  /* SwiftShader needs minutes, not Playwright's default 30 s, to compose a frame */
  const shot = await page.screenshot({ timeout: 300000, animations: 'disabled' });
  const { decodePNG } = await import('../geobuild/png.mjs');
  const img = decodePNG(shot);
  let sum = 0, dark = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const o = i * img.channels;
    const l = 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
    sum += l; if (l < 8) dark++;
  }
  gate(sum / n / 255 > 0.05 && dark / n < 0.85, `frame is a picture (lum ${(sum / n / 255).toFixed(3)})`);
  await page.close();
}

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nall courses boot correctly through the app');
process.exit(bad ? 1 : 0);
