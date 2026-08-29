/* Does the marker layer actually work, and did it break the HUD?

   usage: node geobuild/check-markers.mjs [page.html ...]

   Three things a screenshot glance cannot tell you, so they are measured:
     - the rail grew a row. At every breakpoint, does it still fit on the screen,
       and does anything now overlap anything else? (The compass rose in the card
       header once cost 58 px and silently wrapped the hole line onto two rows.)
     - the discs were de-collided in canvas pixels. What is the worst pair, really?
     - the toggle drives two surfaces. Do they agree at every state?
   Exits non-zero on a regression.                                             */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const VENDOR = path.join(ROOT, 'geobuild/cache/vendor');
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'veckefjarden3d.html', 'norrfallsviken3d.html', 'puttom3d.html',
  'angso3d.html', 'upsala3d.html', 'johannesberg3d.html',
];
/* the widths that matter: desktop, the band where the minimap is still shown but the
   panel has not grown, just above the minimap cutoff, the tablet band, and a phone */
const WIDTHS = [[1440, 900], [1280, 900], [1100, 800], [1000, 800], [900, 800], [420, 780]];

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
async function route(page) {
  await page.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    const base = u.split('?')[0].split('/').pop();
    const f = path.join(VENDOR, base);
    if (fs.existsSync(f)) {
      return r.fulfill({ status: 200, contentType: MIME[path.extname(base)] || 'application/octet-stream',
                         body: fs.readFileSync(f) });
    }
    /* the harness serves an empty stylesheet for the webfont, so every measurement
       here is taken in the FALLBACK face -- deliberately the pessimistic case */
    if (u.includes('fonts.googleapis.com')) return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return r.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
}

let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'],
});

for (const rel of PAGES) {
  console.log(`\n${rel}`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await route(page);
  await page.goto('file://' + path.join(ROOT, rel), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#boot.done', { timeout: 180000 });

  gate(errs.length === 0, `no page errors${errs.length ? ' -- ' + errs[0].slice(0, 160) : ''}`);

  /* --- the marker table ------------------------------------------------------ */
  const marks = await page.evaluate(() => window.V3D.skyMarks());
  gate(marks.holes.length === 18, `18 hole marks (${marks.holes.length})`);
  const all = marks.holes.concat(marks.fac);
  let worst = 1e9, wp = '';
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const d = Math.hypot(all[i].px - all[j].px, all[i].py - all[j].py);
    if (d < worst) { worst = d; wp = `${all[i].id}/${all[j].id}`; }
  }
  const slid = marks.holes.filter(m => Math.abs(m.f - 0.5) > 1e-6).length;
  console.log(`     ${marks.ppm.toFixed(3)} px/m · ${slid} discs slid · worst pair ${wp} at ${worst.toFixed(1)} px` +
              ` · fac ${marks.fac.map(f => f.id).join('') || 'none'}`);
  /* two markers whose centres are closer than a radius are one blob; a graze is the
     honest outcome on a tight routing, a swallow is a defect */
  gate(worst >= marks.r, `no marker pair closer than ${marks.r} px (worst ${worst.toFixed(1)})`);
  gate(marks.holes.every(m => m.f >= 0.12 - 1e-9 && m.f <= 0.88 + 1e-9), 'every disc still on its own line');
  gate(all.every(m => m.px >= marks.r && m.px <= marks.w - marks.r &&
                      m.py >= marks.r && m.py <= marks.w - marks.r), 'every marker fully on the canvas');

  /* --- the toggle drives both surfaces --------------------------------------- */
  const cyc = [];
  for (const s of [0, 1, 2, 3]) {
    cyc.push(await page.evaluate(n => {
      window.V3D.setSky(n, true);
      const sg = window.V3D.skyGroupInfo ? window.V3D.skyGroupInfo() : null;
      return { asked: n, got: window.V3D.skyState(), btn: document.getElementById('skyltBtn').classList.contains('on'), sg };
    }, s));
  }
  const maxState = Math.max(...cyc.map(c => c.got));
  gate(cyc[0].got === 0 && !cyc[0].btn, 'state 0 turns the button off');
  gate(cyc[1].got === 1 && cyc[1].btn, 'state 1 is hole numbers');
  gate(maxState === (marks.fac.length ? 2 : 1), `top state matches the facilities present (${maxState})`);
  gate(cyc[3].got === 0, 'the cycle wraps back to off');
  await page.evaluate(() => window.V3D.setSky(9, true));   /* out of range must not stick */
  gate(await page.evaluate(() => window.V3D.skyState()) === 0, 'an out-of-range state falls back to off');
  await page.evaluate(() => window.V3D.setSky(2, true));

  /* --- the sprites answer to height, not to the view name -------------------- */
  const fade = {};
  for (const m of ['tee', 'green', 'orbit', 'top']) {
    fade[m] = await page.evaluate(async mode => {
      window.V3D.setCam(mode, true);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      let vis = 0, op = 0;
      window.V3D.eachSky(s => { if (s.visible && s.parent.visible) { vis++; op = Math.max(op, s.material.opacity); } });
      return { vis, op: +op.toFixed(2) };
    }, m);
  }
  console.log(`     sprite opacity  tee ${fade.tee.op}  green ${fade.green.op}  fritt ${fade.orbit.op}  ovan ${fade.top.op}`);
  gate(fade.tee.op === 0 && fade.green.op === 0, 'markers are absent at eye level');
  gate(fade.top.op > 0.9, 'markers are fully up in the Ovan view');

  /* --- the HUD still fits ---------------------------------------------------- */
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const L = await page.evaluate(() => {
      const R = id => { const e = document.getElementById(id); if (!e) return null;
        const s = getComputedStyle(e); if (s.display === 'none') return { hidden: true };
        const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      return { rail: R('rail'), mini: R('mini'), holes: R('holes'), card: R('card'),
               vw: innerWidth, vh: innerHeight };
    });
    const over = (a, b) => a && b && !a.hidden && !b.hidden &&
      a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
    const fits = p => !p || p.hidden || (p.x >= -0.5 && p.y >= -0.5 && p.r <= L.vw + 0.5 && p.b <= L.vh + 0.5);
    const tag = `${w}x${h}`;
    gate(fits(L.rail), `${tag} rail inside the viewport` +
      (L.rail && !L.rail.hidden ? ` (${L.rail.y.toFixed(0)}..${L.rail.b.toFixed(0)} of ${L.vh})` : ' (hidden)'));
    gate(fits(L.mini), `${tag} minimap inside the viewport`);
    gate(!over(L.mini, L.holes), `${tag} minimap clear of the hole strip`);
    gate(!over(L.rail, L.mini), `${tag} rail clear of the minimap`);
    gate(!over(L.rail, L.card), `${tag} rail clear of the card`);
  }
  /* on a phone the rail is a sheet a thumb opens; it must not run off the top */
  await page.setViewportSize({ width: 420, height: 780 });
  await page.evaluate(() => document.getElementById('uiToggle').click());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const sheet = await page.evaluate(() => {
    const b = document.getElementById('rail').getBoundingClientRect();
    return { y: b.y, b: b.bottom, h: b.height, vh: innerHeight };
  });
  console.log(`     420 px sheet: ${sheet.y.toFixed(0)}..${sheet.b.toFixed(0)} of ${sheet.vh} (${sheet.h.toFixed(0)} tall)`);
  gate(sheet.y >= 0, 'the open rail sheet clears the top of a 420 px phone');

  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} failed` : '\nall marker checks passed');
process.exit(bad ? 1 : 0);
