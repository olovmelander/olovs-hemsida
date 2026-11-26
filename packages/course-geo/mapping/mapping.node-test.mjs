import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NEEDS_MAPPING, PIXI } from '../toolchain/mapping-environment.mjs';

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

test('assist-surface-segmentation.py extracts bunker with grass island innerRing and water/green polygons', { skip: NEEDS_MAPPING }, t => {
  const pixiExe = PIXI;
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

test('turf_tracing snaps a rough ring to the photo edge, finds a raised tee deck and keeps a waste area whole', { skip: NEEDS_MAPPING }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turf-tracing-'));
  const pixiExe = PIXI;
  const manifest = path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');
  const script = `
import sys, json, math
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'packages/course-geo/mapping'))})
import numpy as np, rasterio, turf_tracing as tt
from rasterio.transform import from_origin
from shapely.geometry import Point, Polygon
rng = np.random.default_rng(3)
R = 0.25; W = 480
yy, xx = np.mgrid[0:W, 0:W]
e = 649000 + (xx + .5) * R; n = 6598500 + W * R - (yy + .5) * R
img = np.stack([np.full((W, W), v, np.float32) for v in (75, 96, 80, 134)])
disc = np.hypot(e - 649040, n - 6598560) < 12
for k, v in enumerate((108, 121, 102, 144)): img[k][disc] = v
waste = (np.abs(n - 6598530) < 8) & (np.abs(e - 649060) < 50) & ~(np.hypot(e - 649060, n - 6598530) < 4)
for k, v in enumerate((165, 153, 140, 106)): img[k][waste] = v
img += rng.normal(0, 2.0, img.shape)
path = ${JSON.stringify(path.join(dir, 'p.tif'))}
with rasterio.open(path, 'w', driver='GTiff', dtype='uint8', count=4, width=W, height=W, crs='EPSG:3006', transform=from_origin(649000, 6598500 + W * R, R, R)) as d:
    d.write(np.clip(img, 0, 255).astype(np.uint8))
im = tt.Imagery([path])
start = Point(649041.2, 6598559.0).buffer(13.2)
ring, st = tt.refine_ring(im, start, 3.0, res=R)
true = Point(649040, 6598560).buffer(12)
iou = ring.intersection(true).area / ring.union(true).area
sand = tt.extract_sand(im, [649000, 6598500, 649120, 6598620], 'waste_sand')
z = np.full((200, 200), 10.0, np.float32) + (np.arange(200)[None] * 0.06).astype(np.float32)
yy, xx = np.mgrid[0:200, 0:200]
deck = (np.abs(yy - 100) < 6) & (np.abs(xx - 90) < 9)
z[deck] = 16.4
pads = tt.tee_platforms(z, 649000.5, 6598699.5, [649020, 6598520, 649180, 6598680])
print(json.dumps(dict(iou=iou, d=st['dPrime'], wastes=len(sand), islands=[len(s.interiors) for s in sand], wasteArea=sand[0].area if sand else 0,
                      pads=[round(p['area']) for p in pads], at=[[round(p['polygon'].centroid.x), round(p['polygon'].centroid.y)] for p in pads])))
`;
  try {
    const run = spawnSync(pixiExe, ['run', '--manifest-path', manifest, '-e', 'mapping', '--frozen', 'python', '-c', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
    assert.ok(out.iou > 0.955, `refined green overlaps the true disc ${out.iou}`);
    assert.ok(out.d > 4);
    assert.equal(out.wastes, 1);
    assert.deepEqual(out.islands, [1]);
    assert.ok(Math.abs(out.wasteArea - (1600 - Math.PI * 16)) < 90, `waste area ${out.wasteArea}`);
    assert.equal(out.pads.length, 1);
    assert.ok(out.at[0].every((v, i) => Math.abs(v - [649091, 6598600][i]) <= 2), JSON.stringify(out.at));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('turf_tracing reads a ground\'s own sand bands: tan sand is no bunker by the default rule and one by its measured bands', { skip: NEEDS_MAPPING }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sand-bands-'));
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'packages/course-geo/mapping'))})
import numpy as np, rasterio, turf_tracing as tt
from rasterio.transform import from_origin
rng = np.random.default_rng(5)
R = 0.16; W = 500
yy, xx = np.mgrid[0:W, 0:W]
e = 649000 + (xx + .5) * R; n = 6598500 + W * R - (yy + .5) * R
img = np.stack([np.full((W, W), v, np.float32) for v in (92, 108, 88, 140)])
tan = np.hypot(e - 649040, n - 6598540) < 4
for k, v in enumerate((172, 155, 148, 112)): img[k][tan] = v
img += rng.normal(0, 1.5, img.shape)
path = ${JSON.stringify(path.join(dir, 't.tif'))}
with rasterio.open(path, 'w', driver='GTiff', dtype='uint8', count=4, width=W, height=W, crs='EPSG:3006', transform=from_origin(649000, 6598500 + W * R, R, R)) as d:
    d.write(np.clip(img, 0, 255).astype(np.uint8))
im = tt.Imagery([path])
box = [649000, 6598500, 649080, 6598580]
tjusta = dict(core=dict(brightness=[128, 215], ndviBelow=-0.12, warmth=[12, 36]), grow=dict(brightness=[112, 230], ndviBelow=-0.04, warmth=[6, 45]))
found = tt.extract_sand(im, box, 'bunker', tjusta)
a = np.linspace(-1, 1, 9)
br, nd_, w = np.meshgrid(np.linspace(100, 255, 9), a, np.linspace(-30, 40, 9))
legacy_core = (br > 188) & (nd_ < 0.02) & (w > 2) & (w < 20)
legacy_grow = (br > 158) & (nd_ < 0.06)
spec = tt.sand_spec('bunker')
print(json.dumps(dict(default=len(tt.extract_sand(im, box, 'bunker')), measured=len(found), area=found[0].area if found else 0,
                      sameCore=bool((spec['core'](br, nd_, w) == legacy_core).all()), sameGrow=bool((spec['grow'](br, nd_, w) == legacy_grow).all()))))
`;
  try {
    const run = spawnSync(PIXI, ['run', '--manifest-path', path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml'), '-e', 'mapping', '--frozen', 'python', '-c', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
    assert.equal(out.default, 0, 'Bro Hof\'s white-sand rule does not take tan sand');
    assert.equal(out.measured, 1, 'the measured bands do');
    assert.ok(Math.abs(out.area - Math.PI * 16) < 8, `bunker area ${out.area}`);
    assert.ok(out.sameCore && out.sameGrow, 'the default bands are the thresholds the tracer always had');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('turf_tracing writes no ring that touches itself, and leaves every other ring as it was', { skip: NEEDS_MAPPING }, () => {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'packages/course-geo/mapping'))})
import turf_tracing as tt
from shapely.geometry import Polygon
# Two lobes that meet at one vertex: a fairway pinched between two trees.
pinch = Polygon([(0, 0), (10, 0), (10, 10), (20, 10), (20, 20), (10, 20), (10, 10), (0, 10)])
plain = Polygon([(0, 0), (10.004, 0), (10, 0.001), (10, 10), (0, 10)])
rings = tt.clean_rings(pinch)
verts = [tuple(p) for p in rings[0][:-1]]
print(json.dumps(dict(before=tt._revisits(tt.round_coords(pinch)), after=len(set(verts)) != len(verts), area=Polygon(rings[0]).area,
                      plain=tt.clean_rings(plain) == tt.round_coords(plain), plainPoints=len(tt.round_coords(plain)[0]))))
`;
  const run = spawnSync(PIXI, ['run', '--manifest-path', path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml'), '-e', 'mapping', '--frozen', 'python', '-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
  assert.equal(out.before, true, 'the pinched ring revisits its vertex');
  assert.equal(out.after, false, 'the written ring does not');
  assert.ok(Math.abs(out.area - 200) < 3, `both lobes kept: ${out.area} m2`);
  assert.equal(out.plain, true, 'a ring without a pinch is written as round_coords writes it');
  assert.equal(out.plainPoints, 5, 'two vertices that round to one are written once');
});

test('the tracer teaches a fairway model from the holes\' lines, and keeps what several flights agree on', { skip: NEEDS_MAPPING }, () => {
  const script = `
import sys, json, importlib.util
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'packages/course-geo/mapping'))})
import numpy as np
from shapely.geometry import LineString, Point
spec = importlib.util.spec_from_file_location('tcs', ${JSON.stringify(path.join(ROOT, 'packages/course-geo/mapping/trace-course-surfaces.py'))})
tcs = importlib.util.module_from_spec(spec); spec.loader.exec_module(tcs)
holes = [(1, 4, LineString([(0, 0), (0, 300)])), (2, 3, LineString([(200, 0), (200, 150)])), (3, 5, LineString([(400, 0), (400, 450)]))]
fairway, rough = tcs.line_labels(holes, skip=[3])
inside = lambda g, x, y: bool(g.contains(Point(x, y)))
a = np.zeros((3, 2, 2), np.float32); b = np.zeros((3, 2, 2), np.float32)
a[:, 0, 0] = [0.1, 0.8, 0.1]; b[:, 0, 0] = [0.1, 0.8, 0.1]    # both say fairway
a[:, 0, 1] = [0.0, 0.9, 0.1]; b[:, 0, 1] = [0.0, 0.1, 0.9]    # they disagree
a[:, 1, 0] = [0.1, 0.8, 0.1]                                   # the second flight saw no turf
p = tcs.flights_agree([a, b])
print(json.dumps(dict(
  core=[inside(fairway, 0, 150), inside(fairway, 6, 150), inside(fairway, 9, 150), inside(fairway, 0, 90), inside(fairway, 0, 262)],
  par3=inside(fairway, 200, 75), skipped=inside(fairway, 400, 200), area=fairway.area,
  rough=[inside(rough, 40, 150), inside(rough, 20, 150), inside(rough, 60, 150), inside(rough, 240, 75), inside(rough, 430, 200)],
  agree=float(p[1, 0, 0]), split=[float(p[1, 0, 1]), float(p[2, 0, 1])], unseen=float(p[:, 1, 0].sum()), sums=float(p[:, 0, 0].sum()))))
`;
  const run = spawnSync(PIXI, ['run', '--manifest-path', path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml'), '-e', 'mapping', '--frozen', 'python', '-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
  assert.deepEqual(out.core, [true, true, false, false, false], 'fairway is the 7 m either side of the line, from 100 m off the tee to 45 m short of the green');
  assert.equal(out.par3, false, 'a par 3 has no fairway to teach from');
  assert.equal(out.skipped, false, 'a skipped hole teaches nothing');
  assert.ok(Math.abs(out.area - (155 * 14 + Math.PI * 49)) < 12, `one strip: ${out.area} m2`);
  assert.deepEqual(out.rough, [true, false, false, true, true], 'rough is 26-55 m from every line, a skipped hole\'s too');
  assert.ok(out.agree > 0.79 && Math.abs(out.sums - 1) < 1e-5, 'where the flights agree their verdict stands');
  assert.ok(out.split[0] < 0.5 && out.split[1] < 0.6, `where they disagree nothing is fairway: ${out.split}`);
  assert.equal(out.unseen, 0, 'no turf in one flight, no verdict');
});

test('a settled turf model gives two samples of the same ground the same verdict, and the fixed steps stay as they were', { skip: NEEDS_MAPPING }, () => {
  // Tjusta, November 2026: fairway against rough taught from hole lines never settled in the fixed 900 steps (the
  // fairway share of the ground swung between 0.61 and 0.92), so a hole line moved 2 m redrew the fairways. The
  // long tail of a texture term is what does it: on this ground the fixed steps at 900 and at 1,000 call 9% of it
  // differently.
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'packages/course-geo/mapping'))})
import numpy as np
import turf_tracing as tt
def draw(seed, n=6000):
    r = np.random.default_rng(seed)
    def cls(mean, sd, m):
        z = r.normal(mean, sd, (m, 3))
        heavy = np.exp(r.normal(0, 2.0, (m, 3))) * (1 + 0.2 * z[:, 1:2])       # local variance has a long tail
        return np.concatenate([z[:, :1] + 0.05 * r.normal(0, 1, (m, 3)), z[:, 1:2] + 0.1 * r.normal(0, 1, (m, 1)), z[:, 2:3], heavy], 1)
    return [cls([4, 2, 0], 0.6, n // 2), cls([0, 0.3, 0.2], 1, n), cls([0, -0.3, -0.2], 1.2, n)]   # fairway and rough overlap
test = np.concatenate(draw(99)).T.reshape(8, 1, -1)
call = lambda m: m.predict(test).argmax(0).ravel()
a, b = tt.TurfModel().fit(draw(1), settled=True), tt.TurfModel().fit(draw(2), settled=True)
again = tt.TurfModel().fit(draw(1), iterations=10, settled=True)
c, d = tt.TurfModel().fit(draw(1)), tt.TurfModel().fit(draw(1))
print(json.dumps(dict(pair=float((call(a) != call(b)).mean()), accuracy=[a.accuracy, b.accuracy], steps=float(np.abs(a.w - again.w).max()),
                      same=bool(np.array_equal(c.w, d.w)), moved=float(np.abs(a.w - c.w).max()))))
`;
  const run = spawnSync(PIXI, ['run', '--manifest-path', path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml'), '-e', 'mapping', '--frozen', 'python', '-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout.trim().split('\n').at(-1));
  assert.ok(out.pair < 0.05, `two samples disagree on ${out.pair} of the ground`);
  for (const k of [0, 1, 2]) assert.ok(Math.abs(out.accuracy[0][k] - out.accuracy[1][k]) < 0.03, `class ${k}: ${out.accuracy[0][k]} and ${out.accuracy[1][k]}`);
  assert.ok(out.accuracy[0][0] > 0.95, 'the green stands apart either way');
  assert.equal(out.steps, 0, 'a settled fit does not depend on a step count');
  assert.equal(out.same, true, 'the fixed steps are deterministic');
  assert.ok(out.moved > 0, 'and are a different fit, which every ground traced before keeps');
});

test('compileGridCourse keeps reviewed tee marks on their platform, far boxes, and only the policies a course asks for', () => {
  const frame = { easting: 649094.5, northing: 6598568.5, latitude: 59.498973, longitude: 17.633749 };
  const E = dx => frame.easting + dx;
  const N = dz => frame.northing - dz;
  const rect = (x0, z0, x1, z1) => [[E(x0), N(z0)], [E(x1), N(z0)], [E(x1), N(z1)], [E(x0), N(z1)], [E(x0), N(z0)]];
  const crs = { type: 'name', properties: { name: 'EPSG:3006' } };
  const holes = Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: i % 3 === 0 ? 3 : i % 3 === 1 ? 4 : 5, index: i * 2 + 1, lengths: { club: 130 + i * 25 } }));
  const card = { par: { front: 36, total: 36 }, tees: [{ id: 'club', name: 'Club', total: holes.reduce((s, h) => s + h.lengths.club, 0) }], holes };
  const at = h => -100 + h.number * 10;
  const build = (mark, placement) => compileGridCourse({
    groundId: 'g', slug: 'g-one', frame, card,
    guideNotes: { schemaVersion: 1, holes: holes.map(h => ({ n: h.number, name: `Hole ${h.number}`, note: 'Synthetic unit test hole description.', basis: 'unit-test' })) },
    routesGeoJson: { type: 'FeatureCollection', crs, features: holes.map(h => ({ type: 'Feature', id: `r${h.number}`, properties: { hole: h.number }, geometry: { type: 'LineString', coordinates: [[E(at(h)), N(-50)], [E(at(h)), N(100)]] } })) },
    surfacesGeoJson: { type: 'FeatureCollection', crs, features: holes.flatMap(h => [
      { type: 'Feature', id: `g${h.number}`, properties: { kind: 'green', hole: h.number }, geometry: { type: 'Polygon', coordinates: [rect(at(h) - 4, 90, at(h) + 4, 110)] } },
      { type: 'Feature', id: `t${h.number}`, properties: { kind: 'tee', hole: h.number, teeIds: ['club'], teeMarks: { club: [E(at(h) + mark), N(-48)] } }, geometry: { type: 'Polygon', coordinates: [rect(at(h) - 4, -55, at(h) + 4, -45)] } },
    ]) },
    facilitiesGeoJson: { type: 'FeatureCollection', crs, features: [{ type: 'Feature', id: 'rf', properties: { kind: 'range_fairway' }, geometry: { type: 'Polygon', coordinates: [rect(20, 20, 60, 40)] } }] },
    contextGeoJson: { type: 'FeatureCollection', crs, features: [
      { type: 'Feature', id: 'b1', properties: { tags: { building: 'semidetached_house', 'building:levels': '2' } }, geometry: { type: 'Polygon', coordinates: [rect(70, 70, 80, 80)] } },
      { type: 'Feature', id: 'p1', properties: { tags: { amenity: 'parking' } }, geometry: { type: 'Polygon', coordinates: [rect(90, 70, 110, 80)] } },
      { type: 'Feature', id: 's1', properties: { tags: { highway: 'service' } }, geometry: { type: 'LineString', coordinates: [[E(0), N(120)], [E(40), N(120)]] } },
    ] },
    farBuildings: [[1500, -900, 12, 6, 0.4, 2, 9.6]], placement,
    fineTerrain: { float32: new Float32Array(513 * 513).fill(12.5), side: 513, spacing: 1, x0: -256, z0: -256, sha256: 'a'.repeat(64) },
  });
  const { model } = build(1.5, { objectPlacement: null, vegetationPlacement: null, terrainPlacement: null });
  assert.deepEqual(model.holes[2].tees.marks[0].c, [at(holes[2]) + 1.5, -48]);
  assert.equal(model.holes[2].tees.marks[0].sourcePadId, 't3');
  assert.equal(model.holes[2].tees.markerLayout, 'separate-reviewed-colours');
  assert.equal('teeMarks' in model.holes[2].tees.pads[0], false);
  assert.equal('objectPlacement' in model.infra, false);
  assert.equal(model.infra.bridgePlacement, 'mapped-only');
  assert.deepEqual(model.infra.farB, [[1500, -900, 12, 6, 0.4, 2, 9.6]]);
  assert.deepEqual([model.infra.buildings[0].kind, model.infra.buildings[0].h], ['semidetached_house', 6.8]);
  assert.equal('cars' in model.infra.parking[0], false);
  assert.equal(model.infra.tracks[0].kind, 'service');
  assert.equal(model.scenery.fairways.length, 1);
  assert.throws(() => build(9, {}), /reviewed mark lies outside its platform/);
  assert.equal(build(1.5, {}).model.infra.objectPlacement, 'mapped-only');
});
