import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertApprovedCanonicalFrame,
  canonicalArrayToWorld,
  canonicalFrameFingerprint,
  canonicalToWorld,
  worldArrayToCanonical,
  worldToCanonical,
} from './frame.mjs';

const origin = {
  easting: 654321.125,
  northing: 6642123.75,
  heightRH2000: 24.625,
};
const approvedManifest = (groundId = 'test-ground') => ({
  groundId,
  canonicalFrame: {
    compoundCrs: 'EPSG:5845',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613',
    originStatus: 'approved',
    origin,
  },
});
test('EPSG:5845 maps east to +x, north to -z and RH 2000 up to +y', () => {
  assert.deepEqual(canonicalToWorld({
    easting: origin.easting + 12.5,
    northing: origin.northing + 8.25,
    heightRH2000: origin.heightRH2000 + 1.75,
  }, origin), { x: 12.5, y: 1.75, z: -8.25 });
});

test('national coordinates round trip without changing axis order', () => {
  const canonical = {
    easting: 654987.4321,
    northing: 6641456.7892,
    heightRH2000: 37.6543,
  };
  const back = worldToCanonical(canonicalToWorld(canonical, origin), origin);
  assert.ok(Math.abs(back.easting - canonical.easting) < 1e-9);
  assert.ok(Math.abs(back.northing - canonical.northing) < 1e-9);
  assert.ok(Math.abs(back.heightRH2000 - canonical.heightRH2000) < 1e-9);
});

test('array conversion uses Three.js [x,y,z], never GIS axis order', () => {
  const canonical = [origin.easting + 2, origin.northing - 3, origin.heightRH2000 + 4];
  const world = canonicalArrayToWorld(canonical, origin);
  assert.deepEqual(world, [2, 4, 3]);
  assert.deepEqual(worldArrayToCanonical(world, origin), canonical);
});

test('longitude/latitude-shaped or incomplete coordinates are rejected', () => {
  assert.throws(
    () => canonicalToWorld({ longitude: 18, latitude: 63, height: 20 }, origin),
    /point\.easting/,
  );
  assert.throws(
    () => canonicalArrayToWorld([654321, 6642123], origin),
    /easting, northing, heightRH2000/,
  );
});

test('pending canonical origins are never exposed', () => {
  const manifest = approvedManifest();
  manifest.canonicalFrame.originStatus = 'pending-control-approval';
  manifest.canonicalFrame.origin = {
    easting: null,
    northing: null,
    heightRH2000: null,
  };
  assert.throws(() => assertApprovedCanonicalFrame(manifest), /not approved/);
});

test('CRS mismatch is rejected before exposing an origin', () => {
  const manifest = approvedManifest();
  manifest.canonicalFrame.horizontalCrs = 'EPSG:4326';
  assert.throws(() => assertApprovedCanonicalFrame(manifest), /must be EPSG:3006/);
});

test('frame fingerprint changes with ground or millimetre origin', () => {
  const first = canonicalFrameFingerprint(approvedManifest());
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(canonicalFrameFingerprint(approvedManifest()), first);
  assert.notEqual(canonicalFrameFingerprint(approvedManifest('other-ground')), first);
  const moved = approvedManifest();
  moved.canonicalFrame.origin = { ...origin, easting: origin.easting + 0.001 };
  assert.notEqual(canonicalFrameFingerprint(moved), first);
});
