/* Visby's first terrain source intake. No canonical origin or playable graph
   is approved by this contract. The full property includes future shared-ground
   routings; only the current visby slug is registered. */
export const VISBY_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'visby', courseSlugs: Object.freeze(['visby']),
  sourceItemIds: Object.freeze(['636_68', '637_68']),
  sourceFloat32Sha256: 'deb6ce495470335a7778da55485ca63ec46386bdfd2bdf9d0a8ddf90a4e4e898',
  sourceExtents: Object.freeze({
    '636_68': Object.freeze({ west: 685000, north: 6370000, east: 690000, south: 6365000 }),
    '637_68': Object.freeze({ west: 685000, north: 6380000, east: 690000, south: 6370000 }),
  }),
  sampleSpacingMetres: 1, tileSegments: 256, width: 4097, height: 4097,
  originEasting: 685700.5, originNorthing: 6372999.5,
  pixelEdgeWindow: Object.freeze({ west: 685700, north: 6373000, east: 689797, south: 6368903 }),
  expectedBounds: Object.freeze({ minEasting: 685700.5, minNorthing: 6368903.5, maxEasting: 689796.5, maxNorthing: 6372999.5 }),
  propertyFeatureId: 'way/199830330', minimumReferenceMarginMetres: 250,
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 100 }),
  expectedCompile: Object.freeze({ levels: 5, tileChunks: 341, uniqueChunks: 342, rootTiles: 1 }),
});

export function assertVisbyAcquisition(acquisition, rasterSha256, discovery) {
  const config = VISBY_GROUND_GRAPH_CONFIG;
  if (acquisition?.groundId !== config.groundId || acquisition.phase !== 'authenticated-finest-terrain-window') throw new Error('Visby terrain acquisition identity differs');
  if (rasterSha256 !== config.sourceFloat32Sha256 || acquisition.raster?.sha256 !== rasterSha256) throw new Error('Visby terrain differs from the pinned acquired raster');
  const lattice = acquisition.lattice;
  if (lattice?.horizontalCrs !== 'EPSG:3006' || lattice.verticalCrs !== 'EPSG:5613' || lattice.compoundCrs !== 'EPSG:5845' ||
      JSON.stringify(lattice.coordinateOrder) !== JSON.stringify(['easting', 'northing'])) throw new Error('Visby terrain must declare the EPSG:5845 frame and axis order');
  for (const key of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) {
    if (lattice[key] !== config[key]) throw new Error(`Visby acquisition lattice differs at ${key}`);
  }
  for (const [key, value] of Object.entries(config.expectedBounds)) if (lattice.sampleCentreBounds?.[key] !== value) throw new Error(`Visby sample bounds differ at ${key}`);
  for (const [key, value] of Object.entries(config.pixelEdgeWindow)) if (lattice.pixelEdgeWindow?.[key] !== value) throw new Error(`Visby pixel edges differ at ${key}`);
  if (acquisition.raster.bytes !== config.width * config.height * 4 || acquisition.raster.format !== 'row-major little-endian Float32, north-up') throw new Error('Visby raster encoding differs');
  if (discovery?.groundId !== config.groundId || discovery.terrain?.compoundCrs !== 'EPSG:5845' || !discovery.terrain.crsValidated) throw new Error('Visby requires retained compound-CRS source discovery');
  if (JSON.stringify(acquisition.sourceItems?.map(item => item.id)) !== JSON.stringify(config.sourceItemIds)) throw new Error('Visby source item order differs');
  for (const item of acquisition.sourceItems) {
    const source = discovery.terrain.items?.find(entry => entry.id === item.id);
    if (item.href !== `https://dl1.lantmateriet.se/hojd/data/grid/mhm/63_6/m${item.id}.tif` ||
        source?.assets?.data?.href !== item.href || source.assets.data.projCode !== 'EPSG:5845' ||
        item.overviewFactorUsed !== 1 || item.noData !== -9999) throw new Error(`Visby ${item.id} source provenance or full resolution differs`);
    for (const [key, value] of Object.entries(config.sourceExtents[item.id])) if (item.sourceExtent?.[key] !== value) throw new Error(`Visby ${item.id} source extent differs`);
    const extent = config.sourceExtents[item.id];
    const sourceRaster = { width: extent.east - extent.west, height: extent.north - extent.south, originX: extent.west, originY: extent.north, pixelScaleX: 1, pixelScaleY: 1 };
    if (Object.entries(sourceRaster).some(([key, value]) => item.sourceRaster?.[key] !== value)) throw new Error(`Visby ${item.id} source raster lattice differs`);
    const window = item.id === '636_68'
      ? { windowPixels: { column0: 700, row0: 0, columns: 4097, rows: 1097 }, latticeWindow: { column0: 0, row0: 3000, columns: 4097, rows: 1097 } }
      : { windowPixels: { column0: 700, row0: 7000, columns: 4097, rows: 3000 }, latticeWindow: { column0: 0, row0: 0, columns: 4097, rows: 3000 } };
    for (const [field, values] of Object.entries(window)) if (Object.entries(values).some(([key, value]) => item[field]?.[key] !== value)) throw new Error(`Visby ${item.id} source seam window differs`);
    if (JSON.stringify(source.assets.data.projBbox) !== JSON.stringify([extent.west, extent.south, extent.east, extent.north])) throw new Error(`Visby ${item.id} discovery extent differs`);
  }
  if (acquisition.samples?.finite !== config.width * config.height || acquisition.samples.total !== acquisition.samples.finite) throw new Error('Visby acquisition has missing source samples');
  return acquisition;
}

