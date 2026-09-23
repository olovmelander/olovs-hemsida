/* Browser gate for GPS mode's round: turn GPS on and the app follows the
   player -- the hole they stand on, the next hole once their green is done, a
   hole they pick by hand held until they walk away, and ANOTHER COURSE when
   they are standing on one, with GPS mode carried across the navigation. Then
   the chooser's "Hitta min bana" does the same from the front door.

   The positions are scripted through Playwright's geolocation override, built
   from the committed manifest's own `gps` record with the inverse of the app's
   frame (SWEREF 99 TM for the grid-authored packs), so every fix lands where
   the app will put it. The rules themselves are unit-tested against simulated
   rounds on all thirteen courses (engine/gps-round.test.mjs); this proves the
   wiring: the HUD, the camera, the URL, the handoff, the chooser.

   usage: node tools/serve.mjs apps/golf/dist 8620 &
          node tools/check-gps-round.mjs [http://127.0.0.1:8620] [--quick]
   --quick stops before the second and third boots (the course switch). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { PROJECTED_GPS_FRAMES } from '../apps/golf/src/engine/gps-projected-frames.mjs';
import { pointAlongLine } from '../apps/golf/src/engine/caddie.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const BASE = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const QUICK = args.includes('--quick');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
const gpsOf = slug => MANIFEST.courses.find(c => c.slug === slug).gps;

/* the inverse of gpsToLocal */
function fixAt(slug, point, accuracy = 5) {
  const gps = gpsOf(slug);
  const projected = PROJECTED_GPS_FRAMES.find(f => f.packFrame === gps.frame);
  if (projected) {
    const [latitude, longitude] = sweref99TmToLatLon(
      projected.legacyOriginEpsg3006.easting + point[0], projected.legacyOriginEpsg3006.northing - point[1]);
    return { latitude, longitude, accuracy };
  }
  return { latitude: gps.origin.lat - point[1] / 111320, longitude: gps.origin.lon + point[0] / gps.mPerLon, accuracy };
}

const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.BANVY_CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: browserArgs() });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await context.grantPermissions(['geolocation'], { origin: new URL(BASE).origin });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

const gate = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
  return ok;
};
const gps = () => page.evaluate(() => window.V3D.caddie().gps);
const until = async (predicate, what, timeout = 30_000) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await gps().catch(() => null);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  console.log(`     (waited ${timeout / 1000}s for ${what}; last ${JSON.stringify(last)})`);
  return last;
};
const move = async (slug, point, accuracy = 5) => context.setGeolocation(fixAt(slug, point, accuracy));
/* GPS on, and the last fix where it was put -- a check that passes with GPS
   silently off proves nothing (that is how the first run of this gate lied) */
const near = (g, p) => Boolean(g?.active && g.point && Math.hypot(g.point[0] - p[0], g.point[1] - p[1]) < 3);
const bootDone = () => page.waitForSelector('#boot.done', { timeout: 900_000 });

/* ------------------------------------------------ one course, one round */
const angso = gpsOf('angso');
const teeOf = n => angso.lines[n - 1][0];
const greenOf = n => angso.lines[n - 1].at(-1);

await move('angso', teeOf(5));
await page.goto(`${BASE}/?bana=angso&det=1&q=lo&gl=1&v2=0`, { waitUntil: 'load', timeout: 120_000 });
await bootDone();
gate((await gps()).hole === 1, 'the course opens on hole 1');

await page.click('#gpsBtn');
let s = await until(g => g.status?.state === 'live' && g.hole === 5, 'hole 5');
gate(s.hole === 5 && s.settled, `turning GPS on at the 5th tee selects hole 5 (${s.status?.text})`);
gate(/Hål 5/.test(await page.locator('#toast').textContent()), 'and says so');

await move('angso', greenOf(5));
s = await until(g => near(g, greenOf(5)), 'the 5th green');
gate(near(s, greenOf(5)) && s.hole === 5, 'on the 5th green it stays on hole 5');

await move('angso', teeOf(6));
s = await until(g => g.active && g.hole === 6, 'hole 6');
gate(s.active && s.hole === 6, 'walking to the 6th tee moves on to hole 6');

await page.locator('#holes .hb').nth(8).click();
s = await until(g => g.hole === 9, 'hole 9 by hand');
const nearTee = [teeOf(6)[0] + 8, teeOf(6)[1]];
await move('angso', nearTee);
s = await until(g => near(g, nearTee), 'a fix beside the tee');
gate(near(s, nearTee) && s.hole === 9 && s.held, 'a hole picked by hand holds while the player stays near where they picked it');
const downSix = pointAlongLine(angso.lines[5], 90);
await move('angso', downSix);
s = await until(g => g.active && g.hole === 6, 'back to hole 6');
gate(s.active && s.hole === 6 && !s.held, 'and lapses once they walk on down the 6th');

await context.setGeolocation({ latitude: 59.3293, longitude: 18.0686, accuracy: 10 });   /* Stockholm */
s = await until(g => g.active && g.status?.state === 'error', 'off course');
gate(s.active && s.status?.state === 'error' && /Närmaste bana|från närmaste hål/.test(s.status.text) && s.hole === 6,
  `far from every course it says how far, and keeps the hole (${s.status?.text})`);

if (!QUICK) {
  /* ------------------------------------------------ onto another course */
  const puttom = gpsOf('puttom');
  await move('puttom', pointAlongLine(puttom.lines[11], 40));
  s = await until(g => g.leaving, 'a course switch', 20_000);
  gate(s.leaving?.slug === 'puttom' && s.leaving?.hole === 12, `standing on Puttom's 12th, GPS takes the player there (${JSON.stringify(s.leaving)})`);
  await page.waitForURL(/bana=puttom/, { timeout: 30_000 });
  gate(/[?&]hal=12\b/.test(page.url()), `the switch opens the hole the player stands on (${page.url()})`);
  await bootDone();
  s = await until(g => g.active && g.status?.state === 'live', 'GPS carried across', 60_000);
  gate(s.active && s.hole === 12, `GPS mode is still on after the switch, on hole 12 (${s.status?.text})`);
  const stored = await page.evaluate(() => sessionStorage.getItem('banvy:gps-handoff'));
  gate(stored === null, 'the handoff was used once and is gone');

  /* ------------------------------------------------ the chooser's locate button */
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForSelector('#chooserLocateBtn');
  const visby = gpsOf('visby');
  await move('visby', pointAlongLine(visby.lines[2], 60));
  await page.click('#chooserLocateBtn');
  await page.waitForURL(/bana=visby/, { timeout: 60_000 });
  gate(/[?&]hal=3\b/.test(page.url()), `"Hitta min bana" opens Visby on the 3rd (${page.url()})`);
  await bootDone();
  s = await until(g => g.active && g.status?.state === 'live', 'GPS on after the chooser', 60_000);
  gate(s.active && s.hole === 3, `and arrives with GPS mode running (${s.status?.text})`);
}

gate(errors.length === 0, `no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
