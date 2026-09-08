/* Lidingö GK's course-specific scenery.

   THE CLUBHOUSE is the odd one out among these courses in the other direction
   from Upsala's: not a red timber building and not a rendered cream one, but a
   long, low, WHITE modern pavilion under a very shallow, almost flat DARK roof,
   standing on a bank above the 18th green with a terrace and steps running down
   to it, and two flagpoles on the lawn - the club flag and the Swedish flag.

   Read off the club's own 2026 gallery, two photographs from different points
   on the 18th fairway (gfx28459 and gfx28462), and corroborated in flat
   daylight by a historical photograph on the club's own history page, where the
   same low pale flat-roofed block with its entrance canopy stands behind the
   subjects. The SHAPE and the pale-wall-against-dark-roof contrast are what
   those frames establish: both modern ones are golden hour, and this repository
   has already painted one clubhouse's storey blue by reading colour out of
   evening light, so the wall is given as a neutral off-white rather than a
   measured tint, and the roof as a near-black grey. A flat-light photograph
   would let both be measured properly; there isn't one yet, and that is
   written down rather than guessed around.

   Single storey, so ONE window row. windowRows is a list of sill heights, and a
   second row on a building that has none is the sort of small invention that
   makes a real club's clubhouse into a generic one. */
export const clubhouse = {
  wall: 0xeff0ec,          /* off-white; tint not measured, see above */
  roof: 0x2a2c2b,          /* near-black shallow roof with deep eaves */
  height: 3.9,             /* one storey under an almost flat roof */
  windowRows: [1.5],
  terrace: true,
};

/* THE WOODS. The club calls its own course "en något kuperad parkbana där
   fairways ligger inbäddade bland vackra villor och välskötta skogsdungar" -
   a slightly undulating PARK course whose fairways sit among villas and
   well-kept groves - and its photographs agree: tall Scots pine with high open
   crowns over rocky knolls, birch along the mown edges, and broadleaf through
   the park.

   The engine's default is already a pine mix, which is right for the hällmark
   this island is built on, so what this rule changes is the DECIDUOUS share.
   Two things justify raising it. The club's ground is parkland rather than
   production forest, and the only laser campaign over it is 2021-03-23 and
   LEAF-OFF, which Johannesberg measured to under-detect deciduous crowns - so
   where the measured generation is thin, the stand fields it hands the planter
   are thin in exactly the species this rule restores.

   0 spruce, 1 pine, 2 birch, matching the SPECIES table's own order. Low ground
   near the mown edges goes birch-led; the higher rocky ground stays pine-led,
   which is what the photographs show and what grows on a Stockholm hällmark. */
export function species({ r, h }) {
  if (h < 18) return r < 0.55 ? 2 : r < 0.85 ? 1 : 0;
  return r < 0.20 ? 2 : r < 0.80 ? 1 : 0;
}
