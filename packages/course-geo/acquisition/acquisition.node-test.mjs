import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EXPECTED_GROUNDS } from '../manifest.mjs';
import {
  coverageSummary,
  rectangleUnionArea,
  selectLatestCampaign,
  selectNewestCoverage,
  sha256FromStacChecksum,
  stacSearch,
} from './stac.mjs';
import {
  credentialState,
  gdalHttpEnvironment,
  lantmaterietCredentials,
} from './credentials.mjs';
import {
  probeLantmaterietAccess,
  probeLantmaterietLaserAccess,
  probeProviderAccess,
} from './access-preflight.mjs';
import {
  copcStatsPipeline,
  laserDensityAssessment,
  laserDensityEvidence,
  laserStatisticsFromMetadata,
  laserWindowPlan,
} from './laser-window.mjs';
import { terrainWindowPlan } from './terrain-window.mjs';
import {
  treeHeightExportUrl,
  treeHeightRasterEvidence,
  treeHeightTiles,
} from './tree-height.mjs';
import {
  alignedControlWindows,
  sourceControlDisposition,
  treeHeightQualityAssessment,
} from './hole-source-controls.mjs';
import { loadRepositoryHoleSourceControlPlan } from './hole-source-inventory.mjs';
import {
  discoverGroundLaserControl,
  executeGroundHoleSourceControls,
} from './hole-source-runner.mjs';

const HASH_A = 'a'.repeat(64);

function feature(id, collection, bbox, date, extra = {}) {
  return {
    id,
    collection,
    bbox: [10, 50, 20, 70],
    properties: {
      'proj:bbox': bbox,
      'proj:code': collection.startsWith('orto-') ? 'EPSG:3006' : 'EPSG:5845',
      datetime: date,
      ...extra,
    },
    assets: {
      data: {
        href: `https://dl1.lantmateriet.se/hojd/data/${id}.tif`,
        'file:size': 100,
        'file:checksum': `1220${HASH_A}`,
        'proj:bbox': bbox,
      },
      breakgeometry: {
        href: `https://dl1.lantmateriet.se/hojd/data/${id}.gpkg`,
        'file:size': 20,
        'file:checksum': `1220${HASH_A}`,
      },
    },
  };
}

test('rectangle coverage uses exact union area without double counting', () => {
  assert.equal(rectangleUnionArea([[0, 0, 6, 10], [4, 0, 10, 10]]), 100);
  assert.deepEqual(coverageSummary([
    feature('left', 'dtm-cog', [0, 0, 6, 10], '2025-01-01'),
    feature('right', 'dtm-cog', [4, 0, 10, 10], '2025-01-01'),
  ], [0, 0, 10, 10]), {
    requiredSquareMetres: 100,
    coveredSquareMetres: 100,
    ratio: 1,
    complete: true,
  });
});

test('newest-coverage selection keeps an older item only for an uncovered region', () => {
  const selected = selectNewestCoverage([
    feature('old-south', 'dsm-skoglig-copc', [0, 0, 10, 5], '2020-01-01'),
    feature('new-south', 'dsm-skoglig-copc', [0, 0, 10, 5], '2026-01-01'),
    feature('older-north', 'dsm-skoglig-copc', [0, 5, 10, 10], '2023-01-01'),
  ], [0, 0, 10, 10]);
  assert.deepEqual(selected.features.map(item => item.id), ['new-south', 'older-north']);
  assert.equal(selected.coverage.ratio, 1);
});

test('orthophoto selection keeps the newest campaign and fills only its coverage gap', () => {
  const selected = selectLatestCampaign([
    feature('new-left', 'orto-a-2026', [0, 0, 5, 10], '2026-06-01', { flygar: 2026 }),
    feature('old-left', 'orto-a-2025', [0, 0, 5, 10], '2025-06-01', { flygar: 2025 }),
    feature('old-right', 'orto-a-2025', [5, 0, 10, 10], '2025-06-01', { flygar: 2025 }),
  ], [0, 0, 10, 10]);
  assert.equal(selected.collection, 'orto-a-2026');
  assert.equal(selected.primaryCoverage.ratio, 0.5);
  assert.equal(selected.coverage.complete, true);
  assert.deepEqual(selected.fallbackCollections, ['orto-a-2025']);
  assert.equal(selected.completeCampaignAvailable, true);
});

test('STAC SHA-256 multihash is projected without dropping validation', () => {
  assert.equal(sha256FromStacChecksum(`1220${HASH_A}`), HASH_A);
  assert.equal(sha256FromStacChecksum(HASH_A), HASH_A);
  assert.equal(sha256FromStacChecksum(`1320${HASH_A}`), null);
  assert.equal(sha256FromStacChecksum('not-a-hash'), null);
});

