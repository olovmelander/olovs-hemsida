/* Tjusta Golfklubb, on Tjusta Gård at Rosersberg: one eighteen round a working farm.

   Evidence: the 2025-06-14 orthophoto (Ortofoto Nedladdning © Lantmäteriet) with the 2023, 2021 and 2019
   flights beside it, Laserdata Skog of 2021-04-17 and the club's own photographs; see
   docs/courses/tjusta-source-research.md. */
import roofColours from './tjusta-roof-colours.json' with { type: 'json' };

/* The houses are drawn with the house kit (engine/house-kit.mjs): a plinth, eaves and gables, and
   windows, doors and the rest modelled in Blender on each mapped footprint. Each roof takes its colour
   from the 2025 orthophoto (geobuild/facilities/roof-colours.py; Ortofoto Nedladdning © Lantmäteriet,
   CC BY 4.0): 205 of the 216 mapped roofs, the rest under crowns. The walls keep the palette. */
export const houseKit = true;
export { roofColours };

/* THE SAND. Tjusta's bunkers are raked tan sand, not white: inside the fourteen traced bunkers the
   2025-06-14 photo reads a median of 170, 157, 148 of 255 (quartiles 164-178 in red), in the same
   campaign and exposure in which Bro Hof's marble reads 220. It is well under the glow's threshold. */
export const groundAppearance = Object.freeze({
  palette: Object.freeze({ sand: 0xaa9d94 }),
});

/* THE WATER. Every pond here is in Lantmäteriet's break geometry: the terrain was flown with the ponds
   full and carries their surface as a level plate, so each level is read off the ground as published.
   The frontier's early carve would lower that ground first and the ponds would stand low inside their
   banks (Bro Hof's first pictures, 24 November), so the beds are carved with the world instead. */
export const deferWaterBedToWorld = true;

/* THE TREES. The first generation's crowns are untyped. On the leafless April 2021 photo the woods the
   holes run through are dark and green, so conifers: spruce on the slopes and in the big wood between
   the two halves, pine on the rock knolls. The bare crowns stand round the farm, along the ditches and
   the wetland east of the 5th, and at the wood edges: birch for the most part, with alder by the water
   and oak in the farm's groves. A share by place, until the tree pipeline measures each crown's type.
   Ids: 0 spruce, 1 pine, 2 birch, 3 alder, 4 oak. The farm stands at about x -15, z -95. */
export function species({ r, x, z, extended = false }) {
  const oak = extended ? 4 : 2, alder = extended ? 3 : 2;
  const farm = Math.hypot(x + 15, z + 95) < 260;
  const conifers = farm ? 0.3 : 0.72;
  if (r < conifers) return r < conifers * 0.58 ? 0 : 1;
  const b = (r - conifers) / (1 - conifers);
  return b < (farm ? 0.3 : 0.1) ? oak : b < (farm ? 0.42 : 0.28) ? alder : 2;
}

/* The clubhouse is the big barn at Tjusta Gård (OSM way 48232863): falu-red boarding under a dark gambrel
   roof, with a terrace toward the 18th green, on the club's own photographs (klubbhus-2022, "Klubbhus med
   terrass"). A barn has next to no windows: the photograph shows two round vents in the gable and three small
   panes on the low wing, so no window rows are hung on it (the first picture of 26 November drew forty, and
   it read as a block of flats). Its roof is the engine's hip: the gabled roof lays a flat lid on this
   L-shaped footprint, and a gambrel is not drawn yet. The heights are display estimates, not laser roof
   measurements. */
export const clubhouse = {
  wall: 0x8a3a2e,
  roof: 0x34373b,
  height: 7.5,
  windowRows: [],
  terrace: true,
};
