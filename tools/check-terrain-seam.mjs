#!/usr/bin/env node
/* The fixed-frontier seam must have actual triangles on its outside.
 * BANVY_GPU=1 node tools/check-terrain-seam.mjs http://127.0.0.1:8620 \
 *   --out johannesbergbuild/cache/terrain-seam-after
 *
 * Captures both camera angles at every edge and corner. The numerical gate
 * uses indexed CORE/MID geometry exported by V3D.terrainSeamGeometry, not a
 * height sampler (which can return a height where no mesh exists). Screenshots
 * are visual evidence only. The separate check-course-v2 harness verifies the
 * replacement metre terrain; this checks its junction to the legacy surround.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const equals = args.find(a => a.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
  return args[i + 1];
};
const BASE = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620').replace(/\/$/, '');
const SLUG = flag('course', 'johannesberg');
const OUT = path.resolve(ROOT, flag('out', 'johannesbergbuild/cache/terrain-seam-before'));
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const OFFSETS = [0.1, 0.5, 2, 5, 11];
const STEP = 2;
const HEIGHT_OFFSET = 0.000001;
const HEIGHT_TOLERANCE = 0.05;
const BOUNDARY_SNAP_TOLERANCE = 0.0002;

/* A 16 m spatial hash keeps the probe count independent of the much larger
 * whole course mesh. Barycentric containment uses actual projected triangles
 * and rejects vertical/degenerate faces, which cannot close an overhead gap. */
