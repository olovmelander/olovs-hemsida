/* A bounded fixed-frontier view of a verified published ground graph.

   Graph/course/ground JSON has already passed CourseV2ManifestLoader before
   this module is called. This boundary then fetches only the reviewed finest
   terrain frontier, checks the manifest byte count and both encoded/decoded
   hashes, verifies the decoded tile identity/bounds, and creates the exact
   renderer resources consumed by V2TerrainLiveAdapter. */
import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { buildFrontierWaterBedField, carveDecodedTerrainTile } from './v2-water-bed.mjs';
import {
  createTerrainRenderResource,
  deriveTerrainRenderResource,
  sampleTerrainRenderResource,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { inscribedLegacyBounds, legacyGridBridge } from './geodetic-frame.mjs';

const EPSILON = 1e-6;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_TERRAIN_CHUNK_BYTES = 256 * 1024;
const MAX_FRONTIER_ENCODED_BYTES = 8 * 1024 * 1024;

function near(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= EPSILON;
}

function sameBounds(left, right) {
  return ['minEasting', 'minNorthing', 'maxEasting', 'maxNorthing']
    .every(key => near(left?.[key], right?.[key]));
}

function sortedUnique(values) {
  return Object.freeze([...values].sort((left, right) => left - right)
    .filter((value, index, all) => index === 0 || !near(value, all[index - 1])));
}

function createTerrainResourceSampler(resources) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('terrain resources are required');
  const first = resources[0];
  const spanX = (first.width - 1) * first.sampleSpacingMetres;
  const spanZ = (first.height - 1) * first.sampleSpacingMetres;
  if (!(spanX > 0 && spanZ > 0)) throw new Error('terrain frontier tile span is invalid');
  for (const resource of resources) {
    if (resource.width !== first.width || resource.height !== first.height ||
        !near(resource.sampleSpacingMetres, first.sampleSpacingMetres)) {
      throw new Error('terrain frontier is not a regular grid');
    }
  }
  const originsX = sortedUnique(resources.map(resource => resource.worldOriginX));
  const originsZ = sortedUnique(resources.map(resource => resource.worldOriginZ));
  const byCell = new Map();
  for (const resource of resources) {
    const column = originsX.findIndex(value => near(value, resource.worldOriginX));
    const row = originsZ.findIndex(value => near(value, resource.worldOriginZ));
    const key = `${column},${row}`;
    if (column < 0 || row < 0 || byCell.has(key)) throw new Error('terrain frontier tile grid is ambiguous');
    byCell.set(key, resource);
  }
  if (byCell.size !== originsX.length * originsZ.length) throw new Error('terrain frontier has a missing tile');
  for (let index = 1; index < originsX.length; index++) {
    if (!near(originsX[index] - originsX[index - 1], spanX)) throw new Error('terrain frontier has an easting gap');
  }
  for (let index = 1; index < originsZ.length; index++) {
    if (!near(originsZ[index] - originsZ[index - 1], spanZ)) throw new Error('terrain frontier has a northing gap');
  }
  const bounds = Object.freeze({
    x0: originsX[0], z0: originsZ[0],
    x1: originsX.at(-1) + spanX, z1: originsZ.at(-1) + spanZ,
  });
  const sample = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) ||
        x < bounds.x0 - EPSILON || x > bounds.x1 + EPSILON ||
        z < bounds.z0 - EPSILON || z > bounds.z1 + EPSILON) return Number.NaN;
    const column = Math.min(originsX.length - 1, Math.max(0, Math.floor((x - bounds.x0) / spanX)));
    const row = Math.min(originsZ.length - 1, Math.max(0, Math.floor((z - bounds.z0) / spanZ)));
    return sampleTerrainRenderResource(byCell.get(`${column},${row}`), x, z);
  };
  return Object.freeze({ bounds, sample });
}

