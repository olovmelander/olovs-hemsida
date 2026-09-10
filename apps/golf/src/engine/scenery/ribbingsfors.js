/* Ribbingsfors Golf & Kultur's course-specific scenery.

   The clubhouse appearance is taken only as a visual reference from the club's
   own 2024 photograph:
   https://ribbingsforsgk.se/wp-content/uploads/2024/07/5I8A1673_fullres-scaled.jpg

   It is a long, simple timber building in the Ribbingsfors manor environment:
   pale warm-yellow vertical boarding with light grey-white corner boards and
   window trim, beneath a low red-orange clay-tile gable roof. The photograph
   also shows a brick chimney, grey-painted multipane openings and a timber
   terrace along the long facade. Only the palette and supported generic
   clubhouse traits are encoded here; the photograph is not redistributed. */
export const clubhouse = {
  wall: 0xcdbb86,          /* pale warm-yellow timber */
  roof: 0xa44f32,          /* red-orange clay tile */
  height: 3.8,             /* one storey with usable space beneath the gable */
  windowRows: [1.3],
  gable: true,
  terrace: true,
};

/* THE AUTHORED FACILITIES, from the 2024-05-17 Lantmäteriet orthophoto and the
   club's 2024-07-12 photographs (ribbingsforsbuild/facilities/README.md). The
   pack is authored directly in the grid frame, so the Blender scene's metres
   ARE this course's local metres and no bridge is applied: the clubhouse with
   its wraparound deck, the range shelter and its nine mats between low masonry
   dividers, the manor precinct the retained model never had, the estate roofs
   and the maintenance yard. Each authored roof either REPLACES the retained
   source building whose centroid it contains or is a new structure; retained
   satellite rectangles the review refuses -- the "clubhouse annex" that is the
   clubhouse's own shadow, the yard boxes drawn over an open arena -- are
   suppressed with the review's reason written in the manifest. A failed load
   leaves every retained building standing, and the appearance above is then
   the clubhouse's fallback. */
import facilitiesManifest from '../../../public/models/ribbingsfors/facilities-v1.json';
import { ringSD } from '../geom.js';

/* Roof footprints of the NEW structures exclude display vegetation; the mats,
   dividers and picnic table must never clear a woodland. Replaced source
   buildings keep excluding through their own retained rings. */
export const facilityFootprints = facilitiesManifest.facilities
  .filter(f => f.sourceFeatureId && f.kind === 'roof' && f.footprintLocal)
  .map(f => ({ id: f.id, ring: f.footprintLocal }));
export const isFacilityInterior = (x, z, margin = .2) =>
  facilityFootprints.some(f => ringSD(x, z, f.ring) <= margin);

// The verified Blender asset installs before parking and vegetation are batched,
// so its footprints take part in every exclusion the generic buildings do.
export const loadFacilitiesBeforeSurfaces = true;
export let replacesRangeFacilities = false;
let activeFacilities = null, facilitiesGeneration = 0;
export const architectureStatus = () => ({
  status: activeFacilities?.report.status ?? 'fallback',
  assetSha256: activeFacilities?.report.assetSha256 ?? null,
  buildings: activeFacilities?.replacedBuildingIds.size ?? 0,
  suppressedBuildingIds: activeFacilities?.report.suppressedBuildingIds ?? [],
  replacesRangeFacilities,
});

export async function loadFacilities(context) {
  const generation = ++facilitiesGeneration;
  activeFacilities?.dispose();
  activeFacilities = null;
  replacesRangeFacilities = false;
  const { loadRibbingsforsFacilities } = await import('./ribbingsfors-facilities.mjs');
  const result = await loadRibbingsforsFacilities({ ...context,
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
