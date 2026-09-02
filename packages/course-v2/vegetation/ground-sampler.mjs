/* Base heights from the EXACT published terrain generation.

   A tree's `heightRH2000` must come from the same tiles the app drapes the
   ground with, not from the DTM the compiler happened to read, or the two
   drift apart and the tree floats. This samples the finest terrain chunks
   of a ground manifest -- verified through the same reader the loader uses
   -- bilinearly, and reports which tile and generation every height came
   from. `readAsset(url)` returns the chunk bytes, so the same code serves a
   test's in-memory graph and the committed public directory.                */
import { readChunk } from '../chunk-node.mjs';
import { decodeTerrainGrid } from '../terrain-grid.mjs';

export async function createGroundSampler(ground, readAsset) {
  if (!ground?.tiles || typeof readAsset !== 'function') throw new TypeError('a ground manifest and readAsset(url) are required');
  const finest = ground.tiles.filter(tile => tile.lod === 0);
  if (!finest.length) throw new Error('the ground manifest has no finest-level tiles');
  const decoded = new Map();
  const load = async tile => {
    if (decoded.has(tile.id)) return decoded.get(tile.id);
    const reference = tile.layers.terrain;
    const bytes = await readAsset(reference.url);
    const chunk = readChunk(bytes);
    if (chunk.header.kind !== 'terrain' || chunk.header.id !== tile.id) {
      throw new Error(`terrain chunk ${reference.url} does not belong to tile ${tile.id}`);
    }
    const grid = chunk.header.grid;
    const heights = decodeTerrainGrid(chunk.payload, grid);
    const entry = Object.freeze({
      tile,
      grid,
      heights,
      sha256: reference.sha256,
      minEasting: tile.bounds.minEasting,
      maxNorthing: tile.bounds.maxNorthing,
    });
    decoded.set(tile.id, entry);
    return entry;
  };
  const owner = (easting, northing) => finest.find(tile =>
    easting >= tile.bounds.minEasting && easting <= tile.bounds.maxEasting &&
    northing >= tile.bounds.minNorthing && northing <= tile.bounds.maxNorthing) || null;
  return Object.freeze({
    frameFingerprint: ground.frame?.fingerprint || null,
    async sample(easting, northing) {
      const tile = owner(easting, northing);
      if (!tile) return null;
      const entry = await load(tile);
      const { grid, heights } = entry;
      const x = (easting - entry.minEasting) / grid.sampleSpacingMetres;
      const y = (entry.maxNorthing - northing) / grid.sampleSpacingMetres;
      const column = Math.min(grid.width - 2, Math.max(0, Math.floor(x)));
      const row = Math.min(grid.height - 2, Math.max(0, Math.floor(y)));
      const fx = Math.min(1, Math.max(0, x - column));
      const fy = Math.min(1, Math.max(0, y - row));
      const h00 = heights[row * grid.width + column];
      const h10 = heights[row * grid.width + column + 1];
      const h01 = heights[(row + 1) * grid.width + column];
      const h11 = heights[(row + 1) * grid.width + column + 1];
      if ([h00, h10, h01, h11].some(Number.isNaN)) return { tileId: tile.id, sha256: entry.sha256, heightRH2000: Number.NaN, nodata: true };
      const height = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
      return { tileId: tile.id, sha256: entry.sha256, heightRH2000: Math.round(height * 1000) / 1000, nodata: false };
    },
  });
}
