import { expect, it } from 'vitest';
import { MeshStandardNodeMaterial, NearestFilter } from 'three/webgpu';
import { createCoastalTerrainMask } from './coastal-terrain-mask.mjs';

it('keeps the geographic surface authority through masking and cannot interpolate coverage onto dry texels', () => {
  const mask = createCoastalTerrainMask({ terrainCoverage: new Uint8Array([0,1,0,0]),
    width:2,height:2,spacing:32,bounds:{x0:-32,z0:-32},maximumCoveredTerrainHeight:.28 });
  expect([...mask.map.image.data]).toEqual([0,255,0,0]);
  expect(mask.map.minFilter).toBe(NearestFilter);
  expect(mask.map.magFilter).toBe(NearestFilter);
  expect(mask.map.generateMipmaps).toBe(false);
  const authority = {}, decorator = material => { material.userData.decorated=true; };
  Object.defineProperty(decorator,'v2SurfaceAuthority',{value:authority});
  const wrapped = mask.wrap(decorator), material = new MeshStandardNodeMaterial();
  expect(wrapped.v2SurfaceAuthority).toBe(authority);
  expect(wrapped(material)).toBe(material);
  expect(material.userData.decorated).toBe(true);
  expect(material.maskNode).toBeTruthy();
  expect(createCoastalTerrainMask(null)).toBe(null);
  expect(createCoastalTerrainMask({terrainCoverage:new Uint8Array(4)})).toBe(null);
});
