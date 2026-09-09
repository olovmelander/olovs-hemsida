/* Reviewed image boundaries are expressed in the frozen legacy frame. Never fit
 * a translation/rotation, slide a tee to a scorecard distance, or change terrain.
 * Source hashes and baseline geometry pins make rebuilds fail on stale reviews.
 */
import { createHash } from 'node:crypto';
import { centroid, polyArea, polyLen, pointInPoly, decodeHF } from '../lib.mjs';
import {assignTeeDisplayAnchors} from './tee-display-anchors.mjs';

export const geometrySha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = /^[a-f0-9]{64}$/;
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const require = (ok, message) => { if (!ok) throw new Error(`Johannesberg orthophoto: ${message}`); };
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on = (a,b,c) => Math.abs(cross(a,b,c)) < 1e-8 && c[0] >= Math.min(a[0],b[0])-1e-8 && c[0] <= Math.max(a[0],b[0])+1e-8 && c[1] >= Math.min(a[1],b[1])-1e-8 && c[1] <= Math.max(a[1],b[1])+1e-8;
const intersects = (a,b,c,d) => (cross(a,b,c)*cross(a,b,d) < 0 && cross(c,d,a)*cross(c,d,b) < 0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);

export function validateRing(ring, id = 'ring') {
  require(Array.isArray(ring) && ring.length >= 3 && ring.every(point), `${id}: finite polygon required`);
  require(!same(ring[0], ring.at(-1)), `${id}: use open rings`);
  require(new Set(ring.map(p => JSON.stringify(p))).size === ring.length, `${id}: duplicate vertex`);
  require(Math.abs(polyArea(ring)) > 0.1, `${id}: degenerate polygon`);
  for (let i=0; i<ring.length; i++) for (let j=i+1; j<ring.length; j++) {
    if (j === i+1 || (i === 0 && j === ring.length-1)) continue;
    require(!intersects(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length]), `${id}: self-intersection`);
  }
  return ring;
}

export function validateReviewEvidence(feature) {
  const e = feature.evidence;
  require(e?.sourceFiles?.length && e.sourceFiles.every(s => typeof s.path === 'string' && hash.test(s.sha256)), `${feature.id}: source image hashes required`);
  require(e.sourceCaptureDates?.length && e.sourceCaptureDates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d), `${feature.id}: exact capture dates required`);
  require(Number.isFinite(e.uncertaintyM) && e.uncertaintyM > 0 && typeof e.note === 'string' && e.note.length > 10, `${feature.id}: boundary interpretation and uncertainty required`);
}

function originalGeometry(hole, feature) {
  if (feature.kind === 'green') return hole.green.ring;
  if (feature.kind === 'fairway') return hole.fairway.rings;
  if (feature.kind === 'tees') return hole.tees.pads.map(p => p.ring);
  return (feature.kind === 'tee' ? hole.tees.pads : hole.bunkers)[feature.index]?.ring;
}

function interior(ring, old) {
  if (point(old) && pointInPoly(...old,ring)) return old;
  const c = centroid(ring);
  if (pointInPoly(...c,ring)) return c;
  for (let i=0;i<ring.length;i++) {
    const p = ring[i].map((v,a) => v*.01+c[a]*.99);
    if (pointInPoly(...p,ring)) return p;
  }
  throw new Error('Reviewed green requires an explicit interior target');
}

