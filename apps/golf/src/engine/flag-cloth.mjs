/* The pin flag's cloth, baked in Blender (tools/blender-flag/bake_flag_cloth.py)
   and played back here.

   One loop of cloth motion per WIND BAND -- calm to gale -- each a real cloth
   simulation calibrated to hang the way a golfer reads a flag (nine degrees of
   flag per m/s). The app plays the band nearest the wind at the flag and
   crossfades when the band changes; the flag group's rotation still says where
   the wind goes, as it did before the bake.

   The file (FLG1) is what tools/build-flag-cloth.mjs writes:
     'FLG1' | u32 header length | header JSON | deflate-raw payload
   The payload is every band's positions, quantized to QUANT metres, delta-coded
   along the frames of each coordinate, zigzagged to unsigned 16-bit and split
   into a plane of low bytes and a plane of high bytes -- smooth motion makes
   the high plane almost all zeros, which is what deflate is for. The same
   scheme the pack's heightfields use (codec.js decodeHF).

   Nothing here touches three.js or the DOM: the packer and the tests run it in
   Node. Positions are the flag's own frame -- x along the fly from the pole's
   axis, y up from the pole's foot, z the lateral. */

export const FLAG_CLOTH_MAGIC = 'FLG1';
export const FLAG_CLOTH_QUANT = 0.0002;          // 0.2 mm

const zig = d => ((d << 1) ^ (d >> 31)) & 0xffff;
const unzig = z => (z >>> 1) ^ -(z & 1);

/* bake: the JSON the Blender script writes. Returns { header, payload } with the
   payload still uncompressed -- the packer deflates it (Node's zlib). */
export function packFlagCloth(bake) {
  const { grid, fps, frames, bands } = bake;
  const nv = grid.nx * grid.nz, comps = nv * 3;
  const planeLen = bands.length * comps * frames;
  const lo = new Uint8Array(planeLen), hi = new Uint8Array(planeLen);
  let k = 0;
  for (const band of bands) {
    if (band.frames.length !== frames) throw new Error(`band ${band.name}: ${band.frames.length} frames, header says ${frames}`);
    for (let c = 0; c < comps; c++) {
      let prev = 0;
      for (let f = 0; f < frames; f++) {
        const v = band.frames[f][c];
        if (!Number.isFinite(v)) throw new Error(`band ${band.name}: frame ${f} coordinate ${c} is not a number`);
        const q = Math.round(v / FLAG_CLOTH_QUANT);
        const d = q - prev;
        if (d < -32768 || d > 32767) throw new Error(`band ${band.name}: a step of ${d} quanta does not fit 16 bits`);
        const z = zig(d);
        lo[k] = z & 0xff; hi[k] = z >>> 8; k++;
        prev = q;
      }
    }
  }
  const payload = new Uint8Array(planeLen * 2);
  payload.set(lo, 0); payload.set(hi, planeLen);
  const header = {
    format: 'banvy-flag-cloth-v1', quant: FLAG_CLOTH_QUANT, grid, fps, frames,
    ruleDegPerMs: bake.ruleDegPerMs, blender: bake.blender, cloth: bake.cloth,
    bands: bands.map(({ frames: _, ...meta }) => meta),
  };
  return { header, payload };
}

export function assembleFlagCloth(header, deflated) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length + deflated.length);
  out.set(new TextEncoder().encode(FLAG_CLOTH_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(deflated, 8 + json.length);
  return out;
}

/* bytes: the whole file. inflate(Uint8Array) -> Promise<Uint8Array> (raw deflate). */
export async function decodeFlagCloth(bytes, inflate) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (new TextDecoder().decode(u8.subarray(0, 4)) !== FLAG_CLOTH_MAGIC) throw new Error('not a flag cloth (FLG1) file');
  const n = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)));
  const payload = await inflate(u8.subarray(8 + n));
  const { grid, frames, bands, quant } = header;
  const nv = grid.nx * grid.nz, comps = nv * 3;
  const planeLen = bands.length * comps * frames;
  if (payload.length !== planeLen * 2) throw new Error(`flag cloth payload is ${payload.length} bytes, expected ${planeLen * 2}`);
  let k = 0;
  const out = bands.map(meta => {
    const positions = new Float32Array(frames * comps);    // frame-major: [frame][vertex][xyz]
    for (let c = 0; c < comps; c++) {
      let q = 0;
      for (let f = 0; f < frames; f++) {
        q += unzig(payload[k] | (payload[planeLen + k] << 8));
        positions[f * comps + c] = q * quant;
        k++;
      }
    }
    return { ...meta, positions };
  });
  return { ...header, nv, bands: out };
}

/* two triangles per cell of the nx x nz grid, row-major like the bake */
export function flagClothIndex(nx, nz) {
  const idx = new Uint16Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  return idx;
}

/* the band a wind speed plays: the nearest by the speed each band's measured
   hang stands for (bands are ordered by it, calm first) */
export function flagClothBand(cloth, ms) {
  if (!Number.isFinite(ms)) return -1;
  let best = 0;
  for (let b = 1; b < cloth.bands.length; b++) {
    if (Math.abs(cloth.bands[b].ms - ms) < Math.abs(cloth.bands[best].ms - ms)) best = b;
  }
  return best;
}

/* Adds weight x (band b at time t, seconds) into out (Float32Array, nv*3).
   Linear between the two baked frames around t; the loop wraps seamlessly
   because the bake crossfaded its own end into its start. */
export function accumulateFlagClothPose(cloth, b, t, weight, out) {
  const { frames, fps } = cloth;
  const comps = cloth.nv * 3;
  const p = cloth.bands[b].positions;
  let x = (t * fps) % frames;
  if (x < 0) x += frames;
  const f0 = Math.floor(x), f1 = (f0 + 1) % frames, s = x - f0;
  const o0 = f0 * comps, o1 = f1 * comps;
  const w0 = weight * (1 - s), w1 = weight * s;
  for (let c = 0; c < comps; c++) out[c] += p[o0 + c] * w0 + p[o1 + c] * w1;
  return out;
}

/* The hang of a pose, degrees from hanging straight down: hoist middle to the
   middle of the free edge, the way the bake measured it. */
export function flagClothHang(cloth, pose) {
  const { nx, nz } = cloth.grid;
  let hx = 0, hy = 0, hz = 0, fx = 0, fy = 0, fz = 0;
  for (let j = 0; j < nz; j++) {
    const h = 3 * (j * nx), f = 3 * (j * nx + nx - 1);
    hx += pose[h]; hy += pose[h + 1]; hz += pose[h + 2];
    fx += pose[f]; fy += pose[f + 1]; fz += pose[f + 2];
  }
  const dx = (fx - hx) / nz, dy = (fy - hy) / nz, dz = (fz - hz) / nz;
  return Math.atan2(Math.hypot(dx, dz), -dy) * 180 / Math.PI;
}
