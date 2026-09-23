import { describe, it, expect } from 'vitest';
import { scatterRecorder, packScatter, forEachSetBit, scatterDigest, validPreparedScatterReference,
  usableScatterSection, preparedScatterIdentity, preparedScatterAllowed, scatterVariant } from './prepared-scatter.mjs';

const H = c => c.repeat(64);

describe('prepared scatter', () => {
  it('packs each section on its own byte range and replays exactly the passed candidates', async () => {
    const make = (n, pass) => { const r = scatterRecorder(); for (let k = 0; k < n; k++) { r.candidate(); if (pass(k)) r.passed(); } return r; };
    const reeds = make(13, k => k % 5 === 0), edge = make(21, k => k === 20);
    const packed = packScatter({ reeds: { decisions: reeds.decisions, digest: H('a') }, cover: undefined,
      edge: { decisions: edge.decisions, digest: H('b'), extra: { n: 1 } } });
    expect(packed.sections.cover).toBe(null);
    expect(packed.sections.reeds).toMatchObject({ candidates: 13, offset: 0 });
    expect(packed.sections.edge).toMatchObject({ candidates: 21, offset: 2, extra: { n: 1 } });
    expect(packed.payload.length).toBe(5);
    const seen = [];
    expect(await forEachSetBit(packed.payload, packed.sections.reeds, k => seen.push(k))).toBe(true);
    expect(seen).toEqual([0, 5, 10]);
    const seenEdge = [];
    await forEachSetBit(packed.payload, packed.sections.edge, k => seenEdge.push(k));
    expect(seenEdge).toEqual([20]);
  });
  it('digests every array, its length and order included', async () => {
    const d = await scatterDigest([[1, 2], [3]]);
    expect(await scatterDigest([[1, 2], [3]])).toBe(d);
    expect(await scatterDigest([[1], [2, 3]])).not.toBe(d);
    expect(await scatterDigest([[1, 2], [3 + 1e-12]])).not.toBe(d);
  });
  it('validates a reference whose sections tile its payload', () => {
    const ref = { identity: H('a'), sha256: H('b'), decodedSha256: H('c'), url: 'x.bin', inputs: '{}', bytes: 9, decodedBytes: 5,
      sections: { reeds: { candidates: 13, offset: 0, digest: H('d') }, cover: null, edge: { candidates: 21, offset: 2, digest: H('e') } } };
    expect(validPreparedScatterReference(ref)).toBe(true);
    expect(validPreparedScatterReference({ ...ref, decodedBytes: 6 })).toBe(false);
    expect(validPreparedScatterReference({ ...ref, sections: { ...ref.sections, edge: { ...ref.sections.edge, offset: 3 } } })).toBe(false);
  });
  it('uses a section only for the same identity, inputs and candidate count', () => {
    const prepared = { identity: 'i', inputs: 'n', payload: new Uint8Array(1), sections: { reeds: { candidates: 8 }, cover: null } };
    expect(usableScatterSection(prepared, 'reeds', { identity: 'i', inputs: 'n', candidates: 8 })).toBe(true);
    expect(usableScatterSection(prepared, 'reeds', { identity: 'i', inputs: 'n', candidates: 9 })).toBe(false);
    expect(usableScatterSection(prepared, 'reeds', { identity: 'j', inputs: 'n', candidates: 8 })).toBe(false);
    expect(usableScatterSection(prepared, 'cover', { identity: 'i', inputs: 'n', candidates: 8 })).toBe(false);
  });
  it('has its own identity and its own switch', async () => {
    const meta = { slug: 't', sha256: H('a') }, base = { meta, groundSha256: H('b'), lowQuality: true, revision: H('c') };
    expect(await preparedScatterIdentity(base)).not.toBe(await preparedScatterIdentity({ ...base, lowQuality: false }));
    expect(scatterVariant(true)).toBe('scatter-lo');
    expect(preparedScatterAllowed('?bana=t&q=lo')).toBe(true);
    for (const search of ['?prepscatter=0', '?bakeVista=1', '?startup=0']) expect(preparedScatterAllowed(search)).toBe(false);
  });
});
