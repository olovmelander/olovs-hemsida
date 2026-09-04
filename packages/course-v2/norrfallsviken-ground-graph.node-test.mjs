import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NORRFALLSVIKEN_GROUND_GRAPH_CONFIG as config } from './norrfallsviken-ground-graph.mjs';
import { NORRFALLSVIKEN_GROUND_RINGS as rings } from './norrfallsviken-ground-rings.mjs';
import { ringSpecFor } from './ground-rings-registry.mjs';

test('Norrfällsviken 1 m lattice is an exact sixteen-by-sixteen 256 m tile grid', () => {
  assert.equal(config.width, config.tileSegments * 16 + 1);
  assert.equal(config.height, config.tileSegments * 16 + 1);
  assert.equal(config.expectedBounds.maxEasting - config.expectedBounds.minEasting, 4096);
  assert.equal(config.expectedBounds.maxNorthing - config.expectedBounds.minNorthing, 4096);
  assert.equal(config.originEasting, config.pixelEdgeWindow.west + 0.5);
  assert.equal(config.originNorthing, config.pixelEdgeWindow.north - 0.5);
  assert.equal(config.pixelEdgeWindow.east - config.pixelEdgeWindow.west, 4097);
  assert.equal(config.pixelEdgeWindow.north - config.pixelEdgeWindow.south, 4097);
});

/* The window's north edge is anchored on the 10 km item boundary rather than
   centred, and that is the whole reason it needs only two source items. If
   someone recentres it the item list has to change with it. */
test('the window is anchored on the source item boundary and stays in two items', () => {
  assert.equal(config.pixelEdgeWindow.north, 6990000);
  assert.equal(config.pixelEdgeWindow.north % 10000, 0);
  assert.deepEqual([...config.sourceItemIds], ['698_67', '698_68']);
  for (const [id, asset] of Object.entries(config.sourceAssets)) {
    assert.ok(config.sourceItemIds.includes(id), `${id} is not a reviewed source item`);
    const [minEasting, minNorthing, maxEasting, maxNorthing] = asset.projBbox;
    assert.ok(minEasting <= config.expectedBounds.maxEasting);
    assert.ok(maxEasting >= config.expectedBounds.minEasting);
    assert.ok(minNorthing <= config.expectedBounds.maxNorthing, `${id} does not reach the window's south edge`);
    assert.ok(maxNorthing >= config.expectedBounds.minNorthing);
  }
  /* every sample of the window lies inside the union of the two items */
  const covered = Object.values(config.sourceAssets)
    .some(a => a.projBbox[0] <= config.expectedBounds.minEasting && a.projBbox[3] >= config.expectedBounds.maxNorthing);
  assert.ok(covered, 'no item covers the window north-west corner');
});

/* Sixteen tiles is not the smallest square that holds the COURSE -- eight
   would be. It is the smallest that also holds the chapel and the harbour,
   and that claim is what this test pins, because it is the only thing
   justifying four times the level-zero tiles. */
test('sixteen tiles is minimal for the played ground TOGETHER WITH the landmarks', () => {
  const ZONE_A = 100;
  const tileSpan = config.tileSegments * config.sampleSpacingMetres;
  const boxes = [config.playedBounds, ...Object.values(config.landmarkBounds)];
  const contained = {
    minEasting: Math.min(...boxes.map(b => b.minEasting)),
    maxEasting: Math.max(...boxes.map(b => b.maxEasting)),
    minNorthing: Math.min(...boxes.map(b => b.minNorthing)),
    maxNorthing: Math.max(...boxes.map(b => b.maxNorthing)),
  };
  const required = Math.max(
    contained.maxEasting - contained.minEasting,
    contained.maxNorthing - contained.minNorthing,
  ) + 2 * ZONE_A;

  assert.ok(16 * tileSpan >= required, 'sixteen tiles must hold the reviewed ground');
  assert.ok(8 * tileSpan < required, 'if eight tiles were enough, sixteen would not be minimal');

  /* and eight tiles WOULD have held the golf course on its own, which is why
     a played-ground-only minimality rule is the wrong rule for this ground */
  const playedOnly = Math.max(
    config.playedBounds.maxEasting - config.playedBounds.minEasting,
    config.playedBounds.maxNorthing - config.playedBounds.minNorthing,
  ) + 2 * ZONE_A;
  assert.ok(8 * tileSpan >= playedOnly);

  for (const box of boxes) {
    assert.ok(box.minEasting - config.expectedBounds.minEasting >= ZONE_A);
    assert.ok(config.expectedBounds.maxEasting - box.maxEasting >= ZONE_A);
    assert.ok(box.minNorthing - config.expectedBounds.minNorthing >= ZONE_A);
    assert.ok(config.expectedBounds.maxNorthing - box.maxNorthing >= ZONE_A);
  }
});