test('STAC pagination follows same-catalog GET links and deduplicates items', async () => {
  const pages = [
    {
      features: [feature('a', 'dtm-cog', [0, 0, 1, 1], '2025-01-01')],
      links: [{ rel: 'next', href: 'https://example.test/stac/v1/search?page=2', method: 'GET' }],
    },
    {
      features: [
        feature('a', 'dtm-cog', [0, 0, 1, 1], '2025-01-01'),
        feature('b', 'dtm-cog', [1, 0, 2, 1], '2025-01-01'),
      ],
      links: [],
    },
  ];
  let calls = 0;
  const fetchImpl = async () => ({ ok: true, json: async () => pages[calls++] });
  const items = await stacSearch('https://example.test/stac/v1/', {
    bbox: [10, 50, 20, 60],
    collections: ['dtm-cog'],
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.deepEqual(items.map(item => item.id), ['a', 'b']);
});

test('STAC pagination refuses a cross-origin next link', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ features: [], links: [{ rel: 'next', href: 'https://evil.test/page' }] }),
  });
  await assert.rejects(
    stacSearch('https://example.test/stac/v1/', {
      bbox: [10, 50, 20, 60],
      collections: ['dtm-cog'],
      fetchImpl,
    }),
    /refusing STAC pagination/,
  );
});

test('credential helpers require complete pairs and report only credential state', () => {
  assert.equal(lantmaterietCredentials({}), null);
  assert.throws(() => lantmaterietCredentials({ LANTMATERIET_USERNAME: 'user' }), /supplied together/);
  const credentials = lantmaterietCredentials({
    LANTMATERIET_USERNAME: 'user',
    LANTMATERIET_PASSWORD: 'secret',
  });
  assert.equal(credentialState(credentials), 'basic-configured');
  assert.equal(gdalHttpEnvironment(credentials).GDAL_HTTP_USERPWD, 'user:secret');
  assert.doesNotMatch(JSON.stringify({ state: credentialState(credentials) }), /user|secret/);
});

test('terrain window plan uses remote COG ranges and exact projected AOI', () => {
  const item = feature('tile-a', 'dtm-cog', [0, 0, 10, 10], '2025-01-01');
  const report = {
    groundId: 'puttom',
    aoi: { bboxEpsg3006: [1, 2, 9, 8] },
    terrain: {
      coverage: { complete: true },
      items: [{
        id: item.id,
        assets: {
          data: {
            href: item.assets.data.href,
            bytes: 100,
            sha256: HASH_A,
          },
          breakgeometry: {
            href: item.assets.breakgeometry.href,
            bytes: 20,
            sha256: HASH_A,
          },
        },
      }],
    },
  };
  const plan = terrainWindowPlan(report, '/tmp/course-geo-acquisition-test');
  assert.ok(plan.buildVrtArgs.includes(`/vsicurl/${item.assets.data.href}`));
  assert.deepEqual(
    plan.translateArgs.slice(plan.translateArgs.indexOf('-projwin'), plan.translateArgs.indexOf('-projwin') + 5),
    ['-projwin', '1', '8', '9', '2'],
  );
  assert.equal(path.basename(plan.terrainOutput), 'terrain-window.cog.tif');
});

test('tree-height export is split into bounded exact-resolution requests', () => {
  const tiles = treeHeightTiles([0.2, 0.7, 4100.2, 2100.1], { maxPixels: 2048 });
  assert.equal(tiles.length, 6);
  assert.ok(tiles.every(tile => tile.width <= 2048 && tile.height <= 2048));
  const url = treeHeightExportUrl(tiles[0]);
  assert.equal(url.origin, 'https://geodata.skogsstyrelsen.se');
  assert.equal(url.searchParams.get('bboxSR'), '3006');
  assert.equal(url.searchParams.get('pixelType'), 'S16');
  assert.deepEqual(JSON.parse(url.searchParams.get('renderingRule')), { rasterFunction: 'None' });
});

test('per-hole controls use deterministic shared 256 metre EPSG:3006 windows', () => {
  const windows = alignedControlWindows([100, 100, 400, 400]);
  assert.deepEqual(windows.map(window => window.id), [
    'w256-0-0',
    'w256-256-0',
    'w256-0-256',
    'w256-256-256',
  ]);
  assert.ok(windows.every(window =>
    window.spanMetres === 256 &&
    window.areaSquareMetres === 65_536 &&
    window.bboxEpsg3006.every(value => value % 256 === 0)));
});

