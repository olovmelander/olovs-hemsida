import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyReviewedStoraSurfaces } from '../tools/apply-reviewed-stora-surfaces.mjs';
import { pointInPoly } from '../upsalabuild/lib.mjs';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const evidence = read('../upsalabuild/mapping/stora-surfaces-2025.json');
const stora = read('../upsalabuild/course-model.json');
const mellan = read('../upsalamellanbuild/course-model.json');
const key = ring => JSON.stringify(ring);
const fixture = () => {
  const model = structuredClone(stora);
  for (const f of evidence.features) model.holes.find(h => h.n === f.hole)[f.kind] = structuredClone(f.originalShape);
  return model;
};
function panelPoint(feature, [x, y]) {
  const [e0, n0, e1, n1] = feature.tracePanel.extentEPSG3006;
  const [latitude, longitude] = sweref99TmToLatLon(e0 + x / 720 * (e1 - e0), n1 - (y - 44) / 720 * (n1 - n0));
  return [(longitude - stora.origin.lon) * stora.mPerLon, (stora.origin.lat - latitude) * stora.mPerLat];
}

describe('Stora dated fairway and green corrections', () => {
  it('preserves routes, pins, tees, bunkers and shared infrastructure when adopting mowing outlines', () => {
    const model = fixture(), before = structuredClone(model);
    applyReviewedStoraSurfaces(model, evidence);
    expect(model.holes.map(({ green, fairway, ...h }) => ({ ...h, pin: green.c })))
      .toEqual(before.holes.map(({ green, fairway, ...h }) => ({ ...h, pin: green.c })));
    expect(model.infra).toEqual(before.infra);
    expect(model.water).toEqual(before.water);
    expect(model.scenery).toEqual(before.scenery);
  });

  it('rejects a late stale replacement or a wrong frame before changing any surface', () => {
    const model = fixture();
    const last = evidence.features.at(-1);
    model.holes.find(h => h.n === last.hole).fairway.rings[0][0][0] += 1;
    const before = structuredClone(model);
    expect(() => applyReviewedStoraSurfaces(model, evidence)).toThrow(/original surface changed/);
    expect(model).toEqual(before);
    const wrong = structuredClone(evidence); wrong.frame.mPerLon += 1;
    expect(() => applyReviewedStoraSurfaces(fixture(), wrong)).toThrow(/frame changed/);
    const candidate = structuredClone(evidence); candidate.features.at(-1).status = 'candidate';
    expect(() => applyReviewedStoraSurfaces(fixture(), candidate)).toThrow(/unaccepted surface/);
  });

  it('reproduces each hand-traced source-panel vertex through an independent projection implementation', () => {
    for (const f of evidence.features) {
      f.tracedPanelPixelRings.forEach((pixels, part) => pixels.forEach((point, index) => {
        const p = panelPoint(f, point), q = f.rings[part][index];
        expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(0.005);
      }));
    }
  });

  it('keeps the observed hole 4 water crossing between separate fairway polygons', () => {
    const f = evidence.features.find(f => f.kind === 'fairway' && f.hole === 4);
    const crossing = panelPoint(f, [190, 320]);
    expect(stora.water.some(w => pointInPoly(...crossing, w.ring))).toBe(true);
    expect(f.originalShape.rings.some(r => pointInPoly(...crossing, r))).toBe(true);
    expect(stora.holes[3].fairway.rings).toHaveLength(2);
    expect(stora.holes[3].fairway.rings.some(r => pointInPoly(...crossing, r))).toBe(false);
  });

  it('removes the hole 16 green/sand overlap instead of moving or deleting the bunker', () => {
    const hole = stora.holes[15], old = evidence.features.find(f => f.kind === 'green').originalShape.ring;
    const points = hole.bunkers.flatMap(b => b.ring), xs = points.map(p => p[0]), zs = points.map(p => p[1]);
    let oldOverlap = 0, overlap = 0;
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) {
        if (!hole.bunkers.some(b => pointInPoly(x, z, b.ring))) continue;
        if (pointInPoly(x, z, old)) oldOverlap++;
        if (pointInPoly(x, z, hole.green.ring)) overlap++;
      }
    }
    expect(oldOverlap).toBeGreaterThan(0);
    expect(overlap).toBe(0);
  });

  it('renders each accepted footprint once in both courses without adding pixel or projected source coordinates', () => {
    for (const model of [stora, mellan]) {
      const surfaces = buildGroundSurfaceFeatures({ holes: model.holes, model, smoothEdges: true });
      for (const f of evidence.features) for (const ring of f.rings) {
        const surface = f.kind === 'green' ? SURFACE.GREEN : SURFACE.FAIRWAY;
        expect(surfaces.filter(s => s.surface === surface).flatMap(s => s.rings || []).filter(r => key(r) === key(ring))).toHaveLength(1);
      }
      for (const { pair } of collectCoordinatePairs(model).coordinates) expect(Math.max(...pair.map(Math.abs))).toBeLessThan(10000);
      expect(JSON.stringify(model)).not.toMatch(/tracedPanelPixelRings|extentEPSG3006|originalShape/);
    }
  });
});
