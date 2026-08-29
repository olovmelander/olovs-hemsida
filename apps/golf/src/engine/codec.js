/* ------------------------------------------------------------- decode data */
async function inflate(data) {
  const u8 = data instanceof Uint8Array ? data
    : Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

/* the exact inverse of geobuild/lib.mjs quantizeHF; check3d runs both and compares */
function decodeHF(spec, bytes) {
  const { nx, nz, h0, hs } = spec, n = nx * nz;
  const out = new Float32Array(n), q = new Int32Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const zz = bytes[k] | (bytes[n + k] << 8);
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

export { inflate, decodeHF };
