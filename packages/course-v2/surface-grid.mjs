export const SURFACE_GRID_BYTES_PER_SAMPLE = 14;
export const SURFACE_NO_DATA_ID = 255;
export const MAX_SURFACE_GRID_BYTES = 64 * 1024 * 1024;

const UINT16_MAX = 65535;
const INT16_MIN = -32768;
const INT16_MAX = 32767;

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || width < 2 || width > 4097) {
    throw new RangeError('width must be an integer from 2 to 4097');
  }
  if (!Number.isSafeInteger(height) || height < 2 || height > 4097) {
    throw new RangeError('height must be an integer from 2 to 4097');
  }
  return width * height;
}

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('payload must be an ArrayBuffer or Uint8Array');
}

function channel(value, count, label, fallback) {
  if (value === undefined) return { length: count, at: () => fallback };
  if (value === null || value.length !== count) {
    throw new RangeError(`${label} must contain ${count} samples`);
  }
  return { length: value.length, at: index => value[index] };
}

function integer(value, minimum, maximum, label, index) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}[${index}] must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function finite(value, minimum, maximum, label, index) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label}[${index}] must be a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

function quantizedSigned(value, scale, label, index) {
  const quantized = Math.round(finite(value, INT16_MIN * scale, INT16_MAX * scale, label, index) / scale);
  if (quantized < INT16_MIN || quantized > INT16_MAX) {
    throw new RangeError(`${label}[${index}] exceeds the signed 16-bit range`);
  }
  return quantized;
}

function quantizedUnsigned(value, scale, label, index) {
  const quantized = Math.round(finite(value, 0, UINT16_MAX * scale, label, index) / scale);
  if (quantized < 0 || quantized > UINT16_MAX) {
    throw new RangeError(`${label}[${index}] exceeds the unsigned 16-bit range`);
  }
  return quantized;
}

function unorm8(value, label, index) {
  return Math.round(finite(value, 0, 1, label, index) * 255);
}

function turnU16(value, label, index) {
  const turns = finite(value, 0, 1, label, index);
  return Math.min(UINT16_MAX, Math.round(turns * UINT16_MAX));
}

function validateSurfaceGridMetadata(surfaceGrid) {
  if (!surfaceGrid || typeof surfaceGrid !== 'object') throw new TypeError('surfaceGrid metadata is required');
  const count = dimensions(surfaceGrid.width, surfaceGrid.height);
  if (count * SURFACE_GRID_BYTES_PER_SAMPLE > MAX_SURFACE_GRID_BYTES) {
    throw new RangeError('surface grid exceeds the 64 MiB decoded-chunk budget');
  }
  if (surfaceGrid.bytesPerSample !== SURFACE_GRID_BYTES_PER_SAMPLE) {
    throw new Error(`surface grid bytesPerSample must be ${SURFACE_GRID_BYTES_PER_SAMPLE}`);
  }
  if (surfaceGrid.rowOrder !== 'north-to-south' || surfaceGrid.columnOrder !== 'west-to-east') {
    throw new Error('unsupported surface grid axis order');
  }
  if (surfaceGrid.mowDirectionEncoding !== 'turn-u16' || surfaceGrid.continuousEncoding !== 'unorm8') {
    throw new Error('unsupported surface field encoding');
  }
  if (surfaceGrid.noDataSurfaceId !== SURFACE_NO_DATA_ID) {
    throw new Error(`surface no-data id must be ${SURFACE_NO_DATA_ID}`);
  }
  if (!Number.isFinite(surfaceGrid.distanceScaleMetres) ||
      surfaceGrid.distanceScaleMetres < 0.001 || surfaceGrid.distanceScaleMetres > 10) {
    throw new RangeError('distanceScaleMetres must be between 0.001 and 10');
  }
  if (!Number.isFinite(surfaceGrid.mowCoordinateScaleMetres) ||
      surfaceGrid.mowCoordinateScaleMetres < 0.001 || surfaceGrid.mowCoordinateScaleMetres > 100) {
    throw new RangeError('mowCoordinateScaleMetres must be between 0.001 and 100');
  }
  return count;
}

