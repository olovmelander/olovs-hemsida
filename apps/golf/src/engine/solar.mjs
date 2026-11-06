/* THE SUN AND THE SEASONS OVER A COURSE, pure, so they can be held to the almanac
   (map/map-light.test.mjs). The map's Nu and the simulator's (light-now.mjs) both
   stand under this sun: moved here from map/map-light.mjs, which re-exports it. */
const DEGREES = Math.PI / 180;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

/* Where the sun stands, by NOAA's solar calculator: within a fraction of a degree
   for any date this app will see. Azimuth is clockwise from north. */
export function solarPosition(date, latitude, longitude) {
  const century = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  const meanLongitude = (280.46646 + century * (36000.76983 + century * 0.0003032)) % 360;
  const anomaly = 357.52911 + century * (35999.05029 - 0.0001537 * century);
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const a = anomaly * DEGREES;
  const centre = Math.sin(a) * (1.914602 - century * (0.004817 + 0.000014 * century))
    + Math.sin(2 * a) * (0.019993 - 0.000101 * century) + Math.sin(3 * a) * 0.000289;
  const node = (125.04 - 1934.136 * century) * DEGREES;
  const apparent = (meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(node)) * DEGREES;
  const meanObliquity = 23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(node)) * DEGREES;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparent));
  const y = Math.tan(obliquity / 2) ** 2;
  const l = meanLongitude * DEGREES;
  const equationOfTime = 4 / DEGREES * (y * Math.sin(2 * l) - 2 * eccentricity * Math.sin(a)
    + 4 * eccentricity * y * Math.sin(a) * Math.cos(2 * l) - 0.5 * y * y * Math.sin(4 * l) - 1.25 * eccentricity * eccentricity * Math.sin(2 * a));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = ((minutes + equationOfTime + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = (trueSolar / 4 - 180) * DEGREES;
  const phi = latitude * DEGREES;
  const elevation = Math.asin(clamp(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle), -1, 1));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi)) + Math.PI;
  return { elevation, azimuth: (azimuth + Math.PI * 2) % (Math.PI * 2) };
}

/* x east, y up, z south: the map's world. */
export const sunDirection = ({ elevation, azimuth }) => [
  Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation),
];

const dayOfYear = date => Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);

/* Swedish seasons, by day of the year: leaves turn from September and are down by
   mid-November, the grass lies pale from the first hard frosts until it greens in
   spring, and snow lies from December to March, a few days longer for every degree
   north. This is what the season usually is, not what the weather is today. */
export function seasonAt(date, latitude = 60) {
  const day = dayOfYear(date);
  const bare = Math.max(smooth(295, 320, day), 1 - smooth(110, 135, day));
  const autumn = day < 200 ? 0 : smooth(250, 275, day) * (1 - bare);
  const dormant = Math.max(smooth(300, 325, day), 1 - smooth(95, 130, day));
  const north = (latitude - 60) * 4;
  const snow = Math.max(smooth(335 - north, 350 - north, day), 1 - smooth(70 + north, 92 + north, day));
  return { autumn, dormant, bare, snow };
}
