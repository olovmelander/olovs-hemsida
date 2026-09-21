/* The pin flag's cloth, baked in Blender (tools/blender-flag/bake_flag_cloth.py)
   and played back here.

   One loop of cloth motion per WIND BAND -- calm to gale -- each a real cloth
   simulation calibrated to hang the way a golfer reads a flag (nine degrees of
   flag per m/s). The app blends neighbouring bands at the flag's smoothed wind
   speed (flag-motion.mjs); the flag group's rotation follows the wind with a
   short response delay. The FLG1 codec also supports denser, longer bakes.

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
// Preserve narrow folds through export: 0.2 mm rounding can put a blended
// triangle on the other side of a crease and trigger a visible normal flip.
export const FLAG_CLOTH_QUANT = 0.0001;          // 0.1 mm

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

// Harmonic-mean tangents give C1 motion without overshooting a fold's sampled
// extrema. In particular, a fast free edge must not change velocity every frame.
const tangent = (a, b) => a * b > 0 ? 2 * a * b / (a + b) : 0;

/* Adds weight x (band b at time t, seconds) into out (Float32Array, nv*3).
   Periodic, monotone cubic interpolation also spans the loop seam. */
export function accumulateFlagClothPose(cloth, b, t, weight, out) {
  const { frames, fps } = cloth;
  const comps = cloth.nv * 3;
  const p = cloth.bands[b].positions;
  let x = (t * fps) % frames;
  if (x < 0) x += frames;
  const f0 = Math.floor(x), f1 = (f0 + 1) % frames, s = x - f0;
  const o0 = f0 * comps, o1 = f1 * comps;
  const prev = ((f0 + frames - 1) % frames) * comps, next = ((f1 + 1) % frames) * comps;
  const s2 = s * s, s3 = s2 * s;
  const h0 = 2 * s3 - 3 * s2 + 1, h1 = -2 * s3 + 3 * s2;
  const t0 = s3 - 2 * s2 + s, t1 = s3 - s2;
  for (let c = 0; c < comps; c++) {
    const a = p[o0 + c], b = p[o1 + c], d = b - a;
    out[c] += weight * (a * h0 + b * h1 + tangent(a - p[prev + c], d) * t0
      + tangent(d, p[next + c] - b) * t1);
  }
  return out;
}

const samplers = new WeakMap();
function clothSampler(grid) {
  if (samplers.has(grid)) return samplers.get(grid);
  const { nx, nz, width, height } = grid, groups = Array.from({ length: 8 }, () => []);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * nx + i;
    if (i + 1 < nx) groups[i % 2].push([a, a + 1]);
    if (j + 1 < nz) groups[2 + j % 2].push([a, a + nx]);
    if (i + 1 < nx && j + 1 < nz) {
      groups[4 + j % 2].push([a, a + nx + 1]);
      groups[6 + j % 2].push([a + 1, a + nx]);
    }
  }
  const edges = groups.flat().filter(([a,b]) => a % nx || b % nx);
  const bends=[];
  for(let j=0;j<nz;j++) for(let i=0;i<nx;i++) {
    const a=j*nx+i;
    if(i+2<nx) bends.push([a,a+2,2*width/(nx-1)]);
    if(i && j+2<nz) bends.push([a,a+2*nx,2*height/(nz-1)]);
  }
  const sampler = {
    left: Int32Array.from(edges, e => e[0]*3), right: Int32Array.from(edges, e => e[1]*3),
    wa: Float32Array.from(edges, e => e[0] % nx ? 1 : 0),
    wb: Float32Array.from(edges, e => e[1] % nx ? 1 : 0),
    lengths: Float32Array.from(edges, ([a,b]) => Math.hypot((a%nx-b%nx)*width/(nx-1),
      (Math.floor(a/nx)-Math.floor(b/nx))*height/(nz-1))),
    bendLeft:Int32Array.from(bends,e=>e[0]*3), bendRight:Int32Array.from(bends,e=>e[1]*3),
    bendLength:Float32Array.from(bends,e=>e[2]*0.96),
    triangles: flagClothIndex(nx,nz), area: width*height/((nx-1)*(nz-1)*2) };
  samplers.set(grid,sampler);
  return sampler;
}

/* Blend the poses. Averaging opposing folds directly
   can shrink a sheet to a third of its area. A small position-based constraint
   solve restores structural and diagonal lengths, while the sewn edge stays
   pinned. The dynamics solver can defer projection until after inertia. */
export function sampleFlagCloth(cloth, blend, time, out, constrain = true) {
  const { lo, hi, weight } = blend;
  out.fill(0);
  if (weight < 1) accumulateFlagClothPose(cloth,lo,time,1-weight,out);
  if (weight > 0) accumulateFlagClothPose(cloth,hi,time,weight,out);
  const ms=cloth.bands[lo].ms*(1-weight)+cloth.bands[hi].ms*weight;
  return constrain ? relaxFlagClothPose(cloth.grid,out,24,null,flagBendingWeight(ms)) : out;
}

