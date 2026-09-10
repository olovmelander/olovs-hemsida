/* Independent production-asset audit. Run with node after the Blender export.
 * Uses the production loader and real GLTFLoader against the shipping pack and
 * published 1 m terrain. No Blender connection and no source files are changed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// This CLI lives outside apps/golf, whose package owns the Three dependency.
import * as THREE from '../../apps/golf/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../apps/golf/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { loadArchitectureFixture } from '../architecture-fixture.mjs';
import { readChunk, sha256Bytes } from '../../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../packages/course-v2/terrain-grid.mjs';
import { loadLidingoFacilities, LIDINGO_PRIMARY_BUILDING_IDS } from '../../apps/golf/src/engine/scenery/lidingo-facilities.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT = 'lidingobuild/facilities/production-independent-audit.json';
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const json = relative => JSON.parse(read(relative));
const sha = relative => createHash('sha256').update(read(relative)).digest('hex');
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const checks = [], details = {};
async function check(name, action) {
  try {
    const result = await action();
    checks.push({ name, passed: true });
    if (result !== undefined) details[name] = result;
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
  }
}

function terrainSampler(manifest) {
  const graph = json('apps/golf/public/lidingo-ground-graph-report.json');
  const ground = json(`apps/golf/public/grounds/lidingo/ground-v2-${graph.graph.groundManifestSha256}.json`);
  const anchors = manifest.facilities.map(f => [677700.5 + f.groundAnchorLocal[0], 6586399.5 - f.groundAnchorLocal[1]]);
  const tiles = ground.tiles.filter(t => t.lod === 0 && anchors.some(([e, n]) => e >= t.bounds.minEasting &&
    e <= t.bounds.maxEasting && n >= t.bounds.minNorthing && n <= t.bounds.maxNorthing)).map(t => {
    const encoded = read(`apps/golf/public/${t.layers.terrain.url}`);
    assert.equal(sha256Bytes(encoded), t.layers.terrain.sha256);
    const { header, payload } = readChunk(encoded);
    assert.equal(header.grid.sampleSpacingMetres, 1);
    return { ...t, grid: header.grid, heights: decodeTerrainGrid(payload, header.grid) };
  });
  return { chunkSha256: tiles.map(t => t.layers.terrain.sha256), height: (x, z) => {
    const e = 677700.5 + x, n = 6586399.5 - z;
    const tile = tiles.find(t => e >= t.bounds.minEasting && e <= t.bounds.maxEasting &&
      n >= t.bounds.minNorthing && n <= t.bounds.maxNorthing);
    assert.ok(tile, `No published terrain for ${x},${z}`);
    const { bounds: b, grid: g, heights: h } = tile, u = e - b.minEasting, v = b.maxNorthing - n;
    const i = Math.min(g.width - 2, Math.floor(u)), j = Math.min(g.height - 2, Math.floor(v));
    const a = u - i, c = v - j, k = j * g.width + i;
    return (h[k] * (1 - a) + h[k + 1] * a) * (1 - c) + (h[k + g.width] * (1 - a) + h[k + g.width + 1] * a) * c;
  } };
}

let installed = null;
try {
  const manifestPath = 'apps/golf/public/models/lidingo/facilities-v1.json';
  const manifest = json(manifestPath), assetPath = `apps/golf/public/${manifest.asset.url}`;
  assert.equal(manifest.asset.url, `models/lidingo/facilities-${manifest.asset.sha256}.glb`);
  const bytes = read(assetPath), buffer = arrayBuffer(bytes);
  const baseline = json('lidingobuild/facilities/model-reference-validation.json');
  const { model } = loadArchitectureFixture();
  const originalBuildings = JSON.stringify(model.infra.buildings);
  const sourceRoofs = json('lidingobuild/mapping/building-roof-meshes.json');
  const terrain = terrainSampler(manifest), scene = new THREE.Scene();
  const fetchImpl = async url => url.endsWith('.json') ? { ok: true, json: async () => structuredClone(manifest) }
    : { ok: true, arrayBuffer: async () => buffer.slice(0) };
  const context = { THREE, scene, courseSlug: 'lidingo', buildings: model.infra.buildings, terrainH: terrain.height,
    v2Active: true, verticalDatumOffsetMetres: 0, baseUrl: 'https://local-audit.invalid/golf/', fetchImpl };
  details.asset = { path: assetPath, sha256: sha(assetPath), bytes: bytes.length,
    manifestPath, manifestSha256: sha(manifestPath), terrainChunkSha256: terrain.chunkSha256 };

  await check('Original source pack roofs footprints facilities and input hashes preserved', () => {
    const receipts = baseline.sourceFiles.map(receipt => {
      const actual = sha(receipt.path);
      assert.equal(actual, receipt.sha256, `Changed original source: ${receipt.path}`);
      return { path: receipt.path, sha256: actual, preserved: true };
    });
    assert.equal(sha(baseline.output.path), baseline.output.sha256, 'Reference payload changed after baseline validation');
    assert.equal(sourceRoofs.buildings.length, 5);
    assert.equal(sourceRoofs.buildings.reduce((n, b) => n + b.mesh.triangleIndices.length / 3, 0), 7069);
    return { receipts, referencePayloadSha256: baseline.output.sha256,
      sourceRoofBuildings: 5, sourceRoofTriangles: 7069, sourceGeometryModified: false };
  });

  await check('GLB is static self-contained geometry without imagery or reference meshes', () => {
    const view = new DataView(buffer);
    assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
    assert.equal(view.getUint32(8, true), bytes.length);
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))).trim());
    assert.equal(doc.asset.version, '2.0'); assert.equal(doc.scenes.length, 1);
    for (const field of ['images', 'textures', 'cameras', 'animations', 'skins']) assert.ok(!doc[field]?.length, field);
    assert.ok(!doc.buffers?.some(b => b.uri)); assert.ok(!doc.extensions?.KHR_lights_punctual);
    assert.ok(doc.nodes.every(n => !/orthophoto|source terrain|reference board|measured roof TIN/i.test(n.name ?? '')));
    const roots = doc.scenes[doc.scene ?? 0].nodes.map(i => doc.nodes[i]);
    assert.equal(roots.length, manifest.facilities.length);
    for (const facility of manifest.facilities) {
      const nodes = roots.filter(n => n.name === facility.nodeName);
      assert.equal(nodes.length, 1, facility.nodeName);
      assert.equal(nodes[0].extras.facilityId, facility.id);
      assert.deepEqual(nodes[0].extras.sourceBuildingIds, facility.sourceBuildingIds);
      assert.ok(Array.isArray(facility.authoredParts) && facility.authoredParts.length > 0, facility.id);
      assert.ok(facility.evidence && Object.keys(facility.evidence).length > 0, facility.id);
    }
    const primitives = doc.meshes.reduce((n, m) => n + m.primitives.length, 0);
    assert.ok(primitives <= 256, `Primitive draw budget exceeded: ${primitives}`);
    return { topLevelFacilities: roots.length, nodes: doc.nodes.length, materials: doc.materials.length,
      meshPrimitives: primitives, primitiveBudget: 256, images: 0,
      drawcallNote: 'Mesh/material primitives before renderer shadow passes and batching.' };
  });

  await check('Production loader and real GLTFLoader install all facilities atomically', async () => {
    installed = await loadLidingoFacilities(context);
    assert.equal(installed.report.status, 'loaded', installed.report.reason);
    assert.equal(installed.report.assetSha256, manifest.asset.sha256);
    const expected = manifest.facilities.flatMap(f => f.sourceBuildingIds);
    assert.equal(new Set(expected).size, expected.length);
    assert.deepEqual([...installed.replacedBuildingIds].sort(), [...expected].sort());
    assert.ok(LIDINGO_PRIMARY_BUILDING_IDS.every(id => installed.replacedBuildingIds.has(id)));
    assert.equal(installed.report.replacesCourtyard, true); assert.equal(installed.report.replacesRangeFacilities, true);
    assert.equal(installed.report.facilities.length, manifest.facilities.length);
    assert.ok(installed.report.triangles > 1000 && installed.report.triangles < 200000, 'Production triangle budget');
    assert.ok(installed.report.meshes <= 256, 'Production draw budget');
    assert.equal(installed.report.triangles, manifest.facilities.reduce((n, f) => n + f.triangles, 0));
    assert.equal(installed.report.meshes, manifest.facilities.reduce((n, f) => n + f.meshCount, 0));
    assert.deepEqual(scene.children, [installed.root]);
    return { ...installed.report, triangleBudget: 200000, meshBudget: 256 };
  });

  await check('Declared bounds match actual world geometry with RH2000 preserved once', () => {
    assert.equal(installed?.report.status, 'loaded', 'Asset is not installed');
    let maximumBoundsErrorMetres = 0, maximumGroundResidualMetres = 0;
    for (const facility of manifest.facilities) {
      const report = installed.report.facilities.find(f => f.id === facility.id);
      assert.equal(report.shift, 0); assert.equal(report.mode, 'absolute-rh2000');
      for (const edge of ['min', 'max']) for (let i = 0; i < 3; i++) {
        maximumBoundsErrorMetres = Math.max(maximumBoundsErrorMetres,
          Math.abs(report.boundsBeforePlacement[edge][i] - facility.boundsLocalRh2000[edge][i]));
      }
      maximumGroundResidualMetres = Math.max(maximumGroundResidualMetres, Math.abs(report.groundResidualMetres));
    }
    assert.ok(maximumBoundsErrorMetres <= .002, `Geometry bounds mismatch ${maximumBoundsErrorMetres}m`);
    assert.ok(maximumGroundResidualMetres <= .05, `Ground anchor differs from published 1m terrain ${maximumGroundResidualMetres}m`);
    return { maximumBoundsErrorMetres, maximumGroundResidualMetres, verticalRuntimeShiftMetres: 0,
      note: 'Export already restores the Blender 25m height origin; runtime adds no second restoration.' };
  });

  await check('Five main buildings retain plausible source roof elevations and evidence', () => {
    assert.equal(installed?.report.status, 'loaded', 'Asset is not installed');
    return LIDINGO_PRIMARY_BUILDING_IDS.map(id => {
      const source = sourceRoofs.buildings.find(b => b.sourceFootprintId === id);
      const facility = manifest.facilities.find(f => f.sourceBuildingIds.includes(id));
      const sourceHeight = source.mesh.statistics.roofHeightRH2000;
      const bounds = installed.report.facilities.find(f => f.id === facility.id).boundsBeforePlacement;
      assert.ok(bounds.min[1] <= sourceHeight.minimum + .5, `Missing lower building envelope: ${id}`);
      assert.ok(Math.abs(bounds.max[1] - sourceHeight.maximum) <= 4, `Implausible roof height change: ${id}`);
      return { sourceBuildingId: id, facilityId: facility.id, sourceRoofMinimumRH2000: sourceHeight.minimum,
        sourceRoofMaximumRH2000: sourceHeight.maximum, modelMinimumRH2000: bounds.min[1], modelMaximumRH2000: bounds.max[1],
        maximumHeightDifferenceMetres: bounds.max[1] - sourceHeight.maximum,
        note: 'Broad 4m sanity tolerance permits authored chimneys/vents; this is not a survey fit metric.',
        authoredParts: facility.authoredParts, evidence: facility.evidence };
    });
  });

  await check('Real parsed asset rejects duplicate facility children without replacing source geometry', async () => {
    const duplicateScene = new THREE.Scene();
    const result = await loadLidingoFacilities({ ...context, scene: duplicateScene, parseGlb: async data => {
      const gltf = await new GLTFLoader().parseAsync(data, '');
      gltf.scene.add(gltf.scene.children[0].clone(true));
      return gltf;
    } });
    assert.equal(result.report.status, 'fallback'); assert.match(result.report.reason, /duplicated/);
    assert.equal(result.replacedBuildingIds.size, 0); assert.equal(result.facilityFootprints.length, 0);
    assert.equal(result.report.replacesCourtyard, false); assert.equal(result.report.replacesRangeFacilities, false);
    assert.equal(duplicateScene.children.length, 0);
    return { fallback: true, reason: result.report.reason, sourceBuildingsReplaced: 0 };
  });

  await check('Source data and retained roof inspection remain intact after load and disposal', () => {
    assert.equal(JSON.stringify(model.infra.buildings), originalBuildings);
    const main = read('apps/golf/src/main.js').toString('utf8');
    assert.ok(main.includes("get('buildingGeometry') !== 'source'"));
    assert.ok(main.includes('!SCENERY?.loadFacilities || !authoredFacilityView'));
    assert.ok(main.includes("get('buildingGeometry') === 'source'"));
    installed?.dispose();
    assert.equal(scene.children.length, 0); assert.equal(installed.replacedBuildingIds.size, 0);
    assert.equal(installed.facilityFootprints.length, 0);
    return { sourceBuildingDataUnchanged: true, sourceModeBypassesFacilityLoader: true,
      disposalClearsGeometryReplacementIdsAndExclusions: true, sourceRoofTriangles: 7069 };
  });
} catch (error) {
  checks.push({ name: 'Audit setup', passed: false, error: error.message });
} finally {
  installed?.dispose();
}
const report = { schemaVersion: 1, groundId: 'lidingo',
  status: checks.length && checks.every(c => c.passed) ? 'passed' : 'failed', checks, details,
  limitations: ['Checks source preservation, runtime contract, static asset scope and basic elevation sanity; appearance still needs visual review.',
    'Primitive counts exclude renderer shadow passes; browser profiling remains the runtime performance check.'] };
fs.writeFileSync(path.join(ROOT, REPORT), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks: checks.length,
  failures: checks.filter(c => !c.passed), report: REPORT }, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
