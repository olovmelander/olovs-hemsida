/* Does every committed pack still decode to the course its build says it is?
   Exits non-zero if not.

   usage: node tools/check-packs.mjs

   `check-pack.mjs` is the stronger statement where it applies -- byte-identity
   against the page that ships the same course -- but it needs a page, and the
   three SECOND courses (upsala-mellanbanan, johannesberg-9,
   veckefjarden-korthalsbanan) have none and never will. They are app-only, so
   without this they would be the only courses whose packs nothing checks.

   This asks a weaker but universal question, of the pack's OWN decode path
   rather than of the JSON it was written from:

     - the pack parses (magic, fmt, framing, no trailing bytes)
     - the header's slug is the slug the manifest filed it under
     - every card value in the build's card.json survives the round trip:
       par, stroke index and every tee distance, hole by hole
     - the manifest's bytes and sha256 are the bytes and hash on disk, which is
       what makes the content-addressed `?v=` fetch safe
     - par and hole count agree between manifest and pack

   The hash check is the load-bearing one. loadCourse appends ?v=<sha prefix>
   and re-hashes at runtime, so a manifest that disagrees with its pack does not
   degrade quietly -- the course refuses to open. Catching that here is cheaper
   than catching it in a browser.                                              */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readPack, sha256, readCard } from '../packages/course-pack/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));

let bad = 0;
for (const c of manifest.courses) {
  const file = path.join(ROOT, 'apps/golf/public/courses', c.slug, 'pack.bin');
  const problems = [];
  let n = 0;
  try {
    const buf = fs.readFileSync(file);
    const { header, sv } = readPack(buf);                 /* throws on bad framing */
    const vec = JSON.parse(zlib.inflateRawSync(sv).toString('utf8'));

    if (header.slug !== c.slug) problems.push(`header slug ${header.slug}`);
    if (buf.length !== c.bytes) problems.push(`bytes ${buf.length} != manifest ${c.bytes}`);
    if (sha256(buf) !== c.sha256) problems.push('sha256 differs from the manifest');
    if (vec.holes.length !== c.holes) problems.push(`${vec.holes.length} holes != manifest ${c.holes}`);
    const par = vec.holes.reduce((s, h) => s + h.par, 0);
    if (par !== c.par) problems.push(`par ${par} != manifest ${c.par}`);

    /* the card, value for value, out of the pack rather than out of the model */
    let mism = 0;
    for (const ch of readCard(ROOT, c.build)) {
      const h = vec.holes.find(x => x.n === ch.n);
      if (!h) { mism++; continue; }
      n++; if (h.par !== ch.par) mism++;
      n++; if (h.idx !== ch.hcp) mism++;          /* null === null on an unrated course */
      ch.t.forEach((t, i) => { n++; if (h.t[i] !== t) mism++; });
    }
    if (mism) problems.push(`${mism} of ${n} card values differ`);
  } catch (e) {
    problems.push(e.message);
  }
  if (problems.length) bad++;
  console.log(`${problems.length ? '  FAIL ' : '  ok   '}${c.slug.padEnd(28)}` +
    `${String(n).padStart(4)} card values${problems.length ? '  — ' + problems.join('; ') : ', 0 mismatches'}`);
}

console.log(bad
  ? `\n${bad} of ${manifest.courses.length} packs FAILED`
  : `\nall ${manifest.courses.length} packs decode to their build card and match the manifest hash, size, par, hole count and slug`);
process.exit(bad ? 1 : 0);
