/* Verify built bookmarks, including the real PWA's offline navigation path.
 * No GPU or full-course boot is needed: close each view after its redirect.
 * node tools/check-legacy-links.mjs [distDir] [basePath]
 * The dist must have been built with that same BANVY_BASE. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { LEGACY_PAGES } from '../apps/golf/src/shell/legacy-links.mjs';
import { browserArgs } from './browser-args.mjs';

export async function checkLegacyLinks(dist, base = '/') {
  assert(base.startsWith('/') && base.endsWith('/'), 'base must start and end with /');
  const directory = path.resolve(dist);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, base, 'build and test base must match');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname.startsWith(base) ? decodeURIComponent(pathname.slice(base.length)) : null;
    const file = relative === null ? '' : path.resolve(directory, relative || 'index.html');
    if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end('Not found'); return;
    }
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
  const query = '?bana=visby&hal=3&vy=green&ljus=host&tee=2&skylt=0&ren=1&kiosk=1&q=lo&gl=1&hero=1&det=1&v2=0&ghibli=0&unknown=1';
  try {
    for (const file of Object.keys(LEGACY_PAGES)) {
      const html = await (await fetch(origin + base + file)).text();
      assert(html.includes('location.replace('), `${file} must be a generated redirect`);
      assert(!/@GEODATA|unpkg|VEC64/.test(html), `${file} must not contain a standalone renderer`);
    }
    assert.equal((await fetch(origin + base + 'missing3d.html')).status, 404);
    browser = await chromium.launch({ executablePath, args: browserArgs() });
    const check = async (context, phase) => {
      for (const file of Object.keys(LEGACY_PAGES)) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        const course = file === 'veckefjardensgc.html' ? 'veckefjarden' : file.replace('3d.html', '');
        const target = `${origin}${base}?bana=${course}&hal=3&vy=green&ljus=host&tee=2&skylt=0&ren=1&kiosk=1&q=lo&gl=1&hero=1&det=1#bookmark`;
        try {
          await page.goto(origin + base + file + query + '#bookmark', { waitUntil: 'commit' });
          await page.waitForURL(target, { waitUntil: 'commit', timeout: 30000 });
          assert.deepEqual(errors, [], `${phase}: ${file} page errors`);
          cases.push({ phase, file, target });
        } finally { await page.close(); }
      }
    };
    const cold = await browser.newContext({ serviceWorkers: 'block' });
    await check(cold, 'before-worker');
    await cold.close();

    const warm = await browser.newContext();
    const installer = await warm.newPage();
    await installer.goto(origin + base, { waitUntil: 'load' });
    await installer.evaluate(() => navigator.serviceWorker.ready);
    await installer.waitForFunction(() => !!navigator.serviceWorker.controller);
    await check(warm, 'installed-worker');
    await stop();
    await assert.rejects(fetch(origin + base), 'the server must really be stopped');
    await check(warm, 'offline-worker');
    await warm.close();
    return { base, cases: cases.length, phases: ['before-worker', 'installed-worker', 'offline-worker'], passed: true };
  } finally {
    await browser?.close();
    await stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await checkLegacyLinks(process.argv[2] || 'apps/golf/dist', process.argv[3] || '/'), null, 2));
}
