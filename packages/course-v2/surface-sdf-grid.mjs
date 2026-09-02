/* The per-class surface payload: `surface-sdf-u8-v1`.

   One byte of clamped signed distance per non-rough class channel, in the
   order the header's `channels` palette declares, followed by three auxiliary
   bytes: the route distance the fairway/semi mow bands run on, the UNCLAMPED
   ring distance the green/fringe mow rings run on, and the owning hole.

     [sdf_0 .. sdf_{N-1}] route ring owner        = N + 3 bytes per sample

   Rough is never stored: the resolved regions partition the plane, so it is
   the complement -max(sdf_i), and a sample where every channel is negative is
   rough. There is no no-data byte; a no-data sample encodes as every channel
   saturated negative with no route, which is what "rough, unmown" is.

   Nothing in here knows Puttom's classes. The palette is data, and a course
   with more classes simply carries more channels, up to sixteen. */

export const SURFACE_SDF_PAYLOAD_FORMAT = 'surface-sdf-u8-v1';
export const SURFACE_SDF_FEATURE = 'surface-sdf-u8-v1';
export const SURFACE_SDF_DISTANCE_LIMIT_METRES = 4;
export const SURFACE_SDF_ROUTE_STEP_METRES = 0.25;
export const SURFACE_SDF_RING_STEP_METRES = 0.16;
export const SURFACE_SDF_NO_ROUTE = 255;
export const SURFACE_SDF_MAX_CHANNELS = 16;
export const SURFACE_SDF_AUXILIARY_BYTES = 3;
/* The one byte value that decodes to exactly zero is 127.5, which no byte is;
   128 decodes to +0.0157 m. A compiled channel is never within a quarter of a
   metre of zero (its source pixel is 0.25 m), so "byte >= 128" is "inside". */
export const SURFACE_SDF_INSIDE_BYTE = 128;
export const MAX_SURFACE_SDF_BYTES = 64 * 1024 * 1024;

const ROUGH = 0;

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

export function validateSurfaceSdfChannels(channels) {
  if (!Array.isArray(channels) || !channels.length || channels.length > SURFACE_SDF_MAX_CHANNELS) {
    throw new RangeError(`channels must list 1 to ${SURFACE_SDF_MAX_CHANNELS} surface ids`);
  }
  const seen = new Set();
  for (const id of channels) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 254) {
      throw new RangeError('channel ids must be surface registry ids from 1 to 254 (rough is the complement)');
    }
    if (seen.has(id)) throw new RangeError(`channel id ${id} is duplicated`);
    seen.add(id);
  }
  return channels;
}

export function validateSurfaceSdfMetadata(surfaceSdf) {
  if (!surfaceSdf || typeof surfaceSdf !== 'object') throw new TypeError('surfaceSdf metadata is required');
  const count = dimensions(surfaceSdf.width, surfaceSdf.height);
  validateSurfaceSdfChannels(surfaceSdf.channels);
  const bytesPerSample = surfaceSdf.channels.length + SURFACE_SDF_AUXILIARY_BYTES;
  if (surfaceSdf.bytesPerSample !== bytesPerSample) {
    throw new Error(`surfaceSdf bytesPerSample must be ${bytesPerSample} for ${surfaceSdf.channels.length} channels`);
  }
  if (count * bytesPerSample > MAX_SURFACE_SDF_BYTES) {
    throw new RangeError('surface sdf grid exceeds the 64 MiB decoded-chunk budget');
  }
  if (!(surfaceSdf.sampleSpacingMetres >= 0.01 && surfaceSdf.sampleSpacingMetres <= 10000)) {
    throw new RangeError('sampleSpacingMetres must be between 0.01 and 10000');
  }
  if (surfaceSdf.distanceLimitMetres !== SURFACE_SDF_DISTANCE_LIMIT_METRES) {
    throw new Error(`distanceLimitMetres must be ${SURFACE_SDF_DISTANCE_LIMIT_METRES}`);
  }
  if (surfaceSdf.distanceEncoding !== 'unorm8-signed') throw new Error('distanceEncoding must be unorm8-signed');
  if (surfaceSdf.routeStepMetres !== SURFACE_SDF_ROUTE_STEP_METRES) {
    throw new Error(`routeStepMetres must be ${SURFACE_SDF_ROUTE_STEP_METRES}`);
  }
  if (surfaceSdf.noRouteValue !== SURFACE_SDF_NO_ROUTE) throw new Error(`noRouteValue must be ${SURFACE_SDF_NO_ROUTE}`);
  if (surfaceSdf.ringStepMetres !== SURFACE_SDF_RING_STEP_METRES) {
    throw new Error(`ringStepMetres must be ${SURFACE_SDF_RING_STEP_METRES}`);
  }
  if (surfaceSdf.ownerEncoding !== 'u8-hole') throw new Error('ownerEncoding must be u8-hole');
  if (surfaceSdf.rowOrder !== 'north-to-south' || surfaceSdf.columnOrder !== 'west-to-east') {
    throw new Error('unsupported surface sdf axis order');
  }
  if (!Number.isSafeInteger(surfaceSdf.surfaceRegistryVersion) ||
      surfaceSdf.surfaceRegistryVersion < 1 || surfaceSdf.surfaceRegistryVersion > 65535) {
    throw new RangeError('surfaceRegistryVersion must be an integer from 1 to 65535');
  }
  return count;
}

