#!/usr/bin/env node
/* Reapply completed vectors onto the current model without rebuilding terrain
 * or replacing newer tee, OB, building, water and vegetation work. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { REVIEW_PATH, APPROACH_PATH, BUNKER_PATH, validateReviewSources, adoptReviewedSource,
  applyReviewedSurfaces, preservedModel, preservedSource, preservedGround } from './apply-reviewed-surfaces.mjs';
import { openPublishedGround, createPublishedGroundLookup } from '../packages/course-v2/published-ground-lookup.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const write = (p, v) => fs.writeFileSync(path.join(root, p), JSON.stringify(v, null, 2) + '\n');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const review = read(REVIEW_PATH), approaches = read(APPROACH_PATH), bunkers = read(BUNKER_PATH);
validateReviewSources(review, approaches, bunkers);
const previousSource = read('lidingobuild/mapping/playing-surfaces.geojson');
const collection = adoptReviewedSource(previousSource, review, bunkers);
const opened = openPublishedGround(fs, path, path.join(root, 'apps/golf/public'), 'lidingo');
const lookup = createPublishedGroundLookup(opened.ground, opened.readAsset);
const before = read('lidingobuild/course-model.json');
const model = applyReviewedSurfaces(before, collection, review, approaches, bunkers,
  (x, z) => lookup.heightAt(677700.5 + x, 6586399.5 - z));
assert.deepEqual(preservedModel(model, review), preservedModel(before, review), 'unreviewed model fields changed');
assert.deepEqual(preservedSource(collection, review), preservedSource(previousSource, review), 'unreviewed source features changed');
const receiptPath = 'lidingobuild/mapping/alignment-integration-2026-09-10.json';
const previousReceipt = fs.existsSync(path.join(root, receiptPath)) ? read(receiptPath) : null;
const baselineGroundManifest = previousReceipt?.baselineGroundManifest ?? opened.courseManifest.groundManifest;
assert.deepEqual(preservedGround(opened.ground), preservedGround(read(`apps/golf/public/${baselineGroundManifest.url}`)),
  'terrain, routing ownership or another ground field changed');
const receipt = { schemaVersion: 1, groundId: 'lidingo', importedCommit: '40cf4de4d7e1498c59f9f50e85b4d8cca66d8460',
  sources: Object.fromEntries([REVIEW_PATH, APPROACH_PATH, BUNKER_PATH].map(p => [p, fileHash(p)])),
  preservedModelSha256: hash(preservedModel(before, review)), preservedSourceSha256: hash(preservedSource(previousSource, review)),
  baselineGroundManifest,
  changes: { reviewedGreens: review.features.map(f => f.hole), approaches: approaches.features.map(f => f.properties.hole), addedBunkers: bunkers.features.map(f => f.id) },
  preserved: ['all tee geometry, references and uncertainty', 'source routes and official card', 'OB lines and posts', 'buildings and courtyard', 'water and coast', '277 terrain tiles and original measured vegetation sources', 'all existing bunkers and fairways'],
  dependentStandRefresh: 'Recompile the current 64 stand layers against adopted surface exclusions; no older branch stands or object records are imported.',
  limitations: ['Machine interpretations of May 2025 imagery; independent survey accuracy remains unknown.', 'Four shaded greens retain their earlier boundaries.'] };
// On reapplication keep the original preservation receipt and require it to
// agree, rather than turning an unexpected later edit into a new baseline.
if (fs.existsSync(path.join(root, receiptPath))) assert.deepEqual(read(receiptPath), receipt, 'preserved baseline changed; review before rebasing this integration');
write('lidingobuild/mapping/playing-surfaces.geojson', collection);
write('lidingobuild/course-model.json', model);
const sourceReport = read('lidingobuild/mapping/playing-surfaces-review.json');
sourceReport.featureCount = collection.features.length;
sourceReport.counts = Object.fromEntries(['green', 'tee', 'fairway', 'bunker'].map(k => [k, collection.features.filter(f => f.properties.kind === k).length]));
sourceReport.puttingCuts2025 = { review: REVIEW_PATH, sha256: fileHash(REVIEW_PATH), replacedHoles: receipt.changes.reviewedGreens,
  independentRegistrationAccuracyMetres: null, independentHumanReview: false };
sourceReport.newerCaptureAdditions = { review: BUNKER_PATH, sha256: fileHash(BUNKER_PATH), adopted: receipt.changes.addedBunkers,
  captureDate: '2025-05-31', independentHumanReview: false };
sourceReport.output.sha256 = fileHash('lidingobuild/mapping/playing-surfaces.geojson');
write('lidingobuild/mapping/playing-surfaces-review.json', sourceReport);
write(receiptPath, receipt);
console.log(JSON.stringify(receipt.changes));
