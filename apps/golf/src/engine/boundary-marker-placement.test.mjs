import { describe, it, expect } from 'vitest';
import { boundaryMarkerSubmerged } from './boundary-marker-placement.mjs';

describe('boundary stakes near water', () => {
  const pond = { ring: [[0, 0], [10, 0], [10, 10], [0, 10]], level: 16 };
  it('retains a low dry-bank post when the grid also returns a higher nearby pond', () => {
    expect(boundaryMarkerSubmerged(-2, 5, 15, [pond])).toBe(false);
  });
  it('suppresses a submerged post inside the actual pond', () => {
    expect(boundaryMarkerSubmerged(2, 5, 15, [pond])).toBe(true);
  });
  it('retains a post above the pond and ignores stream candidates', () => {
    expect(boundaryMarkerSubmerged(2, 5, 16.1, [pond])).toBe(false);
    expect(boundaryMarkerSubmerged(2, 5, 15, [{ stream: true, level: 16 }])).toBe(false);
  });
});
