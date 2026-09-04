#!/usr/bin/env node
/* Build Ribbingsfors' compatibility model from the same metric frame used by
   the v2 terrain. Run through the pinned geo environment so cs2cs/GDAL are
   available:

     pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen \
       node --env-file=.env ribbingsforsbuild/build-course.mjs

   The committed GPK1 model is intentionally usable before the production
   surface survey is complete. Its ground and water are licensed Lantmäteriet
   measurements; routing and turf outlines remain explicitly provisional. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bearing,
  centroid,
  pointInPoly,
  polyArea,
  polyLen,
  quantizeHF,
  ring1,
  r1,
  simplifyDP,
} from '../geobuild/lib.mjs';
import { latLonToSweref99Tm } from '../packages/course-geo/proj.mjs';
import { runGeoCommand } from '../packages/course-geo/proj.mjs';
import {
  gdalHttpEnvironment,
  lantmaterietCredentials,
} from '../packages/course-geo/acquisition/credentials.mjs';
import { teeRoadClearance } from './tee-road-clearance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, 'cache');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value, pretty = false) =>
  fs.writeFileSync(file, JSON.stringify(value, null, pretty ? 2 : 0) + (pretty ? '\n' : ''));

export const FRAME = Object.freeze({
  easting: 448975.5,
  northing: 6536024.5,
  latitude: 58.9607905493,
  longitude: 14.1128725388,
  fineHalfSpan: 1024,
  fineSpacing: 1,
  fineSize: 2049,
});

const TERRAIN = path.join(
  ROOT,
  'packages/course-geo/toolchain/.cache/acquisition/ribbingsfors/terrain-window.cog.tif',
);
const WATER_BREAKS = path.join(
  ROOT,
  'packages/course-geo/toolchain/.cache/acquisition/ribbingsfors/water-breaks.gpkg',
);
const OSM_XML = path.join(CACHE, 'osm-core.xml');
const CARD_FILE = path.join(HERE, 'card.json');
const ROUTE_FILE = path.join(HERE, 'route-seeds.json');
const GUIDE_FILE = path.join(HERE, 'guide-notes.json');
const TEE_CONTROL_FILE = path.join(HERE, 'tee-controls.json');
const CANOPY = Object.freeze({
  data: path.join(
    ROOT,
    'packages/course-geo/toolchain/.cache/vegetation/ribbingsfors/chm-23b028-653-44.f32',
  ),
  sidecar: path.join(
    ROOT,
    'packages/course-geo/toolchain/.cache/vegetation/ribbingsfors/chm-23b028-653-44.json',
  ),
});

const VISTA = Object.freeze({
  x0: -5760,
  z0: -5760,
  dx: 32,
  nx: 361,
  nz: 361,
  sources: [
    'https://dl1.lantmateriet.se/hojd/data/grid/mhm/65_4/m653_44.tif',
    'https://dl1.lantmateriet.se/hojd/data/grid/mhm/65_4/m653_45.tif',
    'https://dl1.lantmateriet.se/hojd/data/grid/mhm/65_4/m654_44.tif',
    'https://dl1.lantmateriet.se/hojd/data/grid/mhm/65_4/m654_45.tif',
  ],
});

function assertFile(file, message) {
  if (!fs.existsSync(file)) throw new Error(`${message}: ${path.relative(ROOT, file)}`);
}

function enviData(source, output, args = [], environment = {}) {
  const header = output.replace(/\.[^.]+$/, '') + '.hdr';
  if (!fs.existsSync(output)) {
    runGeoCommand('gdal_translate', [
      '-q', '-of', 'ENVI', '-ot', 'Float32', '-co', 'INTERLEAVE=BSQ',
      ...args, source, output,
    ], { env: environment });
  }
  assertFile(output, 'GDAL did not create the ENVI raster');
  assertFile(header, 'GDAL did not create the ENVI sidecar');
  return output;
}

function floats(file, expected) {
  const data = fs.readFileSync(file);
  if (data.byteLength !== expected * 4) {
    throw new Error(`${path.basename(file)} has ${data.byteLength} bytes; expected ${expected * 4}`);
  }
  const values = new Float32Array(expected);
  for (let index = 0; index < expected; index++) values[index] = data.readFloatLE(index * 4);
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${path.basename(file)} contains nodata or non-finite heights`);
  }
  return values;
}

function loadFineTerrain() {
  assertFile(TERRAIN, 'Acquire the aligned Ribbingsfors terrain window first');
  const info = JSON.parse(runGeoCommand('gdalinfo', ['-json', TERRAIN]).stdout);
  if (info.size?.[0] !== FRAME.fineSize || info.size?.[1] !== FRAME.fineSize) {
    throw new Error(`aligned terrain is ${info.size?.join('x')}; expected 2049x2049`);
  }
  const transform = info.geoTransform || [];
  const expected = [447951, 1, 0, 6537049, 0, -1];
  if (transform.length !== 6 || transform.some((value, index) => Math.abs(value - expected[index]) > 1e-6)) {
    throw new Error(`aligned terrain geotransform drifted: ${JSON.stringify(transform)}`);
  }
  const raw = enviData(TERRAIN, path.join(CACHE, 'terrain-fine.bin'));
  return floats(raw, FRAME.fineSize * FRAME.fineSize);
}

function loadVistaTerrain() {
  fs.mkdirSync(CACHE, { recursive: true });
  const raw = path.join(CACHE, 'terrain-vista.bin');
  if (fs.existsSync(raw) && fs.statSync(raw).size !== VISTA.nx * VISTA.nz * 4) {
    fs.unlinkSync(raw);
    for (const sidecar of [raw.replace(/\.[^.]+$/, '') + '.hdr', `${raw}.aux.xml`]) {
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
  }
  if (!fs.existsSync(raw)) {
    const credentials = lantmaterietCredentials();
    if (!credentials) {
      throw new Error('The first vista build needs Lantmäteriet credentials; run node with --env-file=.env');
    }
    const vrt = path.join(CACHE, 'terrain-vista.vrt');
    const environment = gdalHttpEnvironment(credentials);
    runGeoCommand('gdalbuildvrt', [
      '-overwrite', '-resolution', 'highest', vrt,
      ...VISTA.sources.map(url => `/vsicurl/${url}`),
    ], { env: environment });
    const west = FRAME.easting + VISTA.x0 - VISTA.dx / 2;
    const north = FRAME.northing - VISTA.z0 + VISTA.dx / 2;
    const east = west + VISTA.nx * VISTA.dx;
    const south = north - VISTA.nz * VISTA.dx;
    /* Direct VRT -> ENVI reads terminate early in GDAL 3.13 on Windows for
       authenticated /vsicurl sources. Materialise the small, already-resampled
       COG first; this is also a useful inspectable cache boundary. */
    const vistaCog = path.join(CACHE, 'terrain-vista.tif');
    runGeoCommand('gdal_translate', [
      '-q', '-of', 'COG',
      '-projwin_srs', 'EPSG:3006',
      '-projwin', String(west), String(north), String(east), String(south),
      '-outsize', String(VISTA.nx), String(VISTA.nz),
      '-r', 'bilinear',
      '-co', 'COMPRESS=ZSTD', '-co', 'LEVEL=12',
      vrt, vistaCog,
    ], { env: environment });
    enviData(vistaCog, raw);
  }
  return floats(raw, VISTA.nx * VISTA.nz);
}

