#!/usr/bin/env node
/* Where the 2021 laser canopy no longer stands: clear-fells read off the
   2026-05-02 orthophoto BY RULE, as exclusion polygons for the stand compiler.

   The stand field is the April 2021 laser canopy, and the render plants trees
   wherever it reads 3 m of canopy. Measured cell by cell against the 2026
   image over the course window (cache/forest-audit2.mjs), 17% of the planted
   cells are open ground today: a 3 ha clear-fell east of the 6th and 7th with
   its slash and machine tracks in plain view, a thinned block west of the 3rd,
   a storm-cleared strip north-west of the 5th. Five years of forestry.

   The rule is deliberately one-sided. A 2021 canopy cell is called FELLED only
   where the 2026 image is unambiguously open: bright (median brightness over
   the 4 m cell of 88 or more -- forest floor under crowns reads 47-75 at its
   10th-90th percentile, the clear-fell's slash 88-105, measured in
   cache/fell-calib.mjs) and with no dark canopy to speak of (under 10% of its
   0.32 m samples darker than 70; intact forest reads 22-97%, a forest edge 6-67%). A cell that
   is merely shaded, or a crown that has thinned, stays laser canopy. Felled
   cells are closed by one cell (stumps and brash shade odd cells), opened by
   one to drop edge noise, and only components of 600 m² or more are kept, because a
   stand field's cell is 4 m and a single lost crown is not forestry.

   Nothing is ADDED: canopy the image shows and the laser lacks (young growth
   since 2021, and a great deal of shadow) is left to the laser, which is the
   measured record. Removal needs only the newer picture.

   Writes mapping/canopy-changes-2026.geojson (kind "override", the exclusion
   class with no buffer) and cache/review/canopy-changes.png over the mosaic. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadReviewMosaic, brightness, toEpsg, toLocal, components, traceOuterRing, simplifyRing, ringArea, dilate, erode } from './lib/imagery.mjs';
import { loadCanopy } from './lib/rasters.mjs';
import { Canvas } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CELL = 4;
const X0 = -600, X1 = 640, Z0 = -1300, Z1 = 1300;          /* the whole mosaic that holds canopy */
const BRIGHT_MIN = 88, DARK_MAX = 0.10, CANOPY_MIN = 3, MIN_AREA = 600, OPEN_R = 1;
const mosaic = loadReviewMosaic();
const chm = loadCanopy();
const W = Math.round((X1 - X0) / CELL), H = Math.round((Z1 - Z0) / CELL);
const felled = new Uint8Array(W * H), laser = new Uint8Array(W * H);
let laserCells = 0, felledCells = 0;
for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
  const x = X0 + col * CELL, z = Z0 + row * CELL;
  let hm = 0, hn = 0;
  for (let dz = 0; dz < CELL; dz++) for (let dx = 0; dx < CELL; dx++) { const v = chm.at(x + dx + 0.5, z + dz + 0.5); if (Number.isFinite(v)) { hm += v; hn++; } }
  if (!hn || hm / hn < CANOPY_MIN) continue;
  laser[row * W + col] = 1; laserCells++;
  const b = [];
  let dark = 0;
  for (let dz = 0.16; dz < CELL; dz += 0.64) for (let dx = 0.16; dx < CELL; dx += 0.64) { const c = mosaic.rgbLocal(x + dx, z + dz); if (!c) continue; const v = brightness(c); b.push(v); if (v < 70) dark++; }
  if (b.length < 20) continue;
  b.sort((p, q) => p - q);
  if (b[b.length >> 1] >= BRIGHT_MIN && dark / b.length < DARK_MAX) { felled[row * W + col] = 1; felledCells++; }
}
/* close by one cell first (a felled field is speckled with stumps and brash that shade a cell here and there), then open by one to drop edge noise */
const closed = erode(dilate(felled, W, H, 1), W, H, 1);
const opened = dilate(erode(closed, W, H, OPEN_R), W, H, OPEN_R);
const comp = components(opened, W, H);
const features = [];
for (let c = 1; c <= comp.count; c++) {
  const area = comp.sizes[c] * CELL * CELL;
  if (area < MIN_AREA) continue;
  let seed = -1; for (let i = 0; i < opened.length; i++) if (comp.labels[i] === c) { seed = i; break; }
  const outline = traceOuterRing(i => comp.labels[i] === c, W, H, seed).map(([px, py]) => [X0 + px * CELL, Z0 + py * CELL]);
  const ring = simplifyRing(outline, 1.5);
  if (ring.length < 4) continue;
  let sx = 0, sz = 0; for (const [x, z] of ring) { sx += x; sz += z; }
  features.push({ type: 'Feature', id: `tortuna-felled-2026-${features.length + 1}`, properties: { kind: 'override', reason: 'clear-fell-or-cleared-after-2021-laser', sourceId: 'imagery-lm-ortho', sourceCollection: 'orto-n2-2026', captureDate: '2026-05-02', observedYear: 2026,
    method: `2021 canopy cells (CHM >= ${CANOPY_MIN} m over a 4 m cell) whose 2026 image is open: median brightness >= ${BRIGHT_MIN} and under ${DARK_MAX * 100}% of 0.32 m samples darker than 70; 8 m opening; components >= ${MIN_AREA} m²`,
    reviewStatus: 'agent-rule-based-review; human-review-pending', areaSquareMetres: Math.round(ringArea(ring)), centreLocal: [Math.round(sx / ring.length), Math.round(sz / ring.length)], canopyExclusion: true, notSurveyed: true },
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]].map(toEpsg).map(p => p.map(v => Math.round(v * 100) / 100))] } });
}
features.sort((a, b) => b.properties.areaSquareMetres - a.properties.areaSquareMetres);
features.forEach((f, i) => { f.id = `tortuna-felled-2026-${i + 1}`; });
const total = features.reduce((s, f) => s + f.properties.areaSquareMetres, 0);
console.log(`laser canopy ${(laserCells * 16 / 1e4).toFixed(1)} ha in the window; open in 2026 ${(felledCells * 16 / 1e4).toFixed(1)} ha of cells; ${features.length} felled polygons of ${MIN_AREA} m² or more, ${(total / 1e4).toFixed(2)} ha`);
for (const f of features.slice(0, 12)) console.log(`  ${f.id} ${f.properties.areaSquareMetres} m² at (${f.properties.centreLocal})`);

