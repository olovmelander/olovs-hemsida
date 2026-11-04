/* The shadows hills throw. Pure.

   A low sun's best work is a ridge laying its shade across the valley behind it,
   and light that only turns with the slope cannot do that: it needs to know what
   stands between a point and the sun. So each tile keeps a small picture of it,
   walked out toward the sun from a coarse grid of points. It is reckoned once per
   tile for each sun, so a high sun pays nothing and a still map pays nothing, and
   the steps grow with the distance, because a hill far off casts a soft edge. */
export const SHADE_SIZE = 33;
/* Above this height the sun has no shadow worth a walk: about 30 degrees. */
export const SHADE_BELOW_SUN = 0.5;
const STEPS = 24, GROWTH = 1.22, FIRST_STEP_METRES = 6, SOFT_EDGE_METRES = 2.5;

/* Swedish courses are gentle: under a true evening sun their slopes throw almost
   nothing, which measured at about 1% of the picture, on three courses. The map
   already draws its relief taller than life for the sake of reading it, and its
   shadows go further the same way. Nothing a golfer measures reads this. */
export const SHADOW_REACH = 2.6;
const LOWEST_CLIMB = 0.2;

export const shadeKey = (sun, exaggeration) => `${sun.map(n => n.toFixed(2)).join(',')}|${exaggeration}`;

/* 255 is in the sun, 0 is deep in a hill's shade. `ceiling` is the highest ground
   anywhere as drawn: a ray above it can stop looking. */
export function bakeHillShade({ node, sun, heightAt, exaggeration, ceiling }) {
  const out = new Uint8Array(SHADE_SIZE * SHADE_SIZE).fill(255);
  const across = Math.hypot(sun[0], sun[2]);
  if (!(across > 0)) return out;
  /* A dawn sun would put the whole course in shade, and a map that dark shows
     nothing: shadows are cast as if it stood no lower than an evening sun. */
  const dx = sun[0] / across, dz = sun[2] / across, climb = Math.max(sun[1] / across, LOWEST_CLIMB);
  const first = Math.max(FIRST_STEP_METRES, node.spacing * 4);
  const tall = exaggeration * SHADOW_REACH, top = ceiling * SHADOW_REACH;
  for (let j = 0; j < SHADE_SIZE; j++) for (let i = 0; i < SHADE_SIZE; i++) {
    const x = node.x0 + i / (SHADE_SIZE - 1) * node.size, z = node.z0 + j / (SHADE_SIZE - 1) * node.size;
    const ground = heightAt(x, z);
    if (!Number.isFinite(ground)) continue;
    const start = ground * tall + 0.4;
    let step = first, along = first, over = 0;
    for (let k = 0; k < STEPS; k++) {
      const ray = start + along * climb;
      if (ray > top) break;
      const height = heightAt(x + dx * along, z + dz * along);
      if (Number.isFinite(height)) over = Math.max(over, height * tall - ray);
      step *= GROWTH;
      along += step;
    }
    const t = Math.min(over / (SOFT_EDGE_METRES * tall), 1);
    out[j * SHADE_SIZE + i] = Math.round(255 * (1 - t * t * (3 - 2 * t)));
  }
  return out;
}
