/* Emit a course pack from a build directory's committed JSON.

   usage: node packages/course-pack/emit-pack.mjs <buildDir> <outDir> [slug]
     e.g. node packages/course-pack/emit-pack.mjs angsobuild apps/golf/public/courses/angso

   The header slug defaults to the build dir name minus "build"; pass it
   explicitly where the two differ (nvgkbuild's course is "norrfallsviken").

   This is embed.mjs minus the base64 and the HTML splicing. The vec shape below
   is copied VERBATIM from the builds' embed.mjs -- the five newer builds carry
   it byte-identically (diffed before this file was written), and keeping the
   key order identical is what lets check-pack prove the pack equals the page:
   deflateRawSync at level 9 over the same JSON is the same stream.

   Veckefjarden's embed differs (older schema: lakeLevel, marking, surround) and
   is NOT served by this shape yet -- that is the Phase 4 merge, and this script
   refuses geobuild rather than emitting something silently wrong.              */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writePack, sha256 } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [buildDir, outDir, slugArg] = process.argv.slice(2);
if (!buildDir || !outDir) { console.error('usage: emit-pack.mjs <buildDir> <outDir> [slug]'); process.exit(2); }
/* Veckefjarden is the older schema and the one course whose extra fields are not
   empty: it carries penalty MARKING, the SURROUND traces (clear-fells, the
   machinery yard, the As hayfields, the silt shallows), a sponsor line per hole,
   and a water level called lakeLevel. The engine already reads all of those
   defensively -- the newer courses simply hand it empty ones -- so the merge is
   a mapping, not a rewrite. The one real translation is the level: the engine's
   GEO.seaLevel means "the level water sits at", and for a regulated lake behind
   a 1939 lock that is 21.59 m, not zero. The sea machinery is keyed off
   water[].isSea, which no Veckefjarden ring carries, so it correctly no-ops. */
const HERE = path.join(ROOT, buildDir);
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const model = readJSON(path.join(HERE, 'course-model.json'));
/* Which schema this is, asked of the MODEL rather than of the directory name.
   It used to be `buildDir === 'geobuild'`, which was true while geobuild was the
   only holder of the older shape -- but Veckefjarden's korthalsbana is a second
   course built on that same model, in its own directory, and a name test would
   have silently emptied its penalty marking and its silt shallows and left its
   water level undefined. The distinguishing fact is the field itself.        */
const OLD = model.lakeLevel !== undefined;
const hf = readJSON(path.join(HERE, 'heightfields.json'));
let cover = null;
try { cover = readJSON(path.join(HERE, 'tree-cover.json')); } catch {}

/* -- verbatim from the builds' embed.mjs; do not "improve" the key order -------- */
const vec = {
  holes: model.holes.map(h => ({
    n: h.n, par: h.par, idx: h.idx, t: h.t,
    line: h.line, lineLen: h.lineLen, pin: h.pin,
    green: { ring: h.green.ring, c: h.green.c },
    fairway: { rings: h.fairway.rings },
    tees: { pads: h.tees.pads.map(p => ({ ring: p.ring })), marks: h.tees.marks.map(m => ({ c: m.c, b: m.b, m: m.m })) },
    bunkers: h.bunkers.map(b => ({ ring: b.ring })),
    elev: h.elev, tiers: h.tiers,
    name: h.name, note: h.note, shape: h.shape,
    ...(OLD ? { sp: h.sp } : {}),
  })),
  water: model.water.map(w => ({ ring: w.ring, level: w.level, isLake: w.isLake, isSea: !!w.isSea, area: w.area })),
  marking: OLD ? model.marking.map(m => ({ c: m.color, pts: m.pts })) : [],
  streams: model.streams.map(s => ({ line: s.line, w: s.w })),
  veg: model.vegetation,
  cover,
  infra: model.infra,
  surround: OLD ? model.surround : { clearfells: [], yard: null, hayfields: null, shallows: [] },
  scenery: model.scenery,
};
/* ------------------------------------------------------------------------------- */

const raw = obj => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 });
const b64ToRaw = s => Buffer.from(s, 'base64');

const slug = slugArg || path.basename(buildDir.replace(/\/$/, '')).replace(/build$/, '');
const pack = writePack({
  slug,
  geo: { origin: model.origin, mPerLon: model.mPerLon,
         seaLevel: OLD ? model.lakeLevel : model.seaLevel, frame: model.frame },
  hf0: { x0: hf.hf0.x0, z0: hf.hf0.z0, dx: hf.hf0.dx, nx: hf.hf0.nx, nz: hf.hf0.nz, h0: hf.hf0.h0, hs: hf.hf0.hs },
  hf1: { x0: hf.hf1.x0, z0: hf.hf1.z0, dx: hf.hf1.dx, nx: hf.hf1.nx, nz: hf.hf1.nz, h0: hf.hf1.h0, hs: hf.hf1.hs },
  streams: [b64ToRaw(hf.hf0.b64), b64ToRaw(hf.hf1.b64), raw(vec)],
});

const outAbs = path.join(ROOT, outDir);
fs.mkdirSync(outAbs, { recursive: true });
const file = path.join(outAbs, 'pack.bin');
fs.writeFileSync(file, pack);
console.log(`${path.relative(ROOT, file)}  ${(pack.length / 1024).toFixed(0)} KB  sha256 ${sha256(pack).slice(0, 16)}…`);
