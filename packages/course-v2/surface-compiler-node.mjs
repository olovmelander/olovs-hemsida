import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { rasterizeGroundAtlas } from '../../apps/golf/src/engine/atlas.js';
import { SURFACE, SURFACE_PRIORITY } from '../../apps/golf/src/engine/surface.js';
import { canonicalJson } from './canonical-json.mjs';
import { assetReferenceForChunk, verifyChunkAsset, writeChunk } from './chunk-node.mjs';
import { extractWindow, signedDistanceField } from './distance-transform.mjs';
import { encodeSurfaceGrid } from './surface-grid.mjs';
import {
  encodeSurfaceSdfGrid,
  SURFACE_SDF_DISTANCE_LIMIT_METRES,
  SURFACE_SDF_FEATURE,
  SURFACE_SDF_PAYLOAD_FORMAT,
  SURFACE_SDF_RING_STEP_METRES,
} from './surface-sdf-grid.mjs';
import {
  assertSurfacePreview,
  SURFACE_PREVIEW_KIND,
  SURFACE_PREVIEW_PROVISIONAL_REASON,
  SURFACE_PREVIEW_SOURCE_KIND,
  SURFACE_REPRESENTATIONS,
} from './surface-preview.mjs';

const SURFACE_FEATURES = Object.freeze(['chunk-envelope-v2', 'surface-grid-u8-i16-v1']);
const SURFACE_SDF_FEATURES = Object.freeze(['chunk-envelope-v2', SURFACE_SDF_FEATURE]);
/* The per-class fields are taken from a source mask this many times finer
   than the payload: 25 cm at 1 m. The distance error of a centre-sampled
   mask is half a source pixel, 12.5 cm, below the 0.25 m boundary gate. */
const SDF_SOURCE_OVERSAMPLE = 4;
/* Classes whose mow pattern is cut in rings from their own edge inward. Their
   inside distance is stored UNCLAMPED (to 40.8 m) so the rings run to the
   middle of a 30 m green; every other class's ring byte is clamped with the
   SDF so it is byte-identical on shared tile borders. */
const RING_CLASSES = Object.freeze([SURFACE.GREEN, SURFACE.FRINGE]);
const RING_LIMIT_METRES = 255 * SURFACE_SDF_RING_STEP_METRES;
const EDGE_DISTANCE_LIMIT_METRES = 8;
const ROUTE_DISTANCE_SCALE = 4;
const RING_DISTANCE_SCALE = 0.16;
const EPSILON = 1e-6;
const SURFACE_RANK = new Uint8Array(256);
for (let index = 0; index < SURFACE_PRIORITY.length; index++) {
  SURFACE_RANK[SURFACE_PRIORITY[index]] = SURFACE_PRIORITY.length - index;
}

function id(value, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) {
    throw new TypeError(`${label} must be a lowercase kebab-case id`);
  }
  return value;
}

