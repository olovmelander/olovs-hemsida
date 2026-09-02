/* A TEE MARKER HAS TO STAND ON A TEE.

   The card carries three to six tees a hole; the surveys mapped one or two pads.
   Measured across the six courses, only 24-63% of tee markers had any prepared
   ground under them at all -- the rest were a pair of coloured balls sitting in
   the rough, and `?vy=tee` opened the hole standing there. Veckefjärden looked
   best (63%) for one reason: its pipeline already synthesises a pad per card tee
   and marks it prov:"synth". The other five never did.

   So the same inference is made once, before anything reads the pads: any mark
   no mapped pad covers gets a deck at the mark, squared to the hole's own
   bearing. It is an inference and it says so (prov:"synth"); what is NOT
   invented is where the tee is, which the card's own length fixed.

   Shared by the app's boot and the v2 surface compiler, because a v2 raster
   without these pads puts every synthesised tee's marker back in the rough --
   the exact regression the inference was written to end. */

import { inRing, lineBearingAt } from './geom.js';

/* Deck size follows Veckefjärden's own synth pads: 10.4 m across the line by
   8.8 m along it, the shape of a real teeing ground rather than a square. */
const HALF_WIDTH = 5.2;
const HALF_DEPTH = 4.4;

/* The bearing is not read from the pack, it is DERIVED from the hole line the
   engine itself draws: `mk.b` in the packs is a compass bearing on eight of
   nine courses and alongLine's convention on the ninth, and a bearing that
   must agree with the line is better derived from the line than believed
   from a field beside it. Degrees, overwritten in place. */
export function deriveTeeBearings(hole) {
  for (const mk of hole.tees?.marks || []) mk.b = lineBearingAt(hole.line, mk.c) * 180 / Math.PI;
  return hole;
}

export function inferSynthTeePads(hole) {
  const pads = hole.tees?.pads;
  if (!pads) return hole;
  for (const mk of hole.tees.marks || []) {
    if (pads.some(p => inRing(mk.c[0], mk.c[1], p.ring))) continue;
    const b = mk.b * Math.PI / 180;
    const F = [Math.sin(b), Math.cos(b)], R = [-Math.cos(b), Math.sin(b)];
    pads.push({
      prov: 'synth', teeIdx: mk.teeIdx, c: [mk.c[0], mk.c[1]],
      ring: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
        [mk.c[0] + R[0] * HALF_WIDTH * u + F[0] * HALF_DEPTH * v,
         mk.c[1] + R[1] * HALF_WIDTH * u + F[1] * HALF_DEPTH * v]),
    });
  }
  return hole;
}

/** Both steps, on copies: what a compiler reading a pack from disk needs. */
export function withInferredTeePads(holes) {
  return holes.map(source => {
    if (!source || typeof source !== 'object' || !source.tees) return source;
    const hole = {
      ...source,
      tees: {
        ...source.tees,
        marks: (source.tees.marks || []).map(mk => ({ ...mk })),
        pads: [...(source.tees.pads || [])],
      },
    };
    deriveTeeBearings(hole);
    inferSynthTeePads(hole);
    return hole;
  });
}