/* review picture over the mosaic at 1.28 m/px */
const px = 1.28;
const cw = Math.round((X1 - X0) / px), ch = Math.round((Z1 - Z0) / px);
const canvas = new Canvas(cw, ch);
for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) { const rgb = mosaic.rgbLocal(X0 + (c + 0.5) * px, Z0 + (r + 0.5) * px); if (rgb) canvas.data.set(rgb, (r * cw + c) * 3); }
const toPx = ([x, z]) => [(x - X0) / px, (z - Z0) / px];
for (const f of features) canvas.polyline(f.geometry.coordinates[0].map(toLocal).map(toPx), [255, 60, 60], 0.95, true, 2);
fs.mkdirSync(path.join(HERE, 'cache', 'review'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'cache', 'review', 'canopy-changes.png'), canvas.toPng());
const out = { type: 'FeatureCollection', name: 'tortuna-canopy-changes-2026', crs: { type: 'name', properties: { name: 'EPSG:3006' } }, axisOrder: ['easting', 'northing'],
  source: { windows: Object.fromEntries(mosaic.windows.map(w => [w.id, { file: w.file, boundsEpsg3006: w.boundsEpsg3006, metres: w.metres, sha256: createHash('sha256').update(fs.readFileSync(path.join(HERE, 'cache', w.file))).digest('hex') }])), canopy: 'tortunabuild/cache/expanded-canopy/chm.f32 (2021-04-05)' },
  rule: { brightMin: BRIGHT_MIN, darkMax: DARK_MAX, canopyMinMetres: CANOPY_MIN, minAreaSquareMetres: MIN_AREA, cellMetres: CELL, openingMetres: OPEN_R * 2 * CELL },
  generatedOn: new Date().toISOString().slice(0, 10), script: 'tortunabuild/trace-canopy-changes.mjs', totalAreaSquareMetres: total, features };
fs.writeFileSync(path.join(HERE, 'mapping', 'canopy-changes-2026.geojson'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote mapping/canopy-changes-2026.geojson and cache/review/canopy-changes.png');
