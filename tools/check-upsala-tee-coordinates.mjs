#!/usr/bin/env node
/** Read-only source-to-consumer contract for Upsala tee coordinates.
 * node tools/check-upsala-tee-coordinates.mjs [--out report.json]
 * Additional ordered reviews: --stora-review file.json --mellan-review file.json
 * Override configured site reviews: --stora-site-review file.json --mellan-site-review file.json
 * Optional current-page proof: --standalone-browser-report report.json
 * No downloads, source edits, inferred associations or generation side effects.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyUpsalaLmTeeReferences } from './apply-upsala-lm-tee-references.mjs';
import { applyUpsalaReviewedTeeSites } from './apply-upsala-reviewed-tee-sites.mjs';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { verifyChunkAsset } from '../packages/course-v2/chunk-node.mjs';
import { latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { UPSALA_V2_CONFIGS } from '../apps/golf/src/engine/v2-upsala-config.mjs';
import { teeView } from '../apps/golf/src/engine/tee-view.mjs';
import { gpsToLocal } from '../apps/golf/src/engine/caddie.js';
import { compassBearing, windAlong, playsLike, greenDistances, lineHazards, layupTargets } from '../apps/golf/src/engine/rangefinder.js';
import { alongLine, clampf, polyLen } from '../apps/golf/src/engine/geom.js';
import { centroid, pointInPoly, ptSegD } from '../upsalabuild/lib.mjs';
import { withInferredTeePads } from '../apps/golf/src/engine/tee-pads.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = n => Number(n.toFixed(9));
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const localFrame = m => ({ origin: m.origin, mPerLat: m.mPerLat, mPerLon: m.mPerLon });
const toWgs = (m, [x, z]) => [m.origin.lon + x / m.mPerLon, m.origin.lat - z / m.mPerLat];
const toGrid = (m, p) => { const [lon, lat] = toWgs(m, p); return latLonToSweref99Tm(lat, lon); };
const teeShape = h => ({ n: h.n, t: h.t, line: h.line, inferPads: h.tees.inferPads,
  pads: h.tees.pads.map(p => ({ ring: p.ring, preserveTerrain: p.preserveTerrain })),
  marks: h.tees.marks.map(m => ({ c: m.c, b: m.b, m: m.m })) });
const courseDefinitions = [
  { slug: 'upsala', course: 'stora', build: 'upsalabuild', reviewParts: ['front9', 'back9'], migration: 'course-model.epsg3006.json' },
  { slug: 'upsala-mellanbanan', course: 'mellan', build: 'upsalamellanbuild', reviewParts: ['mellan'], migration: 'mellanbanan-course-model.epsg3006.json' },
];

/** Independently reconstruct the source pixel/grid/local chain. Evidence
 * footprints support navigation points; they are never assumed to be pads. */
