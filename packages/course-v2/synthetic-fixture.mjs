import { canonicalJsonBytes } from './canonical-json.mjs';
import {
  assetReferenceForChunk,
  sha256Bytes,
  writeCanonicalJsonChunk,
  writeChunk,
} from './chunk-node.mjs';
import {
  V2_COURSE_MEDIA_TYPE,
  V2_GROUND_MEDIA_TYPE,
} from './schema.mjs';
import { encodeTerrainGrid } from './terrain-grid.mjs';

const HASH_A = sha256Bytes(new TextEncoder().encode('synthetic v1 main fallback'));
const HASH_B = sha256Bytes(new TextEncoder().encode('synthetic v1 short fallback'));
const SOURCE_HASH = sha256Bytes(new TextEncoder().encode('synthetic source manifest'));
const FRAME_HASH = sha256Bytes(new TextEncoder().encode('synthetic approved frame'));

function terrainBounds(minEasting, minNorthing, size, minHeightRH2000, maxHeightRH2000) {
  return {
    minEasting,
    minNorthing,
    minHeightRH2000,
    maxEasting: minEasting + size,
    maxNorthing: minNorthing + size,
    maxHeightRH2000,
  };
}

function addChunk(resources, chunk, kind) {
  const reference = assetReferenceForChunk(chunk, { kind, directory: `assets/${kind}` });
  resources.set(reference.url, chunk);
  return reference;
}

function terrainChunk(resources, { id, bounds, heights, width, height, spacing, geometricError }) {
  const encoded = encodeTerrainGrid({ heights, width, height, heightScaleMetres: 0.01 });
  const chunk = writeChunk({
    header: {
      schemaVersion: 2,
      id,
      kind: 'terrain',
      owner: { type: 'ground', id: 'synthetic-ground' },
      bounds: {
        ...bounds,
        minHeightRH2000: encoded.minHeightRH2000,
        maxHeightRH2000: encoded.maxHeightRH2000,
      },
      payloadFormat: 'terrain-grid-u16-le-v1',
      requiredFeatures: ['chunk-envelope-v2', 'terrain-grid-u16-v1'],
      grid: {
        ...encoded.grid,
        sampleSpacingMetres: spacing,
        geometricErrorMetres: geometricError,
      },
    },
    payload: encoded.payload,
  });
  const reference = addChunk(resources, chunk, 'terrain');
  return {
    reference,
    bounds: {
      ...bounds,
      minHeightRH2000: encoded.minHeightRH2000,
      maxHeightRH2000: encoded.maxHeightRH2000,
    },
  };
}

function routingChunk(resources, slug, holes, bounds) {
  const value = { schemaVersion: 1, courseSlug: slug, holes };
  const chunk = writeCanonicalJsonChunk({
    header: {
      schemaVersion: 2,
      id: `${slug}-routing`,
      kind: 'routing',
      owner: { type: 'course', id: slug },
      bounds,
      payloadFormat: 'json-canonical-v1',
      requiredFeatures: ['chunk-envelope-v2', 'course-routing-json-v1'],
      records: { content: 'course-routing', count: holes.length },
    },
    value,
  });
  return addChunk(resources, chunk, 'routing');
}

function addManifest(resources, document, { directory, name, mediaType }) {
  const data = Buffer.from(canonicalJsonBytes(document));
  const sha256 = sha256Bytes(data);
  const reference = {
    url: `${directory}/${name}-${sha256}.json`,
    mediaType,
    bytes: data.byteLength,
    sha256,
  };
  resources.set(reference.url, data);
  return reference;
}

function fallback(slug, sha256) {
  return { format: 1, packUrl: `courses/${slug}/pack.bin`, bytes: 4096, sha256 };
}

