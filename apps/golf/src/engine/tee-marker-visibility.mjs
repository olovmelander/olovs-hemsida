/* A mapped-only course can explicitly opt in reviewed tee references without
 * enabling the other inferred furniture. Colour indices stay in card order;
 * the renderer checks each mark instead of filtering the marks array. */
import { inRing } from './geom.js';

export function canRenderTeeMarker(hole, mark, objectPlacement) {
  if (objectPlacement !== 'mapped-only') return true;
  if (hole?.tees?.markerPlacement !== 'reviewed' ||
      hole.tees.markerLayout !== 'separate-reviewed-colours' ||
      mark?.orthophotoReference?.kind !== 'orthophoto-platform-reference' ||
      typeof mark.sourcePadId !== 'string' || !mark.sourcePadId ||
      !Array.isArray(mark.c) || mark.c.length !== 2 || !mark.c.every(Number.isFinite)) return false;
  return (hole.tees.pads || []).some(pad =>
    (pad.id === mark.sourcePadId || pad.reviewId === mark.sourcePadId) &&
    Array.isArray(pad.ring) && pad.ring.length >= 3 &&
    pad.ring.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) &&
    inRing(...mark.c, pad.ring));
}
