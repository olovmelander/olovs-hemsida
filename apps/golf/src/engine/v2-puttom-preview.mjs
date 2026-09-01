import { inscribedLegacyBounds, legacyGridBridge } from './geodetic-frame.mjs';
import { SURFACE } from './surface.js';

export const PUTTOM_PREVIEW_CONFIG = Object.freeze({
  slug: 'puttom',
  /* The pilot is a VIEW of the published ground graph, not a second extraction:
     the graph's 64 finest tiles already cover 2048 x 2048 m, which is the only
     power-of-two window that holds the whole course. See
     packages/course-v2/derive-preview-from-graph.mjs. The descriptor lives
     beside the graph because resolveTerrainPreviewAssetUrl refuses an asset
     outside its own directory. */
  descriptorPath: 'grounds/puttom/preview.json',
  label: 'Puttom · Lantmäteriet 1 m terräng',
  descriptorSha256: 'be3d4676c7580e75e612ddfe3585be1b905f4c6da4bcfdb34456f1b9673657ed',
  surfaceDescriptorPath: 'grounds/puttom/surface-preview.json',
  surfaceLabel: 'Puttom · migrerade ytor (ej inmätta)',
  surfaceDescriptorSha256: 'f64d662114a13b24ea47e73b686a20dfd3f16d88cda6468cdaa56515bd286a09',
  surfaceProvisionalReason: 'migration-vectors-not-survey-approved',
  frameFingerprint: '07385de7aae61f2e4399e3e18e1df931c86f2bdff4ec233319bfd2d3f03377c8',
  packOriginWgs84: Object.freeze({ latitude: 63.2992, longitude: 18.9413 }),
  /* EPSG:3006 projection of the immutable GPK1 WGS84 origin. This bridge keeps
     the legacy +x east/-z TRUE north frame while the preview remains
     provisional -- and true north is not the grid north the tiles are cut on,
     which is what geodetic-frame.mjs exists to reconcile. */
  legacyOriginEpsg3006: Object.freeze({
    easting: 697498.021708,
    northing: 7024997.739459,
  }),
  /* The pack's OWN flat-earth constants, as puttombuild/lib.mjs declares them.
     They are not the ellipsoid's, and the bridge needs the difference; the
     pack's `geo.mPerLon` is checked against them on every boot so a build that
     changes its frame cannot slip past a bridge computed for the old one. */
  legacyFrame: Object.freeze({
    latitude: 63.2992,
    longitude: 18.9413,
    metresPerLatitude: 111320,
    metresPerLongitude: 111320 * Math.cos(63.2992 * Math.PI / 180),
    /* ------------------------------------------------ MEASURED, not derived.
       The horizontal bridge comes out of the frames' own constants and is exact.
       This one cannot: the legacy heights are AWS Terrarium and the pack never
       recorded what datum they are on -- every migration file in this repo says
       so, `"vertical datum was not persisted"`. There is nothing to derive an
       offset TO. So it is measured, and it says it was measured.

       Legacy minus v2, sampled through the shipped bridge on the played ground
       where both products describe the same mown surface: median 23.6263 m over
       5,319 samples, MAD 0.2432 m. The whole overlap gives 23.6704 m, which
       agrees to four centimetres and is corroboration rather than the source.
       The value is the played-ground median because that is the ground a player
       stands on and the ground the two models actually agree about.

       It is about the geoid height at Puttom, which is what a Terrarium-versus-
       RH 2000 difference should be, but that is a sanity check on the number and
       NOT how it was obtained. Re-measure it per course; the geoid runs from
       roughly 17 to 37 m across Sweden and no other course has a pilot yet. */
    verticalDatumOffsetMetres: 23.6263,
  }),
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 696404.5,
    minNorthing: 7023802.5,
    minHeightRH2000: 26.12063217163086,
    maxEasting: 698452.5,
    maxNorthing: 7025850.5,
    maxHeightRH2000: 103.21914672851562,
  }),
  expectedTileCount: 64,
  /* The surface layer paints the COURSE; the terrain layer carries the WORLD,
     and they do not need the same extent. All 64 terrain tiles at 1 m surface
     decode to 56 MiB, past the compiler's 32 MiB active budget -- and three
     fifths of those bytes would be describing rough. Coarsening the raster
     instead would be the wrong economy: a green's edge is exactly what this
     layer is for, and the plan's own ground-atlas work already found that a
     1.5 m mow ring cannot live in a 1 m raster, let alone a 2 m one.
     So the surface covers the tiles the played ground touches with a 32 m
     margin: 5 x 6 of the 8 x 8, 1280 x 1536 m, 26.5 MiB. The played geometry
     clears its edges by 39 to 240 m. */
  surfaceWindowEpsg3006: Object.freeze({
    minEasting: 696916.5,
    minNorthing: 7024314.5,
    maxEasting: 698196.5,
    maxNorthing: 7025850.5,
  }),
  expectedSurfaceTileCount: 30,
  legacyCoreCutout: Object.freeze({
    guardCells: 2,
    guardMetres: 8,
    /* Reviewed after main.js has normalised the mown-edge geometry. The
       post-normalisation Puttom z minimum snaps to -756, not the raw pack's
       -792, so this spatial contract deliberately accompanies the counts. */
    expectedCoreGrid: Object.freeze({
      dx: 4,
      x0: -648,
      x1: 648,
      z0: -756,
      z1: 756,
      nx: 325,
      nz: 379,
    }),
    /* The wide frontier CONTAINS the whole CORE, so the hole is CORE clamped to
       itself and all that survives is the 8 m guard rim -- 118,987 of 123,175
       points, 96.6%. cutTerrainPreviewRect then removes the rim's triangles as
       well, on the rotated footprint. The pilot replaces the legacy CORE in
       everything but name, through the machinery that was already there and
       with the fail-closed rebuild untouched. */
    expectedSkippedBasePoints: 118_987,
    expectedTotalBasePoints: 123_175,
  }),
});