export function createSyntheticAssetGraph() {
  const resources = new Map();
  const shell = terrainChunk(resources, {
    id: 'shell',
    bounds: terrainBounds(650000, 6640000, 256, 20, 23),
    heights: [20, 20.5, 21, 21.5, 22, 22.5, 23, 22.5, 22],
    width: 3,
    height: 3,
    spacing: 128,
    geometricError: 4,
  });
  const tileA = terrainChunk(resources, {
    id: 'l0/0/0',
    bounds: terrainBounds(650000, 6640000, 128, 20, 22),
    heights: [20, 20.2, 20.4, 20.1, 20.5, 21, 20.3, 21.2, 22],
    width: 3,
    height: 3,
    spacing: 64,
    geometricError: 0.25,
  });
  const tileB = terrainChunk(resources, {
    id: 'l0/1/0',
    bounds: terrainBounds(650128, 6640000, 128, 21, 23),
    heights: [21, 21.2, 21.4, 21.1, 21.5, 22, 21.3, 22.2, 23],
    width: 3,
    height: 3,
    spacing: 64,
    geometricError: 0.25,
  });
  const groundBounds = {
    minEasting: 650000,
    minNorthing: 6640000,
    minHeightRH2000: shell.bounds.minHeightRH2000,
    maxEasting: 650256,
    maxNorthing: 6640256,
    maxHeightRH2000: shell.bounds.maxHeightRH2000,
  };
  const ground = {
    $schema: '../../../packages/course-v2/schemas/ground-v2.schema.json',
    schemaVersion: 2,
    groundFormat: 2,
    groundId: 'synthetic-ground',
    requiredFeatures: ['chunk-envelope-v2', 'terrain-grid-u16-v1'],
    frame: {
      compoundCrs: 'EPSG:5845',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      origin: { easting: 650000, northing: 6640256, heightRH2000: 20 },
      axisMapping: {
        worldX: 'easting - originEasting',
        worldY: 'heightRH2000 - originHeightRH2000',
        worldZ: 'originNorthing - northing',
      },
      fingerprint: FRAME_HASH,
    },
    bounds: groundBounds,
    sourceManifestSha256: SOURCE_HASH,
    shell: shell.reference,
    tiles: [
      {
        id: 'l0/0/0',
        lod: 0,
        bounds: tileA.bounds,
        geometricErrorMetres: 0.25,
        courses: ['synthetic-main', 'synthetic-short'],
        layers: { terrain: tileA.reference, surface: null, objects: null },
      },
      {
        id: 'l0/1/0',
        lod: 0,
        bounds: tileB.bounds,
        geometricErrorMetres: 0.25,
        courses: ['synthetic-main'],
        layers: { terrain: tileB.reference, surface: null, objects: null },
      },
    ],
  };
  const groundReference = addManifest(resources, ground, {
    directory: 'grounds/synthetic-ground',
    name: 'ground-v2',
    mediaType: V2_GROUND_MEDIA_TYPE,
  });

  const mainFallback = fallback('synthetic-main', HASH_A);
  const shortFallback = fallback('synthetic-short', HASH_B);
  const mainRouting = routingChunk(resources, 'synthetic-main', [
    { number: 1, line: [[650010, 6640010, 20.1], [650080, 6640080, 21.1]] },
    { number: 2, line: [[650140, 6640020, 21.2], [650230, 6640100, 22.8]] },
  ], groundBounds);
  const shortRouting = routingChunk(resources, 'synthetic-short', [
    { number: 1, line: [[650020, 6640020, 20.2], [650090, 6640090, 21.2]] },
  ], groundBounds);

  const commonCourse = {
    $schema: '../../../packages/course-v2/schemas/course-v2.schema.json',
    schemaVersion: 2,
    courseFormat: 2,
    groundFormat: 2,
    groundId: 'synthetic-ground',
    requiredFeatures: ['chunk-envelope-v2', 'course-routing-json-v1', 'terrain-grid-u16-v1'],
    groundManifest: groundReference,
  };
  const mainCourse = {
    ...commonCourse,
    slug: 'synthetic-main',
    routing: mainRouting,
    holes: [
      { number: 1, par: 4, strokeIndex: null, strokeIndexStatus: 'unverified', tileIds: ['l0/0/0'], accuracyTier: 'unrated' },
      { number: 2, par: 4, strokeIndex: null, strokeIndexStatus: 'unverified', tileIds: ['l0/1/0'], accuracyTier: 'unrated' },
    ],
    fallbackV1: mainFallback,
  };
  const shortCourse = {
    ...commonCourse,
    slug: 'synthetic-short',
    routing: shortRouting,
    holes: [
      { number: 1, par: 3, strokeIndex: null, strokeIndexStatus: 'not-applicable', tileIds: ['l0/0/0'], accuracyTier: 'unrated' },
    ],
    fallbackV1: shortFallback,
  };
  const mainReference = addManifest(resources, mainCourse, {
    directory: 'courses/synthetic-main', name: 'course-v2', mediaType: V2_COURSE_MEDIA_TYPE,
  });
  const shortReference = addManifest(resources, shortCourse, {
    directory: 'courses/synthetic-short', name: 'course-v2', mediaType: V2_COURSE_MEDIA_TYPE,
  });
  const root = {
    $schema: '../../packages/course-v2/schemas/root-v2.schema.json',
    schemaVersion: 2,
    courses: [
      {
        slug: 'synthetic-main',
        name: 'Synthetic Main',
        groundId: 'synthetic-ground',
        courseFormat: 2,
        groundFormat: 2,
        manifest: mainReference,
        fallbackV1: mainFallback,
      },
      {
        slug: 'synthetic-short',
        name: 'Synthetic Short',
        groundId: 'synthetic-ground',
        courseFormat: 2,
        groundFormat: 2,
        manifest: shortReference,
        fallbackV1: shortFallback,
      },
    ],
  };
  return { root, resources };
}

