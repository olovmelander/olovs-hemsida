/* The day's conditions: what the light and the weather do to the ball.

   The detailed course draws eleven lights, and Nu chooses one from the real sun
   and Open-Meteo's weather. A game played under them should play like them:
   - the storm and the mist leave the turf wet (the ground finish's own
     GROUND_WETNESS: storm 1, mist 0.6), and dawn's dew a little;
   - the summer day is firm and fast;
   - winter's snow stops a ball almost where it lands (and the ball is orange,
     as winter golfers' are);
   - cold air is thicker and carries a ball less far; warm air carries it further.

   The temperature is the weather's own when there is a reading (Nu), and
   otherwise a plausible one for the light. Gusts come and go stroke by stroke:
   the aid shows the mean wind, and the shot meets a gust drawn for it. Pure. */
import { SURFACES, BALL } from './ball-physics.mjs';

/* Each light's ground, and its air when no weather has been read. */
export const LIGHT_DAY = Object.freeze({
  golden:   { tempC: 17 },
  noon:     { tempC: 20, firm: .4 },
  summer:   { tempC: 24, firm: 1 },
  dawn:     { tempC: 11, wet: .3 },
  midnight: { tempC: 14, wet: .2 },
  bluehour: { tempC: 12, wet: .2 },
  storm:    { tempC: 12, wet: 1, gust: 1.6 },
  mist:     { tempC: 10, wet: .6 },
  host:     { tempC: 9, wet: .3 },
  winter:   { tempC: -3, snow: 1 },
});

/** The air's density at a temperature (kg/m3), the ball's 1.2 at 20 °C. */
export const airDensity = tempC => BALL.rho * 293.15 / (273.15 + tempC);

/**
 * The conditions of a light and a weather reading.
 *   preset   the light drawn (Nu's chosen one when Nu is on)
 *   wetness  the ground's wetness when the course says (GROUND_WETNESS), else the light's
 *   snow     whether snow lies (the winter light, or Nu in winter)
 *   weather  { tempC, gustMs, windMs } from a reading, or null
 */
export function conditionsFor({ preset = 'golden', wetness = null, snow = false, weather = null } = {}) {
  const day = LIGHT_DAY[preset] || LIGHT_DAY.golden;
  const wet = Math.max(0, Math.min(1, wetness ?? day.wet ?? 0)), firm = day.firm ?? 0;
  const white = snow || day.snow ? 1 : 0;
  const measured = Number.isFinite(weather?.tempC);
  const tempC = measured ? weather.tempC : day.tempC;
  // Wet turf takes the bounce and the run out of a ball; firm turf gives them back; snow keeps it.
  const roll = (1 + .55 * wet) * (1 - .15 * firm) * (1 + 1.4 * white);
  const bounce = (1 - .25 * wet) * (1 + .1 * firm) * (1 - .5 * white);
  const keep = (1 - .1 * wet) * (1 + .05 * firm) * (1 - .3 * white);
  const words = [];
  if (white) words.push('snö');
  else if (wet >= .6) words.push('blött');
  else if (wet > 0) words.push(preset === 'dawn' ? 'dagg' : 'fuktigt');
  else if (firm >= 1) words.push('fast och snabbt');
  const notes = [];
  if (white) notes.push('Snö: bollen stannar nästan där den landar, och greenerna är långsamma.');
  else if (wet >= .6) notes.push('Blött: bollen studsar lägre, rullar kortare och kan plugga i bunkern. Greenerna är långsammare.');
  else if (wet > 0) notes.push('Fuktigt: bollen rullar lite kortare.');
  else if (firm >= 1) notes.push('Fast och snabbt: bollen studsar högre och rullar längre.');
  notes.push(`${measured ? 'Luften' : 'Luften, uppskattad efter ljuset,'} är ${Math.round(tempC)} °C: ${tempC < 15 ? 'kall luft bär bollen kortare' : tempC > 25 ? 'varm luft bär bollen längre' : 'nära normal bärighet'}.`);
  return {
    preset, wet, firm, snow: Boolean(white), tempC, measured, rho: airDensity(tempC),
    roll, bounce, keep, plug: Math.min(1, wet + white * .5), gust: day.gust ?? 1.3,
    greenRoll: SURFACES.green.roll * roll,
    label: `${Math.round(tempC)} °C${words.length ? ` · ${words.join(', ')}` : ''}`,
    note: notes.join(' '),
    ball: white ? '#ff7a2a' : '#fbfaf3',
  };
}

/** The surfaces under these conditions, as the physics' world.ground(kind). */
export function groundWith(c) {
  const cache = new Map();
  return kind => {
    if (cache.has(kind)) return cache.get(kind);
    const s = SURFACES[kind] || SURFACES.rough;
    const out = kind === 'water' ? s : { ...s, roll: s.roll * c.roll, e: s.e * c.bounce, keep: Math.min(.95, s.keep * c.keep) };
    cache.set(kind, out);
    return out;
  };
}

/**
 * The wind a stroke meets: the mean, with a gust drawn for it. gustMs is the
 * reading's gust when there is one, otherwise the light's own share over the mean.
 * Returns [wx, wz] and how strong it is.
 */
export function strokeWind([wx, wz], { gustMs = null, share = 1.3 } = {}, rand = Math.random) {
  const ms = Math.hypot(wx, wz);
  if (ms < .3) return { wind: [wx, wz], ms, gust: 0 };
  const peak = Number.isFinite(gustMs) && gustMs > ms ? gustMs : ms * share;
  const k = 1 + (peak / ms - 1) * rand() * rand();     // most strokes meet the mean, some a gust
  const turn = (rand() - .5) * .14;                       // and its direction wanders a little
  const c = Math.cos(turn), s = Math.sin(turn);
  return { wind: [(wx * c - wz * s) * k, (wx * s + wz * c) * k], ms: ms * k, gust: ms * k - ms };
}