function geometryIndex(triangles) {
  const bins = new Map(), cellSize = 16, valid = [];
  for (const t of triangles) {
    if (!Array.isArray(t) || t.length !== 9 || !t.every(Number.isFinite)) {
      throw new Error('The seam hook returned an invalid triangle');
    }
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-10) continue;
    const triangle = { ax, ay, az, bx, by, bz, cx, cy, cz, denominator };
    const index = valid.push(triangle) - 1;
    const x0 = Math.floor(Math.min(ax, bx, cx) / cellSize), x1 = Math.floor(Math.max(ax, bx, cx) / cellSize);
    const z0 = Math.floor(Math.min(az, bz, cz) / cellSize), z1 = Math.floor(Math.max(az, bz, cz) / cellSize);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const key = `${ix},${iz}`;
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(index);
    }
  }
  return {
    triangles: triangles.length,
    nondegenerateTriangles: valid.length,
    bins: bins.size,
    heightAt(x, z) {
      for (const index of bins.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`) || []) {
        const t = valid[index];
        const a = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / t.denominator;
        const b = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / t.denominator;
        const c = 1 - a - b;
        if (a >= -1e-7 && b >= -1e-7 && c >= -1e-7) return a * t.ay + b * t.by + c * t.cy;
      }
      return null;
    },
  };
}

function seamSamples(bounds) {
  const { x0, x1, z0, z1 } = bounds, samples = [];
  const add = (edge, x, z, offset) => samples.push({ edge, x, z, offset });
  for (const offset of OFFSETS) {
    /* A nonintegral phase avoids sampling only a terrain lattice. Endpoints
     * are included separately by the corner quadrant grids below. */
    for (let x = x0 + 0.37; x < x1; x += STEP) {
      add('north', x, z0 - offset, offset);
      add('south', x, z1 + offset, offset);
    }
    for (let z = z0 + 0.37; z < z1; z += STEP) {
      add('west', x0 - offset, z, offset);
      add('east', x1 + offset, z, offset);
    }
  }
  for (const [name, x, z, sx, sz] of [
    ['north-west', x0, z0, -1, -1], ['north-east', x1, z0, 1, -1],
    ['south-east', x1, z1, 1, 1], ['south-west', x0, z1, -1, 1],
  ]) for (const dx of OFFSETS) for (const dz of OFFSETS) add(name, x + sx * dx, z + sz * dz, [dx, dz]);
  return samples;
}

function measureCoverage(geometry) {
  if (!geometry) return { verified: false, reason: 'V3D.terrainSeamGeometry is unavailable; photographs do not prove mesh coverage' };
  const { bounds, triangles, bandMetres } = geometry;
  if (!bounds || !['x0', 'x1', 'z0', 'z1'].every(k => Number.isFinite(bounds[k])) ||
      !(bounds.x1 > bounds.x0 && bounds.z1 > bounds.z0) || !Array.isArray(triangles) || !(bandMetres >= Math.max(...OFFSETS))) {
    throw new Error('The seam geometry has invalid bounds or insufficient band width');
  }
  const index = geometryIndex(triangles), samples = seamSamples(bounds);
  const misses = [], byEdge = {};
  for (const sample of samples) {
    const group = byEdge[sample.edge] ||= { samples: 0, misses: 0 };
    group.samples++;
    if (index.heightAt(sample.x, sample.z) === null) { group.misses++; misses.push(sample); }
  }
  return {
    verified: true, method: 'projected containment in actual rendered legacy indexed triangles',
    scope: 'Exterior legacy coverage only; v2 interior coverage is a separate browser acceptance gate',
    triangleCount: index.triangles, nondegenerateTriangles: index.nondegenerateTriangles,
    spatialBins: index.bins, bandMetres, offsetsMetres: OFFSETS, spacingMetres: STEP,
    sampleCount: samples.length, missingSamples: misses.length, byEdge,
    missingExamples: misses.slice(0, 80),
    limitations: 'A finite sampling grid detects seam holes; it does not assert exact coverage at every possible point or equal heights across the seam.',
  };
}

function heightJoinSamples(bounds) {
  const { x0, x1, z0, z1 } = bounds, samples = [];
  const add = (edge, x, z, dx, dz) => samples.push({ edge,
    boundary: [x, z],
    inside: [x - dx * HEIGHT_OFFSET, z - dz * HEIGHT_OFFSET],
  });
  for (let x = x0 + 0.37; x < x1; x += STEP) {
    add('north', x, z0, 0, -1);
    add('south', x, z1, 0, 1);
  }
  for (let z = z0 + 0.37; z < z1; z += STEP) {
    add('west', x0, z, -1, 0);
    add('east', x1, z, 1, 0);
  }
  return samples;
}

/* Float32 world vertices acquire submillimetre grid-coordinate roundoff when
 * inverse-rotated through the bridge. Identify genuine mesh boundary edges by
 * BOTH endpoints being within 0.2 mm of the same rectangle side, then compare
 * their height at the exact along-edge coordinate. A probe 1 mm outside can
 * already be far into an extremely narrow triangle and measure its slope,
 * rather than the contact between the two meshes. No new vertex is invented. */
function boundaryIndex(geometry) {
  const bins = new Map(), cellSize = 16, { bounds } = geometry;
  const sides = [
    { name: 'north', axis: 2, along: 0, coordinate: bounds.z0 },
    { name: 'south', axis: 2, along: 0, coordinate: bounds.z1 },
    { name: 'west', axis: 0, along: 2, coordinate: bounds.x0 },
    { name: 'east', axis: 0, along: 2, coordinate: bounds.x1 },
  ];
  let segmentCount = 0;
  for (const [triangleIndex, triangle] of geometry.triangles.entries()) {
    for (const [aIndex, bIndex] of [[0, 3], [3, 6], [6, 0]]) {
      const a = triangle.slice(aIndex, aIndex + 3), b = triangle.slice(bIndex, bIndex + 3);
      for (const side of sides) {
        if (Math.abs(a[side.axis] - side.coordinate) > BOUNDARY_SNAP_TOLERANCE ||
            Math.abs(b[side.axis] - side.coordinate) > BOUNDARY_SNAP_TOLERANCE) continue;
        if (Math.abs(a[side.along] - b[side.along]) < 1e-8) continue;
        const segment = { triangleIndex, a, b, along: side.along };
        segmentCount++;
        const first = Math.floor(Math.min(a[side.along], b[side.along]) / cellSize);
        const last = Math.floor(Math.max(a[side.along], b[side.along]) / cellSize);
        for (let bin = first; bin <= last; bin++) {
          const key = `${side.name}:${bin}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(segment);
        }
      }
    }
  }
  return { segmentCount,
    at(edge, boundary) {
      const along = ['north', 'south'].includes(edge) ? boundary[0] : boundary[1];
      let best = null;
      for (const segment of bins.get(`${edge}:${Math.floor(along / cellSize)}`) || []) {
        const { a, b } = segment, t = (along - a[segment.along]) / (b[segment.along] - a[segment.along]);
        if (t < -1e-8 || t > 1 + 1e-8) continue;
        const height = a[1] + t * (b[1] - a[1]);
        // If coincident boundaries overlap, the upper actual edge is visible.
        if (best === null || height > best.legacyHeight) {
          best = { legacyHeight: height, legacySegment: { triangleIndex: segment.triangleIndex, a, b, fraction: t } };
        }
      }
      return best ?? { legacyHeight: null, legacySegment: null };
    },
  };
}

