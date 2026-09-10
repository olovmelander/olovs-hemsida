import { geometrySha256, validateRing } from './apply-ortho-review.mjs';
import { pointInPoly, polyLen } from '../lib.mjs';
import { lineBearingAt } from '../../apps/golf/src/engine/geom.js';

const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Apply explicit source-reviewed colour associations after physical surfaces.
 * A scorecard-fitted reference is retained as provenance, never used to choose
 * the nearest photographed platform. The input remains untouched on failure. */
export function applyTeePlacementReview(input, review, { heightAt } = {}) {
  if (review?.groundId !== 'johannesberg' || !['johannesberg', 'johannesberg-9'].includes(review.course) ||
      !same(input.origin, review.frame?.origin) || input.mPerLat !== review.frame.mPerLat ||
      Math.abs(input.mPerLon - review.frame.mPerLon) > .01 ||
      review.holes?.length !== input.holes.length) throw new Error('tee placement review identity/frame mismatch');
  const model = structuredClone(input), seen = new Set();
  const reviewId = `${review.course}-tee-placement-${review.reviewedOn}`;
  for (const entry of review.holes) {
    const h = model.holes.find(hole => hole.n === entry.hole);
    if (!h || seen.has(h.n) || entry.marks.length !== h.tees.marks.length ||
        entry.pads.length !== h.tees.pads.length) throw new Error('tee placement hole/pad/mark coverage mismatch');
    seen.add(h.n);
    const padIds = new Set(), padIndexes = new Set();
    for (const record of entry.pads) {
      const index = record.padIndex ?? record.index, pad = h.tees.pads[index];
      const hash = record.ringSha256 ?? record.geometrySha256;
      if (!pad || padIndexes.has(index) || !record.padId || padIds.has(record.padId) ||
          geometrySha256(pad.ring) !== hash) throw new Error(`hole ${h.n}: reviewed tee platform drift`);
      padIndexes.add(index); padIds.add(record.padId);
      pad.id = record.padId;
      pad.preserveTerrain = true;
    }
    const markIndexes = new Set();
    const originalLine = structuredClone(h.line);
    for (const record of entry.marks) {
      const index = record.teeIndex, mark = h.tees.marks[index];
      if (!mark || markIndexes.has(index) || h.t[index] !== (record.cardMetres ?? record.metres)) {
        throw new Error(`hole ${h.n}: tee colour/card mismatch`);
      }
      markIndexes.add(index);
      const original = record.originalReference ?? record.referenceC;
      if (!point(original) || !same(mark.orthophotoReference?.originalReference?.c ?? mark.c, original)) {
        throw new Error(`hole ${h.n} tee ${index}: original reference drift`);
      }
      const accepted = record.displayMarkers === true || record.status === 'accepted-inferred-platform-reference';
      const c = record.displayC ?? record.c;
      const surfaceKind = record.referenceSurfaceKind ?? record.surfaceKind ?? 'tee';
      const sourcePadId = record.sourcePadId ?? record.padId;
      delete mark.displayC; delete mark.displayPadIndex; delete mark.referenceC;
      delete mark.referenceSurfaceRing; delete mark.referenceSurfaceKind; delete mark.sourcePadId;
      mark.c = [...original];
      mark.orthophotoReference = {
        kind: accepted ? 'guide-orthophoto-reference' : 'unresolved-guide-tee-reference',
        placementReviewId: reviewId,
        status: record.status,
        originalReference: { c: [...original], provenance: 'inherited scorecard-fitted reference' },
        sourceCaptureDate: review.sourceCaptureDate,
        dailyMarkerPositions: 'unverified; constrained illustrative pairs',
      };
      if (!accepted) continue;
      if (!point(c)) throw new Error(`hole ${h.n}: accepted tee has no coordinate`);
      let rings;
      if (surfaceKind === 'tee') {
        const pad = h.tees.pads.find(p => p.id === sourcePadId);
        if (!pad || h.tees.pads[record.padIndex]?.id !== sourcePadId) throw new Error(`hole ${h.n}: invalid colour/platform association`);
        mark.sourcePadId = sourcePadId;
        rings = [pad.ring];
      } else if (surfaceKind === 'fairway') rings = h.fairway.rings;
      else if (surfaceKind === 'mown-ground') {
        validateRing(record.referenceSurfaceRing, `hole ${h.n}: mown tee reference area`);
        mark.referenceSurfaceRing = structuredClone(record.referenceSurfaceRing);
        rings = [mark.referenceSurfaceRing];
      } else throw new Error(`hole ${h.n}: unsupported tee surface ${surfaceKind}`);
      if (!rings.some(ring => pointInPoly(...c, ring))) throw new Error(`hole ${h.n}: accepted reference outside nominated surface`);
      mark.c = [...c];
      mark.referenceSurfaceKind = surfaceKind;
    }
    h.tees.inferPads = false;
    h.tees.markerLayout = 'separate-reviewed-colours';
    h.tees.status = 'reviewed-colour-associations-with-explicit-unresolved-references';
    h.tees.markerPositionStatus = 'reviewed reference positions; decorative pairs separated inside nominated surfaces; daily positions unverified';
    if (h.tees.marks[0].orthophotoReference.kind !== 'unresolved-guide-tee-reference') {
      h.line[0] = [...h.tees.marks[0].c];
      h.lineLen = Number(polyLen(h.line).toFixed(1));
      h.lenDev = Number((Math.abs(polyLen(h.line) - h.t[0]) / h.t[0] * 100).toFixed(3));
      if (heightAt) {
        const tee = heightAt(...h.line[0]);
        if (!Number.isFinite(tee)) throw new Error(`hole ${h.n}: unavailable tee elevation`);
        h.elev = { ...h.elev, tee: Number(tee.toFixed(1)), rise: Number((h.elev.green - tee).toFixed(1)) };
      }
    }
    for (const mark of h.tees.marks) mark.b = lineBearingAt(h.line, mark.c) * 180 / Math.PI;
    const oldProof = h.teePlacementReview;
    h.teePlacementReview = {
      id: reviewId,
      sourceReviewSha256: geometrySha256(review),
      lineBeforeSha256: oldProof?.id === reviewId ? oldProof.lineBeforeSha256 : geometrySha256(originalLine),
      lineAfterSha256: geometrySha256(h.line),
      changedStart: oldProof?.id === reviewId ? oldProof.changedStart : !same(originalLine[0], h.line[0]),
      policy: 'reviewed back-tee reference changes route start only; official card retained',
    };
  }
  return model;
}
