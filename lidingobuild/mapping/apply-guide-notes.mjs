#!/usr/bin/env node
/* Put the hålguide's per-hole text into the committed model.

   Same reason Visby's apply-guide-notes.mjs exists: `build-course.mjs` cannot
   run in a checkout without the acquired 1 m raster it pins by sha256, so the
   committed model is updated through the generator's OWN exported rule --
   `holeNotes` -- and `course.node-test.mjs` re-derives it a third time and
   demands equality. No second implementation.

     node lidingobuild/mapping/apply-guide-notes.mjs [--write] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { holeNotes } from '../build-course.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.join(HERE, '..', 'course-model.json');
const before = fs.readFileSync(MODEL, 'utf8');
const model = JSON.parse(before);
const notes = holeNotes(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'guide-notes.json'), 'utf8')));

let changed = 0;
for (const hole of model.holes) {
  const entry = notes.get(hole.n);
  if (!entry) throw new Error(`no guide note for hole ${hole.n}`);
  if (hole.note !== entry.note || hole.name !== entry.name) changed++;
  hole.note = entry.note;
  hole.name = entry.name;
}
const distinct = new Set(model.holes.map(hole => hole.note)).size;
console.log(`${changed} of 18 holes change; ${distinct} distinct notes, was ${new Set(JSON.parse(before).holes.map(h => h.note)).size}`);
for (const hole of model.holes) console.log(`  h${String(hole.n).padStart(2)} ${hole.name} — ${hole.note.slice(0, 70)}…`);

if (process.argv.includes('--write')) {
  fs.writeFileSync(MODEL, `${JSON.stringify(model, null, 2)}\n`);
  console.log(`wrote ${MODEL}`);
} else console.log('dry run; pass --write to apply');
