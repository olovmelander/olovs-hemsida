#!/usr/bin/env node
/* Trace Mälaren's shore off the published laser ground -> laser-water.json.

   The rings this writes are what reconcile folds into the model in place of
   OSM's one clipped bay ring; the lake mask itself is recomputed by
   build-heightfields (same code, same tiles) to sink the bed. The evidence
   here says what was accepted as lake, what was refused, and how many islands
   each ring encloses and what was done about them.

     node angsobuild/build-laser-water.mjs                                    */
import fs from 'node:fs';
import path from 'node:path';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { createPublishedGroundLookup, openPublishedGround } from '../packages/course-v2/published-ground-lookup.mjs';
import { writeJSON } from './lib.mjs';
import { HERE, PUBLIC, GROUND_ID, LEGACY_FRAME, LEGACY_ORIGIN_EPSG3006, HF1_HALF_SPAN } from './lib-v2.mjs';
import { detectMalaren, detectReeds, traceShore, MALAREN_REGULATED_LEVEL, LEVEL_BAND, LARGE_HECTARES, SEAM_METRES } from './laser-water.mjs';

/* The HF0 box (the carved terrain) and the ring clip, which must stay clear of
   it so the clip edge's bench never lands inside the carved mesh. */
export const CARVED_BOX = { x0: -1500, x1: 1500, z0: -1600, z1: 1712 };
export const RING_CLIP = { x0: -2400, x1: 2400, z0: -2400, z1: 2600 };

const { ground, courseManifest, readAsset } = openPublishedGround(fs, path, PUBLIC, GROUND_ID);
const lookup = createPublishedGroundLookup(ground, readAsset);
const bridge = legacyGridBridge(LEGACY_FRAME);
const sampleAt = (x, z) => {
  const [gx, gz] = bridge.toGrid(x, z);
  return lookup.heightAt(LEGACY_ORIGIN_EPSG3006.easting + gx, LEGACY_ORIGIN_EPSG3006.northing - gz);
};
const t0 = Date.now();
const lake = detectMalaren({ sampleAt, half: HF1_HALF_SPAN, courseBox: CARVED_BOX, log: console.log });
const rings = traceShore(lake, { clip: RING_CLIP, tolerance: 2, keyholeHectares: 1, forbidKeyholeBox: CARVED_BOX, log: console.log });
/* the reed belt is only traced where the carved terrain can paint it */
const reedMask = detectReeds(lake);
const reeds = traceShore(lake, { clip: CARVED_BOX, tolerance: 2, keyholeHectares: Infinity, mask: reedMask.mask, label: 'reeds', log: console.log })
  .filter(r => r.area >= 2000);
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);

const out = {
  source: {
    product: 'Lantmäteriet Markhöjdmodell 1 m via the published Ängsö ring graph; laser-flat water at the regulated Mälaren level',
    groundManifest: courseManifest.groundManifest.url,
    groundManifestSha256: courseManifest.groundManifest.sha256,
    rule: `flat to 0.03 m between 4 m neighbours, within ${LEVEL_BAND} m of ${MALAREN_REGULATED_LEVEL} m, and either >= ${LARGE_HECTARES} ha or within ${SEAM_METRES} m of such a component; rings traced inside x ${RING_CLIP.x0}..${RING_CLIP.x1} z ${RING_CLIP.z0}..${RING_CLIP.z1}, simplified at 2 m`,
  },
  level: Math.round(lake.level * 100) / 100,
  spread: Math.round(lake.spread * 1000) / 1000,
  windowCells: lake.windowCells,
  hectaresInRoot: Math.round(lake.components.reduce((s, c) => s + c.hectares, 0)),
  components: lake.components.map(c => ({ hectares: c.hectares, surfaceHeight: +c.surfaceHeight.toFixed(3), bounds: c.bounds })),
  rejected: lake.rejected.map(c => ({ hectares: c.hectares, surfaceHeight: +c.surfaceHeight.toFixed(3), bounds: c.bounds })),
  rings: rings.map((r, i) => ({ id: `malaren-${i + 1}`, area: Math.round(r.area), points: r.ring.length, islands: r.islands, ring: r.ring })),
  reeds: {
    rule: `shore ground within 0.9 m above the level and 120 m of open water, not itself flat; belts under 0.2 ha dropped; traced inside the carved box x ${CARVED_BOX.x0}..${CARVED_BOX.x1} z ${CARVED_BOX.z0}..${CARVED_BOX.z1}`,
    hectaresInRoot: reedMask.hectares,
    rings: reeds.map((r, i) => ({ id: `vass-${i + 1}`, area: Math.round(r.area), points: r.ring.length, ring: r.ring })),
  },
};
console.log(`reeds: ${out.reeds.rings.length} belts, ${(out.reeds.rings.reduce((s, r) => s + r.area, 0) / 1e4).toFixed(1)} ha, ${out.reeds.rings.reduce((s, r) => s + r.points, 0)} points`);
writeJSON(path.join(HERE, 'laser-water.json'), out);
for (const r of out.rings) console.log(`  ${r.id}: ${(r.area / 1e4).toFixed(1)} ha, ${r.points} points, islands ${JSON.stringify(r.islands)}`);
console.log(`wrote angsobuild/laser-water.json`);
