#!/usr/bin/env node
/* Tjusta's water from Lantmäteriet's break geometry: each 10 km terrain item's
   brytgeometri.gpkg is downloaded once into the ignored tjustabuild/cache/water/,
   checked against the catalogue's SHA-256, clipped to the 4,096 m LOD0 square and
   kept as 2D EPSG:3006 polygons with their RH 2000 level (the median of the
   polygon's own heights). Inland ground: there is no sea or great lake here, so
   every polygon is a pond or a lake.

   node --env-file=.env tjustabuild/acquire-water-breaklines.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lantmaterietCredentials, authorizationHeaders } from '../packages/course-geo/acquisition/credentials.mjs';

const ROOT = process.cwd();
const disc = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/tjusta/acquisition/d2-discovery.json'), 'utf8'));
const creds = lantmaterietCredentials();
if (!creds) throw new Error('Lantmäteriet credentials required');
const headers = authorizationHeaders(creds);

const cacheDir = path.join(ROOT, 'tjustabuild/cache/water');
fs.mkdirSync(cacheDir, { recursive: true });
const pixiExe = fs.existsSync('C:\\Users\\olovm\\.pixi\\bin\\pixi.exe') ? 'C:\\Users\\olovm\\.pixi\\bin\\pixi.exe' : 'pixi';
const pixiManifest = path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml');

// The LOD0 square of packages/course-v2/tjusta-ground-graph.mjs.
const CLIP = [667082.5, 6609202.5, 671178.5, 6613298.5];
const allFeatures = [];
const sourcesMeta = [];

for (const item of disc.terrain.items) {
  const bg = item.assets.breakgeometry;
  const gpkgPath = path.join(cacheDir, `${item.id}_brytgeometri.gpkg`);
  if (!fs.existsSync(gpkgPath)) {
    const res = await fetch(bg.href, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${bg.href}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(gpkgPath, buf);
  }
  const actualSha = createHash('sha256').update(fs.readFileSync(gpkgPath)).digest('hex');
  if (actualSha !== bg.sha256) throw new Error(`SHA-256 mismatch on ${gpkgPath}: ${actualSha} != ${bg.sha256}`);
  sourcesMeta.push({ id: item.id, href: bg.href, bytes: fs.statSync(gpkgPath).size, sha256: actualSha });

  const clippedGeo = path.join(cacheDir, `${item.id}_clipped.geojson`);
  if (fs.existsSync(clippedGeo)) fs.unlinkSync(clippedGeo);
  const run = spawnSync(pixiExe, [
    'run', '--manifest-path', pixiManifest, '--frozen',
    'ogr2ogr', '-f', 'GeoJSON', '-clipsrc', ...CLIP.map(String),
    clippedGeo, gpkgPath,
  ], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`ogr2ogr failed on ${item.id}: ${run.stderr}`);
  const fc = JSON.parse(fs.readFileSync(clippedGeo, 'utf8'));
  for (let i = 0; i < (fc.features || []).length; i++) {
    const f = fc.features[i];
    if (!f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type)) continue;
    // Median Z of the 3D outline (RH 2000), then strip Z to 2D EPSG:3006.
    const zs = [];
    const stripRing = ring => ring.map(pt => {
      if (pt.length >= 3 && Number.isFinite(pt[2])) zs.push(pt[2]);
      return [Math.round(pt[0] * 1000) / 1000, Math.round(pt[1] * 1000) / 1000];
    });
    const geom2d = f.geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: f.geometry.coordinates.map(stripRing) }
      : { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(poly => poly.map(stripRing)) };
    zs.sort((a, b) => a - b);
    const level = zs.length ? Math.round(zs[zs.length >> 1] * 1000) / 1000 : null;
    allFeatures.push({
      type: 'Feature',
      id: `lm-water-${item.id}-${f.id ?? i}`,
      properties: {
        sourceItem: item.id,
        sourceFid: f.id ?? i,
        heightRH2000: level,
        zMin: zs.length ? Math.round(zs[0] * 1000) / 1000 : null,
        zMax: zs.length ? Math.round(zs.at(-1) * 1000) / 1000 : null,
        isLake: true,
        isSea: false,
        waterKind: 'inland-pond',
        sourceId: 'water-breaks-lm-1m',
        ...f.properties,
      },
      geometry: geom2d,
    });
  }
}

const outPath = path.join(ROOT, 'geo_data/course-v2/tjusta/mapping/water-breakgeometry-epsg3006.geojson');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const outFc = {
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'EPSG:3006' } },
  sources: sourcesMeta,
  clipBoundsEpsg3006: CLIP,
  features: allFeatures,
};
fs.writeFileSync(outPath, JSON.stringify(outFc, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  sources: sourcesMeta.length,
  waterPolygons: allFeatures.length,
  levels: [...new Set(allFeatures.map(f => f.properties.heightRH2000))].sort((a, b) => a - b),
  outPath: path.relative(ROOT, outPath),
}, null, 2));
