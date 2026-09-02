import test from 'node:test';
import assert from 'node:assert/strict';
import {
  binnedHeights, clearedBlocks, disagreementProfile, heightAgreement, presenceConfusion, recordAgreement, seamProfile, tileCrosscheck,
} from './chmv2-crosscheck.mjs';

function raster(width, height, fill) {
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) values[row * width + column] = fill(column, row);
  return { width, height, sampleSpacingMetres: 1, originEasting: 1000, originNorthing: 2000, values };
}

test('presence and height agreement are exact on a constructed pair', () => {
  /* 8 x 8: the left half is 10 m forest in both; the right half is open in
     the laser and 3 m in the other on its top row only */
  const laser = raster(8, 8, c => (c < 4 ? 10 : 0));
  const other = raster(8, 8, (c, r) => (c < 4 ? 8 : (r === 0 ? 3 : 0)));
  const presence = presenceConfusion(laser, other);
  assert.deepEqual([presence.n, presence.both, presence.laserOnly, presence.otherOnly, presence.neither], [64, 32, 0, 4, 28]);
  assert.ok(Math.abs(presence.agreement - 60 / 64) < 1e-12);
  assert.ok(presence.kappa > 0.85 && presence.kappa < 0.9, `kappa ${presence.kappa}`);
  const heights = heightAgreement(laser, other);
  assert.equal(heights.n, 32);
  assert.equal(heights.biasMetres, 2);
  assert.equal(heights.maeMetres, 2);
  assert.equal(heights.p90AbsMetres, 2);
  const bins = binnedHeights(laser, other);
  assert.equal(bins[2].n, 32);
  assert.equal(bins[2].otherMeanMetres, 8);
  const tiles = tileCrosscheck(laser, other, { tileCells: 4 });
  assert.equal(tiles.length, 4);
  assert.equal(tiles[0].agreement, 1);
  assert.equal(tiles[1].agreement, 12 / 16);
  assert.equal(tiles[1].minEasting, 1004);
});

test('void cells are left out and a raster on another grid is refused', () => {
  const laser = raster(4, 4, () => 5);
  const other = raster(4, 4, (c, r) => (c === 0 && r === 0 ? Number.NaN : 5));
  assert.equal(presenceConfusion(laser, other).n, 15);
  assert.throws(() => presenceConfusion(laser, { ...other, originEasting: 999 }), /originEasting/);
});

test('the seam profile attributes a laser-only step to the campaigns and a shared step to the forest', () => {
  /* seam at row 10 of 20 (northing 1990): north rows 0-9, south rows 10-19 */
  const laserStep = raster(4, 20, (c, r) => (r < 10 ? 20 : 12));
  const otherFlat = raster(4, 20, () => 15);
  const campaign = seamProfile(laserStep, otherFlat, { seamNorthing: 1990, bandMetres: 10, stepMetres: 5 });
  assert.equal(campaign.steps.meanHeightMetres.laser, 8);
  assert.equal(campaign.steps.meanHeightMetres.other, 0);
  assert.equal(campaign.steps.meanHeightMetres.attribution, 'campaign');
  assert.equal(campaign.profile.length, 4);
  const otherStep = raster(4, 20, (c, r) => (r < 10 ? 18 : 10.5));
  const forest = seamProfile(laserStep, otherStep, { seamNorthing: 1990, bandMetres: 10, stepMetres: 5 });
  assert.equal(forest.steps.meanHeightMetres.attribution, 'forest');
  assert.equal(forest.steps.canopyFraction.attribution, 'forest');
});

test('the disagreement profile separates edge blur from isolated differences', () => {
  /* a 4 x 4 block of 10 m forest in both; the other adds a 3 m column beside
     it (blur) and one isolated 6 m cell far away */
  const laser = raster(8, 8, (c, r) => (c < 4 && r < 4 ? 10 : 0));
  const other = raster(8, 8, (c, r) => (c < 4 && r < 4 ? 10 : (c === 4 && r < 4 ? 3 : (c === 7 && r === 7 ? 6 : 0))));
  const profile = disagreementProfile(laser, other);
  assert.equal(profile.laserOnly.n, 0);
  assert.equal(profile.otherOnly.n, 5);
  assert.equal(profile.otherOnly.heights['3-5'], 4);
  assert.equal(profile.otherOnly.heights['5-10'], 1);
  assert.equal(profile.otherOnly.besideLaserCanopyFraction, 0.8);
});

test('cleared blocks are counted per tile with their largest connected extent', () => {
  /* one 3 x 3 block and one isolated cell of tall-in-imagery, bare-in-laser */
  const laser = raster(8, 8, () => 0);
  const other = raster(8, 8, (c, r) => ((c >= 1 && c <= 3 && r >= 1 && r <= 3) || (c === 7 && r === 7) ? 12 : 0));
  const [tile] = clearedBlocks(laser, other, { tileCells: 8, minBlockCells: 5 });
  assert.equal(tile.compared, 64);
  assert.equal(tile.tallImageryBareLaserFraction, 10 / 64);
  assert.ok(Math.abs(tile.largestBlockHectares - 9 / 10000) < 1e-12);
  assert.equal(tile.blocksOverMinimum, 1);
});

test('record agreement looks within the crown and reports the height bias per campaign', () => {
  const other = raster(10, 10, c => (c >= 5 ? 12 : 0));
  const records = [
    { easting: 1007.5, northing: 1995.5, crownRadiusMetres: 2, heightMetres: 15, campaignId: 'north' },
    { easting: 1001.5, northing: 1995.5, crownRadiusMetres: 1, heightMetres: 9, campaignId: 'south' },
    { easting: 1004.2, northing: 1995.5, crownRadiusMetres: 1.5, heightMetres: 9, campaignId: 'south' },
  ];
  const result = recordAgreement(records, other);
  assert.equal(result.n, 3);
  assert.equal(result.agree, 2);
  assert.equal(result.byCampaign.north.fraction, 1);
  assert.equal(result.byCampaign.north.heightBiasMetres, 3);
  assert.equal(result.byCampaign.south.agree, 1, 'the crown reaching the forest edge counts');
});