function decimateTerrainRenderResources(resources, stride = 1) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('terrain resources are required');
  if (!Number.isSafeInteger(stride) || stride < 1 || stride > 8 || (stride & (stride - 1)) !== 0) {
    throw new RangeError('terrain render stride must be a power-of-two integer from 1 to 8');
  }
  if (stride === 1) return Object.freeze([...resources]);
  return Object.freeze(resources.map(resource => {
    const segmentsX = resource.width - 1;
    const segmentsZ = resource.height - 1;
    if (segmentsX % stride !== 0 || segmentsZ % stride !== 0) {
      throw new Error(`terrain tile ${resource.tileId} cannot use render stride ${stride}`);
    }
    const width = segmentsX / stride + 1;
    const height = segmentsZ / stride + 1;
    const textureData = new Uint8Array(width * height * 8);
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const source = ((row * stride) * resource.width + column * stride) * 8;
      const target = (row * width + column) * 8;
      textureData.set(resource.textureData.subarray(source, source + 8), target);
    }
    return Object.freeze({
      ...resource,
      width,
      height,
      textureData,
      sampleSpacingMetres: resource.sampleSpacingMetres * stride,
      geometricErrorMetres: Math.max(resource.geometricErrorMetres, resource.maximumMorphDeltaMetres),
      decodedSha256: `${resource.decodedSha256}:render-stride-${stride}`,
      gpuBytes: textureData.byteLength,
    });
  }));
}

