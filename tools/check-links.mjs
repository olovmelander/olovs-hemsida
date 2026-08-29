/* Does every URL that ever worked still show the same thing?

   usage: node tools/check-links.mjs [baseUrl]     (default http://127.0.0.1:8620)

   The six standalone pages have been shared and bookmarked with the full query
   grammar. This drives the app through every shape those links take and asserts
   the view that comes back -- hole, camera, light, tee, markers, clean mode --
   is the one the link asked for. Two of these params exist in this test only
   because an audit found them missing from a plan that claimed the grammar was
   preserved verbatim: gl=1 (force the WebGL2 backend) and q=lo (the light
   build). A link nobody re-tests is a link that quietly stops working.

   Half the matrix is legacy: /veckefjarden3d.html?hal=14&vy=green must land on
   the app showing Veckefjärden's 14th from the green, params intact.          */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8620';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
const DEFAULT_SLUG = manifest.courses[0].slug;

/* url -> what the view must be. `rail` says whether the chooser should be open. */
const CASES = [
  { url: '/', want: { slug: null, rail: true, lightweight: true }, why: 'a bare visit opens the lightweight chooser without booting a course' },
  { url: '/?bana=puttom', want: { slug: 'puttom', rail: false }, why: 'naming a course goes straight to it' },
  { url: '/?bana=veckefjarden&hal=14&vy=green&ljus=host', want: { slug: 'veckefjarden', hole: 14, cam: 'green', preset: 'host', rail: false }, why: 'the full view grammar' },
  { url: '/?bana=upsala&tee=6', want: { slug: 'upsala', tee: 5, rail: false }, why: 'the sixth tee on a six-tee card' },
  { url: '/?bana=angso&skylt=0', want: { slug: 'angso', skylt: 0, rail: false }, why: 'markers explicitly off' },
  { url: '/?bana=angso&ren=1', want: { slug: 'angso', clean: true, rail: false }, why: 'clean view, and the chooser stays out of it' },
  { url: '/?bana=johannesberg&gl=1', want: { slug: 'johannesberg', rail: false }, why: 'gl=1 still forces the WebGL2 backend' },
  { url: '/?bana=norrfallsviken&q=lo', want: { slug: 'norrfallsviken', rail: false }, why: 'q=lo still selects the light build' },
  /* the legacy half: the page name carries the course, the query the view */
  { url: '/veckefjarden3d.html?hal=14&vy=green', want: { slug: 'veckefjarden', hole: 14, cam: 'green', rail: false }, why: 'a shared link to the old page' },
  { url: '/norrfallsviken3d.html?hal=3&ljus=dag&tee=2', want: { slug: 'norrfallsviken', hole: 3, preset: 'noon', tee: 1, rail: false }, why: 'an old link with light and tee' },
  { url: '/puttom3d.html', want: { slug: 'puttom', rail: false }, why: 'a bare old link still names its course' },
  { url: '/johannesberg3d.html?hal=12&vy=tee&skylt=1', want: { slug: 'johannesberg', hole: 12, cam: 'tee', skylt: 1, rail: false }, why: 'an old link carrying markers' },
];

let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--force-device-scale-factor=1'],
});

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errs = [];
  page.on('pageerror', e => { const s = String(e); if (!/redirecting to/.test(s)) errs.push(s.slice(0, 120)); });
  await page.goto(BASE + c.url, { waitUntil: 'load', timeout: 120000 });
  let got;
  try {
    await page.waitForSelector('#boot.done', { timeout: 240000 });
    got = await page.evaluate(() => {
      const V = window.V3D;
      if (!V) return {
        slug: null,
        rail: !!document.getElementById('chooser') && !document.getElementById('chooser').hidden,
        lightweight: true,
      };
      return {
        slug: V.course().slug,
        hole: V.camInfo ? +document.getElementById('cno').textContent : null,
        cam: V.camInfo().mode,
        preset: [...document.querySelectorAll('[data-preset]')].find(b => b.classList.contains('on'))?.dataset.preset,
        tee: [...document.querySelectorAll('#tees .tee')].findIndex(e => e.classList.contains('on')),
        skylt: V.skyState(),
        clean: document.body.classList.contains('clean'),
        rail: !document.getElementById('chooser').hidden,
        lightweight: false,
      };
    });
  } catch (e) {
    gate(false, `${c.url} — ${String(e).split('\n')[0].slice(0, 90)}`);
    await page.close(); continue;
  }
  const wrong = Object.entries(c.want).filter(([k, v]) => got[k] !== v)
    .map(([k, v]) => `${k}: wanted ${v}, got ${got[k]}`);
  gate(wrong.length === 0 && errs.length === 0,
    `${c.url.padEnd(48)} ${c.why}${wrong.length ? ' -- ' + wrong.join('; ') : ''}${errs.length ? ' -- ' + errs[0] : ''}`);
  await page.close();
}

await browser.close();
console.log(bad ? `\n${bad} of ${CASES.length} links do not resolve as they did` : `\nall ${CASES.length} link shapes resolve correctly`);
process.exit(bad ? 1 : 0);
