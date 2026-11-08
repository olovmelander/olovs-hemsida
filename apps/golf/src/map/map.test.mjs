/* The map's rules, without a GPU: what it draws, how it reads a slope, what it
   tells a golfer, and that it stays a separate, small program. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseChunkEnvelope } from '../../../../packages/course-v2/chunk.mjs';
import { decodeStandField } from '../../../../packages/course-v2/stand-field.mjs';
import { nearestHole } from '../engine/caddie.js';
import { inRing, ringSD } from '../engine/geom.js';
import { planV2Vegetation } from '../engine/v2-vegetation.mjs';
import treeCatalogues from '../../public/models/map-trees.json';
import { softened } from './map-paint.mjs';
import { createCamera, createFlight, EYE_FOV_DEGREES } from './map-camera.mjs';
import { createDetailTexture } from './map-detail.mjs';
import { bakeHillShade, SHADE_SIZE, shadeKey, SHADOW_REACH } from './map-horizon.mjs';
import { HOUSE_FLOATS, raiseHouses } from './map-houses.mjs';
import { hitGreen, newRound, parseRound, roundTotals, scoreName, stablefordPoints, strokeKeys, strokesReceived } from './map-score.mjs';
import { buildMapCourse, validSurroundings } from './map-course.mjs';
import { createTeeWatch, nextHole, TEE_DWELL_MS } from './map-follow.mjs';
import { buildGreenGrid, GRID_VERTEX_FLOATS, PULSE_FLOATS, slopeAt, slopeColor } from './map-greengrid.mjs';
import { landRecord, outlineOverLand } from './map-land.mjs';
import { bakeTileRelief, decodeSlope, decodeTileHeights, sampleTile, SLOPE_LIMIT } from './map-height.mjs';
import { boxInFrustum, buildTileTree, frustumPlanes, PATCH_GRIDS, selectPatches, shareTrees, TILE_SAMPLES, TILE_SEGMENTS } from './map-lod.mjs';
import { bearingOf, contourInterval, elevationProfile, greenNumbers, groupBunkers, hazardsAhead, placeOnProfile, playedPath, sideOfPlay, principalBearing, STRIP_REST, stripX, waterShape, windWords, shotReading } from './map-measure.mjs';
import { canopyAlpha, catalogueFor, createTreeRules, plantTile, SPECIES_RULES, speciesCount, TREE_FLOATS } from './map-trees.mjs';
import { createFarBlocker, createFarSample, FAR_FOREST, farForestCells, farSpacing, pictureSampler, plantFarCell, readForestPicture } from './map-far-forest.mjs';
import { species as angsoSpecies } from '../engine/scenery/angso.js';
import { species as veckefjardenSpecies } from '../engine/scenery/veckefjarden.js';
import { species as visbySpecies } from '../engine/scenery/visby.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), 'utf8'));
const packs = readJson('courses/index.json').courses;
const index = readJson('courses/v2-index.json').courses;

function packFor(meta) {
  const bytes = fs.readFileSync(path.join(PUBLIC, meta.packUrl));
  const headerBytes = bytes.readUInt32LE(4);
  const header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString('utf8'));
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  return { header, vectors: JSON.parse(zlib.inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)).toString('utf8')) };
}

function courseFor(slug) {
  const meta = packs.find(entry => entry.slug === slug);
  const entry = index.find(item => item.slug === slug);
  const course = readJson(entry.manifest.url);
  const ground = readJson(course.groundManifest.url);
  const { header, vectors } = packFor(meta);
  const surroundings = meta.surroundings ? readJson(meta.surroundings.url) : null;
  return buildMapCourse({ meta, geo: header.GEO, vectors, ground, course, surroundings });
}

/* A small ground of the published shape: a 1024 m root over two levels. */
function miniGround() {
  const tile = (id, lod, parentId, minE, maxN, span) => ({
    id, lod, parentId, layers: {},
    bounds: { minEasting: minE, maxEasting: minE + span, minNorthing: maxN - span, maxNorthing: maxN, minHeightRH2000: 0, maxHeightRH2000: 10 },
  });
  const tiles = [tile('root', 2, null, 0, 1024, 1024)];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const id = `m${j}${i}`;
    tiles.push(tile(id, 1, 'root', i * 512, 1024 - j * 512, 512));
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      tiles.push(tile(`s${j}${i}${b}${a}`, 0, id, i * 512 + a * 256, 1024 - j * 512 - b * 256, 256));
    }
  }
  return { tiles, frame: { origin: { easting: 0, northing: 1024, heightRH2000: 0 } } };
}

const everyPlane = () => [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]];
const coverage = patches => patches.reduce((sum, { node, span }) => sum + (node.size * span) ** 2, 0);

describe('choosing tiles', () => {
  it('links the ground into a quadtree by position', () => {
    const { root, nodes } = buildTileTree(miniGround());
    expect(root.id).toBe('root');
    expect(root.children.map(child => child.id)).toEqual(['m00', 'm01', 'm10', 'm11']);
    expect(nodes.get('m01').children[2].id).toBe('s0110');
    expect(nodes.get('s0000')).toMatchObject({ x0: 0, z0: 0, size: 256, spacing: 1 });
  });

  it('refuses a tile with a missing parent', () => {
    const ground = miniGround();
    ground.tiles[1].parentId = 'nowhere';
    expect(() => buildTileTree(ground)).toThrow(/missing parent/);
  });

  const view = (root, isReady, height) => ({
    root, isReady, eye: [512, height, 512], planes: everyPlane(), pixelsPerRadian: 2000,
  });

  it('never leaves a hole while children are missing', () => {
    const { root } = buildTileTree(miniGround());
    const ready = new Set([root]);
    const { patches, wanted } = selectPatches(view(root, node => ready.has(node), 30));
    expect(coverage(patches)).toBe(1024 * 1024);
    expect(patches.every(patch => patch.node === root && patch.span === 0.5)).toBe(true);
    expect(wanted.map(item => item.node.id).sort()).toEqual(['m00', 'm01', 'm10', 'm11']);
  });

  it('covers the ground exactly once however many tiles are in', () => {
    const { root, nodes } = buildTileTree(miniGround());
    const ready = new Set([root, nodes.get('m00'), nodes.get('s0000'), nodes.get('s0001')]);
    const { patches } = selectPatches(view(root, node => ready.has(node), 30));
    expect(coverage(patches)).toBe(1024 * 1024);
    expect(patches.some(patch => patch.node.id === 's0000' && patch.span === 1)).toBe(true);
  });

  it('asks for a parent before its children and only the root first', () => {
    const { root } = buildTileTree(miniGround());
    const { patches, wanted } = selectPatches(view(root, () => false, 30));
    expect(patches).toEqual([]);
    expect(wanted.map(item => item.node.id)).toEqual(['root']);
  });

  it('stops at a coarse tile from far away and reaches 1 m up close', () => {
    const { root } = buildTileTree(miniGround());
    const far = selectPatches(view(root, () => true, 40000));
    expect(far.patches.map(patch => patch.node.lod)).toEqual([2]);
    const near = selectPatches(view(root, () => true, 60));
    expect(near.patches.some(patch => patch.node.lod === 0)).toBe(true);
  });

  it('skips ground outside the view and asks for none of it', () => {
    const { root } = buildTileTree(miniGround());
    const westOnly = [[-1, 0, 0, 400], ...everyPlane().slice(1)];
    const { patches, wanted } = selectPatches({ ...view(root, node => node === root, 30), planes: westOnly });
    expect(patches.length).toBe(2);
    expect(wanted.every(item => item.node.x0 < 512)).toBe(true);
  });

  it('holds a patch budget by coarsening the whole view', () => {
    const { root } = buildTileTree(miniGround());
    const { patches } = selectPatches({ ...view(root, () => true, 60), maxPatches: 6 });
    expect(patches.length).toBeLessThanOrEqual(6);
    expect(coverage(patches)).toBe(1024 * 1024);
  });

  it('never meshes finer than the shared grids', () => {
    const { root } = buildTileTree(miniGround());
    const { patches } = selectPatches({ ...view(root, () => true, 2), pixelsPerRadian: 40000 });
    for (const patch of patches) expect(PATCH_GRIDS).toContain(patch.grid);
  });

  it('reads the frustum planes a camera produces', () => {
    const camera = createCamera();
    Object.assign(camera.state, { width: 400, height: 800, distance: 500, tilt: 0.3 });
    camera.update();
    const planes = frustumPlanes(camera.derived.clip);
    expect(boxInFrustum(planes, -5, -5, -5, 5, 5, 5)).toBe(true);
    expect(boxInFrustum(planes, 9000, -5, 9000, 9010, 5, 9010)).toBe(false);
  });
});

