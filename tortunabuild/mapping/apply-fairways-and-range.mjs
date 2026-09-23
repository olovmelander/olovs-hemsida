#!/usr/bin/env node
/* The plan fairways and the whole range field, applied to the master input and
   the committed model (2026-09-23).

   What changes and nothing else:
   - every hole's fairway rings become the rings trace-plan-fairways.mjs read
     off the club's hole plans (mapping/fairways-plan-2026.geojson); the 5th
     gets none, because its plan draws only rough between tee and green;
   - the range field `tortuna-range-grassed-front` (the visibly grassed wedge by
     the tee line, 4,680 m²) is replaced by `tortuna-range-field-2026`
     (mapping/range-field-2026.geojson, the whole field the net closes).
   Both replacements name what they replace (`replacesFeatureIds`, the
   assembler's convention), the input's checksum ledger is refreshed so
   build-course.mjs's verifyInputSources still means what it means, and the
   changeset is written as mapping/review-2026-09-23.json.

   The committed model is updated through the generator's own exported rules,
   holeFairways() and rangeFields(), because build-course.mjs cannot run
   without the private 1 m raster it pins; course.node-test.mjs re-derives both
   and demands equality.

     node tortunabuild/mapping/apply-fairways-and-range.mjs [--write]      */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { holeFairways, rangeFields } from '../build-course.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WRITE = process.argv.includes('--write');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const write = (p, value) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(value, null, 2) + '\n');

const SURFACES = 'tortunabuild/mapping/playing-surfaces.geojson';
const INPUT = 'tortunabuild/mapping/course-input.json';
const FAIRWAYS = 'tortunabuild/mapping/fairways-plan-2026.geojson';
const RANGE = 'tortunabuild/mapping/range-field-2026.geojson';
const REVIEW = 'tortunabuild/mapping/review-2026-09-23.json';
const MODEL = 'tortunabuild/course-model.json';
const REPLACED_RANGE = 'tortuna-range-grassed-front';

const surfaces = read(SURFACES), input = read(INPUT), fairways = read(FAIRWAYS), range = read(RANGE), model = read(MODEL);
const RULE_TRACE = read('tortunabuild/mapping/fairways-2026.geojson');
if (input.holes.length !== 18 || model.holes.length !== 18) throw new Error('need all eighteen holes');

/* ---- fairways ---- */
const removed = [], replaced = [], added = [], holes = [];
/* What the plan replaces is what stood before it: the 2026 rule trace, which the
   input carried feature for feature, plus anything else found that is not the
   plan's own. It is derived, never read back off the features, because a rerun
   finds the plan already in place and the 5th has no plan feature to carry it. */
const planIds = new Set(fairways.features.map(f => f.id));
for (const hole of input.holes) {
  const existing = surfaces.features.filter(f => f.properties.kind === 'fairway' && f.properties.hole === hole.number);
  const replacedIds = [...new Set([
    ...RULE_TRACE.features.filter(f => f.properties.hole === hole.number).map(f => f.id),
    ...existing.filter(f => !planIds.has(f.id)).map(f => f.id),
    ...existing.filter(f => planIds.has(f.id)).flatMap(f => f.properties.replacesFeatureIds || [])])];
  const replacements = fairways.features.filter(f => f.properties.hole === hole.number)
    .map((f, i) => ({ ...f, properties: { ...f.properties, replacesFeatureIds: i === 0 ? replacedIds : [] } }));
  removed.push(...existing.map(o => o.id));
  replaced.push(...replacedIds);
  added.push(...replacements);
  hole.fairways = replacements.map(f => ({ ...f.properties, ring: f.geometry.coordinates[0], sourceFeatureId: f.id }));
  const replacedFeatures = RULE_TRACE.features.filter(f => replacedIds.includes(f.id));
  holes.push({ hole: hole.number, replaced: replacedIds, adopted: replacements.map(f => f.id),
    areaSquareMetres: { before: Math.round(replacedFeatures.reduce((s, f) => s + (f.properties.areaSquareMetres || 0), 0)), after: Math.round(replacements.reduce((s, f) => s + f.properties.areaSquareMetres, 0)) },
    note: replacements.length ? undefined : 'the club plan draws no fairway on this hole: rough from tee to green' });
}
const kept = surfaces.features.filter(f => !removed.includes(f.id));
const ids = new Set(kept.map(f => f.id));
for (const f of added) { if (ids.has(f.id)) throw new Error(`duplicate feature id ${f.id}`); ids.add(f.id); }

