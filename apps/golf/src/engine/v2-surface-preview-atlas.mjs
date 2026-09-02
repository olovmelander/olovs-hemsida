/* Stitch verified, north-up surface BVCH tiles into the atlas interface shared
   by the existing TSL materials. This is a preview adapter only: its caller has
   already checked the descriptor's migration provenance and source pack hash.

   Two payloads are understood, and the descriptor says which:

   - pair-sdf-v1: two nearest ids + one signed distance per sample, the
     original representation, kept byte-for-byte so the retained preview and
     its gates keep working while the replacement is proved.
   - class-sdf-v1: one exact signed distance per non-rough class. Stitched into
     RGBA8 SDF textures (linear, mipmapped -- an averaged distance is still a
     distance, which an id never was) plus one route/ring field texture. The
     owner byte stays on the CPU: it is an id, ids are never filtered, and no
     shader reads it. */

import * as THREE from 'three/webgpu';
import { SURFACE, surfaceTransitionWidthMetres } from './surface.js';
import { SURFACE_NO_DATA_ID } from '../../../../packages/course-v2/surface-grid.mjs';
import {
  decodeSurfaceSdfDistance,
  SURFACE_SDF_INSIDE_BYTE,
  SURFACE_SDF_NO_ROUTE,
  SURFACE_SDF_PAYLOAD_FORMAT,
  SURFACE_SDF_RING_STEP_METRES,
  SURFACE_SDF_ROUTE_STEP_METRES,
} from '../../../../packages/course-v2/surface-sdf-grid.mjs';

const EPSILON = 1e-6;
const MATERIAL_EDGE_LIMIT_METRES = 8;
const ROUTE_DISTANCE_SCALE = 4;
const RING_DISTANCE_SCALE = 0.16;
const PAIR_REPRESENTATION = 'pair-sdf-v1';
const CLASS_REPRESENTATION = 'class-sdf-v1';
const MINIMUM_TRANSITION_WIDTH_METRES = 0.22;
const PAIR_FORMAT = 'surface-grid-u8-i16-le-v1';

