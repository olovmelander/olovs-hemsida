/* Puttom's course-specific scenery. The Blender facility asset reconstructs
   the clubhouse, connected wings, range and nearby buildings from reviewed
   photographs, orthophotos and laser evidence. Source notes and uncertainty:
   puttombuild/facilities/models-2026-09-10/. The older appearance settings below
   provide a fallback if the complete authored asset cannot be validated. */
export const buildingLooks = {
  'trace-annex-a': { wall: 0x8b3a2c, roof: 0x4a4d50, windows: true },
  'trace-annex-b': { wall: 0x8b3a2c, roof: 0x4a4d50 },
  'trace-reception': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-east-house': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-vinkelhus': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-vinkelhus-arm': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-range-hut': { wall: 0x8b3a2c, roof: 0x3a3d40, windows: true },
  'trace-range-shed': { wall: 0x8b3a2c, roof: 0x34373b },
  'trace-yard-shed-long': { wall: 0x8b3a2c, roof: 0x2f3234 },
  'trace-yard-hall': { wall: 0x8b3a2c, roof: 0x2f3234 },
  'trace-yard-small': { wall: 0x6f6a62, roof: 0x2f3234 },
  'trace-house-red': { wall: 0x8b3a2c, roof: 0x9d3f2e },
};

export const clubhouse = {
  wall: 0x8b3a2c,          /* falurött, white-trimmed */
  lowerWall: null,
  lowerHeight: 0,
  roof: 0x34373b,          /* dark grey, steep */
  height: 6.6,             /* two full storeys to the eaves */
  windowRows: [1.5, 4.4],
  gable: true,             /* a gabled roof, not the hip the engine defaults to */
  glazedGable: true,       /* the window wall on the end that faces the course */
  balcony: true,
  terrace: true,
};

/* Install before cars and vegetation so the verified, corrected footprints
   also keep those objects out of the buildings. Appearance above is fallback. */
export const loadFacilitiesBeforeSurfaces = true;
export let replacesRangeFacilities = false;
let activeFacilities = null;
export const isFacilityInterior = (x, z, margin) => activeFacilities?.isFacilityInterior(x, z, margin) ?? false;

export async function loadFacilities(context) {
  const { loadPuttomFacilities } = await import('./puttom-facilities.mjs');
  activeFacilities = await loadPuttomFacilities(context);
  replacesRangeFacilities = activeFacilities.report.status === 'loaded' && activeFacilities.report.replacesRangeFacilities;
  return activeFacilities;
}
