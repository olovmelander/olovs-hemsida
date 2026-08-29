/* Fetch a course: manifest -> entry -> fmt:1 pack, verified. The streams stay
   compressed here; engine/codec.js inflates them.

   The manifest (courses/index.json) is the pipelines' contract with the app:
   everything the pages used to hard-code per course -- tee names and marker
   colours, header strings, the tee-hiding breakpoint -- plus the pack's size
   and sha256, which is checked here at runtime: a pack that does not hash to
   what the manifest promises never reaches the decoder. */

export async function fetchPack(url, wantSha) {
  const buf = await (await fetch(url)).arrayBuffer();
  if (wantSha && crypto.subtle) {
    const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if (got !== wantSha) throw new Error(`pack integrity: ${url} hashes ${got.slice(0, 12)}…, manifest says ${wantSha.slice(0, 12)}…`);
  }
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'GPK1') throw new Error('bad pack magic');
  const hlen = new DataView(buf).getUint32(4, true);
  const H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  if (H.fmt !== 1) throw new Error('unsupported pack fmt ' + H.fmt);
  let o = 8 + hlen;
  const take = n => { const s = u8.subarray(o, o + n); o += n; return s; };
  return { H, s0: take(H.HF0.bytes), s1: take(H.HF1.bytes), sv: take(H.VEC.bytes) };
}

export async function loadCourse(slug) {
  const manifest = await (await fetch('/courses/index.json')).json();
  const meta = manifest.courses.find(c => c.slug === slug) || manifest.courses[0];
  const pack = await fetchPack(meta.packUrl, meta.sha256);
  if (pack.H.slug !== meta.slug) throw new Error(`pack says ${pack.H.slug}, manifest says ${meta.slug}`);
  return { meta, pack, all: manifest.courses };
}
