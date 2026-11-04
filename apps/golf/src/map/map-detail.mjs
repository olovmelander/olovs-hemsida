/* The one tileable texture every surface draws its grain from, made on the phone:
   R a fine turf grain, G clumps for the rough, B speckle for sand, A ripples for
   water. A seeded noise, so it is the same on every visit and costs no download. */
const SIZE = 256;

function latticeNoise(frequency, seed) {
  const grid = new Float32Array(frequency * frequency);
  let state = seed;
  for (let i = 0; i < grid.length; i++) {
    state = (state * 16807) % 2147483647;
    grid[i] = state / 2147483647;
  }
  return (x, y) => {
    const fx = x * frequency, fy = y * frequency;
    const i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, v = fy - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const at = (a, b) => grid[((b + frequency) % frequency) * frequency + ((a + frequency) % frequency)];
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  };
}

function layered(octaves, seed) {
  const layers = octaves.map(([frequency, weight], k) => [latticeNoise(frequency, seed + k * 977), weight]);
  const total = octaves.reduce((sum, [, weight]) => sum + weight, 0);
  return (x, y) => layers.reduce((sum, [noise, weight]) => sum + noise(x, y) * weight, 0) / total;
}

export function createDetailTexture() {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const grain = layered([[128, 1], [64, 0.7], [32, 0.3]], 101);
  const clumps = layered([[8, 1], [16, 0.8], [32, 0.6], [64, 0.4], [128, 0.25]], 2003);
  const speckle = layered([[128, 1], [96, 0.6]], 30011);
  const ripple = layered([[12, 1], [24, 0.6], [48, 0.3]], 40013);
  /* Noise crowds about its mean; spread it so the texture has some contrast left
     once the shader takes a tenth of it. */
  const spread = value => Math.max(0, Math.min(255, Math.round((0.5 + (value - 0.5) * 2.4) * 255)));
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const x = i / SIZE, y = j / SIZE, k = (j * SIZE + i) * 4;
    pixels[k] = spread(grain(x, y));
    pixels[k + 1] = spread(clumps(x, y));
    pixels[k + 2] = spread(speckle(x, y));
    pixels[k + 3] = spread(ripple(x, y));
  }
  return { pixels, size: SIZE };
}
