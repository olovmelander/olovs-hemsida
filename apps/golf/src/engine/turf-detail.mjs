/* THE TURF, CLOSE UP (3 November, owner request: "the grass like EA Sports PGA
   Tour 2K25"). The ground's detail texture is clumps and blotches a metre
   across; from a tee or at a green there was nothing between them and the
   pixel, so a fairway read as a coloured sheet and a green as felt. This is the
   detail under that: a 512 x 512 texture made at load, tileable, mip-mapped
   (so it averages away to its mean with distance and cannot shimmer), one
   material in each channel, each about a mean of 128:

   - R  MOWN BLADES: short blades laid one way (along +u, within about 15
        degrees), a little darker at the root and lighter at the tip, as a cut
        lawn is seen from standing height; the ground lays it along each
        hole's own mowing so the grain runs with the stripes;
   - G  WILD BLADES: longer blades every way, in clumps, for the rough, the
        forest floor's moss and the heath;
   - B  GRAVEL: rounded pebbles packed with darker gaps, for paths and gravel
        (and, finer, the asphalt's aggregate);
   - A  SAND: fine grain with scattered darker and brighter grains.

   Each channel is the material's albedo variation about its mean AND its
   height, for the bump the ground reckons from it. Deterministic: the same
   bytes every boot (a seeded generator, no Math.random). */
import { DataTexture, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from 'three/webgpu';

export const TURF_DETAIL = Object.freeze({
  size: 512,
  /* blades a channel draws, and their length and width in texels */
  mown: Object.freeze({ count: 26000, length: Object.freeze([5, 15]), width: Object.freeze([0.8, 1.4]), spread: 0.26 }),
  wild: Object.freeze({ count: 15000, length: Object.freeze([8, 26]), width: Object.freeze([0.9, 1.6]) }),
  gravel: Object.freeze({ count: 11000, radius: Object.freeze([1.6, 5.2]) }),
  seed: 0x5eed7a,
});

/** mulberry32: a small seeded generator, [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* a soft splat of value v at (x, y), wrapped, blended over what is there by `a` */
function splat(plane, size, x, y, v, a) {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const xs = [x0, x0 + 1, x0, x0 + 1], ys = [y0, y0, y0 + 1, y0 + 1];
  for (let k = 0; k < 4; k++) {
    const px = ((xs[k] % size) + size) % size, py = ((ys[k] % size) + size) % size;
    const i = py * size + px, t = Math.min(1, w[k] * a * 1.6);
    plane[i] += (v - plane[i]) * t;
  }
}

/* one blade: from its root to its tip, `width` texels wide, darker at the root */
function blade(plane, size, rand, x, y, angle, length, width, value, bend = 0) {
  const steps = Math.ceil(length * 2);
  let a = angle, px = x, py = y;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const v = value * (0.55 + 0.45 * t);
    /* across the blade: its width in half-texel splats, its edges a little darker */
    const nx = -Math.sin(a), ny = Math.cos(a);
    const half = width * (1 - 0.6 * t) * 0.5;
    for (let o = -half; o <= half + 1e-6; o += 0.5) {
      const edge = half > 0 ? 1 - 0.25 * Math.abs(o) / half : 1;
      splat(plane, size, px + nx * o, py + ny * o, v * edge, 0.9);
    }
    px += Math.cos(a) * 0.5; py += Math.sin(a) * 0.5;
    a += bend / steps;
  }
}

