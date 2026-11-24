import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { registerBanguide, transformPixelToEpsg3006, projectPixelAnnotations } from './register-banguide.mjs';
import { compileGridCourse, assertNoEpsg3006Leakage } from './compile-grid-course.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-mapping-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('register-banguide recovers similarity/affine transforms, rejects RANSAC outliers, and reports LOO residuals', () => {
  // Ground-truth transform: scale 2.0 m/px, slight rotation, image y-down to EPSG:3006 north-up
  const a = 1.9696, b = 0.3473, tx = 648500, ty = 6599500;
  const gt = (u, v) => [a * u + b * v + tx, b * u - a * v + ty];
  const pixels = [[100, 100], [400, 120], [450, 420], [120, 460], [280, 260], [310, 390]];
  const controls = pixels.map(([u, v], i) => ({
    id: `cp-${i + 1}`,
    pixel: [u, v],
    epsg3006: gt(u, v),
  }));
  // Inject one gross outlier (+180 m off)
  controls.push({ id: 'outlier', pixel: [200, 200], epsg3006: [gt(200, 200)[0] + 180, gt(200, 200)[1] - 90] });

  const sim = registerBanguide(controls, { model: 'similarity', ransacThresholdMetres: 5 });
  assert.equal(sim.diagnostics.inlierCount, 6);
  assert.equal(sim.diagnostics.outlierCount, 1);
  assert(sim.diagnostics.leaveOneOutRmseMetres < 0.01);
  assert.equal(sim.controlPoints.find(p => p.id === 'outlier').inlier, false);

  const predicted = transformPixelToEpsg3006(sim.transform, [250, 300]);
  const expected = gt(250, 300);
  assert(Math.hypot(predicted[0] - expected[0], predicted[1] - expected[1]) < 0.01);

  const aff = registerBanguide(controls, { model: 'affine', ransacThresholdMetres: 5 });
  assert.equal(aff.diagnostics.inlierCount, 6);
  assert(aff.diagnostics.leaveOneOutRmseMetres < 0.01);

  const projected = projectPixelAnnotations(sim.transform, [
    { id: 'h16-route', kind: 'hole', hole: 16, points: [[150, 150], [220, 240]] },
  ]);
  assert.equal(projected.provenance, 'registered-banguide-corroboration-not-survey');
  assert.equal(projected.features[0].geometry.type, 'LineString');
});

