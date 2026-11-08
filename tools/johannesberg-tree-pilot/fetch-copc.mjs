#!/usr/bin/env node
/* Cache whole Laserdata Skog COPC items for the Johannesberg tree pilot.

   usage: node --env-file=<.env> tools/johannesberg-tree-pilot/fetch-copc.mjs
            [--campaigns geo_data/course-v2/johannesberg/acquisition/laser-campaigns-2026-11-08.json]
            [--items id,id] [--cache johannesbergbuild/cache/trees-2026-11-08/copc]

   Each item is streamed over an authenticated request into the ignored cache
   and verified against the pinned byte size and SHA-256 before it is renamed
   into place; a verified file is never fetched again. The point cloud is
   personal data under the licence terms and never leaves the ignored cache.
   Nothing here prints or writes a credential.                               */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';
import { safeCopcUrl } from '../../packages/course-geo/copc-reader/copc-nodes.mjs';
import { PILOT } from './pilot-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const campaignsPath = path.resolve(ROOT, flag('campaigns', PILOT.laserCampaigns));
const cacheDir = path.resolve(ROOT, flag('cache', PILOT.copcCache));
const only = (flag('items', PILOT.laserItems.join(',')) || '').split(',').filter(Boolean);

export function sha256OfFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(8 << 20);
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

async function main() {
  const credentials = lantmaterietCredentials();
  if (!credentials) throw new Error('Lantmäteriet credentials are required');
  const headers = authorizationHeaders(credentials);
  const campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
  fs.mkdirSync(cacheDir, { recursive: true });
  const ledger = [];
  for (const item of campaigns.items.filter(entry => only.includes(entry.id))) {
    const asset = item.assets.data;
    const url = safeCopcUrl(asset.href);
    const file = path.join(cacheDir, path.basename(url.pathname));
    if (fs.existsSync(file) && fs.statSync(file).size === asset.bytes && sha256OfFile(file) === asset.sha256) {
      console.log(`${item.id}: cached and verified`);
      ledger.push({ itemId: item.id, file: path.relative(ROOT, file).replaceAll('\\', '/'), bytes: asset.bytes, sha256: asset.sha256, verified: true, fetched: false });
      continue;
    }
    const partial = `${file}.partial`;
    const started = performance.now();
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok) throw new Error(`${item.id}: HTTP ${response.status}`);
    const out = fs.createWriteStream(partial);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      hash.update(chunk);
      bytes += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
    const sha256 = hash.digest('hex');
    if (bytes !== asset.bytes || sha256 !== asset.sha256) {
      fs.rmSync(partial, { force: true });
      throw new Error(`${item.id}: ${bytes} bytes sha256 ${sha256} does not match the pin (${asset.bytes}, ${asset.sha256})`);
    }
    fs.renameSync(partial, file);
    const seconds = (performance.now() - started) / 1000;
    console.log(`${item.id}: ${(bytes / 1e6).toFixed(1)} MB in ${seconds.toFixed(0)} s, sha256 verified`);
    ledger.push({ itemId: item.id, file: path.relative(ROOT, file).replaceAll('\\', '/'), bytes, sha256, verified: true, fetched: true });
  }
  fs.writeFileSync(path.join(cacheDir, 'ledger.json'), JSON.stringify({ campaigns: path.relative(ROOT, campaignsPath).replaceAll('\\', '/'), items: ledger }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`fetch-copc failed: ${error.message}`); process.exitCode = 1; });
}