export function checkUpsalaSiteEvidence({ model, review, record, decision, publishedSources = {} }) {
  const label = `${review.course} H${record.hole} reference ${decision.markIndex}`;
  const support = decision.supportEvidence, position = decision.positionEvidence;
  assert(support && position, `${label}: site support and position evidence required`);
  const panel = support.panel;
  assert(panel && panel.hole === record.hole, `${label}: source panel hole identity differs`);
  assert.deepEqual(panel.frame, localFrame(model), `${label}: source panel frame differs`);
  const gt = panel.geoTransform, size = panel.pixelSize;
  assert(Array.isArray(gt) && gt.length === 6 && gt.every(Number.isFinite), `${label}: finite source pixel transform required`);
  assert(finitePoint(size) && size.every(v => v > 0), `${label}: source panel dimensions required`);
  const determinant = gt[1] * gt[5] - gt[2] * gt[4];
  assert(Math.abs(determinant) > 1e-12, `${label}: singular source pixel transform`);
  const native = panel.source;
  assert(native && typeof native.path === 'string' && /^[a-f0-9]{64}$/.test(native.sha256), `${label}: native source identity and checksum required`);
  assert(Array.isArray(review.sources) && decision.sourceIds.every(id => review.sources.some(s => s.id === id)), `${label}: unresolved site source identity`);
  const nativeSource = review.sources.find(s => s.path === native.path && s.sha256 === native.sha256);
  assert(nativeSource, `${label}: panel native source differs from review source`);
  assert(decision.sourceIds.includes(nativeSource.id), `${label}: native panel source is not cited by this decision`);
  if (nativeSource.geoTransform) assert.deepEqual(native.geoTransform, nativeSource.geoTransform, `${label}: native raster transform differs from source registry`);
  if (panel.extentEPSG3006) {
    const corners = [[0, 0], [size[0], 0], [0, size[1]], size].map(([x, y]) => [gt[0] + x * gt[1] + y * gt[2], gt[3] + x * gt[4] + y * gt[5]]);
    const bounds = [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))];
    assert(bounds.every((v, i) => Math.abs(v - panel.extentEPSG3006[i]) < 0.00001), `${label}: panel extent differs from pixel transform`);
  }
  assert.deepEqual(support.localRing, decision.supportRing, `${label}: local support evidence differs from accepted footprint`);
  assert(Array.isArray(support.pixelRing) && Array.isArray(support.epsg3006Ring)
    && support.pixelRing.length === decision.supportRing.length && support.epsg3006Ring.length === decision.supportRing.length,
  `${label}: source support vertex counts differ`);
  let maximumProjectionErrorMetres = 0, maximumPixelRoundtripErrorMetres = 0;
  function inspect(pixel, projected, local, suffix) {
    assert(finitePoint(pixel) && finitePoint(projected) && finitePoint(local), `${label}: finite ${suffix} source coordinates required`);
    assert(pixel[0] >= 0 && pixel[0] <= size[0] && pixel[1] >= 0 && pixel[1] <= size[1], `${label}: ${suffix} is outside source panel`);
    const calculated = [gt[0] + pixel[0] * gt[1] + pixel[1] * gt[2], gt[3] + pixel[0] * gt[4] + pixel[1] * gt[5]];
    const pixelError = distance(calculated, projected);
    assert(pixelError < 0.00001, `${label}: ${suffix} pixel-to-EPSG transform mismatch`);
    const projectionError = distance(toGrid(model, local), projected);
    assert(projectionError < 0.005, `${label}: ${suffix} EPSG-to-local source mismatch`);
    const [east, north] = toGrid(model, local), de = east - gt[0], dn = north - gt[3];
    const returnedPixel = [(de * gt[5] - dn * gt[2]) / determinant, (dn * gt[1] - de * gt[4]) / determinant];
    const dx = returnedPixel[0] - pixel[0], dy = returnedPixel[1] - pixel[1];
    const roundtripError = Math.hypot(dx * gt[1] + dy * gt[2], dx * gt[4] + dy * gt[5]);
    assert(roundtripError < 0.005, `${label}: ${suffix} source pixel roundtrip mismatch`);
    maximumProjectionErrorMetres = Math.max(maximumProjectionErrorMetres, projectionError);
    maximumPixelRoundtripErrorMetres = Math.max(maximumPixelRoundtripErrorMetres, roundtripError);
  }
  support.pixelRing.forEach((p, i) => inspect(p, support.epsg3006Ring[i], decision.supportRing[i], `support vertex ${i}`));
  inspect(position.pixel, position.epsg3006, decision.reviewedPosition, 'reviewed point');
  assert(finitePoint(position.wgs84LongitudeLatitude), `${label}: source WGS84 point required`);
  const wgs = toWgs(model, decision.reviewedPosition);
  const wgsError = Math.hypot((wgs[0] - position.wgs84LongitudeLatitude[0]) * model.mPerLon,
    (wgs[1] - position.wgs84LongitudeLatitude[1]) * model.mPerLat);
  assert(wgsError < 0.002, `${label}: source WGS84 coordinate order or point differs`);
  assert(pointInPoly(...decision.reviewedPosition, decision.supportRing), `${label}: reviewed site point lies outside evidence support`);
  const clearance = Math.min(...decision.supportRing.map((a, i, ring) => ptSegD(...decision.reviewedPosition, ...a, ...ring[(i + 1) % ring.length])));
  assert(clearance >= 1, `${label}: reviewed site lacks 1 m evidence clearance`);
  assert(Number.isFinite(position.minimumSupportClearanceMetres) && position.minimumSupportClearanceMetres >= 1
    && position.minimumSupportClearanceMetres <= clearance + 0.002,
    `${label}: reported support clearance differs`);
  let publishedPointVerifiedAgainstCachedSource = false;
  if (position.publishedFeaturePath !== undefined) {
    const pointer = position.publishedFeaturePath.match(/^props\.profile\.club\.holes\[(\d+)\]\.teeGeoPoints\[(\d+)\]$/);
    assert(pointer && Number(pointer[1]) === record.hole - 1 && Number(pointer[2]) === position.publishedTeeIndex,
      `${label}: published site point identity differs`);
    const publishedLocal = position.publishedSourceLocal, publishedWgs = position.publishedSourceWgs84LongitudeLatitude;
    assert(finitePoint(publishedLocal) && finitePoint(publishedWgs) && finitePoint(position.publishedSourceEpsg3006), `${label}: published site coordinates required`);
    const wanted = toWgs(model, publishedLocal);
    assert(Math.hypot((wanted[0] - publishedWgs[0]) * model.mPerLon, (wanted[1] - publishedWgs[1]) * model.mPerLat) < 0.002,
      `${label}: published site WGS84-to-local mismatch`);
    assert(distance(toGrid(model, publishedLocal), position.publishedSourceEpsg3006) < 0.005,
      `${label}: published site EPSG-to-local mismatch`);
    const offset = distance(decision.reviewedPosition, publishedLocal);
    assert(Number.isFinite(position.offsetFromPublishedMetres) && Math.abs(offset - position.offsetFromPublishedMetres) < 0.002,
      `${label}: published site offset differs`);
    if (decision.coordinateBasis?.startsWith('published-coordinate')) assert(offset < 0.002, `${label}: published coordinate was moved without an approximate coordinate basis`);
    for (const sourceId of decision.sourceIds) {
      const source = publishedSources[sourceId];
      if (!source) continue;
      const sourcePoint = source.profile.club.holes[Number(pointer[1])]?.teeGeoPoints?.[Number(pointer[2])];
      assert(sourcePoint, `${label}: published cached point is missing`);
      assert.deepEqual([sourcePoint.longitude, sourcePoint.latitude], publishedWgs, `${label}: published site point differs from hashed source`);
      assert.equal(source.profile.club.tees[Number(pointer[2])]?.name, position.publishedTeeName, `${label}: published tee identity differs`);
      const sourceYards = source.profile.club.holes[Number(pointer[1])].teeYardages[Number(pointer[2])];
      assert(Number.isFinite(sourceYards) && Math.round(sourceYards * 0.9144) === record.originalDistances[decision.markIndex],
        `${label}: published tee scorecard association differs`);
      publishedPointVerifiedAgainstCachedSource = true;
    }
  }
  return { supportVertices: support.pixelRing.length, clearanceMetres: clearance, maximumProjectionErrorMetres,
    maximumPixelRoundtripErrorMetres, sourcePath: native.path, sourceSha256: native.sha256, publishedPointVerifiedAgainstCachedSource };
}

/** Parse the actual standalone camera implementation and execute it with only
 * rendering/DOM effects stubbed. A reintroduced camera setback fails the same
 * gate as an incorrect coordinate in a pack. Repository source is trusted. */
