import { createHash } from 'node:crypto';
import { CANONICAL_CRS } from './manifest.mjs';

const finite = (value, name) => {
  if (!Number.isFinite(value)) throw new TypeError(name + ' must be a finite number');
  return value;
};

function canonicalPoint(point, name = 'point') {
  if (!point || typeof point !== 'object' || Array.isArray(point)) {
    throw new TypeError(name + ' must be an object');
  }
  return {
    easting: finite(point.easting, name + '.easting'),
    northing: finite(point.northing, name + '.northing'),
    heightRH2000: finite(point.heightRH2000, name + '.heightRH2000'),
  };
}

function worldPoint(point, name = 'point') {
  if (!point || typeof point !== 'object' || Array.isArray(point)) {
    throw new TypeError(name + ' must be an object');
  }
  return {
    x: finite(point.x, name + '.x'),
    y: finite(point.y, name + '.y'),
    z: finite(point.z, name + '.z'),
  };
}

export function assertApprovedCanonicalFrame(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('manifest must be an object');
  }
  const frame = manifest.canonicalFrame;
  if (!frame || typeof frame !== 'object') {
    throw new Error(manifest.groundId + ': canonicalFrame is missing');
  }
  const expected = {
    compoundCrs: CANONICAL_CRS.compound,
    horizontalCrs: CANONICAL_CRS.horizontal,
    verticalCrs: CANONICAL_CRS.vertical,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (frame[field] !== value) {
      throw new Error(manifest.groundId + ': ' + field + ' must be ' + value);
    }
  }
  if (frame.originStatus !== 'approved') {
    throw new Error(manifest.groundId + ': canonical origin is not approved');
  }
  return Object.freeze({
    groundId: manifest.groundId,
    ...canonicalPoint({
      easting: frame.origin.easting,
      northing: frame.origin.northing,
      heightRH2000: frame.origin.heightRH2000,
    }, 'canonicalFrame.origin'),
  });
}

/* Within the canonical EPSG:5845 frame, whose world axes ARE the grid's, so a
   translation is the whole transform. This is NOT the way into a legacy page's
   world: that frame's -z is TRUE north and its metre is a sphere's, and the
   three terms between them live in apps/golf/src/engine/geodetic-frame.mjs. */
export function canonicalToWorld(point, origin) {
  const p = canonicalPoint(point);
  const o = canonicalPoint(origin, 'origin');
  return {
    x: p.easting - o.easting,
    y: p.heightRH2000 - o.heightRH2000,
    z: o.northing - p.northing,
  };
}

export function worldToCanonical(point, origin) {
  const p = worldPoint(point);
  const o = canonicalPoint(origin, 'origin');
  return {
    easting: o.easting + p.x,
    northing: o.northing - p.z,
    heightRH2000: o.heightRH2000 + p.y,
  };
}

export function canonicalArrayToWorld(position, origin) {
  if (!Array.isArray(position) || position.length !== 3) {
    throw new TypeError('position must be [easting, northing, heightRH2000]');
  }
  const world = canonicalToWorld({
    easting: position[0],
    northing: position[1],
    heightRH2000: position[2],
  }, origin);
  return [world.x, world.y, world.z];
}

export function worldArrayToCanonical(position, origin) {
  if (!Array.isArray(position) || position.length !== 3) {
    throw new TypeError('position must be [worldX, worldY, worldZ]');
  }
  const canonical = worldToCanonical({
    x: position[0],
    y: position[1],
    z: position[2],
  }, origin);
  return [canonical.easting, canonical.northing, canonical.heightRH2000];
}

export function canonicalFrameFingerprint(manifest) {
  const origin = assertApprovedCanonicalFrame(manifest);
  const contract = [
    'course-frame-v1',
    origin.groundId,
    CANONICAL_CRS.compound,
    origin.easting.toFixed(3),
    origin.northing.toFixed(3),
    origin.heightRH2000.toFixed(3),
    'x=e-oE',
    'z=oN-n',
    'y=h-oH',
  ].join('|');
  return createHash('sha256').update(contract).digest('hex');
}
