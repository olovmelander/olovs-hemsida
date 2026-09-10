#!/usr/bin/env node
/* Verify adoption of traced source pixels independently of imagery availability.
 * The optional ignored baseline only supplies before/after movement diagnostics.
 * Pixel agreement and runtime projection error are not survey accuracy claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pointInPoly, polyArea } from '../lib.mjs';
import { orthophotoPoint, orthophotoPointEpsg3006 } from './reviewed-orthophoto.mjs';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TEE_KEYS = ['tee-61', 'tee-57', 'tee-48', 'tee-41'];
const EPSILON = 1e-8;
const round = value => Number.isFinite(value) ? +value.toFixed(6) : null;
const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const distance = (a, b) => pair(a) && pair(b) ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(value).digest('hex');
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function onSegment(a, b, c) {
  return Math.abs(cross(a, b, c)) <= EPSILON &&
    c[0] >= Math.min(a[0], b[0]) - EPSILON && c[0] <= Math.max(a[0], b[0]) + EPSILON &&
    c[1] >= Math.min(a[1], b[1]) - EPSILON && c[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function simpleRingErrors(points) {
  if (!Array.isArray(points) || points.length < 4 || !points.every(pair)) return ['invalid coordinate ring'];
  const errors = [], count = points.length - 1;
  if (distance(points[0], points.at(-1)) > EPSILON) errors.push('ring is not explicitly closed');
  if (new Set(points.slice(0, -1).map(p => p.join(','))).size !== count) errors.push('repeated nonclosure vertex');
  for (let i = 0; i < count; i++) if (distance(points[i], points[i + 1]) <= EPSILON) errors.push(`zero-length edge ${i}`);
  if (Math.abs(polyArea(points)) < EPSILON) errors.push('zero enclosed area');
  for (let i = 0; i < count; i++) for (let j = i + 2; j < count; j++) {
    if (i === 0 && j === count - 1) continue;
    if (intersects(points[i], points[i + 1], points[j], points[j + 1])) {
      errors.push(`edges ${i}/${j} intersect`);
      return errors;
    }
  }
  return errors;
}

function ringCentroid(points) {
  if (!Array.isArray(points) || points.length < 3 || !points.every(pair)) return null;
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const term = a[0] * b[1] - b[0] * a[1];
    area += term; x += (a[0] + b[0]) * term; y += (a[1] + b[1]) * term;
  }
  return Math.abs(area) > EPSILON ? [x / (3 * area), y / (3 * area)] : null;
}

function summary(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { count: finite.length, maximumMetres: finite.length ? round(finite.at(-1)) : null,
    medianMetres: finite.length ? round(finite[Math.floor((finite.length - 1) / 2)]) : null,
    p95Metres: finite.length ? round(finite[Math.ceil(finite.length * .95) - 1]) : null };
}

/** Reports all existing mark locations; only explicitly corrected marks are
 * required to lie inside a source-reviewed platform with numbered identity. */
