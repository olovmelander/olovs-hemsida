/* One place that says which physical grounds have a reviewed ring
   specification, so `build-ground-rings` and `publish-ground-rings` cannot
   disagree about it. Both used to carry their own one-entry literal, and the
   runbook's generalisation backlog names exactly that: "Both commands
   currently register only Puttom; add a validated ground ring registry."

   A ring spec is pure reviewed data (see puttom-ground-rings.mjs for the
   shape). Registering a ground here does NOT publish it -- the acquisition
   and publication commands still have to be run, and each one gates its own
   evidence. */
import { ANGSO_GROUND_RINGS } from './angso-ground-rings.mjs';
import { NORRFALLSVIKEN_GROUND_RINGS } from './norrfallsviken-ground-rings.mjs';
import { PUTTOM_GROUND_RINGS } from './puttom-ground-rings.mjs';
import { UPSALA_GROUND_RINGS } from './upsala-ground-rings.mjs';
import { VECKEFJARDEN_GROUND_RINGS } from './veckefjarden-ground-rings.mjs';

export const GROUND_RINGS = Object.freeze({
  angso: ANGSO_GROUND_RINGS,
  norrfallsviken: NORRFALLSVIKEN_GROUND_RINGS,
  puttom: PUTTOM_GROUND_RINGS,
  upsala: UPSALA_GROUND_RINGS,
  veckefjarden: VECKEFJARDEN_GROUND_RINGS,
});

export function ringSpecFor(groundId) {
  const spec = GROUND_RINGS[groundId];
  if (!spec) {
    throw new Error(
      `no ring specification for ground ${groundId}; registered grounds are ${Object.keys(GROUND_RINGS).join(', ')}`,
    );
  }
  if (spec.groundId !== groundId) {
    throw new Error(`ring specification registered as ${groundId} declares groundId ${spec.groundId}`);
  }
  return spec;
}

/* The generic helpers live beside Puttom's spec because that is where they
   were written; they take a level and read nothing course-specific, so they
   are re-exported here rather than duplicated. */
export { dtmItemsFor, ringLevelExtent } from './puttom-ground-rings.mjs';
