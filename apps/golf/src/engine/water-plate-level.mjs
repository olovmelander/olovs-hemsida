import { squaredDistanceTransform } from '../../../../packages/course-v2/distance-transform.mjs';

/* water-render-policy.mjs's MEASURED_WATER_CLEARANCE_METRES, held here so the map
   (no three.js) can read a lake's level the same way; the test keeps them equal */
export const PLATE_DISPLAY_CLEARANCE_METRES = 0.06;

/* The courses whose lakes stand at the laser's own surface (owner request for Puttom,
   7 November). puttombuild/laser-features.json records the surfaces this must agree
   with: Stor-Rossjon 62.73 m, Lill-Rossjon 60.89 m, Ovansjosjon 50.96 m, Trattjarnen
   49.81 m (legacy datum). The simulator (main.js) and the map read the same list.
   ?waterlevel=before is the ring-percentile rule with its quarter metre. */
export const LASER_PLATE_COURSES = Object.freeze(new Set(['puttom']));

/* A LAKE'S LEVEL IS ITS SURFACE, AS THE LASER MEASURED IT (7 November, owner
   request: Puttom's water "aligned with the real measurements").

   The boot rule re-measures a lake as the 30th percentile of the ground under
   its ring's own points, plus 0.25 m so the sheet clears the laser's flat lake
   surface it would otherwise lie on (main.js). A loose ring puts many of its
   points on the bank, and the clearance comes on top: Stor-Rossjon came out at
   62.98 m over a surface the laser reads at 62.73 m (8,551 samples, 2 cm
   spread; puttombuild/laser-features.json), so the water stood a quarter metre
   up its banks.

   Airborne laser does not enter water, so inside a lake the ground model IS the
   surface, flat to a few centimetres. Read it there: on a lattice inside the
   ring, clear of its banks, take the median, and accept it only where most of
   the samples sit at that one height -- a plate, not a field or a bank. The
   sheet stands the measured-water display clearance above it, as on the other
   measured grounds; the bed under it is carved (v2-water-bed.mjs,
   water-reach.mjs), so the two never meet. Returns null when the inside does
   not read as one surface; the caller keeps its own rule then. */

export const WATER_PLATE = Object.freeze({
  /* clear of the banks a loose ring puts inside it */
  edgeMetres: 6,
  spacingMetres: 4,
  maximumSamples: 6000,
  minimumSamples: 25,
  /* the plate: this share of the samples within this height of the median */
  levelToleranceMetres: 0.05,
  levelFractionMinimum: 0.6,
});

export function laserPlateLevel(ring, heightAt, options = {}) {
  const o = { ...WATER_PLATE, ...options };
  if (!Array.isArray(ring) || ring.length < 3 || typeof heightAt !== 'function') return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  let spacing = o.spacingMetres;
  /* the inside is at most the box: widen the lattice until the box fits the budget */
  while ((x1 - x0) * (z1 - z0) / (spacing * spacing) > o.maximumSamples * 4) spacing *= 1.5;
  /* the lattice's nodes inside the ring (an even-odd scanline fill), and their distance
     to the nearest node outside it: one pass each, where a ring query per node cost
     the boot a quarter second over a course's lakes */
  const cols = Math.max(1, Math.ceil((x1 - x0) / spacing)), rows = Math.max(1, Math.ceil((z1 - z0) / spacing));
  const inside = new Uint8Array(cols * rows);
  const xs = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 + (r + 0.5) * spacing;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z)) xs.push(xi + (z - zi) * (xj - xi) / (zj - zi));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / spacing - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - x0) / spacing - 0.5));
      for (let c = c0; c <= c1; c++) inside[r * cols + c] = 1;
    }
  }
  /* a node's distance to the outside, in nodes; the lattice's own edge counts as outside */
  const outside = squaredDistanceTransform(cols + 2, rows + 2, i => {
    const r = Math.floor(i / (cols + 2)) - 1, c = i % (cols + 2) - 1;
    return r < 0 || c < 0 || r >= rows || c >= cols || !inside[r * cols + c];
  });
  const edge2 = (o.edgeMetres / spacing) ** 2;
  const heights = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!inside[r * cols + c] || outside[(r + 1) * (cols + 2) + c + 1] <= edge2) continue;
    const probe = heightAt(x0 + (c + 0.5) * spacing, z0 + (r + 0.5) * spacing);
    const h = Number.isFinite(probe) ? probe : probe?.height;
    if (Number.isFinite(h)) heights.push(h);
  }
  if (heights.length < o.minimumSamples) return null;
  heights.sort((a, b) => a - b);
  const median = heights[heights.length >> 1];
  let level = 0;
  for (const h of heights) if (Math.abs(h - median) <= o.levelToleranceMetres) level++;
  const fraction = level / heights.length;
  if (fraction < o.levelFractionMinimum) return null;
  const clearance = o.clearanceMetres ?? PLATE_DISPLAY_CLEARANCE_METRES;
  return Object.freeze({
    level: Math.round((median + clearance) * 100) / 100,
    surfaceMetres: Math.round(median * 1000) / 1000,
    displayClearanceMetres: clearance,
    plateFraction: +fraction.toFixed(3),
    samples: heights.length,
    spreadMetres: +(heights[Math.floor(heights.length * 0.9)] - heights[Math.floor(heights.length * 0.1)]).toFixed(3),
    method: 'laser-plate-median',
  });
}
