import { canonicalJson } from './canonical-json.mjs';
import { sha256Bytes, verifyChunkAsset } from './chunk-node.mjs';
import {
  V2_COURSE_MEDIA_TYPE,
  V2_GROUND_MEDIA_TYPE,
  assertSupported,
  assertValid,
  validateCourseManifest,
  validateGroundManifest,
  validateRootIndex,
} from './schema.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function manifestResource(reference, resources, label, validate, mediaType) {
  if (reference.mediaType !== mediaType) throw new Error(`${label} has the wrong media type`);
  const source = resources.get(reference.url);
  if (!source) throw new Error(`${label} is missing resource ${reference.url}`);
  const data = bytes(source, label);
  if (data.byteLength !== reference.bytes) throw new Error(`${label} byte size does not match its reference`);
  if (sha256Bytes(data) !== reference.sha256) throw new Error(`${label} SHA-256 does not match its reference`);
  const text = decoder.decode(data);
  let document;
  try { document = JSON.parse(text); }
  catch (error) { throw new Error(`${label} is not JSON: ${error.message}`); }
  if (canonicalJson(document) !== text) throw new Error(`${label} is not canonical JSON`);
  assertValid(label, validate(document));
  return document;
}

function collectAsset(reference, state, label, expectations = {}) {
  state.usedResources.add(reference.url);
  let chunk = state.chunks.get(reference.url);
  if (!chunk) {
    const resource = state.resources.get(reference.url);
    if (!resource) throw new Error(`${label} is missing chunk ${reference.url}`);
    chunk = verifyChunkAsset(reference, resource, { supportedFeatures: state.supportedFeatures });
    state.chunks.set(reference.url, chunk);
  } else if (chunk.header.decodedSha256 !== reference.decodedSha256 ||
             chunk.header.kind !== reference.kind) {
    throw new Error(`${label} reuses one chunk URL with conflicting metadata`);
  }
  const { header } = chunk;
  if (expectations.ownerType && header.owner.type !== expectations.ownerType) {
    throw new Error(`${label} owner type does not match`);
  }
  if (expectations.ownerId && header.owner.id !== expectations.ownerId) {
    throw new Error(`${label} owner id does not match`);
  }
  if (expectations.id && header.id !== expectations.id) throw new Error(`${label} id does not match`);
  if (expectations.bounds && !same(header.bounds, expectations.bounds)) {
    throw new Error(`${label} bounds do not match the manifest`);
  }
  return chunk;
}

function validateRoutingChunk(chunk, course, label) {
  if (chunk.header.kind !== 'routing' || chunk.header.records.content !== 'course-routing') {
    throw new Error(`${label} is not a course-routing chunk`);
  }
  if (chunk.content?.schemaVersion !== 1 || chunk.content?.courseSlug !== course.slug ||
      !Array.isArray(chunk.content?.holes)) {
    throw new Error(`${label} routing payload identity does not match the course`);
  }
  if (chunk.content.holes.length !== course.holes.length) {
    throw new Error(`${label} routing hole count does not match the course manifest`);
  }
  chunk.content.holes.forEach((hole, index) => {
    if (hole?.number !== course.holes[index].number || !Array.isArray(hole?.line) || hole.line.length < 2) {
      throw new Error(`${label} has invalid routing for hole ${index + 1}`);
    }
    hole.line.forEach((point, pointIndex) => {
      if (!Array.isArray(point) || point.length !== 3 || point.some(value => !Number.isFinite(value))) {
        throw new Error(`${label} hole ${index + 1} point ${pointIndex} must be [easting,northing,heightRH2000]`);
      }
    });
  });
}

function validateSurfaceChunk(chunk, label) {
  if (chunk.header.kind !== 'surface' ||
      !['surface-grid-u8-i16-le-v1', 'surface-sdf-u8-v1'].includes(chunk.header.payloadFormat) ||
      !chunk.inspection || chunk.inspection.validCount < 1) {
    throw new Error(`${label} is not a classified surface-grid chunk`);
  }
}

function validateObjectChunk(chunk, groundId, tileId, label) {
  if (chunk.header.kind !== 'objects' || chunk.header.records.content !== 'object-registry' ||
      chunk.content?.schemaVersion !== 1 || chunk.content?.groundId !== groundId ||
      chunk.content?.tileId !== tileId || !Array.isArray(chunk.content?.records) || !chunk.inspection) {
    throw new Error(`${label} is not an object-registry chunk for its ground tile`);
  }
}

