/* Bake the reconciled course into the page.

   Only the one block between the GEODATA anchors is ever rewritten, and the patcher
   refuses unless each anchor matches exactly once. This file has been destroyed by a
   blind regex edit before; an anchored replace that asserts its own uniqueness is the
   cheapest insurance against doing it again.

   Usage: node geobuild/embed.mjs [in.html] [out.html]                              */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, patcher, deflateB64, r1 } from './lib.mjs';

const inFile = process.argv[2] || path.join(ROOT, 'veckefjarden3d.html');
const outFile = process.argv[3] || inFile;

const model = readJSON(path.join(ROOT, 'geobuild/course-model.json'));
const hf = readJSON(path.join(ROOT, 'geobuild/heightfields.json'));
let cover = null;
try { cover = readJSON(path.join(ROOT, 'geobuild/tree-cover.json')); } catch {}

/* The page needs the shapes, not the audit trail: provenance, per-feature ids and the
   agreement figures belong in course-model.json and the report, where they can be
   read, and would otherwise be shipped to every visitor for nothing. */
const vec = {
  holes: model.holes.map(h => ({
    n: h.n, par: h.par, idx: h.idx, t: h.t,
    line: h.line, lineLen: h.lineLen, pin: h.pin,
    green: { ring: h.green.ring, c: h.green.c },
    fairway: { rings: h.fairway.rings },
    tees: { pads: h.tees.pads.map(p => ({ ring: p.ring })), marks: h.tees.marks.map(m => ({ c: m.c, b: m.b, m: m.m })) },
    bunkers: h.bunkers.map(b => ({ ring: b.ring })),
    elev: h.elev, tiers: h.tiers,
    name: h.name, note: h.note, shape: h.shape, sp: h.sp,
  })),
  water: model.water.map(w => ({ ring: w.ring, level: w.level, isLake: w.isLake, area: w.area })),
  marking: model.marking.map(m => ({ c: m.color, pts: m.pts })),
  streams: model.streams.map(s => ({ line: s.line, w: s.w })),
  veg: model.vegetation,
  cover,
  infra: model.infra,
  scenery: model.scenery,
};

const B64 = s => `'${s}'`;
const block = `
const GEO = ${JSON.stringify({ origin: model.origin, mPerLon: model.mPerLon, lakeLevel: model.lakeLevel, frame: model.frame })};
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
if (size > 1024 * 1024) { console.error('  OVER BUDGET: the page must stay under 1 MB'); process.exit(1); }
