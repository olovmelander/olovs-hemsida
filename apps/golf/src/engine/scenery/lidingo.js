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
   measured tint.

   THE ROOF IS NOW MEASURED, and it was not near-black. This note used to say a
   flat-light photograph would settle it and that there wasn't one; the
   2025-05-31 Lantmateriet ortho IS one. Inside the footprint eroded 2 m and
   within 1.2 m of a laser roof return, 13,182 pixels read a median rgb
   (90, 99, 107) - a MID grey with a slight blue cast, interquartile ten counts,
   sitting 0.30 of the way from that frame's deepest shadow (29, 39, 49) to its
   brightest paint (232, 237, 240) and at 0.743 of the luminance of the asphalt
   beside it (129, 131, 133). The old 0x2a2c2b sits at 0.031 on the same scale:
   an order of magnitude darker than the building is.

   A sunlit nadir reading with atmospheric path radiance in it is not a paint
   chip, so what is carried over is the RATIO and the CHROMATICITY, not the raw
   triple: the measured chromaticity scaled so its luminance keeps that 0.743
   against the engine's own hard-surface albedo 0x8a857b. And there is NO RIDGE
   to state - the roof over this footprint is two near-level plates, both under
   2 degrees, stepping down 1.17 m to the south across a line running about
   east-west. A ridge azimuth would be an invention.

   The walls stay unmeasured, and deliberately: an ortho gives a roof and never
   a facade. Guessing a wall colour invents an appearance for a real business.

   Single storey, so ONE window row. windowRows is a list of sill heights, and a
   second row on a building that has none is the sort of small invention that
   makes a real club's clubhouse into a generic one. */
export const clubhouse = {
  wall: 0xeff0ec,          /* off-white; tint not measured, see above */
  roof: 0x5c656d,          /* measured: mid blue-grey at 0.743 of asphalt, 2025 ortho */
  height: 3.9,             /* one storey under an almost flat roof */
  windowRows: [1.5],
  terrace: true,
};

// Use the retained 2025 canopy raster for floor appearance as well as trees.
// Source polygons for greens, paths, sand and other maintained ground win.
export const canopyFloor = true;

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
   THE DENSITY IS LOW AND THERE ARE TWO NUMBERS FOR IT, over two extents, and
   they must not be mixed. The pinned campaign inventory
   (acquisition/laser-campaigns.json) measures the whole 10 km item: 217,740,127
   points at 2.156 all returns/m2, declared 1.2. The canopy evidence
   (vegetation/canopy-evidence.json) measures the AOI this build reads:
   18,077,669 points at 2.784 all returns/m2 and 1.24 pulses/m2. Both are
   committed; say which extent you mean. Against Veckefjarden's 3.119 and
   Norrfallsviken's 3.4, either way this scan is about half their pulse density.

   So the scan is BOTH leaf-off AND thin, and those cut the same way. An earlier
   draft of this note also cited a crown yield of "11.5 individuals per canopy
   hectare against 39-48"; that figure is in no committed artifact and is not
   reproducible from one, so it is withdrawn rather than repeated. Do not
   attribute a thin generation to leaf state or to density without measuring
   which - a rule justified by the wrong mechanism survives until somebody fixes
   that mechanism, and then quietly becomes wrong.

   0 spruce, 1 pine, 2 birch, matching the SPECIES table's own order. Low ground
   near the mown edges goes birch-led; the higher rocky ground stays pine-led,
   which is what the photographs show and what grows on a Stockholm hällmark. */
export function species({ r, h }) {
  if (h < 18) return r < 0.55 ? 2 : r < 0.85 ? 1 : 0;
  return r < 0.20 ? 2 : r < 0.80 ? 1 : 0;
}
