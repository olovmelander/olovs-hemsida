import { fbm, hash2 } from './geom.js';

/* THE WATER'S RIPPLE MAP (WATERN): a height field of two anisotropic noise
   layers, its normals by central difference, sampled by the water four times at
   periods from 4 to 71 m (main.js makeWater). It repeats, so it must close: the
   lattice it was drawn on (0.028 x 0.043 and 0.11 x 0.09 cells a pixel, 2.03 an
   octave) closed nowhere across the 512 px, and every repeat of every layer drew
   a straight seam through the ripples. Seamless, each octave keeps a whole number
   of cells across the texture in both axes -- the nearest to the old count, so
   the ripples keep their size and grain -- and the differences wrap. `seamless:
   false` is the before, byte for byte (?waternormal=legacy). */
const LAYERS = [
  { sx: 0.028, sy: 0.043, octaves: 4, weight: 1 },
  { sx: 0.11, sy: 0.09, octaves: 2, weight: 0.35 },
];
const RELIEF = 2.6;

function periodicAxis(size, period) {
  const index = new Uint16Array(size), blend = new Float64Array(size);
  for (let pixel = 0; pixel < size; pixel++) {
    const coordinate = pixel * period / size, cell = Math.floor(coordinate), f = coordinate - cell;
    index[pixel] = cell;
    blend[pixel] = f * f * (3 - 2 * f);
  }
  return { index, blend };
}

/* value noise on a px x py lattice that wraps, the octaves weighted as geom.js fbm weights them */
function periodicLayer(size, { sx, sy, octaves }) {
  const out = [];
  for (let octave = 0; octave < octaves; octave++) {
    const px = Math.max(1, Math.round(size * sx * 2.03 ** octave)), py = Math.max(1, Math.round(size * sy * 2.03 ** octave));
    const stride = px + 1, lattice = new Float64Array(stride * (py + 1));
    for (let y = 0; y <= py; y++) for (let x = 0; x <= px; x++) lattice[y * stride + x] = hash2(x % px, y % py);
    out.push({ lattice, stride, x: periodicAxis(size, px), y: periodicAxis(size, py), amplitude: 0.5 ** octave });
  }
  return out;
}

function sampleLayer(layer, x, y) {
  let sum = 0, normalization = 0;
  for (const { lattice, stride, x: ax, y: ay, amplitude } of layer) {
    const offset = ay.index[y] * stride + ax.index[x], u = ax.blend[x], v = ay.blend[y];
    const a = lattice[offset], b = lattice[offset + stride];
    const upper = a + (lattice[offset + 1] - a) * u, lower = b + (lattice[offset + stride + 1] - b) * u;
    sum += ((upper + (lower - upper) * v) * 2 - 1) * amplitude;
    normalization += amplitude;
  }
  return sum / normalization;
}

/** Fill a size x size RGBA8 image with the tangent-space ripple normals (A = 255). */
export function fillWaterNormalPixels(rgba, size, { seamless = true } = {}) {
  let height;
  if (seamless) {
    const layers = LAYERS.map(layer => ({ weight: layer.weight, octaves: periodicLayer(size, layer) }));
    const field = new Float64Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let h = 0;
      for (const { weight, octaves } of layers) h += sampleLayer(octaves, x, y) * weight;
      field[y * size + x] = h;
    }
    height = (x, y) => field[((y + size) % size) * size + ((x + size) % size)];
  } else {
    height = (x, y) => fbm(x * 0.028, y * 0.043, 4) + fbm(x * 0.11, y * 0.09, 2) * 0.35;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const nx = (height(x - 1, y) - height(x + 1, y)) * RELIEF, ny = (height(x, y - 1) - height(x, y + 1)) * RELIEF;
    const l = Math.hypot(nx, ny, 1);
    rgba[i] = (nx / l * 0.5 + 0.5) * 255; rgba[i + 1] = (ny / l * 0.5 + 0.5) * 255;
    rgba[i + 2] = (1 / l * 0.5 + 0.5) * 255; rgba[i + 3] = 255;
  }
  return rgba;
}
