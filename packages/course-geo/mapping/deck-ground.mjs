#!/usr/bin/env node
/* IS EVERY TEE DECK ON A DECK?

   A tee deck is built level, and the terrain is a laser's measurement of the ground: under a ring that lies on its
   deck, the terrain is a plane tilted a percent or two. At Bro Hof 136 of 155 decks sloped under 2% and 18 stood
   clear of them, with almost nothing between. Those 18 were exactly the two kinds of fault a photo hides:

   - a ring off its deck: under crowns, where neither photo shows the edge (Castle 11's white tee hung 3 m over a
     bank and had passed the first look, and Castle 7's decks had been redrawn by eye and still missed);
   - a deck newer than the terrain: mown on today's photo, but ground that was a bank, a hollow or water when the
     terrain was flown. The outline is right and the model's ground under it is not.

   The check cannot tell the two apart, and says so: it names the decks, and a person looks. It reads the terrain
   the tracer reads (trace-config.json `terrain`), which is a private cache, so it runs where the tracing runs and
   its result is kept beside the outlines, tied to them by their checksum:

   node packages/course-geo/mapping/deck-ground.mjs --config <build>/mapping/trace-config.json            the decks off the line
   node packages/course-geo/mapping/deck-ground.mjs --config <build>/mapping/trace-config.json --record   and keep the record
   node packages/course-geo/mapping/deck-ground.mjs --config <...> --around <ring id> [--pad 8]           the heights round one ring

   <build>/mapping/deck-ground.json is what the walkthrough and the owner's review page print on each hole. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** A deck's ground slopes less than this (percent), and lies within this of a plane (metres, nine cells in ten). */
export const DECK_SLOPE_LINE = 3;
export const DECK_OFF_PLANE_LINE = 0.08;
const INSET_METRES = 1, RIM_METRES = 4, FEWEST_CELLS = 6;

const read = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(read(file).toString('utf8'));
export const deckGroundPath = build => `${build}/mapping/deck-ground.json`;
const sha = file => createHash('sha256').update(read(file)).digest('hex');

function inside(p, ring) {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}
function gap(p, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i], dx = bx - ax, dy = by - ay;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - u * dx, p[1] - ay - u * dy));
  }
  return best;
}
const quantile = (list, share) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]; };
const round = (value, digits) => Number(value.toFixed(digits));

/** The terrain under one ring, read on a 1 m grid a metre inside its edge: the slope of the plane through it (percent),
 * how far nine cells in ten lie from that plane (metres), and how far its middle stands above the 4 m of ground round
 * it. `heightAt(easting, northing)` is the terrain. A ring too small to hold six cells is not measured. */
export function deckGround(heightAt, ring) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), cells = [], rim = [];
  for (let e = Math.floor(Math.min(...xs)) - RIM_METRES - 1; e <= Math.max(...xs) + RIM_METRES + 1; e++) {
    for (let n = Math.floor(Math.min(...ys)) - RIM_METRES - 1; n <= Math.max(...ys) + RIM_METRES + 1; n++) {
      const p = [e + 0.5, n + 0.5], d = gap(p, ring);
      if (inside(p, ring)) { if (d >= INSET_METRES) cells.push([p[0], p[1], heightAt(p[0], p[1])]); } else if (d >= INSET_METRES && d <= RIM_METRES) rim.push(heightAt(p[0], p[1]));
    }
  }
  if (cells.length < FEWEST_CELLS) return { cells: cells.length, measured: false };
  const n = cells.length, mean = k => cells.reduce((s, c) => s + c[k], 0) / n, mx = mean(0), my = mean(1), mz = mean(2);
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const [x, y, z] of cells) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; sxz += (x - mx) * (z - mz); syz += (y - my) * (z - mz); }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-9)) return { cells: n, measured: false }; // every cell on one line: no plane
  const a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det;
  const off = cells.map(([x, y, z]) => Math.abs(z - mz - a * (x - mx) - b * (y - my)));
  return { cells: n, measured: true, slope: round(100 * Math.hypot(a, b), 1), offPlane: round(quantile(off, 0.9), 2),
    level: round(quantile(cells.map(c => c[2]), 0.5), 2), aboveRim: rim.length ? round(quantile(cells.map(c => c[2]), 0.5) - quantile(rim, 0.5), 2) : null };
}

export const offTheLine = deck => deck.measured && (deck.slope > DECK_SLOPE_LINE || deck.offPlane > DECK_OFF_PLANE_LINE);

/** The trace config's terrain as a height function over EPSG:3006 metres (a north-up Float32 grid of 1 m cells). */
export function terrainReader(terrain, root = ROOT) {
  const raw = fs.readFileSync(path.join(root, terrain.path));
  const z = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), side = terrain.side, step = terrain.step ?? 1;
  if (z.length !== side * side) throw new Error(`${terrain.path}: not a ${side} x ${side} grid`);
  return (e, n) => {
    const c = Math.round((e - terrain.firstEasting) / step), r = Math.round((terrain.firstNorthing - n) / step);
    if (c < 0 || r < 0 || c >= side || r >= side) throw new Error(`${e}, ${n} is outside the terrain`);
    return z[r * side + c];
  };
}

