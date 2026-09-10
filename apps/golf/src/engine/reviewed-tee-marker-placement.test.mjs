import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inRing, ringSD } from './geom.js';
import { teeMarkerPositions } from './tee-marker-placement.mjs';
import { reviewedTeeMarkerPositions } from './reviewed-tee-marker-placement.mjs';

const rectangle = (x0, z0, x1, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const mark = (extra = {}) => ({ c: [0,0], b: 0, sourcePadId: 'actual-tee', ...extra });
const fixture = (marks, ring = rectangle(-4,-5,4,5)) => ({
  n: 1, line: [[0,0],[0,100]],
  tees: { markerLayout: 'separate-reviewed-colours', pads: [{ id: 'actual-tee', ring }], marks },
});
const layout = hole => hole.tees.marks.map(reference => reviewedTeeMarkerPositions(hole, reference));
const separated = pairs => pairs.every((pair, index) => pair.every(p => pairs.slice(0,index).flat()
  .every(q => Math.hypot(p[0]-q[0],p[1]-q[1]) >= .35)));

describe('reviewed tee colour display layout', () => {
  it('delegates unchanged unless the course explicitly selects the reviewed layout', () => {
    const reference=mark(),hole=fixture([reference]);
    for(const value of [undefined, 'legacy', 'separate-colours']) {
      hole.tees.markerLayout=value;
      expect(reviewedTeeMarkerPositions(hole,reference)).toEqual(teeMarkerPositions(hole,reference));
    }
  });

  it('separates three equal references in canonical colour order without changing any source object', () => {
    const hole=fixture([mark({m:312}),mark({m:312}),mark({m:312})]),before=structuredClone(hole);
    const pairs=layout(hole);
    expect(pairs).toEqual([[[2.6,0],[-2.6,0]],[[2.6,.6],[-2.6,.6]],[[2.6,-.6],[-2.6,-.6]]]);
    expect(separated(pairs)).toBe(true);
    expect(hole.tees.marks.slice().reverse().map(reference=>reviewedTeeMarkerPositions(hole,reference))).toEqual(pairs.slice().reverse());
    expect(hole).toEqual(before);
  });

  it('honours a nominated narrow platform even when another overlapping deck is wider', () => {
    const hole=fixture([mark(),mark(),mark()],rectangle(-1,-3,1,3));
    hole.tees.pads.unshift({id:'unrelated-tee',ring:rectangle(-20,-20,20,20)});
    const pairs=layout(hole);
    expect(pairs.every(pair=>pair.length===2)).toBe(true);
    expect(pairs.flat().every(p=>ringSD(...p,hole.tees.pads[1].ring)<=-.15+1e-8)).toBe(true);
    expect(pairs.flat().every(p=>Math.abs(p[0])<=.8+1e-8)).toBe(true);
    expect(separated(pairs)).toBe(true);
    const missing=mark({sourcePadId:'missing'});hole.tees.marks.push(missing);
    expect(reviewedTeeMarkerPositions(hole,missing)).toEqual([]);
  });

  it('omits an unresolved colour without reserving the real marker position', () => {
    const hole=fixture([mark({orthophotoReference:{kind:'unresolved-guide-tee-reference'}}),mark()]);
    expect(layout(hole)).toEqual([[],[[2.6,0],[-2.6,0]]]);
  });

  it('omits additional colours when a narrow strip cannot fit their sphere footprints', () => {
    const ring=rectangle(-3,-.25,3,.25),hole=fixture([mark(),mark(),mark()],ring);
    expect(layout(hole)).toEqual([[[2.6,0],[-2.6,0]],[],[]]);
    expect(layout(fixture([mark()],rectangle(-.1,-2,.1,2)))).toEqual([[]]);
  });

  it('fits reviewed mown-ground references without modifying or adding a tee platform', () => {
    const ring=rectangle(-2,-3,2,3),references=[0,1,2].map(()=>mark({referenceSurfaceKind:'mown-ground',
      referenceSurfaceRing:ring,orthophotoReference:{kind:'guide-orthophoto-reference'}}));
    const hole=fixture(references,rectangle(10,-3,20,3)),before=structuredClone(hole),pairs=layout(hole);
    expect(pairs.every(pair=>pair.length===2)).toBe(true);
    expect(pairs.flat().every(p=>ringSD(...p,ring)<=-.15+1e-8)).toBe(true);
    expect(separated(pairs)).toBe(true);
    expect(hole).toEqual(before);
  });

  it('requires both evidence and the nominated mown-ground area', () => {
    for(const extra of [
      {referenceSurfaceKind:'mown-ground',referenceSurfaceRing:rectangle(-4,-4,4,4)},
      {referenceSurfaceKind:'mown-ground',orthophotoReference:{kind:'guide-orthophoto-reference'}},
      {referenceSurfaceKind:'mown-ground',referenceSurfaceRing:[[0,0],[NaN,4],[4,0]],orthophotoReference:{kind:'guide-orthophoto-reference'}},
    ]) expect(layout(fixture([mark(extra)]))).toEqual([[]]);
  });

  it('keeps associated fairway colours on fairway turf and cannot borrow a nearby platform', () => {
    const references=[mark(),mark()].map(reference=>({...reference,referenceSurfaceKind:'fairway',orthophotoReference:{kind:'guide-orthophoto-reference'}}));
    const hole=fixture(references),ring=rectangle(-1,-2,1,2);hole.fairway={rings:[ring]};
    const pairs=layout(hole);
    expect(pairs.every(pair=>pair.length===2)).toBe(true);
    expect(pairs.flat().every(p=>ringSD(...p,ring)<=-.15+1e-8)).toBe(true);
    expect(separated(pairs)).toBe(true);
  });

  it('never rescues an outside reference by shifting it onto a nearby deck', () => {
    const reference=mark({c:[0,0]}),hole=fixture([reference],rectangle(-3,.4,3,5));
    expect(reviewedTeeMarkerPositions(hole,reference)).toEqual([]);
  });

  it('does not jump across rough to another branch of the same concave ring', () => {
    const ring=[[-3,-.25],[3,-.25],[3,2],[-3,2],[-3,.5],[2.9,.5],[2.9,.25],[-3,.25]];
    const hole=fixture([mark(),mark()],ring),pairs=layout(hole);
    expect(pairs[0]).toHaveLength(2);
    expect(pairs[1]).toEqual([]);
    expect(inRing(0,.6,ring)).toBe(true);
  });

  it('caps the deterministic fore/aft spread at three metres and omits overflow', () => {
    const hole=fixture(Array.from({length:12},()=>mark()),rectangle(-4,-20,4,20)),pairs=layout(hole);
    expect(pairs.slice(0,11).every(pair=>pair.length===2)).toBe(true);
    expect(pairs[11]).toEqual([]);
    expect(pairs.flat().every(p=>Math.abs(p[1])<=3)).toBe(true);
    expect(separated(pairs)).toBe(true);
  });

  it('uses the reference bearing for transverse pairs and fore/aft colour separation', () => {
    const bearing=67*Math.PI/180,forward=[Math.sin(bearing),Math.cos(bearing)];
    const hole=fixture([mark({b:67}),mark({b:67}),mark({b:67})],rectangle(-10,-10,10,10));
    const pairs=layout(hole);
    for(const pair of pairs) {
      expect((pair[1][0]-pair[0][0])*forward[0]+(pair[1][1]-pair[0][1])*forward[1]).toBeCloseTo(0,8);
      expect(pair.every(p=>ringSD(...p,hole.tees.pads[0].ring)<=-.15+1e-8)).toBe(true);
    }
    const centre=pair=>[(pair[0][0]+pair[1][0])/2,(pair[0][1]+pair[1][1])/2];
    expect(centre(pairs[1])[0]).toBeCloseTo(forward[0]*.6,8);
    expect(centre(pairs[1])[1]).toBeCloseTo(forward[1]*.6,8);
    expect(separated(pairs)).toBe(true);
  });

  it('fits every accepted Johannesberg colour on its reviewed surface without drawing unresolved colours', () => {
    const read = name => JSON.parse(fs.readFileSync(new URL(`../../../../johannesbergbuild/${name}`,import.meta.url),'utf8'));
    const review=read('mapping/tee-placement-review.json'),model=read('course-model.json');
    for(const row of review.holes) {
      const source=model.holes.find(h=>h.n===row.hole);
      const hole={...source,tees:{...source.tees,markerLayout:'separate-reviewed-colours',
        pads:row.pads.map(p=>({id:p.padId,ring:p.ring})),
        marks:row.marks.map(m=>({c:m.displayC??m.referenceC,
          b:m.aimC?Math.atan2(m.aimC[0]-m.displayC[0],m.aimC[1]-m.displayC[1])*180/Math.PI:0,
          sourcePadId:m.padId??undefined,referenceSurfaceKind:m.surfaceKind,referenceSurfaceRing:m.referenceSurfaceRing,
          orthophotoReference:{kind:m.displayMarkers?'guide-orthophoto-reference':'unresolved-guide-tee-reference'}}))}};
      const before=structuredClone(hole),pairs=layout(hole);
      row.marks.forEach((reference,index)=>{
        const pair=pairs[index];
        expect(pair,`hole ${row.hole} ${reference.colour}`).toHaveLength(reference.displayMarkers?2:0);
        const rings=reference.surfaceKind==='mown-ground'?[reference.referenceSurfaceRing]
          :reference.surfaceKind==='fairway'?source.fairway.rings
            :row.pads.filter(p=>p.padId===reference.padId).map(p=>p.ring);
        expect(pair.every(p=>rings.some(ring=>ringSD(...p,ring)<=-.15+1e-7))).toBe(true);
      });
      expect(separated(pairs)).toBe(true);
      expect(hole).toEqual(before);
    }
  });
});