function local([easting, northing]) {
  return [r1(easting - FRAME.easting), r1(FRAME.northing - northing)];
}

async function projectLonLatPairs(pairs) {
  const projected = latLonToSweref99Tm(
    pairs.map(([longitude, latitude]) => ({ latitude, longitude })),
    { decimals: 6 },
  );
  return projected.map(({ easting, northing }) => [easting, northing]);
}

function pointAt(line, distance) {
  if (distance < 0) {
    const [a, b] = line;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [a[0] + (b[0] - a[0]) * distance / length,
      a[1] + (b[1] - a[1]) * distance / length];
  }
  let remaining = distance;
  for (let index = 1; index < line.length; index++) {
    const a = line[index - 1], b = line[index];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length || index === line.length - 1) {
      const t = length ? remaining / length : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= length;
  }
  return [...line.at(-1)];
}

function pointFromGreen(line, distance) {
  const total = polyLen(line);
  return pointAt(line, total - distance);
}

function tangentAt(line, distance) {
  const epsilon = 1;
  const a = pointAt(line, Math.max(0, distance - epsilon));
  const b = pointAt(line, Math.min(polyLen(line), distance + epsilon));
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
}

function extendBackTee(line, requiredLength) {
  const difference = requiredLength - polyLen(line);
  if (difference <= 0.05) return line;
  const [a, b] = line;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [[
    a[0] - (b[0] - a[0]) * difference / length,
    a[1] - (b[1] - a[1]) * difference / length,
  ], ...line.slice(1)];
}

