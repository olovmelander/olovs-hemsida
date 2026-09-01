/* --------------------------------------------------------------- geometry
   helpers -- the same formulas geobuild uses, so the page and the checks agree */
const TAU = Math.PI * 2;
const clampf = (v, a, b) => v < a ? a : v > b ? b : v;
const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clampf((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rightOf = b => [-Math.cos(b), Math.sin(b)];

/* The direction of play at a point that lies on a hole line: the heading of the
   nearest segment, in alongLine's convention -- forward is (sin b, cos b), so
   rightOf(b) is the player's right hand. It exists because `mk.b` in the packs
   is NOT in this convention on eight of nine courses (the pipelines write a
   compass bearing, atan2(dx,-dz)), and a bearing that must agree with the line
   is better derived from the line than believed from a field beside it. */
function lineBearingAt(L, c) {
  let best = Infinity, b = 0;
  for (let i = 0; i < L.length - 1; i++) {
    const dx = L[i + 1][0] - L[i][0], dz = L[i + 1][1] - L[i][1];
    if (!(dx * dx + dz * dz)) continue;
    const d = ptSegD(c[0], c[1], L[i][0], L[i][1], L[i + 1][0], L[i + 1][1]);
    if (d < best) { best = d; b = Math.atan2(dx, dz); }
  }
  return b;
}

function polyLen(L) { let t = 0; for (let i = 0; i < L.length - 1; i++) t += hyp(L[i], L[i + 1]); return t; }
function alongLine(L, f) {
  const seg = []; let tot = 0;
  for (let i = 0; i < L.length - 1; i++) { const d = hyp(L[i], L[i + 1]); seg.push(d); tot += d; }
  let d = clampf(f, -0.25, 1.25) * tot;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? d / seg[i] : 0;
      return { x: lerp(L[i][0], L[i + 1][0], t), z: lerp(L[i][1], L[i + 1][1], t),
               b: Math.atan2(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]) };
    }
    d -= seg[i];
  }
}
function ptSegD(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = clampf(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function distToLine(px, pz, L) {
  let m = Infinity;
  for (let i = 0; i < L.length - 1; i++) m = Math.min(m, ptSegD(px, pz, L[i][0], L[i][1], L[i + 1][0], L[i + 1][1]));
  return m;
}
function ringBBox(r) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return { x0, x1, z0, z1 };
}
function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringSD(x, z, r) {
  let m = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    m = Math.min(m, ptSegD(x, z, r[j][0], r[j][1], r[i][0], r[i][1]));
  return inRing(x, z, r) ? -m : m;
}
function centroidOf(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f; cx += (r[j][0] + r[i][0]) * f; cz += (r[j][1] + r[i][1]) * f;
  }
  if (Math.abs(a) < 1e-6) { let mx = 0, mz = 0; for (const p of r) { mx += p[0]; mz += p[1]; } return [mx / r.length, mz / r.length]; }
  return [cx / (3 * a), cz / (3 * a)];
}

/* deterministic noise: one hash, three octaves, no texture fetch */
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), u),
              lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u), v) * 2 - 1;
}
function fbm(x, z, oct = 3) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export { TAU, clampf, hyp, lerp, smooth, rightOf, polyLen, alongLine, lineBearingAt, ptSegD, distToLine, ringBBox, inRing, ringSD, centroidOf, hash2, vnoise, fbm };
