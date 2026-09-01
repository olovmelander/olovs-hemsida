import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANOPY_MAXIMUM_HEIGHT_METRES,
  CANOPY_RESOLUTION_METRES,
  CANOPY_THRESHOLD_METRES,
  canopyAgreement,
  canopyHeightPipeline,
  chooseBalancedWindow,
  classifyProbes,
  probeLattice,
  treeCoverIndex,
} from './canopy-window.mjs';
import { authorizationHeaders } from './credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CREDENTIALS = Object.freeze({ type: 'basic', username: 'lm-user', password: 'lm-secret' });

function plan(overrides = {}) {
  return Object.freeze({
    groundId: 'puttom',
    collection: 'dsm-skoglig-copc',
    source: Object.freeze({
      id: '23f028-702_69',
      sourceUrl: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/23f028-702_69.copc.laz',
      pointDensityPerSquareMetre: 1.1,
      ...overrides.source,
    }),
    boundsEpsg3006: Object.freeze([697200, 7024700, 697712, 7025212]),
    spanMetres: 512,
    areaSquareMetres: 512 * 512,
    maximumPoints: 1_000_000,
    ...overrides,
  });
}

/* Pack classes the way puttombuild/build-treecover.py does: two bits per cell,
   four per byte, least significant pair first, row-major k = j*nx + i. */
function packTwoBit(classes) {
  const bytes = Buffer.alloc(Math.ceil(classes.length / 4));
  classes.forEach((value, k) => { bytes[k >> 2] |= (value & 3) << ((k & 3) * 2); });
  return bytes.toString('base64');
}

test('tree-cover decode survives a non-square raster, which a transposition would not', () => {
  /* nx !== nz on purpose, and a class pattern that differs under transposition:
     reading the packing back-to-front would mirror the whole forest, and a
     mirrored control set looks exactly like a real disagreement. */
  const nx = 5;
  const nz = 3;
  const classes = [
    3, 3, 2, 2, 2,
    3, 2, 2, 0, 2,
    2, 2, 3, 3, 3,
  ];
  const index = treeCoverIndex({ cell: 3, x0: -30, z0: 60, nx, nz, b64: packTwoBit(classes) });
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const worldX = -30 + i * 3 + 1.5;
      const worldZ = 60 + j * 3 + 1.5;
      assert.equal(index.classAt(worldX, worldZ), classes[j * nx + i], `cell ${i},${j}`);
    }
  }
  /* Outside the raster is unknown, never a class. */
  assert.equal(index.classAt(-31, 61), 0);
  assert.equal(index.classAt(-30 + nx * 3 + 1, 61), 0);
  assert.equal(index.classAt(-28, 60 + nz * 3 + 1), 0);
});

test('a probe on a stand edge is discarded rather than counted for either side', () => {
  /* Six columns so a tree cell can be genuinely interior: columns 0-2 are
     trees, 3-5 open. */
  const nx = 6;
  const nz = 4;
  const classes = [
    3, 3, 3, 2, 2, 2,
    3, 3, 3, 2, 2, 2,
    3, 3, 3, 2, 2, 2,
    3, 3, 3, 2, 2, 2,
  ];
  const index = treeCoverIndex({ cell: 3, x0: 0, z0: 0, nx, nz, b64: packTwoBit(classes) });
  /* Interior to the stand, whole neighbourhood inside the raster and agreeing. */
  assert.equal(index.uniformClassAt(4.5, 4.5, 3), 3);
  assert.equal(index.uniformClassAt(13.5, 4.5, 3), 2);
  /* Against the stand boundary it does not agree, so the probe is unusable --
     that edge is the one place the satellite and the LiDAR may legitimately
     differ by metres. */
  assert.equal(index.uniformClassAt(7.5, 4.5, 3), 0);
  assert.equal(index.uniformClassAt(10.5, 4.5, 3), 0);
  /* And a probe whose neighbourhood leaves the raster is unusable too, rather
     than borrowing the unknown outside as agreement. */
  assert.equal(index.uniformClassAt(1.5, 4.5, 3), 0);
});

