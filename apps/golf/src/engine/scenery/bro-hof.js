/* Bro Hof Slott's shared ground: both Robert Trent Jones Jr. courses stand on it, so both slugs
   load this one module.

   Evidence: the 2025-06-14 orthophoto (Ortofoto Nedladdning © Lantmäteriet), Laserdata Skog 2020-21
   and the club's Caddee plates; see docs/courses/bro-hof-source-research.md. */
import roofColours from './bro-hof-roof-colours.json' with { type: 'json' };
import { campusSlot } from './campus-slot.mjs';

/* The houses are drawn with the house kit (engine/house-kit.mjs): a plinth, eaves and gables, and
   windows, doors and the rest modelled in Blender on each mapped footprint. Each roof takes its colour
   from the 2025 orthophoto (geobuild/facilities/roof-colours.py; Ortofoto Nedladdning © Lantmäteriet,
   CC BY 4.0) unless this module states it; the walls keep the palette. */
export const houseKit = true;
export { roofColours };

/* THE SAND. Both courses' bunkers are the same crushed white marble: in one exposure the raked sand
   reads 220 +/- 4 of 255 on Stadium 1 and 6 and on Castle 1, 2 and 15 alike, so the Castle has no sand
   of its own. The waste areas are another material, tan and unraked, at about half the marble's
   reflectance. The marble stays under the glow's own threshold (glow.mjs): white paint does not bloom. */
export const groundAppearance = Object.freeze({
  palette: Object.freeze({ sand: 0xdedbd2, waste: 0xb8aa93 }),
});

/* THE WATER. Every pond here was flown full (Lantmäteriet's plate and the laser's own flat agree to the
   centimetre), so its level is read off the ground as published. The frontier's early carve would lower
   that ground first, and the ponds then stood up to 0.75 m down, eight metres inside their own walls
   (seen on the first GPU pictures, 24 November). The beds are carved with the world instead. */
export const deferWaterBedToWorld = true;

/* THE MOWN BANKS (the owner, 27 November 2026: Bro Hof's mown pond banks bear no reeds). Judged one water at a
   time on the 2025-06-14 photo; the record, with what the photo shows round each water and the waters that keep
   their reeds (Mälaren's natural shore, the reed belt and wetland of the pond on Stadium 15, the meadow ponds by
   Stadium 6 and Castle 5), is brohofbuild/mapping/reed-bank-decisions.json, held equal to this list by
   bro-hof.test.mjs. `at` is a point inside the water's outline, in the pack's local metres (the pack keeps no
   water ids); `stretch`, where the bank is mown only in part, is the part of the ground where it is. Read by the
   reed scan (ground-cover.mjs onMownBank); ?mownbanks=0 is the before. */
export const mownBanks = Object.freeze([
  { id: 'lm-water-659_64-16', at: [-450.5, 728.7] },
  { id: 'lm-water-659_64-18', at: [-609, 560.6] },
  { id: 'lm-water-659_64-19', at: [-210, 522.7] },
  { id: 'lm-water-659_64-20', at: [-285.5, 337.5] },
  { id: 'lm-water-659_64-21', at: [596.6, 233.9],
    stretch: [[489.1, 219.9], [648.2, 219.9], [648.2, 263.7], [696.6, 263.7], [696.6, 224.5], [747.3, 224.5], [747.3, 159.9], [811.8, 159.9], [811.8, 360.7], [489.1, 360.7]] },
  { id: 'lm-water-659_64-22', at: [99.3, 208.6] },
  { id: 'lm-water-659_64-23', at: [-57.2, 175.8] },
  { id: 'lm-water-659_64-25', at: [566.8, -66.9] },
  { id: 'lm-water-659_64-27', at: [536.9, -129.6] },
  { id: 'lm-water-659_64-28', at: [122.8, -455.7] },
  { id: 'lm-water-659_64-29', at: [36.8, -432.3],
    stretch: [[-8.7, -502.4], [78.5, -502.4], [66.5, -476.8], [44.1, -457.6], [32.9, -438.4], [29.7, -416], [-8.7, -416]] },
  { id: 'ortho-creek-castle-09-a', at: [207.4, -599.7] },
  { id: 'ortho-creek-castle-09-b', at: [206.1, -626.8] },
  { id: 'ortho-creek-castle-09-c', at: [229.1, -556.1] },
  { id: 'ortho-creek-stadium-05', at: [616.8, -38.1] },
  { id: 'ortho-creek-stadium-12-a', at: [638.1, -0.5] },
  { id: 'ortho-creek-stadium-12-b', at: [658.6, 25.4] },
].map(bank => Object.freeze(bank)));

/* THE TREES. The laser and the April photo type each crown inside the 2,048 m window; which broadleaf it is
   they do not say. The estate's are the park trees of Mälardalen, and the entrance photographs show maples,
   limes and oaks along the avenue, so half of them are drawn as the catalogue's oak, alder by the low shore
   and birch for the rest. Outside the window the woods mix with Uppland's conifers.
   Ids: 0 spruce, 1 pine, 2 birch, 3 alder, 4 oak. h is the ground in RH 2000; Mälaren stands at about 0.9 m. */
export function species({ r, x, z, h, extended = false }) {
  const oak = extended ? 4 : 2, alder = extended ? 3 : 2;
  if (h < 2.2) return r < 0.6 ? alder : 2;
  const conifers = Math.max(Math.abs(x), Math.abs(z)) > 1024 ? 0.5 : 0.2;
  if (r < conifers) return r < conifers * 0.45 ? 0 : 1;
  const b = (r - conifers) / (1 - conifers);
  return b < 0.55 ? oak : b < 0.68 ? alder : 2;
}

/* The castle is the clubhouse (OSM way 319035128): white plaster under dark slate, two storeys and a
   mansard. This is the plain appearance, drawn until the authored model is loaded. */
export const clubhouse = {
  wall: 0xe4dfd2,
  roof: 0x3c434b,
  height: 10.5,
  windowRows: [1.6, 5.4],
  terrace: true,
};

/* Single buildings the sources say more about than OSM's `building=yes`. The long building north of
   the car park (way 370846851) has a red tile roof and white gables on the photo; the two courtyard
   wings by the castle (370846847, 370846866) and the house to the north-east (370846850) are dark
   slate, hipped. */
export const houseKitBuildings = {
  w370846847: { type: 'villa', wall: 0xe2d9c6 },
  w370846866: { type: 'villa', wall: 0xe2d9c6 },
  w370846850: { type: 'villa', wall: 0xe2d9c6 },
  w370846851: { type: 'villa', wall: 0xe6e0d2 },
};

/* The authored campus (brohofbuild/facilities/build_campus.py, Blender): the castle, its terrace and
   forecourt, the avenue's gate, the pavilion and both halfway houses. It stands in for the mapped
   footprints it names, and only once the whole asset has been checked; until then, and with
   buildingGeometry=source, the house kit draws them. */
export const BRO_HOF_CAMPUS = Object.freeze({
  groundId: 'bro-hof', name: 'Bro Hof authored facilities', courseSlugs: ['bro-hof-stadium', 'bro-hof-castle'],
  originEasting: 649094.5, originNorthing: 6598568.5, requiredSources: ['w319035128', 'w1235353673'],
});
const campus = campusSlot(async context => {
  const { loadCampusFacilities } = await import('./campus-facilities.mjs');
  return loadCampusFacilities(BRO_HOF_CAMPUS, context);
});
export const loadFacilitiesBeforeSurfaces = true;
export const loadFacilities = context => campus.load(context);
export const isFacilityInterior = campus.isFacilityInterior;
export const architectureStatus = campus.status;
