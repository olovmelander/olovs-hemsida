#!/usr/bin/env node
/* The clubs' own buildings for the map (Lätt 3D), simpler, as its other houses are
   (owner, 27 November 2026: "look the same in Lätt 3D but simpler").

   The detailed course draws each club's modelled buildings (the facility GLBs, the
   authored meshes, a house stated through the kit) in place of the mapped footprint
   under them. The map draws houses as walls and a roof raised from a footprint. Here
   each modelled building is read in its own frame, carried into the map's (the
   ground's metres, east +x, south +z) and recorded from above in its own axes: a grid
   of cells, each with how high the building stands there and the colour seen from
   above, and the colour its walls show most. The map raises that as walls and a roof
   (map-club-buildings.mjs): the same outline, height, roof shape, towers and colours,
   without windows and trim. Flagpoles, nets, mats, terraces and other site pieces are
   left to the ground.

     node tools/bake-map-buildings.mjs

   Rerun it when a club's buildings are republished: map-club-buildings.test.mjs
   compares each record's sources with the files it was read from. It writes
   apps/golf/public/models/map-buildings/ and map-buildings.json, replacing the set. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMapFrame } from '../apps/golf/src/map/map-frames.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');
const SCENERY = path.join(ROOT, 'apps/golf/src/engine/scenery');
const OUT = path.join(PUBLIC, 'models/map-buildings');
const json = file => JSON.parse(fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/* What a cell must rise above the building's lowest point to be building, not ground,
   and what a building must at least be to stand on the map. */
export const BAKE = Object.freeze({ minRise: 1.0, minArea: 4, minHeight: 2.0, cellLeast: 0.5, cellMost: 1.0, cellsAcross: 48, sameColour: 0.1 });
/* Facility kinds that are buildings, where a receipt states one; otherwise its id must
   not name a site piece. */
const BUILDING_KINDS = new Set(['building', 'building-part', 'canopy', 'roof', 'shelter', 'range-building']);
const SITE_PIECE = /flag|parasol|(^|-)nets?(-|$)|safety-net|net-base|(^|-)mats?(-|$)|mat-line|divider|kerb|rope|marking|target|grass-tee|courtyard|garden|(^|-)terrace(-|$)|picnic|fence|apron|dispenser/;

const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const linearToSrgb = rgb => rgb.slice(0, 3).map(c => Math.min(1, Math.max(0, toSrgb(c))));
const hexToSrgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(c => c / 255);

/* ------------------------------------------------------------------ reading */
function readGlb(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binAt = 20 + jsonLength;
  const bin = bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt));
  const accessor = index => {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = view.byteStride || width * Type.BYTES_PER_ELEMENT;
    const out = new Type(a.count * width);
    for (let i = 0; i < a.count; i++) {
      const at = bin.byteOffset + start + i * stride;
      const row = new Type(bin.buffer.slice(at, at + width * Type.BYTES_PER_ELEMENT));
      out.set(row, i * width);
    }
    return out;
  };
  return { gltf, accessor, bytes };
}

/* Every triangle under a node, in the GLB's own coordinates, with its material's colour. */
function nodeTriangles({ gltf, accessor }, nodeIndex, place) {
  const triangles = [];
  const visit = index => {
    const node = gltf.nodes[index];
    if (node.matrix || node.translation || node.rotation || node.scale) throw new Error(`GLB node ${node.name} carries a transform; the bake assumes none`);
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4) continue;
        const positions = accessor(primitive.attributes.POSITION);
        const indices = primitive.indices !== undefined ? accessor(primitive.indices) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
        const factor = gltf.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor ?? [0.6, 0.6, 0.6, 1];
        const colour = linearToSrgb(factor);
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const corner = k => place(positions[indices[i + k] * 3], positions[indices[i + k] * 3 + 1], positions[indices[i + k] * 3 + 2]);
          triangles.push({ a: corner(0), b: corner(1), c: corner(2), colour });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(nodeIndex);
  return triangles;
}

/* --------------------------------------------------------------- the record */
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const out = [];
    for (const point of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), point) <= 0) out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}

/* The building's own axes: the rectangle of least area round its plan. */
function ownAxes(points) {
  const ring = hull(points);
  let best = { area: Infinity, angle: 0 };
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const angle = Math.atan2(bz - az, bx - ax);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * cos + z * sin, v = -x * sin + z * cos;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area - 1e-6) best = { area, angle };
  }
  return best.angle;
}

