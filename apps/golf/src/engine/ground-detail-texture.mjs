import { fbm, hash2 } from './geom.js';

const SIZE = 512;
/* Measured from the original 512² ImageData bytes, after Uint8ClampedArray
   quantization. Matching their mean and contrast keeps the material palette
   stable when its smooth noise becomes periodic. These are texture statistics,
   never geographic data or a change to the shader's colour interpretation. */
const REFERENCE = [
  { scale: 0.055, octaves: 3, mean: 130.83710861206055, deviation: 36.439080774940514 },
  { scale: 0.012, octaves: 2, mean: 119.99592971801758, deviation: 38.206690318090146 },
];

function periodicOctaves(size, scale, count) {
  const octaves = [];
  for (let octave = 0; octave < count; octave++) {
    /* An integer number of lattice cells closes the field in both axes.
       Rounding each octave independently retains the original 2.03 spacing
       more closely than changing the whole FBM to an octave ratio of two. */
    const period = Math.round(size * scale * 2.03 ** octave);
    const stride = period + 1;
    const lattice = new Float64Array(stride * stride);
    for (let y = 0; y <= period; y++) {
      for (let x = 0; x <= period; x++) {
        lattice[y * stride + x] = hash2(x % period, y % period);
      }
    }
    /* x and y use the same coordinates. Cache interpolation once per row or
       column, instead of doing five floors and cubic blends for every pixel. */
    const indices = new Uint16Array(size);
    const blends = new Float64Array(size);
    for (let pixel = 0; pixel < size; pixel++) {
      const coordinate = pixel * period / size;
      const index = Math.floor(coordinate);
      const fraction = coordinate - index;
      indices[pixel] = index;
      blends[pixel] = fraction * fraction * (3 - 2 * fraction);
    }
    octaves.push({ lattice, stride, indices, blends, amplitude: 0.5 ** octave });
  }
  return octaves;
}

function periodicSample(octaves, x, y) {
  let sum = 0, normalization = 0;
  for (const { lattice, stride, indices, blends, amplitude } of octaves) {
    const offset = indices[y] * stride + indices[x];
    const u = blends[x], v = blends[y];
    const a = lattice[offset], b = lattice[offset + stride];
    const upper = a + (lattice[offset + 1] - a) * u;
    const lower = b + (lattice[offset + stride + 1] - b) * u;
    sum += ((upper + (lower - upper) * v) * 2 - 1) * amplitude;
    normalization += amplitude;
  }
  return sum / normalization;
}

/** Fill the existing packed DETAIL ImageData. The opt-in changes only its
 * smooth G/B fields; fine blades, glint mask, dimensions and GPU layout stay
 * fixed. No lattice or scratch arrays survive this startup bake. */
export function fillGroundDetailPixels(rgba, size, { seamless = false } = {}) {
  if (!(rgba instanceof Uint8ClampedArray) || size !== SIZE || rgba.length !== size * size * 4) {
    throw new TypeError('Ground detail requires the existing 512 by 512 RGBA ImageData');
  }
  if (typeof seamless !== 'boolean') throw new TypeError('seamless must be a boolean');

  const fields = seamless ? REFERENCE.map(({ scale, octaves }) => periodicOctaves(size, scale, octaves)) : null;
  const sums = [0, 0], squares = [0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const blade = (Math.sin(x * 2.1 + Math.sin(y * 0.7) * 2) * 0.5 + 0.5) * 0.5
      + (hash2(x, y) * 0.5);
    const clump = (fields ? periodicSample(fields[0], x, y) : fbm(x * 0.055, y * 0.055, 3)) * 0.5 + 0.5;
    const macro = (fields ? periodicSample(fields[1], x, y) : fbm(x * 0.012, y * 0.012, 2)) * 0.5 + 0.5;
    rgba[index] = blade * 255;
    rgba[index + 1] = clump * 255;
    rgba[index + 2] = macro * 255;
    rgba[index + 3] = Math.pow(hash2(x + 977, y + 131), 6) * 255;
    if (fields) {
      for (let channel = 0; channel < 2; channel++) {
        const value = rgba[index + channel + 1];
        sums[channel] += value;
        squares[channel] += value * value;
      }
    }
  }
  if (fields) {
    const count = size * size;
    const adjustments = REFERENCE.map((reference, channel) => {
      const mean = sums[channel] / count;
      const deviation = Math.sqrt(squares[channel] / count - mean * mean);
      const gain = reference.deviation / deviation;
      return { gain, offset: reference.mean - mean * gain };
    });
    /* Calibrate in place. A second quantization is bounded by the image tests;
       it avoids retaining a 512² float image merely for this startup change. */
    for (let index = 0; index < rgba.length; index += 4) {
      for (let channel = 0; channel < 2; channel++) {
        const { gain, offset } = adjustments[channel];
        rgba[index + channel + 1] = rgba[index + channel + 1] * gain + offset;
      }
    }
  }
  return rgba;
}
