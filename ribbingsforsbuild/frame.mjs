/* The frozen Ribbingsfors frame, usable without the pixi/GDAL toolchain.

   These constants mirror FRAME in build-course.mjs (which cannot be imported
   here: that module runs the whole GDAL-dependent build at import time). The
   surroundings scripts project with the repo's own Krüger series
   (packages/course-geo/chmv2/projection.mjs), which reproduces the cs2cs
   origin E448975.5 N6536024.5 to 0.0000023 m east / 0.00072 m north — far
   inside every source's own accuracy. */
import { latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';

export const FRAME = Object.freeze({
  easting: 448975.5,
  northing: 6536024.5,
  latitude: 58.9607905493,
  longitude: 14.1128725388,
  fineHalfSpan: 1024,
  fineSpacing: 1,
  fineSize: 2049,
});

export const r1 = value => Math.round(value * 10) / 10;

export function localFromLatLon(latitude, longitude) {
  const [easting, northing] = latLonToSweref99Tm(latitude, longitude);
  return [r1(easting - FRAME.easting), r1(FRAME.northing - northing)];
}

export function localFromSweref([easting, northing]) {
  return [r1(easting - FRAME.easting), r1(FRAME.northing - northing)];
}
