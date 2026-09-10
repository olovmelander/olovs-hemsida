/** Refresh Tortuna's source ledger after reproducible local source/model builds.
 * Graph-dependent validation reports deliberately stay outside this ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File, validateSourceManifest } from '../packages/course-geo/manifest.mjs';
import { TORTUNA_FRAME as FRAME } from './frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'geo_data/course-v2/tortuna/';
const absolute = p => path.join(ROOT, p);
const has = p => fs.existsSync(absolute(p));
const read = p => JSON.parse(fs.readFileSync(absolute(p), 'utf8'));
const digest = p => sha256File(absolute(p));
const day = value => value ? value.slice(0, 10) : null;
const manifestPath = absolute(BASE + 'source-manifest.json');
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const discovery = read(BASE + 'acquisition/d2-discovery.json');
const terrain = read(BASE + 'acquisition/terrain-window.json');
const ortho = read(BASE + 'acquisition/orthophoto-review.json');
const water = read(BASE + 'acquisition/water-evidence.json');
const canopy = read(BASE + 'vegetation/canopy-evidence.json');
const expandedCanopy = read(BASE + 'vegetation/expanded-canopy-evidence.json');
const osm = read(BASE + 'acquisition/osm-context.json');
const extraOsm = read(BASE + 'acquisition/osm-context-extra.json');
const extraOsmId = 'tortuna-osm-environment-2026-09-09';
const media = read('tortunabuild/reference/source-assets.json');
const card = read('tortunabuild/reference/scorecard.json');

function source(id, updates, defaults = {}) {
  let entry = m.sources.find(s => s.id === id);
  if (!entry) {
    entry = {
      id, productId: defaults.productId, roles: defaults.roles,
      lifecycle: 'planned', use: 'candidate', sourceUri: defaults.sourceUri,
      localPath: null, bboxWgs84: m.targetBboxWgs84, acquiredAt: null, capturedAt: null,
      checksum: null, checksumReason: 'No retained source identity recorded yet.',
      replacementSourceId: null, accuracyTier: 'unrated',
      horizontalAccuracyMetres: null, verticalAccuracyMetres: null, notes: '',
    };
    m.sources.push(entry);
  }
  Object.assign(entry, updates);
  if (entry.checksum !== null) entry.checksumReason = null;
}

const dtm = discovery.terrain.items.find(item => item.id === terrain.sourceItems[0].id);
if (!dtm || dtm.assets.data.href !== terrain.sourceItems[0].href) throw new Error('Tortuna terrain source receipt differs from discovery');
source('terrain-lm-1m', {
  lifecycle: 'acquired', use: 'candidate', sourceUri: dtm.assets.data.href,
  localPath: null, acquiredAt: terrain.acquiredOn, capturedAt: day(dtm.capturedAt),
  checksum: dtm.assets.data.sha256,
  horizontalAccuracyMetres: dtm.horizontalUncertaintyMetres,
  verticalAccuracyMetres: dtm.verticalUncertaintyMetres,
  notes: `Source item ${dtm.id}, 303676386-byte COG. Checksum is the provider-advertised whole-source SHA-256, not a recomputation: acquisition used ${terrain.transfer.rangeRequests} bounded HTTP requests transferring ${terrain.transfer.rangeBytes} bytes. The separate terrain-window artifact records the exact ${terrain.raster.bytes}-byte Float32 window SHA-256 (${terrain.raster.sha256}), 4097 x 4097 native 1 m samples without resampling. Catalogue capture range ${dtm.captureStart} to ${dtm.captureEnd}; capturedAt is the catalogue representative date, not a site-wide single flight. Declared 0.3 m plan/0.1 m height accuracy is not independent local control approval. CC BY 4.0, Lantmäteriet attribution required.`,
});
source('imagery-lm-ortho', {
  lifecycle: 'acquired', use: 'candidate', acquiredAt: day(ortho.acquiredAt),
  capturedAt: day(ortho.sources[0].capturedAt),
  sourceUri: 'https://api.lantmateriet.se/stac-bild/v1/',
  localPath: BASE + 'acquisition/orthophoto-review.json',
  checksum: digest(BASE + 'acquisition/orthophoto-review.json'),
  notes: `${ortho.collection}, four RGBI COGs captured 2026-05-02, native GSD 0.16 m. This checksum identifies the retained ACQUISITION RECEIPT at localPath, not a whole source COG. The receipt retains exact source URLs and identities plus separate hashes for two private 4000 x 4000, 0.32 m review windows averaged from native pixels. Native 0.16 m supplementary hole crops have a separate receipt. Original imagery remains in ignored private cache and is never a rendered ground texture. Per-feature outlines are provisional visual interpretations; human review and independent accuracy checks remain open. Exact provider terms/attribution are retained in provider-access-review.json.`,
});
source('laser-lm-skog', {
  lifecycle: 'acquired', use: 'candidate', acquiredAt: canopy.observedOn,
  capturedAt: day(canopy.source.capturedAt), sourceUri: canopy.source.assets.data.href,
  localPath: null, checksum: canopy.source.assets.data.sha256,
  notes: `${canopy.source.id}, 930359431-byte COPC, captured ${canopy.source.captureStart} to ${canopy.source.captureEnd}. Checksum is provider-advertised; the full file was not rehashed. Count-checked bounded reads transferred ${canopy.transfer.bytes} bytes in ${canopy.transfer.requests} requests. Four retained ${canopy.grid.width} x ${canopy.grid.height} 1 m rasters have independent derived-byte hashes in canopy-evidence.json. Void cells remain unknown. April 2021 canopy and later 2026 exclusions do not prove a complete current tree census or stem/species survey. CC BY 4.0, Lantmäteriet attribution required.`,
});
source('water-breaks-lm-1m', {
  lifecycle: 'acquired', use: 'candidate', sourceUri: water.sourceUrl,
  acquiredAt: day(water.acquiredAt), capturedAt: null, checksum: water.sourceSha256,
  notes: `The complete ${water.sourceBytes}-byte source GeoPackage SHA-256 was verified before clipping. The separately checksummed source clip retains ${water.features} 3D Polygon/MultiPolygon features with RH 2000 levels. Acquisition crop edges are not shoreline and the source contains no bathymetry. The runtime-specific water review is a separate derivation retaining area/holes checks; it does not redefine this source. CC BY 4.0, Lantmäteriet attribution required.`,
}, { productId: 'lantmateriet-markhojdmodell-1m', roles: ['hydrology', 'topography'], sourceUri: water.sourceUrl });
source('tortuna-osm-2026-09-09', {
  lifecycle: 'acquired', use: 'candidate', sourceUri: osm.sourceUrl,
  bboxWgs84: [16.71, 59.651, 16.744, 59.674],
  acquiredAt: day(osm.acquiredAt), capturedAt: null, checksum: osm.sourceSha256,
  localPath: null,
  notes: `Complete bounded ${osm.sourceBytes}-byte OSM XML response hashed before projection. Projected derivative identity is separately retained in osm-context.json; incomplete relations are listed, not repaired by invented closure. No golf hole, green, tee, fairway or bunker outlines exist in this extract. OSM edit timestamps are not capture dates. Buildings/path widths and heights require separate observation. ODbL 1.0; © OpenStreetMap contributors.`,
});
source(extraOsmId, {
  lifecycle: 'acquired', use: 'candidate', sourceUri: extraOsm.sourceUrl,
  bboxWgs84: [16.703, 59.645, 16.754, 59.676],
  acquiredAt: day(extraOsm.acquiredAt), capturedAt: null, checksum: extraOsm.sourceSha256,
  localPath: null,
  notes: `Supplementary bounded ${extraOsm.sourceBytes}-byte OSM XML acquisition for the wider surroundings. Original source IDs are excluded, complete building footprints retained, land cover clipped only to acquired native terrain, and unresolved relations explicitly omitted. Original contributor/contact metadata remains private. Edit timestamps do not establish capture dates; building dimensions and seasonal appearance remain estimates. ODbL 1.0; © OpenStreetMap contributors.`,
}, { productId: 'openstreetmap', roles: ['topography', 'hydrology'], sourceUri: extraOsm.sourceUrl });
const clubPage = media.assets.find(a => a.id === 'club-course');
const firstGolftraxx = media.assets.find(a => a.id === 'golftraxx-1');
source('tortuna-club-reference', {
  lifecycle: 'acquired', use: 'reference-only', sourceUri: clubPage.sourceUrl,
  acquiredAt: day(clubPage.retrievedAt), capturedAt: null, checksum: clubPage.sha256,
  localPath: null,
  notes: `Checksum identifies the exact official course-page HTML, retained privately. The separate source-assets ledger records all ${media.assets.length} original reference assets (including responsive variants): club pages/photos, 18 full Caddee hole graphics and overview, 18 GolfTraxx HTML pages and three official 2026 rules/slope PDFs. Photos/diagrams are appearance/routing corroboration, not survey input or redistribution grants. Club page embeds Caddee identifier 11454. Unknown image capture dates remain unknown.`,
});
source('tortuna-golftraxx-reference', {
  lifecycle: 'acquired', use: 'reference-only', sourceUri: firstGolftraxx.sourceUrl,
  acquiredAt: day(firstGolftraxx.retrievedAt), capturedAt: null, checksum: firstGolftraxx.sha256,
  localPath: null,
  notes: 'Checksum identifies only the exact hole-1 HTML at sourceUri; all 18 original page hashes and extracted point sets are in separate reference artifacts. TheTipsTee Back is a historical tee reference; teeTarget is a landing target. Three green points do not define green edges. Hole 9 retains an obsolete par-4 start and must not replace the current short par-3 tee. Other reference tee points can be displaced from current observed pads. Public access establishes neither survey accuracy nor a production database/geometry grant.',
});
source('club-scorecard', {
  lifecycle: 'acquired', use: 'reference-only', sourceUri: card.source,
  acquiredAt: card.observedOn, capturedAt: null, checksum: card.sourceHtmlSha256,
  localPath: null,
  notes: `Checksum identifies the live Caddee HTML, linked by the official club page, not the derived scorecard JSON. Numeric facts: 18 holes, par 71 (35/36), Gul/Blå/Röd/Orange totals ${card.teeTotals.join('/')}. Official August 2026 slope PDFs independently confirm par 71 and state 2019-08-15 rating date. Hole 9 is par 3, 105/105/95/95 m. Hole 5 is Gul 140 m and Röd 125 m; a competing aggregator reverses these. Coloured tee positions and complete current pad census remain unverified.`,
}, { productId: 'club-course-guide', roles: ['course-guide', 'routing'], sourceUri: card.source });

if (has('tortunabuild/course-model.json')) {
  const model = read('tortunabuild/course-model.json');
  m.legacyFrame = {
    buildDirectory: 'tortunabuild', originWgs84: { latitude: FRAME.latitude, longitude: FRAME.longitude },
    metresPerLatitude: model.mPerLat, metresPerLongitude: model.mPerLon,
    heightReference: 'Absolute RH 2000 from retained Lantmäteriet native 1 m DTM; independent local controls pending',
    frame: FRAME.text,
    projectedOriginEpsg3006: { easting: FRAME.easting, northing: FRAME.northing,
      axisMapping: { worldX: 'easting - originEasting', worldZ: 'originNorthing - northing' } },
  };
}
// Compiler origin is intentionally not promoted to an independently approved
// survey origin. Preserve the existing canonical control status.
const national = ['terrain-lm-1m', 'imagery-lm-ortho', 'laser-lm-skog', 'water-breaks-lm-1m'];
const refs = ['tortuna-club-reference', 'tortuna-golftraxx-reference', 'club-scorecard'];
const lineage = [...national, 'tortuna-osm-2026-09-09', extraOsmId, ...refs];
function artifact(id, kind, p, derivedFrom, notes, use = 'discovery-evidence') {
  if (!has(p)) return;
  const entry = { id, kind, path: p, sha256: digest(p), derivedFrom: [...new Set(derivedFrom)], use, notes };
  const index = m.artifacts.findIndex(a => a.id === id);
  if (index === -1) m.artifacts.push(entry); else m.artifacts[index] = entry;
}
const acquisition = (id, file, sources, note) => artifact(id, 'acquisition', BASE + 'acquisition/' + file, sources, note);
acquisition('national-source-discovery', 'd2-discovery.json', national.slice(0, 3), 'Dated initial public STAC discovery. Its historical missing-credentials state is superseded by the actual acquisition receipts; retained unchanged for provenance.');
acquisition('national-source-recovery', 'source-recovery.json', national, 'Verified GitHub acquisition ZIP digests and individual recovered raster hashes; orthophoto reacquired through existing authorized provider access.');
acquisition('national-provider-access-review', 'provider-access-review.json', national, 'Retained exact product and terms documents, hashes, resolved URLs and access outcomes; source-specific rights scope remains explicit.');
acquisition('native-terrain-acquisition', 'terrain-window.json', ['terrain-lm-1m'], 'Native 4097 x 4097 1 m Float32 window: all finite, exact source pixels, independent bounded-output SHA and transfer evidence.');
acquisition('orthophoto-review-acquisition', 'orthophoto-review.json', ['imagery-lm-ortho'], 'Four May 2026 COG identities and two privately retained 0.32 m RGB review mosaics; output hashes are not full-source hashes.');
acquisition('orthophoto-native-crops', 'orthophoto-native-crops.json', ['imagery-lm-ortho'], 'Private native 0.16 m tee/green crops with exact source windows, transforms and byte identities.');
acquisition('orthophoto-supplement-crops', 'orthophoto-supplement-crops.json', ['imagery-lm-ortho'], 'Private supplementary native-resolution crops for changed tee and other specific review locations.');
acquisition('source-water-acquisition', 'water-evidence.json', ['water-breaks-lm-1m'], 'Complete provider GeoPackage SHA verified, then independently hashed course-window clip retaining source RH 2000 surface heights.');
artifact('source-water-clip', 'topography', BASE + 'acquisition/water-epsg3006.geojson', ['water-breaks-lm-1m'], 'Source-clipped 3D geometry before runtime area/holes interpretation.');
acquisition('osm-context-acquisition', 'osm-context.json', ['tortuna-osm-2026-09-09'], 'Exact original OSM XML digest, projected output digest, PROJ version and omitted incomplete source relation inventory.');
acquisition('osm-environment-expansion-acquisition', 'osm-context-extra.json', [extraOsmId], 'Separate wider acquisition with retained raw source digest and original-ID exclusion; original intake remains unchanged.');
artifact('osm-environment-expansion-projected', 'topography', 'tortunabuild/mapping/environment-context-extra.geojson', [extraOsmId, 'tortuna-osm-2026-09-09'], 'Additional mapped surroundings in EPSG:3006; original IDs excluded and holes retained. Buildings truncated by the terrain edge are withheld.');
artifact('osm-environment-expansion-review', 'control', 'tortunabuild/mapping/environment-context-extra-review.json', [extraOsmId, 'tortuna-osm-2026-09-09'], 'Supplementary projection, duplicate-ID, geometry and omission checks; not independent survey approval.');
artifact('osm-context-projected', 'topography', BASE + 'reference/osm-context-epsg3006.geojson', ['tortuna-osm-2026-09-09'], 'Projected supplementary source infrastructure; no invented closed paths or golf surfaces.');
artifact('reference-asset-ledger', 'acquisition', 'tortunabuild/reference/source-assets.json', refs, 'Exact private original media/page byte identities and retrieval provenance; does not grant redistribution.');
artifact('reference-source-validation', 'control', 'tortunabuild/reference/reference-validation.json', refs, 'All retained original assets rehashed and images decoded; numeric card totals/indexes and coordinate AOI checked.');
artifact('club-current-scorecard', 'routing', 'tortunabuild/reference/scorecard.json', ['club-scorecard', 'tortuna-club-reference'], 'Current adopted card, source linkage and explicit conflicts; does not locate tee markers.');
artifact('golftraxx-routing-reference', 'routing', 'tortunabuild/reference/routing-golftraxx.json', ['tortuna-golftraxx-reference'], 'All 18 historical WGS84 tee, landing, green front/centre/back reference points with explicit status; current hole-9 tee replaced separately.');
artifact('clubhouse-appearance-review', 'control', 'tortunabuild/reference/clubhouse-review.json', ['tortuna-club-reference', 'imagery-lm-ortho', 'tortuna-osm-2026-09-09'], 'Source photos establish appearance and hole-9 relationship; dimensions/footprint need their separate observed evidence.');
artifact('front-nine-observed-surfaces', 'surface', 'tortunabuild/mapping/surfaces-front9.geojson', ['imagery-lm-ortho'], 'Nine greens and visible tees/bunkers digitized from May 2026 imagery; original crop bounds/pixels/hashes and shadow interpretation retained.');
artifact('front-nine-source-pixel-traces', 'surface', 'tortunabuild/mapping/traces-front9.json', ['imagery-lm-ortho'], 'Exact source-pixel authoring coordinates; no generated green circles, tee dimensions or hidden physical survey claims.');
artifact('front-nine-independent-review', 'control', 'tortunabuild/mapping/front9-independent-review.json', ['imagery-lm-ortho'], 'Separate agent checked the exact source hash against all nine green and tee crops; no gross misidentification found, shadows and incomplete tee census remain explicit. Not human acceptance.');
artifact('front-nine-fairway-candidates', 'surface', 'tortunabuild/mapping/surfaces-front9-fairways.geojson', ['imagery-lm-ortho'], 'Observed maintained fairway/approach candidates; spring cut-transition and obscured-edge uncertainty retained.');
artifact('back-nine-observed-surfaces', 'surface', 'tortunabuild/mapping/surfaces-back9.geojson', ['imagery-lm-ortho'], 'Nine greens, 11 observed tee platforms, nine fairway/approach strips and 23 bunkers. H11/H16 shadow closures explicit, H12/H15 tees unresolved in this trace set.');
artifact('back-nine-visual-review', 'control', 'tortunabuild/mapping/back9-review.json', ['imagery-lm-ortho', 'tortuna-golftraxx-reference'], 'Independent polygon validity and source-green reference containment audit, with agent overlay review; not human acceptance.');
for (const half of ['front9', 'back9']) {
  artifact(`${half}-surface-refinements`, 'surface', `tortunabuild/mapping/improvements-${half}.geojson`, ['imagery-lm-ortho'], 'Reviewed source-pixel replacements and additions with explicit replaced IDs. Original traces remain retained; unobserved platforms and tee colours remain unresolved.');
  artifact(`${half}-surface-refinement-review`, 'control', `tortunabuild/mapping/improvements-${half}-review.json`, ['imagery-lm-ortho', 'tortuna-golftraxx-reference'], 'Exact source hashes, replacement/removal decisions, overlay review and unresolved areas. Machine review, not human acceptance or independent survey.');
}
artifact('environment-source-observations', 'control', 'tortunabuild/mapping/environment-observations.json', ['imagery-lm-ortho'], 'Explicit pixel-grid path/ground-cover interpretations. Widths/materials are interpreted; ground cover does not authorize removal of measured canopy.');
artifact('environment-source-geometry', 'topography', 'tortunabuild/mapping/environment.geojson', ['imagery-lm-ortho', 'tortuna-osm-2026-09-09', extraOsmId], 'Mapped fields, routes, open-watercourse centrelines, railway and explicit power supports clipped to native terrain. Polygon holes retained by exact partition; no generated bridge elevations or inferred masts.');
artifact('environment-source-review', 'control', 'tortunabuild/mapping/environment-review.json', ['imagery-lm-ortho', 'tortuna-osm-2026-09-09', extraOsmId], 'Source byte identities, counts, omitted covered/deck routes and polygon topology checks. Watercourse widths are context bands, not observed channel banks.');
artifact('building-laser-acquisition', 'acquisition', 'tortunabuild/mapping/building-laser-acquisition.json', ['laser-lm-skog'], 'Count-checked bounded COPC window for building observations; retained point-output identity is distinct from provider whole-source identity.');
artifact('building-ortho-acquisition', 'acquisition', 'tortunabuild/mapping/building-orthophoto-acquisition.json', ['imagery-lm-ortho'], 'Native imagery windows for roof interpretation; original rasters stay private.');
artifact('building-roof-observations', 'control', 'tortunabuild/mapping/building-observations.json', ['imagery-lm-ortho', 'tortuna-osm-2026-09-09'], 'Observed roof envelopes and component identities kept separate from OSM ground footprints. Roof and facade material observations do not establish dimensions.');
artifact('building-height-evidence', 'control', 'tortunabuild/mapping/building-height-evidence.json', ['imagery-lm-ortho', 'laser-lm-skog', 'terrain-lm-1m'], 'Dated plane support, coverage, height checks and withheld components for measured roof candidates. Unsupported geometry is not filled.');
artifact('building-measured-roofs', 'topography', 'tortunabuild/mapping/building-roof-meshes.json', ['imagery-lm-ortho', 'laser-lm-skog', 'terrain-lm-1m'], 'Absolute RH2000 roof TINs and supported perimeter walls from April 2021 laser with May 2026 envelope review. Not a current architectural survey; ground footprints remain separate source hypotheses.');
artifact('building-roof-exclusions', 'topography', 'tortunabuild/mapping/building-roof-envelopes.geojson', ['imagery-lm-ortho', 'laser-lm-skog'], 'Supported observed roof envelopes for canopy exclusion. Distinct from, and not replacements for, ground footprints.');
artifact('building-roof-review', 'control', 'tortunabuild/mapping/building-roof-review.json', ['imagery-lm-ortho', 'laser-lm-skog', 'terrain-lm-1m'], 'Per-building supported triangles, coverage, source datum and withheld components; no inferred low terraces or small roofs.');
artifact('hole-nine-current-tee', 'surface', BASE + 'mapping/hole-09-tee-review.geojson', ['imagery-lm-ortho', 'club-scorecard'], 'Current short hole-9 tee from national imagery, replacing the old par-4 source reference; coloured markers remain provisional.');
artifact('playing-surface-candidates', 'surface', 'tortunabuild/mapping/playing-surfaces.geojson', ['imagery-lm-ortho'], 'Single assembled candidate surface inventory; per-feature IDs, measured source traces and uncertainties retained.');
artifact('playing-surface-assembly-review', 'control', 'tortunabuild/mapping/assembly-review.json', lineage, 'Assembly counts, observed endpoint selection and omitted/uncertain source fields; not independent ground survey.');
artifact('facility-surface-candidates', 'surface', 'tortunabuild/mapping/facilities.geojson', ['imagery-lm-ortho', 'tortuna-osm-2026-09-09'], 'Observed facilities/practice surfaces and footprint reconciliation, preserving source IDs and unresolved dimensions.');
artifact('facility-source-review', 'control', 'tortunabuild/mapping/facilities-review.json', ['imagery-lm-ortho', 'tortuna-osm-2026-09-09', 'tortuna-club-reference'], 'Per-feature appearance/source comparison and provisional object-size limitations.');
artifact('runtime-water-source-geometry', 'topography', BASE + 'mapping/water-runtime-epsg3006.geojson', ['water-breaks-lm-1m'], 'Topology-reviewed source-derived water polygons for compatibility publication; no bathymetry or invented shoreline.');
artifact('runtime-water-source-validation', 'control', BASE + 'mapping/water-runtime-validation.json', ['water-breaks-lm-1m'], 'Pre-publication source geometry area/holes comparison; independent of graph hash.');
artifact('canopy-raster-acquisition', 'canopy', BASE + 'vegetation/canopy-evidence.json', ['laser-lm-skog'], 'Count-checked bounded April 2021 COPC measurements and four checksummed retained field rasters with explicit voids.');
artifact('canopy-expansion-acquisition', 'canopy', BASE + 'vegetation/expanded-canopy-evidence.json', ['laser-lm-skog'], `Measured surroundings expanded to ${expandedCanopy.grid.width} x ${expandedCanopy.grid.height} one-metre cells. The original 60 tiles remain exact bytes inside a separately acquired 120-tile field; missing returns remain unknown.`);
artifact('canopy-expansion-review', 'control', BASE + 'vegetation/expanded-canopy-review.json', ['laser-lm-skog', 'terrain-lm-1m'], 'Independent recomputation of four overlap byte hashes, native tile coverage, source counts, voids and unchanged native terrain identity. Machine validation, not independent positional controls.');
artifact('canopy-stand-compilation', 'canopy', BASE + 'vegetation/stand-evidence.json', ['laser-lm-skog', 'terrain-lm-1m', 'imagery-lm-ortho', 'water-breaks-lm-1m', 'tortuna-osm-2026-09-09', extraOsmId], 'Measured 4 m stand fields and current observed semantic exclusions; representative render positions are not surveyed individual stems/species.');
artifact('canopy-orthophoto-crown-review', 'control', BASE + 'vegetation/ortho-crown-review.json', ['laser-lm-skog', 'imagery-lm-ortho'], 'Every 2021 laser crown maximum read against the 2026-05-02 national orthophoto: present, absent or unclear, with distinct crowns that promote a maximum and absent crowns that leave the stand field. An imagery check of the laser record, not a stem survey.');
artifact('canopy-object-compilation', 'canopy', BASE + 'vegetation/objects-evidence.json', ['laser-lm-skog', 'terrain-lm-1m', 'imagery-lm-ortho', 'water-breaks-lm-1m', 'tortuna-osm-2026-09-09', extraOsmId], 'Machine-reviewed individual crown records from the 2021 laser canopy, kept only where the 2026 orthophoto does not refuse them, published as object tiles beside recompiled window stand fields. Heights and positions are the laser\'s; species is not measured.');
artifact('projected-course-input', 'composite', 'tortunabuild/mapping/course-input.json', lineage, 'Exact EPSG:3006 assembled source geometry with input byte hashes and provenance; no tee/card-length geometry fabrication.');
artifact('legacy-course-model', 'composite', 'tortunabuild/course-model.json', lineage, 'Canonical migration input: exact projected local-metre compatibility model with RH 2000 heights sampled from native national DTM. Coloured tee starts and flags are provisional UI references. Independent survey and human review gates remain open.', 'migration-only');
artifact('compatibility-scorecard', 'routing', 'tortunabuild/card.json', ['club-scorecard', 'tortuna-club-reference'], 'Compatibility card from the adopted current 18-hole par-71 source facts.', 'migration-only');
artifact('compatibility-heightfields', 'terrain', 'tortunabuild/heightfields.json', ['terrain-lm-1m'], '4 m and 16 m compatibility levels sample the retained native 1 m source; no terrain deformation or interpolated source substitution.', 'migration-only');
artifact('migration-course-model-epsg3006', 'composite', BASE + 'migration/course-model.epsg3006.json', lineage, 'Exact local-to-EPSG:3006 coordinate translation; source RH 2000 heights retained without a geographic approximation.', 'migration-only');

function blocker(id, description, exitGate, severity = 'release-blocking') {
  const entry = { id, severity, description, exitGate };
  const at = m.blockers.findIndex(b => b.id === id);
  if (at < 0) m.blockers.push(entry); else m.blockers[at] = entry;
}
blocker('current-routing-review', 'The current card is resolved as par 71 and hole 9 as the short par 3. Current coloured tee locations and the complete physical tee census remain unverified; displaced/occluded reference starts remain provisional.', 'Review observed routing and every current tee/green association with club or independent controls; retain current short hole 9.');
blocker('surface-intake-pending', 'All 18 greens and additional played/facility surfaces are observed candidates from May 2026 national imagery. Shadows, rough transitions, omitted tees and human acceptance remain unresolved.', 'Complete per-hole human imagery review and explicit source/accuracy/rights gates before authoritative surface publication.');
blocker('media-rights-review', 'Original club/Caddee/GolfTraxx media remains private reference evidence. National provider terms and attribution are retained; private imagery is measurement input. No implicit production reuse grant is inferred for historical third-party reference geometry.', 'Retain source-specific terms, attribution and derivative decisions separately from runtime availability.', 'quality');
blocker('vegetation-current-review', 'April 2021 laser canopy is measured area evidence with explicit voids. May 2026 semantic exclusions remove mapped playing/facility areas but do not prove current tree identity, botanical species, clearing completeness or individual stem positions.', 'Review current canopy change and significant objects against current imagery/controls; keep representative stands distinct from surveyed individuals.', 'quality');

const errors = validateSourceManifest(m, { catalog: read('geo_data/course-v2/source-catalog.json'), repoRoot: ROOT, label: 'Tortuna source ledger' });
if (errors.length) throw new Error(errors.join('\n'));
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
console.log(`Tortuna ledger: ${m.sources.length} sources, ${m.artifacts.length} artifacts, ${m.blockers.length} unresolved gates`);
