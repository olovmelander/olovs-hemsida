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
import { applyReviewedOrthophoto } from './reviewed-orthophoto.mjs';
import { applyReviewedTeeAlignment } from './reviewed-tee-alignment.mjs';
import { buildHoles, holeNotes, localRing } from '../build-course.mjs';
import { VISBY_FRAME } from '../frame.mjs';
import { openPublishedGround, createPublishedGroundLookup } from '../../packages/course-v2/published-ground-lookup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
const args = process.argv.slice(2);
if (args.some(arg => !['--write', '--geometry-only'].includes(arg))) throw new Error('Unknown facility adoption argument');
const teeReview = read('visbybuild/mapping/tee-platform-review.json');
const environmentReview = read('visbybuild/mapping/environment-surfaces-review.json');
const orthophotoReview = read('visbybuild/mapping/orthophoto-review-2026.json');
const applyReviews = input => applyReviewedTeeAlignment(applyReviewedOrthophoto(applyReviewedEnvironment(applyReviewedTeePlatforms(applyReviewedFacilities(input, read('visbybuild/mapping/facilities-review.json')), teeReview), environmentReview), orthophotoReview));
const geometry = applyReviews(read('visbybuild/mapping/geometry.json'));
assert.deepEqual(applyReviews(geometry), geometry, 'the complete dated review chain must be idempotent');
if (!args.includes('--geometry-only')) {
  const model = read('visbybuild/course-model.json');
  const { ground, readAsset } = openPublishedGround(fs, path, path.join(root, 'apps/golf/public'), 'visby');
  const lookup = createPublishedGroundLookup(ground, readAsset);
  const heightAt = (x, z) => {
    const value = lookup.heightAt(VISBY_FRAME.easting + x, VISBY_FRAME.northing - z);
    if (!Number.isFinite(value)) throw new Error('Reviewed camera has no published terrain sample');
    return value;
  };
  model.holes = buildHoles(read('visbybuild/reference/club-scorecard.json'), geometry, heightAt, holeNotes(read('visbybuild/guide-notes.json')));
  model.scenery.greens = geometry.scenery.greens.map((ring, index) => localRing(ring, `Practice green ${index + 1}`));
  model.scenery.bunkers = geometry.scenery.bunkers.map((ring, index) => localRing(ring, `Scenery bunker ${index + 1}`));
  console.log(JSON.stringify({ physicalPlatforms: model.holes.reduce((sum, h) => sum + h.tees.pads.length, 0), reviewedHoles: [1, ...teeReview.holes.map(h => h.n)], practiceGreens: model.scenery.greens.length, terrainChanged: false, dryRun: !args.includes('--write') }));
  if (args.includes('--write')) write('visbybuild/course-model.json', model);
}
if (args.includes('--write')) write('visbybuild/mapping/geometry.json', geometry);
