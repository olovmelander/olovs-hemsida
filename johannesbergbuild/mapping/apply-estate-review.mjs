import {geometrySha256,validateRing,validateReviewEvidence} from './apply-ortho-review.mjs';
import {centroid,polyArea} from '../lib.mjs';

const allowed=/^\/(?:scenery\/(?:practiceGreens|greens|range)\/\d+|infra\/(?:buildings|paths|tracks|roads|parking)\/\d+\/(?:ring|line)|water\/\d+\/ring)$/;
const fail=message=>{throw new Error(`Johannesberg estate review: ${message}`);};
function slot(model,pointer) {
  if(typeof pointer!=='string'||!allowed.test(pointer))fail('unsupported geometry pointer');
  const parts=pointer.slice(1).split('/');const key=parts.pop();
  let parent=model;
  for(const part of parts) {if(parent?.[part]===undefined)fail(`missing ${pointer}`);parent=parent[part];}
  if(!Array.isArray(parent?.[key]))fail(`missing geometry ${pointer}`);
  return {parent,key};
}

/** Validate every target, then update shared estate vectors as one operation. */
export function applyEstateReview(model,review) {
  if(review?.schemaVersion!==1||review.groundId!=='johannesberg'||!Array.isArray(review.features))fail('wrong identity');
  const frame={origin:model.origin,mPerLat:model.mPerLat,mPerLon:model.mPerLon};
  if(JSON.stringify(frame)!==JSON.stringify(review.frame))fail('frame mismatch');
  const ids=new Set(),targets=new Set();
  const operations=review.features.map(f=>{
    if(typeof f.id!=='string'||ids.has(f.id)||f.status!=='accepted'||f.action!=='replace')fail('unaccepted/duplicate feature');ids.add(f.id);
    validateReviewEvidence(f);
    if(!/^[a-f0-9]{64}$/.test(f.originalRingSha256))fail('baseline hash required');
    const geometry=f.closed?f.ring:f.line;
    if(f.closed)validateRing(geometry,f.id);
    else if(!Array.isArray(geometry)||geometry.length<2||!geometry.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))||geometry.some((p,i)=>i&&JSON.stringify(p)===JSON.stringify(geometry[i-1])))fail('invalid path line');
    const paths=f.targetPaths??[f.modelPath];
    if(!Array.isArray(paths)||!paths.length||!paths.includes(f.modelPath))fail('primary target missing');
    for(const pointer of paths) {
      if(targets.has(pointer))fail('duplicate target');targets.add(pointer);
      const {parent,key}=slot(model,pointer),current=geometrySha256(parent[key]);
      if(current!==f.originalRingSha256&&current!==geometrySha256(geometry))fail(`${f.id}: baseline changed`);
      if((pointer.endsWith('/line')&&f.closed)||(pointer.endsWith('/ring')&&!f.closed))fail('ring/line mismatch');
    }
    return {f,paths,geometry};
  });
  const out=structuredClone(model);
  for(const {f,paths,geometry} of operations)for(const pointer of paths) {
    const {parent,key}=slot(out,pointer);parent[key]=structuredClone(geometry);
    if(!Array.isArray(parent)) {
      parent.prov='reviewed-lm-orthophoto';parent.reviewId=f.id;
      if(f.closed) {
        if(Object.hasOwn(parent,'area'))parent.area=Math.round(Math.abs(polyArea(geometry)));
        if(Array.isArray(parent.c))parent.c=centroid(geometry);
      }
    }
  }
  out.infra={...out.infra,preserveMappedBoundaries:true};
  return out;
}
