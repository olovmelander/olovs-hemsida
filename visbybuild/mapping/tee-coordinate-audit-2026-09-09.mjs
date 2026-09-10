#!/usr/bin/env node
/* Independent numeric audit of Visby's source pixels and published coordinates.
 * --capture-baseline snapshots protected data in ignored cache, never overwrites.
 * --write writes the current report. The script does not edit course geometry.
 * Residuals between representations are not independent survey accuracy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { verifyChunkAsset } from '../../packages/course-v2/chunk-node.mjs';
import { pointInPoly } from '../../geobuild/lib.mjs';
import { VISBY_FRAME, local, projected } from '../frame.mjs';
import { VISBY_V2_CONFIG } from '../../apps/golf/src/engine/v2-visby-config.mjs';
import { loadPublishedGraphTerrainFrontier } from '../../apps/golf/src/engine/v2-graph-frontier.mjs';
import { facilityPoint } from './reviewed-facilities.mjs';
import { gpsToLocal } from '../../apps/golf/src/engine/caddie.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASELINE = 'visbybuild/cache/tee-coordinate-baseline-2026-09-09.json';
const OUTPUT = 'visbybuild/mapping/tee-coordinate-audit-2026-09-09.json';
const readBytes = file => fs.readFileSync(path.join(ROOT, file));
const read = file => JSON.parse(readBytes(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonSha = value => sha(JSON.stringify(value));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = n => Math.round(n * 1e9) / 1e9;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const args = process.argv.slice(2);
if (args.some(arg => !['--write', '--capture-baseline'].includes(arg))) throw new Error('Unknown audit argument');
const model = read('visbybuild/course-model.json');
const geometry = read('visbybuild/mapping/geometry.json');
const card = read('visbybuild/reference/club-scorecard.json');
const migration = read('geo_data/course-v2/visby/migration/course-model.epsg3006.json');
const canonical = migration.geometry;
const publicRead = url => read(`apps/golf/public/${url}`);
const publicBytes = url => readBytes(`apps/golf/public/${url}`);
const index = publicRead('courses/v2-index.json').courses.find(c => c.slug === 'visby');
const course = publicRead(index.manifest.url);
const ground = publicRead(course.groundManifest.url);
const packBytes = publicBytes(index.fallbackV1.packUrl);
const pack = readPack(packBytes);
const vectors = JSON.parse(inflateStream(pack.sv));
const routing = verifyChunkAsset(course.routing, publicBytes(course.routing.url)).content;
const layerReferences = layer => ground.tiles.flatMap(tile => tile.layers[layer] ? [{ tile: tile.id, ...tile.layers[layer] }] : []);
const protectedState = () => ({
  frame: { model: model.frame, origin: model.origin, graph: ground.frame },
  groundManifest: course.groundManifest,
  terrain: layerReferences('terrain'), stands: layerReferences('stands'), objects: layerReferences('objects'),
  heightfieldsSha256: sha(readBytes('visbybuild/heightfields.json')),
  packHeightStreamsSha256: { s0: sha(pack.s0), s1: sha(pack.s1) },
  cardSha256: sha(readBytes('visbybuild/card.json')),
  clubCardSha256: sha(readBytes('visbybuild/reference/club-scorecard.json')),
  modelCardSha256: jsonSha(model.holes.map(h => ({ n: h.n, par: h.par, idx: h.idx, t: h.t }))),
  laterRouteVerticesSha256: jsonSha(model.holes.map(h => ({ n: h.n, line: h.line.slice(1) }))),
  greenGeometrySha256: jsonSha(model.holes.map(h => ({ n: h.n, pin: h.pin, green: h.green }))),
  otherPlayingSurfacesSha256: jsonSha(model.holes.map(h => ({ n: h.n, fairway: h.fairway, bunkers: h.bunkers }))),
  contextSha256: jsonSha({ water: model.water, infra: model.infra, scenery: model.scenery, vegetation: model.vegetation }),
});
if (args.includes('--capture-baseline')) {
  if (fs.existsSync(path.join(ROOT, BASELINE))) throw new Error('Baseline already exists; refusing to overwrite it');
  const value = { schemaVersion: 1, capturedAt: new Date().toISOString(), modelSha256: sha(readBytes('visbybuild/course-model.json')),
    geometrySha256: sha(readBytes('visbybuild/mapping/geometry.json')), protected: protectedState(),
    holes: model.holes.map(h => ({ n: h.n, line: h.line, tees: h.tees })) };
  fs.mkdirSync(path.dirname(path.join(ROOT, BASELINE)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, BASELINE), `${JSON.stringify(value, null, 2)}\n`);
  console.log(JSON.stringify({ captured: BASELINE, modelSha256: value.modelSha256, terrainTiles: value.protected.terrain.length, standTiles: value.protected.stands.length }));
  process.exit(0);
}
const failures = [], limitations = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const statistics = values => ({ count: values.length, rmseMetres: values.length ? round(Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length)) : null,
  maxMetres: values.length ? round(Math.max(...values)) : null });
const residuals = { authoringReferenceToModel: [], modelToCanonical: [], modelToPack: [], geometryRoundTrip: [], canonicalToRouting: [] };
const verifiedAssets = new Map();
for (const reference of [ground.shell, ...ground.tiles.flatMap(t => Object.values(t.layers).filter(Boolean))]) {
  if (verifiedAssets.has(reference.url)) continue;
  const bytes = publicBytes(reference.url);
  check(bytes.length === reference.bytes && sha(bytes) === reference.sha256, `Published protected asset differs: ${reference.url}`);
  verifiedAssets.set(reference.url, bytes.length);
}
check(geometry.horizontalCrs === 'EPSG:3006' && equal(geometry.axisOrder, ['easting', 'northing']), 'Authoring geometry frame differs');
check(['easting', 'northing', 'heightRH2000'].every(k => ground.frame.origin[k] === VISBY_V2_CONFIG.canonicalOrigin[k]), 'Graph and runtime origins differ');
check(ground.frame.origin.easting === VISBY_FRAME.easting && ground.frame.origin.northing === VISBY_FRAME.northing, 'Model and graph projected origins differ');
check(VISBY_V2_CONFIG.bridgeMode === 'epsg3006-local-rh2000', 'Grid-authored course was assigned a legacy WGS84 bridge');
check(migration.source.sha256 === sha(readBytes('visbybuild/course-model.json').toString('utf8').replace(/\r\n/g, '\n')), 'Canonical migration is stale');
check(index.fallbackV1.sha256 === sha(packBytes), 'Published pack hash is stale');
const allReferences = model.holes.flatMap(hole => {
  const authored = geometry.holes.find(h => h.n === hole.n), migrated = canonical.holes.find(h => h.n === hole.n), packed = vectors.holes.find(h => h.n === hole.n);
  const route = routing.holes.find(h => h.number === hole.n);
  check(authored.tees.pads.length === hole.tees.pads.length && packed.tees.pads.length === hole.tees.pads.length,
    `H${hole.n} physical pad count differs across representations`);
  for (let padIndex = 0; padIndex < hole.tees.pads.length; padIndex++) {
    const ring = hole.tees.pads[padIndex].ring;
    check(equal(authored.tees.pads[padIndex].ring.map(local), ring), `H${hole.n} pad ${padIndex} source geometry differs from model`);
    check(equal(packed.tees.pads[padIndex].ring, ring), `H${hole.n} pad ${padIndex} model geometry differs from pack`);
    for (let vertex = 0; vertex < ring.length; vertex++) {
      check(distance(projected(ring[vertex]), migrated.tees.pads[padIndex].ring[vertex]) < 0.001,
        `H${hole.n} pad ${padIndex} canonical vertex ${vertex} differs`);
    }
  }
  check(route.line.length === hole.line.length, `H${hole.n} published route length differs`);
  for (let i = 0; i < hole.line.length; i++) {
    const d = distance(projected(hole.line[i]), route.line[i]);
    residuals.canonicalToRouting.push(d); check(d <= 0.001, `H${hole.n} route vertex ${i} differs from published routing by ${d} m`);
  }
  return card.tees.map((tee, index) => {
    const mark = hole.tees.marks[index];
    const reference = authored.tees.references?.[tee.id];
    const referenceReview = authored.tees.referenceReview?.[tee.id];
    const canonicalMark = migrated.tees.marks[index].c;
    const packedMark = packed.tees.marks[index].c;
    const onPads = hole.tees.pads.flatMap((pad, i) => pointInPoly(...mark.c, pad.ring) ? [i] : []);
    const sourceError = reference ? distance(reference, projected(mark.c)) : null;
    if (reference) residuals.authoringReferenceToModel.push(sourceError);
    residuals.modelToCanonical.push(distance(projected(mark.c), canonicalMark));
    residuals.modelToPack.push(distance(mark.c, packedMark));
    if (reference) residuals.geometryRoundTrip.push(distance(reference, projected(local(reference))));
    check(sourceError === null || sourceError < 1e-7, `H${hole.n} ${tee.id} model differs from source reference`);
    check(distance(projected(mark.c), canonicalMark) < 0.001, `H${hole.n} ${tee.id} canonical coordinate differs`);
    check(distance(mark.c, packedMark) < 1e-9, `H${hole.n} ${tee.id} pack coordinate differs`);
    check(!reference || referenceReview?.status === 'retained-unresolved' || onPads.length > 0,
      `H${hole.n} ${tee.id} resolved reference leaves every platform`);
    return { hole: hole.n, tee: tee.id, referenceDeclared: Boolean(reference), observedPadIndices: onPads,
      reviewStatus: referenceReview?.status ?? (reference ? 'historical-declaration' : 'no-explicit-reference'),
      local: mark.c, projected: projected(mark.c), sourceToModelResidualMetres: sourceError, placement: mark.placement };
  });
});
const sourceReviews = [];
const datedGeometryControls = [];
for (const filename of ['orthophoto-review-2026.json', 'lm-tee-review-front9-2026-09-09.json', 'lm-tee-review-back9-2026-09-09.json']) {
  const file = `visbybuild/mapping/${filename}`;
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const review = read(file), sourcePixelResiduals = [], adoptedReferenceResiduals = [], reviewedPixelReferenceResiduals = [];
  let sourceCount = 0;
  const sources = Object.values(review.sources ?? Object.fromEntries(review.holes.map(h => [h.hole, h.sourceImage])));
  for (const source of sources) {
    if (!source.geoTransform) continue;
    const extent = source.extentEpsg3006 ?? source.boundsEpsg3006;
    const imageSize = source.imageSize ?? [source.width, source.height];
    const s = { ...source, extentEpsg3006: extent, imageSize };
    for (const p of [[0, 0], imageSize, [imageSize[0] / 2, imageSize[1] / 2]]) {
      const g = source.geoTransform;
      const native = [g[0] + p[0] * g[1] + p[1] * g[2], g[3] + p[0] * g[4] + p[1] * g[5]];
      const d = distance(native, facilityPoint({ source: s }, p));
      sourcePixelResiduals.push(d); check(d < 1e-7, `${filename} ${source.id} raster grid differs from authoring conversion`);
    }
    sourceCount++;
  }
  for (const hole of review.holes) {
    const actual = geometry.holes.find(h => h.n === (hole.n ?? hole.hole));
    if (filename === 'orthophoto-review-2026.json' && [3, 9].includes(hole.n)) {
      const entries = [...(hole.green ? [{ feature: 'green', entry: hole.green, ring: actual.green.ring }] : []),
        ...(hole.tees ?? []).map(entry => ({ feature: 'tee', entry, ring: actual.tees.pads.find(p => p.reviewId === entry.id)?.ring }))];
      for (const { feature, entry, ring } of entries) {
        const source = review.sources[entry.sourceKey];
        const expected = entry.ringPixels.map(pixel => facilityPoint({ source }, pixel));
        const matched = ring?.length === expected.length;
        const values = matched ? ring.map((point, i) => distance(point, expected[i])) : [];
        check(matched && Math.max(...values) < 1e-7, `H${hole.n} ${entry.id} native source ring differs from adopted geometry`);
        datedGeometryControls.push({ hole: hole.n, feature, id: entry.id, sourceKey: entry.sourceKey,
          sourceSha256: source.sha256, matchedVertexCount: matched ? ring.length : 0, residuals: statistics(values) });
      }
      if (hole.green?.referencePixels) {
        const source = review.sources[hole.green.sourceKey], expected = facilityPoint({ source }, hole.green.referencePixels);
        check(distance(actual.green.reference, expected) < 1e-7, `H${hole.n} target no longer matches native source reference`);
        if (hole.green.updateRouteTarget) check(distance(actual.line.at(-1), expected) < 1e-7, `H${hole.n} route no longer ends at reviewed source target`);
      }
    }
    for (const ref of hole.numberedReferences ?? hole.references ?? []) {
      const tee = ref.tee.startsWith('tee-') ? ref.tee : `tee-${ref.tee}`;
      const target = ref.targetReferenceProjected ?? (ref.targetReferenceLocal && projected(ref.targetReferenceLocal));
      const adopted = actual.tees.references?.[tee];
      if (adopted && target) adoptedReferenceResiduals.push(distance(adopted, target));
      const source = hole.sourceImage ?? review.sources?.[hole.sourceKey];
      const pixel = ref.targetReferencePixels ?? ref.targetSourcePixel;
      if (source && pixel && target) {
        const s = { ...source, extentEpsg3006: source.extentEpsg3006 ?? source.boundsEpsg3006,
          imageSize: source.imageSize ?? [source.width, source.height] };
        const d = distance(target, facilityPoint({ source: s }, pixel));
        reviewedPixelReferenceResiduals.push(d);
        check(d < 1e-5, `${filename} H${actual.n} ${tee} native pixel target differs from declared projected coordinate`);
      }
    }
  }
  sourceReviews.push({ file, sha256: sha(readBytes(file)), sourceCount,
    nativeRasterToAuthoringGrid: statistics(sourcePixelResiduals), reviewedReferenceToCurrentGeometry: statistics(adoptedReferenceResiduals),
    reviewedNativePixelsToReferenceCoordinates: statistics(reviewedPixelReferenceResiduals),
    interpretation: 'Same source pixels/coordinates checked through distinct code paths; no independent geographic control.' });
}
const frontier = await loadPublishedGraphTerrainFrontier({ graph: { slug: 'visby', groundId: 'visby', ground, summary: { surfaceTiles: 0 } },
  geo: pack.header.GEO, config: VISBY_V2_CONFIG, baseUrl: '/', locationHref: 'https://visby-audit.invalid/',
  fetchImpl: async url => new Response(publicBytes(new URL(url).pathname.replace(/^\//, ''))) });
const heightResiduals = [];
for (const hole of model.holes) {
  for (const mark of hole.tees.marks) check(Number.isFinite(frontier.heightAt(...mark.c)), `H${hole.n} tee has no runtime ground height`);
  const residual = Math.abs(frontier.heightAt(...hole.tees.marks[1].c) - hole.elev.tee);
  heightResiduals.push(residual); check(residual <= 0.061, `H${hole.n} tee59 elevation differs from runtime RH2000 ground`);
}
/* Independent PROJ 9.8.1 / pyproj 3.8.0 inverse projection, always_xy,
 * 2026-09-09. Synthetic grid controls test software, not geographic surveying. */
