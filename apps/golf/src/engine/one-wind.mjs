/* ONE WIND. The flags answered the weather's wind (flag-motion.mjs), while the
   trees and reeds swayed on a clock of their own along fixed axes and the sky's
   clouds drifted west at a speed each preset chose: three winds at once, and in
   the default westerly the clouds ran against the flags. Now one air, eased
   toward the flags' own target wind (FLAG_WIND in main.js: the weather, ?vind=,
   or the 4 m/s default), carries all of it:
   - the trees and reeds swing along its axis, as strongly as it blows, and gusts
     roll through them as patches the air carries downwind;
   - the sky's clouds drift with it, at their preset's speed scaled by it;
   - the clouds' shadows cross the ground with it (cloud-shadow.mjs).
   Reduced motion holds the air still: the trees and reeds stand, and the
   clouds and their shadows stay where they are. The flags keep answering the
   wind -- they are how a player reads it -- and det=1 pins the air to the
   target wind with nothing carried. Everything here is a handful of uniforms
   and a few operations per plant vertex; nothing is added per pixel. */
import { Vector2, Vector3 } from 'three/webgpu';
import { cos, float, renderGroup, sin, time, uniform, vec2, vec3 } from 'three/tsl';
import { FLAG_DEFAULT_MS } from './flag-motion.mjs';

export const ONE_WIND = Object.freeze({
  /* the wind the plants' sway was drawn for: the flags' default */
  referenceMs: FLAG_DEFAULT_MS,
  /* sway against the wind: a fifth of the drawn sway in calm air, all of it
     at the reference wind, and on up to 2.2 times in a gale */
  swayCalm: 0.2, swayCap: 2.2,
  /* the air eases toward a new wind in about three seconds, slower than a flag's cloth */
  easeSeconds: 3,
  /* gusts are patches about 40 m across (80 m apart), in a pattern that repeats every 400 m */
  gustWavelength: 80, gustPeriod: 400,
  /* the sky's clouds drift at their preset's speed times the wind against the reference, within these bounds */
  skyDrift: [0.25, 3],
  /* cloud shadows cross the ground at 1.5 times the surface wind: the air aloft is faster */
  cloudPerMs: 1.5,
});

/* Uploaded once a render, as they change every frame. The downwind axis on
   the ground (x, z), and how strongly the plants sway: 0 stands them still. */
export const windAxis = uniform(new Vector2(1, 0)).setGroup(renderGroup);
export const windSway = uniform(1).setGroup(renderGroup);
/* how far the air has carried the gust pattern, wrapped to its 400 m period */
export const airOffset = uniform(new Vector2(0, 0)).setGroup(renderGroup);
/* the sky's cloud drift: its offset across the cloud plane (x, y) and how far it has run (z) */
export const skyDrift = uniform(new Vector3(0, 0, 0)).setGroup(renderGroup);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const wrap = (x, period) => x - Math.floor(x / period) * period;

/** How strongly the plants sway in a wind of `ms` m/s: 1 at the reference wind. */
export function swayStrength(ms) {
  const { swayCalm, swayCap, referenceMs } = ONE_WIND;
  return Math.min(swayCap, swayCalm + (1 - swayCalm) * Math.max(0, ms) / referenceMs);
}

/** The downwind unit vector on the ground (x east, z south) for a flag's yaw:
    three turns the flag's local +x, which points downwind, to (cos yaw, -sin yaw). */
export const downwindOf = yaw => [Math.cos(yaw), -Math.sin(yaw)];

/* A LIGHT'S OWN WIND (docs/visual-lights-2026-09-25.md). The storm is weather:
   it brings its gale into the visible air -- the trees, reeds, clouds, their
   shadows, the water and the flags -- when the flags' wind (the live reading,
   or the 4 m/s default) is weaker. `floor` is the light's `wind: { ms, gust }`
   (painted-world-palette.mjs): the wind blows at least that hard, from where it
   blew, gusting at least that high. A wind asked for with ?vind= is kept as
   asked, and a light without a floor leaves the wind as it is. The Kikaren
   reads the live weather itself, so its wind and its advice are untouched. */
export function lightWind(wind, floor) {
  if (!floor || !wind || wind.source === 'url') return wind;
  const ms = Number.isFinite(wind.ms) ? Math.max(0, wind.ms) : ONE_WIND.referenceMs;
  const gust = Number.isFinite(wind.gust) ? wind.gust : 0;
  if (ms >= floor.ms && gust >= (floor.gust ?? 0)) return wind;
  return { ...wind, ms: Math.max(ms, floor.ms), gust: Math.max(gust, floor.gust ?? 0) };
}

export function createAir() {
  return { x: null, z: null, ms: 0, axisX: 1, axisZ: 0, sway: 1,
    gustX: 0, gustZ: 0, cloudX: 0, cloudZ: 0, skyX: 0, skyY: 0, skyRun: 0 };
}

/** Ease the air toward `wind` (FLAG_WIND: ms, yaw) and carry what it carries.
    `skySpeed` is the sky's own drift in cloud-plane units a second (its preset
    speed; 0 under det=1); `cloudPeriod` wraps the cloud shadows' offset to their
    pattern's tile. `still` is reduced motion. */
