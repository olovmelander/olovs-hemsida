/* Tortuna's retained native sample lattice. These constants are independent
 * of the acquisition specification so a coordinated drift cannot shrink it. */
export const TORTUNA_GROUND_GRAPH_CONFIG = Object.freeze({
  groundId: 'tortuna', courseSlug: 'tortuna',
  sourceItemIds: Object.freeze(['661_59']),
  sourceHref: 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/66_5/m661_59.tif',
  sourceETag: '"f976297b6161d94a61255a568eb05e82"', sourceBytes: 303676386,
  sourceFloat32Sha256: '86f30a75f398cfa2da8c32b833b859c575a9056910b237ac2539fdbba3c02ef1',
  sampleSpacingMetres: 1, tileSegments: 256, width: 4097, height: 4097,
  originEasting: 595352.5, originNorthing: 6616947.5,
  pixelEdgeWindow: Object.freeze({ west: 595352, north: 6616948, east: 599449, south: 6612851 }),
  expectedBounds: Object.freeze({ minEasting: 595352.5, minNorthing: 6612851.5, maxEasting: 599448.5, maxNorthing: 6616947.5 }),
  plausibleHeightRangeRH2000: Object.freeze({ minimum: -5, maximum: 150 }),
  expectedCompile: Object.freeze({ levels: 5, tileChunks: 341, uniqueChunks: 342, rootTiles: 1 }),
});

export function assertTortunaAcquisition(acquisition, rasterSha256) {
  const c = TORTUNA_GROUND_GRAPH_CONFIG;
  if (acquisition?.groundId !== c.groundId || acquisition.phase !== 'authenticated-finest-terrain-window') throw new Error('Tortuna acquisition identity differs');
  if (!c.sourceFloat32Sha256 || rasterSha256 !== c.sourceFloat32Sha256 || acquisition.raster?.sha256 !== rasterSha256) throw new Error('Tortuna terrain differs from the pinned acquired raster');
  const lattice = acquisition.lattice;
  if (lattice?.horizontalCrs !== 'EPSG:3006' || lattice.verticalCrs !== 'EPSG:5613' || lattice.compoundCrs !== 'EPSG:5845' || JSON.stringify(lattice.coordinateOrder) !== JSON.stringify(['easting', 'northing'])) throw new Error('Tortuna acquisition requires EPSG:5845 in easting/northing order');
  for (const field of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) if (lattice[field] !== c[field]) throw new Error(`Tortuna acquisition lattice differs at ${field}`);
  for (const [field, value] of Object.entries(c.expectedBounds)) if (lattice.sampleCentreBounds?.[field] !== value) throw new Error(`Tortuna sample bounds differ at ${field}`);
  for (const [field, value] of Object.entries(c.pixelEdgeWindow)) if (lattice.pixelEdgeWindow?.[field] !== value) throw new Error(`Tortuna pixel edges differ at ${field}`);
  if (acquisition.raster.bytes !== c.width * c.height * 4 || acquisition.samples?.finite !== c.width * c.height || acquisition.samples.total !== acquisition.samples.finite) throw new Error('Tortuna source raster is incomplete');
  if (acquisition.sourceItems?.length !== 1 || acquisition.sourceItems[0].id !== c.sourceItemIds[0] || acquisition.sourceItems[0].href !== c.sourceHref || acquisition.sourceItems[0].etag !== c.sourceETag || acquisition.sourceItems[0].contentLength !== c.sourceBytes || acquisition.sourceItems[0].overviewFactorUsed !== 1) throw new Error('Tortuna requires the pinned full-resolution source item 661_59');
  return acquisition;
}

