#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'apps/golf/dist');
const ASSETS = path.join(DIST, 'assets');

if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  throw new Error('golf production build is missing; run the Vite build first');
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
