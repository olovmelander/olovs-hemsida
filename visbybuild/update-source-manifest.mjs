/* Refresh Visby's reproducible derived evidence without approving survey or rights gates. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../packages/course-geo/manifest.mjs';
import { VISBY_FRAME as FRAME } from './frame.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'geo_data/course-v2/visby/source-manifest.json');
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
const has = p => fs.existsSync(path.join(ROOT, p));
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const terrain = ['terrain-lm-636-68', 'terrain-lm-637-68'];
const water = ['water-breaks-lm-636-68', 'water-breaks-lm-637-68'];
const laser = ['laser-lm-24e002-636-68', 'laser-lm-24e002-637-68'];
const surfaces = ['visby-municipal-ortho-2022', 'visby-osm-2026-09-07', 'club-banguide'];
const lineage = [...terrain, ...water, ...surfaces, 'club-scorecard'];
if (has('visbybuild/course-model.json')) {
  const model = read('visbybuild/course-model.json');
  m.legacyFrame = { buildDirectory: 'visbybuild', originWgs84: { latitude: FRAME.latitude, longitude: FRAME.longitude },
    metresPerLatitude: model.mPerLat, metresPerLongitude: model.mPerLon,
    heightReference: 'Absolute RH 2000 from acquired Lantmäteriet 1 m DTM; independent local controls pending',
    frame: FRAME.text, projectedOriginEpsg3006: { easting: FRAME.easting, northing: FRAME.northing,
      axisMapping: { worldX: 'easting - originEasting', worldZ: 'originNorthing - northing' } } };
  // Schema intentionally keeps an unapproved canonical origin null. The exact
  // software frame is recorded above and in the hashed runtime contract.
  m.canonicalFrame.origin = { easting: null, northing: null, heightRH2000: null };
  m.canonicalFrame.originStatus = 'pending-control-approval';
}
for (const s of m.sources) {
  if (terrain.includes(s.id)) s.notes = s.notes.replace('No approved canonical origin or playable course.', 'The local provisional 3D uses this exact terrain; canonical origin approval remains pending.');
  if (water.includes(s.id)) s.notes = 'Complete source GeoPackage SHA verified. Clipped EPSG:3006 water retains source levels and ten interior islands across both source items. Compatibility partition preserves polygon union; acquisition edges are not shoreline and heights are not bathymetry. See mapping/water-breakgeometry-review.json.';
  // Acquisition owns source identities. The current canopy evidence records
  // campaigns rather than the retired sourceIdentity array; refreshing vector
  // artifacts must neither crash nor rewrite already verified laser checksums.
}
function artifact(id, kind, p, derivedFrom, notes, use = 'discovery-evidence') {
  if (!has(p)) return;
  const value = { id, kind, path: p, sha256: sha256File(path.join(ROOT, p)), derivedFrom, use, notes };
  const i = m.artifacts.findIndex(a => a.id === id);
  if (i < 0) m.artifacts.push(value); else m.artifacts[i] = value;
}
const base = 'geo_data/course-v2/visby/';
artifact('source-route-crosswalk', 'routing', 'visbybuild/mapping/route-reference.json', surfaces, 'All 18 main-course identities matched against guide and 2022 image; explicit pixels and source associations; independent review pending.');
artifact('playing-surface-pixel-traces', 'surface', 'visbybuild/mapping/surface-traces-2022.json', surfaces, 'Reproducible source-pixel polygons and sand seeds; interpretation uncertainty separate from unknown registration accuracy.');
artifact('playing-surface-candidates', 'surface', 'visbybuild/mapping/playing-surfaces.geojson', surfaces, 'Observed provisional surface polygons; OSM ring lineage and image trace methods retained per feature. Production rights and contemporary verification remain unresolved.');
artifact('playing-surface-review', 'control', 'visbybuild/mapping/playing-surfaces-review.json', surfaces, 'Geometry, association, coverage and source-byte audit; not survey approval.');
artifact('practice-surface-candidate', 'surface', 'visbybuild/mapping/practice-surfaces.geojson', surfaces, 'Observed range field excludes measured height cells that may be range structures, retaining visible boundary trees.');
artifact('practice-surface-review', 'control', base+'vegetation/practice-surface-evidence.json', surfaces, 'Source pixel vertices, retained image hash and independent overlay review of range footprint.');
artifact('canonical-routing-candidate', 'composite', 'visbybuild/mapping/geometry.json', surfaces, 'EPSG:3006 main-course authoring geometry; cardinal tee lengths do not determine source coordinates.');
artifact('clubhouse-and-first-tee-review', 'control', 'visbybuild/mapping/facilities-review.json', ['visby-municipal-ortho-2022'], 'Source image registration and pixel boundaries for a clubhouse practice green and two additional first-hole platforms. Camera references are inside observed surfaces; numbered tee associations and daily markers remain unverified.');
artifact('expanded-tee-platform-review', 'control', 'visbybuild/mapping/tee-platform-review.json', ['visby-municipal-ortho-2022'], 'All 18 tee windows inspected; 27 additional physical platforms on 12 holes, with bounded virtual-camera corrections. Retained source pixels and image hashes; not current numbered-marker or survey evidence.');
artifact('range-environment-surface-review', 'control', 'visbybuild/mapping/environment-surfaces-review.json', surfaces, 'Registered mowing boundaries for the short-game green and neighbouring nine-course green beside the range. Schematic guide corroborates identity only; no new playable routing or equipment inferred.');
artifact('bunker-contour-review', 'control', 'visbybuild/mapping/bunker-contour-review.json', surfaces, 'Image component parameters and omitted unresolved contours.');
artifact('water-canonical-geometry', 'topography', base+'mapping/water-breakgeometry-epsg3006.geojson', water, 'Canonical source-clipped PolygonZ/MultiPolygonZ with islands retained.');
artifact('water-compatibility-geometry', 'topography', base+'mapping/water-breakgeometry-simple-epsg3006.geojson', water, 'Exact area-preserving simple-polygon decomposition for GPK1; artificial cuts explicitly distinguished from shores.');
artifact('water-review', 'control', base+'mapping/water-breakgeometry-evidence.json', water, 'Water source, topology, height and partition audit.');
artifact('osm-context-clipped', 'topography', base+'mapping/osm-context-epsg3006.geojson', ['visby-osm-2026-09-07'], 'Source context clipped to measured terrain; footprints are supplementary, heights and widths may be generic.');
artifact('measured-canopy-evidence', 'canopy', base+'vegetation/canopy-evidence.json', [...laser, ...terrain], '2024 campaign constrained 2 m canopy from bounded COPC reads, with density/void metadata.');
artifact('measured-stand-evidence', 'canopy', base+'vegetation/stand-evidence.json', [...laser, ...lineage], '4 m measured stand cells with current playing-surface and water exclusions; zero individual stem claims.');
artifact('legacy-course-model', 'composite', 'visbybuild/course-model.json', lineage, 'Provisional compatibility model using exact projected offsets. Measured terrain unchanged; pins and numeric tee starts are camera references only.', 'migration-only');
artifact('compatibility-heightfields', 'terrain', 'visbybuild/heightfields.json', terrain, '4 m/16 m exact source decimations for fallback; live v2 terrain retains 1 m spacing.', 'migration-only');
artifact('migration-course-model-epsg3006', 'composite', base+'migration/course-model.epsg3006.json', lineage, 'Exact projected-offset roundtrip, without geographic scale distortion.', 'migration-only');
artifact('migration-residual-report', 'control', base+'migration/residual-report.json', lineage, 'Software coordinate preservation, not independent survey control.', 'migration-only');
artifact('runtime-contract', 'control', 'visbybuild/mapping/runtime-contract.json', lineage, 'Terrain bounds, origin and fallback/graph bridge contract; geospatial approval pending.');
// Browser reports bind a concrete graph generation separately. Including them
// here would create a cycle: source ledger -> graph -> browser proof -> ledger.
const descriptions = {
  'hole-routing-unresolved': 'All 18 main-course identities have provisional source-derived routes. Independent contemporary routing review and coordinate controls remain pending; ambiguous OSM ref2 records are not used as authority.',
  'playing-surfaces-incomplete': 'Main-course greens, representative physical tees, fairways and observed bunkers are implemented. All tee platforms, current mowing edges, fringes and the separate nine remain incompletely reviewed.',
  'canonical-origin-unapproved': 'A fixed software frame at the measured terrain midpoint is now used consistently. No independent survey anchors approve its canonical status.',
  'vegetation-and-objects': '2024 measured canopy, national water with preserved islands and OSM context are implemented. Individual trees, present-day change and building dimensions remain unapproved.',
  'playable-runtime-pending': 'A local provisional compatibility pack and measured v2 graph are implemented; complete independent human, named device and all-season visual acceptance remains pending.'
};
for (const b of m.blockers) if (descriptions[b.id]) b.description = descriptions[b.id];
fs.writeFileSync(file, JSON.stringify(m, null, 2)+'\n');
console.log(`Visby ledger: ${m.sources.length} sources, ${m.artifacts.length} artifacts; ${m.blockers.length} independent release gates remain open.`);
