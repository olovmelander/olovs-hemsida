import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three/webgpu';
import { DEFAULT_BAG, strategyForHole } from './caddie.js';
import { createShotEnvironment } from './shot-planner.mjs';
import { hyp, inRing, ptSegD } from './geom.js';
import { treeTemplateBounds } from './tree-bounds.mjs';

const rectangle = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const straightHole = () => ({
  par: 4, line: [[0, 0], [0, 320]],
  tees: { marks: [{ c: [0, 0] }, { c: [25, 10] }] },
  fairway: { rings: [rectangle(-24, 55, 24, 290)] },
  green: { c: [0, 320], ring: rectangle(-15, 305, 15, 335) },
});

describe('shot routing safety contracts', () => {
  it('leaves a lateral tee directly toward its landing area', () => {
    const strategy = strategyForHole(straightHole(), 1);
    expect(strategy.line[0]).toEqual([25, 10]);
    expect(strategy.line[1]).toEqual(strategy.primary);
    expect(strategy.primaryDistance).toBeGreaterThan(100);
    expect(strategy.primaryDistance).toBeCloseTo(hyp(strategy.origin, strategy.primary));
    expect(Math.abs(strategy.primary[0])).toBeLessThan(10);
  });

  it('targets the green centre directly when it is reachable and clear', () => {
    const hole = straightHole();
    hole.tees.marks[0].c = [60, 240];
    const strategy = strategyForHole(hole);
    expect(strategy.line).toEqual([[60, 240], [0, 320]]);
    expect(strategy.primaryDistance).toBe(100);
    expect(strategy.zones[0].kind).toBe('green');
  });

  it('routes every shot around an obstructing crown, including the next approach', () => {
    const tree = { x: 0, z: 85, radius: 5 };
    const strategy = strategyForHole(straightHole(), 0, DEFAULT_BAG, createShotEnvironment({ trees: [tree] }));
    expect(strategy.primary).not.toBeNull();
    for (let i = 1; i < strategy.line.length; i++) {
      expect(ptSegD(tree.x, tree.z, ...strategy.line[i - 1], ...strategy.line[i])).toBeGreaterThan(tree.radius + 2);
    }
  });

  it('does not publish a target when a tree wall closes every route', () => {
    const trees = Array.from({ length: 21 }, (_, i) => ({ x: -100 + i * 10, z: 30, radius: 8 }));
    const strategy = strategyForHole(straightHole(), 0, DEFAULT_BAG, createShotEnvironment({ trees }));
    expect(strategy.primary).toBeNull();
    expect(strategy.zones).toEqual([]);
    expect(strategy.line).toEqual([[0, 0]]);
  });

  it('checks narrow trunks between samples and rejects shots through buildings', () => {
    const trees = createShotEnvironment({ trees: [{ x: 0, z: 50.75, radius: 0.1 }], clearance: 0 });
    expect(trees.clearSegment([0, 0], [0, 100])).toBe(false);
    const buildings = createShotEnvironment({ buildings: [rectangle(-5, 30, 5, 40)] });
    expect(buildings.clearSegment([0, 0], [0, 100])).toBe(false);
    expect(buildings.clearSegment([20, 0], [20, 100])).toBe(true);
  });

  it('allows carrying a hazard but never landing in it', () => {
    const hole = straightHole();
    const water = rectangle(-40, 100, 40, 165);
    const env = createShotEnvironment({ landingAllowed: (x, z) => !inRing(x, z, water) });
    const strategy = strategyForHole(hole, 0, DEFAULT_BAG, env);
    expect(strategy.primary).not.toBeNull();
    for (const zone of strategy.zones) expect(inRing(...zone.point, water)).toBe(false);
    expect(env.clearSegment([0, 80], [0, 190])).toBe(true);
  });

  it('rejects terrain that intersects the nominal flight', () => {
    const env = createShotEnvironment({ terrainHeight: (x, z) => z > 45 && z < 55 ? 60 : 0 });
    expect(env.clearSegment([0, 0], [0, 100])).toBe(false);
  });

  it('never recommends an unreachable green when the bag is too short', () => {
    const hole = straightHole();
    hole.fairway.rings = [];
    const strategy = strategyForHole(hole, 0, [{ id: 'a', name: 'A', carry: 100 }, { id: 'b', name: 'B', carry: 80 }]);
    expect(strategy.primary).toBeNull();
  });

  it('uses every rendered tree variant and its actual instance scale for clearance', () => {
    const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const start = source.indexOf('function getStrategyEnvironment()');
    const body = source.slice(start, source.indexOf('\n}', start) + 2);
    const crown = new THREE.BoxGeometry(4, 10, 2), trunk = new THREE.BoxGeometry(0.5, 10, 0.5);
    const wide = new THREE.BoxGeometry(8, 10, 2);
    const ordinary = { parts: [{ geometry: crown }, { geometry: trunk }] };
    const variant = { parts: [{ geometry: wide }, { geometry: trunk }] };
    const context = { THREE, treeTemplateBounds, createShotEnvironment, strategyEnvironment: null,
      TREE_LOD: { tiers: [{ t: [null, ordinary, ordinary, variant] }], mats: [new Float32Array(new THREE.Matrix4().compose(
        new THREE.Vector3(10, 0, 0), new THREE.Quaternion(), new THREE.Vector3(3, 1, 1)).elements)] },
      terrainH: () => 0, kikKindAt: () => null,
      classify: () => ({ fair: 1, green: 0, path: 0 }), M: { infra: { buildings: [] } } };
    const environment = runInNewContext(`${body}\ngetStrategyEnvironment()`, context);
    // The wider tier reaches x=22 after the rendered scale. The unscaled
    // population's nominal crown radius would incorrectly permit this shot.
    expect(environment.clearSegment([21, -20], [21, 20])).toBe(false);
    expect(environment.clearSegment([40, -20], [40, 20])).toBe(true);
    crown.dispose(); trunk.dispose(); wide.dispose();
  });
});

describe('Upsala course landing contracts', () => {
  const model = JSON.parse(readFileSync(new URL('../../../../upsalabuild/course-model.json', import.meta.url), 'utf8'));
  it('keeps recommended landings on their own hole for every mapped tee', () => {
    let planned = 0;
    for (const hole of model.holes) for (let tee = 0; tee < hole.tees.marks.length; tee++) {
      const strategy = strategyForHole(hole, tee);
      expect(strategy.origin).toEqual(hole.tees.marks[tee].c);
      if (!strategy.primary) continue;
      planned++;
      expect(strategy.line[1]).toEqual(strategy.primary);
      for (const zone of strategy.zones) {
        const rings = zone.surface === 'green' ? [hole.green.ring] : hole.fairway.rings;
        expect(rings.some(ring => inRing(...zone.point, ring)), `hole ${hole.n}, tee ${tee}`).toBe(true);
        expect(zone.shotDistance).toBeCloseTo(hyp(zone.from, zone.point));
        expect(zone.shotDistance).toBeLessThanOrEqual(210 + 1e-6);
      }
    }
    expect(planned).toBeGreaterThanOrEqual(100);
  });
});
