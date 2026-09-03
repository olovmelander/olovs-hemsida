/* The vegetation runtime: a published ground's object registries and stand
   fields, loaded, verified, and turned into tree instances in the legacy
   world frame -- Phase 4 of docs/puttom-v2-lidar-tree-placement-plan.md.

   Two populations come out of it and they are never mixed with the lattice:
   individuals, one instance per registry record at its measured position,
   height and crown radius; and stand trees, representative instances drawn
   from the measured stand field (canopy fraction and heights per 4 m cell)
   with an allometry fitted on this ground's own individuals. Species is a
   rendering choice made by hash, because the registry carries no species
   claim and this module must not invent one. Every instance stands on the
   VISIBLE ground the terrain, camera and water share; the registry's own
   base height is compared with it and the mismatch reported, never used to
   float a tree.

   Loading is fail-closed: any chunk that is missing, unsupported, corrupt or
   that does not match its reference makes the whole load fail, and the
   caller decides whether that is a boot error (?v2=require) or a fall back
   to the legacy population everywhere (?v2=1). There is no per-tile
   fallback, by design: a gap or a duplicate is worse than the lattice.     */
import { createHttpByteFetcher, resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { V2_SUPPORTED_FEATURES } from '../../../../packages/course-v2/schema.mjs';
import { STAND_FLAG_EXCLUDED, STAND_FLAG_MEASURED, decodeStandField } from '../../../../packages/course-v2/stand-field.mjs';

export const V2_VEGETATION_VERSION = 1;

/* Fitted on Puttom's 3,710 machine-reviewed individuals (least squares,
   radius against height): the crown a stand tree of a given height draws. */
export const STAND_PLANTING = Object.freeze({
  minimumFraction: 0.15,
  minimumHeightMetres: 2.5,
  allometry: Object.freeze({ interceptMetres: 2.48, slope: 0.124, minimumRadius: 1.5, maximumRadius: 6 }),
  /* stems overlap in a closed stand, so the crown-area packing is not one-to-one */
  overlapFactor: 1.1,
  lowQualityKeep: 0.55,
});

export const SPECIES_INDEX = Object.freeze({ spruce: 0, pine: 1, birch: 2 });

export function crownRadiusForHeight(heightMetres, allometry = STAND_PLANTING.allometry) {
  const radius = allometry.interceptMetres + allometry.slope * heightMetres;
  return Math.min(allometry.maximumRadius, Math.max(allometry.minimumRadius, radius));
}

/* deterministic, position-keyed, in [0, 1) */
export function hash01(a, b, salt = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(salt | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function stringHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/**
 * EPSG:3006 <-> legacy world, through the same bridge the v2 terrain group
 * uses: grid coordinates about the legacy origin, then rotation and frame
 * scale. `bridge` is the aligned preview's bridge; `frameOrigin` the ground
 * manifest's origin.
 */
export function createFrameMapper({ bridge, frameOrigin }) {
  if (typeof bridge?.toLegacy !== 'function' || typeof bridge?.toGrid !== 'function') {
    throw new TypeError('the legacy grid bridge with toLegacy/toGrid is required');
  }
  if (!Number.isFinite(frameOrigin?.easting) || !Number.isFinite(frameOrigin?.northing)) {
    throw new TypeError('a finite ground frame origin is required');
  }
  const legacyOriginEasting = frameOrigin.easting - bridge.translateX;
  const legacyOriginNorthing = frameOrigin.northing + bridge.translateZ;
  return Object.freeze({
    legacyOriginEasting,
    legacyOriginNorthing,
    toWorld: (easting, northing) => bridge.toLegacy(easting - legacyOriginEasting, legacyOriginNorthing - northing),
    toEpsg: (x, z) => {
      const [gx, gz] = bridge.toGrid(x, z);
      return [gx + legacyOriginEasting, legacyOriginNorthing - gz];
    },
  });
}

/** Load and verify every object and stand chunk a resolved graph references. */
export async function loadV2Vegetation({
  graph,
  baseUrl,
  fetchImpl = globalThis.fetch,
  signal,
  maxConcurrent = 6,
  supportedFeatures = V2_SUPPORTED_FEATURES,
}) {
  if (!graph?.ground?.tiles) throw new TypeError('a resolved v2 graph is required');
  const fetchBytes = createHttpByteFetcher(fetchImpl);
  const base = new URL(baseUrl, globalThis.location?.href || 'https://banvy.invalid/').href;
  const jobs = [];
  for (const tile of graph.ground.tiles) {
    if (tile.lod !== 0) continue;
    if (tile.layers.objects) jobs.push({ tile, kind: 'objects', reference: tile.layers.objects });
    if (tile.layers.stands) jobs.push({ tile, kind: 'stands', reference: tile.layers.stands });
  }
  const results = new Map();
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const url = resolveV2AssetUrl(job.reference.url, base);
      const data = await fetchBytes(url, { signal, expectedBytes: job.reference.bytes });
      bytes += data.byteLength;
      const verified = await verifyChunkAssetWeb(job.reference, data, { signal, supportedFeatures });
      if (verified.header.id !== job.tile.id || verified.header.owner?.id !== graph.ground.groundId) {
        throw new Error(`${job.kind} chunk ${job.reference.url} does not belong to tile ${job.tile.id}`);
      }
      const entry = results.get(job.tile.id) || { id: job.tile.id, bounds: job.tile.bounds, objects: null, stands: null };
      if (job.kind === 'objects') {
        if (!Array.isArray(verified.content?.records)) throw new Error(`object chunk ${job.reference.url} carries no records`);
        entry.objects = verified.content.records;
      } else {
        entry.stands = decodeStandField(verified.payload, verified.header.standField);
      }
      results.set(job.tile.id, entry);
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxConcurrent, Math.max(1, jobs.length)) }, worker));
  const tiles = [...results.values()].sort((left, right) => left.id.localeCompare(right.id));
  let records = 0;
  for (const tile of tiles) records += tile.objects ? tile.objects.length : 0;
  return Object.freeze({
    version: V2_VEGETATION_VERSION,
    groundId: graph.ground.groundId,
    frameOrigin: graph.ground.frame.origin,
    frameFingerprint: graph.ground.frame.fingerprint,
    tiles,
    counts: Object.freeze({
      referencedObjectTiles: jobs.filter(job => job.kind === 'objects').length,
      referencedStandTiles: jobs.filter(job => job.kind === 'stands').length,
      loadedTiles: tiles.length,
      records,
    }),
    bytes,
  });
}

