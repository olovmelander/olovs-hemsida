import fs from 'node:fs';
import { validateRootIndex, validateCourseManifest, validateGroundManifest } from '../course-v2/schema.mjs';
import { STANDARD_RING_LEVELS, STANDARD_TILE_COUNT } from '../course-v2/standard-ground-rings.mjs';
import { validateSourceManifest } from '../course-geo/manifest.mjs';
import { digest, readJson, safePath, fileDigest, inventory, candidateInventory, hashObject } from './io.mjs';
import { STANDARD, assertWorkflow } from './standard.mjs';

export function readManifest(root, publicRoot, ref, validator) {
  const bytes = fs.readFileSync(safePath(root, `${publicRoot}/${ref.url}`));
  if (bytes.length !== ref.bytes || digest(bytes) !== ref.sha256) throw new Error(`${ref.url}: manifest size/hash mismatch`);
  const doc = JSON.parse(bytes);
  const errors = validator(doc);
  if (errors.length) throw new Error(`${ref.url}: ${errors.join('; ')}`);
  return doc;
}
export function loadGround(root, groundId, publicRoot = 'apps/golf/public') {
  const index = readJson(root, `${publicRoot}/courses/v2-index.json`);
  const errors = validateRootIndex(index);
  if (errors.length) throw new Error(errors.join('; '));
  const entries = index.courses.filter(c => c.groundId === groundId);
  if (!entries.length) throw new Error(`${groundId}: no published course entries`);
  const courses = entries.map(e => {
    const c = readManifest(root, publicRoot, e.manifest, validateCourseManifest);
    if (c.slug !== e.slug || c.groundId !== e.groundId || hashObject(c.fallbackV1) !== hashObject(e.fallbackV1)) throw new Error(`${e.slug}: root/course identity or fallback mismatch`);
    return c;
  });
  if (new Set(courses.map(c => hashObject(c.groundManifest))).size !== 1) throw new Error(`${groundId}: shared routings reference different ground generations`);
  const ground = readManifest(root, publicRoot, courses[0].groundManifest, validateGroundManifest);
  const player = readJson(root, `${publicRoot}/courses/index.json`);
  if (player.fmt !== 1 || !Array.isArray(player.courses)) throw new Error('invalid player catalogue');
  const playerEntries = courses.map(c => {
    const matches = player.courses.filter(e => e.slug === c.slug);
    const e = matches[0];
    if (matches.length !== 1 || e.holes !== c.holes.length || ['packUrl', 'bytes', 'sha256'].some(k => e[k] !== c.fallbackV1[k])) throw new Error(`${c.slug}: player catalogue is missing, duplicated or differs from the reviewed course/fallback`);
    return e;
  });
  if (ground.groundId !== groundId) throw new Error(`${groundId}: wrong ground identity`);
  const tiles = new Map(ground.tiles.map(t => [t.id, t]));
  for (const c of courses) for (const h of c.holes) for (const id of h.tileIds) {
    if (!tiles.get(id)?.courses.includes(c.slug)) throw new Error(`${c.slug}/${h.number}: missing or unowned tile ${id}`);
  }
  return { index, entries, courses, ground, playerEntries };
}
export function terrainErrors(g) {
  const e = [];
  if (g.tiles.length !== STANDARD_TILE_COUNT) e.push(`expected ${STANDARD_TILE_COUNT} terrain tiles, found ${g.tiles.length}`);
  const center = g.frame.origin;
  const expectedIds = new Set();
  const lookup = new Map(g.tiles.map(t => [t.id, t]));
  for (const level of STANDARD_RING_LEVELS) {
    const span = 256 * level.sampleSpacingMetres;
    for (let row = 0; row < level.tilesPerSide; row++) for (let col = 0; col < level.tilesPerSide; col++) {
      const id = `l${level.lod}/${col}/${row}`;
      expectedIds.add(id);
      const t = lookup.get(id);
      if (!t) { e.push(`missing ${id}`); continue; }
      const x = center.easting - level.halfSpan + col * span;
      const z = center.northing + level.halfSpan - row * span;
      if (t.lod !== level.lod || t.bounds.minEasting !== x || t.bounds.maxEasting !== x + span ||
        t.bounds.maxNorthing !== z || t.bounds.minNorthing !== z - span || !t.layers.terrain) e.push(`${id}: lattice/terrain mismatch`);
      if (level.lod < 6) {
        const p = lookup.get(t.parentId);
        if (!p || p.lod !== level.lod + 1 || p.bounds.minEasting > x || p.bounds.maxEasting < x + span ||
          p.bounds.minNorthing > z - span || p.bounds.maxNorthing < z) e.push(`${id}: missing or incorrect parent`);
      }
    }
  }
  if (g.tiles.some(t => !expectedIds.has(t.id))) e.push('unexpected terrain tile IDs');
  if (g.bounds.maxEasting - g.bounds.minEasting !== 16384 || g.bounds.maxNorthing - g.bounds.minNorthing !== 16384) e.push('ground extent does not match the standard');
  return e;
}
export function inspectGround(root, groundId, { publicRoot = 'apps/golf/public', sourceManifest = `geo_data/course-v2/${groundId}/source-manifest.json` } = {}) {
  const graph = loadGround(root, groundId, publicRoot);
  const source = readJson(root, sourceManifest);
  const catalog = readJson(root, 'geo_data/course-v2/source-catalog.json');
  const errors = validateSourceManifest(source, { catalog });
  if (source.groundId !== groundId) errors.push('source manifest ground identity mismatch');
  const slugs = graph.courses.map(c => c.slug).sort();
  if (JSON.stringify([...source.courseSlugs].sort()) !== JSON.stringify(slugs)) errors.push('source manifest and published routing inventories differ');
  const terrain = terrainErrors(graph.ground);
  errors.push(...terrain);
  return { groundId, courses: graph.courses.map(c => ({ slug: c.slug, holes: c.holes.length })),
    terrain: { status: terrain.length ? 'failed' : 'passed', tiles: graph.ground.tiles.length, finestSpacingMetres: 1, coreSpanMetres: 4096, worldSpanMetres: 16384 },
    layers: Object.fromEntries(['surface', 'objects', 'stands'].map(k => [k, graph.ground.tiles.filter(t => t.layers[k]).length])),
    frameStatus: source.canonicalFrame.originStatus,
    sourceSnapshotMatches: fileDigest(root, sourceManifest) === graph.ground.sourceManifestSha256,
    sources: source.sources.map(s => ({ id: s.id, roles: s.roles, lifecycle: s.lifecycle, use: s.use, capturedAt: s.capturedAt, acquiredAt: s.acquiredAt })),
    blockers: source.blockers,
    perHoleReview: 'unknown', releaseStatus: 'not-assessed', errors,
  };
}
export function candidate(root, w, { publicRoot = w.publicRoot } = {}) {
  assertWorkflow(w);
  const graph = loadGround(root, w.groundId, publicRoot);
  const expected = [...w.courses].sort((a, b) => a.slug.localeCompare(b.slug));
  const actual = graph.courses.map(c => ({ slug: c.slug, holes: c.holes.length })).sort((a, b) => a.slug.localeCompare(b.slug));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('workflow must include every shared routing and its exact hole count');
  // Staging and promotion paths are operational details; identical reviewed
  // bytes remain the same candidate when copied into the public catalogue.
  const { publicRoot: ignored, ...policy } = w;
  const source = readJson(root, w.sourceManifest);
  const code = { ...inventory(root, w.watch), ...candidateInventory(root,
    [...Object.values(w.stages).flatMap(s => s.inputs), ...source.artifacts.map(a => a.path)], w.publicRoot, publicRoot) };
  const candidateDigest = hashObject({ standard: STANDARD, policy, code,
    catalog: fileDigest(root, 'geo_data/course-v2/source-catalog.json'),
    source: fileDigest(root, w.sourceManifest), entries: graph.entries, playerEntries: graph.playerEntries });
  return { ...graph, candidateDigest, code };
}
export function catalogueAudit(root) {
  const index = readJson(root, 'apps/golf/public/courses/v2-index.json');
  const indexErrors = validateRootIndex(index);
  if (indexErrors.length) throw new Error(indexErrors.join('; '));
  const player = readJson(root, 'apps/golf/public/courses/index.json');
  if (player.fmt !== 1 || !Array.isArray(player.courses) ||
    JSON.stringify(player.courses.map(c => c.slug).sort()) !== JSON.stringify(index.courses.map(c => c.slug).sort())) throw new Error('player and v2 catalogue routing inventories differ');
  const grounds = [...new Set(index.courses.map(c => c.groundId))].sort().map(id => {
    try { return inspectGround(root, id); }
    catch (e) { return { groundId: id, errors: [e.message], releaseStatus: 'not-assessed' }; }
  });
  return { schemaVersion: 1, standard: STANDARD, courseCount: index.courses.length, groundCount: grounds.length,
    scope: 'Manifest structure and declared source metadata; no fresh visual review or binary verification.', grounds };
}
export function markdownAudit(report) {
  const lines = ['# Course production audit', '', report.scope, '',
    '| Ground | Layouts | Terrain | Surface tiles | Object tiles | Stand tiles | Frame approval | Hole review |',
    '|---|---:|---|---:|---:|---:|---|---|'];
  for (const g of report.grounds) lines.push(`| ${g.groundId} | ${g.courses?.length ?? '?'} | ${g.terrain?.status ?? 'unknown'} | ${g.layers?.surface ?? '?'} | ${g.layers?.objects ?? '?'} | ${g.layers?.stands ?? '?'} | ${g.frameStatus ?? 'unknown'} | ${g.perHoleReview ?? 'unknown'} |`);
  lines.push('', 'Tile counts describe representation, not mapping completeness. Zero authoritative surface tiles does not mean no rendered playing surfaces.', '');
  for (const g of report.grounds) {
    lines.push(`## ${g.groundId}`, '', ...g.errors.map(e => `- Structural error: ${e}`));
    if (g.sourceSnapshotMatches === false) lines.push('- The source ledger has changed since this ground generation; reconcile it before release.');
    for (const b of g.blockers || []) lines.push(`- ${b.id}: ${b.description}`);
    lines.push('');
  }
  return lines.join('\n');
}
