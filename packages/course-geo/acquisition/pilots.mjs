import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../proj.mjs';
import { readJson } from '../manifest.mjs';

export const PILOT_GROUND_IDS = Object.freeze(['norrfallsviken', 'puttom', 'upsala']);

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..');
export const COURSE_DATA_DIR = path.join(REPO_ROOT, 'geo_data/course-v2');

export function manifestPath(groundId) {
  if (!PILOT_GROUND_IDS.includes(groundId)) throw new Error(`unknown D2 pilot ${groundId}`);
  return path.join(COURSE_DATA_DIR, groundId, 'source-manifest.json');
}

export function loadPilotManifest(groundId) {
  return readJson(manifestPath(groundId));
}

export function edgePoints(bbox, segments = 16) {
  if (!Number.isInteger(segments) || segments < 1) throw new RangeError('segments must be positive');
  const [west, south, east, north] = bbox;
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const longitude = west + (east - west) * t;
    const latitude = south + (north - south) * t;
    points.push({ latitude: south, longitude });
    points.push({ latitude: north, longitude });
    if (index > 0 && index < segments) {
      points.push({ latitude, longitude: west });
      points.push({ latitude, longitude: east });
    }
  }
  return points;
}

export function projectBboxWgs84(bbox, { segments = 16 } = {}) {
  const projected = latLonToSweref99Tm(edgePoints(bbox, segments));
  return projected.reduce((extent, point) => [
    Math.min(extent[0], point.easting),
    Math.min(extent[1], point.northing),
    Math.max(extent[2], point.easting),
    Math.max(extent[3], point.northing),
  ], [Infinity, Infinity, -Infinity, -Infinity]).map(value => Math.round(value * 1000) / 1000);
}

export function pilotAoi(groundId) {
  const manifest = loadPilotManifest(groundId);
  return {
    groundId,
    groundName: manifest.groundName,
    courseSlugs: manifest.courseSlugs,
    bboxWgs84: manifest.targetBboxWgs84,
    bboxEpsg3006: projectBboxWgs84(manifest.targetBboxWgs84),
  };
}
