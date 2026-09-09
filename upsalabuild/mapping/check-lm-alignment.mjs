#!/usr/bin/env node
/** Read-only geometry/asset audit. Optional --out writes a new review report only.
 * Run before and after a mapping rebuild; --baseline requires the shared ground,
 * terrain/vegetation references, legacy heightfields and routing/card/marker data
 * to remain identical. Course/pack/model hashes may change after surface edits.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { UPSALA_V2_CONFIGS } from '../../apps/golf/src/engine/v2-upsala-config.mjs';
import { latLonToSweref99Tm, sweref99TmToLatLon } from '../../packages/course-geo/chmv2/projection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonSha = value => sha(JSON.stringify(value));
const round = value => Number(value.toFixed(9));
const sourceFile = relative => {
  const bytes = fs.readFileSync(path.join(ROOT, relative));
  return { path: relative, bytes: bytes.length, sha256: sha(bytes),
    normalizedTextSha256: sha(bytes.toString('utf8').replace(/\r\n/g, '\n')) };
};
const readJSON = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const courses = [
  { slug: 'upsala', model: 'upsalabuild/course-model.json', heightfields: 'upsalabuild/heightfields.json' },
  { slug: 'upsala-mellanbanan', model: 'upsalamellanbuild/course-model.json', heightfields: 'upsalamellanbuild/heightfields.json' },
];

function statistics(rows, key) {
  assert(rows.length > 0, 'empty vertex population');
  const sorted = rows.slice().sort((a, b) => a[key] - b[key]);
  const quantile = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))][key];
  const worst = sorted.at(-1);
  return { count: rows.length, p50Metres: round(quantile(0.5)), p95Metres: round(quantile(0.95)),
    maxMetres: round(worst[key]), worst: { hole: worst.hole, geometry: worst.geometry,
      vertex: worst.vertex, localXZ: worst.localXZ, exactEPSG3006: worst.exactEPSG3006,
      runtimeEPSG3006: worst.runtimeEPSG3006 } };
}

function auditCourse(course) {
  const model = readJSON(course.model), config = UPSALA_V2_CONFIGS[course.slug];
  assert.deepEqual(model.origin, { lat: config.legacyFrame.latitude, lon: config.legacyFrame.longitude });
  assert.equal(model.mPerLat, config.legacyFrame.metresPerLatitude);
  assert.equal(model.mPerLon, config.legacyFrame.metresPerLongitude);
  const bridge = legacyGridBridge(config.legacyFrame);
  const origin = latLonToSweref99Tm(model.origin.lat, model.origin.lon);
  const rows = [];
  for (const hole of model.holes) {
    const geometries = [['route', hole.line], ['green', hole.green.ring],
      ...hole.tees.pads.map((pad, i) => [`tee/${i}`, pad.ring]),
      ...hole.fairway.rings.map((ring, i) => [`fairway/${i}`, ring]),
      ...hole.bunkers.map((bunker, i) => [`bunker/${i}`, bunker.ring])];
    for (const [geometry, points] of geometries) {
      assert(Array.isArray(points), `missing ${course.slug} H${hole.n} ${geometry}`);
      for (const [vertex, point] of points.entries()) {
        assert(point.length === 2 && point.every(Number.isFinite), 'invalid local vertex');
        const [x, z] = point;
        const latitude = model.origin.lat - z / model.mPerLat;
        const longitude = model.origin.lon + x / model.mPerLon;
        const exact = latLonToSweref99Tm(latitude, longitude), [gx, gz] = bridge.toGrid(x, z);
        const runtime = [config.legacyOriginEpsg3006.easting + gx, config.legacyOriginEpsg3006.northing - gz];
        const [backLat, backLon] = sweref99TmToLatLon(...exact);
        const back = [(backLon - model.origin.lon) * model.mPerLon, (model.origin.lat - backLat) * model.mPerLat];
        rows.push({ hole: hole.n, geometry, vertex, localXZ: point, exactEPSG3006: exact.map(round),
          runtimeEPSG3006: runtime.map(round), runtimeResidual: Math.hypot(runtime[0] - exact[0], runtime[1] - exact[1]),
          affineOnlyResidual: Math.hypot(origin[0] + gx - exact[0], origin[1] - gz - exact[1]),
          projectionRoundtripResidual: Math.hypot(x - back[0], z - back[1]) });
      }
    }
  }
  const protectedGeometry = { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
    frame: model.frame, card: model.card, holes: model.holes.map(hole => ({ n: hole.n, par: hole.par,
      idx: hole.idx, t: hole.t, line: hole.line, greenCentre: hole.green.c, pin: hole.pin, marks: hole.tees.marks })) };
  return { slug: course.slug, sourceModel: sourceFile(course.model), legacyHeightfields: sourceFile(course.heightfields),
    protectedRoutingCardMarkersSha256: jsonSha(protectedGeometry),
    bridge: { rotationDegrees: round(bridge.rotationDegrees), scaleX: round(bridge.scaleX), scaleZ: round(bridge.scaleZ),
      exactProjectedLegacyOrigin: origin.map(round), configuredProjectedLegacyOrigin: config.legacyOriginEpsg3006,
      projectedOriginDifferenceMetres: round(Math.hypot(config.legacyOriginEpsg3006.easting - origin[0], config.legacyOriginEpsg3006.northing - origin[1])) },
    runtimeVsExactProjection: statistics(rows, 'runtimeResidual'), affineApproximationOnly: statistics(rows, 'affineOnlyResidual'),
    exactProjectionRoundtrip: statistics(rows, 'projectionRoundtripResidual'),
    perHole: model.holes.map(hole => ({ hole: hole.n, ...statistics(rows.filter(row => row.hole === hole.n), 'runtimeResidual') })) };
}

function auditPublishedAssets() {
  const verified = new Map();
  function verify(reference) {
    const url = reference.url ?? reference.packUrl;
    assert(typeof url === 'string' && !url.includes('\\') && !path.isAbsolute(url), 'invalid asset URL');
    const filename = path.resolve(PUBLIC, url);
    assert(filename.startsWith(`${PUBLIC}${path.sep}`), 'asset URL outside public directory');
    const bytes = verified.get(url) ?? fs.readFileSync(filename);
    assert.equal(bytes.length, reference.bytes, `${url}: bytes`);
    assert.equal(sha(bytes), reference.sha256, `${url}: SHA-256`);
    verified.set(url, bytes);
    return bytes;
  }
  const reference = ref => ({ url: ref.url ?? ref.packUrl, bytes: ref.bytes, sha256: ref.sha256 });
  const root = readJSON('apps/golf/public/courses/v2-index.json');
  let ground = null, groundReference = null;
  const publishedCourses = courses.map(({ slug }) => {
    const entry = root.courses.find(course => course.slug === slug);
    assert(entry && entry.groundId === 'upsala', `missing ${slug}`);
    const course = JSON.parse(verify(entry.manifest));
    assert.equal(course.slug, slug);
    assert.deepEqual(course.fallbackV1, entry.fallbackV1);
    verify(course.routing); verify(course.fallbackV1);
    const nextGround = JSON.parse(verify(course.groundManifest));
    if (groundReference) assert.deepEqual(course.groundManifest, groundReference, 'courses do not share one ground');
    ground = nextGround; groundReference = course.groundManifest;
    assert.deepEqual(ground.frame.origin, UPSALA_V2_CONFIGS[slug].canonicalOrigin);
    assert.equal(ground.frame.fingerprint, UPSALA_V2_CONFIGS[slug].frameFingerprint);
    return { slug, manifest: reference(entry.manifest), routing: reference(course.routing), fallbackV1: reference(course.fallbackV1) };
  });
  verify(ground.shell);
  const layers = {};
  for (const name of [...new Set(ground.tiles.flatMap(tile => Object.keys(tile.layers)))].sort()) {
    const references = ground.tiles.filter(tile => tile.layers[name]).map(tile => ({ tileId: tile.id, ...reference(tile.layers[name]) }));
    for (const ref of references) verify(ref);
    references.sort((a, b) => a.tileId.localeCompare(b.tileId));
    const unique = new Map(references.map(ref => [ref.url, ref]));
    layers[name] = { tileReferenceCount: references.length, uniqueAssets: unique.size,
      totalUniqueBytes: [...unique.values()].reduce((sum, ref) => sum + ref.bytes, 0),
      sortedReferencesSha256: jsonSha(references) };
  }
  return { rootIndex: sourceFile('apps/golf/public/courses/v2-index.json'), courses: publishedCourses,
    ground: { manifest: reference(groundReference), frame: ground.frame, shell: reference(ground.shell), layers },
    verifiedAssetCount: verified.size };
}

function compareBaseline(report, baseline) {
  assert.equal(baseline.schemaVersion, 1, 'unsupported baseline schema');
  assert.equal(baseline.audit, report.audit, 'different baseline audit');
  assert.deepEqual(report.published.ground, baseline.published.ground, 'published ground/frame/terrain/vegetation changed');
  for (const course of report.courses) {
    const previous = baseline.courses.find(c => c.slug === course.slug);
    assert(previous, `baseline missing ${course.slug}`);
    assert.equal(course.legacyHeightfields.normalizedTextSha256, previous.legacyHeightfields.normalizedTextSha256,
      `${course.slug}: legacy heightfields changed`);
    assert.equal(course.protectedRoutingCardMarkersSha256, previous.protectedRoutingCardMarkersSha256,
      `${course.slug}: routing, scorecard, nominal pin or daily-marker reference changed`);
  }
  return { status: 'unchanged', groundFrameTerrainVegetation: true, legacyHeightfields: true, routingCardMarkers: true,
    note: 'Source model, pack, course-manifest and root-index hashes may change after a surface-only rebuild.' };
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: node upsalabuild/mapping/check-lm-alignment.mjs [--out NEW.json] [--baseline PREVIOUS.json]\nWithout --out, prints JSON. --out refuses to overwrite an existing file. No production assets are written.');
    return;
  }
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    assert(['--out', '--baseline'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'unknown/incomplete argument');
    options[argv[i].slice(2)] = argv[++i];
  }
  const report = { schemaVersion: 1, audit: 'upsala-lm-horizontal-alignment-v1', generatedAt: new Date().toISOString(),
    methodology: {
      population: 'Every stored route, green-ring, physical-tee-ring, fairway-ring and bunker-ring vertex of both shipped course models. Repeated vertices are retained; scenery/infra and intermediate mesh samples are outside this population.',
      exactProjection: 'Invert the declared legacy flat-earth frame to latitude/longitude, then use the repository Kruger-series SWEREF 99 TM forward projection. Exact means nonlinear projection instead of affine approximation; this is not an independent survey.',
      runtimeProjection: 'Use the runtime legacyGridBridge.toGrid plus the configured projected legacy origin; compare Euclidean EPSG:3006 distances with nonlinear projection.',
      affineApproximationOnly: 'Use the nonlinear projected origin for both paths, isolating affine curvature error from the configured origin rounding difference.',
      quantiles: 'Ascending residuals; p50/p95 select index floor(count*q), capped at count-1. Units are metres; output rounded to 9 decimals.',
      roundtrip: 'Forward then inverse repository projection and declared local frame. Numerical closure only; it does not validate orthophoto registration or original pixel traces.',
      assetHashes: 'Every referenced course, routing, fallback, ground, shell and tile payload is read and checked against byte count and SHA-256. Each layer digest hashes JSON.stringify of {tileId,url,bytes,sha256} references sorted by tileId.',
      limitations: 'No imagery pixels or independent control points are compared. No geometry/frame/terrain is changed. Orthophoto capture age, edge interpretation and source positional uncertainty remain separate limits.',
    },
    implementation: ['upsalabuild/mapping/check-lm-alignment.mjs', 'apps/golf/src/engine/geodetic-frame.mjs',
      'apps/golf/src/engine/v2-upsala-config.mjs', 'packages/course-geo/chmv2/projection.mjs'].map(sourceFile),
    courses: courses.map(auditCourse), published: auditPublishedAssets() };
  if (options.baseline) report.baselineComparison = compareBaseline(report, JSON.parse(fs.readFileSync(path.resolve(ROOT, options.baseline), 'utf8')));
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const filename = path.resolve(ROOT, options.out);
    assert(filename.endsWith('.json'), '--out must be a JSON report');
    fs.writeFileSync(filename, output, { flag: 'wx' });
    console.log(`Wrote ${path.relative(ROOT, filename)}; verified ${report.published.verifiedAssetCount} published assets.`);
    for (const course of report.courses) console.log(`${course.slug}: ${course.runtimeVsExactProjection.count} vertices, p50 ${course.runtimeVsExactProjection.p50Metres} m, p95 ${course.runtimeVsExactProjection.p95Metres} m, max ${course.runtimeVsExactProjection.maxMetres} m.`);
    if (report.baselineComparison) console.log('Baseline ground, heightfields and routing/card/marker checks passed.');
  } else process.stdout.write(output);
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(`Upsala alignment audit failed: ${error.message}`); process.exitCode = 1; }
