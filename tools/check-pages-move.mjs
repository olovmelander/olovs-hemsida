/* Banvy's move from GitHub Pages, end to end, on two local origins standing in for
   the old address (olovmelander.github.io/olovs-hemsida/) and the main site.

   1. The old app (a /olovs-hemsida/ build) is installed with its worker, and the
      golfer keeps a round there.
   2. The old address is republished as tools/pages-moved-site.mjs writes it.
   3. An old bookmark, opened through the installed worker: the worker must clear
      the old app and the visitor must reach the main site with their data, which
      Inställningar offers once; read in, it is the main site's.
   4. Another old bookmark: straight to its course, not offered again.
   5. A visitor with nothing kept: straight through, nothing carried.

   node tools/check-pages-move.mjs --old <dir> --new <dir>
     --old: apps/golf/dist built with BANVY_BASE=/olovs-hemsida/
     --new: apps/golf/dist built with BANVY_BASE=/ (served as Cloudflare serves it)
   node tools/check-pages-move.mjs --receive <origin>
     The main site's end only, on a running host (the release journeys run it on
     wrangler dev): a moved visitor is offered their data once, reads it in and is
     offered the way on; the same data again goes straight to the bookmark. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { moveRules, writeMovedSite } from './pages-moved-site.mjs';
import { movedLocation } from '../apps/golf/src/shell/pages-move.mjs';

const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at >= 0 ? path.resolve(args[at + 1]) : null; };
const BASE = '/olovs-hemsida/';
const ROUNDS_KEY = 'banvy-map-rounds-v1';
const ROUNDS = JSON.stringify({ version: 1, rounds: [{ id: 1_764_244_800_000, course: 'visby', courseName: 'Visby GK', holes: [{ n: 1, strokes: 4, putts: 2 }] }] });
const results = [];
const pass = message => { results.push(message); console.log('  PASS · ' + message); };

if (args.includes('--receive')) {
  await receiveOnly(new URL(args[args.indexOf('--receive') + 1]).origin);
  process.exit(0);
}

const OLD = flag('--old'), NEW = flag('--new');
assert.ok(OLD && NEW, 'usage: check-pages-move.mjs --old <subpath build> --new <root build> | --receive <origin>');
assert.equal(JSON.parse(fs.readFileSync(path.join(OLD, 'manifest.webmanifest'), 'utf8')).scope, BASE, '--old must be a /olovs-hemsida/ build');
assert.equal(JSON.parse(fs.readFileSync(path.join(NEW, 'manifest.webmanifest'), 'utf8')).scope, '/', '--new must be a root build');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png' };
const isFile = file => fs.existsSync(file) && fs.statSync(file).isFile();

/* GitHub Pages: files under the base, 404.html for anything missing. */
function pagesServer(state) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/probe') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>probe</title>'); return; }
    const relative = url.pathname.startsWith(BASE) ? decodeURIComponent(url.pathname.slice(BASE.length)) : null;
    const root = state.root;
    let file = relative === null ? null : path.join(root, relative || 'index.html');
    if (file && !isFile(file) && isFile(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
    if (!file || !file.startsWith(root) || !isFile(file)) {
      const notFound = path.join(root, '404.html');
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(isFile(notFound) ? fs.readFileSync(notFound) : 'Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

/* Cloudflare's static assets: /name.html answers 307 to /name, which serves it. */
function cloudflareServer(root) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname.slice(1));
    let file = path.join(root, relative || 'index.html');
    if (relative && /\.html$/.test(relative) && isFile(file)) {
      response.writeHead(307, { Location: '/' + relative.replace(/(?:^|\/)index\.html$/, '').replace(/\.html$/, '') + url.search });
      response.end();
      return;
    }
    if (relative && !path.extname(relative) && isFile(file + '.html')) file += '.html';
    if (!file.startsWith(root) || !isFile(file)) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const state = { root: OLD };
const pages = pagesServer(state), main = cloudflareServer(NEW);
const [oldOrigin, mainOrigin] = await Promise.all([listen(pages), listen(main)]);
const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-pages-moved-'));
writeMovedSite(moved, { site: mainOrigin + '/', base: BASE });

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  /* 1. the old app, installed, with a round kept */
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const errors = [];
  /* the main site's start menu and Inställningar; a course boot is not this check's */
  page.on('pageerror', error => { if (new URL(page.url()).origin === mainOrigin && !new URL(page.url()).search) errors.push(error.message); });
  await page.goto(oldOrigin + BASE, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(([key, rounds]) => {
    localStorage.setItem(key, rounds);
    localStorage.setItem('banvy-map-handicap-v1', '12.4');
    localStorage.setItem('banvy-device-id-v1', 'old-device');
  }, [ROUNDS_KEY, ROUNDS]);
  const before = await page.evaluate(async () => (await caches.keys()).length);
  assert.ok(before > 0, 'the old app keeps caches to clear');
  pass(`the old app is installed at ${BASE}, with ${before} caches and a kept round`);

  /* 2-3. republished; an old bookmark through the installed worker */
  state.root = moved;
  await page.goto(oldOrigin + BASE + 'veckefjarden3d.html?hal=14&q=lo', { waitUntil: 'commit' });
  await page.waitForURL(url => url.origin === mainOrigin && url.hash === '#installningar/konto', { timeout: 180_000 });
  assert.ok(!page.url().includes('flytt='), 'the data left the address bar');
  const offer = page.locator('[data-backup-confirm]:not([hidden])');
  await offer.waitFor();
  const text = await offer.locator('[data-backup-text]').textContent();
  assert.match(text, /flyttat hit från olovmelander\.github\.io/);
  const entries = Number(text.match(/1 runda och (\d+) poster/)?.[1]);
  assert.ok(entries >= 2, text);
  assert.match(text, /Inget här ersätts/, text);
  pass(`an old bookmark reaches the main site, and Inställningar offers 1 round in ${entries} entries`);
  assert.deepEqual(errors, [], `page errors on the main site: ${errors.join('; ')}`);
  await page.locator('[data-backup-apply]').click();
  await page.locator('[data-backup-text]', { hasText: `Läste in ${entries} poster från den gamla adressen` }).waitFor();
  const kept = await page.evaluate(key => localStorage.getItem(key), ROUNDS_KEY);
  assert.equal(kept, ROUNDS, 'the round is the main site\'s now');
  assert.equal(await page.evaluate(() => localStorage.getItem('banvy-device-id-v1')), null);
  const onward = await page.locator('[data-backup-continue]').getAttribute('href');
  assert.equal(onward, '/?bana=veckefjarden&hal=14&q=lo', 'and offers the way on to the bookmark\'s course');
  pass(`read in, with the way on to ${onward}`);

  /* the old app is gone from the old address */
  const probe = await context.newPage();
  await probe.goto(oldOrigin + '/probe');
  const left = await probe.evaluate(async () => ({
    workers: (await navigator.serviceWorker.getRegistrations()).map(r => r.scope),
    caches: await caches.keys(),
    data: localStorage.getItem('banvy-map-rounds-v1') !== null,
  }));
  assert.deepEqual(left.workers, [], 'no worker left at the old address');
  assert.deepEqual(left.caches, [], 'no cache left at the old address');
  assert.ok(left.data, 'the old address keeps its copy of the data');
  await probe.close();
  pass('the old address has no worker and no caches left, and keeps its copy of the data');

  /* 4. another old bookmark: the same data is not offered again */
  await page.goto(oldOrigin + BASE + 'angso3d.html?hal=5&q=lo', { waitUntil: 'commit' });
  await page.waitForURL(url => url.origin === mainOrigin && url.searchParams.get('bana') === 'angso' && url.searchParams.get('hal') === '5');
  await page.waitForFunction(() => !location.hash.includes('flytt='));
  assert.ok(!page.url().includes('installningar'), page.url());
  pass('a second old bookmark goes straight to its course, not offered again');
  await context.close();

  /* 5. a visitor who kept nothing */
  const fresh = await browser.newContext({ serviceWorkers: 'block' });
  const visitor = await fresh.newPage();
  await visitor.goto(oldOrigin + BASE + '?bana=visby&hal=3&q=lo#statistik', { waitUntil: 'commit' });
  await visitor.waitForURL(url => url.origin === mainOrigin && url.search === '?bana=visby&hal=3&q=lo');
  assert.equal(new URL(visitor.url()).hash, '#statistik');
  pass('a visitor with nothing kept goes straight through, hash and all');
  await fresh.close();
  console.log(`\nthe move from ${BASE} works: ${results.length} checks`);
} finally {
  await browser.close();
  pages.closeAllConnections(); main.closeAllConnections();
  pages.close(); main.close();
  fs.rmSync(moved, { recursive: true, force: true });
}

async function receiveOnly(origin) {
  const data = { [ROUNDS_KEY]: ROUNDS, 'banvy-map-handicap-v1': '12.4', 'banvy-device-id-v1': 'old-device' };
  const storage = { get length() { return Object.keys(data).length; }, key: i => Object.keys(data)[i] ?? null, getItem: key => data[key] ?? null };
  const bookmark = '/?bana=angso&hal=2&q=lo';
  const moved = await movedLocation({ pathname: BASE, search: bookmark.slice(1), hash: '' }, storage,
    { ...moveRules({ site: origin + '/', base: BASE }), now: Date.now() });
  const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(moved.url, { waitUntil: 'commit' });
    await page.waitForURL(url => url.hash === '#installningar/konto');
    const offer = page.locator('[data-backup-confirm]:not([hidden])');
    await offer.waitFor();
    const text = await offer.locator('[data-backup-text]').textContent();
    assert.match(text, /1 runda och 2 poster\. Inget här ersätts\./, text);
    await page.locator('[data-backup-apply]').click();
    await page.locator('[data-backup-text]', { hasText: 'Läste in 2 poster från den gamla adressen' }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), ROUNDS_KEY), ROUNDS, 'the round is read in');
    assert.equal(await page.locator('[data-backup-continue]').getAttribute('href'), bookmark);
    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    pass('a moved visitor is offered 1 round in 2 entries, reads them in and is offered the way on');
    await page.goto(moved.url, { waitUntil: 'commit' });
    await page.waitForFunction(() => !location.hash.includes('flytt='));
    const at = new URL(page.url());
    assert.equal(at.pathname + at.search + at.hash, bookmark, 'the same data again goes straight to the bookmark');
    pass('the same data again goes straight to the bookmark');
    await context.close();
  } finally {
    await browser.close();
  }
}
