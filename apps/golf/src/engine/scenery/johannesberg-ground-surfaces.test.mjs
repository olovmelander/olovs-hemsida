import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPack, inflateStream } from '../../../../../packages/course-pack/lib.mjs';
import { validateRing } from '../../../../../johannesbergbuild/mapping/apply-ortho-review.mjs';
import { buildGroundSurfaceFeatures } from '../surface-features.mjs';
import { rasterizeGroundAtlas } from '../atlas.js';
import { inRing } from '../geom.js';
import { SURFACE } from '../surface.js';
import { loadSceneryModule } from './index.js';
import { applyGroundSurfaceReview, JOHANNESBERG_GROUND_REVIEW as review, groundAppearance } from './johannesberg-ground-surfaces.mjs';

function pack(slug) {
  const p = readPack(fs.readFileSync(new URL(`../../../public/courses/${slug}/pack.bin`, import.meta.url)));
  return { model: JSON.parse(inflateStream(p.sv)), geo: p.header.GEO };
}

const CORE = { x0: -260, z0: -880, x1: 250, z1: -100 };
function atlas(model) {
  const features = buildGroundSurfaceFeatures({ holes: model.holes, model });
  const data = rasterizeGroundAtlas({ CORE, features, res: 1, classesOnly: true });
  return { features, at(x, z) {
    return data.classes[Math.floor(z - CORE.z0) * data.bounds.w + Math.floor(x - CORE.x0)];
  } };
}

describe('Johannesberg source-reviewed ground surfaces', () => {
  it.each(review.courseSlugs)('corrects the actual %s pack before atlas construction', async slug => {
    const { model, geo } = pack(slug);
    const holes = structuredClone(model.holes), water = structuredClone(model.water), infra = structuredClone(model.infra);
    const before = atlas(model);
    const scenery = await loadSceneryModule(slug);
    scenery.applyGroundSurfaceReview(model, geo);
    const after = atlas(model);
    for (const c of review.controls) {
      const surface = after.at(...c.point);
      if (c.expectedMaterial === 'natural') {
        expect([SURFACE.GRAVEL, SURFACE.ROCK, SURFACE.ASPHALT, SURFACE.SAND], c.id).not.toContain(surface);
      } else expect(surface, c.id).toBe(c.expectedMaterial === 'rock' ? SURFACE.ROCK : SURFACE.GRAVEL);
      if (c.id.startsWith('yard-')) expect(before.at(...c.point), c.id).toBe(SURFACE.GRAVEL);
      if (c.id === 'h18-canopy') expect(before.at(...c.point)).toBe(SURFACE.ROCK);
    }
    expect(model.holes).toEqual(holes);
    expect(model.water).toEqual(water);
    expect(model.infra).toEqual(infra);
    const rendered = JSON.stringify(model);
    expect(applyGroundSurfaceReview(model, geo).id).toBe(review.id);
    expect(JSON.stringify(model)).toBe(rendered);
  });

  it('preserves the unpaved island as an interior exclusion, including through the compiler feature path', () => {
    const { model, geo } = pack('johannesberg');
    applyGroundSurfaceReview(model, geo);
    const feature = atlas(model).features.find(f => f.sourceId === 'works-north-access');
    const source = review.features.find(f => f.id === 'works-north-access');
    expect(feature.polygons).toEqual([{ rings: source.rings }]);
    const island = review.controls.find(c => c.id === 'yard-central-island').point;
    expect(inRing(...island, source.rings[0])).toBe(true);
    expect(inRing(...island, source.rings[1])).toBe(true);
  });

  it('has valid source polygons and pixel evidence without claiming an unknown capture date', () => {
    for (const feature of review.features) {
      const source = review.sources.find(s => s.id === feature.sourceId);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source.captureDate).toBeNull();
      expect(feature.rings.length).toBe(feature.pixelRings.length);
      feature.rings.forEach(r => validateRing(r, feature.id));
      for (const ring of feature.pixelRings) for (const [x, y] of ring) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(source.width);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(source.height);
      }
    }
  });

  it('refuses a different frame or revised baseline before changing anything', () => {
    const { model, geo } = pack('johannesberg');
    const before = JSON.stringify(model);
    expect(() => applyGroundSurfaceReview(model, { origin: { lat: 60, lon: 18 } })).toThrow('frame');
    expect(JSON.stringify(model)).toBe(before);
    model.surround.yard[0][0] += 1;
    const changed = JSON.stringify(model);
    expect(() => applyGroundSurfaceReview(model, geo)).toThrow('geometry changed');
    expect(JSON.stringify(model)).toBe(changed);
  });

  it('keeps mineral colours neutral and stops slope-only rock inference in both courses', async () => {
    for (const slug of review.courseSlugs) {
      expect((await loadSceneryModule(slug)).groundAppearance).toBe(groundAppearance);
    }
    expect(groundAppearance.rockFromSlope).toBe(false);
    for (const hex of Object.values(groundAppearance.palette)) {
      const red = hex >> 16, green = (hex >> 8) & 255, blue = hex & 255;
      expect(blue).toBeLessThanOrEqual(Math.min(red, green));
    }
    expect((await loadSceneryModule('puttom')).groundAppearance).toBeUndefined();
  });
});
