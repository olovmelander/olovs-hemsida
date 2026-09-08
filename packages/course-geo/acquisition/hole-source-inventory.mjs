import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_GROUNDS, readJson, sha256File } from '../manifest.mjs';
import {
  collectCoordinatePairs,
  localToLatLon,
  localToProjected,
  roundedCoordinate,
} from '../migration.mjs';
import { latLonToSweref99Tm } from '../proj.mjs';
import {
  COURSE_MODEL_SHA256,
  COURSE_MODEL_PATHS,
  allCourseHoleSourceControlPlan,
  groundHoleSourceControlPlan,
} from './hole-source-controls.mjs';
import { COURSE_DATA_DIR, REPO_ROOT } from './pilots.mjs';

export const LEGACY_COURSE_MODEL_SOURCES = Object.freeze({
  visby: Object.freeze({ path: 'visbybuild/course-model.json', sha256: '9e7f580c7bc6fc9d9fb50db14c9fb15000fc3bd9dfd466569e53470e4c73caa7',
    projectedOriginEpsg3006: Object.freeze({ easting: 687748.5, northing: 6370951.5 }) }),
  lidingo: Object.freeze({ path: 'lidingobuild/course-model.json', sha256: 'f6ff8a5f5bad203b9ab2940bf5fb25d4b9938f7b152475b3d8d679f0f0ce51cd',
    projectedOriginEpsg3006: Object.freeze({ easting: 677700.5, northing: 6586399.5 }) }),
  angso: Object.freeze({
    path: 'angsobuild/course-model.json',
    sha256: 'f163f2b3fcd5f032149129a0b03c5411cb3485a3454018a5976a1c0306b0059e',
  }),
  norrfallsviken: Object.freeze({
    path: 'nvgkbuild/course-model.json',
    sha256: '1adf3129f434d6f573d7662cc190ec5be7938303382876cbb6f4460aa13b9239',
  }),
  puttom: Object.freeze({
    path: 'puttombuild/course-model.json',
    sha256: 'ce192fe669ba2a5256451287554f5c80d1de95416b84b176cd6c9598b1751176',
  }),
  ribbingsfors: Object.freeze({
    path: 'ribbingsforsbuild/course-model.json',
    sha256: 'f99ca922f7a810fa40db9ac71e0f8e5dcf101395213a45cf56deaa6af4ee9e17',
    projectedOriginEpsg3006: Object.freeze({
      easting: 448975.5,
      northing: 6536024.5,
    }),
  }),
  upsala: Object.freeze({
    path: 'upsalabuild/course-model.json',
    sha256: 'becbfca4ab43408ffc7003eb31051e5ad7700701b80add47f9a55a36225abb5d',
  }),
  'upsala-mellanbanan': Object.freeze({
    path: 'upsalamellanbuild/course-model.json',
    sha256: '23cf42493f6d7dc7be60569e06967f2c94605c2ae6a3e9d6bd670c7e85bee39b',
  }),
  johannesberg: Object.freeze({
    path: 'johannesbergbuild/course-model.json',
    sha256: '066f0cc3e7a2bddd99d3c34f18002ec9d2f9aa3e754592924f8beff939916839',
  }),
  'johannesberg-9': Object.freeze({
    path: 'johannesberg9build/course-model.json',
    sha256: '5ce19f44e8b1328e44f96a6438439d4e5f9a0f1c6faedbad5f5a04f7076fed1d',
  }),
  veckefjarden: Object.freeze({
    path: 'geobuild/course-model.json',
    sha256: '938823c626068d8f464c7318dc84e95fa6c11711f215354b229c441b31fc1093',
  }),
  'veckefjarden-korthalsbanan': Object.freeze({
    path: 'veckefjardenkortbuild/course-model.json',
    sha256: '4cdc23854e79f96b65ee34a430cbfbbcd5d884b795d5c7afb68f0e638457647d',
  }),
});

