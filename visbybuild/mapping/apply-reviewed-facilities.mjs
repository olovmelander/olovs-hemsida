#!/usr/bin/env node
/* Apply only reviewed facilities, using the generator's surface/tee rules.
 * The raw terrain acquisition need not be reconstructed from quantized tiles.
 * node visbybuild/mapping/apply-reviewed-facilities.mjs [--geometry-only] [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { applyReviewedFacilities } from './reviewed-facilities.mjs';
import { applyReviewedTeePlatforms } from './reviewed-tee-platforms.mjs';
import { applyReviewedEnvironment } from './reviewed-environment.mjs';
import { buildHoles, localRing } from '../build-course.mjs';
import { VISBY_FRAME } from '../frame.mjs';
import { openPublishedGround, createPublishedGroundLookup } from '../../packages/course-v2/published-ground-lookup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
const args = process.argv.slice(2);
if (args.some(arg => !['--write', '--geometry-only'].includes(arg))) throw new Error('Unknown facility adoption argument');
const teeReview = read('visbybuild/mapping/tee-platform-review.json');
const environmentReview = read('visbybuild/mapping/environment-surfaces-review.json');
const geometry = applyReviewedEnvironment(applyReviewedTeePlatforms(applyReviewedFacilities(read('visbybuild/mapping/geometry.json'), read('visbybuild/mapping/facilities-review.json')), teeReview), environmentReview);
assert.deepEqual(applyReviewedFacilities(geometry, read('visbybuild/mapping/facilities-review.json')), geometry);
assert.deepEqual(applyReviewedTeePlatforms(geometry, teeReview), geometry);
assert.deepEqual(applyReviewedEnvironment(geometry, environmentReview), geometry);
if (!args.includes('--geometry-only')) {
  const model = read('visbybuild/course-model.json');
  const { ground, readAsset } = openPublishedGround(fs, path, path.join(root, 'apps/golf/public'), 'visby');
  const lookup = createPublishedGroundLookup(ground, readAsset);
  const heightAt = (x, z) => {
    const value = lookup.heightAt(VISBY_FRAME.easting + x, VISBY_FRAME.northing - z);
    if (!Number.isFinite(value)) throw new Error('Reviewed camera has no published terrain sample');
    return value;
  };
  const holes = buildHoles(read('visbybuild/reference/club-scorecard.json'), geometry, heightAt);
  for (const n of [1, ...teeReview.holes.map(h => h.n)]) {
    model.holes[n - 1].tees = holes[n - 1].tees;
    model.holes[n - 1].elev = holes[n - 1].elev;
  }
  model.scenery.greens = geometry.scenery.greens.map((ring, index) => localRing(ring, `Practice green ${index + 1}`));
  console.log(JSON.stringify({ physicalPlatforms: model.holes.reduce((sum, h) => sum + h.tees.pads.length, 0), reviewedHoles: [1, ...teeReview.holes.map(h => h.n)], practiceGreens: model.scenery.greens.length, terrainChanged: false, dryRun: !args.includes('--write') }));
  if (args.includes('--write')) write('visbybuild/course-model.json', model);
}
if (args.includes('--write')) write('visbybuild/mapping/geometry.json', geometry);
