/* Packs the Blender flag bake for the app.

     node tools/build-flag-cloth.mjs [tools/blender-flag/cache/flag-bake.json]

   Reads the JSON tools/blender-flag/bake_flag_cloth.py writes, packs it with
   the app's own codec (apps/golf/src/engine/flag-cloth.mjs), and writes
     apps/golf/public/models/flag/cloth-<sha256>.bin      the asset, by content
     apps/golf/src/engine/flag-cloth-asset.mjs            where the app finds it
   removing any older cloth-*.bin so exactly one ships. Then it decodes what it
   wrote and demands every coordinate back within half a quantum -- a packer
   that cannot read its own file does not get to publish it. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packFlagCloth, assembleFlagCloth, decodeFlagCloth, FLAG_CLOTH_QUANT } from '../apps/golf/src/engine/flag-cloth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, 'tools/blender-flag/cache/flag-bake.json'));
const DIR = path.join(ROOT, 'apps/golf/public/models/flag');
const MODULE = path.join(ROOT, 'apps/golf/src/engine/flag-cloth-asset.mjs');

const bake = JSON.parse(fs.readFileSync(SRC, 'utf8'));
if (bake.format !== 'banvy-flag-bake-v1') throw new Error(`${SRC} is not a banvy-flag-bake-v1`);
if (bake.bands.some((b,i) => !Number.isFinite(b.ms) || (i && b.ms <= bake.bands[i-1].ms))) {
  throw new Error('Flag bands must be ordered by distinct measured wind speeds');
}
const { header, payload } = packFlagCloth(bake);
const deflated = zlib.deflateRawSync(payload, { level: 9 });
const file = assembleFlagCloth(header, deflated);
const sha = crypto.createHash('sha256').update(file).digest('hex');

/* read it back through the runtime's own decoder */
const inflate = async u8 => new Uint8Array(zlib.inflateRawSync(u8));
const back = await decodeFlagCloth(file, inflate);
let worst = 0;
bake.bands.forEach((band, b) => band.frames.forEach((frame, f) => frame.forEach((v, c) => {
  worst = Math.max(worst, Math.abs(back.bands[b].positions[f * back.nv * 3 + c] - v));
})));
/* half a quantum, plus float32 rounding: the decoder stores metres as float32, whose step at 2.6 m is ~2.4e-7 */
if (worst > FLAG_CLOTH_QUANT * 0.5 + 1e-6) throw new Error(`round trip is ${worst} m off, more than half a quantum`);

fs.mkdirSync(DIR, { recursive: true });
for (const old of fs.readdirSync(DIR)) if (/^cloth-[a-f0-9]{64}\.bin$/.test(old) && old !== `cloth-${sha}.bin`) fs.rmSync(path.join(DIR, old));
fs.writeFileSync(path.join(DIR, `cloth-${sha}.bin`), file);
fs.writeFileSync(MODULE, `/* Written by tools/build-flag-cloth.mjs from the Blender bake -- do not edit.
   The pin flag's baked cloth: ${bake.bands.length} wind bands, ${bake.frames} frames each at ${bake.fps} fps,
   a ${bake.grid.nx} x ${bake.grid.nz} grid, Blender ${bake.blender}. Fetched by content. */
export const FLAG_CLOTH_ASSET = ${JSON.stringify({
  path: `models/flag/cloth-${sha}.bin`, sha256: sha, bytes: file.length,
  bands: bake.bands.map(b => ({ name: b.name, ms: b.ms, hangDeg: b.hangDeg })),
}, null, 2)};
`);
console.log(JSON.stringify({ file: `apps/golf/public/models/flag/cloth-${sha}.bin`, bytes: file.length,
  payloadBytes: payload.length, headerBytes: JSON.stringify(header).length, roundTripWorstM: +worst.toExponential(2),
  bands: bake.bands.map(b => `${b.name} ${b.ms} m/s ${b.hangDeg} deg`) }, null, 2));