// Broad folds in limp fabric; release the extra bend resistance continuously
// as the sheet fills. Do not let area preservation create tiny accordion folds.
export function flagBendingWeight(ms) {
  const t=Math.max(0,Math.min(1,ms/7));
  return 1-t*t*(3-2*t);
}

/* Project against the actual sewn dimensions, including at exact wind bands
   and between sampled times. Local area constraints preserve fabric that an
   edge-only solve can still compress at the sharpest folds. */
export function relaxFlagClothPose(grid, out, iterations = 24, collide = null, bending = 0) {
  const { left, right, wa, wb, lengths, triangles, area, bendLeft, bendRight, bendLength } = clothSampler(grid);
  const nx=grid.nx;
  for (let iteration=0; iteration<iterations; iteration++) {
    for (let e=0; e<left.length; e++) {
      const l=left[e], r=right[e];
      const dx=out[r]-out[l], dy=out[r+1]-out[l+1], dz=out[r+2]-out[l+2];
      const length=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if (length<1e-9) continue;
      const correction=(length-lengths[e])/length/(wa[e]+wb[e])*0.85;
      const ca=correction*wa[e], cb=correction*wb[e];
      out[l]+=dx*ca; out[l+1]+=dy*ca; out[l+2]+=dz*ca;
      out[r]-=dx*cb; out[r+1]-=dy*cb; out[r+2]-=dz*cb;
    }
    for(let t=0;t<triangles.length;t+=3) {
      const ai=triangles[t],bi=triangles[t+1],ci=triangles[t+2], a=ai*3,b=bi*3,c=ci*3;
      const aw=ai%nx ? 1:0,bw=bi%nx ? 1:0,cw=ci%nx ? 1:0;
      const abx=out[b]-out[a],aby=out[b+1]-out[a+1],abz=out[b+2]-out[a+2];
      const acx=out[c]-out[a],acy=out[c+1]-out[a+1],acz=out[c+2]-out[a+2];
      let x=aby*acz-abz*acy,y=abz*acx-abx*acz,z=abx*acy-aby*acx;
      const length=Math.sqrt(x*x+y*y+z*z), actual=length*0.5;
      if(length<1e-12 || (actual>=area*0.97 && actual<=area*1.03)) continue;
      x/=length; y/=length; z/=length;
      const bcx=abx-acx,bcy=aby-acy,bcz=abz-acz;
      const ax=(bcy*z-bcz*y)*0.5,ay=(bcz*x-bcx*z)*0.5,az=(bcx*y-bcy*x)*0.5;
      const bx=(acy*z-acz*y)*0.5,by=(acz*x-acx*z)*0.5,bz=(acx*y-acy*x)*0.5;
      const cx=(z*aby-y*abz)*-0.5,cy=(x*abz-z*abx)*-0.5,cz=(y*abx-x*aby)*-0.5;
      const denom=aw*(ax*ax+ay*ay+az*az)+bw*(bx*bx+by*by+bz*bz)+cw*(cx*cx+cy*cy+cz*cz);
      if(denom<1e-14) continue;
      const target=Math.min(area*1.03,Math.max(area*0.97,actual));
      const lambda=(actual-target)/denom*0.9;
      out[a]-=lambda*aw*ax; out[a+1]-=lambda*aw*ay; out[a+2]-=lambda*aw*az;
      out[b]-=lambda*bw*bx; out[b+1]-=lambda*bw*by; out[b+2]-=lambda*bw*bz;
      out[c]-=lambda*cw*cx; out[c+1]-=lambda*cw*cy; out[c+2]-=lambda*cw*cz;
    }
    if(bending>0) for(let e=0;e<bendLeft.length;e++) {
      const l=bendLeft[e],r=bendRight[e],lw=(l/3)%nx ? 1:0;
      const dx=out[r]-out[l],dy=out[r+1]-out[l+1],dz=out[r+2]-out[l+2];
      const length=Math.hypot(dx,dy,dz);
      if(length<1e-9 || length>=bendLength[e]) continue;
      const correction=(length-bendLength[e])/length/(lw+1)*bending*0.75;
      out[l]+=dx*correction*lw;out[l+1]+=dy*correction*lw;out[l+2]+=dz*correction*lw;
      out[r]-=dx*correction;out[r+1]-=dy*correction;out[r+2]-=dz*correction;
    }
    if(collide) collide(grid,out);
  }
  // Area alone can hide a long, narrow triangle in a tight fold. Limit local
  // stretch as well, without pushing already compressed edges farther apart.
  for(let pass=0;pass<3;pass++) for(let e=0;e<left.length;e++) {
    const l=left[e],r=right[e],dx=out[r]-out[l],dy=out[r+1]-out[l+1],dz=out[r+2]-out[l+2];
    const length=Math.sqrt(dx*dx+dy*dy+dz*dz),limit=lengths[e]*1.08;
    if(length<=limit) continue;
    const correction=(length-limit)/length/(wa[e]+wb[e]),ca=correction*wa[e],cb=correction*wb[e];
    out[l]+=dx*ca;out[l+1]+=dy*ca;out[l+2]+=dz*ca;
    out[r]-=dx*cb;out[r+1]-=dy*cb;out[r+2]-=dz*cb;
  }
  if(collide) collide(grid,out);
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