export function auditAlignment({ model, review, card, baseline = null } = {}) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'puttom' || !Array.isArray(review.holes)) {
    throw new Error('Expected a Puttom orthophoto review');
  }
  if (!Array.isArray(model?.holes) || !Array.isArray(card?.holes)) throw new Error('Expected course model and scorecard');
  const issues = [], features = [], references = [], pixelErrors = [], runtimeErrors = [];
  const bridge = legacyGridBridge(PUTTOM_PREVIEW_CONFIG.legacyFrame);
  const gridOrigin = PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006;
  const corrected = new Map(), seenIds = new Set();
  const byNumber = n => model.holes.find(h => h.n === n);
  const originalHole = n => baseline?.holes?.find(h => h.n === n);
  const fail = (gate, id, message) => issues.push({ gate, id, message });
  if (baseline && review.baseModelSha256 && hash(JSON.stringify(baseline)) !== review.baseModelSha256) {
    fail('baseline-identity', 'baseline', 'optional baseline does not match the model pinned by this review');
  }
  const counts = { greens: 0, teePlatforms: 0, fairwayRings: 0, bunkers: 0, cameraReferences: 0,
    cameraReferencesWithReviewedPlatform: 0, standaloneCameraReferences: 0,
    waterRings: 0, paths: 0, removedBunkers: 0 };

  function comparePoint(trace, pixel, actual, label) {
    const expected = orthophotoPoint(review, trace.sourceKey, pixel);
    const e = distance(expected, actual);
    pixelErrors.push(e);
    if (!(e < .01)) fail('source-pixel-adoption', label, `coordinate error ${round(e)} m; requires <0.01 m`);
    if (pair(actual)) {
      const [easting, northing] = orthophotoPointEpsg3006(review, trace.sourceKey, pixel);
      const [gx, gz] = bridge.toGrid(...actual);
      const runtime = Math.hypot(gridOrigin.easting + gx - easting, gridOrigin.northing - gz - northing);
      runtimeErrors.push(runtime);
      if (!(runtime < .16)) fail('runtime-grid-alignment', label, `bridge error ${round(runtime)} m; requires <0.16 m`);
    }
    return e;
  }

  function feature(trace, kind, hole, actual, original = null) {
    if (seenIds.has(trace.id)) fail('feature-identity', trace.id, 'duplicate reviewed feature id');
    seenIds.add(trace.id);
    for (const error of simpleRingErrors(trace.ringPixels)) fail('source-topology', trace.id, error);
    const ring = actual?.ring;
    if (!ring || actual.reviewId !== trace.id) fail('feature-identity', trace.id, 'adopted model feature not found by reviewId');
    const errors = simpleRingErrors(ring);
    for (const error of errors) fail('model-topology', trace.id, error);
    if (ring?.length !== trace.ringPixels.length) fail('source-pixel-adoption', trace.id, 'source/model vertex counts differ');
    const start = pixelErrors.length;
    for (let i = 0; i < trace.ringPixels.length; i++) comparePoint(trace, trace.ringPixels[i], ring?.[i], `${trace.id}[${i}]`);
    if (actual && (actual.sourceSha256 !== review.sources[trace.sourceKey]?.sha256 || actual.sourceKey !== trace.sourceKey)) {
      fail('feature-provenance', trace.id, 'model source identity does not match review');
    }
    features.push({ id: trace.id, kind, hole, sourceKey: trace.sourceKey, vertexCount: trace.ringPixels.length,
      maximumSourcePixelErrorMetres: summary(pixelErrors.slice(start)).maximumMetres,
      areaSquareMetres: ring ? round(Math.abs(polyArea(ring))) : null,
      previousAreaSquareMetres: original?.ring ? round(Math.abs(polyArea(original.ring))) : null,
      centroidMovementMetres: original?.ring && ring ? round(distance(ringCentroid(original.ring), ringCentroid(ring))) : null });
  }

  function reference(trace, key, pixel, actual, previous = null) {
    const error = comparePoint(trace, pixel, actual, `${trace.id}:${key}`);
    references.push({ id: trace.id, key, sourceKey: trace.sourceKey,
      sourcePixelErrorMetres: round(error), previousCoordinate: previous ?? null,
      coordinate: actual ?? null, movementMetres: previous ? round(distance(previous, actual)) : null });
  }

  for (const entry of review.holes) {
    const hole = byNumber(entry.n), before = originalHole(entry.n);
    if (!hole) { fail('hole-identity', entry.n, 'reviewed hole missing from model'); continue; }
    if (entry.green) {
      counts.greens++;
      feature(entry.green, 'green', entry.n, hole.green, before?.green);
      if (entry.green.referencePixels) {
        reference(entry.green, `green-${entry.n}`, entry.green.referencePixels, hole.green.c, before?.green?.c);
        comparePoint(entry.green, entry.green.referencePixels, hole.pin, `${entry.green.id}:pin`);
        if (entry.green.updateRouteTarget !== false) comparePoint(entry.green, entry.green.referencePixels, hole.line.at(-1), `${entry.green.id}:route-target`);
      }
      if (!pointInPoly(...hole.green.c, hole.green.ring)) fail('green-reference', entry.green.id, 'green reference leaves reviewed putting surface');
    }
    for (const tee of entry.tees ?? []) {
      counts.teePlatforms++;
      const pads = hole.tees.pads.filter(p => p.reviewId === tee.id);
      if (pads.length !== 1) fail('feature-identity', tee.id, `expected one reviewed platform, found ${pads.length}`);
      const pad = pads[0];
      feature(tee, 'tee', entry.n, pad, Number.isInteger(tee.replaceIndex) ? before?.tees?.pads?.[tee.replaceIndex] : null);
      for (const [key, pixel] of Object.entries(tee.cameraReferencesPixels ?? {})) {
        counts.cameraReferences++;
        counts.cameraReferencesWithReviewedPlatform++;
        const index = TEE_KEYS.indexOf(key), mark = hole.tees.marks[index];
        const identity = `${entry.n}:${key}`;
        if (corrected.has(identity)) fail('corrected-marker', identity, 'duplicate corrected reference');
        corrected.set(identity, { trace: tee, pad, geometryBasis: 'reviewed-platform' });
        reference(tee, identity, pixel, mark?.c, before?.tees?.marks?.[index]?.c);
        if (index === 0 && tee.updateRouteStart !== false) comparePoint(tee, pixel, hole.line[0], `${tee.id}:route-start`);
        if (!mark || !pad || !pointInPoly(...mark.c, pad.ring)) fail('corrected-marker', identity, 'corrected camera outside its own reviewed platform');
        if (!tee.numberedSourceAssetId || mark?.numberedSourceAssetId !== tee.numberedSourceAssetId) {
          fail('corrected-marker', identity, 'numbered platform evidence missing or mismatched');
        }
        if (mark?.sourcePadId !== pad?.id || mark?.sourceKey !== tee.sourceKey ||
            mark?.sourceSha256 !== review.sources[tee.sourceKey]?.sha256) {
          fail('feature-provenance', identity, 'tee marker lost its reviewed platform or native image identity');
        }
      }
    }
    for (const anchor of entry.cameraReferences ?? []) {
      counts.cameraReferences++;
      counts.standaloneCameraReferences++;
      const key = anchor.teeKey, index = TEE_KEYS.indexOf(key), mark = hole.tees.marks[index];
      const identity = `${entry.n}:${key}`;
      if (seenIds.has(anchor.id)) fail('feature-identity', anchor.id, 'duplicate reviewed anchor id');
      seenIds.add(anchor.id);
      if (corrected.has(identity)) fail('corrected-marker', identity, 'duplicate corrected reference');
      corrected.set(identity, { trace: anchor, geometryBasis: 'visible-interior-anchor' });
      reference(anchor, identity, anchor.pointPixels, mark?.c, before?.tees?.marks?.[index]?.c);
      if (index === 0 && anchor.updateRouteStart !== false) comparePoint(anchor, anchor.pointPixels, hole.line[0], `${anchor.id}:route-start`);
      if (anchor.geometryBasis !== 'visible-interior-anchor' || !anchor.reviewNotes?.trim() ||
          !mark || mark.reviewId !== anchor.id || mark.geometryBasis !== 'visible-interior-anchor' ||
          mark.platformBoundaryReviewed !== false) {
        fail('standalone-marker', identity, 'visible-interior observation is missing or incorrectly claims a reviewed boundary');
      }
      if (!anchor.numberedSourceAssetId || mark?.numberedSourceAssetId !== anchor.numberedSourceAssetId) {
        fail('standalone-marker', identity, 'numbered platform identity evidence missing or mismatched');
      }
      if (mark?.sourceKey !== anchor.sourceKey || mark?.sourceSha256 !== review.sources[anchor.sourceKey]?.sha256) {
        fail('feature-provenance', anchor.id, 'standalone source identity does not match review');
      }
      if (anchor.existingPadIndex !== undefined && !hole.tees.pads[anchor.existingPadIndex]) {
        fail('standalone-marker', identity, 'referenced existing platform is missing');
      }
      if (before && anchor.existingPadIndex !== undefined &&
          !same(hole.tees.pads[anchor.existingPadIndex]?.ring, before.tees.pads[anchor.existingPadIndex]?.ring)) {
        fail('standalone-marker', identity, 'point-only adoption changed the unreviewed platform boundary');
      }
    }
    for (const fairway of entry.fairways ?? []) {
      counts.fairwayRings++;
      const slot = hole.fairway.reviewedRings?.[fairway.id];
      const source = hole.fairway.orthophotoSources?.[fairway.id];
      feature(fairway, 'fairway', entry.n, Number.isInteger(slot) && source ? { ...source, ring: hole.fairway.rings[slot] } : null,
        Number.isInteger(fairway.replaceIndex) && before?.fairway?.rings?.[fairway.replaceIndex]
          ? { ring: before.fairway.rings[fairway.replaceIndex] } : null);
    }
    const bunkers = Array.isArray(entry.bunkers) ? entry.bunkers : entry.bunkers?.accepted ?? [];
    for (const bunker of bunkers) {
      counts.bunkers++;
      // Indexed slots can shift after explicit reassignment/removal. The accepted
      // review id and owning hole, rather than historical index, identify it.
      const matches = model.holes.flatMap(h => h.bunkers.filter(b => b.reviewId === bunker.id).map(b => ({ hole: h.n, value: b })));
      if (matches.length !== 1 || matches[0]?.hole !== entry.n) fail('bunker-ownership', bunker.id, 'reviewed bunker is missing, duplicated or assigned to the wrong hole');
      feature(bunker, 'bunker', entry.n, matches[0]?.value,
        Number.isInteger(bunker.replaceIndex) ? before?.bunkers?.[bunker.replaceIndex] : null);
    }
    for (const removal of entry.removeBunkers ?? []) {
      counts.removedBunkers++;
      if (hole.bunkers.some(b => same(b.ring, removal.ringLegacy))) fail('bunker-ownership', removal.id, 'reassigned legacy bunker remains on previous hole');
    }
  }
  for (const water of review.water ?? []) {
    counts.waterRings++;
    feature(water, 'water', null, model.water?.find(w => w.reviewId === water.id),
      baseline?.water?.find(w => w.id === water.replaceId));
  }
  for (const trace of review.paths ?? []) {
    counts.paths++;
    const actual = model.infra?.paths?.find(p => p.reviewId === trace.id);
    if (actual?.line?.length !== trace.linePixels?.length) fail('source-pixel-adoption', trace.id, 'path source/model counts differ');
    for (let i = 0; i < trace.linePixels.length; i++) comparePoint(trace, trace.linePixels[i], actual?.line?.[i], `${trace.id}[${i}]`);
  }

  let checkedCardValues = 0;
  if (model.holes.length !== 18 || card.holes.length !== 18 || new Set(model.holes.map(h => h.n)).size !== 18) {
    fail('scorecard', 'holes', 'exactly eighteen distinct holes required');
  }
  if (!same(model.card?.teeNames, card.teeNames)) fail('scorecard', 'tee-names', 'tee identities differ from scorecard');
  for (const row of card.holes) {
    const h = byNumber(row.n);
    if (!h || h.par !== row.par || h.idx !== row.hcp || !same(h.t, row.t)) fail('scorecard', row.n, 'par/stroke index/tee lengths changed');
    checkedCardValues += 2 + row.t.length;
    if (h?.tees?.marks?.length !== row.t.length || h.tees.marks.some((m, i) => m.m !== row.t[i])) fail('scorecard', `${row.n}:marks`, 'tee mark distance metadata changed');
    const old = originalHole(row.n);
    if (old && (old.par !== h?.par || old.idx !== h?.idx || !same(old.t, h?.t))) fail('scorecard', `${row.n}:baseline`, 'published card changed from baseline');
  }

  const marks = model.holes.flatMap(h => (h.tees?.marks ?? []).map((mark, i) => {
    const key = TEE_KEYS[i], correction = corrected.get(`${h.n}:${key}`);
    const pads = h.tees.pads.filter(p => p.prov !== 'synth' && pair(mark.c) && pointInPoly(...mark.c, p.ring));
    const insideReviewed = pads.some(p => p.prov === 'lm-orthophoto');
    return { hole: h.n, tee: key, coordinate: mark.c, corrected: !!correction,
      geometryBasis: correction?.geometryBasis ?? null,
      insideAnyMappedPlatform: pads.length > 0,
      containingPlatformReviewIds: pads.map(p => p.reviewId ?? null),
      status: correction?.geometryBasis === 'visible-interior-anchor' ? 'reviewed-visible-interior-anchor-boundary-unreviewed'
        : correction ? (pads.includes(correction.pad) ? 'corrected-inside-reviewed-platform' : 'corrected-outside-own-platform')
        : insideReviewed ? 'inside-reviewed-platform-numbered-identity-unverified'
          : pads.length ? 'inside-unreviewed-mapped-platform' : 'outside-all-mapped-platforms',
      movementMetres: originalHole(h.n) ? round(distance(originalHole(h.n).tees.marks[i].c, mark.c)) : null };
  }));
  if (marks.length !== 72) fail('marker-inventory', 'marks', `expected 72 references, found ${marks.length}`);
  const statusCounts = {};
  for (const mark of marks) statusCounts[mark.status] = (statusCounts[mark.status] ?? 0) + 1;
  const coverage = model.holes.map(h => ({ hole: h.n,
    greens: features.filter(f => f.hole === h.n && f.kind === 'green').length,
    teePlatforms: features.filter(f => f.hole === h.n && f.kind === 'tee').length,
    fairwayRings: features.filter(f => f.hole === h.n && f.kind === 'fairway').length,
    bunkers: features.filter(f => f.hole === h.n && f.kind === 'bunker').length,
    correctedCameras: marks.filter(m => m.hole === h.n && m.corrected).length,
    unresolvedCameras: marks.filter(m => m.hole === h.n && !m.corrected).length }));
  return { schemaVersion: 1, groundId: 'puttom', kind: 'orthophoto-adoption-alignment-audit',
    passed: issues.length === 0, reviewedAt: review.reviewedAt ?? null, baselineAvailable: !!baseline,
    tolerances: { sourcePixelAdoptionMetres: .01, runtimeBridgeMetres: .16 },
    adopted: counts, coverage: { holes: coverage, greensRemainingUnreviewed: 18 - counts.greens,
      cameraReferences: marks.length, explicitlyReviewedCameras: corrected.size,
      referencesWithoutReviewedNumberedIdentity: marks.length - corrected.size, markerStatuses: statusCounts },
    sourcePixelAgreement: summary(pixelErrors), runtimeBridgeAgreement: summary(runtimeErrors),
    correctedCameraMovement: summary(references.filter(r => /:tee-/.test(r.key)).map(r => r.movementMetres)),
    cameraReferenceDisposition: baseline ? {
      movedAtLeastOneNativePixel: marks.filter(m => m.corrected && m.movementMetres >= .16).length,
      retainedWithinOneNativePixel: marks.filter(m => m.corrected && m.movementMetres < .16).length,
      outsideAnyMappedPlatform: marks.filter(m => !m.insideAnyMappedPlatform).length,
      unreviewedAndOutsideAnyMappedPlatform: marks.filter(m => !m.corrected && !m.insideAnyMappedPlatform).length,
    } : null,
    scorecard: { checkedDisplayValues: checkedCardValues, checkedMarkerDistanceValues: marks.length,
      exactConservation: !issues.some(i => i.gate === 'scorecard') },
    features, references, marks, issues,
    limitations: ['Source-pixel agreement verifies the software conversion, not absolute positional accuracy.',
      'Runtime bridge error measures coordinate-frame approximation, not imagery or survey accuracy.',
      'Uncorrected marker containment is diagnostic; it does not establish numbered platform identity.',
      'Standalone visible-interior anchors certify no platform boundary; their existing-pad containment remains diagnostic.',
      'Visible 2024 boundaries and virtual camera references are not survey-approved or daily tee-marker measurements.'] };
}

