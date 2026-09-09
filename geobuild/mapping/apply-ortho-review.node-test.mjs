import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrthoReview, hasReviewedRouteEndpoint, orthoReviewBaseline, ringGeometrySha256, validateOrthoRing } from './apply-ortho-review.mjs';
import { pointInPoly } from '../lib.mjs';
import { inferSynthTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';

const square = (x, z, r = 2) => [[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r]];
function fixture() {
  const frame = { origin: { lat: 63.2845, lon: 18.6735 }, mPerLat: 111320, mPerLon: 50045.09 };
  const model = { ...frame, lakeLevel: 21.59, water: [{ ring: square(50,50), level: 30 }],
    holes: [{ n: 1, par: 4, idx: 8, t: [100,90,80,70,60,50], line: [[0,0],[0,100]], lineLen: 100, lenDev: 0,
      teeSlide: 3, teePadDist: 0, green: { ring: square(0,100), c: [0,100], prov: 'plan', area: 16 }, pin: [0,100],
      fairway: { rings: [square(0,50,8)], prov: 'plan' }, bunkers: [{ ring: square(10,90), c: [10,90], prov: 'dtm' }],
      tees: { pads: [{ ring: square(0,0), c: [0,0], prov: 'synth' }], marks: [{ c: [0,0], m: 100, teeIdx: 0, b: 180, padDist: 0 }] },
      elev: { tee: 50, green: 60, rise: 10 }, guideElevM: 12, guideBearingDeg: 180 }],
    infra: { paths: [{ line: [[0,0],[20,20]] }] }, scenery: { greens: [] } };
  const evidence = { sourceFiles: [{ path: 'cache/lm-source.tif', sha256: 'a'.repeat(64) }], sourceCaptureDates: ['2024-06-27'], uncertaintyM: 0.75 };
  const feature = (kind, geometry, index) => ({ id: `h1-${kind}`, status: 'accepted', hole: 1, kind,
    ...(index === undefined ? {} : { index }), originalRingSha256: ringGeometrySha256(kind === 'green' ? model.holes[0].green.ring : kind === 'fairway' ? model.holes[0].fairway.rings : kind === 'tee' ? model.holes[0].tees.pads[index].ring : model.holes[0].bunkers[index].ring),
    ...(kind === 'fairway' ? { rings: geometry } : { ring: geometry }), evidence: structuredClone(evidence) });
  return { model, review: { schemaVersion: 1, groundId: 'veckefjarden', frame, features: [] }, feature };
}

test('reviewed outline preserves an existing green target when still inside; reapplication is exact', () => {
  const { model, review, feature } = fixture();
  review.features.push(feature('green', square(0,100,3)));
  const before = structuredClone(model), result = applyOrthoReview(model, review);
  assert.deepEqual(model, before);
  assert.deepEqual(result.holes[0].green.c, before.holes[0].green.c);
  assert.deepEqual(result.holes[0].line, before.holes[0].line);
  assert.equal(result.holes[0].green.area, 36);
  assert.equal(result.holes[0].routingReviewId, undefined);
  assert.deepEqual(applyOrthoReview(result, review), result);
  assert.deepEqual(result.water, before.water);
  assert.deepEqual(result.infra, { ...before.infra, preserveMappedBoundaries: true });
});

test('moved green updates routing and measured labels, retaining scorecard, tee start and marker positions', () => {
  const { model, review, feature } = fixture();
  review.features.push(feature('green', square(10,110)));
  const heightAt = (x,z) => 50 + x * 0.2 + z * 0.1;
  const out = applyOrthoReview(model, review, { heightAt }), h = out.holes[0];
  assert.deepEqual(h.green.c, [10,110]); assert.deepEqual(h.pin, [10,110]);
  assert.deepEqual(h.line, [[0,0],[10,110]]);
  assert.deepEqual(h.t, model.holes[0].t); assert.deepEqual(h.tees, model.holes[0].tees);
  assert.deepEqual(h.elev, { tee: 50, green: 63, rise: 13 });
  assert.equal(h.elevErr, 1); assert.equal(h.lineLen, 110.5); assert.equal(h.lenDev, 10.45);
  assert.equal(hasReviewedRouteEndpoint(h, review), true);
  assert.deepEqual(applyOrthoReview(out, review), out);
  h.green.ring[0][0] -= 0.5;
  assert.equal(hasReviewedRouteEndpoint(h, review), false);
  assert.throws(() => applyOrthoReview(model, review), /heightfield sampler/);
  assert.throws(() => applyOrthoReview(model, review, { heightAt: () => NaN }), /outside the existing heightfield/);
});

test('physical tee, sand and fairway components replace only their pinned surfaces', () => {
  const { model, review, feature } = fixture();
  review.features.push(feature('tee', square(4,0,3), 0), feature('bunker', square(12,92,3), 0), feature('fairway', [square(0,40,5),square(0,60,5)]));
  const out = applyOrthoReview(model, review), h = out.holes[0];
  assert.deepEqual(h.tees.pads[0].c, [4,0]); assert.equal(h.tees.marks[0].padDist, 4);
  assert.equal(h.tees.pads[0].preserveTerrain, true);
  assert.equal(h.tees.inferPads, undefined, 'one reviewed pad does not claim a complete physical tee inventory');
  assert.deepEqual(h.tees.marks[0].c, [0,0]); assert.equal(h.tees.marks[0].m, 100);
  assert.deepEqual(h.line, model.holes[0].line); assert.equal(h.teeSlide, 3);
  assert.deepEqual(h.bunkers[0].c, [12,92]); assert.equal(h.bunkers[0].area, 36);
  assert.equal(h.fairway.rings.length, 2); assert.equal(h.fairway.area, 200);
  assert.deepEqual(applyOrthoReview(out, review), out);
});

test('only an explicit complete physical tee review disables inferred marker pads', () => {
  const { model, review, feature } = fixture();
  review.features.push(feature('tee', square(4,0,3), 0)); review.reviewedTeeHoles = [1];
  const result = applyOrthoReview(model, review);
  assert.equal(result.holes[0].tees.inferPads, false);
  assert.deepEqual(result.holes[0].tees.marks[0].c, model.holes[0].tees.marks[0].c);
  assert.deepEqual(applyOrthoReview(result, review), result);
  for (const holes of [[2], [1,1], ['1']]) {
    const bad = structuredClone(review); bad.reviewedTeeHoles = holes;
    assert.throws(() => applyOrthoReview(model, bad), /reviewedTeeHoles/);
  }
  review.features = []; assert.throws(() => applyOrthoReview(model, review), /reviewedTeeHoles/);
});

test('wrong frame, stale source geometry and evidence failures leave all input geometry intact', () => {
  const { model, review, feature } = fixture();
  review.features.push(feature('green', square(0,100,3)), feature('bunker', square(12,92), 0));
  const baseline = structuredClone(model);
  for (const mutate of [
    r => { r.frame.mPerLon += 1; },
    r => { r.features[1].originalRingSha256 = 'b'.repeat(64); },
    r => { r.features[1].evidence.sourceFiles[0].sha256 = 'missing'; },
    r => { r.features[1].evidence.sourceCaptureDates[0] = '2024-02-30'; },
    r => { r.features[1].evidence.uncertaintyM = 0; },
    r => { r.features[1].status = 'candidate'; },
    r => { r.features[1].index = 99; },
    r => { r.features[1].ring = [[0,0],[3,3],[0,3],[3,0]]; },
    r => { r.features[0].target = [1000,1000]; },
    r => { r.features.push({ ...structuredClone(r.features[0]), id: 'second-green' }); },
  ]) {
    const bad = structuredClone(review); mutate(bad);
    assert.throws(() => applyOrthoReview(model, bad));
    assert.deepEqual(model, baseline);
  }
  const out = applyOrthoReview(model, review);
  const forged = structuredClone(out.holes[0]); forged.routingReviewId = 'unreviewed';
  assert.equal(hasReviewedRouteEndpoint(forged, review), false);
});

test('rings reject crossings, repeated vertices and non-finite values, including a touching edge', () => {
  assert.deepEqual(validateOrthoRing([...square(0,0),[-2,-2]]), square(0,0));
  for (const ring of [ [[0,0],[3,3],[0,3],[3,0]], [[0,0],[3,0],[1,0],[1,3]], [[0,0],[1,0],[2,0]], [[0,0],[1,0],[NaN,1]], [[0,0],[1,0],[1,0],[0,1]], [[0,0],[1,0],[0,1],[1,0]] ]) assert.throws(() => validateOrthoRing(ring));
});

test('baseline hashes are independent of mutable provenance and retain per-surface addresses', () => {
  const { model } = fixture(); const baseline = orthoReviewBaseline(model);
  model.holes[0].green.prov = 'changed'; model.holes[0].green.area = 123;
  assert.deepEqual(orthoReviewBaseline(model), baseline);
  assert.equal(baseline.holes[0].tees[0].index, 0);
  assert.equal(baseline.holes[0].green.originalRingSha256, ringGeometrySha256(model.holes[0].green.ring));
});

test('a newly observed bunker appends only to its pinned empty slot and remains idempotent', () => {
  const { model, review, feature } = fixture();
  const addition = { ...feature('bunker', square(20,85), 0), id: 'h1-added-bunker', action: 'add', index: 1, originalRingSha256: ringGeometrySha256(null) };
  review.features.push(addition);
  const out = applyOrthoReview(model, review);
  assert.equal(out.holes[0].bunkers.length, 2); assert.deepEqual(out.holes[0].bunkers[1].c, [20,85]);
  assert.deepEqual(out.holes[0].bunkers[0], model.holes[0].bunkers[0]);
  assert.deepEqual(applyOrthoReview(out, review), out);
  for (const change of [{ index: 0 }, { index: 2 }, { originalRingSha256: 'a'.repeat(64) }, { kind: 'tee' }]) {
    const bad = structuredClone(review); Object.assign(bad.features[0], change);
    assert.throws(() => applyOrthoReview(model, bad));
  }
});

test('complete tee inventories replace phantom pads atomically and preserve marker locations', () => {
  const { model, review } = fixture();
  const feature = { id: 'h1-reviewed-platforms', status: 'accepted', hole: 1, kind: 'tee-set',
    originalRingSha256: ringGeometrySha256(model.holes[0].tees.pads.map(pad => pad.ring)),
    pads: [{ id: 'h1-north-platform', ring: square(5,0,3), note: 'Visible prepared mowing edge.' }, { id: 'h1-south-platform', ring: square(5,8,3) }],
    evidence: { sourceFiles: [{ path: 'cache/ortho.tif', sha256: 'a'.repeat(64) }], sourceCaptureDates: ['2024-06-27'], uncertaintyM: 1 } };
  review.features = [feature]; review.reviewedTeeHoles = [1];
  const out = applyOrthoReview(model, review), tees = out.holes[0].tees;
  assert.equal(tees.pads.length, 2);
  assert.deepEqual(tees.pads.map(pad => pad.id), ['h1-north-platform','h1-south-platform']);
  assert.deepEqual(tees.pads.map(pad => pad.c), [[5,0],[5,8]]);
  assert.ok(tees.pads.every(pad => pad.preserveTerrain === true && pad.teeSetReviewId === feature.id));
  assert.equal(tees.pads[0].area, 36); assert.equal(tees.inferPads, false);
  assert.deepEqual(tees.marks[0].c, model.holes[0].tees.marks[0].c); assert.equal(tees.marks[0].padDist, 5);
  assert.deepEqual(out.holes[0].line, model.holes[0].line);
  assert.deepEqual(applyOrthoReview(out, review), out);
  const partial = structuredClone(review); delete partial.reviewedTeeHoles;
  assert.equal(applyOrthoReview(model, partial).holes[0].tees.inferPads, undefined);
  for (const mutate of [
    r => { r.features[0].pads[1].id = r.features[0].pads[0].id; },
    r => { r.features[0].pads = []; },
    r => { r.features[0].pads[1].ring[1][0] = Infinity; },
    r => { r.features[0].originalRingSha256 = 'f'.repeat(64); },
    r => { r.features.push({ ...r.features[0], id: 'individual-tee', kind: 'tee', index: 0, ring: square(0,0) }); },
  ]) {
    const bad = structuredClone(review), baseline = structuredClone(model); mutate(bad);
    assert.throws(() => applyOrthoReview(model, bad)); assert.deepEqual(model, baseline);
  }
});

function teeReferenceFixture() {
  const F = fixture();
  F.model.holes[0].tees.marks.push({ teeIdx: 1, m: 50, c: [50,50], b: 180, padDist: 70.7 });
  const feature = { id: 'h1-observed-platforms', status: 'accepted', hole: 1, kind: 'tee-set',
    originalRingSha256: ringGeometrySha256(F.model.holes[0].tees.pads.map(pad => pad.ring)),
    pads: [{ id: 'back-platform', ring: square(20,-10,3) }, { id: 'forward-platform', ring: square(20,50,3) }],
    referencePads: [null,1], evidence: { sourceFiles: [{ path: 'cache/ortho.tif', sha256: 'a'.repeat(64) }], sourceCaptureDates: ['2024-06-27'], uncertaintyM: 1 } };
  F.review.features = [feature]; F.review.reviewedTeeHoles = [1];
  return { ...F, teeFeature: feature };
}

test('an explicitly associated camera reference moves out of water onto its observed platform', () => {
  const { model, review } = teeReferenceFixture();
  assert.equal(pointInPoly(...model.holes[0].tees.marks[1].c,model.water[0].ring),true);
  const out=applyOrthoReview(model,review),h=out.holes[0],m=h.tees.marks[1];
  assert.deepEqual(m.c,[22.25,50]);assert.equal(pointInPoly(...m.c,h.tees.pads[1].ring),true);
  assert.equal(pointInPoly(...m.c,out.water[0].ring),false);
  assert.equal(m.prov,'orthophoto-platform-reference');assert.equal(m.associationConfidence,'provisional');
  assert.equal(m.sourcePadId,'forward-platform');assert.equal(m.sourceReviewId,'h1-observed-platforms');
  assert.deepEqual(h.tees.marks[0].c,[0,0]);assert.equal(h.tees.marks[0].associationConfidence,'unresolved');
  assert.deepEqual(h.line,model.holes[0].line);assert.deepEqual(h.t,model.holes[0].t);assert.equal(m.m,50);
  assert.equal(h.teeRoutingReviewId,undefined);
  assert.deepEqual(applyOrthoReview(out,review),out);
});

test('a moved back reference updates routing from observed turf and proves its endpoint against the ledger', () => {
  const { model, review, teeFeature } = teeReferenceFixture();teeFeature.referencePads=[0,1];
  const heightAt=(x,z)=>50+x*.2+z*.1;
  const out=applyOrthoReview(model,review,{heightAt}),h=out.holes[0];
  const expected=[17+0.75/Math.SQRT2,-7-0.75/Math.SQRT2];
  assert.deepEqual(h.line,[expected,[0,100]]);assert.deepEqual(h.tees.marks[0].c,expected);
  assert.deepEqual(h.elev,{tee:52.8,green:60,rise:7.2});assert.equal(h.lineLen,108.9);assert.equal(h.lenDev,8.95);
  assert.equal(h.teeSlide,null);assert.equal(h.teePadDist,3.5);assert.equal(hasReviewedRouteEndpoint(h,review),true);
  assert.deepEqual(applyOrthoReview(out,review),out);
  const broken=structuredClone(h);broken.tees.marks[0].c=[0,0];assert.equal(hasReviewedRouteEndpoint(broken,review),false);
  const unapproved=structuredClone(review);unapproved.features[0].referencePads[0]=null;assert.equal(hasReviewedRouteEndpoint(h,unapproved),false);
  assert.throws(()=>applyOrthoReview(model,review),/heightfield sampler/);
});

test('both reviewed routing endpoints use final heights independent of feature order', () => {
  const { model, review, teeFeature, feature }=teeReferenceFixture();teeFeature.referencePads=[0,1];
  const green=feature('green',square(10,110));review.features.push(green);
  const heightAt=(x,z)=>50+x*.2+z*.1;
  const out=applyOrthoReview(model,review,{heightAt}),h=out.holes[0];
  assert.deepEqual(h.line,[[17+0.75/Math.SQRT2,-7-0.75/Math.SQRT2],[10,110]]);assert.deepEqual(h.elev,{tee:52.8,green:63,rise:10.2});
  assert.equal(h.lineLen,117.8);assert.equal(hasReviewedRouteEndpoint(h,review),true);
  assert.deepEqual(applyOrthoReview(model,{...review,features:[green,teeFeature]},{heightAt}),out);
  assert.deepEqual(applyOrthoReview(out,review),out);
  const broken=structuredClone(h);broken.green.ring[0][0]-=.5;assert.equal(hasReviewedRouteEndpoint(broken,review),false,'a valid tee claim cannot mask a stale green claim');
});

test('associations are explicit and validated, while already-contained positions are preserved', () => {
  const {model,review,teeFeature}=teeReferenceFixture();
  teeFeature.pads[0].ring=square(0,0,3);teeFeature.referencePads=[0,null];
  const out=applyOrthoReview(model,review);
  assert.deepEqual(out.holes[0].tees.marks[0].c,[0,0]);assert.equal(out.holes[0].teeRoutingReviewId,undefined);
  assert.deepEqual(out.holes[0].tees.marks[1].c,[50,50]);assert.equal(out.holes[0].tees.marks[1].associationConfidence,'unresolved');
  for(const refs of [[0],[0,2],[false,1],[-1,1],['0',1]]) {
    const bad=structuredClone(review);bad.features[0].referencePads=refs;
    assert.throws(()=>applyOrthoReview(model,bad),/referencePads/);
  }
});

test('partial tee inventories can suppress invented pads without a completeness claim', () => {
  const {model,review}=teeReferenceFixture();delete review.reviewedTeeHoles;
  review.features[0].referencePads=[null,null];review.suppressInferredTeeHoles=[1];
  const out=applyOrthoReview(model,review),h=out.holes[0];
  assert.equal(h.tees.inferPads,false);assert.equal(review.reviewedTeeHoles,undefined);
  assert.deepEqual(h.tees.marks.map(m=>m.c),model.holes[0].tees.marks.map(m=>m.c));
  assert.ok(h.tees.marks.every(m=>m.associationConfidence==='unresolved'));
  const runtimeHole=structuredClone(h);inferSynthTeePads(runtimeHole);
  assert.deepEqual(runtimeHole.tees.pads,h.tees.pads,'unresolved rough/water references cannot invent a platform');
  assert.deepEqual(applyOrthoReview(out,review),out);
  for(const holes of [[2],[1,1],['1']]) {
    const bad=structuredClone(review);bad.suppressInferredTeeHoles=holes;
    assert.throws(()=>applyOrthoReview(model,bad),/suppressInferredTeeHoles/);
  }
  const empty=structuredClone(review);empty.features=[];
  assert.throws(()=>applyOrthoReview(model,empty),/suppressInferredTeeHoles/);
});

test('an associated back reference already inside turf repairs a stale route start', () => {
  const {model,review,teeFeature}=teeReferenceFixture();
  teeFeature.pads[0].ring=square(0,0,3);teeFeature.referencePads=[0,null];
  model.holes[0].line[0]=[0,-0.1];
  const out=applyOrthoReview(model,review,{heightAt:()=>50}),h=out.holes[0];
  assert.deepEqual(h.tees.marks[0].c,[0,0]);assert.deepEqual(h.line[0],[0,0]);
  assert.equal(hasReviewedRouteEndpoint(h,review),true);
  assert.deepEqual(h.t,model.holes[0].t);assert.deepEqual(applyOrthoReview(out,review),out);
});

test('a reference just outside a long deck enters near the edge instead of collapsing to its centre', () => {
  const {model,review,teeFeature}=teeReferenceFixture();
  teeFeature.pads[1].ring=[[10,45],[40,45],[40,55],[10,55]];
  model.holes[0].tees.marks[1].c=[40.5,50];
  const out=applyOrthoReview(model,review),reference=out.holes[0].tees.marks[1].c;
  assert.deepEqual(reference,[39.25,50]);assert.equal(Math.hypot(reference[0]-40.5,reference[1]-50),1.25);
  assert.ok(pointInPoly(...reference,teeFeature.pads[1].ring));
  assert.deepEqual(applyOrthoReview(out,review),out);
});

test('a shadow-obscured historic platform retains source provenance only when its original ring is unchanged', () => {
  const {model,review,teeFeature}=teeReferenceFixture();
  Object.assign(model.holes[0].tees.pads[0],{id:'w123',prov:'osm'});
  const historical={id:'retained-platform',ring:structuredClone(model.holes[0].tees.pads[0].ring),
    retainedHistorical:true,sourceId:'w123',prov:'osm',boundaryInterpretationUncertaintyMetres:3,
    note:'Retained historic outline under tree shadow; no new contour accuracy claim.'};
  teeFeature.pads.push(historical);
  const out=applyOrthoReview(model,review),pad=out.holes[0].tees.pads[2];
  assert.equal(pad.prov,'osm');assert.equal(pad.sourceId,'w123');assert.equal(pad.retainedHistorical,true);
  assert.equal(pad.boundaryInterpretationUncertaintyMetres,3);assert.equal(pad.teeSetReviewId,teeFeature.id);
  assert.deepEqual(applyOrthoReview(out,review),out);
  for(const changes of [{prov:'plan'},{sourceId:'missing'},{note:''},{boundaryInterpretationUncertaintyMetres:.1},{ring:square(1,0)}]){
    const bad=structuredClone(review);Object.assign(bad.features[0].pads[2],changes);
    assert.throws(()=>applyOrthoReview(model,bad),/historical retention/);
  }
});

test('narrow decks bound the inset and concave decks fall back to a validated interior centre', () => {
  const {model,review,teeFeature}=teeReferenceFixture();
  teeFeature.pads[1].ring=square(20,50,.2);
  let out=applyOrthoReview(model,review),reference=out.holes[0].tees.marks[1].c;
  assert.ok(Math.abs(reference[0]-20.1)<1e-8);assert.ok(pointInPoly(...reference,teeFeature.pads[1].ring));
  teeFeature.pads[1].ring=[[0,0],[10,0],[10,10],[9.5,10],[9.5,4],[.5,4],[.5,10],[0,10]];
  model.holes[0].tees.marks[1].c=[10.1,5];
  out=applyOrthoReview(model,review);reference=out.holes[0].tees.marks[1].c;
  assert.deepEqual(reference,out.holes[0].tees.pads[1].c);
  assert.ok(pointInPoly(...reference,teeFeature.pads[1].ring));
});