function summarizeHeightJoin(samples) {
  const finite = samples.filter(s => Number.isFinite(s.legacyHeight) && Number.isFinite(s.v2Height));
  const summarize = rows => {
    const deltas = rows.map(s => Math.abs(s.legacyHeight - s.v2Height)).sort((a, b) => a - b);
    return { samples: rows.length, maxDeltaMetres: deltas.at(-1) ?? null,
      p95DeltaMetres: deltas.length ? deltas[Math.ceil(deltas.length * 0.95) - 1] : null,
      rmsDeltaMetres: deltas.length ? Math.sqrt(deltas.reduce((sum, d) => sum + d * d, 0) / deltas.length) : null,
      samplesAboveTolerance: deltas.filter(d => d > HEIGHT_TOLERANCE).length };
  };
  return { verified: true,
    method: 'Height interpolated on actual legacy mesh boundary segments, snapping only Float32 coordinate roundoff to the rectangle, versus v2 terrainH sampled 1 micrometre inside',
    v2InsetMetres: HEIGHT_OFFSET, boundarySnapToleranceMetres: BOUNDARY_SNAP_TOLERANCE,
    spacingMetres: STEP, toleranceMetres: HEIGHT_TOLERANCE,
    sampleCount: samples.length, missingSamples: samples.length - finite.length,
    ...summarize(finite),
    byEdge: Object.fromEntries(['north', 'east', 'south', 'west'].map(edge => [edge, summarize(finite.filter(s => s.edge === edge))])),
    largestDeltas: finite.map(s => ({ ...s, deltaMetres: Math.abs(s.legacyHeight - s.v2Height) }))
      .sort((a, b) => b.deltaMetres - a.deltaMetres).slice(0, 20),
    missingExamples: samples.filter(s => !Number.isFinite(s.legacyHeight) || !Number.isFinite(s.v2Height)).slice(0, 20),
    limitations: 'Finite edge sampling compares the rendered legacy geometry with the live v2 height sampler; it does not assert exact equality at every point.',
  };
}

if (args.includes('--self-test')) {
  const index = geometryIndex([[0, 2, 0, 4, 2, 0, 0, 2, 4]]);
  if (index.heightAt(0.5, 0.5) !== 2 || index.heightAt(3, 3) !== null || index.heightAt(-0.1, 0) !== null) {
    throw new Error('Triangle coverage self-test failed');
  }
  const small = { bounds: { x0: 0, x1: 4, z0: 0, z1: 4 }, triangles: [], bandMetres: 24 };
  const missing = measureCoverage(small);
  if (!missing.sampleCount || missing.missingSamples !== missing.sampleCount) throw new Error('Missing mesh falsely passed');
  const full = measureCoverage({ ...small, triangles: [[-20, 0, -20, 20, 0, -20, -20, 0, 20], [20, 0, -20, 20, 0, 20, -20, 0, 20]] });
  if (full.missingSamples !== 0 || measureCoverage(null).verified) throw new Error('Coverage self-test failed');
  const heightResult = summarizeHeightJoin([
    { edge: 'north', legacyHeight: 10, v2Height: 10 },
    { edge: 'south', legacyHeight: 10.5, v2Height: 10 },
    { edge: 'east', legacyHeight: null, v2Height: 10 },
  ]);
  if (heightResult.maxDeltaMetres !== 0.5 || heightResult.missingSamples !== 1 || heightResult.samplesAboveTolerance !== 1) {
    throw new Error('Height discontinuity or missing mesh falsely passed');
  }
  const boundary = boundaryIndex({ ...small, triangles: [[0, 3, 0.0001, 4, 5, -0.0001, 2, 100, -0.003]] });
  if (boundary.at('north', [2, 0]).legacyHeight !== 4 || boundary.at('south', [2, 4]).legacyHeight !== null) {
    throw new Error('Actual boundary segment height self-test failed');
  }
  const offBoundary = boundaryIndex({ ...small, triangles: [[0, 3, -0.001, 4, 5, -0.001, 2, 100, -0.003]] });
  if (offBoundary.at('north', [2, 0]).legacyHeight !== null) throw new Error('An off-boundary triangle was fabricated into a mesh boundary');
  console.log('terrain seam harness self-tests passed');
  process.exit(0);
}