test('assist-surface-segmentation.py extracts bunker with grass island innerRing and water/green polygons', t => {
  const pixiExe = fs.existsSync('C:\\Users\\olovm\\.pixi\\bin\\pixi.exe') ? 'C:\\Users\\olovm\\.pixi\\bin\\pixi.exe' : 'pixi';
  const manifest = path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');
  const dir = tempDir(t);
  const rgbiPath = path.join(dir, 'synthetic.tif');
  const seedsPath = path.join(dir, 'seeds.json');
  const outPath = path.join(dir, 'candidates.geojson');
  const reviewDir = path.join(dir, 'cache', 'seg-review');

  // Create a 120x120 0.5m RGBI raster (60m x 60m) with:
  // - Background medium rough (R=55, G=110, B=50, NIR=195)
  // - Bright white marble bunker (10m..28m x 10m..28m) with a 4m x 4m grass island inside!
  // - Dark water pond (36m..54m x 36m..54m)
  const makeRaster = `
import numpy as np, rasterio
from rasterio.transform import from_bounds
arr = np.zeros((4, 120, 120), dtype=np.uint8)
arr[0] = 55; arr[1] = 110; arr[2] = 50; arr[3] = 195
# Bright low-NDVI white marble bunker at rows 20..56, cols 20..56 (18m x 18m)
arr[0, 20:56, 20:56] = 235; arr[1, 20:56, 20:56] = 232; arr[2, 20:56, 20:56] = 225; arr[3, 20:56, 20:56] = 210
# Green grass island inside bunker at rows 32..44, cols 32..44 (6m x 6m = 36 m2)
arr[0, 32:44, 32:44] = 55; arr[1, 32:44, 32:44] = 125; arr[2, 32:44, 32:44] = 50; arr[3, 32:44, 32:44] = 205
# Dark water pond at rows 72..108, cols 72..108
arr[0, 72:108, 72:108] = 25; arr[1, 72:108, 72:108] = 55; arr[2, 72:108, 72:108] = 80; arr[3, 72:108, 72:108] = 15
with rasterio.open(${JSON.stringify(rgbiPath)}, 'w', driver='GTiff', dtype='uint8', count=4, width=120, height=120,
                   crs='EPSG:3006', transform=from_bounds(649000, 6598500, 649060, 6598560, 120, 120),
                   photometric='RGB', alpha='NO') as dst:
    dst.write(arr)
`;
  const mk = spawnSync(pixiExe, ['run', '--manifest-path', manifest, '-e', 'mapping', '--frozen', 'python', '-c', makeRaster], { encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);

  fs.writeFileSync(seedsPath, JSON.stringify({
    seeds: [
      // Bunker ring point (off-center so it lands on sand, not on the central grass island)
      { id: 'bunker-1', kind: 'bunker', hole: 1, epsg3006: [649013, 6598547], searchRadiusM: 25, minIslandAreaM2: 4 },
      { id: 'pond-1', kind: 'water', epsg3006: [649045, 6598515], searchRadiusM: 25 },
    ],
  }));

  const run = spawnSync(pixiExe, [
    'run', '--manifest-path', manifest, '-e', 'mapping', '--frozen', 'python',
    path.join(ROOT, 'packages/course-geo/mapping/assist-surface-segmentation.py'),
    '--rgbi', rgbiPath, '--seeds', seedsPath, '--out', outPath, '--review-dir', reviewDir,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  const fc = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(fc.features.length, 2);
  const bunker = fc.features.find(f => f.id === 'bunker-1');
  assert.equal(bunker.properties.islandCount, 1);
  assert.equal(bunker.geometry.coordinates.length, 2); // outerRing + 1 grass island innerRing!
  assert.equal(fs.existsSync(path.join(reviewDir, 'bunker-1.png')), true);
});

test('compileGridCourse compiles 9-hole course with innerRings, bulkheads, waste_sand, sibling scenery, and EPSG:3006 leakage guard', () => {
  const frame = { easting: 649094.5, northing: 6598568.5, latitude: 59.498973, longitude: 17.633749 };
  const E = dx => frame.easting + dx;
  const N = dz => frame.northing - dz;
  const rect = (x0, z0, x1, z1) => [[E(x0), N(z0)], [E(x1), N(z0)], [E(x1), N(z1)], [E(x0), N(z1)], [E(x0), N(z0)]];

  const holes = Array.from({ length: 9 }, (_, i) => ({
    number: i + 1,
    par: i % 3 === 0 ? 3 : i % 3 === 1 ? 4 : 5,
    index: i * 2 + 1,
    lengths: { back: 150 + i * 30, club: 130 + i * 25 },
  }));
  const card = {
    par: { front: 36, total: 36 },
    tees: [
      { id: 'back', name: 'Back', total: holes.reduce((s, h) => s + h.lengths.back, 0) },
      { id: 'club', name: 'Club', total: holes.reduce((s, h) => s + h.lengths.club, 0) },
    ],
    holes,
  };
  const guideNotes = {
    schemaVersion: 1,
    holes: holes.map(h => ({ n: h.number, name: `Hole ${h.number}`, note: `Synthetic unit test hole ${h.number} description for validation.`, basis: 'unit-test' })),
  };
  const routesGeoJson = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:3006' } },
    features: holes.map(h => ({
      type: 'Feature', id: `r${h.number}`, properties: { hole: h.number },
      geometry: { type: 'LineString', coordinates: [[E(-100 + h.number * 10), N(-50)], [E(-100 + h.number * 10), N(100)]] },
    })),
  };
  const surfaceFeatures = [];
  for (const h of holes) {
    const x = -100 + h.number * 10;
    surfaceFeatures.push(
      { type: 'Feature', id: `g${h.number}`, properties: { kind: 'green', hole: h.number }, geometry: { type: 'Polygon', coordinates: [rect(x - 6, 90, x + 6, 110)] } },
      { type: 'Feature', id: `t${h.number}`, properties: { kind: 'tee', hole: h.number }, geometry: { type: 'Polygon', coordinates: [rect(x - 4, -55, x + 4, -45)] } },
      { type: 'Feature', id: `f${h.number}`, properties: { kind: 'fairway', hole: h.number }, geometry: { type: 'Polygon', coordinates: [rect(x - 8, -20, x + 8, 80)] } },
    );
  }
  // Hole 1 bunker WITH grass island innerRing + tight green apron
  surfaceFeatures.push(
    {
      type: 'Feature', id: 'b1-island', properties: { kind: 'bunker', hole: 1 },
      geometry: { type: 'Polygon', coordinates: [rect(-82, 88, -68, 102), rect(-77, 93, -73, 97)] },
    },
    {
      type: 'Feature', id: 'apron-1', properties: { kind: 'mown_approach', hole: 1 },
      geometry: { type: 'Polygon', coordinates: [rect(-98, 82, -82, 92)] },
    },
  );
  const surfacesGeoJson = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3006' } }, features: surfaceFeatures };
  const siblingSurfacesGeoJson = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:3006' } },
    features: [
      { type: 'Feature', id: 'castle-g1', properties: { kind: 'green', course: 'bro-hof-castle' }, geometry: { type: 'Polygon', coordinates: [rect(120, 20, 140, 40)] } },
      { type: 'Feature', id: 'castle-ws1', properties: { kind: 'waste_sand', course: 'bro-hof-castle' }, geometry: { type: 'Polygon', coordinates: [rect(110, -10, 150, 10), rect(125, -4, 135, 4)] } },
    ],
  };
  const infrastructureGeoJson = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:3006' } },
    features: [
      { type: 'Feature', id: 'bh-17', properties: { kind: 'bulkhead', material: 'timber', waterId: 'pond-17' }, geometry: { type: 'LineString', coordinates: [[E(20), N(20)], [E(40), N(20)]] } },
      { type: 'Feature', id: 'br-17', properties: { kind: 'bridge', style: 'timber_footbridge', width: 2.5 }, geometry: { type: 'LineString', coordinates: [[E(40), N(20)], [E(55), N(20)]] } },
    ],
  };

  const side = 513;
  const fineTerrain = { float32: new Float32Array(side * side).fill(12.5), side, spacing: 1, x0: -256, z0: -256, sha256: 'a'.repeat(64) };
  const { model, heightfields, card: outCard, siblingCount } = compileGridCourse({
    groundId: 'bro-hof', slug: 'bro-hof-stadium', frame, card, guideNotes,
    routesGeoJson, surfacesGeoJson, siblingSurfacesGeoJson, infrastructureGeoJson, fineTerrain,
  });

  assert.equal(model.holes.length, 9);
  assert.equal(model.holes[0].bunkers[0].innerRings.length, 1);
  assert.equal(model.infra.bulkheads.length, 1);
  assert.equal(model.infra.bridges.length, 1);
  assert.equal(siblingCount, 2);
  assert.equal(model.scenery.greens.length, 1);
  assert.equal(model.scenery.mappedFeatures.some(f => f.kind === 'waste_sand' && f.rings.length === 2), true);
  assert.equal(outCard.holes.length, 9);
  assert.equal(heightfields.hf0.dx, 4);

  // Leakage guard must throw if a raw EPSG:3006 coordinate sneaks in
  const leaked = structuredClone(model);
  leaked.holes[0].line[0] = [649100, 6598500];
  assert.throws(() => assertNoEpsg3006Leakage(leaked), /EPSG:3006 coordinate leakage/);
});