export function assertVisbyReferenceExtent(collection) {
  const config = VISBY_GROUND_GRAPH_CONFIG;
  if (collection?.type !== 'FeatureCollection' || collection.crs?.properties?.name !== 'EPSG:3006') throw new Error('Visby reference must use EPSG:3006');
  const property = collection.features?.filter(feature => feature.id === config.propertyFeatureId);
  if (property?.length !== 1 || property[0].properties?.tags?.leisure !== 'golf_course' || property[0].geometry?.type !== 'Polygon') throw new Error('Visby reference requires its identified property polygon exactly once');
  const points = property[0].geometry.coordinates.flat();
  if (points.length < 4 || !points.every(point => point.length === 2 && point.every(Number.isFinite))) throw new Error('Visby property coordinates are invalid');
  const bounds = { minEasting: Math.min(...points.map(p => p[0])), minNorthing: Math.min(...points.map(p => p[1])), maxEasting: Math.max(...points.map(p => p[0])), maxNorthing: Math.max(...points.map(p => p[1])) };
  const terrain = config.expectedBounds;
  const marginMetres = { west: bounds.minEasting - terrain.minEasting, east: terrain.maxEasting - bounds.maxEasting, south: bounds.minNorthing - terrain.minNorthing, north: terrain.maxNorthing - bounds.maxNorthing };
  if (Math.min(...Object.values(marginMetres)) < config.minimumReferenceMarginMetres) throw new Error('Visby property leaves the terrain window or its minimum reference margin');
  return { propertyFeatureId: config.propertyFeatureId, bounds, marginMetres };
}

export function assertVisbyCompilation(compilation) {
  const config = VISBY_GROUND_GRAPH_CONFIG;
  if (compilation.groundId !== config.groundId || JSON.stringify(compilation.courseSlugs) !== JSON.stringify(config.courseSlugs)) throw new Error('Visby compilation identity differs');
  for (const [key, value] of Object.entries(config.expectedBounds)) if (compilation.bounds?.[key] !== value) throw new Error(`Visby compiled bounds differ at ${key}`);
  for (const [key, value] of Object.entries(config.expectedCompile)) {
    if ((key === 'levels' ? compilation.stats.levels.length : compilation.stats[key]) !== value) throw new Error(`Visby compiled ${key} differs`);
  }
  if (compilation.stats.finiteSamples !== config.width * config.height || compilation.stats.sourceSamples !== config.width * config.height) throw new Error('Visby compilation has missing source samples');
  const min = compilation.pyramid.sourceMinimumHeightRH2000, max = compilation.pyramid.sourceMaximumHeightRH2000;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < config.plausibleHeightRangeRH2000.minimum || max > config.plausibleHeightRangeRH2000.maximum) throw new Error('Visby terrain leaves its RH2000 plausibility band');
  return compilation;
}
