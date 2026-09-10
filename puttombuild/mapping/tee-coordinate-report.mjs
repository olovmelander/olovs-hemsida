#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { teeMarkerPositions } from '../../apps/golf/src/engine/tee-marker-placement.mjs';
import { teeView } from '../../apps/golf/src/engine/tee-view.mjs';
import { inRing, ringSD } from '../../apps/golf/src/engine/geom.js';
import { orthophotoPoint, orthophotoPointEpsg3006 } from './reviewed-orthophoto.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const KEYS = ['tee-61', 'tee-57', 'tee-48', 'tee-41'];
const distance = (a, b) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;
const rounded = (v, places = 6) => Number.isFinite(v) ? +v.toFixed(places) : null;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function decodeTeeReportPack(bytes) {
  if (bytes.subarray(0, 4).toString() !== 'GPK1') throw new Error('Expected GPK1 course pack');
  const n = bytes.readUInt32LE(4), header = JSON.parse(bytes.subarray(8, 8 + n));
  const start = 8 + n + header.HF0.bytes + header.HF1.bytes;
  const model = JSON.parse(inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)));
  return { header, model };
}

export function makeTeeCoordinateReport({ model, review, pack, routing = null }) {
  const issues = [], rows = [], markers = [];
  const fail = (gate, hole, tee, message) => issues.push({ gate, hole, tee, message });
  if (model.origin?.lat !== 63.2992 || model.origin?.lon !== 18.9413 || model.mPerLat !== 111320 ||
      Math.abs(model.mPerLon - 50019.58) > 1e-6) throw new Error('Expected the immutable Puttom model frame');
  if (pack.header.slug !== 'puttom' || JSON.stringify(pack.header.GEO.origin) !== JSON.stringify(model.origin) ||
      pack.header.GEO.mPerLon !== model.mPerLon) throw new Error('Puttom pack/model frames differ');
  const runtimeHoles = withInferredTeePads(pack.model.holes);
  const bridge = legacyGridBridge(PUTTOM_PREVIEW_CONFIG.legacyFrame);
  const origin = PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006;
  const observations = new Map();
  for (const h of review.holes) {
    for (const t of h.tees ?? []) for (const [tee, pixel] of Object.entries(t.cameraReferencesPixels ?? {})) {
      observations.set(`${h.n}:${tee}`, { trace: t, pixel, basis: 'reviewed-platform' });
    }
    for (const t of h.cameraReferences ?? []) observations.set(`${h.n}:${t.teeKey}`,
      { trace: t, pixel: t.pointPixels, basis: 'visible-interior-anchor' });
  }
  for (const h of model.holes) {
    const serialized = pack.model.holes.find(v => v.n === h.n), runtime = runtimeHoles.find(v => v.n === h.n);
    if (!serialized || !runtime || h.tees.marks.length !== 4) throw new Error(`Missing four tees for hole ${h.n}`);
    if (h.tees.inferPads !== false || runtime.tees.pads.length !== h.tees.pads.length) fail('platform-inventory', h.n, null, 'Synthetic or stale tee platforms');
    for (let i = 0; i < 4; i++) {
      const tee = KEYS[i], mark = h.tees.marks[i], packedMark = serialized.tees.marks[i], live = runtime.tees.marks[i];
      const observation = observations.get(`${h.n}:${tee}`), trace = observation?.trace;
      const source = trace ? review.sources[trace.sourceKey] : null;
      const latitude = model.origin.lat - mark.c[1] / model.mPerLat;
      const longitude = model.origin.lon + mark.c[0] / model.mPerLon;
      const projected = latLonToSweref99Tm(latitude, longitude);
      const grid = trace ? orthophotoPointEpsg3006(review, trace.sourceKey, observation.pixel) : projected;
      const converted = trace ? orthophotoPoint(review, trace.sourceKey, observation.pixel) : null;
      const [gx, gz] = bridge.toGrid(...live.c), runtimeGrid = [origin.easting + gx, origin.northing - gz];
      const containing = h.tees.pads.filter(p => inRing(...mark.c, p.ring));
      const reviewedPad = observation?.basis === 'reviewed-platform' ? h.tees.pads.find(p => p.reviewId === trace.id) : null;
      const platform = reviewedPad ?? (trace?.existingPadIndex !== undefined ? h.tees.pads[trace.existingPadIndex] : containing[0]);
      const sourcePixelError = converted ? distance(mark.c, converted) : null;
      const packError = distance(mark.c, packedMark?.c), bootError = distance(packedMark?.c, live.c);
      const cameraError = distance(live.c, teeView(runtime, live).position), bridgeError = distance(grid, runtimeGrid);
      const cardSame = mark.m === h.t[i] && packedMark?.m === h.t[i];
      const route = routing?.holes?.find(r => r.number === h.n);
      const routeDifference = i === 0 ? distance(h.line[0], mark.c) : null;
      const publishedRouteDifference = i === 0 && route ? distance(route.line[0], grid) : null;
      if (packError > 1e-9) fail('pack-position', h.n, tee, `serialized position differs by ${packError} m`);
      if (bootError > 1e-9) fail('boot-position', h.n, tee, `boot normalization moves reference by ${bootError} m`);
      if (cameraError > 1e-9) fail('camera-position', h.n, tee, 'teeView moves the selected reference');
      if (sourcePixelError !== null && sourcePixelError >= .01) fail('source-pixel', h.n, tee, `reviewed point differs by ${sourcePixelError} m`);
      if (bridgeError >= .16) fail('runtime-frame', h.n, tee, `linear bridge residual ${bridgeError} m exceeds one native pixel`);
      if (!cardSame) fail('scorecard', h.n, tee, 'displayed scorecard distance changed');
      if (routeDifference !== null && routeDifference >= .01) fail('route-start', h.n, tee, `route starts ${routeDifference} m from its back reference`);
      if (publishedRouteDifference !== null && publishedRouteDifference >= .01) fail('published-routing', h.n, tee, `published route starts ${publishedRouteDifference} m from its back reference`);
      if (reviewedPad && (!live.sourcePadId || ![reviewedPad.id, reviewedPad.reviewId].includes(live.sourcePadId))) {
        fail('marker-platform-binding', h.n, tee, 'paired reviewed reference lacks the adopted source platform identity in the pack');
      }
      const pair = pack.model.infra?.objectPlacement === 'mapped-only' ? [] : teeMarkerPositions(runtime, live);
      let clearance = null;
      if (pair.length) {
        const candidates = runtime.tees.pads.filter(p => live.sourcePadId === undefined || [p.id, p.reviewId].includes(live.sourcePadId));
        const owner = candidates.find(p => inRing(...live.c, p.ring) && pair.every(c => ringSD(...c, p.ring) <= -.15 + 1e-7));
        if (!owner || pair.length !== 2) fail('physical-markers', h.n, tee, 'decorative pair leaves its own platform or radius clearance');
        clearance = owner ? Math.min(...pair.map(p => -ringSD(...p, owner.ring))) : null;
        for (const c of pair) markers.push({ hole: h.n, tee, position: c, sourcePadId: live.sourcePadId ?? null,
          platformId: owner?.id ?? owner?.reviewId ?? null, minimumEdgeClearanceMetres: clearance });
      }
      const row = { hole: h.n, tee, cardMetres: h.t[i], latitude: rounded(latitude, 10), longitude: rounded(longitude, 10),
        eastingEpsg3006: rounded(grid[0], 3), northingEpsg3006: rounded(grid[1], 3),
        coordinateBasis: trace ? 'reviewed-orthophoto-pixel' : 'unreviewed-legacy-reference-projected',
        reviewStatus: observation?.basis ?? (containing.length ? 'unreviewed-inside-mapped-platform' : 'unreviewed-outside-mapped-platforms'),
        sourceKey: trace?.sourceKey ?? null, sourceCapturedAt: [...new Set(source?.sources?.map(s => s.capturedAt).filter(Boolean) ?? [])],
        sourceIds: source?.sourceIds ?? source?.sources?.map(s => s.id) ?? [], sourceSha256: source?.sha256 ?? null,
        numberedSourceAssetId: trace?.numberedSourceAssetId ?? null,
        platformId: platform?.id ?? platform?.reviewId ?? null, sourcePadId: live.sourcePadId ?? null,
        platformBoundaryReviewed: observation?.basis === 'reviewed-platform', insideAnyMappedPlatform: containing.length > 0,
        legacyX: mark.c[0], legacyZ: mark.c[1], sourcePixelAgreementMetres: rounded(sourcePixelError),
        serializedPositionErrorMetres: rounded(packError), bootNormalizationErrorMetres: rounded(bootError),
        teeViewHelperPositionErrorMetres: rounded(cameraError), legacyToRuntimeBridgeResidualMetres: rounded(bridgeError),
        publishedRoutingStartErrorMetres: rounded(publishedRouteDifference), routeStartErrorMetres: rounded(routeDifference),
        decorativeMarkerCount: pair.length, decorativeMarkerMinimumEdgeClearanceMetres: rounded(clearance) };
      rows.push(row);
    }
  }
  if (rows.length !== 72) fail('inventory', null, null, `Expected 72 references, found ${rows.length}`);
  const max = key => Math.max(0, ...rows.map(r => r[key] ?? 0));
  return { schemaVersion: 1, groundId: 'puttom', kind: 'tee-coordinate-and-rendering-report', passed: issues.length === 0,
    frame: { originWgs84: model.origin, metresPerLatitude: model.mPerLat, metresPerLongitude: model.mPerLon,
      runtimeBridge: { rotationDegrees: bridge.rotationDegrees, scaleX: bridge.scaleX, scaleZ: bridge.scaleZ } },
    summary: { references: rows.length, reviewedReferences: observations.size, unreviewedReferences: rows.length - observations.size,
      decorativeMarkers: markers.length, maximumPackPositionErrorMetres: max('serializedPositionErrorMetres'),
      maximumBootPositionErrorMetres: max('bootNormalizationErrorMetres'), maximumTeeViewHelperErrorMetres: max('teeViewHelperPositionErrorMetres'),
      maximumRuntimeBridgeResidualMetres: max('legacyToRuntimeBridgeResidualMetres'), maximumRoutingStartErrorMetres: max('publishedRoutingStartErrorMetres') },
    rows, expectedDecorativeMarkers: markers, issues,
    limitations: ['All references are virtual camera/HUD positions, not surveyed daily tee marker placements.',
      'Unreviewed coordinates are projections of inherited references, not new orthophoto measurements.',
      'Coordinate decimals and bridge residuals express numerical conversion, not absolute survey accuracy.',
      'WGS84 output uses the frozen legacy frame and the repository SWEREF/WGS84 approximation; reference epochs are not transformed.',
      'The helper checks are deterministic preflight checks; actual browser camera and GPU instance positions require check-runtime.mjs.'] };
}

