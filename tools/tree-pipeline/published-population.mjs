/* The trees the live player plants today on the inner frontier, recovered on
   the CPU from the published ground: individual records from the finest
   tiles' object chunks, and the stand trees planV2Vegetation draws from the
   stand fields, at their deterministic hashed positions (the same hash01,
   allometry and planting constants the runtime imports). The runtime's
   played-surface predicate (excludeAt) needs the GPK1 classifier and is not
   reproduced: stand trees it would refuse on fairways/greens are still listed
   here, which only matters where a stand cell touches a played surface. */
import fs from 'node:fs';
import path from 'node:path';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { STAND_FLAG_EXCLUDED, STAND_FLAG_MEASURED, decodeStandField } from '../../packages/course-v2/stand-field.mjs';
import { STAND_PLANTING, crownRadiusForHeight, hash01 } from '../../apps/golf/src/engine/v2-vegetation.mjs';

/** The ground the root serves now, or a named earlier generation (kept on disk for rollback). */
export function publishedGround(ctx, groundManifestUrl = null) {
  const publicDir = ctx.paths.publicDir;
  const rootIndex = JSON.parse(fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'), 'utf8'));
  const entry = rootIndex.courses.find(course => course.groundId === ctx.groundId);
  const course = JSON.parse(fs.readFileSync(path.join(publicDir, entry.manifest.url), 'utf8'));
  const url = groundManifestUrl || course.groundManifest.url;
  const ground = JSON.parse(fs.readFileSync(path.join(publicDir, url), 'utf8'));
  return { publicDir, groundManifestUrl: url, ground };
}

export function publishedPopulation(ctx, { bbox = null, groundManifestUrl: requested = null } = {}) {
  const { publicDir, groundManifestUrl, ground } = publishedGround(ctx, requested);
  const inside = (e, n) => !bbox || (e >= bbox[0] && e < bbox[2] && n >= bbox[1] && n < bbox[3]);
  const records = [];
  const standTrees = [];
  for (const tile of ground.tiles.filter(t => t.lod === 0)) {
    const b = tile.bounds;
    if (bbox && (b.maxEasting <= bbox[0] || b.minEasting >= bbox[2] || b.maxNorthing <= bbox[1] || b.minNorthing >= bbox[3])) continue;
    if (tile.layers.objects) {
      const chunk = readChunk(fs.readFileSync(path.join(publicDir, tile.layers.objects.url)));
      for (const record of chunk.content.records) if (record.class === 'tree' && inside(record.easting, record.northing)) records.push({ ...record, tile: tile.id });
    }
    if (tile.layers.stands) {
      const chunk = readChunk(fs.readFileSync(path.join(publicDir, tile.layers.stands.url)));
      const field = decodeStandField(chunk.payload, chunk.header.standField);
      const P = STAND_PLANTING;
      const area = field.cellMetres * field.cellMetres;
      for (let row = 0; row < field.height; row++) for (let column = 0; column < field.width; column++) {
        const i = row * field.width + column;
        const flags = field.flags[i];
        if (!(flags & STAND_FLAG_MEASURED) || (flags & STAND_FLAG_EXCLUDED)) continue;
        const fraction = field.fraction[i];
        const mean = field.meanHeight[i];
        if (fraction < P.minimumFraction || mean < P.minimumHeightMetres) continue;
        const ce0 = b.minEasting + column * field.cellMetres;
        const cn0 = b.maxNorthing - row * field.cellMetres;
        const ce = Math.round(ce0), cn = Math.round(cn0);
        const radius = crownRadiusForHeight(mean, P.allometry);
        const expected = (fraction * area / (Math.PI * radius * radius)) * P.overlapFactor;
        const count = Math.floor(expected) + (hash01(ce, cn, 1) < expected - Math.floor(expected) ? 1 : 0);
        const p95 = Math.max(field.p95Height[i], mean);
        for (let k = 0; k < count; k++) {
          const easting = ce0 + hash01(ce, cn, 11 + k * 5) * field.cellMetres;
          const northing = cn0 - hash01(ce, cn, 12 + k * 5) * field.cellMetres;
          if (!inside(easting, northing)) continue;
          const height = Math.min(p95 * 1.05, Math.max(P.minimumHeightMetres, mean * (0.8 + 0.4 * hash01(ce, cn, 13 + k * 5))));
          standTrees.push({ easting, northing, objectHeightMetres: height, radiusMetres: crownRadiusForHeight(height, P.allometry) * (0.85 + 0.3 * hash01(ce, cn, 14 + k * 5)), tile: tile.id, kind: 'stand' });
        }
      }
    }
  }
  return { groundManifestUrl, records, standTrees };
}
