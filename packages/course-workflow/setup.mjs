import fs from 'node:fs';
import { workflowTemplate, reviewTemplate, ID, assertWorkflow } from './standard.mjs';
import { validateSourceManifest, CANONICAL_CRS } from '../course-geo/manifest.mjs';
import { loadGround } from './audit.mjs';
import { readJson, safePath, writeJson, digest } from './io.mjs';

export const intakePlan = (w, bbox) => ({ schemaVersion: 1, groundId: w.groundId,
  courseSlugs: w.courses.map(c => c.slug), targetBboxWgs84: bbox,
  status: 'planned', notes: 'Requested source coverage only. No acquired data or geographic accuracy is claimed.' });

export function sourceTemplate(root, w, bbox) {
  const catalog = readJson(root, 'geo_data/course-v2/source-catalog.json');
  const types = [['terrain', 'lantmateriet-markhojdmodell-1m', ['terrain']],
    ['imagery', 'lantmateriet-ortofoto', ['imagery', 'surface']],
    ['laser', 'lantmateriet-laserdata-skog', ['canopy']],
    ['controls', 'controlled-course-survey', ['control']]];
  const manifest = { $schema: '../../packages/course-geo/source-manifest.schema.json', schemaVersion: 1,
    groundId: w.groundId, groundName: w.name, courseSlugs: w.courses.map(c => c.slug), targetBboxWgs84: bbox,
    legacyFrame: null,
    canonicalFrame: { compoundCrs: CANONICAL_CRS.compound, horizontalCrs: CANONICAL_CRS.horizontal, verticalCrs: CANONICAL_CRS.vertical,
      originStatus: 'pending-control-approval', origin: { easting: null, northing: null, heightRH2000: null },
      axisMapping: { worldX: 'easting - originEasting', worldZ: 'originNorthing - northing', worldY: 'heightRH2000 - originHeightRH2000' } },
    sources: types.map(([id, productId, roles]) => ({ id, productId, roles, lifecycle: 'planned', use: 'candidate',
      sourceUri: catalog.products.find(p => p.id === productId)?.homepage,
      localPath: null, bboxWgs84: bbox, acquiredAt: null, capturedAt: null, checksum: null,
      checksumReason: 'Not acquired; select and pin source windows before authoring.', replacementSourceId: null,
      accuracyTier: 'unrated', horizontalAccuracyMetres: null, verticalAccuracyMetres: null,
      notes: 'Required source investigation. No coverage, accuracy, acquisition or approval is claimed.' })),
    artifacts: [{ id: 'source-intake-plan', kind: 'acquisition', path: `course-workflows/${w.groundId}/intake-plan.json`,
      sha256: digest(JSON.stringify(intakePlan(w, bbox), null, 2) + '\n'), derivedFrom: types.map(t => t[0]),
      use: 'discovery-evidence', notes: 'Initial acquisition scope; this plan contains no acquired source measurements.' }], blockers: [
      { id: 'source-intake', severity: 'release-blocking', description: 'Source windows have not been acquired and verified.', exitGate: 'Acquire bounded sources, record dates/checksums and review coverage.' },
      { id: 'independent-controls', severity: 'release-blocking', description: 'Independent coordinate controls are pending.', exitGate: 'Measure independent controls and approve the ground frame.' },
      { id: 'all-hole-review', severity: 'release-blocking', description: 'Routing, playing surfaces and environment have not been reviewed.', exitGate: 'Complete every routing and hole review with source-linked evidence.' },
    ] };
  const errors = validateSourceManifest(manifest, { catalog });
  if (errors.length) throw new Error(errors.join('\n'));
  return manifest;
}
export function setupWorkflow(root, { groundId, name, courses, bbox, adopt = false }) {
  if (!ID.test(groundId || '')) throw new Error('ground must be a kebab-case identity');
  const dir = `course-workflows/${groundId}`;
  if (fs.existsSync(safePath(root, dir))) throw new Error(`${dir} already exists; refusing to overwrite its configuration or reviews`);
  let w, source;
  if (adopt) {
    const graph = loadGround(root, groundId);
    const manifestPath = `geo_data/course-v2/${groundId}/source-manifest.json`;
    source = readJson(root, manifestPath);
    w = workflowTemplate({ groundId, name: source.groundName,
      courses: graph.courses.map(c => ({ slug: c.slug, holes: c.holes.length })),
      sourceManifest: manifestPath, releasePolicy: 'advisory' });
    if (source.legacyFrame?.buildDirectory) w.watch.push(source.legacyFrame.buildDirectory);
    assertWorkflow(w);
  } else {
    const live = readJson(root, 'apps/golf/public/courses/v2-index.json');
    if (live.courses.some(c => c.groundId === groundId || courses?.some(n => n.slug === c.slug))) throw new Error('ground or routing already exists; use adopt and include all shared routings');
    w = workflowTemplate({ groundId, name, courses });
    source = sourceTemplate(root, w, bbox);
  }
  // Validate every document before creating the directory; rejected input has
  // no partial scaffold and no catalogue or geometry side effects.
  fs.mkdirSync(safePath(root, dir), { recursive: true });
  writeJson(root, `${dir}/workflow.json`, w, { exclusive: true });
  writeJson(root, w.reviewFile, reviewTemplate(w), { exclusive: true });
  if (!adopt) {
    writeJson(root, `course-workflows/${groundId}/intake-plan.json`, intakePlan(w, bbox), { exclusive: true });
    writeJson(root, w.sourceManifest, source, { exclusive: true });
  }
  return w;
}
