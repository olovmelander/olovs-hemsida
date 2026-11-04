// 48 px by default (owner decision, 4 November; 24 px, approved on 23 September, is
// the before). Explicit 0 retains geographic tree detail. Keep the hardware-measured
// thresholds and reject unsupported overrides.
export function distantHeroReviewPixels(search = '') {
  const value = new URLSearchParams(search).get('distanthero');
  if (value === null) return 48;
  return value === '16' ? 16 : value === '32' ? 32 : value === '48' ? 48 : value === '24' || value === '1' ? 24 : 0;
}
