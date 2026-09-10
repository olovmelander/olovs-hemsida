#!/usr/bin/env node
/* Recompute Visby's numbered tee marks in the committed model.

   `build-course.mjs` is the generator, and it cannot run in every checkout:
   it reads the acquired 1 m Float32 terrain from the ignored cache and
   asserts its pinned sha256, which a raster synthesised from the published
   graph cannot reproduce byte for byte. So this applies the SAME exported
   rule -- `teeMarks` -- to `course-model.json` in place, and
   `course.node-test.mjs` re-derives it a third time and demands equality, so
   the model and its generator cannot drift apart. That is the trap this file
   exists to close: the sea flags were once applied to the model alone, and a
   later generator run would have silently written them back.

   Elevation moves with the marks: `elev.tee` is sampled at the 59 tee, which
   is now a different point from the 63 tee. It is re-read from the published
   ground graph -- the same laser DTM the acquired raster was cut from -- and
   the change against the committed value is printed so it can be reviewed.

     node visbybuild/mapping/apply-tee-marks.mjs [--write] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, pointInPoly, polyLen } from '../../geobuild/lib.mjs';
import { teeMarks } from '../build-course.mjs';
import { openPublishedGround, createPublishedGroundLookup } from '../../packages/course-v2/published-ground-lookup.mjs';
import { VISBY_FRAME, local } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.join(HERE, '..', 'course-model.json');
const write = process.argv.includes('--write');
const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
const geometry = JSON.parse(fs.readFileSync(path.join(HERE, 'geometry.json'), 'utf8'));
const card = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'reference', 'club-scorecard.json'), 'utf8'));

const { ground, readAsset } = openPublishedGround(fs, path, path.join(HERE, '..', '..', 'apps', 'golf', 'public'), 'visby');
const lookup = createPublishedGroundLookup(ground, readAsset);
const heightAt = (x, z) => lookup.heightAt(VISBY_FRAME.easting + x, VISBY_FRAME.northing - z);
const round1 = value => Math.round(value * 10) / 10;

let moved = 0, distinct = 0;
for (const hole of model.holes) {
  const unresolvedPlatform = hole.tees.status === 'unresolved-physical-platform';
  const centres = hole.tees.pads.map(pad => centroid(pad.ring));
  const nearest = unresolvedPlatform ? hole.tees.marks[0].c
    : [...centres].sort((a, b) => Math.hypot(a[0] - hole.line[0][0], a[1] - hole.line[0][1])
                                - Math.hypot(b[0] - hole.line[0][0], b[1] - hole.line[0][1]))[0];
  const marks = teeMarks({
    line: hole.line, lineLen: polyLen(hole.line), lengths: hole.t, nearest,
    pads: hole.tees.pads, unresolvedPlatform,
    referenceReview: card.tees.map(tee => geometry.holes.find(source => source.n === hole.n).tees.referenceReview?.[tee.id] ?? null),
    references: card.tees.map(tee => {
      const point = geometry.holes.find(source => source.n === hole.n).tees.references?.[tee.id];
      return point ? local(point) : null;
    }), hole: hole.n,
  });
  moved += marks.filter((mark, index) => Math.hypot(mark.c[0] - hole.tees.marks[index].c[0],
                                                    mark.c[1] - hole.tees.marks[index].c[1]) > 0.5).length;
  const unique = new Set(marks.map(mark => mark.c.join(',')));
  distinct += unique.size;
  const teeHeight = round1(heightAt(...marks[1].c)), greenHeight = round1(heightAt(...hole.pin));
  const before = hole.elev.tee;
  hole.tees.marks = marks;
  hole.elev = { tee: teeHeight, green: greenHeight, rise: round1(greenHeight - teeHeight) };
  const onPad = marks.filter(mark => hole.tees.pads.some(pad => pointInPoly(...mark.c, pad.ring))).length;
  console.log(`h${String(hole.n).padStart(2)} distinct=${unique.size}/6 onObservedPad=${onPad}/6 `
    + `walk=${(hole.t[0] - hole.t[5]).toFixed(0)} m  elev.tee ${before} -> ${teeHeight}`);
}
console.log(`\n${moved} of 108 marks move; ${distinct} distinct points, was 18`);
if (write) {
  fs.writeFileSync(MODEL, `${JSON.stringify(model, null, 2)}\n`);
  console.log(`wrote ${MODEL}`);
} else console.log('dry run; pass --write to apply');