export function standaloneTeeCamera(source, holes, holeNumber, markIndex) {
  const helperStart = source.indexOf('function teeView(hole, mark) {');
  const start = source.indexOf('function setCam(mode, instant) {');
  const end = source.indexOf('function goHole(', start);
  assert(start >= 0 && end > start, 'standalone camera implementation missing');
  const helper = helperStart >= 0 && helperStart < start ? source.slice(helperStart, start) : '';
  const evaluate = new Function('HOLES', 'hole', 'teeIdx', 'alongLine', 'clampf', 'polyLen', 'teeView', `
    let camMode, result, heldFlightLens = false;
    const RMOTION = false, syncURL = () => {}, terrainH = () => 0;
    const window = {}, GROUND_CLAMP = { eye: 2.4 };
    const document = { querySelectorAll: () => [] };
    const V3 = (x, y, z) => ({ x, y, z });
    const flyTo = (position, aim) => { result = { position, aim }; };
    ${helper}\n${source.slice(start, end)}
    setCam('tee', true); return result;
  `);
  return evaluate(holes, holeNumber, markIndex, alongLine, clampf, polyLen, teeView);
}

function rangefinderOrigin(source, holes, holeNumber, markIndex, standalone) {
  const name = standalone ? 'function kikMeasure(clientX, clientY) {' : 'function kikCompute(origin = null, target = null) {';
  const start = source.indexOf(name);
  const end = source.indexOf(standalone ? '  const dist = ' : 'function kikClubAdvice(', start);
  assert(start >= 0 && end > start, 'rangefinder implementation missing');
  const implementation = source.slice(start, end) + (standalone ? 'return [ox, oz];\n}' : '');
  const evaluate = new Function('HOLES', 'hole', 'teeIdx', 'compassBearing', 'windAlong', 'playsLike', 'greenDistances', 'lineHazards', 'layupTargets', `
    const gpsState = { active: false }, kikBall = null, kikWx = null, kikPt = null, TEE_NAMES = [];
    const terrainH = () => 0, kikKindAt = () => 'rough', kikLie = () => 'rough';
    const groundHit = () => [1, 1], kikClear = () => {};
    ${implementation}
    return ${standalone ? 'kikMeasure(0, 0)' : 'kikCompute().origin'};
  `);
  return evaluate(holes, holeNumber, markIndex, compassBearing, windAlong, playsLike, greenDistances, lineHazards, layupTargets);
}

