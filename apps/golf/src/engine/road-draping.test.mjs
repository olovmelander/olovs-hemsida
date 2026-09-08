import fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hyp, lerp } from './geom.js';

// Exercise the actual ribbon mesh builder, so a helper that is never used by
// the renderer cannot hide a recurrence of the floating-road regression.
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('function resamp('), main.indexOf('/* asphalt with its paint'));
const make = (terrainPlacement, terrainH) => new Function('THREE', 'M', 'hyp', 'lerp', 'terrainH', 'horizonAO', 'groundAt', 'C', 'fbm', 'stats',
  `${source}; return { buildRoad, proofs: ROAD_DRAPE_PROOFS };`)(
  THREE, { infra: { terrainPlacement } }, hyp, lerp, terrainH, () => 1,
  () => ({ col: [.3, .4, .2] }), { hard: [.5, .5, .5], path: [.4, .3, .2] }, () => 0, { verts: 0, tris: 0 });
const road = { line: [[-24, 0], [24, 0]], w: 3, lift: .16, tone: [.3, .3, .3] };

describe('measured road ribbon placement', () => {
  it('drapes every submitted vertex through a sharp valley and across a side slope', () => {
    const terrain = (x, z) => 100 - 20 * Math.exp(-((x / 2) ** 2)) + z * 1.75;
    const builder = make('measured-only', terrain);
    // Even a legacy bridge minimum and excessive lift must not manufacture an
    // embankment in a source-only ground without a separately observed deck.
    const geometry = builder.buildRoad([{ ...road, minH: 1000, lift: 7 }], true);
    const position = geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(50);
    for (let i = 0; i < position.count; i++) {
      const expected = terrain(position.getX(i), position.getZ(i)) + .03;
      expect(position.getY(i)).toBeCloseTo(expected, 4);
    }
    const centre = Array.from({ length: position.count }, (_, i) => i)
      .find(i => position.getX(i) === 0 && position.getZ(i) === 0);
    expect(position.getY(centre)).toBeCloseTo(80.03, 4);
    expect(builder.proofs[0].maximumOffsetErrorMetres).toBeLessThan(.00002);
    geometry.dispose();
  });

  it('keeps the existing box-filter, crown, bridge floor and shoulder behavior for legacy grounds', () => {
    const terrain = (x, z) => 100 - 20 * Math.exp(-((x / 2) ** 2)) + z * 1.75;
    const builder = make(undefined, terrain);
    const geometry = builder.buildRoad([{ ...road, minH: 105 }], false);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i);
      if (Math.abs(z) > road.w + .01) {
        expect(position.getY(i)).toBeCloseTo(terrain(position.getX(i), z) + .03, 4);
      } else {
        const expected = 105 + Math.max(0, .05 * (1 - (z / road.w) ** 2)) + road.lift;
        expect(position.getY(i)).toBeCloseTo(expected, 4);
      }
    }
    expect(builder.proofs).toEqual([]);
    geometry.dispose();
  });

  it('shows why a valley needs direct vertex samples even without a bridge minimum', () => {
    const terrain = x => Math.abs(x) < .1 ? 20 : 40;
    const legacy = make(undefined, terrain).buildRoad([road], true);
    const measured = make('measured-only', terrain).buildRoad([road], true);
    const centre = geometry => {
      const p = geometry.getAttribute('position');
      return Array.from({ length: p.count }, (_, i) => i).filter(i => p.getX(i) === 0 && p.getZ(i) === 0).map(i => p.getY(i))[0];
    };
    expect(centre(legacy)).toBeGreaterThan(38);
    expect(centre(measured)).toBeCloseTo(20.03, 4);
    legacy.dispose(); measured.dispose();
  });
});
