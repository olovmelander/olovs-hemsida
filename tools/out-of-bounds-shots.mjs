/* The shots that must stay in bounds, replayed against a published pack's white stakes
   exactly as Spela rules them.

   Spela (apps/golf/src/play/play-rules.mjs outTest) calls a ball out when the straight
   line from where the stroke was played to where it rests crosses the white stakes an
   odd number of times. Its stakes are the pack's white marking runs and its
   outOfBounds lines (the boundaries handle at the end of main.js; spelaBoundaries
   below reads the same two lists, and a test holds the two in step). A run is an open
   line, so a stake line drawn across a corridor, round a green or through a fairway
   rules shots on the hole's own ground out. A hole's own fairway and green are never
   out of bounds, so every such ruling is a fault in the stakes.

   Found by the owner playing Veckefjärden (27 November 2026): every approach to the
   2nd, 3rd and 5th and every tee shot on the 12th and 14th was out, because "behind
   the green" was drawn in front of it, "around the green" was a closed circle and the
   13th's right-hand stakes crossed the 14th. The quality gate runs this on every
   course; geobuild/reconcile.mjs is where Veckefjärden's stakes are drawn.

   The shots: from every tee mark onto the hole's fairway within TEE_REACH, and onto
   its green on a par 3 or within reach; from its fairway, between 30 m and
   APPROACH_REACH of the pin, onto its green (a thinned grid, see APPROACH_THIN). */
import { boundaryCrossings } from '../apps/golf/src/play/play-rules.mjs';

export const TEE_REACH = 300;
export const APPROACH_REACH = 250;
export const FAIRWAY_STEP = 6;
export const GREEN_STEP = 2.5;
const APPROACH_THIN = { from: 3, to: 4 };

/** Spela's white stakes, read as the boundaries handle in main.js reads them. */
export function spelaBoundaries(vectors) {
  return [
    ...(vectors.marking || []).filter(m => m.c === 'w').map(m => m.pts),
    ...(vectors.outOfBounds?.lines || []).map(l => l.line),
  ].filter(line => Array.isArray(line) && line.length >= 2);
}

function inside(x, z, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}
function grid(ring, step) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const out = [];
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) if (inside(x, z, ring)) out.push([x, z]);
  return out;
}
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round1 = p => p.map(v => Math.round(v * 10) / 10);

/** Per hole: how many good shots, how many Spela calls out, and the first such shot. */
export function goodShotsCalledOut(vectors) {
  const lines = spelaBoundaries(vectors);
  return (vectors.holes || []).map(h => {
    const fairway = (h.fairway?.rings || []).filter(r => r.length >= 3).flatMap(r => grid(r, FAIRWAY_STEP));
    const green = h.green?.ring?.length >= 3 ? grid(h.green.ring, GREEN_STEP) : [];
    const pin = h.pin || h.green?.c || h.line?.[h.line.length - 1];
    const shots = [];
    for (const { c } of h.tees?.marks || []) {
      if (!c) continue;
      if (h.par > 3) for (const p of fairway) if (far(c, p) < TEE_REACH) shots.push(['tee', c, p]);
      for (const p of green) if (h.par === 3 || far(c, p) < TEE_REACH) shots.push(['tee', c, p]);
    }
    if (pin) {
      const from = fairway.filter(p => { const d = far(p, pin); return d > 30 && d < APPROACH_REACH; });
      for (let i = 0; i < from.length; i += APPROACH_THIN.from) for (let k = 0; k < green.length; k += APPROACH_THIN.to) shots.push(['approach', from[i], green[k]]);
    }
    let out = 0, first = null;
    for (const [kind, a, b] of shots) {
      if (boundaryCrossings(lines, a, b) % 2 === 1) { out++; first ||= { kind, from: round1(a), to: round1(b) }; }
    }
    return { hole: h.n, shots: shots.length, out, first };
  });
}
