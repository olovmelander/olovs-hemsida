/* Reference views of each club's clubhouse, from the imagery that is already
   this project's authority for anything it can see from above.

   usage: node tools/clubhouse-refs.mjs [--zoom 19] [--course slug]

   For each course it finds the clubhouse footprint in the committed model,
   converts its centroid to lat/lon through the model's own frame, pulls the
   Esri World Imagery tiles around it, and writes a crop with the OSM footprint
   drawn on top. Two things come out of that in one picture: what the roof
   actually looks like (shape, ridge direction, colour), and whether the
   footprint we extrude is the building that is standing there.

   Tiles are orthorectified, so a tile's coordinates ARE its georeference -- the
   same reason the tree-cover raster trusts them. The footprint overlay is
   therefore a real check, not a decoration.

   Stitching happens in the Chrome the harnesses already drive: the tiles are
   fetched here and handed over as data URLs, so nothing depends on the tile
   server's CORS headers. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'geobuild/cache/clubhouse');
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const Z = +flag('zoom', 19);
const ONLY = flag('course', null);

const BUILDS = {
  norrfallsviken: 'nvgkbuild', puttom: 'puttombuild', angso: 'angsobuild',
  upsala: 'upsalabuild', johannesberg: 'johannesbergbuild', veckefjarden: 'geobuild',
};

const centroid = r => [r.reduce((s, q) => s + q[0], 0) / r.length,
                       r.reduce((s, q) => s + q[1], 0) / r.length];
const areaOf = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++)
  a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };

/* world metres -> lat/lon, through the model's own frame. North is -z. */
const toLatLon = (m, x, z) => [m.origin.lat - z / m.mPerLat, m.origin.lon + x / m.mPerLon];
/* lat/lon -> fractional Web Mercator tile at zoom Z */
const toTile = (lat, lon, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n,
          (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });

for (const [slug, build] of Object.entries(BUILDS)) {
  if (ONLY && slug !== ONLY) continue;
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, build, 'course-model.json'), 'utf8'));
  const buildings = (m.infra && m.infra.buildings) || [];
  const cands = buildings.filter(b => b.amenity === 'clubhouse'
    || (b.name && /golfklubb|klubbhus|golf club/i.test(b.name)));
  if (!cands.length) { console.log(`${slug}: no clubhouse in the model`); continue; }
  cands.sort((a, b) => areaOf(b.ring) - areaOf(a.ring));
  const club = cands[0];
  const c = centroid(club.ring);
  const [lat, lon] = toLatLon(m, c[0], c[1]);
  const [ftx, fty] = toTile(lat, lon, Z);
  const RAD = 1;                                  /* tiles either side -> 3x3 */
  const x0 = Math.floor(ftx) - RAD, y0 = Math.floor(fty) - RAD, span = RAD * 2 + 1;

  const tiles = [];
  for (let dy = 0; dy < span; dy++) for (let dx = 0; dx < span; dx++) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y0 + dy}/${x0 + dx}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('http ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      tiles.push({ dx, dy, src: 'data:image/jpeg;base64,' + buf.toString('base64') });
    } catch (e) { console.log(`  ${slug}: tile ${dx},${dy} failed (${e.message})`); }
  }

  /* every footprint near the clubhouse, in pixels of the stitched mosaic */
  const near = buildings.filter(b => Math.hypot(...centroid(b.ring).map((v, i) => v - c[i])) < 90);
  const polys = near.map(b => ({
    name: b.name || '', isClub: b === club,
    pts: b.ring.map(p => {
      const [la, lo] = toLatLon(m, p[0], p[1]);
      const [tx, ty] = toTile(la, lo, Z);
      return [(tx - x0) * 256, (ty - y0) * 256];
    }),
  }));

  const png = await page.evaluate(async ([tiles, polys, span, slug, lat, lon, Z]) => {
    const S = span * 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, S, S);
    for (const t of tiles) {
      const im = new Image();
      await new Promise(ok => { im.onload = ok; im.onerror = ok; im.src = t.src; });
      g.drawImage(im, t.dx * 256, t.dy * 256);
    }
    for (const p of polys) {
      g.beginPath();
      p.pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]));
      g.closePath();
      g.lineWidth = p.isClub ? 3 : 1.5;
      g.strokeStyle = p.isClub ? '#ff3b30' : 'rgba(0,200,255,.85)';
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(0, 0, S, 34);
    g.fillStyle = '#fff'; g.font = '16px system-ui';
    g.fillText(`${slug} — clubhouse (red) — z${Z} — ${lat.toFixed(5)}, ${lon.toFixed(5)}`, 10, 22);
    return cv.toDataURL('image/png').split(',')[1];
  }, [tiles, polys, span, slug, lat, lon, Z]);

  const file = path.join(OUT, `${slug}-z${Z}.png`);
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`${slug.padEnd(16)} ${areaOf(club.ring).toFixed(0).padStart(5)} m2  ${club.ring.length} pts  ${lat.toFixed(5)},${lon.toFixed(5)}  -> ${path.relative(ROOT, file)}`);
}
await browser.close();