export const PUTTOM_PREVIEW_REQUIRED_SURFACE_CLASSES = Object.freeze([
  Object.freeze({ id: SURFACE.ROUGH, label: 'rough' }),
  Object.freeze({ id: SURFACE.FAIRWAY, label: 'fairway' }),
  Object.freeze({ id: SURFACE.GREEN, label: 'green' }),
  Object.freeze({ id: SURFACE.TEE, label: 'tee' }),
  Object.freeze({ id: SURFACE.SAND, label: 'sand' }),
]);

/* inspectSurfacePayload() inventories both the primary material and its
   non-no-data secondary neighbour. That union is the semantic surface
   contract: the signed-distance shader can legitimately promote the
   higher-priority neighbour to primary across an entire narrow class, as it
   does for Puttom rough. A primary-only histogram is therefore diagnostic
   coverage, never proof that a class is absent. */
export function verifiedSurfaceClassIds(resources) {
  if (!Array.isArray(resources) || !resources.length) {
    throw new TypeError('verified surface resources are required');
  }
  const ids = new Set();
  for (const resource of resources) {
    const surfaceIds = resource?.inspection?.surfaceIds;
    if (!Array.isArray(surfaceIds) || !surfaceIds.length) {
      throw new Error(`surface resource ${resource?.tileId || 'unknown'} has no verified class inventory`);
    }
    for (const surfaceId of surfaceIds) {
      if (!Number.isSafeInteger(surfaceId) || surfaceId < 0 || surfaceId >= 255) {
        throw new Error(`surface resource ${resource?.tileId || 'unknown'} has invalid class id ${surfaceId}`);
      }
      ids.add(surfaceId);
    }
  }
  return Object.freeze([...ids].sort((left, right) => left - right));
}

