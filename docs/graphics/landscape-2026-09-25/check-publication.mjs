// Proves what the re-bake for the landscape batch changed, against main:
//  - every far-vista and scatter record and every water payload keeps its
//    content; only its source identity is refreshed;
//  - every ground tint keeps its layout and every RGB byte it had, and its
//    alpha -- 255 everywhere before -- now carries the ground's relief
//    (ground-relief.mjs), open ground at 128.
// Run from the repository root after the bakes: node docs/graphics/landscape-2026-09-25/check-publication.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = 'apps/golf/public/';
const baseline = '39dba316';
const before = JSON.parse(execFileSync('git', ['show', `${baseline}:apps/golf/public/courses/index.json`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const after = JSON.parse(fs.readFileSync(`${root}courses/index.json`));
const withoutIdentity = ({ identity, ...rest }) => rest;
const readNow = url => fs.readFileSync(root + url);
const readBefore = url => execFileSync('git', ['show', `${baseline}:${root}${url}`], { maxBuffer: 64 << 20 });
const waterAt = (ref, read) => {
  const bytes = inflateRawSync(read(ref.url));
  const size = bytes.readUInt32LE(4), start = (8 + size + 3) & ~3;
  const header = JSON.parse(bytes.subarray(8, 8 + size));
  assert.equal(header.identity, ref.identity);
  return { metadata: withoutIdentity(header), fields: bytes.subarray(start) };
};
const tintAt = (ref, read) => {
  const bytes = inflateRawSync(read(ref.url));
  assert.equal(bytes.length, ref.decodedBytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.decodedSha256);
  return bytes;
};
const build = JSON.parse(fs.readFileSync('apps/golf/dist/course-startup-build.json'));
const results = [];
assert.equal(after.courses.length, before.courses.length);
for (const a of after.courses) {
  const b = before.courses.find(c => c.slug === a.slug);
  const rest = c => ({ ...c, preparedTint: null, preparedVista: null, preparedScatter: null, preparedWater: null, preparedWaterUnsupported: null });
  assert.deepEqual(rest(a), rest(b), `${a.slug}: other catalogue fields changed`);
  const row = { course: a.slug, tint: [], vista: [], scatter: [] };
  for (const quality of ['hi', 'lo']) {
    for (const [key, type, prefix] of [['preparedVista', 'vista', 'vista'], ['preparedScatter', 'scatter', 'scatter']]) {
      const variant = `${prefix}-${quality}`;
      assert.notEqual(a[key][variant].identity, b[key][variant].identity, `${a.slug} ${variant}: identity not refreshed`);
      assert.deepEqual(withoutIdentity(a[key][variant]), withoutIdentity(b[key][variant]), `${a.slug} ${variant}: construction changed`);
      row[type].push({ variant, contentUnchanged: true, sourceIdentityRefreshed: true });
    }
    const variant = `painted-${quality}`, ta = a.preparedTint[variant], tb = b.preparedTint[variant];
    assert.notEqual(ta.identity, tb.identity, `${a.slug} ${variant}: identity not refreshed`);
    assert.deepEqual(ta.layers, tb.layers, `${a.slug} ${variant}: tint layout changed`);
    const now = tintAt(ta, readNow), was = tintAt(tb, readBefore);
    assert.equal(now.length, was.length);
    let alphaWas255 = true, sheltered = 0, exposed = 0, open = 0;
    for (let k = 0; k < now.length; k += 4) {
      assert.ok(now[k] === was[k] && now[k + 1] === was[k + 1] && now[k + 2] === was[k + 2], `${a.slug} ${variant}: an RGB byte changed at ${k}`);
      if (was[k + 3] !== 255) alphaWas255 = false;
      const s = (now[k + 3] - 128) / 127;
      if (s < -0.1) sheltered++; else if (s > 0.1) exposed++; else open++;
    }
    assert.ok(alphaWas255, `${a.slug} ${variant}: the old alpha was not all 255`);
    const texels = now.length / 4;
    row.tint.push({ variant, layoutUnchanged: true, rgbUnchanged: true, alphaWasAll255: true,
      relief: { sheltered: +(sheltered / texels).toFixed(4), open: +(open / texels).toFixed(4), exposed: +(exposed / texels).toFixed(4) } });
  }
  if (a.preparedWater) {
    const wa = waterAt(a.preparedWater, readNow), wb = waterAt(b.preparedWater, readBefore);
    assert.deepEqual(wa.metadata, wb.metadata, `${a.slug}: water metadata changed`);
    assert.ok(wa.fields.equals(wb.fields), `${a.slug}: water fields changed`);
    row.water = { contentUnchanged: true, fieldsSha256: createHash('sha256').update(wa.fields).digest('hex') };
  } else {
    assert.ok(!b.preparedWater && a.preparedWaterUnsupported && b.preparedWaterUnsupported);
    assert.equal(a.preparedWaterUnsupported.revision, build.revision);
    assert.notEqual(a.preparedWaterUnsupported.identity, b.preparedWaterUnsupported.identity);
    const { identity: _ia, revision: _ra, ...ua } = a.preparedWaterUnsupported, { identity: _ib, revision: _rb, ...ub } = b.preparedWaterUnsupported;
    assert.deepEqual(ua, ub, `${a.slug}: unsupported water record changed`);
    row.water = { unsupportedPathUnchanged: true, sourceIdentityRefreshed: true };
  }
  results.push(row);
}
fs.writeFileSync('docs/graphics/landscape-2026-09-25/publication-identity.json',
  JSON.stringify({ baseline, build, results }, null, 2) + '\n');
console.log(`publication: ${results.length} courses; vista, scatter and water unchanged, tints' RGB unchanged and relief in alpha, for ${build.revision}`);