/** One build's record: every tee deck measured, and the ones off the line by ring id. */
export function deckGroundRecord(surfaces, heightAt, { slug, surfacesSha256, terrainSha256 }) {
  const decks = surfaces.features.filter(f => f.properties.kind === 'tee').map(f => ({ id: f.id, hole: f.properties.hole, tees: f.properties.teeIds ?? [], ...deckGround(heightAt, f.geometry.coordinates[0]) }));
  const measured = decks.filter(d => d.measured), off = measured.filter(offTheLine);
  return { schemaVersion: 1, slug, surfacesSha256, terrainSha256, line: { slopePercent: DECK_SLOPE_LINE, offPlaneMetres: DECK_OFF_PLANE_LINE },
    decks: decks.length, measured: measured.length, tooSmall: decks.filter(d => !d.measured).map(d => d.id), level: measured.length - off.length,
    off: off.map(({ id, hole, tees, cells, slope, offPlane, aboveRim }) => ({ id, hole, tees, cells, slope, offPlane, aboveRim })) };
}

/** Why a build's deck record does not hold (an empty list when it does). Needs no terrain: it is what CI can check. */
export function deckGroundErrors(build) {
  if (!fs.existsSync(path.join(ROOT, deckGroundPath(build)))) return [`${build}: the tee decks were not measured against the terrain (deck-ground.mjs --record)`];
  const record = json(deckGroundPath(build)), errors = [];
  if (record.schemaVersion !== 1) errors.push(`${build}: an unknown deck record`);
  if (record.surfacesSha256 !== sha(`${build}/mapping/playing-surfaces.geojson`)) errors.push(`${build}: the outlines changed since the decks were measured; run deck-ground.mjs --record again`);
  if (record.line?.slopePercent !== DECK_SLOPE_LINE || record.line?.offPlaneMetres !== DECK_OFF_PLANE_LINE) errors.push(`${build}: the decks were measured against another line`);
  if (record.decks !== record.measured + record.tooSmall.length || record.level !== record.measured - record.off.length) errors.push(`${build}: the deck record does not add up`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  if (!flag('config')) throw new Error('usage: deck-ground.mjs --config <build>/mapping/trace-config.json [--record | --around <ring id> [--pad 8]]');
  const config = json(flag('config')), heightAt = terrainReader(config.terrain);
  const builds = config.courses.map(course => path.dirname(course.outDir).split(path.sep).join('/'));
  if (flag('around')) {
    const id = flag('around'), pad = Number(flag('pad') ?? 8);
    const ring = builds.flatMap(b => json(`${b}/mapping/playing-surfaces.geojson`).features).find(f => f.id === id)?.geometry.coordinates[0];
    if (!ring) throw new Error(`no ring ${id} in this ground's outlines`);
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const e0 = Math.floor(Math.min(...xs)) - pad, e1 = Math.ceil(Math.max(...xs)) + pad, n0 = Math.floor(Math.min(...ys)) - pad, n1 = Math.ceil(Math.max(...ys)) + pad;
    let base = Infinity;
    for (let e = e0; e <= e1; e++) for (let n = n0; n <= n1; n++) base = Math.min(base, heightAt(e + 0.5, n + 0.5));
    base = Math.floor(base);
    console.log(`${id}: decimetres above ${base} m. East ${e0} to ${e1} from the left, north ${n1} at the top; * is inside the ring.`);
    console.log(`${' '.repeat(8)}${Array.from({ length: e1 - e0 + 1 }, (_, i) => String((e0 + i) % 100).padStart(3)).join(' ')}`);
    for (let n = n1; n >= n0; n--) {
      console.log(`${String(n).padStart(7)} ${Array.from({ length: e1 - e0 + 1 }, (_, i) => { const p = [e0 + i + 0.5, n + 0.5]; return String(Math.round((heightAt(p[0], p[1]) - base) * 10)).padStart(3) + (inside(p, ring) ? '*' : ' '); }).join('')}`);
    }
  } else {
    const terrainSha256 = config.terrain.sha256, out = [];
    for (const [i, build] of builds.entries()) {
      const surfaces = json(`${build}/mapping/playing-surfaces.geojson`);
      const record = deckGroundRecord(surfaces, heightAt, { slug: config.courses[i].slug, surfacesSha256: sha(`${build}/mapping/playing-surfaces.geojson`), terrainSha256 });
      if (argv.includes('--record')) fs.writeFileSync(path.join(ROOT, deckGroundPath(build)), `${JSON.stringify(record, null, 1)}\n`);
      out.push({ build, decks: record.decks, measured: record.measured, level: record.level, tooSmall: record.tooSmall, off: record.off.map(d => `${d.id} (${d.tees.join('/') || 'no card tee'}): slope ${d.slope}%, ${d.offPlane} m off a plane`) });
    }
    console.log(JSON.stringify(out, null, 1));
  }
}