export function recordBuilding(id, triangles) {
  const plan = triangles.flatMap(t => [t.a, t.b, t.c]).map(p => [p[0], p[2]]);
  const angle = ownAxes(plan);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const local = p => [p[0] * cos + p[2] * sin, p[1], -p[0] * sin + p[2] * cos];
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, base = Infinity;
  const flat = triangles.map(t => {
    const pts = [local(t.a), local(t.b), local(t.c)];
    for (const [u, y, v] of pts) {
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); base = Math.min(base, y);
    }
    return { pts, colour: t.colour };
  });
  const cell = Math.min(BAKE.cellMost, Math.max(BAKE.cellLeast, Math.max(maxU - minU, maxV - minV) / BAKE.cellsAcross));
  const cols = Math.max(1, Math.ceil((maxU - minU) / cell)), rows = Math.max(1, Math.ceil((maxV - minV) / cell));
  const tops = new Float64Array(cols * rows).fill(-Infinity);
  const shade = new Array(cols * rows).fill(null);
  const walls = new Map();
  for (const { pts: [a, b, c], colour } of flat) {
    const du1 = b[0] - a[0], dv1 = b[2] - a[2], du2 = c[0] - a[0], dv2 = c[2] - a[2];
    const det = du1 * dv2 - du2 * dv1;
    const ex = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ey = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    const area = Math.hypot(...n) / 2;
    if (area > 1e-6 && Math.abs(n[1]) / (2 * area) < 0.35) {
      const key = colour.map(v => Math.round(v * 255)).join(',');
      walls.set(key, (walls.get(key) ?? 0) + area);
    }
    if (Math.abs(det) < 1e-6) continue;
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - minU) / cell)), c1 = Math.min(cols - 1, Math.floor((Math.max(a[0], b[0], c[0]) - minU) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - minV) / cell)), r1 = Math.min(rows - 1, Math.floor((Math.max(a[2], b[2], c[2]) - minV) / cell));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const u = minU + (col + 0.5) * cell - a[0], v = minV + (row + 0.5) * cell - a[2];
        const s = (u * dv2 - du2 * v) / det, t = (du1 * v - u * dv1) / det;
        if (s < -1e-6 || t < -1e-6 || s + t > 1 + 1e-6) continue;
        const y = a[1] + s * (b[1] - a[1]) + t * (c[1] - a[1]);
        const k = row * cols + col;
        if (y > tops[k]) { tops[k] = y; shade[k] = colour; }
      }
    }
  }
  let kept = 0, highest = 0;
  for (let k = 0; k < tops.length; k++) {
    if (tops[k] - base < BAKE.minRise) { tops[k] = -Infinity; shade[k] = null; continue; }
    kept++;
    highest = Math.max(highest, tops[k] - base);
  }
  if (kept * cell * cell < BAKE.minArea || highest < BAKE.minHeight) return null;

  /* From above a vent, a skylight or a dormer's glass takes a cell of its own; seen as
     the map's other houses are, a roof is one colour. Each cell takes the colour most of
     the cells round it show. */
  const keyOf = colour => colour.map(v => Math.round(v * 255)).join(',');
  /* Shades a step apart, a deck's two tones of plank or a roof's of tile, are one
     colour at the map's scale: the commoner takes the rarer. */
  const counts = new Map();
  for (const colour of shade) if (colour) counts.set(keyOf(colour), { colour, count: (counts.get(keyOf(colour))?.count ?? 0) + 1 });
  const representatives = [], merged = new Map();
  for (const { colour } of [...counts.values()].sort((a, b) => b.count - a.count)) {
    const near = representatives.find(other => Math.hypot(...other.map((v, i) => v - colour[i])) < BAKE.sameColour);
    if (near) merged.set(keyOf(colour), near);
    else { representatives.push(colour); merged.set(keyOf(colour), colour); }
  }
  for (let k = 0; k < shade.length; k++) if (shade[k]) shade[k] = merged.get(keyOf(shade[k]));
  const settled = shade.map((own, k) => {
    if (!own) return null;
    const col = k % cols, row = Math.floor(k / cols), votes = new Map();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc, r = row + dr;
        const other = c >= 0 && r >= 0 && c < cols && r < rows ? shade[r * cols + c] : null;
        if (!other) continue;
        const key = keyOf(other), vote = votes.get(key) ?? { colour: other, count: 0 };
        vote.count += dc === 0 && dr === 0 ? 1.5 : 1;
        votes.set(key, vote);
      }
    }
    return [...votes.values()].sort((a, b) => b.count - a.count)[0].colour;
  });
  for (let k = 0; k < shade.length; k++) shade[k] = settled[k];

  const palette = [], paletteKey = new Map();
  const colourIndex = colour => {
    const key = colour.map(v => Math.round(v * 255)).join(',');
    if (!paletteKey.has(key)) { paletteKey.set(key, palette.length); palette.push(colour.map(v => Math.round(v * 255))); }
    return paletteKey.get(key);
  };
  const heights = new Uint16Array(cols * rows), colours = new Uint8Array(cols * rows);
  let firstCol = cols, lastCol = -1, firstRow = rows, lastRow = -1;
  for (let k = 0; k < tops.length; k++) {
    if (!shade[k]) continue;
    heights[k] = Math.max(1, Math.round((tops[k] - base) * 100));
    colours[k] = colourIndex(shade[k]);
    const col = k % cols, row = Math.floor(k / cols);
    firstCol = Math.min(firstCol, col); lastCol = Math.max(lastCol, col); firstRow = Math.min(firstRow, row); lastRow = Math.max(lastRow, row);
  }
  if (palette.length > 255) throw new Error(`${id}: ${palette.length} colours from above; the record holds 255`);
  const wall = [...walls.entries()].sort((p, q) => q[1] - p[1])[0]?.[0].split(',').map(Number) ?? palette[0];
  const world = (u, v) => [u * cos - v * sin, u * sin + v * cos].map(value => Math.round(value * 100) / 100);
  /* where the building meets the ground: its corners and middle, as the map's houses */
  const u0 = minU + firstCol * cell, u1 = minU + (lastCol + 1) * cell, v0 = minV + firstRow * cell, v1 = minV + (lastRow + 1) * cell;
  const feet = [world(u0, v0), world(u1, v0), world(u1, v1), world(u0, v1), world((u0 + u1) / 2, (v0 + v1) / 2)];
  return {
    id,
    origin: world(minU, minV),
    angle: Math.round(angle * 1e6) / 1e6,
    cell: Math.round(cell * 1000) / 1000,
    cols, rows,
    wall,
    palette,
    heights: Buffer.from(heights.buffer).toString('base64'),
    colours: Buffer.from(colours.buffer).toString('base64'),
    feet,
    cells: kept,
  };
}

