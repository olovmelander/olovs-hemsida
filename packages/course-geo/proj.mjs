import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

export const TOOLCHAIN_DIR = join(PACKAGE_DIR, 'toolchain');
export const GRID_SPEC_PATH = join(TOOLCHAIN_DIR, 'grid-source.json');

export function loadGridSpec() {
  return JSON.parse(readFileSync(GRID_SPEC_PATH, 'utf8'));
}

export function gridPath() {
  const spec = loadGridSpec();
  return join(TOOLCHAIN_DIR, '.cache', 'proj', spec.fileName);
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function runGeoCommand(command, args, { input = '', env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    input,
    env: { ...process.env, PROJ_NETWORK: 'OFF', ...env },
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    const hint = result.error.code === 'ENOENT'
      ? ` Run this command through packages/course-geo/toolchain/pixi.toml.`
      : '';
    throw new Error(`${command} failed to start: ${result.error.message}.${hint}`);
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} exited with ${result.status}${detail ? `:\n${detail}` : ''}`);
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function parseRows(output, expectedRows, label) {
  const rows = output.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length < 2 || values.some(value => !Number.isFinite(value))) {
      throw new Error(`${label} returned an invalid row ${index + 1}: ${JSON.stringify(line)}`);
    }
    return values;
  });
  if (rows.length !== expectedRows) {
    throw new Error(`${label} returned ${rows.length} rows for ${expectedRows} input points`);
  }
  return rows;
}

/**
 * Transform latitude/longitude points to SWEREF 99 TM.
 *
 * EPSG geographic CRSs use latitude, longitude axis order. The returned named
 * values hide EPSG:3006's northing/easting axis order from callers.
 */
export function latLonToSweref99Tm(points, { sourceCrs = 'EPSG:4326', decimals = 6 } = {}) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const input = points.map(({ latitude, longitude }, index) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new TypeError(`point ${index} must contain finite latitude and longitude`);
    }
    return `${latitude} ${longitude}`;
  }).join('\n') + '\n';
  const { stdout } = runGeoCommand(
    'cs2cs',
    ['-f', `%.${decimals}f`, sourceCrs, 'EPSG:3006'],
    { input },
  );
  return parseRows(stdout, points.length, 'cs2cs').map(([northing, easting]) => ({
    easting,
    northing,
  }));
}

export function sweref99TmToLatLon(points, { targetCrs = 'EPSG:4619', decimals = 10 } = {}) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const input = points.map(({ northing, easting }, index) => {
    if (!Number.isFinite(northing) || !Number.isFinite(easting)) {
      throw new TypeError(`point ${index} must contain finite northing and easting`);
    }
    return `${northing} ${easting}`;
  }).join('\n') + '\n';
  const { stdout } = runGeoCommand(
    'cs2cs',
    ['-f', `%.${decimals}f`, 'EPSG:3006', targetCrs],
    { input },
  );
  return parseRows(stdout, points.length, 'cs2cs inverse').map(([latitude, longitude]) => ({
    latitude,
    longitude,
  }));
}

/**
 * Lantmateriet's published SWEREF 99 ellipsoid-height -> EPSG:5845 pipeline.
 * Input and output are named because cct itself uses positional axis values.
 */
export function swerefEllipsoidToEpsg5845(points, { decimals = 4 } = {}) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const input = points.map(({ latitude, longitude, ellipsoidHeight }, index) => {
    if (![latitude, longitude, ellipsoidHeight].every(Number.isFinite)) {
      throw new TypeError(`point ${index} must contain finite latitude, longitude and ellipsoidHeight`);
    }
    return `${latitude} ${longitude} ${ellipsoidHeight}`;
  }).join('\n') + '\n';
  const pipeline = [
    '-d', String(decimals), '-t', '0',
    '+proj=pipeline',
    '+step', '+proj=axisswap', '+order=2,1',
    '+step', '+proj=vgridshift', `+grids=${gridPath()}`,
    '+step', '+proj=tmerc', '+ellps=GRS80', '+lon_0=15',
    '+k_0=0.9996', '+x_0=500000',
    '+step', '+proj=axisswap', '+order=2,1',
  ];
  const { stdout } = runGeoCommand('cct', pipeline, { input });
  return parseRows(stdout, points.length, 'cct EPSG:5845').map(
    ([northing, easting, heightRH2000]) => ({ easting, northing, heightRH2000 }),
  );
}
