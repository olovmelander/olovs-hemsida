#!/usr/bin/env node
/* Name the clubhouse in the committed model.

   The engine finds a clubhouse by `amenity=clubhouse` or a name matching
   golfklubb|klubbhus, and OSM tags NONE of this property's seven buildings with
   either -- there is no `amenity=clubhouse` in the whole extract -- so the
   clubhouse rendered as one of 32 anonymous grey houses with no levelled bench,
   no mown apron, no clubhouse look and no K marker on the map.

   Which building it is now comes from `mapping/geometry.json`, where a reviewed
   assertion belongs; `build-course.mjs` reads it there and this applies the same
   thing to the committed model, which the generator cannot rebuild in a checkout
   without the acquired raster it pins by sha256. `course.node-test.mjs` asserts
   the model against geometry.json, so the two cannot drift.

     node visbybuild/mapping/apply-clubhouse.mjs [--write] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.join(HERE, '..', 'course-model.json');
const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
const geometry = JSON.parse(fs.readFileSync(path.join(HERE, 'geometry.json'), 'utf8'));
const wanted = geometry.clubhouseWayId;
if (!wanted) throw new Error('geometry.json declares no clubhouseWayId');

let named = 0;
for (const building of model.infra.buildings) {
  if (building.id !== wanted) continue;
  building.amenity = 'clubhouse';
  building.name = building.name || 'Klubbhus, Visby GK';
  /* the clubhouse takes its height from the course's own scenery module, which
     read it off photographs; a generic 5 m would flatten a two-storey block */
  building.h = 0;
  named++;
  const ring = building.ring;
  const centre = ring.reduce((sum, point) => [sum[0] + point[0] / ring.length, sum[1] + point[1] / ring.length], [0, 0]);
  console.log(`${building.id} named clubhouse at (${centre[0].toFixed(0)}, ${centre[1].toFixed(0)})`);
}
if (named !== 1) throw new Error(`expected exactly one building ${wanted}; found ${named}`);
if (process.argv.includes('--write')) {
  fs.writeFileSync(MODEL, `${JSON.stringify(model, null, 2)}\n`);
  console.log(`wrote ${MODEL}`);
} else console.log('dry run; pass --write to apply');
