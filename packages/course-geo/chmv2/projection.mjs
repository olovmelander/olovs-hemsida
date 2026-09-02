/* SWEREF 99 TM (EPSG:3006) and Web Mercator (EPSG:3857) in plain Node, for
   the one place the pipeline has to leave the Lantmäteriet grid: sampling a
   Web Mercator canopy raster at EPSG:3006 cell centres. PROJ is the
   authority everywhere else (the migration ran through it, on a machine
   that has it); this is Snyder's transverse Mercator series on GRS 80,
   which at Puttom's 3.9 degrees from the central meridian agrees with PROJ's
   own numbers in this repository to a few millimetres (projection tests).
   SWEREF 99 is treated as WGS 84: the two differ by decimetres at most,
   which is below the 0.54 m pixel this is used against and is stated in the
   evidence rather than hidden.                                               */

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const LON0 = 15 * Math.PI / 180;
const FALSE_EASTING = 500000;
const FALSE_NORTHING = 0;
const RAD = Math.PI / 180;
const MERCATOR_RADIUS = 6378137;

function meridianArc(phi) {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
}

/** Latitude and longitude in degrees to SWEREF 99 TM easting and northing. */
export function latLonToSweref99Tm(latitudeDegrees, longitudeDegrees) {
  const phi = latitudeDegrees * RAD;
  const lambda = longitudeDegrees * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = EP2 * cosPhi * cosPhi;
  const a = (lambda - LON0) * cosPhi;
  const a2 = a * a, a3 = a2 * a, a4 = a3 * a, a5 = a4 * a, a6 = a5 * a;
  const easting = FALSE_EASTING + K0 * n * (a + (1 - t + c) * a3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a5 / 120);
  const northing = FALSE_NORTHING + K0 * (meridianArc(phi) + n * tanPhi * (a2 / 2 + (5 - t + 9 * c + 4 * c * c) * a4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a6 / 720));
  return [easting, northing];
}

/** SWEREF 99 TM easting and northing to latitude and longitude in degrees. */
export function sweref99TmToLatLon(easting, northing) {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const m = (northing - FALSE_NORTHING) / K0;
  const mu = m / (A * (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
  const sqrt1e2 = Math.sqrt(1 - E2);
  const e1 = (1 - sqrt1e2) / (1 + sqrt1e2);
  const e12 = e1 * e1, e13 = e12 * e1, e14 = e13 * e1;
  const phi1 = mu + (3 * e1 / 2 - 27 * e13 / 32) * Math.sin(2 * mu)
    + (21 * e12 / 16 - 55 * e14 / 32) * Math.sin(4 * mu)
    + (151 * e13 / 96) * Math.sin(6 * mu)
    + (1097 * e14 / 512) * Math.sin(8 * mu);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1);
  const t1 = tanPhi1 * tanPhi1;
  const c1 = EP2 * cosPhi1 * cosPhi1;
  const r1 = A * (1 - E2) / Math.pow(1 - E2 * sinPhi1 * sinPhi1, 1.5);
  const d = (easting - FALSE_EASTING) / (n1 * K0);
  const d2 = d * d, d3 = d2 * d, d4 = d3 * d, d5 = d4 * d, d6 = d5 * d;
  const phi = phi1 - (n1 * tanPhi1 / r1) * (d2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d6 / 720);
  const lambda = LON0 + (d - (1 + 2 * t1 + c1) * d3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d5 / 120) / cosPhi1;
  /* the series inverse is a few millimetres off four degrees from the
     central meridian; three fixed-point steps against the forward make the
     inverse exact to the forward's own precision */
  let latitude = phi / RAD;
  let longitude = lambda / RAD;
  for (let step = 0; step < 3; step++) {
    const [e, n] = latLonToSweref99Tm(latitude, longitude);
    const sinLat = Math.sin(latitude * RAD);
    const w = Math.sqrt(1 - E2 * sinLat * sinLat);
    const metresPerLatitudeDegree = RAD * K0 * A * (1 - E2) / (w * w * w);
    const metresPerLongitudeDegree = RAD * K0 * A * Math.cos(latitude * RAD) / w;
    latitude += (northing - n) / metresPerLatitudeDegree;
    longitude += (easting - e) / metresPerLongitudeDegree;
  }
  return [latitude, longitude];
}

/** Latitude and longitude in degrees to Web Mercator metres. */
export function latLonToWebMercator(latitudeDegrees, longitudeDegrees) {
  const phi = latitudeDegrees * RAD;
  return [MERCATOR_RADIUS * longitudeDegrees * RAD, MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))];
}

export function webMercatorToLatLon(x, y) {
  const longitude = x / MERCATOR_RADIUS / RAD;
  const latitude = (2 * Math.atan(Math.exp(y / MERCATOR_RADIUS)) - Math.PI / 2) / RAD;
  return [latitude, longitude];
}

/** Ground metres per Web Mercator metre at a latitude (the projection's scale). */
export function webMercatorGroundScale(latitudeDegrees) {
  return Math.cos(latitudeDegrees * RAD);
}
