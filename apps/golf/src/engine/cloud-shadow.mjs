/* CLOUD SHADOWS. Broad, soft shadows of fair-weather clouds cross the course
   with the wind (one-wind.mjs), in every preset with a sun to cast them: noon,
   golden hour, dawn, the midnight sun and autumn. Overcast, mist and blue hour
   have none.

   The shade is the sun's, taken away where a cloud stands between it and the
   ground, so it reaches everything the sun lights:
   - every lit surface through the sun's own colour, and every shadow receiver
     through its shadow node, which keeps the tree shadows' sky-lit tint: a
     cloud's shade is lit by the sky just as a tree's is, and a tree's shadow
     fades into it (shadow-tint.mjs sunUnderClouds);
   - the painted crowns and impostors, far vista included, through their
     direct light (ghibli-foliage-material.mjs);
   - the water's sun sparkle, and the light that shines through reeds, tufts
     and flags.
   The pattern is one small tiling texture of soft cloud shapes, 4 km a tile,
   read where the ray toward the sun meets the cloud layer: a crown's sample is
   the ground's beside it, moved along the sun as far as the crown stands up.
   It is read once per vertex -- the shapes are hundreds of metres across -- so
   nothing is added per pixel but on the water, and the shadow map and its
   on-demand renders are untouched: moving clouds render nothing again. */
import { DataTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType, Vector2 } from 'three/webgpu';
import { float, positionWorld, renderGroup, smoothstep, texture, uniform } from 'three/tsl';

export const CLOUD_SHADOW = Object.freeze({
  /* texels a side and metres a tile: 16 m a texel, repeating every 4 km */
  size: 256, tileMetres: 4096,
  /* value-noise octaves: [cells across the tile, weight]; the broadest makes clouds about 700 m apart */
  octaves: [[6, 1], [12, 0.5], [24, 0.25], [48, 0.125]],
  /* the shadow's edge, half its width in the pattern's 0..1 units: about 50 m on the ground */
  softness: 0.045,
  /* a sun lower than this (the sine of its height) is taken at this height, so the
     pattern's shift up a slope stays bounded near the horizon */
  sunFloor: 0.12,
});

const smooth = t => t * t * (3 - 2 * t);
/* a small integer hash to 0..1, the same on every machine */
function hash(i, j, salt) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The cloud pattern, size x size bytes: tiling value noise over the octaves,
    stretched to the full byte range. Deterministic. */
export function cloudPattern(size = CLOUD_SHADOW.size) {
  const sum = new Float64Array(size * size);
  for (const [cells, weight] of CLOUD_SHADOW.octaves) {
    const lattice = new Float64Array(cells * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lattice[j * cells + i] = hash(i, j, cells);
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) / size * cells, j0 = Math.floor(v), fv = smooth(v - j0), j1 = (j0 + 1) % cells;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size * cells, i0 = Math.floor(u), fu = smooth(u - i0), i1 = (i0 + 1) % cells;
        const a = lattice[j0 * cells + i0], b = lattice[j0 * cells + i1], c = lattice[j1 * cells + i0], d = lattice[j1 * cells + i1];
        sum[y * size + x] += weight * ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv);
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of sum) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const bytes = new Uint8Array(size * size);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.round((sum[k] - lo) / (hi - lo) * 255);
  return bytes;
}

/** The pattern value (0..1) above which `cover` of the ground lies: between two byte levels. */
export function coverThreshold(bytes, cover) {
  if (!(cover > 0)) return 2;
  const sorted = Uint8Array.from(bytes).sort();
  const k = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * (1 - cover))));
  return (sorted[k] - 0.5) / 255;
}

/** How much of the sun a cloud of the pattern leaves at pattern value v (0..1): 1 in the clear. */
export function cloudSunlight(v, threshold, opacity) {
  const e = CLOUD_SHADOW.softness, t = Math.min(1, Math.max(0, (v - (threshold - e)) / (2 * e)));
  return 1 - smooth(t) * opacity;
}

/** A preset's cloud shadows: `cloudShadow: { cover, opacity }` in its painted atmosphere, none without. */
export function cloudShadowOf(preset) {
  const c = preset?.cloudShadow;
  const cover = Math.min(0.9, Math.max(0, c?.cover ?? 0)), opacity = Math.min(0.9, Math.max(0, c?.opacity ?? 0));
  return cover > 0 && opacity > 0 ? { cover, opacity } : { cover: 0, opacity: 0 };
}

/* One copy of the pattern, shared: the water's calm and gusty patches read it
   too, at their own scale (nordic-water.mjs). Uploaded as it is: a single-channel
   byte texture, tiling, filtered, no mips (the clouds read it at level 0). */
let shared = null;
export function cloudPatternTexture() {
  if (shared) return shared;
  const { size } = CLOUD_SHADOW;
  const bytes = cloudPattern(size);
  const map = new DataTexture(bytes, size, size, RedFormat, UnsignedByteType);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.magFilter = map.minFilter = LinearFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return (shared = { bytes, map });
}

export function createCloudShadow() {
  const { tileMetres, softness, sunFloor } = CLOUD_SHADOW;
  const { bytes, map } = cloudPatternTexture();
  const offset = uniform(new Vector2(0, 0)).setGroup(renderGroup);
  const threshold = uniform(2).setGroup(renderGroup), opacity = uniform(0).setGroup(renderGroup);
  /* how far the pattern moves per metre of height, along the sun: the sun's ground direction over its height */
  const slope = uniform(new Vector2(0, 0)).setGroup(renderGroup);
  /** The share of the sun reaching `position` (world, vec3) past the clouds: 1 in the clear. */
  const sunlightAt = position => {
    const q = position.xz.sub(slope.mul(position.y)).sub(offset).div(tileMetres);
    const v = texture(map, q).level(0).r;
    return float(1).sub(smoothstep(threshold.sub(softness), threshold.add(softness), v).mul(opacity));
  };
  const state = { cover: 0, opacity: 0 };
  return {
    map, bytes, offset, threshold, opacity, slope, sunlightAt,
    /* per vertex, shared by every material that takes it */
    vertex: sunlightAt(positionWorld).toVertexStage(),
    period: tileMetres,
    setPreset(preset) {
      const c = cloudShadowOf(preset);
      Object.assign(state, c);
      opacity.value = c.opacity;
      threshold.value = coverThreshold(bytes, c.cover);
    },
    /** `direction` toward the sun (x, y, z), unit */
    setSun(direction) {
      const up = Math.max(direction.y, sunFloor);
      slope.value.set(direction.x / up, direction.z / up);
    },
    setOffset(x, z) { offset.value.set(x, z); },
    snapshot: () => ({ ...state, threshold: threshold.value, offset: offset.value.toArray(), slope: slope.value.toArray() }),
  };
}