/* ------------------------------------------------------------------ sources */
function groundFrames() {
  const byGround = new Map();
  for (const entry of json('courses/v2-index.json').courses) {
    if (byGround.has(entry.groundId)) continue;
    const groundManifest = json(entry.manifest.url).groundManifest;
    const ground = json(groundManifest.url);
    byGround.set(entry.groundId, { ground, frame: createMapFrame(entry.groundId, ground.frame) });
  }
  return byGround;
}

const sourceRecord = file => ({ path: path.relative(ROOT, file).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(file)) });

/* A facility receipt and its GLB: the detailed course's own list of what it draws. */
function facilityReceipt(groundId, { ground, frame }) {
  const receiptFile = path.join(PUBLIC, `models/${groundId}/facilities-v1.json`);
  if (!fs.existsSync(receiptFile)) return null;
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const glbFile = path.join(PUBLIC, receipt.asset.url);
  const glb = readGlb(glbFile);
  const { easting: groundEasting, northing: groundNorthing } = ground.frame.origin;
  const cf = typeof receipt.coordinateFrame === 'string' ? { kind: receipt.coordinateFrame } : receipt.coordinateFrame;
  let place;
  if (cf.kind === 'epsg3006-local-rh2000') {
    const easting = cf.originEasting ?? cf.originEpsg3006.easting, northing = cf.originNorthing ?? cf.originEpsg3006.northing;
    place = (x, y, z) => [easting + x - groundEasting, y, groundNorthing - (northing - z)];
  } else if (cf.kind === 'legacy-local-rh2000') {
    place = (x, y, z) => { const [wx, wz] = frame.toWorld(x, z); return [wx, y, wz]; };
  } else throw new Error(`${groundId}: unknown facility frame ${cf.kind}`);
  const nodes = new Map(glb.gltf.nodes.map((node, index) => [node.name, index]));
  const buildings = [], replaces = { ids: [], rings: [] };
  for (const facility of receipt.facilities) {
    const ids = [facility.sourceBuildingIds ?? [], facility.sourceBuildingId ?? []].flat().filter(Boolean);
    replaces.ids.push(...ids);
    /* Veckefjärden names its footprints by place in the pack, which differs between
       its layouts: the map finds them by where they stand instead. */
    for (const { ring } of facility.sourceBuildingRingsLocal ?? []) replaces.rings.push(centroid(ring.map(([x, z]) => place(x, 0, z)).map(p => [p[0], p[2]])));
    const building = facility.kind ? BUILDING_KINDS.has(facility.kind) : !SITE_PIECE.test(facility.id);
    if (!building) continue;
    const index = nodes.get(facility.nodeName);
    if (index === undefined) throw new Error(`${groundId}: the GLB has no node ${facility.nodeName}`);
    const record = recordBuilding(facility.id, nodeTriangles(glb, index, place));
    if (record) buildings.push(record);
  }
  replaces.ids.push(...(receipt.suppressedSourceBuildingIds ?? []));
  return { buildings, replaces, sources: [sourceRecord(receiptFile), sourceRecord(glbFile)] };
}

