import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = 'apps/golf/public/';
const before = JSON.parse(execFileSync('git', ['show', 'a93f79e6:apps/golf/public/courses/index.json'], { encoding: 'utf8' }));
const after = JSON.parse(fs.readFileSync(`${root}courses/index.json`));
const withoutIdentity = ({ identity, ...rest }) => rest;
const water = ref => {
  const bytes = inflateRawSync(fs.readFileSync(root + ref.url));
  const size = bytes.readUInt32LE(4), start = (8 + size + 3) & ~3;
  const header = JSON.parse(bytes.subarray(8, 8 + size));
  assert.equal(header.identity, ref.identity);
  return { metadata: withoutIdentity(header), fields: bytes.subarray(start) };
};
const results = [];
for (const a of after.courses) {
  const b = before.courses.find(c => c.slug === a.slug);
  const row = { course: a.slug, tint: [], vista: [], scatter: [] };
  for (const quality of ['hi', 'lo']) {
    for (const [key, type, prefix] of [['preparedTint', 'tint', 'painted'], ['preparedVista', 'vista', 'vista'], ['preparedScatter', 'scatter', 'scatter']]) {
      const variant = `${prefix}-${quality}`;
      assert.notEqual(a[key][variant].identity, b[key][variant].identity);
      assert.deepEqual(withoutIdentity(a[key][variant]), withoutIdentity(b[key][variant]), `${a.slug} ${variant}: construction changed`);
      row[type].push({ variant, contentUnchanged: true, sourceIdentityRefreshed: true });
    }
  }
  if (a.preparedWater) {
    const wa = water(a.preparedWater), wb = water(b.preparedWater);
    assert.deepEqual(wa.metadata, wb.metadata, `${a.slug}: water metadata changed`);
    assert.ok(wa.fields.equals(wb.fields), `${a.slug}: water fields changed`);
    row.water = { contentUnchanged: true, fieldsSha256: createHash('sha256').update(wa.fields).digest('hex') };
  } else {
    assert.ok(!b.preparedWater && a.preparedWaterUnsupported && b.preparedWaterUnsupported);
    row.water = { unsupportedPathUnchanged: true };
  }
  results.push(row);
}
fs.writeFileSync('docs/graphics/performance-distant-hero-2026-09-23/default24/publication-identity.json', JSON.stringify({ baseline: 'a93f79e6', build: JSON.parse(fs.readFileSync('apps/golf/dist/course-startup-build.json')), results }, null, 2) + '\n');
console.log(`${results.length} courses: all rebaked construction content unchanged; source identities refreshed`);