export function loadUpsalaTeeSnapshot({ root = ROOT, extraReviews = {}, siteReviews: siteReviewOverrides = {} } = {}) {
  const files = new Map();
  const read = relative => {
    const bytes = fs.readFileSync(path.join(root, relative));
    files.set(relative, { path: relative, bytes: bytes.length, sha256: sha(bytes) });
    return bytes;
  };
  const json = p => JSON.parse(read(p));
  const reference = ref => {
    const url = ref.url ?? ref.packUrl;
    assert(typeof url === 'string' && !path.isAbsolute(url) && !url.includes('..') && !url.includes('\\'), 'unsafe published reference');
    const bytes = read(`apps/golf/public/${url}`);
    assert.equal(bytes.length, ref.bytes, `${url}: stale reference length`);
    assert.equal(sha(bytes), ref.sha256, `${url}: stale reference hash`);
    return bytes;
  };
  const index = json('apps/golf/public/courses/v2-index.json');
  const packIndex = json('apps/golf/public/courses/index.json');
  const standaloneSource = read('upsala3d.html').toString('utf8');
  const appSource = read('apps/golf/src/main.js').toString('utf8');
  const landingMapSource = read('apps/golf/src/shell/map.js').toString('utf8');
  const storaBuilder = read('upsalabuild/ground-mapping.mjs').toString('utf8');
  const mellanBuilder = json('upsalabuild/mellanbanan.json');
  const configuredSiteReviews = {
    stora: storaBuilder.includes("read('lm-tee-site-review-stora-2026-09-09.json')")
      ? ['upsalabuild/mapping/lm-tee-site-review-stora-2026-09-09.json'] : [],
    mellan: mellanBuilder.reviewedTeeSites ? [mellanBuilder.reviewedTeeSites].flat() : [],
  };
  const vectorMatch = standaloneSource.match(/const VEC64 = '([^']+)'/);
  assert(vectorMatch, 'standalone embedded vectors missing');
  const standalone = JSON.parse(inflateRawSync(Buffer.from(vectorMatch[1], 'base64')));
  const standaloneGeo = JSON.parse(standaloneSource.match(/const GEO = (\{[^\n]+\});/)[1]);
  const courses = courseDefinitions.map(def => {
    const modelPath = `${def.build}/course-model.json`, modelBytes = read(modelPath);
    const model = JSON.parse(modelBytes);
    const reviewPaths = [...def.reviewParts.map(p => `upsalabuild/mapping/lm-tee-review-${p}-2026-09-09.json`),
      `upsalabuild/mapping/lm-tee-followup-${def.course}-2026-09-09.json`, ...(extraReviews[def.course] || [])];
    const reviews = reviewPaths.map(json);
    const siteReviewPaths = siteReviewOverrides[def.course] ?? configuredSiteReviews[def.course];
    const siteReviews = siteReviewPaths.map(json), siteSourceAssets = [], sitePublishedSources = {};
    const assets = new Map();
    for (const review of siteReviews) {
      for (const source of review.sources || []) {
        for (const sourcePath of [source.path, source.extractedProfilePath].filter(Boolean)) {
          assert(typeof sourcePath === 'string' && !path.isAbsolute(sourcePath) && !sourcePath.includes('..') && !sourcePath.includes('\\'), 'unsafe site evidence path');
        }
        if (source.path && source.sha256) assets.set(source.path, source.sha256);
        if (source.extractedProfilePath) {
          assets.set(source.extractedProfilePath, source.extractedProfileSha256);
          if (fs.existsSync(path.join(root, source.extractedProfilePath))) sitePublishedSources[source.id] = json(source.extractedProfilePath);
          if (sitePublishedSources[source.id] && fs.existsSync(path.join(root, source.path))) {
            const html = read(source.path).toString('utf8');
            const payload = html.match(/<astro-island\b[^>]*\bcomponent-export="Course"[^>]*\bprops="([^"]*)"/);
            assert(payload, 'published site Course component missing from source HTML');
            const decoded = payload[1].replace(/&(quot|amp|lt|gt|#39);/g, (_, entity) => ({ quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'" })[entity]);
            const restore = value => {
              if (!Array.isArray(value)) return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v)])) : value;
              assert(value[0] === 0 || value[0] === 1, 'unsupported published source serialization');
              return value[0] === 1 ? value[1].map(restore) : restore(value[1]);
            };
            assert.deepEqual(restore(JSON.parse(decoded)), sitePublishedSources[source.id], 'extracted published site profile differs from primary HTML');
          }
        }
      }
      for (const record of review.holes) for (const decision of record.decisions) {
        const panel = decision.supportEvidence?.panel;
        if (panel?.plainPath && panel?.plainSha256) assets.set(panel.plainPath, panel.plainSha256);
        if (panel?.source?.path) {
          assert.equal(assets.get(panel.source.path), panel.source.sha256, 'site panel native source checksum differs from source registry');
        }
      }
    }
    for (const [sourcePath, checksum] of assets) {
      assert(typeof sourcePath === 'string' && !path.isAbsolute(sourcePath) && !sourcePath.includes('..') && !sourcePath.includes('\\'), 'unsafe site evidence path');
      assert(/^[a-f0-9]{64}$/.test(checksum), 'site evidence checksum required');
      const cached = fs.existsSync(path.join(root, sourcePath));
      if (cached) assert.equal(sha(read(sourcePath)), checksum, `site source checksum mismatch: ${sourcePath}`);
      siteSourceAssets.push({ path: sourcePath, sha256: checksum, cachedBytesVerified: cached });
    }
    const positionSources = {};
    for (const review of reviews) for (const record of review.holes) for (const decision of record.referenceDecisions) {
      const source = decision.positionSource;
      if (!source) continue;
      assert(typeof source.sourcePath === 'string' && !path.isAbsolute(source.sourcePath) && !source.sourcePath.includes('..'), 'unsafe tee point source path');
      const bytes = read(source.sourcePath);
      assert.equal(sha(bytes), source.sourceSha256, 'published tee point source checksum mismatch');
      positionSources[source.sourcePath] = JSON.parse(bytes);
    }
    const pack = readPack(read(`apps/golf/public/courses/${def.slug}/pack.bin`));
    const packed = JSON.parse(inflateStream(pack.sv));
    const migration = json(`geo_data/course-v2/upsala/migration/${def.migration}`);
    const entry = index.courses.find(c => c.slug === def.slug);
    assert(entry, `${def.slug}: v2 index entry missing`);
    const published = JSON.parse(reference(entry.manifest));
    assert.equal(published.slug, def.slug);
    assert.deepEqual(published.fallbackV1, entry.fallbackV1);
    reference(published.fallbackV1);
    const livePack = packIndex.courses.find(c => c.slug === def.slug);
    assert.equal(livePack.sha256, published.fallbackV1.sha256, 'v1/v2 index pack identity differs');
    const routing = verifyChunkAsset(published.routing, reference(published.routing)).content;
    const ground = JSON.parse(reference(published.groundManifest));
    return { ...def, model, reviews, reviewPaths, positionSources, siteReviews, siteReviewPaths, siteSourceAssets, sitePublishedSources,
      packGeo: pack.header.GEO, packed, migration,
      normalizedModelSha256: sha(modelBytes.toString('utf8').replace(/\r\n/g, '\n')),
      published, routing, ground, config: structuredClone(UPSALA_V2_CONFIGS[def.slug]) };
  });
  const geojson = json('upsalabuild/mapping/ground-map.geojson');
  return { courses, geojson, standalone, standaloneGeo, standaloneSource, appSource, landingMapSource, files: [...files.values()] };
}

/** Verify source association, compiler result and independent CRS arithmetic.
 * Reviews are ordered: a follow-up must start from the prior accepted state.
 * Unresolved references remain explicitly unresolved rather than being snapped.
 */
