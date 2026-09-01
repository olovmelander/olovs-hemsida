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
  canopyWindowStreamPipeline,
  copcHeaderPipeline,
  copcHeaderSummary,
  probeRangeSupport,
  SURFACE_INTENSITY_MAX_HAG_METRES,
  SURFACE_INTENSITY_RESOLUTION_METRES,
  chooseBalancedWindow,
  classifyProbes,
  probeLattice,
  surfaceIntensityPipeline,
  treeCoverIndex,
} from './canopy-window.mjs';
import { authorizationHeaders } from './credentials.mjs';
import { runGeoCommand } from '../proj.mjs';

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

test('the read is streamed with credentials, and the derivation carries none', () => {
  /* The measurement that forced this split: one non-streaming pipeline read
     358 points over 512 m where 1.7 pts/m2 predicts hundreds of thousands,
     while the sibling statistics path -- same reader config, but streamed --
     reads the same product densely. So the read streams and the derivation,
     which cannot stream because hag_nn needs the ground returns first, runs
     afterwards against a local file. */
  const stream = canopyWindowStreamPipeline(plan(), CREDENTIALS, {
    outputPath: '/tmp/window.laz',
    authorizationHeaders,
  });
  const [reader, writer] = stream;
  assert.equal(stream.length, 2, 'the streamed pass must stay streamable end to end');
  assert.equal(reader.type, 'readers.copc');
  assert.equal(reader.bounds, '([697200,697712],[7024700,7025212])');
  assert.match(reader.filename.path, /^https:\/\/dl1\.lantmateriet\.se\/hojd\//);
  assert.ok(new Headers(reader.filename.headers).has('authorization'));
  assert.equal(writer.type, 'writers.las');
  assert.equal(writer.forward, 'all');

  const derive = canopyHeightPipeline('/tmp/window.laz', { outputPath: '/tmp/chm.tif' });
  const [localReader, readerStats, hag, range, writerStats, gdal] = derive;
  assert.equal(localReader.type, 'readers.las');
  assert.equal(localReader.filename, '/tmp/window.laz');
  /* No credentials reach the second pass at all -- there is nowhere to put
     them and nothing that needs them. */
  assert.doesNotMatch(JSON.stringify(derive), /lm-user|lm-secret|Basic |authorization/i);
  /* Height above ground from the cloud's OWN ground returns: no second
     product, so no registration error between two of them. */
  assert.equal(hag.type, 'filters.hag_nn');
  assert.equal(hag.allow_extrapolation, false);
  assert.equal(range.limits, `HeightAboveGround[0:${CANOPY_MAXIMUM_HEIGHT_METRES}]`);
  assert.equal(gdal.dimension, 'HeightAboveGround');
  assert.equal(gdal.output_type, 'max');
  assert.equal(gdal.resolution, CANOPY_RESOLUTION_METRES);
  assert.equal(gdal.radius, +(CANOPY_RESOLUTION_METRES * Math.SQRT2).toFixed(4));
  assert.equal(gdal.nodata, -9999);
  /* Counted on BOTH sides of hag_nn, so a thin raster says whether the points
     never arrived or were eaten on the way. One stats stage could not. */
  assert.equal(readerStats.tag, 'afterReader');
  assert.doesNotMatch(readerStats.dimensions, /HeightAboveGround/);
  assert.equal(writerStats.tag, 'beforeWriter');
  assert.match(writerStats.dimensions, /HeightAboveGround/);
  /* No head filter anywhere: truncating a point stream punches holes in a
     raster and nothing downstream can tell those from real clearings. */
  for (const stage of [...stream, ...derive]) assert.notEqual(stage.type, 'filters.head');
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

test('intensity is read as a pseudo-NIR band from ground returns only, with no credentials', () => {
  /* Every other route to surface outlines is closed without a club: the 1 m
     height model resolves no class, Esri is RGB and separates nothing, the
     orthophoto needs an order. Laserdata Skog is already entitled and flown at
     1064 nm, which is the near infrared NDVI would have used. */
  const pipeline = surfaceIntensityPipeline('/tmp/window.laz', { outputPath: '/tmp/intensity.tif' });
  const [reader, hag, range, stats, writer] = pipeline;
  assert.equal(reader.type, 'readers.las');
  assert.equal(hag.type, 'filters.hag_nn');
  /* Ground returns only: a crown's reflectance says nothing about the turf
     under it. */
  assert.equal(range.limits, `HeightAboveGround[0:${SURFACE_INTENSITY_MAX_HAG_METRES}]`);
  assert.match(stats.dimensions, /Intensity/);
  assert.equal(writer.dimension, 'Intensity');
  /* Mean, not max: one specular return must not decide a cell. */
  assert.equal(writer.output_type, 'mean');
  assert.equal(writer.resolution, SURFACE_INTENSITY_RESOLUTION_METRES);
  assert.equal(writer.nodata, -9999);
  /* The derivation runs on a local file; nothing authenticating goes near it. */
  assert.doesNotMatch(JSON.stringify(pipeline), /authorization|Basic |password/i);
  for (const stage of pipeline) assert.notEqual(stage.type, 'filters.head');

  assert.throws(() => surfaceIntensityPipeline('', { outputPath: '/tmp/i.tif' }), /localPath/);
  assert.throws(() => surfaceIntensityPipeline('/tmp/w.laz', {}), /outputPath/);
});

test('a bounded run survives the fractional deadline its caller computes', () => {
  /* CI run 59 spent one second on the canopy measurement and read no points:
     `remaining()` returns a deadline minus a float clock, spawnSync refuses a
     non-integer timeout outright, and the RangeError surfaced as if the COPC
     stream itself had failed. The budget is floored in runGeoCommand now, so
     no call site can reintroduce it. */
  const output = runGeoCommand('node', ['-e', 'process.stdout.write("ok")'], {
    timeoutMilliseconds: 419_999.963_211,
  });
  assert.equal(output.stdout, 'ok');

  /* and it is still a real bound, not a rounded-away one */
  assert.throws(
    () => runGeoCommand('node', ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)'], {
      timeoutMilliseconds: 250.5,
    }),
    error => error.code === 'GEO_COMMAND_TIMEOUT',
  );
});

test('the COPC header probe asks the file what it holds, and leaks nothing', () => {
  const plan = {
    source: { sourceUrl: 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/x.copc.laz' },
    boundsEpsg3006: [697342, 7024285, 697854, 7024797],
  };
  const pipeline = copcHeaderPipeline(plan, CREDENTIALS, { authorizationHeaders });
  const [reader, head, writer] = pipeline;
  assert.equal(reader.type, 'readers.copc');
  /* A pinhole at the window's centre. Asking for no bounds at all spent the
     whole budget planning a read of a 730 MB cloud and published nothing; the
     header comes out either way, and a 20 m box makes the read trivial. */
  assert.equal(reader.bounds, '([697588,697608],[7024531,7024551])');
  assert.match(reader.filename.headers.Authorization, /^Basic /);
  assert.equal(head.type, 'filters.head');
  assert.equal(head.count, 1);
  assert.equal(writer.type, 'writers.null');
  /* nothing is written anywhere, so no point can escape the runner */
  assert.equal(pipeline.filter(stage => /^writers\./.test(stage.type)).length, 1);
  assert.throws(() => copcHeaderPipeline(plan, null, { authorizationHeaders }), /credentials/);
  assert.throws(() => copcHeaderPipeline({}, CREDENTIALS, { authorizationHeaders }), /source URL/);
  assert.throws(() => copcHeaderPipeline({ source: plan.source }, CREDENTIALS, { authorizationHeaders }),
    /EPSG:3006 bounds/);
});

test('the header summary separates a sparse file from a truncated read', () => {
  const metadata = {
    stages: {
      'readers.copc': {
        count: 12_500_000, minx: 695_000, maxx: 697_500, miny: 7_022_500, maxy: 7_025_000,
        software_id: 'PDAL',
      },
    },
  };
  const summary = copcHeaderSummary(metadata);
  assert.equal(summary.available, true);
  assert.equal(summary.declaredPointCount, 12_500_000);
  assert.deepEqual(summary.boundsEpsg3006, [695_000, 7_022_500, 697_500, 7_025_000]);
  /* 12.5 M points over 2500 x 2500 m is 2 pts/m2 -- so a window that returns
     0.0014 pts/m2 is not reading what the file says it holds. */
  assert.equal(summary.declaredDensityPerSquareMetre, 2);
  assert.equal(copcHeaderSummary({ stages: {} }).available, false);
});

test('the range probe reports the transport and never the body', async () => {
  let seen = null;
  const cancelled = [];
  const response = status => ({
    status,
    headers: new Map([
      ['accept-ranges', status === 206 ? 'bytes' : 'none'],
      ['content-range', status === 206 ? 'bytes 0-1/1048576' : null],
      ['content-length', status === 206 ? '2' : '1048576'],
    ]),
    body: { cancel: reason => { cancelled.push(reason); } },
  });
  response.prototype = undefined;
  const withGet = value => ({ ...value, headers: { get: name => value.headers.get(name) ?? null } });

  const partial = await probeRangeSupport('https://example.invalid/x.copc.laz', CREDENTIALS, {
    authorizationHeaders,
    fetchImpl: async (url, init) => { seen = init; return withGet(response(206)); },
  });
  assert.equal(seen.headers.Range, 'bytes=0-1');
  assert.match(seen.headers.Authorization, /^Basic /);
  assert.equal(partial.partialContent, true);
  assert.equal(partial.acceptRanges, 'bytes');
  assert.equal(partial.contentRange, 'bytes 0-1/1048576');
  assert.equal(cancelled.length, 1);
  /* nothing derived from the body, and no header value carrying a secret */
  assert.doesNotMatch(JSON.stringify(partial), /Basic |lm-secret|lm-user/);

  const whole = await probeRangeSupport('https://example.invalid/x.copc.laz', CREDENTIALS, {
    authorizationHeaders,
    fetchImpl: async () => withGet(response(200)),
  });
  assert.equal(whole.partialContent, false);
  assert.equal(whole.status, 200);

  const failed = await probeRangeSupport('https://example.invalid/x.copc.laz', CREDENTIALS, {
    authorizationHeaders,
    fetchImpl: async () => { throw new Error('lm-secret leaked into the message'); },
  });
  assert.equal(failed.available, false);
  assert.equal(failed.error, 'range probe failed');
  assert.doesNotMatch(JSON.stringify(failed), /lm-secret/);
});
