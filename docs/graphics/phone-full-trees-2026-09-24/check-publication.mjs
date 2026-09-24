// Proves the re-bake for the phone tree tier refreshed only source identities:
// every tint, vista and scatter record and every water payload keeps its content.
// Run from the repository root after the bakes: node docs/graphics/phone-full-trees-2026-09-24/check-publication.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = 'apps/golf/public/';
const baseline = '1ec67985';
const before = JSON.parse(execFileSync('git', ['show', `${baseline}:apps/golf/public/courses/index.json`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const after = JSON.parse(fs.readFileSync(`${root}courses/index.json`));
const withoutIdentity = ({ identity, ...rest }) => rest;
const waterAt = (ref, read) => {
  const bytes = inflateRawSync(read(ref.url));
  const size = bytes.readUInt32LE(4), start = (8 + size + 3) & ~3;
  const header = JSON.parse(bytes.subarray(8, 8 + size));
  assert.equal(header.identity, ref.identity);
  return { metadata: withoutIdentity(header), fields: bytes.subarray(start) };
};
const build = JSON.parse(fs.readFileSync('apps/golf/dist/course-startup-build.json'));
const readNow = url => fs.readFileSync(root + url);
const readBefore = url => execFileSync('git', ['show', `${baseline}:${root}${url}`], { maxBuffer: 64 << 20 });
const results = [];
assert.equal(after.courses.length, before.courses.length);
for (const a of after.courses) {
  const b = before.courses.find(c => c.slug === a.slug);
  // The records below carry the source identity; every other catalogue field must not move.
  const rest = c => ({ ...c, preparedTint: null, preparedVista: null, preparedScatter: null, preparedWater: null, preparedWaterUnsupported: null });
  assert.deepEqual(rest(a), rest(b), `${a.slug}: other catalogue fields changed`);
  const row = { course: a.slug, tint: [], vista: [], scatter: [] };
  for (const quality of ['hi', 'lo']) {
    for (const [key, type, prefix] of [['preparedTint', 'tint', 'painted'], ['preparedVista', 'vista', 'vista'], ['preparedScatter', 'scatter', 'scatter']]) {
      const variant = `${prefix}-${quality}`;
      assert.notEqual(a[key][variant].identity, b[key][variant].identity, `${a.slug} ${variant}: identity not refreshed`);
      assert.deepEqual(withoutIdentity(a[key][variant]), withoutIdentity(b[key][variant]), `${a.slug} ${variant}: construction changed`);
      row[type].push({ variant, contentUnchanged: true, sourceIdentityRefreshed: true });
    }
  }
  if (a.preparedWater) {
    const wa = waterAt(a.preparedWater, readNow), wb = waterAt(b.preparedWater, readBefore);
    assert.deepEqual(wa.metadata, wb.metadata, `${a.slug}: water metadata changed`);
    assert.ok(wa.fields.equals(wb.fields), `${a.slug}: water fields changed`);
    row.water = { contentUnchanged: true, fieldsSha256: createHash('sha256').update(wa.fields).digest('hex') };
  } else {
    // A measured/frontier water path keeps its runtime route; only its source identity is refreshed.
    assert.ok(!b.preparedWater && a.preparedWaterUnsupported && b.preparedWaterUnsupported);
    assert.equal(a.preparedWaterUnsupported.revision, build.revision);
    assert.notEqual(a.preparedWaterUnsupported.identity, b.preparedWaterUnsupported.identity);
    const { identity: _ia, revision: _ra, ...ua } = a.preparedWaterUnsupported, { identity: _ib, revision: _rb, ...ub } = b.preparedWaterUnsupported;
    assert.deepEqual(ua, ub, `${a.slug}: unsupported water record changed`);
    row.water = { unsupportedPathUnchanged: true, sourceIdentityRefreshed: true };
  }
  results.push(row);
}
fs.writeFileSync('docs/graphics/phone-full-trees-2026-09-24/publication-identity.json',
  JSON.stringify({ baseline, build, results }, null, 2) + '\n');
console.log(`publication identity: ${results.length} courses, content unchanged, identities refreshed for ${build.revision}`);
