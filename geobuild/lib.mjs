/* Shared geometry, projection and codec for the veckefjarden3d pipeline.

   One frame, stated once: local metres about ORIGIN, north is -z and east is +x,
   so a compass bearing is atan2(dx,-dz) and forward for a bearing b is (sin b, cos b).
   A player facing forward has their right hand at (-Fz, Fx) = (-cos b, sin b). That
   sign is the one the banguide work got wrong once and it mirrored every sided
   feature on the course, so `right()` below is the only place it is written.

   ORIGIN is frozen by reconcile.mjs and asserted by check3d; nothing downstream may
   recompute it, because every baked coordinate in the page is relative to it.       */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[/\\]geobuild$/, '');
export const CACHE = path.join(ROOT, 'geobuild', 'cache');

/* --- the frozen frame -------------------------------------------------------- */
export const ORIGIN = { lat: 63.28450, lon: 18.67350 };
export const M_PER_LAT = 111320;
export const M_PER_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);

export const lonLatToXZ = (lon, lat) => [
  (lon - ORIGIN.lon) * M_PER_LON,
  -(lat - ORIGIN.lat) * M_PER_LAT,
];
export const xzToLonLat = (x, z) => [
  ORIGIN.lon + x / M_PER_LON,
  ORIGIN.lat - z / M_PER_LAT,
];

/* forward is (sin b, cos b); the player's right is (-cos b, sin b) */
export const bearing = (dx, dz) => Math.atan2(dx, -dz);
export const forward = b => [Math.sin(b), Math.cos(b)];
export const right = b => [-Math.cos(b), Math.sin(b)];

/* --- polyline / polygon ------------------------------------------------------ */
export const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const d2r = d => d * Math.PI / 180;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function polyLen(L) {
  let t = 0;
  for (let i = 0; i < L.length - 1; i++) t += hyp(L[i], L[i + 1]);
  return t;
}

export function polyArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;                                   // signed; sign is winding
}

export function centroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cz += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {                       // degenerate: fall back to mean
    let mx = 0, mz = 0;
    for (const p of ring) { mx += p[0]; mz += p[1]; }
    return [mx / ring.length, mz / ring.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  return { x0, x1, z0, z1 };
}

export function ptSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}
export const ptSegD = (px, pz, ax, az, bx, bz) => ptSeg(px, pz, ax, az, bx, bz).d;

export function distToLine(px, pz, L) {
  let m = Infinity;
  for (let i = 0; i < L.length - 1; i++)
    m = Math.min(m, ptSegD(px, pz, L[i][0], L[i][1], L[i + 1][0], L[i + 1][1]));
  return m;
}

export function pointInPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* signed distance to a ring: negative inside, in metres */
export function polySD(x, z, ring) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    m = Math.min(m, ptSegD(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
  return pointInPoly(x, z, ring) ? -m : m;
}

/* Douglas-Peucker in metres */
export function simplifyDP(L, tol = 0.75) {
  if (L.length < 3) return L.slice();
  const keep = new Uint8Array(L.length); keep[0] = keep[L.length - 1] = 1;
  const stack = [[0, L.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = ptSegD(L[i][0], L[i][1], L[a][0], L[a][1], L[b][0], L[b][1]);
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return L.filter((_, i) => keep[i]);
}

/* outward offset of a closed ring by d metres (angle-bisector, self-intersection culled) */
export function offsetRing(ring, d) {
  const n = ring.length, out = [];
  const ccw = polyArea(ring) > 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
    const n1 = norm2([p[1] - a[1], a[0] - p[0]]), n2 = norm2([b[1] - p[1], p[0] - b[0]]);
    let m = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
    if (!m) continue;
    const cosHalf = Math.max(0.35, Math.hypot(n1[0] + n2[0], n1[1] + n2[1]) / 2);
    const s = (ccw ? -1 : 1) * d / cosHalf;
    out.push([p[0] + m[0] * s, p[1] + m[1] * s]);
  }
  return out.length >= 3 ? out : ring.slice();
}
function norm2(v) { const L = Math.hypot(v[0], v[1]); return L > 1e-9 ? [v[0] / L, v[1] / L] : null; }

/* the walk along a hole, same semantics as banguide/lib.mjs: forward is (sin b, cos b) */
export function alongLine(L, f) {
  const seg = []; let tot = 0;
  for (let i = 0; i < L.length - 1; i++) { const d = hyp(L[i], L[i + 1]); seg.push(d); tot += d; }
  let d = clamp(f, -0.2, 1.25) * tot;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? d / seg[i] : 0;
      const b = Math.atan2(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]);
      return { x: L[i][0] + (L[i + 1][0] - L[i][0]) * t, z: L[i][1] + (L[i + 1][1] - L[i][1]) * t, b };
    }
    d -= seg[i];
  }
}