describe('sharing out the trees', () => {
  const tiles = (count, reach) => Array.from({ length: count }, (_, k) => ({ id: k, count: 1000, reach }));

  it('draws the nearest in full, and a far wood thinner', () => {
    const [near, far] = shareTrees([{ count: 1000, reach: 100 }, { count: 1000, reach: 2000 }], 20000, 2000);
    expect(near.count).toBeGreaterThan(900);
    expect(far.count).toBeCloseTo(450, -1);
  });

  it('thins every wood when the budget runs short, rather than dropping the far ones', () => {
    const shared = shareTrees(tiles(100, 1000), 5000, 3000);
    expect(shared.length).toBe(100);
    expect(shared.at(-1).count).toBeGreaterThan(20);
    expect(shared.reduce((sum, tile) => sum + tile.count, 0)).toBeLessThanOrEqual(5000);
  });

  it('stays within the budget, however near everything is', () => {
    const shared = shareTrees(tiles(50, 100), 3000, 3000);
    expect(shared.reduce((sum, tile) => sum + tile.count, 0)).toBeLessThanOrEqual(3000);
  });
});

describe('the wood past the 1 m tiles', () => {
  const templates = [{ templateRadius: 7, templateHeight: 20 }, { templateRadius: 10, templateHeight: 18 }, { templateRadius: 5, templateHeight: 15 }];
  /* A measured wood as plantTile packs it: pines of 10-20 m, a crown a third of their height. */
  const measured = count => {
    const out = new Float32Array(count * TREE_FLOATS);
    for (let k = 0; k < count; k++) {
      const height = 10 + (k % 11);
      out.set([k, 0, k, 0, height / 3 / 7, height / 20, 0, 0.5], k * TREE_FLOATS);
    }
    return out;
  };
  const core = [-1024, -1024, 1024, 1024];
  const covered = (x, z) => x >= core[0] && x < core[2] && z >= core[1] && z < core[3];
  const sampled = (forestAt = () => 1) => {
    const sample = createFarSample({ templates });
    for (let k = 0; k < 4; k++) sample.add({ x0: k * 256 - 1024, z0: 0, size: 256 }, measured(400));
    sample.stemArea(forestAt);
    return sample;
  };
  const plant = (input = {}) => plantFarCell({
    cell: { x0: 1024, z0: 0, size: 512 }, core, covered, forestAt: () => 1, heightAt: () => 42,
    sample: sampled(), templates, ...input,
  });
  const each = (trees, visit) => {
    for (let k = 0; k < trees.length / TREE_FLOATS; k++) visit(trees.subarray(k * TREE_FLOATS, (k + 1) * TREE_FLOATS));
  };

  it('covers every cell of the ground no 1 m tile with stands covers, and none that one does', () => {
    for (const slug of ['veckefjarden', 'lidingo']) {
      const entry = index.find(item => item.slug === slug);
      const ground = readJson(readJson(entry.manifest.url).groundManifest.url);
      const { root, nodes } = buildTileTree(ground);
      const metre = [...nodes.values()].filter(node => node.lod === 0 && node.layers.stands);
      const { cells, core: box } = farForestCells(root, metre);
      const coreCells = ((box[2] - box[0]) / FAR_FOREST.cellMetres) * ((box[3] - box[1]) / FAR_FOREST.cellMetres);
      expect(cells.length, slug).toBe((root.size / FAR_FOREST.cellMetres) ** 2 - coreCells);
      for (const cell of cells) {
        expect(cell.x0 >= box[2] || cell.x0 + cell.size <= box[0] || cell.z0 >= box[3] || cell.z0 + cell.size <= box[1], `${slug} ${cell.id}`).toBe(true);
        expect(cell.maxY).toBeGreaterThanOrEqual(cell.minY);
      }
    }
  });

  it('stands a tree only where the forest picture has a wood, and never inside the 1 m tiles', () => {
    const trees = plant({ cell: { x0: 768, z0: 0, size: 512 }, forestAt: x => (x < 1180 ? 1 : 0) });
    expect(trees.length).toBeGreaterThan(0);
    each(trees, ([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(1024);
      expect(x).toBeLessThan(1180);
      expect(y).toBe(42);
    });
    expect(plant({ forestAt: () => 0 }).length).toBe(0);
  });

  it('keeps the trees off the houses and roads drawn out there', () => {
    const blocker = createFarBlocker({
      buildings: [[[1100, 100], [1140, 100], [1140, 140], [1100, 140]]],
      lines: [{ line: [[1024, 300], [1536, 300]], width: 6 }],
    });
    const cell = { x0: 1024, z0: 0, size: 512 };
    const trees = plant({ cell, blocked: blocker(cell) });
    let near = 0;
    each(trees, ([x, , z]) => {
      expect(x >= 1098 && x <= 1142 && z >= 98 && z <= 142, `a tree on the house at ${x}, ${z}`).toBe(false);
      expect(Math.abs(z - 300), `a tree on the road at ${x}, ${z}`).toBeGreaterThanOrEqual(5);
      if (Math.abs(z - 300) < 12) near++;
    });
    expect(near, 'the wood still meets the road').toBeGreaterThan(0);
    expect(blocker({ x0: 4096, z0: 4096, size: 512 })(4200, 4200)).toBe(false);
  });

  it('draws its trees from the measured wood, grown to cover the stems they stand for and no taller than the tallest', () => {
    const trees = plant();
    const shapes = new Set();
    each(measured(11), tree => shapes.add((tree[4] / tree[5]).toFixed(4)));
    each(trees, ([, , , , crown, height, species]) => {
      expect(species).toBe(0);
      expect(shapes.has((crown / height).toFixed(4)), "a measured tree's own shape").toBe(true);
      expect(height * 20).toBeLessThanOrEqual(20 + 1e-3);
      expect(height * 20).toBeGreaterThanOrEqual(10 - 1e-3);
    });
    expect(Array.from(plant())).toEqual(Array.from(trees));
  });

  it("thins with distance from the measured trees, as the simulator's far ring does", () => {
    expect(farSpacing(0)).toBe(10);
    expect(farSpacing(5000)).toBe(15);
    const near = plant().length, far = plant({ cell: { x0: 4096, z0: 0, size: 512 } }).length;
    expect(far / near).toBeCloseTo(100 / 225, 1);
  });

  it('waits for enough measured trees to draw from', () => {
    const sample = createFarSample({ templates });
    sample.add({ x0: 0, z0: 0, size: 256 }, measured(200));
    expect(sample.count).toBe(200);
    expect(sample.stemArea(() => 1)).toBeNull();
    expect(sampled().count).toBeGreaterThanOrEqual(FAR_FOREST.minimumSamples);
  });

  it("reads every ground's forest picture as the bake writes it", async () => {
    for (const groundId of [...new Set(index.map(entry => entry.groundId))]) {
      const record = landRecord(groundId);
      const picture = await readForestPicture(new Uint8Array(fs.readFileSync(path.join(PUBLIC, record.forest.file))));
      expect(picture.width, groundId).toBe(2049);
      const at = pictureSampler({ picture, x0: record.x0, z0: record.z0, spacing: record.spacing });
      let wood = 0, samples = 0;
      const levels = new Set();
      for (let z = -8000; z <= 8000; z += 97) {
        for (let x = -8000; x <= 8000; x += 97) {
          const cover = at(x, z);
          levels.add(Math.round(cover * 255));
          wood += cover > 0;
          samples++;
        }
      }
      for (const level of levels) expect([0, 85, 170, 255], groundId).toContain(level);
      expect(wood / samples, groundId).toBeGreaterThan(0.2);
      expect(wood / samples, groundId).toBeLessThan(0.9);
      expect(at(-9000, 0)).toBe(0);
    }
    await expect(readForestPicture(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow();
  }, 30000);
});

describe('tiles that show nothing', () => {
  it('reports a tile it passed through, or eviction would make the map reload it for ever', () => {
    const { root, nodes } = buildTileTree(miniGround());
    root.minY = 0;
    root.maxY = 100;
    const child = nodes.get('m00');
    child.minY = 90;
    child.maxY = 100;
    for (const node of nodes.values()) if (node !== root && node !== child) { node.minY = 0; node.maxY = 1; }
    /* Everything up to 50 m in view: the parent's range reaches it, the child's does not. */
    const planes = [[0, -1, 0, 50], ...everyPlane().slice(1)];
    const ready = new Set([root, child]);
    const { patches, visited, wanted } = selectPatches({ root, isReady: node => ready.has(node), eye: [256, 200, 256], planes, pixelsPerRadian: 4000 });
    expect(visited).toContain(child);
    expect(patches.some(patch => patch.node === child)).toBe(false);
    expect(wanted.some(item => item.node === child)).toBe(false);
  });
});

describe('reading a tile', () => {
  const grid = { width: 3, height: 2, heightOffsetMetres: 10, heightScaleMetres: 0.01, noDataValue: 65535, rowOrder: 'north-to-south', columnOrder: 'west-to-east' };
  const payload = values => new Uint8Array(new Uint16Array(values).buffer);

  it('decodes heights above the datum', () => {
    const { heights, min, max } = decodeTileHeights(payload([0, 100, 200, 300, 400, 500]), grid, 10);
    expect([...heights].map(v => +v.toFixed(2))).toEqual([0, 1, 2, 3, 4, 5]);
    expect([min, max].map(v => +v.toFixed(2))).toEqual([0, 5]);
  });

  it('never lets a missing sample reach the shader as NaN', () => {
    const { heights } = decodeTileHeights(payload([100, 65535, 200, 300, 400, 500]), grid);
    expect(heights.every(Number.isFinite)).toBe(true);
  });

  it('refuses a sample order it was not written for', () => {
    expect(() => decodeTileHeights(payload([0, 0, 0, 0, 0, 0]), { ...grid, rowOrder: 'south-to-north' })).toThrow(/sample order/);
  });

  const plane = (size, slopeX, slopeZ) => {
    const out = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out[j * size + i] = i * slopeX + j * slopeZ;
    return out;
  };

  it('carries a fairway slope and a bunker face through eight bits', () => {
    for (const slope of [0.015, 0.05, 0.4, 1.2]) {
      const baked = bakeTileRelief(plane(33, slope, -slope / 2), 33, 33, 1);
      const k = (16 * 33 + 16) * 4;
      expect(Math.abs(decodeSlope(baked[k]) - slope) / slope).toBeLessThan(0.12);
      expect(Math.abs(decodeSlope(baked[k + 1]) + slope / 2) / (slope / 2)).toBeLessThan(0.12);
    }
    expect(decodeSlope(255)).toBeCloseTo(SLOPE_LIMIT);
  });

  it('reads no relief on a plain slope, even at the edge of a tile', () => {
    const baked = bakeTileRelief(plane(33, 0.2, 0.1), 33, 33, 1);
    for (let p = 2; p < baked.length; p += 4) expect(Math.abs(baked[p] - 127.5)).toBeLessThan(1.5);
  });

  it('marks a hollow and a mound', () => {
    const ground = new Float32Array(33 * 33);
    ground[16 * 33 + 16] = -0.6;
    const hollow = bakeTileRelief(ground, 33, 33, 1)[(16 * 33 + 16) * 4 + 2];
    ground[16 * 33 + 16] = 0.6;
    const mound = bakeTileRelief(ground, 33, 33, 1)[(16 * 33 + 16) * 4 + 2];
    expect(hollow).toBeGreaterThan(200);
    expect(mound).toBeLessThan(55);
  });

  it('samples between the 1 m posts', () => {
    expect(sampleTile(new Float32Array([0, 2, 4, 6]), 0.5, 0.5, 2)).toBeCloseTo(3);
    expect(sampleTile(new Float32Array([0, 2, 4, 6]), 2, -1, 2)).toBeCloseTo(2);
  });
});

describe('planting trees', () => {
  const node = { id: 'l0/0/0', x0: 0, z0: 0, size: 256 };
  const heights = new Float32Array(TILE_SAMPLES * TILE_SAMPLES).fill(3);
  const ground = { frame: { origin: { easting: 100, northing: 900 } } };
  const standSection = { width: 64, height: 64, cellMetres: 4, rowOrder: 'north-to-south', columnOrder: 'west-to-east', heightScaleMetres: 0.25 };
  const stand = (fraction, flags) => {
    const payload = new Uint8Array(64 * 64 * 4);
    for (let k = 0; k < 64 * 64; k++) payload.set([fraction, 60, 80, flags], k * 4);
    return { payload, section: standSection };
  };
  const rules = {
    catalogue: { species: [{ templateRadius: 7, templateHeight: 20 }, { templateRadius: 10, templateHeight: 18 }, { templateRadius: 5, templateHeight: 15 }] },
    species: null,
    defaultSpecies: () => 1,
    shoreDistanceAt: () => null,
    excludeFor: () => null,
  };
  const plant = (input = {}) => plantTile({ node, heights, stand: null, objects: [], ground, rules, ...input });
  const record = { id: 'tree-1', class: 'tree', easting: 150, northing: 800, heightRH2000: 3, headingDegrees: 90, objectHeightMetres: 14, radiusMetres: 5 };

  it('plants exactly the trees the simulator plants', () => {
    const planted = plant({ stand: stand(230, 1), objects: [record] });
    const { instances } = planV2Vegetation({
      tiles: [{ id: node.id, objects: [record], stands: decodeStandField(stand(230, 1).payload, standSection), bounds: { minEasting: 100, maxNorthing: 900 } }],
    }, {
      mapper: { toWorld: (e, n) => [e - 100, 900 - n] },
      groundHeightAt: () => 3,
      defaultSpecies: () => 1,
    });
    const key = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;
    const ours = new Set();
    for (let k = 0; k < planted.length; k += TREE_FLOATS) ours.add(key(planted[k], planted[k + 2]));
    expect(instances.length).toBeGreaterThan(100);
    expect(planted.length / TREE_FLOATS).toBe(instances.length);
    for (const tree of instances) expect(ours.has(key(tree.x, tree.z))).toBe(true);
  });

  it('stands a forest on its ground, inside its tile, the same way twice', () => {
    const trees = plant({ stand: stand(230, 1) });
    expect(trees.length).toBeGreaterThan(0);
    expect([...trees]).toEqual([...plant({ stand: stand(230, 1) })]);
    for (let k = 0; k < trees.length; k += TREE_FLOATS) {
      expect(trees[k]).toBeGreaterThanOrEqual(0);
      expect(trees[k]).toBeLessThanOrEqual(256);
      expect(trees[k + 1]).toBe(3);
      expect(trees[k + 5]).toBeGreaterThan(0.3);
    }
  });

  it('plants nothing where the raster says not to', () => {
    expect(plant({ stand: stand(230, 1 | 4) }).length).toBe(0);
    expect(plant({ stand: stand(230, 0) }).length).toBe(0);
    expect(plant({ stand: stand(20, 1) }).length).toBe(0);
  });

  it('places a surveyed tree where it was measured, at its measured size', () => {
    const trees = plant({ objects: [record, { ...record, id: 'rock', class: 'rock' }] });
    expect(trees.length).toBe(TREE_FLOATS);
    expect(trees[0]).toBe(50);
    expect(trees[1]).toBe(3);
    expect(trees[2]).toBe(100);
    expect(trees[3]).toBeCloseTo(Math.PI / 2);
    expect(trees[4]).toBeCloseTo(5 / 10);
    expect(trees[5]).toBeCloseTo(14 / 18);
    expect(trees[6]).toBe(1);
  });

  it('keeps every tree off a played surface', () => {
    const trees = plant({ stand: stand(230, 1), objects: [record] });
    const clear = plant({ stand: stand(230, 1), objects: [record], rules: { ...rules, excludeFor: () => (x, z) => x < 128 && z < 256 } });
    expect(clear.length).toBeLessThan(trees.length);
    for (let k = 0; k < clear.length; k += TREE_FLOATS) expect(clear[k]).toBeGreaterThanOrEqual(128);
  });

  it('takes a cell the laser did not measure from what else is known of it', () => {
    const payload = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 1]);
    expect(canopyAlpha({ payload, width: 2, height: 1 })[3]).toBe(0);
    const alpha = canopyAlpha({ payload, width: 2, height: 1, unmeasured: (column, row) => (column === 0 && row === 0 ? 150 : 0) });
    expect(alpha[3]).toBe(150);
    expect(alpha[7]).toBeGreaterThan(200);
  });

  it('leaves a cell the course has excluded empty, whatever else is known', () => {
    const alpha = canopyAlpha({ payload: new Uint8Array([255, 0, 0, 5, 255, 0, 0, 4]), width: 2, height: 1, unmeasured: () => 255 });
    expect(alpha[3]).toBe(0);
    expect(alpha[7]).toBe(0);
  });

  it('keeps each course\'s species rule exactly as the simulator has it', () => {
    const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const RES = [{ ring, bb: { x0: -10, z0: -10, x1: 10, z1: 10 } }];
    const originals = { angso: angsoSpecies, veckefjarden: veckefjardenSpecies, visby: visbySpecies };
    for (const [ground, original] of Object.entries(originals)) {
      for (let k = 0; k < 400; k++) {
        const input = { r: (k * 0.6180339) % 1, h: k % 60, x: k % 2 ? 0 : 50, z: 0, ringSD, RES, extended: k % 3 > 0 };
        expect(SPECIES_RULES[ground](input), ground).toBe(original(input));
      }
    }
    expect(speciesCount('veckefjarden-korthalsbanan')).toBe(5);
    expect(speciesCount('visby')).toBe(3);
  });

  it('follows a course\'s own species rule on real ground, off its fairways', () => {
    const course = courseFor('veckefjarden');
    const courseRules = createTreeRules(course);
    const { nodes } = buildTileTree(course.ground);
    const tile = nodes.get(course.holes[0].tileIds[2]);
    const read = reference => {
      const { encodedPayload, codec, header } = parseChunkEnvelope(fs.readFileSync(path.join(PUBLIC, reference.url)));
      return { payload: codec === 'deflate-raw' ? new Uint8Array(zlib.inflateRawSync(encodedPayload)) : new Uint8Array(encodedPayload), header };
    };
    const terrain = read(tile.layers.terrain);
    const decoded = decodeTileHeights(terrain.payload, terrain.header.grid, course.ground.frame.origin.heightRH2000);
    const standChunk = read(tile.layers.stands);
    const records = JSON.parse(Buffer.from(read(tile.layers.objects).payload).toString('utf8')).records;
    const trees = plantTile({
      node: tile, heights: decoded.heights, ground: course.ground, rules: courseRules, objects: records,
      stand: { payload: standChunk.payload, section: standChunk.header.standField },
    });
    expect(trees.length).toBeGreaterThan(TREE_FLOATS * 50);
    const kinds = new Set();
    for (let k = 0; k < trees.length; k += TREE_FLOATS) {
      kinds.add(trees[k + 6]);
      for (const ring of course.holes[0].fairways) expect(inRing(trees[k], trees[k + 2], ring)).toBe(false);
    }
    expect(kinds.size).toBeGreaterThan(1);
    expect(Math.max(...kinds)).toBeLessThan(courseRules.catalogue.species.length);
  });
});

describe('the published tree pictures', () => {
  it('are every file the catalogue names, unchanged', () => {
    for (const { species } of Object.values(treeCatalogues.catalogues)) {
      expect(species.length).toBeGreaterThanOrEqual(3);
      for (const entry of species) for (const file of [entry.colour, entry.normal]) {
        const bytes = fs.readFileSync(path.join(PUBLIC, file.file));
        expect(bytes.length).toBe(file.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      }
    }
  });

  it('give each ground its catalogue, and Visby its coastal pine', () => {
    expect(catalogueFor('visby')).toBe(treeCatalogues.catalogues.visby);
    expect(catalogueFor('puttom')).toBe(treeCatalogues.catalogues.realistic);
    expect(catalogueFor('visby').species[1].colour.sha256).not.toBe(catalogueFor('puttom').species[1].colour.sha256);
  });

  it('match the frame grid the renderer maps them with', () => {
    const shaders = fs.readFileSync(path.join(HERE, 'map-gl.mjs'), 'utf8');
    for (const { species } of Object.values(treeCatalogues.catalogues)) {
      for (const entry of species) {
        expect(shaders).toContain(`const float FRAMES = ${entry.framesPerSide.toFixed(1)};`);
        expect(entry.size).toBe(entry.frameSize * entry.framesPerSide);
        expect(entry.templateRadius).toBeGreaterThan(0);
      }
    }
  });
});

describe('raising buildings', () => {
  const square = [[0, 0], [10, 0], [10, 8], [0, 8]];

  it('stands walls and a roof on the lowest corner', () => {
    const houses = raiseHouses([{ ring: square, height: 6 }], (x) => 20 + x / 10);
    const vertices = houses.length / HOUSE_FLOATS;
    expect(vertices).toBe(4 * 9);
    let top = -Infinity;
    for (let k = 0; k < houses.length; k += HOUSE_FLOATS) {
      expect(houses[k + 3]).toBe(20);
      top = Math.max(top, houses[k + 1]);
    }
    expect(top).toBeGreaterThan(6);
    expect(top).toBeLessThan(11);
  });

  it('points every wall outward, whichever way its ring winds', () => {
    for (const ring of [square, [...square].reverse()]) {
      const houses = raiseHouses([{ ring, height: 4 }], () => 0);
      for (let k = 0; k < houses.length; k += HOUSE_FLOATS) {
        if (houses[k + 5] !== 0) continue;
        const middle = [houses[k] - 5, houses[k + 2] - 4];
        expect(middle[0] * houses[k + 4] + middle[1] * houses[k + 6]).toBeGreaterThan(0);
      }
    }
  });

  it('closes a ring that repeats its first point, and skips one with no ground', () => {
    expect(raiseHouses([{ ring: [...square, square[0]], height: 5 }], () => 1).length).toBe(raiseHouses([{ ring: square, height: 5 }], () => 1).length);
    expect(raiseHouses([{ ring: square, height: 5 }], () => NaN).length).toBe(0);
  });
});

describe('softening a stepped outline', () => {
  it('rounds its stairs and stays within the shape', () => {
    const steps = [[0, 0], [10, 0], [10, 10], [20, 10], [20, 20], [0, 20]];
    const smooth = softened(steps);
    expect(smooth.length).toBe(steps.length * 4);
    for (const [x, z] of smooth) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(20);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(20);
    }
  });
});

describe('the surface grain', () => {
  it('tiles without a seam and keeps its contrast', () => {
    const { pixels, size } = createDetailTexture();
    expect(pixels.length).toBe(size * size * 4);
    for (let channel = 0; channel < 4; channel++) {
      let low = 255, high = 0, seam = 0, inner = 0;
      for (let j = 0; j < size; j++) {
        const left = pixels[(j * size) * 4 + channel], right = pixels[(j * size + size - 1) * 4 + channel];
        const next = pixels[(j * size + 1) * 4 + channel];
        seam += Math.abs(left - right);
        inner += Math.abs(left - next);
        low = Math.min(low, left);
        high = Math.max(high, left);
      }
      expect(seam).toBeLessThan(inner * 1.6);
      expect(high - low).toBeGreaterThan(40);
    }
  });
});

describe('what a golfer reads', () => {
  const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]].map(([x, z]) => [x + 150, z]);
  const green = { c: [150, 0], ring };

  it('gives front, middle and back of a green', () => {
    const { front, centre, back } = greenNumbers([0, 0], green);
    expect(centre).toBeCloseTo(150);
    expect(front).toBeCloseTo(140, 0);
    expect(back).toBeCloseTo(160, 0);
  });

  it('adds a climb to what a shot plays', () => {
    const uphill = shotReading([0, 0], [100, 0], (x) => x / 20);
    expect(uphill).toMatchObject({ distance: 100, rise: 5, plays: 105 });
    expect(shotReading([0, 0], [100, 0], () => NaN)).toMatchObject({ distance: 100, rise: null, plays: null });
  });

  it('plays a headwind long, a tailwind short and cold air long', () => {
    const north = [[0, 0], [0, -150]], level = () => 0;
    const still = shotReading(...north, level);
    const against = shotReading(...north, level, { windFromDeg: 0, windMs: 5, tempC: 21 });
    const behind = shotReading(...north, level, { windFromDeg: 180, windMs: 5, tempC: 21 });
    const cold = shotReading(...north, level, { windFromDeg: 0, windMs: 0, tempC: 5 });
    expect(against.head).toBeCloseTo(5);
    expect(against.plays).toBeGreaterThan(still.plays);
    expect(behind.plays).toBeLessThan(still.plays);
    expect(cold.plays).toBeGreaterThan(still.plays);
  });

  it('says what the wind does to a shot', () => {
    expect(windWords({ head: 4.2, cross: 0.3 })).toEqual(['motvind 4 m/s']);
    expect(windWords({ head: -3, cross: 0 })).toEqual(['medvind 3 m/s']);
    expect(windWords({ head: 0.4, cross: 2.6 })).toEqual(['3 m/s från höger']);
    expect(windWords({ head: 2, cross: -2 })).toEqual(['motvind 2 m/s', '2 m/s från vänster']);
    expect(windWords({ head: 0, cross: 0 })).toEqual([]);
  });

  it('profiles the ground along a path, evenly round a bend', () => {
    const straight = elevationProfile([[0, 0], [90, 0]], x => Math.abs(x - 45), 10);
    expect(straight).toMatchObject({ distance: 90, low: 5, high: 45, rise: 0 });
    const bent = elevationProfile([[0, 0], [100, 0], [100, 100]], (x, z) => x + z, 5);
    expect(bent.distance).toBe(200);
    expect(bent.points).toEqual([0, 50, 100, 150, 200]);
    expect(elevationProfile([[0, 0], [1, 0]], () => NaN)).toBeNull();
  });

  it('plays a hole from the tee in use to the middle of the green', () => {
    const hole = { line: [[0, 0], [0, -200], [100, -300]], green: { c: [130, -330] } };
    expect(playedPath(hole, [0, 0])).toEqual([[0, 0], [0, -200], [100, -300], [130, -330]]);
    /* a forward tee past the bend joins the line beyond it */
    expect(playedPath(hole, [40, -240])).toEqual([[40, -240], [100, -300], [130, -330]]);
    /* a line that already ends on the green gains nothing */
    expect(playedPath({ line: [[0, 0], [130, -330]], green: { c: [130, -330] } }, [0, 0]).length).toBe(2);
  });

  it('places a player on the strip, on the curve, wherever they stand beside the line', () => {
    const path = [[0, 0], [100, 0], [100, 100]];
    const profile = elevationProfile(path, (x, z) => (x + z) / 10, 21);
    const halfway = placeOnProfile([100, 0], path, profile);
    expect(halfway.share).toBeCloseTo(0.5);
    expect(halfway.height).toBeCloseTo(10);
    expect(halfway.along).toBeCloseTo(100);
    const inTheRough = placeOnProfile([50, 30], path, profile);
    expect(inTheRough.share).toBeCloseTo(0.25);
    expect(inTheRough.off).toBeCloseTo(30);
  });

  it('leaves the strip as it is on the tee and while the player walks up to its rest', () => {
    for (const share of [0, 0.1, 0.5, 1]) expect(stripX(share, 0)).toBeCloseTo(share);
    for (const share of [0, 0.1, 0.5, 1]) expect(stripX(share, STRIP_REST / 2)).toBeCloseTo(share);
  });

  it('holds the player at its rest and gives the rest of the strip to the ground ahead', () => {
    for (const you of [0.3, 0.6, 0.85]) {
      expect(stripX(you, you)).toBeCloseTo(STRIP_REST);
      expect(stripX(0, you)).toBe(0);
      expect(stripX(1, you)).toBeCloseTo(1);
      /* what is left always has at least its share of the hole */
      expect(1 - stripX(you, you)).toBeGreaterThanOrEqual(1 - you);
    }
    /* the last 60 m of a 400 m hole, nearly four fifths of the strip */
    const you = 340 / 400;
    expect(stripX(1, you) - stripX(you, you)).toBeCloseTo(1 - STRIP_REST);
  });

  it('never folds the strip back on itself', () => {
    for (const you of [0, 0.05, STRIP_REST, 0.5, 0.97, 1]) {
      let last = -1;
      for (let i = 0; i <= 200; i++) {
        const x = stripX(i / 200, you);
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(last);
        last = x;
      }
    }
  });

  it('keeps a player off the strip of a hole they are not on, and on it at both ends', () => {
    const path = [[0, 0], [200, 0]];
    const profile = elevationProfile(path, () => 0);
    expect(placeOnProfile([100, 400], path, profile, 150)).toBeNull();
    expect(placeOnProfile([100, 100], path, profile, 150)).not.toBeNull();
    expect(placeOnProfile([-40, 0], path, profile).share).toBe(0);
    expect(placeOnProfile([260, 0], path, profile).share).toBe(1);
  });

  it('turns the map so play runs up the screen', () => {
    expect(bearingOf([0, 0], [0, -10])).toBeCloseTo(0);
    expect(bearingOf([0, 0], [10, 0])).toBeCloseTo(Math.PI / 2);
  });

  it('lays an overview along the long axis, never upside down', () => {
    const northSouth = Array.from({ length: 20 }, (_, i) => [i % 2, i * 100]);
    expect(Math.abs(principalBearing(northSouth))).toBeLessThan(0.05);
    const eastWest = northSouth.map(([x, z]) => [z, x]);
    expect(Math.abs(principalBearing(eastWest))).toBeCloseTo(Math.PI / 2, 1);
  });

  it('spaces contours for the zoom: slopes on a green, hills over a course', () => {
    expect(contourInterval(0.05)).toBe(0.25);
    expect(contourInterval(0.3)).toBe(2);
    expect(contourInterval(1.5)).toBe(10);
    expect(contourInterval(4)).toBe(20);
    expect(contourInterval(20)).toBe(50);
  });
});

