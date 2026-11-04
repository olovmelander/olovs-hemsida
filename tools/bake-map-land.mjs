#!/usr/bin/env node
/* What covers a ground, for the map: its water and its forest, one small picture
 * of each per ground, on the 8 m ring every ground publishes whole.
 *
 * Water. A pack's water rings are cut off at the box they were extracted in, so a
 * lake running past it ends in a straight edge and lakes beyond it are not there at
 * all. The simulator reads the rest off the laser's own ground at boot: water is
 * level, land is not (engine/v2-flat-water.mjs). The map has no ring tiles to do
 * that with, so it runs here, with the same detector and settings.
 *
 * Forest. The laser's stand field covers the 1 m core and stops; past it there is
 * only the land cover, an appearance record of imagery that can call a whole
 * rectangle of forest water. So inside the core the picture is the laser's canopy,
 * at every zoom, and outside it the land cover's, with main.js's rule for what the
 * land cover says of water that the ground does not bear out: land, and in this
 * country forest unless it is mapped as something open.
 *
 *   node tools/bake-map-land.mjs
 *
 * Rerun it when a ground's terrain or stands are republished: map.test.mjs compares
 * each record with the ground it was read from, so a stale one fails. It writes
 * apps/golf/public/models/map-land/ and map-land.json, replacing the set. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseChunkEnvelope } from '../packages/course-v2/chunk.mjs';
import { ringSD } from '../apps/golf/src/engine/geom.js';
import { decodeLandcover, isTreeClass, LANDCOVER, landcoverSampler } from '../apps/golf/src/engine/landcover.mjs';
import { detectFlatWater, rasterFromRingTiles } from '../apps/golf/src/engine/v2-flat-water.mjs';
import { canopyAlpha } from '../apps/golf/src/map/map-canopy.mjs';
import { createMapFrame } from '../apps/golf/src/map/map-frames.mjs';

const PUBLIC = path.resolve('apps/golf/public');
const OUT = path.join(PUBLIC, 'models/map-land');
const json = file => JSON.parse(fs.readFileSync(path.join(PUBLIC, file), 'utf8'));
const chunkOf = reference => {
  const envelope = parseChunkEnvelope(fs.readFileSync(path.join(PUBLIC, reference.url)));
  return { header: envelope.header, payload: envelope.codec === 'deflate-raw' ? zlib.inflateRawSync(envelope.encodedPayload) : envelope.encodedPayload };
};
/* The ring every ground publishes whole: 64 tiles of 8 m samples. */
const RING_LOD = 3;
/* Johannesberg's own flag (v2-johannesberg-config.mjs): its gentle fields split at
   every height step of the 8 m ring, and read as level. */