function ellipseRing(c, along, major, minor, count = 18) {
  const length = Math.hypot(along[0], along[1]) || 1;
  const ux = along[0] / length, uz = along[1] / length;
  const rx = -uz, rz = ux;
  return Array.from({ length: count }, (_, index) => {
    const a = index / count * Math.PI * 2;
    return [r1(c[0] + ux * Math.cos(a) * major / 2 + rx * Math.sin(a) * minor / 2),
      r1(c[1] + uz * Math.cos(a) * major / 2 + rz * Math.sin(a) * minor / 2)];
  });
}

function rectangleRing(c, along, length = 12, width = 6) {
  const l = Math.hypot(along[0], along[1]) || 1;
  const ux = along[0] / l, uz = along[1] / l, rx = -uz, rz = ux;
  return ring1([
    [c[0] - ux * length / 2 - rx * width / 2, c[1] - uz * length / 2 - rz * width / 2],
    [c[0] + ux * length / 2 - rx * width / 2, c[1] + uz * length / 2 - rz * width / 2],
    [c[0] + ux * length / 2 + rx * width / 2, c[1] + uz * length / 2 + rz * width / 2],
    [c[0] - ux * length / 2 + rx * width / 2, c[1] - uz * length / 2 + rz * width / 2],
  ]);
}

function ribbon(line, startDistance, endDistance, par) {
  const total = polyLen(line);
  const from = Math.max(0, startDistance);
  const to = Math.min(total, endDistance);
  const steps = Math.max(4, Math.ceil((to - from) / 12));
  const left = [], right = [];
  for (let index = 0; index <= steps; index++) {
    const distance = from + (to - from) * index / steps;
    const p = pointAt(line, distance), u = tangentAt(line, distance);
    const phase = Math.sin(Math.PI * index / steps);
    const halfWidth = (par === 3 ? 9 : 10) + phase * (par === 5 ? 16 : 13);
    const rx = -u[1], rz = u[0];
    left.push([r1(p[0] - rx * halfWidth), r1(p[1] - rz * halfWidth)]);
    right.push([r1(p[0] + rx * halfWidth), r1(p[1] + rz * halfWidth)]);
  }
  return left.concat(right.reverse());
}

