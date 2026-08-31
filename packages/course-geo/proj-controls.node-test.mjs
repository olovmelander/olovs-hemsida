import test from 'node:test';
import assert from 'node:assert/strict';
import {
  latLonToSweref99Tm,
  sweref99TmToLatLon,
  swerefEllipsoidToEpsg5845,
} from './proj.mjs';

// Lantmateriet, "Kontrollpunkter for SWEREF 99 TM", 2007-11-20.
// https://www.lantmateriet.se/sv/geodata/gps-geodesi-och-swepos/Referenssystem/Tvadimensionella-system/SWEREF-99-projektioner/contentassets/kontrollpunkter_sweref99tm.pdf
const HORIZONTAL_CONTROLS = [
  [55.0, 12.75, 6097106.672, 356083.438],
  [55.0, 14.25, 6095048.642, 452024.069],
  [57.0, 12.75, 6319636.937, 363331.554],
  [57.0, 19.5, 6326392.707, 773251.054],
  [59.0, 11.25, 6546096.724, 284626.066],
  [59.0, 19.5, 6548757.206, 758410.519],
  [61.0, 12.75, 6764877.311, 378323.440],
  [61.0, 18.75, 6768593.345, 702745.127],
  [63.0, 12.0, 6989134.048, 348083.148],
  [63.0, 19.5, 6993565.630, 727798.671],
  [65.0, 13.5, 7209293.753, 429270.201],
  [65.0, 21.75, 7225449.115, 817833.405],
  [67.0, 16.5, 7432168.174, 565398.458],
  [67.0, 24.0, 7459745.672, 891298.142],
  [69.0, 21.0, 7666089.698, 739639.195],
];

function close(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

test('PROJ matches all official SWEREF 99 TM control points', () => {
  const actual = latLonToSweref99Tm(
    HORIZONTAL_CONTROLS.map(([latitude, longitude]) => ({ latitude, longitude })),
    { sourceCrs: 'EPSG:4619', decimals: 4 },
  );

  actual.forEach((point, index) => {
    const [, , northing, easting] = HORIZONTAL_CONTROLS[index];
    close(point.northing, northing, 0.002, `control ${index + 1} northing`);
    close(point.easting, easting, 0.002, `control ${index + 1} easting`);
  });
});

test('axis order is latitude/longitude in and named easting/northing out', () => {
  const [point] = latLonToSweref99Tm(
    [{ latitude: 60.666369395, longitude: 17.132577526 }],
    { sourceCrs: 'EPSG:4619', decimals: 4 },
  );
  close(point.northing, 6727518.0, 0.002, 'northing');
  close(point.easting, 616536.0, 0.002, 'easting');
  assert.ok(point.northing > point.easting * 5, 'axis-order sentinel must remain true');
});

test('legacy EPSG:4326 seed path agrees with SWEREF 99 at the control point', () => {
  const input = [{ latitude: 60.666369395, longitude: 17.132577526 }];
  const [wgs84] = latLonToSweref99Tm(input, { sourceCrs: 'EPSG:4326', decimals: 6 });
  const [sweref99] = latLonToSweref99Tm(input, { sourceCrs: 'EPSG:4619', decimals: 6 });
  close(wgs84.northing, sweref99.northing, 0.01, 'seed-path northing');
  close(wgs84.easting, sweref99.easting, 0.01, 'seed-path easting');
});

test('SWEREF 99 TM round trips without axis drift', () => {
  const input = HORIZONTAL_CONTROLS.map(([latitude, longitude]) => ({ latitude, longitude }));
  const projected = latLonToSweref99Tm(input, { sourceCrs: 'EPSG:4619', decimals: 6 });
  const roundTripped = sweref99TmToLatLon(projected, { targetCrs: 'EPSG:4619', decimals: 10 });
  roundTripped.forEach((point, index) => {
    close(point.latitude, input[index].latitude, 1e-9, `control ${index + 1} latitude`);
    close(point.longitude, input[index].longitude, 1e-9, `control ${index + 1} longitude`);
  });
});

test('official SWEN17_RH2000 height control matches EPSG:5845', () => {
  // Lantmateriet's live coordinate service returned 16.923 m on 2026-08-30,
  // agreeing with the checksummed PROJ-data grid. Its 2025 PROJ PDF prints
  // 16.993 m for the same input; grid-source.json records that discrepancy.
  const [point] = swerefEllipsoidToEpsg5845([{
    latitude: 60.666369395,
    longitude: 17.132577526,
    ellipsoidHeight: 42.0,
  }]);
  close(point.northing, 6727518.0, 0.002, 'northing');
  close(point.easting, 616536.0, 0.002, 'easting');
  close(point.heightRH2000, 16.923, 0.001, 'RH 2000 height');
});
