/* Reviewed lattice and evidence contract for the first Norrfällsviken v2
   publication. Coordinates address sample centres in EPSG:3006; the source
   COG's pixel-edge window is half a metre wider on every side.

   Norrfällsvikens GK on the Mjällom cape is the first SEASIDE ground here, and
   that changes two things a purely inland course never has to answer.

   The first is what the height model says over water. Lantmäteriet's
   Markhöjdmodell carries no bathymetry: it treats the Gulf of Bothnia as a
   flattened surface and returns it as ground at approximately zero RH 2000,
   with no nodata anywhere in this window. That is the runbook's rule -- the
   DTM is the water surface, never the bed -- and it is why a window that is
   one third open sea still passes the every-sample-finite gate rather than
   arriving full of the -9999 the items declare. It also costs almost nothing:
   a 257 x 257 tile of one repeated value deflates to 142 bytes against the
   45 kB a varied tile takes, so the sea third of this window is roughly one
   land tile's worth of bytes.

   The second is where the window belongs. The course itself is compact -- 784
   by 1,286 m, which eight tiles would hold with 380 m to spare -- but the
   things this club IS are not all inside it: Norrfällsvikens kapell of 1649
   stands 555 m south of the 18th, the fishing harbour and its piers another
   700 m beyond that, and the sea the course is named for is the eastern view
   from most of the back nine. A 2,048 m window centred on the played ground
   misses the chapel by 174 m and the harbour entirely; shifted far enough
   south to catch the chapel it leaves 81 m at the north end, which is under
   the runbook's zone-A margin and has no slack for anything later. The next
   legal size is 4,096 m, so sixteen tiles per side is not padding here either
   -- it is what puts 1 m ground under every landmark this course is looked at
   from and across. Ängsö records the same reasoning for a different reason
   (its 2,167 m length); the tile counts match because the legal sizes do.

   The window is centred EAST-WEST on the played ground, and ANCHORED on the
   north to the 10 km item boundary at N 6990000. Those are two different
   rules on purpose. East-west, centring shares the surplus the way Ängsö and
   Veckefjärden describe. North-south, centring would push the window 613 m
   past that boundary into a second pair of Markhöjdmodell items -- and what
   it would buy there is open sea, because the coast turns west across the top
   of this window and every sample north of about N 6990100 is already water.
   Two items instead of four, for ground that is one flat value: the boundary
   is the better edge. The course still clears the north edge by 792 m.

   Both items were captured in the same campaign, so the seam between them is
   one of file boundaries and not of vintage or method. Item 698_68 is a
   COASTAL item and is NOT a full 10 km square -- it is 7,500 x 7,500 m, and
   its overview chain stops at 16x where every other item here reaches 32x.
   Nothing in this window depends on that, because the finest terrain is read
   at factor 1; the ring compiler is the code that has to fall back, and it
   already does. */
