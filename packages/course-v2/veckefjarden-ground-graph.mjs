/* Reviewed lattice and evidence contract for the first Veckefjärden v2
   publication. Coordinates address sample centres in EPSG:3006; the source
   COG's pixel-edge window is half a metre wider on every side.

   Veckefjärden is the first ground here that carries TWO courses on one
   physical property -- the 18-hole Mästerskapsbanan and the nine-hole
   korthålsbanan -- and the whole of the short course lies inside the long
   one's box, so a single 2048 m LOD0 square serves both. That is what the
   runbook's ground/course split is for: one terrain, two course manifests.

   The origin is REVIEWED rather than produced by alignTerrainGridExtent().
   The aligner centres its power-of-two padding with a floor, so an odd tile
   deficit lands entirely east and south; anchored on the source item it left
   as little as 24 m of clearance south of the 18th while wasting 479 m east.
   Centring on the played ground instead gives 376 m east/west and 206 m
   north/south, comfortably past the runbook's 80-100 m zone-A margin, and it
   still lands the whole window inside a single 10 km DTM item.

   Note what is NOT copied from Puttom. Puttom derives its required bounds
   through a translation-only legacy bridge; Veckefjärden's pack is a
   TRUE-north flat-earth frame and EPSG:3006 is grid north, so that bridge is
   up to 82.6 m wrong here (migration/residual-report.json, playingGeometry
   directFrameDelta.maxMetres). The bounds below come from the committed
   cs2cs migration, which carries the 3.29 deg meridian convergence. */
export const VECKEFJARDEN_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'veckefjarden',
  courseSlug: 'veckefjarden',
  courseSlugs: Object.freeze(['veckefjarden', 'veckefjarden-korthalsbanan']),
  sourceItemId: '702_68',
  sourceCollection: 'dtm-cog',
  sourceAssetUrl: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/70_6/m702_68.tif',
  /* full 10 km COG, from the STAC item's own file:checksum multihash */
  sourceCogSha256: '0532a03bfd19859b2824b9f822c51d5edb56c9b8de4badd4420dd3d7a29e9b56',
  sourceCogBytes: 274998450,
  /* the retained 2049 x 2049 window and the headerless Float32 the compiler reads */
  sourceWindowCogSha256: 'a9239dff6de849d30e2190483947d601f25319dbd1570999741ad14a513d347a',
  sourceFloat32Sha256: 'c740caa00ec7f87559c383bbd6f59b40abe59272899d6fc1e816eaf3f9a19f81',
  sourceCapture: Object.freeze({
    capturedAt: '2022-06-23T00:00:00Z',
    captureStart: '2020-06-18T00:00:00Z',
    captureEnd: '2024-06-27T00:00:00Z',
    /* the item's own ursprungligtmatdatum and method */
    originalSurveyDate: '2020-06-18',
    method: 'Luftburen laserskanning',
    statedPlanUncertaintyMetres: 0.3,
    statedHeightUncertaintyMetres: 0.1,
  }),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 2049,
  height: 2049,
  originEasting: 682885.5,
  originNorthing: 7024026.5,
  pixelEdgeWindow: Object.freeze({
    west: 682885,
    north: 7024027,
    east: 684934,
    south: 7021978,
  }),
  expectedBounds: Object.freeze({
    minEasting: 682885.5,
    minNorthing: 7021978.5,
    maxEasting: 684933.5,
    maxNorthing: 7024026.5,
  }),
  expectedCompile: Object.freeze({
    levels: 4,
    tileChunks: 85,
    uniqueChunks: 86,
    rootTiles: 1,
  }),
  /* Measured, not inherited. The retained window runs 0.164-151.461 m RH 2000:
     Veckefjärden the lake sits within a metre of the Gulf of Bothnia -- which is
     why there is a lock at its outlet -- while Åsberget's shoulder climbs past
     150 m inside the same square. Puttom's 10..200 course gate would fail here
     on its own minimum. */
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -2, maximum: 180 }),
  holeTileBufferMetres: 80,
});

/* The one constant here that is neither derived nor reviewed but MEASURED.

   Veckefjärden's GPK1 pack carries AWS Terrarium heights on an unrecorded
   datum; the v2 ground is Lantmäteriet's laser DTM on RH 2000. The bridge
   between them is the median difference over ground both models describe as
   the same mown surface -- 35,533 samples on a 2 m grid inside the greens,
   fairways and tee pads of both courses, with every sample inside a water ring
   discarded. Median 20.9924 m, MAD 0.2392 m, p05 20.46, p95 21.64.

   Per surface class the medians run 20.75 m (championship greens, n=2115) to
   21.35 m (korthålsbanan tees, n=11); the championship fairways, which supply
   28,842 of the samples, sit at 20.97. The class spread is 0.6 m, twice the
   MAD, and it is the built-up green complexes reading differently in a coarse
   global model -- not noise. The published number is the median over all
   played ground, the same rule Puttom's 23.6263 m follows.

   Copying Puttom's number here would be a 2.6 m error. Copying this one
   anywhere else would be the same mistake in the other direction. */
export const VECKEFJARDEN_VERTICAL_DATUM = Object.freeze({
  offsetMetres: 20.9924,
  evidence: Object.freeze({
    method: 'median legacy-minus-RH2000 over played ground, water rings excluded',
    sampleCount: 35533,
    sampleSpacingMetres: 2,
    madMetres: 0.2392,
    p05Metres: 20.46,
    p95Metres: 21.64,
    legacySource: 'geobuild/heightfields.json hf0 (AWS Terrarium, unrecorded datum)',
    referenceSource: 'Lantmäteriet Markhöjdmodell item 702_68, RH 2000',
    measuredOn: '2026-09-04',
  }),
});

export function assertVeckefjardenCompilation(compilation) {
  const config = VECKEFJARDEN_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      compilation.courseSlugs.length !== config.courseSlugs.length ||
      compilation.courseSlugs.some((slug, index) => slug !== config.courseSlugs[index])) {
    throw new Error('Veckefjärden compilation identity drifted');
  }
  for (const [field, expected] of Object.entries(config.expectedBounds)) {
    if (Math.abs(compilation.bounds?.[field] - expected) > 1e-9) {
      throw new Error(`Veckefjärden terrain ${field} is ${compilation.bounds?.[field]}; expected ${expected}`);
    }
  }
  for (const [field, expected] of Object.entries(config.expectedCompile)) {
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== expected) {
      throw new Error(`Veckefjärden terrain ${field} is ${actual}; expected ${expected}`);
    }
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum ||
      maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error(`Veckefjärden RH 2000 range ${minimum}-${maximum} m is outside the reviewed plausibility band`);
  }
  if (compilation.stats.finiteSamples !== compilation.stats.sourceSamples) {
    throw new Error(`Veckefjärden terrain contains ${compilation.stats.sourceSamples - compilation.stats.finiteSamples} nodata samples`);
  }
  return compilation;
}
