/* Assemble explicit component decisions. A later replacement tee inventory
 * supersedes earlier individual pad edits for that hole; their evidence stays
 * in the original component files. No model geometry is used as a baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = [
  'ortho-reviewed-01-06.json', 'ortho-reviewed-07-12.json', 'ortho-reviewed-13-18.json',
  'ortho-reviewed-07-12-turf.json', 'ortho-reviewed-13-18-turf.json',
  'ortho-reviewed-01-04-tees.json', 'ortho-reviewed-05-06-tees.json',
  'ortho-reviewed-07-12-tee-associations.json', 'ortho-reviewed-13-18-tee-associations.json',
].map(file => 'geobuild/mapping/' + file);
const components = files.map(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
const first = components[0];
for (const component of components) {
  assert.equal(component.schemaVersion, 1);
  assert.equal(component.groundId, 'veckefjarden');
  assert.deepEqual(component.frame, first.frame, 'Component coordinate frames disagree');
}
const all = components.flatMap(component => component.features);
assert.equal(new Set(all.map(f => f.id)).size, all.length, 'Duplicate feature IDs');
const teeSets = all.filter(f => f.kind === 'tee-set');
assert.equal(new Set(teeSets.map(f => f.hole)).size, teeSets.length, 'Duplicate tee inventories');
const teeHoles = new Set(teeSets.map(f => f.hole));
const superseded = all.filter(f => f.kind === 'tee' && teeHoles.has(f.hole));
const features = all.filter(f => !superseded.includes(f)).sort((a, b) => a.hole-b.hole || a.id.localeCompare(b.id, 'en'));
const review = {
  schemaVersion: 1, groundId: 'veckefjarden', frame: first.frame, reviewedOn: '2026-09-09', features,
  suppressInferredTeeHoles: [...teeHoles].sort((a, b) => a-b), reviewedTeeHoles: [],
  sourceCaptureDates: ['2024-06-27'], sourceAbsoluteHorizontalAccuracyMetres: null,
  notes: 'Manually interpreted boundaries and explicit provisional tee-platform references. Unresolved references and obscured historical platforms remain identified. Daily marker locations and absolute surveying accuracy are not established.',
  componentReviews: files, supersededFeatureIds: superseded.map(f => f.id).sort(),
};
const target = path.join(root, 'geobuild/mapping/lm-ortho-review.json');
const text = JSON.stringify(review, null, 2) + '\n';
if (process.argv.includes('--write')) fs.writeFileSync(target, text);
else assert.equal(fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'), text, 'Canonical ledger differs; inspect components, then use --write');
console.log(`${features.length} accepted features; ${teeSets.length} tee inventories; ${superseded.length} superseded individual tee records.`);
