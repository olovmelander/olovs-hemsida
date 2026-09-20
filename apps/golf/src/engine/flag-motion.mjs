/* Wind response shared by the baked cloth and its procedural fallback.
   Speeds are m/s; bearings are meteorological (where the wind comes FROM).
   Only the response is synthesized here. The existing cloth bakes are unchanged. */
export const FLAG_DEFAULT_MS = 4;
export const flagHash01 = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, dt, seconds) => a + (b - a) * -Math.expm1(-dt / seconds);
export const flagWindYaw = fromDeg => -Math.PI / 2 - fromDeg * Math.PI / 180;

/* Adjacent poses meet exactly at every band's speed, including zero. Clamping
   outside the bake's range avoids extrapolated/inverted cloth in extreme wind.
   An optional output object lets the animation loop reuse its storage. */
export function flagBandBlend(cloth, ms, out = {}) {
  const bands = cloth.bands;
  const speed = Number.isFinite(ms) ? Math.max(0, ms) : FLAG_DEFAULT_MS;
  let hi = 0;
  while (hi < bands.length - 1 && speed > bands[hi].ms) hi++;
  const lo = Math.max(0, hi - 1);
  out.lo = lo; out.hi = hi;
  out.weight = lo === hi ? 0 : clamp((speed - bands[lo].ms) / (bands[hi].ms - bands[lo].ms), 0, 1);
  return out;
}

export function createFlagMotion(seed, loopSeconds = 4) {
  return { seed, ms: null, yaw: null, swing: 0, clock: 0,
    poseTime: flagHash01(seed) * loopSeconds, offset: flagHash01(seed) * loopSeconds,
    wavePhase: flagHash01(seed) * Math.PI * 2,
    gustStart: -100, gustDuration: 0, gusts: 0, nextGust: 3 + flagHash01(seed + 0.5) * 9,
    blend: { lo: 0, hi: 0, weight: 0 }, posed: false };
}

/* A continuous envelope, including its endpoints. A weather gust is a peak,
   not a second on/off wind state. The air rises faster than it settles. */
export function flagGustEnvelope(age, duration) {
  if (!(duration > 0) || age <= 0 || age >= duration) return 0;
  return smooth(age / (duration * 0.3)) * smooth((duration - age) / (duration * 0.55));
}

export function stepFlagMotion(state, dt, wind, deterministic = false) {
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
  const base = Number.isFinite(wind.ms) ? Math.max(0, wind.ms) : FLAG_DEFAULT_MS;
  const yaw = Number.isFinite(wind.yaw) ? wind.yaw : 0;
  if (deterministic) {
    state.ms = base; state.yaw = yaw; state.swing = 0;
    state.clock = 3.25; state.poseTime = 3.25 + state.offset;
    state.wavePhase = state.poseTime * (0.8 + 0.55 * Math.min(base, 12));
    return state;
  }
  const t = state.clock += step, seed = state.seed;
  const peak = Number.isFinite(wind.gust) ? Math.max(base, wind.gust) : base;
  if (peak > base && t >= state.nextGust) {
    state.gustStart = t;
    state.gustDuration = 3 + flagHash01(seed * 3.1 + state.gusts) * 3;
    state.nextGust = t + state.gustDuration + 4 + flagHash01(seed * 5.7 + state.gusts) * 10;
    state.gusts++;
  }
  const gust = (peak - base) * flagGustEnvelope(t - state.gustStart, state.gustDuration);
  // Small, slow variation keeps a steady breeze alive without inventing large gusts.
  const drift = base * 0.035 * (Math.sin(t * 0.47 + seed * 1.7) * 0.65 + Math.sin(t * 0.19 + seed * 3.1) * 0.35);
  const target = Math.max(0, base + gust + drift);
  state.ms = state.ms === null ? base : damp(state.ms, target, step, target > state.ms ? 0.45 : 1.1);
  if (state.yaw === null) state.yaw = yaw;
  else {
    // The shortest arc also handles north-crossing readings, e.g. 359 -> 1 deg.
    const delta = Math.atan2(Math.sin(yaw - state.yaw), Math.cos(yaw - state.yaw));
    state.yaw += delta * -Math.expm1(-step / 0.85);
  }
  const lift = clamp(state.ms / 8, 0, 1);
  state.swing = (0.085 - 0.04 * lift) * clamp(state.ms / 1.5, 0, 1)
    * (Math.sin(t * 0.31 + seed * 1.7) * 0.6 + Math.sin(t * 0.83 + seed * 4.1) * 0.4);
  // Integrate the clock: varying its rate never jumps to a different baked frame.
  state.poseTime += step * (1 + 0.035 * Math.sin(t * 0.23 + seed * 2.3));
  state.wavePhase += step * (0.8 + 0.55 * Math.min(state.ms, 12));
  return state;
}

/* The fallback uses the same local frame, pinned edge and material as the bake.
   Two travelling ripples, with a small vertical billow, soften the old flat wave. */
export function poseDrawnFlag(grid, state, out) {
  const { nx, nz, width, height, hoistX, top } = grid;
  const ms = state.ms ?? FLAG_DEFAULT_MS;
  const hang = clamp(ms * 8.95, 3, 90) * Math.PI / 180;
  const hs = Math.sin(hang), hc = Math.cos(hang);
  const amp = 0.004 + 0.085 * clamp(ms / 6, 0, 1);
  const phase = state.wavePhase;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const u = i / (nx - 1), v = j / (nz - 1), c = (j * nx + i) * 3;
    const envelope = u ** 1.35;
    const wave = Math.sin(phase - u * 7 + v * 1.2);
    out[c] = hoistX + width * u * hs;
    out[c + 1] = top - height * v - width * u * hc + wave * amp * envelope * hs * 0.18;
    out[c + 2] = amp * envelope * (wave + 0.24 * Math.sin(phase * 1.67 - u * 13 - v * 2.4));
  }
  return out;
}
