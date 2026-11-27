#!/usr/bin/env node
/* Which of Lantmäteriet's orthophoto flights cover Kronholmen, and which of them this
   account may read: a STAC search over the course box (the 18 holes and 200 m), each
   collection's items written to visbybuild/cache/ortho/stac-<collection>.json in the form
   acquire-ortho-windows.py reads, and a HEAD-style range probe of each item's COG. The
   September dossier found the 2026 flight's COGs refused (401/403) for this account.

   node --env-file=<checkout>/.env visbybuild/stac-ortho-discovery.mjs

   Credentials come only from LANTMATERIET_USERNAME / LANTMATERIET_PASSWORD and are never
   written; the cache folder is ignored. */
import fs from 'node:fs';
import path from 'node:path';

const BOX = [686950, 6370350, 688550, 6372150];          /* E/N min, E/N max (SWEREF 99 TM) */
/* SWEREF 99 TM to WGS 84 (GRS 80, central meridian 15 E, scale 0.9996, false easting 500 km;
   Lantmäteriet's Gauss-Krüger formulas), for the search's longitude/latitude box */
function sweref(e, n) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, fe = 500000, l0 = 15 * Math.PI / 180;
  const e2 = f * (2 - f), n1 = f / (2 - f), ah = a / (1 + n1) * (1 + n1 * n1 / 4 + n1 ** 4 / 64);
  const d1 = n1 / 2 - 2 * n1 * n1 / 3 + 37 * n1 ** 3 / 96, d2 = n1 * n1 / 48 + n1 ** 3 / 15, d3 = 17 * n1 ** 3 / 480;
  const xi = n / (k0 * ah), eta = (e - fe) / (k0 * ah);
  const xp = xi - d1 * Math.sin(2 * xi) * Math.cosh(2 * eta) - d2 * Math.sin(4 * xi) * Math.cosh(4 * eta) - d3 * Math.sin(6 * xi) * Math.cosh(6 * eta);
  const ep = eta - d1 * Math.cos(2 * xi) * Math.sinh(2 * eta) - d2 * Math.cos(4 * xi) * Math.sinh(4 * eta) - d3 * Math.cos(6 * xi) * Math.sinh(6 * eta);
  const phis = Math.asin(Math.sin(xp) / Math.cosh(ep)), dl = Math.atan(Math.sinh(ep) / Math.cos(xp));
  const A = e2 + e2 ** 2 + e2 ** 3 + e2 ** 4, B = -(7 * e2 ** 2 + 17 * e2 ** 3 + 30 * e2 ** 4) / 6;
  const C = (224 * e2 ** 3 + 889 * e2 ** 4) / 120, D = -(4279 * e2 ** 4) / 1260;
  const s2 = Math.sin(phis) ** 2, phi = phis + Math.sin(phis) * Math.cos(phis) * (A + B * s2 + C * s2 * s2 + D * s2 ** 3);
  return [(l0 + dl) * 180 / Math.PI, phi * 180 / Math.PI];
}
const toLonLat = b => { const [w, s] = sweref(b[0], b[1]), [e, n] = sweref(b[2], b[3]); return [w, s, e, n].map(v => +v.toFixed(6)); };
const OUT = path.resolve('visbybuild/cache/ortho');
const user = process.env.LANTMATERIET_USERNAME, pass = process.env.LANTMATERIET_PASSWORD;
if (!user || !pass) throw new Error('LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD are needed');
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
fs.mkdirSync(OUT, { recursive: true });

const response = await fetch('https://api.lantmateriet.se/stac-bild/v1/search', {
  method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' },
  body: JSON.stringify({ bbox: toLonLat(BOX), limit: 200 }),
});
if (!response.ok) throw new Error(`STAC search: HTTP ${response.status}`);
const found = await response.json();
const items = found.features ?? [];
const byCollection = new Map();
for (const item of items) {
  const c = item.collection ?? 'unknown';
  if (!/^orto/.test(c)) continue;
  (byCollection.get(c) ?? byCollection.set(c, []).get(c)).push(item);
}
const probe = async href => {
  try {
    const r = await fetch(href, { headers: { authorization: auth, range: 'bytes=0-15' } });
    await r.arrayBuffer();
    return r.status;
  } catch (error) { return String(error.message).slice(0, 60); }
};
for (const [collection, list] of [...byCollection].sort()) {
  const out = { groundId: 'visby', observedOn: new Date().toISOString().slice(0, 10),
    source: 'https://api.lantmateriet.se/stac-bild/v1/search', box: BOX,
    orthophoto: { collection, items: [] } };
  for (const item of list) {
    const href = item.assets?.data?.href ?? Object.values(item.assets ?? {}).find(a => /\.tif/.test(a.href ?? ''))?.href;
    const status = href ? await probe(href) : 'no asset';
    out.orthophoto.items.push({ id: item.id, collection, capturedAt: item.properties?.datetime ?? null,
      projBbox: item.properties?.['proj:bbox'] ?? item.bbox, status, assets: item.assets });
    console.log(`${collection.padEnd(16)} ${item.id.padEnd(26)} ${String(item.properties?.datetime ?? '').slice(0, 19)}  ${status}`);
  }
  fs.writeFileSync(path.join(OUT, `stac-${collection}.json`), JSON.stringify(out, null, 1));
}
console.log(`${items.length} items; records in ${OUT}`);
