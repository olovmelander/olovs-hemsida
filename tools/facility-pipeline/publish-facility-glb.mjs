#!/usr/bin/env node
/* Publish a ground's authored campus: the GLB under its own hash and the manifest beside it.

   node tools/facility-pipeline/publish-facility-glb.mjs --from <dir with facilities.glb + facilities-v1.json> [--check]

   The manifest's hash and bytes must be the GLB's. A GLB this manifest no longer names is removed: the
   ground's loader reads only facilities-v1.json, and the old generation stays in git. --check writes nothing. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function publishFacility({ from, publicRoot = path.join(ROOT, 'apps/golf/public'), check = false }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(from, 'facilities-v1.json'), 'utf8'));
  const glb = fs.readFileSync(path.join(from, 'facilities.glb'));
  const sha256 = createHash('sha256').update(glb).digest('hex');
  assert.equal(manifest.asset.sha256, sha256, 'the manifest describes another GLB');
  assert.equal(manifest.asset.bytes, glb.length);
  assert.match(manifest.groundId, /^[a-z0-9-]+$/);
  assert.equal(manifest.asset.url, `models/${manifest.groundId}/facilities-${sha256}.glb`);
  const dir = path.join(publicRoot, 'models', manifest.groundId);
  const own = path.basename(manifest.asset.url);
  const stale = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^facilities-[a-f0-9]{64}\.glb$/.test(f) && f !== own) : [];
  if (!check) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, own), glb);
    fs.writeFileSync(path.join(dir, 'facilities-v1.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    for (const f of stale) fs.unlinkSync(path.join(dir, f));
  }
  return { groundId: manifest.groundId, asset: manifest.asset.url, bytes: glb.length, facilities: manifest.facilities.length, stale };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--from');
  assert(i > 0 && process.argv[i + 1], 'usage: publish-facility-glb.mjs --from <dir> [--check]');
  console.log(JSON.stringify(publishFacility({ from: path.resolve(process.argv[i + 1]), check: process.argv.includes('--check') }), null, 1));
}
