/* The wild cover (wild-cover.mjs; docs/visual-wild-cover-2026-09-26.md): the woods'
   floor under the near trees and the summer's flowers in the rough -- where they
   grow, by what rule, how they are drawn and when they are left out, and how
   main.js plants them from what already stands. The pictures are the isolated
   check's (docs/graphics/wild-cover-2026-09-26/check-isolated.mjs). */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createForestFloor, createWildFlowers, fernGeometry, flowerClumpGeometry, flowerDriftAt, flowerKindAt, hash,
  plantFlowers, plantForestFloor, scrubGeometry, valueNoise, WILD_COVER } from './wild-cover.mjs';
import { paintedSeason } from './painted-world-lighting.mjs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('./wild-cover.mjs', import.meta.url), 'utf8');

/* a wood west of x = -40 and a fairway along x = 0, the hole's line down the middle */
const classify = (x, z) => ({
  forest: x < -40 ? 1 : x < -38 ? 0.5 : 0, fair: Math.abs(x) < 20 ? 1 : 0, green: 0, tee: 0, sand: 0,
  path: Math.abs(x + 60) < 1.5 ? 1 : 0, wet: z > 400 ? 1 : 0, dLine: Math.abs(x),
});
const standOf = (species, zone, x0 = -120, x1 = -44) => {
  const trees = [];
  for (let x = x0; x < x1; x += 4.5) for (let z = 0; z < 300; z += 4.5) trees.push(x, z, species, 2.5, zone);
  return trees;
};

describe('the forest floor', () => {
  it('grows only on the forest floor under the near trees: not on paths, mown ground or in water', () => {
    const trees = [...standOf('pine', 1), ...standOf('birch', 2, -300, -200)];
    const { scrub, fern, candidates } = plantForestFloor({ trees, classify, heightAt: () => 3, wetAt: (x, z) => z > 280 });
    expect(candidates).toBeGreaterThan(1000);
    for (const list of [scrub, fern]) {
      expect(list.length % 6).toBe(0);
      for (let k = 0; k < list.length; k += 6) {
        const c = classify(list[k], list[k + 2]);
        expect(c.forest).toBeGreaterThan(WILD_COVER.forest.forestAbove);
        expect(c.path).toBe(0);
        expect(list[k + 2]).toBeLessThanOrEqual(280);
        expect(list[k + 1]).toBe(3);
      }
    }
    expect(scrub.length / 6).toBeGreaterThan(300);
    expect(fern.length / 6).toBeGreaterThan(100);
  });

  it('stands under each tree\'s crown, thicker within 90 m of a hole\'s line, and nowhere past 300 m', () => {
    const near = plantForestFloor({ trees: standOf('pine', 1), classify, heightAt: () => 0 });
    const far = plantForestFloor({ trees: standOf('pine', 2), classify, heightAt: () => 0 });
    const beyond = plantForestFloor({ trees: standOf('pine', 3), classify, heightAt: () => 0 });
    expect(near.candidates / far.candidates).toBeCloseTo(WILD_COVER.forest.perTree[0] / WILD_COVER.forest.perTree[1], 1);
    expect(beyond.candidates).toBe(0);
    /* every plant within its tree's crown */
    const trees = standOf('pine', 1), all = [...near.scrub, ...near.fern];
    for (let k = 0; k < all.length; k += 6) {
      let best = Infinity;
      for (let t = 0; t < trees.length; t += 5) best = Math.min(best, Math.hypot(all[k] - trees[t], all[k + 2] - trees[t + 1]));
      expect(best).toBeLessThanOrEqual(2.5 * WILD_COVER.forest.ring[1] + 1e-9);
    }
  });

  it('grows scrub under the conifers and ferns more under the birch and alder', () => {
    const share = species => {
      const { scrub, fern } = plantForestFloor({ trees: standOf(species, 1), classify, heightAt: () => 0 });
      return fern.length / (scrub.length + fern.length);
    };
    expect(share('pine')).toBeLessThan(0.2);
    expect(share('spruce')).toBeLessThan(0.3);
    expect(share('birch')).toBeGreaterThan(0.4);
    expect(share('alder')).toBeGreaterThan(0.55);
  });

  it('keeps half on a phone, and plants the same wherever it is run', () => {
    const trees = standOf('spruce', 1);
    const hi = plantForestFloor({ trees, classify, heightAt: () => 0 });
    const lo = plantForestFloor({ trees, classify, heightAt: () => 0, lowQuality: true });
    expect(lo.candidates / hi.candidates).toBeGreaterThan(0.42);
    expect(lo.candidates / hi.candidates).toBeLessThan(0.58);
    expect(plantForestFloor({ trees, classify, heightAt: () => 0 })).toEqual(hi);
  });
});

