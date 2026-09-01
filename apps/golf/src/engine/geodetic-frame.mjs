/* -------------------------------------------------- the two frames, reconciled

   A course pack's world is a flat-earth frame about its own WGS84 origin, with
   +x true east, -z TRUE north, and one constant metre-per-degree per axis. A
   v2 terrain product's world is EPSG:3006 (SWEREF 99 TM), whose +northing is
   GRID north. Those are not the same direction, and the difference is not
   small: at Puttom, 18.94 E, grid north stands 3.52 degrees off true north, so
   a bridge that only translates lands the terrain 45 m out at the corner of a
   1 km course.

   Three derived terms close that gap, and every one of them comes from the
   frames' own declared constants -- the origin, the ellipsoid, the projection.
   Nothing here is fitted to a measurement, because a fit against a 2 m DEM
   resolves an angle to about half a degree and this angle is knowable to a
   ten-thousandth of an arcsecond:

     1. meridian convergence     grid north -> true north          45.2 -> 1.6 m
     2. the frame's own scale    its metre is not the ellipsoid's   1.6 -> 0.1 m
     3. the point scale factor   grid metres -> ground metres       (inside 2)

   Term 2 deserves a word, because applying it looks at first like bending real
   data to fit a wrong frame. It is not. The legacy frame uses a sphere of the
   equatorial radius, so at 63 N its metre-per-degree runs 0.13% short in
   latitude and 0.34% short in longitude. Every green, tee and hole line in the
   pack was written through those same constants, and so is the conversion a
   GPS fix would take to enter that world -- the compression is self-consistent
   INSIDE the frame and cancels. It is only ever visible to something that
   arrives by another route, which is exactly what a v2 EPSG:3006 tile does. So
   matching it is the correct completion of the change of frame, not a fudge.
   What it does not do is make the legacy frame metric-true against the real
   world; that stays a property of the frame, and the fix for it is to reproject
   the whole app, which is the v2 endgame and not this bridge's job. */

const GRS80_SEMI_MAJOR_METRES = 6378137;
const GRS80_INVERSE_FLATTENING = 298.257222101;
const SWEREF99TM_CENTRAL_MERIDIAN_DEGREES = 15;
const SWEREF99TM_SCALE_FACTOR = 0.9996;
const DEGREES_TO_RADIANS = Math.PI / 180;

const FLATTENING = 1 / GRS80_INVERSE_FLATTENING;
const FIRST_ECCENTRICITY_SQUARED = FLATTENING * (2 - FLATTENING);
const SECOND_ECCENTRICITY_SQUARED = FIRST_ECCENTRICITY_SQUARED / (1 - FIRST_ECCENTRICITY_SQUARED);

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function latitudeRadians(latitudeDegrees) {
  const latitude = finiteNumber(latitudeDegrees, 'latitude');
  if (Math.abs(latitude) > 89) throw new RangeError('latitude must be inside the projection band');
  return latitude * DEGREES_TO_RADIANS;
}

/** Ellipsoidal ground metres per degree at a latitude: the meridian arc for
    latitude, the parallel arc for longitude. Both on GRS80, both exact. */
export function ellipsoidMetresPerDegree(latitudeDegrees) {
  const phi = latitudeRadians(latitudeDegrees);
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const w = 1 - FIRST_ECCENTRICITY_SQUARED * sinPhi * sinPhi;
  const meridianRadius = GRS80_SEMI_MAJOR_METRES * (1 - FIRST_ECCENTRICITY_SQUARED) / (w * Math.sqrt(w));
  const primeVerticalRadius = GRS80_SEMI_MAJOR_METRES / Math.sqrt(w);
  return Object.freeze({
    perLatitude: DEGREES_TO_RADIANS * meridianRadius,
    perLongitude: DEGREES_TO_RADIANS * primeVerticalRadius * cosPhi,
  });
}

