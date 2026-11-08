import { laserPlateLevel, PLATE_DISPLAY_CLEARANCE_METRES } from './water-plate-level.mjs';
import { waterReach } from './water-reach.mjs';

/* ONE WAY TO STAND A LAKE, A POND OR A WATERHOLE AT ITS LEVEL (8 November, owner
   request: "we need one solid way to place the water correctly on the golf courses";
   Upsala's first ponds by the 1st felt too low).

   Before this, four rules set a water body's level depending on the course: the 30th
   percentile of the ground under its traced outline plus a quarter metre, the laser's
   own flat surface (Puttom), reviewed interior controls (Johannesberg's ponds) and the
   measured polygons (the measured-only grounds). The first lifted most water about
   18 cm above the level its own outline bears out, and the reach that capped it at
   the laser's surface left ponds whose water the laser caught low a metre down their
   banks, inside their own outlines (Upsala's first pond: laser 20.78 m, outline ground
   20.91 m, bank 21.89 m).

   The evidence is two things, and they are kept apart:
   - the traced outline is where the water stands on the summer aerials it was traced
     from;
   - the laser's ground is the shape of the basin, and inside it the water's surface on
     the day it was flown.
   So the shore is the level at which the water, rising over the laser's ground from
   the outline's inside, covers the outline best (water-reach.mjs fitShoreLevel). It
   never stands below the laser's own surface, and a large flat lake the laser measured
   whole stays within `largeLakeRiseMetres` of it: there the measured surface is the
   better evidence of the two (Puttom's lakes, owner request, 7 November). An outline
   the ground does not bear out (it misses the basin: overlap under
   `minimumOverlap`) stands at its own outline's ground instead. The sheet stands the
   measured-water display clearance above the shore, and the reach floods to it.

   Johannesberg's reviewed ponds, the sea and the measured-only grounds keep their own
   measured levels: they are not read here. */
export const WATER_LEVEL = Object.freeze({
  largeLakeSquareMetres: 10000,
  largeLakePlateFraction: 0.9,
  largeLakeRiseMetres: 0.1,
  rangeMetres: 1.5,
  minimumOverlap: 0.6,
  outlinePercentile: 0.3,
});

const area = ring => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a / 2);
};

/**
 * The level of the water a traced outline holds over the laser's ground. `heightAt`
 * is the uncarved ground (a number or { height }); `near(x, z)` says whether the
 * water is beside the played ground (the finer lattice). Returns
 * { level, shoreMetres, surfaceMetres, overlap, method } or null when the ground
 * cannot be read there.
 */
export function shoreLevel({ ring, heightAt, near = () => true, options = {} }) {
  const o = { ...WATER_LEVEL, ...options };
  const height = (x, z) => { const p = heightAt(x, z); return Number.isFinite(p) ? p : p?.height; };
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const plate = laserPlateLevel(ring, height);
  const large = !!plate && area(ring) >= o.largeLakeSquareMetres && plate.plateFraction >= o.largeLakePlateFraction;
  const reach = waterReach({ ring, heightAt: height, near, surface: plate?.surfaceMetres ?? NaN, fit: true,
    options: { fitRangeMetres: large ? o.largeLakeRiseMetres : o.rangeMetres } });
  const fitted = reach?.fitted;
  if (!fitted) return null;
  const evidence = { surfaceMetres: plate?.surfaceMetres ?? null, plateFraction: plate?.plateFraction ?? null, overlap: fitted.overlap, large };
  if (fitted.overlap >= o.minimumOverlap) {
    return Object.freeze({ ...evidence, level: fitted.level, shoreMetres: fitted.shore, method: 'shore-fit' });
  }
  /* the outline misses the basin the laser saw: stand it at its own ground, never below
     the water the laser measured */
  const heights = [];
  for (const [x, z] of ring) { const h = height(x, z); if (Number.isFinite(h)) heights.push(h); }
  if (!heights.length) return Object.freeze({ ...evidence, level: fitted.level, shoreMetres: fitted.shore, method: 'shore-fit' });
  heights.sort((a, b) => a - b);
  const outline = heights[Math.floor(heights.length * o.outlinePercentile)];
  const shore = Math.max(outline, plate?.surfaceMetres ?? -Infinity);
  return Object.freeze({ ...evidence, level: Math.round((shore + PLATE_DISPLAY_CLEARANCE_METRES) * 100) / 100,
    shoreMetres: Math.round(shore * 1000) / 1000, method: 'outline-ground' });
}