test('the committed Puttom raster decodes to a real mixture, not to noise', () => {
  const raster = JSON.parse(fs.readFileSync(path.join(ROOT, 'puttombuild/tree-cover.json'), 'utf8'));
  const index = treeCoverIndex(raster);
  assert.deepEqual(Object.keys(raster.legend).sort(), ['0', '2', '3']);
  const counts = new Map([[0, 0], [1, 0], [2, 0], [3, 0]]);
  for (let j = 0; j < raster.nz; j += 4) {
    for (let i = 0; i < raster.nx; i += 4) {
      const value = index.classAt(raster.x0 + i * raster.cell + 0.5, raster.z0 + j * raster.cell + 0.5);
      counts.set(value, counts.get(value) + 1);
    }
  }
  /* Class 1 is not in the legend, so a decode that produces it is misaligned. */
  assert.equal(counts.get(1), 0);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(counts.get(2) / total > 0.05, `open share ${counts.get(2) / total}`);
  assert.ok(counts.get(3) / total > 0.05, `tree share ${counts.get(3) / total}`);
});

test('the canopy pipeline reads one bounded window and never differences two products', () => {
  const pipeline = canopyHeightPipeline(plan(), CREDENTIALS, {
    outputPath: '/tmp/chm.tif',
    authorizationHeaders,
  });
  const [reader, hag, range, writer] = pipeline;
  assert.equal(reader.type, 'readers.copc');
  assert.equal(reader.bounds, '([697200,697712],[7024700,7025212])');
  assert.match(reader.filename.path, /^https:\/\/dl1\.lantmateriet\.se\/hojd\//);
  assert.ok(new Headers(reader.filename.headers).has('authorization'));
  /* Height above ground from the cloud's OWN ground returns: no second
     product, so no registration error between two of them. */
  assert.equal(hag.type, 'filters.hag_nn');
  assert.equal(hag.allow_extrapolation, false);
  assert.equal(range.limits, `HeightAboveGround[0:${CANOPY_MAXIMUM_HEIGHT_METRES}]`);
  assert.equal(writer.dimension, 'HeightAboveGround');
  assert.equal(writer.output_type, 'max');
  assert.equal(writer.resolution, CANOPY_RESOLUTION_METRES);
  assert.equal(writer.radius, CANOPY_RESOLUTION_METRES);
  assert.equal(writer.nodata, -9999);
  /* No head filter anywhere: truncating a point stream punches holes in a
     raster and nothing downstream can tell those from real clearings. */
  assert.equal(pipeline.filter(stage => stage.type === 'filters.head').length, 0);
});

test('an over-dense window is refused rather than silently truncated', () => {
  assert.throws(() => canopyHeightPipeline(
    plan({ source: { pointDensityPerSquareMetre: 12 } }),
    CREDENTIALS,
    { outputPath: '/tmp/chm.tif', authorizationHeaders },
  ), /past the 1000000 cap; narrow the span/);

  assert.throws(() => canopyHeightPipeline(plan(), CREDENTIALS, { authorizationHeaders }), /outputPath/);
  assert.throws(() => canopyHeightPipeline(plan(), null, { outputPath: '/tmp/c.tif', authorizationHeaders }),
    /credentials are required/);
});

test('canopy agreement reports a declared threshold and labels a fitted one as fitted', () => {
  const treeHeights = [14, 18, 9, 22, 11, 16, 3, 25];
  const openHeights = [0.1, 0.4, 0.0, 1.2, 0.3, 0.2, 0.8, 0.0];
  const agreement = canopyAgreement({ treeHeights, openHeights });
  assert.equal(agreement.declared.thresholdMetres, CANOPY_THRESHOLD_METRES);
  assert.equal(agreement.declared.treeRecall, 1);
  assert.equal(agreement.declared.openSpecificity, 1);
  assert.equal(agreement.declared.balancedAgreement, 1);
  assert.equal(agreement.counts.trees, 8);
  assert.match(agreement.fitted.note, /chosen after seeing these samples/);

  /* Overlapping populations: the declared threshold must report the overlap
     rather than a threshold picked to hide it. */
  const muddled = canopyAgreement({
    treeHeights: [0.5, 1.0, 1.5, 12],
    openHeights: [0.2, 3.0, 4.0, 5.0],
  });
  assert.equal(muddled.declared.treeRecall, 0.25);
  assert.ok(muddled.fitted.balancedAgreement >= muddled.declared.balancedAgreement);

  assert.throws(() => canopyAgreement({ treeHeights: [], openHeights: [1] }), /finite samples on both sides/);
});

/* A tiny raster: a 30 m band of trees at the west end, open everywhere else,
   so the balanced window has to move west to find both classes. */
function bandedCover() {
  const nx = 40;
  const nz = 40;
  const classes = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) classes.push(i < 10 ? 3 : 2);
  }
  return treeCoverIndex({ cell: 3, x0: 0, z0: 0, nx, nz, b64: packTwoBit(classes) });
}

