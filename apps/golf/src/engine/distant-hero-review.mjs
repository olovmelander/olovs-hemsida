// Owner-approved 24 px default; explicit 0 retains geographic tree detail.
// Keep the two hardware-measured thresholds and reject unsupported overrides.
export function distantHeroReviewPixels(search = '') {
  const value = new URLSearchParams(search).get('distanthero');
  if (value === null) return 24;
  return value === '16' ? 16 : value === '24' || value === '1' ? 24 : 0;
}
