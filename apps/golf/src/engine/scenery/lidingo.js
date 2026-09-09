import { buildingArchitecture, courtyardArchitecture } from './lidingo-architecture.js';

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
  return emit(buildingArchitecture(building,terrainH),tri,L);
}
export function renderCourtyard({features,buildings,terrainH,tri,L}) {
  return emit(courtyardArchitecture(features,buildings,terrainH),tri,L);
}
