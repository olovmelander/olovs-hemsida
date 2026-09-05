/* From reviewed crown candidates to the object-registry chunks the graph
   references: the compilation half of the vegetation plan.

   Every record here goes through the strict object-registry validator and
   the chunk envelope the loader already verifies, so a registry that reaches
   the app has passed the same gates as a synthetic fixture. Positions stay
   crown centres; the base height is sampled from the exact DTM generation
   the caller supplies; uncertainty floors are the plan's; heading is a
   deterministic rendering choice derived from the id and is not a measured
   property.                                                                  */
import { assetReferenceForChunk, writeCanonicalJsonChunk } from '../chunk-node.mjs';
import { validateObjectRegistry } from '../object-registry.mjs';
import { CROWN_PARAMETERS } from './crown-detect.mjs';

const FIELD_ORDER = [
  'id', 'groundId', 'class', 'subtype', 'easting', 'northing', 'heightRH2000',
  'objectHeightMetres', 'radiusMetres', 'headingDegrees', 'sourceId', 'capturedAt',
  'accuracyTier', 'horizontalAccuracyMetres', 'verticalAccuracyMetres', 'confidence',
  'reviewStatus', 'truthZone', 'placementMethod',
];

/** A stable 0-360 heading from the id: rendering variation, never a measurement. */
export function headingFromId(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return Math.round(((hash % 36000) / 100) * 100) / 100;
}

const round = (value, decimals = 3) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * Build one registry record from a reviewed candidate. `baseHeightRH2000`
 * comes from the caller's DTM sampler at the crown centre; the accuracy
 * floors cannot be undercut, only raised.
 */
export function treeRecord({
  id,
  groundId,
  candidate,
  baseHeightRH2000,
  sourceId,
  capturedAt,
  truthZone,
  confidence,
  accuracyTier = 'C',
  subtype = null,
  placementMethod = 'derived-lidar',
  reviewStatus = 'approved',
  horizontalAccuracyMetres = CROWN_PARAMETERS.horizontalAccuracyFloorMetres,
  verticalAccuracyMetres = CROWN_PARAMETERS.verticalAccuracyFloorMetres,
}) {
  if (!Number.isFinite(baseHeightRH2000)) throw new TypeError(`${id}: baseHeightRH2000 must be sampled from the published DTM`);
  const record = {
    id,
    groundId,
    class: 'tree',
    subtype,
    easting: round(candidate.centroid.easting),
    northing: round(candidate.centroid.northing),
    heightRH2000: round(baseHeightRH2000),
    objectHeightMetres: round(candidate.heightMetres),
    radiusMetres: round(candidate.radiusMetres ?? candidate.equivalentRadiusMetres),
    headingDegrees: headingFromId(id),
    sourceId,
    capturedAt,
    accuracyTier,
    horizontalAccuracyMetres: round(Math.max(horizontalAccuracyMetres, CROWN_PARAMETERS.horizontalAccuracyFloorMetres)),
    verticalAccuracyMetres: round(Math.max(verticalAccuracyMetres, CROWN_PARAMETERS.verticalAccuracyFloorMetres)),
    confidence: round(confidence),
    reviewStatus,
    truthZone,
    placementMethod,
  };
  return Object.fromEntries(FIELD_ORDER.map(field => [field, record[field]]));
}

/**
 * Each record belongs to exactly one finest-level tile: the one whose bounds
 * contain its position, with a point on a shared edge going to the tile
 * whose minimum it equals. Records outside every tile are returned, not
 * dropped.
 */
export function assignRecordsToTiles(records, tiles) {
  const finest = tiles.filter(tile => tile.lod === 0);
  if (!finest.length) throw new Error('no finest-level tiles to own objects');
  const byTile = new Map(finest.map(tile => [tile.id, []]));
  const outside = [];
  for (const record of records) {
    const owner = finest.find(tile =>
      record.easting >= tile.bounds.minEasting && record.easting < tile.bounds.maxEasting &&
      record.northing >= tile.bounds.minNorthing && record.northing < tile.bounds.maxNorthing);
    if (owner) byTile.get(owner.id).push(record);
    else outside.push(record.id);
  }
  return Object.freeze({ byTile, outside: Object.freeze(outside.sort()) });
}