/* --- similarity fit (Umeyama, 2-D, rotation+uniform scale+translation) -------- */
export function fitSimilarity(src, dst) {
  const n = src.length;
  const mS = [0, 0], mD = [0, 0];
  for (let i = 0; i < n; i++) { mS[0] += src[i][0]; mS[1] += src[i][1]; mD[0] += dst[i][0]; mD[1] += dst[i][1]; }
  mS[0] /= n; mS[1] /= n; mD[0] /= n; mD[1] /= n;
  let sxx = 0, sxy = 0, varS = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - mS[0], az = src[i][1] - mS[1];
    const bx = dst[i][0] - mD[0], bz = dst[i][1] - mD[1];
    sxx += ax * bx + az * bz;                     // dot
    sxy += ax * bz - az * bx;                     // cross
    varS += ax * ax + az * az;
  }
  const rot = Math.atan2(sxy, sxx);
  const s = varS > 1e-9 ? Math.hypot(sxx, sxy) / varS : 1;
  const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  const t = [mD[0] - (c * mS[0] - sn * mS[1]), mD[1] - (sn * mS[0] + c * mS[1])];
  const apply = p => [c * p[0] - sn * p[1] + t[0], sn * p[0] + c * p[1] + t[1]];
  let rms = 0;
  for (let i = 0; i < n; i++) { const q = apply(src[i]); rms += (q[0] - dst[i][0]) ** 2 + (q[1] - dst[i][1]) ** 2; }
  return { rot, rotDeg: rot * 180 / Math.PI, s, t, rms: Math.sqrt(rms / n), apply };
}

/* --- heightfield codec ------------------------------------------------------- */
/* Quantize -> MED predictor (left, up, and up-left, as PNG's Paeth does) -> zigzag ->
   split the low and high bytes into separate planes -> deflate-raw -> base64.

   Two details earn their keep. Predicting from three neighbours rather than one
   roughly halves the residual on real terrain, which slopes in two directions at once.
   And splitting the bytes matters more than it looks: an interleaved Int16 stream
   makes deflate chew through alternating high and low bytes, where the high plane is
   almost entirely zeros and compresses to nearly nothing once it is contiguous.

   The quantum is 10 cm. Terrarium's own vertical accuracy is on the order of a metre
   and the page adds micro-relief an order finer than that on top, so a finer quantum
   would be storing noise at full price. The page implements the exact inverse and
   check3d round-trips the two against each other. */
export function quantizeHF(h, nx, nz, hs = 0.1) {
  let min = Infinity;
  for (let i = 0; i < h.length; i++) if (h[i] < min) min = h[i];
  const h0 = Math.floor(min * 10) / 10;
  const q = new Int32Array(nx * nz);
  for (let i = 0; i < h.length; i++) {
    q[i] = Math.round((h[i] - h0) / hs);
    if (q[i] < 0 || q[i] > 65535) throw new Error(`quantizeHF: sample ${i} out of range (${q[i]})`);
  }
  const lo = new Uint8Array(nx * nz), hi = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const a = i ? q[k - 1] : 0;                       // left
    const b = j ? q[k - nx] : (i ? q[k - 1] : 0);     // up
    const c = (i && j) ? q[k - nx - 1] : b;           // up-left
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    const d = q[k] - pred;
    const zz = (d << 1) ^ (d >> 31);                  // zigzag: small magnitudes stay small
    lo[k] = zz & 255; hi[k] = (zz >>> 8) & 255;
  }
  const packed = zlib.deflateRawSync(Buffer.concat([Buffer.from(lo), Buffer.from(hi)]), { level: 9 });
  return { h0, hs, nx, nz, b64: packed.toString('base64'),
           rawBytes: nx * nz * 2, packedBytes: packed.length };
}

export function decodeHF(spec) {
  const { nx, nz, h0, hs } = spec;
  const raw = zlib.inflateRawSync(Buffer.from(spec.b64, 'base64'));
  const n = nx * nz;
  const out = new Float32Array(n);
  const q = new Int32Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const zz = raw[k] | (raw[n + k] << 8);
    const d = (zz >>> 1) ^ -(zz & 1);
    const a = i ? q[k - 1] : 0;
    const b = j ? q[k - nx] : (i ? q[k - 1] : 0);
    const c = (i && j) ? q[k - nx - 1] : b;
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    q[k] = ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)) + d;
    out[k] = h0 + q[k] * hs;
  }
  return out;
}

export const deflateB64 = obj =>
  zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 }).toString('base64');
export const inflateB64 = s =>
  JSON.parse(zlib.inflateRawSync(Buffer.from(s, 'base64')).toString('utf8'));

/* --- anchored patching: assert the anchor matches exactly once, or refuse ------ */
export function patcher(src) {
  const applied = [];
  return {
    sub(label, a, b) {
      const p = src.split(a);
      if (p.length - 1 !== 1) throw new Error(`ANCHOR FAIL [${label}]: expected 1, found ${p.length - 1}`);
      src = p.join(b); applied.push(label); return this;
    },
    get src() { return src; },
    get applied() { return applied; },
  };
}

/* --- misc -------------------------------------------------------------------- */
export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
export const writeJSONPretty = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1)); };
export const r1 = v => Math.round(v * 10) / 10;
export const ring1 = R => R.map(p => [r1(p[0]), r1(p[1])]);

/* deterministic RNG so every build is byte-identical */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
