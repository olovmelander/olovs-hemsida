/* Is the pack the same course the page ships? Exits non-zero if not.

   usage: node packages/course-pack/check-pack.mjs <pack.bin> <page.html> <buildDir>

   Three claims, each checked against something that did not produce the pack:
     1. the three streams are BYTE-IDENTICAL to the page's embedded base64 --
        the strongest possible currency statement while the pages still build;
     2. the header's GEO/HF0/HF1 metadata deep-equal the page's literals;
     3. the card in the pack's vector stream matches the build's card.json
        value for value -- the same 100+-value gate check3d runs, re-run here
        against the pack's own decode path rather than the page's.            */
import fs from 'node:fs';
import path from 'node:path';
import { readPack, inflateStream } from './lib.mjs';

const [packFile, pageFile, buildDir] = process.argv.slice(2);
if (!buildDir) { console.error('usage: check-pack.mjs <pack.bin> <page.html> <buildDir>'); process.exit(2); }

let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

const { header, s0, s1, sv } = readPack(fs.readFileSync(packFile));

/* the page's embedded block, parsed with the same discipline embed.mjs writes it */
const src = fs.readFileSync(pageFile, 'utf8');
const block = src.split('/*@GEODATA*/')[1].split('/*@/GEODATA*/')[0];
const lit = name => {
  const m = block.match(new RegExp(`const ${name} = (\\{[^\\n]*\\});`));
  return m ? JSON.parse(m[1]) : null;
};
const b64 = name => {
  const m = block.match(new RegExp(`${name} = '([A-Za-z0-9+/=]+)'`));
  return m ? Buffer.from(m[1], 'base64') : null;
};

const pHF0 = lit('HF0'), pHF1 = lit('HF1'), pGEO = lit('GEO');
gate(Buffer.compare(s0, b64('HF0.b64')) === 0, `HF0 stream byte-identical to the page (${s0.length} bytes)`);
gate(Buffer.compare(s1, b64('HF1.b64')) === 0, `HF1 stream byte-identical to the page (${s1.length} bytes)`);
gate(Buffer.compare(sv, b64('const VEC64')) === 0, `vector stream byte-identical to the page (${sv.length} bytes)`);
const meta = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sansBytes = ({ bytes, ...r }) => r;
gate(meta(pGEO, header.GEO), 'GEO metadata equals the page literal');
gate(meta(pHF0, sansBytes(header.HF0)), 'HF0 metadata equals the page literal');
gate(meta(pHF1, sansBytes(header.HF1)), 'HF1 metadata equals the page literal');

/* the card, from the pack's own bytes */
const M = JSON.parse(inflateStream(sv).toString('utf8'));
const card = JSON.parse(fs.readFileSync(path.join(buildDir, 'card.json'), 'utf8'));
let mismatch = 0, checked = 0;
for (const ch of card.holes) {
  const h = M.holes.find(x => x.n === ch.n);
  checked += 2 + ch.t.length;
  if (!h || h.par !== ch.par) mismatch++;
  if (!h || h.idx !== ch.hcp) mismatch++;
  ch.t.forEach((v, i) => { if (!h || h.t[i] !== v) mismatch++; });
}
gate(mismatch === 0 && M.holes.length === 18, `card in the pack: ${checked} values, ${mismatch} mismatches`);

console.log(bad ? `${bad} FAILED` : 'pack matches the page and the card');
process.exit(bad ? 1 : 0);
