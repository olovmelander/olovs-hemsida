/* Ängsö is the first ground whose reviewed frontier is a SUB-RECTANGLE of its
   metre window, so the two numbers that could quietly stop meaning anything
   are the frontier bounds and the tile count. Both are checked here against
   artifacts that never entered them: the committed EPSG:3006 migration for
   the played ground, and the published ground manifest for the tiles and
   their bytes. A test that recomputed either from the config would prove
   nothing. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANGSO_V2_CONFIG } from './v2-angso-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = relative => JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));

/* The 8 MiB a visitor may download and decode before the first frame. Stated
   here so the test fails if the runtime's budget is raised without review,
   rather than tracking it. */
const MAX_FRONTIER_ENCODED_BYTES = 8 * 1024 * 1024;
const ZONE_A_MARGIN_METRES = 100;

function publishedGround() {
  const root = readJson('apps/golf/public/courses/v2-index.json');
  const entry = root.courses.find(course => course.slug === 'angso');
  const course = readJson(path.join('apps/golf/public', entry.manifest.url));
  return readJson(path.join('apps/golf/public', course.groundManifest.url));
}

function playedBounds() {
  const model = readJson('geo_data/course-v2/angso/migration/course-model.epsg3006.json');
  const bounds = { minEasting: Infinity, minNorthing: Infinity, maxEasting: -Infinity, maxNorthing: -Infinity };
  let points = 0;
  const visit = value => {
    if (Array.isArray(value)) {
      if (value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
          value[0] > 200_000 && value[0] < 1_000_000 && value[1] > 6_000_000 && value[1] < 7_700_000) {
        bounds.minEasting = Math.min(bounds.minEasting, value[0]);
        bounds.maxEasting = Math.max(bounds.maxEasting, value[0]);
        bounds.minNorthing = Math.min(bounds.minNorthing, value[1]);
        bounds.maxNorthing = Math.max(bounds.maxNorthing, value[1]);
        points++;
        return;
      }
      for (const entry of value) visit(entry);
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  visit(model.geometry.holes);
  visit(model.geometry.scenery);
  return { ...bounds, points };
}

describe('the reviewed Ängsö frontier rectangle', () => {
  const frontier = ANGSO_V2_CONFIG.expectedFrontierBoundsEpsg5845;

  it('holds every played point with the reviewed zone-A margin', () => {
    const played = playedBounds();
    expect(played.points).toBeGreaterThan(1000);
    const margin = {
      west: played.minEasting - frontier.minEasting,
      east: frontier.maxEasting - played.maxEasting,
      south: played.minNorthing - frontier.minNorthing,
      north: frontier.maxNorthing - played.maxNorthing,
    };
    for (const [side, metres] of Object.entries(margin)) {
      expect(metres, `${side} margin`).toBeGreaterThanOrEqual(ZONE_A_MARGIN_METRES);
    }
    /* The reviewed claim is 577 m east and west, 452 m north and south. */
    expect(Math.round(Math.min(...Object.values(margin)))).toBe(452);
  });

  it('is a complete rectangle of published level-zero tiles inside the budget', () => {
    const ground = publishedGround();
    const levelZero = ground.tiles.filter(tile => tile.lod === 0);
    expect(levelZero).toHaveLength(ANGSO_V2_CONFIG.ringGraph.tilesByLod[0]);
    const inside = levelZero.filter(tile =>
      tile.bounds.minEasting >= frontier.minEasting - 1e-6 &&
      tile.bounds.maxEasting <= frontier.maxEasting + 1e-6 &&
      tile.bounds.minNorthing >= frontier.minNorthing - 1e-6 &&
      tile.bounds.maxNorthing <= frontier.maxNorthing + 1e-6);
    expect(inside).toHaveLength(ANGSO_V2_CONFIG.expectedTileCount);

    const span = levelZero[0].bounds.maxEasting - levelZero[0].bounds.minEasting;
    const columns = Math.round((frontier.maxEasting - frontier.minEasting) / span);
    const rows = Math.round((frontier.maxNorthing - frontier.minNorthing) / span);
    expect(columns * rows).toBe(ANGSO_V2_CONFIG.expectedTileCount);

    const encodedBytes = inside.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0);
    expect(encodedBytes).toBeLessThanOrEqual(MAX_FRONTIER_ENCODED_BYTES);
    /* And the whole metre level genuinely does NOT fit, which is why this
       ground needs a sub-rectangle at all. */
    const wholeLevel = levelZero.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0);
    expect(wholeLevel).toBeGreaterThan(MAX_FRONTIER_ENCODED_BYTES);
  });

  it('declares no legacy CORE cutout, because the ring adapter serves this ground', () => {
    expect(ANGSO_V2_CONFIG.legacyCoreCutout).toBe(null);
    expect(ANGSO_V2_CONFIG.ringGraph.levels).toBe(7);
    expect(ANGSO_V2_CONFIG.ringGraph.rootSpanMetres).toBe(16384);
  });

  it('carries the published frame, not another course frame', () => {
    const ground = publishedGround();
    expect(ground.frame.fingerprint).toBe(ANGSO_V2_CONFIG.frameFingerprint);
    expect(ground.frame.origin.easting).toBe(ANGSO_V2_CONFIG.canonicalOrigin.easting);
    expect(ground.frame.origin.northing).toBe(ANGSO_V2_CONFIG.canonicalOrigin.northing);
    expect(ground.frame.origin.heightRH2000).toBe(ANGSO_V2_CONFIG.canonicalOrigin.heightRH2000);
    for (const [field, value] of Object.entries(ANGSO_V2_CONFIG.expectedBoundsEpsg5845)) {
      expect(ground.bounds[field], field).toBe(value);
    }
  });

  it('states a vertical datum step that is this course, not another one', () => {
    /* Veckefjärden 20.9924, Puttom 23.6263. A copied offset is the failure
       this value exists to make impossible. Ängsö's is exactly zero because
       its pack is re-grounded on the laser DTM (angsobuild/build-heightfields.mjs);
       the pre-rebuild measurement was 9.1166 m with a 1.85 m MAD. */
    expect(ANGSO_V2_CONFIG.legacyFrame.verticalDatumOffsetMetres).toBe(0);
    expect(ANGSO_V2_CONFIG.bridgeMode).toBe('wgs84-legacy-frame');
    expect(ANGSO_V2_CONFIG.legacyFrame.latitude).toBe(59.5739);
    expect(ANGSO_V2_CONFIG.legacyFrame.longitude).toBe(16.871);
  });
});
