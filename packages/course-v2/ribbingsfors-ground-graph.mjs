/* Reviewed lattice and evidence contract for the first Ribbingsfors v2
   publication. Coordinates address sample centres in EPSG:3006; the source
   COG's pixel-edge window is half a metre wider on every side. */
export const RIBBINGSFORS_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'ribbingsfors',
  courseSlug: 'ribbingsfors',
  sourceItemId: '653_44',
  sourceCogSha256: 'f94d6bae09f5730281db1fa081bf1da689e7b48fc335f41c3e68b2ab4efeb283',
  sourceWindowCogSha256: 'c992f541f854aa745742ef3429e15f931cb6459145945c1a1f68897273af44ad',
  sourceFloat32Sha256: '6cbd22bc14fa489279252c1f067f065d2f5fab500f29745258faf3bfd2b1dbdd',
  sourceCapture: Object.freeze({
    capturedAt: '2023-02-13T12:00:00Z',
    captureStart: '2022-12-14T00:00:00Z',
    captureEnd: '2023-04-16T00:00:00Z',
  }),
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 2049,
  height: 2049,
  originEasting: 447951.5,
  originNorthing: 6537048.5,
  pixelEdgeWindow: Object.freeze({
    west: 447951,
    north: 6537049,
    east: 450000,
    south: 6535000,
  }),
  expectedBounds: Object.freeze({
    minEasting: 447951.5,
    minNorthing: 6535000.5,
    maxEasting: 449999.5,
    maxNorthing: 6537048.5,
  }),
  expectedCompile: Object.freeze({
    levels: 4,
    tileChunks: 85,
    uniqueChunks: 86,
    rootTiles: 1,
  }),
  plausibleHeightRangeRH2000: Object.freeze({ minimum: 60, maximum: 130 }),
  holeTileBufferMetres: 80,
});

export function assertRibbingsforsCompilation(compilation) {
  const config = RIBBINGSFORS_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      compilation.courseSlugs.length !== 1 || compilation.courseSlugs[0] !== config.courseSlug) {
    throw new Error('Ribbingsfors compilation identity drifted');
  }
  for (const [field, expected] of Object.entries(config.expectedBounds)) {
    if (Math.abs(compilation.bounds?.[field] - expected) > 1e-9) {
      throw new Error(`Ribbingsfors terrain ${field} is ${compilation.bounds?.[field]}; expected ${expected}`);
    }
  }
  for (const [field, expected] of Object.entries(config.expectedCompile)) {
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== expected) {
      throw new Error(`Ribbingsfors terrain ${field} is ${actual}; expected ${expected}`);
    }
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum ||
      maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error(`Ribbingsfors RH 2000 range ${minimum}-${maximum} m is outside the reviewed plausibility band`);
  }
  if (compilation.stats.finiteSamples !== compilation.stats.sourceSamples) {
    throw new Error(`Ribbingsfors terrain contains ${compilation.stats.sourceSamples - compilation.stats.finiteSamples} nodata samples`);
  }
  return compilation;
}
