/* Buildings in 3D, raised from their mapped footprints. Pure.

   Walls stand straight up from the footprint and a small roof rises to its middle.
   Swedish buildings in a Swedish palette: falu red, pale render and yellow timber
   under dark roofs. A tile's houses share one buffer. */
/* x, height above its ground, z, ground, normal, colour, and which foot it takes:
   0 a house raised from its footprint, 1 a club's own modelled building (map-gl.mjs). */
export const HOUSE_FLOATS = 11;
const DEFAULT_HEIGHT = 5.4;

/* A wall's foot, by the detailed course's rule (engine/building-paint.mjs BUILDING_PAINT:
   `batch` for a house raised from its footprint, `model` for a modelled building, and the
   steepness through which it fades out on a roof). That module brings three.js; a test
   holds these equal. ?wallfoot=0 is the walls lit evenly to the ground. */
export const MAP_WALL_FOOT = Object.freeze({
  house: Object.freeze({ floor: 0.72, metres: 0.9 }),
  model: Object.freeze({ floor: 0.84, metres: 0.55 }),
  steep: Object.freeze([0.5, 0.8]),
});
export const EVEN_WALLS = Object.freeze({ house: { floor: 1, metres: 1 }, model: { floor: 1, metres: 1 }, steep: [0.5, 0.8] });

const WALLS = [[0.56, 0.17, 0.14], [0.86, 0.82, 0.72], [0.82, 0.73, 0.5], [0.55, 0.2, 0.16], [0.78, 0.76, 0.72]];
const ROOFS = [[0.22, 0.23, 0.25], [0.3, 0.27, 0.26], [0.36, 0.2, 0.17], [0.27, 0.3, 0.32]];

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    area += ax * bz - bx * az;
  }
  return area / 2;
}

export function raiseHouses(structures, heightAt) {
  const out = [];
  const add = (x, up, z, ground, normal, colour) => out.push(x, up, z, ground, ...normal, ...colour, 0);
  structures.forEach(({ ring: source, height, roof: measured }, index) => {
    const ring = source.at(0)[0] === source.at(-1)[0] && source.at(0)[1] === source.at(-1)[1] ? source.slice(0, -1) : source;
    if (ring.length < 3) return;
    const levels = ring.map(([x, z]) => heightAt(x, z)).filter(Number.isFinite);
    if (!levels.length) return;
    /* On its lowest corner, so no wall hangs in the air on a slope. */
    const ground = Math.min(...levels);
    const area = Math.abs(signedArea(ring));
    const eaves = Math.max(2.6, height ?? DEFAULT_HEIGHT);
    const across = Math.sqrt(area);
    const roof = Math.min(0.42 * across, 4.5);
    const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    const cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    /* the roof the orthophoto shows, where the detailed course has one (map-roof-colours.mjs) */
    const wall = WALLS[index % WALLS.length], top = measured ?? ROOFS[index % ROOFS.length];
    const pad = 1 - Math.min(0.08, 0.6 / Math.max(across, 1));
    const flip = signedArea(ring) > 0 ? 1 : -1;

    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz) || 1;
      const normal = [(dz / length) * flip, 0, (-dx / length) * flip];
      add(ax, 0, az, ground, normal, wall); add(bx, 0, bz, ground, normal, wall); add(ax, eaves, az, ground, normal, wall);
      add(bx, 0, bz, ground, normal, wall); add(bx, eaves, bz, ground, normal, wall); add(ax, eaves, az, ground, normal, wall);

      /* A low pyramid over the eaves; on a long house it reads as a hip. */
      const ox = (ax - cx) / pad + cx, oz = (az - cz) / pad + cz, px = (bx - cx) / pad + cx, pz = (bz - cz) / pad + cz;
      const rise = roof, run = Math.max(Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz), 0.5);
      const tilt = Math.hypot(rise, run);
      const slope = [normal[0] * rise / tilt, run / tilt, normal[2] * rise / tilt];
      add(ox, eaves, oz, ground, slope, top); add(px, eaves, pz, ground, slope, top); add(cx, eaves + roof, cz, ground, slope, top);
    }
  });
  return new Float32Array(out);
}
