/* Turn a course page's embedded data into a fetched pack -- on a COPY.

   usage: node tools/make-pack-page.mjs <in.html> <out.html> <packUrl> [--det]

   Two anchored substitutions, each asserting exactly one match:
     1. the GEODATA block's contents become a fetch of the pack, leaving GEO/HF0/HF1
        as the same names the next 4,200 lines expect;
     2. the inflate() call site takes the pack's raw streams instead of base64.
   With --det the determinism patch rides along (see pin() below): the TSL `time`
   uniform and the flag-cloth clock are pinned so two boots of the page render the
   same pixels -- without it, water and clouds animate and no screenshot of the
   page can be compared with any other screenshot of the page, including its own. */
import fs from 'node:fs';
import { patcher } from '../geobuild/lib.mjs';

const [inFile, outFile, packUrl] = process.argv.slice(2);
const DET = process.argv.includes('--det');
if (!packUrl && !DET) { console.error('usage: make-pack-page.mjs <in.html> <out.html> <packUrl> [--det]  (packUrl "-" = leave embedded)'); process.exit(2); }

let p = patcher(fs.readFileSync(inFile, 'utf8'));

if (packUrl && packUrl !== '-') {
  const src = p.src;
  const A = '/*@GEODATA*/', B = '/*@/GEODATA*/';
  const old = src.slice(src.indexOf(A) + A.length, src.indexOf(B));
  p = p.sub('geodata-to-fetch', A + old + B, A + `
/* fmt:1 course pack, fetched instead of embedded -- same names, same everything after */
const PACK = await (async () => {
  const buf = await (await fetch(${JSON.stringify(packUrl)})).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'GPK1') throw new Error('bad pack magic');
  const hlen = new DataView(buf).getUint32(4, true);
  const H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  if (H.fmt !== 1) throw new Error('unsupported pack fmt ' + H.fmt);
  let o = 8 + hlen;
  const cut = n => { const s = u8.subarray(o, o + n); o += n; return s; };
  return { H, s0: cut(H.HF0.bytes), s1: cut(H.HF1.bytes), sv: cut(H.VEC.bytes) };
})();
const GEO = PACK.H.GEO;
const HF0 = PACK.H.HF0;
const HF1 = PACK.H.HF1;
` + B);

  p = p.sub('inflate-bytes',
    `async function inflate(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);`,
    `async function inflate(src) {
  const u8 = src instanceof Uint8Array ? src
    : Uint8Array.from(atob(src), ch => ch.charCodeAt(0));`);

  p = p.sub('decode-from-pack',
    `const [b0, b1, bv] = await Promise.all([inflate(HF0.b64), inflate(HF1.b64), inflate(VEC64)]);`,
    `const [b0, b1, bv] = await Promise.all([inflate(PACK.s0), inflate(PACK.s1), inflate(PACK.sv)]);`);
}

if (DET) {
  /* pin the two clocks; everything else in the render is already deterministic */
  p = p.sub('pin-tsl-time',
    `  positionWorld, positionLocal, normalWorld, normalLocal, cameraPosition, time,`,
    `  positionWorld, positionLocal, normalWorld, normalLocal, cameraPosition, time as __liveTime,`);
  p = p.sub('const-time',
    `/* ------------------------------------------------------------------ boot ui */`,
    `const time = float(3.25);   /* determinism: water and clouds frozen mid-wave */
/* ------------------------------------------------------------------ boot ui */`);
  p = p.sub('pin-cloth',
    `  const t = now / 1000;`,
    `  const t = 3.25;   /* determinism: the flags hold their pose */`);
}

fs.writeFileSync(outFile, p.src);
console.log(`${outFile}  [${p.applied.join(', ')}]`);
