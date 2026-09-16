import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const production = 'output/golfer-build', lab = 'output/golfer-lab-build';
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(`${directory}/${prefix}`, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(directory, `${path}/`));
    else result.push(path);
  }
  return result;
}
const normalFiles = await files(production), labFiles = await files(lab);
assert.deepEqual(normalFiles.filter(path => /golfer/i.test(path)), [], 'Normal build must omit the studio and all golfer assets/chunks');
for (const path of normalFiles.filter(path => /\.(js|html)$/.test(path))) {
  const source = await readFile(`${production}/${path}`, 'utf8');
  assert(!/BANVY_GOLFER|banvy-golfer|\/models\/golfer\/|Golfer preview/.test(source), `${path}: golfer code must be compiled out`);
}
assert(labFiles.includes('golfer-study.html'));
assert(!labFiles.includes('sw.js') && !labFiles.includes('registerSW.js'), 'The lab must not install a service worker');
const hashes = {};
for (const name of ['golfer.json', 'golfer-male.json', 'banvy-golfer.glb', 'banvy-golfer-male.glb']) {
  const source = await readFile(`experiments/golfer/assets/${name}`);
  assert.deepEqual(await readFile(`${lab}/models/golfer/${name}`), source, `${name}: lab build must preserve the export`);
  hashes[name] = createHash('sha256').update(source).digest('hex');
  assert.equal((await fetch(`http://127.0.0.1:5173/models/golfer/${name}`)).status, 404, `${name}: normal dev server must not expose the lab models`);
}
assert.equal((await fetch('http://127.0.0.1:5173/golfer-study.html')).status, 404);
assert.equal((await fetch('http://127.0.0.1:5180/golfer-study.html')).status, 200);

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', request => {
  if (/\/models\/golfer\/|\/assets\/golfer/.test(request.url())) requests.push(request.url());
});
try {
  // Check the actual production build, including the old opt-in query parameter.
  await page.goto('http://127.0.0.1:5181/?bana=puttom&golfer=1&ghibli=1&ljus=dag&q=lo&skylt=0', { waitUntil:'domcontentloaded', timeout:180000 });
  await page.waitForFunction(() => window.V3D && document.querySelector('#boot')?.classList.contains('done'), undefined, { timeout:180000 });
  assert(await page.evaluate(() => !window.BANVY_GOLFER && !document.querySelector('.golfer-course')));
  assert.deepEqual(requests, []);assert.deepEqual(errors, []);
  const report = { passed:true, verifiedAt:new Date().toISOString(), productionGolferFiles:0, productionGolferRequests:requests, productionPanel:false, oldQueryCannotEnableGolfer:true, labStudio:true, labServiceWorker:false, assetHashes:hashes, errors };
  await writeFile('docs/graphics/golfer-2026-09-16/isolation-verification.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