/** The angle from true north to grid north, positive east of the central
    meridian. Ellipsoidal series in the longitude difference; the fifth-order
    term is already below a milliarcsecond at these longitudes and is kept only
    so the series stops being the limit before the input does. */
export function meridianConvergenceRadians(
  latitudeDegrees,
  longitudeDegrees,
  centralMeridianDegrees = SWEREF99TM_CENTRAL_MERIDIAN_DEGREES,
) {
  const phi = latitudeRadians(latitudeDegrees);
  const deltaLambda = (finiteNumber(longitudeDegrees, 'longitude')
    - finiteNumber(centralMeridianDegrees, 'centralMeridian')) * DEGREES_TO_RADIANS;
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const tanSquared = (sinPhi / cosPhi) ** 2;
  const etaSquared = SECOND_ECCENTRICITY_SQUARED * cosPhi * cosPhi;
  return deltaLambda * sinPhi
    + (deltaLambda ** 3 / 3) * sinPhi * cosPhi * cosPhi
      * (1 + 3 * etaSquared + 2 * etaSquared * etaSquared)
    + (deltaLambda ** 5 / 15) * sinPhi * cosPhi ** 4 * (2 - tanSquared);
}

/** Grid metres per ground metre at a point: k0 on the central meridian, rising
    with the square of the distance from it. 1.000078 at Puttom -- 4 cm over the
    pilot's half-span, which is why it is folded into the scale rather than
    carried as a fourth term. */
export function transverseMercatorPointScale(
  latitudeDegrees,
  longitudeDegrees,
  centralMeridianDegrees = SWEREF99TM_CENTRAL_MERIDIAN_DEGREES,
  scaleFactor = SWEREF99TM_SCALE_FACTOR,
) {
  const phi = latitudeRadians(latitudeDegrees);
  const deltaLambda = (finiteNumber(longitudeDegrees, 'longitude')
    - finiteNumber(centralMeridianDegrees, 'centralMeridian')) * DEGREES_TO_RADIANS;
  const cosPhi = Math.cos(phi);
  const tanSquared = (Math.sin(phi) / cosPhi) ** 2;
  const etaSquared = SECOND_ECCENTRICITY_SQUARED * cosPhi * cosPhi;
  const a = deltaLambda * cosPhi;
  return finiteNumber(scaleFactor, 'scaleFactor')
    * (1 + (a * a / 2) * (1 + etaSquared) + (a ** 4 / 24) * (5 - 4 * tanSquared));
}

/**
 * The complete linear bridge from a v2 grid-frame world (easting east, northing
 * north, already translated onto the legacy origin) to a legacy pack world.
 *
 * `metresPerLatitude`/`metresPerLongitude` are the pack's OWN declared frame
 * constants, not the ellipsoid's. Passing the ellipsoid's values yields a pure
 * rotation, which is the right bridge for a pack whose frame is metric-true.
 */
export function legacyGridBridge({
  latitude,
  longitude,
  metresPerLatitude,
  metresPerLongitude,
  centralMeridianDegrees = SWEREF99TM_CENTRAL_MERIDIAN_DEGREES,
  scaleFactor = SWEREF99TM_SCALE_FACTOR,
} = {}) {
  const ellipsoid = ellipsoidMetresPerDegree(latitude);
  const frameLatitude = finiteNumber(metresPerLatitude, 'metresPerLatitude');
  const frameLongitude = finiteNumber(metresPerLongitude, 'metresPerLongitude');
  if (!(frameLatitude > 0) || !(frameLongitude > 0)) {
    throw new RangeError('frame metres per degree must be positive');
  }
  const pointScale = transverseMercatorPointScale(
    latitude, longitude, centralMeridianDegrees, scaleFactor,
  );
  const rotationRadians = meridianConvergenceRadians(latitude, longitude, centralMeridianDegrees);
  const scaleX = (frameLongitude / ellipsoid.perLongitude) / pointScale;
  const scaleZ = (frameLatitude / ellipsoid.perLatitude) / pointScale;
  /* A bridge that silently rescaled the world by tens of percent would be a
     misconfigured frame, not a projection subtlety. */
  for (const [value, label] of [[scaleX, 'scaleX'], [scaleZ, 'scaleZ']]) {
    if (!(value > 0.9 && value < 1.1)) throw new RangeError(`${label} ${value} is outside a plausible frame scale`);
  }
  const cos = Math.cos(rotationRadians), sin = Math.sin(rotationRadians);
  return Object.freeze({
    rotationRadians,
    rotationDegrees: rotationRadians / DEGREES_TO_RADIANS,
    scaleX,
    scaleZ,
    pointScale,
    ellipsoidMetresPerLatitude: ellipsoid.perLatitude,
    ellipsoidMetresPerLongitude: ellipsoid.perLongitude,
    toLegacy: (gridX, gridZ) => [
      scaleX * (gridX * cos - gridZ * sin),
      scaleZ * (gridX * sin + gridZ * cos),
    ],
    toGrid: (legacyX, legacyZ) => {
      const x = legacyX / scaleX, z = legacyZ / scaleZ;
      return [x * cos + z * sin, -x * sin + z * cos];
    },
  });
}

