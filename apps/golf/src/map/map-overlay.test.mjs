/* The overlay's aim line: straight at the pin on an open hole, at the dogleg corner until it turns, and wherever the player tapped. */
import { describe, expect, it } from 'vitest';
import { clubAimPoint } from './map-overlay.mjs';

const straightHole = {
  line: [[0, 300], [0, 0]],
  green: { c: [0, 0] },
};

const doglegHole = {
  line: [[0, 350], [0, 140], [160, 140]],
  green: { c: [160, 140] },
};

describe('clubAimPoint', () => {
  it('aims at the green centre on a straight hole', () => {
    expect(clubAimPoint([0, 300], straightHole)).toEqual([0, 0]);
  });

  it('prefers an explicit tapped target over the hole line', () => {
    expect(clubAimPoint([0, 350], doglegHole, [15, 200])).toEqual([15, 200]);
  });

  it('aims toward a dogleg bend while it lies ahead of the ball, then aims at the green', () => {
    expect(clubAimPoint([0, 350], doglegHole)).toEqual([0, 140]);
    expect(clubAimPoint([40, 140], doglegHole)).toEqual([160, 140]);
  });
});
