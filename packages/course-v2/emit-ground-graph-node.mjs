import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { canonicalJsonBytes } from './canonical-json.mjs';
import {
  assetReferenceForChunk,
  sha256Bytes,
  writeCanonicalJsonChunk,
} from './chunk-node.mjs';
import { verifyAssetGraph } from './graph-node.mjs';
import {
  V2_COURSE_MEDIA_TYPE,
  V2_GROUND_MEDIA_TYPE,
  V2_SCHEMA_VERSION,
  V2_SUPPORTED_FEATURES,
  assertValid,
  validateCourseManifest,
  validateGroundManifest,
  validateRootIndex,
} from './schema.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const STROKE_INDEX_STATUSES = new Set(['verified', 'unverified', 'not-applicable']);

function id(value, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) {
    throw new TypeError(`${label} must be a lowercase kebab-case id`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function sortedFeatures(references) {
  const features = new Set();
  for (const reference of references) {
    for (const feature of reference.requiredFeatures) features.add(feature);
  }
  return Object.freeze([...features].sort());
}

function manifestReference(document, { directory, name, mediaType }, resources) {
  const data = canonicalJsonBytes(document);
  const sha256 = sha256Bytes(data);
  const reference = Object.freeze({
    url: `${directory}/${name}-${sha256}.json`,
    mediaType,
    bytes: data.byteLength,
    sha256,
  });
  resources.set(reference.url, data);
  return reference;
}

/* Hole-to-tile assignment: a finest tile serves a hole when the hole's line,
   densified so no chord skips a corner, passes within bufferMetres of the tile.
   This is a streaming-priority statement, not a measured corridor claim. */
function holeTileIds(line, tiles, bufferMetres) {
  const points = [];
  for (let index = 1; index < line.length; index++) {
    const [easting0, northing0] = line[index - 1];
    const [easting1, northing1] = line[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(easting1 - easting0, northing1 - northing0) / 4));
    for (let step = 0; step < steps; step++) {
      points.push([
        easting0 + (easting1 - easting0) * (step / steps),
        northing0 + (northing1 - northing0) * (step / steps),
      ]);
    }
  }
  points.push([...line.at(-1)]);
  const ids = new Set();
  for (const tile of tiles) {
    const west = tile.bounds.minEasting - bufferMetres;
    const east = tile.bounds.maxEasting + bufferMetres;
    const south = tile.bounds.minNorthing - bufferMetres;
    const north = tile.bounds.maxNorthing + bufferMetres;
    if (points.some(([easting, northing]) =>
      easting >= west && easting <= east && northing >= south && northing <= north)) {
      ids.add(tile.id);
    }
  }
  return Object.freeze([...ids].sort());
}

function routingChunkFor({ slug, holes, bounds }) {
  return writeCanonicalJsonChunk({
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
    value: {
      schemaVersion: 1,
      courseSlug: slug,
      holes: holes.map(hole => ({ number: hole.number, line: hole.line })),
    },
  });
}

/**
 * Deterministically assemble a publishable v2 asset graph for one physical
 * ground and one course from an already verified terrain compilation. Every
 * output is content-addressed, canonical and self-verified through the same
 * verifyAssetGraph gate the synthetic contract uses; the returned resources
 * are exactly the bytes a host must serve, keyed by app-base-relative URL.
 */
export function emitGroundGraph({
  compilation,
  frame,
  sourceManifestSha256,
  course,
  fallbackV1,
  heightAt,
  holeTileBufferMetres = 80,
} = {}) {
  if (!(compilation?.resources instanceof Map) || !Array.isArray(compilation.tiles) ||
      !compilation.shell || !compilation.bounds) {
    throw new TypeError('a terrain asset compilation is required');
  }
  if (!frame?.fingerprint) throw new TypeError('a fingerprinted ground frame is required');
  if (!SHA256.test(sourceManifestSha256 || '')) {
    throw new TypeError('sourceManifestSha256 must be the ground source-manifest SHA-256');
  }
  if (typeof heightAt !== 'function') throw new TypeError('heightAt must sample the compiled terrain');
  const slug = id(course?.slug, 'course.slug');
  const groundId = id(compilation.groundId, 'compilation.groundId');
  if (typeof course.name !== 'string' || !course.name.trim()) {
    throw new TypeError('course.name is required');
  }
  if (!Array.isArray(course.holes) || !course.holes.length) {
    throw new TypeError('course.holes must be a non-empty array');
  }
  if (!compilation.courseSlugs.includes(slug)) {
    throw new Error(`terrain compilation does not declare course ${slug}`);
  }
  if (!fallbackV1 || fallbackV1.format !== 1 || !SHA256.test(fallbackV1.sha256 || '') ||
      !Number.isSafeInteger(fallbackV1.bytes) || typeof fallbackV1.packUrl !== 'string') {
    throw new TypeError('fallbackV1 must be the exact live GPK1 manifest entry');
  }
  finite(holeTileBufferMetres, 'holeTileBufferMetres');

  const resources = new Map();
  for (const [url, bytes] of compilation.resources) resources.set(url, bytes);

  const finestLod = Math.min(...compilation.tiles.map(tile => tile.lod));
  const finestTiles = compilation.tiles.filter(tile => tile.lod === finestLod);
  const routingHoles = [];
  const manifestHoles = [];
  for (const [index, hole] of course.holes.entries()) {
    const label = `course ${slug} hole ${index + 1}`;
    if (hole?.number !== index + 1) throw new Error(`${label} must be numbered ${index + 1}`);
    if (!Array.isArray(hole.line) || hole.line.length < 2) {
      throw new Error(`${label} needs a routing line with at least two points`);
    }
    if (!STROKE_INDEX_STATUSES.has(hole.strokeIndexStatus)) {
      throw new Error(`${label} has an invalid strokeIndexStatus`);
    }
    const line = hole.line.map(([easting, northing], pointIndex) => {
      finite(easting, `${label} point ${pointIndex} easting`);
      finite(northing, `${label} point ${pointIndex} northing`);
      const heightRH2000 = heightAt(easting, northing);
      if (!Number.isFinite(heightRH2000)) {
        throw new Error(`${label} point ${pointIndex} has no compiled terrain height`);
      }
      return [easting, northing, heightRH2000];
    });
    const tileIds = holeTileIds(line, finestTiles, holeTileBufferMetres);
    if (!tileIds.length) throw new Error(`${label} intersects no finest terrain tile`);
    routingHoles.push({ number: hole.number, line });
    manifestHoles.push({
      number: hole.number,
      par: hole.par,
      strokeIndex: hole.strokeIndex ?? null,
      strokeIndexStatus: hole.strokeIndexStatus,
      tileIds,
      accuracyTier: hole.accuracyTier ?? 'unrated',
    });
  }

  const routingChunk = routingChunkFor({
    slug,
    holes: routingHoles,
    bounds: compilation.bounds,
  });
  const routingReference = assetReferenceForChunk(routingChunk, {
    kind: 'routing',
    directory: `courses/${slug}/routing`,
  });
  resources.set(routingReference.url, routingChunk);

  const groundManifest = {
    $schema: 'packages/course-v2/schemas/ground-v2.schema.json',
    schemaVersion: 2,
    groundFormat: 2,
    groundId,
    requiredFeatures: sortedFeatures([compilation.shell,
      ...compilation.tiles.map(tile => tile.layers.terrain)]),
    frame: {
      compoundCrs: frame.compoundCrs,
      horizontalCrs: frame.horizontalCrs,
      verticalCrs: frame.verticalCrs,
      origin: { ...frame.origin },
      axisMapping: { ...frame.axisMapping },
      fingerprint: frame.fingerprint,
    },
    bounds: { ...compilation.bounds },
    sourceManifestSha256,
    shell: compilation.shell,
    tiles: compilation.tiles.map(tile => ({
      id: tile.id,
      lod: tile.lod,
      bounds: { ...tile.bounds },
      geometricErrorMetres: tile.geometricErrorMetres,
      courses: [...tile.courses],
      layers: { ...tile.layers },
    })),
  };
  assertValid('ground manifest', validateGroundManifest(groundManifest));
  const groundReference = manifestReference(groundManifest, {
    directory: `grounds/${groundId}`,
    name: 'ground-v2',
    mediaType: V2_GROUND_MEDIA_TYPE,
  }, resources);

  const courseManifest = {
    $schema: 'packages/course-v2/schemas/course-v2.schema.json',
    schemaVersion: 2,
    courseFormat: 2,
    groundFormat: 2,
    slug,
    groundId,
    requiredFeatures: sortedFeatures([routingReference, compilation.shell,
      ...compilation.tiles.map(tile => tile.layers.terrain)]),
    groundManifest: groundReference,
    routing: routingReference,
    holes: manifestHoles,
    fallbackV1: { ...fallbackV1 },
  };
  assertValid('course manifest', validateCourseManifest(courseManifest));
  const courseReference = manifestReference(courseManifest, {
    directory: `courses/${slug}`,
    name: 'course-v2',
    mediaType: V2_COURSE_MEDIA_TYPE,
  }, resources);

  const root = {
    $schema: 'packages/course-v2/schemas/root-v2.schema.json',
    schemaVersion: V2_SCHEMA_VERSION,
    courses: [{
      slug,
      name: course.name,
      groundId,
      courseFormat: 2,
      groundFormat: 2,
      manifest: courseReference,
      fallbackV1: { ...fallbackV1 },
    }],
  };
  assertValid('v2 root index', validateRootIndex(root));

  const verification = verifyAssetGraph({
    root,
    resources,
    supportedFeatures: V2_SUPPORTED_FEATURES,
    strictResources: true,
  });
  /* The root is the one mutable file, so it is not content-addressed by name
     and its reported hash must be over exactly the bytes that reach disk.
     Those bytes are canonical JSON with NOTHING appended: the runtime's
     network-first root store re-serialises what it parsed and rejects the
     manifest unless the text matches byte for byte, so a trailing newline —
     the ordinary courtesy for a committed JSON file — makes the published
     root unloadable. Every other manifest in the graph is written through
     canonicalJsonBytes for the same reason. */
  const rootBytes = canonicalJsonBytes(root);
  return Object.freeze({
    root,
    rootBytes,
    resources,
    references: Object.freeze({
      course: courseReference,
      ground: groundReference,
      routing: routingReference,
    }),
    report: Object.freeze({
      slug,
      groundId,
      frameFingerprint: frame.fingerprint,
      rootBytes: rootBytes.byteLength,
      rootSha256: createHash('sha256').update(rootBytes).digest('hex'),
      courseManifestSha256: courseReference.sha256,
      groundManifestSha256: groundReference.sha256,
      routingSha256: routingReference.sha256,
      holes: manifestHoles.length,
      tiles: compilation.tiles.length,
      finestTiles: finestTiles.length,
      shellBytes: compilation.shell.bytes,
      chunks: verification.chunks,
      encodedChunkBytes: verification.encodedChunkBytes,
      decodedChunkBytes: verification.decodedChunkBytes,
      holeTileBufferMetres,
    }),
  });
}

function graphTarget(outputRoot, relativeUrl) {
  const target = resolve(outputRoot, relativeUrl);
  const relativePath = relative(outputRoot, target);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`graph resource escapes output directory: ${relativeUrl}`);
  }
  return target;
}

