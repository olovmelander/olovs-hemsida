#!/usr/bin/env node
/* Synchronizes and --check-gates Banvy's duplicated course registration tables
 * from the authoritative v2 frontier registry while preserving
 * check-app-build.mjs bundle isolation (zero new static cross-imports in app).
 *
 * Registries verified/synchronized:
 *  1. packages/course-geo/manifest.mjs           (EXPECTED_GROUNDS)
 *  2. apps/golf/src/engine/gps-projected-frames.mjs (PROJECTED_GPS_FRAMES)
 *  3. apps/golf/src/map/map-frames.mjs           (MAP_GROUND_FRAMES)
 *  4. apps/golf/src/engine/v2-grid-origin.test.mjs (grid-authored slug list)
 *  5. apps/golf/src/engine/house-kit.test.mjs    (measured-roof GROUNDS map)
 *
 * Usage:
 *   node tools/sync-course-registries.mjs --check
 *   node tools/sync-course-registries.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRID_BRIDGE = 'epsg3006-local-rh2000';

export async function loadRegistryState(root = ROOT) {
  const imp = rel => import(pathToFileURL(path.join(root, rel)).href);
  const { V2_GRAPH_FRONTIER_CONFIGS } = await imp('apps/golf/src/engine/v2-frontier-configs.mjs');
  const { PUTTOM_PREVIEW_CONFIG } = await imp('apps/golf/src/engine/v2-puttom-preview.mjs');
  const { EXPECTED_GROUNDS } = await imp('packages/course-geo/manifest.mjs');
  const { PROJECTED_GPS_FRAMES } = await imp('apps/golf/src/engine/gps-projected-frames.mjs');
  const { MAP_GROUND_FRAMES } = await imp('apps/golf/src/map/map-frames.mjs');
  const courseIndex = JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public/courses/index.json'), 'utf8'));

  const allConfigs = [
    ...Object.values(V2_GRAPH_FRONTIER_CONFIGS),
    { ...PUTTOM_PREVIEW_CONFIG, groundId: 'puttom', bridgeMode: 'wgs84-legacy-frame' },
  ];

  // Expected groundId -> slugs map derived from frontier configs + puttom pilot
  const derivedGrounds = new Map();
  for (const cfg of allConfigs) {
    const list = derivedGrounds.get(cfg.groundId) || [];
    if (!list.includes(cfg.slug)) list.push(cfg.slug);
    derivedGrounds.set(cfg.groundId, list);
  }

  const gridConfigs = Object.entries(V2_GRAPH_FRONTIER_CONFIGS)
    .filter(([, c]) => c.bridgeMode === GRID_BRIDGE)
    .map(([slug, c]) => ({ slug, ...c }));

  return {
    V2_GRAPH_FRONTIER_CONFIGS,
    PUTTOM_PREVIEW_CONFIG,
    EXPECTED_GROUNDS,
    PROJECTED_GPS_FRAMES,
    MAP_GROUND_FRAMES,
    courseIndex,
    allConfigs,
    derivedGrounds,
    gridConfigs,
  };
}

export function checkRegistries(state, root = ROOT) {
  const drift = [];
  const { EXPECTED_GROUNDS, PROJECTED_GPS_FRAMES, MAP_GROUND_FRAMES, courseIndex, allConfigs, derivedGrounds, gridConfigs } = state;

  // 1. EXPECTED_GROUNDS in packages/course-geo/manifest.mjs
  for (const [groundId, slugs] of derivedGrounds.entries()) {
    const actual = EXPECTED_GROUNDS[groundId];
    if (!actual) {
      drift.push({ file: 'packages/course-geo/manifest.mjs', kind: 'missing-ground', groundId, expected: slugs });
    } else {
      for (const s of slugs) {
        if (!actual.includes(s)) {
          drift.push({ file: 'packages/course-geo/manifest.mjs', kind: 'missing-slug', groundId, slug: s });
        }
      }
    }
  }

  // 2. PROJECTED_GPS_FRAMES in apps/golf/src/engine/gps-projected-frames.mjs
  const gpsBySlug = new Map(PROJECTED_GPS_FRAMES.map(f => [f.slug, f]));
  const gridSlugs = gridConfigs.map(c => c.slug);
  for (const cfg of gridConfigs) {
    const actual = gpsBySlug.get(cfg.slug);
    if (!actual) {
      drift.push({ file: 'apps/golf/src/engine/gps-projected-frames.mjs', kind: 'missing-gps-frame', slug: cfg.slug });
      continue;
    }
    for (const field of ['packFrame', 'packMetresPerLongitude', 'bridgeMode']) {
      if (actual[field] !== cfg[field]) {
        drift.push({ file: 'apps/golf/src/engine/gps-projected-frames.mjs', kind: 'field-mismatch', slug: cfg.slug, field });
      }
    }
    if (actual.packOriginWgs84?.latitude !== cfg.packOriginWgs84?.latitude ||
        actual.packOriginWgs84?.longitude !== cfg.packOriginWgs84?.longitude ||
        actual.legacyOriginEpsg3006?.easting !== cfg.legacyOriginEpsg3006?.easting ||
        actual.legacyOriginEpsg3006?.northing !== cfg.legacyOriginEpsg3006?.northing) {
      drift.push({ file: 'apps/golf/src/engine/gps-projected-frames.mjs', kind: 'origin-mismatch', slug: cfg.slug });
    }
  }
  for (const f of PROJECTED_GPS_FRAMES) {
    if (!gridSlugs.includes(f.slug)) {
      drift.push({ file: 'apps/golf/src/engine/gps-projected-frames.mjs', kind: 'extra-gps-frame', slug: f.slug });
    }
  }

  // 3. MAP_GROUND_FRAMES in apps/golf/src/map/map-frames.mjs
  const seenGrounds = new Set();
  for (const cfg of allConfigs) {
    if (seenGrounds.has(cfg.groundId)) continue;
    seenGrounds.add(cfg.groundId);
    const frame = MAP_GROUND_FRAMES[cfg.groundId];
    if (!frame) {
      drift.push({ file: 'apps/golf/src/map/map-frames.mjs', kind: 'missing-map-frame', groundId: cfg.groundId });
      continue;
    }
    if (frame.bridgeMode !== cfg.bridgeMode ||
        frame.frameFingerprint !== cfg.frameFingerprint ||
        frame.verticalDatumOffsetMetres !== (cfg.legacyFrame?.verticalDatumOffsetMetres ?? 0) ||
        frame.legacyOriginEpsg3006?.easting !== cfg.legacyOriginEpsg3006?.easting ||
        frame.legacyOriginEpsg3006?.northing !== cfg.legacyOriginEpsg3006?.northing) {
      drift.push({ file: 'apps/golf/src/map/map-frames.mjs', kind: 'map-frame-mismatch', groundId: cfg.groundId });
    }
  }
  for (const gId of Object.keys(MAP_GROUND_FRAMES)) {
    if (!seenGrounds.has(gId)) {
      drift.push({ file: 'apps/golf/src/map/map-frames.mjs', kind: 'extra-map-frame', groundId: gId });
    }
  }

  // 4. apps/golf/src/engine/v2-grid-origin.test.mjs grid-authored assertion list
  const gridTestPath = path.join(root, 'apps/golf/src/engine/v2-grid-origin.test.mjs');
  const gridTestSrc = fs.readFileSync(gridTestPath, 'utf8');
  const mGrid = gridTestSrc.match(/expect\(gridAuthored\.map\(\(\[slug\]\)\s*=>\s*slug\)\)\.toEqual\(\[([^\]]*)\]\)/);
  if (!mGrid) {
    drift.push({ file: 'apps/golf/src/engine/v2-grid-origin.test.mjs', kind: 'pattern-not-found' });
  } else {
    const listed = [...mGrid[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    if (JSON.stringify(listed) !== JSON.stringify(gridSlugs)) {
      drift.push({
        file: 'apps/golf/src/engine/v2-grid-origin.test.mjs',
        kind: 'grid-slug-list-mismatch',
        actual: listed,
        expected: gridSlugs,
      });
    }
  }

  // 5. apps/golf/src/engine/house-kit.test.mjs GROUNDS list vs published courses/index.json & roof-colours files
  const houseTestPath = path.join(root, 'apps/golf/src/engine/house-kit.test.mjs');
  const houseTestSrc = fs.readFileSync(houseTestPath, 'utf8');
  const mHouse = houseTestSrc.match(/const GROUNDS = \{([\s\S]*?)\};/);
  if (!mHouse) {
    drift.push({ file: 'apps/golf/src/engine/house-kit.test.mjs', kind: 'pattern-not-found' });
  } else {
    const listedSlugs = [...mHouse[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map(m => m[1]);
    for (const entry of courseIndex.courses || []) {
      if (!listedSlugs.includes(entry.slug)) {
        drift.push({ file: 'apps/golf/src/engine/house-kit.test.mjs', kind: 'missing-published-slug', slug: entry.slug });
      }
    }
  }

  return {
    ok: drift.length === 0,
    groundsChecked: derivedGrounds.size,
    gridAuthoredSlugs: gridSlugs,
    driftCount: drift.length,
    drift,
  };
}

export function renderGpsFrameEntry(cfg) {
  return [
    '  {',
    `    slug: ${JSON.stringify(cfg.slug)},`,
    `    packFrame: ${JSON.stringify(cfg.packFrame)},`,
    `    packOriginWgs84: { latitude: ${cfg.packOriginWgs84.latitude}, longitude: ${cfg.packOriginWgs84.longitude} },`,
    `    packMetresPerLongitude: ${cfg.packMetresPerLongitude},`,
    `    legacyOriginEpsg3006: { easting: ${cfg.legacyOriginEpsg3006.easting}, northing: ${cfg.legacyOriginEpsg3006.northing} },`,
    `    bridgeMode: ${JSON.stringify(cfg.bridgeMode)},`,
    '  },',
  ].join('\n');
}

export function renderMapFrameEntry(cfg) {
  const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(cfg.groundId) ? cfg.groundId : JSON.stringify(cfg.groundId);
  if (cfg.bridgeMode === GRID_BRIDGE) {
    return `  ${key}: grid('${cfg.frameFingerprint}', ${cfg.legacyOriginEpsg3006.easting}, ${cfg.legacyOriginEpsg3006.northing}),`;
  }
  const lf = cfg.legacyFrame;
  return `  ${key}: legacy('${cfg.frameFingerprint}', ${cfg.legacyOriginEpsg3006.easting}, ${cfg.legacyOriginEpsg3006.northing}, ${lf.latitude}, ${lf.longitude}, ${lf.metresPerLongitude}, ${lf.verticalDatumOffsetMetres ?? 0}),`;
}

export function syncRegistries(state, root = ROOT) {
  const modified = [];
  const { allConfigs, derivedGrounds, gridConfigs } = state;

  // 1. Update EXPECTED_GROUNDS in packages/course-geo/manifest.mjs
  const manifestPath = path.join(root, 'packages/course-geo/manifest.mjs');
  const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  const mergedGrounds = { ...state.EXPECTED_GROUNDS };
  for (const [gId, slugs] of derivedGrounds.entries()) {
    const existing = mergedGrounds[gId] || [];
    mergedGrounds[gId] = [...new Set([...existing, ...slugs])];
  }
  const expectedBlock = 'export const EXPECTED_GROUNDS = Object.freeze({\n' +
    Object.entries(mergedGrounds).map(([gId, slugs]) => {
      const k = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(gId) ? gId : JSON.stringify(gId);
      return `  ${k}: [${slugs.map(s => `'${s}'`).join(', ')}],`;
    }).join('\n') +
    '\n});';
  const nextManifest = manifestSrc.replace(/export const EXPECTED_GROUNDS = Object\.freeze\(\{[\s\S]*?\}\);/, expectedBlock);
  if (nextManifest !== manifestSrc) {
    fs.writeFileSync(manifestPath, nextManifest, 'utf8');
    modified.push('packages/course-geo/manifest.mjs');
  }

  // 2. Update PROJECTED_GPS_FRAMES
  const gpsPath = path.join(root, 'apps/golf/src/engine/gps-projected-frames.mjs');
  const gpsSrc = fs.readFileSync(gpsPath, 'utf8');
  const gpsBlock = 'export const PROJECTED_GPS_FRAMES = Object.freeze([\n' +
    gridConfigs.map(renderGpsFrameEntry).join('\n') +
    '\n].map(Object.freeze));';
  const nextGps = gpsSrc.replace(/export const PROJECTED_GPS_FRAMES = Object\.freeze\(\[[\s\S]*?\]\.map\(Object\.freeze\)\);/, gpsBlock);
  if (nextGps !== gpsSrc) {
    fs.writeFileSync(gpsPath, nextGps, 'utf8');
    modified.push('apps/golf/src/engine/gps-projected-frames.mjs');
  }

  // 3. Update MAP_GROUND_FRAMES (sorted alphabetically by groundId)
  const mapPath = path.join(root, 'apps/golf/src/map/map-frames.mjs');
  const mapSrc = fs.readFileSync(mapPath, 'utf8');
  const byGround = new Map();
  for (const cfg of allConfigs) if (!byGround.has(cfg.groundId)) byGround.set(cfg.groundId, cfg);
  const sortedGrounds = [...byGround.keys()].sort();
  const mapBlock = 'export const MAP_GROUND_FRAMES = Object.freeze({\n' +
    sortedGrounds.map(gId => renderMapFrameEntry(byGround.get(gId))).join('\n') +
    '\n});';
  const nextMap = mapSrc.replace(/export const MAP_GROUND_FRAMES = Object\.freeze\(\{[\s\S]*?\}\);/, mapBlock);
  if (nextMap !== mapSrc) {
    fs.writeFileSync(mapPath, nextMap, 'utf8');
    modified.push('apps/golf/src/map/map-frames.mjs');
  }

  // 4. Update apps/golf/src/engine/v2-grid-origin.test.mjs
  const gridTestPath = path.join(root, 'apps/golf/src/engine/v2-grid-origin.test.mjs');
  const gridTestSrc = fs.readFileSync(gridTestPath, 'utf8');
  const gridList = gridConfigs.map(c => `'${c.slug}'`).join(', ');
  const nextGridTest = gridTestSrc.replace(
    /expect\(gridAuthored\.map\(\(\[slug\]\)\s*=>\s*slug\)\)\.toEqual\(\[[^\]]*\]\)/,
    `expect(gridAuthored.map(([slug]) => slug)).toEqual([${gridList}])`,
  );
  if (nextGridTest !== gridTestSrc) {
    fs.writeFileSync(gridTestPath, nextGridTest, 'utf8');
    modified.push('apps/golf/src/engine/v2-grid-origin.test.mjs');
  }

  // 5. Update GROUNDS in apps/golf/src/engine/house-kit.test.mjs for grounds with roof-colours JSON
  const houseTestPath = path.join(root, 'apps/golf/src/engine/house-kit.test.mjs');
  const houseTestSrc = fs.readFileSync(houseTestPath, 'utf8');
  const roofEntries = [];
  for (const [gId, slugs] of Object.entries(mergedGrounds)) {
    const roofFile = path.join(root, `apps/golf/src/engine/scenery/${gId}-roof-colours.json`);
    if (fs.existsSync(roofFile)) {
      const k = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(gId) ? gId : `'${gId}'`;
      roofEntries.push(`${k}: [${slugs.map(s => `'${s}'`).join(', ')}]`);
    }
  }
  const houseBlock = `const GROUNDS = {\n    ${roofEntries.join(',\n    ')},\n  };`;
  const nextHouseTest = houseTestSrc.replace(/const GROUNDS = \{[\s\S]*?\};/, houseBlock);
  if (nextHouseTest !== houseTestSrc && checkRegistries(state, root).drift.some(d => d.file.includes('house-kit.test.mjs'))) {
    fs.writeFileSync(houseTestPath, nextHouseTest, 'utf8');
    modified.push('apps/golf/src/engine/house-kit.test.mjs');
  }

  return { modified };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--write') ? 'write' : 'check';
  const state = await loadRegistryState(ROOT);
  if (mode === 'write') {
    const { modified } = syncRegistries(state, ROOT);
    const recheck = checkRegistries(await loadRegistryState(ROOT), ROOT);
    console.log(JSON.stringify({ mode, modified, ...recheck }, null, 2));
    if (!recheck.ok) process.exitCode = 1;
    return;
  }
  const report = checkRegistries(state, ROOT);
  console.log(JSON.stringify({ mode, ...report }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
