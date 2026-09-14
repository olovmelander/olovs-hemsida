import { ringSDIndexed } from './ring-index.mjs';

/** Refine explicitly reviewed pond beds without enlarging the 16 km raster.
 * The broad field remains responsible for other lakes. Within a mapped pond
 * and the coarse interpolation margin around it, its exact polygon owns the
 * bed. Dry banks have zero depth, including narrow causeways the 8 m raster
 * cannot represent. Depth is illustrative; the source DTM has no bathymetry.
 *
 * Wrap both freshly built and restored fields. The prepared payload retains
 * its arrays; post-measurement knownBodies pins these flags, rings and levels.
 * All CPU and GPU terrain decodes then consume the same bounded function. */
export function refineMappedWaterBeds(field, knownBodies, toGrid) {
  const bodies = knownBodies.filter(w => w.exactShore === true).map(w => {
    if (!Number.isFinite(w.level) || !Array.isArray(w.ring) || w.ring.length < 3) {
      throw new TypeError('a refined water bed needs a finite level and mapped ring');
    }
    const ring = w.ring.map(p => toGrid(...p));
    const holes = (w.holes ?? []).map(r => r.map(p => toGrid(...p)));
    return { ring, holes, level: w.level,
      x0: Math.min(...ring.map(p => p[0])), x1: Math.max(...ring.map(p => p[0])),
      z0: Math.min(...ring.map(p => p[1])), z1: Math.max(...ring.map(p => p[1])) };
  });
  if (!bodies.length) return field;
  // A bilinear cell-centre field can influence a point up to 1.5 cells from
  // the polygon. Own the full margin, so none of that depth cuts dry ground.
  const margin = field.spacing * 1.5;
  const cutoff = Math.max(margin, (field.maximumDepthMetres - field.shoreDepthMetres) / field.depthPerMetre);
  let lastX = NaN, lastZ = NaN, last = null;
  const sample = (x, z) => {
    if (x === lastX && z === lastZ) return last;
    lastX = x; lastZ = z; last = null;
    let controlled = false;
    for (const body of bodies) {
      if (x < body.x0 - margin || x > body.x1 + margin || z < body.z0 - margin || z > body.z1 + margin) continue;
      let sd = ringSDIndexed(x, z, body.ring, cutoff);
      // An island inside this footprint belongs to its exclusion even when
      // its centre is farther than the coarse margin from the island shore.
      if (sd <= 0) controlled = true;
      for (const hole of body.holes) sd = Math.max(sd, -ringSDIndexed(x, z, hole, cutoff));
      if (sd > margin) continue;
      controlled = true;
      if (sd <= 0) {
        last = { wet: true, level: body.level,
          depth: Math.min(field.maximumDepthMetres, field.shoreDepthMetres + field.depthPerMetre * -sd) };
        return last;
      }
    }
    if (controlled) last = { wet: false, depth: 0, level: NaN };
    return last;
  };
  return Object.freeze({ ...field,
    refinedBodies: bodies.length,
    inWater(x, z) { const s = sample(x, z); return s ? s.wet : field.inWater(x, z); },
    nearWater(x, z) { const s = sample(x, z); return s ? s.wet : field.nearWater(x, z); },
    depthAt(x, z) { const s = sample(x, z); return s ? s.depth : field.depthAt(x, z); },
    levelAt(x, z) { const s = sample(x, z); return s ? s.level : field.levelAt(x, z); },
  });
}
