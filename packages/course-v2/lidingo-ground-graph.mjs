/* First Lidingö source window, selected from the complete dated OSM reference
   extent plus a >400 m context margin. This is a terrain intake contract,
   not an approved ground origin or a publishable playable-course graph. */
export const LIDINGO_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'lidingo',
  courseSlug: 'lidingo',
  sourceItemIds: Object.freeze(['658_67']),
  sourceFloat32Sha256: '80ffcd4865daa00f8e2393f43b8fcb1b37e020f968c0656a0189f80dde1de923',
  sourceHref: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/65_6/m658_67.tif',
  sampleSpacingMetres: 1,
  tileSegments: 256,
  width: 2049,
  height: 2049,
  originEasting: 676676.5,
  originNorthing: 6587423.5,
  pixelEdgeWindow: Object.freeze({ west: 676676, north: 6587424, east: 678725, south: 6585375 }),
  expectedBounds: Object.freeze({
    minEasting: 676676.5,
    minNorthing: 6585375.5,
    maxEasting: 678724.5,
    maxNorthing: 6587423.5,
  }),
  minimumReferenceMarginMetres: 100,
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 100 }),
  expectedCompile: Object.freeze({ levels: 4, tileChunks: 85, uniqueChunks: 86, rootTiles: 1 }),
});

export function assertLidingoAcquisition(acquisition, rasterSha256) {
  const config = LIDINGO_GROUND_GRAPH_CONFIG;
  if (acquisition?.groundId !== config.groundId ||
      acquisition?.phase !== 'authenticated-finest-terrain-window') {
    throw new Error('Lidingö terrain acquisition identity is invalid');
  }
  if (rasterSha256 !== config.sourceFloat32Sha256 || acquisition.raster?.sha256 !== rasterSha256) {
    throw new Error('Lidingö terrain differs from the pinned acquired raster');
  }
  const lattice = acquisition.lattice;
  if (lattice?.horizontalCrs !== 'EPSG:3006' || lattice.verticalCrs !== 'EPSG:5613' ||
      lattice.compoundCrs !== 'EPSG:5845' ||
      JSON.stringify(lattice.coordinateOrder) !== JSON.stringify(['easting', 'northing'])) {
    throw new Error('Lidingö terrain CRS or coordinate order differs from EPSG:5845');
  }
  for (const field of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) {
    if (lattice[field] !== config[field]) throw new Error(`Lidingö acquisition lattice differs at ${field}`);
  }
  for (const [field, value] of Object.entries(config.expectedBounds)) {
    if (lattice.sampleCentreBounds?.[field] !== value) throw new Error(`Lidingö sample bounds differ at ${field}`);
  }
  for (const [field, value] of Object.entries(config.pixelEdgeWindow)) {
    if (lattice.pixelEdgeWindow?.[field] !== value) throw new Error(`Lidingö pixel edges differ at ${field}`);
  }
  if (acquisition.raster.bytes !== config.width * config.height * 4) {
    throw new Error('Lidingö terrain raster byte count differs from its lattice');
  }
  if (acquisition.sourceItems?.length !== 1 || acquisition.sourceItems[0].id !== '658_67' ||
      acquisition.sourceItems[0].href !== config.sourceHref ||
      acquisition.sourceItems[0].overviewFactorUsed !== 1) {
    throw new Error('Lidingö terrain must use full-resolution source item 658_67');
  }
  if (acquisition.samples?.finite !== config.width * config.height ||
      acquisition.samples.total !== acquisition.samples.finite) {
    throw new Error('Lidingö acquisition contains incomplete source samples');
  }
  return acquisition;
}

export function assertLidingoReferenceExtent(collection) {
  if (collection?.type !== 'FeatureCollection' || collection.crs?.properties?.name !== 'EPSG:3006') {
    throw new Error('Lidingö reference features must explicitly use EPSG:3006');
  }
  const points = [];
  const visit = coordinates => {
    if (!Array.isArray(coordinates)) throw new Error('Invalid reference coordinates');
    if (typeof coordinates[0] === 'number') {
      if (coordinates.length !== 2 || !coordinates.every(Number.isFinite)) throw new Error('Invalid reference point');
      points.push(coordinates);
    } else coordinates.forEach(visit);
  };
  const routes = [];
  for (const feature of collection.features ?? []) {
    visit(feature.geometry?.coordinates);
    if (feature.properties?.tags?.golf === 'hole') {
      if (feature.geometry.type !== 'LineString' || feature.geometry.coordinates.length < 2) {
        throw new Error('Lidingö reference routing must be a line with at least two points');
      }
      routes.push(Number(feature.properties.tags.ref));
    }
  }
  routes.sort((a, b) => a - b);
  if (!points.length || routes.length !== 18 || routes.some((number, index) => number !== index + 1)) {
    throw new Error('Lidingö reference must contain exactly one route for every hole 1–18');
  }
  const bounds = {
    minEasting: Math.min(...points.map(point => point[0])),
    minNorthing: Math.min(...points.map(point => point[1])),
    maxEasting: Math.max(...points.map(point => point[0])),
    maxNorthing: Math.max(...points.map(point => point[1])),
  };
  const terrain = LIDINGO_GROUND_GRAPH_CONFIG.expectedBounds;
  const margin = {
    west: bounds.minEasting - terrain.minEasting,
    east: terrain.maxEasting - bounds.maxEasting,
    south: bounds.minNorthing - terrain.minNorthing,
    north: terrain.maxNorthing - bounds.maxNorthing,
  };
  if (Math.min(...Object.values(margin)) < LIDINGO_GROUND_GRAPH_CONFIG.minimumReferenceMarginMetres) {
    throw new Error('Lidingö reference leaves the retained terrain window or its minimum margin');
  }
  return { bounds, marginMetres: margin, routeCount: routes.length, featureCount: collection.features.length };
}

export function assertLidingoCompilation(compilation) {
  const config = LIDINGO_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId ||
      JSON.stringify(compilation.courseSlugs) !== JSON.stringify([config.courseSlug])) {
    throw new Error('Lidingö compilation identity differs');
  }
  for (const [field, value] of Object.entries(config.expectedBounds)) {
    if (compilation.bounds?.[field] !== value) throw new Error(`Lidingö compilation bounds differ at ${field}`);
  }
  for (const [field, value] of Object.entries(config.expectedCompile)) {
    const actual = field === 'levels' ? compilation.stats.levels.length : compilation.stats[field];
    if (actual !== value) throw new Error(`Lidingö compiled ${field} differs`);
  }
  if (compilation.stats.finiteSamples !== config.width * config.height ||
      compilation.stats.sourceSamples !== config.width * config.height) {
    throw new Error('Lidingö compilation contains missing source samples');
  }
  const minimum = compilation.pyramid.sourceMinimumHeightRH2000;
  const maximum = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      minimum < config.plausibleHeightRangeRH2000.minimum || maximum > config.plausibleHeightRangeRH2000.maximum) {
    throw new Error('Lidingö terrain exceeds the RH 2000 plausibility band');
  }
  return compilation;
}