function parseOsm(xml) {
  const rawNodes = [];
  for (const match of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g)) {
    rawNodes.push({ id: match[1], latitude: +match[2], longitude: +match[3] });
  }
  const projected = latLonToSweref99Tm(rawNodes, { decimals: 6 });
  const nodes = new Map(rawNodes.map((node, index) => [node.id,
    local([projected[index].easting, projected[index].northing])]));
  const ways = [];
  for (const match of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const tags = {};
    for (const tag of match[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[tag[1]] = tag[2];
    const refs = [...match[2].matchAll(/<nd ref="(\d+)"/g)].map(item => item[1]);
    const points = refs.map(ref => nodes.get(ref)).filter(Boolean);
    ways.push({ id: `w${match[1]}`, tags, refs, points,
      closed: refs.length > 3 && refs[0] === refs.at(-1) });
  }
  const ring = (way, tolerance = 0.8) => {
    if (!way.closed || way.points.length < 4) return null;
    const open = way.points.slice(0, -1);
    const simplified = simplifyDP([...open, open[0]], tolerance).slice(0, -1);
    return simplified.length >= 3 ? ring1(simplified) : null;
  };
  const line = (way, tolerance = 1) => {
    const simplified = simplifyDP(way.points, tolerance);
    return simplified.length >= 2 ? ring1(simplified) : null;
  };
  const out = {
    courseBoundary: null,
    forest: [], wood: [], scrub: [], wetland: [], grass: [], landuse: [],
    paths: [], tracks: [], roads: [], buildings: [], parking: [],
  };
  for (const way of ways) {
    const t = way.tags;
    if (way.closed && t.leisure === 'golf_course') {
      const geometry = ring(way, 1);
      if (geometry) out.courseBoundary = { id: way.id, ring: geometry, name: t.name || null };
      continue;
    }
    if (way.closed && (t.landuse === 'forest' || t.natural === 'wood')) {
      const geometry = ring(way, 1.5);
      if (geometry) (t.natural === 'wood' ? out.wood : out.forest).push(geometry);
    } else if (way.closed && t.natural === 'scrub') {
      const geometry = ring(way, 1.5); if (geometry) out.scrub.push(geometry);
    } else if (way.closed && t.natural === 'wetland') {
      const geometry = ring(way, 1.5); if (geometry) out.wetland.push(geometry);
    } else if (way.closed && /^(grass|meadow|village_green)$/.test(t.landuse || '')) {
      const geometry = ring(way, 1.2); if (geometry) out.grass.push(geometry);
    } else if (way.closed && /^(farmland|farmyard|residential|industrial|commercial)$/.test(t.landuse || '')) {
      const geometry = ring(way, 2); if (geometry) out.landuse.push({ ring: geometry, kind: t.landuse });
    } else if (way.closed && t.building) {
      const geometry = ring(way, 0.4);
      if (geometry) out.buildings.push({ id: way.id, ring: geometry,
        h: t.height ? +t.height : t['building:levels'] ? +t['building:levels'] * 3.1 : null,
        kind: t.building, name: t.name || null, amenity: t.amenity || null });
    } else if (way.closed && t.amenity === 'parking') {
      const geometry = ring(way, 0.6);
      if (geometry) out.parking.push({ id: way.id, ring: geometry, surface: t.surface || null,
        area: Math.round(Math.abs(polyArea(geometry))) });
    } else if (t.highway) {
      const geometry = line(way, 1);
      if (!geometry) continue;
      const rec = { id: way.id, line: geometry, kind: t.highway, surface: t.surface || null };
      if (/^(path|footway|cycleway|bridleway|steps)$/.test(t.highway)) out.paths.push(rec);
      else if (/^(track|service)$/.test(t.highway)) out.tracks.push(rec);
      else out.roads.push({ ...rec, name: t.name || null, lanes: t.lanes ? +t.lanes : null,
        oneway: t.oneway === 'yes', maxspeed: t.maxspeed ? +t.maxspeed : null, lit: t.lit === 'yes' });
    }
  }
  return out;
}

function readWater() {
  assertFile(WATER_BREAKS, 'Acquire the aligned Ribbingsfors water breaks first');
  const geojson = JSON.parse(runGeoCommand('ogr2ogr', [
    '-f', 'GeoJSON', '/vsistdout/', WATER_BREAKS, 'water_breaks',
    '-simplify', '0.75', '-dim', 'XYZ', '-lco', 'COORDINATE_PRECISION=2',
  ]).stdout);
  const water = [];
  for (const feature of geojson.features || []) {
    const polygons = feature.geometry?.type === 'MultiPolygon'
      ? feature.geometry.coordinates : feature.geometry?.type === 'Polygon'
        ? [feature.geometry.coordinates] : [];
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!Array.isArray(outer) || outer.length < 4) continue;
      const level = Number(outer[0][2]);
      const ring = ring1(outer.slice(0, -1).map(([easting, northing]) => local([easting, northing])));
      const area = Math.round(Math.abs(polyArea(ring)));
      if (ring.length < 3 || area < 30 || !Number.isFinite(level)) continue;
      water.push({ ring, level: r1(level), isLake: area > 10000, isSea: false, area,
        prov: 'Lantmäteriet Markhöjdmodell break geometry, item 653_44' });
    }
  }
  return water.sort((left, right) => right.area - left.area);
}

function heightSampler(fine) {
  return (x, z) => {
    const fx = x + FRAME.fineHalfSpan, fz = z + FRAME.fineHalfSpan;
    if (fx < 0 || fz < 0 || fx >= FRAME.fineSize - 1 || fz >= FRAME.fineSize - 1) return null;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * FRAME.fineSize + i;
    const a = fine[k], b = fine[k + 1], c = fine[k + FRAME.fineSize], d = fine[k + FRAME.fineSize + 1];
    return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
  };
}

function circle(c, radius, count = 14) {
  return Array.from({ length: count }, (_, index) => {
    const a = index / count * Math.PI * 2;
    return [r1(c[0] + Math.cos(a) * radius), r1(c[1] + Math.sin(a) * radius)];
  });
}