export function teeCoordinateCsv(report) {
  const columns = ['hole', 'tee', 'cardMetres', 'latitude', 'longitude', 'eastingEpsg3006', 'northingEpsg3006',
    'coordinateBasis', 'reviewStatus', 'sourceCapturedAt', 'sourceKey', 'platformId', 'sourcePadId',
    'platformBoundaryReviewed', 'insideAnyMappedPlatform', 'legacyX', 'legacyZ', 'sourcePixelAgreementMetres',
    'serializedPositionErrorMetres', 'bootNormalizationErrorMetres', 'legacyToRuntimeBridgeResidualMetres',
    'publishedRoutingStartErrorMetres', 'decorativeMarkerCount', 'decorativeMarkerMinimumEdgeClearanceMetres'];
  const cell = value => { const text = Array.isArray(value) ? value.join(';') : value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  return [columns.join(','), ...report.rows.map(row => columns.map(k => cell(row[k])).join(','))].join('\n') + '\n';
}

function main() {
  const options = { model: 'puttombuild/course-model.json', review: 'puttombuild/mapping/orthophoto-review.json',
    pack: 'apps/golf/public/courses/puttom/pack.bin', outDir: 'puttombuild/mapping' };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i] === '--out-dir' ? 'outDir' : process.argv[i].replace(/^--/, '');
    if (!(key in options) || !process.argv[i + 1]) throw new Error('Usage: tee-coordinate-report.mjs [--model file] [--review file] [--pack file] [--out-dir directory]');
    options[key] = process.argv[++i];
  }
  const identities = {}, inputs = {};
  for (const key of ['model', 'review', 'pack']) {
    const file = path.resolve(ROOT, options[key]), bytes = fs.readFileSync(file);
    identities[key] = { path: path.relative(ROOT, file).replaceAll(path.sep, '/'), sha256: sha256(bytes) };
    inputs[key] = key === 'pack' ? decodeTeeReportPack(bytes) : JSON.parse(bytes);
  }
  const pub = p => path.join(ROOT, 'apps/golf/public', p), readPublic = p => JSON.parse(fs.readFileSync(pub(p)));
  const entry = readPublic('courses/v2-index.json').courses.find(c => c.slug === 'puttom');
  const course = readPublic(entry.manifest.url), routingBytes = fs.readFileSync(pub(course.routing.url));
  inputs.routing = readChunk(routingBytes).content;
  identities.routing = { path: `apps/golf/public/${course.routing.url}`, sha256: sha256(routingBytes) };
  const report = { ...makeTeeCoordinateReport(inputs), inputs: identities };
  if (course.fallbackV1.sha256 !== identities.pack.sha256) { report.passed = false; report.issues.push({ gate: 'pack-binding', message: 'Published course fallback hash differs from decoded pack' }); }
  const out = path.resolve(ROOT, options.outDir); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'tee-coordinate-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'tee-coordinates.csv'), teeCoordinateCsv(report));
  console.log(JSON.stringify({ passed: report.passed, summary: report.summary, issues: report.issues, outDir: out }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