export const NORRFALLSVIKEN_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'norrfallsviken',
  courseSlug: 'norrfallsviken',
  /* Two items, west and east of E 680000. 698_67 supplies 3,084 m of the
     window's width and 698_68 the remaining 1,012 m. */
  sourceItemIds: Object.freeze(['698_67', '698_68']),
  sourceCollection: 'dtm-cog',
  sourceAssets: Object.freeze({
    /* full 10 km COG, from the STAC item's own file:checksum multihash */
    '698_67': Object.freeze({
      url: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/69_6/m698_67.tif',
      sha256: '6888aa723a0a4439ac5c794ec612a38e3a09de89e45e05e6a5300a20cc2814cf',
      bytes: 220651661,
      projBbox: Object.freeze([670000, 6980000, 680000, 6990000]),
      projShape: Object.freeze([10000, 10000]),
    }),
    /* the coastal item: 7.5 km square, and its overviews stop at 16x */
    '698_68': Object.freeze({
      url: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/69_6/m698_68.tif',
      sha256: 'af49cc626cc561c94135551730807c2a736d3ee754854ca975d47f5de009dc3d',
      bytes: 42855645,
      projBbox: Object.freeze([680000, 6982500, 687500, 6990000]),
      projShape: Object.freeze([7500, 7500]),
    }),
  }),
  sourceCapture: Object.freeze({
    capturedAt: '2018-12-20T00:00:00Z',
    captureStart: '2012-07-05T00:00:00Z',
    captureEnd: '2025-06-05T00:00:00Z',
    modifiedAt: '2026-04-20T00:00:00Z',
    statedPlanUncertaintyMetres: 0.3,
    statedHeightUncertaintyMetres: 0.1,
  }),
  /* REVIEWED. The bounds every played point falls inside, measured over all
     863 coordinate pairs the committed EPSG:3006 migration carries for the
     eighteen holes. The practice ground is inside this box already: the range
     runs E 678620-678842 / N 6988289-6988359 and the practice greens
     E 678598-678751 / N 6988331-6988363. */
  playedBounds: Object.freeze({
    minEasting: 678571.761,
    maxEasting: 679356.074,
    minNorthing: 6987921.590,
    maxNorthing: 6989207.278,
  }),
  /* REVIEWED. The off-course ground the window exists to reach, and the reason
     it is sixteen tiles rather than eight. Each is read out of the migration
     by the compile driver -- the chapel by NAME, the harbour by FEATURE KIND --
     so a moved or renamed feature fails the window contract instead of
     silently leaving the finest terrain. */
  landmarkBounds: Object.freeze({
    /* Norrfällsvikens kapell, 1649 */
    kapell: Object.freeze({
      minEasting: 678477.7, maxEasting: 678487.3, minNorthing: 6987361.3, maxNorthing: 6987369.9,
    }),
    /* the fishing harbour's piers, which reach furthest west and south */
    harbourPiers: Object.freeze({
      minEasting: 677474.6, maxEasting: 678570.3, minNorthing: 6986601.6, maxNorthing: 6987720.9,
    }),
    /* the marina basins east of the village */
    marinaBasins: Object.freeze({
      minEasting: 679265.8, maxEasting: 679346.5, minNorthing: 6987654.5, maxNorthing: 6987761.4,
    }),
  }),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 4097,
  height: 4097,
  originEasting: 676915.5,
  originNorthing: 6989999.5,
  pixelEdgeWindow: Object.freeze({
    west: 676915,
    north: 6990000,
    east: 681012,
    south: 6985903,
  }),
  expectedBounds: Object.freeze({
    minEasting: 676915.5,
    minNorthing: 6985903.5,
    maxEasting: 681011.5,
    maxNorthing: 6989999.5,
  }),
  /* The margin the window achieves against every played point, and against
     the three off-course landmarks the window exists to contain. The minimum
     is the westernmost harbour pier, not the golf course. */
  reviewedPlayedMarginMetres: Object.freeze({
    west: 1656.3, east: 1655.4, south: 2018.1, north: 792.2, minimum: 792.2,
  }),
  /* The same margin measured against the played ground AND the landmarks
     together. The west and south figures are the harbour piers, and they are
     what eight tiles could not have supplied: that set spans 2,605.7 m
     north-south, so it needs 2,805.7 m with the zone-A margin and 2,048 m
     fails. The north figure is still the golf course. */
  reviewedContainedMarginMetres: Object.freeze({
    west: 559.1, east: 1655.4, south: 698.1, north: 792.2, minimum: 559.1,
  }),
  /* DERIVED — printed by compile-norrfallsviken-ground-graph.mjs. The tile
     count is the 4,097 lattice's pyramid: 256 + 64 + 16 + 4 + 1, the same
     shape Ängsö's 4,097 window compiles to.

     Note what did NOT happen: the all-sea tiles do not collapse into one
     chunk. Content addressing covers each tile's own bounds and quantization
     as well as its samples, so two tiles carrying the same flat water are two
     chunks, and uniqueChunks is tileChunks + 1 here exactly as it is on every
     inland ground. The sea is cheap because it deflates to almost nothing --
     19.0 MB encoded against 43.1 MB decoded -- not because it is shared. */
  expectedCompile: Object.freeze({
    levels: 5,
    tileChunks: 341,
    uniqueChunks: 342,
    rootTiles: 1,
  }),
  /* MEASURED over all 16,785,409 samples of the retained window:
     -0.841 m at the waterline to 90.589 m on the ridge west of the harbour,
     every sample finite. The Gulf of Bothnia is zero by definition and the
     small negative is the height model's own bias where flattened water meets
     the shore, not a hole in the data. The band around it is deliberately far
     wider than the ground can be, so a nodata plane, the wrong item or a
     decimetre/metre unit slip fails loudly without the gate tracking the data
     it polices. */
  measuredHeightRangeRH2000: Object.freeze({ minimum: -0.8411101698875427, maximum: 90.58942413330078 }),
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 150 }),
  holeTileBufferMetres: 80,
});

export function assertNorrfallsvikenCompilation(compilation) {
  const config = NORRFALLSVIKEN_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      compilation.courseSlugs.length !== 1 || compilation.courseSlugs[0] !== config.courseSlug) {
    throw new Error('Norrfällsviken compilation identity drifted');
  }
  for (const [field, expected] of Object.entries(config.expectedBounds)) {
    if (Math.abs(compilation.bounds?.[field] - expected) > 1e-9) {
      throw new Error(`Norrfällsviken terrain ${field} is ${compilation.bounds?.[field]}; expected ${expected}`);
    }
  }
  for (const [field, expected] of Object.entries(config.expectedCompile)) {
    if (expected === null) continue; /* not yet pinned by a first compilation */
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== expected) {
      throw new Error(`Norrfällsviken terrain ${field} is ${actual}; expected ${expected}`);
    }
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum ||
      maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error(`Norrfällsviken RH 2000 range ${minimum}-${maximum} m is outside the reviewed plausibility band`);
  }
  if (compilation.stats.finiteSamples !== compilation.stats.sourceSamples) {
    throw new Error(`Norrfällsviken terrain contains ${compilation.stats.sourceSamples - compilation.stats.finiteSamples} nodata samples`);
  }
  return compilation;
}