test('tree-height quality keeps valid zero-height open ground and blocks invalid rasters', () => {
  const window = {
    treeHeight: {
      request: {
        bboxEpsg3006: [1000, 2000, 1256, 2256],
        width: 256,
        height: 256,
        horizontalCrs: 'EPSG:3006',
        pixelType: 'S16',
        resolutionMetres: 1,
        nodata: 0,
      },
    },
  };
  const valid = treeHeightQualityAssessment(window, {
    width: 256,
    height: 256,
    horizontalCrs: 'EPSG:3006',
    type: 'S16',
    resolutionMetres: 1,
    nodata: 0,
    bboxEpsg3006: [1000, 2000, 1256, 2256],
    geoTransform: [1000, 1, 0, 2256, 0, -1],
    minimumDecimetres: 0,
    maximumDecimetres: 321,
  });
  assert.equal(valid.usable, true);
  assert.equal(valid.minimumMetres, 0);
  assert.equal(valid.maximumMetres, 32.1);

  const invalid = treeHeightQualityAssessment(window, {
    width: 128,
    height: 256,
    horizontalCrs: 'EPSG:3006',
    type: 'S16',
    resolutionMetres: 2,
    nodata: 0,
    bboxEpsg3006: [1000, 2000, 1256, 2256],
    geoTransform: [1000, 1, 0, 2256, 0, -1],
    minimumDecimetres: 0,
    maximumDecimetres: 900,
  });
  assert.equal(invalid.usable, false);
  assert.deepEqual(invalid.reasons, [
    'unexpected-raster-size',
    'unexpected-resolution',
    'implausible-tree-height',
  ]);
});

test('gdal tree-height evidence preserves exact EPSG:3006 pixel alignment', () => {
  const window = {
    treeHeight: { request: {
      bboxEpsg3006: [1000, 2000, 1256, 2256],
      width: 256,
      height: 256,
      horizontalCrs: 'EPSG:3006',
      pixelType: 'S16',
      resolutionMetres: 1,
      nodata: 0,
    } },
  };
  const evidence = treeHeightRasterEvidence({
    size: [256, 256],
    coordinateSystem: { wkt: 'PROJCRS["SWEREF99 TM",ID["EPSG",3006]]' },
    geoTransform: [1000, 1, 0, 2256, 0, -1],
    bands: [{
      type: 'Int16', noDataValue: 0, minimum: 0, maximum: 287,
      mean: 105.4, stdDev: 70.2,
    }],
  }, window, { compressedBytes: 1234, sha256: HASH_A });
  assert.equal(evidence.type, 'S16');
  assert.deepEqual(evidence.bboxEpsg3006, [1000, 2000, 1256, 2256]);
  assert.equal(evidence.resolutionMetres, 1);
  assert.equal(treeHeightQualityAssessment(window, evidence).usable, true);
});

test('automatic object candidates require both usable Laserdata and tree height', () => {
  assert.deepEqual(sourceControlDisposition({
    laserAssessments: [{ usable: false }],
    treeHeightAssessment: { usable: true },
  }), {
    laserUsable: false,
    treeHeightUsable: true,
    state: 'tree-height-with-dtm-ortho-fallback',
    eligibleForAutomaticObjectCandidates: false,
  });
  assert.equal(sourceControlDisposition({
    laserAssessments: [{ usable: true }],
    treeHeightAssessment: { usable: true },
  }).eligibleForAutomaticObjectCandidates, true);
});

