/* Dump the published ground graph over the WHOLE level-0 window (and a wider
   2 m context), for the shoreline work.

   `dump-dtm-window.mjs` dumps the ORTHOPHOTO's window, which is 1190 x 1370 m
   and whose minimum height is 1.955 m RH 2000 -- it holds no sea at all. The
   sea break-geometry (`lm-658-67-water-14`) was clipped to a 2048 m box about
   the model origin and every one of its three parts falls OUTSIDE that
   orthophoto window, so a shoreline cannot be measured on it. This dumps the
   level-0 ring itself, E 676676.5..678724.5 / N 6585375.5..6587423.5, which is
   the same 2048 m box the water was clipped to, plus a 4096 m level-1 context
   so the plate can be followed past the fine window's edge.

   node lidingobuild/mapping/dump-dtm-coast.mjs                                */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPublishedGroundLookup, openPublishedGround } from '../../packages/course-v2/published-ground-lookup.mjs';

const OUT = 'lidingobuild/cache/coast-2025';
const opened = openPublishedGround(fs, path, 'apps/golf/public', 'lidingo');
const lookup = createPublishedGroundLookup(opened.ground, opened.readAsset);
fs.mkdirSync(OUT, { recursive: true });

const windows = [
  { name: 'fine', lod: 0, spacing: 1, bounds: lookup.levels[0].bounds },
  { name: 'context', lod: 1, spacing: 2, bounds: lookup.levels[1].bounds },
];
const report = { levels: lookup.levels, windows: [] };
for (const w of windows) {
  /* sample CENTRES: a level's bounds are pixel edges, the lattice sits half a
     sample inside them */
  const minEasting = w.bounds.minEasting + w.spacing / 2;
  const maxNorthing = w.bounds.maxNorthing - w.spacing / 2;
  const width = Math.round((w.bounds.maxEasting - w.bounds.minEasting) / w.spacing);
  const height = Math.round((w.bounds.maxNorthing - w.bounds.minNorthing) / w.spacing);
  const values = new Float32Array(width * height);
  const lods = new Uint8Array(width * height);
  let finite = 0; let minimum = Infinity; let maximum = -Infinity;
  for (let row = 0; row < height; row += 1) {
    const northing = maxNorthing - row * w.spacing;
    for (let column = 0; column < width; column += 1) {
      const hit = lookup.sample(minEasting + column * w.spacing, northing);
      const v = hit && Number.isFinite(hit.heightRH2000) ? hit.heightRH2000 : NaN;
      values[row * width + column] = v;
      lods[row * width + column] = hit ? hit.lod : 255;
      if (Number.isFinite(v)) { finite += 1; if (v < minimum) minimum = v; if (v > maximum) maximum = v; }
    }
  }
  const bytes = Buffer.from(values.buffer);
  fs.writeFileSync(path.join(OUT, `dtm-${w.name}.f32`), bytes);
  fs.writeFileSync(path.join(OUT, `dtm-${w.name}.lod.u8`), Buffer.from(lods.buffer));
  report.windows.push({
    name: w.name, sampleSpacingMetres: w.spacing, width, height,
    northwestSampleCentre: { easting: minEasting, northing: maxNorthing },
    pixelEdgeWindow: w.bounds, samples: width * height, finite,
    minimumHeightRH2000: Number(minimum.toFixed(3)), maximumHeightRH2000: Number(maximum.toFixed(3)),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
fs.writeFileSync(path.join(OUT, 'dtm.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.windows, null, 1));