function assertReviewedGraph(graph, geo, config) {
  if (!graph?.ground?.tiles || !graph?.ground?.frame || !graph?.summary) {
    throw new TypeError('a resolved published v2 graph is required');
  }
  if (graph.slug !== config.slug || graph.groundId !== config.groundId ||
      graph.ground.groundId !== config.groundId) {
    throw new Error('published graph identity does not match the reviewed frontier');
  }
  const frame = graph.ground.frame;
  if (frame.fingerprint !== config.frameFingerprint ||
      !['easting', 'northing', 'heightRH2000'].every(key =>
        near(frame.origin?.[key], config.canonicalOrigin[key]))) {
    throw new Error(`published graph frame does not match the reviewed ${config.slug} frame`);
  }
  if (!sameBounds(graph.ground.bounds, config.expectedBoundsEpsg5845)) {
    throw new Error(`published graph bounds do not match the reviewed ${config.slug} extraction`);
  }
  if (!BRIDGE_MODES.has(config.bridgeMode) ||
      !near(geo?.origin?.lat, config.packOriginWgs84.latitude) ||
      !near(geo?.origin?.lon, config.packOriginWgs84.longitude) ||
      !near(geo?.mPerLon, config.packMetresPerLongitude) || geo?.frame !== config.packFrame) {
    throw new Error(`${config.slug} GPK1 frame changed; the reviewed ${config.bridgeMode} bridge is no longer valid`);
  }
  if (graph.summary.surfaceTiles !== 0 || config.expectedSurfaceTileCount !== 0 ||
      config.surfacePolicy !== 'legacy-ground-atlas') {
    throw new Error(`${config.slug} zero-surface frontier policy changed without review`);
  }
  /* A frontier is a COMPLETE RECTANGLE of level-zero tiles, and it is not
     necessarily the whole of level zero.

     For the first five grounds it was: the reviewed metre window and the
     course window were the same 2,048 m square, so the frontier was every
     lod-0 tile in the graph. Ängsö is the first course whose own length
     forces them apart. Its played ground runs 2,167 m north to south, so its
     metre level had to be 4,096 m -- 256 tiles, 16.1 MiB, twice the budget a
     visitor may download before the first frame. The window a golfer actually
     needs at one metre is a sub-rectangle of that: what the frontier
     preloads, and what the streaming ring renderer serves beyond it, are two
     different questions and were only ever one answer by coincidence.

     So the set is chosen BY THE REVIEWED FRONTIER BOUNDS, for every ground.
     Where those bounds are the whole window the selection is every lod-0
     tile at column 0, row 0 -- the same code, the same assertions, no branch
     and no course named anywhere. */
  const allLevelZero = graph.ground.tiles.filter(tile => tile.lod === 0);
  if (allLevelZero.length === 0) throw new Error('published graph has no level-zero terrain tiles');
  const frontierBounds = config.expectedFrontierBoundsEpsg5845 || config.expectedBoundsEpsg5845;
  const tileSpan = allLevelZero[0].bounds.maxEasting - allLevelZero[0].bounds.minEasting;
  if (!(tileSpan > 0)) throw new Error('level-zero tiles have no extent');
  /* the graph's own lattice, so the column/row origin comes from the data */
  const latticeMinEasting = Math.min(...allLevelZero.map(tile => tile.bounds.minEasting));
  const latticeMaxNorthing = Math.max(...allLevelZero.map(tile => tile.bounds.maxNorthing));
  const tiles = allLevelZero.filter(tile =>
    tile.bounds.minEasting >= frontierBounds.minEasting - EPSILON &&
    tile.bounds.maxEasting <= frontierBounds.maxEasting + EPSILON &&
    tile.bounds.minNorthing >= frontierBounds.minNorthing - EPSILON &&
    tile.bounds.maxNorthing <= frontierBounds.maxNorthing + EPSILON);
  if (tiles.length !== config.expectedTileCount ||
      tiles.some(tile => tile.layers?.surface !== null || !tile.layers?.terrain ||
        !tile.courses?.includes(config.slug))) {
    throw new Error(`reviewed frontier requires ${config.expectedTileCount} complete level-zero terrain tiles and no v2 surfaces`);
  }
  /* The shape comes from the reviewed BOUNDS, never from the tile count: a
     count alone cannot tell 96 tiles in an 8 by 12 rectangle from 96 tiles
     scattered over the window. */
  const columns = Math.round((frontierBounds.maxEasting - frontierBounds.minEasting) / tileSpan);
  const rows = Math.round((frontierBounds.maxNorthing - frontierBounds.minNorthing) / tileSpan);
  if (columns < 1 || rows < 1 || columns * rows !== config.expectedTileCount) {
    throw new Error(`reviewed frontier bounds enclose ${columns} by ${rows} level-zero tiles, not ${config.expectedTileCount}`);
  }
  const column0 = Math.round((frontierBounds.minEasting - latticeMinEasting) / tileSpan);
  const row0 = Math.round((latticeMaxNorthing - frontierBounds.maxNorthing) / tileSpan);
  if (column0 < 0 || row0 < 0) {
    throw new Error('reviewed frontier bounds start outside the published level-zero lattice');
  }
  const ids = tiles.map(tile => tile.id).sort();
  const expectedIds = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    expectedIds.push(`l0/${column0 + column}/${row0 + row}`);
  }
  expectedIds.sort();
  if (new Set(ids).size !== config.expectedTileCount ||
      ids.some((id, index) => id !== expectedIds[index])) {
    throw new Error(`reviewed frontier is not the complete unique ${columns} by ${rows} level-zero tile set at column ${column0}, row ${row0}`);
  }
  const encodedBytes = tiles.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0);
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1 || encodedBytes > MAX_FRONTIER_ENCODED_BYTES ||
      tiles.some(tile => tile.layers.terrain.bytes > MAX_TERRAIN_CHUNK_BYTES)) {
    throw new Error('reviewed frontier exceeds its encoded-byte budget');
  }
  return Object.freeze({ tiles: Object.freeze(tiles), encodedBytes });
}

async function responseBytes(response, expectedBytes) {
  if (!response?.ok) throw new Error(`terrain frontier request failed with HTTP ${response?.status ?? 'unknown'}`);
  const encoding = response.headers?.get?.('content-encoding');
  const length = response.headers?.get?.('content-length');
  if ((!encoding || encoding.trim().toLowerCase() === 'identity') && length !== null && length !== undefined &&
      String(length).trim() !== '' && Number(length) !== expectedBytes) {
    await response.body?.cancel?.('terrain frontier response has an unexpected byte count');
    throw new Error(`terrain frontier response declares ${length} bytes; expected ${expectedBytes}`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedBytes) {
      throw new Error(`terrain frontier response has ${bytes.byteLength} bytes; expected ${expectedBytes}`);
    }
    return bytes;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > expectedBytes) {
      await reader.cancel('terrain frontier response exceeds its declared byte count');
      throw new Error(`terrain frontier response exceeds ${expectedBytes} bytes`);
    }
    chunks.push(value);
  }
  if (total !== expectedBytes) {
    throw new Error(`terrain frontier response has ${total} bytes; expected ${expectedBytes}`);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function mapConcurrent(items, operation) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      result[index] = await operation(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, items.length) }, worker));
  return result;
}

