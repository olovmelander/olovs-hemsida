const UINT16_MAX = 65_535;
const MAX_RENDER_GRID_DIMENSION = 1025;

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('terrain payload must be an ArrayBuffer or Uint8Array');
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function terrainHeader(decoded) {
  const header = decoded?.header;
  if (!header || header.kind !== 'terrain' || header.payloadFormat !== 'terrain-grid-u16-le-v1') {
    throw new TypeError('decoded input must be a verified terrain-grid-u16 chunk');
  }
  const { width, height } = header.grid || {};
  if (!Number.isSafeInteger(width) || width < 2 ||
      !Number.isSafeInteger(height) || height < 2) {
    throw new RangeError('verified terrain grid dimensions are invalid');
  }
  if (width > MAX_RENDER_GRID_DIMENSION || height > MAX_RENDER_GRID_DIMENSION) {
    throw new RangeError(`terrain renderer grid dimensions may not exceed ${MAX_RENDER_GRID_DIMENSION}`);
  }
  return header;
}

function quantizedSamples(payload, count) {
  const bytes = byteView(payload);
  if (bytes.byteLength !== count * 2) {
    throw new RangeError(`terrain payload has ${bytes.byteLength} bytes; expected ${count * 2}`);
  }
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Uint16Array(count);
  for (let index = 0; index < count; index++) {
    result[index] = source.getUint16(index * 2, true);
  }
  return result;
}

function parentSample(source, width, height, column, row, noDataValue) {
  const west = Math.floor(column / 2) * 2;
  const north = Math.floor(row / 2) * 2;
  const east = Math.min(width - 1, west + 2);
  const south = Math.min(height - 1, north + 2);
  const values = [
    source[north * width + west],
    source[north * width + east],
    source[south * width + west],
    source[south * width + east],
  ];
  if (values.includes(noDataValue)) return source[row * width + column];
  const x = east === west ? 0 : (column - west) / (east - west);
  const y = south === north ? 0 : (row - north) / (south - north);
  const northValue = values[0] + (values[1] - values[0]) * x;
  const southValue = values[2] + (values[3] - values[2]) * x;
  return Math.max(0, Math.min(UINT16_MAX - 1, Math.round(
    northValue + (southValue - northValue) * y,
  )));
}

function terrainNormal(source, width, height, column, row, noDataValue, heightScale, spacing) {
  const centre = source[row * width + column];
  if (centre === noDataValue) return [0, 1, 0];
  const westIndex = row * width + Math.max(0, column - 1);
  const eastIndex = row * width + Math.min(width - 1, column + 1);
  const northIndex = Math.max(0, row - 1) * width + column;
  const southIndex = Math.min(height - 1, row + 1) * width + column;
  let west = source[westIndex], east = source[eastIndex];
  let north = source[northIndex], south = source[southIndex];
  let columns = Math.min(width - 1, column + 1) - Math.max(0, column - 1);
  let rows = Math.min(height - 1, row + 1) - Math.max(0, row - 1);
  if (west === noDataValue) { west = centre; columns--; }
  if (east === noDataValue) { east = centre; columns--; }
  if (north === noDataValue) { north = centre; rows--; }
  if (south === noDataValue) { south = centre; rows--; }
  const slopeX = columns > 0 ? (east - west) * heightScale / (columns * spacing) : 0;
  /* Source rows run north to south and Banvy world-z does the same, so this is
     the world-space z derivative rather than its often-accidentally-mirrored
     negative. */
  const slopeZ = rows > 0 ? (south - north) * heightScale / (rows * spacing) : 0;
  const length = Math.hypot(slopeX, 1, slopeZ);
  return [-slopeX / length, 1 / length, -slopeZ / length];
}

/* Terrain normals always have positive Y. The upper octahedron therefore needs
   two 16-bit components and no fold bit. The shader reconstructs Y as
   1-|x|-|z| and normalizes once. */
function encodeUpperOctahedron(normal) {
  const inverseL1 = 1 / (Math.abs(normal[0]) + normal[1] + Math.abs(normal[2]));
  const x = normal[0] * inverseL1;
  const z = normal[2] * inverseL1;
  return [
    Math.round((x * 0.5 + 0.5) * UINT16_MAX),
    Math.round((z * 0.5 + 0.5) * UINT16_MAX),
  ];
}

