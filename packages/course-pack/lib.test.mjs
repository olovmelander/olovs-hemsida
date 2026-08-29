/* Unit tests for the fmt:1 course pack (GPK1).

   What the format promises, tested small: a pack is magic + uint32 header
   length + UTF-8 JSON header + three raw deflate streams back to back, with
   the header carrying each stream's byte length; readPack recovers the
   streams at exactly their boundaries, refuses a bad magic, a foreign fmt
   and any trailing bytes; and the whole thing is deterministic, because the
   currency gate is a hash comparison.                                       */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { MAGIC, writePack, readPack, inflateStream, sha256 } from './lib.mjs';

const raw = obj => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 });

/* a small but representative pack: GEO verbatim, two HF specs, three streams
   of clearly different lengths so a boundary mistake cannot cancel out */
function samplePack() {
  const geo = { origin: { lat: 63.2845, lon: 18.6735 }, mPerLon: 50000.5, seaLevel: 0, frame: 'local' };
  const hf0 = { x0: -2000, z0: -2000, dx: 4, nx: 5, nz: 3, h0: 1.2, hs: 0.1 };
  const hf1 = { x0: -8000, z0: -8000, dx: 32, nx: 4, nz: 4, h0: -6.4, hs: 0.1 };
  const streams = [
    zlib.deflateRawSync(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])),
    zlib.deflateRawSync(Buffer.alloc(64, 0xab)),
    raw({ holes: [{ n: 1, name: 'Första' }], water: [] }),
  ];
  return { geo, hf0, hf1, streams, pack: writePack({ slug: 'testcourse', geo, hf0, hf1, streams }) };
}

describe('writePack / readPack round-trip', () => {
  it('recovers the header fields', () => {
    const { geo, hf0, hf1, pack } = samplePack();
    const { header } = readPack(pack);
    expect(header.fmt).toBe(1);
    expect(header.slug).toBe('testcourse');
    expect(header.GEO).toEqual(geo);                       // GEO rides verbatim
    const { bytes: b0, ...hf0Back } = header.HF0;
    const { bytes: b1, ...hf1Back } = header.HF1;
    expect(hf0Back).toEqual(hf0);
    expect(hf1Back).toEqual(hf1);
    expect(typeof b0).toBe('number');
    expect(typeof b1).toBe('number');
    expect(typeof header.VEC.bytes).toBe('number');
  });

  it('lays the file out as magic + uint32 LE header length + header', () => {
    const { pack } = samplePack();
    expect(pack.slice(0, 4).toString('ascii')).toBe(MAGIC);
    const hlen = pack.readUInt32LE(4);
    const H = JSON.parse(pack.slice(8, 8 + hlen).toString('utf8'));
    expect(H.fmt).toBe(1);
    // the three declared stream lengths account for every remaining byte
    expect(8 + hlen + H.HF0.bytes + H.HF1.bytes + H.VEC.bytes).toBe(pack.length);
  });

  it('cuts the three streams at exactly their boundaries', () => {
    const { streams, pack } = samplePack();
    const { s0, s1, sv, header } = readPack(pack);
    expect(Buffer.compare(s0, streams[0])).toBe(0);
    expect(Buffer.compare(s1, streams[1])).toBe(0);
    expect(Buffer.compare(sv, streams[2])).toBe(0);
    expect(header.HF0.bytes).toBe(streams[0].length);
    expect(header.HF1.bytes).toBe(streams[1].length);
    expect(header.VEC.bytes).toBe(streams[2].length);
  });

  it('streams inflate back to what was deflated', () => {
    const { pack } = samplePack();
    const { s0, sv } = readPack(pack);
    expect([...inflateStream(s0)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(JSON.parse(inflateStream(sv).toString('utf8')).holes[0].name).toBe('Första');
  });
});

describe('readPack rejection', () => {
  it('detects trailing bytes', () => {
    const { pack } = samplePack();
    const padded = Buffer.concat([pack, Buffer.from([0])]);
    expect(() => readPack(padded)).toThrow(/trailing/);
    expect(() => readPack(Buffer.concat([pack, Buffer.alloc(17)]))).toThrow(/17 trailing bytes/);
  });

  it('rejects a bad magic', () => {
    const { pack } = samplePack();
    const evil = Buffer.from(pack);
    evil.write('GPKX', 0, 'ascii');
    expect(() => readPack(evil)).toThrow(/bad magic/);
    expect(() => readPack(Buffer.from('not a pack at all, longer than eight'))).toThrow(/bad magic/);
  });

  it('rejects an unsupported fmt', () => {
    // hand-build a fmt:2 pack; the fmt gate fires before stream slicing
    const header = Buffer.from(JSON.stringify({ fmt: 2, slug: 'future' }), 'utf8');
    const pre = Buffer.alloc(8);
    pre.write(MAGIC, 0, 'ascii');
    pre.writeUInt32LE(header.length, 4);
    expect(() => readPack(Buffer.concat([pre, header]))).toThrow(/unsupported pack fmt 2/);
  });

  it('a truncated pack does not read as valid', () => {
    const { pack } = samplePack();
    // cutting into the last stream: readPack slices short, then o !== buf.length
    expect(() => readPack(pack.slice(0, pack.length - 3))).toThrow();
  });
});

describe('determinism', () => {
  it('the same inputs produce the same bytes, hence the same sha256', () => {
    const a = samplePack().pack;
    const b = samplePack().pack;
    expect(Buffer.compare(a, b)).toBe(0);
    expect(sha256(a)).toBe(sha256(b));
  });

  it('sha256 matches the published test vectors', () => {
    expect(sha256(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('a one-byte change moves the hash', () => {
    const { pack } = samplePack();
    const tweaked = Buffer.from(pack);
    tweaked[tweaked.length - 1] ^= 1;
    expect(sha256(tweaked)).not.toBe(sha256(pack));
  });
});