const QUANTIZATION_AWARE = new Set(['johannesberg']);
const FOREST_LEVELS = [0, 85, 170, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = bytes => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
/* A palette PNG of white at `levels` of alpha, clear on bare land: a browser reads
   it, canvas carries its alpha straight into a tile, and a lake compresses to
   nothing. */
function encodePicture(values, width, height, levels) {
  const bits = levels.length <= 2 ? 1 : 2;
  const stride = Math.ceil(width * bits / 8);
  const rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    const at = row * (stride + 1) + 1;
    for (let column = 0; column < width; column++) {
      rows[at + (column * bits >> 3)] |= values[row * width + column] << (8 - bits - (column * bits & 7));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bits;
  header[9] = 3;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('PLTE', Buffer.alloc(levels.length * 3, 255)), chunk('tRNS', Buffer.from(levels)),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* The laser's sea is not one sheet: where an old shoreline was burned into the
   model a band of cells a few metres wide reads as not level, and the map would
   draw it as a thin green line across open water. The simulator has an ocean
   polygon over it. A cell is closed in when water lies both sides of it within
   `REACH` cells and it stands no higher than that water by more than `STEP`:
   a real strip of land, however narrow, stands higher. */
const REACH = 3, STEP = 0.6;
function closeSeams({ mask, width, height, heights }) {
  const closed = mask.slice();
  let filled = 0;
  for (let row = REACH; row < height - REACH; row++) {
    for (let column = REACH; column < width - REACH; column++) {
      const i = row * width + column;
      if (mask[i]) continue;
      const reach = (stepColumn, stepRow) => {
        for (let k = 1; k <= REACH; k++) {
          const j = i + stepRow * k * width + stepColumn * k;
          if (mask[j]) return heights[j];
        }
        return NaN;
      };
      const across = [[reach(-1, 0), reach(1, 0)], [reach(0, -1), reach(0, 1)]]
        .find(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
      if (!across || !(heights[i] <= Math.min(...across) + STEP)) continue;
      closed[i] = 1;
      filled++;
    }
  }
  return { closed, filled };
}

/* The rule main.js states for water: wet is inside a ring AND at that ring's own
   level. Norrfällsviken's sea ring closes across the land behind the coast, 430 ha
   of forest up to 40 m above the sea, and painted as it stands that land is sea. An
   outline with land inside it is not painted: `dry` lists it for the map, and the
   water that does lie inside it goes into the picture here. */
const DRY_ABOVE_METRES = 1.5, DRY_SHARE = 0.04, DRY_LEAST_HECTARES = 10, SHORE_ABOVE_METRES = 0.5;
function readOutline(points, raster, mask, frame) {
  const ring = points.map(point => frame.toWorld(point[0], point[1]));
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const { spacing, width, height } = raster;
  const inside = [];
  for (let row = Math.max(0, Math.floor((z0 - raster.z0) / spacing)); row < height && raster.z0 + row * spacing <= z1; row++) {
    for (let column = Math.max(0, Math.floor((x0 - raster.x0) / spacing)); column < width && raster.x0 + column * spacing <= x1; column++) {
      const i = row * width + column;
      if (Number.isFinite(raster.heights[i]) && ringSD(raster.x0 + (column + 0.5) * spacing, raster.z0 + (row + 0.5) * spacing, ring) < 0) inside.push(i);
    }
  }
  if (!inside.length) return null;
  const sorted = inside.map(i => raster.heights[i]).sort((a, b) => a - b);
  const surface = sorted[Math.floor((sorted.length - 1) * 0.1)];
  const land = sorted.filter(value => value > surface + DRY_ABOVE_METRES).length;
  if (land / sorted.length <= DRY_SHARE || inside.length * spacing ** 2 / 10000 < DRY_LEAST_HECTARES) return null;
  for (const i of inside) if (raster.heights[i] <= surface + SHORE_ABOVE_METRES) mask[i] = 1;
  return { points: points.length, first: points[0], landHectares: Math.round(land * spacing ** 2 / 10000) };
}

/* Marks the cells a ring encloses, by even-odd crossings along each row. */
function markRing(target, ring, { x0, z0, spacing, width, height }) {
  let top = Infinity, bottom = -Infinity;
  for (const [, z] of ring) { top = Math.min(top, z); bottom = Math.max(bottom, z); }
  const first = Math.max(0, Math.floor((top - z0) / spacing)), last = Math.min(height - 1, Math.ceil((bottom - z0) / spacing));
  for (let row = first; row <= last; row++) {
    const z = z0 + (row + 0.5) * spacing, crossings = [];
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
      if ((az <= z) !== (bz <= z)) crossings.push(ax + (z - az) / (bz - az) * (bx - ax));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] - x0) / spacing - 0.5)), to = Math.min(width - 1, Math.floor((crossings[k + 1] - x0) / spacing - 0.5));
      for (let column = from; column <= to; column++) target[row * width + column] = 1;
    }
  }
}

/* The laser's canopy over the core, as alpha on the picture's own cells. */
function coreCanopy(ground, raster) {
  const { easting, northing } = ground.frame.origin;
  const { x0, z0, spacing, width, height } = raster;
  const sum = new Float32Array(width * height), count = new Uint16Array(width * height);
  for (const tile of ground.tiles) {
    if (tile.lod !== 0 || !tile.layers.stands) continue;
    const { header, payload } = chunkOf(tile.layers.stands);
    const { width: columns, height: rows, cellMetres } = header.standField;
    const alpha = canopyAlpha({ payload, width: columns, height: rows });
    const west = tile.bounds.minEasting - easting, north = northing - tile.bounds.maxNorthing;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      if (!(payload[(row * columns + column) * 4 + 3] & 1)) continue;
      const i = Math.floor((north + (row + 0.5) * cellMetres - z0) / spacing) * width + Math.floor((west + (column + 0.5) * cellMetres - x0) / spacing);
      sum[i] += alpha[(row * columns + column) * 4 + 3];
      count[i]++;
    }
  }
  return { sum, count };
}

const seen = new Map();
const layouts = json('courses/index.json').courses;
for (const entry of json('courses/v2-index.json').courses) {
  if (!seen.has(entry.groundId)) seen.set(entry.groundId, []);
  seen.get(entry.groundId).push(entry);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const publish = (name, bytes) => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = `models/map-land/${name}-${sha256.slice(0, 16)}.png`;
  fs.writeFileSync(path.join(PUBLIC, file), bytes);
  return { file, sha256, bytes: bytes.length };
};

