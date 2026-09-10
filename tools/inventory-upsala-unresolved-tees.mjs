#!/usr/bin/env node
/** Read-only inventory. Writes only the explicitly named --out review report. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';
import { centroid, pointInPoly, ptSegD } from '../upsalabuild/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = n => Number(n.toFixed(6));
const hash = b => createHash('sha256').update(b).digest('hex');
const definitions = [
  { slug: 'upsala', build: 'upsalabuild', parts: ['front9', 'back9'], followup: 'stora' },
  { slug: 'upsala-mellanbanan', build: 'upsalamellanbuild', parts: ['mellan'], followup: 'mellan' },
];
function ringDistance(p, ring) {
  const inside = pointInPoly(...p, ring);
  const edge = Math.min(...ring.map((a, i) => ptSegD(...p, ...a, ...ring[(i + 1) % ring.length])));
  return { inside, distanceMetres: inside ? 0 : round(edge), signedBoundaryDistanceMetres: round(inside ? -edge : edge) };
}

export function inventoryUnresolvedUpsalaTees(root = ROOT) {
  const sources = new Map();
  const read = relative => {
    const bytes = fs.readFileSync(path.join(root, relative));
    sources.set(relative, { path: relative, sha256: hash(bytes) });
    return JSON.parse(bytes);
  };
  const manifest = read('apps/golf/public/courses/index.json');
  const physicalHistoryPath = 'upsalabuild/mapping/stora-tees-13-18-2025.json';
  const physicalHistory = read(physicalHistoryPath);
  const points = [], courses = [];
  for (const def of definitions) {
    const model = read(`${def.build}/course-model.json`);
    const teeNames = manifest.courses.find(c => c.slug === def.slug).tees.names;
    const reviewFiles = [...def.parts.map(part => `upsalabuild/mapping/lm-tee-review-${part}-2026-09-09.json`),
      `upsalabuild/mapping/lm-tee-followup-${def.followup}-2026-09-09.json`];
    const reviews = reviewFiles.map(file => ({ file, review: read(file) }));
    const beforeCount = points.length;
    for (const hole of model.holes) for (const [markIndex, mark] of hole.tees.marks.entries()) {
      if (mark.referencePlacement) continue;
      const point = mark.c, longitude = model.origin.lon + point[0] / model.mPerLon,
        latitude = model.origin.lat - point[1] / model.mPerLat;
      const pads = hole.tees.pads.map((p, padIndex) => ({ padIndex, sourceId: p.sourceId ?? null,
        observedBoundary: ['ortho-trace', 'dated-orthophoto-trace'].includes(p.prov),
        provenance: p.prov ?? 'legacy-boundary-unverified', ...ringDistance(point, p.ring),
        centreLocal: centroid(p.ring).map(round), ringLocal: p.ring,
        observedYear: p.observedYear ?? null, boundaryInterpretationUncertaintyMetres: p.boundaryInterpretationUncertaintyMetres ?? null }))
        .sort((a, b) => a.distanceMetres - b.distanceMetres || a.padIndex - b.padIndex);
      const fairways = (hole.fairway?.rings || []).map((ring, ringIndex) => ({ ringIndex, ...ringDistance(point, ring) }))
        .sort((a, b) => a.distanceMetres - b.distanceMetres || a.ringIndex - b.ringIndex);
      const reviewHistory = reviews.flatMap(({ file, review }) => {
        const record = review.holes.find(h => h.hole === hole.n), decision = record?.referenceDecisions.find(d => d.markIndex === markIndex);
        return decision ? [{ path: file, status: decision.status, reason: decision.reason }] : [];
      });
      const provisional = def.slug === 'upsala' && ((hole.n === 13 && [3, 4].includes(markIndex)) || (hole.n === 15 && markIndex === 0));
      const originalPhysical = provisional ? physicalHistory.holes.find(h => h.hole === hole.n) : null;
      points.push({ slug: def.slug, hole: hole.n, markIndex, teeName: teeNames[markIndex], cardDistanceMetres: hole.t[markIndex],
        referenceLocalXZ: point, wgs84LongitudeLatitude: [longitude, latitude], epsg3006EastingNorthing: latLonToSweref99Tm(latitude, longitude),
        currentMark: mark, currentRouteStart: hole.line[0], sameHolePads: pads, nearestSameHoleFairway: fairways[0] ?? null,
        reviewHistory, investigationCategory: provisional ? 'tee-area-with-incomplete-platform-boundary' : 'forward-reference-without-associated-platform',
        ...(provisional ? { provisionalPhysicalHistory: { path: physicalHistoryPath, hole: hole.n,
          retainedOriginalPadIndices: originalPhysical.retainOriginalPadIndices ?? [],
          notes: originalPhysical.notes ?? originalPhysical.reviewNotes ?? null,
          nativeReviewPath: 'upsalabuild/mapping/lm-tee-review-back9-2026-09-09.json' } } : {}),
        coordinateAccuracy: 'Unverified scorecard-inferred navigation reference. Numerical projection does not establish physical or daily-marker accuracy.' });
    }
    courses.push({ slug: def.slug, unresolvedReferences: points.length - beforeCount, frame: { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon } });
  }
  return { schemaVersion: 1, reviewedAt: '2026-09-09', scope: 'Unresolved references after the accepted platform followup; read-only snapshot, not an adoption ledger.',
    counts: { references: points.length, courses, provisionalTeeAreaReferences: points.filter(p => p.investigationCategory === 'tee-area-with-incomplete-platform-boundary').length,
      insideSameHoleFairway: points.filter(p => p.nearestSameHoleFairway?.inside).length,
      insideAnySameHolePad: points.filter(p => p.sameHolePads.some(pad => pad.inside)).length },
    sources: [...sources.values()], points,
    proposedReviewContract: {
      scope: 'Separate third-phase point ledger. It changes explicitly reviewed navigation references and never creates or modifies a rendered platform ring.',
      siteClasses: ['tee', 'fairway'],
      requiredEvidence: ['Exact original mark and card arrays, source frame and any coincident route start.',
        'Explicit reviewedPosition plus independently verified published WGS84/EPSG/local source point when available; source feature identity and file checksum.',
        'Dated native-image source hashes and a small evidence-only support footprint whose visible surface is classified as tee or fairway. It is not a claimed complete platform boundary.',
        'Reviewed upper bounds for movement from both the original reference and the source coordinate; source uncertainty and any adjustment are stated separately.'],
      guards: ['Reject unsupported source identity, wrong axis/scale, stale original coordinates, source-image transform mismatch, or an explicit point outside the reviewed support footprint.',
        'Require a reviewed inset/clearance appropriate to the visible support area. Reject pond, bunker, mapped building or path overlap unless evidence explicitly corrects that conflicting source.',
        'Preserve physical pads, fairways, card lengths and later route vertices. Move a formerly coincident route start only under a separate explicit decision.',
        'Store compact point provenance with siteClass and daily-marker/colour verification false; raw EPSG and pixel evidence stay in mapping ledgers.',
        'Only mark a reference resolved when positive source evidence supports its point. A retain decision, containment in an old provisional rectangle or a scorecard-distance match is insufficient.'],
      implementationSuggestion: 'A separate applyUpsalaReviewedTeeSites helper after the accepted pad-association chain avoids weakening the current physical-pad contract. The coordinate checker should read the third-phase ledger as an explicit additional stage.' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Usage: node tools/inventory-upsala-unresolved-tees.mjs --out report.json');
  const report = inventoryUnresolvedUpsalaTees();
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ counts: report.counts, references: report.points.map(p => ({ slug: p.slug, hole: p.hole, tee: p.teeName,
    nearestPadMetres: p.sameHolePads[0]?.distanceMetres, fairway: p.nearestSameHoleFairway, category: p.investigationCategory })) }, null, 2));
}