export function encodeSurfaceGrid({
  primarySurfaceIds,
  secondarySurfaceIds,
  boundaryDistancesMetres,
  ownerFeatureIds,
  mowCoordinatesMetres,
  mowDirectionsTurns,
  moisture,
  wear,
  exposure,
  vegetationDensity,
  width,
  height,
  sampleSpacingMetres,
  distanceScaleMetres = 0.01,
  mowCoordinateScaleMetres = 0.01,
  surfaceRegistryVersion = 1,
}) {
  const count = dimensions(width, height);
  if (count * SURFACE_GRID_BYTES_PER_SAMPLE > MAX_SURFACE_GRID_BYTES) {
    throw new RangeError('surface grid exceeds the 64 MiB decoded-chunk budget');
  }
  if (!Number.isFinite(sampleSpacingMetres) || sampleSpacingMetres < 0.01 || sampleSpacingMetres > 10000) {
    throw new RangeError('sampleSpacingMetres must be between 0.01 and 10000');
  }
  if (!Number.isFinite(distanceScaleMetres) || distanceScaleMetres < 0.001 || distanceScaleMetres > 10) {
    throw new RangeError('distanceScaleMetres must be between 0.001 and 10');
  }
  if (!Number.isFinite(mowCoordinateScaleMetres) ||
      mowCoordinateScaleMetres < 0.001 || mowCoordinateScaleMetres > 100) {
    throw new RangeError('mowCoordinateScaleMetres must be between 0.001 and 100');
  }
  if (!Number.isSafeInteger(surfaceRegistryVersion) || surfaceRegistryVersion < 1 || surfaceRegistryVersion > 65535) {
    throw new RangeError('surfaceRegistryVersion must be an integer from 1 to 65535');
  }

  const primary = channel(primarySurfaceIds, count, 'primarySurfaceIds', SURFACE_NO_DATA_ID);
  const secondary = channel(secondarySurfaceIds, count, 'secondarySurfaceIds', SURFACE_NO_DATA_ID);
  const distance = channel(boundaryDistancesMetres, count, 'boundaryDistancesMetres', 0);
  const owner = channel(ownerFeatureIds, count, 'ownerFeatureIds', 0);
  const mowCoordinate = channel(mowCoordinatesMetres, count, 'mowCoordinatesMetres', 0);
  const mowDirection = channel(mowDirectionsTurns, count, 'mowDirectionsTurns', 0);
  const wet = channel(moisture, count, 'moisture', 0);
  const worn = channel(wear, count, 'wear', 0);
  const exposed = channel(exposure, count, 'exposure', 0);
  const vegetation = channel(vegetationDensity, count, 'vegetationDensity', 0);

  const payload = new Uint8Array(count * SURFACE_GRID_BYTES_PER_SAMPLE);
  const view = new DataView(payload.buffer);
  let validCount = 0;
  let minBoundaryDistanceMetres = Infinity;
  let maxBoundaryDistanceMetres = -Infinity;
  for (let index = 0; index < count; index++) {
    const offset = index * SURFACE_GRID_BYTES_PER_SAMPLE;
    const primaryId = integer(primary.at(index), 0, SURFACE_NO_DATA_ID, 'primarySurfaceIds', index);
    const secondaryId = integer(secondary.at(index), 0, SURFACE_NO_DATA_ID, 'secondarySurfaceIds', index);
    view.setUint8(offset, primaryId);
    view.setUint8(offset + 1, secondaryId);
    if (primaryId === SURFACE_NO_DATA_ID) {
      const empty = [
        ['secondarySurfaceIds', secondaryId, SURFACE_NO_DATA_ID],
        ['boundaryDistancesMetres', distance.at(index), 0],
        ['ownerFeatureIds', owner.at(index), 0],
        ['mowCoordinatesMetres', mowCoordinate.at(index), 0],
        ['mowDirectionsTurns', mowDirection.at(index), 0],
        ['moisture', wet.at(index), 0],
        ['wear', worn.at(index), 0],
        ['exposure', exposed.at(index), 0],
        ['vegetationDensity', vegetation.at(index), 0],
      ];
      for (const [label, actual, expected] of empty) {
        if (actual !== expected) throw new Error(`${label}[${index}] must be ${expected} for a no-data sample`);
      }
      continue;
    }
    if (secondaryId === primaryId) {
      throw new Error(`secondarySurfaceIds[${index}] must differ from the primary surface id`);
    }
    const signedDistance = quantizedSigned(distance.at(index), distanceScaleMetres, 'boundaryDistancesMetres', index);
    const decodedDistance = signedDistance * distanceScaleMetres;
    view.setInt16(offset + 2, signedDistance, true);
    view.setUint16(offset + 4, integer(owner.at(index), 0, UINT16_MAX, 'ownerFeatureIds', index), true);
    view.setUint16(offset + 6, quantizedUnsigned(
      mowCoordinate.at(index), mowCoordinateScaleMetres, 'mowCoordinatesMetres', index,
    ), true);
    view.setUint16(offset + 8, turnU16(mowDirection.at(index), 'mowDirectionsTurns', index), true);
    view.setUint8(offset + 10, unorm8(wet.at(index), 'moisture', index));
    view.setUint8(offset + 11, unorm8(worn.at(index), 'wear', index));
    view.setUint8(offset + 12, unorm8(exposed.at(index), 'exposure', index));
    view.setUint8(offset + 13, unorm8(vegetation.at(index), 'vegetationDensity', index));
    validCount++;
    minBoundaryDistanceMetres = Math.min(minBoundaryDistanceMetres, decodedDistance);
    maxBoundaryDistanceMetres = Math.max(maxBoundaryDistanceMetres, decodedDistance);
  }
  if (!validCount) throw new Error('surface grid contains no classified samples');

  return {
    payload,
    surfaceGrid: {
      width,
      height,
      sampleSpacingMetres,
      bytesPerSample: SURFACE_GRID_BYTES_PER_SAMPLE,
      distanceScaleMetres,
      mowCoordinateScaleMetres,
      noDataSurfaceId: SURFACE_NO_DATA_ID,
      surfaceRegistryVersion,
      rowOrder: 'north-to-south',
      columnOrder: 'west-to-east',
      mowDirectionEncoding: 'turn-u16',
      continuousEncoding: 'unorm8',
    },
    validCount,
    minBoundaryDistanceMetres,
    maxBoundaryDistanceMetres,
    maximumDistanceErrorMetres: distanceScaleMetres / 2,
    maximumMowCoordinateErrorMetres: mowCoordinateScaleMetres / 2,
    maximumContinuousError: 1 / 510,
  };
}

