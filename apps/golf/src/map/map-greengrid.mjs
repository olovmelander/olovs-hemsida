/* The simulator's Greengrid, for the map. Pure: what the grid and its pulses are.

   main.js builds this in three.js (buildGreenGrid), which the map does not have,
   so its numbers are copied here: the 1 m cells, the slope read over 0.45 m either
   way, the five-step heat colours, and each pulse's speed, phase and travel down
   the fall line, so that pulses on one contour ripple downhill together.
   map.test.mjs compares them with main.js's own text, so a change there fails. */
import { ringSD } from '../engine/geom.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const PAD_METRES = 1, CELL_METRES = 1, SUBDIVISIONS = 2, LEAST_CELLS = 8;
const SLOPE_REACH = 0.45, LEAST_SLOPE = 0.003;
/* x, height, z, red, green, blue, edge fade, and the place in the 1 m cells. */
export const GRID_VERTEX_FLOATS = 9;
/* x, height, z, slope, fall x, fall z, speed, phase, travel, scale, red, green, blue. */
export const PULSE_FLOATS = 13;

export function slopeAt(x, z, heightAt) {
  const left = heightAt(x - SLOPE_REACH, z), right = heightAt(x + SLOPE_REACH, z);
  const up = heightAt(x, z - SLOPE_REACH), down = heightAt(x, z + SLOPE_REACH);
  const gx = (right - left) / (SLOPE_REACH * 2), gz = (down - up) / (SLOPE_REACH * 2);
  const s = Math.hypot(gx, gz);
  return { s, dirX: s > 1e-4 ? -gx / s : 0, dirZ: s > 1e-4 ? -gz / s : 0 };
}

/* Azure to 1.5%, emerald to 3.5%, amber to 5.5%, tangerine to 8%, crimson past it. */
export function slopeColor(s) {
  if (s < 0.015) {
    const t = clamp(s / 0.015, 0, 1);
    return [0.08 + t * 0.04, 0.68 + t * 0.18, 0.96 - t * 0.12];
  }
  if (s < 0.035) {
    const t = (s - 0.015) / 0.02;
    return [0.12 + t * 0.10, 0.86 + t * 0.06, 0.84 - t * 0.52];
  }
  if (s < 0.055) {
    const t = (s - 0.035) / 0.02;
    return [0.22 + t * 0.74, 0.92 - t * 0.10, 0.32 - t * 0.18];
  }
  if (s < 0.080) {
    const t = (s - 0.055) / 0.025;
    return [0.96 + t * 0.02, 0.82 - t * 0.34, 0.14 - t * 0.04];
  }
  const t = clamp((s - 0.080) / 0.03, 0, 1);
  return [0.98, 0.48 - t * 0.30, 0.10 + t * 0.08];
}

export const SLOPE_STEPS = Object.freeze([
  { label: '0–1,5', slope: 0.0075 }, { label: '1,5–3,5', slope: 0.025 }, { label: '3,5–5,5', slope: 0.045 },
  { label: '5,5–8', slope: 0.0675 }, { label: '8+', slope: 0.095 },
]);

/* A hole's green as one mesh that conforms to its ground, and its pulses. Null
   when the ground under it is not there to read. */
export function buildGreenGrid({ ring, heightAt }) {
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const [x, z] of ring) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  const x0 = bx0 - PAD_METRES, z0 = bz0 - PAD_METRES;
  const width = bx1 + PAD_METRES - x0, depth = bz1 + PAD_METRES - z0;
  const nx = Math.max(LEAST_CELLS, Math.ceil(width / CELL_METRES)), nz = Math.max(LEAST_CELLS, Math.ceil(depth / CELL_METRES));
  const dx = width / nx, dz = depth / nz;

  const columns = nx * SUBDIVISIONS + 1, rows = nz * SUBDIVISIONS + 1;
  const mesh = new Float32Array(columns * rows * GRID_VERTEX_FLOATS);
  const fades = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = x0 + i * dx / SUBDIVISIONS, z = z0 + j * dz / SUBDIVISIONS;
      const height = heightAt(x, z);
      if (!Number.isFinite(height)) return null;
      const fade = clamp((0.25 - ringSD(x, z, ring)) / 0.75, 0, 1);
      const k = j * columns + i;
      fades[k] = fade;
      mesh.set([x, height, z, ...(fade > 0 ? slopeColor(slopeAt(x, z, heightAt).s) : [0, 0, 0]), fade, i / SUBDIVISIONS, j / SUBDIVISIONS], k * GRID_VERTEX_FLOATS);
    }
  }
  const quads = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < columns - 1; i++) {
      const a = j * columns + i, b = a + 1, c = a + columns, d = c + 1;
      if (Math.max(fades[a], fades[b], fades[c], fades[d]) > 0.02) quads.push(a, b, c, b, d, c);
    }
  }

  const pulses = [];
  let total = 0, steepest = 0, cells = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = x0 + (i + 0.5) * dx, cz = z0 + (j + 0.5) * dz;
      if (ringSD(cx, cz, ring) > -0.05) continue;
      const { s, dirX, dirZ } = slopeAt(cx, cz, heightAt);
      total += s;
      cells++;
      steepest = Math.max(steepest, s);
      if (s < LEAST_SLOPE) continue;
      const height = heightAt(cx, cz);
      const elevation = (height * 1.35) % 1;
      const fallLine = ((cx * dirX + cz * dirZ) * 0.22) % 1;
      const phase = ((elevation + fallLine) % 1 + 1) % 1;
      pulses.push(cx, height, cz, s, dirX, dirZ, clamp(s * 14 + 0.35, 0.38, 1.6), phase,
        Math.min(dx, dz) * 1.15, clamp(0.85 + s * 5, 0.8, 1.3), ...slopeColor(s));
    }
  }
  return {
    mesh,
    indices: new Uint32Array(quads),
    pulses: new Float32Array(pulses),
    mean: cells ? total / cells : 0,
    max: steepest,
  };
}
