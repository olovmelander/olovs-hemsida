import { describe, it, expect, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { createSyntheticAssetGraph } from '../synthetic-fixture.mjs';
import { assetReferenceForChunk, verifyChunkAsset, sha256Bytes } from '../chunk-node.mjs';
import { buildChunkEnvelope, parseChunkEnvelope } from '../chunk.mjs';
import { canonicalJsonBytes } from '../canonical-json.mjs';
import { predictTerrain, restoreTerrain } from '../terrain-predictor.mjs';
import { STARTUP_BUILDER } from '../startup-manifest.mjs';
import { verifyChunkAssetWeb } from './decode-web.mjs';
import { decodeStartupTerrain } from './startup-decode.mjs';
import { CourseChunkSource } from './course-chunk-source.mjs';
import { MemoryByteCache, CacheStorageByteCache, VerifiedImmutableStore } from './cache.mjs';

const baseUrl = 'https://banvy.invalid/subpath/';
function fixture() {
  const synthetic = createSyntheticAssetGraph();
  const original = [...synthetic.resources].find(([url, bytes]) => url.endsWith('.bvch') && parseChunkEnvelope(bytes).header.kind === 'terrain')[1];
  const ref = assetReferenceForChunk(original, { kind: 'terrain', directory: 'grounds/test/terrain' });
  const decoded = verifyChunkAsset(ref, original);
  decoded.payload = new Uint8Array(decoded.payload);
  const header = canonicalJsonBytes(decoded.header);
  const compressed = deflateRawSync(predictTerrain(decoded.payload, decoded.header.grid.width));
  const transport = new Uint8Array(4 + header.length + compressed.length);
  new DataView(transport.buffer).setUint32(0, header.length, true);
  transport.set(header, 4); transport.set(compressed, 4 + header.length);
  const raw = buildChunkEnvelope(decoded.header, decoded.payload, 'raw');
  const entry = { pack: 0, offset: 0, bytes: transport.length, codec: 'terrain-predictor-v1', rawBytes: raw.length, rawSha256: sha256Bytes(raw) };
  const pack = { url: 'grounds/test/startup/pack.bin', bytes: transport.length, sha256: sha256Bytes(transport) };
  const graph = { ground: { groundId: 'test', shell: ref, tiles: [] }, course: { groundManifest: { sha256: 'a'.repeat(64) } } };
  const manifest = { version: 1, builder: STARTUP_BUILDER, groundId: 'test', groundSha256: 'a'.repeat(64), packs: [pack], entries: { [ref.sha256]: entry } };
  const resources = new Map([[ref.url, original], [pack.url, transport]]);
  const counts = new Map();
  const setManifest = () => {
    const bytes = canonicalJsonBytes(manifest);
    const reference = { url: 'grounds/test/startup/manifest.json', sha256: sha256Bytes(bytes), bytes: bytes.length };
    resources.set(reference.url, bytes);
    return reference;
  };
  let offline = false;
  const fetchImpl = async url => {
    const rel = url.slice(baseUrl.length);
    counts.set(rel, (counts.get(rel) || 0) + 1);
    if (offline) throw new Error('network disabled');
    const bytes = resources.get(rel);
    return new Response(bytes ?? 'missing', { status: bytes ? 200 : 404 });
  };
  const workerClient = { decode: async (reference, bytes, options) => {
    // Exercise the ownership rule used by a real Worker.
    const moved = structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    return options.startupEntry ? decodeStartupTerrain(reference, new Uint8Array(moved), options.startupEntry, options)
      : verifyChunkAssetWeb(reference, moved, options);
  } };
  const makeSource = extra => new CourseChunkSource({ graph, baseUrl, workerClient, fetchImpl, cache: new MemoryByteCache(), ...extra });
  return { ref, decoded, transport, entry, graph, manifest, pack, resources, counts, setManifest, makeSource,
    goOffline: () => { offline = true; } };
}

describe('lossless complete-course startup', () => {
  it('completes verification without exposing or copying a consumer payload', async () => {
    const f = fixture();
    const slice = vi.fn(f.decoded.payload.slice.bind(f.decoded.payload));
    f.decoded.payload.slice = slice;
    const workerClient = { decode: vi.fn(async () => f.decoded) };
    const source = f.makeSource({ workerClient });
    expect((await source.ensureComplete()).complete).toBe(true);
    expect(slice).not.toHaveBeenCalled();
    expect(source.stats().decodedResidentBytes).toBe(0);
    expect(source.stats().consumerCopies).toBe(0);
    const consumer = await source.load(f.ref);
    expect(slice).toHaveBeenCalledTimes(1);
    consumer.payload.fill(0);
    expect(f.decoded.payload.some(byte => byte !== 0)).toBe(true);
    source.dispose();
  });

  it('shares in-flight readiness verification with a mutable consumer', async () => {
    const f = fixture(), source = f.makeSource();
    await source.initialize(f.setManifest());
    const [ready, consumer] = await Promise.all([source.ensureComplete(), source.load(f.ref)]);
    expect(ready.complete).toBe(true);
    expect(consumer.payload).toEqual(f.decoded.payload);
    expect(source.stats().decodes).toBe(1);
    expect(source.stats().consumerCopies).toBe(1);
    source.dispose();
  });

  it('never reports complete when verification of an original chunk fails', async () => {
    const f = fixture(), source = f.makeSource();
    f.resources.set(f.ref.url, new Uint8Array(f.resources.get(f.ref.url).length));
    await expect(source.ensureComplete()).rejects.toThrow(/integrity/);
    expect(source.stats().complete).toBe(false);
    expect(source.stats().verified).toBe(0);
    source.dispose();
  });
  it('preserves every u16 value, no-data and discontinuous edges in both directions', () => {
    const data = new Uint8Array(65536 * 2);
    const view = new DataView(data.buffer);
    for (let i = 0; i < 65536; i++) view.setUint16(i * 2, (i * 40503) & 65535, true);
    expect(restoreTerrain(predictTerrain(data, 256), 256)).toEqual(data);
    expect(() => restoreTerrain(data, 257)).toThrow(/dimensions/);
  });

  it('uses one verified package, shares concurrent decodes, and isolates water carving', async () => {
    const f = fixture(), source = f.makeSource();
    await source.initialize(f.setManifest());
    const [a, b] = await Promise.all([source.load(f.ref), source.load(f.ref)]);
    expect(source.stats().fallbackReasons).toEqual([]);
    expect(a.payload).toEqual(f.decoded.payload);
    a.payload.fill(0); a.header.grid.width = 999;
    expect(b.payload).toEqual(f.decoded.payload);
    const c = await source.load(f.ref);
    expect(c.header.grid.width).toBe(f.decoded.header.grid.width);
    expect(c.payload).toEqual(f.decoded.payload);
    expect(f.counts.get(f.pack.url)).toBe(1);
    expect(f.counts.has(f.ref.url)).toBe(false);
    expect(source.stats().decodes).toBe(1);
  });

  it('can evict decoded terrain and decode it again with the network disabled', async () => {
    const f = fixture(), source = f.makeSource({ decodedBudget: 0 });
    await source.initialize(f.setManifest());
    expect((await source.ensureComplete()).complete).toBe(true);
    f.goOffline();
    expect((await source.load(f.ref)).payload).toEqual(f.decoded.payload);
    expect(source.stats().decodedResidentBytes).toBe(0);
    expect(f.counts.size).toBe(2);
  });

  it('cancelling one subscriber does not abort another subscriber or poison residency', async () => {
    const f = fixture(), source = f.makeSource();
    const controller = new AbortController();
    const a = source.load(f.ref, { signal: controller.signal });
    const b = source.load(f.ref);
    controller.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect((await b).payload).toEqual(f.decoded.payload);
    expect(f.counts.get(f.ref.url)).toBe(1);
    source.dispose();
    await expect(source.load(f.ref)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['stale', 'missing', 'corrupt', 'wrong decoded identity', 'overlap'])('falls back to the same v2 data when startup is %s', async failure => {
    const f = fixture(), source = f.makeSource();
    if (failure === 'stale') f.manifest.groundSha256 = 'b'.repeat(64);
    if (failure === 'missing') f.resources.delete(f.pack.url);
    if (failure === 'corrupt') f.resources.set(f.pack.url, new Uint8Array(f.transport.length));
    if (failure === 'wrong decoded identity') f.entry.rawSha256 = 'c'.repeat(64);
    if (failure === 'overlap') f.entry.offset = 1;
    await source.initialize(f.setManifest());
    expect((await source.load(f.ref)).payload).toEqual(f.decoded.payload);
    expect(f.counts.get(f.ref.url)).toBe(1);
    expect(source.stats().fallbackReasons.length).toBeGreaterThan(0);
  });

  it('rejects identity changes even when the requested SHA stays the same', async () => {
    const f = fixture(), source = f.makeSource();
    await expect(source.load({ ...f.ref, decodedSha256: 'd'.repeat(64) })).rejects.toThrow(/generation/);
    expect(f.counts.size).toBe(0);
  });

  it('rejects predictor corruption and truncated streams through the existing decoded hash gate', async () => {
    const f = fixture();
    await expect(decodeStartupTerrain(f.ref, f.transport.slice(0, -5), f.entry)).rejects.toThrow();
    await expect(decodeStartupTerrain({ ...f.ref, decodedBytes: 2 }, f.transport, f.entry)).rejects.toThrow(/identity/);
  });

  it('does not fail a verified online load if Cache Storage is denied or full', async () => {
    for (const cacheStorage of [null, { open: async () => { throw new Error('denied'); } }, {
      open: async () => ({ match: async () => null, put: async () => { throw new Error('quota exceeded'); } }),
    }]) {
      const store = new VerifiedImmutableStore({ cache: new CacheStorageByteCache({ cacheStorage }),
        fetchBytes: async () => new Uint8Array([1, 2]) });
      expect((await store.load({ url: '/data', bytes: 2 }, { verify: async (_, bytes) => bytes })).value).toEqual(new Uint8Array([1, 2]));
    }
  });
});
