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
const chunks = fs.readdirSync(ASSETS).filter(file => /^v2-selection-[A-Za-z0-9_-]+\.js$/.test(file));
if (chunks.length !== 1) throw new Error(`expected one isolated v2 selection chunk, found ${chunks.length}`);
const chunk = chunks[0];
const bytes = fs.statSync(path.join(ASSETS, chunk)).size;
if (bytes > 64 * 1024) throw new Error(`v2 selection chunk is ${bytes} bytes; budget is 65536`);

const serviceWorker = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
if (serviceWorker.includes(chunk) || serviceWorker.includes('v2-selection-')) {
  throw new Error('v2 selection debug chunk leaked into the production PWA precache');
}
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (html.includes(chunk) || html.includes('v2-selection-')) {
  throw new Error('v2 selection debug chunk leaked into initial HTML');
}
console.log(`course-v2 app isolation passed: ${chunk}, ${bytes} bytes, not precached`);
