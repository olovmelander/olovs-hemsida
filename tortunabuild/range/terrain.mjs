/* Sample the build's own compatibility heightfield in local metres.
 * decodeHF is the engine's exact inverse of geobuild/lib.mjs quantizeHF:
 * planar byte split, zigzag delta, Paeth predictor. Do not re-derive it here. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { decodeHF } from '../../apps/golf/src/engine/codec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HF = JSON.parse(readFileSync(resolve(HERE, '../heightfields.json'), 'utf8'));
export const ORIGIN = [597400.5, 6614899.5];
export const toLocal = ([e, n]) => [e - ORIGIN[0], ORIGIN[1] - n];   /* east +x, north -z */

function sampler(field) {
  const values = decodeHF(field, inflateRawSync(Buffer.from(field.b64, 'base64')));
  return (x, z) => {
    const fx = (x - field.x0) / field.dx, fz = (z - field.z0) / field.dx;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= field.nx - 1 || j >= field.nz - 1) return NaN;
    const tx = fx - i, tz = fz - j;
    const g = (a, b) => values[b * field.nx + a];
    return g(i, j) * (1 - tx) * (1 - tz) + g(i + 1, j) * tx * (1 - tz)
      + g(i, j + 1) * (1 - tx) * tz + g(i + 1, j + 1) * tx * tz;
  };
}
const fine = sampler(HF.hf0), coarse = sampler(HF.hf1);
/** Height in the pack's own vertical reference (RH2000) at a local metre point. */
export function heightAtLocal(x, z) { const v = fine(x, z); return Number.isFinite(v) ? v : coarse(x, z); }
export const heightAtEpsg3006 = (e, n) => heightAtLocal(...toLocal([e, n]));
export const FIELDS = { hf0: { ...HF.hf0, b64: undefined }, hf1: { ...HF.hf1, b64: undefined }, source: HF.source };