describe('hazards ahead', () => {
  const square = (x, z, half = 5) => [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
  const path = [[0, 0], [0, -400]];
  const bunkers = rings => groupBunkers(rings);
  const ahead = input => hazardsAhead({ origin: [0, 0], path, bunkers: [], waters: [], ...input });

  it('gives a bunker its reach and its carry, nearest first', () => {
    const found = ahead({ bunkers: bunkers([square(20, -300), square(-20, -200)]) });
    expect(found.map(hazard => hazard.kind)).toEqual(['bunker', 'bunker']);
    expect(found[0].front).toBeGreaterThan(190);
    expect(found[0].front).toBeLessThan(200);
    expect(found[0].carry).toBeGreaterThan(205);
    expect(found[1].at).toEqual([20, -300]);
  });

  it('names the side each lies on, facing the green', () => {
    const found = ahead({ bunkers: bunkers([square(20, -300), square(-20, -200), square(0, -120)]) });
    expect(found.map(hazard => hazard.side)).toEqual(['mitt', 'vänster', 'höger']);
    expect(sideOfPlay([30, -50], path)).toBe('höger');
    expect(sideOfPlay([30, -50], [...path].reverse())).toBe('vänster');
  });

  it('counts a cluster of bunkers as one hazard', () => {
    expect(ahead({ bunkers: bunkers([square(20, -300), square(30, -300), square(20, -200)]) }).length).toBe(2);
  });

  it('forgets what the ball has passed and what is off on another hole', () => {
    const found = hazardsAhead({ origin: [0, -250], path, waters: [], bunkers: bunkers([square(20, -200), square(20, -320), square(200, -320)]) });
    expect(found.length).toBe(1);
    expect(found[0].at).toEqual([20, -320]);
  });

  it('stops at the five nearest', () => {
    const many = Array.from({ length: 9 }, (_, i) => square(25, -60 - i * 40));
    expect(ahead({ bunkers: bunkers(many) }).length).toBe(5);
  });

  it('gives water across the line a carry, and water beside it none', () => {
    const across = waterShape([[-80, -200], [80, -200], [80, -260], [-80, -260]]);
    const crossing = ahead({ waters: [across] });
    expect(crossing.length).toBe(1);
    expect(crossing[0].kind).toBe('water');
    expect(crossing[0].front).toBeGreaterThan(175);
    expect(crossing[0].front).toBeLessThan(200);
    expect(crossing[0].carry).toBeGreaterThan(250);
    expect(crossing[0].carry).toBeLessThan(265);
    const beside = waterShape([[12, -200], [80, -200], [80, -260], [12, -260]]);
    expect(ahead({ waters: [beside] })[0].carry).toBeNull();
  });

  it('says nothing of water at the player\'s feet that needs no carrying', () => {
    const beside = waterShape([[10, 20], [80, 20], [80, -12], [10, -12]]);
    expect(ahead({ waters: [beside] })).toEqual([]);
  });

  it('finds a pond halfway along a long straight hole', () => {
    const long = [[0, 0], [0, -900]];
    const pond = waterShape([[-30, -430], [30, -430], [30, -470], [-30, -470]]);
    const found = hazardsAhead({ origin: [0, 0], path: long, bunkers: [], waters: [pond] });
    expect(found.length).toBe(1);
    expect(found[0].carry).toBeGreaterThan(460);
  });

  it('leaves water that is nowhere near the hole out of it', () => {
    expect(ahead({ waters: [waterShape(square(900, -200, 40))] })).toEqual([]);
  });
});

describe('the camera at eye level', () => {
  it('keeps the map\'s lens until asked, and goes back to it', () => {
    const camera = createCamera();
    expect(camera.state.fov).toBe(30);
    camera.setLens(EYE_FOV_DEGREES, true);
    expect(camera.state).toMatchObject({ fov: EYE_FOV_DEGREES, atEyeLevel: true });
    camera.setLens();
    expect(camera.state).toMatchObject({ fov: 30, atEyeLevel: false });
  });

  it('widens with the lens, so a point stays where the eye expects it', () => {
    const camera = createCamera();
    Object.assign(camera.state, { width: 400, height: 800, distance: 120, tilt: 1.5, x: 0, y: 0, z: 0 });
    camera.update();
    const narrow = camera.derived.pixelsPerRadian;
    camera.setLens(EYE_FOV_DEGREES, true);
    camera.update();
    expect(camera.derived.pixelsPerRadian).toBeLessThan(narrow);
  });

  it('flies the lens with the view, and leaves it alone when a view has none', () => {
    const from = { x: 0, y: 0, z: 0, distance: 100, bearing: 0, tilt: 1, fov: 30 };
    const flight = createFlight(from, { ...from, fov: 50 }, 100);
    expect(flight.at(100).fov).toBeCloseTo(50);
    const { fov, ...plain } = from;
    expect(createFlight(from, plain, 100).at(100).fov).toBeUndefined();
    expect(fov).toBe(30);
  });
});

describe('the camera', () => {
  const camera = () => {
    const made = createCamera();
    Object.assign(made.state, { width: 400, height: 800 });
    made.update();
    return made;
  };

  it('puts the point it looks at in the middle of the screen', () => {
    const view = camera();
    Object.assign(view.state, { x: 100, y: 5, z: -40, distance: 600, tilt: 0.9, bearing: 1.1 });
    view.update();
    const middle = view.project(100, 5, -40);
    expect(middle.x).toBeCloseTo(200, 3);
    expect(middle.y).toBeCloseTo(400, 3);
  });

  it('has up the screen follow the bearing', () => {
    const view = camera();
    Object.assign(view.state, { bearing: Math.PI / 2, tilt: 0.4, distance: 500 });
    view.update();
    expect(view.project(100, 0, 0).y).toBeLessThan(400);
    expect(view.project(-100, 0, 0).y).toBeGreaterThan(400);
  });

  it('inverts its own projection on a plane', () => {
    const view = camera();
    Object.assign(view.state, { distance: 700, tilt: 1, bearing: 0.4 });
    view.update();
    const s = view.project(120, 0, 80);
    const [x, z] = view.onPlane(s.x, s.y, 0);
    expect(x).toBeCloseTo(120, 2);
    expect(z).toBeCloseTo(80, 2);
  });

  it('finds the ground under a tap on a hill, not behind it', () => {
    const view = camera();
    Object.assign(view.state, { distance: 700, tilt: 1 });
    view.update();
    const hill = (x, z) => 30 * Math.exp(-(x * x + z * z) / 20000);
    const s = view.project(0, hill(0, 0) * 2, 0);
    const [x, z] = view.pick(s.x, s.y, hill, 2);
    expect(Math.hypot(x, z)).toBeLessThan(1);
  });

  it('fits a hole inside the room the controls leave', () => {
    const view = camera();
    const insets = { top: 96, bottom: 196, left: 34, right: 96 };
    const points = [[0, 0, 0], [40, 12, -200], [0, 24, -420]];
    const fitted = view.fit(points, { bearing: 0, tilt: 0.9, insets });
    Object.assign(view.state, fitted);
    view.update();
    for (const [x, y, z] of points) {
      const s = view.project(x, y, z);
      expect(s.x).toBeGreaterThanOrEqual(insets.left - 2);
      expect(s.x).toBeLessThanOrEqual(400 - insets.right + 2);
      expect(s.y).toBeGreaterThanOrEqual(insets.top - 2);
      expect(s.y).toBeLessThanOrEqual(800 - insets.bottom + 2);
    }
  });

  it('frames a far hole from close in, as tapping the next hole with GPS on does', () => {
    const view = camera();
    Object.assign(view.state, { x: 0, y: 0, z: 0, distance: 120, tilt: 0.9, bearing: 0 });
    view.update();
    const points = [[0, 0, 0], [50, 8, -420], [20, 4, -460], [30, 6, -440]];
    const fitted = view.fit(points, { bearing: 2.4, tilt: 0.9, insets: { top: 96, bottom: 196, left: 34, right: 96 }, minDistance: 150 });
    for (const key of ['x', 'y', 'z', 'distance']) expect(Number.isFinite(fitted[key]), key).toBe(true);
    Object.assign(view.state, fitted);
    view.update();
    for (const [x, y, z] of points) {
      const s = view.project(x, y, z);
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(400);
    }
  });

  it('flies the short way round', () => {
    const flight = createFlight({ x: 0, y: 0, z: 0, distance: 100, bearing: 3.1, tilt: 1 }, { x: 0, y: 0, z: 0, distance: 400, bearing: -3.1, tilt: 1 }, 100);
    expect(Math.abs(flight.at(50).bearing - 3.14)).toBeLessThan(0.1);
    expect(flight.at(50).distance).toBeCloseTo(200, 0);
    expect(flight.at(1000).distance).toBeCloseTo(400);
    expect(flight.done(100)).toBe(true);
    expect(createFlight({ x: 0, y: 0, z: 0, distance: 1, bearing: 0, tilt: 0 }, { x: 5, y: 0, z: 0, distance: 1, bearing: 0, tilt: 0 }, 0).at(0).x).toBe(5);
  });
});

describe('the shadows of hills', () => {
  const node = { x0: 0, z0: 0, size: 256, spacing: 1 };
  const sunFromWest = [-0.97, 0.24, 0];
  const lit = (input = {}) => bakeHillShade({ node, sun: sunFromWest, exaggeration: 1, ceiling: 100, heightAt: () => 0, ...input });
  const at = (pixels, i, j) => pixels[j * SHADE_SIZE + i];
  /* a wall running north and south, 80 m west of the tile's middle */
  const ridge = height => (x) => (x > 40 && x < 56 ? height : 0);

  it('leaves level ground in the sun', () => {
    expect(lit().every(value => value === 255)).toBe(true);
  });

  it('lays a ridge\'s shadow behind it, away from the sun, and none before it', () => {
    const shade = lit({ heightAt: ridge(20) });
    const row = (SHADE_SIZE - 1) / 2;
    const behind = Math.round(90 / 256 * (SHADE_SIZE - 1)), before = Math.round(10 / 256 * (SHADE_SIZE - 1));
    expect(at(shade, behind, row)).toBeLessThan(40);
    expect(at(shade, before, row)).toBe(255);
  });

  it('ends the shadow, at the reach the map draws its relief with', () => {
    const plateau = x => (x < 56 ? 10 : 0);
    const shade = lit({ heightAt: plateau });
    const row = (SHADE_SIZE - 1) / 2;
    /* 10 m high under this sun reaches 40 m past the edge, and SHADOW_REACH times that */
    const end = 56 + 40 * SHADOW_REACH;
    expect(at(shade, Math.round((end - 30) / 256 * (SHADE_SIZE - 1)), row)).toBeLessThan(128);
    expect(at(shade, Math.round((end + 30) / 256 * (SHADE_SIZE - 1)), row)).toBe(255);
  });

  it('casts no longer under a dawn sun than an evening one', () => {
    const plateau = x => (x < 56 ? 10 : 0);
    const count = pixels => pixels.filter(value => value < 128).length;
    const evening = lit({ heightAt: plateau, sun: [-0.98, 0.2, 0] });
    const dawn = lit({ heightAt: plateau, sun: [-0.995, 0.1, 0] });
    expect(count(dawn)).toBe(count(evening));
  });

  it('draws longer shadows when the relief is drawn taller', () => {
    const count = pixels => pixels.filter(value => value < 128).length;
    expect(count(lit({ heightAt: ridge(10), exaggeration: 2 }))).toBeGreaterThan(count(lit({ heightAt: ridge(10), exaggeration: 1 })));
  });

  it('asks no more of unknown ground than to skip it', () => {
    expect(lit({ heightAt: () => NaN }).every(value => value === 255)).toBe(true);
  });

  it('keys a bake by the sun and the height it was drawn at', () => {
    expect(shadeKey([0.5, 0.2, 0.1], 2)).not.toBe(shadeKey([0.5, 0.2, 0.1], 3));
    expect(shadeKey([0.5, 0.2, 0.1], 2)).toBe(shadeKey([0.501, 0.2, 0.1], 2));
  });
});

describe('the greengrid', () => {
  const mainSource = fs.readFileSync(path.resolve(HERE, '../main.js'), 'utf8');
  const ring = [[-12, -12], [12, -12], [12, 12], [-12, 12]];
  const tilted = x => x * 0.02;

  it('takes its heat colours from the simulator, number for number', () => {
    const body = mainSource.match(/function slopeColor\(s\) \{[\s\S]*?\n\}/)[0];
    const original = new Function('clampf', `${body}; return slopeColor;`)((value, low, high) => Math.max(low, Math.min(high, value)));
    for (let s = 0; s < 0.13; s += 0.0007) {
      slopeColor(s).forEach((channel, k) => expect(channel).toBeCloseTo(original(s)[k], 9));
    }
  });

  it('moves its pulses by the simulator\'s rules', () => {
    for (const rule of ['const delta = 0.45;', 'speed: clampf(s * 14.0 + 0.35, 0.38, 1.6)', 'baseScale: clampf(0.85 + s * 5.0, 0.80, 1.30)',
      'travelDist: Math.min(dx, dz) * 1.15', 'const elevCycle = (curY * 1.35) % 1.0;', 'const fallLineCoord = ((cx * dirX + cz * dirZ) * 0.22) % 1.0;',
      'const envelope = Math.pow(sinU, 1.6);', 'if (s >= 0.003) {', 'const CELL = 1.0;', 'const SUB = 2;']) {
      expect(mainSource, `main.js changed: ${rule}`).toContain(rule);
    }
  });

  it('reads a slope in the sim\'s terms: downhill, and how steep', () => {
    const { s, dirX, dirZ } = slopeAt(3, 4, tilted);
    expect(s).toBeCloseTo(0.02);
    expect(dirX).toBeCloseTo(-1);
    expect(dirZ).toBeCloseTo(0);
  });

  it('lays a pulse in every readable metre of a green, all running downhill', () => {
    const grid = buildGreenGrid({ ring, heightAt: tilted });
    const count = grid.pulses.length / PULSE_FLOATS;
    expect(count).toBeGreaterThan(400);
    expect(count).toBeLessThanOrEqual(26 * 26);
    for (let k = 0; k < count; k++) {
      const pulse = grid.pulses.subarray(k * PULSE_FLOATS, (k + 1) * PULSE_FLOATS);
      expect(pulse[4]).toBeCloseTo(-1);
      expect(pulse[3]).toBeCloseTo(0.02);
      expect(pulse[7]).toBeGreaterThanOrEqual(0);
      expect(pulse[7]).toBeLessThan(1);
    }
    expect(grid.mean).toBeCloseTo(0.02);
    expect(grid.max).toBeCloseTo(0.02);
  });

  it('feathers out at the green\'s edge and draws nothing past it', () => {
    const grid = buildGreenGrid({ ring, heightAt: tilted });
    expect(grid.indices.length).toBeGreaterThan(0);
    const fades = [];
    for (let k = 6; k < grid.mesh.length; k += GRID_VERTEX_FLOATS) fades.push(grid.mesh[k]);
    expect(Math.max(...fades)).toBe(1);
    expect(Math.min(...fades)).toBe(0);
    const far = Math.max(...grid.indices);
    expect(far * GRID_VERTEX_FLOATS).toBeLessThan(grid.mesh.length);
  });

  it('has nothing to pulse on level ground, and no grid on ground that is not there', () => {
    const level = buildGreenGrid({ ring, heightAt: () => 12 });
    expect(level.pulses.length).toBe(0);
    expect(level.max).toBe(0);
    expect(buildGreenGrid({ ring, heightAt: () => NaN })).toBeNull();
  });
});

describe('the scorecard', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, index: i + 1 }));
  const hole = n => holes[n - 1];

  it('offers its keys around par, and keeps a higher score on the row', () => {
    expect(strokeKeys(4)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(strokeKeys(3)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(strokeKeys(5, 6)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(strokeKeys(4, 11)).toEqual([2, 3, 4, 5, 6, 11]);
  });

  it('counts fairways and greens in regulation from what was entered', () => {
    expect(hitGreen({ strokes: 4, putts: 2 }, 4)).toBe(true);
    expect(hitGreen({ strokes: 5, putts: 2 }, 4)).toBe(false);
    expect(hitGreen({ strokes: 4 }, 4)).toBe(false);
    const round = { ...newRound(), scores: {
      1: { strokes: 4, putts: 2, fairway: 'hit' },
      2: { strokes: 6, putts: 3, fairway: 'left' },
      3: { strokes: 5 },
    } };
    expect(roundTotals(round, holes)).toMatchObject({ fairways: 1, fairwaysTried: 2, greens: 1, greensTried: 2 });
    const short = holes.map(each => ({ ...each, par: 3 }));
    expect(roundTotals(round, short).fairwaysTried).toBe(0);
  });

  it('gives strokes on the hardest holes first', () => {
    expect(strokesReceived(18, hole(18), holes)).toBe(1);
    expect(strokesReceived(10, hole(10), holes)).toBe(1);
    expect(strokesReceived(10, hole(11), holes)).toBe(0);
    expect(strokesReceived(20, hole(2), holes)).toBe(2);
    expect(strokesReceived(20, hole(3), holes)).toBe(1);
    expect(strokesReceived(54, hole(1), holes)).toBe(3);
    expect(strokesReceived(0, hole(1), holes)).toBe(0);
  });

  it('takes a plus handicap back on the easiest holes', () => {
    expect(strokesReceived(-2, hole(18), holes)).toBe(-1);
    expect(strokesReceived(-2, hole(17), holes)).toBe(-1);
    expect(strokesReceived(-2, hole(16), holes)).toBe(0);
  });

  it('ranks a nine-hole card among its own holes', () => {
    const nine = [{ n: 1, par: 4, index: 3 }, { n: 2, par: 3, index: 17 }, { n: 3, par: 5, index: 9 }];
    expect(strokesReceived(1, nine[0], nine)).toBe(1);
    expect(strokesReceived(1, nine[2], nine)).toBe(0);
  });

  it('has no strokes to give without an index or a handicap', () => {
    const unrated = [{ n: 1, par: 3, index: null }, { n: 2, par: 3, index: null }];
    expect(strokesReceived(10, unrated[0], unrated)).toBeNull();
    expect(strokesReceived(null, hole(1), holes)).toBeNull();
  });

  it('scores Stableford, and never below nil', () => {
    expect(stablefordPoints(4, 4, 0)).toBe(2);
    expect(stablefordPoints(4, 3, 0)).toBe(3);
    expect(stablefordPoints(4, 5, 1)).toBe(2);
    expect(stablefordPoints(4, 9, 0)).toBe(0);
  });

  it('names a score', () => {
    expect(scoreName(3, 4)).toBe('Birdie');
    expect(scoreName(4, 4)).toBe('Par');
    expect(scoreName(5, 4)).toBe('Bogey');
    expect(scoreName(1, 3)).toBe('Hole in one');
    expect(scoreName(9, 4)).toBe('+5');
  });

  it('adds a round up as it goes, with a struck hole worth nothing', () => {
    const round = { ...newRound(), handicap: 18, scores: { 1: { strokes: 5, putts: 2 }, 2: { strokes: 4, putts: 1 }, 3: { picked: true } } };
    expect(roundTotals(round, holes)).toMatchObject({ played: 3, strokes: 9, par: 8, putts: 3, points: 5, toPar: 1 });
  });

  it('adds strokes but no points without a handicap', () => {
    const round = { ...newRound(), scores: { 1: { strokes: 4 } } };
    expect(roundTotals(round, holes)).toMatchObject({ strokes: 4, toPar: 0, points: null });
  });

  it('comes back from storage, or starts afresh from anything else', () => {
    const round = { ...newRound(), scores: { 4: { strokes: 3 } } };
    expect(parseRound(JSON.stringify(round)).scores[4].strokes).toBe(3);
    for (const bad of [null, '', 'nonsense', '{"version":9}', '{"version":1,"scores":null}']) expect(parseRound(bad)).toBeNull();
  });
});

describe('what covers the ground', () => {
  const grounds = [...new Set(index.map(entry => entry.groundId))];

  it('has a picture of each ground, read from the ground as published', () => {
    for (const groundId of grounds) {
      const record = landRecord(groundId);
      expect(record, `${groundId}: rerun tools/bake-map-land.mjs`).toBeTruthy();
      const { groundManifest } = readJson(index.find(entry => entry.groundId === groundId).manifest.url);
      const ground = readJson(groundManifest.url);
      expect(record.terrain, `${groundId}: its terrain was republished, rerun tools/bake-map-land.mjs`).toBe(groundManifest.sha256);
      expect(record.ground).toBe(ground.frame.fingerprint);
      for (const picture of [record.water, record.forest]) {
        const bytes = fs.readFileSync(path.join(PUBLIC, picture.file));
        expect(bytes.length).toBe(picture.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(picture.sha256);
        expect(bytes.length, 'a picture stays small enough for a phone').toBeLessThan(260 * 1024);
      }
    }
  });

  it('does not paint Norrfällsviken\'s sea ring, which closes across the land south of the course', () => {
    const flagged = grounds.filter(groundId => landRecord(groundId).dry.length);
    expect(flagged).toEqual(['norrfallsviken']);
    const course = courseFor('norrfallsviken');
    const dry = course.features.water.filter(item => item.overLand);
    expect(dry.length).toBe(1);
    expect(dry[0].sea).toBe(true);
    expect(outlineOverLand('norrfallsviken', [[1, 2], [3, 4], [5, 6]])).toBe(false);
    expect(outlineOverLand('visby', [[1, 2], [3, 4], [5, 6]])).toBe(false);
  });

  it('draws what stands on the ground beside the course', () => {
    const veckefjarden = courseFor('veckefjarden');
    expect(veckefjarden.features.farBuildings.length).toBeGreaterThan(7000);
    expect(veckefjarden.features.railways.length).toBeGreaterThan(10);
    expect(veckefjarden.features.pitches.length).toBeGreaterThan(30);
    expect(veckefjarden.features.hayfields.length).toBe(1);
    expect(veckefjarden.features.stakes.length).toBeGreaterThan(500);
    expect(new Set(veckefjarden.features.stakes.map(stake => stake.colour)).size).toBeGreaterThan(1);
    for (const corners of veckefjarden.features.farBuildings.slice(0, 50)) {
      expect(corners.length).toBe(4);
      expect(corners.flat().every(Number.isFinite)).toBe(true);
    }
    expect(courseFor('lidingo').features.outOfBounds.length).toBe(6);
    expect(courseFor('upsala').features.bridges.length).toBe(4);
    expect(courseFor('ribbingsfors').features.clearfells.length).toBeGreaterThan(0);
  });

  it('refuses a surroundings record the simulator would refuse', () => {
    expect(validSurroundings({ version: 2, buildings: [], box: {}, inner: {} })).toBeNull();
    expect(validSurroundings({ version: 1, buildings: [] })).toBeNull();
    expect(validSurroundings(null)).toBeNull();
  });
});

describe('every layout', () => {
  for (const { slug } of index) {
    it(`${slug} has what a round needs`, () => {
      const course = courseFor(slug);
      const finite = point => Number.isFinite(point[0]) && Number.isFinite(point[1]);
      expect(course.holes.length).toBeGreaterThanOrEqual(9);
      for (const hole of course.holes) {
        expect(hole.line.length).toBeGreaterThanOrEqual(2);
        expect(hole.line.every(finite)).toBe(true);
        expect(hole.green.ring.length).toBeGreaterThanOrEqual(3);
        expect(finite(hole.green.c)).toBe(true);
        expect(hole.tees.length, `hole ${hole.n} has no tee positions`).toBeGreaterThan(0);
        expect(hole.tees.every(tee => finite(tee.point))).toBe(true);
        expect(hole.tileIds.length, `hole ${hole.n} names no 1 m tiles`).toBeGreaterThan(0);
        /* A hole's own numbers follow it: the first hole of a nearest-hole search
           from its own tee is that hole. */
        expect(nearestHole(hole.green.c, course.holes, hole.n).hole).toBe(hole.n);
      }
      expect(course.heightHigh).toBeGreaterThan(course.heightLow);
      const bunkers = course.holes.reduce((sum, hole) => sum + hole.bunkers.length, 0) + course.features.otherBunkers.length;
      expect(bunkers, 'a short layout keeps its bunkers in the scenery').toBeGreaterThan(0);
    });
  }

  it('changes hole on every tee of every next hole, on every layout', () => {
    for (const { slug } of index) {
      const { holes } = courseFor(slug);
      for (const hole of holes) {
        const next = holes[nextHole(hole.n, holes.length) - 1];
        for (const tee of next.tees) {
          const watch = createTeeWatch();
          const at = (point, now) => watch.update({ point, accuracy: 5, now, holes, shown: hole.n, playing: hole.n });
          at(hole.green.c, 0);
          at(tee.point, 1);
          expect(at(tee.point, TEE_DWELL_MS + 2), `${slug}: from hole ${hole.n} on to its next tee`).toBe(next.n);
        }
      }
    }
  });

  it('stays on a hole while the player waits on its own tee, on every layout', () => {
    for (const { slug } of index) {
      const { holes } = courseFor(slug);
      for (const hole of holes) {
        for (const tee of hole.tees) {
          const watch = createTeeWatch();
          const at = now => watch.update({ point: tee.point, accuracy: 5, now, holes, shown: hole.n, playing: hole.n });
          at(0);
          expect(at(TEE_DWELL_MS * 4), `${slug}: waiting on the tee of hole ${hole.n}`).toBeNull();
        }
      }
    }
  });

  it('reaches every 1 m tile a hole names', () => {
    for (const { slug } of index) {
      const course = courseFor(slug);
      const { nodes } = buildTileTree(course.ground);
      for (const hole of course.holes) for (const id of hole.tileIds) {
        const node = nodes.get(id);
        expect(node?.lod, `${slug} ${id}`).toBe(0);
        expect(node.spacing).toBe(1);
        expect(node.size).toBe(TILE_SEGMENTS);
      }
    }
  });
});

describe('a separate, small program', () => {
  const sources = fs.readdirSync(HERE).filter(name => /\.m?js$/.test(name) && !name.endsWith('.test.mjs'));
  it('never imports the 3D engine or the player', () => {
    for (const name of sources) {
      const text = fs.readFileSync(path.join(HERE, name), 'utf8');
      expect(/from\s+['"]three/.test(text), `${name} imports three`).toBe(false);
      expect(/engine\/scenery\//.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), `${name} imports a scenery module, and three.js with it`).toBe(false);
      expect(/from\s+['"][^'"]*main\.js/.test(text), `${name} imports the player`).toBe(false);
      expect(/requestAnimationFrame\(\s*frame\s*\)/.test(text) && !/const invalidate/.test(text), `${name} runs a free loop`).toBe(false);
    }
  });

  it('enters through its own import call, so the chooser never pays for it', () => {
    const entry = fs.readFileSync(path.resolve(HERE, '../entry.js'), 'utf8');
    expect(entry).toMatch(/opensMap\(location\.search, isPhone\(\)\)[\s\S]*?await import\('\.\/map\/map-app\.js'\)/);
  });
});
