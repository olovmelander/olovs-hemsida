/* THE SUN'S ROAD, SPARKLING TO THE HORIZON (docs/visual-water-road-2026-09-25.md).
   Owner, 25 September: the sun's reflection "feels uneven" and does not look as
   good as it did. Seen from a player's camera over the sea it had become a dull,
   wide smear cut into bars:
   - past 120-450 m the water batch gave the sparkle's dabs way to their
     expectation, a smooth glow the width of the ripples' spread of slopes. From
     a camera 180 m up with the coast 450 m ahead, that is the whole road. It
     was meant to keep the far dabs from thinning to a flicker, but they do not
     flicker: past 800 m they are as steady as the glow, the wind's drift or the
     camera's flight notwithstanding (check-isolated.mjs);
   - the clouds' shadows cut the road. The pattern is laid straight down, round,
     where a low sun's shadow would be drawn out six times along its light, and
     the eye looks along the road at a few degrees: each shadow crossed it as a
     thin bar.
   Now (water-shading.mjs, `road`):
   - THE DABS TO THE HORIZON. Wherever a ripple faces the sun it shines, as the
     water always drew it near, in the sun's own colour: at golden hour a warm
     road, at noon nearly white. Far off the ripples' finest chop is filtered
     away and the road draws together into a bright column.
   - BRIGHTER TOWARD GRAZING. Water reflects more of the sun the lower the eye
     looks across it (Schlick's reflectance): the road rises from its dabs'
     brightness where the sun meets the water at 70 degrees to 2.5 times at 79,
     so a low sun's road blazes toward the horizon. It never dims: the glitter
     under a high sun keeps its brightness.
   - CLOUDS ONLY UNDER A HIGH SUN. A cloud's shade puts out the road where the
     sun stands over 35 degrees, as it always did; below 15 degrees it does not.
   And (water-shading.mjs):
   - `mirror`: toward a low sun the water mirrors more of its glowing sky: the
     reflection's share rises from 0.42 to 0.7 inside the sun glow's own lobe,
     so the road lies in warm water rather than in a grey where the glow's amber
     and the water's blue cancelled;
   - `relief`: THE WAVES FROM ABOVE. Looked down on, from the overviews at 25-45
     degrees, the water was one flat blue: its ripples live in the reflection,
     and a steep look reflects 3.5% of the sky. The body now takes the ripples'
     relief, as a painter shows waves from above: a facet tilted toward the sun
     lighter, one tilted away darker, by up to 12%, as the sun is direct (none
     under an overcast or a set sun). It fades far off with the ripples
     themselves, as their mipmaps flatten them. */
import { float, mix, normalize, pow, saturate, smoothstep, uniform, vec2 } from 'three/tsl';

export const WATER_ROAD = Object.freeze({
  /* the dabs' window on N.H: a ripple facing the sun within 5 degrees shines in full, none past 10 */
  dabs: [0.985, 0.996],
  /* the road's brightening toward grazing: Schlick's reflectance over its value at this cosine (70 degrees), capped */
  grazing: { reference: Math.cos(70 * Math.PI / 180), cap: 2.5 },
  /* the clouds' shadows cut the road as the sun's height (its sine) rises through these: 15 and 35 degrees */
  cloudSun: [Math.sin(15 * Math.PI / 180), Math.sin(35 * Math.PI / 180)],
  /* inside the sun glow's lobe the water's reflection takes up to this share (0.42 elsewhere) */
  mirror: { share: 0.42, glow: 0.7 },
  /* the body's relief: its brightness against a facet's tilt toward the sun's azimuth, at most this share either
     way, in full with a sun this strong (the preset's intensity) and less under a weaker one */
  relief: { gain: 2, cap: 0.12, fullSun: 1.5 },
});

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Schlick's reflectance of water at the cosine of the angle of incidence. */
export const schlick = cosine => 0.02 + 0.98 * (1 - Math.min(1, Math.max(0, cosine))) ** 5;
/** How much brighter the road is where the eye meets the sun's reflection at this cosine (V.H): 1 to the cap. */
export function roadGrazing(cosine) {
  const { reference, cap } = WATER_ROAD.grazing;
  return Math.min(cap, Math.max(1, schlick(cosine) / schlick(reference)));
}
/** The share of a cloud's shade the road takes under a sun this high (the sine of its height). */
export const roadCloudShare = sunUp => smooth(WATER_ROAD.cloudSun[0], WATER_ROAD.cloudSun[1], sunUp);

const schlickNode = cosine => pow(float(1).sub(saturate(cosine)), 5).mul(0.98).add(0.02);
/** The road in the shader (0..cap): the dabs at the half vector's cosine nh, brightened toward grazing at the
    eye's cosine to it vh, and put out by a cloud's shade (`sunlight`, 1 in the clear) only under a high sun. */
export function sunRoad({ nh, vh, sunUp, sunlight = null }) {
  const { dabs, grazing, cloudSun } = WATER_ROAD;
  let road = smoothstep(dabs[0], dabs[1], saturate(nh)).mul(schlickNode(vh).div(schlick(grazing.reference)).clamp(1, grazing.cap));
  if (sunlight) road = road.mul(mix(float(1), sunlight, smoothstep(cloudSun[0], cloudSun[1], sunUp)));
  return road;
}

/** The share of the sky the water mirrors (its Fresnel term `fres`), more of it inside the sun glow's lobe (`glow`, 0..1). */
export const mirrorShare = ({ fres, glow }) => fres.mul(mix(float(WATER_ROAD.mirror.share), float(WATER_ROAD.mirror.glow), glow));

/** How direct the preset's sun is, for the relief (0..1): set by setWaterRoadPreset. */
export const waterReliefSun = uniform(1);
export const reliefSunOf = p => Math.min(1, Math.max(0, (p.int ?? 0) / WATER_ROAD.relief.fullSun));
export function setWaterRoadPreset(p) { waterReliefSun.value = reliefSunOf(p); }
/** The body's brightness over the ripples' relief (1 on a level facet): the normal N's tilt toward the sun's azimuth. */
export function bodyRelief({ N, sun }) {
  const { gain, cap } = WATER_ROAD.relief;
  const toward = normalize(vec2(sun.x, sun.z).add(vec2(1e-4, 0)));
  const tilt = N.x.mul(toward.x).add(N.z.mul(toward.y));
  return tilt.mul(gain).clamp(-cap, cap).mul(waterReliefSun).add(1);
}
