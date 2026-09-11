/* One place that says which physical grounds have a reviewed ring
   specification, so `build-ground-rings` and `publish-ground-rings` cannot
   disagree about it. Both used to carry their own one-entry literal, and the
   runbook's generalisation backlog names exactly that: "Both commands
   currently register only Puttom; add a validated ground ring registry."

   Every ground is on the ONE standard topology (standard-ground-rings.mjs):
   a 16 km root in seven levels with 1 m over the central 4,096 m. A spec is
   pure reviewed data -- the ground's centre, its courses and their
   migrations, its measured coverage band and, on a coast, its sea-fill rule.
   Registering a ground here does NOT publish it -- the acquisition and
   publication commands still have to be run, and each one gates its own
   evidence. */
import { ANGSO_GROUND_RINGS } from './angso-ground-rings.mjs';
import { JOHANNESBERG_GROUND_RINGS } from './johannesberg-ground-rings.mjs';
import { LIDINGO_GROUND_RINGS } from './lidingo-ground-rings.mjs';
import { NORRFALLSVIKEN_GROUND_RINGS } from './norrfallsviken-ground-rings.mjs';
import { PUTTOM_GROUND_RINGS } from './puttom-ground-rings.mjs';
import { RIBBINGSFORS_GROUND_RINGS } from './ribbingsfors-ground-rings.mjs';
import { TORTUNA_GROUND_RINGS } from './tortuna-ground-rings.mjs';
import { UPSALA_GROUND_RINGS } from './upsala-ground-rings.mjs';
import { VECKEFJARDEN_GROUND_RINGS } from './veckefjarden-ground-rings.mjs';
import { VISBY_GROUND_RINGS } from './visby-ground-rings.mjs';
import { STANDARD_RING_LEVELS } from './standard-ground-rings.mjs';

export const GROUND_RINGS = Object.freeze({
  angso: ANGSO_GROUND_RINGS,
  johannesberg: JOHANNESBERG_GROUND_RINGS,
  lidingo: LIDINGO_GROUND_RINGS,
  norrfallsviken: NORRFALLSVIKEN_GROUND_RINGS,
  puttom: PUTTOM_GROUND_RINGS,
  ribbingsfors: RIBBINGSFORS_GROUND_RINGS,
  tortuna: TORTUNA_GROUND_RINGS,
  upsala: UPSALA_GROUND_RINGS,
  veckefjarden: VECKEFJARDEN_GROUND_RINGS,
  visby: VISBY_GROUND_RINGS,
});

/* Every registered ground IS on the standard: a spec that drifted from it
   -- a narrowed ring, a moved lod, a level zero that is not sixteen wide --
   fails at import, before any command can read it. */
for (const [groundId, spec] of Object.entries(GROUND_RINGS)) {
  if (spec.groundId !== groundId) throw new Error(`ring specification registered as ${groundId} declares groundId ${spec.groundId}`);
  if (spec.levels.length !== STANDARD_RING_LEVELS.length) throw new Error(`${groundId} ring spec has ${spec.levels.length} levels; the standard has ${STANDARD_RING_LEVELS.length}`);
  spec.levels.forEach((level, index) => {
    const standard = STANDARD_RING_LEVELS[index];
    for (const key of ['lod', 'sampleSpacingMetres', 'tilesPerSide', 'heightScaleMetres']) {
      if (level[key] !== standard[key]) throw new Error(`${groundId} lod ${index} ${key} is ${level[key]}; the standard is ${standard[key]}`);
    }
    if (level.originEasting !== spec.centre.easting - standard.halfSpan || level.originNorthing !== spec.centre.northing + standard.halfSpan) {
      throw new Error(`${groundId} lod ${index} is not centred on the ground's frame centre`);
    }
  });
}

export function ringSpecFor(groundId) {
  const spec = GROUND_RINGS[groundId];
  if (!spec) {
    throw new Error(
      `no ring specification for ground ${groundId}; registered grounds are ${Object.keys(GROUND_RINGS).join(', ')}`,
    );
  }
  return spec;
}

export { dtmItemsFor, ringLevelExtent } from './standard-ground-rings.mjs';
