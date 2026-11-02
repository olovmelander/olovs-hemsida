import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WATER_BANK } from './water-shading.mjs';

describe('the bank in the water', () => {
  it('darkens and greens the body a stride or two inside the waterline, no further', () => {
    expect(WATER_BANK.reach[0]).toBeLessThan(WATER_BANK.reach[1]);
    expect(WATER_BANK.reach[1]).toBeLessThanOrEqual(4);
    expect(WATER_BANK.share).toBeLessThan(0.75);
    const [r, g, b] = WATER_BANK.tint;
    for (const c of WATER_BANK.tint) expect(c).toBeLessThan(1);
    expect(g).toBeGreaterThan(r); expect(g).toBeGreaterThan(b);
  });
  it('is off on the open sea and switched in main.js', () => {
    const shading = fs.readFileSync(new URL('./water-shading.mjs', import.meta.url), 'utf8');
    expect(shading).toMatch(/if \(bank && !ocean && !sea\)/);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/bank: new URLSearchParams\(location\.search\)\.get\('waterbank'\) !== '0'/);
  });
});
