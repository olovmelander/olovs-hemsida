import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRegistryState,
  checkRegistries,
  renderGpsFrameEntry,
  renderMapFrameEntry,
} from './sync-course-registries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('live repository course registries are synchronized with zero drift', async () => {
  const state = await loadRegistryState(ROOT);
  const report = checkRegistries(state, ROOT);
  assert.equal(report.ok, true, JSON.stringify(report.drift, null, 2));
  assert.equal(report.driftCount, 0);
  assert.equal(report.groundsChecked, 10);
  assert.deepEqual(report.gridAuthoredSlugs, ['lidingo', 'ribbingsfors', 'visby', 'tortuna']);
});

test('checkRegistries detects drift when a new grid-authored ground is missing from downstream registries', async () => {
  const state = await loadRegistryState(ROOT);
  const fakeBroHof = {
    slug: 'bro-hof-stadium',
    groundId: 'bro-hof',
    bridgeMode: 'epsg3006-local-rh2000',
    frameFingerprint: 'a'.repeat(64),
    packFrame: 'local metres from EPSG:3006; east +x, north -z; origin E649094.5 N6598568.5; heights RH 2000',
    packOriginWgs84: { latitude: 59.498973, longitude: 17.633749 },
    packMetresPerLongitude: 56503.01,
    legacyOriginEpsg3006: { easting: 649094.5, northing: 6598568.5 },
  };
  const mutated = {
    ...state,
    allConfigs: [...state.allConfigs, fakeBroHof],
    derivedGrounds: new Map([...state.derivedGrounds, ['bro-hof', ['bro-hof-stadium']]]),
    gridConfigs: [...state.gridConfigs, fakeBroHof],
  };
  const report = checkRegistries(mutated, ROOT);
  assert.equal(report.ok, false);
  const files = new Set(report.drift.map(d => d.file));
  assert.equal(files.has('packages/course-geo/manifest.mjs'), true);
  assert.equal(files.has('apps/golf/src/engine/gps-projected-frames.mjs'), true);
  assert.equal(files.has('apps/golf/src/map/map-frames.mjs'), true);
  assert.equal(files.has('apps/golf/src/engine/v2-grid-origin.test.mjs'), true);

  // Verify entry renderers quote hyphenated groundIds cleanly
  assert.match(renderMapFrameEntry(fakeBroHof), /"bro-hof": grid\(/);
  assert.match(renderGpsFrameEntry(fakeBroHof), /slug: "bro-hof-stadium"/);
});
