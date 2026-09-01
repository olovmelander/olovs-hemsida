import { describe, expect, it } from 'vitest';
import {
  ellipsoidMetresPerDegree,
  inscribedLegacyBounds,
  legacyGridBridge,
  meridianConvergenceRadians,
  transverseMercatorPointScale,
} from './geodetic-frame.mjs';

/* ------------------------------------------------------ a reference to test against

   The bridge is a linearisation, so it can only be judged against the real
   projection. This is the Krüger series forward EPSG:3006, kept in the test
   and never shipped -- and it is itself checked, first thing, against the one
   projected point this repo holds from real PROJ. If it cannot reproduce that,
   nothing measured with it means anything. */
const KRUGER = (() => {
  const a = 6378137.0, f = 1 / 298.257222101;
  const k0 = 0.9996, lambda0 = 15 * Math.PI / 180, FE = 500000, FN = 0;
  const e2 = f * (2 - f), n = f / (2 - f), e = Math.sqrt(e2);
  const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const a1 = n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180;
  const a2 = 13 * n * n / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440;
  const a3 = 61 * n ** 3 / 240 - 103 * n ** 4 / 140;
  const a4 = 49561 * n ** 4 / 161280;
  return function project(latitudeDegrees, longitudeDegrees) {
    const phi = latitudeDegrees * Math.PI / 180;
    const dl = longitudeDegrees * Math.PI / 180 - lambda0;
    const q = Math.asinh(Math.tan(phi)) - e * Math.atanh(e * Math.sin(phi));
    const phiStar = Math.atan(Math.sinh(q));
    const xi = Math.atan2(Math.tan(phiStar), Math.cos(dl));
    const eta = Math.atanh(Math.cos(phiStar) * Math.sin(dl));
    return {
      northing: k0 * A * (xi
        + a1 * Math.sin(2 * xi) * Math.cosh(2 * eta) + a2 * Math.sin(4 * xi) * Math.cosh(4 * eta)
        + a3 * Math.sin(6 * xi) * Math.cosh(6 * eta) + a4 * Math.sin(8 * xi) * Math.cosh(8 * eta)) + FN,
      easting: k0 * A * (eta
        + a1 * Math.cos(2 * xi) * Math.sinh(2 * eta) + a2 * Math.cos(4 * xi) * Math.sinh(4 * eta)
        + a3 * Math.cos(6 * xi) * Math.sinh(6 * eta) + a4 * Math.cos(8 * xi) * Math.sinh(8 * eta)) + FE,
    };
  };
})();

/* Puttom's GPK1 origin and the EPSG:3006 projection of it that
   v2-puttom-preview.mjs has carried since the pilot was compiled. */
const PUTTOM = Object.freeze({ latitude: 63.2992, longitude: 18.9413 });
const PUTTOM_PROJECTED = Object.freeze({ easting: 697498.021708, northing: 7024997.739459 });
const FRAME_METRES_PER_LATITUDE = 111320;
const FRAME_METRES_PER_LONGITUDE = 111320 * Math.cos(PUTTOM.latitude * Math.PI / 180);

describe('the reference projection', () => {
  it('reproduces the committed PROJ point to a micrometre', () => {
    const got = KRUGER(PUTTOM.latitude, PUTTOM.longitude);
    expect(Math.abs(got.easting - PUTTOM_PROJECTED.easting)).toBeLessThan(1e-5);
    expect(Math.abs(got.northing - PUTTOM_PROJECTED.northing)).toBeLessThan(1e-5);
  });
});

describe('meridian convergence', () => {
  it('agrees with the projection it describes, to a milliarcsecond', () => {
    for (const [latitude, longitude] of [
      [63.2992, 18.9413], [55.6, 13.0], [68.4, 21.5], [59.3, 15.0], [62.98, 18.53],
    ]) {
      const origin = KRUGER(latitude, longitude);
      const north = KRUGER(latitude + 1e-6, longitude);
      /* the grid bearing of true north is the convergence, negated */
      const measured = -Math.atan2(north.easting - origin.easting, north.northing - origin.northing);
      const derived = meridianConvergenceRadians(latitude, longitude);
      const arcseconds = Math.abs(measured - derived) * 180 / Math.PI * 3600;
      expect(arcseconds).toBeLessThan(1e-3);
    }
  });

  it('is zero on the central meridian and changes sign across it', () => {
    expect(Math.abs(meridianConvergenceRadians(63.3, 15))).toBeLessThan(1e-15);
    expect(meridianConvergenceRadians(63.3, 18.9)).toBeGreaterThan(0);
    expect(meridianConvergenceRadians(63.3, 11.1)).toBeLessThan(0);
  });

  it('puts the Puttom grid north 3.52 degrees east of true north', () => {
    const degrees = meridianConvergenceRadians(PUTTOM.latitude, PUTTOM.longitude) * 180 / Math.PI;
    expect(degrees).toBeCloseTo(3.522145, 5);
  });
});

describe('the ellipsoid and the point scale', () => {
  it('measures the parallel arc the projection measures', () => {
    const { perLongitude } = ellipsoidMetresPerDegree(PUTTOM.latitude);
    const k = transverseMercatorPointScale(PUTTOM.latitude, PUTTOM.longitude);
    const origin = KRUGER(PUTTOM.latitude, PUTTOM.longitude);
    const east = KRUGER(PUTTOM.latitude, PUTTOM.longitude + 1e-6);
    const gridPerDegree = Math.hypot(east.easting - origin.easting, east.northing - origin.northing) / 1e-6;
    expect(Math.abs(gridPerDegree / k - perLongitude)).toBeLessThan(0.1);
  });

  it('keeps the legacy frame constants short of the ellipsoid, by the amounts that matter', () => {
    const ellipsoid = ellipsoidMetresPerDegree(PUTTOM.latitude);
    expect(FRAME_METRES_PER_LATITUDE / ellipsoid.perLatitude).toBeCloseTo(0.99868665, 7);
    expect(FRAME_METRES_PER_LONGITUDE / ellipsoid.perLongitude).toBeCloseTo(0.99732959, 7);
  });
});

