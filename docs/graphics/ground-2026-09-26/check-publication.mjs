// Proves the re-bake for the ground batch refreshed source identities and moved
// nothing but reeds: every tint, vista and water payload keeps its content;
// every prepared scatter keeps its cover and edge sections bit for bit, and its
// reeds section only gains candidates (reeds at every lake and pond at its own
// level beside the first lake's, ground-cover.mjs reedWaterAt): every reed that
// stood still stands. Reports each course's reeds before and after, per quality.
// Run from the repository root after the bakes: node docs/graphics/ground-2026-09-26/check-publication.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = 'apps/golf/public/';
const baseline = '4170051d';
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
/* one section's decisions as a bit set: how many pass, and against another's, how many both, only this, only that */
const bitsOf = (payload, section) => payload.subarray(section.offset, section.offset + ((section.candidates + 7) >> 3));
const popcount = bytes => { let n = 0; for (const b of bytes) { let v = b; while (v) { n += v & 1; v >>= 1; } } return n; };
const both = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) { let v = a[i] & b[i]; while (v) { n += v & 1; v >>= 1; } } return n; };
const build = JSON.parse(fs.readFileSync('apps/golf/dist/course-startup-build.json'));
const results = [];
assert.equal(after.courses.length, before.courses.length);
for (const a of after.courses) {
  const b = before.courses.find(c => c.slug === a.slug);
  // The records below carry the source identity; every other catalogue field must not move.
  const rest = c => ({ ...c, preparedTint: null, preparedVista: null, preparedScatter: null, preparedWater: null, preparedWaterUnsupported: null });
  assert.deepEqual(rest(a), rest(b), `${a.slug}: other catalogue fields changed`);
  const row = { course: a.slug, tint: [], vista: [], scatter: [] };
  for (const quality of ['hi', 'lo']) {
    for (const [key, type, prefix] of [['preparedTint', 'tint', 'painted'], ['preparedVista', 'vista', 'vista']]) {
      const variant = `${prefix}-${quality}`;
      assert.notEqual(a[key][variant].identity, b[key][variant].identity, `${a.slug} ${variant}: identity not refreshed`);
      assert.deepEqual(withoutIdentity(a[key][variant]), withoutIdentity(b[key][variant]), `${a.slug} ${variant}: construction changed`);
      row[type].push({ variant, contentUnchanged: true, sourceIdentityRefreshed: true });
    }
    if (!a.preparedScatter) { assert.ok(!b.preparedScatter, `${a.slug}: scatter appeared`); continue; }
    const variant = `scatter-${quality}`, A = a.preparedScatter[variant], B = b.preparedScatter[variant];
    assert.notEqual(A.identity, B.identity, `${a.slug} ${variant}: identity not refreshed`);
    /* a course that plants nothing (measured vegetation only) records that it has no scatter */
    if (A.none || B.none) {
      assert.deepEqual(withoutIdentity(A), withoutIdentity(B), `${a.slug} ${variant}: no-scatter record changed`);
      row.scatter.push({ variant, noScatter: true, sourceIdentityRefreshed: true });
      continue;
    }
    assert.equal(A.inputs, B.inputs, `${a.slug} ${variant}: inputs changed`);
    assert.equal(A.decodedBytes, B.decodedBytes, `${a.slug} ${variant}: payload size changed`);
    /* the cover and the mown edge's tufts: the same decisions, the same plantings */
    for (const name of ['cover', 'edge']) assert.deepEqual(A.sections[name], B.sections[name], `${a.slug} ${variant}: ${name} section changed`);
    /* a course without a lake plants no reeds, and has no section for them, before and after */
    if (A.sections.reeds === null || B.sections.reeds === null) {
      assert.equal(A.sections.reeds, B.sections.reeds, `${a.slug} ${variant}: reeds section appeared or vanished`);
      assert.deepEqual(withoutIdentity(A), withoutIdentity(B), `${a.slug} ${variant}: scatter without reeds changed`);
      row.scatter.push({ variant, coverAndEdgeUnchanged: true, sourceIdentityRefreshed: true, reeds: null });
      continue;
    }
    /* the reeds: the same lattice, its own decisions */
    assert.equal(A.sections.reeds.candidates, B.sections.reeds.candidates, `${a.slug} ${variant}: reed lattice changed`);
    assert.equal(A.sections.reeds.offset, B.sections.reeds.offset);
    assert.deepEqual(A.sections.reeds.extra, B.sections.reeds.extra);
    const pa = inflateRawSync(readNow(A.url)), pb = inflateRawSync(readBefore(B.url));
    assert.equal(createHash('sha256').update(pa).digest('hex'), A.decodedSha256);
    assert.equal(createHash('sha256').update(pb).digest('hex'), B.decodedSha256);
    const ra = bitsOf(pa, A.sections.reeds), rb = bitsOf(pb, B.sections.reeds);
    const end = A.sections.reeds.offset + ra.length;
    assert.ok(pa.subarray(0, A.sections.reeds.offset).equals(pb.subarray(0, B.sections.reeds.offset)) && pa.subarray(end).equals(pb.subarray(end)),
      `${a.slug} ${variant}: bytes outside the reeds changed`);
    const reedsBefore = popcount(rb), reedsAfter = popcount(ra), kept = both(ra, rb);
    assert.equal(kept, reedsBefore, `${a.slug} ${variant}: ${reedsBefore - kept} reeds that stood are gone`);
    row.scatter.push({ variant, coverAndEdgeUnchanged: true, sourceIdentityRefreshed: true,
      reeds: { before: reedsBefore, after: reedsAfter, kept, added: reedsAfter - kept, removed: reedsBefore - kept,
        digestChanged: A.sections.reeds.digest !== B.sections.reeds.digest } });
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
fs.writeFileSync('docs/graphics/ground-2026-09-26/publication-identity.json',
  JSON.stringify({ baseline, build, results }, null, 2) + '\n');
const reeds = results.flatMap(r => r.scatter.filter(s => s.variant === 'scatter-hi' && s.reeds).map(s => `${r.course} ${s.reeds.before}->${s.reeds.after}`));
console.log(`publication identity: ${results.length} courses, all content but the reeds unchanged, every reed kept, identities refreshed for ${build.revision}`);
console.log(`reeds at high quality: ${reeds.join(', ')}`);
