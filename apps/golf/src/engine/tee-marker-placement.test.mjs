import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { centroidOf, inRing, rightOf, ringSD } from './geom.js';
import { teeMarkerPlacement, teeMarkerPositions } from './tee-marker-placement.mjs';

const rectangle = (x0, z0, x1, z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const fixture = ring => ({ n: 1, line: [[0,0],[0,100]], tees: { pads: [{ ring }] } });

describe('marker pairs on existing tee decks', () => {
  it('keeps the nominal spacing on a wide deck without moving the source reference', () => {
    const hole = fixture(rectangle(-5,-10,5,10)), mark = { c: [0,0], b: 0 };
    const before = structuredClone({ hole, mark });
    expect(teeMarkerPositions(hole,mark)).toEqual([[2.6,0],[-2.6,0]]);
    expect({ hole, mark }).toEqual(before);
  });

  it('clips the pair to a narrow deck while retaining its transverse axis', () => {
    const hole = fixture(rectangle(-2,-10,2,10)), mark = { c: [0,0], b: 0 };
    const pair = teeMarkerPositions(hole,mark);
    expect(pair).toEqual([[1.8,0],[-1.8,0]]);
    expect(pair.every(p => inRing(...p,hole.tees.pads[0].ring))).toBe(true);
  });

  it('fits an asymmetric reference near the edge instead of moving its coordinate', () => {
    const hole = fixture(rectangle(-2,-10,2,10)), mark = { c: [1.5,0], b: 0 };
    const pair = teeMarkerPositions(hole,mark);
    expect(pair[0][0]).toBeCloseTo(1.8,8);
    expect(pair[1][0]).toBeCloseTo(-1.1,8);
    expect(mark.c).toEqual([1.5,0]);
  });

  it('uses the connected cross-section of a concave pad, never another branch across a gap', () => {
    const ring = [[0,0],[10,0],[10,10],[8,10],[8,2],[2,2],[2,10],[0,10]];
    const pair = teeMarkerPositions(fixture(ring),{ c: [1,8], b: 0 },{ halfWidth: 8.5 });
    expect(pair).toEqual([[1.8,8],[0.19999999999999996,8]]);
    expect(pair.every(p => inRing(...p,ring))).toBe(true);
  });

  it('does not invent a pair for an unresolved reference outside all existing decks', () => {
    const hole = fixture(rectangle(10,-5,20,5));
    expect(teeMarkerPositions(hole,{ c: [0,0], b: 0 })).toEqual([]);
  });

  it('insets only the decorative pair when an inside reference lacks edge clearance', () => {
    const hole = fixture(rectangle(-2,-5,2,5));
    const mark = { c: [1.95,0], b: 0, displayC: undefined }, before = structuredClone({ hole, mark });
    const result = teeMarkerPlacement(hole,mark);
    expect(result.positions).toHaveLength(2);
    expect(result.displayShiftM).toBeCloseTo(.15,4);
    expect(result.displayC[0]).toBeCloseTo(1.8,4);
    expect(result.reason).toBe('inward-display-adjustment');
    expect(result.positions.every(p=>ringSD(...p,hole.tees.pads[0].ring)<=-.15+1e-8)).toBe(true);
    expect({ hole, mark }).toEqual(before);
  });

  it('reports the display limit without relocating to a distant fitting cross-section', () => {
    const ring = [[-1,-1],[1,-1],[10,100],[-10,100]];
    const mark = { c: [0,-.95], b: 90 };
    const result = teeMarkerPlacement(fixture(ring),mark,{maxDisplayShift:.1});
    expect(result.positions).toEqual([]);
    expect(result.displayC).toBeNull();
    expect(result.displayShiftM).toBeNull();
    expect(result.reason).toBe('display-inset-exceeds-limit');
    expect(result.interiorAnchorWouldFit).toBe(true);
    expect(mark.c).toEqual([0,-.95]);
    const fitted = teeMarkerPlacement(fixture(ring),mark);
    expect(fitted.positions).toHaveLength(2);
    expect(fitted.displayShiftM).toBeLessThanOrEqual(1);
  });

  it('omits a pair on a truly narrow deck and preserves unresolved outside references', () => {
    expect(teeMarkerPositions(fixture(rectangle(-.1,-1,.1,1)),{ c: [0,0], b: 0 })).toEqual([]);
    const mark = { c: [2.05,0], b: 0 };
    expect(teeMarkerPlacement(fixture(rectangle(-2,-5,2,5)),mark).reason).toBe('reference-outside-nominated-surface');
    expect(mark.c).toEqual([2.05,0]);
  });

  it('does not search farther than one metre toward a wide interior from a narrow tip', () => {
    const result = teeMarkerPlacement(fixture([[0,0],[1,100],[-1,100]]),{c:[0,.5],b:0});
    expect(result.positions).toEqual([]);
    expect(result.maxDisplayShiftM).toBe(1);
    expect(result.reason).toBe('display-inset-exceeds-limit');
    expect(result.interiorAnchorWouldFit).toBe(true);
  });

  it('respects explicit deck identity even when a wider neighbouring pad overlaps it', () => {
    const hole=fixture(rectangle(-2,-5,2,5));hole.tees.pads[0].id='reviewed-narrow';
    hole.tees.pads.unshift({id:'other-wide',ring:rectangle(-10,-10,10,10)});
    const mark={c:[0,0],b:0,sourcePadId:'reviewed-narrow'};
    expect(teeMarkerPositions(hole,mark)).toEqual([[1.8,0],[-1.8,0]]);
    expect(teeMarkerPositions(hole,{...mark,sourcePadId:'missing'})).toEqual([]);
    expect(teeMarkerPositions(hole,{...mark,c:[4,0]})).toEqual([]);
    const inset = teeMarkerPlacement(hole,{...mark,c:[1.95,0]});
    expect(inset.padId).toBe('reviewed-narrow');
    expect(inset.displayShiftM).toBeCloseTo(.15,4);
    expect(inset.positions.every(p=>ringSD(...p,hole.tees.pads[1].ring)<=-.15+1e-8)).toBe(true);
  });

  it('keeps the sphere footprint inside an oblique deck edge', () => {
    const ring=[[-3,-5],[3,-1],[3,5],[-3,5]],hole=fixture(ring),mark={c:[0,0],b:0};
    const pair=teeMarkerPositions(hole,mark);
    expect(pair).toHaveLength(2);
    expect(pair.every(p=>ringSD(...p,ring)<=-.15+1e-8)).toBe(true);
  });

  it('fits an explicitly guide-associated fairway tee without adding a platform', () => {
    const hole = fixture(rectangle(10,-5,20,5));
    hole.fairway = { rings: [rectangle(-2,-10,2,10)] };
    const mark = { c: [0,0], b: 0, referenceSurfaceKind: 'fairway',
      orthophotoReference: { kind: 'guide-orthophoto-reference' } };
    const before = structuredClone({ hole, mark });
    const pair = teeMarkerPositions(hole, mark);
    expect(pair).toEqual([[1.8,0],[-1.8,0]]);
    expect(pair.every(p => ringSD(...p,hole.fairway.rings[0]) <= -.15 + 1e-8)).toBe(true);
    expect({ hole, mark }).toEqual(before);
  });

  it('requires both explicit fairway classification and guide association before using fairway turf', () => {
    const hole = fixture(rectangle(10,-5,20,5));
    hole.fairway = { rings: [rectangle(-5,-10,5,10)] };
    for (const metadata of [{}, { referenceSurfaceKind: 'fairway' },
      { orthophotoReference: { kind: 'guide-orthophoto-reference' } },
      { referenceSurfaceKind: 'platform', orthophotoReference: { kind: 'guide-orthophoto-reference' } },
      { referenceSurfaceKind: 'fairway', orthophotoReference: { kind: 'unresolved-virtual-tee-reference' } }]) {
      expect(teeMarkerPositions(hole, { c: [0,0], b: 0, ...metadata })).toEqual([]);
    }
  });

  it('omits an explicitly unresolved guide colour even if its original reference lies on a pad', () => {
    const hole = fixture(rectangle(-5,-10,5,10)), mark = { c: [0,0], b: 0 };
    expect(teeMarkerPositions(hole, { ...mark,
      orthophotoReference: { kind: 'unresolved-guide-tee-reference' } })).toEqual([]);
    expect(teeMarkerPositions(hole, mark)).toHaveLength(2);
    expect(teeMarkerPositions(hole, { ...mark,
      orthophotoReference: { kind: 'unresolved-virtual-tee-reference' } })).toHaveLength(2);
  });

  it('keeps a fairway pair in the connected turf at its reference and does not borrow a platform', () => {
    const hole = fixture(rectangle(-20,-20,20,20));
    hole.fairway = { rings: [rectangle(-2,-10,2,10), rectangle(10,-10,15,10)] };
    const mark = { c: [0,0], b: 0, referenceSurfaceKind: 'fairway',
      orthophotoReference: { kind: 'guide-orthophoto-reference' } };
    expect(teeMarkerPositions(hole, mark, { halfWidth: 15 })).toEqual([[1.8,0],[-1.8,0]]);
    expect(teeMarkerPositions(hole, { ...mark, c: [5,0] })).toEqual([]);
  });

  it.each(['veckefjarden3d.html', 'angso3d.html'])('uses the same implementation in standalone %s', filename => {
    const html = fs.readFileSync(new URL(`../../../../${filename}`,import.meta.url),'utf8');
    const module = fs.readFileSync(new URL('./tee-marker-placement.mjs',import.meta.url),'utf8');
    const source = ['teeMarkerPlacement','teeMarkerPositions'].map(name=>{
      const pattern = new RegExp(`function ${name}\\([^]*?^\\}`, 'm');
      const implementation = html.match(pattern)?.[0];
      expect(implementation.replace(/\r\n/g,'\n')).toBe(module.match(pattern)[0].replace(/\r\n/g,'\n'));
      return implementation;
    }).join('\n');
    const context = vm.createContext({ centroidOf,inRing,rightOf,ringSD });
    vm.runInContext(source+';globalThis.place=teeMarkerPositions;',context);
    for (const mark of [{c:[0,0],b:0},{c:[1.5,0],b:0},{c:[1.95,0],b:0},{c:[10,0],b:0}]) {
      const hole = fixture(rectangle(-2,-10,2,10));
      expect(JSON.stringify(context.place(hole,mark))).toBe(JSON.stringify(teeMarkerPositions(hole,mark)));
    }
  });

  it('shares Ängsö standalone camera targeting and derives its marker bearing from the route', () => {
    const html = fs.readFileSync(new URL('../../../../angso3d.html',import.meta.url),'utf8');
    for (const [name, file] of [['lineBearingAt', './geom.js'], ['teeView', './tee-view.mjs']]) {
      const source = fs.readFileSync(new URL(file,import.meta.url),'utf8');
      const pattern = new RegExp(`function ${name}\\([^]*?^\\}`, 'm');
      expect(html.match(pattern)?.[0].replace(/\r\n/g,'\n')).toBe(source.match(pattern)[0].replace(/\r\n/g,'\n'));
    }
    expect(html).toContain('b: lineBearingAt(h.line, mk[k].c) * 180 / Math.PI');
    expect(html).toContain('const { position: [x, z], aim } = teeView(h, mk);');
    expect(html).toContain('for (const [mx, mz] of teeMarkerPositions(h, m))');
  });
});