function sha256(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new TypeError(`${label} must be a lowercase SHA-256`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function near(left, right) {
  return Math.abs(left - right) <= EPSILON;
}

function roundedInteger(value, label) {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || !near(value, rounded)) {
    throw new Error(`${label} must land on an exact sample coordinate`);
  }
  return rounded;
}

function copyBounds(value, label) {
  const fields = [
    'minEasting', 'minNorthing', 'minHeightRH2000',
    'maxEasting', 'maxNorthing', 'maxHeightRH2000',
  ];
  if (!value || typeof value !== 'object') throw new TypeError(`${label} must be an object`);
  const result = Object.fromEntries(fields.map(field => [field, finite(value[field], `${label}.${field}`)]));
  if (!(result.minEasting < result.maxEasting && result.minNorthing < result.maxNorthing &&
      result.minHeightRH2000 <= result.maxHeightRH2000)) {
    throw new RangeError(`${label} has invalid extents`);
  }
  return Object.freeze(result);
}

function previewFrame(frame) {
  if (!frame || typeof frame !== 'object') throw new TypeError('frame is required');
  if (frame.compoundCrs !== 'EPSG:5845' || frame.horizontalCrs !== 'EPSG:3006' ||
      frame.verticalCrs !== 'EPSG:5613') {
    throw new Error('surface preview requires the canonical EPSG:5845 frame');
  }
  sha256(frame.fingerprint, 'frame.fingerprint');
  const origin = frame.origin || {};
  const expectedAxisMapping = {
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  };
  for (const [axis, mapping] of Object.entries(expectedAxisMapping)) {
    if (frame.axisMapping?.[axis] !== mapping) {
      throw new Error(`surface preview requires canonical ${axis} axis mapping`);
    }
  }
  return Object.freeze({
    origin: Object.freeze({
      easting: finite(origin.easting, 'frame.origin.easting'),
      northing: finite(origin.northing, 'frame.origin.northing'),
      heightRH2000: finite(origin.heightRH2000, 'frame.origin.heightRH2000'),
    }),
    fingerprint: frame.fingerprint,
  });
}

function previewBridge(value) {
  if (!value || typeof value !== 'object') throw new TypeError('legacy bridge is required');
  return Object.freeze({
    translateX: finite(value.translateX, 'legacy bridge translateX'),
    translateZ: finite(value.translateZ, 'legacy bridge translateZ'),
  });
}

function normalizeTiles(value) {
  if (!Array.isArray(value) || !value.length || value.length > 64) {
    throw new RangeError('surface preview requires 1 to 64 terrain tiles');
  }
  const ids = new Set();
  const result = value.map((tile, index) => {
    const at = `tiles[${index}]`;
    if (!tile || typeof tile !== 'object') throw new TypeError(`${at} must be an object`);
    if (!/^l(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)\/(?:0|[1-9][0-9]*)$/.test(tile.id || '')) {
      throw new TypeError(`${at}.id must be a finest terrain tile id`);
    }
    if (ids.has(tile.id)) throw new Error(`${at}.id is duplicated`);
    ids.add(tile.id);
    const sampleSpacingMetres = finite(tile.sampleSpacingMetres, `${at}.sampleSpacingMetres`);
    if (!(sampleSpacingMetres > 0 && sampleSpacingMetres <= 1000)) {
      throw new RangeError(`${at}.sampleSpacingMetres must be positive`);
    }
    const bounds = copyBounds(tile.bounds, `${at}.bounds`);
    const width = roundedInteger(
      (bounds.maxEasting - bounds.minEasting) / sampleSpacingMetres + 1,
      `${at} easting span`,
    );
    const height = roundedInteger(
      (bounds.maxNorthing - bounds.minNorthing) / sampleSpacingMetres + 1,
      `${at} northing span`,
    );
    if (width < 2 || height < 2 || width > 4097 || height > 4097) {
      throw new RangeError(`${at} dimensions must be from 2 to 4097`);
    }
    return Object.freeze({ id: tile.id, bounds, sampleSpacingMetres, width, height });
  });
  return Object.freeze(result.sort((left, right) => left.id.localeCompare(right.id)));
}

function worldBounds(bounds, frame, bridge) {
  return Object.freeze({
    x0: bounds.minEasting - frame.origin.easting + bridge.translateX,
    x1: bounds.maxEasting - frame.origin.easting + bridge.translateX,
    z0: frame.origin.northing - bounds.maxNorthing + bridge.translateZ,
    z1: frame.origin.northing - bounds.minNorthing + bridge.translateZ,
  });
}

function previewExtent(tiles, spacing) {
  const extent = {
    minEasting: Math.min(...tiles.map(tile => tile.bounds.minEasting)),
    minNorthing: Math.min(...tiles.map(tile => tile.bounds.minNorthing)),
    maxEasting: Math.max(...tiles.map(tile => tile.bounds.maxEasting)),
    maxNorthing: Math.max(...tiles.map(tile => tile.bounds.maxNorthing)),
  };
  const width = roundedInteger((extent.maxEasting - extent.minEasting) / spacing + 1, 'preview easting span');
  const height = roundedInteger((extent.maxNorthing - extent.minNorthing) / spacing + 1, 'preview northing span');
  return Object.freeze({ ...extent, width, height });
}

function assertRegularTerrainFrontier(tiles, extent, spacing) {
  const first = tiles[0];
  if (!tiles.every(tile => tile.width === first.width && tile.height === first.height)) {
    throw new Error('surface preview terrain tiles must have common grid dimensions');
  }
  const spanX = (first.width - 1) * spacing;
  const spanY = (first.height - 1) * spacing;
  const cells = new Set();
  let columns = 0, rows = 0;
  for (const tile of tiles) {
    const column = roundedInteger((tile.bounds.minEasting - extent.minEasting) / spanX, `${tile.id} frontier column`);
    const row = roundedInteger((extent.maxNorthing - tile.bounds.maxNorthing) / spanY, `${tile.id} frontier row`);
    const key = `${column},${row}`;
    if (column < 0 || row < 0 || cells.has(key)) throw new Error('surface preview terrain frontier is ambiguous');
    cells.add(key);
    columns = Math.max(columns, column + 1);
    rows = Math.max(rows, row + 1);
  }
  if (cells.size !== columns * rows || !near(columns * spanX, extent.maxEasting - extent.minEasting) ||
      !near(rows * spanY, extent.maxNorthing - extent.minNorthing)) {
    throw new Error('surface preview terrain frontier has a gap or partial tile');
  }
  return Object.freeze({ columns, rows });
}

function materialCoordinate(surface, fields, index) {
  if (surface === SURFACE.GREEN || surface === SURFACE.FRINGE) {
    return fields[index * 4 + 3] * RING_DISTANCE_SCALE;
  }
  if (surface === SURFACE.FAIRWAY || surface === SURFACE.SEMI) {
    return fields[index * 4 + 1] / ROUTE_DISTANCE_SCALE;
  }
  return 0;
}

function boundarySample(raster, index) {
  const current = raster.classes[index];
  const other = raster.boundaryNeighbour[index];
  const distance = Math.min(EDGE_DISTANCE_LIMIT_METRES, raster.boundaryDistance[index]);
  if (other !== current && SURFACE_RANK[other] > SURFACE_RANK[current]) {
    return { primary: other, secondary: current, signedDistance: -distance };
  }
  return { primary: current, secondary: other, signedDistance: distance };
}

function tilePayload({ raster, boundaryRaster, boundaryOversample, tile, extent, spacing, mowCoordinateMode }) {
  const count = tile.width * tile.height;
  const primarySurfaceIds = new Uint8Array(count);
  const secondarySurfaceIds = new Uint8Array(count);
  const boundaryDistancesMetres = new Float32Array(count);
  const ownerFeatureIds = new Uint16Array(count);
  const mowCoordinatesMetres = new Float32Array(count);
  const column0 = roundedInteger((tile.bounds.minEasting - extent.minEasting) / spacing, `${tile.id} column`);
  const row0 = roundedInteger((extent.maxNorthing - tile.bounds.maxNorthing) / spacing, `${tile.id} row`);

  for (let row = 0; row < tile.height; row++) {
    for (let column = 0; column < tile.width; column++) {
      const source = (row0 + row) * extent.width + column0 + column;
      const boundarySource = ((row0 + row) * boundaryOversample) * boundaryRaster.bounds.w +
        (column0 + column) * boundaryOversample;
      const target = row * tile.width + column;
      if (source < 0 || source >= raster.classes.length) throw new Error(`${tile.id} slice escapes the preview raster`);
      if (boundarySource < 0 || boundarySource >= boundaryRaster.classes.length) {
        throw new Error(`${tile.id} slice escapes the supersampled boundary raster`);
      }
      const { primary, secondary, signedDistance } = boundarySample(boundaryRaster, boundarySource);
      primarySurfaceIds[target] = primary;
      /* The surface contract denotes no adjacent material with 255. The legacy
         shader had repeated ids internally, so normalize only at this boundary. */
      secondarySurfaceIds[target] = secondary === primary ? 255 : secondary;
      boundaryDistancesMetres[target] = signedDistance;
      ownerFeatureIds[target] = raster.owner[source];
      mowCoordinatesMetres[target] = mowCoordinateMode === 'unmeasured-zero'
        ? 0
        : materialCoordinate(primary, raster.fieldData, source);
    }
  }
  return encodeSurfaceGrid({
    primarySurfaceIds,
    secondarySurfaceIds,
    boundaryDistancesMetres,
    ownerFeatureIds,
    mowCoordinatesMetres,
    width: tile.width,
    height: tile.height,
    sampleSpacingMetres: spacing,
    distanceScaleMetres: 0.01,
    mowCoordinateScaleMetres: 0.01,
  });
}

/* The per-class payload for one tile: exact Euclidean signed distance per
   channel from the 25 cm resolved mask, sampled at the 1 m lattice, plus the
   route/ring/owner bytes. Each tile is transformed inside its own window with
   a halo at least as wide as the largest distance it stores, which makes the
   bytes on a shared tile border identical however the frontier is cut. */
function tileSdfPayload({ raster, source, oversample, tile, extent, spacing, channels }) {
  const count = tile.width * tile.height;
  const column0 = roundedInteger((tile.bounds.minEasting - extent.minEasting) / spacing, `${tile.id} column`);
  const row0 = roundedInteger((extent.maxNorthing - tile.bounds.maxNorthing) / spacing, `${tile.id} row`);
  const pixelMetres = spacing / oversample;
  const sourceColumn0 = column0 * oversample;
  const sourceRow0 = row0 * oversample;
  const sourceWidth = (tile.width - 1) * oversample + 1;
  const sourceHeight = (tile.height - 1) * oversample + 1;
  const clampHalo = Math.ceil(SURFACE_SDF_DISTANCE_LIMIT_METRES / pixelMetres) + 1;
  const ringHalo = Math.ceil(RING_LIMIT_METRES / pixelMetres) + 1;

  const distancesMetres = channels.map(() => new Float32Array(count));
  const ringDistancesMetres = new Float32Array(count);
  const routeDistancesMetres = new Float32Array(count);
  const ownerIds = new Uint8Array(count);
  const sampleClass = new Uint8Array(count);
  for (let row = 0; row < tile.height; row++) {
    for (let column = 0; column < tile.width; column++) {
      const target = row * tile.width + column;
      const coarse = (row0 + row) * extent.width + column0 + column;
      if (coarse < 0 || coarse >= raster.classes.length) throw new Error(`${tile.id} slice escapes the preview raster`);
      const route = raster.routeDistance[coarse];
      routeDistancesMetres[target] = route >= 1e19 ? Infinity : route;
      const owner = raster.owner[coarse];
      if (owner > 255) throw new Error(`${tile.id} owner ${owner} does not fit the u8 hole channel`);
      ownerIds[target] = owner;
      const fine = (sourceRow0 + row * oversample) * source.bounds.w + sourceColumn0 + column * oversample;
      if (fine < 0 || fine >= source.classes.length) throw new Error(`${tile.id} slice escapes the source mask`);
      sampleClass[target] = source.classes[fine];
    }
  }

  for (let channel = 0; channel < channels.length; channel++) {
    const id = channels[channel];
    const ringClass = RING_CLASSES.includes(id);
    const halo = ringClass ? ringHalo : clampHalo;
    const window = extractWindow(source.classes, source.bounds.w, source.bounds.h, {
      column0: sourceColumn0 - halo,
      row0: sourceRow0 - halo,
      column1: sourceColumn0 + sourceWidth - 1 + halo,
      row1: sourceRow0 + sourceHeight - 1 + halo,
    });
    const mask = new Uint8Array(window.data.length);
    let any = false;
    for (let index = 0; index < mask.length; index++) {
      if (window.data[index] === id) { mask[index] = 1; any = true; }
    }
    const field = any
      ? signedDistanceField(mask, window.width, window.height, { pixelMetres })
      : null;
    const out = distancesMetres[channel];
    for (let row = 0; row < tile.height; row++) {
      for (let column = 0; column < tile.width; column++) {
        const target = row * tile.width + column;
        const value = field
          ? field[(sourceRow0 + row * oversample - window.row0) * window.width +
                  (sourceColumn0 + column * oversample - window.column0)]
          : -SURFACE_SDF_DISTANCE_LIMIT_METRES;
        out[target] = value;
        if (sampleClass[target] === id) {
          /* A ring class keeps its full inside distance; any other class's
             ring byte is the same clamped distance the SDF stores. */
          ringDistancesMetres[target] = ringClass
            ? Math.min(RING_LIMIT_METRES, Math.max(0, value))
            : Math.min(SURFACE_SDF_DISTANCE_LIMIT_METRES, Math.max(0, value));
        }
      }
    }
  }
  return encodeSurfaceSdfGrid({
    channels,
    distancesMetres,
    routeDistancesMetres,
    ringDistancesMetres,
    ownerIds,
    width: tile.width,
    height: tile.height,
    sampleSpacingMetres: spacing,
  });
}

function surfaceChunk({ groundId, tile, encoded, assetDirectory, codec, representation }) {
  const sdf = representation === 'class-sdf-v1';
  const chunk = writeChunk({
    header: {
      schemaVersion: 2,
      id: tile.id,
      kind: 'surface',
      owner: { type: 'ground', id: groundId },
      bounds: tile.bounds,
      payloadFormat: sdf ? SURFACE_SDF_PAYLOAD_FORMAT : 'surface-grid-u8-i16-le-v1',
      requiredFeatures: sdf ? [...SURFACE_SDF_FEATURES] : [...SURFACE_FEATURES],
      ...(sdf ? { surfaceSdf: encoded.surfaceSdf } : { surfaceGrid: encoded.surfaceGrid }),
    },
    payload: encoded.payload,
    codec,
  });
  const reference = assetReferenceForChunk(chunk, { kind: 'surface', directory: assetDirectory });
  verifyChunkAsset(reference, chunk);
  return Object.freeze({ chunk, reference, encoded });
}

/**
 * Compile a regular terrain-preview frontier into matching 1 m surface tiles.
 * The input feature set is deliberately external: callers must declare the
 * provenance of their vectors in the resulting preview descriptor.
 */
export function compileSurfacePreviewAssets({
  groundId: requestedGroundId,
  frame: requestedFrame,
  legacyBridge,
  terrainTiles,
  holes = [],
  features = [],
  assetDirectory,
  codec = 'deflate-raw',
  mowCoordinateMode = 'legacy-route',
  boundaryOversample = 1,
  representation = 'pair-sdf-v1',
} = {}) {
  const groundId = id(requestedGroundId, 'groundId');
  const frame = previewFrame(requestedFrame);
  const bridge = previewBridge(legacyBridge);
  if (!SURFACE_REPRESENTATIONS.includes(representation)) {
    throw new TypeError(`representation must be one of ${SURFACE_REPRESENTATIONS.join(', ')}`);
  }
  /* Which coordinate a fragment must present to read this raster. A zero
     bridge means the features were already canonical EPSG:3006 offsets from
     the frame origin; anything else is the legacy pack world, translated. */
  const samplingFrame = bridge.translateX === 0 && bridge.translateZ === 0 ? 'canonical' : 'legacy-bridge';
  const tiles = normalizeTiles(terrainTiles);
  if (!Array.isArray(holes) || !Array.isArray(features)) {
    throw new TypeError('holes and features must be arrays');
  }
  if (!['legacy-route', 'unmeasured-zero'].includes(mowCoordinateMode)) {
    throw new TypeError('mowCoordinateMode must be legacy-route or unmeasured-zero');
  }
  if (![1, 2, 4].includes(boundaryOversample)) {
    throw new TypeError('boundaryOversample must be 1, 2, or 4');
  }
  const spacing = tiles[0].sampleSpacingMetres;
  if (!tiles.every(tile => near(tile.sampleSpacingMetres, spacing))) {
    throw new Error('surface preview terrain tiles must have a common sample spacing');
  }
  const extent = previewExtent(tiles, spacing);
  assertRegularTerrainFrontier(tiles, extent, spacing);
  const globalBounds = worldBounds({
    minEasting: extent.minEasting,
    minNorthing: extent.minNorthing,
    maxEasting: extent.maxEasting,
    maxNorthing: extent.maxNorthing,
  }, frame, bridge);
  const raster = rasterizeGroundAtlas({
    /* Raster samples are at texel centres. The half-cell expansion places those
       centres exactly on the north-up terrain-grid vertices. */
    CORE: {
      x0: globalBounds.x0 - spacing * 0.5,
      x1: globalBounds.x1 + spacing * 0.5,
      z0: globalBounds.z0 - spacing * 0.5,
      z1: globalBounds.z1 + spacing * 0.5,
    },
    HOLES: holes,
    features,
    res: spacing,
  });
  if (raster.bounds.w !== extent.width || raster.bounds.h !== extent.height) {
    throw new Error('surface preview raster dimensions do not match the terrain frontier');
  }
  const boundarySpacing = spacing / boundaryOversample;
  const boundaryRaster = boundaryOversample === 1 ? Object.freeze({
    bounds: raster.bounds,
    classes: raster.classes,
    boundaryDistance: Float32Array.from(raster.signedDistance, Math.abs),
    boundaryNeighbour: Uint8Array.from(raster.idData, (_, index) => {
      const sample = Math.floor(index / 2);
      const current = raster.classes[sample];
      const primary = raster.idData[sample * 2];
      const secondary = raster.idData[sample * 2 + 1];
      return index % 2 === 0 ? (primary === current ? secondary : primary) : 0;
    }).filter((_, index) => index % 2 === 0),
  }) : rasterizeGroundAtlas({
    CORE: {
      x0: globalBounds.x0 - boundarySpacing * 0.5,
      x1: globalBounds.x1 + boundarySpacing * 0.5,
      z0: globalBounds.z0 - boundarySpacing * 0.5,
      z1: globalBounds.z1 + boundarySpacing * 0.5,
    },
    HOLES: holes,
    features,
    res: boundarySpacing,
    boundaryOnly: true,
  });
  if (boundaryRaster.bounds.w !== (extent.width - 1) * boundaryOversample + 1 ||
      boundaryRaster.bounds.h !== (extent.height - 1) * boundaryOversample + 1) {
    throw new Error('supersampled boundary raster dimensions do not match the terrain frontier');
  }

  /* The per-class path takes its distances from the resolved partition at the
     source oversample and never from the chamfer: the 1 m raster above still
     supplies route, owner and the class cross-check. */
  const sdf = representation === 'class-sdf-v1';
  let source = null;
  let channels = null;
  const sourceSpacing = spacing / SDF_SOURCE_OVERSAMPLE;
  if (sdf) {
    source = rasterizeGroundAtlas({
      CORE: {
        x0: globalBounds.x0 - sourceSpacing * 0.5,
        x1: globalBounds.x1 + sourceSpacing * 0.5,
        z0: globalBounds.z0 - sourceSpacing * 0.5,
        z1: globalBounds.z1 + sourceSpacing * 0.5,
      },
      HOLES: holes,
      features,
      res: sourceSpacing,
      classesOnly: true,
    });
    if (source.bounds.w !== (extent.width - 1) * SDF_SOURCE_OVERSAMPLE + 1 ||
        source.bounds.h !== (extent.height - 1) * SDF_SOURCE_OVERSAMPLE + 1) {
      throw new Error('per-class source mask dimensions do not match the terrain frontier');
    }
    /* The palette is every non-rough class the source mask contains, in
       registry order, and it is the same for every tile of the compilation. */
    const present = new Uint8Array(256);
    for (const value of source.classes) present[value] = 1;
    channels = [];
    for (let value = 1; value < 255; value++) if (present[value]) channels.push(value);
    if (!channels.length) throw new Error('per-class compilation found no non-rough class in the source mask');
  }

  const directory = assetDirectory || `grounds/${groundId}/surface`;
  const resources = new Map();
  const tilesOut = [];
  const positiveCounts = sdf ? new Uint32Array(channels.length) : null;
  let roughCount = 0;
  for (const tile of tiles) {
    const encoded = sdf
      ? tileSdfPayload({ raster, source, oversample: SDF_SOURCE_OVERSAMPLE, tile, extent, spacing, channels })
      : tilePayload({
        raster, boundaryRaster, boundaryOversample, tile, extent, spacing, mowCoordinateMode,
      });
    if (sdf) {
      for (let channel = 0; channel < channels.length; channel++) positiveCounts[channel] += encoded.positiveCounts[channel];
      roughCount += encoded.roughCount;
    }
    const asset = surfaceChunk({ groundId, tile, encoded, assetDirectory: directory, codec, representation });
    const prior = resources.get(asset.reference.url);
    if (prior && !Buffer.from(prior).equals(Buffer.from(asset.chunk))) {
      throw new Error(`content-address collision for ${asset.reference.url}`);
    }
    resources.set(asset.reference.url, asset.chunk);
    tilesOut.push(Object.freeze({ id: tile.id, reference: asset.reference, bounds: tile.bounds }));
  }
  const encodedBytes = [...resources.values()].reduce((sum, resource) => sum + resource.byteLength, 0);
  const decodedBytes = tilesOut.reduce((sum, tile) => sum + tile.reference.decodedBytes, 0);
  if (decodedBytes > 32 * 1024 * 1024) {
    throw new RangeError('surface preview exceeds the 32 MiB active decoded-byte budget');
  }
  return Object.freeze({
    groundId,
    frameFingerprint: frame.fingerprint,
    representation,
    samplingFrame,
    channels: sdf ? Object.freeze([...channels]) : null,
    terrainTiles: tiles,
    tiles: Object.freeze(tilesOut),
    resources,
    stats: Object.freeze({
      representation,
      samplingFrame,
      tileChunks: tilesOut.length,
      encodedBytes,
      decodedBytes,
      sampleSpacingMetres: spacing,
      previewWidth: extent.width,
      previewHeight: extent.height,
      maximumBoundaryDistanceMetres: sdf ? SURFACE_SDF_DISTANCE_LIMIT_METRES : EDGE_DISTANCE_LIMIT_METRES,
      boundarySampleSpacingMetres: sdf ? sourceSpacing : boundarySpacing,
      mowCoordinateMode: sdf ? 'route-and-ring' : mowCoordinateMode,
      channels: sdf ? [...channels] : null,
      channelInsideCounts: sdf ? Array.from(positiveCounts) : null,
      roughCount: sdf ? roughCount : null,
    }),
  });
}

export function createSurfacePreviewDescriptor(compilation, {
  label = 'Migrerade ytor',
  terrainDescriptorSha256,
  packSha256,
} = {}) {
  if (!(compilation?.resources instanceof Map) || !Array.isArray(compilation.tiles)) {
    throw new TypeError('a surface asset compilation is required');
  }
  sha256(terrainDescriptorSha256, 'terrainDescriptorSha256');
  sha256(packSha256, 'packSha256');
  const tiles = compilation.tiles
    .map(tile => Object.freeze({ id: tile.id, reference: tile.reference }))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const tile of tiles) {
    if (!compilation.resources.has(tile.reference.url)) {
      throw new Error(`surface compilation is missing ${tile.reference.url}`);
    }
  }
  return Object.freeze(assertSurfacePreview({
    schemaVersion: 1,
    kind: SURFACE_PREVIEW_KIND,
    provisional: true,
    provisionalReason: SURFACE_PREVIEW_PROVISIONAL_REASON,
    label,
    terrainDescriptorSha256,
    frameFingerprint: compilation.frameFingerprint,
    representation: compilation.representation,
    samplingFrame: compilation.samplingFrame,
    source: {
      kind: SURFACE_PREVIEW_SOURCE_KIND,
      packSha256,
    },
    /* These channels are contractually present but remain zero until a source
       with measured/approved values is available. */
    unmeasuredFields: ['exposure', 'moisture', 'vegetation-density', 'wear'],
    tiles,
  }));
}