test('repository inventory plans Laserdata and tree-height controls for every hole on every course', () => {
  const plan = loadRepositoryHoleSourceControlPlan();
  assert.deepEqual(plan.summary, {
    groundCount: 7,
    courseCount: 10,
    holeCount: 144,
    /* 194 until 2026-09-05, when two measurements landed the same day:
       Veckefjärden's water and ditches became laser readings (laser-water.mjs,
       the 4th's and 18th's ditches — the 12th's pond is two lobes and the 2 m
       fjärd shoreline reaches one more 256 m control window), and Ribbingsfors's
       bunkers were re-centred onto their laser dishes and its clubhouse onto its
       measured roof. Both are read off the assertion's own "got" line, never
       added up: the two moves share the window they reached. */
    uniqueGroundWindowCount: 195,
    /* 702 until 2026-09-05, when the Johannesberg nine's 2nd, 7th and 8th greens
       became measured rings (trace-nine.mjs) and two of them reach a second
       256 m control window, and 709 when the Ribbingsfors pass measured its
       own; the number is MEASURED after every such pass, never summed */
    /* Upsala H8's reviewed tees remove two references (711 ->709). The
       Mellanbanan inventory now reads the shipped GPS-route model, rather than
       the retired guide model: holes3/4/7/8 change by-2/+2/+2/+3 references (->714).
       All144 holes and all195 unique windows remain covered. */
    requestedWindowReferences: 714,
    groundsWithDiscovery: plan.grounds.filter(ground =>
      ground.discoveryState === 'checksummed-snapshot-available').length,
    productionEnabled: false,
  });
  assert.deepEqual(
    plan.grounds.flatMap(ground => ground.courseSlugs).sort(),
    Object.values(EXPECTED_GROUNDS).flat().sort(),
  );
  for (const ground of plan.grounds) {
    for (const course of ground.courses) {
      assert.equal(course.holes.length, course.holeCount);
      assert.ok(course.holes.every(hole => hole.controlWindowIds.length > 0));
    }
    for (const window of ground.windows) {
      assert.ok(window.bboxEpsg3006.every(value => value % 256 === 0));
      assert.equal(window.treeHeight.request.resolutionMetres, 1);
      assert.equal(window.treeHeight.request.horizontalCrs, 'EPSG:3006');
      assert.equal(window.laser.requiresLocalDensityCheck, true);
      assert.equal(window.laser.eligibleForDerivedAssets, false);
      assert.ok(window.consumers.length > 0);
    }
  }
});

test('live Laserdata control discovery covers the complete expanded ground window extent', async () => {
  const item = feature('laser-control-a', 'dsm-skoglig-copc', [0, 0, 512, 256], '2026-01-01', {
    punkttathet: 1.7,
    'pc:count': 1000,
  });
  item.assets.data.type = 'application/vnd.laszip+copc';
  const result = await discoverGroundLaserControl({
    groundId: 'puttom',
    windows: [
      { bboxEpsg3006: [0, 0, 256, 256] },
      { bboxEpsg3006: [256, 0, 512, 256] },
    ],
  }, {
    toLatLon: points => points.map(point => ({
      latitude: point.northing / 1000,
      longitude: point.easting / 1000,
    })),
    fetchImpl: async () => ({ ok: true, json: async () => ({ features: [item], links: [] }) }),
  });
  assert.deepEqual(result.aoi.bboxEpsg3006, [0, 0, 512, 256]);
  assert.equal(result.laser.coverage.complete, true);
  assert.equal(result.laser.items[0].pointDensityPerSquareMetre, 1.7);
  assert.equal(result.laser.items[0].assets.data.type, 'application/vnd.laszip+copc');
});

test('authenticated control evidence omits window coordinates and raw provider payloads', async () => {
  const request = bboxEpsg3006 => ({
    bboxEpsg3006,
    horizontalCrs: 'EPSG:3006',
    width: 256,
    height: 256,
    resolutionMetres: 1,
    pixelType: 'S16',
    nodata: 0,
  });
  const windows = [
    {
      id: 'w256-1024-2048',
      bboxEpsg3006: [1024, 2048, 1280, 2304],
      consumers: [{ courseSlug: 'puttom', holeNumber: 1 }],
      treeHeight: { request: request([1024, 2048, 1280, 2304]) },
    },
    {
      id: 'w256-1280-2048',
      bboxEpsg3006: [1280, 2048, 1536, 2304],
      consumers: [{ courseSlug: 'puttom', holeNumber: 2 }],
      treeHeight: { request: request([1280, 2048, 1536, 2304]) },
    },
  ];
  const groundPlan = {
    groundId: 'puttom',
    courses: [{
      courseSlug: 'puttom', model: { sha256: HASH_A }, holeCount: 18,
    }],
    windows,
    summary: {
      courseCount: 1, holeCount: 18, uniqueWindowCount: 2, requestedWindowReferences: 2,
    },
  };
  const evidence = await executeGroundHoleSourceControls(groundPlan, {
    executedAt: '2026-08-30T12:00:00.000Z',
    checkLaser: async window => ({
      usable: window === windows[0],
      state: window === windows[0] ? 'usable' : 'local-density-gap',
      source: { itemId: 'laser-a', capturedAt: '2025-01-01', sourceSha256: HASH_A },
      pointCount: window === windows[0] ? 1000 : 10,
      observedPointDensityPerSquareMetre: window === windows[0] ? 1.5 : 0.001,
      advertisedPointDensityPerSquareMetre: 1.5,
      advertisedDensityRatio: window === windows[0] ? 1 : 0.0007,
      classificationCounts: [{ value: 2, count: 10 }],
      returnNumberCounts: [{ value: 1, count: 10 }],
      numberOfReturnsCounts: [{ value: 1, count: 10 }],
      elapsedMilliseconds: 10,
    }),
    checkTreeHeight: async window => ({
      acquisition: { raster: {
        meanDecimetres: 100,
        standardDeviationDecimetres: 50,
        compressedBytes: 2000,
        sha256: HASH_A,
      }, elapsedMilliseconds: 5 },
      assessment: {
        usable: true, reasons: [], minimumMetres: 0, maximumMetres: 30,
      },
    }),
  });
  assert.equal(evidence.summary.checkedWindowCount, 2);
  assert.equal(evidence.summary.automaticEligibleCount, 1);
  assert.equal(evidence.summary.fallbackOrReviewCount, 1);
  assert.equal(evidence.summary.productionEnabled, false);
  assert.ok(evidence.windows.every(window => /^[a-f0-9]{24}$/.test(window.controlKey)));
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /w256-|bboxEpsg3006|cachePath|sourceUrl|Authorization/);
});

