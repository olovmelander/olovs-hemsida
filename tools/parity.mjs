/* Are these two screenshots the same picture? Exits non-zero if not.

   usage: node tools/parity.mjs <a.png> <b.png> [more pairs ...]

   Strict on purpose. Both pages run the same code over what check-pack proved
   are the same bytes, on the same software rasterizer, with both clocks pinned
   -- so the honest expectation is IDENTITY, and the gate only forgives what a
   compositor is entitled to: up to 0.05% of pixels differing by more than 2/255
   per channel (antialiased edge crawl where a polygon meets the HUD), and a
   mean absolute difference under 0.10/255. Anything past that is a real
   divergence and the gate says so instead of averaging it away.              */
import fs from 'node:fs';
import { decodePNG } from '../geobuild/png.mjs';

const files = process.argv.slice(2);
if (files.length < 2 || files.length % 2) { console.error('usage: parity.mjs <a.png> <b.png> [...]'); process.exit(2); }

let bad = 0;
for (let p = 0; p < files.length; p += 2) {
  const A = decodePNG(fs.readFileSync(files[p])), B = decodePNG(fs.readFileSync(files[p + 1]));
  const name = `${files[p].split('/').pop()} vs ${files[p + 1].split('/').pop()}`;
  if (A.width !== B.width || A.height !== B.height) {
    console.log(`FAIL ${name}: ${A.width}x${A.height} vs ${B.width}x${B.height}`);
    bad++; continue;
  }
  const n = A.width * A.height;
  let sum = 0, off = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    const oA = i * A.channels, oB = i * B.channels;
    let px = 0;
    for (let c = 0; c < 3; c++) px = Math.max(px, Math.abs(A.data[oA + c] - B.data[oB + c]));
    sum += px; if (px > 2) off++; if (px > worst) worst = px;
  }
  const mean = sum / n, pctOff = 100 * off / n;
  const ok = mean <= 0.10 && pctOff <= 0.05;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  mean ${mean.toFixed(4)}/255  >2: ${pctOff.toFixed(3)}%  worst ${worst}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
