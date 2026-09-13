/* Runtime playing positions on existing pads. Keep the mapped reference for
 * review; centre only across the hole's bearing so shared long pads retain
 * each tee's distance along the hole. This is presentation geometry, not a
 * surveyed daily tee-marker position. Never used by the surface compiler. */
import { inRing, rightOf, ringSD } from './geom.js';

const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const validRing = ring => Array.isArray(ring) && ring.length >= 3 && ring.every(point);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

function containingSection(anchor, axis, ring) {
  let low = -Infinity, high = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const edge = [b[0] - a[0], b[1] - a[1]];
    const relative = [a[0] - anchor[0], a[1] - anchor[1]];
    const denominator = cross(axis, edge);
    if (Math.abs(denominator) < 1e-10) continue;
    const t = cross(relative, edge) / denominator, u = cross(relative, axis) / denominator;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    if (t <= 0) low = Math.max(low, t);
    if (t >= 0) high = Math.min(high, t);
  }
  return [low, high];
}

export function deriveTeePlayingPositions(hole, { maxShift = 6 } = {}) {
  if (!hole?.tees?.marks) return hole;
  if (!Number.isFinite(maxShift) || maxShift < 0) throw new Error('Invalid tee playing-position shift limit');
  const pads = hole.tees.pads || [];
  hole.tees.marks = hole.tees.marks.map(mark => {
    if (mark.playingPosition) return mark;
    const inputC = mark.c;
    if (!point(inputC) || !Number.isFinite(mark.b)) return mark;
    const retained = (reason, detail = {}) => ({ ...mark, c: [...inputC],
      referenceC: [...(mark.referenceC ?? inputC)],
      playingPosition: { method: 'retained-reference', reason, inputC: [...inputC], shiftM: 0, ...detail } });
    if (mark.orthophotoReference?.kind === 'unresolved-guide-tee-reference') return retained('unresolved-guide-reference');
    if (['fairway', 'mown-ground'].includes(mark.referenceSurfaceKind)) return retained('non-pad-reference');
    const eligible = pads.flatMap((pad, index) => {
      if (mark.sourcePadId != null && pad.id !== mark.sourcePadId && pad.reviewId !== mark.sourcePadId) return [];
      return validRing(pad.ring) && inRing(...inputC, pad.ring) ? [{ pad, index }] : [];
    });
    if (!eligible.length) return retained('reference-outside-associated-pad');
    if (eligible.length !== 1) return retained('ambiguous-pad-association');
    const { pad, index } = eligible[0], before = -ringSD(...inputC, pad.ring);
    const detail = { padIndex: index, padId: pad.id ?? pad.reviewId ?? null,
      beforeEdgeClearanceM: before, afterEdgeClearanceM: before };
    // An interior source point establishes which connected section to use.
    // Edge points and disconnected turf islands need an explicit review.
    if (before < 1e-6) return retained('reference-on-pad-boundary', detail);
    const lateral = rightOf(mark.b * Math.PI / 180);
    const [low, high] = containingSection(inputC, lateral, pad.ring);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < .3) return retained('insufficient-pad-width', detail);
    const offset = (low + high) / 2, shiftM = Math.abs(offset);
    if (shiftM < .05) return retained('already-centred', detail);
    if (shiftM > maxShift) return retained('centering-exceeds-shift-limit', detail);
    const c = [inputC[0] + lateral[0] * offset, inputC[1] + lateral[1] * offset];
    const after = -ringSD(...c, pad.ring);
    if (!inRing(...c, pad.ring) || after < Math.max(.15, before - 1e-6)) return retained('insufficient-centre-clearance', detail);
    return { ...mark, referenceC: [...(mark.referenceC ?? inputC)], c,
      playingPosition: { method: 'lateral-pad-centre', reason: 'centred-on-associated-pad',
        inputC: [...inputC], shiftM, ...detail, afterEdgeClearanceM: after } };
  });
  return hole;
}
