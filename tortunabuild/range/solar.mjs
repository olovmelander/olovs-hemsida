/* NOAA solar position. Used to turn a measured shadow length in the retained
 * orthophoto into an object height. The capture instant comes from the source
 * item's own STAC record, so nothing here is fitted to the objects measured. */
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

export function solarPosition(iso, latitude, longitude) {
  const date = new Date(iso);
  const julian = date.getTime() / 86400000 + 2440587.5;
  const t = (julian - 2451545) / 36525;                                   /* Julian centuries */
  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t)
    + Math.sin(rad(3 * meanAnom)) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(meanLong)) - 2 * eccent * Math.sin(rad(meanAnom))
    + 4 * eccent * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong))
    - 0.5 * y * y * Math.sin(4 * rad(meanLong)) - 1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom)));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = (minutes + eqTime + 4 * longitude + 1440) % 1440;
  const hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;
  const cosZenith = Math.sin(rad(latitude)) * Math.sin(rad(declination))
    + Math.cos(rad(latitude)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle));
  const zenith = deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
  /* Refraction matters at low sun; at 40 deg it is under a minute of arc. */
  const e = 90 - zenith, tanE = Math.tan(rad(e));
  const refraction = e > 85 ? 0 : e > 5 ? (58.1 / tanE - 0.07 / tanE ** 3 + 0.000086 / tanE ** 5) / 3600
    : e > -0.575 ? (1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)))) / 3600 : -20.772 / tanE / 3600;
  const elevation = e + refraction;
  let azimuth = deg(Math.acos(Math.min(1, Math.max(-1,
    (Math.sin(rad(latitude)) * Math.cos(rad(zenith)) - Math.sin(rad(declination)))
    / (Math.cos(rad(latitude)) * Math.sin(rad(zenith)))))));
  azimuth = hourAngle > 0 ? (azimuth + 180) % 360 : (540 - azimuth) % 360;
  return { elevationDeg: elevation, azimuthDeg: azimuth, declinationDeg: declination, equationOfTimeMinutes: eqTime };
}

/** Shadow bearing is the anti-solar bearing; height = length * tan(elevation). */
export const shadowBearingDeg = sun => (sun.azimuthDeg + 180) % 360;
export const heightFromShadow = (metres, sun) => metres * Math.tan(rad(sun.elevationDeg));
export const shadowFromHeight = (metres, sun) => metres / Math.tan(rad(sun.elevationDeg));