describe('the summer flowers', () => {
  const tufts = [];
  for (let x = 30; x < 330; x += 5.2) for (let z = 0; z < 300; z += 5.2) tufts.push(x, 0, z, 1, 0);

  it('stand in drifts beside the tussocks, a patch in the thick of one, and of one kind a drift', () => {
    const flowers = plantFlowers({ tufts, heightAt: () => 1 });
    expect(flowers.length % 7).toBe(0);
    const n = flowers.length / 7;
    expect(n).toBeGreaterThan(tufts.length / 5 * 0.15);
    let inDrift = 0;
    for (let k = 0; k < flowers.length; k += 7) {
      const [x, y, z, , , , kind] = flowers.slice(k, k + 7);
      expect(y).toBe(1);
      expect(kind).toBe(flowerKindAt(x, z));
      /* within the patch's reach of a tussock */
      let best = Infinity;
      for (let t = 0; t < tufts.length; t += 5) best = Math.min(best, Math.hypot(x - tufts[t], z - tufts[t + 2]));
      expect(best).toBeLessThanOrEqual(WILD_COVER.flowers.beside[1] + 1e-9);
      if (flowerDriftAt(x, z) > 0.3) inDrift++;
    }
    /* nearly all where the drifts are thick */
    expect(inDrift / n).toBeGreaterThan(0.85);
    /* every kind grows, each in its share */
    const counts = WILD_COVER.kinds.map(() => 0);
    for (let k = 6; k < flowers.length; k += 7) counts[flowers[k]]++;
    expect(counts.every(c => c > 0)).toBe(true);
  });

  it('take the fringe\'s clumps more sparingly, and the same wherever they are planted', () => {
    const edge = tufts.slice();
    const fromTufts = plantFlowers({ tufts }).length, fromEdge = plantFlowers({ edge }).length;
    expect(fromEdge / fromTufts).toBeLessThan(WILD_COVER.flowers.perEdge / WILD_COVER.flowers.perTuft);
    expect(plantFlowers({ tufts })).toEqual(plantFlowers({ tufts }));
  });

  it('stand only where a tussock could: off the mown ground, the paths and the woods, and out of the water', () => {
    /* tussocks and a fringe right along the fairway's edge (x = 20) and the wood's (x = -40) */
    const edge = [];
    for (let z = 0; z < 300; z += 0.8) edge.push(21, 0, z, 1, 0, -37.5, 0, z, 1, 0, 58.6, 0, z, 1, 0);
    const wetAt = (x, z) => z > 250;
    const all = plantFlowers({ tufts, edge, heightAt: () => 0 });
    const kept = plantFlowers({ tufts, edge, heightAt: () => 0, classify, wetAt });
    let offGround = 0;
    for (let k = 0; k < all.length; k += 7) {
      const c = classify(all[k], all[k + 2]);
      if (c.fair > 0.03 || c.path > 0.1 || c.forest > WILD_COVER.forest.forestAbove || all[k + 2] > 250) offGround++;
    }
    /* without the rule some clumps fall on the fairway, the path, into the wood or the water; with it none */
    expect(offGround).toBeGreaterThan(20);
    expect(kept.length / 7).toBe(all.length / 7 - offGround);
    for (let k = 0; k < kept.length; k += 7) {
      const c = classify(kept[k], kept[k + 2]);
      expect(c.fair).toBe(0);
      expect(c.path).toBe(0);
      expect(c.forest).toBeLessThanOrEqual(WILD_COVER.forest.forestAbove);
      expect(kept[k + 2]).toBeLessThanOrEqual(250);
    }
  });

  it('have drifts tens of metres across and kinds in larger patches', () => {
    expect(valueNoise(3.3, 7.1, 1)).toBe(valueNoise(3.3, 7.1, 1));
    expect(hash(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(hash(1, 2, 3)).toBeLessThan(1);
    /* neighbouring metres agree, as a drift should */
    let agree = 0, total = 0;
    for (let x = 0; x < 400; x += 7) for (let z = 0; z < 400; z += 7) {
      total++;
      if (flowerKindAt(x, z) === flowerKindAt(x + 2, z + 2)) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.85);
  });
});

describe('the shapes', () => {
  it('are small and cheap: a scrub and a fern under 20 triangles, a clump of seven flowers 21', () => {
    const count = g => g.getAttribute('position').count / 3;
    expect(count(scrubGeometry())).toBe(18);
    expect(count(fernGeometry())).toBe(18);
    expect(count(flowerClumpGeometry())).toBe(21);
    for (const g of [scrubGeometry(), fernGeometry(), flowerClumpGeometry()]) {
      g.computeBoundingBox();
      expect(g.boundingBox.min.y).toBeGreaterThanOrEqual(0);
      expect(g.boundingBox.max.y).toBeLessThan(0.5);
      expect(g.getAttribute('aWhere').itemSize).toBe(4);
    }
    /* a flower's head vertices mark its corners, facing the eye */
    const where = flowerClumpGeometry().getAttribute('aWhere');
    let heads = 0;
    for (let i = 0; i < where.count; i++) if (where.getY(i) === 1) { heads++; expect(Math.hypot(where.getZ(i), where.getW(i))).toBeGreaterThan(0.03); }
    expect(heads).toBe(7 * 6);
  });
});

describe('the draws', () => {
  const uSun = uniform(new THREE.Vector3(0, 1, 0));
  const DETAIL = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const floor = plantForestFloor({ trees: [...standOf('pine', 1), ...standOf('birch', 1, -900, -800)], classify, heightAt: () => 0 });

  it('draw each kind in tiles: culled by the eye\'s frustum, and left out past the kind\'s fade', () => {
    const { scrub, fern } = createForestFloor({ ...floor, DETAIL, uSun });
    expect(scrub.count).toBe(floor.scrub.length / 6);
    expect(scrub.tiles.reduce((n, tile) => n + tile.count, 0)).toBe(scrub.count);
    for (const tile of [...scrub.tiles, ...fern.tiles]) {
      expect([tile.frustumCulled, tile.castShadow, tile.receiveShadow]).toEqual([true, false, true]);
      expect(tile.geometry.getAttribute('aRoot').count).toBe(tile.count);
    }
    /* two woods 700 m apart: from one, the other's tiles are left out */
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(-80, 1.7, 150);
    scrub.update(camera);
    const drawn = scrub.tiles.filter(t => t.visible), left = scrub.tiles.filter(t => !t.visible);
    expect(drawn.length).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    for (const tile of left) expect(tile.boundingSphere.center.distanceTo(camera.position) - tile.boundingSphere.radius).toBeGreaterThanOrEqual(WILD_COVER.fade.scrub[1]);
  });

  it('leave every flower tile out in Höst, where the shader has shrunk them to nothing', () => {
    const flowers = plantFlowers({ tufts: [0, 0, 0, 1, 0, 3, 0, 5, 1, 0, 1, 0, 1, 1, 0, 2, 0, 2, 1, 0] });
    const part = createWildFlowers({ flowers: flowers.length ? flowers : [0, 0, 0, 1, 0, 0.5, 2], uSun });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.7, -5);
    try {
      expect(part.update(camera)).toBe(part.tiles.length);
      paintedSeason.value = 1;
      expect(part.update(camera)).toBe(0);
      expect(part.tiles.every(t => !t.visible)).toBe(true);
    } finally { paintedSeason.value = 0; }
    expect(part.update(camera)).toBe(part.tiles.length);
  });

  it('give each flower its kind\'s petals and eye, and nothing when none grow', () => {
    const flowers = plantFlowers({ tufts: [0, 0, 0, 1, 0, 3, 0, 5, 1, 0, 400, 0, 400, 1, 0] });
    const part = createWildFlowers({ flowers: flowers.length ? flowers : [0, 0, 0, 1, 0, 0.5, 2], uSun });
    const tile = part.tiles[0];
    expect(tile.geometry.getAttribute('aHead').itemSize).toBe(3);
    expect(tile.geometry.getAttribute('aEye').itemSize).toBe(3);
    expect(createWildFlowers({ flowers: [], uSun })).toBeNull();
    expect(createForestFloor({ scrub: [], fern: [], DETAIL, uSun })).toEqual({ scrub: null, fern: null });
  });

  it('shrink to their roots past their fade, the flowers in Höst too, and sway on the one wind', () => {
    expect(source).toMatch(/if \(summerOnly\) keep = keep\.mul\(float\(1\)\.sub\(paintedSeason\)\)/);
    expect(source).toMatch(/shrinkNode\(WILD_COVER\.fade\.flowers, true\)/);
    expect((source.match(/swayOnWind\(/g) || []).length).toBe(2);
    expect(WILD_COVER.fade.flowers[1]).toBeLessThan(WILD_COVER.fade.fern[0]);
  });
});

describe('main.js', () => {
  it('plants the wild cover from what already stands, where the ground cover grows, behind its befores', () => {
    expect(main).toMatch(/import \{ createForestFloor, createWildFlowers, plantFlowers, plantForestFloor \} from '\.\/engine\/wild-cover\.mjs';/);
    expect(main).toMatch(/const FOREST_FLOOR_ON = new URLSearchParams\(location\.search\)\.get\('forestfloor'\) !== '0';/);
    expect(main).toMatch(/const WILD_FLOWERS_ON = new URLSearchParams\(location\.search\)\.get\('wildflowers'\) !== '0';/);
    /* the tussocks and the fringe as planted, inside the cover's vegetation gate */
    expect(main).toMatch(/coverPlantings = \{ tufts: T, edge: ET, wetAt: coverWetAt \};\n\}/);
    expect(main).toMatch(/if \(coverPlantings && \(FOREST_FLOOR_ON \|\| WILD_FLOWERS_ON\)\)/);
    /* the near trees, zones A and B, from the tiers' own records */
    expect(main).toMatch(/if \(rec\.zone\[j\] === 1 \|\| rec\.zone\[j\] === 2\) near\.push\(imp\[j \* 6\], imp\[j \* 6 \+ 2\], species, imp\[j \* 6 \+ 4\] \* radius, rec\.zone\[j\]\);/);
    expect(main).toMatch(/plantForestFloor\(\{ trees: near, classify, heightAt: terrainH, wetAt: coverPlantings\.wetAt, lowQuality: LOWQ \}\)/);
    expect(main).toMatch(/plantFlowers\(\{ tufts: coverPlantings\.tufts, edge: coverPlantings\.edge, heightAt: terrainH, classify, wetAt: coverPlantings\.wetAt \}\)/);
    /* its own boot lap, the cover's left as it was */
    expect(main).toMatch(/lap\('ground cover \(tufts, bushes, stones, stumps\)'\);/);
    expect(main).toMatch(/lap\('wild cover \(forest floor, flowers\)'\);/);
  });

  it('updates its tiles each frame from the camera the frame draws', () => {
    expect(main).toMatch(/nearGrass\?\.update\(camera, renderer\.domElement\.height\);\s*wildCover\?\.update\(camera\);/);
    expect(main).toMatch(/wildCover: \(\) => \(\{ \.\.\.structuredClone\(stats\.wildCover\), drawnTiles:/);
  });
});
