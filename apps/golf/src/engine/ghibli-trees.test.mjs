import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {loadGhibliTrees,playerTreeMeshTier,PLAYER_TREE_MESH_TIERS,GHIBLI_FOLIAGE_REVISION,VISBY_PINE_REVISION} from './ghibli-trees.mjs';
import {preparedTintAllowed} from './prepared-ground-tint.mjs';
import {preparedWaterAllowed} from './prepared-water.mjs';
import {preparedVistaAllowed} from './prepared-vista.mjs';
import {preparedScatterAllowed} from './prepared-scatter.mjs';
import {loadStudyTrees} from '../studies/tree-loader.mjs';
import {inspectBuildingGlb} from './authored-buildings.mjs';
const root=new URL('../../public/models/trees/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('ghibli-fluffy.json',root)));
const digest=b=>createHash('sha256').update(b).digest('hex');
function assetFetch(url){
  const file=new URL(String(url).split('/models/trees/')[1],root);
  return Promise.resolve(new Response(fs.readFileSync(file)));
}
describe('approved Ghibli foliage assets',()=>{
  it('ships bounded geometry-only meshes and one verified shared atlas per species',()=>{
    expect(manifest.species).toHaveLength(5);
    for(const s of manifest.species){
      const a=s.foliage.atlas,texture=fs.readFileSync(new URL(a.file,root));
      expect(digest(texture)).toBe(a.sha256);expect(texture.length).toBe(a.bytes);
      expect(texture.readUInt32BE(16)).toBe(512);expect(texture.readUInt32BE(20)).toBe(512);
      for(const v of s.variants){
        expect(v.templateHeight).toBeGreaterThan(8);expect(v.templateRadius).toBeGreaterThan(1);
        for(const [tier,r] of Object.entries(v.tiers)){
          const b=fs.readFileSync(new URL(r.file,root));expect(digest(b)).toBe(r.sha256);expect(b.length).toBe(r.bytes);
          const j=inspectBuildingGlb(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
          const triangles=j.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+j.accessors[p.indices].count/3,0);
          expect(triangles).toBe(r.tris);expect(triangles).toBeLessThanOrEqual(manifest.budgets[tier]);
          if(tier!=='lite')expect(j.meshes.some(m=>m.primitives.some(p=>p.attributes.TEXCOORD_0!=null))).toBe(true);
        }
      }
    }
  });
});
describe('production foliage loader',()=>{
  beforeEach(()=>vi.spyOn(THREE.TextureLoader.prototype,'loadAsync').mockImplementation(async()=>new THREE.Texture()));
  afterEach(()=>vi.restoreAllMocks());
  it('overlaps at most three asset fetches while retaining catalogue and variant order',async()=>{
    let active=0,peak=0;
    const fetchImpl=async(url)=>{
      if(String(url).includes('.json'))return assetFetch(url);
      active++;peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,String(url).endsWith('.png')?8:2));
      active--;
      return assetFetch(url);
    };
    const loaded=await loadGhibliTrees({courseSlug:'visby',fetchImpl});
    expect(peak).toBe(3);
    expect(loaded.species.map(s=>s.key)).toEqual(['gran','tall','björk','al','ek']);
    for(const s of loaded.species){
      const entry=loaded.manifest.species.find(e=>e.key===s.key);
      expect(s.variants.map(v=>v.seed)).toEqual(entry.variants.slice(0,4).map(v=>v.seed));
      expect(s.variants.every(v=>v.foliage===s.foliage&&v.hero&&v.foliage.map)).toBe(true);
    }
  });
  for(const courseSlug of ['puttom','visby']) it(`loads only real Hero meshes for production (${courseSlug})`,async()=>{
    const fetchImpl=vi.fn(assetFetch);
    // Historical study options cannot switch or downgrade the player catalogue.
    const loaded=await loadGhibliTrees({courseSlug,heroOnly:false,hero:false,design:'original',fetchImpl});
    const catalogue=loaded.manifest;
    const expected=new Set(catalogue.species.flatMap(s=>s.variants.map(v=>v.tiers.hero.file)));
    const meshRequests=fetchImpl.mock.calls.map(([url])=>String(url).split('/models/trees/')[1]).filter(url=>url.endsWith('.glb'));
    expect(new Set(meshRequests)).toEqual(expected);
    expect(loaded.summary.files).toBe(expected.size+5);
    expect(loaded.summary.tier).toBe('hero');expect(loaded.summary.hero).toBe(true);
    for(const s of loaded.species)for(const v of s.variants){
      expect(v.full).toBeUndefined();expect(v.decimated).toBeUndefined();expect(v.mesh).toBe(v.hero);
      const triangles=[v.hero.crown,v.hero.trunk].reduce((n,g)=>n+(g.index?.count??g.attributes.position.count)/3,0);
      expect(triangles).toBe(v.tris.hero);
      expect(v.hero.crown.attributes.uv.count).toBe(v.hero.crown.attributes.position.count);
      expect(v.trunkMean).toHaveLength(3);
      expect(v.trunkMean.every(Number.isFinite)).toBe(true);
    }
  });
  for(const courseSlug of ['puttom','visby']) it(`gives low quality only the lighter Full meshes, at Hero's height and radius (${courseSlug})`,async()=>{
    const fetchImpl=vi.fn(assetFetch);
    const loaded=await loadGhibliTrees({courseSlug,tier:'full',fetchImpl});
    const expected=new Set(loaded.manifest.species.flatMap(s=>s.variants.map(v=>v.tiers.full.file)));
    const meshRequests=fetchImpl.mock.calls.map(([url])=>String(url).split('/models/trees/')[1]).filter(url=>url.endsWith('.glb'));
    expect(new Set(meshRequests)).toEqual(expected);
    expect(loaded.summary.files).toBe(expected.size+5);
    expect(loaded.summary.tier).toBe('full');expect(loaded.summary.hero).toBe(false);
    for(const s of loaded.species)for(const v of s.variants){
      expect(v.hero).toBeUndefined();expect(v.decimated).toBeUndefined();expect(v.mesh).toBe(v.full);
      const box=new THREE.Box3();
      let triangles=0;
      for(const g of [v.full.crown,v.full.trunk]){
        g.computeBoundingBox();box.union(g.boundingBox);
        triangles+=(g.index?.count??g.attributes.position.count)/3;
      }
      expect(triangles).toBe(v.tris.full);
      // Under half of Hero's triangles, drawn at exactly the same size.
      expect(triangles).toBeLessThan(v.tris.hero/2);
      expect(box.max.y).toBeCloseTo(v.templateHeight,4);
      expect(Math.max(Math.abs(box.min.x),box.max.x,Math.abs(box.min.z),box.max.z)).toBeCloseTo(v.templateRadius,4);
      expect(v.full.crown.attributes.uv.count).toBe(v.full.crown.attributes.position.count);
      expect(v.trunkMean.every(Number.isFinite)).toBe(true);
    }
  });
  it('picks Full for low quality and Hero for high, with a comparison override',async()=>{
    expect(PLAYER_TREE_MESH_TIERS).toEqual(['hero','full']);
    expect(playerTreeMeshTier('',true)).toBe('full');
    expect(playerTreeMeshTier('?bana=puttom&q=lo',true)).toBe('full');
    expect(playerTreeMeshTier('',false)).toBe('hero');
    expect(playerTreeMeshTier('?treemesh=hero',true)).toBe('hero');
    expect(playerTreeMeshTier('?treemesh=full',false)).toBe('full');
    for(const value of ['lite','decimated','','1','HERO'])expect(playerTreeMeshTier(`?treemesh=${value}`,true)).toBe('full');
    await expect(loadGhibliTrees({tier:'lite',fetchImpl:assetFetch})).rejects.toThrow(/no lite tier/);
    for(const allowed of [preparedTintAllowed,preparedWaterAllowed,preparedVistaAllowed,preparedScatterAllowed])
      for(const value of ['hero','full'])expect(allowed(`?bana=puttom&q=lo&treemesh=${value}`)).toBe(true);
  });
  it('uses the coastal pine only at Visby, preserving the other species and every detail budget',async()=>{
    const coastal=JSON.parse(fs.readFileSync(new URL('ghibli-visby.json',root)));
    for(const s of coastal.species){
      if(s.key!=='tall')expect(s).toEqual(manifest.species.find(original=>original.key===s.key));
    }
    const fetchImpl=vi.fn(assetFetch);
    const loaded=await loadStudyTrees({courseSlug:'visby',hero:true,fetchImpl});
    expect(fetchImpl.mock.calls[0][0]).toBe(`/models/trees/ghibli-visby.json?v=${VISBY_PINE_REVISION}`);
    expect(loaded.summary.revision).toBe(VISBY_PINE_REVISION);
    expect(loaded.summary.files).toBe(26);
    expect(loaded.species[1].variants).toHaveLength(3);
    expect(loaded.species[1].foliage.key).toBe('tall');
    const pine=coastal.species.find(s=>s.key==='tall');
    expect(new Set(pine.variants.map(v=>v.tiers.hero.sha256)).size).toBe(3);
    for(const v of loaded.species[1].variants){
      for(const [tier,slot] of [['hero','hero'],['full','full'],['lite','decimated']]){
        const parts=v[slot],box=new THREE.Box3();
        let triangles=0;
        for(const g of [parts.crown,parts.trunk]){
          g.computeBoundingBox();box.union(g.boundingBox);
          triangles+=(g.index?.count??g.attributes.position.count)/3;
          expect(Array.from(g.attributes.position.array).every(Number.isFinite)).toBe(true);
        }
        expect(triangles).toBe(v.tris[tier]);
        expect(triangles).toBeLessThanOrEqual(coastal.budgets[tier]);
        expect(box.min.y).toBeCloseTo(0,4);
        expect(box.max.y).toBeCloseTo(v.templateHeight,4);
        expect(Math.max(Math.abs(box.min.x),box.max.x,Math.abs(box.min.z),box.max.z)).toBeCloseTo(v.templateRadius,4);
        expect(parts.crown.attributes.uv.count).toBe(parts.crown.attributes.position.count);
      }
    }
    const elsewhere=await loadGhibliTrees({courseSlug:'upsala',fetchImpl:assetFetch});
    expect(elsewhere.summary.revision).toBe(GHIBLI_FOLIAGE_REVISION);
    expect(elsewhere.species[1].variants).toHaveLength(1);
  });
  it('defaults to approved foliage, retaining UVs, custom normals and independent LOD buffers',async()=>{
    const loaded=await loadStudyTrees({hero:true,fetchImpl:assetFetch});
    expect(loaded.foliage).toBe(true);expect(loaded.summary.files).toBe(20);
    for(const s of loaded.species){
      expect(s.foliage.map).toBeInstanceOf(THREE.Texture);
      expect(s.foliage.map.flipY).toBe(false);
      expect(s.foliage.map.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(s.hero.crown.attributes.uv.count).toBe(s.hero.crown.attributes.position.count);
      expect(s.hero.crown.attributes.normal.count).toBe(s.hero.crown.attributes.position.count);
      expect(s.hero.crown).not.toBe(s.full.crown);expect(s.full.crown).not.toBe(s.decimated.crown);
      expect(Array.from(s.hero.crown.attributes.position.array).every(Number.isFinite)).toBe(true);
      for(const level of ['hero','full','decimated']){
        const box=new THREE.Box3();
        for(const part of ['crown','trunk']){const g=s[level][part];g.computeBoundingBox();box.union(g.boundingBox);}
        const normals=s[level].crown.attributes.normal;
        for(let i=0;i<normals.count;i++){
          expect(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))).toBeCloseTo(1,4);
        }
        expect(box.max.y).toBeCloseTo(s.templateHeight,4);
        expect(Math.max(Math.abs(box.min.x),box.max.x,Math.abs(box.min.z),box.max.z)).toBeCloseTo(s.templateRadius,4);
      }
    }
  });
  it('uses a new manifest cache key for the approved revision and reports what loaded',async()=>{
    const fetchImpl=vi.fn(assetFetch);
    const loaded=await loadGhibliTrees({fetchImpl});
    const [request,options]=fetchImpl.mock.calls[0];
    const url=new URL(request,'https://banvy.test');
    expect(url.pathname).toBe('/models/trees/ghibli-fluffy.json');
    expect(url.searchParams.get('v')).toBe(GHIBLI_FOLIAGE_REVISION);
    expect(options.cache).toBe('no-cache');
    expect(manifest.revision).toBe(GHIBLI_FOLIAGE_REVISION);
    expect(loaded.summary.revision).toBe(manifest.revision);
  });
  it('loads no close meshes with hero disabled and never shares mutable tier geometry',async()=>{
    const loaded=await loadStudyTrees({hero:false,fetchImpl:assetFetch});
    expect(loaded.summary.files).toBe(15);
    for(const s of loaded.species){
      expect(s.hero.crown).not.toBe(s.full.crown);
      expect(s.hero.crown.attributes.position.array).not.toBe(s.full.crown.attributes.position.array);
      expect(s.hero.crown.attributes.position.count).toBe(s.full.crown.attributes.position.count);
    }
  });
  it('rejects an unpainted catalogue before constructing player materials',async()=>{
    const invalid=structuredClone(manifest);
    delete invalid.species.find(s=>s.key==='gran').foliage;
    await expect(loadGhibliTrees({fetchImpl:async()=>Response.json(invalid)})).rejects.toThrow('lacks painted foliage');
    expect(THREE.TextureLoader.prototype.loadAsync).not.toHaveBeenCalled();
  });
  it('rejects corrupted atlas bytes before decoding a texture',async()=>{
    await expect(loadGhibliTrees({fetchImpl:async url=>String(url).endsWith('.png')?new Response(new Uint8Array(16)):assetFetch(url)})).rejects.toThrow('atlas checksum');
    expect(THREE.TextureLoader.prototype.loadAsync).not.toHaveBeenCalled();
  });
});
