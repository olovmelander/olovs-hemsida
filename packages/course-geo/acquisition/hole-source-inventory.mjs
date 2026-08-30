import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_GROUNDS, readJson, sha256File } from '../manifest.mjs';
import {
  COURSE_MODEL_PATHS,
  SUPPLEMENTAL_COURSE_MODEL_SHA256,
  allCourseHoleSourceControlPlan,
  groundHoleSourceControlPlan,
} from './hole-source-controls.mjs';
import { COURSE_DATA_DIR, REPO_ROOT } from './pilots.mjs';

export function loadGroundHoleSourceControlPlan(groundId, {
  discovery = undefined,
} = {}) {
  if (!EXPECTED_GROUNDS[groundId]) throw new Error(`unknown physical ground ${groundId}`);
  const manifest = readJson(path.join(COURSE_DATA_DIR, groundId, 'source-manifest.json'));
  const courseModels = {};
  for (const courseSlug of EXPECTED_GROUNDS[groundId]) {
    const relativePath = COURSE_MODEL_PATHS[courseSlug];
    if (!relativePath) throw new Error(`no EPSG:3006 model path is registered for ${courseSlug}`);
    const file = path.join(REPO_ROOT, relativePath);
    const actualSha256 = sha256File(file);
    const supplementalSha256 = SUPPLEMENTAL_COURSE_MODEL_SHA256[courseSlug];
    if (supplementalSha256 && actualSha256 !== supplementalSha256) {
      throw new Error(`${courseSlug} supplemental EPSG:3006 model checksum drifted`);
    }
    courseModels[courseSlug] = {
      path: relativePath,
      sha256: actualSha256,
      model: readJson(file),
    };
  }
  let resolvedDiscovery = discovery;
  if (resolvedDiscovery === undefined) {
    const discoveryFile = path.join(COURSE_DATA_DIR, groundId, 'acquisition', 'd2-discovery.json');
    resolvedDiscovery = fs.existsSync(discoveryFile) ? readJson(discoveryFile) : null;
  }
  return groundHoleSourceControlPlan({ manifest, courseModels, discovery: resolvedDiscovery });
}

export function loadRepositoryHoleSourceControlPlan({
  discoveryByGround = {},
} = {}) {
  const grounds = Object.keys(EXPECTED_GROUNDS).map(groundId =>
    loadGroundHoleSourceControlPlan(groundId, {
      discovery: Object.hasOwn(discoveryByGround, groundId)
        ? discoveryByGround[groundId]
        : undefined,
    }));
  return allCourseHoleSourceControlPlan(grounds);
}
