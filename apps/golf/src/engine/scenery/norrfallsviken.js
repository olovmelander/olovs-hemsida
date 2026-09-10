import { renderReviewedClubhouse, renderReviewedFacilities } from './norrfallsviken-architecture.mjs';
import { authoredSiteHeights } from './norrfallsviken-facilities.mjs';
import { isReviewedRangeFeature, prepareRangeScenery, renderRangeDetails } from './norrfallsviken-range.mjs';
export { loadFacilities, facilityFootprints, isFacilityInterior, isFacilityTreeObstruction, architectureStatus } from './norrfallsviken-facilities.mjs';
export const renderClubhouse = renderReviewedClubhouse;

/* THE DRIVING RANGE, read off the 2024 orthophoto and the club's 2025 range
   photograph (nvgkbuild/facilities/driving-range-review.json): twelve
   rectangular mats in three-mat groups on four separate concrete platforms,
   the gravel hardstanding behind them and the three turf target patches. The
   pack still carries the intake's round mat markers; this is a DISPLAY revision
   of those outlines by id, and source inspection (?buildingGeometry=source)
   returns the scenery itself, untouched and by identity. Applying it twice
   re-derives rather than accumulates. */
export function applySurfaceAppearance(scenery, { sourceView = false } = {}) {
  return sourceView ? scenery : prepareRangeScenery(scenery);
}

/* The measured surfaces the retained review draws (terrace, padel court, the
   ditch) and the reviewed range details are one courtyard pass: the range
   module owns its mats and targets, so the generic surface renderer must not
   draw them a second time from the same features. */
export const renderCourtyard = ctx => {
  const facilities = renderReviewedFacilities({ ...ctx,
    features: (ctx.features || []).filter(feature => !isReviewedRangeFeature(feature)),
    siteHeights: authoredSiteHeights() });
  const range = renderRangeDetails(ctx);
  return { triangles: facilities.triangles + range.triangles, counts: { ...facilities.counts, ...range.counts },
    evidence: `${facilities.evidence}; ${range.evidence}`,
    range: { platforms: range.platforms, limitations: range.limitations } };
};
export const customMappedKinds = ['range_mat', 'range_platform', 'range_target_surface', 'sports_court', 'terrace', 'ditch', 'clubhouse_roof_section', 'roof_solar'];

/* Norrfällsviken's course-specific scenery.

   Its two bespoke landmarks -- the 1649 chapel on its OSM footprint, and the
   boats moored along the marina piers -- are still drawn inline in main.js
   behind the feature guards they were written with. They render correctly
   there, and moving working code for symmetry is how a refactor turns into a
   regression; they come across when something asks them to. What is here is
   the one piece of this course's truth that the shared engine WAS carrying,
   and had no business carrying: the clearing in the far-vista forest. */

/* The chapel green and the harbour front are village lawn and bare rock, not
   forest. This is true of the place, and it is why the guard was written -- but
   it is currently INERT here, and saying so is the point of the note: the far
   scatter only runs outside the tree-cover raster's box, and at Norrfällsviken
   this point lies inside it, where the satellite raster already decides what
   grows. It is kept because the fact does not stop being true when the box
   moves, and because leaving it in the engine meant five other courses got a
   bald patch at Norrfällsviken's coordinate -- at Upsala, a real one. */
export const clearings = [
  { c: [-551, 1161], r: 90, wobble: 30 },
];

/* The clubhouse, from the club's own photographs.

   These notes once said "cream walls, red roof", which is the wrong way round:
   it is a Falu red timber building with WHITE window frames and corner boards,
   single storey, with a glazed veranda and a railed terrace standing above the
   green it looks over. Aerial imagery gives a roof and never a facade -- that
   part needed a picture from the ground.

   The ROOF was then wrong for the opposite reason, and it is worth writing down
   because it is the same mistake twice in one building. "Dark red-brown" came
   from a photograph in low light. Measured instead in FLAT OVERCAST -- the one
   condition where a colour can be trusted, with the sky sampling neutral at
   rgb(227,236,238) -- the roof is a red pantile: rgb(212,166,170) from the
   ground and rgb(190,130,119) from directly overhead in a drone frame. It is
   the same terracotta pantile as the chapel down in the village and as Ängsö's
   clubhouse, not a dark roof at all.

   The rule this keeps proving: a photograph at golden or blue hour tells you
   shape, never colour. Puttom's lower storey was painted blue for exactly this
   reason and had to be corrected too. */
export const clubhouse = {
  wall: 0x8b3a2c,          /* falurött */
  /* MEASURED in flat overcast, overhead and from the ground: red pantile */
  roof: 0xb5705f,
  height: 3.6,             /* one storey; the terrace does the rest */
  windowRows: [1.3],
  terrace: true,
};