function centroid(ring) {
  const [x, z] = ring.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]);
  return [Math.round(x / ring.length * 100) / 100, Math.round(z / ring.length * 100) / 100];
}

/* Tortuna: a GLB a building, each at its own EPSG:3006 anchor. */
async function tortuna({ ground }) {
  const { easting: groundEasting, northing: groundNorthing } = ground.frame.origin;
  const buildings = [], replaces = { ids: [], rings: [] }, sources = [];
  for (const module of ['tortuna-architecture.js', 'tortuna-facilities.js']) {
    const file = path.join(SCENERY, module);
    sources.push(sourceRecord(file));
    const exported = await import(pathToFileURL(file).href);
    const list = Object.values(exported).find(value => Array.isArray(value) && value[0]?.anchorEpsg3006RH2000) ?? [];
    for (const item of list) {
      if ((item.rotationYRadians ?? 0) !== 0 || (item.scale ?? 1) !== 1) throw new Error(`tortuna ${item.buildingId}: the bake assumes no turn or scale`);
      const [easting, northing, height] = item.anchorEpsg3006RH2000;
      const glbFile = path.join(PUBLIC, item.asset.url);
      sources.push(sourceRecord(glbFile));
      const glb = readGlb(glbFile);
      const place = (x, y, z) => [easting + x - groundEasting, height + y, groundNorthing - (northing - z)];
      const triangles = glb.gltf.scenes[glb.gltf.scene ?? 0].nodes.flatMap(index => nodeTriangles(glb, index, place));
      replaces.ids.push(item.buildingId);
      const record = recordBuilding(item.buildingId, triangles);
      if (record) buildings.push(record);
    }
  }
  return { buildings, replaces, sources };
}

/* Norrfällsviken: authored parts in Blender's east/north/up from an EPSG:3006/RH2000
   origin, and the hotel stated through the house kit. */
function norrfallsviken({ ground, frame }) {
  const { easting: groundEasting, northing: groundNorthing } = ground.frame.origin;
  const buildings = [], replaces = { ids: ['w1205924894', 'lm-range-shelter', 'w1206117854'], rings: [] }, sources = [];
  for (const name of ['norrfallsviken-facilities-meshes.json', 'norrfallsviken-range-shelter-meshes.json']) {
    const file = path.join(SCENERY, name);
    sources.push(sourceRecord(file));
    const meshes = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [e0, n0, h0] = meshes.originEpsg3006RH2000;
    const groups = new Map();
    for (const part of meshes.parts) {
      const id = part.facilityId.startsWith('clubhouse') ? 'clubhouse' : part.facilityId;
      if (!groups.has(id)) groups.set(id, []);
      const p = part.positions, colour = linearToSrgb(part.colour);
      const at = i => [e0 + p[i * 3] - groundEasting, h0 + p[i * 3 + 2], groundNorthing - (n0 + p[i * 3 + 1])];
      for (let i = 0; i + 2 < part.indices.length; i += 3) groups.get(id).push({ a: at(part.indices[i]), b: at(part.indices[i + 1]), c: at(part.indices[i + 2]), colour });
    }
    for (const [id, triangles] of groups) {
      const record = recordBuilding(id, triangles);
      if (record) buildings.push(record);
    }
  }
  const moduleFile = path.join(SCENERY, 'norrfallsviken.js');
  sources.push(sourceRecord(moduleFile));
  const literal = fs.readFileSync(moduleFile, 'utf8').match(/export const houseKitBuildings = (\{[\s\S]*?\n\});/);
  if (!literal) throw new Error('norrfallsviken.js: houseKitBuildings not found');
  const stated = Function(`return ${literal[1]}`)();
  for (const [id, statement] of Object.entries(stated)) {
    const record = recordBuilding(id, statedHouse(statement, (x, z) => frame.toWorld(x, z)));
    if (record) buildings.push(record);
  }
  return { buildings, replaces, sources };
}

