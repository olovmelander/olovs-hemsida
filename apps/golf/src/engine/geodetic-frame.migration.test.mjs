import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legacyGridBridge } from './geodetic-frame.mjs';

/* ------------------------------------------- the bridge against real geometry

   geo_data/course-v2/<ground>/migration/ holds every course's playing geometry
   projected into EPSG:3006 POINT BY POINT through real PROJ. That is the exact
   answer the runtime bridge approximates with one rotation and two scales, over
   thousands of real coordinates, and none of it entered the derivation -- the
   bridge is computed from the frame's declared constants alone.

   It is also the measurement that says what the defect was: the shipped
   translation-only bridge put a green a median 15 to 40 m from where its own
   terrain says it stands. */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const BUILD_DIRECTORY = Object.freeze({
  puttom: 'puttombuild', angso: 'angsobuild', veckefjarden: 'geobuild',
  norrfallsviken: 'nvgkbuild', upsala: 'upsalabuild', johannesberg: 'johannesbergbuild',
});

/* One traversal order, applied to both files. The migrator rewrote coordinates
   in place, so the nth playing coordinate of one is the nth of the other; a
   count mismatch means that stopped being true and the pairing is void. */
function playingCoordinates(model) {
  const out = [];
  for (const hole of model.holes || []) {
    for (const point of hole.line || []) out.push(point);
    for (const key of ['green', 'fairway']) {
      const feature = hole[key];
      if (!feature) continue;
      if (feature.ring) out.push(...feature.ring);
      for (const ring of feature.rings || []) out.push(...ring);
    }
  }
  return out;
}

function quantile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

describe.each(Object.entries(BUILD_DIRECTORY))('%s: the bridge against PROJ', (ground, build) => {
  const migrated = JSON.parse(readFileSync(
    `${REPO}geo_data/course-v2/${ground}/migration/course-model.epsg3006.json`, 'utf8'));
  const legacy = JSON.parse(readFileSync(`${REPO}${build}/course-model.json`, 'utf8'));
  const legacyPoints = playingCoordinates(legacy);
  const projectedPoints = playingCoordinates(migrated.geometry);
  const frame = migrated.source.localFrame;
  const origin = migrated.candidateOrigin;

  it('pairs its playing geometry coordinate for coordinate', () => {
    expect(legacyPoints.length).toBe(projectedPoints.length);
    expect(legacyPoints.length).toBeGreaterThan(600);
  });

  it('reproduces the point-by-point projection to a few centimetres', () => {
    const bridge = legacyGridBridge({
      latitude: frame.originWgs84.latitude,
      longitude: frame.originWgs84.longitude,
      metresPerLatitude: frame.metresPerLatitude,
      metresPerLongitude: frame.metresPerLongitude,
    });
    const translationOnly = [], bridged = [];
    for (let index = 0; index < legacyPoints.length; index++) {
      const gridX = projectedPoints[index][0] - origin.easting;
      const gridZ = origin.northing - projectedPoints[index][1];
      const [legacyX, legacyZ] = legacyPoints[index];
      translationOnly.push(Math.hypot(gridX - legacyX, gridZ - legacyZ));
      const [bridgedX, bridgedZ] = bridge.toLegacy(gridX, gridZ);
      bridged.push(Math.hypot(bridgedX - legacyX, bridgedZ - legacyZ));
    }
    /* the defect, stated so it cannot come back unnoticed */
    expect(quantile(translationOnly, 0.5)).toBeGreaterThan(10);
    expect(quantile(translationOnly, 1)).toBeGreaterThan(20);
    /* the fix, stated as a bound and not as the number of the day */
    expect(quantile(bridged, 0.5)).toBeLessThan(0.05);
    expect(quantile(bridged, 1)).toBeLessThan(0.30);
  });

  it('derives a convergence the migration report independently fitted', () => {
    const report = JSON.parse(readFileSync(
      `${REPO}geo_data/course-v2/${ground}/migration/residual-report.json`, 'utf8'));
    const fitted = -report.aggregate.scopes.playingGeometry.bestFitSimilarity.rotationDegrees;
    const derived = legacyGridBridge({
      latitude: frame.originWgs84.latitude,
      longitude: frame.originWgs84.longitude,
      metresPerLatitude: frame.metresPerLatitude,
      metresPerLongitude: frame.metresPerLongitude,
    }).rotationDegrees;
    /* The report fits ONE scale where the truth has two, so its rotation
       absorbs a little of the anisotropy -- up to about 90 arcseconds here,
       which over a 500 m course is 22 cm. Close enough to corroborate the
       derivation, not close enough to replace it. */
    expect(Math.abs(derived - fitted) * 3600).toBeLessThan(90);
    expect(Math.sign(derived)).toBe(Math.sign(fitted));
  });
});
