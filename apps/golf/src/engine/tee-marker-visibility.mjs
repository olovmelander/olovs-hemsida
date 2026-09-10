/* A mapped-only course can explicitly opt in reviewed tee references without
 * enabling the other inferred furniture. Colour indices stay in card order;
 * the renderer checks each mark instead of filtering the marks array. */
import { inRing } from './geom.js';

/* A platform reference the balls may stand on: one read off orthophotography,
   or one DERIVED from the card on a course whose imagery shows the tee as a
   mown rectangle in a mown corridor and nothing more (Tortuna, 2026-09-10) --
   the platform is in the model, flagged as derived in its own record, and a
   marker drawn on it is a marker on the platform the model carries. An
   unresolved reference still draws nothing. */
export const RENDERABLE_REFERENCE_KINDS = new Set(['orthophoto-platform-reference', 'card-derived-platform-reference']);

export function canRenderTeeMarker(hole, mark, objectPlacement) {
  if (objectPlacement !== 'mapped-only') return true;
  if (hole?.tees?.markerPlacement !== 'reviewed' ||
      hole.tees.markerLayout !== 'separate-reviewed-colours' ||
      !RENDERABLE_REFERENCE_KINDS.has(mark?.orthophotoReference?.kind) ||
      typeof mark.sourcePadId !== 'string' || !mark.sourcePadId ||
      !Array.isArray(mark.c) || mark.c.length !== 2 || !mark.c.every(Number.isFinite)) return false;
  return (hole.tees.pads || []).some(pad =>
    (pad.id === mark.sourcePadId || pad.reviewId === mark.sourcePadId) &&
    Array.isArray(pad.ring) && pad.ring.length >= 3 &&
    pad.ring.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) &&
    inRing(...mark.c, pad.ring));
}
