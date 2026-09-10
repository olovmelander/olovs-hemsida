import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createUpsalaArchitecture, loadUpsalaArchitecture, UPSALA_ARCHITECTURE_FRAME, validateUpsalaMeshPackage } from './upsala-architecture.mjs';

const clone = value => structuredClone(value);
const ringA = [[10,-290],[20,-290],[20,-280],[10,-280]];
const ringB = [[20,-290],[24,-290],[24,-286],[20,-286]];
function fixture() {
  return { schemaVersion:1, groundId:'upsala', frame:clone(UPSALA_ARCHITECTURE_FRAME), assets:[{
    id:'clubhouse-test', renderOnBuildingId:'club', replaces:[{id:'club',ring:clone(ringA)},{id:'annex',ring:clone(ringB)}],
    parts:[{name:'fixed-roof',color:0xa67546,positions:[10,39,-290,20,39,-290,15,42,-285],indices:[0,1,2]}],
    foundations:[{ring:clone(ringA),topHeightRH2000:35,color:0x999388}],
  }] };
}
function context(options={}) {
  const buildings=[{id:'club',ring:clone(ringA)},{id:'annex',ring:clone(ringB)},{id:'unrelated',ring:[[0,0],[1,0],[0,1]]}];
  const emitted=[];
  return {buildings,terrainH:()=>34.7,tri:(...triangle)=>emitted.push(triangle),L:()=>[.2,.3,.4],emitted,...options};
}
const draw = (renderer,ctx,id,extra={}) => renderer.render({...ctx,building:ctx.buildings.find(b=>b.id===id),...extra});

