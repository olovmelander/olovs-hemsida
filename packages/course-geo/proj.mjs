import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const PYPROJ_HELPER = join(PACKAGE_DIR, 'pyproj-horizontal.py');

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

export function runGeoCommand(command, args, { input = '', env = {}, timeoutMilliseconds = 0 } = {}) {
  /* Callers derive this from a deadline, so it arrives as a float, and
     spawnSync rejects a non-integer timeout outright -- which is how a bounded
     canopy run died in one second with "The value of \"timeout\" is out of
     range" instead of reading any points. Round here rather than at every call
     site: a budget is a budget whichever caller computed it. */
  const timeout = timeoutMilliseconds > 0 ? Math.max(1, Math.floor(timeoutMilliseconds)) : 0;
  const result = spawnSync(command, args, {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    input,
    env: { ...process.env, PROJ_NETWORK: 'OFF', ...env },
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
    ...(timeout > 0 ? { timeout, killSignal: 'SIGKILL' } : {}),
  });

  /* A caller that set a bound wants to know it was hit, not to read
     "failed to start" about a command that started fine and ran too long. */
  if (timeout > 0 && (result.error?.code === 'ETIMEDOUT' || result.signal)) {
    const expired = new Error(`${command} exceeded its ${Math.round(timeout / 1000)} s budget`);
    expired.code = 'GEO_COMMAND_TIMEOUT';
    throw expired;
  }
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

/** Explicit, horizontal-only alternative when a real Python PROJ binding is
 * installed. This never impersonates cs2cs and does not replace vertical cct. */
export function horizontalProjectionBackend() {
  const python = process.env.COURSE_GEO_PYPROJ_PYTHON;
  if (!python) return { implementation: 'PROJ cs2cs', executable: 'cs2cs', axisOrder: 'authority', network: 'OFF', scope: 'horizontal-only' };
  const { stdout } = runGeoCommand(python, [PYPROJ_HELPER, '--metadata'], { env: { PROJ_NETWORK: 'OFF' } });
  return { ...JSON.parse(stdout), executable: python };
}

function horizontalRows(sourceCrs, targetCrs, decimals, input, rowCount, label) {
  const python = process.env.COURSE_GEO_PYPROJ_PYTHON;
  const command = python || 'cs2cs';
  const args = python
    ? [PYPROJ_HELPER, '--source', sourceCrs, '--target', targetCrs, '--decimals', String(decimals)]
    : ['-f', `%.${decimals}f`, sourceCrs, targetCrs];
  const { stdout } = runGeoCommand(command, args, { input, env: { PROJ_NETWORK: 'OFF' } });
  return parseRows(stdout, rowCount, python ? `pyproj ${label}` : `cs2cs ${label}`);
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
  return horizontalRows(sourceCrs, 'EPSG:3006', decimals, input, points.length, 'forward').map(([northing, easting]) => ({
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
  return horizontalRows('EPSG:3006', targetCrs, decimals, input, points.length, 'inverse').map(([latitude, longitude]) => ({
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
