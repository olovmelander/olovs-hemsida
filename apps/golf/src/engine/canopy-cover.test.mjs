import { describe, it, expect } from 'vitest';
import { canopySampler } from './canopy-cover.mjs';
import { rasterizeGroundAtlas } from './atlas.js';
import { SURFACE } from './surface.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ringSD } from './geom.js';

const cover = { x0: 0, z0: 0, nx: 4, nz: 2, cell: 3, b64: btoa(String.fromCharCode(0b00101111, 0b11111111)) };
describe('observed canopy floor', () => {
  it('uses the cell edges, packed bit order and unknown exterior without extrapolation', () => {
    const sample = canopySampler(cover);
    expect([sample(1, 1), sample(4, 1), sample(7, 1), sample(10, 1)]).toEqual([3, 3, 2, 0]);
    expect([sample(-.01, 1), sample(12, 1), sample(1, 6), sample(NaN, 1)]).toEqual([0, 0, 0, 0]);
    expect(() => canopySampler({ ...cover, b64: '' })).toThrow(/Incomplete/);
  });
  it('paints observed woodland while preserving greens, hard surfaces and polygon islands', () => {
    const rect = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d],[a,b]];
    const raster = rasterizeGroundAtlas({ CORE: {x0:-1,z0:-1,x1:13,z1:7}, res:1, canopyFloor:cover, classesOnly:true,
      features: [{surface:SURFACE.GREEN,rings:[rect(0,3,3,6)]},
        {surface:SURFACE.GRAVEL,polygons:[{rings:[rect(3,3,12,6),rect(6,4,9,5)]}]}] });
    const at = (x,z) => raster.classes[(z+1)*14+x+1];
    expect(at(0,0)).toBe(SURFACE.FOREST);
    expect(at(6,0)).toBe(SURFACE.ROUGH);
    expect(at(10,0)).toBe(SURFACE.ROUGH);
    expect(at(-1,0)).toBe(SURFACE.ROUGH);
    expect(at(0,3)).toBe(SURFACE.GREEN);
    expect(at(4,4)).toBe(SURFACE.GRAVEL);
    expect(at(7,4)).toBe(SURFACE.FOREST);
  });
  it('keeps analytic fallback approaches and maintained ground clear of canopy floor', () => {
    const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const start = source.indexOf('const approaches = ');
    const end = source.indexOf('\n};', start) + 3;
    expect(start).toBeGreaterThan(0);
    const rect = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]];
    const context = { M: { scenery: { mappedFeatures: [{ kind: 'mown_approach',
      rings: [rect(0, 0, 6, 6), rect(2, 2, 4, 4)] }] } },
      SCENERY: { canopyFloor: true }, coverAt: () => 3, ringSD, groundAtlas: null,
      maintained: {}, classifyAnalytic: () => ({ green: 0, fringe: 0, tee: 0,
        fair: 0, sand: 0, path: 0, wet: 0, forest: 0, ...context.maintained }) };
    const classify = runInNewContext(`${source.slice(start, end)}\nclassify`, context);
    expect(classify(1, 1)).toMatchObject({ fair: 0.35, forest: 0 });
    expect(classify(3, 3)).toMatchObject({ fair: 0, forest: 1 });
    for (const kind of ['green', 'fringe', 'tee', 'fair', 'sand', 'path', 'wet']) {
      context.maintained = { [kind]: 1 };
      expect(classify(8, 8).forest, kind).toBe(0);
    }
    context.maintained = {};
    context.SCENERY.canopyFloor = false;
    expect(classify(8, 8).forest).toBe(0);
  });
});