function protectedTreePoints() {
  const known = [
    [449354.605, 6536055.906, 'aspen-poplar', 387],
    [449090.910, 6536039.732, 'oak', 328],
    [449001.948, 6536039.658, 'oak', 311],
    [448694.978, 6535882.021, 'oak', 310],
  ];
  return known.map(([easting, northing, species, circumferenceCm]) => ({
    c: local([easting, northing]), easting, northing, species, circumferenceCm,
    source: 'Länsstyrelsen Västra Götaland Skyddsvärda Träd, inventory 2008-03-07',
  }));
}

function loadCanopy() {
  if (!fs.existsSync(CANOPY.data) && !fs.existsSync(CANOPY.sidecar)) return null;
  assertFile(CANOPY.data, 'The COPC canopy data is incomplete');
  assertFile(CANOPY.sidecar, 'The COPC canopy sidecar is incomplete');
  const sidecar = readJson(CANOPY.sidecar);
  const expected = {
    width: 2048,
    height: 2048,
    sampleSpacingMetres: 1,
    originEasting: 447951.5,
    originNorthing: 6537048.5,
    campaignId: '23b028-653_44',
  };
  for (const [field, value] of Object.entries(expected)) {
    if (sidecar[field] !== value) {
      throw new Error(`COPC canopy ${field} is ${sidecar[field]}; expected ${value}`);
    }
  }
  const bytes = fs.readFileSync(CANOPY.data);
  if (bytes.byteLength !== sidecar.width * sidecar.height * 4) {
    throw new Error(`COPC canopy has ${bytes.byteLength} bytes; expected ${sidecar.width * sidecar.height * 4}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(sidecar.width * sidecar.height);
  for (let index = 0; index < values.length; index++) values[index] = view.getFloat32(index * 4, true);
  return {
    ...sidecar,
    values,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function makeTreeCover(model, osm, trees) {
  const cell = 4, x0 = -1024, z0 = -1024, nx = 513, nz = 513;
  const values = new Uint8Array(nx * nz).fill(2);
  const canopy = loadCanopy();
  const treeRings = [...osm.forest, ...osm.wood];
  const openRings = [];
  for (const hole of model.holes) {
    openRings.push(hole.green.ring, ...hole.fairway.rings,
      ...hole.tees.pads.map(pad => pad.ring), ...hole.bunkers.map(bunker => bunker.ring));
  }
  openRings.push(...model.water.map(item => item.ring), ...model.infra.buildings.map(item => item.ring));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, index = j * nx + i;
    let laserTree = false;
    if (canopy) {
      const easting = FRAME.easting + x;
      const northing = FRAME.northing - z;
      const column = Math.floor((easting - canopy.originEasting) / canopy.sampleSpacingMetres);
      const row = Math.floor((canopy.originNorthing - northing) / canopy.sampleSpacingMetres);
      /* A 4 m compatibility cell is a tree cell when any measured 1 m canopy
         return in its footprint reaches three metres above laser ground. */
      for (let dj = -1; dj <= 2 && !laserTree; dj++) for (let di = -1; di <= 2; di++) {
        const ci = column + di, rj = row + dj;
        if (ci < 0 || rj < 0 || ci >= canopy.width || rj >= canopy.height) continue;
        const height = canopy.values[rj * canopy.width + ci];
        if (Number.isFinite(height) && height >= 3) { laserTree = true; break; }
      }
    }
    if (laserTree || treeRings.some(ring => pointInPoly(x, z, ring)) ||
        trees.some(tree => Math.hypot(x - tree.c[0], z - tree.c[1]) < 7)) values[index] = 3;
    if (openRings.some(ring => pointInPoly(x, z, ring))) values[index] = 2;
  }
  const packed = Buffer.alloc(Math.ceil(values.length / 4));
  for (let index = 0; index < values.length; index++) {
    packed[index >> 2] |= (values[index] & 3) << ((index & 3) * 2);
  }
  return {
    cell, x0, z0, nx, nz, b64: packed.toString('base64'),
    legend: { 0: 'unknown', 2: 'open', 3: 'trees' },
    source: canopy
      ? `LantmÃ¤teriet Laserdata skog 2023 COPC campaign ${canopy.campaignId}, 1 m CHM SHA-256 ${canopy.sha256}; 3 m threshold; protected trees added; provisional playing surfaces, official water and mapped buildings burned open.`
      : 'Provisional canopy mask: OSM woodland plus exact protected-tree points; playing surfaces, official water breaks and buildings burned open. Replace with reviewed 2023 COPC canopy output.',
  };
}

const fine = loadFineTerrain();
const vista = loadVistaTerrain();
const heightAt = heightSampler(fine);
const originHeight = heightAt(0, 0);
const card = readJson(CARD_FILE);
const routeSeeds = readJson(ROUTE_FILE);
const guide = readJson(GUIDE_FILE);
const teeControlDocument = readJson(TEE_CONTROL_FILE);
if (teeControlDocument.horizontalCrs !== 'EPSG:3006' || !Array.isArray(teeControlDocument.controls)) {
  throw new Error('tee-controls.json must contain an EPSG:3006 controls array');
}
assertFile(OSM_XML, 'Fetch the OSM context extract first');
const osm = parseOsm(fs.readFileSync(OSM_XML, 'utf8'));
if (!osm.courseBoundary) throw new Error('OSM extract did not contain the Ribbingsfors course boundary');
const water = readWater();

const holes = [];
for (const cardHole of card.holes) {
  const seed = routeSeeds.holes.find(item => item.n === cardHole.n);
  const note = guide.holes.find(item => item.n === cardHole.n);
  if (!seed || !note) throw new Error(`hole ${cardHole.n} lacks route or guide data`);
  const projectedRoute = (await projectLonLatPairs(seed.route)).map(local);
  const greenPoints = (await projectLonLatPairs(seed.green)).map(local);
  const route = extendBackTee(projectedRoute, cardHole.t[0]).map(pair => pair.map(r1));
  const routeLength = polyLen(route);
  const greenCentre = greenPoints[1];
  const greenAxis = [greenPoints[2][0] - greenPoints[0][0], greenPoints[2][1] - greenPoints[0][1]];
  const greenLength = Math.max(18, Math.min(36, Math.hypot(...greenAxis)));
  const greenRing = ellipseRing(greenCentre, greenAxis, greenLength, Math.max(15, greenLength * 0.72));
  const pads = [], marks = [];
  for (const teeLength of cardHole.t) {
    const control = teeControlDocument.controls.find(item =>
      item.hole === cardHole.n && item.teeMetres === teeLength);
    const c = control
      ? local([control.centre?.easting, control.centre?.northing])
      : pointFromGreen(route, teeLength).map(r1);
    const routeDistance = routeLength - teeLength;
    const u = tangentAt(route, Math.max(0, routeDistance));
    const length = control?.pad?.lengthMetres ?? 12;
    const width = control?.pad?.widthMetres ?? 6;
    if (![...c, length, width].every(Number.isFinite) || length <= 0 || width <= 0) {
      throw new Error(`hole ${cardHole.n} tee ${teeLength} has an invalid spatial control`);
    }
    const prov = control?.provenance || 'card-constrained synthetic pad';
    pads.push({ ring: rectangleRing(c, u, length, width), c, prov });
    marks.push({ c, b: +(bearing(u[0], u[1]) * 180 / Math.PI).toFixed(1), m: teeLength, prov });
  }
  const fairwayStart = cardHole.par === 3 ? routeLength * 0.56 : 34;
  const fairwayRing = ribbon(route, fairwayStart, routeLength - greenLength * 0.42, cardHole.par);
  const bunkers = note.bunkers.map(spec => {
    const distance = routeLength - spec.fromGreen;
    const p = pointAt(route, distance), u = tangentAt(route, distance);
    const right = [-u[1], u[0]];
    const halfFairway = cardHole.par === 3 ? 12 : 20;
    const c = [p[0] + right[0] * spec.side * halfFairway,
      p[1] + right[1] * spec.side * halfFairway];
    return { ring: ellipseRing(c, u, spec.size[0], spec.size[1], 14), c: c.map(r1),
      prov: 'official/Caddee guide interpretation; survey pending' };
  });
  const teeHeight = heightAt(route[0][0], route[0][1]);
  const greenHeight = heightAt(greenCentre[0], greenCentre[1]);
  holes.push({
    n: cardHole.n, par: cardHole.par, idx: cardHole.hcp, t: cardHole.t,
    line: route, lineLen: cardHole.t[0], pin: greenCentre.map(r1),
    green: { ring: greenRing, c: greenCentre.map(r1), prov: 'reference control + synthetic outline',
      area: Math.round(Math.abs(polyArea(greenRing))) },
    fairway: { rings: [fairwayRing], prov: 'route-derived provisional corridor' },
    tees: { pads, marks }, bunkers,
    elev: { tee: r1(teeHeight), green: r1(greenHeight), rise: r1(greenHeight - teeHeight) },
    /* No source publishes official hole names. Editorial working labels stay
       in guide-notes.json and are not presented as club-authored names. */
    tiers: 1, name: null, note: note.note,
    confidence: 'provisional-playing-surface',
  });
}

/* Narrow guide-derived drains. They are deliberately separate from the
   authoritative break polygons and remain tagged as provisional in the model. */
const streams = [];
for (const [holeNumber, fromGreen, halfWidth] of [[1, 88, 38], [1, 38, 32], [3, 135, 25], [4, 145, 24]]) {
  const hole = holes[holeNumber - 1], distance = polyLen(hole.line) - fromGreen;
  const c = pointAt(hole.line, distance), u = tangentAt(hole.line, distance), r = [-u[1], u[0]];
  streams.push({ line: ring1([[c[0] - r[0] * halfWidth, c[1] - r[1] * halfWidth],
    [c[0] + r[0] * halfWidth, c[1] + r[1] * halfWidth]]), w: 1.2,
    prov: 'course-guide interpretation; survey pending' });
}

const protectedTrees = protectedTreePoints();
/* OSM has the estate buildings but not the clubhouse footprint itself. The
   public POI at 58.9649569,14.1212497 is therefore represented by a modest
   generic footprint whose dimensions/orientation remain explicitly
   provisional; the course scenery module supplies only photo-observed visual
   traits. Replace this ring as soon as the club supplies a plan or survey. */
const clubhouse = {
  id: 'ribbingsfors-clubhouse-provisional',
  ring: rectangleRing(local([449463.404255, 6536482.035169]), [0.94, -0.34], 30, 10),
  h: 4.2,
  kind: 'house',
  name: 'Ribbingsfors Golf & Kultur',
  amenity: 'clubhouse',
  prov: 'public clubhouse POI + photo-observed generic form; footprint survey pending',
};
if (!osm.buildings.some(building => {
  const centre = centroid(building.ring);
  const target = centroid(clubhouse.ring);
  return Math.hypot(centre[0] - target[0], centre[1] - target[1]) < 25;
})) osm.buildings.push(clubhouse);
const range = (() => {
  /* Placement follows the official overview and is intentionally marked as a
     guide interpretation until the orthophoto order is available. */
  const a = local([449210, 6536480]), b = local([448990, 6536280]);
  const u = [b[0] - a[0], b[1] - a[1]];
  return ellipseRing([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u, 285, 82, 24);
})();

const model = {
  version: 1,
  origin: { lat: FRAME.latitude, lon: FRAME.longitude },
  mPerLat: 111320,
  mPerLon: +(111320 * Math.cos(FRAME.latitude * Math.PI / 180)).toFixed(2),
  frame: 'local metres from EPSG:3006; east +x, north -z; origin E448975.5 N6536024.5; heights RH 2000',
  seaLevel: 0,
  card: {
    teeNames: card.teeNames,
    publishedNineHoleTotals: card.publishedNineHoleTotals,
    status: 'official totals; provisional per-hole reconciliation pending club GIT card',
  },
  holes,
  water,
  streams,
  coast: [],
  vegetation: {
    forest: osm.forest,
    wood: [...osm.wood, ...protectedTrees.map(tree => circle(tree.c, 8))],
    scrub: osm.scrub,
    wetland: osm.wetland,
    sand: [],
    rock: [],
  },
  infra: {
    paths: osm.paths,
    tracks: osm.tracks,
    roads: osm.roads,
    buildings: osm.buildings,
    farB: [],
    parking: osm.parking,
    piers: [],
    basins: [],
    pitches: [],
    landuse: osm.landuse,
    reserves: [],
    power: { lines: [], towers: [], poles: [] },
    railway: [],
  },
  surround: { clearfells: [], yard: null, hayfields: null, shallows: [] },
  pois: [],
  scenery: {
    greens: [], fairways: [], tees: [], bunkers: [],
    grass: osm.grass,
    range: [range],
    rangeFacilities: null,
    cartPark: null,
  },
  evidence: {
    canonicalOrigin: { easting: FRAME.easting, northing: FRAME.northing,
      heightRH2000: +originHeight.toFixed(3), status: 'provisional-pending-independent-control' },
    terrain: 'Lantmäteriet Markhöjdmodell 1 m item 653_44, RH 2000',
    water: 'Lantmäteriet break geometry item 653_44',
    route: 'GolfTraxx migration/reference controls; back tees extended to white card distance',
    teeControls: 'Explicit EPSG:3006 controls in tee-controls.json; DTM bench interpretation and road exclusion, guide-corroborated and survey pending',
    surfaces: 'guide-constrained synthetic geometry pending licensed orthophoto or survey',
    protectedTrees,
  },
};

const hf0Values = new Float32Array(513 * 513);
for (let row = 0; row < 513; row++) for (let column = 0; column < 513; column++) {
  hf0Values[row * 513 + column] = fine[(row * 4) * FRAME.fineSize + column * 4];
}
const hf0 = { x0: -1024, z0: -1024, dx: 4, ...quantizeHF(hf0Values, 513, 513, 0.1) };
const hf1 = { x0: VISTA.x0, z0: VISTA.z0, dx: VISTA.dx,
  ...quantizeHF(vista, VISTA.nx, VISTA.nz, 0.25) };
const heightfields = {
  source: {
    product: 'Lantmäteriet Markhöjdmodell Nedladdning, grid 1 m',
    horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
    fineItem: '653_44', fineInputSha256: 'c992f541f854aa745742ef3429e15f931cb6459145945c1a1f68897273af44ad',
    note: 'HF0 samples the authoritative 1 m grid every 4 m; HF1 resamples the four surrounding official COG items at 32 m.',
  },
  hf0, hf1,
};

const teeTotals = card.teeNames.map((_, index) => holes.reduce((sum, hole) => sum + hole.t[index], 0));
card.teeNames.forEach((name, index) => {
  if (teeTotals[index] !== card.publishedNineHoleTotals[name]) {
    throw new Error(`${name} rows total ${teeTotals[index]}, official total is ${card.publishedNineHoleTotals[name]}`);
  }
});
if (holes.some(hole => hole.line.some(([x, z]) => Math.abs(x) > 1024 || Math.abs(z) > 1024))) {
  throw new Error('playing route leaves the reviewed 1 m LOD0 square');
}
/* A tee class has higher atlas priority than asphalt, so centre probes alone
   cannot detect a road ribbon later drawn across it. Gate the complete pad
   against the visible road width before any model or pack can be emitted. */
for (const hole of holes) for (let index = 0; index < hole.tees.pads.length; index++) {
  const pad = hole.tees.pads[index];
  for (const road of osm.roads) {
    const clearance = teeRoadClearance(pad.ring, road);
    if (clearance < -1e-6) {
      throw new Error(
        `hole ${hole.n} tee ${hole.t[index]} overlaps road ${road.id || road.kind} by ${(-clearance).toFixed(2)} m`,
      );
    }
  }
}

writeJson(path.join(HERE, 'osm-features.json'), {
  schemaVersion: 1,
  source: 'https://api.openstreetmap.org/api/0.6/map?bbox=14.0948,58.9514,14.1309,58.9702',
  licence: 'ODbL-1.0; © OpenStreetMap contributors',
  generatedFrame: { easting: FRAME.easting, northing: FRAME.northing },
  ...osm,
});
writeJson(path.join(HERE, 'course-model.json'), model);
writeJson(path.join(HERE, 'heightfields.json'), heightfields);
writeJson(path.join(HERE, 'tree-cover.json'), makeTreeCover(model, osm, protectedTrees));

console.log(`Ribbingsfors: ${holes.length} holes, par ${holes.reduce((sum, hole) => sum + hole.par, 0)}`);
console.log(`official tee totals: ${card.teeNames.map((name, index) => `${name} ${teeTotals[index]} m`).join(', ')}`);
console.log(`terrain origin: ${originHeight.toFixed(3)} m RH 2000; ${water.length} break-water polygons`);
console.log(`OSM: ${osm.buildings.length} buildings, ${osm.roads.length + osm.tracks.length + osm.paths.length} ways, ${osm.forest.length + osm.wood.length} woodland rings`);
console.log('wrote ribbingsforsbuild/{course-model,heightfields,tree-cover,osm-features}.json');
