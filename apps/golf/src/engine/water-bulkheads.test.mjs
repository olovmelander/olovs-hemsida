import { describe, expect, it } from 'vitest';
import {
  buildBulkheadGeometry,
  createBulkheadCollider,
  isNearBulkhead,
  bridgeOutlineFromLine,
} from './water-bulkheads.mjs';
import { simulateShot } from '../play/ball-physics.mjs';
import { buildGroundSurfaceFeatures } from './surface-features.mjs';
import { SURFACE } from './surface.js';
import { GLOW, luminanceOf } from './glow.mjs';

describe('water bulkheads (timber & stone retaining walls)', () => {
  const waterList = [{ id: 'pond-17', level: 2.71, ring: [[-20, -20], [20, -20], [20, 20], [-20, 20]] }];
  const heightAt = () => 3.6;

  it('builds bloom-safe opaque triangle geometry for both timber and stone bulkheads', () => {
    const bulkheads = [
      { id: 'bh-17-island', kind: 'stone', waterId: 'pond-17', line: [[0, 0], [10, 0], [10, 8]] },
      { id: 'bh-15-pond', kind: 'timber', waterId: 'pond-17', line: [[-10, 0], [-10, 6]] },
    ];
    const { positions, colors, rendered } = buildBulkheadGeometry(bulkheads, { waterList, heightAt });
    expect(rendered.length).toBe(2);
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.length).toBe(colors.length);
    expect(positions.length % 9).toBe(0);

    // Every vertex colour must stay strictly below GLOW.threshold
    for (let i = 0; i < colors.length; i += 3) {
      const lum = luminanceOf({ r: colors[i], g: colors[i + 1], b: colors[i + 2] });
      expect(lum).toBeLessThan(GLOW.threshold - 0.2);
    }
  });

  it('detects shoreline proximity for reed suppression and builds bridge outlines from lines', () => {
    const bulkheads = [{ id: 'bh-1', kind: 'stone', line: [[0, 0], [20, 0]] }];
    expect(isNearBulkhead(10, 1.2, bulkheads, 2.0)).toBe(true);
    expect(isNearBulkhead(10, 4.5, bulkheads, 2.0)).toBe(false);

    const ring = bridgeOutlineFromLine([[0, 0], [12, 0]], 2.6);
    expect(ring.length).toBe(4);
    expect(ring[0][1]).toBeCloseTo(1.3, 5);
    expect(ring[3][1]).toBeCloseTo(-1.3, 5);
  });

  it('bounces low shots off vertical stone/timber bulkheads in Spela ball physics', () => {
    const bulkheads = createBulkheadCollider(
      [{ id: 'bh-17', kind: 'stone', waterId: 'pond-17', line: [[10, -5], [10, 5]] }],
      { waterList, heightAt: () => 3.6 },
    );
    expect(bulkheads.count).toBe(1);

    const world = {
      heightAt: () => 2.8,
      surfaceAt: () => 'fairway',
      bulkheads,
    };
    // Low line drive aimed straight into the x = 10 vertical stone wall (y = 3.2 < yMax 3.68)
    const shot = simulateShot(world, {
      start: [5, 3.2, 0],
      velocity: [18, 0.2, 0],
      spin: [0, 0, 0],
      seed: 1,
    });
    expect(shot.events.some(e => e.type === 'bulkhead' && e.kind === 'stone')).toBe(true);
    expect(shot.rest[0]).toBeLessThan(10.5);
  });
});

describe('waste_sand mapped surface feature', () => {
  it('maps waste_sand polygons (including interior fescue islands) to SURFACE.SHORE', () => {
    const outer = [[0, 0], [30, 0], [30, 20], [0, 20]];
    const island = [[10, 6], [16, 6], [16, 12], [10, 12]];
    const features = buildGroundSurfaceFeatures({
      holes: [],
      model: {
        scenery: {
          mappedFeatures: [{ id: 'castle-waste-1', kind: 'waste_sand', rings: [outer, island] }],
        },
      },
    });
    const waste = features.find(f => f.sourceId === 'castle-waste-1');
    expect(waste).toBeDefined();
    expect(waste.surface).toBe(SURFACE.SHORE);
    expect(waste.polygons[0].rings.length).toBe(2);
  });
});
