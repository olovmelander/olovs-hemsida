import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UPSALA_GROUND_GRAPH_CONFIG as config } from './upsala-ground-graph.mjs';
import { UPSALA_GROUND_RINGS as rings } from './upsala-ground-rings.mjs';

test('Upsala 1 m lattice is an exact eight-by-eight 256 m tile grid', () => {
  assert.equal(config.width, config.tileSegments * 8 + 1);
  assert.equal(config.height, config.tileSegments * 8 + 1);
  assert.equal(config.expectedBounds.maxEasting - config.expectedBounds.minEasting, 2048);
  assert.equal(config.expectedBounds.maxNorthing - config.expectedBounds.minNorthing, 2048);
  assert.equal(config.originEasting, config.pixelEdgeWindow.west + 0.5);
  assert.equal(config.originNorthing, config.pixelEdgeWindow.north - 0.5);
  assert.equal(config.pixelEdgeWindow.east - config.pixelEdgeWindow.west, 2049);
  assert.equal(config.pixelEdgeWindow.north - config.pixelEdgeWindow.south, 2049);
});

/* The reviewed margins are a CLAIM about where the played ground is, so they
   are recomputed from the played bounds rather than restated. This is the
   tightest window on any ground here and the one most worth checking. */
test('the reviewed window clears every played point by the recorded margin', () => {
  const played = config.playedBounds;
  const bounds = config.expectedBounds;
  const margin = {
    west: played.minEasting - bounds.minEasting,
    east: bounds.maxEasting - played.maxEasting,
    south: played.minNorthing - bounds.minNorthing,
    north: bounds.maxNorthing - played.maxNorthing,
  };
  for (const side of ['west', 'east', 'south', 'north']) {
    assert.ok(Math.abs(margin[side] - config.reviewedPlayedMarginMetres[side]) < 0.05,
      `${side} margin is ${margin[side].toFixed(2)} m; reviewed ${config.reviewedPlayedMarginMetres[side]}`);
    assert.ok(margin[side] > 0, `${side} margin must be positive`);
  }
  const smallest = Math.min(...Object.values(margin));
  assert.equal(config.reviewedPlayedMarginMetres.minimum, config.reviewedPlayedMarginMetres.west);
  /* The runbook's zone-A margin is 80-100 m. This window clears it, but only
     just on the east-west axis, which is what two courses standing side by
     side across 1,686 m costs. */
  assert.ok(smallest >= 100, `smallest margin ${smallest.toFixed(1)} m is under the reviewed zone-A margin`);
});

/* Håmö straddles easting 640000. The two items are not interchangeable and the
   window genuinely needs both, so the config must not quietly become
   single-item. */
test('the window spans both 10 km Markhojdmodell items it declares', () => {
  assert.deepEqual([...config.sourceItemIds], ['663_63', '663_64']);
  assert.equal(config.sourceItems.length, 2);
  const seam = 640000;
  assert.ok(config.expectedBounds.minEasting < seam && config.expectedBounds.maxEasting > seam,
    'the reviewed window must cross the item seam, or one item would be enough');
  for (const item of config.sourceItems) {
    assert.match(item.cogSha256, /^[0-9a-f]{64}$/);
    assert.match(item.assetUrl, /^https:\/\/dl1\.lantmateriet\.se\/hojd\/data\/grid\/mhm\//);
  }
  assert.notEqual(config.sourceItems[0].cogSha256, config.sourceItems[1].cogSha256);
});

/* The ring spec and the course window are two files and must address one
   lattice; publish-ground-rings reuses the published 1 m tiles byte for byte
   and would fail loudly, but this fails in a second rather than after a
   hundred megabytes of reads. */
test('the ring spec is centred on the reviewed window', () => {
  const level0 = rings.levels.find(level => level.lod === 0);
  assert.equal(level0.originEasting, config.originEasting);
  assert.equal(level0.originNorthing, config.originNorthing);
  assert.equal(level0.sampleSpacingMetres, config.sampleSpacingMetres);
  assert.equal(level0.tilesPerSide * rings.tileSegments + 1, config.width);
  assert.deepEqual([...rings.courseSlugs], [...config.courseSlugs]);
  /* Every ring is centred on the same point, and each finer one is the middle
     four tiles of the next coarser: a coarse tile is then wholly covered or
     not at all. */
  const centre = level => ({
    easting: level.originEasting + level.tilesPerSide * rings.tileSegments * level.sampleSpacingMetres / 2,
    northing: level.originNorthing - level.tilesPerSide * rings.tileSegments * level.sampleSpacingMetres / 2,
  });
  const first = centre(rings.levels[0]);
  for (const level of rings.levels) {
    assert.deepEqual(centre(level), first, `lod ${level.lod} is not centred with lod 0`);
  }
});

/* The plausibility band is a gate, and a gate that tracks its own data proves
   nothing. It has to be wider than the measured ground on both sides and still
   reject a nodata plane at zero. */
test('the plausible height band brackets the measured ground without tracking it', () => {
  const band = config.plausibleHeightRangeRH2000;
  const measured = { minimum: 13.286335945129395, maximum: 54.38547134399414 };
  assert.ok(band.minimum < measured.minimum && band.maximum > measured.maximum);
  assert.ok(band.minimum > 0, 'a zero-padded nodata plane must fall outside the band');
  assert.ok(band.maximum < 200, 'the band must be tight enough to catch a wrong item');
  assert.ok(rings.coverageGate.minimumHeightRH2000 < band.minimum,
    'the 16 km ring band must be at least as wide as the course window band');
  assert.equal(rings.coverageGate.requireEverySampleFinite, true);
});