export function assertPuttomSurfaceCoverage(classCounts) {
  if ((!Array.isArray(classCounts) && !ArrayBuffer.isView(classCounts)) || classCounts.length < 1) {
    throw new TypeError('classified surface coverage counts are required');
  }
  const missing = PUTTOM_PREVIEW_REQUIRED_SURFACE_CLASSES
    .filter(({ id }) => !Number.isSafeInteger(classCounts[id]) || classCounts[id] < 1)
    .map(({ label }) => label);
  if (missing.length) throw new Error(`Puttom surface preview is missing ${missing.join(', ')}`);
  return classCounts;
}

const EPSILON = 1e-6;

function near(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= EPSILON;
}

function immutableState(value) {
  return Object.freeze({
    requested: false,
    ready: false,
    status: 'off',
    reason: null,
    descriptor: null,
    surfaceDescriptor: null,
    surfaceAtlas: null,
    surfaceClassIds: Object.freeze([]),
    resources: Object.freeze([]),
    bounds: null,
    legacyBounds: null,
    bridge: null,
    heightAt: () => Number.NaN,
    heightAtGrid: () => Number.NaN,
    renderResources: () => Object.freeze([]),
    stats: () => Object.freeze({ renderedTiles: 0, encodedBytes: 0, decodedBytes: 0, gpuBytes: 0 }),
    ...value,
  });
}

