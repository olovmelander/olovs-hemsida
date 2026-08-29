/* Are these two screenshots the same picture? Exits non-zero if not.

   usage: node tools/parity.mjs [--perceptual] <a.png> <b.png> [more pairs ...]

   Strict (default):
   - mean absolute difference <= 0.10/255
   - >2/255 diffs <= 0.05%

   Perceptual (--perceptual):
   - mean absolute difference <= 2.50/255
   - >8/255 diffs <= 5.00%
*/
import fs from 'node:fs';
import { decodePNG } from '../geobuild/png.mjs';

let args = process.argv.slice(2);
let isPerceptual = false;
if (args[0] === '--perceptual') {
  isPerceptual = true;
  args = args.slice(1);
}

const files = args;
if (files.length < 2 || files.length % 2) {
  console.error('usage: parity.mjs [--perceptual] <a.png> <b.png> [...]');
  process.exit(2);
}

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
  const threshold = isPerceptual ? 8 : 2;
  for (let i = 0; i < n; i++) {
    const oA = i * A.channels, oB = i * B.channels;
    let px = 0;
    for (let c = 0; c < 3; c++) px = Math.max(px, Math.abs(A.data[oA + c] - B.data[oB + c]));
    sum += px; if (px > threshold) off++; if (px > worst) worst = px;
  }
  const mean = sum / n, pctOff = 100 * off / n;
  const maxMean = isPerceptual ? 2.50 : 0.10;
  const maxPct = isPerceptual ? 5.00 : 0.05;
  const ok = mean <= maxMean && pctOff <= maxPct;
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${isPerceptual ? 'perceptual' : 'strict'}] ${name}  mean ${mean.toFixed(4)}/255  >${threshold}: ${pctOff.toFixed(3)}%  worst ${worst}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
