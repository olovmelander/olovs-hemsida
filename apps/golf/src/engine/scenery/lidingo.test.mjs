import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeHF } from '../../../../../geobuild/lib.mjs';
import { measuredRoofGeometry } from '../measured-roof.mjs';
import { buildingLooks, clubhouseDetails, decorateMeasuredBuilding } from './lidingo.js';

const model = JSON.parse(readFileSync(new URL('../../../../../lidingobuild/course-model.json', import.meta.url)));
const { hf0 } = JSON.parse(readFileSync(new URL('../../../../../lidingobuild/heightfields.json', import.meta.url)));
const heights = decodeHF(hf0);
function terrainH(x,z) {
  const u=(x-hf0.x0)/hf0.dx,v=(z-hf0.z0)/hf0.dx,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  const h=(di,dj)=>heights[(j+dj)*hf0.nx+i+di];
  return (1-b)*((1-a)*h(0,0)+a*h(1,0))+b*((1-a)*h(0,1)+a*h(1,1));
}
const buildings=model.infra.buildings.filter(b=>buildingLooks[b.id]);
const restaurant=buildings.find(b=>b.id==='way/32262183');

describe('Lidingö photo-referenced clubhouse facade', () => {
  it('preserves measured footprints, roof triangles and partial wall support', () => {
    const source=structuredClone(buildings);
    for(const b of buildings) {
      const before=measuredRoofGeometry(b.roofSurface,terrainH);
      clubhouseDetails(b,terrainH);
      expect(measuredRoofGeometry(b.roofSurface,terrainH)).toEqual(before);
    }
    expect(buildings).toEqual(source);
  });

  it('builds finite, nondegenerate details on the actual sloping DTM within a phone-sized budget', () => {
    let count=0;
    for(const b of buildings) {
      const result=clubhouseDetails(b,terrainH);
      count+=result.triangles.length;
      expect(result.evidence).toBe('public-photo-appearance-estimate');
      for(const {points:[a,b,c],color} of result.triangles) {
        expect([...a,...b,...c,color].every(Number.isFinite)).toBe(true);
        const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);
        expect(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])).toBeGreaterThan(1e-7);
      }
    }
    expect(count).toBeGreaterThan(1000);
    expect(count).toBeLessThanOrEqual(3000);
    expect(clubhouseDetails(restaurant,terrainH).parts).toEqual(expect.arrayContaining([
      'restaurant-facade','blue-awnings','upper-glazing','reception-glazing','balcony-apron','clock',
    ]));
    expect(clubhouseDetails(buildings.find(b=>b.id==='way/32262176'),terrainH).parts)
      .toEqual(expect.arrayContaining(['pavilion-glazing','veranda-posts']));
  });

  it('withholds facade features when the retained roof has no support', () => {
    for(const b of buildings) {
      const unsupported=structuredClone(b);
      unsupported.roofSurface.triangleIndices=[];
      unsupported.roofSurface.boundaryWallSegments=[];
      expect(clubhouseDetails(unsupported,terrainH).triangles).toHaveLength(0);
    }
    const low=structuredClone(restaurant);
    for(const v of low.roofSurface.vertices) v.heightRH2000=35.9;
    expect(clubhouseDetails(low,terrainH).parts).not.toContain('blue-awnings');
    expect(()=>clubhouseDetails({...restaurant,roofSurface:{...restaurant.roofSurface,verticalCrs:'unknown'}},terrainH)).toThrow(/RH2000/);
  });

  it('limits the appearance to three source IDs and appends into the existing batch', () => {
    expect(buildings).toHaveLength(3);
    for(const b of model.infra.buildings.filter(b=>!buildingLooks[b.id]))
      expect(clubhouseDetails(b,terrainH)).toBeNull();
    expect(clubhouseDetails({...restaurant,roofSurface:null},terrainH)).toBeNull();
    const emitted=[],colors=[];
    const result=decorateMeasuredBuilding({building:restaurant,terrainH,
      tri:(...t)=>emitted.push(t),L:c=>{colors.push(c);return c;}});
    expect(emitted).toHaveLength(result.triangles);
    expect(new Set(colors).size).toBe(colors.length);
    expect(emitted.every(t=>t.length===4)).toBe(true);
  });
});
