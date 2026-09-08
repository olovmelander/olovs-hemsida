#!/usr/bin/env node
/* Fold the wide OSM land cover into the committed model.

   Same reason `apply-tee-marks.mjs` exists: `build-course.mjs` cannot run in a
   checkout without the acquired 1 m raster it pins by sha256, so the committed
   model is updated through the generator's OWN exported rule -- `vistaLandcover`
   -- and `course.node-test.mjs` re-derives it a third time and demands equality.
   Nothing here is a second implementation.

     node visbybuild/mapping/apply-vista-landcover.mjs [--write] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vistaLandcover } from '../build-course.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const MODEL = path.join(HERE, '..', 'course-model.json');
const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
const collection = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/visby/mapping/osm-vista-landcover-epsg3006.geojson'), 'utf8'));
const { vegetation, landuse } = vistaLandcover(collection);

model.vegetation = vegetation;
model.infra.landuse = landuse;
for (const [kind, rings] of Object.entries(vegetation)) console.log(`vegetation.${kind.padEnd(8)} ${rings.length}`);
const kinds = landuse.reduce((counts, item) => ({ ...counts, [item.kind]: (counts[item.kind] ?? 0) + 1 }), {});
console.log(`infra.landuse ${landuse.length}: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(', ')}`);

if (process.argv.includes('--write')) {
  fs.writeFileSync(MODEL, `${JSON.stringify(model, null, 2)}\n`);
  console.log(`wrote ${MODEL}`);
} else console.log('dry run; pass --write to apply');
