import { buildingArchitecture, courtyardArchitecture } from './lidingo-architecture.js';

// Use the retained canopy raster for floor appearance; maintained surfaces win.
export const canopyFloor = true;

export const buildingLooks = {
  'way/32262183': { wall: 0xe6e5dd, roof: 0x343b3e },
  'way/32262176': { wall: 0xe6e5dd, roof: 0x343b3e },
  'way/32262169': { wall: 0xe6e5dd, roof: 0x343b3e },
};
export const clubhouse = { wall: 0xe6e5dd, roof: 0x343b3e, windowRows: [], terrace: false };

// The public 2024 courtyard photograph shows asphalt. Preserve all source
// rings and retain the source material label alongside the display override.
export function applySurfaceAppearance(scenery) {
  return { ...scenery, mappedFeatures: (scenery.mappedFeatures || []).map(f =>
    f.id === 'lidingo-courtyard-hardstanding-2019'
      ? { ...f, sourceMaterial: f.sourceMaterial ?? f.material, material: 'asphalt',
        appearanceEvidence: 'public-club-courtyard-photo-2024-07-06' }
      : f) };
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
export const isFacilityInterior = (x, z, margin) => activeFacilities?.isFacilityInterior(x, z, margin) ?? false;
export const architectureStatus = () => ({
  status: activeFacilities?.report.status ?? 'fallback',
  assetSha256: activeFacilities?.report.assetSha256 ?? null,
  buildings: activeFacilities?.replacedBuildingIds.size ?? 0,
  replacesCourtyard: activeFacilities?.report.replacesCourtyard ?? false,
  replacesRangeFacilities,
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
