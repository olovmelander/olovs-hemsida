import { authoredBuildings as clubhouseBuildings } from './tortuna-architecture.js';
import { facilityBuildings } from './tortuna-facilities.js';
export const authoredBuildings = [...clubhouseBuildings, ...facilityBuildings];
import { isReviewedRangeFeature, prepareRangeScenery, renderRangeDetails } from './tortuna-range.mjs';

/* THE DRIVING RANGE, measured off the retained 2026 native orthophoto
   (apps/golf/src/engine/scenery/tortuna-range-site.json): twenty-two hitting
   mats on the strip above the road, and the ball-stop net standing at the
   landing field's north-east boundary, its ten posts read off their own
   shadows. The pack still carries the earlier seventeen-ring reading of the
   same mats; this is a DISPLAY revision of those outlines, so source
   inspection (?buildingGeometry=source) returns the scenery itself, untouched
   and by identity, and applying it twice re-derives rather than accumulates. */
export function applySurfaceAppearance(scenery, { sourceView = false } = {}) {
  return sourceView ? scenery : prepareRangeScenery(scenery);
}

/* The range module owns its mats, so the generic surface renderer must not
   draw them a second time from the same features. The net is not drawn here:
   it is see-through, so it goes through the engine's own range-net mesh. */
export const renderCourtyard = ctx => renderRangeDetails(ctx);
export const customMappedKinds = ['range_mat'];
export { isReviewedRangeFeature };

/* Tortuna's clubhouse fallback appearance, reviewed against the club's own photographs
 * club-photo-17 (Klubben.jpeg) and club-photo-65 (DJI_0063-scaled.jpg), plus the
 * native 2026 orthophoto. Evidence: tortunabuild/reference/clubhouse-review.json.
 *
 * Both photographs show ochre-yellow vertical timber, white window/corner
 * trim, two storeys, a brown tiled pitched/hipped roof and a terrace facing
 * the pond. The source footprint stays in the course model. Eave height and
 * window elevations below are display estimates, not laser roof measurements.
 * The fallback generic shell approximates the intersecting roof. The source
 * building pass renders the independently retained April 2021 roof TIN when
 * available; none of the fallback heights below replace measured roof values.
 */
export const clubhouse = {
  wall: 0xd4b156,
  roof: 0x68574b,
  height: 6.2,
  windowRows: [1.1, 4.0],
  terrace: true,
};

// Keep the photographed colour identity even in a generic-building pass.
// The builder identifies this exact footprint as the clubhouse; its OSM source
// only said building=yes, so the name/role comes from the photo/ortho review.
export const buildingLooks = {
  'way/1163533127': { wall: clubhouse.wall, roof: clubhouse.roof, windows: true },
  // Native May 2026 roof appearances; illumination-dependent colour estimates.
  // Facade colours are intentionally unspecified without ground-photo evidence.
  // Detached yellow entry/courtyard building in official WP photo 2657/2827.
  'way/1163533128': { wall: 0xcba548, roof: 0xa7725f },
  'way/1163533113': { roof: 0xad7160 },
  'way/1163533114': { roof: 0x995f52 },
  'way/1163533115': { roof: 0xa97360 },
  'way/1163533123': { roof: 0x77716b },
  'way/1163607303': { roof: 0xab715a },
  'way/1384988126': { roof: 0x535c5e },
  'way/1384988127': { roof: 0x596061 },
  'tortuna-range-shelter': { roof: 0xdeded6 },
};

export const appearanceEvidence = {
  review: 'tortunabuild/reference/clubhouse-review.json',
  footprintId: 'way/1163533127',
  facadeSourceIds: ['club-photo-17', 'club-photo-65'],
  roofSourceId: 'imagery-lm-ortho',
  heightStatus: 'measured-source-roof-when-attached; photo-informed-display-estimate-for-fallback',
  measuredRoof: true,
  measuredRoofEpoch: '2021-04-05T12:00:00Z',
  roofGeometryReview: 'tortunabuild/mapping/building-roof-review.json',
  roofColourReview: 'tortunabuild/mapping/building-observations.json',
};
