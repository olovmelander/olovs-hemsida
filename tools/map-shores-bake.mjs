/* The water a lake's ground holds, read for the map (7 November, owner request: no
 * straight, sharp lines on the water, and the map and the course agree).
 *
 * The simulator draws each lake out to where its ground rises out of it
 * (engine/water-reach.mjs), at a level re-measured off the ground at boot. The map
 * reads the same reach, by the same rule, off the same published tiles. It cannot do
 * so on the phone: a lake's whole shore is more ground than a view streams, 0.5-4 MB
 * of 2 m tiles a course beyond the holes' own, so tools/bake-map-land.mjs reads it
 * once per ground with this, and the map paints what it found (map-shores.mjs).
 *
 * Everything here runs in the pack's own frame and datum, as main.js does: the same
 * ring, the same lattice, the same near ground. Only the heights are read from the
 * tiles directly, the finest at each point, where the simulator reads its 1 m
 * frontier and then its 2 m rings. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { squaredDistanceTransform } from '../packages/course-v2/distance-transform.mjs';
import { waterReach } from '../apps/golf/src/engine/water-reach.mjs';
import { laserPlateLevel, LASER_PLATE_COURSES } from '../apps/golf/src/engine/water-plate-level.mjs';
import { shoreLevel } from '../apps/golf/src/engine/water-level.mjs';

/* The rules the bake follows: when either changes, the map's shores are stale
   (map.test.mjs compares this with the record). */
export const SHORE_RULE_FILES = Object.freeze([
  'apps/golf/src/engine/water-reach.mjs',
  'apps/golf/src/engine/water-plate-level.mjs',
  'apps/golf/src/engine/water-level.mjs',
]);
export function shoreRuleHash(root = '.') {
  const hash = createHash('sha256');
  for (const file of SHORE_RULE_FILES) hash.update(file).update('\0').update(fs.readFileSync(`${root}/${file}`, 'utf8').replaceAll('\r\n', '\n')).update('\0');
  return hash.digest('hex');
}

/* main.js's reachableWater, for a body as the boot holds it. */
export const reachableInSimulator = (water, infra) => !water.stream && water.ring?.length >= 3 && !water.isSea && !water.shoreline
  && !(water.artificialCutEdgeCount > 0) && !water.surr && !water.exactShore && infra?.terrainPlacement !== 'measured-only';

/* main.js's re-measured level, copied here (map-shores.test.mjs holds them to
   main.js's text): on a LASER_PLATE course the lake's laser plate; otherwise the
   30th percentile of the ground under the ring's own points plus 0.25 m, where 60%
   of them are on the ground, and on fewer never lower than the pack's level. */
export const SIMULATOR_LEVEL = Object.freeze({ coverage: 0.6, percentile: 0.30, minimumPoints: 3, clearanceMetres: 0.25 });
export function simulatorLevel({ ring, level, probe, plate = false }) {
  const measuredPlate = plate ? laserPlateLevel(ring, probe) : null;
  if (measuredPlate) return { level: measuredPlate.level, evidence: measuredPlate };
  const heights = [];
  for (const [x, z] of ring) {
    const h = probe(x, z);
    if (Number.isFinite(h)) heights.push(h);
  }
  if (heights.length < SIMULATOR_LEVEL.minimumPoints) return { level, evidence: null };
  heights.sort((a, b) => a - b);
  const measured = Math.round((heights[Math.floor(heights.length * SIMULATOR_LEVEL.percentile)] + SIMULATOR_LEVEL.clearanceMetres) * 100) / 100;
  return { level: heights.length >= ring.length * SIMULATOR_LEVEL.coverage ? measured : Math.max(level, measured), evidence: null };
}

/* The played ground and 180 m round it: main.js's `near` for a lake's lattice. */
export function nearPlay(holes) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const hole of holes) for (const [x, z] of hole.line) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return (x, z) => x > x0 - 180 && x < x1 + 180 && z > z0 - 180 && z < z1 + 180;
}

/* How far past the water the ground picture's soft 8 m water is taken off the bank:
   a flat cell can stand half a cell past the shore and its filtering runs a cell
   further. */
export const SHORE_BANK_METRES = 16;

/* The two pictures a reach leaves the map: the wet nodes, and the dry bank beside
   them, on the reach's own lattice, cut to the nodes that say anything and one more. */