test('Laserdata Skog plan prefers the AOI centre, then the newest containing COPC', () => {
  const report = {
    groundId: 'puttom',
    aoi: { bboxEpsg3006: [0, 0, 1000, 1100] },
    laser: {
      collection: 'dsm-skoglig-copc',
      items: [
        {
          id: 'older-north', collection: 'dsm-skoglig-copc', capturedAt: '2023-06-04',
          projBbox: [0, 500, 2000, 1500], pointCount: 100,
          pointDensityPerSquareMetre: 1.1,
          assets: { data: {
            href: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/old.copc.laz',
            type: 'application/vnd.laszip+copc', bytes: 2000, sha256: HASH_A,
          } },
        },
        {
          id: 'newer-south', collection: 'dsm-skoglig-copc', capturedAt: '2026-06-11',
          projBbox: [0, -500, 2000, 500], pointCount: 200,
          pointDensityPerSquareMetre: 1.7,
          assets: { data: {
            href: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/new.copc.laz',
            type: 'application/vnd.laszip+copc', bytes: 3000, sha256: HASH_A,
          } },
        },
        {
          id: 'newest-centred', collection: 'dsm-skoglig-copc', capturedAt: '2025-08-12',
          projBbox: [-500, -500, 1500, 1500], pointCount: 300,
          pointDensityPerSquareMetre: 1.9,
          assets: { data: {
            href: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/centred.copc.laz',
            type: 'application/vnd.laszip+copc', bytes: 4000, sha256: HASH_A,
          } },
        },
        {
          id: 'older-centred', collection: 'dsm-skoglig-copc', capturedAt: '2024-08-12',
          projBbox: [-500, -500, 1500, 1500], pointCount: 300,
          pointDensityPerSquareMetre: 1.8,
          assets: { data: {
            href: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/older-centred.copc.laz',
            type: 'application/vnd.laszip+copc', bytes: 3500, sha256: HASH_A,
          } },
        },
      ],
    },
  };
  const plan = laserWindowPlan(report, { spanMetres: 128, maximumPoints: 500_000 });
  assert.equal(plan.source.id, 'newest-centred');
  assert.deepEqual(plan.boundsEpsg3006, [436, 486, 564, 614]);
  assert.deepEqual(plan.focusEpsg3006, [500, 550]);
  assert.equal(plan.selection, 'nearest-aoi-centre-then-newest');
  assert.equal(plan.areaSquareMetres, 16_384);
  const pipeline = copcStatsPipeline(plan, {
    type: 'basic', username: 'user', password: 'secret',
  });
  assert.equal(pipeline[0].type, 'readers.copc');
  assert.equal(pipeline[0].filename.path,
    'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/centred.copc.laz');
  assert.match(pipeline[0].filename.headers.Authorization, /^Basic /);
  assert.equal(pipeline[0].bounds, '([436,564],[486,614])');
  assert.equal(pipeline[0].count, undefined);
  assert.equal(pipeline[1].type, 'filters.head');
  assert.equal(pipeline[1].count, 500_000);
  assert.equal(pipeline[2].count, 'Classification,ReturnNumber,NumberOfReturns');
  assert.doesNotMatch(JSON.stringify(plan), /user|secret|Basic /);
});

