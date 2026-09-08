/* End-to-end preview check. Serve the built app, then:
 * node tools/check-lidingo-intake.mjs http://127.0.0.1:8630/ */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8630/';
const OUTPUT = path.join(ROOT, 'lidingobuild/cache/app-review');
fs.mkdirSync(OUTPUT, { recursive: true });
const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'lidingobuild/reference/club-scorecard.json'), 'utf8'));
const preview = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/src/data/lidingo-preview.json'), 'utf8'));
const executable = process.env.BANVY_CHROME || chromium.executablePath();
const browser = await chromium.launch(fs.existsSync(executable) ? { executablePath: executable } : { channel: 'chrome' });
const checks = [];
const passed = label => { checks.push(label); console.log(`ok ${label}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [], failed = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  page.on('request', request => requests.push(request.url()));
  await page.goto(BASE);
  await page.locator('#courseSearchInput').fill('Lidingö');
  const listing = page.locator('.card[data-slug="lidingo"]');
  assert.match(await listing.innerText(), /Preliminär 3D/i);
  await page.goto(new URL('?bana=lidingo&view=sources', BASE).href);
  await page.locator('#intakeMap').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('bana'), 'lidingo');
  assert.equal(await page.locator('tbody tr').count(), 18);
  for (const h of card.holes) {
    const values = await page.locator(`tr[data-card-hole="${h.number}"]`).locator('th,td').allTextContents();
    assert.deepEqual(values.map(n => Number(n.trim())), [h.number, h.par, h.index, ...card.tees.map(t => h.lengths[t.id])]);
  }
  passed('chooser lists provisional 3D; explicit source view retains all 144 official scorecard cells');
  const overview = await page.locator('#intakeMap').getAttribute('viewBox');
  await page.locator('.intake-hole-buttons button[data-hole="18"]').click();
  assert.match(await page.locator('#intakeHole h2').innerText(), /Hål 18/);
  assert.equal(new URL(page.url()).searchParams.get('hal'), '18');
  assert.notEqual(await page.locator('#intakeMap').getAttribute('viewBox'), overview);
  await page.locator('#intakeSurfaces').uncheck();
  assert.equal(await page.locator('#intakeSurfaceLayer').getAttribute('visibility'), 'hidden');
  await page.locator('#intakeSurfaces').check();
  await page.locator('#intakeOverview').click();
  assert.equal(await page.locator('#intakeMap').getAttribute('viewBox'), overview);
  await page.locator('.intake-route[data-hole="7"]').focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#intakeHole h2').innerText(), /Hål 7/);
  passed('hole selection by button and keyboard, URL state, zoom, overview and surface toggle');
  await page.locator('#intakeOverview').click();
  await page.screenshot({ path: path.join(OUTPUT, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'auto');
  await page.screenshot({ path: path.join(OUTPUT, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  assert.deepEqual(requests.filter(url => /pack\.bin|three\.(?:core|tsl)|v2-index/.test(url)), []);
  passed('desktop/mobile scrolling, no page errors, no failed resources, no playable pack or 3D engine requested');
  await context.close();

  const corruptContext = await browser.newContext({ serviceWorkers: 'block' });
  const corrupt = await corruptContext.newPage();
  await corrupt.route(/\/intake-[a-f0-9]{64}\.json$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await corrupt.goto(new URL('?bana=lidingo&view=sources', BASE).href);
  await corrupt.getByText('Underlaget har ändrats.', { exact: false }).waitFor();
  assert.equal(await corrupt.locator('#intakeMap').count(), 0);
  passed('corrupt preview is rejected before rendering');
  await corruptContext.close();

  const offlineContext = await browser.newContext();
  const offline = await offlineContext.newPage();
  await offline.goto(new URL('?bana=lidingo&view=sources&hal=12', BASE).href);
  await offline.locator('#intakeMap').waitFor();
  await offline.evaluate(() => navigator.serviceWorker.ready);
  await offline.reload();
  await offline.locator('#intakeMap').waitFor();
  // Wait on the actual immutable response, not merely worker installation.
  const previewUrl = new URL(preview.previewUrl, BASE).href;
  await offline.waitForFunction(async url => Boolean(await (await caches.open('banvy-course-intakes')).match(url)), previewUrl);
  await offlineContext.setOffline(true);
  await offline.reload();
  await offline.locator('#intakeMap').waitFor();
  assert.match(await offline.locator('#intakeHole h2').innerText(), /Hål 12/);
  passed('visited preview reopens offline with its selected hole');
  await offlineContext.close();
  const report = { schemaVersion: 1, groundId: 'lidingo', state: 'passed', observedOn: new Date().toISOString().slice(0, 10),
    browser: browser.version(), previewSha256: preview.previewSha256, checks,
    screenshots: ['lidingobuild/cache/app-review/desktop.png', 'lidingobuild/cache/app-review/mobile.png'],
    scope: 'Source-only app preview. These checks do not approve course geography, frame controls or a playable 3D release.' };
  fs.writeFileSync(path.join(ROOT, 'lidingobuild/mapping/app-validation.json'), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