function resourceTarget(outputRoot, relativeUrl) {
  const target = resolve(outputRoot, relativeUrl);
  if (target !== outputRoot && !target.startsWith(`${outputRoot}${sep}`)) {
    throw new Error(`surface resource escapes output directory: ${relativeUrl}`);
  }
  return target;
}

async function writeImmutable(target, data, label) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, data, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (!existing.equals(Buffer.from(data))) {
      throw new Error(`refusing to replace non-matching immutable ${label} ${target}`);
    }
  }
}

export async function writeSurfacePreviewBundle(outputDirectory, compilation, options = {}) {
  if (typeof outputDirectory !== 'string' || !outputDirectory) {
    throw new TypeError('outputDirectory must be a non-empty string');
  }
  const outputRoot = resolve(outputDirectory);
  const descriptor = createSurfacePreviewDescriptor(compilation, options);
  const writtenAssets = [];
  for (const [relativeUrl, data] of [...compilation.resources].sort(([left], [right]) => left.localeCompare(right))) {
    const target = resourceTarget(outputRoot, relativeUrl);
    await writeImmutable(target, data, 'surface asset');
    writtenAssets.push(target);
  }
  const descriptorName = options.fileName || 'surface-preview.json';
  if (descriptorName.includes('/') || descriptorName.includes('\\')) {
    throw new Error('surface preview descriptor must stay at the output root');
  }
  const descriptorPath = resolve(outputRoot, descriptorName);
  const descriptorBytes = Buffer.from(`${canonicalJson(descriptor)}\n`, 'utf8');
  await writeImmutable(descriptorPath, descriptorBytes, 'surface preview descriptor');
  return Object.freeze({ descriptor, descriptorPath, writtenAssets: Object.freeze(writtenAssets) });
}
