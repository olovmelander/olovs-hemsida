import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { inRing } from './geom.js';
import { applyTeeDisplayAnchors, deriveTeeBearings, withInferredTeePads } from './tee-pads.mjs';

const fixture = () => ({
  n: 1, line: [[0, 0], [0, -100], [100, -100]],
  tees: {
    inferPads: false,
    pads: [{ ring: [[65, -105], [85, -105], [85, -95], [65, -95]], preserveTerrain: true }],
    marks: [{ c: [0, -5], displayC: [75, -100], b: 180, m: 200 }],
  },
});

describe('explicit tee display anchors', () => {
  it('adopts an existing deck for runtime while keeping the source reference and route intact', () => {
    const source = fixture(), before = structuredClone(source);
    const runtime = withInferredTeePads([source])[0];
    expect(source).toEqual(before);
    expect(runtime.tees.marks[0].c).toEqual([75, -100]);
    expect(runtime.tees.marks[0].referenceC).toEqual([0, -5]);
    expect(runtime.tees.marks[0].b).toBeCloseTo(90, 6);
    expect(runtime.tees.pads).toEqual(source.tees.pads);
    expect(runtime.line).toEqual(source.line);
    expect(runtime.tees.inferPads).toBe(false);
    deriveTeeBearings(runtime);
    expect(runtime.tees.marks[0].referenceC).toEqual([0, -5]);
  });

  it('keeps existing coordinate behavior without an opt-in anchor', () => {
    const source = fixture(); delete source.tees.marks[0].displayC;
    const runtime = withInferredTeePads([source])[0];
    expect(runtime.tees.marks[0].c).toEqual(source.tees.marks[0].c);
    expect(runtime.tees.marks[0].referenceC).toBeUndefined();
    expect(runtime.tees.marks[0].b).toBeCloseTo(180, 6);
    expect(runtime.tees.pads).toHaveLength(1);
  });

  it('does not overwrite the original mark object when adopting a display coordinate', () => {
    const hole = fixture(), mark = hole.tees.marks[0];
    deriveTeeBearings(hole);
    expect(mark.c).toEqual([0, -5]);
    expect(mark.referenceC).toBeUndefined();
    expect(hole.tees.marks[0]).not.toBe(mark);
  });

  it.each([null, undefined, [75], [75, -100, 0], [NaN, -100], [75, Infinity], ['75', -100], [0, -5]])(
    'rejects an invalid or uncovered display anchor %j', displayC => {
      const hole = fixture(); hole.tees.marks[0].displayC = displayC;
      expect(() => deriveTeeBearings(hole)).toThrow(/tee displayC/);
      expect(hole.tees.marks[0].c).toEqual([0, -5]);
      expect(hole.tees.pads).toHaveLength(1);
    },
  );

  it('validates all anchors before mutating any marker', () => {
    const hole = fixture(); hole.tees.marks.push({ c: [0, -25], displayC: [400, 400], b: 180 });
    const before = structuredClone(hole);
    expect(() => deriveTeeBearings(hole)).toThrow(/outside existing tee pads/);
    expect(hole).toEqual(before);
  });

  it('keeps standalone anchor placement and rejection consistent with the app', () => {
    const html = fs.readFileSync(new URL('../../../../johannesberg3d.html', import.meta.url), 'utf8');
    const context = vm.createContext({ inRing });
    vm.runInContext(html.match(/function applyTeeDisplayAnchors\([^]*?^\}/m)[0] + ';globalThis.apply=applyTeeDisplayAnchors;', context);
    for (const displayC of [[75, -100], [0, -5], [NaN, 0], null]) {
      const app = fixture(); app.tees.marks[0].displayC = displayC;
      const page = structuredClone(app);
      if (Array.isArray(displayC) && displayC[0] === 75) {
        expect(JSON.stringify(context.apply(page))).toEqual(JSON.stringify(applyTeeDisplayAnchors(app)));
      } else {
        expect(() => context.apply(page)).toThrow(/tee displayC/);
        expect(() => applyTeeDisplayAnchors(app)).toThrow(/tee displayC/);
      }
    }
  });
});