function decodeUpperOctahedron(encoded) {
  const x = encoded[0] / UINT16_MAX * 2 - 1;
  const z = encoded[1] / UINT16_MAX * 2 - 1;
  const y = Math.max(0, 1 - Math.abs(x) - Math.abs(z));
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function writeUint16LittleEndian(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = value >>> 8;
}

function readUint16LittleEndian(source, offset) {
  return source[offset] | source[offset + 1] << 8;
}

/**
 * Prepare one verified uint16 terrain tile for two portable RGBA8 vertex
 * texture loads. The first texel stores little-endian fine/parent heights and
 * the second stores the two little-endian upper-octahedral normal components.
 * RGBA8 avoids optional normalized-16 and integer-texture paths on WebGL2
 * mobile without increasing the eight bytes used by each terrain sample.
 * This work is Three.js-independent and runs in the decode Worker.
 */
export function prepareTerrainRenderData(decoded) {
  const header = terrainHeader(decoded);
  const { width, height, noDataValue, heightScaleMetres, sampleSpacingMetres } = header.grid;
  finite(heightScaleMetres, 'heightScaleMetres');
  finite(sampleSpacingMetres, 'sampleSpacingMetres');
  if (heightScaleMetres <= 0 || sampleSpacingMetres <= 0) {
    throw new RangeError('terrain height scale and sample spacing must be positive');
  }
  const count = width * height;
  const source = quantizedSamples(decoded.payload, count);
  const textureData = new Uint8Array(count * 8);
  let noDataCount = 0;
  let maximumMorphDeltaMetres = 0;
  let maximumNormalEncodingErrorDegrees = 0;

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const fine = source[index];
      const parent = fine === noDataValue
        ? noDataValue
        : parentSample(source, width, height, column, row, noDataValue);
      const normal = terrainNormal(
        source, width, height, column, row, noDataValue,
        heightScaleMetres, sampleSpacingMetres,
      );
      const oct = encodeUpperOctahedron(normal);
      const offset = index * 8;
      writeUint16LittleEndian(textureData, offset, fine);
      writeUint16LittleEndian(textureData, offset + 2, parent);
      writeUint16LittleEndian(textureData, offset + 4, oct[0]);
      writeUint16LittleEndian(textureData, offset + 6, oct[1]);
      if (fine === noDataValue) {
        noDataCount++;
      } else {
        maximumMorphDeltaMetres = Math.max(
          maximumMorphDeltaMetres,
          Math.abs(fine - parent) * heightScaleMetres,
        );
      }
      const decodedNormal = decodeUpperOctahedron(oct);
      const cosine = Math.max(-1, Math.min(1,
        normal[0] * decodedNormal[0] + normal[1] * decodedNormal[1] + normal[2] * decodedNormal[2],
      ));
      maximumNormalEncodingErrorDegrees = Math.max(
        maximumNormalEncodingErrorDegrees,
        Math.acos(cosine) * 180 / Math.PI,
      );
    }
  }

  return Object.freeze({
    tileId: header.id,
    width,
    height,
    textureData,
    noDataCount,
    finiteCount: count - noDataCount,
    maximumMorphDeltaMetres,
    maximumNormalEncodingErrorDegrees,
    gpuBytes: textureData.byteLength,
    layout: 'rgba8x2-height-parent-octnormal-v1',
  });
}

function assertCanonicalFrame(frame) {
  if (frame?.compoundCrs !== 'EPSG:5845' || frame.horizontalCrs !== 'EPSG:3006' ||
      frame.verticalCrs !== 'EPSG:5613') {
    throw new Error('terrain renderer requires the canonical EPSG:5845 frame');
  }
  const expected = {
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  };
  for (const [axis, mapping] of Object.entries(expected)) {
    if (frame.axisMapping?.[axis] !== mapping) {
      throw new Error(`terrain renderer does not support frame mapping ${axis}`);
    }
  }
  for (const coordinate of ['easting', 'northing', 'heightRH2000']) {
    finite(frame.origin?.[coordinate], `frame.origin.${coordinate}`);
  }
}

const RENDER_DERIVED = Object.freeze(['textureData', 'noDataCount', 'finiteCount', 'maximumMorphDeltaMetres',
  'maximumNormalEncodingErrorDegrees', 'layout']);

/**
 * Build the immutable, renderer-neutral resource retained by the stream pool.
 *
 * With `lazyRenderData` the texel preparation -- parent morph, normal,
 * octahedral encode and its error check over every sample -- is deferred to
 * the first read of a render-derived field, and the resource carries the
 * verified `payload` so a CPU sampler can read heights without it. A
 * course whose GPU frontier comes from the ring graph samples the pilot's
 * tiles for construction and never draws them, so it never pays for texels
 * it does not upload; the fixed-frontier renderer reads `textureData` and
 * pays then, once, the same amount as before.
 */
