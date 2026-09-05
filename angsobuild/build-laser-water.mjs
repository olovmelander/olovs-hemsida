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
import { writeJSON, readJSON, bbox, pointInPoly } from './lib.mjs';
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
/* OSM landuse drawn over the lake or the reeds: the farmland south of the
   2nd runs to the open water, and the page paints a field's crop tone AFTER
   the wetland tint, so the reed belt rendered as ploughed soil. A ring that
   loses ground to the laser water is re-traced without it. */
const osm = readJSON(path.join(HERE, 'osm-features.json'));
const { width, height, spacing, x0: rx0, z0: rz0 } = lake.raster;
const landuse = [];
for (const feature of (osm.landuse || [])) {
  const box = bbox(feature.ring);
  if (box.x1 < CARVED_BOX.x0 || box.x0 > CARVED_BOX.x1 || box.z1 < CARVED_BOX.z0 || box.z0 > CARVED_BOX.z1) continue;
  const mask = new Uint8Array(width * height);
  let cells = 0, removed = 0;
  for (let r = Math.max(0, Math.floor((box.z0 - rz0) / spacing)); r <= Math.min(height - 1, Math.ceil((box.z1 - rz0) / spacing)); r++) {
    for (let c = Math.max(0, Math.floor((box.x0 - rx0) / spacing)); c <= Math.min(width - 1, Math.ceil((box.x1 - rx0) / spacing)); c++) {
      if (!pointInPoly(rx0 + c * spacing, rz0 + r * spacing, feature.ring)) continue;
      cells++;
      const i = r * width + c;
      if (lake.mask[i] || reedMask.mask[i]) { removed++; continue; }
      mask[i] = 1;
    }
  }
  if (cells < 25 || removed / cells < 0.03) continue;
  const pieces = traceShore(lake, { clip: { x0: box.x0 - 8, x1: box.x1 + 8, z0: box.z0 - 8, z1: box.z1 + 8 }, tolerance: 2, keyholeHectares: Infinity, mask, label: `${feature.kind} ${feature.id}` })
    .filter(p => p.area >= 1000);
  landuse.push({ id: feature.id, kind: feature.kind, removedFraction: +(removed / cells).toFixed(3), rings: pieces.map(p => p.ring) });
  console.log(`  ${feature.kind} ${feature.id}: ${(removed / cells * 100).toFixed(0)}% under the lake or the reeds -> ${pieces.length} piece(s)`);
}
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
  landuse: { rule: 'an OSM landuse ring with at least 3% of its cells under the laser lake or the reed belt is re-traced without them', rings: landuse },
};
console.log(`reeds: ${out.reeds.rings.length} belts, ${(out.reeds.rings.reduce((s, r) => s + r.area, 0) / 1e4).toFixed(1)} ha, ${out.reeds.rings.reduce((s, r) => s + r.points, 0)} points`);
writeJSON(path.join(HERE, 'laser-water.json'), out);
for (const r of out.rings) console.log(`  ${r.id}: ${(r.area / 1e4).toFixed(1)} ha, ${r.points} points, islands ${JSON.stringify(r.islands)}`);
console.log(`wrote angsobuild/laser-water.json`);
