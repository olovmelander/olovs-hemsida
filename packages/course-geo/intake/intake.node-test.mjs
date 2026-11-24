import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NEEDS_MAPPING, PIXI } from '../toolchain/mapping-environment.mjs';

import {
  stitchRings,
  partitionOsmElements,
  assertOverpassFreshness,
  toGeoJsonFeature,
} from './acquire-osm.mjs';
import { verifyScorecard } from './verify-scorecard.mjs';
import { parseImageDimensions, acquireClubSources } from './acquire-club-sources.mjs';
import { summarizeLaserPoints, selectCopcItemsForBbox } from './acquire-microterrain-laser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-intake-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('acquire-osm isolates target club, rejects neighbour golf features, and flags missing hole refs', () => {
  // Two simple synthetic golf course boundaries around Bro Hof & a neighbouring club
  const targetBoundary = {
    type: 'relation',
    id: 5509342,
    tags: { leisure: 'golf_course', name: 'Target Club' },
    members: [
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 59.490, lon: 17.620 },
          { lat: 59.490, lon: 17.640 },
          { lat: 59.505, lon: 17.640 },
        ],
      },
      {
        type: 'way',
        role: 'outer',
        geometry: [
          { lat: 59.490, lon: 17.620 },
          { lat: 59.505, lon: 17.620 },
          { lat: 59.505, lon: 17.640 },
        ],
      },
    ],
  };
  const neighbourBoundary = {
    type: 'way',
    id: 35935442,
    tags: { leisure: 'golf_course', name: 'Neighbour Club' },
    geometry: [
      { lat: 59.515, lon: 17.580 },
      { lat: 59.515, lon: 17.600 },
      { lat: 59.525, lon: 17.600 },
      { lat: 59.525, lon: 17.580 },
      { lat: 59.515, lon: 17.580 },
    ],
  };
  const targetHole1 = {
    type: 'way',
    id: 101,
    tags: { golf: 'hole', ref: '1', par: '4', handicap: '7' },
    geometry: [
      { lat: 59.495, lon: 17.625 },
      { lat: 59.498, lon: 17.630 },
    ],
  };
  const neighbourHole1 = {
    type: 'way',
    id: 201,
    tags: { golf: 'hole', ref: '1', par: '4' },
    geometry: [
      { lat: 59.518, lon: 17.585 },
      { lat: 59.520, lon: 17.590 },
    ],
  };
  const castle = {
    type: 'way',
    id: 319035128,
    tags: { building: 'yes', historic: 'castle' },
    geometry: [
      { lat: 59.497, lon: 17.630 },
      { lat: 59.497, lon: 17.631 },
      { lat: 59.498, lon: 17.631 },
      { lat: 59.498, lon: 17.630 },
      { lat: 59.497, lon: 17.630 },
    ],
  };

  const { golf, context, report } = partitionOsmElements(
    [targetBoundary, neighbourBoundary, targetHole1, neighbourHole1, castle],
    { targetRelationId: 5509342, expectedHoleCount: 3 },
  );

  assert.equal(report.excludedNeighbourGolfCount, 1);
  assert.equal(report.mappedHoleCount, 1);
  assert.deepEqual(report.missingHoleRefs, [2, 3]);
  assert.equal(golf.features.some(f => f.id === 'w101'), true);
  assert.equal(golf.features.some(f => f.id === 'w201'), false);
  assert.equal(context.features.some(f => f.id === 'w319035128'), true);

  // Stitched relation boundary must become a closed Polygon
  const boundFeat = toGeoJsonFeature(targetBoundary);
  assert.equal(boundFeat.geometry.type, 'Polygon');
  assert.equal(stitchRings([[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 0]]]).length, 1);
});

test('assertOverpassFreshness rejects stale mirrors and accepts fresh timestamps', () => {
  const recent = new Date(Date.now() - 3600_000).toISOString();
  const stale = '2024-01-01T00:00:00Z';
  assert.equal(assertOverpassFreshness({ osm3s: { timestamp_osm_base: recent } }).ageDays < 1, true);
  assert.throws(() => assertOverpassFreshness({ osm3s: { timestamp_osm_base: stale } }, 14), /stale/);
  assert.throws(() => assertOverpassFreshness({}), /timestamp_osm_base/);
});

