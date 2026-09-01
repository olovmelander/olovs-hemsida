/* Stitch verified, north-up surface BVCH tiles into the atlas interface shared
   by the existing TSL materials. This is a preview adapter only: its caller has
   already checked the descriptor's migration provenance and source pack hash. */

import * as THREE from 'three/webgpu';
import { SURFACE } from './surface.js';
import { SURFACE_NO_DATA_ID } from '../../../../packages/course-v2/surface-grid.mjs';

const EPSILON = 1e-6;
const MATERIAL_EDGE_LIMIT_METRES = 8;
const ROUTE_DISTANCE_SCALE = 4;
const RING_DISTANCE_SCALE = 0.16;
const PREVIEW_REPRESENTATION = 'pair-sdf-v1';
const MINIMUM_TRANSITION_WIDTH_METRES = 0.22;

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

function resourceInfo(resource, frame, bridge) {
  const header = resource?.header;
  const grid = header?.surfaceGrid;
  if (header?.kind !== 'surface' || header?.payloadFormat !== 'surface-grid-u8-i16-le-v1') {
    throw new TypeError('surface preview resource must be a verified surface grid');
  }
  const width = grid?.width, height = grid?.height, spacing = grid?.sampleSpacingMetres;
  if (!Number.isSafeInteger(width) || width < 2 || !Number.isSafeInteger(height) || height < 2 ||
      !(spacing > 0) || !(resource.payload instanceof Uint8Array) ||
      resource.payload.byteLength !== width * height * 14) {
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
    spanX,
    spanZ,
    originX,
    originZ,
    payload: resource.payload,
  });
}

function makeTexture(data, width, height, format, filter) {
  const texture = new THREE.DataTexture(data, width, height, format, THREE.UnsignedByteType);
  texture.minFilter = filter;
  texture.magFilter = filter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
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

  const tiles = resources.map(resource => resourceInfo(resource, frame, bridge));
  const first = tiles[0];
  if (!tiles.every(tile => tile.width === first.width && tile.height === first.height && near(tile.spacing, first.spacing))) {
    throw new Error('surface preview tiles must have a common regular grid');
  }
  const distanceScale = resources[0].header.surfaceGrid.distanceScaleMetres;
  const mowScale = resources[0].header.surfaceGrid.mowCoordinateScaleMetres;
  if (!resources.every(resource => near(resource.header.surfaceGrid.distanceScaleMetres, distanceScale) &&
      near(resource.header.surfaceGrid.mowCoordinateScaleMetres, mowScale))) {
    throw new Error('surface preview tiles must use common field encodings');
  }
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
  const raw = new Uint8Array(samples * 14);
  const written = new Uint8Array(samples);
  for (const [key, tile] of byCell) {
    const [column, row] = key.split(',').map(Number);
    const destinationColumn = column * (first.width - 1);
    const destinationRow = row * (first.height - 1);
    for (let sourceRow = 0; sourceRow < first.height; sourceRow++) {
      for (let sourceColumn = 0; sourceColumn < first.width; sourceColumn++) {
        const source = (sourceRow * first.width + sourceColumn) * 14;
        const destinationIndex = (destinationRow + sourceRow) * width + destinationColumn + sourceColumn;
        const destination = destinationIndex * 14;
        if (written[destinationIndex]) {
          for (let byte = 0; byte < 14; byte++) {
            if (raw[destination + byte] !== tile.payload[source + byte]) {
              throw new Error(`surface preview seam mismatch at ${tile.id}`);
            }
          }
        } else {
          raw.set(tile.payload.subarray(source, source + 14), destination);
          written[destinationIndex] = 1;
        }
      }
    }
  }
  if (written.some(value => value === 0)) throw new Error('surface preview atlas has an unwritten sample');

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

  const bounds = Object.freeze({
    x0: originsX[0] - first.spacing * 0.5,
    z0: originsZ[0] - first.spacing * 0.5,
    x1: originsX.at(-1) + first.spanX + first.spacing * 0.5,
    z1: originsZ.at(-1) + first.spanZ + first.spacing * 0.5,
    w: width,
    h: height,
    res: first.spacing,
  });
  const texID = makeTexture(idData, width, height, THREE.RGFormat, THREE.NearestFilter);
  const texF = makeTexture(fieldData, width, height, THREE.RGBAFormat, THREE.LinearFilter);
  const indexAt = (x, z) => {
    const column = Math.floor((x - bounds.x0) / bounds.res);
    const row = Math.floor((z - bounds.z0) / bounds.res);
    return column < 0 || row < 0 || column >= width || row >= height ? -1 : row * width + column;
  };
  const linearlySampleFieldByte = (x, z, channel) => {
    const sampleX = Math.max(0, Math.min(width - 1, (x - bounds.x0) / bounds.res - 0.5));
    const sampleZ = Math.max(0, Math.min(height - 1, (z - bounds.z0) / bounds.res - 0.5));
    const column0 = Math.floor(sampleX), row0 = Math.floor(sampleZ);
    const column1 = Math.min(width - 1, column0 + 1), row1 = Math.min(height - 1, row0 + 1);
    const fractionX = sampleX - column0, fractionZ = sampleZ - row0;
    const at = (column, row) => fieldData[(row * width + column) * 4 + channel];
    const north = at(column0, row0) * (1 - fractionX) + at(column1, row0) * fractionX;
    const south = at(column0, row1) * (1 - fractionX) + at(column1, row1) * fractionX;
    return north * (1 - fractionZ) + south * fractionZ;
  };
  const probeAt = (x, z) => {
    finite(x, 'surface probe x');
    finite(z, 'surface probe z');
    const index = indexAt(x, z);
    if (index < 0) return Object.freeze({
      inBounds: false,
      representation: PREVIEW_REPRESENTATION,
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
    const t = Math.max(0, Math.min(1,
      (signedDistanceMetres + transition) / (transition * 2)));
    const primaryWeight = t * t * (3 - 2 * t);
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
      representation: PREVIEW_REPRESENTATION,
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
      representation: PREVIEW_REPRESENTATION,
    }),
  });
}