export function checkUpsalaTeeSnapshot(snapshot) {
  const { geojson } = snapshot;
  const landingMatch = snapshot.landingMapSource.match(/\bupsala:\s*\{\s*(?:\/\/[^\n]*\n\s*)*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+)/);
  assert(landingMatch, 'Upsala landing-page map location is missing');
  const stora = snapshot.courses.find(c => c.slug === 'upsala').model;
  const clubhouse = stora.infra.buildings.find(b => b.id === 'w221193965');
  assert(clubhouse?.name === 'Upsala golfklubb', 'named clubhouse source identity changed');
  const landingWgs84 = [Number(landingMatch[2]), Number(landingMatch[1])];
  const landingLocal = gpsToLocal({ longitude: landingWgs84[0], latitude: landingWgs84[1] }, { origin: stora.origin, mPerLon: stora.mPerLon });
  assert(pointInPoly(...landingLocal, clubhouse.ring), 'landing-page map marker lies outside the sourced Upsala clubhouse');
  const landingCentroidDistance = distance(landingLocal, centroid(clubhouse.ring));
  assert(landingCentroidDistance < 0.01, 'landing-page map marker differs from the sourced clubhouse centroid');
  const sharedPads = new Map(snapshot.courses.flatMap(c => c.model.holes.flatMap(h => h.tees.pads.map((p, i) =>
    [JSON.stringify(p.ring), `${c.slug} H${h.n} pad ${i}`]))));
  assert.equal(geojson.metadata.coordinateOrder, 'longitude, latitude', 'GeoJSON coordinate order');
  assert.equal(geojson.metadata.coordinateReferenceSystem, 'OGC:CRS84', 'GeoJSON coordinate reference system');
  const occurrences = new Map();
  for (const feature of geojson.features) for (const occurrence of feature.properties.occurrences || []) {
    const key = `${occurrence.build}:${occurrence.path}`;
    assert(!occurrences.has(key), `duplicate geographic occurrence ${key}`);
    occurrences.set(key, feature);
  }
  const results = [];
  for (const course of snapshot.courses) {
    const { model, reviews, packed, migration, config, slug, build } = course;
    const expected = structuredClone(model), reset = new Set(), finalDecisions = new Map();
    for (const review of reviews) for (const record of review.holes) {
      if (!reset.has(record.hole)) {
        const hole = expected.holes.find(h => h.n === record.hole);
        hole.tees.marks = structuredClone(record.originalMarks);
        hole.line = structuredClone(record.originalLine);
        reset.add(record.hole);
      }
      const previous = finalDecisions.get(record.hole);
      finalDecisions.set(record.hole, { ...record, referenceDecisions: record.referenceDecisions.map(decision => {
        const prior = previous?.referenceDecisions.find(d => d.markIndex === decision.markIndex);
        // Retaining an earlier accepted association does not make it unresolved.
        return decision.status === 'retain' && prior?.status === 'align-to-observed-pad' ? prior : decision;
      }) });
    }
    assert.equal(reset.size, model.holes.length, `${slug}: incomplete reference review`);
    for (const review of reviews) applyUpsalaLmTeeReferences(expected, review);
    const finalSiteDecisions = new Map(), siteMetadataReset = new Set();
    for (const review of course.siteReviews || []) {
      for (const record of review.holes) {
        const hole = expected.holes[record.hole - 1];
        assert(hole && hole.n === record.hole, `${slug}: site review hole identity changed`);
        // The current model already carries final metadata. Reconstruct the
        // pre-site metadata only after checking its complete point/pad lineage.
        assert.deepEqual(hole.tees.marks, record.originalTees.marks, `${slug}: site review reference lineage changed`);
        assert.deepEqual(hole.tees.pads, record.originalTees.pads, `${slug}: site review physical platform identity changed`);
        if (!siteMetadataReset.has(record.hole)) {
          hole.tees = structuredClone(record.originalTees);
          siteMetadataReset.add(record.hole);
        }
        for (const decision of record.decisions) finalSiteDecisions.set(`${record.hole}:${decision.markIndex}`, { review, record, decision });
      }
      applyUpsalaReviewedTeeSites(expected, review);
    }
    assert.deepEqual(model.holes.map(h => h.tees.marks), expected.holes.map(h => h.tees.marks), `${slug}: current references differ from accepted source decisions`);
    assert.deepEqual(model.holes.map(h => h.line), expected.holes.map(h => h.line), `${slug}: current routes differ from accepted source decisions`);
    assert.deepEqual(localFrame(model), { origin: { lat: config.legacyFrame.latitude, lon: config.legacyFrame.longitude },
      mPerLat: config.legacyFrame.metresPerLatitude, mPerLon: config.legacyFrame.metresPerLongitude }, `${slug}: runtime frame mismatch`);
    assert.deepEqual(course.packGeo.origin, model.origin, `${slug}: packed origin`);
    assert.equal(course.packGeo.mPerLon, model.mPerLon, `${slug}: packed longitude scale`);
    assert.equal(model.frame, config.packFrame, `${slug}: model axis declaration`);
    assert.equal(course.packGeo.frame, config.packFrame, `${slug}: packed axis declaration`);
    assert.deepEqual(packed.holes.map(teeShape), model.holes.map(teeShape), `${slug}: stale packed tee geometry`);
    assert.deepEqual(withInferredTeePads(packed.holes).map(h => h.tees.pads), packed.holes.map(h => h.tees.pads), `${slug}: synthetic pads were introduced`);
    const renderedRings = buildGroundSurfaceFeatures({ holes: packed.holes, model: packed })
      .filter(f => f.surface === SURFACE.TEE).flatMap(f => f.rings || []).map(r => JSON.stringify(r));
    for (const [ring, label] of sharedPads) {
      assert.equal(renderedRings.filter(r => r === ring).length, 1, `${slug}: shared tee surface missing or duplicated: ${label}`);
    }
    for (const { decision } of finalSiteDecisions.values()) {
      assert(!renderedRings.includes(JSON.stringify(decision.supportRing)), `${slug}: evidence-only support footprint was emitted as a physical tee`);
    }
    assert.equal(migration.source.sha256, course.normalizedModelSha256, `${slug}: stale canonical migration`);
    assert.equal(migration.target.horizontalCrs, 'EPSG:3006');
    assert.deepEqual(migration.target.coordinateOrder, ['easting', 'northing']);
    assert.deepEqual(course.ground.frame.origin, config.canonicalOrigin, `${slug}: published ground origin`);
    assert.equal(course.ground.frame.fingerprint, config.frameFingerprint, `${slug}: published ground frame`);
    const sourceMeta = geojson.metadata.modelSources.find(s => s.build === build);
    assert(sourceMeta && sourceMeta.sha256 === snapshot.files.find(f => f.path === `${build}/course-model.json`).sha256, `${slug}: stale geographic export source`);
    let references = 0, assigned = 0, retained = 0, routeVertices = 0, teeVertices = 0, sourcePoints = 0;
    let siteReviewed = 0, siteSupportVertices = 0, minSiteClearance = Infinity, maxSiteProjection = 0, maxSitePixelRoundtrip = 0;
    const siteClasses = { tee: 0, fairway: 0 };
    const siteReferences = [];
    let maxMigration = 0, maxGeographic = 0, maxBridge = 0, maxGps = 0, minClearance = Infinity;
    const bridge = legacyGridBridge(config.legacyFrame);
    function checkProjection(local, projected, label) {
      const error = distance(toGrid(model, local), projected);
      assert(error < 0.005, `${slug}: ${label} EPSG:3006 mismatch ${error} m`);
      maxMigration = Math.max(maxMigration, error);
    }
    function geographic(local, lonLat, label) {
      const wanted = toWgs(model, local);
      const error = Math.hypot((wanted[0] - lonLat[0]) * model.mPerLon, (wanted[1] - lonLat[1]) * model.mPerLat);
      assert(error < 0.0002, `${slug}: ${label} longitude/latitude mismatch ${error} m`);
      maxGeographic = Math.max(maxGeographic, error);
    }
    for (const [hi, hole] of model.holes.entries()) {
      const migrated = migration.geometry.holes[hi], published = course.routing.holes[hi];
      assert.equal(migrated.n, hole.n);
      assert.equal(published.number, hole.n);
      assert.equal(published.line.length, hole.line.length);
      for (const [pi, point] of hole.line.entries()) {
        checkProjection(point, migrated.line[pi], `H${hole.n} route ${pi}`);
        assert.deepEqual(published.line[pi].slice(0, 2), migrated.line[pi].slice(0, 2), `${slug}: stale published routing`);
        routeVertices++;
      }
      const record = finalDecisions.get(hole.n);
      for (const decision of record.referenceDecisions) {
        const mi = decision.markIndex, mark = hole.tees.marks[mi]; references++;
        const label = `H${hole.n} reference ${mi}`;
        assert.deepEqual(teeView(hole, mark).position, mark.c, `${slug}: app camera offset`);
        const appCamera = standaloneTeeCamera(snapshot.appSource, packed.holes, hole.n, mi);
        assert.deepEqual([appCamera.position.x, appCamera.position.z], mark.c, `${slug}: actual app camera branch offsets the selected reference`);
        assert.deepEqual(rangefinderOrigin(snapshot.appSource, packed.holes, hole.n, mi, false), mark.c, `${slug}: app rangefinder origin differs from selected tee`);
        const [longitude, latitude] = toWgs(model, mark.c);
        const gpsError = distance(gpsToLocal({ longitude, latitude }, course.packGeo), mark.c);
        assert(gpsError < 0.000001, `${slug}: GPS conversion does not recover local tee coordinates`);
        maxGps = Math.max(maxGps, gpsError);
        checkProjection(mark.c, migrated.tees.marks[mi].c, label);
        const feature = occurrences.get(`${build}:holes[${hi}].tees.marks[${mi}]`);
        assert.equal(feature?.geometry.type, 'Point', `${slug}: missing geographic ${label}`);
        geographic(mark.c, feature.geometry.coordinates, label);
        const [gx, gz] = bridge.toGrid(...mark.c);
        const runtime = [config.legacyOriginEpsg3006.easting + gx, config.legacyOriginEpsg3006.northing - gz];
        const bridgeError = distance(runtime, toGrid(model, mark.c));
        assert(bridgeError < 0.25, `${slug}: runtime world bridge mismatch ${bridgeError} m`);
        maxBridge = Math.max(maxBridge, bridgeError);
        const site = finalSiteDecisions.get(`${hole.n}:${mi}`);
        if (site) {
          const evidence = checkUpsalaSiteEvidence({ model, ...site, publishedSources: course.sitePublishedSources });
          assert.deepEqual(mark.c, site.decision.reviewedPosition, `${slug}: accepted site point differs`);
          assert.equal(mark.referencePlacement.method, 'reviewed-visible-site-navigation-reference', `${slug}: site point lacks compact provenance`);
          assert.equal(mark.referencePlacement.siteClass, site.decision.siteClass, `${slug}: site class differs`);
          for (const key of ['supportFootprintIsPhysicalBoundary', 'physicalPadBoundaryVerified', 'dailyMarkerPositionVerified', 'teeColourAssociationVerified']) {
            assert.equal(mark.referencePlacement[key], false, `${slug}: site evidence was promoted into a surveyed boundary or marker`);
          }
          siteReviewed++; siteClasses[site.decision.siteClass]++;
          siteSupportVertices += evidence.supportVertices;
          minSiteClearance = Math.min(minSiteClearance, evidence.clearanceMetres);
          maxSiteProjection = Math.max(maxSiteProjection, evidence.maximumProjectionErrorMetres);
          maxSitePixelRoundtrip = Math.max(maxSitePixelRoundtrip, evidence.maximumPixelRoundtripErrorMetres);
          siteReferences.push({ hole: hole.n, markIndex: mi, siteClass: site.decision.siteClass, referenceXZ: mark.c,
            movementMetres: round(distance(mark.c, site.record.originalTees.marks[mi].c)),
            evidenceSupportClearanceMetres: round(evidence.clearanceMetres),
            coordinateBasis: site.decision.coordinateBasis ?? null,
            declaredPositionInterpretationUncertaintyMetres: site.decision.positionInterpretationUncertaintyMetres ?? null,
            declaredSupportInterpretationUncertaintyMetres: site.decision.supportEvidence.interpretationUncertaintyMetres ?? null,
            publishedPointVerifiedAgainstCachedSource: evidence.publishedPointVerifiedAgainstCachedSource,
            sourceCoordinateArithmeticErrorMetres: round(evidence.maximumProjectionErrorMetres),
            sourcePath: evidence.sourcePath, sourceSha256: evidence.sourceSha256 });
        } else if (decision.status === 'align-to-observed-pad') {
          const ring = hole.tees.pads[decision.padIndex].ring;
          assert(pointInPoly(...mark.c, ring), `${slug}: ${label} outside chosen pad`);
          const clearance = Math.min(...ring.map((a, i) => ptSegD(...mark.c, ...a, ...ring[(i + 1) % ring.length])));
          assert(clearance >= 1, `${slug}: ${label} lacks 1 m pad clearance`);
          assert.equal(mark.referencePlacement.padSourceId, decision.padSourceId, `${slug}: ${label} association mismatch`);
          minClearance = Math.min(minClearance, clearance); assigned++;
          if (decision.positionSource) {
            const evidence = decision.positionSource;
            assert(typeof evidence.sourceFeatureId === 'string' && /^\/points\/\d+$/.test(evidence.sourceFeatureId), `${slug}: published point JSON pointer required`);
            const sourcePoint = course.positionSources[evidence.sourcePath]?.points[Number(evidence.sourceFeatureId.split('/').at(-1))];
            assert(sourcePoint && sourcePoint.hole === hole.n && sourcePoint.markIndex === mi, `${slug}: published source point identity differs`);
            assert.deepEqual(evidence.wgs84, sourcePoint.publishedWgs84, `${slug}: published WGS84 source differs`);
            assert.deepEqual(evidence.epsg3006, sourcePoint.publishedEpsg3006, `${slug}: published EPSG source differs`);
            assert.deepEqual(evidence.localXZ, sourcePoint.publishedLocal, `${slug}: published local source differs`);
            geographic(evidence.localXZ, evidence.wgs84, `${label} published point`);
            checkProjection(evidence.localXZ, evidence.epsg3006, `${label} published point`);
            assert.deepEqual(mark.c, decision.reviewedPosition, `${slug}: explicit source-reviewed coordinate changed`);
            const adjustment = distance(mark.c, evidence.localXZ);
            if (adjustment > 0.002) assert.equal(evidence.positionAdjustedForPadInterior, true, `${slug}: source point adjustment is undeclared`);
            assert(Number.isFinite(evidence.adjustmentDistanceMetres) && Math.abs(adjustment - evidence.adjustmentDistanceMetres) < 0.002,
              `${slug}: reported source point adjustment differs`);
            assert(adjustment <= decision.maxShiftMetres, `${slug}: source point adjustment exceeds reviewed bound`);
            sourcePoints++;
          }
        } else {
          assert.deepEqual(mark, record.originalMarks[mi], `${slug}: unresolved reference moved`); retained++;
        }
        if (slug === 'upsala') {
          const camera = standaloneTeeCamera(snapshot.standaloneSource, snapshot.standalone.holes, hole.n, mi);
          assert.deepEqual([camera.position.x, camera.position.z], mark.c, `${slug}: standalone camera offset at ${label}`);
          const aim = teeView(hole, mark).aim;
          assert.deepEqual([camera.aim.x, camera.aim.z], [aim.x, aim.z], `${slug}: standalone forward camera aim differs`);
          assert.deepEqual(rangefinderOrigin(snapshot.standaloneSource, snapshot.standalone.holes, hole.n, mi, true), mark.c, `${slug}: standalone rangefinder origin differs from selected tee`);
        }
      }
      for (const [pi, pad] of hole.tees.pads.entries()) {
        const feature = occurrences.get(`${build}:holes[${hi}].tees.pads[${pi}]`);
        assert.equal(feature?.geometry.type, 'Polygon', `${slug}: missing geographic pad`);
        const geographicRing = feature.geometry.coordinates[0];
        const closed = distance(pad.ring[0], pad.ring.at(-1)) === 0;
        assert.equal(geographicRing.length, pad.ring.length + (closed ? 0 : 1), `${slug}: geographic pad vertex count`);
        for (const [vi, point] of pad.ring.entries()) {
          checkProjection(point, migrated.tees.pads[pi].ring[vi], `H${hole.n} pad ${pi}/${vi}`);
          const wanted = toWgs(model, point);
          const closest = geographicRing.reduce((a, b) => distance(a, wanted) < distance(b, wanted) ? a : b);
          geographic(point, closest, `H${hole.n} pad ${pi}/${vi}`); teeVertices++;
        }
      }
    }
    if (slug === 'upsala') {
      assert.deepEqual(snapshot.standaloneGeo, course.packGeo, 'standalone GEO differs from live pack');
      assert.deepEqual(snapshot.standalone.holes.map(teeShape), model.holes.map(teeShape), 'standalone embedded tee geometry is stale');
    }
    results.push({ slug, references, assigned, platformAssigned: assigned, siteReviewed, siteClasses, unresolvedRetained: retained,
      siteSupportVerticesChecked: siteSupportVertices, minimumReviewedSiteClearanceMetres: siteReviewed ? round(minSiteClearance) : null,
      maximumSiteSourceProjectionErrorMetres: round(maxSiteProjection), maximumSitePixelRoundtripErrorMetres: round(maxSitePixelRoundtrip),
      siteReviewPaths: course.siteReviewPaths || [], siteSourceAssets: course.siteSourceAssets || [],
      siteReferences,
      physicalPads: model.holes.reduce((n, h) => n + h.tees.pads.length, 0),
      routeVertices, teeVertices, independentlyCheckedPublishedSourcePoints: sourcePoints, minimumAssociatedPadClearanceMetres: round(minClearance), maximumMigrationErrorMetres: round(maxMigration),
      maximumGeographicRoundingErrorMetres: round(maxGeographic), maximumRuntimeBridgeResidualMetres: round(maxBridge),
      maximumGpsRoundtripErrorMetres: round(maxGps),
      appCameraReferencesChecked: references,
      appRangefinderReferencesChecked: references,
      ownAndSharedPhysicalPadRingsRenderedOnce: sharedPads.size,
      standaloneCameraReferencesChecked: slug === 'upsala' ? references : 0 });
  }
  return { schemaVersion: 1, passed: true, method: 'Ordered platform reference decisions, then evidence-only site decisions -> current models -> decoded packs and standalone -> canonical EPSG:3006 migration and published routing -> RFC7946 occurrences. Site pixels, EPSG coordinates, local footprints and WGS84 points are independently checked. Actual camera and rangefinder implementations are executed for every reference.',
    toleranceMetres: { canonicalMigration: 0.005, geographicRounding: 0.0002, runtimeAffineBridge: 0.25, associatedPadInteriorMinimum: 1,
      sourcePixelToGrid: 0.00001, sourceProjectionAndPixelRoundtrip: 0.005, sourceWgs84ToRoundedLocal: 0.002, reviewedSiteInteriorMinimum: 1 },
    limitations: ['Unresolved references are checked for preservation only; this does not validate their physical location.', 'Evidence-supported tee/fairway sites are checked independently of physical pad geometry; their support footprints do not establish complete platform boundaries.', 'Millimetre coordinate-arithmetic residuals are independent of, and do not reduce, the source interpretation uncertainty recorded for each site.', 'Source raster bytes are verified when present locally; the report identifies any unavailable ignored cache assets.', 'The affine runtime bridge has a measured sub-metre approximation residual; it is not asserted to be the exact nonlinear projection.', 'Daily tee marker positions and tee-colour assignments are not independently established.'],
    landingMap: { sourceBuildingId: clubhouse.id, sourceName: clubhouse.name, wgs84LongitudeLatitude: landingWgs84,
      insideSourceBuilding: true, distanceFromBuildingCentroidMetres: round(landingCentroidDistance) },
    courses: results, files: snapshot.files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = { extraReviews: { stora: [], mellan: [] }, siteReviews: {} }; let output = null, browserReport = null;
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i], value = process.argv[++i];
      assert(value && !value.startsWith('--'), `missing value for ${arg}`);
      if (arg === '--out') output = value;
      else if (arg === '--standalone-browser-report') browserReport = value;
      else if (arg === '--stora-review') options.extraReviews.stora.push(value);
      else if (arg === '--mellan-review') options.extraReviews.mellan.push(value);
      else if (arg === '--stora-site-review') (options.siteReviews.stora ??= []).push(value);
      else if (arg === '--mellan-site-review') (options.siteReviews.mellan ??= []).push(value);
      else throw new Error(`unknown argument ${arg}`);
    }
    const report = checkUpsalaTeeSnapshot(loadUpsalaTeeSnapshot(options));
    if (browserReport) {
      const bytes = fs.readFileSync(browserReport), proof = JSON.parse(bytes);
      assert(proof.passed && proof.errors.length === 0, 'standalone browser proof did not pass');
      assert.equal(proof.pageSha256, report.files.find(f => f.path === 'upsala3d.html').sha256, 'standalone browser proof belongs to a different page');
      assert(proof.checks.length === 108 && proof.checks.every(c => c.modelMatches && c.padsMatch && c.cameraRoundedErrorMetres <= Math.SQRT2 * 0.05 + 1e-8
        && (!c.assigned || c.assignedCameraInside) && (!c.siteReviewed || c.siteReferenceMatchesReviewedPoint && c.siteReferenceInsideSupport
          && c.siteReferenceSupportClearanceMetres >= 1 && c.siteCameraRoundedInsideSupport && c.supportIsNotPhysicalPad)), 'standalone browser proof has failed reference checks');
      assert.equal(proof.checks.filter(c => c.assigned).length, report.courses[0].platformAssigned, 'standalone browser platform coverage differs');
      assert.equal(proof.checks.filter(c => c.siteReviewed).length, report.courses[0].siteReviewed, 'standalone browser site coverage differs');
      report.standaloneBrowser = { startedAt: proof.startedAt, backend: proof.backend,
        source: { path: browserReport.replaceAll('\\', '/'), sha256: sha(bytes) },
        pageSha256: proof.pageSha256, referencesChecked: proof.checks.length,
        associatedCamerasInsidePad: proof.checks.filter(c => c.assigned && c.assignedCameraInside).length,
        reviewedSiteCamerasInsideEvidence: proof.checks.filter(c => c.siteReviewed && c.siteCameraRoundedInsideSupport).length,
        maximumRoundedCameraErrorMetres: Math.max(...proof.checks.map(c => c.cameraRoundedErrorMetres)),
        cameraDiagnosticRoundingMetres: 0.1, browserErrors: 0,
        screenshots: proof.captures.map(c => {
          const filename = path.join(path.dirname(browserReport), c.file);
          assert.equal(sha(fs.readFileSync(filename)), c.sha256, 'standalone screenshot checksum mismatch');
          return { hole: c.hole, markIndex: c.markIndex, path: filename.replaceAll('\\', '/'), sha256: c.sha256 };
        }) };
    }
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, courses: report.courses.map(({ siteSourceAssets, siteReferences, ...summary }) => ({ ...summary,
      cachedSiteSourcesVerified: siteSourceAssets.filter(s => s.cachedBytesVerified).length,
      unavailableSiteCacheAssets: siteSourceAssets.filter(s => !s.cachedBytesVerified).length,
      publishedSitePointsCheckedAgainstCachedSource: siteReferences.filter(s => s.publishedPointVerifiedAgainstCachedSource).length })) }, null, 2));
  } catch (error) { console.error(`Upsala tee coordinate check failed: ${error.message}`); process.exitCode = 1; }
}
