/* Rebuild the acquired 1 m window from the PUBLISHED ground tiles.

   build-course.mjs reads lidingobuild/cache/terrain-review/terrain-1m.f32, the
   raster the credentialed acquisition left behind, and that cache is gitignored
   - so on a fresh checkout the model cannot be rebuilt at all without a
   Lantmäteriet account, even though the pinned sha256 says exactly which bytes
   are wanted.

   It half does not need one, and this tool exists to say which half. The
   published level-0 tiles ARE that window: 64 tiles
   of 257 x 257 samples on the same 1 m lattice, and the ring acquisition
   measured them back against the source at a maximum difference of 0.005 m,
   which is one quantum of their own encoding. This walks the tiles back into
   the 2049 x 2049 raster and REFUSES unless the result hashes to the pinned
   value.

   MEASURED: it covers the window completely - 4,198,401 of 4,198,401 samples,
   none missing - and it does not reproduce the bytes, because the tiles are
   quantised at 0.01 m. So the terrain's SHAPE is fully recoverable from this
   repository with no credential, and the acquisition's BYTES are not. A
   credential-less session may therefore measure against this ground
   (dump-dtm-window.mjs) but may not rebuild course-model.json, whose
   sourceFloat32Sha256 pin is the contract saying which bytes it was built on.
   Loosening that pin to accept a reconstruction would make the checksum agree
   with whatever it was handed, which is not a checksum.

     node lidingobuild/mapping/rebuild-terrain-raster.mjs                      */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../packages/course-v2/terrain-grid.mjs';
import { openPublishedGround } from '../../packages/course-v2/published-ground-lookup.mjs';
import { LIDINGO_GROUND_GRAPH_CONFIG as CONFIG } from '../../packages/course-v2/lidingo-ground-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'lidingobuild/cache/terrain-review/terrain-1m.f32');

const { ground, readAsset } = openPublishedGround(fs, path, 'apps/golf/public', 'lidingo');
const { width, height, originEasting, originNorthing, sampleSpacingMetres: step } = CONFIG;
const values = new Float32Array(width * height).fill(NaN);
let written = 0; let tiles = 0;
for (const tile of ground.tiles) {
  if (tile.lod !== 0) continue;
  const chunk = readChunk(readAsset(tile.layers.terrain.url));
  const grid = chunk.header.grid;
  const heights = decodeTerrainGrid(chunk.payload, grid);
  const size = grid.size ?? Math.round(Math.sqrt(heights.length));
  const spacing = grid.sampleSpacingMetres ?? grid.spacingMetres ?? step;
  if (spacing !== step) throw new Error(`tile ${tile.id} is ${spacing} m, not ${step} m`);
  tiles += 1;
  for (let row = 0; row < size; row += 1) {
    const northing = tile.bounds.maxNorthing - row * spacing;
    const gy = Math.round((originNorthing - northing) / step);
    if (gy < 0 || gy >= height) continue;
    for (let column = 0; column < size; column += 1) {
      const easting = tile.bounds.minEasting + column * spacing;
      const gx = Math.round((easting - originEasting) / step);
      if (gx < 0 || gx >= width) continue;
      const v = heights[row * size + column];
      if (!Number.isFinite(v)) continue;
      if (Number.isNaN(values[gy * width + gx])) written += 1;
      values[gy * width + gx] = v;
    }
  }
}
const missing = values.reduce((n, v) => n + (Number.isNaN(v) ? 1 : 0), 0);
const bytes = Buffer.from(values.buffer);
const sha = createHash('sha256').update(bytes).digest('hex');
/* If an existing acquisition is on disk, say how far the reconstruction is
   from it in METRES, which is the number that matters, rather than only that
   two hashes differ. */
let difference = null;
if (fs.existsSync(OUT)) {
  const original = new Float32Array(fs.readFileSync(OUT).buffer.slice(0));
  let worst = 0; let sum = 0; let n = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(original[i]) || !Number.isFinite(values[i])) continue;
    const d = Math.abs(original[i] - values[i]);
    if (d > worst) worst = d;
    sum += d; n += 1;
  }
  difference = { comparedSamples: n, meanMetres: +(sum / n).toFixed(6), maximumMetres: +worst.toFixed(6) };
}
console.log(JSON.stringify({ tiles, samples: width * height, written, missing, sha256: sha,
  pinned: CONFIG.sourceFloat32Sha256, matchesPinned: sha === CONFIG.sourceFloat32Sha256, difference }));
if (missing) throw new Error(`${missing} samples of the 1 m window are not covered by the published level-0 tiles`);
if (sha !== CONFIG.sourceFloat32Sha256) {
  /* MEASURED, and this is the useful part of the answer: the 64 published
     level-0 tiles cover the acquired window completely - 4,198,401 of
     4,198,401 samples, none missing - so the SHAPE of the terrain is fully
     recoverable from the repository with no credential at all. What is not
     recoverable is the BYTES: the tiles are quantised at their 0.01 m height
     scale, so every sample comes back within a quantum and none of them comes
     back identical.

     That distinction decides what a credential-less session may do here. It may
     measure against this terrain, and lidingobuild/mapping/dump-dtm-window.mjs
     exists for exactly that. It may NOT rebuild course-model.json, because
     assertLidingoAcquisition pins sourceFloat32Sha256 and that pin is the
     contract saying which bytes the model was built on. Loosening the pin to
     accept a reconstruction would make the checksum agree with whatever it was
     handed, which is not a checksum. */
  throw new Error('the rebuilt raster reproduces the acquired window to within one encoding quantum but is NOT '
    + 'the same bytes, so it cannot stand in where sourceFloat32Sha256 is the contract. It is not written. '
    + 'Use dump-dtm-window.mjs to MEASURE against this terrain; rebuilding the model needs the acquisition.');
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, bytes);
console.log(`wrote ${path.relative(ROOT, OUT)} — reproduces the pinned acquisition exactly`);
