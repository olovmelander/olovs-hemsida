/* Deterministic surface-feature extraction shared by the legacy ground atlas
   and the v2 surface compiler. The GPK1 vectors are a migration source, not
   survey-approved surface truth; callers that publish its output must retain
   that provenance in their descriptor. */

import { smoothMownEdges } from './ring-smoothing.mjs';
import { SURFACE } from './surface.js';
import { withInferredTeePads } from './tee-pads.mjs';

function validRings(value) {
  return (value || []).filter(ring => Array.isArray(ring) && ring.length >= 3);
}

function hardSurface(item) {
  const value = `${item?.surface || ''} ${item?.kind || ''}`.toLowerCase();
  if (/asphalt|paved|trunk|secondary|tertiary|cycleway/.test(value)) return SURFACE.ASPHALT;
  if (/mud/.test(value)) return SURFACE.MUD;
  if (/dirt|ground|earth|soil/.test(value)) return SURFACE.DIRT;
  return SURFACE.GRAVEL;
}

/**
 * Recreate the exact polygon/line precedence used by the GPK1 runtime atlas.
 * This intentionally has no Three.js dependency so Node compilers can produce
 * byte-stable preview surface tiles from the same migration geometry.
 */
export function buildGroundSurfaceFeatures({
  holes: sourceHoles = [], model: sourceModel = {}, smoothEdges = false, inferTeePads = false,
} = {}) {
  if (!Array.isArray(sourceHoles)) throw new TypeError('holes must be an array');
  if (!sourceModel || typeof sourceModel !== 'object') throw new TypeError('model must be an object');
  /* The app infers its synthesised tee pads and smooths its mown edges IN
     PLACE at boot, in that order, and then builds its atlas from the result,
     so at runtime this must do neither again. A compiler reading a pack from
     disk sees the raw rings and asks for the same treatment here, which is
     what makes its raster the one the app draws. */
  let holes = inferTeePads ? withInferredTeePads(sourceHoles) : sourceHoles;
  let model = sourceModel;
  if (smoothEdges) {
    const smoothed = smoothMownEdges({ holes, scenery: sourceModel.scenery || {},
      preserveMappedBoundaries: sourceModel.infra?.preserveMappedBoundaries === true });
    holes = smoothed.holes;
    model = { ...sourceModel, scenery: smoothed.scenery };
  }

  const features = [];
  const sandPad = model.infra?.preserveMappedBoundaries === true ? 0 : 0.5;
  const rings = (surface, source, extra = {}) => {
    const values = validRings(source);
    if (values.length) features.push({ surface, rings: values, ...extra });
  };
  const line = (surface, item, width) => {
    if (Array.isArray(item?.line) && item.line.length > 1) {
      features.push({ surface, line: item.line, width });
    }
  };

  for (const hole of holes) {
    if (!hole || typeof hole !== 'object') continue;
    const owner = Number.isSafeInteger(hole.n) && hole.n >= 0 && hole.n <= 65535 ? hole.n : 0;
    rings(SURFACE.SEMI, hole.fairway?.rings, { pad: 4.5, hole: owner });
    rings(SURFACE.FAIRWAY, hole.fairway?.rings, { hole: owner });
    rings(SURFACE.FRINGE, [hole.green?.ring], { pad: 3.2, hole: owner });
    rings(SURFACE.GREEN, [hole.green?.ring], { hole: owner });
    const tees = (hole.tees?.pads || []).map(tee => tee?.ring);
    rings(SURFACE.FRINGE, tees, { pad: 2.2, hole: owner });
    rings(SURFACE.TEE, tees, { hole: owner });
    rings(SURFACE.SAND, (hole.bunkers || []).map(bunker => bunker?.ring), { pad: sandPad, hole: owner });
  }

  const scenery = model.scenery || {};
  const vegetation = model.veg || {};
  const infrastructure = model.infra || {};
  rings(SURFACE.FAIRWAY, [...(scenery.fairways || []), ...(scenery.range || [])]);
  rings(SURFACE.GREEN, scenery.greens);
  rings(SURFACE.TEE, scenery.tees);
  rings(SURFACE.SEMI, scenery.grass);
  rings(SURFACE.SAND, [...(scenery.bunkers || []), ...(vegetation.sand || [])], { pad: sandPad });

  // These are complete polygons, not independent outer rings: an interior island
  // must remain excluded from the putting turf in the atlas and v2 compiler.
  for (const feature of scenery.mappedFeatures || []) {
    const surface = feature.kind === 'practice_green' ? SURFACE.GREEN
      : feature.kind === 'range_bunker' || feature.kind === 'practice_bunker' ? SURFACE.SAND
        : feature.kind === 'range_tee_pad' && feature.material === 'unverified-turf-surface' ? SURFACE.TEE : null;
    if (surface !== null && validRings(feature.rings).length) {
      features.push({ surface, polygons: [{ rings: feature.rings }], sourceId: feature.id });
    }
  }

  for (const [kind, source] of Object.entries(vegetation)) {
    if (kind === 'sand') continue;
    const surface = /forest|wood|scrub/.test(kind) ? SURFACE.FOREST
      : /wet|marsh|bog/.test(kind) ? SURFACE.WETLAND
        : /rock|stone|scree/.test(kind) ? SURFACE.ROCK
          : /mud/.test(kind) ? SURFACE.MUD : null;
    if (surface !== null) rings(surface, source);
  }

  // A source asphalt tag overrides the historical gravel default; 'unpaved'
  // must not accidentally match 'paved'. Other grounds retain their default.
  const parking = infrastructure.parking || [];
  const parkingSurface = item => /\b(asphalt|paved)\b/i.test(item?.surface || '') ? SURFACE.ASPHALT : SURFACE.GRAVEL;
  for (const surface of new Set(parking.map(parkingSurface))) {
    rings(surface, parking.filter(item => parkingSurface(item) === surface).map(item => item?.ring));
  }
  for (const path of infrastructure.paths || []) line(
    hardSurface(path), path, path?.kind === 'cycleway' ? 1.3 : 0.65,
  );
  for (const track of infrastructure.tracks || []) line(
    hardSurface(track), track, track?.kind === 'service' ? 1.9 : 1.7,
  );
  /* Roads and railway render as raised ribbons too, but keeping their class in
     the atlas prevents vegetation/scatter placement beneath those ribbons. */
  for (const road of infrastructure.roads || []) line(
    hardSurface(road), road,
    road?.kind === 'trunk' ? 8 : road?.kind === 'secondary' || road?.kind === 'tertiary' ? 3.2 : 2.7,
  );
  for (const railway of infrastructure.railway || []) line(SURFACE.GRAVEL, railway, 4);

  return Object.freeze(features.map(feature => Object.freeze(feature)));
}
