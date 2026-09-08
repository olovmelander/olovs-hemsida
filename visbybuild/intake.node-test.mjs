import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildIntake, overviewSvg } from './build-intake.mjs';
import { sha256File } from '../packages/course-geo/manifest.mjs';

const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const card = read('./reference/club-scorecard.json');
const golf = read('../geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson');

test('verified 18-hole card preserves six numeric tee identities and every source value', () => {
  const intake = buildIntake(card, golf);
  assert.deepEqual(intake.card.teeNames, ['63', '59', '55', '51', '46', '41']);
  // Independently published Caddee totals, corroborated with SGF row sums.
  assert.deepEqual(intake.card.teeTotals, [6230, 5819, 5490, 4926, 4609, 4216]);
  assert.deepEqual(intake.card.holes.map(h => h.par), [3, 4, 5, 4, 3, 5, 3, 4, 4, 5, 4, 4, 4, 3, 4, 5, 3, 5]);
  for (const [i, h] of intake.card.holes.entries()) {
    assert.equal(h.hcp, card.holes[i].index);
    assert.deepEqual(h.t, card.tees.map(t => card.holes[i].lengths[t.id]));
    assert.equal(h.route, null);
    assert.equal(h.teeMarkers, null);
    assert.equal(h.pin, null);
  }
});

test('shared-property geometry retains source vertices and ambiguous ref=2 routes stay unassigned', () => {
  const intake = buildIntake(card, golf);
  for (const f of intake.features) {
    assert.deepEqual(f.geometry, golf.features.find(s => s.id === f.id).geometry);
    assert.equal(f.holeNumber, null);
  }
  assert.deepEqual(intake.counts, { hole: 2, green: 17, tee: 2, fairway: 0, bunker: 5 });
  assert.equal(intake.unassignedRoutes.length, 2);
  assert.ok(intake.unassignedRoutes.every(r => r.sourceRef === '2'));
  assert.equal(intake.releaseGates.routeParCrosscheck, false);
  assert.equal(intake.playable, false);
  const svg = overviewSvg(intake);
  assert.ok(!svg.includes('NaN'));
  assert.ok(svg.includes('OpenStreetMap'));
});

test('bad card totals, duplicate indices, duplicate geometry IDs, swapped CRS and open rings fail', () => {
  let changed = structuredClone(card);
  changed.holes[0].lengths['tee-63']++;
  assert.throws(() => buildIntake(changed, golf), /totals disagree/);
  changed = structuredClone(card); changed.holes[0].index = changed.holes[1].index;
  assert.throws(() => buildIntake(changed, golf), /Invalid official card/);
  let geometry = structuredClone(golf); geometry.crs.properties.name = 'EPSG:4326';
  assert.throws(() => buildIntake(card, geometry), /EPSG:3006/);
  geometry = structuredClone(golf);
  geometry.features.push(geometry.features.find(f => f.properties.tags.golf === 'green'));
  assert.throws(() => buildIntake(card, geometry), /duplicate source feature/);
  geometry = structuredClone(golf);
  geometry.features.find(f => f.properties.tags.golf === 'green').geometry.coordinates[0].pop();
  assert.throws(() => buildIntake(card, geometry), /Unclosed source polygon/);
});

test('retained source preview verifies exact bytes and stays separate from provisional 3D', () => {
  const meta = read('../apps/golf/src/data/visby-preview.json');
  const file = new URL(`../apps/golf/public/${meta.previewUrl}`, import.meta.url);
  const bytes = fs.readFileSync(file), published = JSON.parse(bytes);
  assert.equal(meta.previewSha256, createHash('sha256').update(bytes).digest('hex'));
  const expected = buildIntake(card, golf);
  for (const key of Object.keys(expected)) assert.deepEqual(published[key], expected[key]);
  for (const source of published.sources) assert.equal(source.sha256, sha256File(fileURLToPath(new URL(`../${source.path}`, import.meta.url))));
  assert.equal(meta.status, 'mapping');
  assert.equal(meta.packUrl, undefined);
  assert.equal(read('../apps/golf/public/courses/index.json').courses.find(c => c.slug === 'visby').status, 'provisional');
});
