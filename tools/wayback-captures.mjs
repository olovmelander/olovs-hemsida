#!/usr/bin/env node
/* Which dated capture is under a course, and where the live mosaic changes.

   Esri's World Imagery is a MOSAIC: neighbouring tiles can come from different
   flights on different dates, and the live service shows whatever is newest per
   block. Tracing a course off it therefore mixes captures -- at Veckefjärden
   half the course was leaf-off with a winter cover over the 1st green. Wayback
   keeps every past release of the same tiling scheme, so a release IS a dated
   state of the mosaic, and one release where every probe tile carries one
   capture date is a single-capture tracing frame.

   The method needs no metadata to work: fetch the SAME z18 tile from every
   release and hash the bytes. Identical hashes are the same imagery; the
   release where a hash changes is when that block was re-flown. Run it over
   several probe points and a patchwork shows itself -- the blocks change at
   different releases. The metadata service is then asked only for the distinct
   states, and it answers with the capture date, the sensor and the resolution.

     node tools/wayback-captures.mjs --build angsobuild
     node tools/wayback-captures.mjs --build geobuild --probe 0,0 --probe -300,600
     node tools/wayback-captures.mjs --build angsobuild --out angsobuild/imagery-captures.json

   Probes default to the played bounding box of <build>/course-model.json: its
   centre and four inset corners, which is what catches a seam THROUGH a course.  */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const many = n => argv.flatMap((v, i) => v === `--${n}` && i + 1 < argv.length ? [argv[i + 1]] : []);
const BUILD = flag('build');
if (!BUILD) throw new Error('usage: --build <dir> [--probe x,z ...] [--z 18] [--out file.json]');
const Z = +flag('z', 18);
const OUT = flag('out', path.join(ROOT, BUILD, 'imagery-captures.json'));

const lib = await import(pathToFileURL(path.join(ROOT, BUILD, 'lib.mjs')).href);
const { ORIGIN, M_PER_LON } = lib;
const M_PER_LAT = lib.M_PER_LAT ?? 111320;

/* --- probes ------------------------------------------------------------------ */
let probes = many('probe').map(s => s.split(',').map(Number));
if (!probes.length) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, BUILD, 'course-model.json'), 'utf8'));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const add = p => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } };
  for (const h of m.holes) { h.line.forEach(add); (h.green?.ring || []).forEach(add); }
  const ix = (x1 - x0) * 0.15, iz = (z1 - z0) * 0.15;
  probes = [[(x0 + x1) / 2, (z0 + z1) / 2], [x0 + ix, z0 + iz], [x1 - ix, z0 + iz], [x0 + ix, z1 - iz], [x1 - ix, z1 - iz]];
}
const n2 = 2 ** Z;
const tileOf = ([x, z]) => {
  const lon = ORIGIN.lon + x / M_PER_LON, lat = ORIGIN.lat - z / M_PER_LAT;
  return [Math.floor((lon + 180) / 360 * n2), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n2), lon, lat];
};
const tiles = probes.map(p => { const [tx, ty, lon, lat] = tileOf(p); return { p, tx, ty, lon, lat }; });
console.log(`${BUILD}: ${probes.length} probes at z${Z}`);
for (const t of tiles) console.log(`  (${t.p.map(v => Math.round(v))}) -> tile ${t.tx}/${t.ty}  ${t.lat.toFixed(5)} ${t.lon.toFixed(5)}`);

/* --- releases, newest first --------------------------------------------------- */
const cfg = await (await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json')).json();
const releases = Object.entries(cfg).map(([id, r]) => ({ id: +id, title: r.itemTitle, url: r.itemURL, meta: r.metadataLayerUrl,
  date: (r.itemTitle.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || null }))
  .filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
console.log(`${releases.length} Wayback releases, ${releases.at(-1).date} .. ${releases[0].date}`);

/* --- hash every probe tile in every release ----------------------------------- */
const jobs = [];
for (const r of releases) for (const t of tiles) jobs.push({ r, t });
const results = new Map();                       /* `${release}|${tx}/${ty}` -> sha */
let done = 0, failed = 0;
async function worker() {
  for (;;) {
    const j = jobs.shift(); if (!j) return;
    const url = j.r.url.replace('{level}', Z).replace('{row}', j.t.ty).replace('{col}', j.t.tx);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) { if (res.status === 404) { results.set(`${j.r.id}|${j.t.tx}/${j.t.ty}`, null); break; } throw new Error(res.status); }
        const buf = Buffer.from(await res.arrayBuffer());
        results.set(`${j.r.id}|${j.t.tx}/${j.t.ty}`, createHash('sha256').update(buf).digest('hex').slice(0, 16));
        break;
      } catch (e) { if (attempt >= 3) { failed++; results.set(`${j.r.id}|${j.t.tx}/${j.t.ty}`, null); break; } await new Promise(r => setTimeout(r, 400 * 2 ** attempt)); }
    }
    if (++done % 100 === 0) process.stdout.write(`\r  hashed ${done}/${releases.length * tiles.length}`);
  }
}
await Promise.all(Array.from({ length: 10 }, worker));
console.log(`\r  hashed ${done} tiles${failed ? `, ${failed} failed` : ''}`);