/** Which legacy-world points the v2 populations own: every finest tile that published a layer. */
export function createCoverage(loaded, mapper) {
  const tiles = loaded.tiles.filter(tile => tile.objects || tile.stands);
  const scan = (easting, northing) => tiles.find(tile =>
    easting >= tile.bounds.minEasting && easting < tile.bounds.maxEasting &&
    northing >= tile.bounds.minNorthing && northing < tile.bounds.maxNorthing) || null;
  /* The finest tiles stand on one lattice, so a point's owner is one map
     read. The lattice is proved here -- every tile the same size and on
     whole steps from the first -- and the linear scan is kept for a set that
     is not, so the answer is the same either way; only its cost differs. The
     legacy lattice asked this for 286,000 candidates and each was up to 64
     box tests before it did anything else. */
  const lattice = (() => {
    if (!tiles.length) return null;
    const size = tiles[0].bounds.maxEasting - tiles[0].bounds.minEasting;
    if (!(size > 0)) return null;
    const e0 = Math.min(...tiles.map(tile => tile.bounds.minEasting));
    const n0 = Math.min(...tiles.map(tile => tile.bounds.minNorthing));
    const byCell = new Map();
    for (const tile of tiles) {
      const { minEasting, maxEasting, minNorthing, maxNorthing } = tile.bounds;
      const column = (minEasting - e0) / size, row = (minNorthing - n0) / size;
      if (Math.abs(maxEasting - minEasting - size) > 1e-6 || Math.abs(maxNorthing - minNorthing - size) > 1e-6 ||
          !Number.isInteger(column) || !Number.isInteger(row)) return null;
      const key = `${column},${row}`;
      if (byCell.has(key)) return null;
      byCell.set(key, tile);
    }
    return { size, e0, n0, byCell };
  })();
  const owner = lattice
    ? (easting, northing) => {
      const column = Math.floor((easting - lattice.e0) / lattice.size), row = Math.floor((northing - lattice.n0) / lattice.size);
      return lattice.byCell.get(`${column},${row}`) || null;
    }
    : scan;
  return Object.freeze({
    tiles: tiles.length,
    covers: (x, z) => {
      const [easting, northing] = mapper.toEpsg(x, z);
      return owner(easting, northing) !== null;
    },
    ownerAt: (x, z) => {
      const [easting, northing] = mapper.toEpsg(x, z);
      return owner(easting, northing);
    },
  });
}

function chooseSpecies(r, shoreDistance) {
  if (shoreDistance !== null && shoreDistance < 28 && r < 0.7) return SPECIES_INDEX.birch;
  return r < 0.56 ? SPECIES_INDEX.pine : r < 0.83 ? SPECIES_INDEX.spruce : SPECIES_INDEX.birch;
}

/**
 * Instances for the legacy world. `groundHeightAt(x, z)` is the shared
 * visible-ground sampler; `shoreDistanceAt(x, z)` may return null.
 */
