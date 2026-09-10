#!/usr/bin/env node
/* Validate the published Blender bytes through the application's real loader.
 * This catches axis, source-node, ownership and checksum problems before the
 * more expensive complete-course browser review. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadVisbyFacilities } from '../../apps/golf/src/engine/scenery/visby-facilities.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'apps/golf/package.json'));
const THREE = require('three');
const publicRoot = path.join(ROOT, 'apps/golf/public');
const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'visbybuild/course-model.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'models/visby/facilities-v1.json'), 'utf8'));
const scene = new THREE.Scene();
const terrain = fs.readFileSync(path.join(ROOT, 'visbybuild/cache/terrain-review/terrain-1m.f32'));
function terrainH(x, z) {
  const col = x + 2048, row = z + 2048;
  const c = Math.floor(col), r = Math.floor(row), fx = col - c, fz = row - r;
  const h = (dc, dr) => terrain.readFloatLE(((r + dr) * 4097 + c + dc) * 4);
  return (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fz)
    + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fz;
}
const result = await loadVisbyFacilities({ THREE, scene, courseSlug: 'visby', buildings: model.infra.buildings,
  terrainH, v2Active: true, verticalDatumOffsetMetres: 0, baseUrl: 'http://localhost/',
  fetchImpl: async url => {
    const local = path.resolve(publicRoot, '.' + new URL(url).pathname);
    if (!local.startsWith(publicRoot + path.sep)) throw new Error('Unexpected asset path');
    const bytes = fs.readFileSync(local);
    return { ok: true, json: async () => JSON.parse(bytes.toString('utf8')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  },
});
const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), asset: manifest.asset,
  ...result.report, liveSceneFacilities: scene.children[0]?.children.length ?? 0 };
const out = path.join(ROOT, 'visbybuild/cache/facilities-runtime');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'asset-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, asset: report.asset, facilities: report.liveSceneFacilities,
  meshes: report.meshes, triangles: report.triangles, ...(report.reason ? { reason: report.reason } : {}),
  report: path.relative(ROOT, path.join(out, 'asset-audit.json')) }, null, 2));
result.dispose();
if (report.status !== 'loaded') process.exitCode = 1;
