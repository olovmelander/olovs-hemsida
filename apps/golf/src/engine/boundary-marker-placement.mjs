import { inRing } from './geom.js';

/* A spatial-grid hit is only a nearby candidate. Its pond level must not
 * suppress a post on a separate dry bank or below a neighbouring pond. */
export function boundaryMarkerSubmerged(x, z, height, waterCandidates) {
  return waterCandidates.some(w => !w.stream && Number.isFinite(w.level) &&
    height < w.level + .05 && inRing(x, z, w.ring));
}
