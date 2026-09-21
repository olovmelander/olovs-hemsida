/* Wind response shared by the baked cloth and its procedural fallback.
   Speeds are m/s; bearings are meteorological (where the wind comes FROM).
   Each cloth band comes from Blender; this response handles changing weather. */
export const FLAG_DEFAULT_MS = 4;
export const flagHash01 = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, dt, seconds) => a + (b - a) * -Math.expm1(-dt / seconds);
const flutterRate = ms => 0.9 + 1.4 * Math.min(ms, 30);
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
  out.weight = lo === hi ? 0 : smooth((speed - bands[lo].ms) / (bands[hi].ms - bands[lo].ms));
  return out;
}

export function createFlagMotion(seed, loopSeconds = 4) {
  return { seed, ms: null, yaw: null, flowX: null, flowZ: null, swing: 0, tailYaw: 0, clock: 0,
    poseTime: flagHash01(seed) * loopSeconds, offset: flagHash01(seed) * loopSeconds,
    wavePhase: flagHash01(seed) * Math.PI * 2,
    gustStart: -100, gustDuration: 0, gusts: 0, nextGust: 3 + flagHash01(seed + 0.5) * 9,
    blend: { lo: 0, hi: 0, weight: 0 }, posed: false, lastPoseTime: -Infinity };
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
    state.ms = base; state.yaw = yaw; state.swing = 0; state.tailYaw = 0;
    state.flowX = base*Math.cos(yaw); state.flowZ = base*Math.sin(yaw);
    state.clock = 3.25; state.poseTime = 3.25 + state.offset;
    state.wavePhase = state.poseTime * flutterRate(base);
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
  // Filter the airflow vector, rather than independently interpolating speed
  // and direction. Opposing air unloads the cloth before filling it again;
  // a reversal must not rotate a fully inflated flag like a solid weather vane.
  if (state.flowX === null) {
    state.flowX=base*Math.cos(yaw); state.flowZ=base*Math.sin(yaw);
  }
  const responseTime = target > (state.ms ?? base) ? 0.45 : 0.75;
  state.flowX=damp(state.flowX,target*Math.cos(yaw),step,responseTime);
  state.flowZ=damp(state.flowZ,target*Math.sin(yaw),step,responseTime);
  state.ms=Math.hypot(state.flowX,state.flowZ);
  const flowYaw=state.ms>0.05 ? Math.atan2(state.flowZ,state.flowX) : (state.yaw ?? yaw);
  let yawVelocity = 0;
  if (state.yaw === null) state.yaw = yaw;
  else {
    // The shortest arc also handles north-crossing readings, e.g. 359 -> 1 deg.
    const delta = Math.atan2(Math.sin(flowYaw - state.yaw), Math.cos(flowYaw - state.yaw));
    // A limp flag has no force making it rotate toward a new weather bearing.
    const response = -Math.expm1(-step * smooth(state.ms / 0.75) / 0.85);
    state.yaw += delta * response;
    if (step > 0) yawVelocity = delta * response / step;
  }
  state.tailYaw = damp(state.tailYaw, clamp(-yawVelocity * 0.16, -0.28, 0.28), step, 0.25);
  const lift = clamp(state.ms / 8, 0, 1);
  state.swing = (0.085 - 0.04 * lift) * clamp(state.ms / 1.5, 0, 1)
    * (Math.sin(t * 0.31 + seed * 1.7) * 0.6 + Math.sin(t * 0.83 + seed * 4.1) * 0.4);
  // Integrate the clock: varying its rate never jumps to a different baked frame.
  const movingAir=smooth(state.ms/0.6);
  state.poseTime += step * movingAir * (1 + 0.3 * smooth((state.ms - 24) / 16))
    * (1 + 0.035 * Math.sin(t * 0.23 + seed * 2.3));
  state.wavePhase += step * movingAir * flutterRate(state.ms);
  return state;
}

/* Let the fly follow a changing bearing after the sleeve, so a gust does not
   rotate the whole sheet as a rigid vane. Column rotations preserve the hoist
   and each vertical fold; the bounded lag relaxes to zero in steady wind. */
export function turnFlagCloth(grid, state, pose) {
  if (Math.abs(state.tailYaw) < 1e-6) return pose;
  const { nx, nz } = grid, hx = pose[0], hz = pose[2];
  for (let i = 1; i < nx; i++) {
    const angle = state.tailYaw * (i / (nx - 1)) ** 1.5;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let j = 0; j < nz; j++) {
      const k = (j * nx + i) * 3, x = pose[k] - hx, z = pose[k + 2] - hz;
      pose[k] = hx + x * c + z * s; pose[k + 2] = hz - x * s + z * c;
    }
  }
  return pose;
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
