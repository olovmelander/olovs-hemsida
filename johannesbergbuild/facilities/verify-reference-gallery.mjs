// Verify the delivered local gallery in an isolated headless browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gallery = path.join(root, 'johannesbergbuild/cache/facilities-reference/index.html');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(gallery).href);
  const imageCount = await page.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(images.map(img => { img.loading = 'eager'; return img.decode(); }));
    if (images.some(img => !img.naturalWidth)) throw new Error('Missing gallery image');
    return images.length;
  });
  assert.equal(imageCount, 23);
  assert.equal(await page.locator('.card:visible').count(), 22);
  const localLinks = await page.locator('a').evaluateAll(links => links.map(a => a.href).filter(href => href.startsWith('file:')));
  for (const href of localLinks) {
    const url = new URL(href);
    url.hash = '';
    await fs.access(fileURLToPath(url));
  }
  await page.locator('#filter').fill('clubhouse');
  const clubhousePhotos = await page.locator('.card:visible').count();
  assert(clubhousePhotos >= 4, 'Clubhouse views not searchable');
  assert.equal(await page.locator('#inventory + p + .scroll tbody tr:visible').filter({ hasText: 'w296165896' }).count(), 1);
  await page.locator('#filter').fill('w296165896');
  assert.equal(await page.locator('#inventory + p + .scroll tbody tr:visible').count(), 1);
  await page.locator('#filter').fill('no-such-facility');
  assert.equal(await page.locator('.card:visible').count(), 0);
  await page.locator('#filter').fill('');
  assert.equal(await page.locator('.card:visible').count(), 22);
  assert.equal(await page.locator('#inventory + p + .scroll tbody tr:visible').count(), 22);
  assert.deepEqual(errors, []);
  const screenshot = 'johannesbergbuild/cache/facilities-reference/gallery-preview.png';
  await page.screenshot({ path: path.join(root, screenshot) });
  const report = { passed: true, date: '2026-09-10', decodedImages: imageCount,
    photoBoards: 22, buildingRows: 22, checkedLocalLinks: localLinks.length,
    clubhouseSearchPhotos: clubhousePhotos, searchAndResetVerified: true,
    pageErrors: errors, screenshot };
  await fs.writeFile(path.join(root, 'johannesbergbuild/facilities/gallery-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