function main() {
  const options = { model: 'puttombuild/course-model.json', review: 'puttombuild/mapping/orthophoto-review.json',
    card: 'puttombuild/card.json', baseline: 'puttombuild/cache/orthophoto-baseline.json',
    out: 'puttombuild/mapping/alignment-audit.json', check: false };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/, '');
    if (key === 'check') options.check = true;
    else if (['model', 'review', 'card', 'baseline', 'out'].includes(key) && process.argv[i + 1]) options[key] = process.argv[++i];
    else throw new Error('Usage: audit-alignment.mjs [--model file] [--review file] [--card file] [--baseline file] [--out file] [--check]');
  }
  const inputs = {}, identities = {};
  for (const key of ['model', 'review', 'card', 'baseline']) {
    const file = path.resolve(ROOT, options[key]);
    if (key === 'baseline' && !fs.existsSync(file)) { inputs[key] = null; identities[key] = null; continue; }
    const bytes = fs.readFileSync(file);
    inputs[key] = JSON.parse(bytes);
    identities[key] = { path: path.relative(ROOT, file).replaceAll(path.sep, '/'), sha256: hash(bytes) };
  }
  const report = { ...auditAlignment(inputs), inputs: identities };
  if (!options.check) {
    const output = path.resolve(ROOT, options.out);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: report.passed, adopted: report.adopted,
    coverage: { ...report.coverage, holes: undefined }, sourcePixelAgreement: report.sourcePixelAgreement,
    runtimeBridgeAgreement: report.runtimeBridgeAgreement, correctedCameraMovement: report.correctedCameraMovement,
    issues: report.issues, report: options.check ? null : options.out }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Puttom alignment audit failed: ${error.message}`); process.exitCode = 1; }
}
