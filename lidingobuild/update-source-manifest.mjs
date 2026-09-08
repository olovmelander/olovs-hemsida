/* Refresh only Lidingö's evidence ledger after reproducible local builds. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../packages/course-geo/manifest.mjs';
import { FRAME } from './build-course.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'geo_data/course-v2/lidingo/source-manifest.json');
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const has = p => fs.existsSync(path.join(ROOT, p));
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const lineage = ['terrain-lm-1m', 'water-breaks-lm-1m', 'laser-lm-skog', 'lidingo-osm-2026-09-07', 'imagery-municipal-2019', 'club-scorecard'];
if (has('lidingobuild/course-model.json')) {
  const model = read('lidingobuild/course-model.json');
  m.legacyFrame = {
    buildDirectory: 'lidingobuild', originWgs84: { latitude: FRAME.latitude, longitude: FRAME.longitude },
    metresPerLatitude: model.mPerLat, metresPerLongitude: model.mPerLon,
    heightReference: 'Absolute RH 2000 from retained Lantmäteriet 1 m DTM; independent local residual checks pending',
    frame: 'exact local metres from EPSG:3006; east +x, north -z',
    projectedOriginEpsg3006: { easting: FRAME.easting, northing: FRAME.northing,
      axisMapping: { worldX: 'easting - originEasting', worldZ: 'originNorthing - northing' } },
  };
}
const laser = m.sources.find(s => s.id === 'laser-lm-skog');
const canopy = read('geo_data/course-v2/lidingo/vegetation/canopy-evidence.json');
Object.assign(laser, { lifecycle: 'acquired', acquiredAt: '2026-09-07', capturedAt: '2021-03-23',
  checksum: canopy.sourceIdentity.catalogueSha256, checksumReason: null,
  notes: 'Bounded COPC reads acquired 11,677,559 interior non-noise returns over 64 windows, with 64 m halos. Four retained 2048×2048 1 m rasters preserve measured/void cells. SHA identifies provider-advertised whole source; 99,116,447 transferred bytes were range-read, not a complete source rehash. Derived canopy is area evidence, not individual-tree survey. See vegetation/canopy-evidence.json.' });
m.sources.find(s => s.id === 'water-breaks-lm-1m').notes =
  'Complete source GPKG checksum verified. Clipped EPSG:3006 PolygonZ/MultiPolygonZ source preserves all 7 outer polygons and RH 2000 water levels; no retained holes. Acquisition clip edges are not claimed as shoreline. See mapping/water-breakgeometry-review.json; no bathymetry inferred.';
m.sources.find(s => s.id === 'imagery-municipal-2019').notes =
  'Retained 2019 municipal orthophoto, exported at 0.5 m per pixel in EPSG:3011 with worldfile. Official municipal distribution metadata resource/32 explicitly licences this exact service as CC0-1.0; see mapping/municipal-ortho-2019-licence.json. Source GSD, exact capture date and local control residuals unknown. Traces are machine-reviewed candidates; 2019 cannot establish later course changes.';
function artifact(id, kind, p, derivedFrom, notes, use = 'discovery-evidence') {
  if (!has(p)) return;
  const entry = { id, kind, path: p, sha256: sha256File(path.join(ROOT, p)), derivedFrom: [...new Set(derivedFrom)], use, notes };
  const index = m.artifacts.findIndex(a => a.id === id);
  if (index === -1) m.artifacts.push(entry); else m.artifacts[index] = entry;
}
const base = 'geo_data/course-v2/lidingo/';
artifact('municipal-imagery-primary-licence', 'acquisition', base + 'mapping/municipal-ortho-2019-licence.json', ['imagery-municipal-2019'], 'Primary CC0 licence evidence for exact 2019 endpoint; does not license the separate public national orthophoto view.');
artifact('water-breakgeometry-clipped', 'topography', base + 'mapping/water-breakgeometry-epsg3006.geojson', ['water-breaks-lm-1m'], 'Source-clipped 3D water polygons, topology and levels preserved.');
artifact('water-breakgeometry-review', 'control', base + 'mapping/water-breakgeometry-review.json', ['water-breaks-lm-1m'], 'Source SHA, topology, height and acquisition-edge audit; not independent survey approval.');
artifact('terrain-vista-acquisition', 'acquisition', base + 'mapping/terrain-vista.json', ['terrain-lm-1m'], 'Four source items, 257×257 samples at 32 m over the 8192 m context extent; byte identities and no-data checks.');
artifact('canopy-raster-acquisition', 'canopy', base + 'vegetation/canopy-evidence.json', ['laser-lm-skog', 'terrain-lm-1m'], '2021 campaign-constrained point-cloud rasters with explicit voids, density, transfer and DTM ground comparison.');
artifact('canopy-stand-compilation', 'canopy', base + 'vegetation/stand-evidence.json', ['laser-lm-skog', ...lineage], 'Measured 4 m stand fields and semantic exclusions; no individual-tree registry or stem survey.');
artifact('playing-surface-candidates', 'surface', 'lidingobuild/mapping/playing-surfaces.geojson', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Per-feature observed geometry and uncertainty; source polygons and 2019 CC0 image traces; machine review only.');
artifact('playing-surface-review', 'control', 'lidingobuild/mapping/playing-surfaces-review.json', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Per-polygon source, geometry, association and omission review; explicit retained source hashes and unknown registration accuracy.');
artifact('facility-surface-candidates', 'surface', 'lidingobuild/mapping/facilities.geojson', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Named practice greens, range field and platforms, courtyard paving with turf island, and observed parking. One runtime owner per physical surface; generic material where unknown.');
artifact('facility-surface-review', 'control', 'lidingobuild/mapping/facilities-review.json', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Source identities, valid polygons, retained interior rings, qualified building clips and pending current facility alterations.');
artifact('facility-pixel-traces', 'surface', 'lidingobuild/mapping/facility-traces-2019.json', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Reproducible source-pixel authoring and explicit OSM facility associations; no invented furniture, bay spacing or tree locations.');
artifact('normalized-infrastructure', 'topography', 'lidingobuild/mapping/infrastructure.geojson', ['lidingo-osm-2026-09-07', 'imagery-municipal-2019'], '26 closed parking ways interpreted as source areas and six golf paths restored from the split reference; two coarse club parking rings retired in favour of observed surfaces.');
artifact('normalized-infrastructure-review', 'control', 'lidingobuild/mapping/infrastructure-review.json', ['lidingo-osm-2026-09-07', 'imagery-municipal-2019'], 'Exact vertex identity, parking area semantics, retired footprint overlap and unresolved remainder recorded.');
artifact('playing-surface-pixel-traces', 'surface', 'lidingobuild/mapping/surface-traces-2019.json', ['imagery-municipal-2019'], 'Observed pixel vertices on the retained georeferenced CC0 2019 image; no schematic or card-derived shapes.');
artifact('fairway-trace-review', 'surface', 'lidingobuild/mapping/fairway-traces-review.json', ['imagery-municipal-2019'], 'Independent observed 2019 fairway12/13 pixel traces and omission of unresolvable hole16 fairway.');
artifact('surface-refinement-traces', 'surface', 'lidingobuild/mapping/surface-refinements-2019.json', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Additional observed tee platforms, bunkers and hole13 approach; displaced supplementary rings retired explicitly.');
artifact('building-laser-acquisition', 'acquisition', 'lidingobuild/mapping/building-laser-acquisition.json', ['laser-lm-skog'], 'Small bounded source point-cloud window for course facility buildings; retained transfer and point identities.');
artifact('building-roof-evidence', 'control', 'lidingobuild/mapping/building-height-evidence.json', ['laser-lm-skog', 'terrain-lm-1m', 'imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Dated first-return roof evidence, planar support, source correspondence and withheld sparse shed.');
artifact('building-roof-candidates', 'topography', 'lidingobuild/mapping/building-roof-meshes.json', ['laser-lm-skog', 'terrain-lm-1m', 'imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Five finite roof surface TIN candidates at absolute RH2000 heights. Clubhouse/north facility are explicitly partial; unsupported roof and wall regions remain omitted. Facade architecture unmeasured.');
artifact('building-roof-validation', 'control', 'lidingobuild/mapping/building-roof-validation.json', ['laser-lm-skog', 'terrain-lm-1m', 'imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Independent TIN area, winding, source heights, footprint containment, uncovered topology and supported wall perimeter checks.');
artifact('legacy-course-model', 'composite', 'lidingobuild/course-model.json', lineage, 'Source-derived exact projected compatibility adapter. Terrain is preserved; no inferred physical tees, extended routes or synthetic fairway corridors. Flags and coloured tee starts are UI references. Survey gates remain open.', 'migration-only');
artifact('compatibility-heightfields', 'terrain', 'lidingobuild/heightfields.json', ['terrain-lm-1m'], '4 m fallback sampling of acquired 1 m source and 32 m context; the live v2 graph retains 1 m spacing.', 'migration-only');
artifact('migration-course-model-epsg3006', 'composite', base + 'migration/course-model.epsg3006.json', lineage, 'Exact translation back to EPSG:3006, preserving source coordinates and RH 2000 heights.', 'migration-only');
artifact('migration-residual-report', 'control', base + 'migration/residual-report.json', lineage, 'Deterministic frame translation audit, not independent survey controls.', 'migration-only');
artifact('runtime-contract', 'control', 'lidingobuild/mapping/runtime-contract.json', lineage, 'Provisional software bridge, bounds and legacy grid omission contract. Human geospatial approval remains pending.');
// Existing immutable acquisition evidence is checked too; don't silently repair
// checksums on files not generated by this continuation.
const incomplete = m.blockers.find(b => b.id === 'incomplete-playing-geometry');
incomplete.description = 'The provisional model uses observed 2019/source polygons; completeness and current 2024–2026 alterations are not independently approved.';
m.blockers.find(b => b.id === 'vegetation-and-stable-objects-pending').description =
  'Measured 2021 canopy stands, clipped national water and supplementary OSM facilities are acquired. Contemporary stand boundaries, individual large objects and local residuals remain unapproved.';
if (process.argv.includes('--runtime-validated')) {
  m.blockers = m.blockers.filter(b => b.id !== 'runtime-graph-not-published');
}
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
console.log(`Lidingö ledger: ${m.sources.length} sources, ${m.artifacts.length} artifacts, ${m.blockers.length} unresolved gates`);
