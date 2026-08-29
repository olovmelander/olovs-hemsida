/* Fetch and frame a fmt:1 course pack -- the network half of what the pages
   embed. The streams stay compressed here; engine/codec.js inflates them. */
export const fetchPack = url => (async () => {
  const buf = await (await fetch(url)).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'GPK1') throw new Error('bad pack magic');
  const hlen = new DataView(buf).getUint32(4, true);
  const H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  if (H.fmt !== 1) throw new Error('unsupported pack fmt ' + H.fmt);
  let o = 8 + hlen;
  const take = n => { const s = u8.subarray(o, o + n); o += n; return s; };
  return { H, s0: take(H.HF0.bytes), s1: take(H.HF1.bytes), sv: take(H.VEC.bytes) };
})();