function identityBridge(frame, config) {
  const translateX = frame.origin.easting - config.canonicalOrigin.easting;
  const translateZ = config.canonicalOrigin.northing - frame.origin.northing;
  if (!near(translateX, 0) || !near(translateZ, 0)) {
    throw new Error('the reviewed EPSG:3006 identity bridge acquired a translation');
  }
  return Object.freeze({
    translateX,
    translateY: frame.origin.heightRH2000,
    translateZ,
    verticalDatumOffsetMetres: 0,
    rotationRadians: 0,
    scaleX: 1,
    scaleZ: 1,
    toLegacy: (gridX, gridZ) => [gridX, gridZ],
    toGrid: (legacyX, legacyZ) => [legacyX, legacyZ],
  });
}

/* A pack authored in the older flat-earth lat/lon frame does not share the
   grid's north OR its metre: EPSG:3006 northing points at GRID north and the
   pack's -z at TRUE north, and the pack's metres-per-degree constants are a
   sphere's rather than the ellipsoid's. Both terms are DERIVED from the two
   frames' own declared constants and are exact. The vertical term is not
   derivable at all -- legacy heights are Terrarium on an unrecorded datum --
   so it arrives already MEASURED in the reviewed config, and is the one number
   here that must be re-measured for every ground.

   Only the translation is baked into the tiles; the rotation and frame scale
   stay in the bridge and are applied at the two places that face the legacy
   world, `heightAt` and the render group's matrix. */
function legacyFrameBridge(frame, config) {
  const legacyFrame = config.legacyFrame;
  const legacyOrigin = config.legacyOriginEpsg3006;
  if (!Number.isFinite(legacyOrigin?.easting) || !Number.isFinite(legacyOrigin?.northing)) {
    throw new TypeError('the legacy-frame bridge needs a finite EPSG:3006 legacy origin');
  }
  const verticalDatumOffsetMetres = legacyFrame?.verticalDatumOffsetMetres;
  if (!Number.isFinite(verticalDatumOffsetMetres)) {
    throw new TypeError('the legacy-frame bridge needs a measured verticalDatumOffsetMetres');
  }
  const geodetic = legacyGridBridge(legacyFrame);
  return Object.freeze({
    translateX: frame.origin.easting - legacyOrigin.easting,
    /* tile height -> absolute RH 2000 -> the legacy frame's own datum */
    translateY: frame.origin.heightRH2000 + verticalDatumOffsetMetres,
    translateZ: legacyOrigin.northing - frame.origin.northing,
    verticalDatumOffsetMetres,
    rotationRadians: geodetic.rotationRadians,
    scaleX: geodetic.scaleX,
    scaleZ: geodetic.scaleZ,
    toLegacy: geodetic.toLegacy,
    toGrid: geodetic.toGrid,
    geodetic,
  });
}

const BRIDGE_MODES = new Map([
  ['epsg3006-local-rh2000', identityBridge],
  ['wgs84-legacy-frame', legacyFrameBridge],
]);

/** Load the reviewed l0 frontier from a manifest graph without inventing a
    second descriptor or weakening the graph's content-addressed references. */
