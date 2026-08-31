function callback(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function finiteCoordinate(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function heightFromSample(sample) {
  if (Number.isFinite(sample)) return sample;
  return Number.isFinite(sample?.height) ? sample.height : Number.NaN;
}

function metadataFromSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const result = {};
  if (typeof sample.tileId === 'string') result.tileId = sample.tileId;
  if (Number.isFinite(sample.sampleSpacingMetres)) {
    result.sampleSpacingMetres = sample.sampleSpacingMetres;
  }
  return Object.keys(result).length ? result : null;
}

/**
 * Resolves the height of the terrain that is actually visible in the scene.
 *
 * The verified v2 frontier wins only after its renderer has installed
 * successfully. Outside that frontier (or after a renderer fallback), the
 * sampler follows the already-built legacy triangles rather than re-running the
 * analytic sculpt at an arbitrary point. The analytic function is the final
 * bounded fallback beyond both rendered meshes.
 */
export function createGroundHeightSampler({
  previewActive = () => false,
  previewHeightAt = () => Number.NaN,
  legacyMeshHeightAt,
  fallbackHeightAt,
} = {}) {
  callback(previewActive, 'previewActive');
  callback(previewHeightAt, 'previewHeightAt');
  callback(legacyMeshHeightAt, 'legacyMeshHeightAt');
  callback(fallbackHeightAt, 'fallbackHeightAt');

  function resolve(worldX, worldZ, includeMetadata) {
    finiteCoordinate(worldX, 'worldX');
    finiteCoordinate(worldZ, 'worldZ');

    if (previewActive()) {
      const sample = previewHeightAt(worldX, worldZ);
      const height = heightFromSample(sample);
      if (Number.isFinite(height)) {
        return includeMetadata
          ? Object.freeze({ height, source: 'v2-preview', ...metadataFromSample(sample) })
          : height;
      }
    }

    const meshHeight = heightFromSample(legacyMeshHeightAt(worldX, worldZ));
    if (Number.isFinite(meshHeight)) {
      return includeMetadata
        ? Object.freeze({ height: meshHeight, source: 'legacy-rendered-mesh' })
        : meshHeight;
    }

    const fallbackHeight = heightFromSample(fallbackHeightAt(worldX, worldZ));
    if (!Number.isFinite(fallbackHeight)) {
      throw new Error('visible ground height has no finite fallback');
    }
    return includeMetadata
      ? Object.freeze({ height: fallbackHeight, source: 'legacy-analytic-fallback' })
      : fallbackHeight;
  }

  return Object.freeze({
    heightAt: (worldX, worldZ) => resolve(worldX, worldZ, false),
    inspectAt: (worldX, worldZ) => resolve(worldX, worldZ, true),
  });
}
