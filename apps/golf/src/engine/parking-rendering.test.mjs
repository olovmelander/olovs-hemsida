import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parkingSurface } from './road-surface.mjs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('  const lots =', main.indexOf('const PARKING_RENDER_PROOFS'));
const source = main.slice(start, main.indexOf('  const posts = [];', start));
const ring = [[0, 0], [20, 0], [20, 20], [0, 20]];
const lots = [
  { id: 'paved', ring, surface: 'asphalt', prov: 'dated-orthophoto-trace' },
  { id: 'gravel', ring, surface: 'unpaved' },
  { id: 'authored', ring, surface: 'asphalt' },
];

function renderParking() {
  const stats = {}, proofs = [];
  const run = new Function('M', 'facilityArchitecture', 'stats', 'PARKING_RENDER_PROOFS', 'parkingSurface', source);
  run({ infra: { parking: lots } }, { replacedParkingIndices: new Set([2]) }, stats, proofs, parkingSurface);
  return { stats, proofs };
}

describe('v2 parking ownership', () => {
  it('keeps observed paving classifications on the terrain', () => {
    const result = renderParking();
    expect(result.proofs).toEqual(lots.slice(0, 2).map(lot => ({
      id: lot.id, surface: parkingSurface(lot), renderer: 'terrain',
    })));
  });

  it('retains authored replacements as the sole owner of their parking footprint', () => {
    const result = renderParking();
    expect(result.stats.sourceParkingBatchIndices).toEqual([0, 1]);
    expect(result.stats.sourceParkingBatchIds).toEqual(['paved', 'gravel']);
  });
});