export function createTerrainRenderResource({ tileId, decoded, frame, requireCompleteCoverage = true, lazyRenderData = false } = {}) {
  const header = terrainHeader(decoded);
  if (typeof tileId !== 'string' || tileId !== header.id) {
    throw new Error(`requested terrain tile ${tileId} does not match decoded chunk ${header.id}`);
  }
  assertCanonicalFrame(frame);
  const validated = renderData => {
    if (renderData.tileId !== tileId || renderData.width !== header.grid.width ||
        renderData.height !== header.grid.height ||
        !(renderData.textureData instanceof Uint8Array) ||
        renderData.textureData.length !== header.grid.width * header.grid.height * 8) {
      throw new Error(`terrain render payload for ${tileId} is inconsistent`);
    }
    if (requireCompleteCoverage && renderData.noDataCount) {
      throw new Error(`terrain tile ${tileId} contains ${renderData.noDataCount} nodata samples`);
    }
    return renderData;
  };
  let renderData = decoded.terrainRenderData ? validated(decoded.terrainRenderData) : null;
  if (!renderData && !lazyRenderData) renderData = validated(prepareTerrainRenderData(decoded));
  const render = () => renderData || (renderData = validated(prepareTerrainRenderData(decoded)));
  const spanEasting = (header.grid.width - 1) * header.grid.sampleSpacingMetres;
  const spanNorthing = (header.grid.height - 1) * header.grid.sampleSpacingMetres;
  const tolerance = Math.max(1e-5, header.grid.sampleSpacingMetres * 1e-6);
  if (Math.abs(header.bounds.maxEasting - header.bounds.minEasting - spanEasting) > tolerance ||
      Math.abs(header.bounds.maxNorthing - header.bounds.minNorthing - spanNorthing) > tolerance) {
    throw new Error(`terrain tile ${tileId} bounds do not match its sample grid`);
  }
  const resource = {
    tileId,
    width: header.grid.width,
    height: header.grid.height,
    /* the verified samples, for readers that need heights and not texels */
    payload: decoded.payload instanceof Uint8Array ? decoded.payload : new Uint8Array(decoded.payload),
    bounds: Object.freeze({ ...header.bounds }),
    sampleSpacingMetres: header.grid.sampleSpacingMetres,
    geometricErrorMetres: header.grid.geometricErrorMetres,
    heightOffsetWorld: header.grid.heightOffsetMetres - frame.origin.heightRH2000,
    heightScaleMetres: header.grid.heightScaleMetres,
    noDataValue: header.grid.noDataValue,
    worldOriginX: header.bounds.minEasting - frame.origin.easting,
    worldOriginZ: frame.origin.northing - header.bounds.maxNorthing,
    decodedSha256: header.decodedSha256,
    gpuBytes: header.grid.width * header.grid.height * 8,
  };
  for (const key of RENDER_DERIVED) {
    Object.defineProperty(resource, key, { enumerable: true, get: () => render()[key] });
  }
  return Object.freeze(resource);
}

/**
 * A copy of a render resource with some fields replaced, keeping a lazy
 * resource lazy: data fields are copied, render-derived accessors delegate.
 * A spread would read every accessor and prepare the texels it exists to
 * defer.
 */
export function deriveTerrainRenderResource(resource, overrides = {}) {
  const derived = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(resource))) {
    if (key in overrides) continue;
    if (descriptor.get) Object.defineProperty(derived, key, { enumerable: true, get: () => resource[key] });
    else derived[key] = descriptor.value;
  }
  Object.assign(derived, overrides);
  return Object.freeze(derived);
}

export function sampleTerrainRenderResource(resource, worldX, worldZ) {
  finite(worldX, 'worldX');
  finite(worldZ, 'worldZ');
  const column = (worldX - resource.worldOriginX) / resource.sampleSpacingMetres;
  const row = (worldZ - resource.worldOriginZ) / resource.sampleSpacingMetres;
  const epsilon = 1e-9;
  if (column < -epsilon || row < -epsilon ||
      column > resource.width - 1 + epsilon || row > resource.height - 1 + epsilon) return Number.NaN;
  const x = Math.max(0, Math.min(resource.width - 1, column));
  const y = Math.max(0, Math.min(resource.height - 1, row));
  const west = Math.floor(x), east = Math.min(resource.width - 1, west + 1);
  const north = Math.floor(y), south = Math.min(resource.height - 1, north + 1);
  const at = (columnIndex, rowIndex) => {
    /* the payload holds the same fine sample the first texel carries */
    const quantized = resource.payload
      ? readUint16LittleEndian(resource.payload, (rowIndex * resource.width + columnIndex) * 2)
      : readUint16LittleEndian(resource.textureData, (rowIndex * resource.width + columnIndex) * 8);
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
