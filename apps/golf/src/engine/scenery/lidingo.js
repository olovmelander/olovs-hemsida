import { buildingArchitecture, courtyardArchitecture } from './lidingo-architecture.js';
import { createPracticeSurfaceFeatures, isPracticeSurfaceInterior } from './lidingo-practice-surfaces.mjs';

// Use the retained canopy raster for floor appearance; maintained surfaces win.
export const canopyFloor = true;

/* The far cone ring reaches the edge of the land-cover record (±6400 m), not
   the engine's default ±5400: the ring world runs to 8192 m and the horizon
   the course looks at -- Bogesundslandet across Askrikefjärden, Täby beyond
   -- lies between those two lines. Past the record this measured-only course
   plants nothing, so the record's own box is the honest limit. */
export const farRing = { x0: -6400, x1: 6400, z0: -6400, z1: 6400 };

export const buildingLooks = {
  'way/32262183': { wall: 0xe6e5dd, roof: 0x343b3e },
  'way/32262176': { wall: 0xe6e5dd, roof: 0x343b3e },
  'way/32262169': { wall: 0xe6e5dd, roof: 0x343b3e },
};
export const clubhouse = { wall: 0xe6e5dd, roof: 0x343b3e, windowRows: [], terrace: false };

/* The confidence-traced practice surfaces that are currently applied. They are
   display-only additions over retained 1 m terrain, so nothing outside this
   module may treat them as survey: the tree exclusion below and the ground
   atlas read them, and source inspection must see neither. */
let activePracticeSurfaces = [];

// The public 2024 courtyard photograph shows asphalt. Preserve all source
// rings and retain the source material label alongside the display override.
//
// SOURCE INSPECTION RETURNS THE SCENERY ITSELF, unchanged and by identity:
// ?buildingGeometry=source exists to show the pack as it was measured, and a
// copy carrying a display override is not that. Otherwise the seven reviewed
// practice surfaces are appended as displayOnly features -- the originals pass
// through by identity, so nothing downstream can mistake a display addition for
// a source ring. Applying twice re-derives rather than accumulates, because the
// engine may hand back a scenery this function already returned.
export function applySurfaceAppearance(scenery, { sourceView = false } = {}) {
  if (sourceView) { activePracticeSurfaces = []; return scenery; }
  const source = (scenery.mappedFeatures || []).filter(f => !f.displayOnly);
  const practice = createPracticeSurfaceFeatures();
  activePracticeSurfaces = practice;
  return { ...scenery, mappedFeatures: [...source.map(f =>
    f.id === 'lidingo-courtyard-hardstanding-2019'
      ? { ...f, sourceMaterial: f.sourceMaterial ?? f.material, material: 'asphalt',
        appearanceEvidence: 'public-club-courtyard-photo-2024-07-06' }
      : f), ...practice] };
}
function emit(details,tri,L) {
  if(!details) return null;
  const colors=new Map();
  for(const t of details.triangles) {
    if(!colors.has(t.color)) colors.set(t.color,L(t.color));
    tri(...t.points,colors.get(t.color));
  }
  return { buildingId:details.buildingId,triangles:details.triangles.length,parts:details.parts,
    evidence:details.evidence,sourceRoofTriangles:details.sourceRoofTriangles };
}
export function renderArchitecture({building,terrainH,tri,L}) {
  if (activeFacilities?.report.status === 'loaded' && activeFacilities.replacedBuildingIds.has(building.id)) return null;
  return emit(buildingArchitecture(building,terrainH),tri,L);
}
export function renderCourtyard({features,buildings,terrainH,tri,L}) {
  if (activeFacilities?.report.status === 'loaded' && activeFacilities.report.replacesCourtyard) return null;
  return emit(courtyardArchitecture(features,buildings,terrainH),tri,L);
}

// Load the verified Blender asset before parking and vegetation are batched.
// The shared pipeline bypasses this hook entirely for buildingGeometry=source.
export const loadFacilitiesBeforeSurfaces = true;
export let replacesRangeFacilities = false;
let activeFacilities = null, facilitiesGeneration = 0;
/* A tree may not stand on a practice green or in a practice bunker, so the
   exclusion covers the applied display surfaces as well as the authored
   buildings. In source inspection the list is empty and only the buildings
   exclude, which is what makes the surfaces reversible. */
export const isFacilityInterior = (x, z, margin) =>
  (activeFacilities?.isFacilityInterior(x, z, margin) ?? false)
  || isPracticeSurfaceInterior(activePracticeSurfaces, x, z, margin);
export const architectureStatus = () => ({
  status: activeFacilities?.report.status ?? 'fallback',
  assetSha256: activeFacilities?.report.assetSha256 ?? null,
  buildings: activeFacilities?.replacedBuildingIds.size ?? 0,
  replacesCourtyard: activeFacilities?.report.replacesCourtyard ?? false,
  replacesRangeFacilities,
  practiceSurfaceCount: activePracticeSurfaces.length,
  practiceSurfaceIds: activePracticeSurfaces.map(feature => feature.id),
});

export async function loadFacilities(context) {
  const generation = ++facilitiesGeneration;
  activeFacilities?.dispose();
  activeFacilities = null;
  replacesRangeFacilities = false;
  const { loadLidingoFacilities } = await import('./lidingo-facilities.mjs');
  const result = await loadLidingoFacilities({ ...context,
    isCurrentCourse: () => generation === facilitiesGeneration && (context.isCurrentCourse?.() ?? true) });
  if (generation !== facilitiesGeneration) {
    result.dispose();
    return result;
  }
  activeFacilities = result;
  replacesRangeFacilities = result.report.status === 'loaded' && result.report.replacesRangeFacilities;
  const dispose = result.dispose;
  result.dispose = () => {
    dispose();
    if (activeFacilities === result) {
      activeFacilities = null;
      replacesRangeFacilities = false;
    }
  };
  return result;
}
