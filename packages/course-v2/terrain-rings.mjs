/* Nested rings of terrain resolution, compiled into one quadtree.
 *
 * A single-master pyramid (terrain-pyramid.mjs) needs the whole extent at
 * the finest spacing, which is the wrong shape for a horizon: nobody looks
 * at 1 m ground eight kilometres away, and a 16 km square at 1 m is 256
 * million samples. Here every level is its own raster over its own, smaller,
 * extent -- 1 m over the course, 2 m to 1.5 km, 4 m to 3 km, 8 m to 6 km,
 * and 16 m and coarser to the root -- and the levels nest: each tile lies in
 * exactly one tile of the next coarser level, which the manifest records as
 * an explicit parent id, so the runtime's quadtree never has to guess it
 * from indices. Geometric error is measured against the finest data that
 * exists at each point, so refinement decisions see the truth they would
 * refine towards.                                                            */
import { assetReferenceForChunk, writeChunk } from './chunk-node.mjs';
import { encodeTerrainGrid, decodeTerrainGrid } from './terrain-grid.mjs';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TERRAIN_FEATURES = Object.freeze(['chunk-envelope-v2', 'terrain-grid-u16-v1']);
const EPSILON = 1e-6;

function id(value, label) {
  if (!ID.test(value || '')) throw new TypeError(`${label} must be a lowercase kebab-case id`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function positiveInteger(value, label, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${label} must be an integer of at least ${minimum}`);
  return value;
}

function terrainChunk({ groundId, tile, chunkId, bounds, assetDirectory, codec }) {
  const chunk = writeChunk({
    header: {
      schemaVersion: 2,
      id: chunkId,
      kind: 'terrain',
      owner: { type: 'ground', id: groundId },
      bounds,
      payloadFormat: 'terrain-grid-u16-le-v1',
      requiredFeatures: [...TERRAIN_FEATURES],
      grid: { ...tile.grid },
    },
    payload: tile.payload,
    codec,
  });
  const reference = assetReferenceForChunk(chunk, { kind: 'terrain', directory: assetDirectory });
  return Object.freeze({ chunk, reference });
}

/** One level: a north-up raster of (tilesPerSide * tileSegments + 1)^2 samples. */
function checkLevel(level, index, tileSegments) {
  const label = `levels[${index}]`;
  positiveInteger(level.lod, `${label}.lod`, 0);
  finite(level.sampleSpacingMetres, `${label}.sampleSpacingMetres`);
  if (level.sampleSpacingMetres <= 0) throw new RangeError(`${label}.sampleSpacingMetres must be positive`);
  finite(level.originEasting, `${label}.originEasting`);
  finite(level.originNorthing, `${label}.originNorthing`);
  positiveInteger(level.tilesPerSide, `${label}.tilesPerSide`);
  finite(level.heightScaleMetres, `${label}.heightScaleMetres`);
  const size = level.tilesPerSide * tileSegments + 1;
  if (!level.heights || level.heights.length !== size * size) {
    throw new RangeError(`${label}.heights must contain ${size * size} samples`);
  }
  let minimum = Infinity, maximum = -Infinity, finiteCount = 0;
  for (const value of level.heights) {
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value)) throw new TypeError(`${label} has a non-finite sample`);
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    finiteCount++;
  }
  if (!finiteCount) throw new Error(`${label} contains no finite height samples`);
  const span = level.tilesPerSide * tileSegments * level.sampleSpacingMetres;
  return Object.freeze({
    ...level, size, span, minimum, maximum, finiteCount,
    minEasting: level.originEasting,
    maxEasting: level.originEasting + span,
    maxNorthing: level.originNorthing,
    minNorthing: level.originNorthing - span,
  });
}

function contains(outer, inner) {
  return inner.minEasting >= outer.minEasting - EPSILON && inner.maxEasting <= outer.maxEasting + EPSILON &&
    inner.minNorthing >= outer.minNorthing - EPSILON && inner.maxNorthing <= outer.maxNorthing + EPSILON;
}

/* bilinear read of a level raster at a map position; NaN outside or at nodata */
function sampleLevel(level, easting, northing) {
  const x = (easting - level.originEasting) / level.sampleSpacingMetres;
  const y = (level.originNorthing - northing) / level.sampleSpacingMetres;
  if (x < -EPSILON || y < -EPSILON || x > level.size - 1 + EPSILON || y > level.size - 1 + EPSILON) return Number.NaN;
  const cx = Math.min(level.size - 1, Math.max(0, x)), cy = Math.min(level.size - 1, Math.max(0, y));
  const west = Math.floor(cx), north = Math.floor(cy);
  const east = Math.min(level.size - 1, west + 1), south = Math.min(level.size - 1, north + 1);
  const tx = cx - west, ty = cy - north;
  const a = level.heights[north * level.size + west], b = level.heights[north * level.size + east];
  const c = level.heights[south * level.size + west], d = level.heights[south * level.size + east];
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) return Number.NaN;
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/* the bilinear reconstruction of a tile from its own (unquantized) samples */
function sampleTile(tile, easting, northing) {
  const x = (easting - tile.minEasting) / tile.sampleSpacingMetres;
  const y = (tile.maxNorthing - northing) / tile.sampleSpacingMetres;
  const size = tile.size;
  const cx = Math.min(size - 1, Math.max(0, x)), cy = Math.min(size - 1, Math.max(0, y));
  const west = Math.floor(cx), north = Math.floor(cy);
  const east = Math.min(size - 1, west + 1), south = Math.min(size - 1, north + 1);
  const tx = cx - west, ty = cy - north;
  const a = tile.values[north * size + west], b = tile.values[north * size + east];
  const c = tile.values[south * size + west], d = tile.values[south * size + east];
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) return Number.NaN;
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Maximum |truth - reconstruction| over the tile, where truth is the finest
 * level whose extent covers the sample. Finer levels are walked at their own
 * grid nodes over the part of the tile they cover and no finer level does.
 */
function tileGeometricError(tile, finerLevels) {
  let maximum = 0;
  for (let k = 0; k < finerLevels.length; k++) {
    const level = finerLevels[k];
    const finer = k > 0 ? finerLevels[k - 1] : null;
    const minEasting = Math.max(tile.minEasting, level.minEasting);
    const maxEasting = Math.min(tile.maxEasting, level.maxEasting);
    const minNorthing = Math.max(tile.minNorthing, level.minNorthing);
    const maxNorthing = Math.min(tile.maxNorthing, level.maxNorthing);
    if (!(maxEasting > minEasting && maxNorthing > minNorthing)) continue;
    const step = level.sampleSpacingMetres;
    const column0 = Math.ceil((minEasting - level.originEasting) / step - EPSILON);
    const column1 = Math.floor((maxEasting - level.originEasting) / step + EPSILON);
    const row0 = Math.ceil((level.originNorthing - maxNorthing) / step - EPSILON);
    const row1 = Math.floor((level.originNorthing - minNorthing) / step + EPSILON);
    for (let row = row0; row <= row1; row++) {
      const northing = level.originNorthing - row * step;
      for (let column = column0; column <= column1; column++) {
        const easting = level.originEasting + column * step;
        if (finer && easting > finer.minEasting + EPSILON && easting < finer.maxEasting - EPSILON &&
            northing > finer.minNorthing + EPSILON && northing < finer.maxNorthing - EPSILON) continue;
        const truth = level.heights[row * level.size + column];
        if (Number.isNaN(truth)) continue;
        const reconstructed = sampleTile(tile, easting, northing);
        if (Number.isNaN(reconstructed)) throw new Error(`tile ${tile.id} loses finite terrain at ${easting},${northing}`);
        const difference = Math.abs(truth - reconstructed);
        if (difference > maximum) maximum = difference;
      }
    }
  }
  return maximum;
}

/**
 * Compile nested resolution rings into content-addressed terrain chunks and
 * the shell/tile fields of a ground-v2 manifest. `levels` are finest first,
 * with lods 0..n consecutive; every level's extent must lie inside the next
 * coarser one with its tile boundaries on that level's lattice, and the
 * coarsest level must be a single tile, which becomes the shell.
 * `reuse(lod, column, row)` may return an already published chunk for a
 * tile, `{ chunk, reference, heights }`, whose decoded heights are asserted
 * equal to the compiled ones before it is kept byte for byte.
 */
export function compileTerrainRings({
  groundId: requestedGroundId,
  courseSlugs,
  levels: requestedLevels,
  tileSegments = 256,
  assetDirectory,
  codec = 'deflate-raw',
  reuse = null,
} = {}) {
  const groundId = id(requestedGroundId, 'groundId');
  if (!Array.isArray(courseSlugs) || !courseSlugs.length) throw new TypeError('courseSlugs must be a non-empty array');
  const slugs = Object.freeze([...courseSlugs].map((slug, index) => id(slug, `courseSlugs[${index}]`)).sort());
  positiveInteger(tileSegments, 'tileSegments', 2);
  if ((tileSegments & (tileSegments - 1)) !== 0) throw new RangeError('tileSegments must be a power of two');
  if (!Array.isArray(requestedLevels) || !requestedLevels.length) throw new TypeError('levels are required');
  const levels = requestedLevels.map((level, index) => checkLevel(level, index, tileSegments));
  levels.forEach((level, index) => {
    if (level.lod !== index) throw new Error(`levels must be listed finest first with consecutive lods; got lod ${level.lod} at ${index}`);
    if (index === 0) return;
    const finer = levels[index - 1];
    if (Math.abs(level.sampleSpacingMetres - finer.sampleSpacingMetres * 2) > EPSILON) {
      throw new Error(`level ${level.lod} spacing must be twice level ${finer.lod}`);
    }
    if (!contains(level, finer)) throw new Error(`level ${finer.lod} extent leaves level ${level.lod}`);
    const tileSpan = tileSegments * finer.sampleSpacingMetres;
    const offsetE = (level.originEasting - finer.originEasting) / tileSpan;
    const offsetN = (finer.originNorthing - level.originNorthing) / tileSpan;
    if (Math.abs(offsetE - Math.round(offsetE)) > EPSILON || Math.abs(offsetN - Math.round(offsetN)) > EPSILON) {
      throw new Error(`level ${level.lod} lattice is not aligned to level ${finer.lod} tiles`);
    }
    /* The finer ring must be made of WHOLE coarser tiles: the runtime replaces
       a coarse tile by its children and draws nothing where they are missing,
       so a coarse tile half inside the finer ring would open a hole in the
       ground the size of its other half. */
    const coarseSpan = tileSegments * level.sampleSpacingMetres;
    const startE = (finer.originEasting - level.originEasting) / coarseSpan;
    const startN = (level.originNorthing - finer.originNorthing) / coarseSpan;
    const count = finer.span / coarseSpan;
    if ([startE, startN, count].some(value => Math.abs(value - Math.round(value)) > EPSILON)) {
      throw new Error(`level ${finer.lod} ring does not cover whole level ${level.lod} tiles`);
    }
  });
  const coarsest = levels.at(-1);
  if (coarsest.tilesPerSide !== 1) throw new Error('the coarsest level must be a single root tile');
  const directory = assetDirectory || `grounds/${groundId}/terrain`;

  const resources = new Map();
  const tiles = [];
  const compiledByLevel = [];
  const levelStats = [];
  let reusedTiles = 0;
  let reuseTies = 0;
  for (const level of levels) {
    const size = tileSegments + 1;
    const heightOffsetMetres = Math.floor(level.minimum / level.heightScaleMetres) * level.heightScaleMetres;
    if (Math.round((level.maximum - heightOffsetMetres) / level.heightScaleMetres) >= 65535) {
      throw new RangeError(`level ${level.lod} height range exceeds uint16 at ${level.heightScaleMetres} m`);
    }
    const finer = levels.slice(0, level.lod);
    const compiled = [];
    let encodedBytes = 0, decodedBytes = 0, maximumError = 0;
    for (let row = 0; row < level.tilesPerSide; row++) for (let column = 0; column < level.tilesPerSide; column++) {
      const values = new Float64Array(size * size);
      for (let r = 0; r < size; r++) {
        const source = (row * tileSegments + r) * level.size + column * tileSegments;
        for (let c = 0; c < size; c++) values[r * size + c] = level.heights[source + c];
      }
      const minEasting = level.originEasting + column * tileSegments * level.sampleSpacingMetres;
      const maxNorthing = level.originNorthing - row * tileSegments * level.sampleSpacingMetres;
      const tile = {
        id: `l${level.lod}/${column}/${row}`, lod: level.lod, column, row, size, values,
        sampleSpacingMetres: level.sampleSpacingMetres,
        minEasting, maxEasting: minEasting + tileSegments * level.sampleSpacingMetres,
        maxNorthing, minNorthing: maxNorthing - tileSegments * level.sampleSpacingMetres,
      };
      const residual = tileGeometricError(tile, finer);
      const geometricErrorMetres = residual + level.heightScaleMetres / 2;
      const encoded = encodeTerrainGrid({
        heights: values, width: size, height: size, heightOffsetMetres, heightScaleMetres: level.heightScaleMetres,
      });
      const bounds = Object.freeze({
        minEasting: tile.minEasting, minNorthing: tile.minNorthing, minHeightRH2000: encoded.minHeightRH2000,
        maxEasting: tile.maxEasting, maxNorthing: tile.maxNorthing, maxHeightRH2000: encoded.maxHeightRH2000,
      });
      const grid = Object.freeze({ ...encoded.grid, sampleSpacingMetres: level.sampleSpacingMetres, geometricErrorMetres });
      let asset = terrainChunk({ groundId, tile: { grid, payload: encoded.payload }, chunkId: tile.id, bounds, assetDirectory: directory, codec });
      const published = reuse?.(level.lod, column, row) ?? null;
      if (published) {
        const mine = decodeTerrainGrid(encoded.payload, grid);
        if (published.heights.length !== mine.length) throw new Error(`published ${tile.id} has a different grid`);
        /* A source value that sits exactly half a quantum from the lattice
           rounds either way depending on which decimal representation the
           compiler saw (the CI path read a text dump); such ties differ by
           exactly one quantum and are counted, never treated as drift. */
        for (let index = 0; index < mine.length; index++) {
          const a = published.heights[index], b = mine[index];
          if (Number.isNaN(a) !== Number.isNaN(b)) throw new Error(`published ${tile.id} differs in coverage at sample ${index}`);
          if (Number.isNaN(a)) continue;
          const difference = Math.abs(a - b);
          if (difference > level.heightScaleMetres + 1e-9) {
            throw new Error(`published ${tile.id} differs from the compiled heights at sample ${index}: ${a} vs ${b}`);
          }
          if (difference > 1e-9) reuseTies++;
        }
        if (Math.abs(published.reference.geometricErrorMetres ?? geometricErrorMetres) > 0 &&
            published.grid?.geometricErrorMetres !== undefined &&
            Math.abs(published.grid.geometricErrorMetres - geometricErrorMetres) > 1e-9) {
          throw new Error(`published ${tile.id} carries geometric error ${published.grid.geometricErrorMetres}; compiled ${geometricErrorMetres}`);
        }
        asset = Object.freeze({ chunk: published.chunk, reference: published.reference });
        reusedTiles++;
      }
      resources.set(asset.reference.url, asset.chunk);
      encodedBytes += asset.reference.bytes;
      decodedBytes += asset.reference.decodedBytes;
      maximumError = Math.max(maximumError, geometricErrorMetres);
      compiled.push(Object.freeze({ ...tile, bounds, grid, payload: encoded.payload, reference: asset.reference, geometricErrorMetres }));
    }
    compiledByLevel.push(compiled);
    levelStats.push(Object.freeze({
      lod: level.lod, sampleSpacingMetres: level.sampleSpacingMetres, tiles: compiled.length,
      spanMetres: level.span, heightScaleMetres: level.heightScaleMetres, encodedBytes, decodedBytes,
      maximumGeometricErrorMetres: maximumError,
    }));
  }

  /* explicit parents: the coarser tile whose footprint holds the tile's centre */
  for (let lod = 0; lod < compiledByLevel.length; lod++) {
    const parents = compiledByLevel[lod + 1] || null;
    for (const tile of compiledByLevel[lod]) {
      let parentId = null;
      if (parents) {
        const centreE = (tile.minEasting + tile.maxEasting) / 2;
        const centreN = (tile.minNorthing + tile.maxNorthing) / 2;
        const parent = parents.find(candidate => centreE > candidate.minEasting && centreE < candidate.maxEasting &&
          centreN > candidate.minNorthing && centreN < candidate.maxNorthing);
        if (!parent || !contains(parent, tile)) throw new Error(`tile ${tile.id} has no containing parent at level ${lod + 1}`);
        parentId = parent.id;
      }
      tiles.push(Object.freeze({
        id: tile.id,
        lod: tile.lod,
        parentId,
        bounds: tile.bounds,
        geometricErrorMetres: tile.geometricErrorMetres,
        courses: slugs,
        layers: Object.freeze({ terrain: tile.reference, surface: null, objects: null }),
      }));
    }
  }

  const root = compiledByLevel.at(-1)[0];
  const bounds = Object.freeze({
    minEasting: coarsest.minEasting,
    minNorthing: coarsest.minNorthing,
    minHeightRH2000: Math.min(...levels.map(level => level.minimum)),
    maxEasting: coarsest.maxEasting,
    maxNorthing: coarsest.maxNorthing,
    maxHeightRH2000: Math.max(...levels.map(level => level.maximum)),
  });
  const shellAsset = terrainChunk({
    groundId, tile: { grid: root.grid, payload: root.payload }, chunkId: 'shell', bounds, assetDirectory: directory, codec,
  });
  resources.set(shellAsset.reference.url, shellAsset.chunk);

  let encodedBytes = 0;
  for (const resource of resources.values()) encodedBytes += resource.byteLength;
  return Object.freeze({
    groundId,
    courseSlugs: slugs,
    bounds,
    shell: shellAsset.reference,
    tiles: Object.freeze(tiles),
    resources,
    levels: Object.freeze(levels.map(level => Object.freeze({
      lod: level.lod, sampleSpacingMetres: level.sampleSpacingMetres, tilesPerSide: level.tilesPerSide,
      originEasting: level.originEasting, originNorthing: level.originNorthing, spanMetres: level.span,
      minimum: level.minimum, maximum: level.maximum, finiteCount: level.finiteCount,
    }))),
    stats: Object.freeze({
      tileChunks: tiles.length,
      rootTiles: 1,
      reusedTiles,
      reuseTies,
      uniqueChunks: resources.size,
      encodedBytes,
      decodedBytes: shellAsset.reference.decodedBytes + tiles.reduce((sum, tile) => sum + tile.layers.terrain.decodedBytes, 0),
      shellEncodedBytes: shellAsset.reference.bytes,
      levels: Object.freeze(levelStats),
    }),
  });
}

/** Sample a compiled ring set at a map position: the finest level covering it. */
export function createRingSampler(levels) {
  const checked = levels.map((level, index) => checkLevel(level, index, (Math.sqrt(level.heights.length) - 1) / level.tilesPerSide));
  return (easting, northing) => {
    for (const level of checked) {
      const value = sampleLevel(level, easting, northing);
      if (!Number.isNaN(value)) return value;
    }
    return Number.NaN;
  };
}