function near(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= EPSILON;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function sortedUnique(values) {
  return [...values].sort((left, right) => left - right).filter((value, index, all) =>
    index === 0 || !near(value, all[index - 1]));
}

function resourceInfo(resource, frame, bridge, format) {
  const header = resource?.header;
  const grid = format === PAIR_FORMAT ? header?.surfaceGrid : header?.surfaceSdf;
  if (header?.kind !== 'surface' || header?.payloadFormat !== format) {
    throw new TypeError(`surface preview resource must be a verified ${format} surface tile`);
  }
  const width = grid?.width, height = grid?.height, spacing = grid?.sampleSpacingMetres;
  const stride = format === PAIR_FORMAT ? 14 : grid?.bytesPerSample;
  if (!Number.isSafeInteger(width) || width < 2 || !Number.isSafeInteger(height) || height < 2 ||
      !(spacing > 0) || !Number.isSafeInteger(stride) || !(resource.payload instanceof Uint8Array) ||
      resource.payload.byteLength !== width * height * stride) {
    throw new Error(`surface preview tile ${header.id} has an invalid payload/grid`);
  }
  const bounds = header.bounds || {};
  const spanX = (width - 1) * spacing;
  const spanZ = (height - 1) * spacing;
  if (!near(bounds.maxEasting - bounds.minEasting, spanX) ||
      !near(bounds.maxNorthing - bounds.minNorthing, spanZ)) {
    throw new Error(`surface preview tile ${header.id} bounds do not match its grid`);
  }
  const originX = finite(bounds.minEasting, `${header.id}.bounds.minEasting`) - frame.origin.easting + bridge.translateX;
  const originZ = frame.origin.northing - finite(bounds.maxNorthing, `${header.id}.bounds.maxNorthing`) + bridge.translateZ;
  return Object.freeze({
    id: header.id,
    width,
    height,
    spacing,
    stride,
    spanX,
    spanZ,
    originX,
    originZ,
    payload: resource.payload,
    grid,
  });
}

function makeTexture(data, width, height, format, filter, { mipmaps = false } = {}) {
  const texture = new THREE.DataTexture(data, width, height, format, THREE.UnsignedByteType);
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : filter;
  texture.magFilter = filter;
  texture.generateMipmaps = mipmaps;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/* Lay every tile into one row-major buffer of `stride` bytes per sample,
   refusing gaps, overlaps and any byte that disagrees on a shared border. */
function stitch(tiles) {
  const first = tiles[0];
  if (!tiles.every(tile => tile.width === first.width && tile.height === first.height &&
      tile.stride === first.stride && near(tile.spacing, first.spacing))) {
    throw new Error('surface preview tiles must have a common regular grid');
  }
  const stride = first.stride;
  const originsX = sortedUnique(tiles.map(tile => tile.originX));
  const originsZ = sortedUnique(tiles.map(tile => tile.originZ));
  const byCell = new Map();
  for (const tile of tiles) {
    const column = originsX.findIndex(value => near(value, tile.originX));
    const row = originsZ.findIndex(value => near(value, tile.originZ));
    const key = `${column},${row}`;
    if (column < 0 || row < 0 || byCell.has(key)) throw new Error(`surface preview tile grid is ambiguous at ${tile.id}`);
    byCell.set(key, tile);
  }
  if (byCell.size !== originsX.length * originsZ.length) {
    throw new Error('surface preview tile grid has missing cells');
  }
  for (let index = 1; index < originsX.length; index++) {
    if (!near(originsX[index] - originsX[index - 1], first.spanX)) throw new Error('surface preview has an easting gap');
  }
  for (let index = 1; index < originsZ.length; index++) {
    if (!near(originsZ[index] - originsZ[index - 1], first.spanZ)) throw new Error('surface preview has a northing gap');
  }

  const width = first.width + (originsX.length - 1) * (first.width - 1);
  const height = first.height + (originsZ.length - 1) * (first.height - 1);
  const samples = width * height;
  const raw = new Uint8Array(samples * stride);
  const written = new Uint8Array(samples);
  for (const [key, tile] of byCell) {
    const [column, row] = key.split(',').map(Number);
    const destinationColumn = column * (first.width - 1);
    const destinationRow = row * (first.height - 1);
    for (let sourceRow = 0; sourceRow < first.height; sourceRow++) {
      for (let sourceColumn = 0; sourceColumn < first.width; sourceColumn++) {
        const source = (sourceRow * first.width + sourceColumn) * stride;
        const destinationIndex = (destinationRow + sourceRow) * width + destinationColumn + sourceColumn;
        const destination = destinationIndex * stride;
        if (written[destinationIndex]) {
          for (let byte = 0; byte < stride; byte++) {
            if (raw[destination + byte] !== tile.payload[source + byte]) {
              throw new Error(`surface preview seam mismatch at ${tile.id}`);
            }
          }
        } else {
          raw.set(tile.payload.subarray(source, source + stride), destination);
          written[destinationIndex] = 1;
        }
      }
    }
  }
  if (written.some(value => value === 0)) throw new Error('surface preview atlas has an unwritten sample');

  const bounds = Object.freeze({
    x0: originsX[0] - first.spacing * 0.5,
    z0: originsZ[0] - first.spacing * 0.5,
    x1: originsX.at(-1) + first.spanX + first.spacing * 0.5,
    z1: originsZ.at(-1) + first.spanZ + first.spacing * 0.5,
    w: width,
    h: height,
    res: first.spacing,
  });
  return { raw, width, height, samples, stride, bounds, first };
}

function indexer(bounds, width, height) {
  return (x, z) => {
    const column = Math.floor((x - bounds.x0) / bounds.res);
    const row = Math.floor((z - bounds.z0) / bounds.res);
    return column < 0 || row < 0 || column >= width || row >= height ? -1 : row * width + column;
  };
}

/* Bilinear read of one byte channel from an interleaved buffer, at the same
   half-texel convention the material's uvAtlas uses. */
function bilinear(bounds, width, height, data, stride, channel) {
  return (x, z) => {
    const sampleX = Math.max(0, Math.min(width - 1, (x - bounds.x0) / bounds.res - 0.5));
    const sampleZ = Math.max(0, Math.min(height - 1, (z - bounds.z0) / bounds.res - 0.5));
    const column0 = Math.floor(sampleX), row0 = Math.floor(sampleZ);
    const column1 = Math.min(width - 1, column0 + 1), row1 = Math.min(height - 1, row0 + 1);
    const fractionX = sampleX - column0, fractionZ = sampleZ - row0;
    const at = (column, row) => data[(row * width + column) * stride + channel];
    const north = at(column0, row0) * (1 - fractionX) + at(column1, row0) * fractionX;
    const south = at(column0, row1) * (1 - fractionX) + at(column1, row1) * fractionX;
    return north * (1 - fractionZ) + south * fractionZ;
  };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------ pair-sdf-v1 */

function createPairAtlas({ resources, frame, bridge }) {
  const tiles = resources.map(resource => resourceInfo(resource, frame, bridge, PAIR_FORMAT));
  const distanceScale = resources[0].header.surfaceGrid.distanceScaleMetres;
  const mowScale = resources[0].header.surfaceGrid.mowCoordinateScaleMetres;
  if (!resources.every(resource => near(resource.header.surfaceGrid.distanceScaleMetres, distanceScale) &&
      near(resource.header.surfaceGrid.mowCoordinateScaleMetres, mowScale))) {
    throw new Error('surface preview tiles must use common field encodings');
  }
  const { raw, width, height, samples, bounds } = stitch(tiles);

  const idData = new Uint8Array(samples * 2);
  const fieldData = new Uint8Array(samples * 4);
  const classCounts = new Uint32Array(256);
  const primaryClassCounts = new Uint32Array(256);
  let noDataCount = 0;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let index = 0; index < samples; index++) {
    const source = index * 14;
    const primary = raw[source];
    const secondary = raw[source + 1];
    const target = index * 2;
    const fields = index * 4;
    if (primary === SURFACE_NO_DATA_ID) {
      idData[target] = SURFACE.ROUGH;
      idData[target + 1] = SURFACE.ROUGH;
      fieldData[fields] = 255;
      noDataCount++;
      continue;
    }
    if (secondary === primary) throw new Error(`surface preview sample ${index} has ambiguous secondary id`);
    const signedDistance = view.getInt16(source + 2, true) * distanceScale;
    const mowCoordinate = view.getUint16(source + 6, true) * mowScale;
    const owner = view.getUint16(source + 4, true);
    if (owner > 255) throw new Error(`surface preview owner ${owner} exceeds the material's 8-bit owner channel`);
    idData[target] = primary;
    idData[target + 1] = secondary === SURFACE_NO_DATA_ID ? primary : secondary;
    fieldData[fields] = Math.round((Math.max(-MATERIAL_EDGE_LIMIT_METRES,
      Math.min(MATERIAL_EDGE_LIMIT_METRES, signedDistance)) + MATERIAL_EDGE_LIMIT_METRES) /
      (MATERIAL_EDGE_LIMIT_METRES * 2) * 255);
    fieldData[fields + 1] = Math.round(Math.min(255, mowCoordinate * ROUTE_DISTANCE_SCALE));
    fieldData[fields + 2] = owner;
    fieldData[fields + 3] = Math.round(Math.min(255, mowCoordinate / RING_DISTANCE_SCALE));
    /* Primary is the higher-priority shader side, not necessarily the class
       occupying this sample. A negative signed distance means the encoded
       secondary is the current class (notably rough around Puttom edges). */
    const current = signedDistance < 0 && secondary !== SURFACE_NO_DATA_ID ? secondary : primary;
    classCounts[current]++;
    primaryClassCounts[primary]++;
  }

  const texID = makeTexture(idData, width, height, THREE.RGFormat, THREE.NearestFilter);
  const texF = makeTexture(fieldData, width, height, THREE.RGBAFormat, THREE.LinearFilter);
  const indexAt = indexer(bounds, width, height);
  const linearlySampleFieldByte = (x, z, channel) => bilinear(bounds, width, height, fieldData, 4, channel)(x, z);
  const probeAt = (x, z) => {
    finite(x, 'surface probe x');
    finite(z, 'surface probe z');
    const index = indexAt(x, z);
    if (index < 0) return Object.freeze({
      inBounds: false,
      representation: PAIR_REPRESENTATION,
      surface: SURFACE.ROUGH,
      weights: Object.freeze([Object.freeze({ surface: SURFACE.ROUGH, weight: 1 })]),
      weightSum: 1,
      weightError: 0,
    });
    const primary = idData[index * 2];
    const secondary = idData[index * 2 + 1];
    const signedDistanceMetres = linearlySampleFieldByte(x, z, 0) /
      255 * MATERIAL_EDGE_LIMIT_METRES * 2 - MATERIAL_EDGE_LIMIT_METRES;
    const transition = MINIMUM_TRANSITION_WIDTH_METRES;
    const primaryWeight = smoothstep(-transition, transition, signedDistanceMetres);
    const secondaryWeight = 1 - primaryWeight;
    const weights = primary === secondary
      ? [Object.freeze({ surface: primary, weight: 1 })]
      : [
          Object.freeze({ surface: primary, weight: primaryWeight }),
          Object.freeze({ surface: secondary, weight: secondaryWeight }),
        ];
    const weightSum = weights.reduce((sum, item) => sum + item.weight, 0);
    return Object.freeze({
      inBounds: true,
      representation: PAIR_REPRESENTATION,
      surface: primaryWeight >= 0.5 ? primary : secondary,
      primary,
      secondary,
      signedDistanceMetres,
      minimumTransitionWidthMetres: transition,
      weights: Object.freeze(weights),
      weightSum,
      weightError: Math.abs(1 - weightSum),
      owner: fieldData[index * 4 + 2],
      routeCoordinateMetres: linearlySampleFieldByte(x, z, 1) / ROUTE_DISTANCE_SCALE,
      ringCoordinateMetres: linearlySampleFieldByte(x, z, 3) * RING_DISTANCE_SCALE,
    });
  };
  const sampleAt = (x, z) => {
    const index = indexAt(x, z);
    if (index < 0) return { inBounds: false, surface: SURFACE.ROUGH };
    const primary = idData[index * 2];
    const secondary = idData[index * 2 + 1];
    const surface = fieldData[index * 4] < 128 ? secondary : primary;
    return Object.freeze({
      inBounds: true,
      surface,
      primary,
      secondary,
    });
  };
  return Object.freeze({
    texID,
    texF,
    texSdf: null,
    bounds,
    contains: (x, z) => indexAt(x, z) >= 0,
    sampleAt,
    probeAt,
    dispose: () => { texID.dispose(); texF.dispose(); },
    data: Object.freeze({
      bounds,
      classCounts,
      primaryClassCounts,
      noDataCount,
      tileIds: Object.freeze(tiles.map(tile => tile.id).sort()),
      decodedBytes: resources.reduce((sum, resource) => sum + resource.payload.byteLength, 0),
      textureBytes: idData.byteLength + fieldData.byteLength,
      representation: PAIR_REPRESENTATION,
      channels: null,
    }),
  });
}

/* ----------------------------------------------------------- class-sdf-v1 */

function createClassSdfAtlas({ resources, frame, bridge }) {
  const tiles = resources.map(resource => resourceInfo(resource, frame, bridge, SURFACE_SDF_PAYLOAD_FORMAT));
  const channels = Object.freeze([...tiles[0].grid.channels]);
  if (!tiles.every(tile => tile.grid.channels.length === channels.length &&
      tile.grid.channels.every((id, index) => id === channels[index]))) {
    throw new Error('surface preview tiles must share one channel palette');
  }
  if (channels.includes(SURFACE.ROUGH)) throw new Error('rough is the complement and may not be a channel');
  const { raw, width, height, samples, stride, bounds } = stitch(tiles);
  const channelCount = channels.length;
  const textureCount = Math.ceil(channelCount / 4);

  /* De-interleave: RGBA8 per four channels (a missing channel decodes to -4 m,
     "far outside", which is what an absent class is), one RG-in-RGBA8 field
     texture for route and ring, and the owner byte on the CPU only. */
  const sdfData = Array.from({ length: textureCount }, () => new Uint8Array(samples * 4));
  const fieldData = new Uint8Array(samples * 4);
  const ownerData = new Uint8Array(samples);
  const classIds = new Uint8Array(samples);
  const classCounts = new Uint32Array(256);
  for (let index = 0; index < samples; index++) {
    const source = index * stride;
    let occupied = SURFACE.ROUGH;
    for (let channel = 0; channel < channelCount; channel++) {
      const byte = raw[source + channel];
      sdfData[channel >> 2][index * 4 + (channel & 3)] = byte;
      if (occupied === SURFACE.ROUGH && byte >= SURFACE_SDF_INSIDE_BYTE) occupied = channels[channel];
    }
    fieldData[index * 4] = raw[source + channelCount];
    fieldData[index * 4 + 1] = raw[source + channelCount + 1];
    ownerData[index] = raw[source + channelCount + 2];
    classIds[index] = occupied;
    classCounts[occupied]++;
  }

  const texSdf = sdfData.map(data => makeTexture(data, width, height, THREE.RGBAFormat, THREE.LinearFilter, { mipmaps: true }));
  const texF = makeTexture(fieldData, width, height, THREE.RGBAFormat, THREE.LinearFilter);
  const indexAt = indexer(bounds, width, height);
  const sdfSampler = channels.map((_, channel) =>
    bilinear(bounds, width, height, sdfData[channel >> 2], 4, channel & 3));
  const routeSampler = bilinear(bounds, width, height, fieldData, 4, 0);
  const ringSampler = bilinear(bounds, width, height, fieldData, 4, 1);
  const widths = channels.map(id => surfaceTransitionWidthMetres(id));
  const roughWidth = surfaceTransitionWidthMetres(SURFACE.ROUGH);

  /* Shader-equivalent at magnification: the same bytes, the same bilinear
     footprint, the same per-class widths and the same normalisation. It omits
     only the screen-derivative widening, which has no meaning off-screen. */
  const probeAt = (x, z) => {
    finite(x, 'surface probe x');
    finite(z, 'surface probe z');
    const index = indexAt(x, z);
    if (index < 0) return Object.freeze({
      inBounds: false,
      representation: CLASS_REPRESENTATION,
      surface: SURFACE.ROUGH,
      weights: Object.freeze([Object.freeze({ surface: SURFACE.ROUGH, weight: 1 })]),
      weightSum: 1,
      rawWeightSum: 1,
      weightError: 0,
    });
    const distances = sdfSampler.map(sample => decodeSurfaceSdfDistance(sample(x, z)));
    /* the pair-width rule, exactly as the shader applies it: each class blends
       over the wider of its own width and the width of the class it meets --
       the runner-up for the leader, the leader for everyone else, rough when
       the runner-up is more than a metre away */
    let best = distances[0], bestWidth = widths[0], second = -8, secondWidth = roughWidth;
    for (let channel = 1; channel < distances.length; channel++) {
      const distance = distances[channel];
      if (distance > best) {
        second = best; secondWidth = bestWidth;
        best = distance; bestWidth = widths[channel];
      } else if (distance > second) {
        second = distance; secondWidth = widths[channel];
      }
    }
    const leaderMeets = second > -1 ? secondWidth : roughWidth;
    const classRaws = distances.map((distance, channel) => {
      const meets = distance >= best ? leaderMeets : bestWidth;
      const width = Math.max(widths[channel], meets);
      return smoothstep(-width, width, distance);
    });
    const classSum = classRaws.reduce((sum, value) => sum + value, 0);
    /* rough is the complement of the class WEIGHTS, exactly as the shader
       takes it -- see createClassSdfDecorator for why not of the distances */
    const roughRaw = Math.max(0, Math.min(1, 1 - classSum));
    const rawWeightSum = classSum + roughRaw;
    const inverse = 1 / Math.max(classSum, 1);
    const weights = [
      ...channels.map((surface, channel) => Object.freeze({
        surface, weight: classRaws[channel] * inverse, signedDistanceMetres: distances[channel],
      })),
      Object.freeze({ surface: SURFACE.ROUGH, weight: roughRaw * inverse, signedDistanceMetres: -Math.max(...distances) }),
    ];
    let leading = weights[0];
    for (const item of weights) if (item.weight > leading.weight) leading = item;
    const routeByte = routeSampler(x, z);
    return Object.freeze({
      inBounds: true,
      representation: CLASS_REPRESENTATION,
      surface: leading.surface,
      occupying: classIds[index],
      weights: Object.freeze(weights),
      weightSum: weights.reduce((sum, item) => sum + item.weight, 0),
      rawWeightSum,
      weightError: Math.abs(1 - rawWeightSum),
      owner: ownerData[index],
      routeCoordinateMetres: routeByte >= SURFACE_SDF_NO_ROUTE - 0.001 ? Infinity : routeByte * SURFACE_SDF_ROUTE_STEP_METRES,
      ringCoordinateMetres: ringSampler(x, z) * SURFACE_SDF_RING_STEP_METRES,
    });
  };
  const sampleAt = (x, z) => {
    const index = indexAt(x, z);
    if (index < 0) return { inBounds: false, surface: SURFACE.ROUGH };
    return Object.freeze({ inBounds: true, surface: classIds[index], owner: ownerData[index] });
  };
  return Object.freeze({
    texID: null,
    texF,
    texSdf: Object.freeze(texSdf),
    bounds,
    contains: (x, z) => indexAt(x, z) >= 0,
    sampleAt,
    probeAt,
    dispose: () => { for (const texture of texSdf) texture.dispose(); texF.dispose(); },
    data: Object.freeze({
      bounds,
      classCounts,
      /* no primary/secondary here; the occupying class is the only histogram */
      primaryClassCounts: classCounts,
      noDataCount: 0,
      tileIds: Object.freeze(tiles.map(tile => tile.id).sort()),
      decodedBytes: resources.reduce((sum, resource) => sum + resource.payload.byteLength, 0),
      textureBytes: sdfData.reduce((sum, data) => sum + data.byteLength, 0) + fieldData.byteLength,
      representation: CLASS_REPRESENTATION,
      channels,
      textureCount,
      /* the rough-complement ring byte only means "distance to my own edge"
         for classes cut in rings; the material reads it that way */
      ringStepMetres: SURFACE_SDF_RING_STEP_METRES,
      routeStepMetres: SURFACE_SDF_ROUTE_STEP_METRES,
    }),
  });
}

/**
 * Return a material-compatible atlas, rejecting gapped, overlapping or
 * semantically inconsistent tiles before a terrain batch can be rendered.
 */
export function createSurfacePreviewAtlas({ resources, frame, bridge } = {}) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('surface preview resources are required');
  if (!frame?.origin || !bridge) throw new TypeError('surface preview frame and bridge are required');
  finite(frame.origin.easting, 'frame.origin.easting');
  finite(frame.origin.northing, 'frame.origin.northing');
  finite(bridge.translateX, 'bridge.translateX');
  finite(bridge.translateZ, 'bridge.translateZ');
  const format = resources[0]?.header?.payloadFormat;
  if (!resources.every(resource => resource?.header?.payloadFormat === format)) {
    throw new Error('surface preview tiles must share one payload format');
  }
  if (format === PAIR_FORMAT) return createPairAtlas({ resources, frame, bridge });
  if (format === SURFACE_SDF_PAYLOAD_FORMAT) return createClassSdfAtlas({ resources, frame, bridge });
  throw new TypeError(`surface preview resource must be a verified surface grid, not ${format}`);
}