export async function loadPublishedGraphTerrainFrontier({
  graph,
  geo,
  config,
  baseUrl = import.meta.env?.BASE_URL || '/',
  locationHref = globalThis.location?.href || 'https://banvy.invalid/',
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  DecompressionStreamImpl = globalThis.DecompressionStream,
  signal,
  waterBeds = null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (waterBeds !== null && typeof waterBeds !== 'function') throw new TypeError('waterBeds must be a function or null');
  const reviewed = assertReviewedGraph(graph, geo, config);
  /* The bridge and the reviewed window depend on the config alone, so they
     are known before a tile is fetched -- which is when the lake beds must
     be, because a tile is carved as it is decoded. */
  const bridge = BRIDGE_MODES.get(config.bridgeMode)(graph.ground.frame, config);
  const gridOrigin = config.bridgeMode === 'wgs84-legacy-frame'
    ? config.legacyOriginEpsg3006
    : config.canonicalOrigin;
  const frontierBounds = config.expectedFrontierBoundsEpsg5845 || config.expectedBoundsEpsg5845;
  const expectedLocalBounds = {
    x0: frontierBounds.minEasting - gridOrigin.easting,
    x1: frontierBounds.maxEasting - gridOrigin.easting,
    z0: gridOrigin.northing - frontierBounds.maxNorthing,
    z1: gridOrigin.northing - frontierBounds.minNorthing,
  };
  /* THE LAKE BEDS. Laser does not penetrate water, so a frontier tile inside
     a lake ring is the lake's surface, a hand's depth under the sheet the app
     draws -- and every tile is encoded with its own minimum as its floor, so
     a carve after the fact cannot go below that surface at all. The ring
     adapter carves as it decodes; so does this. The caller hands over the
     model's water (rings at their committed levels, and the traced silt
     shallows) as a function, because the model is inflated beside these
     tiles and is not a value yet when the load begins. */
  let waterBed = null, waterBedSummary = null;
  if (waterBeds) {
    const water = await waterBeds();
    if (water && Array.isArray(water.bodies) && water.bodies.length) {
      const started = Date.now();
      waterBed = buildFrontierWaterBedField({
        bounds: expectedLocalBounds,
        knownBodies: water.bodies,
        shallows: water.shallows ?? [],
        toLegacy: bridge.toLegacy,
        toGrid: bridge.toGrid,
        ...(water.profile ?? {}),
      });
      waterBedSummary = { cells: waterBed.cells, hectares: waterBed.hectares, maximumDepthMetres: waterBed.maximumDepthMetres,
        shallowCells: waterBed.shallowCells, carvedSamples: 0, carvedTiles: 0, rebasedTiles: 0, fieldMilliseconds: Date.now() - started };
    }
  }
  const carveOptions = { legacyOrigin: gridOrigin, verticalDatumOffsetMetres: bridge.verticalDatumOffsetMetres };
  const applicationBase = new URL(baseUrl, locationHref);
  if (globalThis.location && applicationBase.origin !== globalThis.location.origin) {
    throw new Error('terrain frontier application base must be same-origin');
  }
  const resources = await mapConcurrent(reviewed.tiles, async tile => {
    const reference = tile.layers.terrain;
    const url = resolveV2AssetUrl(reference.url, applicationBase.href);
    const response = await fetchImpl(url, {
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
    const encoded = await responseBytes(response, reference.bytes);
    const decoded = await verifyChunkAssetWeb(reference, encoded, {
      signal,
      cryptoImpl,
      DecompressionStreamImpl,
    });
    if (decoded.header.id !== tile.id || !sameBounds(decoded.header.bounds, tile.bounds)) {
      throw new Error(`terrain frontier tile ${tile.id} decoded with a different identity or footprint`);
    }
    let input = decoded;
    if (waterBed) {
      input = carveDecodedTerrainTile(decoded, waterBed, carveOptions);
      if (input !== decoded) {
        waterBedSummary.carvedSamples += input.waterBed.carvedSamples;
        waterBedSummary.carvedTiles++;
        if (input.waterBed.rebasedOffsetMetres !== null) waterBedSummary.rebasedTiles++;
      }
    }
    return createTerrainRenderResource({
      tileId: tile.id,
      decoded: input,
      frame: graph.ground.frame,
      lazyRenderData: true,
    });
  });

  const aligned = Object.freeze(resources.map(resource => deriveTerrainRenderResource(resource, {
    worldOriginX: resource.worldOriginX + bridge.translateX,
    worldOriginZ: resource.worldOriginZ + bridge.translateZ,
    heightOffsetWorld: resource.heightOffsetWorld + bridge.translateY,
  })));
  const sampler = createTerrainResourceSampler(aligned);
  /* Only the TRANSLATION is baked into the tiles, so the sampler still works in
     grid space -- but which origin that space is measured from depends on the
     bridge. The identity bridge leaves the tiles on the ground's own canonical
     origin; a legacy-frame bridge moves them onto the pack's origin, and the
     rotation that finishes the job lives in the group matrix, not here. */
  /* The frontier is the level-zero window, which is NOT the graph's extent as
     soon as the ground carries world rings: Veckefjärden's graph reaches a
     16,384 m root while its 8 by 8 metre-resolution frontier is 2,048 m across.
     A ground published without rings has one rectangle and says so by omitting
     this field. */
  if (!['x0', 'x1', 'z0', 'z1'].every(key => near(sampler.bounds[key], expectedLocalBounds[key]))) {
    throw new Error('decoded terrain frontier does not fill the reviewed local bounds');
  }
  /* Anything that can only omit an axis-aligned rectangle -- the legacy CORE
     and MID cutouts -- must be given the rectangle INSCRIBED in the rotated
     footprint, never the footprint itself, or it punches a hole the v2 mesh
     does not reach. Under the identity bridge the two are the same rectangle. */
  const legacyBounds = bridge.geodetic
    ? inscribedLegacyBounds(bridge.geodetic, sampler.bounds)
    : sampler.bounds;
  const decodedBytes = reviewed.tiles.reduce((sum, tile) => sum + tile.layers.terrain.decodedBytes, 0);
  const terrainGpuBytes = aligned.reduce((sum, resource) => sum + resource.gpuBytes, 0);
  const renderFrontiers = new Map([[1, aligned]]);
  const descriptor = Object.freeze({
    label: config.label,
    frame: graph.ground.frame,
    /* what this frontier COVERS, which is the level-zero window and not the
       graph's extent. graphCoversHorizon compares the two to decide whether the
       streaming ring renderer has anything to add: advertising the graph's own
       16 km bounds here made a ring ground look like it already reached the
       horizon, and the world adapter never took over. */
    bounds: frontierBounds,
    tiles: Object.freeze(reviewed.tiles.map(tile => Object.freeze({
      id: tile.id,
      reference: tile.layers.terrain,
    }))),
  });
  return Object.freeze({
    requested: true,
    ready: true,
    status: 'ready',
    reason: null,
    slug: config.slug,
    descriptor,
    surfaceDescriptor: null,
    surfaceAtlas: null,
    surfaceClassIds: Object.freeze([]),
    surfacePolicy: config.surfacePolicy,
    resources: aligned,
    bounds: sampler.bounds,
    legacyBounds,
    bridge,
    /* the carved lake beds, for the sampler's readers and the gates */
    waterBed,
    waterBedSummary: waterBedSummary ? Object.freeze(waterBedSummary) : null,
    /* `heightAt` takes LEGACY world coordinates and so goes through the
       bridge; `heightAtGrid` is for the caller that compares v2 against v2 and
       must not go round it. Under the identity bridge they coincide. */
    heightAt: (legacyX, legacyZ) => sampler.sample(...bridge.toGrid(legacyX, legacyZ)),
    heightAtGrid: sampler.sample,
    renderResources: stride => {
      if (!renderFrontiers.has(stride)) {
        renderFrontiers.set(stride, decimateTerrainRenderResources(aligned, stride));
      }
      return renderFrontiers.get(stride);
    },
    stats: () => Object.freeze({
      renderedTiles: aligned.length,
      encodedBytes: reviewed.encodedBytes,
      decodedBytes,
      gpuBytes: terrainGpuBytes,
      terrainEncodedBytes: reviewed.encodedBytes,
      terrainDecodedBytes: decodedBytes,
      terrainGpuBytes,
      surfaceEncodedBytes: 0,
      surfaceDecodedBytes: 0,
      surfaceTextureBytes: 0,
    }),
  });
}
