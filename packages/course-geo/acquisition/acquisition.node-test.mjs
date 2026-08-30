import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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
  laserStatisticsFromMetadata,
  laserWindowPlan,
} from './laser-window.mjs';
import { terrainWindowPlan } from './terrain-window.mjs';
import { treeHeightExportUrl, treeHeightTiles } from './tree-height.mjs';

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

test('Laserdata Skog plan selects the newest containing COPC and bounds the point window', () => {
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
      ],
    },
  };
  const plan = laserWindowPlan(report, { spanMetres: 128, maximumPoints: 500_000 });
  assert.equal(plan.source.id, 'newer-south');
  assert.deepEqual(plan.boundsEpsg3006, [436, 372, 564, 500]);
  assert.equal(plan.areaSquareMetres, 16_384);
  const pipeline = copcStatsPipeline(plan, {
    type: 'basic', username: 'user', password: 'secret',
  });
  assert.equal(pipeline[0].type, 'readers.copc');
  assert.equal(pipeline[0].bounds, '([436,564],[372,500])');
  assert.equal(pipeline[0].count, 500_000);
  assert.equal(pipeline[1].count, 'Classification,ReturnNumber,NumberOfReturns');
  assert.doesNotMatch(JSON.stringify(plan), /user|secret|Basic /);
});

test('Laserdata Skog aggregates parse PDAL category counts without retaining points', () => {
  const statistics = laserStatisticsFromMetadata({
    stages: {
      'filters.stats': {
        statistic: [
          { name: 'Z', count: 4, minimum: 10, maximum: 17, average: 13, stddev: 2.5 },
          { name: 'Classification', counts: ['2.000000/1', '3.000000/2', '5.000000/1'] },
          { name: 'ReturnNumber', counts: ['1.000000/3', '2.000000/1'] },
          { name: 'NumberOfReturns', counts: ['1.000000/2', '2.000000/2'] },
        ],
      },
    },
  }, 10);
  assert.equal(statistics.pointCount, 4);
  assert.deepEqual(statistics.classificationCounts, [
    { value: 2, count: 1 }, { value: 3, count: 2 }, { value: 5, count: 1 },
  ]);
  assert.deepEqual(statistics.returnNumberCounts, [
    { value: 1, count: 3 }, { value: 2, count: 1 },
  ]);
});

test('Laserdata Skog aggregates reject malformed or over-budget PDAL metadata', () => {
  const metadata = count => ({ statistic: [
    { name: 'Z', count, minimum: 1, maximum: 2, average: 1.5, stddev: 0.5 },
    { name: 'Classification', counts: ['not-a-count'] },
    { name: 'ReturnNumber', counts: [`1.000000/${count}`] },
    { name: 'NumberOfReturns', counts: [`1.000000/${count}`] },
  ] });
  assert.throws(() => laserStatisticsFromMetadata(metadata(11), 10), /outside 1\.\.10/);
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