test('Laserdata Skog plan can centre a bounded window on a playable hole focus', () => {
  const report = {
    groundId: 'puttom',
    aoi: { bboxEpsg3006: [0, 0, 1000, 1000] },
    laser: {
      collection: 'dsm-skoglig-copc',
      items: [{
        id: 'north', collection: 'dsm-skoglig-copc', capturedAt: '2025-01-01',
        projBbox: [0, 500, 1000, 1000], pointCount: 100,
        pointDensityPerSquareMetre: 1.1,
        assets: { data: {
          href: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/north.copc.laz',
          type: 'application/vnd.laszip+copc', bytes: 2000, sha256: HASH_A,
        } },
      }],
    },
  };
  const plan = laserWindowPlan(report, {
    spanMetres: 256,
    focusEpsg3006: [337, 889],
  });
  assert.deepEqual(plan.boundsEpsg3006, [209, 744, 465, 1000]);
  assert.deepEqual(plan.focusEpsg3006, [337, 889]);
  assert.equal(plan.selection, 'nearest-focus-then-newest');
  assert.throws(() => laserWindowPlan(report, {
    focusEpsg3006: [1001, 500],
  }), /inside the laser AOI/);
});

test('Laserdata Skog density gate detects an empty tile edge', () => {
  const plan = {
    areaSquareMetres: 65_536,
    source: { pointDensityPerSquareMetre: 0.6 },
  };
  const sparse = laserDensityAssessment(plan, 315);
  assert.equal(sparse.usable, false);
  assert.equal(laserDensityAssessment(plan, 0).usable, false);
  assert.throws(() => laserDensityEvidence(plan, 315), /density ratio .* below 0\.1/);
  const evidence = laserDensityEvidence(plan, 39_322);
  assert.equal(evidence.usable, true);
  assert.ok(Math.abs(evidence.observedPointDensityPerSquareMetre - 0.6) < 0.001);
  assert.ok(evidence.advertisedDensityRatio > 0.99);
});

test('Laserdata Skog aggregates parse PDAL category counts without retaining points', () => {
  const statistics = laserStatisticsFromMetadata({
    stages: {
      'filters.stats': {
        statistic: [
          { name: 'X', count: 4, minimum: 100, maximum: 102 },
          { name: 'Y', count: 4, minimum: 200, maximum: 203 },
          { name: 'Z', count: 4, minimum: 10, maximum: 17, average: 13, stddev: 2.5 },
          { name: 'Classification', counts: ['2.000000/1', '3.000000/2', '5.000000/1'] },
          { name: 'ReturnNumber', counts: ['1.000000/3', '2.000000/1'] },
          { name: 'NumberOfReturns', counts: ['1.000000/2', '2.000000/2'] },
        ],
      },
    },
  }, 10, { expectedBoundsEpsg3006: [99, 199, 103, 204] });
  assert.equal(statistics.pointCount, 4);
  assert.deepEqual(statistics.observedBoundsEpsg3006, [100, 200, 102, 203]);
  assert.deepEqual(statistics.classificationCounts, [
    { value: 2, count: 1 }, { value: 3, count: 2 }, { value: 5, count: 1 },
  ]);
  assert.deepEqual(statistics.returnNumberCounts, [
    { value: 1, count: 3 }, { value: 2, count: 1 },
  ]);
  assert.throws(() => laserStatisticsFromMetadata({ statistic: [
    { name: 'X', count: 4, minimum: 98, maximum: 102 },
    { name: 'Y', count: 4, minimum: 200, maximum: 203 },
    { name: 'Z', count: 4 },
    { name: 'Classification', counts: ['2/4'] },
    { name: 'ReturnNumber', counts: ['1/4'] },
    { name: 'NumberOfReturns', counts: ['1/4'] },
  ] }, 10, { expectedBoundsEpsg3006: [99, 199, 103, 204] }), /outside the requested/);
});

test('Laserdata Skog aggregates reject malformed or over-budget PDAL metadata', () => {
  const metadata = count => ({ statistic: [
    { name: 'Z', count, minimum: 1, maximum: 2, average: 1.5, stddev: 0.5 },
    { name: 'Classification', counts: ['not-a-count'] },
    { name: 'ReturnNumber', counts: [`1.000000/${count}`] },
    { name: 'NumberOfReturns', counts: [`1.000000/${count}`] },
  ] });
  assert.throws(() => laserStatisticsFromMetadata(metadata(10), 10), /outside 1\.\.9/);
  assert.throws(() => laserStatisticsFromMetadata(metadata(11), 10), /outside 1\.\.9/);
  assert.throws(() => laserStatisticsFromMetadata(metadata(2), 10), /invalid Classification count/);
});