/* a smooth periodic noise, for clumps under the wild blades */
function clumpField(size, rand, cells = 8) {
  const lattice = new Float32Array(cells * cells).map(() => rand());
  const out = new Float32Array(size * size);
  const at = (i, j) => lattice[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * cells, v = y / size * cells, i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    out[y * size + x] = (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  }
  return out;
}

/* normalise a plane to a mean of 128 and a given spread, into the RGBA bytes' channel */
function store(pixels, plane, channel, deviation) {
  let mean = 0;
  for (const v of plane) mean += v;
  mean /= plane.length;
  let variance = 0;
  for (const v of plane) variance += (v - mean) ** 2;
  const scale = deviation / Math.max(1e-6, Math.sqrt(variance / plane.length));
  for (let i = 0; i < plane.length; i++) pixels[i * 4 + channel] = Math.max(0, Math.min(255, Math.round(128 + (plane[i] - mean) * scale)));
}

/** Fills `pixels` (size x size x 4 bytes) with the four materials. */
export function fillTurfDetailPixels(pixels, size = TURF_DETAIL.size, { seed = TURF_DETAIL.seed } = {}) {
  const D = TURF_DETAIL, n = size * size;
  const rand = seededRandom(seed);
  const scale = size / D.size;

  /* R: mown blades, laid along +u */
  const mown = new Float32Array(n).fill(0.42);
  for (let k = 0; k < D.mown.count * scale * scale; k++) {
    const angle = (rand() - 0.5) * 2 * D.mown.spread;
    const length = (D.mown.length[0] + rand() * (D.mown.length[1] - D.mown.length[0])) * scale;
    const width = (D.mown.width[0] + rand() * (D.mown.width[1] - D.mown.width[0])) * scale;
    blade(mown, size, rand, rand() * size, rand() * size, angle, length, width, 0.3 + rand() * 0.7, (rand() - 0.5) * 0.3);
  }
  store(pixels, mown, 0, 34);

  /* G: wild blades, every way, thicker in clumps */
  const clumps = clumpField(size, rand, 6);
  const wild = new Float32Array(n);
  for (let i = 0; i < n; i++) wild[i] = 0.25 + 0.2 * clumps[i];
  for (let k = 0; k < D.wild.count * scale * scale; k++) {
    const x = rand() * size, y = rand() * size;
    const dense = clumps[Math.floor(y) * size + Math.floor(x)];
    if (rand() > 0.35 + 0.65 * dense) continue;
    const angle = rand() * Math.PI * 2;
    const length = (D.wild.length[0] + rand() * (D.wild.length[1] - D.wild.length[0])) * scale;
    const width = (D.wild.width[0] + rand() * (D.wild.width[1] - D.wild.width[0])) * scale;
    blade(wild, size, rand, x, y, angle, length, width, 0.35 + rand() * 0.65 * (0.6 + 0.4 * dense), (rand() - 0.5) * 0.9);
  }
  store(pixels, wild, 1, 38);

  /* B: gravel, pebbles packed on dark gaps, each domed (lighter at its crown) */
  const gravel = new Float32Array(n).fill(0.22);
  for (let k = 0; k < D.gravel.count * scale * scale; k++) {
    const cx = rand() * size, cy = rand() * size;
    const r = (D.gravel.radius[0] + rand() * (D.gravel.radius[1] - D.gravel.radius[0])) * scale;
    const tone = 0.45 + rand() * 0.5, squash = 0.7 + rand() * 0.3, turn = rand() * Math.PI;
    const c = Math.cos(turn), s = Math.sin(turn);
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * c + dy * s) / r, v = (-dx * s + dy * c) / (r * squash);
      const d2 = u * u + v * v;
      if (d2 > 1) continue;
      const dome = Math.sqrt(1 - d2);
      const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
      gravel[i] = tone * (0.55 + 0.45 * dome);
    }
  }
  store(pixels, gravel, 2, 40);

  /* A: sand, fine grain: white noise softened a texel, and a few darker and brighter grains */
  const noise = new Float32Array(n).map(() => rand());
  const sand = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (i, j) => noise[(((j % size) + size) % size) * size + (((i % size) + size) % size)];
    sand[y * size + x] = at(x, y) * 0.5 + (at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1)) * 0.125;
  }
  for (let k = 0; k < n * 0.02; k++) {
    const i = Math.floor(rand() * n);
    sand[i] = rand() < 0.5 ? 0.05 : 0.95;
  }
  store(pixels, sand, 3, 26);
  return pixels;
}

/** The texture: repeat-wrapped, mip-mapped and anisotropically filtered, uploaded as its bytes. */
export function createTurfDetailTexture({ size = TURF_DETAIL.size } = {}) {
  const pixels = new Uint8Array(size * size * 4);
  fillTurfDetailPixels(pixels, size);
  const texture = new DataTexture(pixels, size, size);
  texture.name = 'TurfDetail';
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}