export function assertTortunaCompilation(compilation) {
  const c = TORTUNA_GROUND_GRAPH_CONFIG;
  if (compilation?.groundId !== c.groundId || JSON.stringify(compilation.courseSlugs) !== '["tortuna"]') throw new Error('Tortuna compilation identity differs');
  for (const [field, value] of Object.entries(c.expectedBounds)) if (compilation.bounds?.[field] !== value) throw new Error(`Tortuna compilation bounds differ at ${field}`);
  for (const [field, value] of Object.entries(c.expectedCompile)) if ((field === 'levels' ? compilation.stats.levels.length : compilation.stats[field]) !== value) throw new Error(`Tortuna compilation ${field} differs`);
  if (compilation.stats.finiteSamples !== c.width * c.height || compilation.stats.sourceSamples !== c.width * c.height) throw new Error('Tortuna compilation contains missing source samples');
  if (!Number.isFinite(compilation.pyramid?.sourceMinimumHeightRH2000) || !Number.isFinite(compilation.pyramid?.sourceMaximumHeightRH2000) || compilation.pyramid.sourceMinimumHeightRH2000 < c.plausibleHeightRangeRH2000.minimum || compilation.pyramid.sourceMaximumHeightRH2000 > c.plausibleHeightRangeRH2000.maximum) throw new Error('Tortuna height range is implausible');
  return compilation;
}

/* compileTerrainAssets deliberately omits pyramid parents. Restore only the
 * already compiled topology: no payload, bounds, shell or height changes. */
export function attachTortunaTerrainParents(compilation) {
  assertTortunaCompilation(compilation);
  const source = new Map(compilation.pyramid.levels.flatMap(level => level.tiles.map(tile => [tile.id, tile])));
  const tiles = compilation.tiles.map(tile => {
    const original = source.get(tile.id);
    if (!original || original.lod !== tile.lod) throw new Error(`Missing Tortuna pyramid tile ${tile.id}`);
    const parentId = original.parentId;
    if (parentId !== null) {
      const parent = source.get(parentId);
      if (!parent || parent.lod !== tile.lod + 1 || parent.bounds.minEasting > tile.bounds.minEasting || parent.bounds.maxEasting < tile.bounds.maxEasting || parent.bounds.minNorthing > tile.bounds.minNorthing || parent.bounds.maxNorthing < tile.bounds.maxNorthing) throw new Error(`Tortuna tile ${tile.id} has no containing parent`);
    }
    return Object.freeze({ ...tile, parentId });
  });
  if (new Set(tiles.map(tile => tile.id)).size !== 341 || tiles.filter(tile => tile.parentId !== null).length !== 340) throw new Error('Tortuna requires 341 tiles and all 340 parent links');
  return Object.freeze({ ...compilation, tiles: Object.freeze(tiles) });
}

export function assertTortunaTerrainRetention(previous, next) {
  if (!previous) return;
  if (previous.groundId !== 'tortuna' || next.groundId !== 'tortuna' || JSON.stringify(previous.frame) !== JSON.stringify(next.frame)) throw new Error('Tortuna published frame cannot change');
  if (JSON.stringify(previous.bounds) !== JSON.stringify(next.bounds) || JSON.stringify(previous.shell) !== JSON.stringify(next.shell)) throw new Error('Tortuna published terrain bounds and shell cannot change');
  const before = new Map(previous.tiles.map(tile => [tile.id, tile]));
  /* the live set is compared as a whole: the 341-tile pyramid before the ring publish, the 469-tile standard graph after it */
  if (before.size < 341 || next.tiles.length !== before.size || new Set(next.tiles.map(tile => tile.id)).size !== before.size) throw new Error('Tortuna published terrain coverage cannot shrink');
  for (const tile of next.tiles) {
    const old = before.get(tile.id);
    if (!old || old.lod !== tile.lod || old.parentId !== tile.parentId || old.geometricErrorMetres !== tile.geometricErrorMetres || JSON.stringify(old.bounds) !== JSON.stringify(tile.bounds) || JSON.stringify(old.layers.terrain) !== JSON.stringify(tile.layers.terrain)) throw new Error(`Tortuna published terrain tile ${tile.id} cannot change`);
  }
}