function transientEpsg3006Model(groundId, courseSlug, legacyModel, source) {
  const frame = {
    originWgs84: {
      latitude: legacyModel.origin?.lat,
      longitude: legacyModel.origin?.lon,
    },
    metresPerLatitude: legacyModel.mPerLat,
    metresPerLongitude: legacyModel.mPerLon,
  };
  if (!Array.isArray(legacyModel.holes) || !legacyModel.holes.length ||
      !Object.values(frame.originWgs84).every(Number.isFinite) ||
      ![frame.metresPerLatitude, frame.metresPerLongitude].every(Number.isFinite)) {
    throw new Error(`${source.path} lacks a finite legacy frame or playable holes`);
  }
  const geometry = { holes: structuredClone(legacyModel.holes) };
  const collected = collectCoordinatePairs(geometry);
  const projected = source.projectedOriginEpsg3006
    ? collected.coordinates.map(({ pair }) => localToProjected(pair, {
      projectedOriginEpsg3006: source.projectedOriginEpsg3006,
    }))
    : latLonToSweref99Tm(
      collected.coordinates.map(({ pair }) => localToLatLon(pair, frame)),
      { decimals: 6 },
    );
  collected.coordinates.forEach(({ pair }, index) => {
    pair[0] = roundedCoordinate(projected[index].easting);
    pair[1] = roundedCoordinate(projected[index].northing);
  });
  return {
    schemaVersion: 1,
    generator: 'course-geo/transient-hole-vector-migrator@1',
    groundId,
    source: { path: source.path, sha256: source.sha256 },
    target: {
      horizontalCrs: 'EPSG:3006',
      coordinateOrder: ['easting', 'northing'],
      verticalStatus: 'legacy-height-datum-unknown-not-converted',
      approvalStatus: 'migration-only-pending-independent-control',
    },
    geometry,
  };
}

function loadCourseModel(groundId, courseSlug) {
  const relativePath = COURSE_MODEL_PATHS[courseSlug];
  const expectedSha256 = COURSE_MODEL_SHA256[courseSlug];
  if (!relativePath || !expectedSha256) {
    throw new Error(`no immutable EPSG:3006 model is registered for ${courseSlug}`);
  }
  const file = path.join(REPO_ROOT, relativePath);
  if (fs.existsSync(file)) {
    const actualSha256 = sha256File(file);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`${courseSlug} EPSG:3006 model checksum drifted`);
    }
    return { path: relativePath, sha256: actualSha256, model: readJson(file) };
  }

  const source = LEGACY_COURSE_MODEL_SOURCES[courseSlug];
  if (!source) throw new Error(`no reviewed legacy fallback is registered for ${courseSlug}`);
  const sourceFile = path.join(REPO_ROOT, source.path);
  const actualSourceSha256 = sha256File(sourceFile);
  if (actualSourceSha256 !== source.sha256) {
    throw new Error(`${courseSlug} legacy course model checksum drifted`);
  }
  return {
    path: `${source.path}#transient-epsg3006`,
    sha256: actualSourceSha256,
    model: transientEpsg3006Model(groundId, courseSlug, readJson(sourceFile), source),
  };
}

export function loadGroundHoleSourceControlPlan(groundId, {
  discovery = undefined,
} = {}) {
  if (!EXPECTED_GROUNDS[groundId]) throw new Error(`unknown physical ground ${groundId}`);
  const manifest = readJson(path.join(COURSE_DATA_DIR, groundId, 'source-manifest.json'));
  if (manifest.groundId !== groundId || JSON.stringify(manifest.courseSlugs) !== JSON.stringify(EXPECTED_GROUNDS[groundId])) {
    throw new Error(`${groundId} source manifest does not match the registered course inventory`);
  }
  let resolvedDiscovery = discovery;
  if (resolvedDiscovery === undefined) {
    const discoveryFile = path.join(COURSE_DATA_DIR, groundId, 'acquisition', 'd2-discovery.json');
    resolvedDiscovery = fs.existsSync(discoveryFile) ? readJson(discoveryFile) : null;
  }
  if (resolvedDiscovery && resolvedDiscovery.groundId !== groundId) {
    throw new Error(`discovery ground ${resolvedDiscovery.groundId} does not match ${groundId}`);
  }
  if (manifest.legacyFrame === null) {
    // Source acquisition can precede a playable model. Keep that ground visible
    // in the inventory without inventing holes or successful control windows.
    if (manifest.courseSlugs.some(slug => COURSE_MODEL_PATHS[slug])) {
      throw new Error(`${groundId} has registered migration models but no compatibility frame`);
    }
    return Object.freeze({
      schemaVersion: 1,
      phase: 'D2-per-hole-source-control-plan',
      groundId,
      courseSlugs: Object.freeze([...manifest.courseSlugs]),
      planningState: 'source-intake-pending-playable-model',
      pendingCourseSlugs: Object.freeze([...manifest.courseSlugs]),
      discoveryState: resolvedDiscovery ? 'checksummed-snapshot-available' : 'discovery-pending',
      courses: Object.freeze([]),
      windows: Object.freeze([]),
      summary: Object.freeze({
        courseCount: manifest.courseSlugs.length,
        holeCount: 0,
        uniqueWindowCount: 0,
        requestedWindowReferences: 0,
        laserStates: Object.freeze({}),
        treeHeightStates: Object.freeze({}),
      }),
    });
  }
  const courseModels = {};
  for (const courseSlug of EXPECTED_GROUNDS[groundId]) {
    courseModels[courseSlug] = loadCourseModel(groundId, courseSlug);
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
