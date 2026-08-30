import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { writeTerrainAssetFiles } from './terrain-compiler-node.mjs';
import {
  TERRAIN_PREVIEW_KIND,
  TERRAIN_PREVIEW_PROVISIONAL_REASON,
  assertTerrainPreview,
} from './terrain-preview.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function finiteBounds(bounds) {
  const fields = [
    'minEasting', 'minNorthing', 'minHeightRH2000',
    'maxEasting', 'maxNorthing', 'maxHeightRH2000',
  ];
  if (!bounds || !fields.every(field => Number.isFinite(bounds[field]))) {
    throw new TypeError('terrain compilation bounds are invalid');
  }
  return Object.freeze(Object.fromEntries(fields.map(field => [field, bounds[field]])));
}

function previewFrame(bounds) {
  const frame = {
    compoundCrs: 'EPSG:5845',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613',
    origin: {
      easting: (bounds.minEasting + bounds.maxEasting) / 2,
      northing: (bounds.minNorthing + bounds.maxNorthing) / 2,
      heightRH2000: Math.floor(bounds.minHeightRH2000 * 100) / 100,
    },
    axisMapping: {
      worldX: 'easting - originEasting',
      worldY: 'heightRH2000 - originHeightRH2000',
      worldZ: 'originNorthing - northing',
    },
  };
  return Object.freeze({ ...frame, fingerprint: sha256(canonicalJson(frame)) });
}

function previewCamera(bounds, origin) {
  const spanEasting = bounds.maxEasting - bounds.minEasting;
  const spanNorthing = bounds.maxNorthing - bounds.minNorthing;
  const span = Math.max(spanEasting, spanNorthing);
  const centreHeight = (bounds.minHeightRH2000 + bounds.maxHeightRH2000) / 2 - origin.heightRH2000;
  const relief = bounds.maxHeightRH2000 - bounds.minHeightRH2000;
  return Object.freeze({
    position: Object.freeze([span * 0.58, Math.max(span * 0.32, relief * 5 + 60), span * 0.62]),
    target: Object.freeze([0, centreHeight, 0]),
    fovDegrees: 43,
    nearMetres: Math.max(0.5, span / 4000),
    farMetres: Math.max(2000, span * 4),
  });
}

export function createTerrainPreviewDescriptor(compilation, { label = 'Terrängpilot' } = {}) {
  if (!(compilation?.resources instanceof Map) || !Array.isArray(compilation.tiles)) {
    throw new TypeError('a terrain asset compilation is required');
  }
  const bounds = finiteBounds(compilation.bounds);
  const finestLod = Math.min(...compilation.tiles.map(tile => tile.lod));
  const tiles = compilation.tiles
    .filter(tile => tile.lod === finestLod)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(tile => Object.freeze({ id: tile.id, reference: tile.layers.terrain }));
  if (!tiles.length) throw new Error('terrain compilation has no previewable finest-level tiles');
  for (const tile of tiles) {
    if (!compilation.resources.has(tile.reference.url)) {
      throw new Error(`terrain compilation is missing ${tile.reference.url}`);
    }
  }
  const frame = previewFrame(bounds);
  return Object.freeze(assertTerrainPreview({
    schemaVersion: 1,
    kind: TERRAIN_PREVIEW_KIND,
    provisional: true,
    provisionalReason: TERRAIN_PREVIEW_PROVISIONAL_REASON,
    label,
    frame,
    bounds,
    camera: previewCamera(bounds, frame.origin),
    tiles: Object.freeze(tiles),
  }));
}

async function writeImmutableJson(target, value) {
  const bytes = canonicalJson(value) + '\n';
  try {
    await writeFile(target, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(target, 'utf8');
    if (existing !== bytes) throw new Error(`refusing to replace non-matching preview descriptor ${target}`);
  }
}

/** Persist ephemeral proof inputs; callers choose separately what may be uploaded. */
export async function writeTerrainPreviewBundle(outputDirectory, compilation, options = {}) {
  if (typeof outputDirectory !== 'string' || !outputDirectory) {
    throw new TypeError('outputDirectory must be a non-empty string');
  }
  const outputRoot = resolve(outputDirectory);
  const descriptor = createTerrainPreviewDescriptor(compilation, options);
  const writtenAssets = await writeTerrainAssetFiles(outputRoot, compilation);
  const descriptorPath = join(outputRoot, options.fileName || 'preview.json');
  if (dirname(descriptorPath) !== outputRoot) throw new Error('preview descriptor must stay at the output root');
  await writeImmutableJson(descriptorPath, descriptor);
  return Object.freeze({ descriptor, descriptorPath, writtenAssets });
}
