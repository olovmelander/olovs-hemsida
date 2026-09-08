/* Cache Esri World Imagery z18 tiles over the course.

   The 2019 municipal orthophoto is CC0 and is the licensed record, but it is a
   LEAF-OFF spring frame: dormant turf, bare deciduous canopy and winter wear
   read as bright as sand, and detect-bunkers.py measures the cost -- it
   recovers 9 of the 40 mapped bunkers. This capture is leaf-on and 0.30 m,
   where a bunker is plainly a bunker.

   A tile's coordinates ARE its georeference (Web Mercator, orthorectified), so
   nothing read off it needs registering. Rights: this is a MEASURING
   instrument, the same use every other course in this repository makes of it.
   The tiles stay in the ignored cache and are never redistributed; what is
   committed is derived vector geometry and the measurements beside it. The
   licensed CC0 2019 imagery remains the record for anything that is published
   as an image.

     node lidingobuild/mapping/fetch-esri-z18.mjs [--release <id>]              */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const RELEASE = process.argv.includes('--release') ? process.argv[process.argv.indexOf('--release') + 1] : null;
const OUT = path.join(ROOT, 'lidingobuild/cache', RELEASE ? `esri-z18-${RELEASE}` : 'esri-z18');
const Z = 18;
/* the same EPSG:3006 window the 2019 orthophoto and the DTM dump cover */
const WINDOW = { minEasting: 677060, minNorthing: 6585730, maxEasting: 678250, maxNorthing: 6587100 };

/* EPSG:3006 -> WGS 84 through the repository's own tested series */
const { sweref99TmToLatLon } = await import(path.join(ROOT, 'packages/course-geo/chmv2/projection.mjs'));
const corners = [
  sweref99TmToLatLon(WINDOW.minEasting, WINDOW.minNorthing),
  sweref99TmToLatLon(WINDOW.maxEasting, WINDOW.minNorthing),
  sweref99TmToLatLon(WINDOW.minEasting, WINDOW.maxNorthing),
  sweref99TmToLatLon(WINDOW.maxEasting, WINDOW.maxNorthing),
];
const lats = corners.map((c) => c[0]); const lons = corners.map((c) => c[1]);
const n = 2 ** Z;
const tileX = (lon) => Math.floor((lon + 180) / 360 * n);
const tileY = (lat) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
const x0 = tileX(Math.min(...lons)); const x1 = tileX(Math.max(...lons));
const y0 = tileY(Math.max(...lats)); const y1 = tileY(Math.min(...lats));

const base = RELEASE
  ? `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${RELEASE}`
  : 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

fs.mkdirSync(OUT, { recursive: true });
let fetched = 0; let cached = 0; let missing = 0; let bytes = 0;
const index = [];
for (let y = y0; y <= y1; y += 1) {
  for (let x = x0; x <= x1; x += 1) {
    const file = path.join(OUT, `${Z}-${y}-${x}.jpg`);
    if (fs.existsSync(file)) {
      cached += 1; bytes += fs.statSync(file).size;
      index.push({ z: Z, y, x, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
      continue;
    }
    const response = await fetch(`${base}/${Z}/${y}/${x}`, { signal: AbortSignal.timeout(45_000) });
    if (response.status === 404) { missing += 1; continue; }
    if (!response.ok) throw new Error(`tile ${Z}/${y}/${x} answered ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(file, buffer);
    fetched += 1; bytes += buffer.length;
    index.push({ z: Z, y, x, sha256: createHash('sha256').update(buffer).digest('hex') });
  }
}
const meta = {
  schemaVersion: 1, retrievedOn: new Date().toISOString().slice(0, 10), release: RELEASE,
  service: base, zoom: Z, tileRange: { x0, x1, y0, y1 }, tiles: index.length,
  groundResolutionMetres: Number((156543.03392 * Math.cos((Math.min(...lats) + Math.max(...lats)) / 2 * Math.PI / 180) / n).toFixed(4)),
  windowEpsg3006: WINDOW, fetched, cached, missing, bytes,
  rights: 'Esri World Imagery. Cached locally as a measuring instrument only; tiles are not redistributed and no derived image is published. Derived vector geometry and measurements are what this repository keeps.',
  index,
};
fs.writeFileSync(path.join(OUT, 'tiles.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify({ tiles: index.length, fetched, cached, missing, megabytes: +(bytes / 1e6).toFixed(1), metresPerPixel: meta.groundResolutionMetres, tileRange: meta.tileRange }));
