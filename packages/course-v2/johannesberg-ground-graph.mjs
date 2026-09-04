/* Reviewed lattice and evidence contract for the first Johannesberg v2
   publication.

   The window is DERIVED, not typed: it is the smallest power-of-two 256 m
   tile lattice that holds every played point of both courses on this ground
   (the 18-hole Donald Steel course and the nine) with at least the reviewed
   100 m zone-A margin, centred on that played ground and snapped to the
   Lantmateriet 1 m sample lattice. `alignTerrainGridExtent` reproduces it
   from the required bounds, which is what the compile driver asserts.

   Coordinates address sample centres in EPSG:3006; the source COG's
   pixel-edge window is half a metre wider on every side. Unlike Ribbingsfors,
   this ground's GPK1 pack is in the legacy flat-earth lat/lon frame, so the
   runtime bridge needs a real convergence rotation, scale and MEASURED
   vertical offset -- none of which belong in this file, which describes only
   the published terrain. */
export const JOHANNESBERG_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'johannesberg',
  courseSlug: 'johannesberg',
  /* Two 10 km Markhojdmodell squares meet inside this window: the course
     straddles E 680000. Both are read, and a sample is taken from the item
     that contains it. */
  sourceItemIds: Object.freeze(['662_67', '662_68']),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 2049,
  height: 2049,
  originEasting: 678403.5,
  originNorthing: 6626324.5,
  pixelEdgeWindow: Object.freeze({
    west: 678403,
    north: 6626325,
    east: 680452,
    south: 6624276,
  }),
  expectedBounds: Object.freeze({
    minEasting: 678403.5,
    minNorthing: 6624276.5,
    maxEasting: 680451.5,
    maxNorthing: 6626324.5,
  }),
  /* The reviewed zone-A margin actually achieved by the centred window,
     measured against every played point of both courses. */
  reviewedPlayedMarginMetres: Object.freeze({
    west: 231.2, east: 231.2, north: 110.4, south: 110.9, minimum: 110.4,
  }),
  expectedCompile: Object.freeze({
    levels: 4,
    tileChunks: 85,
    uniqueChunks: 86,
    rootTiles: 1,
  }),
  /* Gottrora sits on the Uppland till plain between Skedviken and Vasby;
     the course itself runs from the lake shore up onto the ridge the slott
     stands on. The band is deliberately wider than the compiled range so a
     nodata plane or a wrong item fails loudly without the gate tracking the
     data it is meant to police. */
  plausibleHeightRangeRH2000: Object.freeze({ minimum: 0, maximum: 90 }),
  holeTileBufferMetres: 80,
});

export function assertJohannesbergCompilation(compilation) {
  const config = JOHANNESBERG_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      compilation.courseSlugs.length !== 1 || compilation.courseSlugs[0] !== config.courseSlug) {
    throw new Error('Johannesberg compilation identity drifted');
  }
  for (const [field, expected] of Object.entries(config.expectedBounds)) {
    if (Math.abs(compilation.bounds?.[field] - expected) > 1e-9) {
      throw new Error(`Johannesberg terrain ${field} is ${compilation.bounds?.[field]}; expected ${expected}`);
    }
  }
  for (const [field, expected] of Object.entries(config.expectedCompile)) {
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== expected) {
      throw new Error(`Johannesberg terrain ${field} is ${actual}; expected ${expected}`);
    }
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum ||
      maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error(`Johannesberg RH 2000 range ${minimum}-${maximum} m is outside the reviewed plausibility band`);
  }
  if (compilation.stats.finiteSamples !== compilation.stats.sourceSamples) {
    throw new Error(`Johannesberg terrain contains ${compilation.stats.sourceSamples - compilation.stats.finiteSamples} nodata samples`);
  }
  return compilation;
}