export function planV2Vegetation(loaded, {
  mapper,
  groundHeightAt,
  shoreDistanceAt = () => null,
  lowQuality = false,
  verticalDatumOffsetMetres = 0,
  planting = STAND_PLANTING,
} = {}) {
  if (typeof groundHeightAt !== 'function') throw new TypeError('groundHeightAt is required');
  const instances = [];
  const mismatches = [];
  let individuals = 0;
  let standTrees = 0;
  let cellsPlanted = 0;
  let cellsSkipped = 0;
  for (const tile of loaded.tiles) {
    for (const record of tile.objects || []) {
      if (record.class !== 'tree') continue;
      const [x, z] = mapper.toWorld(record.easting, record.northing);
      const y = groundHeightAt(x, z);
      if (!Number.isFinite(y)) continue;
      mismatches.push(Math.abs(y - (record.heightRH2000 + verticalDatumOffsetMetres)));
      const r = stringHash(record.id) / 4294967296;
      instances.push({
        x, y, z,
        height: record.objectHeightMetres,
        radius: record.radiusMetres,
        rotation: (record.headingDegrees / 180) * Math.PI,
        species: chooseSpecies(r, shoreDistanceAt(x, z)),
        kind: 'individual',
        id: record.id,
      });
      individuals++;
    }
    const field = tile.stands;
    if (!field) continue;
    const cellArea = field.cellMetres * field.cellMetres;
    for (let row = 0; row < field.height; row++) {
      for (let column = 0; column < field.width; column++) {
        const index = row * field.width + column;
        const flags = field.flags[index];
        if (!(flags & STAND_FLAG_MEASURED)) continue;
        if (flags & STAND_FLAG_EXCLUDED) { cellsSkipped++; continue; }
        const fraction = field.fraction[index];
        const mean = field.meanHeight[index];
        if (fraction < planting.minimumFraction || mean < planting.minimumHeightMetres) { cellsSkipped++; continue; }
        const cellEasting = tile.bounds.minEasting + column * field.cellMetres;
        const cellNorthing = tile.bounds.maxNorthing - row * field.cellMetres;
        const ce = Math.round(cellEasting), cn = Math.round(cellNorthing);
        if (lowQuality && hash01(ce, cn, 7) > planting.lowQualityKeep) { cellsSkipped++; continue; }
        const radius = crownRadiusForHeight(mean, planting.allometry);
        const expected = (fraction * cellArea / (Math.PI * radius * radius)) * planting.overlapFactor;
        const count = Math.floor(expected) + (hash01(ce, cn, 1) < expected - Math.floor(expected) ? 1 : 0);
        if (!count) { cellsSkipped++; continue; }
        cellsPlanted++;
        const p95 = Math.max(field.p95Height[index], mean);
        for (let k = 0; k < count; k++) {
          const easting = cellEasting + hash01(ce, cn, 11 + k * 5) * field.cellMetres;
          const northing = cellNorthing - hash01(ce, cn, 12 + k * 5) * field.cellMetres;
          const [x, z] = mapper.toWorld(easting, northing);
          const y = groundHeightAt(x, z);
          if (!Number.isFinite(y)) continue;
          const height = Math.min(p95 * 1.05, Math.max(planting.minimumHeightMetres, mean * (0.8 + 0.4 * hash01(ce, cn, 13 + k * 5))));
          instances.push({
            x, y, z,
            height,
            radius: crownRadiusForHeight(height, planting.allometry) * (0.85 + 0.3 * hash01(ce, cn, 14 + k * 5)),
            rotation: hash01(ce, cn, 15 + k * 5) * Math.PI * 2,
            species: chooseSpecies(hash01(ce, cn, 16 + k * 5), shoreDistanceAt(x, z)),
            kind: 'stand',
            id: null,
          });
          standTrees++;
        }
      }
    }
  }
  mismatches.sort((a, b) => a - b);
  const mean = mismatches.length ? mismatches.reduce((sum, value) => sum + value, 0) / mismatches.length : null;
  return Object.freeze({
    instances,
    stats: Object.freeze({
      individuals,
      standTrees,
      cellsPlanted,
      cellsSkipped,
      baseMismatch: Object.freeze({
        samples: mismatches.length,
        meanAbsMetres: mean === null ? null : Math.round(mean * 1000) / 1000,
        p95Metres: mismatches.length ? Math.round(mismatches[Math.floor(0.95 * (mismatches.length - 1))] * 1000) / 1000 : null,
        maxMetres: mismatches.length ? Math.round(mismatches[mismatches.length - 1] * 1000) / 1000 : null,
      }),
    }),
  });
}
