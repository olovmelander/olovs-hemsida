import review from '../../../../../johannesbergbuild/mapping/ground-surface-review.json' with { type: 'json' };

export const JOHANNESBERG_GROUND_REVIEW = review;
export const groundAppearance = Object.freeze({
  palette: Object.freeze({ rock: review.appearance.rock, gravel: review.appearance.gravel }),
  rockFromSlope: review.appearance.rockFromSlope,
});

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Apply the source review to the inherited pack before any surface, tint or
 * vegetation classification. Both courses carry the same historical estate.
 * The old vectors remain the pinned migration baseline, not current truth.
 * Geometry mismatches are refused so a later source update cannot be silently
 * overwritten by this review. No elevation or playing geometry is modified. */
export function applyGroundSurfaceReview(model, geo) {
  if (geo?.origin?.lat !== review.frame.origin.lat || geo?.origin?.lon !== review.frame.origin.lon
    || !Number.isFinite(geo.mPerLon) || Math.abs(geo.mPerLon - review.frame.metresPerLongitude) > .02) {
    throw new Error('Johannesberg ground review: coordinate frame mismatch');
  }
  const vegetation = model.veg ?? model.vegetation;
  const rocks = review.features.filter(f => f.material === 'rock').flatMap(f => structuredClone(f.rings));
  const gravel = review.features.filter(f => f.material === 'gravel').map(f => ({
    id: f.id, kind: 'hardstanding', material: 'gravel', rings: structuredClone(f.rings),
    reviewId: review.id, sourceId: f.sourceId, boundaryUncertaintyMetres: f.boundaryUncertaintyMetres,
  }));
  if (model.groundSurfaceReview?.id === review.id) {
    if (model.surround?.yard !== null || !same(vegetation?.rock, rocks)
      || !gravel.every(f => same(model.scenery?.mappedFeatures?.find(g => g.id === f.id), f))) {
      throw new Error('Johannesberg ground review: reviewed geometry changed');
    }
    return model.groundSurfaceReview;
  }
  if (!same(model.surround?.yard, review.baseline.yard) || !same(vegetation?.rock, review.baseline.rock)) {
    throw new Error('Johannesberg ground review: inherited surface geometry changed');
  }
  const mapped = model.scenery?.mappedFeatures ?? [];
  if (gravel.some(f => mapped.some(g => g.id === f.id))) {
    throw new Error('Johannesberg ground review: duplicate surface identity');
  }
  // The source shows grass, trees and small mineral exposures in these former
  // solid fills. Keep natural ground between the observed surface polygons.
  model.surround.yard = null;
  vegetation.rock = rocks;
  model.scenery = { ...model.scenery, mappedFeatures: [...mapped, ...gravel] };
  model.groundSurfaceReview = {
    id: review.id, source: 'Lantmäteriet Ortofoto_0.16',
    rockSurfaces: rocks.length, hardstandingSurfaces: gravel.length,
    terrainModified: false,
  };
  return model.groundSurfaceReview;
}
