import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LASER_TERMS,
  campaignDrift,
  campaignInventory,
  itemStatisticsFromInfo,
  laserCampaignsReport,
  parseSkogsstyrelsenScanMetadata,
  rectangleSeamRelation,
  safePublicInfoUrl,
  scanMetadataQueryUrl,
  seamDistances,
  validateLaserCampaignsReport,
} from './laser-campaigns.mjs';

const HASH = 'a'.repeat(64);
const AOI = [695289.437, 7022734.805, 699568.189, 7027431.813];

function item(id, projBbox, start, end, extra = {}) {
  return {
    id,
    collection: 'dsm-skoglig-copc',
    bbox: [18.7, 63.2, 19.0, 63.4],
    properties: {
      datetime: end,
      start_datetime: start,
      end_datetime: end,
      updated: '2026-06-17T14:04:17Z',
      'proj:code': 'EPSG:5845',
      'proj:bbox': projBbox,
      punkttathet: 1.7,
      'pc:density': 0.6,
      'pc:count': 1000,
      ...extra,
    },
    assets: {
      data: {
        href: `https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/${id.slice(0, 6)}/m${id}.copc.laz`,
        type: 'application/vnd.laszip+copc',
        'file:size': 1000,
        'file:checksum': `1220${HASH}`,
        'proj:bbox': projBbox,
      },
      info: {
        href: `https://dl1.lantmateriet.se/hojd/pub/pointcloud/sls/${id.slice(0, 6)}/m${id}_info.json`,
        type: 'application/json',
        'file:size': 100,
        'file:checksum': `1220${HASH}`,
      },
    },
  };
}

const NORTH = item('23f028-702_69', [690000, 7025000, 700000, 7030000], '2023-06-01T00:00:00Z', '2023-06-07T00:00:00Z');
const SOUTH = item('26f015-702_69', [690000, 7020000, 700000, 7025000], '2026-06-01T00:00:00Z', '2026-06-21T00:00:00Z');
const OLD_SOUTH = item('20f015-702_69', [690000, 7020000, 700000, 7025000], '2020-06-16T00:00:00Z', '2020-08-10T00:00:00Z');

function info(count, area) {
  return {
    boundary: { area, density: count / area, avg_pt_spacing: 0.56, avg_pt_per_sq_unit: 0.94 },
    metadata: {
      count, major_version: 1, minor_version: 4, dataformat_id: 6, point_length: 30,
      comp_spatialreference: 'COMPD_CS["SWEREF99 TM + RH2000 height",AUTHORITY["EPSG","5845"]]',
      minx: 690000, maxx: 699999.99, miny: 7025000, maxy: 7029999.99, minz: 0.04, maxz: 165.71,
      scale_x: 0.01, scale_y: 0.01, scale_z: 0.01, offset_x: 535000, offset_y: 6715000, offset_z: 0,
      copc_info: { center_x: 694999.995, center_y: 7027499.995, center_z: 82.875, halfsize: 5000.005, spacing: 78.125, root_hier_offset: 1061381999, root_hier_size: 197824 },
      creation_year: 2026, creation_doy: 144, software_id: 'Untwine',
    },
    stats: { statistic: [
      { name: 'NumberOfReturns', average: 2.79, maximum: 5 },
      { name: 'ReturnNumber', average: 1.89 },
      { name: 'Classification', average: 1.39 },
      { name: 'Intensity', minimum: 740, average: 2376.7, maximum: 65535 },
      { name: 'ScanAngleRank', minimum: -18, maximum: 18 },
      { name: 'PointSourceId', minimum: 61709, maximum: 61715 },
      { name: 'GpsTime', minimum: 369625724.6, maximum: 370143420.4 },
    ] },
  };
}

test('item statistics keep the three density definitions apart', () => {
  const stats = itemStatisticsFromInfo(info(172835421, 54415020.02));
  assert.equal(stats.pointCount, 172835421);
  assert.equal(stats.allReturnDensityPerSquareMetre, 3.176);
  assert.equal(stats.averagePointSpacingMetres, 0.56);
  assert.equal(stats.compoundCrs, 'EPSG:5845');
  assert.equal(stats.pointRecordFormat, 6);
  assert.equal(stats.flightLines.count, 7);
  assert.equal(stats.gpsTime.spanSeconds, 517695.8);
  assert.equal(stats.returns.numberOfReturnsMax, 5);
  assert.throws(() => itemStatisticsFromInfo({ metadata: {} }), /incomplete/);
});

