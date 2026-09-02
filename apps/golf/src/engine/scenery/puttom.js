/* Puttom's course-specific scenery.

   The clubhouse, from the club's own photographs -- the 18th green at sunset
   and a drone view of the whole hub from over the lake (puttom.se, Instagram).
   It is not Falu red under pantile: it is a modern two-storey building whose
   whole gable end towards the course is GLASS -- a tall white-framed window
   wall running up into the gable -- with a balcony and a wide wooden terrace
   along that end. The walls are Falu red with white trim and white window
   frames (the sunset photograph's blue lower storey was the blue hour on red
   paint, not paint), the roof dark grey and steep. A low gabled annex stands
   against its west side, the shop block against its north. The footprint is
   the large dark-roofed block the z18 imagery shows east of the annex
   (puttombuild/sat-traces.json). */
export const buildingLooks = {
  'trace-annex-a': { wall: 0x8b3a2c, roof: 0x4a4d50, windows: true },
  'trace-annex-b': { wall: 0x8b3a2c, roof: 0x4a4d50 },
  'trace-reception': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-east-house': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-vinkelhus': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-vinkelhus-arm': { wall: 0x8b3a2c, roof: 0x34373b, windows: true },
  'trace-range-hut': { wall: 0x8b3a2c, roof: 0x3a3d40, windows: true },
  'trace-range-shed': { wall: 0x8b3a2c, roof: 0x34373b },
  'trace-yard-shed-long': { wall: 0x8b3a2c, roof: 0x2f3234 },
  'trace-yard-hall': { wall: 0x8b3a2c, roof: 0x2f3234 },
  'trace-yard-small': { wall: 0x6f6a62, roof: 0x2f3234 },
  'trace-house-red': { wall: 0x8b3a2c, roof: 0x9d3f2e },
};

export const clubhouse = {
  wall: 0x8b3a2c,          /* falurött, white-trimmed */
  lowerWall: null,
  lowerHeight: 0,
  roof: 0x34373b,          /* dark grey, steep */
  height: 6.6,             /* two full storeys to the eaves */
  windowRows: [1.5, 4.4],
  gable: true,             /* a gabled roof, not the hip the engine defaults to */
  glazedGable: true,       /* the window wall on the end that faces the course */
  balcony: true,
  terrace: true,
};
