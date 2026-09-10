/* The retained measured rasters, read as plain Float32 with their sidecars:
   the 1 m laser terrain (4097 x 4097, local -2048..2048, the same bytes
   build-course.mjs pins by sha256) and the 2021 canopy height model
   (2560 x 3072 at 1 m, height above cloud ground). Local metres in, metres out. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TORTUNA_FRAME } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(HERE, '../cache');

/** heightAt(x, z) in RH 2000, bilinear on the native lattice; throws off-grid like the generator does. */
export function loadTerrain() {
  const bytes = fs.readFileSync(path.join(CACHE, 'terrain/terrain-1m.f32'));
  const size = 4097;
  if (bytes.length !== size * size * 4) throw new Error('terrain-1m.f32 is not 4097 x 4097 Float32');
  const fine = new Float32Array(bytes.buffer, bytes.byteOffset, size * size);
  const heightAt = (x, z) => {
    const col = x + 2048, row = z + 2048;
    if (col < 0 || row < 0 || col > 4096 || row > 4096) return NaN;
    const c = Math.min(4095, Math.floor(col)), r = Math.min(4095, Math.floor(row)), u = col - c, v = row - r;
    const k = r * size + c;
    return (fine[k] * (1 - u) + fine[k + 1] * u) * (1 - v) + (fine[k + size] * (1 - u) + fine[k + size + 1] * u) * v;
  };
  return { size, fine, heightAt };
}

/** The expanded 2021 canopy height raster; canopyAt(x, z) in metres (NaN where unknown). */
export function loadCanopy(layer = 'chm', expanded = true) {
  const dir = path.join(CACHE, expanded ? 'expanded-canopy' : 'canopy');
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, `${layer}.json`), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir, `${layer}.f32`));
  const { width, height, originEasting, originNorthing, sampleSpacingMetres } = sidecar;
  if (bytes.length !== width * height * 4) throw new Error(`${layer}.f32 does not match its sidecar`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, width * height);
  /* sidecar origin is the first sample CENTRE */
  const at = (x, z) => {
    const e = x + TORTUNA_FRAME.easting, n = TORTUNA_FRAME.northing - z;
    const col = Math.round((e - originEasting) / sampleSpacingMetres), row = Math.round((originNorthing - n) / sampleSpacingMetres);
    if (col < 0 || row < 0 || col >= width || row >= height) return NaN;
    return values[row * width + col];
  };
  return { ...sidecar, values, at, bounds: [originEasting - .5, originNorthing - height + .5, originEasting + width - .5, originNorthing + .5] };
}