test('newest campaign owns its area, the older southern scan is superseded, and the abutting pair has one seam', () => {
  const inventory = campaignInventory([OLD_SOUTH, NORTH, SOUTH], AOI, {
    infoStatistics: new Map([[NORTH.id, itemStatisticsFromInfo(info(10, 5))]]),
  });
  assert.deepEqual(inventory.activeItemIds, [SOUTH.id, NORTH.id]);
  assert.deepEqual(inventory.supersededItemIds, [OLD_SOUTH.id]);
  const old = inventory.items.find(entry => entry.id === OLD_SOUTH.id);
  assert.equal(old.role, 'superseded');
  assert.equal(old.excludedFromCanopy, true);
  assert.deepEqual(old.supersededBy, [SOUTH.id]);
  assert.equal(old.exclusiveSquareMetres, 0);
  const south = inventory.items.find(entry => entry.id === SOUTH.id);
  assert.equal(south.role, 'active');
  assert.equal(south.excludedFromCanopy, false);
  assert.equal(south.statistics, null);
  assert.equal(inventory.seams.length, 1);
  assert.equal(inventory.seams[0].axis, 'northing');
  assert.equal(inventory.seams[0].value, 7025000);
  assert.deepEqual(inventory.seams[0].items, [NORTH.id, SOUTH.id]);
  assert.equal(inventory.seams[0].from, AOI[0]);
  assert.equal(inventory.seams[0].to, AOI[2]);
  assert.deepEqual(inventory.activeOverlapBands, []);
  assert.equal(inventory.coverageRatio, 1);
});

test('two active campaigns that overlap produce a band, not a seam', () => {
  const west = item('25a001-702_68', [690000, 7020000, 697000, 7030000], '2025-06-01T00:00:00Z', '2025-06-02T00:00:00Z');
  const east = item('26a001-702_69', [696000, 7020000, 700000, 7030000], '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z');
  const inventory = campaignInventory([west, east], AOI);
  assert.deepEqual(inventory.activeItemIds, [east.id, west.id]);
  assert.equal(inventory.seams.length, 0);
  assert.equal(inventory.activeOverlapBands.length, 1);
  assert.deepEqual(inventory.activeOverlapBands[0].bboxEpsg3006, [696000, AOI[1], 697000, AOI[3]]);
  const westItem = inventory.items.find(entry => entry.id === west.id);
  assert.equal(westItem.exclusiveSquareMetres, Math.round((696000 - AOI[0]) * (AOI[3] - AOI[1]) * 10) / 10);
});

test('items outside the AOI or in another collection are ignored', () => {
  const far = item('27a001-700_69', [670000, 7020000, 680000, 7030000], '2027-06-01T00:00:00Z', '2027-06-02T00:00:00Z');
  const dtm = { ...NORTH, id: '702_69', collection: 'dtm-cog' };
  const inventory = campaignInventory([far, dtm, NORTH], AOI);
  assert.deepEqual(inventory.items.map(entry => entry.id), [NORTH.id]);
  assert.ok(inventory.coverageRatio < 1);
});

test('seam distances and rectangle relations are signed by side', () => {
  const inventory = campaignInventory([NORTH, SOUTH], AOI);
  const [distance] = seamDistances({ easting: 697498.022, northing: 7024997.739 }, inventory.seams);
  assert.equal(distance.signedDistanceMetres, -2.261);
  assert.equal(distance.side, 'south');
  const [relation] = rectangleSeamRelation([696404.5, 7023802.5, 698452.5, 7025850.5], inventory.seams);
  assert.equal(relation.relation, 'straddles');
  assert.equal(relation.lowSideMetres, 1197.5);
  assert.equal(relation.highSideMetres, 850.5);
  assert.equal(rectangleSeamRelation([696404.5, 7025100, 698452.5, 7025850.5], inventory.seams)[0].relation, 'north');
});

