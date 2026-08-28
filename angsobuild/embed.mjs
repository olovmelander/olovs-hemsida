/* Bake the reconciled Ängsö GK course into the page.

   Same discipline as geobuild/embed.mjs: only the block between the GEODATA
   anchors is rewritten, and the patcher refuses unless each anchor matches
   exactly once.

   Usage: node nvgkbuild/embed.mjs [in.html] [out.html]                        */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJSON, patcher, deflateB64 } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const inFile = process.argv[2] || path.join(ROOT, 'angso3d.html');
const outFile = process.argv[3] || inFile;

const model = readJSON(path.join(HERE, 'course-model.json'));
const hf = readJSON(path.join(HERE, 'heightfields.json'));
let cover = null;
try { cover = readJSON(path.join(HERE, 'tree-cover.json')); } catch {}

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
  })),
  water: model.water.map(w => ({ ring: w.ring, level: w.level, isLake: w.isLake, isSea: !!w.isSea, area: w.area })),
  marking: [],
  streams: model.streams.map(s => ({ line: s.line, w: s.w })),
  veg: model.vegetation,
  cover,
  infra: model.infra,
  surround: { clearfells: [], yard: null, hayfields: null, shallows: [] },
  scenery: model.scenery,
};

const B64 = s => `'${s}'`;
const block = `
const GEO = ${JSON.stringify({ origin: model.origin, mPerLon: model.mPerLon, seaLevel: model.seaLevel, frame: model.frame })};
const HF0 = ${JSON.stringify({ x0: hf.hf0.x0, z0: hf.hf0.z0, dx: hf.hf0.dx, nx: hf.hf0.nx, nz: hf.hf0.nz, h0: hf.hf0.h0, hs: hf.hf0.hs })};
HF0.b64 = ${B64(hf.hf0.b64)};
const HF1 = ${JSON.stringify({ x0: hf.hf1.x0, z0: hf.hf1.z0, dx: hf.hf1.dx, nx: hf.hf1.nx, nz: hf.hf1.nz, h0: hf.hf1.h0, hs: hf.hf1.hs })};
HF1.b64 = ${B64(hf.hf1.b64)};
const VEC64 = ${B64(deflateB64(vec))};
`;

const src = fs.readFileSync(inFile, 'utf8');
const A = '/*@GEODATA*/', B = '/*@/GEODATA*/';
const i = src.indexOf(A), j = src.indexOf(B);
if (i < 0 || j < 0) throw new Error('embed: GEODATA anchors not found');
const old = src.slice(i + A.length, j);
const p = patcher(src).sub('geodata', A + old + B, A + block + B);
fs.writeFileSync(outFile, p.src);

const size = fs.statSync(outFile).size;
console.log(`embedded into ${path.relative(process.cwd(), outFile)}`);
console.log(`  HF0 ${(hf.hf0.b64.length / 1024).toFixed(0)} KB   HF1 ${(hf.hf1.b64.length / 1024).toFixed(0)} KB   vectors ${(deflateB64(vec).length / 1024).toFixed(0)} KB`);
console.log(`  page ${(size / 1024).toFixed(0)} KB total`);
if (size > 1150 * 1024) { console.error('  OVER BUDGET: the page must stay near 1 MB'); process.exit(1); }
