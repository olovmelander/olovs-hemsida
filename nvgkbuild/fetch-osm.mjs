/* Fetch the OpenStreetMap extract for the Mjällom cape.

   Same approach as geobuild/fetch-osm.mjs: the raw map API (Overpass resets on
   large geometry responses), one core bbox, then re-fetch any tagged way the
   bbox clipped. Here the feature that must never arrive clipped is the
   natural=coastline chain — the sea IS the eastern edge of this course.

   The bbox covers the whole cape: the course (62.977–62.988), Storsanden beach
   and reserve to the north, the fishing village, marina and chapel to the
   south-west, and the holiday village between them.                            */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './lib.mjs';

const CORE_BBOX = '18.495,62.955,18.560,63.000';
const REPAIR_TAGS = /k="natural" v="(water|wood|scrub|bare_rock|beach|sand|wetland|coastline)"|k="landuse" v="(forest|grass|meadow|residential)"|k="golf"|k="waterway"|k="leisure" v="(marina|nature_reserve)"/;

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'norrfallsviken3d-nvgkbuild/1 (+github.com/olovmelander/olovs-hemsida)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      const wait = 2000 * 2 ** i;
      process.stderr.write(`  retry ${i + 1}/${tries - 1} after ${wait / 1000}s (${e.message})\n`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

const force = process.argv.includes('--force');
fs.mkdirSync(CACHE, { recursive: true });

/* --- the core extract -------------------------------------------------------- */
const coreFile = path.join(CACHE, 'osm-core.xml');
if (fs.existsSync(coreFile) && !force) {
  console.log(`osm-core.xml: cached (${(fs.statSync(coreFile).size / 1024).toFixed(0)} KB)`);
} else {
  process.stdout.write(`osm-core.xml: fetching bbox ${CORE_BBOX} ... `);
  const buf = await get(`https://api.openstreetmap.org/api/0.6/map?bbox=${CORE_BBOX}`);
  fs.writeFileSync(coreFile, buf);
  console.log(`${(buf.length / 1024).toFixed(0)} KB`);
}

/* --- find what the bbox cut in half ------------------------------------------ */
const core = fs.readFileSync(coreFile, 'utf8');
const haveNodes = new Set();
for (const m of core.matchAll(/<node id="(\d+)"/g)) haveNodes.add(m[1]);

const clipped = [];
for (const m of core.matchAll(/<way id="(\d+)"[\s\S]*?<\/way>/g)) {
  if (!REPAIR_TAGS.test(m[0])) continue;
  const refs = [...m[0].matchAll(/<nd ref="(\d+)"/g)].map(r => r[1]);
  if (refs.some(r => !haveNodes.has(r))) clipped.push(m[1]);
}
console.log(`ways clipped by the bbox: ${clipped.length}`);

fs.mkdirSync(path.join(CACHE, 'ways'), { recursive: true });
let fetched = 0;
for (const id of clipped) {
  const out = path.join(CACHE, 'ways', `${id}.xml`);
  if (fs.existsSync(out) && !force) continue;
  const buf = await get(`https://api.openstreetmap.org/api/0.6/way/${id}/full`);
  fs.writeFileSync(out, buf);
  fetched++;
  await new Promise(r => setTimeout(r, 120));            // be a good API citizen
}
console.log(`repaired ways: ${clipped.length} on disk (${fetched} fetched)`);

/* --- water/wetland relations, if any are multipolygons ------------------------ */
const relIds = new Set();
for (const m of core.matchAll(/<relation id="(\d+)"[\s\S]*?<\/relation>/g))
  if (/k="natural" v="(water|wetland)"|k="water" v="lake"/.test(m[0])) relIds.add(m[1]);
for (const id of relIds) {
  const out = path.join(CACHE, `osm-rel-${id}.xml`);
  if (fs.existsSync(out) && !force) { console.log(`relation ${id}: cached`); continue; }
  process.stdout.write(`relation ${id}: fetching full ... `);
  fs.writeFileSync(out, await get(`https://api.openstreetmap.org/api/0.6/relation/${id}/full`));
  console.log('ok');
}
if (!relIds.size) console.log('no water relations: every water body is a closed way');
