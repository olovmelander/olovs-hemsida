/* Heights from a PUBLISHED ground graph, at every level it carries.

   `createGroundHeightLookup` in vegetation/ground-sampler.mjs reads the finest
   tiles only, which is right for a tree base inside the course window. A
   legacy heightfield rebuild needs the whole 16 km root -- HF1 reaches 7.5 km
   from the pack origin -- so this one decodes every tile of the manifest up
   front and answers from the FINEST level that covers a point: 1 m inside the
   course window, then 2, 4 and 8 m out to the root. Every value comes from the
   exact chunks the app drapes, verified through the loader's own reader, so a
   pack cut from it and the streamed v2 ground are one field.

   Bilinear inside a tile; a point that lands beyond every level returns null,
   NaN where the tile itself holds nodata (published seaFill grounds have none). */
import { readChunk } from './chunk-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

export function createPublishedGroundLookup(ground, readAsset) {
  if (!ground?.tiles?.length || typeof readAsset !== 'function') {
    throw new TypeError('a ground manifest and readAsset(url) are required');
  }
  const levels = new Map();
  for (const tile of ground.tiles) {
    const chunk = readChunk(readAsset(tile.layers.terrain.url));
    if (chunk.header.kind !== 'terrain' || chunk.header.id !== tile.id) {
      throw new Error(`terrain chunk ${tile.layers.terrain.url} does not belong to tile ${tile.id}`);
    }
    const grid = chunk.header.grid;
    const entry = {
      grid,
      heights: decodeTerrainGrid(chunk.payload, grid),
      minEasting: tile.bounds.minEasting,
      maxEasting: tile.bounds.maxEasting,
      minNorthing: tile.bounds.minNorthing,
      maxNorthing: tile.bounds.maxNorthing,
    };
    if (!levels.has(tile.lod)) levels.set(tile.lod, { tiles: [], span: entry.maxEasting - entry.minEasting });
    levels.get(tile.lod).tiles.push(entry);
  }
  /* index each level as a lattice of whole tiles so a lookup is arithmetic */
  const indexed = [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([lod, level]) => {
    const minEasting = Math.min(...level.tiles.map(t => t.minEasting));
    const maxEasting = Math.max(...level.tiles.map(t => t.maxEasting));
    const minNorthing = Math.min(...level.tiles.map(t => t.minNorthing));
    const maxNorthing = Math.max(...level.tiles.map(t => t.maxNorthing));
    const columns = Math.round((maxEasting - minEasting) / level.span);
    const rows = Math.round((maxNorthing - minNorthing) / level.span);
    const cells = new Array(columns * rows).fill(null);
    for (const tile of level.tiles) {
      const column = Math.round((tile.minEasting - minEasting) / level.span);
      const row = Math.round((maxNorthing - tile.maxNorthing) / level.span);
      cells[row * columns + column] = tile;
    }
    return { lod, span: level.span, minEasting, maxEasting, minNorthing, maxNorthing, columns, rows, cells };
  });

  function sampleTile(entry, easting, northing) {
    const { grid, heights } = entry;
    const x = (easting - entry.minEasting) / grid.sampleSpacingMetres;
    const y = (entry.maxNorthing - northing) / grid.sampleSpacingMetres;
    const cx = Math.min(grid.width - 2, Math.max(0, Math.floor(x)));
    const cy = Math.min(grid.height - 2, Math.max(0, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - cx));
    const fy = Math.min(1, Math.max(0, y - cy));
    const h00 = heights[cy * grid.width + cx];
    const h10 = heights[cy * grid.width + cx + 1];
    const h01 = heights[(cy + 1) * grid.width + cx];
    const h11 = heights[(cy + 1) * grid.width + cx + 1];
    if (Number.isNaN(h00) || Number.isNaN(h10) || Number.isNaN(h01) || Number.isNaN(h11)) return Number.NaN;
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  function tileFor(level, easting, northing) {
    if (easting < level.minEasting || easting > level.maxEasting ||
        northing < level.minNorthing || northing > level.maxNorthing) return null;
    const column = Math.min(level.columns - 1, Math.max(0, Math.floor((easting - level.minEasting) / level.span)));
    const row = Math.min(level.rows - 1, Math.max(0, Math.floor((level.maxNorthing - northing) / level.span)));
    return level.cells[row * level.columns + column];
  }

  return Object.freeze({
    levels: indexed.map(level => ({
      lod: level.lod, tiles: level.cells.filter(Boolean).length, spacing: level.cells.find(Boolean).grid.sampleSpacingMetres,
      bounds: { minEasting: level.minEasting, maxEasting: level.maxEasting, minNorthing: level.minNorthing, maxNorthing: level.maxNorthing },
    })),
    /** Height at the finest level covering the point, with the level it came from. */
    sample(easting, northing) {
      for (const level of indexed) {
        const tile = tileFor(level, easting, northing);
        if (!tile) continue;
        const height = sampleTile(tile, easting, northing);
        return { heightRH2000: height, lod: level.lod };
      }
      return null;
    },
    heightAt(easting, northing) {
      const hit = this.sample(easting, northing);
      return hit ? hit.heightRH2000 : null;
    },
    /** Height at one named level only, or null where that level has no tile. */
    heightAtLevel(lod, easting, northing) {
      const level = indexed.find(entry => entry.lod === lod);
      if (!level) return null;
      const tile = tileFor(level, easting, northing);
      return tile ? sampleTile(tile, easting, northing) : null;
    },
  });
}

/** Read a ground graph from a public directory: the manifest and a byte reader for its chunks. */
export function openPublishedGround(fs, path, publicDir, groundId) {
  const rootIndex = JSON.parse(fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'), 'utf8'));
  const entry = rootIndex.courses.find(course => course.groundId === groundId);
  if (!entry) throw new Error(`v2 root index has no course on ground ${groundId}`);
  const courseManifest = JSON.parse(fs.readFileSync(path.join(publicDir, entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(publicDir, courseManifest.groundManifest.url), 'utf8'));
  if (ground.groundId !== groundId) throw new Error(`course ${entry.slug} is on ground ${ground.groundId}`);
  const readAsset = url => fs.readFileSync(path.join(publicDir, url));
  return { ground, courseManifest, rootEntry: entry, readAsset };
}