export function encodeSurfaceSdfDistance(metres) {
  const limit = SURFACE_SDF_DISTANCE_LIMIT_METRES;
  const clamped = Math.max(-limit, Math.min(limit, metres));
  return Math.round((clamped + limit) / (2 * limit) * 255);
}

export function decodeSurfaceSdfDistance(byte) {
  const limit = SURFACE_SDF_DISTANCE_LIMIT_METRES;
  return byte * (2 * limit / 255) - limit;
}

/**
 * Encode per-class distances plus the auxiliary fields into one payload.
 * `distancesMetres[c]` is a Float32Array per channel in metres, unclamped
 * (the encoder clamps). `routeDistancesMetres` may hold Infinity for "no
 * route"; `ringDistancesMetres` is the occupying class's own inside distance,
 * unclamped; `ownerIds` are hole numbers 0-255.
 */
export function encodeSurfaceSdfGrid({
  channels,
  distancesMetres,
  routeDistancesMetres,
  ringDistancesMetres,
  ownerIds,
  width,
  height,
  sampleSpacingMetres,
  surfaceRegistryVersion = 1,
}) {
  const count = dimensions(width, height);
  validateSurfaceSdfChannels(channels);
  if (!Array.isArray(distancesMetres) || distancesMetres.length !== channels.length ||
      distancesMetres.some(field => !(field instanceof Float32Array) || field.length !== count)) {
    throw new TypeError('distancesMetres must hold one Float32Array of width * height per channel');
  }
  for (const [label, field] of [['routeDistancesMetres', routeDistancesMetres], ['ringDistancesMetres', ringDistancesMetres]]) {
    if (!(field instanceof Float32Array) || field.length !== count) {
      throw new TypeError(`${label} must be a Float32Array of width * height`);
    }
  }
  if (!ArrayBuffer.isView(ownerIds) || ownerIds.length !== count) {
    throw new TypeError('ownerIds must be a typed array of width * height');
  }
  if (!(sampleSpacingMetres >= 0.01 && sampleSpacingMetres <= 10000)) {
    throw new RangeError('sampleSpacingMetres must be between 0.01 and 10000');
  }
  const bytesPerSample = channels.length + SURFACE_SDF_AUXILIARY_BYTES;
  if (count * bytesPerSample > MAX_SURFACE_SDF_BYTES) {
    throw new RangeError('surface sdf grid exceeds the 64 MiB decoded-chunk budget');
  }

  const payload = new Uint8Array(count * bytesPerSample);
  const positiveCounts = new Uint32Array(channels.length);
  let roughCount = 0;
  let violations = 0;
  for (let index = 0; index < count; index++) {
    const offset = index * bytesPerSample;
    let inside = 0;
    for (let channel = 0; channel < channels.length; channel++) {
      const metres = distancesMetres[channel][index];
      if (!Number.isFinite(metres)) throw new RangeError(`distancesMetres[${channel}][${index}] must be finite`);
      const byte = encodeSurfaceSdfDistance(metres);
      payload[offset + channel] = byte;
      if (byte >= SURFACE_SDF_INSIDE_BYTE) { inside++; positiveCounts[channel]++; }
    }
    if (inside === 0) roughCount++;
    else if (inside > 1) violations++;
    const route = routeDistancesMetres[index];
    payload[offset + channels.length] = Number.isFinite(route) && route >= 0
      ? Math.min(SURFACE_SDF_NO_ROUTE, Math.round(route / SURFACE_SDF_ROUTE_STEP_METRES))
      : SURFACE_SDF_NO_ROUTE;
    const ring = ringDistancesMetres[index];
    if (!(ring >= 0)) throw new RangeError(`ringDistancesMetres[${index}] must be non-negative`);
    payload[offset + channels.length + 1] = Math.min(255, Math.round(ring / SURFACE_SDF_RING_STEP_METRES));
    const owner = ownerIds[index];
    if (!Number.isSafeInteger(owner) || owner < 0 || owner > 255) {
      throw new RangeError(`ownerIds[${index}] must be a hole number from 0 to 255`);
    }
    payload[offset + channels.length + 2] = owner;
  }
  /* The regions were resolved by priority before any distance was taken, so
     two channels claiming one sample means the compiler's masks overlapped --
     a bug upstream, never a value to ship. */
  if (violations) throw new Error(`${violations} samples are inside more than one class channel`);

  return {
    payload,
    surfaceSdf: {
      width,
      height,
      sampleSpacingMetres,
      bytesPerSample,
      channels: [...channels],
      distanceLimitMetres: SURFACE_SDF_DISTANCE_LIMIT_METRES,
      distanceEncoding: 'unorm8-signed',
      routeStepMetres: SURFACE_SDF_ROUTE_STEP_METRES,
      noRouteValue: SURFACE_SDF_NO_ROUTE,
      ringStepMetres: SURFACE_SDF_RING_STEP_METRES,
      ownerEncoding: 'u8-hole',
      surfaceRegistryVersion,
      rowOrder: 'north-to-south',
      columnOrder: 'west-to-east',
    },
    positiveCounts,
    roughCount,
    maximumDistanceErrorMetres: SURFACE_SDF_DISTANCE_LIMIT_METRES / 255,
  };
}

