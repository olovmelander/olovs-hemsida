import { describe, it, expect } from 'vitest';
import { canopySampler } from './canopy-cover.mjs';
import { rasterizeGroundAtlas } from './atlas.js';
import { SURFACE } from './surface.js';

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
});