/* --- per probe: the releases where its block changed --------------------------- */
const perProbe = tiles.map(t => {
  const runs = [];
  for (const r of releases) {                       /* newest first */
    const sha = results.get(`${r.id}|${t.tx}/${t.ty}`);
    if (!sha) continue;
    if (!runs.length || runs.at(-1).sha !== sha) runs.push({ sha, newest: r, oldest: r });
    else runs.at(-1).oldest = r;
  }
  return { tile: `${t.tx}/${t.ty}`, p: t.p.map(v => Math.round(v)), lon: t.lon, lat: t.lat, runs };
});

/* --- ask the metadata service for the date of each distinct state --------------- */
const dateCache = new Map();
async function capture(rel, lon, lat) {
  const key = `${rel.id}|${lon.toFixed(4)},${lat.toFixed(4)}`;
  if (dateCache.has(key)) return dateCache.get(key);
  const pt = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
  let best = null;
  for (const L of [3, 4, 5, 6]) {
    const q = new URLSearchParams({ geometry: pt, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'SRC_DATE,SRC_RES,SRC_DESC,NICE_DESC,MinMapLevel,MaxMapLevel', returnGeometry: 'false', f: 'json' });
    let j; try { j = await (await fetch(`${rel.meta}/${L}/query?${q}`)).json(); } catch { continue; }
    for (const f of j.features || []) {
      const a = f.attributes;
      if (a.MaxMapLevel < Z) continue;
      const c = { date: a.SRC_DATE ? String(a.SRC_DATE).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : null, res: a.SRC_RES, sensor: a.SRC_DESC, provider: a.NICE_DESC };
      if (!best || (c.res ?? 99) < (best.res ?? 99)) best = c;
    }
    if (best) break;
  }
  dateCache.set(key, best);
  return best;
}
for (const pr of perProbe) for (const run of pr.runs.slice(0, 8)) run.capture = await capture(run.newest, pr.lon, pr.lat);

console.log('');
for (const pr of perProbe) {
  console.log(`probe (${pr.p}) tile ${pr.tile}`);
  for (const run of pr.runs.slice(0, 6)) {
    const c = run.capture;
    console.log(`  ${run.newest.date} .. ${run.oldest.date}  ${run.sha}  ${c ? `${c.date ?? 'undated'} ${c.res ?? '?'} m ${c.sensor ?? ''} ${c.provider ?? ''}` : 'no metadata'}`);
  }
  if (pr.runs.length > 6) console.log(`  … ${pr.runs.length - 6} older states`);
}

/* --- a release where every probe carries ONE capture date ---------------------- */
const uniform = [];
for (const r of releases) {
  const caps = perProbe.map(pr => pr.runs.find(run => run.newest.date >= r.date && run.oldest.date <= r.date));
  if (caps.some(c => !c || !c.capture)) continue;
  const dates = [...new Set(caps.map(c => c.capture.date))];
  if (dates.length === 1) uniform.push({ release: r.id, releaseDate: r.date, capture: dates[0], res: Math.max(...caps.map(c => c.capture.res ?? 0)), sensor: caps[0].capture.sensor, provider: caps[0].capture.provider });
}
const byCapture = new Map();
for (const u of uniform) if (!byCapture.has(u.capture)) byCapture.set(u.capture, u);
console.log('\nreleases where every probe carries ONE capture date (newest release per capture):');
for (const u of byCapture.values()) console.log(`  release ${u.release} (${u.releaseDate})  capture ${u.capture}  ${u.res} m  ${u.sensor} ${u.provider}`);
if (!byCapture.size) console.log('  none -- every release is a patchwork over these probes');

const out = { probedOn: new Date().toISOString().slice(0, 10), build: BUILD, zoom: Z, origin: ORIGIN, probes: perProbe.map(pr => ({ ...pr, runs: pr.runs.map(r => ({ sha: r.sha, newestRelease: r.newest.id, newestDate: r.newest.date, oldestRelease: r.oldest.id, oldestDate: r.oldest.date, capture: r.capture ?? null })) })), uniformReleases: [...byCapture.values()] };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