test('Laserdata Skog plan rejects an asset URL with ambient query credentials', () => {
  const report = {
    groundId: 'puttom',
    aoi: { bboxEpsg3006: [0, 0, 100, 100] },
    laser: {
      collection: 'dsm-skoglig-copc',
      items: [{
        id: 'laser', collection: 'dsm-skoglig-copc', capturedAt: '2026-01-01',
        projBbox: [0, 0, 100, 100],
        assets: { data: {
          href: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/a.copc.laz?token=secret',
          type: 'application/vnd.laszip+copc', bytes: 1000, sha256: HASH_A,
        } },
      }],
    },
  };
  assert.throws(() => laserWindowPlan(report, { spanMetres: 32 }), /refusing non-Laserdata/);
});

function accessReport() {
  return {
    groundId: 'puttom',
    aoi: { bboxEpsg3006: [695000, 7022000, 699000, 7027000] },
    terrain: {
      items: [{
        id: 'tile-a',
        assets: {
          data: {
            href: 'https://dl1.lantmateriet.se/hojd/data/tile-a.tif',
            bytes: 1000,
          },
        },
      }],
    },
    laser: {
      collection: 'dsm-skoglig-copc',
      items: [{
        id: 'laser-a',
        pointCount: 123456,
        pointDensityPerSquareMetre: 1.7,
        assets: {
          data: {
            href: 'https://dl1.lantmateriet.se/hojd/data/laser-a.copc.laz',
            type: 'application/vnd.laszip+copc',
            bytes: 2000,
          },
        },
      }],
    },
  };
}

const TIFF_PROBE = Uint8Array.from([
  0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
]);

const COPC_PROBE = (() => {
  const value = new Uint8Array(589);
  value.set(new TextEncoder().encode('LASF'), 0);
  value[24] = 1;
  value[25] = 4;
  value[104] = 0x80 | 7;
  value.set(new TextEncoder().encode('copc'), 377);
  value[393] = 1;
  value[394] = 0;
  value[395] = 160;
  return value;
})();

test('provider access preflight proves range and raster access without serializing credentials', async () => {
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.hostname === 'dl1.lantmateriet.se') {
      if (url.pathname.endsWith('.copc.laz')) {
        return new Response(COPC_PROBE, {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-588/2000', 'Content-Length': '589' },
        });
      }
      return new Response(TIFF_PROBE, {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-15/1000', 'Content-Length': '16' },
      });
    }
    if (url.pathname.endsWith('/ImageServer') && url.searchParams.get('f') === 'pjson') {
      return Response.json({
        name: 'Tradhojd_3_2',
        pixelType: 'S16',
        spatialReference: { wkid: 3006 },
      });
    }
    if (url.pathname.endsWith('/exportImage')) return new Response(TIFF_PROBE);
    return new Response('unexpected', { status: 500 });
  };
  const result = await probeProviderAccess(accessReport(), {
    env: {
      LANTMATERIET_USERNAME: 'lm-user',
      LANTMATERIET_PASSWORD: 'lm-secret',
      SKOGSSTYRELSEN_USERNAME: 'sks-user',
      SKOGSSTYRELSEN_PASSWORD: 'sks-secret',
    },
    fetchImpl,
  });
  assert.equal(result.ready, true);
  assert.equal(result.providers.lantmateriet.rangeSupported, true);
  assert.equal(result.providers.lantmateriet.laser.bytesRead, 589);
  assert.equal(result.providers.lantmateriet.laser.pointDataRecordFormat, 7);
  assert.equal(result.providers.skogsstyrelsen.sampleBytes, TIFF_PROBE.byteLength);
  assert.equal(requests.length, 4);
  assert.equal(new Headers(requests[0].options.headers).get('range'), 'bytes=0-15');
  assert.equal(new Headers(requests[1].options.headers).get('range'), 'bytes=0-588');
  assert.ok(requests.every(request => new Headers(request.options.headers).has('authorization')));
  assert.doesNotMatch(JSON.stringify(result), /lm-user|lm-secret|sks-user|sks-secret|Basic /);
});

test('provider preflight is a no-network readiness report while credentials are pending', async () => {
  let calls = 0;
  const result = await probeProviderAccess(accessReport(), {
    env: {},
    fetchImpl: async () => { calls++; throw new Error('must not fetch'); },
  });
  assert.equal(result.ready, false);
  assert.equal(result.providers.lantmateriet.credentialState, 'missing');
  assert.equal(result.providers.skogsstyrelsen.credentialState, 'missing');
  assert.equal(calls, 0);
});

