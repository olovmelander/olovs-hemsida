#!/usr/bin/env node
/* Dump a 1 m RH 2000 raster over the Visby frame from the PUBLISHED ring graph.

   The laser DTM is not reachable here -- dl1 answers 401/403 for this account --
   but the published graph IS that DTM: its finest level is the acquired 1 m
   window, sample for sample. So a tracing tool that needs bare-earth height
   reads it back out of the chunks the app itself drapes, which is also the
   only reading that cannot disagree with what a player sees.

   Writes a raw Float32 plane plus a JSON header beside it, both under the
   ignored cache -- they are derived from committed bytes and re-derivable.

   usage: node visbybuild/mapping/dump-dtm.mjs [x0 z0 x1 z1] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPublishedGround, createPublishedGroundLookup } from '../../packages/course-v2/published-ground-lookup.mjs';
import { VISBY_FRAME } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', '..', 'apps', 'golf', 'public');
const OUT = path.join(HERE, '..', 'cache', 'dtm');
fs.mkdirSync(OUT, { recursive: true });

const [x0, z0, x1, z1] = process.argv.length > 5 ? process.argv.slice(2, 6).map(Number) : [-1200, -1400, 1200, 900];
const { ground, readAsset } = openPublishedGround(fs, path, PUBLIC, 'visby');
const lookup = createPublishedGroundLookup(ground, readAsset);

const cols = Math.round(x1 - x0), rows = Math.round(z1 - z0);
const plane = new Float32Array(cols * rows);
let finite = 0, min = Infinity, max = -Infinity;
for (let row = 0; row < rows; row++) {
  const northing = VISBY_FRAME.northing - (z0 + row + 0.5);
  for (let col = 0; col < cols; col++) {
    const height = lookup.heightAt(VISBY_FRAME.easting + x0 + col + 0.5, northing);
    const value = Number.isFinite(height) ? height : NaN;
    if (Number.isFinite(value)) { finite++; if (value < min) min = value; if (value > max) max = value; }
    plane[row * cols + col] = value;
  }
}
fs.writeFileSync(path.join(OUT, 'dtm-1m.f32'), Buffer.from(plane.buffer));
fs.writeFileSync(path.join(OUT, 'dtm-1m.json'), JSON.stringify({
  x0, z0, cols, rows, metres: 1, frame: { easting: VISBY_FRAME.easting, northing: VISBY_FRAME.northing },
  source: 'apps/golf/public published ground graph "visby", finest level covering each point',
  finite, coveredFraction: +(finite / plane.length).toFixed(6),
  heightRangeRH2000: [+min.toFixed(4), +max.toFixed(4)],
}, null, 2) + '\n');
console.log(`${cols}x${rows} at 1 m, ${finite} finite (${(100 * finite / plane.length).toFixed(2)}%), ${min.toFixed(3)}..${max.toFixed(3)} m RH2000`);
