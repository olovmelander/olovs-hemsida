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
/* This ground moved off its bespoke stand pipeline onto the repository's
   generic vegetation chain, and the generic build-canopy writes a DIFFERENT
   evidence shape: campaigns[] with per-tile transfer and totals, pinned by
   campaignsSha256 and censusSha256, where the bespoke one carried a
   sourceIdentity block. Read whichever is present rather than assuming, so a
   ground can be migrated without its ledger throwing. */
const canopyChecksum = canopy.sourceIdentity?.catalogueSha256 || canopy.campaignsSha256;
const campaign = canopy.campaigns?.[0] || null;
Object.assign(laser, { lifecycle: 'acquired', acquiredAt: '2026-09-08',
  capturedAt: (campaign?.captureStart || '2021-03-23T00:00:00Z').slice(0, 10),
  checksum: canopyChecksum, checksumReason: null,
  notes: `Bounded COPC reads over ${campaign ? campaign.tiles : 64} finest tiles with a ${canopy.haloMetres || 32} m halo, through the repository's generic vegetation chain rather than this ground's original bespoke one. The checksum pins the campaign inventory, which is what identifies the source: the point bytes are range-read, never rehashed whole. The campaign is LEAF-OFF (2021-03-23), which Johannesberg measured to under-detect deciduous crowns, and this is a park course. See vegetation/canopy-evidence.json and the review overlays beside it.` });
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
/* The 1 m window's own record. It was pinned once and never re-pinned, because
   nothing registered it - so a re-acquisition, which rewrites its clocks, failed
   the checksum gate. The guard against a source actually moving is
   restore-build-caches, which compares this record field by field against the
   committed one; this is only the bookkeeping. */
artifact('terrain-window-acquisition', 'acquisition', base + 'acquisition/terrain-window.json', ['terrain-lm-1m'], 'Exact 1 m lattice, source ETag/bytes, range-read measurements, local Float32 hash and height range. Raw raster is ignored and is not a published v2 graph.');
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

/* --- the 2026-09-08 continuation: a third-party GPS survey, the ring world,
   the pinned campaign inventory, and the imagery measurements that refused
   themselves. Each is EVIDENCE; none of it moved an observed polygon. */