export function applyOrthoReview(model, review, { heightAt } = {}) {
  require(review?.schemaVersion === 1 && review.groundId === 'johannesberg' && ['johannesberg','johannesberg-9'].includes(review.course), 'wrong review identity');
  require(model.origin.lat === 59.72733 && model.origin.lon === 18.19202 && same(review.frame, {origin:model.origin,mPerLat:model.mPerLat,mPerLon:model.mPerLon}), 'frame mismatch');
  require(model.holes.length === (review.course === 'johannesberg' ? 18 : 9), 'wrong course');
  require(Array.isArray(review.features), 'features required');
  const ids = new Set(), slots = new Set();
  const operations = review.features.map(f => {
    require(typeof f.id === 'string' && f.id.length && !ids.has(f.id), 'duplicate/missing review ID'); ids.add(f.id);
    require(f.status === 'accepted' && ['green','fairway','tee','tees','bunker'].includes(f.kind) && hash.test(f.originalRingSha256), `${f.id}: unaccepted or unpinned feature`);
    require([undefined,'replace','add','remove'].includes(f.action), `${f.id}: unsupported action`);
    require(!['add','remove'].includes(f.action) || f.kind === 'bunker' || (f.kind === 'tee' && f.action === 'add'), `${f.id}: only bunker additions/removals and observed tee additions supported`);
    validateReviewEvidence(f);
    const h = model.holes.find(h => h.n === f.hole);
    require(h, `${f.id}: missing hole`);
    if (['tee','bunker'].includes(f.kind)) require(Number.isSafeInteger(f.index) && f.index >= 0, `${f.id}: index required`);
    const slot = `${f.hole}/${f.kind}/${f.index ?? ''}`;
    require(!slots.has(slot), `${f.id}: duplicate slot`); slots.add(slot);
    require(!review.features.some(g => g !== f && g.hole === f.hole && ((g.kind === 'tee' && f.kind === 'tees') || (g.kind === 'tees' && f.kind === 'tee'))), `${f.id}: conflicting tee review`);
    const many = ['fairway','tees'].includes(f.kind);
    const geometry = f.action === 'remove' ? null : many ? f.rings : f.ring;
    if (f.action !== 'remove') {
      if (many) { require(Array.isArray(geometry) && geometry.length, `${f.id}: rings required`); geometry.forEach(r => validateRing(r,f.id)); }
      else validateRing(geometry,f.id);
    }
    const old = originalGeometry(h,f);
    const existing = ['tee','bunker'].includes(f.kind) ? (f.kind === 'tee' ? h.tees.pads : h.bunkers).find(b => b.reviewId === f.id) : null;
    const retired = model.orthophotoReview?.retired?.find(r => r.id === f.id);
    const already = f.action === 'remove' ? retired?.originalRingSha256 === f.originalRingSha256 : geometrySha256(existing?.ring ?? old ?? null) === geometrySha256(geometry);
    if (f.action === 'add') {
      const precedingAdds = review.features.filter(g => g.hole === f.hole && g.kind === f.kind && g.action === 'add' && g.index < f.index);
      const count = f.kind === 'tee' ? h.tees.pads.length : h.bunkers.length;
      require(f.originalRingSha256 === geometrySha256(null) && (already || (!old && f.index === count + precedingAdds.length)), `${f.id}: occupied or discontinuous append slot`);
    }
    else require(already || (old && geometrySha256(old) === f.originalRingSha256), `${f.id}: baseline geometry changed`);
    let target;
    if (f.kind === 'green') {
      target = f.target ?? interior(geometry,h.green.c);
      require(point(target) && pointInPoly(...target,geometry), `${f.id}: target outside putting surface`);
      if (!same(target,h.green.c) || !same(target,h.line.at(-1))) require(typeof heightAt === 'function' && [heightAt(...h.line[0]),heightAt(...target)].every(Number.isFinite), `${f.id}: moved target needs terrain sampler`);
    }
    return {f,geometry,target,already};
  });
  const out = structuredClone(model);
  for (const {f,geometry,target,already} of operations.filter(o => o.f.action !== 'remove')) {
    const h = out.holes.find(h => h.n === f.hole);
    const provenance = {prov:'reviewed-lm-orthophoto',reviewId:f.id,sourceCaptureDates:f.evidence.sourceCaptureDates,boundaryInterpretationUncertaintyMetres:f.evidence.uncertaintyM};
    const surface = ring => ({ring:structuredClone(ring),c:centroid(ring),area:Math.round(Math.abs(polyArea(ring))),...provenance});
    if (f.kind === 'fairway') h.fairway = {...h.fairway,...provenance,rings:structuredClone(geometry)};
    else if (f.kind === 'tees') { h.tees.pads = geometry.map(r => ({...surface(r),cx:centroid(r)[0],cz:centroid(r)[1],preserveTerrain:true})); h.tees.inferPads = false; }
    else if (f.kind === 'tee') { const c=centroid(geometry); h.tees.pads[f.index]={...h.tees.pads[f.index],...surface(geometry),cx:c[0],cz:c[1],preserveTerrain:true}; h.tees.inferPads = false; }
    else if (f.kind === 'bunker') {
      const index = already ? h.bunkers.findIndex(b => b.reviewId === f.id) : f.index;
      h.bunkers[index >= 0 ? index : f.index] = {...h.bunkers[index >= 0 ? index : f.index],...surface(geometry)};
    } else {
      h.green = {...h.green,...surface(geometry),c:[...target]}; h.pin = [...target];
      if (!same(h.line.at(-1),target)) {
        h.routingReview = {reviewId:f.id,originalLine:structuredClone(h.line),originalLineSha256:geometrySha256(h.line)};
        h.line[h.line.length-1] = [...target]; h.routingReviewId = f.id;
        h.lineLen = Number(polyLen(h.line).toFixed(1)); h.lenDev = Number((Math.abs(polyLen(h.line)-h.t[0])/h.t[0]*100).toFixed(2));
        const tee=heightAt(...h.line[0]),green=heightAt(...target);
        h.elev={...h.elev,tee:Number(tee.toFixed(1)),green:Number(green.toFixed(1)),rise:Number((green-tee).toFixed(1))};
      }
    }
  }
  for (const {f,already} of operations.filter(o => o.f.action === 'remove').sort((a,b) => b.f.index-a.f.index)) {
    if (already) continue;
    out.holes.find(h => h.n === f.hole).bunkers.splice(f.index,1);
    ((out.orthophotoReview ||= {}).retired ||= []).push({id:f.id,originalRingSha256:f.originalRingSha256,hole:f.hole,kind:f.kind,note:f.evidence.note});
  }
  if (operations.length) out.infra = {...out.infra,preserveMappedBoundaries:true};
  for (const n of new Set(operations.filter(o => ['tee','tees'].includes(o.f.kind)).map(o => o.f.hole))) {
    const h=out.holes.find(h=>h.n===n), distance=p=>Math.min(...h.tees.pads.map(t=>Math.hypot(centroid(t.ring)[0]-p[0],centroid(t.ring)[1]-p[1])));
    h.teePadDist=Number(distance(h.line[0]).toFixed(1));
    h.tees.marks.forEach(m=>{m.padDist=Number(distance(m.c).toFixed(1));});
    assignTeeDisplayAnchors(h);
  }
  return out;
}

export function legacyHeightfieldSampler(spec) {
  const a=decodeHF(spec);
  return (x,z) => {
    const fx=(x-spec.x0)/spec.dx,fz=(z-spec.z0)/spec.dx;
    if (fx<0 || fz<0 || fx>spec.nx-1 || fz>spec.nz-1) return NaN;
    const i=Math.min(Math.floor(fx),spec.nx-2),j=Math.min(Math.floor(fz),spec.nz-2),u=fx-i,v=fz-j,k=j*spec.nx+i;
    return (a[k]*(1-u)+a[k+1]*u)*(1-v)+(a[k+spec.nx]*(1-u)+a[k+spec.nx+1]*u)*v;
  };
}
