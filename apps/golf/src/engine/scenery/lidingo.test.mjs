import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadArchitectureFixture } from '../../../../../lidingobuild/architecture-fixture.mjs';
import { measuredRoofGeometry } from '../measured-roof.mjs';
import { mappedPathSurface, buildGroundSurfaceFeatures } from '../surface-features.mjs';
import { SURFACE } from '../surface.js';
import { buildingArchitecture, courtyardArchitecture, BUILDING_IDS } from './lidingo-architecture.js';
import { applySurfaceAppearance, renderArchitecture } from './lidingo.js';
import { loadSceneryModule } from './index.js';
const {model,terrainH}=loadArchitectureFixture();
const buildings=model.infra.buildings.filter(b=>Object.values(BUILDING_IDS).includes(b.id));
const area=ring=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2);

describe('Lidingö complete display architecture',()=>{
  it('retains all original measured roof evidence and building footprints',()=>{
    const original=structuredClone(buildings);
    for(const b of buildings) {
      const before=measuredRoofGeometry(b.roofSurface,terrainH);
      const d=buildingArchitecture(b,terrainH);
      expect(d.sourceRoofUnchanged).toBe(true);
      expect(d.sourceRoofTriangles).toBe(b.roofSurface.triangleIndices.length/3);
      expect(measuredRoofGeometry(b.roofSurface,terrainH)).toEqual(before);
    }
    expect(buildings).toEqual(original);
    expect(buildings.reduce((n,b)=>n+b.roofSurface.triangleIndices.length/3,0)).toBe(7069);
  });
  it('covers each footprint with clean upward roof planes, without the TIN gaps',()=>{
    for(const b of buildings) {
      const roof=buildingArchitecture(b,terrainH).triangles.filter(t=>t.part==='roof-plane');
      expect(roof.length).toBeGreaterThan(0);
      expect(roof.length).toBeLessThan(30);
      expect(roof.reduce((n,t)=>n+area(t.points.map(p=>[p[0],p[2]])),0)).toBeCloseTo(area(b.ring),5);
      for(const {points:[a,b,c]} of roof)
        expect((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])).toBeGreaterThan(0);
    }
  });
  it('emits finite nondegenerate buildings and courtyard details within a bounded budget',()=>{
    const details=buildings.map(b=>buildingArchitecture(b,terrainH));
    details.push(courtyardArchitecture(model.scenery.mappedFeatures,model.infra.buildings,terrainH));
    let count=0;
    for(const d of details)for(const {points:[a,b,c],color} of d.triangles) {
      count++;
      expect([...a,...b,...c,color].every(Number.isFinite)).toBe(true);
      const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
      expect(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])).toBeGreaterThan(1e-8);
    }
    expect(count).toBeGreaterThan(3000);
    expect(count).toBeLessThan(6500); // Fewer than the old roofs alone.
    expect(details.find(d=>d.buildingId===BUILDING_IDS.restaurant).parts).toEqual(expect.arrayContaining(['blue-awnings','reception-glazing','closed-wall','roof-service-room','chimney','clock']));
    expect(details.at(-1).parts).toEqual(expect.arrayContaining(['putting-green-kerb','terrace-deck','terrace-stairs','terrace-supports']));
  });
  it('changes only the documented courtyard material and preserves its green island',()=>{
    const original=structuredClone(model.scenery),result=applySurfaceAppearance(model.scenery);
    expect(model.scenery).toEqual(original);
    const old=model.scenery.mappedFeatures.find(f=>f.id==='lidingo-courtyard-hardstanding-2019');
    const now=result.mappedFeatures.find(f=>f.id===old.id);
    expect(now.rings).toEqual(old.rings);
    expect(now.rings).toHaveLength(2);
    expect(now.sourceMaterial).toBe(old.material);
    expect(mappedPathSurface(now)).toBe(SURFACE.ASPHALT);
    /* The reviewed practice surfaces are display-only ADDITIONS, so the check
       here is what it always was -- every SOURCE feature passes through by
       identity -- plus the additions being exactly that: new ids, marked
       displayOnly, and nothing else appearing. */
    const added=result.mappedFeatures.filter(f=>f.displayOnly);
    for(const f of result.mappedFeatures.filter(f=>f.id!==old.id&&!f.displayOnly))expect(f).toBe(model.scenery.mappedFeatures.find(old=>old.id===f.id));
    expect(result.mappedFeatures).toHaveLength(model.scenery.mappedFeatures.length+added.length);
    for(const f of added)expect(model.scenery.mappedFeatures.some(s=>s.id===f.id)).toBe(false);
    const compiled=buildGroundSurfaceFeatures({model:{...model,scenery:result},holes:model.holes});
    const paved=compiled.find(f=>f.sourceId===now.id);
    expect(paved.surface).toBe(SURFACE.ASPHALT);
    expect(paved.polygons).toEqual([{rings:now.rings}]);
  });
  it('uses the shipping registry, scopes the replacement and appends to the existing batch',async()=>{
    const mod=await loadSceneryModule('lidingo');
    expect(mod.renderArchitecture).toBe(renderArchitecture);
    const b=buildings[0],emitted=[],colors=[];
    const r=mod.renderArchitecture({building:b,terrainH,tri:(...t)=>emitted.push(t),L:c=>{colors.push(c);return c;}});
    expect(emitted).toHaveLength(r.triangles);
    expect(new Set(colors).size).toBe(colors.length);
    for(const b of model.infra.buildings.filter(b=>!Object.values(BUILDING_IDS).includes(b.id)))expect(buildingArchitecture(b,terrainH)).toBeNull();
    expect(buildingArchitecture({...b,roofSurface:null},terrainH)).toBeNull();
    expect(()=>buildingArchitecture({...b,roofSurface:{...b.roofSurface,verticalCrs:'wrong'}},terrainH)).toThrow(/RH2000/);
    const main=readFileSync(new URL('../../main.js',import.meta.url),'utf8');
    expect(main).toContain("get('buildingGeometry') === 'source'");
    expect(main.indexOf('SCENERY?.renderArchitecture')).toBeLessThan(main.indexOf('const geometry = measuredRoofGeometry(b.roofSurface'));
  });
});
