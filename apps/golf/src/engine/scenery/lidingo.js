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
   this island is built on, so what this rule changes is the DECIDUOUS share,
   and it rests on the club's own description and its photographs - parkland
   among villas, birch along the mown edges - and on nothing else.

   An earlier draft of this note also blamed the laser: the campaign is
   2021-03-23 and leaf-off, and Johannesberg measured a leaf-off scan to
   under-detect deciduous crowns, so it seemed to follow that the stand fields
   handed to the planter would be thin in exactly these species. MEASURED ON
   THIS GROUND THAT DOES NOT HOLD - the leaf-off canopy and the leaf-on imagery
   agree closely enough that under-detection is not what this rule corrects.
   What is low is the crown YIELD: 11.5 individuals per canopy hectare against
   39-48 on comparable grounds, and that is pulse density (2.156 returns/m2),
   not leaf state. Keep the two apart. A rule justified by the wrong mechanism
   survives until somebody fixes that mechanism, and then quietly becomes wrong.

   0 spruce, 1 pine, 2 birch, matching the SPECIES table's own order. Low ground
   near the mown edges goes birch-led; the higher rocky ground stays pine-led,
   which is what the photographs show and what grows on a Stockholm hällmark. */
export function species({ r, h }) {
  if (h < 18) return r < 0.55 ? 2 : r < 0.85 ? 1 : 0;
  return r < 0.20 ? 2 : r < 0.80 ? 1 : 0;
}
