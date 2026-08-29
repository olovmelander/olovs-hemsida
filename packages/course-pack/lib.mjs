/* The course pack: fmt 1.

   One binary file per course carrying exactly what a page embeds today, minus
   the base64 and the HTML around it:

     bytes 0-3   magic "GPK1"
     bytes 4-7   uint32 LE: header length
     then        the header, UTF-8 JSON
     then        three raw deflate streams, back to back: HF0, HF1, VEC

   The header is {fmt, slug, GEO, HF0, HF1, VEC} where GEO is the page's GEO
   literal verbatim, HF0/HF1 are the heightfield specs with a `bytes` field
   giving that stream's length, and VEC.bytes the third's. No timestamps and
   no environment leaks into the file: the same committed build JSON must
   produce the same pack, byte for byte, on any machine, because the currency
   gate is a hash comparison and a hash that moves on its own is no gate.    */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

export const MAGIC = 'GPK1';

export function writePack({ slug, geo, hf0, hf1, streams }) {
  const header = Buffer.from(JSON.stringify({
    fmt: 1, slug,
    GEO: geo,
    HF0: { ...hf0, bytes: streams[0].length },
    HF1: { ...hf1, bytes: streams[1].length },
    VEC: { bytes: streams[2].length },
  }), 'utf8');
  const pre = Buffer.alloc(8);
  pre.write(MAGIC, 0, 'ascii');
  pre.writeUInt32LE(header.length, 4);
  return Buffer.concat([pre, header, ...streams]);
}

export function readPack(buf) {
  if (buf.slice(0, 4).toString('ascii') !== MAGIC) throw new Error('not a course pack (bad magic)');
  const hlen = buf.readUInt32LE(4);
  const H = JSON.parse(buf.slice(8, 8 + hlen).toString('utf8'));
  if (H.fmt !== 1) throw new Error(`unsupported pack fmt ${H.fmt}`);
  let o = 8 + hlen;
  const cut = n => { const s = buf.slice(o, o + n); o += n; return s; };
  const s0 = cut(H.HF0.bytes), s1 = cut(H.HF1.bytes), sv = cut(H.VEC.bytes);
  if (o !== buf.length) throw new Error(`pack has ${buf.length - o} trailing bytes`);
  return { header: H, s0, s1, sv };
}

export const inflateStream = s => zlib.inflateRawSync(s);
export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/* The card, whichever shape this course keeps it in. The five newer builds have
   their own card.json holding an ARRAY of {n,par,hcp,t}; Veckefjarden's card is
   banguide/guide-card.json, an OBJECT keyed by hole number -- the club's guide
   transcription, which predates the per-build convention and which geobuild's
   own reconcile and check3d still read from there. That legacy path is a real
   dependency of the Veckefjarden pipeline, not just of its data: banguide/ has
   to stay where geobuild can import it. Returns the array shape either way.  */
export function readCard(root, buildDir) {
  const own = path.join(root, buildDir, 'card.json');
  if (fs.existsSync(own)) return JSON.parse(fs.readFileSync(own, 'utf8')).holes;
  const guide = JSON.parse(fs.readFileSync(path.join(root, 'banguide/guide-card.json'), 'utf8'));
  return Object.entries(guide.holes)
    .map(([n, h]) => ({ n: +n, par: h.par, hcp: h.hcp, t: h.t }))
    .sort((a, b) => a.n - b.n);
}
