/* NU: THE LIGHT OF THIS MOMENT OVER THE COURSE (docs/visual-winter-2026-11-06.md).
 *
 * The real sun over the course (solar.mjs, NOAA's equations), the season as it
 * usually is on that date and latitude, and the weather now, as Open-Meteo reads
 * it at the course (weather.js): one of the ten authored lights, chosen by these,
 * with the sun standing where it really stands. Pure, so every rule is tested.
 *
 *  - Night and dusk, the sun under 4 degrees below the horizon: the blue hour.
 *  - Rain or thunder: the storm. Falling snow, fog, or under 1.5 km to see: the
 *    mist. A sky over 85% covered: the mist, with clearer air than a fog's.
 *  - Snow on the ground (the reading's snow depth, or snow falling; without a
 *    reading, the season's) and a clear or broken sky: winter. The snow lies,
 *    and the broadleaves are bare, under whichever light the weather chose.
 *  - Otherwise by the sun: under 12 degrees dawn before noon and golden hour
 *    after it, or the midnight sun when a summer sun stands low in the north;
 *    higher, the cloudless summer day under a clear summer sky and the day else.
 *  - In autumn the leaves turn under any light; from the first frosts until the
 *    grass greens in spring it lies pale (`straw`, the autumn light's ochre on
 *    the ground); and in either a low sun is autumn's own.
 */
import { solarPosition, sunDirection, seasonAt } from './solar.mjs';

const DEGREES = Math.PI / 180;

export const NU = Object.freeze({
  /* the sun's height, in degrees, under which it is night, and under which a light is a low sun's */
  night: -4, low: 12,
  /* a midnight sun stands in the north: within 53 degrees of it (its azimuth's cosine over this),
     after about nine on a June evening; before that a low western sun is golden hour's */
  north: 0.6,
  /* covered over this share of the sky, it is overcast; under this, clear */
  overcast: 85, clear: 20,
  /* under this many metres to see, it is mist */
  fogMetres: 1500,
  /* this much snow on the ground covers it, in metres */
  snowMetres: 0.02,
  /* an overcast sky's air: thinner than the mist light's own fog */
  overcastDensity: 0.00055,
  /* the lowest each light lets the sun stand (its direction's y), so a low sun still lights the ground */
  lowest: Object.freeze({ midnight: 0.06, storm: 0.2, mist: 0.2 }), lowestElse: 0.1,
  /* the blue hour keeps its own height under the horizon: its afterglow stands where the sun set */
  dusk: -0.025,
  /* Nu looks again this often, and draws again only when the light or the sun has moved this far */
  refreshMs: 60000, sunStep: 0.02,
});

/* WMO weather codes (weather.js weatherWord): drizzle, rain, freezing rain and showers; snow; thunder; fog */
const RAIN = code => (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
const SNOWING = code => (code >= 71 && code <= 77) || code === 85 || code === 86;
const THUNDER = code => code >= 95;
const FOG = code => code === 45 || code === 48;

/** The sky a reading describes: 'storm', 'snowing', 'fog', 'overcast', 'clear', 'broken', or null without one. */
export function skyOf(weather) {
  if (!weather) return null;
  const code = weather.code;
  if (Number.isFinite(code) && (RAIN(code) || THUNDER(code))) return 'storm';
  if (Number.isFinite(code) && SNOWING(code)) return 'snowing';
  if ((Number.isFinite(code) && FOG(code)) || (Number.isFinite(weather.visibilityM) && weather.visibilityM < NU.fogMetres)) return 'fog';
  const cloud = Number.isFinite(weather.cloudPct) ? weather.cloudPct : code === 3 ? 100 : code === 0 ? 0 : Number.isFinite(code) ? 50 : null;
  if (cloud === null) return null;
  if (cloud >= NU.overcast) return 'overcast';
  return cloud <= NU.clear ? 'clear' : 'broken';
}

/** Whether snow lies: the reading's own depth, snow falling now, or without either the season's. */
export function snowLies(weather, season) {
  if (weather && Number.isFinite(weather.code) && SNOWING(weather.code)) return true;
  if (weather && Number.isFinite(weather.snowDepthM)) return weather.snowDepthM >= NU.snowMetres;
  return season.snow > 0.5;
}

/* the real sun's direction in the world (x east, y up, z south), at no lower than the light allows */
function sunFor(preset, position) {
  const d = sunDirection(position);
  const flat = Math.hypot(d[0], d[2]) || 1;
  const y = preset === 'bluehour' ? NU.dusk : Math.max(d[1], NU.lowest[preset] ?? NU.lowestElse);
  const across = Math.sqrt(1 - y * y);
  return [d[0] / flat * across, y, d[2] / flat * across];
}

/**
 * The light now: `{ preset, dir, snow, bare, autumn, overrides, sky, elevation, azimuth }`, with
 * `overrides` what setPreset lays over the preset (the sun's direction, the season and, under an
 * overcast sky, its air). `weather` is a reading from weather.js, or null.
 */
export function lightNow(date, latitude, longitude, weather = null) {
  const position = solarPosition(date, latitude, longitude);
  const elevation = position.elevation / DEGREES;
  const season = seasonAt(date, latitude);
  const sky = skyOf(weather);
  const snow = snowLies(weather, season);
  const bare = snow || season.bare > 0.5;
  const autumn = !bare && season.autumn > 0.5;
  const straw = !snow && (season.autumn > 0.5 || season.dormant > 0.5);
  const summer = season.dormant < 0.5 && season.autumn < 0.5;
  let preset;
  if (elevation < NU.night) preset = 'bluehour';
  else if (sky === 'storm') preset = 'storm';
  else if (sky === 'snowing' || sky === 'fog' || sky === 'overcast') preset = 'mist';
  else if (snow) preset = 'winter';
  else if (elevation < NU.low) {
    const northern = Math.cos(position.azimuth) > NU.north;
    preset = autumn || straw ? 'host' : summer && northern ? 'midnight' : position.azimuth < Math.PI ? 'dawn' : 'golden';
  } else preset = sky === 'clear' && summer ? 'summer' : 'noon';
  const dir = sunFor(preset, position);
  const overrides = { dir, snow: snow ? 1 : 0, bare: bare ? 1 : 0, autumn: autumn ? 1 : 0, straw: straw ? 1 : 0,
    ...(sky === 'overcast' ? { dens: NU.overcastDensity } : {}) };
  return { preset, dir, snow: overrides.snow, bare: overrides.bare, autumn: overrides.autumn, straw: overrides.straw,
    overrides, sky, elevation, azimuth: position.azimuth };
}

/** Two lights of the moment draw the same picture: the same light, season and air, and the sun within a step. */
export function sameLight(a, b) {
  if (!a || !b || a.preset !== b.preset || a.snow !== b.snow || a.bare !== b.bare || a.autumn !== b.autumn
    || a.straw !== b.straw || a.overrides.dens !== b.overrides.dens) return false;
  return a.dir.every((v, i) => Math.abs(v - b.dir[i]) < NU.sunStep);
}
