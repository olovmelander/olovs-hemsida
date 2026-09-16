/* Browser gate for the selected tee and green markers, measured on a phone-
   shaped viewport because that is the screen the design is for: 390 x 844, the
   same short side the mobile HUD sheets break at.

   It exists because these two annotations used to DOCK -- a pill at the bottom
   centre of the screen whenever the target was off camera -- and on a phone
   that is a strip of the course replaced by text the hole card already carried.
   Numbers, not impressions: the badge's share of the screen and its overlap
   with the HUD are measured, and a regression is a number going up.

   usage: node tools/serve.mjs apps/golf/dist 8631
          node tools/check-hole-marker.mjs [http://127.0.0.1:8631] [--shots dir]

   BANVY_GPU=1 uses the real adapter; without it SwiftShader boots in minutes.
   The picture is irrelevant here -- every assertion reads the DOM -- so either
   mode is valid, unlike a pixel comparison. */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:8631';
const shotIndex = process.argv.indexOf('--shots');
const SHOTS = shotIndex > 0 ? process.argv[shotIndex + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.BANVY_CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

const gate = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(`${BASE}/?bana=veckefjarden&hal=1&vy=green&det=1&v2=0`, { waitUntil: 'load', timeout: 180_000 });
await page.waitForSelector('#boot.done', { timeout: 600_000 });
await page.waitForTimeout(1200);

const read = () => page.evaluate(() => {
  const pick = id => {
    const root = document.getElementById(id);
    if (!root || root.hidden) return { id, hidden: true };
    const card = root.querySelector('.hole-marker-card');
    const arrow = root.querySelector('.hole-marker-arrow');
    const r = card.getBoundingClientRect();
    const copy = root.querySelector('.hole-marker-copy');
    const c = copy.getBoundingClientRect();
    return {
      id, hidden: false, mode: root.dataset.mode,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      area: r.width * r.height,
      tapWidth: r.width + 10, tapHeight: r.height + 10, // ::after widens the hit area, not the box
      /* The name must reach a screen reader and NOT the screen, so the question
         is the live region's painted size -- innerText still returns text that
         is merely clipped, which is the whole trick of an sr-only region. */
      copyPainted: Math.max(c.width, c.height),
      copyText: copy.textContent.replace(/\s+/g, ' ').trim(),
      /* The one string the badge is allowed to paint. innerText is no use for
         this -- it returns text that is merely clipped, which is exactly what
         the live region is -- so the metric is measured the same geometric way
         the live region is: a box with size, or none. */
      metric: root.querySelector('.hole-marker-metric').textContent.trim(),
      metricPainted: (() => {
        const el = root.querySelector('.hole-marker-metric');
        if (getComputedStyle(el).display === 'none') return 0;
        const m = el.getBoundingClientRect();
        return Math.max(m.width, m.height);
      })(),
      label: card.getAttribute('aria-label') || '',
      arrowShown: arrow ? getComputedStyle(arrow).display !== 'none' : false,
    };
  };
  const hud = [...document.querySelectorAll('#card, #rail, .mobile-hud-cluster, .holes-wrap, #courseNav, #mini')]
    .filter(el => el.getClientRects().length && getComputedStyle(el).opacity !== '0')
    .map(el => el.getBoundingClientRect())
    .map(r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
  return { tee: pick('selectedTee'), green: pick('selectedGreen'), hud,
    screen: { w: innerWidth, h: innerHeight } };
});

/* Aim the camera so the flag sits `degrees` off the line of play. Past 90 it is
   behind the player, which is the case a mirrored projection gets backwards. */
const aim = degrees => page.evaluate(turn => {
  const line = window.V3D.holeLines().find(hole => hole.n === 1).line;
  const tee = line[0], green = line.at(-1);
  const dx = green[0] - tee[0], dz = green[1] - tee[1];
  const length = Math.hypot(dx, dz) || 1;
  const radians = turn * Math.PI / 180;
  const fx = (dx * Math.cos(radians) - dz * Math.sin(radians)) / length;
  const fz = (dx * Math.sin(radians) + dz * Math.cos(radians)) / length;
  window.V3D.placeCamera([tee[0], 25, tee[1]], [tee[0] + fx * 400, 10, tee[1] + fz * 400]);
}, degrees);

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const hudOverlap = state => marker => state.hud.reduce((sum, h) => sum + overlap(marker.rect, h), 0);
const share = (marker, state) => marker.area / (state.screen.w * state.screen.h) * 100;

const facing = await read();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/marker-facing-green.png` });
const both = [facing.tee, facing.green].filter(m => !m.hidden);

gate(both.length === 2, `both markers are present (${both.length}/2)`);
gate(both.every(m => m.copyPainted <= 1),
  `the live region is spoken and not painted (largest painted text box ${Math.max(...both.map(m => m.copyPainted)).toFixed(1)} px)`);
gate(both.every(m => m.copyText.length > 0) && /green/i.test(facing.green.label) && /tee/i.test(facing.tee.label),
  `each marker still names itself to assistive technology (${JSON.stringify(facing.green.label)})`);
/* No badge paints a NAME. The tee paints its length and nothing else, which is
   the number a tee marker carries on a real course; the green paints nothing. */
gate(facing.green.metricPainted === 0 && facing.green.copyPainted <= 1,
  `the green badge paints no text at all (metric ${facing.green.metricPainted} px)`);
gate(facing.tee.metricPainted > 0 && /^\d+\s*m$/.test(facing.tee.metric),
  `the tee badge paints its length and no name (${JSON.stringify(facing.tee.metric)})`);
gate(facing.green.rect.width === facing.green.rect.height && facing.green.rect.width <= 40,
  `the green badge is a disc (${facing.green.rect.width}x${facing.green.rect.height})`);
gate(both.every(m => m.rect.height <= 40) && facing.tee.rect.width <= 110,
  `each badge stays one row tall (${both.map(m => `${Math.round(m.rect.width)}x${Math.round(m.rect.height)}`).join(' ')})`);
gate(both.every(m => m.tapWidth >= 44 && m.tapHeight >= 44),
  `each badge keeps a 44 px tap target (${both.map(m => `${Math.round(m.tapWidth)}x${Math.round(m.tapHeight)}`).join(' ')})`);
const together = both.reduce((sum, m) => sum + share(m, facing), 0);
gate(together < 1.5, `both badges together cover ${together.toFixed(2)}% of a phone screen (< 1.5%)`);
gate(both.every(m => hudOverlap(facing)(m) === 0),
  `no badge sits on the HUD (${both.map(m => hudOverlap(facing)(m).toFixed(0)).join(' ')} px2)`);

/* The flag behind the player: what used to dock at the bottom of the screen. */
await aim(150);
await page.waitForTimeout(900);
const behind = await read();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/marker-flag-behind.png` });
gate(behind.green.mode === 'edge', `an off-screen flag becomes an edge arrow, not a docked pill (${behind.green.mode})`);
gate(behind.green.arrowShown, 'the edge badge shows its direction arrow');
gate(hudOverlap(behind)(behind.green) === 0, 'the edge badge clears the HUD');
const bottomStrip = behind.green.rect.bottom > behind.screen.h - 110;
gate(!bottomStrip, `the edge badge is not in the bottom strip the pill used to occupy (bottom ${behind.green.rect.bottom.toFixed(0)} of ${behind.screen.h})`);
gate(Math.abs(behind.green.rect.left + behind.green.rect.width / 2 - behind.screen.w / 2) > 40
  || Math.abs(behind.green.rect.top + behind.green.rect.height / 2 - behind.screen.h / 2) > 40,
  'the edge badge is at an edge rather than the middle of the screen');

