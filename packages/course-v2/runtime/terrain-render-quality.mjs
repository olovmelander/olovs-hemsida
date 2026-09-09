import { deriveTerrainRenderResource } from './terrain-render-data.mjs';

export function terrainRenderStride(value = 1) {
  if (value !== 1 && value !== 2) throw new RangeError('terrain render stride must be 1 or 2');
  return value;
}

const read = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8;
const write = (bytes, offset, value) => { bytes[offset] = value & 255; bytes[offset + 1] = value >>> 8; };

/* Interpolate the actual NW/SW/NE, NE/SW/SE triangles, not a bilinear
 * surface. Coarse diagonals lie on the source lattice, so testing all source
 * vertices bounds the difference between the two piecewise-linear meshes. */
function triangleHeight(at, width, height, column, row, step) {
  const west = Math.min(width - 1 - step, Math.floor(column / step) * step);
  const north = Math.min(height - 1 - step, Math.floor(row / step) * step);
  const x = (column - west) / step, z = (row - north) / step;
  const ne = at(west + step, north), sw = at(west, north + step);
  return x + z <= 1
    ? at(west, north) * (1 - x - z) + ne * x + sw * z
    : ne * (1 - z) + sw * (1 - x) + at(west + step, north + step) * (x + z - 1);
}

/** A GPU view only. The source resource/payload remains the CPU height truth.
 * The caller retains complete meshes for finest available tiles; refinable
 * levels may be decimated. Rebuild targets on the actual rendered parent for
 * a full-resolution child. Copying the old parent bytes would remove the morph
 * at every even vertex. Source normals are retained at every rendered vertex.
 */
export function createTerrainRenderView(source, { stride = 1, parentStride = 1, parentResource = null } = {}) {
  terrainRenderStride(stride); terrainRenderStride(parentStride);
  if (stride === 1 && parentStride === 1 && !parentResource) return source;
  const parentStep = 2 * parentStride;
  for (const dimension of [source.width, source.height]) {
    if (dimension <= parentStep || (dimension - 1) % parentStep || (dimension - 1) % stride) {
      throw new Error(`terrain tile ${source.tileId} cannot use render stride ${stride} / parent ${parentStride}`);
    }
  }
  if (source.noDataCount) throw new Error(`terrain tile ${source.tileId} has nodata in its render source`);
  const width = (source.width - 1) / stride + 1;
  const height = (source.height - 1) / stride + 1;
  const bytes = source.textureData;
  const at = (column, row) => read(bytes, (row * source.width + column) * 8);
  const textureData = new Uint8Array(width * height * 8);
  const parentAt = parentResource ? (column, row) => {
    const offset = (row * parentResource.width + column) * 8;
    return read(parentResource.textureData, offset) * parentResource.heightScaleMetres + parentResource.heightOffsetWorld;
  } : null;
  const parentTargets = new Int32Array(width * height);
  let offsetSteps = 0, maximumEncoded = 0;
  let maximumMorphDeltaMetres = 0, maximumReductionErrorMetres = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const c = column * stride, r = row * stride;
    const from = (r * source.width + c) * 8, to = (row * width + column) * 8;
    textureData.set(bytes.subarray(from, from + 8), to);
    let target = triangleHeight(at, source.width, source.height, c, r, parentStep);
    if (parentResource) {
      const x = (source.worldOriginX + c * source.sampleSpacingMetres - parentResource.worldOriginX) / parentResource.sampleSpacingMetres;
      const z = (source.worldOriginZ + r * source.sampleSpacingMetres - parentResource.worldOriginZ) / parentResource.sampleSpacingMetres;
      if (x < -1e-6 || z < -1e-6 || x > parentResource.width - 1 + 1e-6 || z > parentResource.height - 1 + 1e-6) {
        throw new Error(`terrain parent does not cover ${source.tileId}`);
      }
      target = (triangleHeight(parentAt, parentResource.width, parentResource.height, x, z, 1) - source.heightOffsetWorld) / source.heightScaleMetres;
    }
    const parent = Math.round(target);
    parentTargets[row * width + column] = parent;
    offsetSteps = Math.min(offsetSteps, parent);
    maximumEncoded = Math.max(maximumEncoded, parent, at(c, r));
    maximumMorphDeltaMetres = Math.max(maximumMorphDeltaMetres,
      Math.abs(at(c, r) - parent) * source.heightScaleMetres);
  }
  // Parent samples can be below this child's source offset. Shift both packed
  // channels by whole quantization steps so the fine world heights stay exact.
  if (maximumEncoded - offsetSteps > 65535) throw new Error(`terrain parent height range exceeds ${source.tileId} encoding`);
  for (let i = 0; i < parentTargets.length; i++) {
    write(textureData, i * 8, read(textureData, i * 8) - offsetSteps);
    write(textureData, i * 8 + 2, parentTargets[i] - offsetSteps);
  }
  if (stride > 1) {
    for (let row = 0; row < source.height; row++) for (let column = 0; column < source.width; column++) {
      const coarse = triangleHeight(at, source.width, source.height, column, row, stride);
      maximumReductionErrorMetres = Math.max(maximumReductionErrorMetres,
        Math.abs(at(column, row) - coarse) * source.heightScaleMetres);
    }
  }
  return deriveTerrainRenderResource(source, {
    sourceResource: source,
    renderStride: stride,
    parentRenderStride: parentStride,
    width, height, textureData,
    heightOffsetWorld: source.heightOffsetWorld + offsetSteps * source.heightScaleMetres,
    sampleSpacingMetres: source.sampleSpacingMetres * stride,
    geometricErrorMetres: source.geometricErrorMetres + maximumReductionErrorMetres,
    maximumReductionErrorMetres,
    maximumMorphDeltaMetres,
    finiteCount: width * height,
    decodedSha256: `${source.decodedSha256}:render-${stride}-parent-${parentStride}${parentResource ? `:${(parentResource.sourceResource ?? parentResource).decodedSha256}` : ''}`,
    gpuBytes: textureData.byteLength,
  });
}