export function verifyAssetGraph({ root, resources, supportedFeatures, strictResources = true }) {
  assertValid('v2 root index', validateRootIndex(root));
  if (!(resources instanceof Map)) throw new TypeError('resources must be a Map keyed by relative URL');
  const state = {
    resources,
    supportedFeatures,
    usedResources: new Set(),
    chunks: new Map(),
    courseManifests: new Map(),
    groundManifests: new Map(),
    groundReferences: new Map(),
  };

  for (const entry of root.courses) {
    state.usedResources.add(entry.manifest.url);
    let course = state.courseManifests.get(entry.manifest.url);
    if (!course) {
      course = manifestResource(entry.manifest, resources, `course ${entry.slug}`, validateCourseManifest, V2_COURSE_MEDIA_TYPE);
      state.courseManifests.set(entry.manifest.url, course);
    }
    if (course.slug !== entry.slug || course.groundId !== entry.groundId ||
        course.courseFormat !== entry.courseFormat || course.groundFormat !== entry.groundFormat) {
      throw new Error(`course ${entry.slug} identity does not match the root index`);
    }
    if (!same(course.fallbackV1, entry.fallbackV1)) {
      throw new Error(`course ${entry.slug} v1 fallback does not match the root index`);
    }
    assertSupported(`course ${entry.slug}`, course.requiredFeatures, supportedFeatures);

    const routing = collectAsset(course.routing, state, `course ${entry.slug} routing`, {
      ownerType: 'course', ownerId: entry.slug,
    });
    validateRoutingChunk(routing, course, `course ${entry.slug} routing`);

    const priorGroundReference = state.groundReferences.get(entry.groundId);
    if (priorGroundReference && !same(priorGroundReference, course.groundManifest)) {
      throw new Error(`ground ${entry.groundId} is referenced with conflicting manifests`);
    }
    state.groundReferences.set(entry.groundId, course.groundManifest);
    state.usedResources.add(course.groundManifest.url);
    let ground = state.groundManifests.get(course.groundManifest.url);
    if (!ground) {
      ground = manifestResource(course.groundManifest, resources, `ground ${entry.groundId}`, validateGroundManifest, V2_GROUND_MEDIA_TYPE);
      state.groundManifests.set(course.groundManifest.url, ground);
      if (ground.groundId !== entry.groundId || ground.groundFormat !== entry.groundFormat) {
        throw new Error(`ground ${entry.groundId} identity does not match the course`);
      }
      assertSupported(`ground ${entry.groundId}`, ground.requiredFeatures, supportedFeatures);
      collectAsset(ground.shell, state, `ground ${entry.groundId} shell`, {
        ownerType: 'ground', ownerId: entry.groundId, id: 'shell', bounds: ground.bounds,
      });
      const tilesById = new Map(ground.tiles.map(tile => [tile.id, tile]));
      for (const tile of ground.tiles) {
        if (typeof tile.parentId === 'string') {
          const parent = tilesById.get(tile.parentId);
          const holds = parent && parent.lod === tile.lod + 1 &&
            parent.bounds.minEasting <= tile.bounds.minEasting + 1e-6 &&
            parent.bounds.maxEasting >= tile.bounds.maxEasting - 1e-6 &&
            parent.bounds.minNorthing <= tile.bounds.minNorthing + 1e-6 &&
            parent.bounds.maxNorthing >= tile.bounds.maxNorthing - 1e-6;
          if (!holds) throw new Error(`ground ${entry.groundId} tile ${tile.id} names a parent that does not contain it`);
        }
        const terrain = collectAsset(tile.layers.terrain, state, `ground ${entry.groundId} tile ${tile.id}`, {
          ownerType: 'ground', ownerId: entry.groundId, id: tile.id, bounds: tile.bounds,
        });
        if (terrain.header.grid.geometricErrorMetres !== tile.geometricErrorMetres) {
          throw new Error(`ground ${entry.groundId} tile ${tile.id} geometric error does not match its chunk`);
        }
        for (const kind of ['surface', 'objects', 'stands']) {
          if (!tile.layers[kind]) continue;
          const label = `ground ${entry.groundId} tile ${tile.id} ${kind}`;
          const chunk = collectAsset(tile.layers[kind], state, label, {
            ownerType: 'ground', ownerId: entry.groundId, id: tile.id, bounds: tile.bounds,
          });
          if (kind === 'surface') validateSurfaceChunk(chunk, label);
          else if (kind === 'objects') validateObjectChunk(chunk, entry.groundId, tile.id, label);
          else if (chunk.header.kind !== 'stands' || chunk.header.payloadFormat !== 'stand-field-u8-v1' ||
                   !chunk.inspection || chunk.header.id !== tile.id) {
            throw new Error(`${label} is not a stand field for its tile`);
          }
        }
      }
    } else if (ground.groundId !== entry.groundId) {
      throw new Error(`ground manifest ${course.groundManifest.url} is aliased across ground ids`);
    }

    const tiles = new Map(ground.tiles.map(tile => [tile.id, tile]));
    for (const hole of course.holes) {
      for (const requested of hole.tileIds) {
        const tile = tiles.get(requested);
        if (!tile) throw new Error(`course ${entry.slug} hole ${hole.number} references missing tile ${requested}`);
        if (!tile.courses.includes(entry.slug)) {
          throw new Error(`ground tile ${requested} does not declare course ${entry.slug}`);
        }
      }
    }
  }

  if (strictResources) {
    const unused = [...resources.keys()].filter(url => !state.usedResources.has(url)).sort();
    if (unused.length) throw new Error(`asset graph has unreferenced resources: ${unused.join(', ')}`);
  }
  let encodedChunkBytes = 0;
  let decodedChunkBytes = 0;
  for (const [url, chunk] of state.chunks) {
    encodedChunkBytes += bytes(resources.get(url), url).byteLength;
    decodedChunkBytes += chunk.payload.byteLength;
  }
  return Object.freeze({
    courses: state.courseManifests.size,
    grounds: state.groundManifests.size,
    chunks: state.chunks.size,
    encodedChunkBytes,
    decodedChunkBytes,
    v1Fallbacks: root.courses.length,
  });
}