test('the reviewed height band contains the measured range with real headroom', () => {
  const band = config.plausibleHeightRangeRH2000;
  const measured = config.measuredHeightRangeRH2000;
  assert.ok(measured.minimum > band.minimum);
  assert.ok(measured.maximum < band.maximum);
  /* the band must not track the data: a decimetre/metre slip has to fail */
  assert.ok(band.maximum - measured.maximum > 10, 'the band is too tight to be a sanity gate');
  assert.ok(measured.maximum * 10 > band.maximum, 'a ten-times unit slip must leave the band');
});

/* lod 0 of the ring graph and the published course terrain must address the
   same lattice, or publish-ground-rings cannot reuse the published tiles byte
   for byte and the frontier would meet a seam. */
test('the ring graph lod 0 is the reviewed course window', () => {
  assert.equal(ringSpecFor('norrfallsviken'), rings);
  const lod0 = rings.levels.find(level => level.lod === 0);
  assert.equal(lod0.sampleSpacingMetres, config.sampleSpacingMetres);
  assert.equal(lod0.tilesPerSide * rings.tileSegments + 1, config.width);
  assert.equal(lod0.originEasting, config.originEasting);
  assert.equal(lod0.originNorthing, config.originNorthing);
  assert.equal(rings.tileSegments, config.tileSegments);
});

/* Each finer ring must be exactly the middle four tiles of the next coarser
   one. Puttom's first cut broke this and drew sky through the ground. */
test('every ring is a whole number of coarser tiles, centred', () => {
  const levels = [...rings.levels].sort((a, b) => a.lod - b.lod);
  for (let i = 1; i < levels.length; i++) {
    const fine = levels[i - 1], coarse = levels[i];
    assert.equal(coarse.sampleSpacingMetres, fine.sampleSpacingMetres * 2,
      `lod ${coarse.lod} must be twice lod ${fine.lod}`);
    const coarseSpan = coarse.tilesPerSide * rings.tileSegments * coarse.sampleSpacingMetres;
    const fineSpan = fine.tilesPerSide * rings.tileSegments * fine.sampleSpacingMetres;
    assert.ok(coarseSpan >= fineSpan, `lod ${coarse.lod} must cover lod ${fine.lod}`);
    const coarseTile = rings.tileSegments * coarse.sampleSpacingMetres;
    const inset = (fine.originEasting - 0.5) - (coarse.originEasting - 0.5);
    assert.equal(inset % coarseTile, 0, `lod ${fine.lod} does not start on a lod ${coarse.lod} tile edge`);
    const insetNorth = (coarse.originNorthing + 0.5) - (fine.originNorthing + 0.5);
    assert.equal(insetNorth % coarseTile, 0, `lod ${fine.lod} does not start on a lod ${coarse.lod} tile row`);
  }
  const root = levels[levels.length - 1];
  assert.equal(root.tilesPerSide, 1, 'the coarsest level must be one root tile');
});

/* The sea fill is this ground's own, and its thresholds are measurements. A
   later edit that loosens them past the point where a missing LAND square
   would still fail is the failure this guards. */
test('the sea fill can never accept a hole bounded by real terrain', () => {
  const fill = rings.seaFill;
  assert.ok(fill, 'a seaside ground must declare its sea fill');
  assert.ok(fill.boundaryMedianMaximumHeightRH2000 <= 0.5);
  assert.ok(fill.boundaryMaximumHeightRH2000 <= 5,
    'the ceiling must stay far below any real ground in this window');
  assert.ok(fill.boundaryWaterMinimumFraction >= 0.5);
  assert.ok(fill.maximumFilledFraction <= 0.25);
  /* the course window itself must never need filling: it was measured finite */
  assert.equal(config.measuredHeightRangeRH2000.minimum > -5, true);
});

test('no inland ground here declares a sea fill', () => {
  for (const id of ['angso', 'puttom', 'upsala', 'veckefjarden']) {
    assert.equal(ringSpecFor(id).seaFill, undefined, `${id} must not carry a sea fill`);
  }
});