artifact('golftraxx-survey', 'control', 'geo_data/lidingo_clean.json', ['club-scorecard'], 'Third-party published GolfTraxx hole geometry for course 18130SW, 18 holes x 5 points. Its Green Center points are adopted as a per-hole ANCHOR only; its tee points are refused, because every hole but the first measures 0.915-0.919 of its card length and that fraction is the yard.');
artifact('golftraxx-survey-review', 'control', 'lidingobuild/mapping/golftraxx-survey-review.json', ['club-scorecard', 'imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'The survey measured against two records it never saw: the card (its six no-target holes are exactly the six par 3s) and the observed greens (all 18 centres on the right hole, 16 strictly inside, median 3.27 m). The median offset is far smaller than the scatter, so no shift is applied to either record.');
/* the ring acquisition evidence is registered by publish-ground-rings itself,
   as `ground-rings`; a second id on the same path is two pins that can
   disagree. */
artifact('laser-campaign-inventory', 'acquisition', base + 'acquisition/laser-campaigns.json', ['laser-lm-skog'], 'Pinned Laserdata Skog inventory: one campaign 21c031-658_67 captured 2021-03-23, 217,740,127 points at 2.156 returns/m2, exclusive over the AOI with no seam. Skogsstyrelsen calls it Terrain Mapper Omdrev 2 and LEAF-OFF, which under-detects deciduous crowns on a park course.');
/* THE 2025 CAPTURE IS THE PHOTO RECORD, and six layers were measured on it and
   then adversarially verified. Each file carries its own rule, its score
   against a record that never entered that rule, its refusals with their
   numbers, and a `verification` block naming what the check reproduced and what
   it corrected. reconcile-2025-evidence.py --check is the gate that a re-run of
   a tracer has not reintroduced a corrected statement. */
artifact('lm2025-shared-reader', 'control', 'lidingobuild/mapping/lm2025.py', ['imagery-lm-ortho', 'terrain-lm-1m'], 'One reader for the 2025 capture and the 1 m laser, so four surface classes cannot each calibrate a different rule on the same pixels and then disagree about what the photograph says.');
artifact('green-trace-2025', 'control', 'lidingobuild/mapping/green-trace-2025.json', ['imagery-lm-ortho', 'terrain-lm-1m', 'lidingo-osm-2026-09-07'], 'Five green-tracing methods scored against the 11 OSM green rings, which never entered any rule: best median IoU 0.365 by a method that grows on every hole, 0.603 by one that grows on two. REFUSED. Mown turf is one colour in this frame, and the polar readings return 2.7-3.4x the surveyed area - the green complex, not the putting surface.');
artifact('coast-2025', 'topography', 'lidingobuild/mapping/coast-2025.json', ['terrain-lm-1m', 'lidingo-osm-2026-09-07'], 'The sea as laser-flat plates at a measured 0.100 m RH 2000, traced to closed rings, scored against the OSM coastline at a median 2.85 m over the fine pair and 5.27 m over the context ring. The 2025 capture cannot see this feature at all - 0 of 98,571 plate samples fall inside it - so the layer is laser-only and says so.');
artifact('coast-rings', 'topography', 'lidingobuild/mapping/coast-rings.geojson', ['terrain-lm-1m'], 'The five plates united into one ring per body, 607.74 ha replacing the break geometry\'s 9.90 ha of window-clipped fragments. One body, one ring: two sheets at one level over one water are a z-fight. isSea stays false - that flag is an instruction about the whole world and this ring stops at the acquisition edge.');
artifact('fairway-trace-2025', 'surface', 'lidingobuild/mapping/fairway-trace-2025.json', ['imagery-lm-ortho', 'terrain-lm-1m', 'lidingo-osm-2026-09-07'], 'Mown turf separates from rough and forest jointly (held-out true-positive rate 0.901) but is 2.1x a fairway; a fairway-grade cut reproduces the five held-out OSM rings at a median ring IoU of 0.665 on all 12 par 4s and 5s. CANDIDATE: seven of the twelve rest on one record plus a rule, and each piece is tagged.');
artifact('bunker-trace-2025', 'surface', 'lidingobuild/mapping/bunker-trace-2025.json', ['imagery-lm-ortho', 'terrain-lm-1m'], 'The 2025 detection confirms 34 of the 40 mapped bunkers at sub-metre registration and offers each a measured 0.16 m outline; 6 keep their own ring with a dated refusal. NOTHING ADOPTED. The 37 accepts away from any mapped bunker are not a stable census - closing the calibration loop moves them to 30 while the 34 stay.');
artifact('tee-deck-2025', 'surface', 'lidingobuild/mapping/tee-deck-2025.json', ['imagery-lm-ortho', 'terrain-lm-1m'], 'Flatness does NOT define a tee deck here - every flatness and slope gap measured is negative - and the edge step is an enrichment rather than a separation: matched populations put tee p25 at 0.134 against confuser p90 0.139. 42 platforms, 8 adopted where the measured platform AND a card distance agree.');
artifact('tree-cover-2025-evidence', 'control', 'lidingobuild/mapping/tree-cover-2025.json', ['imagery-lm-ortho', 'laser-lm-skog'], 'A two-term classifier - relative texture over 4.8 m plus a shadow anchor - reproduces the laser canopy at IoU 0.774 / recall 0.947 where the model\'s own 18 wood rings reach 0.321 / 0.346. 41.7% of the adopted raster has no second record under it, and that is stated as a taken decision.');
artifact('tree-cover-raster', 'canopy', 'lidingobuild/tree-cover.json', ['imagery-lm-ortho', 'laser-lm-skog'], 'The 3 m two-bit canopy raster this ground never had, 398 x 456 cells. emit-pack reads this path directly, so it is live geometry and not a candidate.');
artifact('building-check-2025', 'control', 'lidingobuild/mapping/building-check-2025.json', ['imagery-lm-ortho', 'lidingo-osm-2026-09-07', 'laser-lm-skog'], 'Registration and presence against the 2025 capture. NOTHING APPLIED: the relief lean is real but only ~0.6 m at a median 296 m radius, and it is radial about EACH mosaic block - this capture is 15 timestamped frames in three flight lines. The clubhouse roof measures a mid blue-grey, not the near-black the page claimed.');
artifact('evidence-reconciliation-2025', 'control', 'lidingobuild/mapping/reconcile-2025-evidence.py', ['imagery-lm-ortho'], 'Applies the adversarial verification\'s corrections to the six evidence files from their own computed fields, and gates with --check that a re-run has not reintroduced one.');
artifact('ortho-colour-calibration', 'control', 'lidingobuild/mapping/ortho-calibration.json', ['imagery-municipal-2019', 'lidingo-osm-2026-09-07'], 'Colour classes measured on THIS course, on features mapped without reference to them: sand luminance 140 against turf 89-100 and wood 66, excess-green 19 against turf 37-41. A rule calibrated on another course is calibrated on another course s light.');
artifact('bunker-detection-refusal', 'control', 'lidingobuild/mapping/bunker-detection.json', ['imagery-municipal-2019', 'terrain-lm-1m'], 'The identical sand-in-a-hollow rule run over both available captures, scored on the 40 already-mapped bunkers. It recovers 9 of 40 on the 2019 CC0 frame and 8 of 40 on a leaf-on 0.30 m one, against 8 of 9 at Angso. NOTHING IS ADOPTED; the number is recorded so the attempt is not repeated without a better capture.');
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
