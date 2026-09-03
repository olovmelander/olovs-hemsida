/* Rangefinder arithmetic for Kikaren: pure functions, no THREE, no DOM, so every
   number the card shows has a test behind it.

   Frame: the engine's local metres, north is -z and east is +x, so a compass
   bearing is atan2(dx, -dz) (CLAUDE.md, "Bearings"). Wind directions are
   meteorological, the direction the wind blows FROM, 0 = north, 90 = east. */
import { inRing } from './geom.js';

export const compassBearing = (ax, az, bx, bz) => Math.atan2(bx - ax, -(bz - az));

/* Wind relative to a shot. head > 0 is a headwind in m/s (negative = tailwind);
   cross > 0 blows from the player's right. A north wind on a north-bound shot is
   all headwind; an east wind on it is all cross, from the right. */
export function windAlong(bearingRad, windFromDeg, speedMs) {
  if (!(speedMs > 0) || !Number.isFinite(windFromDeg)) return { head: 0, cross: 0 };
  const rel = windFromDeg * Math.PI / 180 - bearingRad;
  return { head: speedMs * Math.cos(rel), cross: speedMs * Math.sin(rel) };
}

/* The plays-like arithmetic the GPS apps publish, in metric: one metre per metre
   of rise; about 1% of the shot per mph of headwind and 0.5% per mph of
   tailwind, which is 2.24% and 1.12% per m/s; about 1.5% per 20 °F off 70 °F,
   which is 0.135% per °C off 21 °C, warmer air playing shorter. The wind term
   is capped at a quarter of the shot so a gale reads as a warning, not a number. */
export const PLAYS_LIKE = Object.freeze({ headPerMs: 0.0224, tailPerMs: 0.0112, perDegC: 0.00135, baseC: 21, windCap: 0.25 });
export function playsLike({ dist, dh = 0, head = 0, tempC = null }) {
  const slope = dh;
  let windFrac = head > 0 ? PLAYS_LIKE.headPerMs * head : PLAYS_LIKE.tailPerMs * head;
  windFrac = Math.max(-PLAYS_LIKE.windCap, Math.min(PLAYS_LIKE.windCap, windFrac));
  const wind = dist * windFrac;
  const temp = Number.isFinite(tempC) ? -dist * PLAYS_LIKE.perDegC * (tempC - PLAYS_LIKE.baseC) : 0;
  return { total: dist + slope + wind + temp, slope, wind, temp };
}

/* Front, centre and back of a green along the ray from the origin through the
   green centre: the first and last metres inside the ring, marched in half-metre
   steps over the span the ring can reach. front/back are null when the ray never
   enters the ring, which happens when the green lies off to the side of the line. */
export function greenDistances(origin, green, step = 0.5) {
  const c = green.c, ring = green.ring;
  const dx = c[0] - origin[0], dz = c[1] - origin[1];
  const centre = Math.hypot(dx, dz);
  if (!(centre > 0) || !ring || ring.length < 3) return { front: null, centre, back: null };
  const ux = dx / centre, uz = dz / centre;
  let reach = 0;
  for (const p of ring) reach = Math.max(reach, Math.hypot(p[0] - c[0], p[1] - c[1]));
  const s0 = Math.max(0, centre - reach - 1), s1 = centre + reach + 1;
  let front = null, back = null;
  for (let s = s0; s <= s1; s += step) {
    if (inRing(origin[0] + ux * s, origin[1] + uz * s, ring)) { if (front === null) front = s; back = s; }
  }
  return { front, centre, back };
}

/* What a straight shot crosses. Samples every `step` metres from origin to
   target, asks kindAt(x, z) what is there ('vatten', 'bunker' or null) and
   returns the runs with the metres from the origin where each starts and ends:
   `from` is the layup that stays short of it, `to` the carry that clears it.
   Runs of one kind closer than mergeGap are one hazard. */
export function lineHazards(origin, target, kindAt, step = 1, mergeGap = 2) {
  const dx = target[0] - origin[0], dz = target[1] - origin[1];
  const len = Math.hypot(dx, dz);
  const runs = [];
  if (!(len > 0)) return runs;
  const ux = dx / len, uz = dz / len;
  let cur = null;
  for (let s = 0; s <= len; s += step) {
    const k = kindAt(origin[0] + ux * s, origin[1] + uz * s) || null;
    if (cur && k === cur.type) { cur.to = s; continue; }
    if (cur) { runs.push(cur); cur = null; }
    if (k) cur = { type: k, from: s, to: s };
  }
  if (cur) runs.push(cur);
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.type === r.type && r.from - last.to <= mergeGap) last.to = r.to;
    else out.push({ ...r });
  }
  return out;
}

/* Layups that leave a full approach, measured along the straight line to the
   green centre: for each `remain`, the shot that leaves it. Only offered when
   that shot is a real one (a 20 m layup is not advice). */
export function layupTargets(distToGreen, remains = [100, 150], minShot = 40) {
  return remains.filter(r => distToGreen - r >= minShot).map(r => ({ remain: r, shot: distToGreen - r }));
}