test('verifyScorecard validates sums, stroke index permutations, and cross-checks secondary cards', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: i % 3 === 0 ? 3 : i % 3 === 1 ? 4 : 5,
    index: ((i * 5) % 18) + 1,
    lengths: { back: 180 + i * 20, club: 150 + i * 18 },
  }));
  const frontBack = holes.slice(0, 9).reduce((s, h) => s + h.lengths.back, 0);
  const backBack = holes.slice(9).reduce((s, h) => s + h.lengths.back, 0);
  const frontClub = holes.slice(0, 9).reduce((s, h) => s + h.lengths.club, 0);
  const backClub = holes.slice(9).reduce((s, h) => s + h.lengths.club, 0);
  const card = {
    par: { front: 36, back: 36, total: 72 },
    tees: [
      { id: 'back', name: 'Back', front: frontBack, back: backBack, total: frontBack + backBack },
      { id: 'club', name: 'Club', front: frontClub, back: backClub, total: frontClub + backClub },
    ],
    holes,
  };

  const good = verifyScorecard(card, { secondaryCards: [{ sourceName: 'caddee', ...structuredClone(card) }] });
  assert.equal(good.valid, true);
  assert.equal(good.errors.length, 0);

  // Tamper one cell in secondary source -> must flag cell-by-cell mismatch
  const tamperedSecondary = structuredClone(card);
  tamperedSecondary.holes[15].lengths.back += 7;
  const mismatch = verifyScorecard(card, { secondaryCards: [{ sourceName: 'caddee', ...tamperedSecondary }] });
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.errors[0], /h16 tee back/);

  // Tamper duplicate stroke index
  const dupIdx = structuredClone(card);
  dupIdx.holes[1].index = dupIdx.holes[0].index;
  assert.equal(verifyScorecard(dupIdx).valid, false);
});

test('acquireClubSources parses PNG/JPEG/WEBP dimensions and emits SHA-256 ledger', async t => {
  const dir = tempDir(t);
  // Minimal valid PNG header (320 x 240)
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(320, 16);
  png.writeUInt32BE(240, 20);
  assert.deepEqual(parseImageDimensions(png), { format: 'png', width: 320, height: 240 });

  // Minimal JPEG SOF0 header (640 x 480)
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9]);
  assert.deepEqual(parseImageDimensions(jpg), { format: 'jpeg', width: 640, height: 480 });

  const mockFetch = async url => ({
    ok: true,
    status: 200,
    url,
    headers: new Map([['content-type', url.endsWith('.png') ? 'image/png' : 'application/json']]),
    arrayBuffer: async () => (url.endsWith('.png') ? png : Buffer.from('{"ok":true}')),
  });

  const ledger = await acquireClubSources({
    groundId: 'unit-ground',
    cacheDir: dir,
    fetchImpl: mockFetch,
    items: [
      { id: 'hole-map', url: 'https://example.test/hole17.png', kind: 'banguide', role: 'diagram' },
      { id: 'sgf-card', url: 'https://example.test/card.json', kind: 'scorecard', role: 'sgf-git' },
    ],
  });
  assert.equal(ledger.succeeded, 2);
  assert.equal(ledger.failed, 0);
  assert.deepEqual(ledger.entries[0].image, { format: 'png', width: 320, height: 240 });
  assert.equal(fs.existsSync(path.join(dir, 'hole-map.png')), true);
  assert.equal(fs.existsSync(path.join(dir, 'sgf-card.json')), true);
});

