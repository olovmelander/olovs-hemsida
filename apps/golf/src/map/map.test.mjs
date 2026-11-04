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
import { createCamera, createFlight } from './map-camera.mjs';
import { createDetailTexture } from './map-detail.mjs';
import { HOUSE_FLOATS, raiseHouses } from './map-houses.mjs';
import { buildMapCourse } from './map-course.mjs';
import { bakeTileRelief, decodeSlope, decodeTileHeights, sampleTile, SLOPE_LIMIT } from './map-height.mjs';
import { boxInFrustum, buildTileTree, frustumPlanes, PATCH_GRIDS, selectPatches, TILE_SAMPLES, TILE_SEGMENTS } from './map-lod.mjs';
import { bearingOf, contourInterval, elevationProfile, greenNumbers, principalBearing, shotReading } from './map-measure.mjs';
import { canopyAlpha, catalogueFor, createTreeRules, plantTile, SPECIES_RULES, speciesCount, TREE_FLOATS } from './map-trees.mjs';
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
  return buildMapCourse({ meta, geo: header.GEO, vectors, ground, course });
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

  it('paints no canopy from a cell the laser did not measure', () => {
    const alpha = canopyAlpha({ payload: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 1]), width: 2, height: 1 });
    expect(alpha[3]).toBe(0);
    expect(alpha[7]).toBeGreaterThan(200);
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
    expect(uphill).toEqual({ distance: 100, rise: 5, plays: 105 });
    expect(shotReading([0, 0], [100, 0], () => NaN)).toEqual({ distance: 100, rise: null, plays: null });
  });

  it('profiles the ground between two points', () => {
    const line = elevationProfile([0, 0], [90, 0], x => Math.abs(x - 45), 10);
    expect(line).toMatchObject({ distance: 90, low: 5, high: 45, rise: 0 });
    expect(elevationProfile([0, 0], [1, 0], () => NaN)).toBeNull();
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