export function stepAir(air, dt, wind, { deterministic = false, still = false, skySpeed = 0, cloudPeriod = Infinity } = {}) {
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
  const ms = Number.isFinite(wind?.ms) ? Math.max(0, wind.ms) : ONE_WIND.referenceMs;
  const [dx, dz] = downwindOf(Number.isFinite(wind?.yaw) ? wind.yaw : 0);
  /* the air's velocity is eased as a vector, as a flag's flow is: a reversal
     passes through calm rather than swinging the whole air round */
  if (deterministic || air.x === null) { air.x = ms * dx; air.z = ms * dz; }
  else {
    const k = -Math.expm1(-step / ONE_WIND.easeSeconds);
    air.x += (ms * dx - air.x) * k; air.z += (ms * dz - air.z) * k;
  }
  air.ms = Math.hypot(air.x, air.z);
  if (air.ms > 0.05) { air.axisX = air.x / air.ms; air.axisZ = air.z / air.ms; }
  else if (deterministic) { air.axisX = dx; air.axisZ = dz; }
  air.sway = still ? 0 : swayStrength(air.ms);
  if (!deterministic && !still && step > 0) {
    air.gustX = wrap(air.gustX + air.x * step, ONE_WIND.gustPeriod);
    air.gustZ = wrap(air.gustZ + air.z * step, ONE_WIND.gustPeriod);
    const cloud = ONE_WIND.cloudPerMs * step;
    air.cloudX = wrap(air.cloudX + air.x * cloud, cloudPeriod);
    air.cloudZ = wrap(air.cloudZ + air.z * cloud, cloudPeriod);
    const sky = skySpeed * clamp(air.ms / ONE_WIND.referenceMs, ...ONE_WIND.skyDrift) * step;
    air.skyX += air.axisX * sky; air.skyY += air.axisZ * sky; air.skyRun += sky;
  }
  return air;
}

/** Write the air into the shared uniforms. */
export function applyAir(air) {
  windAxis.value.set(air.axisX, air.axisZ);
  windSway.value = air.sway;
  airOffset.value.set(air.gustX, air.gustZ);
  skyDrift.value.set(air.skyX, air.skyY, air.skyRun);
}

/* The gust a plant at q (its ground position less the air's offset) is in,
   0 to 1: a quilt of patches 40 m across, bent so it has no straight rows, and
   periodic in both axes over gustPeriod so the offset can wrap. */
export function gustAt(qx, qz) {
  const k = 2 * Math.PI / ONE_WIND.gustWavelength;
  const a = qx * k + 0.9 * Math.sin(qz * k * 0.6), b = qz * k + 0.9 * Math.sin(qx * k * 0.6);
  return 0.5 + 0.5 * Math.sin(a) * Math.sin(b);
}
const gustNode = q => {
  const k = 2 * Math.PI / ONE_WIND.gustWavelength;
  const a = q.x.mul(k).add(sin(q.y.mul(k * 0.6)).mul(0.9)), b = q.y.mul(k).add(sin(q.x.mul(k * 0.6)).mul(0.9));
  return sin(a).mul(sin(b)).mul(0.5).add(0.5);
};

/** The shared gust node: 0..1 at a ground position `p` (vec2), the pattern the air is carrying past it. */
export const gustNodeAt = p => gustNode(p.sub(airOffset));

/* Each plant's own place in the sway, so that neighbours move nearly together
   and stands differ: a bent sine field, fixed on the ground (the gusts, not the
   phase, are what travels). `scale` 1 suits trees, 2 reeds. */
export const swayPhaseAt = (p, scale = 1) => sin(p.x.mul(0.045 * scale).add(sin(p.y.mul(0.033 * scale)).mul(1.3))).mul(1.2)
  .add(sin(p.y.mul(0.05 * scale).add(sin(p.x.mul(0.029 * scale)).mul(1.1))));

/** A plant's sway on the one wind, as an offset to add to its position:
    - `p` its ground position (vec2), `weight` how far it bends there;
    - `rate` its own swing's frequency, `scale` its phase field's;
    - `swing(phase)` the drawn swing, [along, across] the wind;
    - `lean` how far a gust pushes it downwind, against the swing's size.
    The drawn swing is turned onto the wind's axis and scaled by the wind's
    strength and by the gust passing (0.6 to 1 of it, as the drawn gust was). */
export function swayOnWind({ p, weight, rate, scale = 1, swing, lean = 0 }) {
  const gust = gustNodeAt(p);
  const phase = time.mul(rate).add(swayPhaseAt(p, scale));
  const [along, across] = swing(phase);
  const strength = weight.mul(gust.mul(0.4).add(0.6)).mul(windSway);
  const a = along.add(gust.mul(lean).mul(windSway)).mul(strength), c = across.mul(strength);
  const side = vec2(windAxis.y.negate(), windAxis.x);
  const d = windAxis.mul(a).add(side.mul(c));
  return vec3(d.x, float(0), d.y);
}

/* The drawn swings: a tree's, with its height lag, and a reed's. The trees'
   drawn sway had the gust's 0.6 to 1 already; the reeds' had none, so theirs
   is drawn a quarter larger to keep its mean. */
export const treeSwing = height => phase => [
  sin(phase.add(height.mul(0.08))).mul(0.24).add(sin(phase.mul(2.1)).mul(0.06)),
  cos(phase.mul(0.82)).mul(0.18).add(cos(phase.mul(1.8)).mul(0.05)),
];
export const reedSwing = phase => [sin(phase).mul(0.18 * 1.25), cos(phase.mul(0.9)).mul(0.14 * 1.25)];
