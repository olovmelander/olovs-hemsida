import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inflate } from '../engine/codec.js';
import { scorecardOf } from './course-scorecard.mjs';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

const hole = (n, par, t, idx = n) => ({ n, par, idx, t });

describe('scorecardOf', () => {
  it('orders the holes and sums each nine and the course', () => {
    const holes = Array.from({ length: 18 }, (_, i) => hole(18 - i, i % 3 === 0 ? 3 : 4, [300 + i, 250 + i]));
    const card = scorecardOf({ holes }, 2);
    expect(card.holes.map(h => h.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(card.nines.map(n => n.label)).toEqual(['Ut', 'In']);
    expect(card.nines[0].par + card.nines[1].par).toBe(card.par);
    expect(card.nines[0].lengths[0] + card.nines[1].lengths[0]).toBe(card.lengths[0]);
    expect(card.indexed).toBe(true);
  });

  it('gives a nine one total, and no sum to a tee with a hole missing', () => {
    const holes = Array.from({ length: 9 }, (_, i) => hole(i + 1, 3, i === 4 ? [100] : [100, 80], null));
    const card = scorecardOf({ holes }, 2);
    expect(card.nines).toHaveLength(1);
    expect(card.nines[0].label).toBe('Tot');
    expect(card.lengths).toEqual([900, null]);
    expect(card.indexed).toBe(false);
  });

  it('reads a length from the tee marks where the card list has none', () => {
    const card = scorecardOf({ holes: [{ n: 1, par: 4, tees: { marks: [{ m: 333 }] } }] }, 1);
    expect(card.holes[0].lengths).toEqual([333]);
  });
});

describe('every published course', () => {
  const manifest = JSON.parse(readFileSync(`${PUBLIC}courses/index.json`, 'utf8'));
  for (const meta of manifest.courses) {
    it(`${meta.slug}: the pack's card agrees with the manifest`, async () => {
      const buf = readFileSync(`${PUBLIC}${meta.packUrl}`);
      const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const headerBytes = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true);
      const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + headerBytes)));
      const at = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
      const vectors = JSON.parse(new TextDecoder().decode(await inflate(u8.subarray(at, at + header.VEC.bytes))));
      const card = scorecardOf(vectors, meta.tees.names.length);
      expect(card.holes).toHaveLength(meta.holes);
      expect(card.par).toBe(meta.par);
      /* every tee the course offers has a length on every hole */
      expect(card.lengths.every(Number.isFinite)).toBe(true);
    });
  }
});
