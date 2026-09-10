import { pointInPoly } from '../../geobuild/lib.mjs';
import { lineBearingAt } from '../../apps/golf/src/engine/geom.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const colours = ['white', 'yellow', 'blue', 'red', 'orange'];
const local = ([e, n]) => [e - 677700.5, 6586399.5 - n];
export function reviewPixel(image, pixel) {
  const g = image?.geoTransform;
  if (!Array.isArray(g) || g.length !== 6 || g[2] !== 0 || g[4] !== 0 || g[1] <= 0 || g[5] >= 0 ||
      !Array.isArray(pixel) || pixel.length !== 2 || !pixel.every(Number.isFinite) ||
      pixel[0] < 0 || pixel[1] < 0 || pixel[0] > image.width || pixel[1] > image.height) throw new Error('Lidingo tee review has invalid image coordinates');
  return [+(g[0] + pixel[0] * g[1]).toFixed(5), +(g[3] + pixel[1] * g[5]).toFixed(5)];
}

export function applyReviewedTeePlacement(holes, review, heightAt) {
  if (review?.groundId !== 'lidingo' || review.horizontalCrs !== 'EPSG:3006' ||
      holes.length !== 18 || review.holes.length !== 18) throw new Error('Lidingo tee review identity or coverage differs');
  const output = structuredClone(holes);
  for (const [index, entry] of review.holes.entries()) {
    const hole = output[index];
    if (hole.n !== index + 1 || entry.hole !== hole.n || entry.marks.length !== 5 ||
        entry.pads.length !== hole.tees.pads.length) throw new Error('Lidingo tee review hole/pad coverage differs');
    for (const pad of entry.pads) {
      const target = hole.tees.pads.find(p => p.sourceFeatureId === pad.id);
      const ring = pad.pixels.map(p => local(reviewPixel(entry.image, p)));
      if (!same(ring[0], ring.at(-1))) ring.push([...ring[0]]);
      if (!target || target.ring.length !== ring.length || !target.ring.every((p, i) =>
          Math.hypot(p[0] - ring[i][0], p[1] - ring[i][1]) < 0.00001)) throw new Error(`H${hole.n}: tee outline differs from reviewed pixels`);
      target.id = pad.id;
      target.preserveTerrain = true;
      if (pad.sharedPhysicalPlatformId) target.sharedPhysicalPlatformId = pad.sharedPhysicalPlatformId;
    }
    for (const [i, mark] of entry.marks.entries()) {
      if (mark.colour !== colours[i] || !mark.note) throw new Error(`H${hole.n}: colour review incomplete`);
      const target = hole.tees.marks[i], original = [...(entry.baselineMarks?.[i]?.c ?? target.c)];
      target.c = [...original];
      const accepted = mark.status === 'guide-and-orthophoto-associated';
      target.orthophotoReference = {
        kind: accepted ? 'orthophoto-platform-reference' : 'unresolved-guide-tee-reference',
        placementReviewId: review.id, sourceCaptureDate: review.capturedAt,
        originalReference: { c: original, provenance: 'nominal-scorecard-selected-platform' },
        dailyMarkerPositions: 'unverified; illustrative pair inside observed surface',
        status: mark.status, note: mark.note,
      };
      if (accepted) {
        const pad = hole.tees.pads.find(p => p.id === mark.padId);
        const c = local(reviewPixel(entry.image, mark.pixel));
        if (!pad || !pointInPoly(...c, pad.ring)) throw new Error(`H${hole.n} ${mark.colour}: reference outside nominated tee`);
        target.c = c;
        target.sourcePadId = pad.id;
        target.referenceSurfaceKind = 'tee';
      } else if (mark.status !== 'unresolved') throw new Error(`H${hole.n}: unsupported tee status`);
      target.b = lineBearingAt(hole.line, target.c) * 180 / Math.PI;
      target.placement = accepted ? 'guide-associated-reference-on-2025-orthophoto-platform' : 'unresolved-colour-reference';
    }
    hole.tees.inferPads = false;
    hole.tees.markerLayout = 'separate-reviewed-colours';
    hole.tees.markerPlacement = 'reviewed';
    hole.tees.markerPositionStatus = 'Illustrative positions on image-reviewed platforms; daily coloured markers unverified';
    if (heightAt) {
      const tee = heightAt(...hole.tees.marks[1].c);
      if (!Number.isFinite(tee)) throw new Error(`H${hole.n}: tee height unavailable`);
      hole.elev.tee = +tee.toFixed(1);
      hole.elev.rise = +(hole.elev.green - tee).toFixed(1);
    }
    hole.note = 'Preliminär kartläggning. Teeytor granskade mot Lantmäteriets ortofoto 2025-05-31. Färgmarkörer är visningspositioner; dagens lägen är inte inmätta.';
  }
  return output;
}
