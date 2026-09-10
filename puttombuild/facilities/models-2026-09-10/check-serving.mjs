#!/usr/bin/env node
/* Inspect actual generated Workbox routes without starting a browser/network. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const routes = [];
const workbox = new Proxy({
  registerRoute: (match, strategy) => routes.push({ match, strategy }),
  precacheAndRoute() {}, cleanupOutdatedCaches() {}, clientsClaim() {},
  createHandlerBoundToURL() { return () => {}; },
}, { get: (target, name) => target[name] ?? class {
  constructor(options) { this.kind = name; this.options = options; }
} });
const define = (_dependencies, factory) => factory(workbox);
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'apps/golf/dist/sw.js'), 'utf8'),
  { define, self: { define, skipWaiting() {} }, URL }, { timeout: 1000 });
const manifest = routes.find(r => r.strategy?.options?.cacheName === 'banvy-puttom-facilities-manifest');
const geometry = routes.find(r => r.strategy?.options?.cacheName === 'banvy-puttom-facilities');
assert(manifest && geometry, 'Built service worker must include both Puttom routes');
assert.equal(manifest.strategy.kind, 'NetworkFirst');
assert.equal(geometry.strategy.kind, 'CacheFirst');
assert.equal(geometry.strategy.options.matchOptions?.ignoreSearch ?? false, false);
const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
for (const prefix of ['', '/olovs-hemsida']) {
  const url = suffix => new URL(`https://example.test${prefix}/models/puttom/${suffix}`);
  assert(manifest.match({ url: url('facilities-v1.json'), sameOrigin: true }));
  for (const value of [hash, otherHash]) assert(geometry.match({ url: url(`facilities-v1.glb?sha256=${value}`), sameOrigin: true }));
  assert(!geometry.match({ url: url('facilities-v1.glb'), sameOrigin: true }));
  assert(!geometry.match({ url: url('facilities-v1.glb?sha256=invalid'), sameOrigin: true }));
  assert(!geometry.match({ url: url(`facilities-v1.glb?sha256=${hash}`), sameOrigin: false }));
}
for (const filename of ['facilities-v1.json', 'facilities-v1.glb']) {
  const headers = fs.readFileSync(path.join(ROOT, 'apps/golf/dist/_headers'), 'utf8');
  assert(headers.includes(`/models/puttom/${filename}\n  Cache-Control: no-cache`)
    || headers.includes(`/models/puttom/${filename}\r\n  Cache-Control: no-cache`), 'Built CDN headers must revalidate mutable filenames');
}
const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'passed',
  manifestStrategy: 'NetworkFirst', geometryStrategy: 'CacheFirst',
  geometryCacheKey: 'Full URL including complete SHA-256 query',
  geometryRevisionsRetained: 2, bareGeometryCached: false, subpathRoutesChecked: true,
  mutableHttpResponses: 'no-cache', reference: 'Existing pack.bin content query convention' };
fs.writeFileSync(path.join(HERE, 'serving-cache-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
