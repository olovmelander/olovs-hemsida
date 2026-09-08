import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyReviewedStoraPar3Sahara } from '../tools/apply-reviewed-stora-par3-sahara.mjs';
import { pointInPoly, polyArea } from '../upsalabuild/lib.mjs';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(name, import.meta.url)));
const evidence = read('../upsalabuild/mapping/stora-par3-sahara-review-2026-09-07.json');
const stora = read('../upsalabuild/course-model.json');
const fixture = () => {
  const model = structuredClone(stora);
  for (const f of evidence.features) {
    const hole = model.holes.find(h => h.n === f.hole);
    if (f.action === 'retire') hole.fairway = structuredClone(f.originalShape);
    else hole.bunkers = structuredClone(f.originalBunkers);
  }
  return model;
};
function panelPoint(panel, [x, y]) {
  const [e0, n0, e1, n1] = panel.extentEPSG3006;
  const [latitude, longitude] = sweref99TmToLatLon(e0 + x / 720 * (e1 - e0), n1 - (y - 44) / 720 * (n1 - n0));
  return [(longitude - stora.origin.lon) * stora.mPerLon, (stora.origin.lat - latitude) * stora.mPerLat];
}

describe('Stora reviewed par3 retirements and Sahara bunker', () => {
  it('changes only the three fairway claims and the eighth hole bunker census', () => {
    const model = fixture(), before = structuredClone(model);
    applyReviewedStoraPar3Sahara(model, evidence);
    for (const f of evidence.features) {
      const hole = before.holes.find(h => h.n === f.hole);
      const current = model.holes.find(h => h.n === f.hole);
      if (f.action === 'retire') hole.fairway = current.fairway;
      else hole.bunkers = current.bunkers;
    }
    expect(model).toEqual(before);
    expect(model.holes[9].fairway.rings).toEqual([]);
  });

  it('rejects stale geometry, unaccepted decisions and wrong frames before any mutation', () => {
    const model = fixture();
    model.holes[7].bunkers.push({ ring: [[0, 0], [5, 0], [0, 5]] });
    const before = structuredClone(model);
    expect(() => applyReviewedStoraPar3Sahara(model, evidence)).toThrow(/original bunker census changed/);
    expect(model).toEqual(before);
    const candidate = structuredClone(evidence); candidate.features.at(-1).status = 'candidate';
    expect(() => applyReviewedStoraPar3Sahara(fixture(), candidate)).toThrow(/unaccepted decision/);
    const wrong = structuredClone(evidence); wrong.frame.mPerLon++;
    expect(() => applyReviewedStoraPar3Sahara(fixture(), wrong)).toThrow(/frame changed/);
    const stale = fixture(); stale.holes[13].fairway.rings[0][0][0]++;
    expect(() => applyReviewedStoraPar3Sahara(stale, evidence)).toThrow(/original fairway changed/);
  });

  it('reproduces the sand trace and retirement witnesses through an independent projection', () => {
    for (const f of evidence.features) {
      if (f.action === 'add') {
        f.tracedPanelPixelRings[0].forEach((p, i) => {
          const actual = panelPoint(f.tracePanel, p), local = f.rings[0][i];
          expect(Math.hypot(actual[0] - local[0], actual[1] - local[1])).toBeLessThan(0.005);
        });
        expect(Math.abs(polyArea(f.rings[0]))).toBeCloseTo(f.areaM2, 2);
      } else {
        for (const observation of f.observations) {
          const actual = panelPoint(f.sourcePanels[0], observation.panelPixel);
          expect(Math.hypot(actual[0] - observation.localPoint[0], actual[1] - observation.localPoint[1])).toBeLessThan(0.005);
          expect(f.originalShape.rings.some(r => pointInPoly(...actual, r))).toBe(true);
        }
      }
    }
  });

  it('does not recreate a retired fairway and renders Sahara exactly once with its observed boundary', () => {
    const model = applyReviewedStoraPar3Sahara(fixture(), evidence);
    const surfaces = buildGroundSurfaceFeatures({ holes: model.holes, model, smoothEdges: true });
    for (const n of [2, 6, 14]) {
      expect(surfaces.some(f => f.hole === n && [SURFACE.FAIRWAY, SURFACE.SEMI].includes(f.surface))).toBe(false);
    }
    const bunker = evidence.features.find(f => f.kind === 'bunker');
    const matching = surfaces.filter(f => f.surface === SURFACE.SAND).flatMap(f => f.rings || [])
      .filter(r => JSON.stringify(r) === JSON.stringify(bunker.rings[0]));
    expect(matching).toHaveLength(1);
    const inside = panelPoint(bunker.tracePanel, [135, 410]);
    expect(pointInPoly(...inside, matching[0])).toBe(true);
    expect(pointInPoly(...model.holes[7].green.c, matching[0])).toBe(false);
  });

  it('keeps source-panel and projected coordinates outside the runtime model', () => {
    const model = applyReviewedStoraPar3Sahara(fixture(), evidence);
    for (const { pair } of collectCoordinatePairs(model).coordinates) expect(Math.max(...pair.map(Math.abs))).toBeLessThan(10000);
    expect(JSON.stringify(model)).not.toMatch(/tracedPanelPixelRings|extentEPSG3006|sourcePanels|originalBunkers|panelPixel|originalShape/);
  });
});