test('Skogsstyrelsen scan metadata parses leaf state and sorts newest first', () => {
  const parsed = parseSkogsstyrelsenScanMetadata({ features: [
    { attributes: { Indexruta: '70225_6950_25', Las_Namn: '11F015_70225_6950_25', Datum: '2012-08-02', Lov_Avlov: 1, Skannermodell: 'Leica', Omdrev: 'Omdrev 1' } },
    { attributes: { Indexruta: '70225_6950_25', Las_Namn: '20F015_70225_6950_25', Datum: '2020-06-18', Lov_Avlov: 0, Skannermodell: 'ALS80-HP', Omdrev: 'Omdrev 2' } },
  ] });
  assert.equal(parsed[0].scanName, '20F015_70225_6950_25');
  assert.equal(parsed[0].leafOn, false);
  assert.equal(parsed[1].leafOn, true);
  assert.throws(() => parseSkogsstyrelsenScanMetadata({}), /no feature array/);
  const url = scanMetadataQueryUrl({ easting: 697498, northing: 7025300 });
  assert.equal(url.searchParams.get('inSR'), '3006');
  assert.equal(url.searchParams.get('f'), 'json');
  assert.match(url.searchParams.get('geometry'), /"x":697498/);
});

test('only public Lantmäteriet info assets are fetched', () => {
  assert.ok(safePublicInfoUrl('https://dl1.lantmateriet.se/hojd/pub/pointcloud/sls/26f015/m26f015-702_69_info.json'));
  assert.throws(() => safePublicInfoUrl('https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/26f015/m26f015-702_69.copc.laz'), /refusing/);
  assert.throws(() => safePublicInfoUrl('https://example.org/hojd/pub/pointcloud/sls/x/m_info.json'), /refusing/);
  assert.throws(() => safePublicInfoUrl('https://dl1.lantmateriet.se/hojd/pub/pointcloud/sls/x/m_info.json?token=1'), /refusing/);
});

test('the report validates, carries the attribution, and detects drift', () => {
  const inventory = campaignInventory([OLD_SOUTH, NORTH, SOUTH], AOI, {
    infoStatistics: new Map([
      [NORTH.id, itemStatisticsFromInfo(info(10, 5))],
      [SOUTH.id, itemStatisticsFromInfo(info(12, 5))],
    ]),
  });
  const evidence = [NORTH, SOUTH, OLD_SOUTH].map(feature => ({
    itemId: feature.id, href: feature.assets.info.href, bytes: 100, sha256: HASH, expectedSha256: HASH,
    checksumVerified: true, elapsedMilliseconds: 1,
  }));
  const report = laserCampaignsReport({
    groundId: 'puttom', groundName: 'Puttom Golfklubb', courseSlugs: ['puttom'], observedOn: '2026-09-02',
    aoi: { bboxWgs84: [18.9, 63.28, 18.98, 63.32], bboxEpsg3006: AOI },
    inventory, origin: { easting: 697498.022, northing: 7024997.739 }, infoEvidence: evidence,
  });
  assert.equal(report.terms.attribution, LASER_TERMS.attribution);
  assert.equal(report.origin.seams[0].side, 'south');
  assert.deepEqual(validateLaserCampaignsReport(report, { groundId: 'puttom', targetBboxWgs84: [18.9, 63.28, 18.98, 63.32] }), []);
  const broken = JSON.parse(JSON.stringify(report));
  broken.terms.attribution = 'something else';
  broken.infoEvidence[0].checksumVerified = false;
  const errors = validateLaserCampaignsReport(broken);
  assert.ok(errors.some(error => /attribution/.test(error)));
  assert.ok(errors.some(error => /checksum-verified/.test(error)));

  assert.equal(campaignDrift(report, report).drifted, false);
  const refly = item('27f001-702_69', [690000, 7025000, 700000, 7030000], '2027-06-01T00:00:00Z', '2027-06-03T00:00:00Z');
  const live = laserCampaignsReport({
    ...report, observedOn: '2027-09-01',
    inventory: campaignInventory([OLD_SOUTH, NORTH, SOUTH, refly], AOI, { infoStatistics: new Map() }),
    infoEvidence: evidence,
  });
  const drift = campaignDrift(report, live);
  assert.equal(drift.drifted, true);
  assert.deepEqual(drift.added, [refly.id]);
  assert.ok(drift.changed.some(change => change.id === NORTH.id && change.field === 'role' && change.live === 'superseded'));
  assert.ok(drift.changed.some(change => change.field === 'seams'));
});