/** The class occupying one sample: the channel whose byte is inside, or rough. */
export function surfaceSdfSampleClass(payload, surfaceSdf, index) {
  const channels = surfaceSdf.channels;
  const offset = index * surfaceSdf.bytesPerSample;
  for (let channel = 0; channel < channels.length; channel++) {
    if (payload[offset + channel] >= SURFACE_SDF_INSIDE_BYTE) return channels[channel];
  }
  return ROUGH;
}

export function decodeSurfaceSdfGrid(payload, surfaceSdf) {
  const bytes = byteView(payload);
  const count = validateSurfaceSdfMetadata(surfaceSdf);
  const stride = surfaceSdf.bytesPerSample;
  if (bytes.byteLength !== count * stride) {
    throw new RangeError(`surface sdf payload has ${bytes.byteLength} bytes; expected ${count * stride}`);
  }
  const channels = surfaceSdf.channels;
  const distancesMetres = channels.map(() => new Float32Array(count));
  const routeDistancesMetres = new Float32Array(count);
  const ringDistancesMetres = new Float32Array(count);
  const ownerIds = new Uint8Array(count);
  const classIds = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const offset = index * stride;
    let occupied = ROUGH;
    for (let channel = 0; channel < channels.length; channel++) {
      const byte = bytes[offset + channel];
      distancesMetres[channel][index] = decodeSurfaceSdfDistance(byte);
      if (occupied === ROUGH && byte >= SURFACE_SDF_INSIDE_BYTE) occupied = channels[channel];
    }
    const route = bytes[offset + channels.length];
    routeDistancesMetres[index] = route === SURFACE_SDF_NO_ROUTE ? Infinity : route * SURFACE_SDF_ROUTE_STEP_METRES;
    ringDistancesMetres[index] = bytes[offset + channels.length + 1] * SURFACE_SDF_RING_STEP_METRES;
    ownerIds[index] = bytes[offset + channels.length + 2];
    classIds[index] = occupied;
  }
  return { channels: [...channels], distancesMetres, routeDistancesMetres, ringDistancesMetres, ownerIds, classIds };
}

/**
 * Walk every sample once and report what the payload contains, refusing the
 * two things a valid compilation can never produce: a sample inside more than
 * one channel, and a payload whose size disagrees with its own header.
 */
export function inspectSurfaceSdfPayload(payload, header) {
  const bytes = byteView(payload);
  const grid = header.surfaceSdf;
  const count = validateSurfaceSdfMetadata(grid);
  const stride = grid.bytesPerSample;
  if (bytes.byteLength !== count * stride) {
    throw new RangeError(`surface sdf payload has ${bytes.byteLength} bytes; expected ${count * stride}`);
  }
  const eastingSpan = header.bounds.maxEasting - header.bounds.minEasting;
  const northingSpan = header.bounds.maxNorthing - header.bounds.minNorthing;
  const tolerance = Math.max(1e-6, grid.sampleSpacingMetres * 1e-6);
  if (Math.abs(eastingSpan - (grid.width - 1) * grid.sampleSpacingMetres) > tolerance ||
      Math.abs(northingSpan - (grid.height - 1) * grid.sampleSpacingMetres) > tolerance) {
    throw new Error('surface sdf grid dimensions and spacing do not span the declared bounds');
  }
  const channels = grid.channels;
  const classCounts = new Uint32Array(256);
  let routedCount = 0;
  for (let index = 0; index < count; index++) {
    const offset = index * stride;
    let inside = 0;
    let occupied = ROUGH;
    for (let channel = 0; channel < channels.length; channel++) {
      if (bytes[offset + channel] >= SURFACE_SDF_INSIDE_BYTE) { inside++; occupied = channels[channel]; }
    }
    if (inside > 1) throw new Error(`surface sdf sample ${index} is inside ${inside} class channels`);
    classCounts[occupied]++;
    if (bytes[offset + channels.length] !== SURFACE_SDF_NO_ROUTE) routedCount++;
  }
  const surfaceIds = [];
  for (let id = 0; id < 256; id++) if (classCounts[id] > 0) surfaceIds.push(id);
  return {
    validCount: count,
    noDataCount: 0,
    surfaceIds,
    classCounts: Array.from(classCounts),
    routedCount,
    channels: [...channels],
  };
}
