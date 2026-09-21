import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build, createServer } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { LEGACY_PAGES } from '../apps/golf/src/shell/legacy-links.mjs';
import { legacyPageRedirectsPlugin } from './legacy-page-redirects.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'banvy-links-'));
  roots.push(root);
  writeFileSync(path.join(root, 'index.html'), '<p>player fixture</p>');
  return root;
};

function redirected(html, file, base) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(html).not.toMatch(/@GEODATA|unpkg|<script[^>]+src=/);
  const link = {};
  let replaced;
  vm.runInNewContext(scripts[0][1], { URLSearchParams,
    location: { pathname: base + file,
      search: '?bana=visby&hal=3&vy=green&ljus=host&tee=2&skylt=0&ren=1&kiosk=1&q=lo&gl=1&hero=1&det=1&v2=0&ghibli=0&unknown=1',
      hash: '#bookmark', replace(value) { replaced = value; } },
    document: { getElementById() { return link; } },
  });
  expect(link.href).toBe(replaced);
  const course = file === 'veckefjardensgc.html' ? 'veckefjarden' : file.replace('3d.html', '');
  expect(replaced).toBe(`${base}?bana=${course}&hal=3&vy=green&ljus=host&tee=2&skylt=0&ren=1&kiosk=1&q=lo&gl=1&hero=1&det=1#bookmark`);
}

describe.each(['/', '/olovs-hemsida/'])('legacy URLs at %s', base => {
  it('builds seven executable redirects with the original view and no old engine', async () => {
    const root = fixture();
    await build({ root, base, configFile: false, publicDir: false, logLevel: 'silent',
      plugins: [legacyPageRedirectsPlugin()] });
    for (const file of Object.keys(LEGACY_PAGES)) redirected(readFileSync(path.join(root, 'dist', file), 'utf8'), file, base);
  });

  it('serves the same documents during Vite development', async () => {
    const root = fixture();
    const server = await createServer({ root, base, configFile: false, logLevel: 'silent',
      plugins: [legacyPageRedirectsPlugin()], server: { host: '127.0.0.1', port: 0 } });
    try {
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      for (const file of Object.keys(LEGACY_PAGES)) {
        const response = await fetch(origin + base + file);
        expect(response.status).toBe(200);
        redirected(await response.text(), file, base);
      }
    } finally { await server.close(); }
  });
});
