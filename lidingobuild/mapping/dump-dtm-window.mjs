/* Dump a 1 m RH 2000 raster over the review window from the PUBLISHED ground
   graph, so the colour work and the shape work read the same terrain the app
   drapes. The published chunks are committed, so this needs no credential and
   cannot drift from what is rendered.

   node lidingobuild/mapping/dump-dtm-window.mjs [--out <dir>]                */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPublishedGroundLookup, openPublishedGround } from '../../packages/course-v2/published-ground-lookup.mjs';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'lidingobuild/cache/terrain-review';
/* the orthophoto's own requested EPSG:3006 coverage, so the two rasters
   describe exactly the same ground */
const WINDOW = { minEasting: 677060, minNorthing: 6585730, maxEasting: 678250, maxNorthing: 6587100 };
const SPACING = 1;

const opened = openPublishedGround(fs, path, 'apps/golf/public', 'lidingo');
const lookup = createPublishedGroundLookup(opened.ground, opened.readAsset);
const width = Math.round((WINDOW.maxEasting - WINDOW.minEasting) / SPACING) + 1;
const height = Math.round((WINDOW.maxNorthing - WINDOW.minNorthing) / SPACING) + 1;
const values = new Float32Array(width * height);
let finite = 0; let minimum = Infinity; let maximum = -Infinity;
for (let row = 0; row < height; row += 1) {
  const northing = WINDOW.maxNorthing - row * SPACING;
  for (let column = 0; column < width; column += 1) {
    const value = lookup.heightAt(WINDOW.minEasting + column * SPACING, northing);
    const v = Number.isFinite(value) ? value : NaN;
    values[row * width + column] = v;
    if (Number.isFinite(v)) { finite += 1; if (v < minimum) minimum = v; if (v > maximum) maximum = v; }
  }
}
fs.mkdirSync(OUT, { recursive: true });
const bytes = Buffer.from(values.buffer);
fs.writeFileSync(path.join(OUT, 'review-dtm-1m.f32'), bytes);
const sidecar = {
  schemaVersion: 1, groundId: 'lidingo', source: 'published v2 ground graph (finest covering level per sample)',
  groundManifest: path.basename(opened.rootEntry?.url || ''), horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
  sampleSpacingMetres: SPACING, width, height, northwestSampleCentre: { easting: WINDOW.minEasting, northing: WINDOW.maxNorthing },
  window: WINDOW, format: 'row-major little-endian Float32, north-up', samples: width * height, finite,
  minimumHeightRH2000: Number(minimum.toFixed(3)), maximumHeightRH2000: Number(maximum.toFixed(3)),
  sha256: createHash('sha256').update(bytes).digest('hex'),
};
fs.writeFileSync(path.join(OUT, 'review-dtm-1m.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
console.log(JSON.stringify({ width, height, finite, samples: width * height, min: sidecar.minimumHeightRH2000, max: sidecar.maximumHeightRH2000 }));
