/* Does the HUD fit the window? The panels are anchored to opposite corners and
   sized by their own content, so nothing about the markup keeps them apart: the
   control rail grows DOWN from the top-right and the minimap is pinned UP from
   the bottom-right, and on a window that is merely a little short the two meet.
   That is not a rare case -- a maximised browser on a 1080p laptop with a
   bookmarks bar is already there.

   The pages have had this gate for years (geobuild/check-markers.mjs measures
   the HUD at 1440/1280/1100/1000/900/420). The app never did, which is why the
   minimap could sit on the rail in a shipped build.

   usage: node tools/serve.mjs apps/golf/dist 8631
          node tools/check-hud-layout.mjs [http://127.0.0.1:8631] */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:8631';
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.BANVY_CHROME || (fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined);

/* Real window shapes, not round numbers: a 1080p laptop with browser chrome and
   a bookmarks bar leaves about 1920x870, and 1366x768 is still the second most
   common desktop screen there is. The owner's report came from 1600x843. */
const SIZES = [[1920, 1080], [1920, 870], [1600, 843], [1440, 900], [1366, 768],
  [1280, 800], [1152, 720], [1024, 768], [900, 900], [390, 844]];

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

const gate = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(`${BASE}/?bana=veckefjarden&hal=12&vy=tee&det=1&v2=0`, { waitUntil: 'load', timeout: 180_000 });
await page.waitForSelector('#boot.done', { timeout: 600_000 });
await page.waitForTimeout(1200);

for (const [width, height] of SIZES) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const ids = ['card', 'rail', 'mini', 'note', 'holes', 'courseNav', 'kikGreen', 'brand'];
    const panels = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el || !el.getClientRects().length) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      panels.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    /* A panel that has to scroll to reach its own last control is a different
       complaint from one that is covered, so it is reported separately. */
    const rail = document.getElementById('rail');
    const clipped = rail && rail.getClientRects().length
      ? rail.scrollHeight - rail.clientHeight > 1 : false;
    return { panels, clipped, screen: { w: innerWidth, h: innerHeight } };
  });

  const over = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const collisions = [];
  for (let i = 0; i < state.panels.length; i++) {
    for (let j = i + 1; j < state.panels.length; j++) {
      const a = state.panels[i], b = state.panels[j], area = over(a, b);
      const box = p => `${p.id}[${Math.round(p.left)},${Math.round(p.top)} ${Math.round(p.right)},${Math.round(p.bottom)}]`;
      if (area > 1) collisions.push(`${box(a)} x ${box(b)} = ${Math.round(area)}px2`);
    }
  }
  gate(collisions.length === 0,
    `${width}x${height}: no two HUD panels overlap${collisions.length ? ` -- ${collisions.join(', ')}` : ''}`);
  const offscreen = state.panels.filter(p => p.left < -1 || p.top < -1
    || p.right > state.screen.w + 1 || p.bottom > state.screen.h + 1);
  gate(offscreen.length === 0,
    `${width}x${height}: every HUD panel is fully on screen${offscreen.length ? ` -- ${offscreen.map(p => p.id).join(', ')}` : ''}`);
}

gate(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
await browser.close();
