import { describe, expect, it } from 'vitest';
import { checkUpsalaTeeSnapshot, loadUpsalaTeeSnapshot, standaloneTeeCamera } from '../tools/check-upsala-tee-coordinates.mjs';

const source = loadUpsalaTeeSnapshot();
const changed = mutate => { const snapshot = structuredClone(source); mutate(snapshot); return snapshot; };

describe('Upsala source-to-consumer tee coordinate contract', () => {
  it('reproduces all accepted references and checks their actual published consumers in both frames', () => {
    const result = checkUpsalaTeeSnapshot(source);
    expect(result.passed).toBe(true);
    expect(result.courses.map(c => c.references)).toEqual([108, 45]);
    expect(result.courses.every(c => c.minimumAssociatedPadClearanceMetres >= 1)).toBe(true);
    expect(result.courses.every(c => c.maximumMigrationErrorMetres < 0.005)).toBe(true);
    expect(result.courses.every(c => c.maximumGeographicRoundingErrorMetres < 0.0002)).toBe(true);
    expect(result.courses[0].standaloneCameraReferencesChecked).toBe(108);
    expect(result.courses[1].independentlyCheckedPublishedSourcePoints).toBeGreaterThan(0);
    for (const [index, course] of source.courses.entries()) {
      const siteCount = new Set((course.siteReviews || []).flatMap(r => r.holes.flatMap(h => h.decisions.map(d => `${h.hole}:${d.markIndex}`)))).size;
      expect(result.courses[index].siteReviewed).toBe(siteCount);
      if (siteCount) expect(result.courses[index].minimumReviewedSiteClearanceMetres).toBeGreaterThanOrEqual(1);
      expect(result.courses[index].platformAssigned + result.courses[index].siteReviewed + result.courses[index].unresolvedRetained).toBe(result.courses[index].references);
    }
  }, 15000);

  it.each([
    ['the former distant landing-page marker', s => {
      s.landingMapSource = s.landingMapSource.replace('lat: 59.8415076', 'lat: 59.8510').replace('lng: 17.4955179', 'lng: 17.5250');
    }, /landing-page map marker lies outside/],
    ['stale model reference', s => { s.courses[0].model.holes[0].tees.marks[0].c[0] += 2; }, /current references/],
    ['different physical pad identity', s => { s.courses[0].model.holes[0].tees.pads[0].sourceId += '-other'; }, /platform identity/],
    ['changed source pad boundary', s => { s.courses[0].reviews[0].holes[0].referenceDecisions[0].originalPadRing[0][0] += 1; }, /platform boundary/],
    ['wrong longitude scale', s => { s.courses[0].packGeo.mPerLon = 111320; }, /longitude scale/],
    ['wrong packed axis declaration', s => { s.courses[0].packGeo.frame = 'east +x, north +z'; }, /packed axis declaration/],
    ['stale packed reference', s => { s.courses[0].packed.holes[0].tees.marks[0].c[1] *= -1; }, /packed tee geometry/],
    ['missing shared tee in the other routing', s => {
      const key = JSON.stringify(s.courses[0].model.holes[0].tees.pads[0].ring);
      s.courses[1].packed.scenery.tees = s.courses[1].packed.scenery.tees.filter(r => JSON.stringify(r) !== key);
    }, /shared tee surface missing or duplicated/],
    ['wrong EPSG northing axis', s => { s.courses[0].migration.geometry.holes[0].tees.marks[0].c[1] *= -1; }, /EPSG:3006 mismatch/],
    ['swapped geographic coordinate order', s => {
      const f = s.geojson.features.find(f => f.properties.occurrences.some(o => o.build === 'upsalabuild' && o.path === 'holes[0].tees.marks[0]'));
      f.geometry.coordinates.reverse();
    }, /longitude\/latitude mismatch/],
    ['stale published route start', s => { s.courses[0].routing.holes[0].line[0][0] += 3; }, /stale published routing/],
    ['wrong projected runtime origin', s => { s.courses[0].config.legacyOriginEpsg3006.northing += 5; }, /runtime world bridge mismatch/],
    ['camera setback in the actual app branch', s => {
      s.appSource = s.appSource.replace('const { position: [x, z], aim } = teeView(h, mk);',
        'const x = mk.c[0] - 7, z = mk.c[1]; const aim = alongLine(h.line, 0.72);');
    }, /actual app camera branch/],
    ['offset in the actual rangefinder origin', s => {
      s.appSource = s.appSource.replace('const o = origin || gpsOrigin || kikBall || mk.c;',
        'const o = origin || gpsOrigin || kikBall || [mk.c[0] + 7, mk.c[1]];');
    }, /app rangefinder origin differs/],
    ['broken follow-up review lineage', s => { s.courses[1].reviews.at(-1).holes[0].originalMarks[0].c[0] += 1; }, /original marker references changed/],
    ['misidentified published source point', s => {
      const decision = s.courses[1].reviews.at(-1).holes[0].referenceDecisions.find(d => d.positionSource);
      decision.positionSource.sourceFeatureId = '/points/0';
    }, /published source point identity differs/],
    ['wrong EPSG coordinates in both source representations', s => {
      const decision = s.courses[1].reviews.at(-1).holes[0].referenceDecisions.find(d => d.positionSource);
      decision.positionSource.epsg3006[0] += 8;
      const index = Number(decision.positionSource.sourceFeatureId.split('/').at(-1));
      s.courses[1].positionSources[decision.positionSource.sourcePath].points[index].publishedEpsg3006[0] += 8;
    }, /EPSG:3006 mismatch/],
    ['unsupported movement of an unresolved reference', s => {
      const review = s.courses[0].reviews[0], record = review.holes.find(h => h.referenceDecisions.some(d => d.status === 'retain'));
      const decision = record.referenceDecisions.find(d => d.status === 'retain');
      s.courses[0].model.holes[record.hole - 1].tees.marks[decision.markIndex].c[0] += 1;
    }, /current references/],
  ])('rejects %s', (_label, mutate, message) => {
    expect(() => checkUpsalaTeeSnapshot(changed(mutate))).toThrow(message);
  }, 15000);

  it('executes the standalone camera branch and rejects its former seven-metre setback', () => {
    const snapshot = changed(s => {
      s.standaloneSource = s.standaloneSource.replace('const { position: [x, z], aim } = teeView(h, mk);',
        'const x = mk.c[0] - F[0] * 7, z = mk.c[1] - F[1] * 7; const aim = alongLine(h.line, 0.72);');
    });
    const mark = source.courses[0].model.holes[0].tees.marks[0];
    const camera = standaloneTeeCamera(snapshot.standaloneSource, snapshot.standalone.holes, 1, 0);
    expect(Math.hypot(camera.position.x - mark.c[0], camera.position.z - mark.c[1])).toBeCloseTo(7, 8);
    expect(() => checkUpsalaTeeSnapshot(snapshot)).toThrow(/standalone camera offset/);
  }, 15000);

  it.each([
    ['references', record => { record.originalTees.marks[0].c[0] += 1; }, /site review reference lineage changed/],
    ['physical platform', record => { record.originalTees.pads[0].ring[0][0] += 1; }, /site review physical platform identity changed/],
  ])('rejects a third-phase original snapshot that contradicts prior %s', (_name, mutate, error) => {
    const snapshot = changed(s => {
      const course = s.courses.find(c => c.siteReviews?.length);
      expect(course, 'configured evidence-only site review is required').toBeDefined();
      mutate(course.siteReviews[0].holes[0]);
    });
    expect(() => checkUpsalaTeeSnapshot(snapshot)).toThrow(error);
  }, 15000);
});