/* The independent direction test. The flag is physically on the SAME side of
   the player at 60 degrees as at 120 -- only the second is behind the camera --
   so both must put the badge on the same half of the screen. A projection read
   without the behind-camera correction flips the second one, and this is what
   catches that without restating the arithmetic the code uses. */
await aim(60); await page.waitForTimeout(700);
const ahead = await read();
await aim(120); await page.waitForTimeout(700);
const past = await read();
const sideOf = marker => marker.rect.left + marker.rect.width / 2 < 195 ? 'left' : 'right';
gate(ahead.green.mode === 'edge' && past.green.mode === 'edge',
  `the flag is off screen at 60 and 120 degrees (${ahead.green.mode}/${past.green.mode})`);
gate(sideOf(ahead.green) === sideOf(past.green),
  `the arrow keeps the flag on its real side past 90 degrees (${sideOf(ahead.green)} then ${sideOf(past.green)})`);

/* The desktop HUD is the case the phone never shows: the control panel stands
   down the whole right-hand side (measured 1210..1426 x 14..586 at 1440x900)
   and the minimap under it. A badge whose direction points right lands inside
   the panel and renders BEHIND it, z-index 18 against 20 -- which is what the
   owner saw: the arrows poking out and no badges. Every width the app lays out
   differently is worth a look, because the obstacle only exists at some. */
for (const [width, height] of [[900, 900], [1440, 900]]) {
  await page.setViewportSize({ width, height });
  await aim(-60);
  await page.waitForTimeout(900);
  const desk = await read();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/marker-desktop-${width}.png` });
  const panelled = [desk.tee, desk.green].filter(m => !m.hidden);
  const worst = Math.max(...panelled.map(hudOverlap(desk)));
  gate(panelled.length === 2 && worst === 0,
    `at ${width}x${height} no badge hides behind the HUD panels (worst overlap ${worst.toFixed(0)} px2)`);
  gate(panelled.every(m => m.rect.left >= 0 && m.rect.top >= 0
    && m.rect.right <= width && m.rect.bottom <= height),
    `at ${width}x${height} every badge is fully on screen`);
}

gate(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
await browser.close();
