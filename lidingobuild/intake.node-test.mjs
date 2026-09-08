import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildIntake } from './build-intake.mjs';
import { validateSourceManifest } from '../packages/course-geo/manifest.mjs';

const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const card = read('./reference/club-scorecard.json');
const golf = read('../geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson');

test('Lidingö source ledger validates every artifact without claiming approved survey control', () => {
  const manifest = read('../geo_data/course-v2/lidingo/source-manifest.json');
  const catalog = read('../geo_data/course-v2/source-catalog.json');
  assert.equal(manifest.canonicalFrame.originStatus, 'pending-control-approval');
  assert.deepEqual(manifest.canonicalFrame.origin, { easting: null, northing: null, heightRH2000: null });
  assert.deepEqual(validateSourceManifest(manifest, { catalog, repoRoot: fileURLToPath(new URL('../', import.meta.url)) }), []);
});

test('official front/back totals reconcile independently and source routes remain unchanged', () => {
  const intake = buildIntake(card, golf);
  card.tees.forEach((tee, i) => {
    assert.equal(intake.card.holes.slice(0, 9).reduce((n, h) => n + h.t[i], 0), tee.front);
    assert.equal(intake.card.holes.slice(9).reduce((n, h) => n + h.t[i], 0), tee.back);
  });
  for (const h of intake.card.holes) {
    const source = golf.features.find(f => f.id === h.routeId);
    assert.deepEqual(h.route, source.geometry.coordinates);
    assert.equal(h.pin, null);
    assert.equal(h.teeMarkers, null);
  }
  assert.equal(intake.playable, false);
  assert.equal(intake.releaseGates.completePlayingSurfaces, false);
  assert.deepEqual(intake.counts, { hole: 18, green: 15, tee: 19, fairway: 5, bunker: 13 });
});

test('card and routing disagreements fail instead of changing source geography', () => {
  const changed = structuredClone(golf);
  changed.features.find(f => f.properties.tags.golf === 'hole').properties.tags.par = '6';
  assert.throws(() => buildIntake(card, changed), /par disagreement/);
  const duplicate = structuredClone(golf);
  const routes = duplicate.features.filter(f => f.properties.tags.golf === 'hole');
  routes[1].properties.tags.ref = routes[0].properties.tags.ref;
  assert.throws(() => buildIntake(card, duplicate), /duplicate route/);
});

test('invalid card totals, index permutation and CRS are rejected', () => {
  const changed = structuredClone(card);
  changed.holes[0].lengths.white++;
  assert.throws(() => buildIntake(changed, golf), /printed totals/);
  changed.holes[0].index = changed.holes[1].index;
  assert.throws(() => buildIntake(changed, golf), /Invalid official card/);
  const swapped = structuredClone(golf);
  swapped.crs.properties.name = 'EPSG:4326';
  assert.throws(() => buildIntake(card, swapped), /EPSG:3006/);
});

test('retained source preview matches immutable intake facts independently of the later 3D model', () => {
  const preview = read('../apps/golf/src/data/lidingo-preview.json');
  const published = read(`../apps/golf/public/${preview.previewUrl}`);
  const expected = buildIntake(card, golf);
  for (const key of Object.keys(expected)) assert.deepEqual(published[key], expected[key]);
  const bytes = fs.readFileSync(new URL(`../apps/golf/public/${preview.previewUrl}`, import.meta.url));
  assert.equal(preview.previewSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(preview.packUrl, undefined);
  assert.equal(preview.status, 'mapping');
});