describe('Upsala authored geometry contract',()=>{
  it('rejects incompatible frames, swapped axes, malformed faces and duplicate replacement ownership',()=>{
    for(const mutate of [
      p=>{p.frame.mPerLon=55930.7;},
      p=>{p.frame.verticalDatum='ellipsoid';},
      p=>{p.assets[0].parts[0].positions=[-290,39,10,-290,39,20,-285,42,15];},
      p=>{p.assets[0].parts[0].positions[1]=NaN;},
      p=>{p.assets[0].parts[0].positions=p.assets[0].parts[0].positions.map((v,i)=>i%3===1?v-13.28:v);},
      p=>{p.assets[0].parts[0].indices[2]=9;},
      p=>{p.assets.push({...clone(p.assets[0]),id:'duplicate'});},
      p=>{p.assets[0].renderOnBuildingId='unknown';},
      p=>{p.assets[0].foundations=[];},
    ]) {const packet=fixture();mutate(packet);expect(()=>validateUpsalaMeshPackage(packet)).toThrow();}
  });

  it('validates all source IDs before suppressing an annex encountered before the render owner',()=>{
    const renderer=createUpsalaArchitecture(fixture()),ctx=context();
    ctx.buildings[0].ring[0][0]+=.01;
    expect(draw(renderer,ctx,'annex')).toBeNull();
    expect(draw(renderer,ctx,'club')).toBeNull();
    expect(ctx.emitted).toHaveLength(0);
    expect(renderer.status().state).toBe('partial-fallback');
  });

  it('rejects missing source records and accepts only submillimetre packing differences',()=>{
    const missing=context();missing.buildings=missing.buildings.filter(b=>b.id!=='annex');
    expect(draw(createUpsalaArchitecture(fixture()),missing,'club')).toBeNull();
    const rounded=context();rounded.buildings[0].ring[0][0]+=.0003;
    expect(draw(createUpsalaArchitecture(fixture()),rounded,'club').disposition).toBe('authored');
  });

  it('accepts an explicitly referenced new component without broadening the replaced ID set',()=>{
    const packet=fixture();
    packet.assets[0].parts.push({name:'reviewed-extension',color:0x222222,
      positions:[70,38,-290,75,38,-290,72,40,-286],indices:[0,1,2]});
    expect(()=>validateUpsalaMeshPackage(packet)).toThrow(/outside source/);
    packet.assets[0].referenceOutlines=[{sourceId:'B09/municipal:1390788',ring:[[69,-291],[76,-291],[76,-285],[69,-285]]}];
    const ctx=context(),result=draw(createUpsalaArchitecture(packet),ctx,'club');
    expect(result.meshTriangles).toBe(2);
    expect(result.replaces).toEqual(['club','annex']);
    expect(draw(createUpsalaArchitecture(packet),ctx,'unrelated')).toBeNull();
  });

  it('emits a multi-building asset once and never claims an unrelated ID',()=>{
    const renderer=createUpsalaArchitecture(fixture()),ctx=context();
    const before=clone(ctx.buildings);
    expect(draw(renderer,ctx,'annex')).toMatchObject({triangles:0,disposition:'source-suppressed'});
    expect(ctx.emitted).toHaveLength(0);
    const owner=draw(renderer,ctx,'club');
    expect(owner).toMatchObject({meshTriangles:1,disposition:'authored',sourceGeometryPreserved:true});
    expect(owner.foundationTriangles).toBeGreaterThan(0);
    const count=ctx.emitted.length;
    expect(draw(renderer,ctx,'club').triangles).toBe(0);
    expect(draw(renderer,ctx,'annex').triangles).toBe(0);
    expect(draw(renderer,ctx,'unrelated')).toBeNull();
    expect(ctx.emitted).toHaveLength(count);
    expect(ctx.buildings).toEqual(before);
    expect(renderer.status().emittedAssetCount).toBe(1);
  });

  it('keeps independent batches for Stora and Mellan and releases prepared geometry after each emission',()=>{
    const renderer=createUpsalaArchitecture(fixture()),stora=context(),mellan=context();
    draw(renderer,stora,'club');draw(renderer,mellan,'club');
    expect(mellan.emitted).toEqual(stora.emitted);
    expect(renderer.status().emittedAssetCount).toBe(2);
    expect(renderer.status().resourceOwnership).toContain('no separate GPU resources');
  });

  it('samples foundation bottoms along edges while retaining every authored roof height',()=>{
    const a=context(),sampled=[];
    const b=context({terrainH:(x,z)=>{sampled.push([x,z]);return 33.1+.02*(x-10);}});
    draw(createUpsalaArchitecture(fixture()),a,'club');
    draw(createUpsalaArchitecture(fixture()),b,'club');
    expect(a.emitted[0]).toEqual(b.emitted[0]);
    expect(b.emitted[0].slice(0,3)).toEqual([[10,39,-290],[20,39,-290],[15,42,-285]]);
    expect(sampled.some(([x,z])=>x===15&&z===-290)).toBe(true);
    const bottoms=b.emitted.slice(1).flatMap(triangle=>triangle.slice(0,3)).filter(p=>p[1]<35);
    expect(bottoms.length).toBeGreaterThan(0);
    for(const [x,y] of bottoms)expect(y).toBeCloseTo(32.9+.02*(x-10),8);
  });

  it('falls back transactionally for nonfinite terrain, wrong vertical placement or invalid material conversion',()=>{
    for(const options of [{terrainH:()=>NaN},{terrainH:()=>20},{L:()=>[NaN,0,0]}]) {
      const ctx=context(options),renderer=createUpsalaArchitecture(fixture());
      expect(draw(renderer,ctx,'annex')).toBeNull();
      expect(draw(renderer,ctx,'club')).toBeNull();
      expect(ctx.emitted).toHaveLength(0);
    }
  });

  it('leaves source-view buildings untouched and preserves generic fallback when the chunk fails',async()=>{
    const ctx=context();
    expect(draw(createUpsalaArchitecture(fixture()),ctx,'club',{sourceView:true})).toBeNull();
    for(const load of [async()=>{throw new Error('offline optional chunk');},async()=>({default:{bad:true}})]) {
      const renderer=await loadUpsalaArchitecture(load);
      expect(draw(renderer,ctx,'club')).toBeNull();
      expect(renderer.status().state).toBe('fallback');
    }
    expect(ctx.emitted).toHaveLength(0);
  });

  it('loads a valid optional module and isolates its immutable data from later caller mutations',async()=>{
    const packet=fixture(),renderer=await loadUpsalaArchitecture(async()=>({default:packet}));
    packet.assets[0].parts[0].positions[1]=100;
    const ctx=context();draw(renderer,ctx,'club');
    expect(ctx.emitted[0][0][1]).toBe(39);
  });

  it('wires both course slugs into the same source-aware hook and keeps source-view bypass',()=>{
    const registry=readFileSync(new URL('./index.js',import.meta.url),'utf8');
    expect(registry).toContain("upsala: () => import('./upsala.js')");
    expect(registry).toContain("'upsala-mellanbanan': () => import('./upsala.js')");
    const main=readFileSync(new URL('../../main.js',import.meta.url),'utf8');
    expect(main).toMatch(/!sourceBuildingView\s*&&\s*SCENERY\?\.renderClubhouse\?\.\(\{\s*building:b,\s*buildings:M\.infra\.buildings/);
  });
});
