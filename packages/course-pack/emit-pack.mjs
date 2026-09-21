/* Emit a course pack from a build directory's committed JSON.

   usage: node packages/course-pack/emit-pack.mjs <buildDir> <outDir> [slug]
     e.g. node packages/course-pack/emit-pack.mjs angsobuild apps/golf/public/courses/angso

   The header slug defaults to the build dir name minus "build"; pass it
   explicitly where the two differ (nvgkbuild's course is "norrfallsviken").

   The pure compiler in compile-pack.mjs is also used by staged production.
   It preserves the established vector key order, old-schema translation and
   level-9 deflate encoding. This CLI remains a filesystem wrapper. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './lib.mjs';
import { compilePack } from './compile-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [buildDir, outDir, slugArg] = process.argv.slice(2);
if (!buildDir || !outDir) { console.error('usage: emit-pack.mjs <buildDir> <outDir> [slug]'); process.exit(2); }
const HERE = path.join(ROOT, buildDir);
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const model = readJSON(path.join(HERE, 'course-model.json'));
const hf = readJSON(path.join(HERE, 'heightfields.json'));
let cover = null;
try { cover = readJSON(path.join(HERE, 'tree-cover.json')); } catch {}

const slug = slugArg || path.basename(buildDir.replace(/\/$/, '')).replace(/build$/, '');
const pack = compilePack({ model, heightfields: hf, cover, slug });

const outAbs = path.join(ROOT, outDir);
fs.mkdirSync(outAbs, { recursive: true });
const file = path.join(outAbs, 'pack.bin');
fs.writeFileSync(file, pack);
console.log(`${path.relative(ROOT, file)}  ${(pack.length / 1024).toFixed(0)} KB  sha256 ${sha256(pack).slice(0, 16)}…`);
