import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPack, inflateStream } from '../../../../../packages/course-pack/lib.mjs';
import { decodeHF } from '../codec.js';
import { createUpsalaArchitecture, validateUpsalaMeshPackage } from './upsala-architecture.mjs';

const root=new URL('../../../../../',import.meta.url);
const read=file=>JSON.parse(readFileSync(new URL(file,root),'utf8'));
const packet=read('apps/golf/src/engine/scenery/upsala-authored-meshes.json');
const plan=read('upsalabuild/facilities/models-2026-09-10/model-plan.json');

function packedCourse(slug) {
  const packed=readPack(readFileSync(new URL(`apps/golf/public/courses/${slug}/pack.bin`,root)));
  const model=JSON.parse(inflateStream(packed.sv));
  const spec=packed.header.HF0,heights=decodeHF(spec,inflateStream(packed.s0));
  const terrainH=(x,z)=>{
    const column=(x-spec.x0)/spec.dx,row=(z-spec.z0)/spec.dx;
    const i=Math.floor(column),j=Math.floor(row),tx=column-i,tz=row-j,k=j*spec.nx+i;
    if(i<0||j<0||i+1>=spec.nx||j+1>=spec.nz)return NaN;
    return (heights[k]*(1-tx)+heights[k+1]*tx)*(1-tz)+
      (heights[k+spec.nx]*(1-tx)+heights[k+spec.nx+1]*tx)*tz;
  };
  return {model,terrainH};
}

describe('published Upsala Blender mesh contract',()=>{
  it('covers the frozen 12 assets /19 reference parts with exactly13 source replacements',()=>{
    const validated=validateUpsalaMeshPackage(packet);
    expect(validated.assets).toHaveLength(12);
    expect(packet.assets.map(a=>a.id).sort()).toEqual(plan.assets.map(a=>a.id).sort());
    expect(packet.assets.reduce((n,a)=>n+a.referenceOutlines.length,0)).toBe(19);
    expect(packet.assets.reduce((n,a)=>n+a.replaces.length,0)).toBe(13);
    for(const asset of packet.assets) {
      const source=plan.assets.find(a=>a.id===asset.id);
      expect(asset.replaces).toEqual(source.replaces);
      expect(asset.renderOnBuildingId).toBe(source.renderOnBuildingId);
      expect(asset.referenceOutlines.map(r=>r.sourceId).sort()).toEqual(
        source.features.map(f=>`${f.id}/municipal:${f.sourceId}`).sort());
      for(const outline of asset.referenceOutlines) {
        const original=source.features.find(f=>`${f.id}/municipal:${f.sourceId}`===outline.sourceId).ring;
        expect(outline.ring).toHaveLength(original.length);
        outline.ring.forEach((point,i)=>expect(Math.hypot(point[0]-original[i][0],point[1]-original[i][1])).toBeLessThan(.001));
      }
    }
  },30000);

  for(const [slug,build] of [['upsala','upsalabuild'],['upsala-mellanbanan','upsalamellanbuild']]) {
    it(`renders every asset against actual ${slug} pack source rings and shipped heights`,()=>{
      const {model,terrainH}=packedCourse(slug),original=JSON.stringify(model);
      expect(model.infra.buildings).toEqual(read(`${build}/course-model.json`).infra.buildings);
      const renderer=createUpsalaArchitecture(packet),emitted=[],details=[];
      const ctx={buildings:model.infra.buildings,terrainH,tri:(...t)=>emitted.push(t),L:()=>[.5,.5,.5]};
      for(const building of model.infra.buildings) {
        const detail=renderer.render({...ctx,building});
        if(detail)details.push(detail);
      }
      expect(renderer.status().state).toBe('ready');
      expect(details.filter(d=>d.disposition==='authored')).toHaveLength(12);
      expect(details.filter(d=>d.disposition==='source-suppressed')).toHaveLength(1);
      expect(details.reduce((sum,d)=>sum+d.triangles,0)).toBe(emitted.length);
      expect(emitted.length).toBeGreaterThan(1000);
      expect(emitted.length).toBeLessThan(100000);
      expect(emitted.every(triangle=>triangle.flat().every(Number.isFinite))).toBe(true);
      expect(JSON.stringify(model)).toBe(original);
    },30000);
  }

  it('keeps all assets out of source view with the real package',()=>{
    const {model,terrainH}=packedCourse('upsala'),renderer=createUpsalaArchitecture(packet),tri=()=>{throw new Error('source view emitted authored mesh');};
    for(const building of model.infra.buildings)expect(renderer.render({building,buildings:model.infra.buildings,
      terrainH,tri,L:()=>[1,1,1],sourceView:true})).toBeNull();
    expect(renderer.status().emittedAssetCount).toBe(0);
  },30000);
});
