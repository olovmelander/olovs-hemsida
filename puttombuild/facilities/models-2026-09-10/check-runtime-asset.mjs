#!/usr/bin/env node
/* Exercise the published geometry through the application's real GLTFLoader.
 * This is an asset/frame audit. Browser review separately verifies contact
 * with the actual course terrain, using its active height bridge. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { loadPuttomFacilities } from '../../../apps/golf/src/engine/scenery/puttom-facilities.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const publicRoot = path.join(ROOT, 'apps/golf/public');
const require = createRequire(path.join(ROOT, 'apps/golf/package.json'));
const THREE = require('three');
const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'puttombuild/course-model.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'models/puttom/facilities-v1.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'model-plan.json'), 'utf8')).coveredInheritedIds;
const scene = new THREE.Scene(), unrelated = new THREE.Group(); scene.add(unrelated);
const datum = 23.6263;
function terrainH(x, z) {
  const anchor = manifest.facilities.reduce((best, facility) =>
    Math.hypot(facility.groundAnchorLocal[0] - x, facility.groundAnchorLocal[1] - z)
      < Math.hypot(best.groundAnchorLocal[0] - x, best.groundAnchorLocal[1] - z) ? facility : best);
  return anchor.groundAnchorRh2000M + datum;
}
const result = await loadPuttomFacilities({ THREE, scene, courseSlug: 'puttom', buildings: model.infra.buildings,
  terrainH, v2Active: true, verticalDatumOffsetMetres: datum, baseUrl: 'https://example.test/golf/',
  fetchImpl: async url => {
    const relative = new URL(url).pathname.replace(/^\/golf\//, '');
    const local = path.resolve(publicRoot, relative);
    assert(local.startsWith(publicRoot + path.sep), 'Unexpected asset path');
    const bytes = fs.readFileSync(local);
    return { ok: true, json: async () => JSON.parse(bytes.toString('utf8')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  },
});
const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), asset: manifest.asset,
  terrainTest: 'Nearest declared facility ground anchor plus current Puttom datum; visible terrain requires browser verification',
  ...result.report };
if (report.status === 'loaded') {
  assert.deepEqual([...result.replacedBuildingIds].sort(), [...expected].sort(), 'All planned inherited sources must be replaced exactly once');
  assert(scene.children.includes(unrelated), 'Existing terrain/scenery must survive installation');
  let maximumNormalError = 0, coordinateErrors = 0, projectionHeightErrors = 0;
  for (const node of result.root.children) {
    const facility = manifest.facilities.find(f => f.id === node.userData.facilityId);
    const box = new THREE.Box3().setFromObject(node);
    for (const axis of [0, 2]) {
      if (Math.abs(box.min.toArray()[axis] - facility.boundsLocalRh2000.min[axis]) > .001
          || Math.abs(box.max.toArray()[axis] - facility.boundsLocalRh2000.max[axis]) > .001) coordinateErrors++;
    }
    const shift = node.userData.placement.shift;
    if (facility.placement === 'absolute-rh2000' && Math.abs(shift - datum) > .00001) projectionHeightErrors++;
    node.traverse(mesh => {
      if (!mesh.isMesh) return;
      const normal = mesh.geometry.attributes.normal;
      assert(normal, 'All authored meshes need exported normals');
      for (let i = 0; i < normal.count; i++) maximumNormalError = Math.max(maximumNormalError,
        Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1));
    });
  }
  assert(maximumNormalError < .00001, 'Transformed normals must remain normalized');
  assert.equal(coordinateErrors, 0, 'Runtime horizontal coordinates changed');
  assert.equal(projectionHeightErrors, 0, 'Height bridge applied incorrectly');
  Object.assign(report, { sourceCoverage: expected.length, maximumNormalError, coordinateErrors, projectionHeightErrors,
    activeFootprints: result.facilityFootprints.length, liveSceneFacilities: result.root.children.length });
}
result.dispose();
assert.deepEqual(scene.children, [unrelated], 'Disposal must remove only authored geometry');
assert.equal(result.replacedBuildingIds.size, 0, 'Disposal must clear source replacement ownership');
fs.writeFileSync(path.join(HERE, 'runtime-asset-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, reason: report.reason, facilities: report.facilities.length,
  triangles: report.triangles, sourceCoverage: report.sourceCoverage, meshes: report.meshes,
  maximumNormalError: report.maximumNormalError, asset: manifest.asset }, null, 2));
if (report.status !== 'loaded') process.exitCode = 1;