export function decodeSurfaceGrid(payload, surfaceGrid) {
  const bytes = byteView(payload);
  const count = validateSurfaceGridMetadata(surfaceGrid);
  const expectedBytes = count * SURFACE_GRID_BYTES_PER_SAMPLE;
  if (bytes.byteLength !== expectedBytes) {
    throw new RangeError(`surface payload has ${bytes.byteLength} bytes; expected ${expectedBytes}`);
  }
  const primarySurfaceIds = new Uint8Array(count);
  const secondarySurfaceIds = new Uint8Array(count);
  const boundaryDistancesMetres = new Float32Array(count);
  const ownerFeatureIds = new Uint16Array(count);
  const mowCoordinatesMetres = new Float32Array(count);
  const mowDirectionsTurns = new Float32Array(count);
  const moisture = new Float32Array(count);
  const wear = new Float32Array(count);
  const exposure = new Float32Array(count);
  const vegetationDensity = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < count; index++) {
    const offset = index * SURFACE_GRID_BYTES_PER_SAMPLE;
    primarySurfaceIds[index] = view.getUint8(offset);
    secondarySurfaceIds[index] = view.getUint8(offset + 1);
    boundaryDistancesMetres[index] = view.getInt16(offset + 2, true) * surfaceGrid.distanceScaleMetres;
    ownerFeatureIds[index] = view.getUint16(offset + 4, true);
    mowCoordinatesMetres[index] = view.getUint16(offset + 6, true) * surfaceGrid.mowCoordinateScaleMetres;
    mowDirectionsTurns[index] = view.getUint16(offset + 8, true) / UINT16_MAX;
    moisture[index] = view.getUint8(offset + 10) / 255;
    wear[index] = view.getUint8(offset + 11) / 255;
    exposure[index] = view.getUint8(offset + 12) / 255;
    vegetationDensity[index] = view.getUint8(offset + 13) / 255;
  }
  return {
    primarySurfaceIds,
    secondarySurfaceIds,
    boundaryDistancesMetres,
    ownerFeatureIds,
    mowCoordinatesMetres,
    mowDirectionsTurns,
    moisture,
    wear,
    exposure,
    vegetationDensity,
  };
}