test('probe classification keeps only cells the raster is confident about', () => {
  const cover = bandedCover();
  const toWorld = (easting, northing) => [easting, northing];
  const split = classifyProbes({
    probes: probeLattice({ centreEpsg3006: [60, 60], spanMetres: 60, lattice: 6 }),
    cover, toWorld, uniformRadiusMetres: 6,
  });
  assert.equal(split.trees.length + split.open.length + split.unusable, 36);
  /* Every kept probe really is on its class, checked independently of the
     helper that chose it. */
  for (const probe of split.trees) assert.equal(cover.classAt(probe.easting, probe.northing), 3);
  for (const probe of split.open) assert.equal(cover.classAt(probe.easting, probe.northing), 2);
});

test('the window is placed for sample adequacy, from the raster alone, deterministically', () => {
  const cover = bandedCover();
  const toWorld = (easting, northing) => [easting, northing];
  const choose = () => chooseBalancedWindow({
    /* Start well east of the band, where a centred window sees no trees. */
    centreEpsg3006: [90, 60],
    cover, toWorld, spanMetres: 48, lattice: 12, uniformRadiusMetres: 6,
    searchRadiusMetres: 60, searchStepMetres: 10,
  });
  const chosen = choose();
  assert.ok(chosen.treeProbes > 0 && chosen.openProbes > 0, JSON.stringify(chosen));
  assert.equal(chosen.score, Math.min(chosen.treeProbes, chosen.openProbes));
  /* It had to move west to find the band at all. */
  assert.ok(chosen.focusEpsg3006[0] < 90, `focus ${chosen.focusEpsg3006}`);
  assert.match(chosen.rule, /before any point cloud is read/);
  /* Deterministic: the same raster gives the same window every run, or the
     measurement is not reproducible. */
  assert.deepEqual(choose(), chosen);

  /* A raster with no trees at all cannot be measured, and says so rather than
     returning a window with an empty side. */
  const nx = 8;
  const openOnly = treeCoverIndex({
    cell: 3, x0: 0, z0: 0, nx, nz: 8, b64: packTwoBit(new Array(nx * 8).fill(2)),
  });
  assert.throws(() => chooseBalancedWindow({
    centreEpsg3006: [12, 12], cover: openOnly, toWorld, spanMetres: 12, lattice: 4,
    uniformRadiusMetres: 3, searchRadiusMetres: 6, searchStepMetres: 3,
  }), /both tree and open probes/);
});

test('a window pinned to the edge of its own search is reported, not passed off as an optimum', () => {
  const cover = bandedCover();
  const toWorld = (easting, northing) => [easting, northing];
  const common = {
    centreEpsg3006: [90, 60], cover, toWorld, spanMetres: 48, lattice: 12,
    uniformRadiusMetres: 6, searchStepMetres: 10,
  };
  /* Too narrow to reach the band's balance point: the best candidate lands on
     the boundary, which is "as far as we were allowed", not an optimum. */
  const clipped = chooseBalancedWindow({ ...common, searchRadiusMetres: 50 });
  assert.equal(clipped.searchConverged, false);
  /* Wide enough, and the answer stops moving -- which is what convergence
     means and what the flag is asserting. */
  const wide = chooseBalancedWindow({ ...common, searchRadiusMetres: 90 });
  const wider = chooseBalancedWindow({ ...common, searchRadiusMetres: 140 });
  assert.equal(wide.searchConverged, true);
  assert.deepEqual(wider.focusEpsg3006, wide.focusEpsg3006);
  assert.equal(wider.score, wide.score);
  assert.ok(wide.score > clipped.score);
  /* And a search too narrow to reach the band at all cannot measure, so it
     refuses rather than returning a one-sided window. */
  assert.throws(() => chooseBalancedWindow({ ...common, searchRadiusMetres: 40 }),
    /both tree and open probes/);
});