/* ---- the range field ---- */
const rangeFeature = range.features.find(f => f.properties.kind === 'range_field');
if (!rangeFeature || !rangeFeature.properties.replacesFeatureIds.includes(REPLACED_RANGE)) throw new Error('the range record must name the ring it replaces');
const oldRangeIndex = input.facilities.findIndex(f => f.id === REPLACED_RANGE);
const alreadyApplied = input.facilities.some(f => f.id === rangeFeature.id);
if (oldRangeIndex < 0 && !alreadyApplied) throw new Error(`${REPLACED_RANGE} is not in the input facilities`);
const rangeFacility = { ...rangeFeature.properties, id: rangeFeature.id, rings: rangeFeature.geometry.coordinates };
if (oldRangeIndex >= 0) input.facilities.splice(oldRangeIndex, 1, rangeFacility);
else input.facilities.splice(input.facilities.findIndex(f => f.id === rangeFeature.id), 1, rangeFacility);

/* ---- the committed model, through the generator's own rules ---- */
const before = { fairwayRings: model.holes.reduce((s, h) => s + h.fairway.rings.length, 0), range: model.scenery.range.length };
for (const hole of model.holes) hole.fairway = holeFairways(input.holes.find(h => h.number === hole.n), `Tortuna hole ${hole.n}`);
model.scenery.range = rangeFields(input.facilities);

const review = { schemaVersion: 1, groundId: 'tortuna', reviewedOn: '2026-09-23', script: 'tortunabuild/mapping/apply-fairways-and-range.mjs',
  why: 'Every Lantmäteriet capture of this course is a spring one, as is the one Esri\'s live mosaic serves, and in spring fairway and mown rough cannot be told apart; the 2026 rule trace clipped the mown estate to a 24 m design half-width and read as straight-edged bands. The club hole plans draw the fairway itself. The range carried only the grassed wedge by the tee line while the owner states the whole range is grass.',
  sources: { fairways: { path: FAIRWAYS, sha256: sha(FAIRWAYS) }, range: { path: RANGE, sha256: sha(RANGE) } },
  removedFeatureIds: replaced, addedFeatureIds: added.map(f => f.id), holes,
  range: { replaced: REPLACED_RANGE, adopted: rangeFeature.id, areaSquareMetres: rangeFeature.properties.areaSquareMetres },
  limits: ['The fairways are the club plans\' drawn shapes placed on the measured greens, bunkers and tees; the plans are illustrations, and the registration residuals in the fairway record are the accuracy claimed, not a survey.',
    'The range field boundary is a visual interpretation of the 2026 orthophoto along the edges it shows; the owner\'s word is its material.'] };

const counts = [...kept, ...added].reduce((a, f) => { a[f.properties.kind] = (a[f.properties.kind] || 0) + 1; return a; }, {});
console.log(`fairways: ${replaced.length} features replaced by ${added.length} (model rings ${before.fairwayRings} -> ${model.holes.reduce((s, h) => s + h.fairway.rings.length, 0)})`);
for (const h of holes) console.log(`  h${String(h.hole).padStart(2)} ${h.areaSquareMetres.before} -> ${h.areaSquareMetres.after} m²${h.note ? ` (${h.note})` : ''}`);
console.log(`range: ${REPLACED_RANGE} -> ${rangeFeature.id} (${rangeFeature.properties.areaSquareMetres} m²)`);
console.log(`surfaces: ${surfaces.features.length} -> ${kept.length + added.length} (${JSON.stringify(counts)})`);
if (!WRITE) { console.log('dry run; pass --write to apply'); process.exit(0); }

write(SURFACES, { ...surfaces, features: [...kept, ...added],
  status: 'provisional-orthophoto-interpretation-not-surveyed; 2026 tee decisions (mapping/review-2026.json) and plan fairways (mapping/review-2026-09-23.json) applied',
  inputs: [...surfaces.inputs.filter(i => i.path !== FAIRWAYS), { path: FAIRWAYS, sha256: sha(FAIRWAYS) }],
  review20260923: { path: REVIEW, applied: '2026-09-23' } });
write(REVIEW, review);
input.inputs = input.inputs.map(i => i.path === SURFACES ? { path: SURFACES, sha256: sha(SURFACES) } : i);
for (const extra of [FAIRWAYS, RANGE, REVIEW]) {
  const entry = input.inputs.find(i => i.path === extra);
  if (entry) entry.sha256 = sha(extra); else input.inputs.push({ path: extra, sha256: sha(extra) });
}
input.status = 'provisional-source-derived; 2026 review and plan fairways applied';
write(INPUT, input);
write(MODEL, model);
console.log(`wrote ${SURFACES}, ${INPUT}, ${REVIEW}, ${MODEL}`);