function makeViews(bounds) {
  const { x0, x1, z0, z1 } = bounds, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const sites = [
    ['north', mx, z0, 0, -1], ['east', x1, mz, 1, 0],
    ['south', mx, z1, 0, 1], ['west', x0, mz, -1, 0],
    ['north-west', x0, z0, -Math.SQRT1_2, -Math.SQRT1_2],
    ['north-east', x1, z0, Math.SQRT1_2, -Math.SQRT1_2],
    ['south-east', x1, z1, Math.SQRT1_2, Math.SQRT1_2],
    ['south-west', x0, z1, -Math.SQRT1_2, Math.SQRT1_2],
  ];
  return sites.flatMap(([site, x, z, dx, dz]) => [
    { id: `${site}-overhead`, targetGrid: [x, z], cameraGrid: [x, z + 0.01], height: 1050 },
    { id: `${site}-oblique`, targetGrid: [x, z], cameraGrid: [x + dx * 550, z + dz * 550], height: 650 },
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
const report = { schemaVersion: 1, capturedAt: new Date().toISOString(), course: SLUG,
  url: `${BASE}/?bana=${SLUG}&det=1&hal=1&vy=fritt&ljus=kvall`, gpuRequested: GPU,
  viewport: [1600, 900], errors: [], consoleErrors: [], views: [], gates: [], passed: false };
let browser;
const gate = (ok, label) => { report.gates.push({ ok: !!ok, label }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
try {
  const linuxChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const bundledChrome = chromium.executablePath();
  const chrome = process.env.BANVY_CHROME || (fs.existsSync(linuxChrome) ? linuxChrome : fs.existsSync(bundledChrome) ? bundledChrome : null);
  browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : { channel: 'chrome' }), args: browserArgs() });
  report.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(String(error).slice(0, 500)));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text().slice(0, 500)); });
  console.log(`terrain seam <- ${report.url}`);
  const start = Date.now();
  await page.goto(report.url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT });
  report.bootSeconds = (Date.now() - start) / 1000;
  report.metadata = await page.evaluate(() => ({ terrain: window.V3D.v2Terrain(), stats: window.V3D.stats, course: window.V3D.course() }));
  const terrain = report.metadata.terrain;
  gate(terrain.ready && terrain.status === 'ready' && terrain.kind === 'fixed-frontier', 'fixed metre frontier is serving');
  if (!terrain.bounds || !terrain.bridge) throw new Error('No frontier bounds/bridge for seam placement');
  const geometry = await page.evaluate(() => window.V3D.terrainSeamGeometry?.() ?? null);
  if (geometry) {
    const encoded = gzipSync(JSON.stringify(geometry));
    fs.writeFileSync(path.join(OUT, 'legacy-seam-geometry.json.gz'), encoded);
    report.geometryArtifact = { file: 'legacy-seam-geometry.json.gz', bytes: encoded.length, sha256: hash(encoded) };
  }
  report.coverage = measureCoverage(geometry);
  gate(report.coverage.verified, 'actual legacy triangle geometry was measured');
  gate(report.coverage.verified && report.coverage.missingSamples === 0,
    `legacy seam coverage: ${report.coverage.missingSamples ?? 'unmeasured'} missing / ${report.coverage.sampleCount ?? 0} exterior samples`);

  if (geometry && report.coverage.verified) {
    const index = boundaryIndex(geometry);
    const samples = heightJoinSamples(geometry.bounds).map(sample => ({ ...sample,
      ...index.at(sample.edge, sample.boundary),
    }));
    const heights = await page.evaluate(({ points, bridge }) => {
      const c = Math.cos(bridge.rotationRadians), s = Math.sin(bridge.rotationRadians);
      return points.map(([x, z]) => window.V3D.terrainH(
        bridge.scaleX * (x * c - z * s), bridge.scaleZ * (x * s + z * c)));
    }, { points: samples.map(sample => sample.inside), bridge: terrain.bridge });
    samples.forEach((sample, i) => { sample.v2Height = heights[i]; });
    report.heightJoin = summarizeHeightJoin(samples);
    report.heightJoin.actualBoundarySegments = index.segmentCount;
    const encoded = gzipSync(JSON.stringify(samples));
    fs.writeFileSync(path.join(OUT, 'boundary-height-samples.json.gz'), encoded);
    report.heightJoinArtifact = { file: 'boundary-height-samples.json.gz', bytes: encoded.length, sha256: hash(encoded) };
  } else report.heightJoin = { verified: false, reason: 'Actual legacy seam geometry is unavailable' };
  gate(report.heightJoin.verified && report.heightJoin.missingSamples === 0 && report.heightJoin.maxDeltaMetres <= HEIGHT_TOLERANCE,
    `boundary height continuity: max ${report.heightJoin.maxDeltaMetres?.toFixed(5) ?? 'unmeasured'} m, P95 ${report.heightJoin.p95DeltaMetres?.toFixed(5) ?? 'unmeasured'} m; limit ${HEIGHT_TOLERANCE} m`);

  const views = makeViews(terrain.bounds);
  for (const view of views) {
    const placement = await page.evaluate(({ view, bridge }) => {
      /* Bounds already include the tile translation about the legacy origin.
       * Only the rotation and anisotropic scale are applied here, exactly as
       * the bridge's toLegacy function does; adding translateX/Z again would
       * displace every camera from the seam we mean to inspect. */
      const c = Math.cos(bridge.rotationRadians), s = Math.sin(bridge.rotationRadians);
      const legacy = ([x, z]) => [bridge.scaleX * (x * c - z * s), bridge.scaleZ * (x * s + z * c)];
      const target = legacy(view.targetGrid), camera = legacy(view.cameraGrid);
      const ground = window.V3D.terrainH(...target);
      const p = [camera[0], ground + view.height, camera[1]], t = [target[0], ground, target[1]];
      window.V3D.placeCamera(p, t);
      return { position: p, target: t };
    }, { view, bridge: terrain.bridge });
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 60000 });
    await page.evaluate(() => window.V3D.prepareCapture());
    const filename = `${view.id}.png`;
    const bytes = await page.screenshot({ path: path.join(OUT, filename), animations: 'disabled', timeout: 60000 });
    const camera = await page.evaluate(() => window.V3D.camExact());
    report.views.push({ ...view, ...placement, actualCamera: camera, file: filename, bytes: bytes.length, sha256: hash(bytes) });
    console.log(`captured ${view.id}`);
  }
  gate(report.views.length === 16, 'overhead and oblique evidence captured at all four edges and corners');
  gate(report.errors.length === 0, 'no browser page errors');
  gate(report.consoleErrors.length === 0, 'no browser console errors');
  report.passed = report.gates.every(g => g.ok);
} catch (error) {
  report.failure = String(error?.stack || error);
  console.error(report.failure);
} finally {
  await browser?.close();
  fs.writeFileSync(path.join(OUT, 'terrain-seam.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, path.join(OUT, 'terrain-seam.json'))}`);
  if (!report.passed) process.exitCode = 1;
}
