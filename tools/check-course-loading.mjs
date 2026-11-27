/* A golfer can return to the exact setup while the first course request is pending. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const [mode, query, label, selection] of [
    ['karta', 'karta=1', 'Lätt 3D med GPS', 'hal=4&tee=2'],
    ['3d', 'karta=0', 'Detaljerad 3D', 'hal=4&tee=2'],
    ['spela', 'karta=0&spela=1', 'Simulator', 'hal=4&tee=2'],
    ['karta', '', 'Lätt 3D med GPS', 'hal=4'],
  ]) {
    const page = await browser.newPage({
      serviceWorkers: 'block', reducedMotion: 'reduce',
      ...(query ? {} : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
    });
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    await page.route('**/courses/index.json*', async route => {
      if (new URL(route.request().frame().url()).searchParams.has('bana')) {
        await waiting;
        return route.abort().catch(() => {});
      }
      return route.continue();
    });
    try {
      const search = [query, 'bana=bro-hof-castle', selection].filter(Boolean).join('&');
      await page.goto(new URL('?' + search, base).href, { waitUntil: 'domcontentloaded' });
      await page.locator('#bootMode').waitFor();
      assert.equal(await page.locator('#bootMode').textContent(), label + ' · Hål 4');
      assert.equal(await page.locator('#bootRetry').isVisible(), false);
      const back = page.getByRole('link', { name: 'Avbryt' });
      const setupHash = '#klubb/bro-hof?bana=bro-hof-castle&lage=' + mode + '&' + selection;
      assert.equal(new URL(await back.getAttribute('href'), base).hash, setupHash);
      await back.click();
      await page.locator('#courseSheet[open]').waitFor();
      assert.equal(new URL(page.url()).hash, setupHash);
      assert.equal(await page.locator('#courseSheet input[name="cs-layout"]:checked').inputValue(), 'bro-hof-castle');
      console.log(label + ' returns to ' + setupHash + ' during loading.');
    } finally {
      release();
      await page.close();
    }
  }
} finally { await browser.close(); }