test('provider preflight separates a denied account from an unreachable provider', async () => {
  /* CI once failed with nothing but `lantmateriet: fetch failed`, which is
     what undici says for DNS, TLS, a reset and a refused socket alike. The
     run before it had passed, so the failure was weather -- but the log could
     not say so, and an outage and a lost entitlement need opposite responses
     from a human. */
  const outage = await probeProviderAccess(accessReport(), {
    providers: ['lantmateriet'],
    env: { LANTMATERIET_USERNAME: 'lm-user', LANTMATERIET_PASSWORD: 'lm-secret' },
    fetchImpl: async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo EAI_AGAIN dl1.lantmateriet.se'), { code: 'EAI_AGAIN' }),
      });
    },
  });
  assert.equal(outage.ready, false);
  assert.equal(outage.providers.lantmateriet.denied, false);
  assert.equal(outage.providers.lantmateriet.reason,
    'fetch failed <- EAI_AGAIN: getaddrinfo EAI_AGAIN dl1.lantmateriet.se');
  /* An unwrapped cause chain is new text in the report, so it gets the same
     no-secrets assertion every other serialized path here already carries. */
  assert.doesNotMatch(JSON.stringify(outage), /lm-user|lm-secret|Basic /);

  const denied = await probeProviderAccess(accessReport(), {
    providers: ['skogsstyrelsen'],
    env: { SKOGSSTYRELSEN_USERNAME: 'sks-user', SKOGSSTYRELSEN_PASSWORD: 'sks-secret' },
    fetchImpl: async () => new Response('no', { status: 401 }),
  });
  assert.equal(denied.ready, false);
  assert.equal(denied.providers.skogsstyrelsen.denied, true);
  /* No `Error:` in front of it: a generic error name labels nothing. */
  assert.equal(denied.providers.skogsstyrelsen.reason,
    'Skogsstyrelsen denied the configured account (HTTP 401)');
  assert.doesNotMatch(JSON.stringify(denied), /sks-user|sks-secret|Basic /);
});

test('provider preflight can approve Lantmäteriet independently while Skogsstyrelsen is pending', async () => {
  let calls = 0;
  const result = await probeProviderAccess(accessReport(), {
    providers: ['lantmateriet'],
    env: {
      LANTMATERIET_USERNAME: 'lm-user',
      LANTMATERIET_PASSWORD: 'lm-secret',
    },
    fetchImpl: async input => {
      calls++;
      const url = new URL(input);
      assert.equal(url.hostname, 'dl1.lantmateriet.se');
      if (url.pathname.endsWith('.copc.laz')) {
        return new Response(COPC_PROBE, {
          status: 206,
          headers: { 'Content-Range': 'bytes 0-588/2000', 'Content-Length': '589' },
        });
      }
      return new Response(TIFF_PROBE, {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-15/1000', 'Content-Length': '16' },
      });
    },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.selectedProviders, ['lantmateriet']);
  assert.equal(result.providers.lantmateriet.ready, true);
  assert.equal(result.providers.skogsstyrelsen.skipped, true);
  assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(result), /lm-user|lm-secret|Basic /);
});

test('Lantmäteriet preflight refuses a full-body response because GDAL needs byte ranges', async () => {
  await assert.rejects(probeLantmaterietAccess(accessReport(), {
    credentials: { type: 'basic', username: 'user', password: 'secret' },
    fetchImpl: async () => new Response(TIFF_PROBE, { status: 200 }),
  }), /did not provide byte ranges/);
});

test('Laserdata Skog preflight rejects a LAZ file without the COPC info VLR', async () => {
  const invalid = COPC_PROBE.slice();
  invalid.fill(0, 377, 381);
  await assert.rejects(probeLantmaterietLaserAccess(accessReport(), {
    credentials: { type: 'basic', username: 'user', password: 'secret' },
    fetchImpl: async () => new Response(invalid, {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-588/2000', 'Content-Length': '589' },
    }),
  }), /not a valid COPC/);
});

test('provider preflight reports denied access without exposing the authorization value', async () => {
  const fetchImpl = async input => {
    const url = new URL(input);
    if (url.hostname === 'dl1.lantmateriet.se') return new Response('denied', { status: 403 });
    if (url.pathname.endsWith('/ImageServer')) return Response.json({ name: 'tree', pixelType: 'S16' });
    return new Response(TIFF_PROBE);
  };
  const result = await probeProviderAccess(accessReport(), {
    env: {
      LANTMATERIET_USERNAME: 'user',
      LANTMATERIET_PASSWORD: 'secret',
      SKOGSSTYRELSEN_USERNAME: 'tree',
      SKOGSSTYRELSEN_PASSWORD: 'tree-secret',
    },
    fetchImpl,
  });
  assert.equal(result.ready, false);
  assert.match(result.providers.lantmateriet.reason, /denied.*403/);
  assert.doesNotMatch(JSON.stringify(result), /secret|Basic /);
});