/**
 * The largest axis-aligned legacy rectangle that still lies wholly inside a
 * grid-frame rectangle once the bridge has rotated it. A rotated footprint has
 * no axis-aligned corners, so the legacy CORE cutout -- which can only omit an
 * axis-aligned rectangle -- has to stay inside the inscribed one or it would
 * punch a hole the v2 mesh does not reach.
 *
 * Found by bisecting a uniform inset rather than by a closed form: the closed
 * form for an off-centre rectangle is not one expression, and this runs 48
 * deterministic iterations once per boot.
 */
export function inscribedLegacyBounds(bridge, gridBounds, { epsilon = 1e-6 } = {}) {
  if (typeof bridge?.toLegacy !== 'function' || typeof bridge?.toGrid !== 'function') {
    throw new TypeError('a legacy grid bridge is required');
  }
  const g = {
    x0: finiteNumber(gridBounds?.x0, 'gridBounds.x0'), x1: finiteNumber(gridBounds?.x1, 'gridBounds.x1'),
    z0: finiteNumber(gridBounds?.z0, 'gridBounds.z0'), z1: finiteNumber(gridBounds?.z1, 'gridBounds.z1'),
  };
  if (!(g.x1 > g.x0 && g.z1 > g.z0)) throw new RangeError('gridBounds must have positive extents');
  const corners = [[g.x0, g.z0], [g.x1, g.z0], [g.x0, g.z1], [g.x1, g.z1]]
    .map(([x, z]) => bridge.toLegacy(x, z));
  const outer = {
    x0: Math.min(...corners.map(c => c[0])), x1: Math.max(...corners.map(c => c[0])),
    z0: Math.min(...corners.map(c => c[1])), z1: Math.max(...corners.map(c => c[1])),
  };
  const insetFits = inset => {
    const rect = { x0: outer.x0 + inset, x1: outer.x1 - inset, z0: outer.z0 + inset, z1: outer.z1 - inset };
    if (!(rect.x1 > rect.x0 && rect.z1 > rect.z0)) return null;
    for (const [x, z] of [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1]]) {
      const [gx, gz] = bridge.toGrid(x, z);
      if (gx < g.x0 + epsilon || gx > g.x1 - epsilon || gz < g.z0 + epsilon || gz > g.z1 - epsilon) return null;
    }
    return rect;
  };
  let low = 0, high = Math.min(outer.x1 - outer.x0, outer.z1 - outer.z0) / 2;
  let best = insetFits(low);
  if (!best) {
    for (let step = 0; step < 48; step++) {
      const mid = (low + high) / 2;
      const rect = insetFits(mid);
      if (rect) { best = rect; high = mid; } else { low = mid; }
    }
  }
  if (!best) throw new RangeError('the rotated grid bounds contain no axis-aligned legacy rectangle');
  return Object.freeze(best);
}
