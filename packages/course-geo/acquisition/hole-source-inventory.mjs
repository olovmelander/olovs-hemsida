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
  tortuna: Object.freeze({ path: 'tortunabuild/course-model.json', sha256: 'aba02b65fc4c9e8e5b50fca73c1052a38e02b67b60fa1e8f6a730318ec0599b9',
    projectedOriginEpsg3006: Object.freeze({ easting: 597400.5, northing: 6614899.5 }) }),
  visby: Object.freeze({ path: 'visbybuild/course-model.json', sha256: 'c9d7e2e3cd13b2a8d040681d315eec3e99083437fa6f82bbda423402eb64eb71',
    projectedOriginEpsg3006: Object.freeze({ easting: 687748.5, northing: 6370951.5 }) }),
  lidingo: Object.freeze({ path: 'lidingobuild/course-model.json', sha256: '5bfe6e8451b5d3ae606ad3a831c50630ee50ec02c64e136f3e88964a287c7fe8',
    projectedOriginEpsg3006: Object.freeze({ easting: 677700.5, northing: 6586399.5 }) }),
  angso: Object.freeze({
    path: 'angsobuild/course-model.json',
    sha256: '43bd0a4441d8a9b128b49a9163195dd845807ba555706d0738c719fb4644cf9b',
  }),
  norrfallsviken: Object.freeze({
    path: 'nvgkbuild/course-model.json',
    sha256: '9868d54c21abf6533368ac7de0790347a439383b42462d98189cf6aea0c423fd',
  }),
  puttom: Object.freeze({
    path: 'puttombuild/course-model.json',
    sha256: '8f0dad509aba561875dc80da16aa26a768b95b2b008bf198a961e82ceaf7c496',
  }),
  ribbingsfors: Object.freeze({
    path: 'ribbingsforsbuild/course-model.json',
    sha256: 'ad136229a3bc962e30522c01eb1800e5ccfe65fbdecd764a672a5ed3f53376ab',
    projectedOriginEpsg3006: Object.freeze({
      easting: 448975.5,
      northing: 6536024.5,
    }),
  }),
  upsala: Object.freeze({
    path: 'upsalabuild/course-model.json',
    sha256: '3ec429382ac69f986be297c4a1b4c3e7467d558e0e0a8d8f11956818d1c41c2c',
  }),
  'upsala-mellanbanan': Object.freeze({
    path: 'upsalamellanbuild/course-model.json',
    sha256: '61b2e883cefff22ccc8b5f5a6efa7faa2db989f404ab833dda2fd2a59c20ccff',
  }),
  johannesberg: Object.freeze({
    path: 'johannesbergbuild/course-model.json',
    sha256: 'd8b2b931791709105a6863b4b03b29acb182d5feced01b4cdc2fd984eaa35eed',
  }),
  'johannesberg-9': Object.freeze({
    path: 'johannesberg9build/course-model.json',
    sha256: '6d8af299e4a3a2f69b8304dcc0c123d2b26f3f77bd1ea44c29603a784d6b0cc3',
  }),
  veckefjarden: Object.freeze({
    path: 'geobuild/course-model.json',
    sha256: '66885fa4e54d3c240f717800e27035262c82c48e0eea3002b7afbbf0da0997fd',
  }),
  'veckefjarden-korthalsbanan': Object.freeze({
    path: 'veckefjardenkortbuild/course-model.json',
    sha256: '0e3bd2f09a89062bdd4b5f715ccb0195c42ab2687ad10086202cf8c0be3ef911',
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