const gpsControls = [
  { local: [0, 0], wgs84: [18.12847826436399, 57.44236399463288] },
  { local: [-650, -1050], wgs84: [18.118467660619093, 57.45205012630819] },
  { local: [650, -1050], wgs84: [18.1400984521626, 57.451512773274224] },
  { local: [650, 450], wgs84: [18.1389448076941, 57.43805873583014] },
  { local: [-650, 450], wgs84: [18.117321931606615, 57.43859581227263] },
].map(control => ({ ...control, measuredLocal: gpsToLocal({ longitude: control.wgs84[0], latitude: control.wgs84[1] }, pack.header.GEO) }));
const gpsResiduals = gpsControls.map(control => distance(control.local, control.measuredLocal));
check(Math.max(...gpsResiduals) < 0.01, `GPS input does not use the course projected frame (maximum software control error ${Math.max(...gpsResiduals)} m)`);
const withoutReference = allReferences.filter(r => !r.referenceDeclared || r.reviewStatus === 'retained-unresolved')
  .map(({ hole, tee, referenceDeclared, reviewStatus, placement }) => ({ hole, tee, referenceDeclared, reviewStatus, placement }));
if (withoutReference.length) limitations.push(`${withoutReference.length} camera positions have unresolved numbered-platform identity or no explicit numeric reference; see unresolvedReferences.`);
limitations.push('No independent surveyed horizontal control anchors are available. Numeric round trips and native pixel spacing do not establish absolute positional accuracy.');
limitations.push('Numbered points are representative navigation references on source-observed turf; daily tee marker positions are unverified.');
const currentProtected = protectedState();
let baselineComparison = null;
if (fs.existsSync(path.join(ROOT, BASELINE))) {
  const baseline = read(BASELINE);
  const changedProtectedFields = Object.keys(currentProtected).filter(key => !equal(currentProtected[key], baseline.protected[key]));
  const movedReferences = allReferences.flatMap(reference => {
    const h = baseline.holes.find(h => h.n === reference.hole), index = card.tees.findIndex(t => t.id === reference.tee);
    const d = distance(h.tees.marks[index].c, reference.local);
    return d > 1e-7 ? [{ hole: reference.hole, tee: reference.tee, displacementMetres: round(d) }] : [];
  });
  baselineComparison = { baselinePath: BASELINE, baselineModelSha256: baseline.modelSha256,
    baselineCapturedAt: baseline.capturedAt, changedProtectedFields, movedReferences,
    protectedHashes: Object.fromEntries(Object.entries(currentProtected).map(([k, v]) => [k, jsonSha(v)])) };
  changedProtectedFields.forEach(key => check(false, `Protected baseline field changed: ${key}`));
}
const report = { schemaVersion: 1, groundId: 'visby', kind: 'source-to-runtime-tee-coordinate-audit', auditedAt: new Date().toISOString(),
  status: failures.length ? 'failed' : 'numeric-coordinate-chain-verified; absolute-survey-control-pending',
  artifacts: { modelSha256: sha(readBytes('visbybuild/course-model.json')), geometrySha256: sha(readBytes('visbybuild/mapping/geometry.json')),
    migrationSha256: sha(readBytes('geo_data/course-v2/visby/migration/course-model.epsg3006.json')), packSha256: sha(packBytes), course: index.manifest, ground: course.groundManifest },
  frame: { horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', compoundCrs: 'EPSG:5845', origin: ground.frame.origin,
    conversion: 'x=E-687748.5; z=6370951.5-N; bridge restores source RH2000 height; no horizontal affine correction',
    bridgeMode: VISBY_V2_CONFIG.bridgeMode },
  municipalPixelConvention: { fullImage: 'E=686900.25+0.5*u; N=6372149.75-0.5*v (pixel centres)',
    croppedReviews: 'E=xmin+u*spacing; N=ymax-v*spacing (pixel edges)',
    accidentalHalfPixelShiftMetresAt0p5m: Math.SQRT2 * 0.25,
    interpretation: 'Distinct declared conventions; never add a further half pixel to native pixel-edge review coordinates.' },
  summary: { holes: model.holes.length, cameraReferences: allReferences.length, declaredReferences: allReferences.filter(r => r.referenceDeclared).length,
    sourceCorroboratedReferences: allReferences.filter(r => r.reviewStatus === 'source-corroborated').length,
    retainedUnresolvedReferences: allReferences.filter(r => r.reviewStatus === 'retained-unresolved').length,
    referencesOnObservedPads: allReferences.filter(r => r.observedPadIndices.length).length, physicalPlatforms: model.holes.reduce((s, h) => s + h.tees.pads.length, 0),
    coordinateResiduals: Object.fromEntries(Object.entries(residuals).map(([key, values]) => [key, statistics(values)])),
    runtimeTerrain: { ready: frontier.ready, resources: frontier.resources.length, tee59HeightResiduals: statistics(heightResiduals) },
    gpsInput: { controlSource: 'Synthetic EPSG:3006 grid points inverted with PROJ 9.8.1 / pyproj 3.8.0; not surveyed controls',
      controls: gpsControls, residuals: statistics(gpsResiduals) } },
  sourceReviews, datedGeometryControls, baselineComparison, unresolvedReferences: withoutReference, references: allReferences, failures, limitations };
report.summary.verifiedProtectedAssets = { count: verifiedAssets.size, bytes: [...verifiedAssets.values()].reduce((sum, n) => sum + n, 0) };
if (args.includes('--write')) fs.writeFileSync(path.join(ROOT, OUTPUT), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, summary: report.summary, sourceReviews, baselineComparison: baselineComparison && { changedProtectedFields: baselineComparison.changedProtectedFields, movedReferences: baselineComparison.movedReferences }, failures }, null, 2));
if (failures.length) process.exitCode = 1;