/* A house stated wing by wing: walls a storey high and a gabled roof at its pitch. */
function statedHouse({ storeys = 1, pitch = 27, wall, roof, wings }, toWorld) {
  const triangles = [];
  const walls = hexToSrgb(wall), roofs = hexToSrgb(roof);
  const eaves = 0.5 + storeys * 2.8;
  for (const { from, to, width } of wings) {
    const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
    const sx = -dz / length * width / 2, sz = dx / length * width / 2;
    const ridge = eaves + (width / 2) * Math.tan(pitch * Math.PI / 180);
    const at = (x, z, y) => { const [wx, wz] = toWorld(x, z); return [wx, y, wz]; };
    const a = [from[0] + sx, from[1] + sz], b = [to[0] + sx, to[1] + sz], c = [to[0] - sx, to[1] - sz], d = [from[0] - sx, from[1] - sz];
    const quad = (p, q, r, s, colour) => { triangles.push({ a: p, b: q, c: r, colour }, { a: p, b: r, c: s, colour }); };
    for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]]) quad(at(p[0], p[1], 0), at(q[0], q[1], 0), at(q[0], q[1], eaves), at(p[0], p[1], eaves), walls);
    const ridgeFrom = at(from[0], from[1], ridge), ridgeTo = at(to[0], to[1], ridge);
    quad(at(a[0], a[1], eaves), at(b[0], b[1], eaves), ridgeTo, ridgeFrom, roofs);
    quad(at(c[0], c[1], eaves), at(d[0], d[1], eaves), ridgeFrom, ridgeTo, roofs);
  }
  return triangles;
}

/* Upsala: authored parts in the layout's legacy frame, heights in RH2000. */
function upsala({ frame }) {
  const file = path.join(SCENERY, 'upsala-authored-meshes.json');
  const meshes = JSON.parse(fs.readFileSync(file, 'utf8'));
  const buildings = [], replaces = { ids: [], rings: [] };
  for (const asset of meshes.assets) {
    replaces.ids.push(...(asset.replaces ?? []).map(item => item.id));
    const triangles = [];
    for (const part of asset.parts) {
      const p = part.positions, colour = hexToSrgb(part.color);
      const at = i => { const [wx, wz] = frame.toWorld(p[i * 3], p[i * 3 + 2]); return [wx, p[i * 3 + 1], wz]; };
      for (let i = 0; i + 2 < part.indices.length; i += 3) triangles.push({ a: at(part.indices[i]), b: at(part.indices[i + 1]), c: at(part.indices[i + 2]), colour });
    }
    const record = recordBuilding(asset.id, triangles);
    if (record) buildings.push(record);
  }
  return { buildings, replaces, sources: [sourceRecord(file)] };
}

const SPECIAL = { tortuna, norrfallsviken, upsala };

/* Whether the detailed course draws buildings of a ground's own that the map should copy:
   a facility receipt, or one of the grounds read their own way above (course-doctor.mjs). */
export const hasModelledBuildings = (groundId, root = ROOT) =>
  Object.hasOwn(SPECIAL, groundId) || fs.existsSync(path.join(root, 'apps/golf/public/models', groundId, 'facilities-v1.json'));

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const grounds = {};
  for (const [groundId, ground] of groundFrames()) {
    const baked = SPECIAL[groundId] ? await SPECIAL[groundId](ground) : facilityReceipt(groundId, ground);
    if (!baked?.buildings.length) continue;
    const record = { version: 1, groundId, frame: ground.ground.frame.fingerprint, replaces: baked.replaces, buildings: baked.buildings };
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    const digest = sha256(bytes);
    const file = `models/map-buildings/${groundId}-${digest.slice(0, 16)}.json`;
    fs.writeFileSync(path.join(PUBLIC, file), bytes);
    grounds[groundId] = { file, sha256: digest, bytes: bytes.length, buildings: baked.buildings.length, sources: baked.sources };
    const cells = baked.buildings.reduce((sum, b) => sum + b.cells, 0);
    console.log(`${groundId.padEnd(15)} ${String(baked.buildings.length).padStart(3)} buildings · ${String(cells).padStart(6)} cells · ${(bytes.length / 1024).toFixed(1)} KiB · replaces ${baked.replaces.ids.length} ids${baked.replaces.rings.length ? ` + ${baked.replaces.rings.length} rings` : ''}`);
  }
  fs.writeFileSync(path.join(PUBLIC, 'models/map-buildings.json'), `${JSON.stringify({ version: 1, grounds }, null, 1)}\n`);
}
