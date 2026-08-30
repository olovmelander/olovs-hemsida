export const PUTTOM_PREVIEW_CONFIG = Object.freeze({
  slug: 'puttom',
  descriptorPath: 'v2/puttom/preview.json',
  label: 'Puttom · Lantmäteriet 1 m terräng',
  descriptorSha256: '398b0b70b7d9ed9793e189bc66bd8c94060741990271cceacbea97b1f3278eb1',
  frameFingerprint: 'ee406f792b7e59817667d6f6fc8cf6e6b271bf5f7efabb58f3907928f741bef3',
  packOriginWgs84: Object.freeze({ latitude: 63.2992, longitude: 18.9413 }),
  /* EPSG:3006 projection of the immutable GPK1 WGS84 origin. This bridge keeps
     the legacy +x east/-z north frame while the preview remains provisional. */
  legacyOriginEpsg3006: Object.freeze({
    easting: 697498.021708,
    northing: 7024997.739459,
  }),
  expectedBoundsEpsg5845: Object.freeze({
    minEasting: 696916.5,
    minNorthing: 7024570.5,
    minHeightRH2000: 37.24201202392578,
    maxEasting: 697940.5,
    maxNorthing: 7025594.5,
    maxHeightRH2000: 70.53581237792969,
  }),
  expectedTileCount: 16,
});

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
    resources: Object.freeze([]),
    bounds: null,
    bridge: null,
    heightAt: () => Number.NaN,
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

function validatePuttomDescriptor(descriptor, geo) {
  if (descriptor.label !== PUTTOM_PREVIEW_CONFIG.label) {
    throw new Error('Puttom preview label does not match the approved pilot');
  }
  if (descriptor.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedTileCount) {
    throw new Error(`Puttom preview has ${descriptor.tiles.length} tiles; expected 16`);
  }
  if (descriptor.frame.fingerprint !== PUTTOM_PREVIEW_CONFIG.frameFingerprint ||
      !near(descriptor.frame.origin.heightRH2000, 37.24)) {
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

export function alignTerrainPreviewToLegacyFrame(loaded, legacyOriginEpsg3006) {
  const { descriptor, resources } = loaded || {};
  if (!descriptor?.frame?.origin || !Array.isArray(resources) || !resources.length) {
    throw new TypeError('a loaded terrain preview is required');
  }
  if (!Number.isFinite(legacyOriginEpsg3006?.easting) || !Number.isFinite(legacyOriginEpsg3006?.northing)) {
    throw new TypeError('a finite EPSG:3006 legacy origin is required');
  }
  const bridge = Object.freeze({
    translateX: descriptor.frame.origin.easting - legacyOriginEpsg3006.easting,
    translateY: descriptor.frame.origin.heightRH2000,
    translateZ: legacyOriginEpsg3006.northing - descriptor.frame.origin.northing,
  });
  const aligned = resources.map(resource => Object.freeze({
    ...resource,
    worldOriginX: resource.worldOriginX + bridge.translateX,
    worldOriginZ: resource.worldOriginZ + bridge.translateZ,
    heightOffsetWorld: resource.heightOffsetWorld + bridge.translateY,
  }));
  const sampler = createTerrainResourceSampler(aligned);
  return Object.freeze({ resources: Object.freeze(aligned), bridge, ...sampler });
}

export async function loadPuttomTerrainPreview({
  slug,
  geo,
  search = globalThis.location?.search || '',
  baseUrl = import.meta.env?.BASE_URL || '/',
  locationHref = globalThis.location?.href || 'https://banvy.invalid/',
  loaderOptions,
} = {}) {
  const parameterRequested = new URLSearchParams(search).get('v2') === '1';
  if (!parameterRequested) return immutableState({ slug });
  if (slug !== PUTTOM_PREVIEW_CONFIG.slug) {
    return immutableState({ requested: true, status: 'fallback', reason: 'course-not-enabled', slug });
  }
  try {
    const descriptorUrl = new URL(PUTTOM_PREVIEW_CONFIG.descriptorPath, new URL(baseUrl, locationHref));
    const { loadTerrainPreview } = await import('./v2-terrain-preview-loader.mjs');
    const loaded = await loadTerrainPreview(descriptorUrl.href, {
      ...loaderOptions,
      expectedDescriptorSha256: PUTTOM_PREVIEW_CONFIG.descriptorSha256,
    });
    validatePuttomDescriptor(loaded.descriptor, geo);
    const aligned = alignTerrainPreviewToLegacyFrame(
      loaded,
      PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006,
    );
    const encodedBytes = loaded.descriptor.tiles.reduce((sum, tile) => sum + tile.reference.bytes, 0);
    const decodedBytes = loaded.descriptor.tiles.reduce((sum, tile) => sum + tile.reference.decodedBytes, 0);
    const gpuBytes = aligned.resources.reduce((sum, resource) => sum + resource.gpuBytes, 0);
    const renderFrontiers = new Map([[1, aligned.resources]]);
    return immutableState({
      requested: true,
      ready: true,
      status: 'ready',
      reason: null,
      slug,
      descriptor: loaded.descriptor,
      resources: aligned.resources,
      bounds: aligned.bounds,
      bridge: aligned.bridge,
      heightAt: aligned.sample,
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
