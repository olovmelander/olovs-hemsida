import { describe, it, expect } from 'vitest';
import { packVistaBits, vistaBitReader, vistaDigest, preparedVistaIdentity, preparedVistaInputs,
  preparedVistaAllowed, usablePreparedVista, validPreparedVistaReference, vistaVariant } from './prepared-vista.mjs';

const meta = { slug: 'test', sha256: 'a'.repeat(64), landcover: { sha256: 'b'.repeat(64) }, mownSurface: null, surroundings: null };

describe('prepared far vista', () => {
  it('round-trips every decision through the packed bits, and refuses to read past them', () => {
    const decisions = Array.from({ length: 1003 }, (_, k) => (k * 7919) % 5 === 0 ? 1 : 0);
    const bytes = packVistaBits(decisions), reader = vistaBitReader(bytes, decisions.length);
    expect(bytes.length).toBe(126);
    for (const d of decisions) expect(reader.next()).toBe(d === 1);
    expect(reader.consumed).toBe(1003);
    expect(() => reader.next()).toThrow(/overrun/);
  });
  it('digests every value at full precision, including the calibrated sizes', async () => {
    const pts = [1.5, 2.25, 3.125, 0.9, 10, 20, 30, 1.2], sizes = [undefined, [14.2, 3.1]];
    const d = await vistaDigest(pts, sizes);
    expect(await vistaDigest(pts.slice(), [undefined, [14.2, 3.1]])).toBe(d);
    expect(await vistaDigest([...pts.slice(0, 7), 1.2 + 1e-12], sizes)).not.toBe(d);
    expect(await vistaDigest(pts, [undefined, [14.2, 3.1000001]])).not.toBe(d);
    expect(await vistaDigest(pts, [])).not.toBe(d);
  });
  it('ties the identity to revision, quality and the course data', async () => {
    const base = { meta, groundSha256: 'c'.repeat(64), lowQuality: false, revision: 'd'.repeat(64) };
    const id = await preparedVistaIdentity(base);
    for (const change of [{ lowQuality: true }, { revision: 'e'.repeat(64) }, { groundSha256: 'f'.repeat(64) },
      { meta: { ...meta, landcover: null } }, { meta: { ...meta, sha256: '0'.repeat(64) } }])
      expect(await preparedVistaIdentity({ ...base, ...change })).not.toBe(id);
    expect(vistaVariant(true)).toBe('vista-lo');
  });
  it('uses a record only for the same run-time inputs', () => {
    const inputs = preparedVistaInputs({ landmarks: ['b', 'a'], flags: { vegetation: true } });
    expect(inputs).toBe(preparedVistaInputs({ landmarks: ['a', 'b'], flags: { vegetation: true } }));
    const prepared = { identity: 'x', inputs, candidates: 9, bits: new Uint8Array(2) };
    expect(usablePreparedVista(prepared, { identity: 'x', inputs })).toBe(true);
    expect(usablePreparedVista(prepared, { identity: 'y', inputs })).toBe(false);
    expect(usablePreparedVista(prepared, { identity: 'x', inputs: preparedVistaInputs({ landmarks: ['a'], flags: { vegetation: true } }) })).toBe(false);
    expect(usablePreparedVista({ ...prepared, bits: new Uint8Array(1) }, { identity: 'x', inputs })).toBe(false);
    expect(usablePreparedVista(null, { identity: 'x', inputs })).toBe(false);
  });
  it('is off for the bake, the explicit before, and non-display parameters', () => {
    expect(preparedVistaAllowed('?bana=test&hal=3&q=lo')).toBe(true);
    for (const search of ['?bakeVista=1', '?prepvista=0', '?startup=0', '?buildingGeometry=source'])
      expect(preparedVistaAllowed(search)).toBe(false);
  });
  it('validates a published reference before downloading it', () => {
    const ref = { identity: 'a'.repeat(64), sha256: 'b'.repeat(64), decodedSha256: 'c'.repeat(64), digest: 'd'.repeat(64),
      url: 'courses/test/prepared/vista-x.bin', bytes: 10, decodedBytes: 2, candidates: 9, inputs: '{}' };
    expect(validPreparedVistaReference(ref)).toBe(true);
    expect(validPreparedVistaReference({ ...ref, decodedBytes: 3 })).toBe(false);
    expect(validPreparedVistaReference({ ...ref, none: true, url: undefined })).toBe(false);
  });
});