export function inspectSurfacePayload(payload, header) {
  const bytes = byteView(payload);
  const grid = header.surfaceGrid;
  const count = validateSurfaceGridMetadata(grid);
  const expectedBytes = count * SURFACE_GRID_BYTES_PER_SAMPLE;
  if (bytes.byteLength !== expectedBytes) {
    throw new RangeError(`surface payload has ${bytes.byteLength} bytes; expected ${expectedBytes}`);
  }
  const eastingSpan = header.bounds.maxEasting - header.bounds.minEasting;
  const northingSpan = header.bounds.maxNorthing - header.bounds.minNorthing;
  const tolerance = Math.max(1e-6, grid.sampleSpacingMetres * 1e-6);
  if (Math.abs(eastingSpan - (grid.width - 1) * grid.sampleSpacingMetres) > tolerance ||
      Math.abs(northingSpan - (grid.height - 1) * grid.sampleSpacingMetres) > tolerance) {
    throw new Error('surface grid dimensions and spacing do not span the declared bounds');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let validCount = 0;
  let noDataCount = 0;
  let minBoundaryDistanceMetres = Infinity;
  let maxBoundaryDistanceMetres = -Infinity;
  const surfaceIds = new Set();
  for (let index = 0; index < count; index++) {
    const offset = index * SURFACE_GRID_BYTES_PER_SAMPLE;
    const primary = view.getUint8(offset);
    const secondary = view.getUint8(offset + 1);
    const signedDistance = view.getInt16(offset + 2, true);
    if (primary === grid.noDataSurfaceId) {
      if (secondary !== grid.noDataSurfaceId || signedDistance !== 0 ||
          view.getUint16(offset + 4, true) !== 0 || view.getUint16(offset + 6, true) !== 0 ||
          view.getUint16(offset + 8, true) !== 0 || view.getUint8(offset + 10) !== 0 ||
          view.getUint8(offset + 11) !== 0 || view.getUint8(offset + 12) !== 0 ||
          view.getUint8(offset + 13) !== 0) {
        throw new Error(`surface no-data sample ${index} contains non-zero semantic fields`);
      }
      noDataCount++;
      continue;
    }
    if (secondary === primary) throw new Error(`surface sample ${index} repeats its primary id as secondary`);
    surfaceIds.add(primary);
    if (secondary !== grid.noDataSurfaceId) surfaceIds.add(secondary);
    const distance = signedDistance * grid.distanceScaleMetres;
    minBoundaryDistanceMetres = Math.min(minBoundaryDistanceMetres, distance);
    maxBoundaryDistanceMetres = Math.max(maxBoundaryDistanceMetres, distance);
    validCount++;
  }
  if (!validCount) throw new Error('decoded surface grid contains no classified samples');
  return {
    validCount,
    noDataCount,
    surfaceIds: [...surfaceIds].sort((left, right) => left - right),
    minBoundaryDistanceMetres,
    maxBoundaryDistanceMetres,
  };
}
