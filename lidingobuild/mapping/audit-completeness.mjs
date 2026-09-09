/* Inventory the adopted evidence and check that its geometry survives into the
 * actual served pack. Passing this audit is not a current-course census or a
 * positional-accuracy claim. No downloads, credentials or source-cache needed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readPack, inflateStream, sha256 } from '../../packages/course-pack/lib.mjs';
import { FRAME, local } from '../build-course.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inputs = [];
function bytes(relative) {
  const value = fs.readFileSync(path.join(root, relative));
  inputs.push({ path: relative, sha256: sha256(value) });
  return value;
}
const json = relative => JSON.parse(bytes(relative));
const model = json('lidingobuild/course-model.json');
const surfaces = json('lidingobuild/mapping/playing-surfaces.geojson');
const facilities = json('lidingobuild/mapping/facilities.geojson');
const context = json('geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson');
const refinements = json('lidingobuild/mapping/surface-refinements-2019.json');
const roofs = json('lidingobuild/mapping/building-roof-meshes.json');
const stands = json('geo_data/course-v2/lidingo/vegetation/stand-evidence.json');
const orthophotoAudit = json('geo_data/course-v2/lidingo/acquisition/ortho-2025-surface-audit.json');
const environmentWater = json('geo_data/course-v2/lidingo/acquisition/environment-water.json');
const pack = readPack(bytes('apps/golf/public/courses/lidingo/pack.bin'));
const runtime = JSON.parse(inflateStream(pack.sv));
// Unrelated courses changing their index must not invalidate this report.
const readPublic = relative => JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public', relative)));
const route = readPublic('courses/v2-index.json').courses.find(c => c.slug === 'lidingo');
const course = readPublic(route.manifest.url);
const ground = json(`apps/golf/public/${course.groundManifest.url.replace(/^\//, '')}`);
for (const [label, collection] of Object.entries({ surfaces, facilities, context })) {
  if (collection.crs?.properties?.name !== 'EPSG:3006') throw new Error(`${label}: unknown source frame`);
}

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const countBy = (rows, field) => rows.reduce((out, row) => {
  const key = field(row) ?? 'unknown'; out[key] = (out[key] || 0) + 1; return out;
}, {});
const polygonParts = f => f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
const localParts = f => polygonParts(f).map(p => p.map(r => r.map(local)));
// Compare all vertices, ring order and holes; never round coordinates to hide
// a shift. Separate marker references from physical ground-surface ownership.
function physicalSurfaces(data) {
  const out = [];
  const add = (kind, id, rings) => out.push({ kind, id, rings });
  for (const h of data.holes) {
    add('green', `hole-${h.n}-green`, [h.green.ring]);
    h.tees.pads.forEach((p, i) => add('tee', `hole-${h.n}-tee-${i}`, [p.ring]));
    h.fairway.rings.forEach((r, i) => add('fairway', `hole-${h.n}-fairway-${i}`, [r]));
    h.bunkers.forEach((b, i) => add('bunker', `hole-${h.n}-bunker-${i}`, [b.ring]));
  }
  for (const [key, kind] of Object.entries({ greens: 'green', tees: 'tee', fairways: 'fairway', bunkers: 'bunker', range: 'range_field' })) {
    (data.scenery[key] || []).forEach((r, i) => add(kind, `scenery-${key}-${i}`, [r]));
  }
  for (const f of data.scenery.mappedFeatures || []) add(f.kind, f.id, f.rings);
  for (const p of data.infra.parking || []) add('parking', p.id, [p.ring]);
  return out;
}
const physical = physicalSurfaces(runtime);
assert(isDeepStrictEqual(physicalSurfaces(model), physical), 'Served pack changed or dropped physical surface geometry');
const adopted = new Map(facilities.features.filter(f => f.properties.sourceFeatureId).map(f => [f.properties.sourceFeatureId, f]));
const surfaceRecords = surfaces.features.map(f => {
  const ownerSource = adopted.get(f.id) || f;
  const parts = localParts(ownerSource);
  const owners = parts.flatMap(rings => physical.filter(p => p.kind === ownerSource.properties.kind && isDeepStrictEqual(p.rings, rings)).map(p => p.id));
  assert(owners.length === parts.length, `${f.id}: expected exactly one physical owner per polygon, got ${owners.length}`);
  return { id: f.id, hole: f.properties.hole ?? null, kind: f.properties.kind,
    sourceId: f.properties.sourceId, observedYear: f.properties.observedYear ?? null,
    sourceTimestamp: f.properties.sourceTimestamp ?? null, runtimeOwners: owners,
    currentBoundaryVerified: false };
});
for (const f of facilities.features) {
  for (const rings of localParts(f)) {
    const owners = physical.filter(p => p.kind === f.properties.kind && isDeepStrictEqual(p.rings, rings));
    assert(owners.length === 1, `${f.id}: facility has ${owners.length} physical owners`);
  }
}

const buildings = context.features.filter(f => f.properties.tags.building && f.geometry.type === 'Polygon');
for (const f of buildings) {
  const matches = runtime.infra.buildings.filter(b => b.id === f.id);
  assert(matches.length === 1 && isDeepStrictEqual([matches[0].ring], localParts(f)[0]), `${f.id}: building footprint changed or dropped`);
}
assert(isDeepStrictEqual(model.infra.buildings, runtime.infra.buildings), 'Pack changed building evidence/roof geometry');
assert(isDeepStrictEqual(model.vegetation, runtime.veg), 'Pack changed vegetation context');
const vegetationFeatures = context.features.filter(f => f.geometry.type === 'Polygon' && ['forest', 'wood', 'scrub', 'wetland', 'sand', 'rock'].includes(f.properties.tags.landuse === 'forest' ? 'forest' : f.properties.tags.natural));
for (const f of vegetationFeatures) {
  const kind = f.properties.tags.landuse === 'forest' ? 'forest' : f.properties.tags.natural;
  assert(runtime.veg[kind].some(r => isDeepStrictEqual([r], localParts(f)[0])), `${f.id}: vegetation boundary dropped`);
}
assert(runtime.holes.length === 18, 'Served pack lacks the 18 holes');
assert(runtime.infra.terrainPlacement === 'measured-only' && runtime.infra.preserveMappedBoundaries === true, 'Measured terrain/source-boundary policy lost');
assert(runtime.infra.vegetationPlacement === 'measured-only', 'Unmeasured vegetation fallback enabled');

const holeRows = model.holes.map(h => {
  const features = surfaceRecords.filter(f => f.hole === h.n);
  const byKind = countBy(features, f => f.kind);
  const issues = refinements.unadoptedInspections.filter(i => i.hole === h.n).map(i => ({ kind: i.kind, status: i.status, reason: i.reason }));
  return { hole: h.n, par: h.par,
    green: byKind.green || 0, tee: byKind.tee || 0, fairway: byKind.fairway || 0, bunker: byKind.bunker || 0,
    sourceEvidence: countBy(features, f => f.observedYear ? `orthophoto-${f.observedYear}` : 'supplementary-map-outline'),
    runtimeGeometryPreserved: features.every(f => f.runtimeOwners.length === 1),
    currentCompleteness: 'not-verified', knownReviewIssues: issues,
    reviewRequired: ['Current outlines and all additional/missing playing surfaces', 'Trees over/along play, woodland edges and nearby buildings', 'Independent horizontal alignment checks'] };
});
const bounds = coordinates => {
  const points = coordinates.flat(Infinity);
  const e = [], n = [];
  for (let i = 0; i < points.length; i += 2) { e.push(points[i]); n.push(points[i + 1]); }
  return { minEasting: Math.min(...e), minNorthing: Math.min(...n), maxEasting: Math.max(...e), maxNorthing: Math.max(...n) };
};
const core = ground.tiles.filter(t => t.lod === 0);
const measuredBounds = {
  minEasting: Math.min(...core.map(t => t.bounds.minEasting)), minNorthing: Math.min(...core.map(t => t.bounds.minNorthing)),
  maxEasting: Math.max(...core.map(t => t.bounds.maxEasting)), maxNorthing: Math.max(...core.map(t => t.bounds.maxNorthing)),
};
const report = {
  schemaVersion: 1, groundId: 'lidingo', scope: 'retained-source-to-served-pack geometry audit; current census and positional accuracy not established',
  geometryAudit: failures.length ? 'failed' : 'passed', failures,
  inputs, coordinateFrame: { horizontalCrs: 'EPSG:3006', localOrigin: [FRAME.easting, FRAME.northing] },
  playingSurfaces: { counts: countBy(surfaceRecords, f => f.kind), total: surfaceRecords.length,
    evidence: countBy(surfaceRecords, f => f.observedYear ? `orthophoto-${f.observedYear}` : 'supplementary-map-outline'),
    unassigned: surfaceRecords.filter(f => f.hole === null), currentCompleteness: 'not-verified' },
  facilities: { total: facilities.features.length, physicalOwnership: 'one owner per adopted polygon; internal islands preserved' },
  holes: holeRows,
  environment: {
    terrain: { bounds: ground.bounds, tileCount: ground.tiles.length, nativeOneMetreBounds: measuredBounds },
    context: { bounds: bounds(context.features.map(f => f.geometry.coordinates)), sourceFeatures: context.features.length,
      unmodeledLeisureFeatures: context.features.filter(f => ['pitch', 'park', 'playground'].includes(f.properties.tags.leisure)).map(f => ({ id: f.id, kind: f.properties.tags.leisure, name: f.properties.tags.name ?? null })),
      note: 'Context coverage is smaller than the terrain world. Park boundaries alone do not establish vegetation or equipment.' },
    buildings: { footprints: buildings.length, measuredRoofCount: roofs.buildings.length, sourceEpoch: roofs.sourceEpoch,
      roofs: roofs.buildings.map(b => ({ id: b.sourceFootprintId, coverageFraction: b.mesh.statistics.footprintCoverageFraction, state: b.state })),
      limitation: 'Other heights are generic or unverified map tags; current footprints and architectural detail remain unverified.' },
    vegetation: { boundaryCounts: countBy(vegetationFeatures, f => f.properties.tags.landuse === 'forest' ? 'forest' : f.properties.tags.natural),
      measuredStandTileCount: core.filter(t => t.layers.stands).length, capturedAt: stands.capturedAt,
      individualObjectRecords: stands.individualObjectRecords,
      limitation: 'Measured canopy cells do not establish exact individual stems, crowns or species. No new laser campaign was acquired by this audit.' },
    water: { courseComponents: runtime.water.length, surroundingComponents: environmentWater.features,
      surroundingInteriorRings: environmentWater.interiorRings, worldBoundsEpsg3006: environmentWater.worldBoundsEpsg3006,
      renderer: 'separate checksummed surrounding-water meshes; course pack polygons preserved',
      limitation: 'Source coverage now reaches the 16 km world bounds. Browser visual verification remains pending; no bathymetry or present-day water level is claimed.' },
  },
  newOrthophoto: { accessState: orthophotoAudit.state, measuredFeatures: orthophotoAudit.features.length,
    geometryVerificationFromImagery: false, boundaryVerification: 'per-hole visual source review pending; acquired spectral statistics are separate evidence' },
  surfaceRecords,
};
const rows = holeRows.map(h => `| ${h.hole} | ${h.par} | ${h.green} | ${h.tee} | ${h.fairway} | ${h.bunker} | ${h.knownReviewIssues.map(i => i.status).join('; ') || 'Current-image review required'} |`).join('\n');
const md = `# Lidingö mapping completeness audit\n\nGeometry preservation: **${report.geometryAudit}**. This checks retained source vertices against the served pack; it does not establish current completeness or survey accuracy. Both 2025 Lantmäteriet orthophoto tiles have been read and all 110 outlines have spectral measurements. This geometry audit does not substitute for a visual image-overlay review; see [the new imagery review](ortho-2025-review.md).\n\n${surfaceRecords.length} adopted playing outlines and ${facilities.features.length} facility features retain their physical ownership through packing, including interior islands. ${buildings.length} building footprints and ${vegetationFeatures.length} vegetation context polygons retain their source geometry.\n\n## Every-hole review queue\n\nCounts describe adopted outlines, not the actual number present today. Zero does not mean a feature is absent. Par-3 holes need not have a fairway. Every hole still needs a current-image census and alignment review.\n\n| Hole | Par | Greens | Tees | Fairways | Bunkers | Recorded issue / next review |\n|---|---|---|---|---|---|---|\n${rows}\n\nTwo greens, one tee and three bunkers are unassigned to playing holes. The greens have named practice-facility owners; unassigned context must not be silently reassigned to reach a target count.\n\n## Environment coverage\n\n- Terrain now spans 16,384 m in ${ground.tiles.length} tiles. The 2,048 m native 1 m window and its canopy remain the highest-detail region.\n- Source context has ${context.features.length} features over a smaller extent than the terrain world. ${report.environment.context.unmodeledLeisureFeatures.length} retained park, pitch and playground polygons lack explicit leisure-feature representation; their tags cannot locate individual equipment or trees.\n- ${roofs.buildings.length} roofs have 2021 measurements. Clubhouse and north facility roof coverage remains about 92.3% and 89.7%; other building heights and facades need evidence.\n- Canopy is dated ${stands.capturedAt}; it provides stand representatives, with zero surveyed individual-tree records. It does not establish forest coverage throughout the expanded world.\n- Seven course-water components are now joined by 144 acquired surrounding polygons with 180 interior rings. The separate renderer preserves islands, original water heights and the course-window exclusion. Browser visual verification remains pending.\n\n## Acceptance for the next source pass\n\nFor each hole, inspect the current orthophoto with the adopted outlines overlaid, record additions/removals and source date, check ambiguous shadows against laser evidence, and retain unresolved edges as unresolved. Independently check horizontal alignment before assigning accuracy. Rebuild vegetation exclusions after adopting changed surfaces. Review surrounding land cover, shorelines and buildings across the camera-visible environment as well as the course.\n\nRegenerate with \`node lidingobuild/mapping/audit-completeness.mjs\`; use \`--check\` to require a current report and preserved runtime geometry. Full feature IDs, evidence classes, bounds and file hashes are in [mapping-completeness.json](mapping-completeness.json).\n`;
for (const [name, content] of [['mapping-completeness.json', JSON.stringify(report, null, 2) + '\n'], ['mapping-completeness.md', md]]) {
  const destination = path.join(root, 'lidingobuild/mapping', name);
  if (process.argv.includes('--check')) assert(fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === content, `${name} is stale; regenerate the audit`);
  else fs.writeFileSync(destination, content);
}
console.log(JSON.stringify({ geometryAudit: failures.length ? 'failed' : 'passed', playingSurfaces: surfaceRecords.length,
  facilities: facilities.features.length, buildings: buildings.length, vegetationPolygons: vegetationFeatures.length,
  currentCompleteness: 'not-verified', failures }, null, 2));
if (failures.length) process.exitCode = 1;
