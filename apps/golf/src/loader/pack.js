/* Fetch a course: manifest -> entry -> fmt:1 pack, verified. The streams stay
   compressed here; engine/codec.js inflates them.

   The manifest (courses/index.json) is the pipelines' contract with the app:
   everything the pages used to hard-code per course -- tee names and marker
   colours, header strings, the tee-hiding breakpoint -- plus the pack's size
   and sha256, which is checked here at runtime: a pack that does not hash to
   what the manifest promises never reaches the decoder. */

/* Why these messages live here and not in the boot screen's error handler: this
   is the only place that knows WHICH fetch failed, and that is the whole
   difference between "the app is broken" and "you have not downloaded this
   course yet". The first instinct was to branch on navigator.onLine in the boot
   handler, and it is wrong: onLine reports whether the browser has a network
   interface, not whether anything answers on it. With the server stopped and
   wifi up it stays true, which is exactly the case a phone on a dead cell hits. */
async function get(url, what) {
  let r;
  try { r = await fetch(url); }
  catch { throw new Error(what); }
  if (!r.ok) throw new Error(`${what} (${r.status})`);
  return r;
}

export async function fetchPack(url, wantSha) {
  const buf = await (await get(url,
    'banan är inte nedladdad och servern svarar inte — banor du redan öppnat fungerar offline'))
    .arrayBuffer();
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
  const manifest = await (await get('/courses/index.json',
    'kunde inte nå servern — kontrollera anslutningen och ladda om')).json();
  const meta = manifest.courses.find(c => c.slug === slug) || manifest.courses[0];
  /* The pack is asked for by CONTENT, not by name. A pack file keeps one path
     forever, so a CDN that cached it could hand back yesterday's bytes under
     today's manifest -- and because the sha is checked above, that does not
     degrade quietly, it throws and the course refuses to open. Putting the hash
     in the URL means a changed pack is a different URL, so the cached copy is
     never the wrong one and every copy can be cached as hard as the CDN likes.
     The manifest itself is the one thing that must stay fresh (see _headers). */
  const url = meta.packUrl + (meta.sha256 ? `?v=${meta.sha256.slice(0, 16)}` : '');
  const pack = await fetchPack(url, meta.sha256);
  if (pack.H.slug !== meta.slug) throw new Error(`pack says ${pack.H.slug}, manifest says ${meta.slug}`);
  return { meta, pack, all: manifest.courses };
}