async function writeImmutable(target, data) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, data, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (!existing.equals(Buffer.from(data))) {
      throw new Error(`refusing to replace non-matching graph asset ${target}`);
    }
  }
}

/** Write the emitted graph: mutable root at courses/v2-index.json, everything
    else content-addressed and immutable. */
export async function writeGroundGraphFiles(outputDirectory, graph) {
  if (typeof outputDirectory !== 'string' || !outputDirectory) {
    throw new TypeError('outputDirectory must be a non-empty string');
  }
  if (!(graph?.resources instanceof Map) || !graph.rootBytes) {
    throw new TypeError('an emitted graph is required');
  }
  const outputRoot = resolve(outputDirectory);
  const written = [];
  for (const [relativeUrl, data] of [...graph.resources].sort(([left], [right]) => left.localeCompare(right))) {
    const target = graphTarget(outputRoot, relativeUrl);
    await writeImmutable(target, data);
    written.push(target);
  }
  /* Exactly the bytes report.rootSha256 digests, never a second rendering. */
  const rootTarget = graphTarget(outputRoot, 'courses/v2-index.json');
  await mkdir(dirname(rootTarget), { recursive: true });
  await writeFile(rootTarget, graph.rootBytes);
  written.push(rootTarget);
  return Object.freeze(written);
}
