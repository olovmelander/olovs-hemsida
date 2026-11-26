import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { decodeBankReflection, loadMeasuredBankReflection } from './measured-bank-reflection.mjs';

async function packaged(slug) {
  const bytes = await fs.readFile(new URL('./assets/bank-' + slug + '.bin', import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function at(field, x, z) {
  const column = Math.floor((x - field.x0) / field.cell), row = Math.floor((z - field.z0) / field.cell);
  const offset = (column + field.width * row) * 4, d = field.map.image.data;
  return { height: ((d[offset] << 8) + d[offset + 1]) / 100 - 32, crown: d[offset+2] / 5, cover: d[offset+3] };
}

describe('surveyed water reflection fields', () => {
  it('keeps the open Stadium 18 green clear of invented crowns', async () => {
    const f = await decodeBankReflection(await packaged('bro-hof-stadium'));
    const shore = at(f,-482.52,660.15), green = at(f,-488,657);
    expect(shore.cover).toBe(24);
    expect(green.cover).toBe(148);
    expect(green.height).toBeGreaterThan(shore.height);
    expect([green.crown,shore.crown]).toEqual([0,0]);
  });
  it('registers the Norrfällsviken pond and the approved canopy on its east bank in the player frame', async () => {
    const f = await decodeBankReflection(await packaged('norrfallsviken'));
    const pond = at(f,177,59), bank = at(f,203,66);
    expect(pond.cover).toBe(24);
    expect(pond.height).toBeCloseTo(32.66,2);
    expect(pond.crown).toBe(0);
    expect(bank).toMatchObject({cover:104,crown:11.6});
    expect(bank.height).toBeGreaterThan(pond.height);
    expect(at(f,1.7,87.1)).toMatchObject({cover:148,crown:0});
  });
  it('rejects a malformed or truncated field before binding any texture', async () => {
    const input = await packaged('norrfallsviken');
    await expect(decodeBankReflection(input.slice(0,8))).rejects.toThrow('size');
    await expect(decodeBankReflection(input.slice(0,28))).rejects.toThrow();
    const header = new DataView(input);
    header.setFloat32(16,Infinity,true);
    await expect(decodeBankReflection(input)).rejects.toThrow('bounds');
    header.setUint32(0,0);
    await expect(decodeBankReflection(input)).rejects.toThrow('field');
  });
  it('makes no request for another course and surfaces a missing pilot asset to the sky fallback', async () => {
    const request = vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:404}));
    try {
      expect(await loadMeasuredBankReflection('puttom')).toBe(null);
      expect(request).not.toHaveBeenCalled();
      await expect(loadMeasuredBankReflection('norrfallsviken')).rejects.toThrow('404');
    } finally { request.mockRestore(); }
  });
});
