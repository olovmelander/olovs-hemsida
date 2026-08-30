#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'apps/golf/dist');
const ASSETS = path.join(DIST, 'assets');

if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  throw new Error('golf production build is missing; run the Vite build first');
}

const previewRoot = path.join(DIST, 'v2/puttom');
const descriptorBytes = fs.readFileSync(path.join(previewRoot, 'preview.json'));
const descriptorSha256 = createHash('sha256').update(descriptorBytes).digest('hex');
if (descriptorSha256 !== PUTTOM_PREVIEW_CONFIG.descriptorSha256) {
  throw new Error(`built Puttom descriptor is ${descriptorSha256}; expected ${PUTTOM_PREVIEW_CONFIG.descriptorSha256}`);
}
const preview = assertTerrainPreview(JSON.parse(descriptorBytes));
if (preview.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedTileCount ||
    preview.frame.fingerprint !== PUTTOM_PREVIEW_CONFIG.frameFingerprint) {
  throw new Error('built Puttom preview does not match its reviewed tile/frame contract');
}
const referenced = new Set();
for (const tile of preview.tiles) {
  const file = path.resolve(previewRoot, tile.reference.url);
  if (!file.startsWith(`${previewRoot}${path.sep}`)) throw new Error('built Puttom preview asset escaped its root');
  verifyChunkAsset(tile.reference, fs.readFileSync(file));
  referenced.add(path.relative(previewRoot, file));
}
const terrainDirectory = path.join(previewRoot, 'grounds/puttom/terrain');
const retained = fs.readdirSync(terrainDirectory)
  .filter(file => file.endsWith('.bvch'))
  .map(file => path.join('grounds/puttom/terrain', file));
if (retained.length !== referenced.size || retained.some(file => !referenced.has(file))) {
  throw new Error('built Puttom preview contains missing or unreferenced BVCH files');
}
const assets = fs.readdirSync(ASSETS);
const expected = [
  /^v2-terrain-preview-loader-[A-Za-z0-9_-]+\.js$/,
  /^v2-terrain-batch-[A-Za-z0-9_-]+\.js$/,
];
const chunks = expected.map(pattern => {
  const matches = assets.filter(file => pattern.test(file));
  if (matches.length !== 1) throw new Error(`expected one isolated ${pattern} chunk, found ${matches.length}`);
  return matches[0];
});
for (const chunk of chunks) {
  const bytes = fs.statSync(path.join(ASSETS, chunk)).size;
  if (bytes > 64 * 1024) throw new Error(`${chunk} is ${bytes} bytes; budget is 65536`);
}

const serviceWorker = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
if (chunks.some(chunk => serviceWorker.includes(chunk)) ||
    serviceWorker.includes('v2-terrain-preview-loader-') ||
    serviceWorker.includes('v2-terrain-batch-') ||
    serviceWorker.includes('terrain-render-data-')) {
  throw new Error('v2 terrain preview chunks leaked into the production PWA precache');
}
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (chunks.some(chunk => html.includes(chunk))) {
  throw new Error('v2 terrain preview chunks leaked into initial HTML');
}
console.log(`course-v2 app isolation passed: ${chunks.join(', ')}, not precached`);
