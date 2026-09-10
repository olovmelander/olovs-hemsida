/** Real-browser Tortuna menu regression. Start the app, then run:
 * CHROME_BIN=/path/to/chrome node tortunabuild/check-menu.mjs http://localhost:5173/
 * Screenshots and report are local review evidence, not a GPU benchmark.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] || 'http://localhost:5173/');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tortunabuild/cache/menu-review');
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const browser = await chromium.launch({ executablePath: chrome, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce', serviceWorkers: 'block' });
// Keep the course boot affordable on software rendering; navigation still
// supplies the selected slug through the real menu handlers.
await context.addInitScript(() => {
  const url = new URL(location.href);
  if (!url.searchParams.has('bana')) return;
  url.searchParams.set('q', 'lo');
  url.searchParams.set('gl', '1');
  url.searchParams.set('qualitylock', '1');
  history.replaceState(null, '', url);
});
// Map selection must work independently of the external basemap service.
await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({
  contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
}));
const page = await context.newPage();
page.setDefaultTimeout(30000);
const report = { base: base.href, date: new Date().toISOString(), passed: false,
  basemap: 'stubbed; checks exercise real menu markers and actions',
  renderer: 'software WebGL2 with low quality forced for the boot check', checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
const passed = name => { report.checks.push(name); console.log(`PASS ${name}`); };

try {
  const response = await context.request.get(new URL('courses/index.json', base).href);
  assert.equal(response.status(), 200);
  const manifest = await response.json();
  assert.equal(manifest.courses.filter(c => c.slug === 'tortuna').length, 1,
    'The running server must serve the Tortuna checkout, not another branch');
  passed('served manifest includes Tortuna exactly once');

  await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  const card = page.locator('.card[data-slug="tortuna"]');
  await card.waitFor({ state: 'visible' });
  assert.match(await card.innerText(), /Tortuna GK/);
  assert.match(await card.innerText(), /Preliminär 3D/i);
  passed('Tortuna card is selectable from All courses');

  await page.locator('[data-filter="skog"]').click();
  assert.equal(await card.isVisible(), true);
  passed('Tortuna stays visible in Skog & Park');
  for (const query of ['Tortuna', 'Västerås']) {
    await page.locator('#courseSearchInput').fill(query);
    assert.equal(await card.isVisible(), true);
    passed(`search finds Tortuna by ${query}`);
  }
  await page.locator('#courseSearchInput').fill('Tortuna');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'card-search.png') });
  await page.locator('#courseSearchInput').fill('');
  await page.locator('#viewMapBtn').click();
  const pin = page.locator('.golf-pin-container').filter({ hasText: 'Tortuna GK' });
  await pin.waitFor({ state: 'attached' });
  await page.locator('[data-region="malardalen"]').click();
  // Leaflet may animate/pan the pin; click its real event target once visible.
  await pin.click();
  await page.locator('#mapPreviewPanel.visible').waitFor();
  assert.match(await page.locator('#mapPreviewPanel h3').innerText(), /Tortuna GK/);
  await page.screenshot({ path: path.join(out, 'map-selection.png') });
  passed('Tortuna map pin and Mälardalen preview are selectable');

  await page.setViewportSize({ width: 640, height: 720 });
  await page.locator('#mppPlayBtn').click();
  await page.waitForURL(url => url.searchParams.get('bana') === 'tortuna');
  passed('map play button navigates to Tortuna');
  console.log('Waiting for the selected course to finish booting');
  await page.waitForFunction(() => window.__navDrawer && window.V3D &&
    document.getElementById('boot')?.classList.contains('done'), null, { timeout: 240000 });
  await page.locator('#menuToggle').click();
  const quick = page.locator('.d-course-btn[data-slug="tortuna"]');
  await quick.waitFor({ state: 'visible' });
  assert.match(await quick.getAttribute('class'), /active/);
  assert.match(await page.locator('.dcc-title').innerText(), /Tortuna GK/);
  await page.screenshot({ path: path.join(out, 'in-game-menu.png'), timeout: 120000 });
  passed('Tortuna boots and appears as active in the quick-switch drawer');
  await page.locator('#drawerStartBtn').click();
  await card.waitFor({ state: 'visible' });
  await card.click();
  await page.waitForFunction(() => document.getElementById('chooser').hidden);
  assert.equal(new URL(page.url()).searchParams.get('bana'), 'tortuna');
  passed('selecting the active Tortuna card resumes the course');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
