/* Capture the golden screenshot matrix: 12 views per course, one boot each via
   shot.mjs --seq. The captures are APPROVAL CANDIDATES: a person signs them off
   per course, and from then on they are the baseline tools/parity.mjs measures
   against (--perceptual for shader work, strict for everything else).

   usage: node tools/goldens.mjs <base-url> [--course slug] [--ground atlas|mesh]
                                 [--out-dir tools/goldens]
   e.g.   node tools/goldens.mjs http://127.0.0.1:8620 --course norrfallsviken
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GOLDEN_VIEWS = [
  { id: '01_h1_tee_kvall', hole: 1, cam: 'tee', preset: 'golden' },
  { id: '02_h1_green_kvall', hole: 1, cam: 'green', preset: 'golden' },
  { id: '03_h1_fritt_kvall', hole: 1, cam: 'orbit', preset: 'golden' },
  { id: '04_h1_ovan_dag', hole: 1, cam: 'top', preset: 'noon' },
  { id: '05_h2_tee_dag', hole: 2, cam: 'tee', preset: 'noon' },
  { id: '06_h5_tee_kvall', hole: 5, cam: 'tee', preset: 'golden' },
  { id: '07_h9_green_kvall', hole: 9, cam: 'green', preset: 'golden' },
  { id: '08_h10_tee_dag', hole: 10, cam: 'tee', preset: 'noon' },
  { id: '09_h13_tee_kvall', hole: 13, cam: 'tee', preset: 'golden' },
  { id: '10_h14_green_kvall', hole: 14, cam: 'green', preset: 'golden' },
  { id: '11_h18_tee_dag', hole: 18, cam: 'tee', preset: 'noon' },
  { id: '12_h18_green_kvall', hole: 18, cam: 'green', preset: 'golden' },
];

export const COURSES = ['angso', 'johannesberg', 'norrfallsviken', 'puttom', 'upsala', 'veckefjarden'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = args[0] && !args[0].startsWith('--') ? args[0] : 'http://127.0.0.1:8620';
const selected = flag('course', null);
const ground = flag('ground', 'atlas');
const outRoot = path.resolve(ROOT, flag('out-dir', 'tools/goldens'));

const seq = GOLDEN_VIEWS.map(v => `${v.hole}:${v.cam}:${v.preset}`).join(',');
let failed = 0;

for (const slug of selected ? [selected] : COURSES) {
  const dir = path.join(outRoot, ground === 'mesh' ? `${slug}-mesh` : slug);
  fs.mkdirSync(dir, { recursive: true });
  const url = `${BASE}/?bana=${slug}&det=1${ground === 'mesh' ? '&ground=mesh' : ''}`;
  const tmp = path.join(dir, '_cap.png');
  console.log(`\n${slug} (${ground}) <- ${url}`);
  try {
    execFileSync('node', [path.join(ROOT, 'geobuild/shot.mjs'), url, tmp, '--seq', seq],
      { stdio: 'inherit', cwd: ROOT });
  } catch {
    console.error(`  FAIL: capture did not complete for ${slug}`);
    failed++;
    continue;
  }
  GOLDEN_VIEWS.forEach((v, i) => {
    const from = path.join(dir, `_cap-${i + 1}.png`);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, `${v.id}.png`));
    else { console.error(`  FAIL: missing view ${v.id}`); failed++; }
  });
}
console.log(failed ? `\n${failed} capture(s) FAILED` : '\nall goldens captured');
process.exit(failed ? 1 : 0);