export function decimateTerrainRenderResources(resources, stride = 1) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('terrain resources are required');
  if (!Number.isSafeInteger(stride) || stride < 1 || stride > 8 || (stride & (stride - 1)) !== 0) {
    throw new RangeError('terrain render stride must be a power-of-two integer from 1 to 8');
  }
  if (stride === 1) return Object.freeze([...resources]);
  return Object.freeze(resources.map(resource => {
    const segmentsX = resource.width - 1, segmentsZ = resource.height - 1;
    if (segmentsX % stride !== 0 || segmentsZ % stride !== 0) {
      throw new Error(`terrain tile ${resource.tileId} cannot use render stride ${stride}`);
    }
    const width = segmentsX / stride + 1, height = segmentsZ / stride + 1;
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

export function puttomPreviewRequested(slug, search = globalThis.location?.search || '') {
  return slug === PUTTOM_PREVIEW_CONFIG.slug && new URLSearchParams(search).get('v2') === '1';
}

/* The explicit not-loaded state the selection boundary hands the app when a v2
   request cannot (yet) be served by this retained pilot, so every consumer of
   the preview interface sees one shape whatever the selection outcome was. */
export function fallbackTerrainPreviewState({ slug, reason }) {
  if (typeof slug !== 'string' || !slug) throw new TypeError('slug is required');
  if (typeof reason !== 'string' || !reason) throw new TypeError('an explicit fallback reason is required');
  return immutableState({ requested: true, status: 'fallback', reason, slug });
}

function validatePuttomDescriptor(descriptor, geo) {
  if (descriptor.label !== PUTTOM_PREVIEW_CONFIG.label) {
    throw new Error('Puttom preview label does not match the approved pilot');
  }
  if (descriptor.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedTileCount) {
    throw new Error(`Puttom preview has ${descriptor.tiles.length} tiles; expected ${PUTTOM_PREVIEW_CONFIG.expectedTileCount}`);
  }
  if (descriptor.frame.fingerprint !== PUTTOM_PREVIEW_CONFIG.frameFingerprint ||
      !near(descriptor.frame.origin.heightRH2000, 26.12)) {
    throw new Error('Puttom preview frame fingerprint does not match the reviewed pilot');
  }
  for (const [field, expected] of Object.entries(PUTTOM_PREVIEW_CONFIG.expectedBoundsEpsg5845)) {
    if (!near(descriptor.bounds[field], expected)) {
      throw new Error(`Puttom preview ${field} does not match its verified extraction window`);
    }
  }
  const expectedFrameOrigin = {
    easting: (descriptor.bounds.minEasting + descriptor.bounds.maxEasting) / 2,
    northing: (descriptor.bounds.minNorthing + descriptor.bounds.maxNorthing) / 2,
  };
  if (!near(descriptor.frame.origin.easting, expectedFrameOrigin.easting) ||
      !near(descriptor.frame.origin.northing, expectedFrameOrigin.northing)) {
    throw new Error('Puttom preview frame is not centred on its extraction window');
  }
  if (!near(geo?.origin?.lat, PUTTOM_PREVIEW_CONFIG.packOriginWgs84.latitude) ||
      !near(geo?.origin?.lon, PUTTOM_PREVIEW_CONFIG.packOriginWgs84.longitude) ||
      geo?.frame !== 'local metres about ORIGIN; north -z, east +x') {
    throw new Error('Puttom GPK1 frame changed; the provisional EPSG:3006 bridge must be recalculated');
  }
  /* reconcile.mjs rounds mPerLon to two decimals on the way into the pack, so
     compare at that resolution and no finer. */
  const declaredMetresPerLongitude = Math.round(PUTTOM_PREVIEW_CONFIG.legacyFrame.metresPerLongitude * 100) / 100;
  if (Math.abs(geo?.mPerLon - declaredMetresPerLongitude) > 0.005) {
    throw new Error(
      `Puttom GPK1 frame scale changed: pack says ${geo?.mPerLon} m/deg, the bridge was derived for ${declaredMetresPerLongitude}`,
    );
  }
}

function validatePuttomSurfaceDescriptor(descriptor, terrainDescriptor, packSha256) {
  if (descriptor.label !== PUTTOM_PREVIEW_CONFIG.surfaceLabel ||
      descriptor.provisionalReason !== PUTTOM_PREVIEW_CONFIG.surfaceProvisionalReason) {
    throw new Error('Puttom surface preview does not retain its migration provenance');
  }
  if (descriptor.terrainDescriptorSha256 !== PUTTOM_PREVIEW_CONFIG.descriptorSha256 ||
      descriptor.frameFingerprint !== terrainDescriptor.frame.fingerprint) {
    throw new Error('Puttom surface preview is not bound to the active terrain preview frame');
  }
  if (!/^[a-f0-9]{64}$/.test(packSha256 || '') || descriptor.source.packSha256 !== packSha256) {
    throw new Error('Puttom surface preview was not derived from the verified active GPK1 pack');
  }
  /* The surface frontier is a rectangular SUBSET of the terrain frontier -- see
     surfaceWindowEpsg3006 -- so it is checked as a subset drawn from it, at its
     own reviewed count. Equality here is what caught this change when the
     adapter and the build gate had already been taught the subset and the
     loader had not; the count is what stops the subset from quietly shrinking. */
  const terrainIds = new Set(terrainDescriptor.tiles.map(tile => tile.id));
  if (descriptor.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount ||
      descriptor.tiles.some(tile => !terrainIds.has(tile.id))) {
    throw new Error(
      `Puttom surface preview has ${descriptor.tiles.length} tiles drawn from the terrain frontier; ` +
      `expected ${PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount}`,
    );
  }
}

function sortedUnique(values) {
  const result = [...values].sort((a, b) => a - b).filter((value, index, all) =>
    index === 0 || Math.abs(value - all[index - 1]) > EPSILON);
  return Object.freeze(result);
}

/* Kept local so the normal GPK1 player does not statically pull the v2 decoder
   chunk into its critical path. The loader and renderer remain true dynamic
   imports and the PWA can exclude them until ?v2=1 is requested. */
function sampleTerrainResource(resource, worldX, worldZ) {
  const column = (worldX - resource.worldOriginX) / resource.sampleSpacingMetres;
  const row = (worldZ - resource.worldOriginZ) / resource.sampleSpacingMetres;
  if (column < -1e-9 || row < -1e-9 ||
      column > resource.width - 1 + 1e-9 || row > resource.height - 1 + 1e-9) return Number.NaN;
  const x = Math.max(0, Math.min(resource.width - 1, column));
  const y = Math.max(0, Math.min(resource.height - 1, row));
  const west = Math.floor(x), east = Math.min(resource.width - 1, west + 1);
  const north = Math.floor(y), south = Math.min(resource.height - 1, north + 1);
  const at = (columnIndex, rowIndex) => {
    const offset = (rowIndex * resource.width + columnIndex) * 8;
    const quantized = resource.textureData[offset] | resource.textureData[offset + 1] << 8;
    return quantized === resource.noDataValue
      ? Number.NaN
      : resource.heightOffsetWorld + quantized * resource.heightScaleMetres;
  };
  const samples = [at(west, north), at(east, north), at(west, south), at(east, south)];
  if (samples.some(Number.isNaN)) return Number.NaN;
  const tx = x - west, ty = y - north;
  const top = samples[0] + (samples[1] - samples[0]) * tx;
  const bottom = samples[2] + (samples[3] - samples[2]) * tx;
  return top + (bottom - top) * ty;
}

export function createTerrainResourceSampler(resources) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('terrain resources are required');
  const first = resources[0];
  const spanX = (first.width - 1) * first.sampleSpacingMetres;
  const spanZ = (first.height - 1) * first.sampleSpacingMetres;
  if (!(spanX > 0 && spanZ > 0)) throw new Error('terrain preview tile span is invalid');
  for (const resource of resources) {
    if (resource.width !== first.width || resource.height !== first.height ||
        !near(resource.sampleSpacingMetres, first.sampleSpacingMetres)) {
      throw new Error('terrain preview finest frontier is not a regular grid');
    }
  }
  const originsX = sortedUnique(resources.map(resource => resource.worldOriginX));
  const originsZ = sortedUnique(resources.map(resource => resource.worldOriginZ));
  const byCell = new Map();
  for (const resource of resources) {
    const column = originsX.findIndex(value => near(value, resource.worldOriginX));
    const row = originsZ.findIndex(value => near(value, resource.worldOriginZ));
    const key = `${column},${row}`;
    if (column < 0 || row < 0 || byCell.has(key)) throw new Error('terrain preview tile grid is ambiguous');
    byCell.set(key, resource);
  }
  if (byCell.size !== originsX.length * originsZ.length) {
    throw new Error('terrain preview finest frontier has a missing tile');
  }
  for (let index = 1; index < originsX.length; index++) {
    if (!near(originsX[index] - originsX[index - 1], spanX)) throw new Error('terrain preview has an easting gap');
  }
  for (let index = 1; index < originsZ.length; index++) {
    if (!near(originsZ[index] - originsZ[index - 1], spanZ)) throw new Error('terrain preview has a northing gap');
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
    return sampleTerrainResource(byCell.get(`${column},${row}`), x, z);
  };
  return Object.freeze({ bounds, sample });
}

/**
 * Bridge a loaded EPSG:3006 preview into a legacy pack world.
 *
 * The tiles stay on their own axis-aligned grid: only the translation is baked
 * into them, so the sampler and the tile lattice keep working in GRID space
 * where they are rectangles. Rotation and frame scale live in the bridge,
 * applied at the two places that face the legacy world -- `sample()`, which
 * takes legacy coordinates, and the render group's matrix.
 *
 * The surface atlas is a third thing and is NOT bridged: it is the pack's own
 * legacy vectors rasterised onto this lattice, so its cells are legacy metres
 * that merely happen to share these numbers. See the note in
 * engine/material.js, which measured it.
 *
 * `bounds` is therefore still the grid-frame rectangle. `legacyBounds` is the
 * axis-aligned legacy rectangle inscribed in the rotated footprint, which is
 * what anything that can only omit a rectangle (the legacy CORE cutout) must
 * be given instead.
 */
export function alignTerrainPreviewToLegacyFrame(loaded, legacyOriginEpsg3006, legacyFrame) {
  const { descriptor, resources } = loaded || {};
  if (!descriptor?.frame?.origin || !Array.isArray(resources) || !resources.length) {
    throw new TypeError('a loaded terrain preview is required');
  }
  if (!Number.isFinite(legacyOriginEpsg3006?.easting) || !Number.isFinite(legacyOriginEpsg3006?.northing)) {
    throw new TypeError('a finite EPSG:3006 legacy origin is required');
  }
  const geodetic = legacyGridBridge(legacyFrame ?? {});
  /* Deliberately applied here and NOT inside geodetic-frame.mjs: everything in
     that module is derived from declared constants and exact, and mixing a
     measured term into it would blur the one distinction worth keeping. */
  const verticalDatumOffsetMetres = legacyFrame?.verticalDatumOffsetMetres ?? 0;
  if (!Number.isFinite(verticalDatumOffsetMetres)) {
    throw new TypeError('verticalDatumOffsetMetres must be finite when provided');
  }
  const bridge = Object.freeze({
    translateX: descriptor.frame.origin.easting - legacyOriginEpsg3006.easting,
    /* tile height -> absolute RH 2000 -> the legacy frame's own datum */
    translateY: descriptor.frame.origin.heightRH2000 + verticalDatumOffsetMetres,
    verticalDatumOffsetMetres,
    translateZ: legacyOriginEpsg3006.northing - descriptor.frame.origin.northing,
    rotationRadians: geodetic.rotationRadians,
    scaleX: geodetic.scaleX,
    scaleZ: geodetic.scaleZ,
    toLegacy: geodetic.toLegacy,
    toGrid: geodetic.toGrid,
  });
  const aligned = resources.map(resource => Object.freeze({
    ...resource,
    worldOriginX: resource.worldOriginX + bridge.translateX,
    worldOriginZ: resource.worldOriginZ + bridge.translateZ,
    heightOffsetWorld: resource.heightOffsetWorld + bridge.translateY,
  }));
  const sampler = createTerrainResourceSampler(aligned);
  const legacyBounds = inscribedLegacyBounds(geodetic, sampler.bounds);
  return Object.freeze({
    resources: Object.freeze(aligned),
    bridge,
    bounds: sampler.bounds,
    legacyBounds,
    sampleGrid: sampler.sample,
    sample: (legacyX, legacyZ) => sampler.sample(...bridge.toGrid(legacyX, legacyZ)),
  });
}

export async function loadPuttomTerrainPreview({
  slug,
  geo,
  packSha256,
  search = globalThis.location?.search || '',
  baseUrl = import.meta.env?.BASE_URL || '/',
  locationHref = globalThis.location?.href || 'https://banvy.invalid/',
  loaderOptions,
  surfaceLoaderOptions,
  requested,
} = {}) {
  if (requested !== undefined && typeof requested !== 'boolean') {
    throw new TypeError('requested must be boolean when provided');
  }
  /* The selection boundary passes the flag decision explicitly so `?v2=require`
     reaches this loader too; a direct call still reads `?v2=1` from the URL. */
  const parameterRequested = requested ?? (new URLSearchParams(search).get('v2') === '1');
  if (!parameterRequested) return immutableState({ slug });
  if (slug !== PUTTOM_PREVIEW_CONFIG.slug) {
    return immutableState({ requested: true, status: 'fallback', reason: 'course-not-enabled', slug });
  }
  try {
    const descriptorUrl = new URL(PUTTOM_PREVIEW_CONFIG.descriptorPath, new URL(baseUrl, locationHref));
    const surfaceDescriptorUrl = new URL(
      PUTTOM_PREVIEW_CONFIG.surfaceDescriptorPath, new URL(baseUrl, locationHref),
    );
    const [{ loadTerrainPreview }, { loadSurfacePreview }] = await Promise.all([
      import('./v2-terrain-preview-loader.mjs'),
      import('./v2-surface-preview-loader.mjs'),
    ]);
    const [loaded, loadedSurface] = await Promise.all([
      loadTerrainPreview(descriptorUrl.href, {
        ...loaderOptions,
        expectedDescriptorSha256: PUTTOM_PREVIEW_CONFIG.descriptorSha256,
      }),
      loadSurfacePreview(surfaceDescriptorUrl.href, {
        ...(surfaceLoaderOptions ?? loaderOptions),
        expectedDescriptorSha256: PUTTOM_PREVIEW_CONFIG.surfaceDescriptorSha256,
      }),
    ]);
    validatePuttomDescriptor(loaded.descriptor, geo);
    validatePuttomSurfaceDescriptor(loadedSurface.descriptor, loaded.descriptor, packSha256);
    const surfaceClassIds = verifiedSurfaceClassIds(loadedSurface.resources);
    const aligned = alignTerrainPreviewToLegacyFrame(
      loaded,
      PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006,
      PUTTOM_PREVIEW_CONFIG.legacyFrame,
    );
    const { createSurfacePreviewAtlas } = await import('./v2-surface-preview-atlas.mjs');
    const surfaceAtlas = createSurfacePreviewAtlas({
      resources: loadedSurface.resources,
      frame: loaded.descriptor.frame,
      bridge: aligned.bridge,
    });
    try {
      assertPuttomSurfaceCoverage(surfaceAtlas.data.classCounts);
    } catch (error) {
      surfaceAtlas.dispose();
      throw error;
    }
    const terrainEncodedBytes = loaded.descriptor.tiles.reduce((sum, tile) => sum + tile.reference.bytes, 0);
    const terrainDecodedBytes = loaded.descriptor.tiles.reduce((sum, tile) => sum + tile.reference.decodedBytes, 0);
    const encodedBytes = terrainEncodedBytes + loadedSurface.encodedBytes;
    const decodedBytes = terrainDecodedBytes + loadedSurface.decodedBytes;
    const terrainGpuBytes = aligned.resources.reduce((sum, resource) => sum + resource.gpuBytes, 0);
    const gpuBytes = terrainGpuBytes + surfaceAtlas.data.textureBytes;
    const renderFrontiers = new Map([[1, aligned.resources]]);
    return immutableState({
      requested: true,
      ready: true,
      status: 'ready',
      reason: null,
      slug,
      descriptor: loaded.descriptor,
      surfaceDescriptor: loadedSurface.descriptor,
      surfaceAtlas,
      surfaceClassIds,
      resources: aligned.resources,
      bounds: aligned.bounds,
      legacyBounds: aligned.legacyBounds,
      bridge: aligned.bridge,
      heightAt: aligned.sample,
      /* the same terrain addressed on its own EPSG:3006 grid, for the one
         caller that compares v2 against v2 and must not go round the bridge
         twice: the streaming probe */
      heightAtGrid: aligned.sampleGrid,
      renderResources: stride => {
        if (!renderFrontiers.has(stride)) {
          renderFrontiers.set(stride, decimateTerrainRenderResources(aligned.resources, stride));
        }
        return renderFrontiers.get(stride);
      },
      stats: () => Object.freeze({
        renderedTiles: aligned.resources.length,
        encodedBytes,
        decodedBytes,
        gpuBytes,
        terrainEncodedBytes,
        terrainDecodedBytes,
        terrainGpuBytes,
        surfaceEncodedBytes: loadedSurface.encodedBytes,
        surfaceDecodedBytes: loadedSurface.decodedBytes,
        surfaceTextureBytes: surfaceAtlas.data.textureBytes,
      }),
    });
  } catch (error) {
    console.warn('Puttom 1 m terrain preview fell back to GPK1:', error);
    return immutableState({
      requested: true,
      status: 'fallback',
      reason: 'load-failed',
      error: String(error?.message || error).slice(0, 300),
      slug,
    });
  }
}
