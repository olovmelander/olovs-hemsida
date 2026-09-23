// Owner-review experiment only. Ordinary visits keep geographic tree detail.
// Restrict the prototype to the two thresholds being compared on hardware.
export function distantHeroReviewPixels(search = '') {
  const value = new URLSearchParams(search).get('distanthero');
  return value === '16' ? 16 : value === '24' || value === '1' ? 24 : 0;
}
