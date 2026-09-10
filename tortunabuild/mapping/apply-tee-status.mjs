#!/usr/bin/env node
/* Stamp `tees.status` on the committed model through the generator's own
   rule (teeStatus in build-course.mjs), for the same reason apply-guide-notes
   exists: build-course cannot run without the private 1 m raster it pins.
     node tortunabuild/mapping/apply-tee-status.mjs [--write] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { teeStatus } from '../build-course.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.join(HERE, '..', 'course-model.json');
const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
const input = JSON.parse(fs.readFileSync(path.join(HERE, 'course-input.json'), 'utf8'));
let changed = 0;
for (const hole of model.holes) {
  const source = input.holes.find(h => h.number === hole.n);
  const want = teeStatus(hole.tees.pads, source).status;
  if (hole.tees.status !== want) changed++;
  const { status, ...rest } = hole.tees;
  hole.tees = want ? { ...rest, status: want } : rest;
  if (want) console.log(`  h${hole.n}: ${want}`);
}
console.log(`${changed} holes change`);
if (process.argv.includes('--write')) { fs.writeFileSync(MODEL, `${JSON.stringify(model, null, 2)}\n`); console.log(`wrote ${MODEL}`); }
else console.log('dry run; pass --write to apply');
