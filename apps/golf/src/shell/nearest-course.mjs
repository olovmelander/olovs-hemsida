/* Which courses lie nearest a phone. Pure, and light enough for the front door: the
   places come from course-places.mjs, never from the Leaflet map beside them. */
const EARTH_RADIUS_METRES = 6371000;
const radians = degrees => degrees * Math.PI / 180;

export function metresBetween(a, b) {
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h));
}

export const coursesByDistance = ({ latitude, longitude }, places) => Object.entries(places)
  .map(([slug, place]) => ({ slug, metres: metresBetween({ lat: latitude, lng: longitude }, place) }))
  .sort((a, b) => a.metres - b.metres);

export function distanceText(metres) {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 10000) return `${(metres / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(metres / 1000)} km`;
}
