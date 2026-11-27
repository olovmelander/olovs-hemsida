/* Verify built bookmarks, including the real PWA's offline navigation path.
 * No GPU or full-course boot is needed: close each view after its redirect.
 *
 * node tools/check-legacy-links.mjs [distDir] [basePath]
 *   The dist must have been built with that same BANVY_BASE. A root build is
 *   served as Cloudflare serves it (/name.html answers 307 to /name, which serves
 *   the page), a subpath build as GitHub Pages serves it.
 * node tools/check-legacy-links.mjs --url <origin>
 *   The same bookmarks on a running host: a local `wrangler dev`, whose assets
 *   behave as Cloudflare's do, or the deployed site.
 *
 * Both also open the privacy and terms pages, which must be their own documents
 * and never the app shell, with and without the service worker. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { LEGACY_PAGES } from '../apps/golf/src/shell/legacy-links.mjs';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const QUERY = '?bana=visby&hal=3&vy=green&ljus=host&tee=2&skylt=0&ren=1&kiosk=1&q=lo&gl=1&hero=1&det=1&v2=0&ghibli=0&unknown=1';
const KEPT = 'hal=3&vy=green&ljus=host&tee=2&skylt=0&ren=1&kiosk=1&q=lo&gl=1&hero=1&det=1';
const POLICIES = { 'integritet.html': 'Integritetspolicy', 'villkor.html': 'Användarvillkor' };
const bare = file => file.replace(/\.html$/, '');
const count = (cases, kind) => cases.filter(c => c.kind === kind).length;
/* Cloudflare serves a page under both names; GitHub Pages is checked as published. */
const spellingsFor = host => file => (host === 'cloudflare' ? [file, bare(file)] : [file]);

async function checkBookmarks(context, origin, base, phase, spellings, cases) {
  for (const file of Object.keys(LEGACY_PAGES)) {
    for (const name of spellings(file)) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      const target = `${origin}${base}?bana=${LEGACY_PAGES[file]}&${KEPT}#bookmark`;
      try {
        await page.goto(origin + base + name + QUERY + '#bookmark', { waitUntil: 'commit' });
        await page.waitForURL(target, { waitUntil: 'commit', timeout: 30000 });
        assert.deepEqual(errors, [], `${phase}: ${name} page errors`);
        cases.push({ kind: 'bookmark', phase, file: name, target });
      } finally { await page.close(); }
    }
  }
}

async function checkPolicies(context, origin, base, phase, spellings, cases) {
  for (const [file, title] of Object.entries(POLICIES)) {
    for (const name of spellings(file)) {
      const page = await context.newPage();
      try {
        await page.goto(origin + base + name, { waitUntil: 'load' });
        const seen = await page.title();
        assert.ok(seen.startsWith(title), `${phase}: ${name} must open its own page, not "${seen}"`);
        cases.push({ kind: 'policy', phase, file: name, target: title });
      } finally { await page.close(); }
    }
  }
}

async function installWorker(context, origin, base) {
  const installer = await context.newPage();
  await installer.goto(origin + base, { waitUntil: 'load' });
  await installer.evaluate(() => navigator.serviceWorker.ready);
  await installer.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  return installer;
}

export async function checkLegacyLinks(dist, base = '/') {
  assert(base.startsWith('/') && base.endsWith('/'), 'base must start and end with /');
  const host = base === '/' ? 'cloudflare' : 'pages';
  const spellings = spellingsFor(host);
  const directory = path.resolve(dist);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, base, 'build and test base must match');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
  const isFile = file => file.startsWith(directory + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const relative = url.pathname.startsWith(base) ? decodeURIComponent(url.pathname.slice(base.length)) : null;
    let file = relative === null ? '' : path.resolve(directory, relative || 'index.html');
    if (host === 'cloudflare' && relative) {
      /* Workers static assets' default html_handling: drop .html with a 307, and
         serve name.html at /name. */
      if (/\.html$/.test(relative) && isFile(file)) {
        response.writeHead(307, { Location: base + bare(relative) + url.search }); response.end(); return;
      }
      if (!path.extname(relative) && isFile(file + '.html')) file += '.html';
    }
    if (!isFile(file)) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  };
  const legacyChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const executablePath = process.env.BANVY_CHROME || (fs.existsSync(legacyChrome) ? legacyChrome : undefined);
  let browser;
  const cases = [];
  try {
    for (const file of Object.keys(LEGACY_PAGES)) {
      const html = await (await fetch(origin + base + file)).text();
      assert(html.includes('location.replace('), `${file} must be a generated redirect`);
      assert(!/@GEODATA|unpkg|VEC64/.test(html), `${file} must not contain a standalone renderer`);
    }
    assert.equal((await fetch(origin + base + 'missing3d.html')).status, 404);
    browser = await chromium.launch({ executablePath, args: browserArgs() });
    const cold = await browser.newContext({ serviceWorkers: 'block' });
    await checkBookmarks(cold, origin, base, 'before-worker', spellings, cases);
    await checkPolicies(cold, origin, base, 'before-worker', spellings, cases);
    await cold.close();

    const warm = await browser.newContext();
    await installWorker(warm, origin, base);
    await checkBookmarks(warm, origin, base, 'installed-worker', spellings, cases);
    await checkPolicies(warm, origin, base, 'installed-worker', spellings, cases);
    await stop();
    await assert.rejects(fetch(origin + base), 'the server must really be stopped');
    await checkBookmarks(warm, origin, base, 'offline-worker', spellings, cases);
    await warm.close();
    return { base, host, cases: cases.length, bookmarks: count(cases, 'bookmark'), policies: count(cases, 'policy'),
      phases: ['before-worker', 'installed-worker', 'offline-worker'], passed: true };
  } finally {
    await browser?.close();
    await stop();
  }
}

export async function checkHostLinks(url) {
  const at = new URL(url);
  const origin = at.origin, base = at.pathname.replace(/\/?$/, '/');
  const host = base === '/' ? 'cloudflare' : 'pages';
  const spellings = spellingsFor(host);
  const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
  const cases = [];
  try {
    const cold = await browser.newContext({ serviceWorkers: 'block' });
    await checkBookmarks(cold, origin, base, 'before-worker', spellings, cases);
    await checkPolicies(cold, origin, base, 'before-worker', spellings, cases);
    await cold.close();
    const warm = await browser.newContext();
    await installWorker(warm, origin, base);
    await checkBookmarks(warm, origin, base, 'installed-worker', spellings, cases);
    await checkPolicies(warm, origin, base, 'installed-worker', spellings, cases);
    await warm.close();
    return { url: origin + base, host, cases: cases.length, bookmarks: count(cases, 'bookmark'), policies: count(cases, 'policy'),
      phases: ['before-worker', 'installed-worker'], passed: true };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--url');
  const result = at >= 0
    ? await checkHostLinks(args[at + 1])
    : await checkLegacyLinks(args[0] || 'apps/golf/dist', args[1] || '/');
  console.log(JSON.stringify(result, null, 2));
}
