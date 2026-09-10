/* Scoped acceptance of both Veckefjarden publications after a tee review.
 * Optional first argument points to a production asset directory.
 * This checks implementation consistency; unresolved positions stay unresolved.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sha256File, validateSourceManifest } from '../../packages/course-geo/manifest.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { prepareOrthoVegetation } from './refresh-ortho-vegetation.mjs';
import { auditTeeRuntime } from './audit-tee-runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const publicDir = path.resolve(root, process.argv[2] ?? 'apps/golf/public');
const model = read('geobuild/course-model.json');
const source = read('geo_data/course-v2/veckefjarden/source-manifest.json');
assert.deepEqual(validateSourceManifest(source, {
  catalog: read('geo_data/course-v2/source-catalog.json'), repoRoot: root,
}), [], 'Veckefjarden source manifest is inconsistent');

for (const file of ['ortho-alignment-audit.json', 'tee-coordinate-review.json']) {
  const report = read('geo_data/course-v2/veckefjarden/acquisition/' + file);
  assert.equal(report.state, 'passed', file + ' did not pass');
  assert.equal(report.inputs.modelSha256, sha256File(path.join(root, 'geobuild/course-model.json')), file + ' has a stale model');
  assert.equal(report.inputs.ledgerSha256 ?? report.inputs.reviewSha256,
    sha256File(path.join(root, 'geobuild/mapping/lm-ortho-review.json')), file + ' has a stale review');
}
assert.equal(model.holes.length, 18);
assert.ok(model.holes.every(h => h.tees.inferPads === false), 'A reviewed hole can still invent runtime decks');
assert.ok(model.holes.every(h => h.tees.pads.every(p => p.prov !== 'synth')), 'A synthetic tee footprint remains');
const vectors = JSON.parse(inflateStream(readPack(fs.readFileSync(path.join(publicDir, 'courses/veckefjarden/pack.bin'))).sv));
const runtime = auditTeeRuntime(model, vectors);
assert.equal(runtime.summary.references, 108);
assert.deepEqual(runtime.issues, []);
assert.equal(runtime.summary.addedSyntheticPads, 0);
assert.equal(runtime.summary.renderedPairsOutsideSourcePads, 0);
for (const hole of runtime.holes) for (const mark of hole.marks) {
  assert.deepEqual(mark.cameraC, mark.runtimeC, 'Camera horizontal reference changed');
}
const graph = await prepareOrthoVegetation({ publicDir });
assert.equal(graph.blocked, false, 'A crown centre intersects reviewed turf');
assert.equal(graph.report.changedTiles, 0, 'Stand exclusions have not been published');
assert.equal(graph.report.outputGround.sha256, graph.report.inputGround.sha256, 'Source or shared graph publication is stale');
console.log(JSON.stringify({ state: 'passed', publicDir, references: runtime.summary.references,
  syntheticPadsAdded: 0, renderedPairsOutsideSourcePads: 0,
  unresolvedReferences: model.holes.flatMap(h => h.tees.marks).filter(m => m.associationConfidence === 'unresolved').length,
  terrainBridgeMaximumApproximationMetres: runtime.bridge.maxResidualM,
  sharedGroundSha256: graph.report.outputGround.sha256 }, null, 2));
