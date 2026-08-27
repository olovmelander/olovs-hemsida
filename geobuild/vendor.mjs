/* Cache the libraries the page loads from a CDN.

   Not for the page's benefit -- it fetches them itself and that is fine -- but for the
   screenshot harness. Chromium cannot complete a TLS handshake through this
   environment's egress proxy, so a headless run of the page would get no three.js at
   all and photograph a blank canvas, which is exactly the failure a screenshot test is
   supposed to catch and would instead be caused by. curl can reach the proxy, so the
   files are fetched here and replayed into the browser from disk.                    */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './lib.mjs';

const THREE = '0.185.1';
const FILES = [
  [`https://unpkg.com/three@${THREE}/build/three.webgpu.js`, `three.webgpu.js`],
  [`https://unpkg.com/three@${THREE}/build/three.core.js`, `three.core.js`],
  [`https://unpkg.com/three@${THREE}/build/three.tsl.js`, `three.tsl.js`],
  [`https://unpkg.com/three@${THREE}/examples/jsm/controls/OrbitControls.js`, `OrbitControls.js`],
  [`https://unpkg.com/three@${THREE}/examples/jsm/objects/SkyMesh.js`, `SkyMesh.js`],
  [`https://unpkg.com/three@${THREE}/examples/jsm/tsl/display/BloomNode.js`, `BloomNode.js`],
  [`https://unpkg.com/three@${THREE}/examples/jsm/tsl/display/GaussianBlurNode.js`, `GaussianBlurNode.js`],
  [`https://unpkg.com/three@${THREE}/examples/jsm/tsl/display/RGBShiftNode.js`, `RGBShiftNode.js`],
];

const dir = path.join(CACHE, 'vendor');
fs.mkdirSync(dir, { recursive: true });
const force = process.argv.includes('--force');

for (const [url, name] of FILES) {
  const out = path.join(dir, name);
  if (fs.existsSync(out) && !force) { console.log(`${name}: cached`); continue; }
  process.stdout.write(`${name}: `);
  const r = await fetch(url);
  if (!r.ok) { console.log(`HTTP ${r.status} — skipped`); continue; }
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(out, b);
  console.log(`${(b.length / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(dir, 'manifest.json'),
  JSON.stringify({ three: THREE, files: FILES.map(f => f[1]) }, null, 1));
console.log(`vendor cache: ${path.relative(process.cwd(), dir)}`);
