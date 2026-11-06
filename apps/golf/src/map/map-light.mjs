/* The map's lights. Pure, so the sun can be tested against the almanac.

   The nine named lights are the simulator's own: every colour here is read from
   its presets (engine/atmosphere-presets.mjs and painted-world-palette.mjs), so the
   two modes cannot drift apart. Only how much each takes from direct sun and how
   bright it stands are set here, because the map is lit by a simpler sum.

   `Nu` is the tenth: the real sun over the course at this moment, by NOAA's solar
   equations, in the colours of the named lights it falls between. */
import { ATMOSPHERE_PRESETS } from '../engine/atmosphere-presets.mjs';
import { AUTUMN_FOLIAGE, paintedAtmosphere } from '../engine/painted-world-palette.mjs';
import { solarPosition, sunDirection, seasonAt } from '../engine/solar.mjs';

const DEGREES = Math.PI / 180;

const rgb = hex => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
const normalize = v => { const l = Math.hypot(...v) || 1; return v.map(n => n / l); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
/* A colour's hue with its green at one, so a tint never changes the brightness. */
const hue = colour => colour.map(n => n / Math.max(colour[1], 0.001));

/* direct: the share of the light that comes straight from the sun.
   exposure: how bright the ground stands, with the summer day at one. */
const LIGHT_TABLE = Object.freeze([
  { key: 'sommar', preset: 'summer', label: 'Sommar', direct: 1, exposure: 1 },
  { key: 'dag', preset: 'noon', label: 'Dag', direct: 0.92, exposure: 0.98 },
  { key: 'kvall', preset: 'golden', label: 'Kväll', direct: 0.88, exposure: 0.95 },
  { key: 'gryning', preset: 'dawn', label: 'Gryning', direct: 0.62, exposure: 0.88 },
  { key: 'midnatt', preset: 'midnight', label: 'Midnattssol', direct: 0.74, exposure: 0.9 },
  { key: 'host', preset: 'host', label: 'Höst', direct: 0.86, exposure: 0.98, autumn: 1 },
  { key: 'dis', preset: 'mist', label: 'Dis', direct: 0.16, exposure: 0.98, saturation: 0.82 },
  { key: 'ovader', preset: 'storm', label: 'Oväder', direct: 0.12, exposure: 0.74, saturation: 0.8 },
  { key: 'bla', preset: 'bluehour', label: 'Blå timmen', direct: 0.06, exposure: 0.56, saturation: 0.86 },
]);

/* Low suns light the ground from their true height, but a shadow that long would
   lie across hills it cannot follow: it is cast from no lower than this. */
const SHADOW_HEIGHT = 0.36, LOWEST_LIGHT = 0.1;

function raised(direction, least) {
  const flat = Math.hypot(direction[0], direction[2]) || 1;
  const height = Math.max(direction[1], least);
  return normalize([direction[0] / flat * Math.sqrt(1 - height * height), height, direction[2] / flat * Math.sqrt(1 - height * height)]);
}

const atmosphere = entry => paintedAtmosphere(entry.preset, ATMOSPHERE_PRESETS[entry.preset]);
/* The colour a light gives the ground, before it is measured against the summer. */
const groundHue = entry => {
  const p = atmosphere(entry);
  const sunHue = hue(rgb(p.sun)), skyHue = hue(rgb(p.hemiS));
  return sunHue.map((n, i) => lerp(skyHue[i], n, entry.direct * 0.82 + 0.18));
};
/* The summer day is the map's neutral: its colours are the painted ones exactly, so
   sand stays sand, and every other light is read as a departure from it. Only part
   of a light's colour goes to the ground, or a low sun turns the grass to olive. */
const NEUTRAL = groundHue(LIGHT_TABLE[0]);
const GROUND_TINT = 0.55;

function buildLight(entry) {
  const p = atmosphere(entry);
  const sunHue = hue(rgb(p.sun)), skyHue = hue(rgb(p.hemiS));
  const direction = normalize(p.dir);
  const { direct, exposure } = entry;
  const reach = 0.3 + 0.7 * direct;
  return {
    key: entry.key,
    label: entry.label,
    sun: raised(direction, LOWEST_LIGHT),
    shadowSun: raised(direction, SHADOW_HEIGHT),
    sunShare: reach,
    grade: groundHue(entry).map((n, i) => exposure * lerp(1, n / NEUTRAL[i], GROUND_TINT)),
    warm: sunHue.map(n => lerp(1, n, 0.4)),
    cool: skyHue.map(n => lerp(1, n, 0.55)),
    haze: rgb(p.paintedFog ?? p.fog),
    zenith: rgb(p.skyZenith),
    horizon: rgb(p.skyHorizon),
    treeSun: sunHue.map(n => n * 1.24 * exposure * reach),
    treeSky: skyHue.map(n => n * 0.72 * exposure),
    shadow: [0.5, 0.55, 0.64].map(n => lerp(1, n, clamp(direct * 1.05, 0, 1))),
    waterNear: rgb(p.water?.[0] ?? 0x2f858e).map(n => n * Math.min(exposure * 1.05, 1.05)),
    waterFar: rgb(p.water?.[1] ?? 0x1b5084).map(n => n * Math.min(exposure * 1.05, 1.05)),
    cloud: [p.cloudShadow?.cover ?? 0, (p.cloudShadow?.opacity ?? 0) * reach],
    skyClouds: Math.min((p.cloud ?? 0) * 1.5, 1),
    saturation: entry.saturation ?? 1,
    autumn: entry.autumn ?? 0,
    dormant: 0,
    bare: 0,
    snow: 0,
  };
}

/* The map's own winter, kept as it was when the simulator took one (engine/snow.mjs): the clear low
   sun of a January day over snow, on the bones of its noon light. */
const WINTER = Object.freeze({
  ...buildLight({ key: 'vinter', preset: 'noon', label: 'Vinter', direct: 0.8, exposure: 1 }),
  sun: raised(normalize([-0.42, 0.26, 0.86]), LOWEST_LIGHT),
  shadowSun: raised(normalize([-0.42, 0.26, 0.86]), SHADOW_HEIGHT),
  bare: 1,
  snow: 1,
});

export const SIMULATOR_LIGHTS = Object.freeze(LIGHT_TABLE.map(buildLight));
export const MAP_LIGHTS = Object.freeze([...SIMULATOR_LIGHTS, WINTER]);
export const DEFAULT_LIGHT = 'sommar';
export const lightByKey = key => MAP_LIGHTS.find(light => light.key === key) ?? null;

export function blendLights(a, b, t) {
  const out = {};
  for (const [key, value] of Object.entries(a)) {
    if (typeof value === 'number') out[key] = lerp(value, b[key], t);
    else if (Array.isArray(value)) out[key] = value.map((n, i) => lerp(n, b[key][i], t));
    else out[key] = t < 0.5 ? value : b[key];
  }
  return out;
}

/* The autumn ramps in the order the tree shader reads them: birch, oak, alder,
   three ramps of three colours each, and each family's two breaks. */
const FAMILIES = ['bjork', 'ek', 'al'];
export const AUTUMN_RAMPS = Object.freeze({
  colours: new Float32Array(FAMILIES.flatMap(name => AUTUMN_FOLIAGE[name].ramps.flat().flatMap(rgb))),
  breaks: new Float32Array(FAMILIES.flatMap(name => AUTUMN_FOLIAGE[name].breaks)),
});

/* The sun and the seasons are the simulator's too (engine/solar.mjs): its Nu stands
   under the same sun, in the same season, as the map's. */
export { solarPosition, sunDirection, seasonAt } from '../engine/solar.mjs';

export const compassName = azimuth => ['norr', 'nordost', 'öster', 'sydost', 'söder', 'sydväst', 'väster', 'nordväst'][Math.round(azimuth / (Math.PI / 4)) % 8];

/* The light of this moment: the real sun, and a sky chosen by how high it stands. */
export function lightNow(date, latitude, longitude) {
  const position = solarPosition(date, latitude, longitude);
  const degrees = position.elevation / DEGREES;
  const morning = position.azimuth < Math.PI;
  const { autumn, dormant, bare, snow } = seasonAt(date, latitude);
  const summer = dormant < 0.5 && autumn < 0.5;
  const day = lightByKey(summer ? 'sommar' : 'dag');
  const low = lightByKey(morning ? 'gryning' : 'kvall');
  const dusk = lightByKey('bla');
  const light = degrees >= 2
    ? blendLights(low, day, smooth(5, 26, degrees))
    : blendLights(dusk, low, smooth(-5, 2, degrees));
  const direction = sunDirection(position);
  return {
    ...light,
    key: 'nu',
    label: 'Nu',
    sun: raised(direction, LOWEST_LIGHT),
    shadowSun: raised(direction, SHADOW_HEIGHT),
    autumn,
    dormant,
    bare,
    snow,
    elevationDegrees: degrees,
    azimuth: position.azimuth,
  };
}