/* A base height is sampled from the tile's own terrain and rounded to the
   millimetre the record carries, while the tile's declared height bounds are
   the decoded quantized values, float tails included: Ängsö's Mälaren plate
   decodes to 0.7600000000000002, a crown standing on it samples exactly that,
   and its record rounds to 0.76 -- below the bound by 2e-16, which the strict
   validator rightly refuses (tile l0/4/13, the first shoreline compile). A
   height within the record's own precision of a bound is the bound; anything
   further out is a real disagreement between sampler and tile and still fails. */
const RECORD_HEIGHT_PRECISION_METRES = 0.001;
export function snapHeightIntoBounds(record, bounds) {
  const height = record.heightRH2000;
  if (!Number.isFinite(height) || !bounds) return record;
  const { minHeightRH2000: low, maxHeightRH2000: high } = bounds;
  if (Number.isFinite(low) && height < low && low - height <= RECORD_HEIGHT_PRECISION_METRES) return { ...record, heightRH2000: low };
  if (Number.isFinite(high) && height > high && height - high <= RECORD_HEIGHT_PRECISION_METRES) return { ...record, heightRH2000: high };
  return record;
}

/**
 * One chunk per owning tile with at least one record. Throws on any record
 * the strict validator refuses: a compiler that emits an invalid registry
 * has nothing to publish.
 */
export function compileObjectChunks({ groundId, tiles, records, directory = `grounds/${groundId}/objects` }) {
  const { byTile, outside } = assignRecordsToTiles(records, tiles);
  if (outside.length) throw new Error(`${outside.length} record(s) lie outside every finest tile: ${outside.slice(0, 5).join(', ')}`);
  const chunks = [];
  const layers = new Map();
  for (const tile of tiles) {
    const owned = byTile.get(tile.id);
    if (!owned || !owned.length) continue;
    const sorted = owned.map(record => snapHeightIntoBounds(record, tile.bounds)).sort((left, right) => left.id.localeCompare(right.id));
    const value = { schemaVersion: 1, groundId, tileId: tile.id, records: sorted };
    /* the chunk's bounds ARE the tile's, height range included: the graph
       verifier holds every layer of a tile to the same box, and the registry
       validator then refuses a base height the tile's terrain cannot hold */
    const header = {
      schemaVersion: 2,
      id: tile.id,
      kind: 'objects',
      owner: { type: 'ground', id: groundId },
      bounds: { ...tile.bounds },
      payloadFormat: 'json-canonical-v1',
      requiredFeatures: ['chunk-envelope-v2', 'object-registry-json-v1'],
      records: { content: 'object-registry', count: sorted.length },
    };
    const errors = validateObjectRegistry(value, header);
    if (errors.length) throw new Error(`tile ${tile.id} registry is invalid:\n${errors.join('\n')}`);
    const chunk = writeCanonicalJsonChunk({ header, value });
    const reference = assetReferenceForChunk(chunk, { kind: 'objects', directory });
    chunks.push(Object.freeze({ tileId: tile.id, records: sorted.length, bytes: chunk, reference }));
    layers.set(tile.id, reference);
  }
  return Object.freeze({ chunks, layers, recordCount: records.length });
}

/** Counts a release note can print. */
export function objectCompilationSummary(compiled) {
  let records = 0;
  let encodedBytes = 0;
  for (const chunk of compiled.chunks) { records += chunk.records; encodedBytes += chunk.bytes.byteLength; }
  return Object.freeze({ tiles: compiled.chunks.length, records, encodedBytes });
}
