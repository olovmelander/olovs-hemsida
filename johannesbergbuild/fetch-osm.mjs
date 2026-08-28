/* Fetch the OpenStreetMap extract for Johannesberg and its surroundings.

   Estate country north-east of Stockholm: the golf property, the manor, its
   lakes and the farmland and forest around them. The raw map API, one core
   bbox, then re-fetch any tagged way the bbox cut in half.                     */
import fs from 'node:fs';
import path from 'node:path';
import { CACHE } from './lib.mjs';

const CORE_BBOX = '18.152,59.703,18.232,59.752';
const REPAIR_TAGS = /k="natural" v="(water|wood|scrub|bare_rock|beach|sand|wetland)"|k="landuse" v="(forest|grass|meadow|residential|farmland)"|k="golf"|k="waterway"|k="leisure" v="nature_reserve"/;

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'johannesberg3d-johannesbergbuild/1 (+github.com/olovmelander/olovs-hemsida)' } });
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

const coreFile = path.join(CACHE, 'osm-core.xml');
if (fs.existsSync(coreFile) && !force) {
  console.log(`osm-core.xml: cached (${(fs.statSync(coreFile).size / 1024).toFixed(0)} KB)`);
} else {
  process.stdout.write(`osm-core.xml: fetching bbox ${CORE_BBOX} ... `);
  const buf = await get(`https://api.openstreetmap.org/api/0.6/map?bbox=${CORE_BBOX}`);
  fs.writeFileSync(coreFile, buf);
  console.log(`${(buf.length / 1024).toFixed(0)} KB`);
}

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
  fs.writeFileSync(out, await get(`https://api.openstreetmap.org/api/0.6/way/${id}/full`));
  fetched++;
  await new Promise(r => setTimeout(r, 120));
}
console.log(`repaired ways: ${clipped.length} on disk (${fetched} fetched)`);

const relIds = new Set();
for (const m of core.matchAll(/<relation id="(\d+)"[\s\S]*?<\/relation>/g))
  if (/k="natural" v="(water|wetland)"|k="water" v="lake"|k="landuse" v="forest"/.test(m[0])) relIds.add(m[1]);
for (const id of relIds) {
  const out = path.join(CACHE, `osm-rel-${id}.xml`);
  if (fs.existsSync(out) && !force) { console.log(`relation ${id}: cached`); continue; }
  process.stdout.write(`relation ${id}: fetching full ... `);
  fs.writeFileSync(out, await get(`https://api.openstreetmap.org/api/0.6/relation/${id}/full`));
  console.log('ok');
}
if (!relIds.size) console.log('no multipolygon relations');
