import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GPU_GRASS, gpuGrassLayout } from './gpu-grass.mjs';
import { NEAR_GRASS_TOUR } from './near-grass.mjs';
import { SURFACE } from './surface.js';

const source = fs.readFileSync(new URL('./gpu-grass.mjs', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

describe('the grass grown on the GPU', () => {
  it('lays its rings out to some 75 m, each twice as coarse, the rough whole to past 30 m and gone by 62', () => {
    const L = gpuGrassLayout();
    expect(L.rings.map(r => r.cell)).toEqual([0.1, 0.2, 0.4, 0.8, 1.6]);
    expect(L.rings.map(r => r.half)).toEqual([5, 10, 20, 40, 80]);
    expect(L.reach).toBeGreaterThan(GPU_GRASS.fadeMetres[SURFACE.ROUGH]);
    expect(GPU_GRASS.fadeMetres[SURFACE.ROUGH] * GPU_GRASS.fadeFrom).toBeGreaterThan(30);
    expect(L.candidates).toBe(GPU_GRASS.rings * GPU_GRASS.cells ** 2 * GPU_GRASS.blades);
    /* the rings' density: 1600 blades a square metre near the eye, a quarter of that a ring further out */
    expect(GPU_GRASS.blades / GPU_GRASS.cell ** 2).toBeCloseTo(1600, 6);
    /* the ground grid covers the reach and a margin, whole metres either side */
    expect(L.clipTexels).toBeGreaterThanOrEqual(2 * L.reach);
  });
  it('draws two indirect strips, the near ones with more segments', () => {
    expect(GPU_GRASS.segments.near).toBeGreaterThan(GPU_GRASS.segments.far);
    expect(source).toContain('new IndirectStorageBufferAttribute(new Uint32Array([strip(G.segments.near), 0, 0, 0, 0, strip(G.segments.far), 0, 0, 0, 0]), 1)');
    expect(source).toContain("geometry.setIndirect(drawArgs, offset * 4);");
    /* each draw's count clamped to its capacity before it is drawn */
    expect(source).toContain('atomicStore(args.element(1), min(atomicLoad(args.element(1)), uint(capNear)));');
  });
  it('reads no camera in the compute pass: a dispatch has none', () => {
    const kernel = source.slice(source.indexOf('const generate = Fn('), source.indexOf('})().compute(layout.candidates'));
    expect(kernel).not.toContain('cameraPosition');
    expect(kernel).toContain('uEye');
  });
  it('keeps the wild grass the rings grow, and lays the mown turf thin and short', () => {
    for (const sid of [SURFACE.ROUGH, SURFACE.SEMI, SURFACE.HEATH, SURFACE.WETLAND]) expect(source).toContain('T.bladeMetres[sid]');
    expect(NEAR_GRASS_TOUR.bladeMetres[SURFACE.ROUGH]).toBeGreaterThan(GPU_GRASS.mownMetres[SURFACE.FAIRWAY] * 2);
    expect(GPU_GRASS.mownKeep).toBeLessThan(0.5);
    /* the mown blades fade within a few metres of the eye: laid a pixel wide they flickered further out */
    for (const sid of [SURFACE.FAIRWAY, SURFACE.TEE, SURFACE.FRINGE, SURFACE.GREEN]) expect(GPU_GRASS.fadeMetres[sid]).toBeLessThanOrEqual(8);
  });
  it('runs on WebGPU at high quality with the tour turf; the rings stay for the rest, and the befores', () => {
    expect(main).toContain("const gpuGrass = IS_GPU && !LOWQ && TOUR_TURF_ON && new URLSearchParams(location.search).get('grass') !== 'rings';");
    expect(main).toContain('nearGrass = (gpuGrass ? createGpuGrass : createNearGrass)({');
    expect(main).toContain("mown: new URLSearchParams(location.search).get('grassmown') !== '0',");
  });
});