const grounds = {};
for (const [groundId, entries] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const groundManifest = json(entries[0].manifest.url).groundManifest;
  const ground = json(groundManifest.url);
  const tiles = ground.tiles.filter(tile => tile.lod === RING_LOD).map(tile => {
    const { header, payload } = chunkOf(tile.layers.terrain);
    return { bounds: tile.bounds, grid: header.grid, payload };
  });
  const { easting, northing } = ground.frame.origin;
  const raster = rasterFromRingTiles(tiles, { legacyOrigin: { easting, northing }, verticalDatumOffsetMetres: 0 });
  const flat = detectFlatWater({ raster, quantizationAware: QUANTIZATION_AWARE.has(groundId) });
  const { width, height, spacing, x0, z0 } = flat;
  const { closed, filled } = closeSeams({ mask: flat.mask, width, height, heights: raster.heights });
  const frame = createMapFrame(groundId, ground.frame);
  const dry = new Map();
  const open = new Uint8Array(width * height);
  const known = { raster: { x0, z0, spacing, width, height } };
  let cover = null;
  for (const { slug } of entries) {
    const meta = layouts.find(course => course.slug === slug);
    const pack = fs.readFileSync(path.join(PUBLIC, meta.packUrl));
    const headerBytes = pack.readUInt32LE(4);
    const header = JSON.parse(pack.subarray(8, 8 + headerBytes).toString());
    const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
    const vectors = JSON.parse(zlib.inflateRawSync(pack.subarray(start, start + header.VEC.bytes)).toString());
    const far = meta.surroundings ? json(meta.surroundings.url) : null;
    for (const water of [...(vectors.water ?? []), ...(far?.water ?? [])]) {
      if (water.stream || !(water.ring?.length >= 3)) continue;
      const outline = readOutline(water.ring, raster, closed, frame);
      if (outline) dry.set(outline.first.join(), outline);
    }
    /* What is mapped as open keeps no guessed forest: main.js's openLand. */
    const single = value => (typeof value?.[0]?.[0] === 'number' ? [value] : value ?? []);
    const openRings = [...[...(vectors.infra?.landuse ?? []), ...(far?.landuse ?? [])].filter(item => item.kind !== 'industrial' && item.kind !== 'commercial').map(item => item.ring),
      ...single(vectors.surround?.clearfells), ...single(vectors.surround?.yard), ...single(vectors.surround?.hayfields)];
    for (const ring of openRings) if (ring?.length >= 3) markRing(open, ring.map(point => frame.toWorld(point[0], point[1])), known.raster);
    if (!cover && meta.landcover?.url) cover = await decodeLandcover(json(meta.landcover.url), async text => new Uint8Array(zlib.inflateRawSync(Buffer.from(text, 'base64'))));
  }

  /* Forest. Two cells off any water: a shore's reeds and shallows are what imagery
     calls water with reason. */
  const landAt = landcoverSampler(cover);
  const wetNear = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    if (!closed[row * width + column]) continue;
    for (let b = Math.max(0, row - 2); b <= Math.min(height - 1, row + 2); b++) for (let a = Math.max(0, column - 2); a <= Math.min(width - 1, column + 2); a++) wetNear[b * width + a] = 1;
  }
  const { sum, count } = coreCanopy(ground, flat);
  const forest = new Uint8Array(width * height);
  let measured = 0, recorded = 0, guessed = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const i = row * width + column;
    if (closed[i]) continue;
    let alpha;
    if (count[i]) {
      alpha = sum[i] / count[i];
      measured += alpha > 0 ? 1 : 0;
    } else {
      const [x, z] = frame.toPack(x0 + (column + 0.5) * spacing, z0 + (row + 0.5) * spacing);
      const kind = landAt(x, z);
      if (isTreeClass(kind)) {
        alpha = kind === LANDCOVER.TREES ? 255 : 150;
        recorded++;
      } else if ((kind === LANDCOVER.WATER || kind === LANDCOVER.UNKNOWN) && !wetNear[i] && !open[i]) {
        alpha = 255;
        guessed++;
      } else alpha = 0;
    }
    forest[i] = Math.round(alpha / 255 * (FOREST_LEVELS.length - 1));
  }

  let wetCells = 0;
  for (const value of closed) wetCells += value;
  const hectares = cells => (cells * spacing ** 2 / 10000).toFixed(0);
  const water = publish(`${groundId}-water`, encodePicture(closed, width, height, [0, 255]));
  const wood = publish(`${groundId}-forest`, encodePicture(forest, width, height, FOREST_LEVELS));
  grounds[groundId] = {
    water,
    forest: wood,
    width,
    height,
    spacing,
    x0,
    z0,
    dry: [...dry.values()],
    ground: ground.frame.fingerprint,
    terrain: groundManifest.sha256,
  };
  console.log(`${groundId.padEnd(15)} water ${hectares(wetCells).padStart(6)} ha (${hectares(filled)} ha of seams${dry.size ? `, ${[...dry.values()].map(item => item.landHectares).join('+')} ha of land inside an outline` : ''}) ${(water.bytes / 1024).toFixed(0)} KB  forest: laser ${hectares(measured)} ha, land cover ${hectares(recorded)} ha, by rule ${hectares(guessed)} ha, ${(wood.bytes / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(PUBLIC, 'models/map-land.json'), `${JSON.stringify({ version: 1, lod: RING_LOD, grounds }, null, 1)}\n`);