test('summarizeLaserPoints extracts roof eave/ridge, shoreline bulkhead step, and intensity quartiles', () => {
  // Synthetic points: ground at z=10, building roof eave at 18 / ridge at 24, water at 8.5
  const xs = [], ys = [], zs = [], cls = [], ret = [], nret = [], inten = [];
  const push = (x, y, z, c, i) => { xs.push(x); ys.push(y); zs.push(z); cls.push(c); ret.push(1); nret.push(1); inten.push(i); };
  for (let i = 0; i < 20; i++) push(649000 + i * 0.5, 6598500 + i * 0.5, 10.0 + (i % 3) * 0.1, 2, 1200 + i * 10);
  for (let i = 0; i < 15; i++) push(649010 + i * 0.4, 6598510 + i * 0.4, 18.0 + (i / 14) * 6.0, 6, 900);
  for (let i = 0; i < 10; i++) push(649020 + i * 0.5, 6598502, 8.5, 9, 120);

  const pts = {
    count: xs.length,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    z: Float32Array.from(zs),
    classification: Uint8Array.from(cls),
    returnNumber: Uint8Array.from(ret),
    numberOfReturns: Uint8Array.from(nret),
    intensity: Uint16Array.from(inten),
  };
  const { summary, microGrid } = summarizeLaserPoints(pts, [649000, 6598500, 649040, 6598540], { cellMetres: 1 });
  assert.equal(summary.pointCount, 45);
  assert(summary.buildingRelative.eaveAboveGroundMetres >= 7.5 && summary.buildingRelative.eaveAboveGroundMetres <= 9.0);
  assert(summary.buildingRelative.ridgeAboveGroundMetres >= 13.0 && summary.buildingRelative.ridgeAboveGroundMetres <= 14.5);
  assert(summary.shorelineDrop.stepHeightMetres >= 1.5 && summary.shorelineDrop.stepHeightMetres <= 1.8);
  assert.equal(microGrid.cols, 40);
  assert.equal(microGrid.rows, 40);

  const selected = selectCopcItemsForBbox({
    laser: {
      items: [
        { id: 'old', capturedAt: '2019-05-01', projBbox: [648000, 6597000, 650500, 6599500] },
        { id: 'new', capturedAt: '2023-05-01', projBbox: [648000, 6597000, 650500, 6599500] },
        { id: 'far', capturedAt: '2024-05-01', projBbox: [600000, 6500000, 602500, 6502500] },
      ],
    },
  }, [649000, 6598500, 649100, 6598600]);
  assert.deepEqual(selected.map(i => i.id), ['new', 'old']);
});

test('acquire-ortho-windows.py emits acquisition.json verified by render-source-overlays.py', { skip: NEEDS_MAPPING }, t => {
  const pixiExe = PIXI;
  const dir = tempDir(t);
  const srcTif = path.join(dir, 'synthetic-rgbi.tif');
  const cacheDir = path.join(dir, 'cache', 'ortho');
  const acqPath = path.join(dir, 'acquisition.json');
  const manifest = path.join(ROOT, 'packages', 'course-geo', 'toolchain', 'pixi.toml');

  // Create a synthetic 4-band EPSG:3006 GeoTIFF inside Pixi mapping env
  const makeScript = `
import numpy as np, rasterio
from rasterio.transform import from_bounds
arr = np.zeros((4, 40, 40), dtype=np.uint8)
arr[0] = 60; arr[1] = 140; arr[2] = 75; arr[3] = 210
with rasterio.open(${JSON.stringify(srcTif)}, 'w', driver='GTiff', dtype='uint8', count=4, width=40, height=40,
                   crs='EPSG:3006', transform=from_bounds(649000, 6598500, 649040, 6598540, 40, 40),
                   photometric='RGB', alpha='NO') as dst:
    dst.write(arr)
`;
  const mk = spawnSync(pixiExe, ['run', '--manifest-path', manifest, '-e', 'mapping', '--frozen', 'python', '-c', makeScript], { encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);

  const run = spawnSync(pixiExe, [
    'run', '--manifest-path', manifest, '-e', 'mapping', '--frozen', 'python',
    path.join(ROOT, 'packages/course-geo/intake/acquire-ortho-windows.py'),
    '--ground', 'unit-ground',
    '--local-tif', srcTif,
    '--captured-at', '2024-06-15T10:30:00Z',
    '--out-dir', cacheDir,
    '--acquisition-out', acqPath,
    '--window', 'native-test:649005,6598505,649035,6598535:0.5:2024:leaf-on',
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  // Verify render-source-overlays.py read_sources accepts our acquisition.json with 0 errors!
  const verifyScript = `
import importlib.util, json
from pathlib import Path
spec = importlib.util.spec_from_file_location('overlays', ${JSON.stringify(path.join(ROOT, 'packages/course-workflow/render-source-overlays.py'))})
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
acq = json.loads(Path(${JSON.stringify(acqPath)}).read_text())
sources, errors = mod.read_sources(acq, Path(${JSON.stringify(cacheDir)}))
assert errors == [], f'errors: {errors}'
assert len(sources) == 1
assert sources[0]['solar']['solarElevationDeg'] > 40
print('OVERLAY_COMPAT_OK')
`;
  const check = spawnSync(pixiExe, ['run', '--manifest-path', manifest, '-e', 'mapping', '--frozen', 'python', '-c', verifyScript], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /OVERLAY_COMPAT_OK/);
});