describe('the legacy grid bridge', () => {
  const bridge = legacyGridBridge({
    ...PUTTOM,
    metresPerLatitude: FRAME_METRES_PER_LATITUDE,
    metresPerLongitude: FRAME_METRES_PER_LONGITUDE,
  });

  /* Walk the pilot's own extent: legacy world -> WGS84 by the pack's flat-earth
     rule -> EPSG:3006 by the reference projection -> back through the bridge. */
  function roundTripErrors(transform) {
    const errors = [];
    for (let x = -512; x <= 512; x += 32) for (let z = -512; z <= 512; z += 32) {
      const latitude = PUTTOM.latitude + (-z) / FRAME_METRES_PER_LATITUDE;
      const longitude = PUTTOM.longitude + x / FRAME_METRES_PER_LONGITUDE;
      const projected = KRUGER(latitude, longitude);
      const [gx, gz] = transform(
        projected.easting - PUTTOM_PROJECTED.easting,
        PUTTOM_PROJECTED.northing - projected.northing,
      );
      errors.push(Math.hypot(gx - x, gz - z));
    }
    return { worst: Math.max(...errors), mean: errors.reduce((s, v) => s + v, 0) / errors.length };
  }

  it('lands the pilot within a decimetre, where translation alone is 45 m out', () => {
    const translationOnly = roundTripErrors((x, z) => [x, z]);
    expect(translationOnly.worst).toBeGreaterThan(45);
    const rotationOnly = roundTripErrors((x, z) => {
      const c = Math.cos(bridge.rotationRadians), s = Math.sin(bridge.rotationRadians);
      return [x * c - z * s, x * s + z * c];
    });
    expect(rotationOnly.worst).toBeLessThan(1.7);
    const complete = roundTripErrors(bridge.toLegacy);
    expect(complete.worst).toBeLessThan(0.15);
    expect(complete.mean).toBeLessThan(0.05);
  });

  it('inverts itself', () => {
    for (const [x, z] of [[0, 0], [512, -512], [-311, 207], [1, 99999]]) {
      const [gx, gz] = bridge.toGrid(...bridge.toLegacy(x, z));
      expect(gx).toBeCloseTo(x, 8);
      expect(gz).toBeCloseTo(z, 8);
    }
  });

  it('reduces to a pure rotation for a metric-true frame', () => {
    const ellipsoid = ellipsoidMetresPerDegree(PUTTOM.latitude);
    const k = transverseMercatorPointScale(PUTTOM.latitude, PUTTOM.longitude);
    const pure = legacyGridBridge({
      ...PUTTOM,
      metresPerLatitude: ellipsoid.perLatitude * k,
      metresPerLongitude: ellipsoid.perLongitude * k,
    });
    expect(pure.scaleX).toBeCloseTo(1, 12);
    expect(pure.scaleZ).toBeCloseTo(1, 12);
  });

  it('refuses a frame scale that is not a projection subtlety', () => {
    expect(() => legacyGridBridge({
      ...PUTTOM, metresPerLatitude: 111320, metresPerLongitude: 111320,
    })).toThrow(/plausible frame scale/);
    expect(() => legacyGridBridge({ ...PUTTOM, metresPerLatitude: 0, metresPerLongitude: 1 }))
      .toThrow(/must be positive/);
  });
});

describe('the inscribed legacy rectangle', () => {
  const bridge = legacyGridBridge({
    ...PUTTOM,
    metresPerLatitude: FRAME_METRES_PER_LATITUDE,
    metresPerLongitude: FRAME_METRES_PER_LONGITUDE,
  });
  const grid = { x0: -512, x1: 512, z0: -512, z1: 512 };

  it('keeps every corner inside the rotated footprint', () => {
    const rect = inscribedLegacyBounds(bridge, grid);
    for (const [x, z] of [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1]]) {
      const [gx, gz] = bridge.toGrid(x, z);
      expect(gx).toBeGreaterThanOrEqual(grid.x0);
      expect(gx).toBeLessThanOrEqual(grid.x1);
      expect(gz).toBeGreaterThanOrEqual(grid.z0);
      expect(gz).toBeLessThanOrEqual(grid.z1);
    }
  });

  it('gives up only the rotation overhang, not the pilot', () => {
    const rect = inscribedLegacyBounds(bridge, grid);
    expect(rect.x1 - rect.x0).toBeGreaterThan(940);
    expect(rect.z1 - rect.z0).toBeGreaterThan(940);
    expect(rect.x1 - rect.x0).toBeLessThan(1024);
  });

  it('returns the rectangle itself when nothing rotates', () => {
    const ellipsoid = ellipsoidMetresPerDegree(63.3);
    const k = transverseMercatorPointScale(63.3, 15);
    const straight = legacyGridBridge({
      latitude: 63.3, longitude: 15,
      metresPerLatitude: ellipsoid.perLatitude * k, metresPerLongitude: ellipsoid.perLongitude * k,
    });
    const rect = inscribedLegacyBounds(straight, grid);
    /* the strict-interior epsilon keeps it a hair inside, never outside */
    expect(rect.x0).toBeCloseTo(grid.x0, 4);
    expect(rect.z1).toBeCloseTo(grid.z1, 4);
    expect(rect.x0).toBeGreaterThan(grid.x0);
    expect(rect.z1).toBeLessThan(grid.z1);
  });
});
