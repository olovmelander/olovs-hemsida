#!/usr/bin/env node
/* Visby/Kronholmen evidence only. Original bytes remain in ignored cache;
   no publication, runtime geometry adoption, or credentials in output. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { discoverPilot, summarizeDiscoveryReport } from '../../../../packages/course-geo/acquisition/discovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const reference = path.dirname(fileURLToPath(import.meta.url));
const date = '2026-09-07';
const cache = path.join(root, `visbybuild/cache/geodata-${date}`);
const bbox = [18.105, 57.429, 18.145, 57.455];
const python = process.env.COURSE_GEO_PYPROJ_PYTHON || path.join(root, 'upsalabuild/cache/review-venv/Scripts/python.exe');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(root, file).replaceAll(path.sep, '/');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const mode = process.argv[2] || 'all';
if (!['all', 'osm', 'stac', 'municipal'].includes(mode)) throw new Error('usage: acquire-geodata.mjs [all|osm|stac|municipal]');
fs.mkdirSync(cache, { recursive: true });

async function acquire(name, url, options = {}) {
  const file = path.join(cache, name);
  const record = file + '.download.json';
  if (fs.existsSync(file) && fs.existsSync(record)) {
    const metadata = JSON.parse(fs.readFileSync(record));
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== metadata.sha256) throw new Error(`cached bytes changed: ${file}`);
    return { bytes, metadata };
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), ...options });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, bytes);
  const metadata = { url, method: options.method || 'GET', acquiredAt: new Date().toISOString(), path: relative(file), bytes: bytes.length, sha256: sha256(bytes), contentType: response.headers.get('content-type'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
  write(record, metadata);
  return { bytes, metadata };
}

function project(points) {
  const script = "import json,sys,pyproj; t=pyproj.Transformer.from_crs(4326,3006,always_xy=True); print(json.dumps([list(t.transform(*p)) for p in json.load(sys.stdin)]))";
  const result = spawnSync(python, ['-c', script], { input: JSON.stringify(points), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`pyproj failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function osm() {
  const [west, south, east, north] = bbox;
  const query = `[out:json][timeout:45];(nwr["golf"](${south},${west},${north},${east});nwr["leisure"="golf_course"](${south},${west},${north},${east});nwr["building"](${south},${west},${north},${east});way["highway"](${south},${west},${north},${east});nwr["natural"="water"](${south},${west},${north},${east});way["natural"="coastline"](${south},${west},${north},${east});relation["type"="golf_course"](${south},${west},${north},${east}););out meta geom;`;
  let result;
  let raw;
  try {
    result = await acquire('osm-map-api.xml', `https://www.openstreetmap.org/api/0.6/map?bbox=${bbox.join(',')}`, { headers: { 'User-Agent': 'Banvy golf source research (read-only)' } });
    const parser = `import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.buffer.read()); nodes={e.attrib['id']:{'lat':float(e.attrib['lat']),'lon':float(e.attrib['lon'])} for e in r.findall('node')}; elements=[]
for e in r:
 if e.tag not in ['node','way','relation']: continue
 tags={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
 if not ('golf' in tags or tags.get('leisure')=='golf_course' or 'building' in tags or 'highway' in tags or tags.get('natural') in ['water','coastline'] or tags.get('type')=='golf_course'): continue
 o={'type':e.tag,'id':int(e.attrib['id']),'version':int(e.attrib['version']),'timestamp':e.attrib['timestamp'],'tags':tags}
 if e.tag=='node': o.update(nodes[e.attrib['id']])
 if e.tag=='way':
  refs=[n.attrib['ref'] for n in e.findall('nd')]; o['nodes']=[int(n) for n in refs]
  if not all(n in nodes for n in refs): raise Exception('way with missing node geometry: '+e.attrib['id'])
  o['geometry']=[nodes[n] for n in refs]
 if e.tag=='relation': o['members']=[{'type':m.attrib['type'],'ref':int(m.attrib['ref']),'role':m.attrib['role']} for m in e.findall('member')]
 elements.append(o)
print(json.dumps({'version':0.6,'generator':r.attrib.get('generator'),'elements':elements}))`;
    const converted = spawnSync(python, ['-c', parser], { input: result.bytes.toString(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (converted.status !== 0) throw new Error(`OSM API XML conversion failed: ${converted.stderr}`);
    raw = JSON.parse(converted.stdout);
  } catch (error) { console.error(`Current OSM map API unavailable: ${error.message}`); result = null; }
  for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    if (result) break;
    try {
      result = await acquire('osm-elements.json', `${endpoint}?${new URLSearchParams({ data: query })}`, { headers: { 'User-Agent': 'Banvy golf source research (read-only)' } });
      break;
    } catch (error) { console.error(error.message); }
  }
  if (!result) throw new Error('all Overpass endpoints failed');
  raw ||= JSON.parse(result.bytes);
  if (raw.remark) throw new Error(`Overpass incomplete: ${raw.remark}`);
  const features = [];
  const points = [];
  for (const item of raw.elements) {
    let geometry;
    if (item.type === 'node') geometry = { type: 'Point', coordinates: [item.lon, item.lat] };
    else if (item.type === 'way' && item.geometry?.length) {
      const coordinates = item.geometry.map(p => [p.lon, p.lat]);
      const closed = item.nodes[0] === item.nodes.at(-1);
      geometry = closed && item.tags?.area !== 'no' && item.tags?.golf !== 'hole'
        ? { type: 'Polygon', coordinates: [coordinates] }
        : { type: 'LineString', coordinates };
    } else continue; // Relations are preserved in raw evidence; never approximate rings.
    const visit = value => typeof value[0] === 'number' ? points.push(value) : value.forEach(visit);
    visit(geometry.coordinates);
    features.push({ type: 'Feature', id: `${item.type}/${item.id}`, properties: { osmType: item.type, osmId: String(item.id), osmVersion: String(item.version), osmTimestamp: item.timestamp, sourceId: `visby-osm-${date}`, reviewStatus: 'unreviewed-supplementary', tags: item.tags || {} }, geometry });
  }
  const wgs = { type: 'FeatureCollection', name: `Visby GK supplementary OSM evidence, ${date}`, licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', features };
  write(path.join(reference, 'osm-golf-wgs84.geojson'), wgs);
  const projected = project(points);
  let position = 0;
  const transform = coordinates => typeof coordinates[0] === 'number' ? projected[position++] : coordinates.map(transform);
  const sweref = structuredClone(wgs);
  sweref.crs = { type: 'name', properties: { name: 'EPSG:3006' } };
  sweref.features.forEach(feature => { feature.geometry.coordinates = transform(feature.geometry.coordinates); });
  write(path.join(reference, 'osm-golf-epsg3006.geojson'), sweref);
  const counts = {};
  for (const feature of features) { const key = feature.properties.tags.golf || feature.properties.tags.leisure || (feature.properties.tags.building ? 'building' : feature.properties.tags.highway ? 'highway' : feature.properties.tags.natural || 'other'); counts[key] = (counts[key] || 0) + 1; }
  const golfPoints = [];
  const visit = coordinates => typeof coordinates[0] === 'number' ? golfPoints.push(coordinates) : coordinates.forEach(visit);
  sweref.features.filter(f => f.properties.tags.golf || f.properties.tags.leisure === 'golf_course').forEach(f => visit(f.geometry.coordinates));
  const extent = golfPoints.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity,Infinity,-Infinity,-Infinity]);
  const summary = { schemaVersion: 1, groundId: 'visby', ...result.metadata, query: result.metadata.url.includes('interpreter') ? query : null, bboxWgs84: bbox, golfBboxEpsg3006: extent, baseTimestamp: raw.osm3s?.timestamp_osm_base || null, licence: 'ODbL-1.0', termsUrl: 'https://www.openstreetmap.org/copyright', attribution: '© OpenStreetMap contributors', horizontalCrs: 'EPSG:4326; derived EPSG:3006 with pyproj/PROJ always_xy', counts, relations: raw.elements.filter(e => e.type === 'relation'), holes: features.filter(f => f.properties.tags.golf === 'hole').map(f => ({ id: f.id, tags: f.properties.tags, endpointsWgs84: [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)] })), limitations: ['OSM dates are edit timestamps, not capture dates.', 'No independent control or surface approval.', 'Relations retained verbatim; their topology has not been flattened into invented polygons.', 'Route association must be reviewed against official club guide before gameplay adoption.', 'Both current hole lines are ref=2/par=4/handicap=7, with no explicit course membership. Do not merge or select one silently.', 'golf=water_hazard identifies an OSM golf tag, not verified standing water or a surveyed penalty-area boundary.'] };
  write(path.join(reference, 'osm-acquisition.json'), summary);
  console.log(JSON.stringify({ counts, golfBboxEpsg3006: extent, holes: summary.holes, relations: summary.relations.map(r => ({ id:r.id, tags:r.tags, members:r.members.map(m => ({ type:m.type, ref:m.ref, role:m.role })) })) }, null, 2));
}

async function stac() {
  const edges = [];
  for (let i = 0; i <= 16; i++) { const x = bbox[0] + (bbox[2] - bbox[0]) * i / 16; const y = bbox[1] + (bbox[3] - bbox[1]) * i / 16; edges.push([x,bbox[1]],[x,bbox[3]],[bbox[0],y],[bbox[2],y]); }
  const extent = project(edges).reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity,Infinity,-Infinity,-Infinity]);
  const aoi = { groundId: 'visby', groundName: 'Visby Golfklubb – Kronholmen', courseSlugs: ['visby'], bboxWgs84: bbox, bboxEpsg3006: extent.map(n => Math.round(n * 1000) / 1000) };
  const report = await discoverPilot(aoi, { observedOn: date, fetchMetadata: true });
  report.projection = { library: 'pyproj/PROJ', axisOrder: 'always_xy', note: 'Densified WGS84 bbox edges transformed to EPSG:3006 for discovery only; no canonical origin approved.' };
  write(path.join(reference, '../acquisition/d2-discovery.json'), report);
  console.log(JSON.stringify(summarizeDiscoveryReport(report), null, 2));
}

async function municipal() {
  const rootService = 'https://imageserver.gotland.se/arcgis/rest/services/Ortofoto';
  const catalog = await acquire('gotland-imagery-services.json', `${rootService}?f=pjson`);
  const services = JSON.parse(catalog.bytes).services.filter(s => /Ortofoto|ORTOFOTO|HOJDRASTER/.test(s.name));
  const output = { schemaVersion: 1, groundId: 'visby', provider: 'Region Gotland', discoveredAt: new Date().toISOString(), catalog: catalog.metadata, services: [], limitations: ['Public endpoint access does not establish redistribution or derivative rights.', 'A service year is a campaign label, not a verified per-pixel capture date.', 'Native municipal grid EPSG:3015 differs from the course master grid EPSG:3006.'] };
  for (const service of services) {
    const short = service.name.split('/').at(-1);
    const result = await acquire(`gotland-${short}-metadata.json`, `${rootService}/${short}/ImageServer?f=pjson`);
    const meta = JSON.parse(result.bytes);
    output.services.push({ ...result.metadata, name: service.name, description: meta.description, extent: meta.extent, pixelSizeX: meta.pixelSizeX, pixelSizeY: meta.pixelSizeY, bandCount: meta.bandCount, pixelType: meta.pixelType, copyrightText: meta.copyrightText, fields: meta.fields, maxImageWidth: meta.maxImageWidth, maxImageHeight: meta.maxImageHeight });
  }
  write(path.join(reference, 'gotland-imagery-services.json'), output);
  console.log(JSON.stringify(output.services.map(s => ({name:s.name, pixelSizeX:s.pixelSizeX, extent:s.extent})), null, 2));
}

for (const [name, run] of [['osm',osm],['stac',stac],['municipal',municipal]]) if (mode === 'all' || mode === name) await run();
