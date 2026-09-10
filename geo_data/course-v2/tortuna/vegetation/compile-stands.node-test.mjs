import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tortunaExclusionFeatures, assertTortunaStandInputs, assertRetainedCanopy, assertTortunaCanopyEvidence } from './compile-stands.mjs';
import { createRaster } from '../../../../packages/course-v2/vegetation/canopy-fields.mjs';
import { readFileSync } from 'node:fs';

test('range targets, shelter and practice sand all exclude old canopy without relabelling source features',()=>{
  const kinds=['range_target','range_shelter','practice_bunker','range_mat'];
  const source={type:'FeatureCollection',crs:{properties:{name:'EPSG:3006'}},features:kinds.map((kind,i)=>({
    type:'Feature',id:`facility-${i}`,properties:{kind,sourceId:'imagery-lm-ortho'},
    geometry:{type:'Polygon',coordinates:[[[597000,6615000],[597010,6615000],[597010,6615010],[597000,6615010],[597000,6615000]]]}
  }))};
  const before=structuredClone(source);
  assert.deepEqual(tortunaExclusionFeatures([source]).map(f=>f.kind),['practice','building','bunker','tee']);
  assert.deepEqual(source,before);
});

test('stand attachment rejects changed exclusion sources instead of silently adopting stale vegetation',()=>{
  const source=Buffer.from('accepted source');
  const sha256=createHash('sha256').update(source).digest('hex');
  const paths=['tortunabuild/mapping/playing-surfaces.geojson','tortunabuild/mapping/facilities.geojson',
    'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson','geo_data/course-v2/tortuna/mapping/water-runtime-epsg3006.geojson',
    'tortunabuild/mapping/environment.geojson','tortunabuild/mapping/building-roof-envelopes.geojson',
    'tortunabuild/mapping/environment-context-extra.geojson','tortunabuild/mapping/canopy-changes-2026.geojson'];
  const sources=['geo_data/course-v2/tortuna/vegetation/canopy-evidence.json',
    'tortunabuild/cache/canopy/chm.f32','tortunabuild/cache/canopy/chm.json',
    'tortunabuild/cache/canopy/ground.f32','tortunabuild/cache/canopy/ground.json',
    'geo_data/course-v2/tortuna/vegetation/expanded-canopy-evidence.json',
    'tortunabuild/cache/expanded-canopy/chm.f32','tortunabuild/cache/expanded-canopy/chm.json',
    'tortunabuild/cache/expanded-canopy/ground.f32','tortunabuild/cache/expanded-canopy/ground.json'];
  const index={inputs:paths.map(path=>({path,sha256})),
    terrainStage:{path:'tortunabuild/cache/terrain-stage/terrain-compilation.json',sha256},sourceFiles:sources.map(path=>({path,sha256}))};
  assert.doesNotThrow(()=>assertTortunaStandInputs(index,()=>source));
  assert.throws(()=>assertTortunaStandInputs(index,p=>p===paths[1]?Buffer.from('new shelter'):source),/rebuild stands explicitly/);
  assert.throws(()=>assertTortunaStandInputs({...index,inputs:index.inputs.slice(1)},()=>source),/inventory changed/);
  assert.throws(()=>assertTortunaStandInputs({...index,sourceFiles:[]},()=>source),/source inventory changed/);
});

test('canopy expansion preserves original cell bytes including voids and rejects shifted lattices',()=>{
  const original=createRaster({width:2,height:2,sampleSpacingMetres:1,originEasting:10,originNorthing:20,
    values:Float32Array.of(2,NaN,0,12)});
  const expanded=createRaster({width:4,height:4,sampleSpacingMetres:1,originEasting:9,originNorthing:21});
  expanded.values.set(original.values.subarray(0,2),5);
  expanded.values.set(original.values.subarray(2),9);
  assert.deepEqual(assertRetainedCanopy(original,expanded),{columnOffset:1,rowOffset:1,retainedSamples:4,exactBytes:true});
  assert.throws(()=>assertRetainedCanopy(original,{...expanded,originEasting:9.5}),/original lattice/);
  expanded.values[6]=0; // Missing evidence must not become a clearing.
  assert.throws(()=>assertRetainedCanopy(original,expanded),/changed retained source bytes/);
});

test('source receipts cannot relabel the capture date, provider asset or expanded lattice',()=>{
  for (const expanded of [false,true]) {
    const receipt=JSON.parse(readFileSync(new URL(expanded?'expanded-canopy-evidence.json':'canopy-evidence.json',import.meta.url)));
    assert.doesNotThrow(()=>assertTortunaCanopyEvidence(receipt,expanded));
    for (const mutate of [r=>{r.source.capturedAt='2026-05-02T12:00:00Z';},
      r=>{r.source.assets.data.sha256='a'.repeat(64);},r=>{r.grid.minEasting+=.5;},r=>{r.tiles--;}]) {
      const changed=structuredClone(receipt); mutate(changed);
      assert.throws(()=>assertTortunaCanopyEvidence(changed,expanded),/source evidence changed/);
    }
  }
});

test('observed roof envelopes exclude canopy while ground-cover observations retain trees',()=>{
  const source={type:'FeatureCollection',crs:{properties:{name:'EPSG:3006'}},features:[
    {type:'Feature',id:'roof',properties:{kind:'building_roof_envelope',sourceId:'imagery-lm-ortho'},geometry:{type:'Polygon',coordinates:[[[0,0],[5,0],[5,5],[0,5],[0,0]]]}},
    {type:'Feature',id:'ground-only',properties:{kind:'clearfell',canopyExclusion:false,tags:{building:'yes'}},geometry:{type:'Polygon',coordinates:[[[0,0],[5,0],[5,5],[0,5],[0,0]]]}},
  ]};
  const before=structuredClone(source), features=tortunaExclusionFeatures([source]);
  assert.deepEqual(features.map(f=>[f.id,f.kind]),[['roof','building']]);
  assert.deepEqual(source,before);
});