export function shoreMasks(reach, bankMetres = SHORE_BANK_METRES) {
  const { cols, rows, cell, wet, kind } = reach;
  const toWet = squaredDistanceTransform(cols, rows, i => wet[i] === 1);
  const reach2 = (bankMetres / cell) ** 2;
  const bank = new Uint8Array(cols * rows);
  let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
  for (let i = 0; i < cols * rows; i++) {
    /* only ground the reach sampled and found above its water */
    if (!wet[i] && kind[i] === 1 && toWet[i] <= reach2) bank[i] = 1;
    if (!wet[i] && !bank[i]) continue;
    const c = i % cols, r = (i - c) / cols;
    c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
  }
  if (c1 < 0) return null;
  c0 = Math.max(0, c0 - 1); r0 = Math.max(0, r0 - 1); c1 = Math.min(cols - 1, c1 + 1); r1 = Math.min(rows - 1, r1 + 1);
  const width = c1 - c0 + 1, height = r1 - r0 + 1;
  const cut = source => {
    const out = new Uint8Array(width * height);
    for (let r = 0; r < height; r++) out.set(source.subarray((r0 + r) * cols + c0, (r0 + r) * cols + c0 + width), r * width);
    return out;
  };
  return { x0: reach.x0 + c0 * cell, z0: reach.z0 + r0 * cell, cell, cols: width, rows: height, wet: cut(wet), bank: cut(bank) };
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Every lake on a ground that the simulator reaches, for each layout on it.
 * `layouts`: [{ slug, vectors, geo, review }] where `review` is the layout's scenery
 * water review (Johannesberg's), or null. `probe(x, z)` is the ground's height in the
 * pack's frame and datum. Identical results on two layouts are kept once.
 */
export function bakeShores({ layouts, probe }) {
  const lakes = new Map();
  for (const { slug, vectors, geo, review = null } of layouts) {
    const infra = vectors.infra ?? {};
    if (infra.terrainPlacement === 'measured-only') continue;
    /* the boot's model: a reviewed pond takes its exact shore and is not reached */
    const model = { water: (vectors.water ?? []).map(water => ({ ...water })) };
    review?.applyWaterSourceReview?.(model, geo);
    const near = nearPlay(vectors.holes ?? []);
    for (const water of model.water) {
      if (water.stream || !(water.ring?.length >= 3)) continue;
      if (review?.reviewedWaterLevel?.(water, probe, review.datum)) water.exactShore = true;
      if (!reachableInSimulator(water, infra)) continue;
      /* main.js's one level rule (engine/water-level.mjs), and its older rules where that cannot read the ground */
      const shore = shoreLevel({ ring: water.ring, heightAt: probe, near });
      const { level, evidence } = shore ? { level: shore.level, evidence: shore }
        : simulatorLevel({ ring: water.ring, level: water.level, probe, plate: LASER_PLATE_COURSES.has(slug) });
      const surface = evidence?.shoreMetres ?? evidence?.surfaceMetres ?? laserPlateLevel(water.ring, probe)?.surfaceMetres ?? NaN;
      const reach = waterReach({ ring: water.ring, level, surface, heightAt: probe, near });
      if (!reach) continue;
      const masks = shoreMasks(reach);
      if (!masks) continue;
      const key = [water.ring.length, ...water.ring[0], masks.cell, masks.x0, masks.z0, masks.cols, masks.rows, digest(masks.wet), digest(masks.bank)].join();
      const known = lakes.get(key);
      if (known) { known.layouts.push(slug); continue; }
      lakes.set(key, {
        layouts: [slug], points: water.ring.length, first: water.ring[0],
        level: round(level, 3), surface: Number.isFinite(surface) ? round(surface, 3) : null,
        outsideWetSquareMetres: reach.stats.outsideWetSquareMetres, ...masks,
      });
    }
  }
  return [...lakes.values()];
}

/* Every lake's two pictures on one sheet, in shelves, two transparent pixels apart so
   no filtered edge borrows a neighbour's. */
export function packShores(lakes, { pad = 2, width = 1024 } = {}) {
  const sprites = lakes.flatMap(lake => [{ lake, which: 'wet' }, { lake, which: 'bank' }]);
  const sheetWidth = Math.max(width, ...sprites.map(({ lake }) => lake.cols + pad * 2));
  sprites.sort((a, b) => b.lake.rows - a.lake.rows || b.lake.cols - a.lake.cols);
  let x = 0, y = 0, shelf = 0;
  for (const sprite of sprites) {
    const w = sprite.lake.cols + pad * 2, h = sprite.lake.rows + pad * 2;
    if (x + w > sheetWidth) { x = 0; y += shelf; shelf = 0; }
    sprite.at = [x + pad, y + pad];
    x += w; shelf = Math.max(shelf, h);
  }
  const height = Math.max(1, y + shelf);
  const values = new Uint8Array(sheetWidth * height);
  for (const { lake, which, at: [u, v] } of sprites) {
    const source = lake[which];
    for (let r = 0; r < lake.rows; r++) values.set(source.subarray(r * lake.cols, (r + 1) * lake.cols), (v + r) * sheetWidth + u);
  }
  const placed = new Map();
  for (const { lake, which, at } of sprites) placed.set(lake, { ...placed.get(lake), [which]: at });
  return {
    width: sheetWidth,
    height,
    values,
    lakes: lakes.map(lake => {
      const { wet, bank, ...rest } = lake;
      return { ...rest, wet: placed.get(lake).wet, bank: placed.get(lake).bank };
    }),
  };
}
