/* Extract a course page into app-shaped source -- REFERENCE ONLY since phase 2.

   Phase 1 generated apps/golf/{index.html,src/main.js} with this tool. From
   phase 2 the app is hand-maintained source (the determinism switch and the
   module split live there and would be clobbered), so this tool now writes to
   tools/reference/ instead: when one of the six pages takes a hotfix, extract
   it here and diff against the app to see exactly what must be mirrored.

   usage: node tools/extract-engine.mjs [page.html] [--det]
          (writes tools/reference/{index.html,main.js})                        */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patcher } from '../geobuild/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(a => a !== '--det');
const DET = process.argv.includes('--det');
const pageFile = path.join(ROOT, args[0] || 'angso3d.html');
const OUT = path.join(ROOT, 'tools/reference');

const src = fs.readFileSync(pageFile, 'utf8');
const cut = (s, a, b) => {
  const i = s.indexOf(a), j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`anchor missing: ${a.slice(0, 30)}`);
  return { before: s.slice(0, i), inner: s.slice(i + a.length, j), after: s.slice(j + b.length) };
};

/* ---- the module body -> src/main.js ---------------------------------------- */
const mod = cut(src, '<script type="module">', '</script>');
let body = mod.inner;
{
  /* the same three substitutions phase 0 proved, inlined here so this tool has
     no runtime dependency on the page's GEODATA block staying embedded */
  const A = '/*@GEODATA*/', B = '/*@/GEODATA*/';
  const old = body.slice(body.indexOf(A) + A.length, body.indexOf(B));
  let p = patcher(body)
    .sub('geodata-to-fetch', A + old + B, A + `
const PACK = await (async () => {
  const buf = await (await fetch('/courses/angso/pack.bin')).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'GPK1') throw new Error('bad pack magic');
  const hlen = new DataView(buf).getUint32(4, true);
  const H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  if (H.fmt !== 1) throw new Error('unsupported pack fmt ' + H.fmt);
  let o = 8 + hlen;
  const take = n => { const s = u8.subarray(o, o + n); o += n; return s; };
  return { H, s0: take(H.HF0.bytes), s1: take(H.HF1.bytes), sv: take(H.VEC.bytes) };
})();
const GEO = PACK.H.GEO;
const HF0 = PACK.H.HF0;
const HF1 = PACK.H.HF1;
` + B)
    .sub('inflate-bytes',
      `async function inflate(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);`,
      `async function inflate(data) {
  const u8 = data instanceof Uint8Array ? data
    : Uint8Array.from(atob(data), ch => ch.charCodeAt(0));`)
    .sub('decode-from-pack',
      `const [b0, b1, bv] = await Promise.all([inflate(HF0.b64), inflate(HF1.b64), inflate(VEC64)]);`,
      `const [b0, b1, bv] = await Promise.all([inflate(PACK.s0), inflate(PACK.s1), inflate(PACK.sv)]);`);
  if (DET) {
    p = p.sub('pin-tsl-time',
      `  positionWorld, positionLocal, normalWorld, normalLocal, cameraPosition, time,`,
      `  positionWorld, positionLocal, normalWorld, normalLocal, cameraPosition, time as __liveTime,`)
      .sub('const-time',
        `/* ------------------------------------------------------------------ boot ui */`,
        `const time = float(3.25);   /* determinism build: clocks pinned for parity shots */
/* ------------------------------------------------------------------ boot ui */`)
      .sub('pin-cloth', `  const t = now / 1000;`, `  const t = 3.25;`);
  }
  body = p.src;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'main.js'), body);

/* ---- the document -> index.html -------------------------------------------- */
let doc = mod.before + '<script type="module" src="/src/main.js"><' + '/script>' + mod.after;
{
  const im = cut(doc, '<script type="importmap">', '</script>');
  doc = im.before + im.after;                       /* the bundler is the importmap now */
  let p = patcher(doc)
    .sub('preconnect-fonts', `<link rel="preconnect" href="https://fonts.googleapis.com">\n`, '')
    .sub('preconnect-gstatic', `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n`, '')
    .sub('preconnect-unpkg', `<link rel="preconnect" href="https://unpkg.com" crossorigin>\n`, '')
    .sub('preload-webgpu', `<link rel="modulepreload" href="https://unpkg.com/three@0.185.1/build/three.webgpu.min.js">\n`, '')
    .sub('preload-core', `<link rel="modulepreload" href="https://unpkg.com/three@0.185.1/build/three.core.min.js">\n`, '')
    .sub('local-fonts',
      `<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">`,
      `<link href="/fonts/fonts.css" rel="stylesheet">`);
  doc = p.src;
}
fs.writeFileSync(path.join(OUT, 'index.html'), doc);

console.log(`tools/reference/{index.html,main.js} from ${path.basename(pageFile)}${DET ? '  [determinism build]' : ''}`);
