/* Individual crowns for Tortuna from the pinned 2021 laser canopy: the object
 * layer this ground never had. The published ground carried stand fields
 * only (compile-stands.mjs), so every tree on the course was a representative
 * placement inside a 4 m canopy cell; this compiles the crowns themselves
 * with the repo's own detector (crown-detect.mjs: height-adaptive local
 * maxima, Dalponte growth on the smoothed model, heights from the unsmoothed
 * one) and the same exclusions the stand compiler applies -- the 2026
 * playing surfaces, the dated roof envelopes, the facilities, the national
 * water and the 2026 clear-fells -- so nothing is approved on a green, a
 * roof or ground the newer picture shows felled.
 *
 * Two passes, by design:
 *   --machine-review   the versioned rules approve; writes the candidates and
 *                      a provisional registry for the 2026 orthophoto check
 *   --approvals FILE   the keys the orthophoto check kept; the registry that
 *                      is published
 *
 *     node geo_data/course-v2/tortuna/vegetation/compile-objects.mjs --machine-review
 *     node geo_data/course-v2/tortuna/vegetation/compile-objects.mjs --approvals tortunabuild/cache/vegetation/ortho-approvals.json
 *
 * Needs tortunabuild/cache/canopy/ (the pinned 60-tile canopy window; the CI
 * artifact of the tortuna-canopy-water workflow, or the owner's sibling
 * checkout). The campaign inventory is derived from the pinned canopy
 * evidence rather than written down a second time.
 *
 * The stand fields this compile also writes cover the same 60 tiles, with the
 * cells of every approved crown taken out, so a tree is never planted twice.
 * The 60 expanded-window stand tiles beyond them (compile-stands.mjs, whose
 * rasters are not in this checkout) are CARRIED over from the ground that
 * published them: the publisher replaces every vegetation layer it is not
 * handed, so the stage must hand it those too, byte for byte. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compileVegetation, writeCompilation, readActivePublishedGround, loadGroundGeometry, MACHINE_REVIEW_RULES } from '../../../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { assertTortunaCanopyEvidence, sourceRaster, tortunaExclusionFeatures } from './compile-stands.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const OBJECTS_STAGE = 'tortunabuild/cache/vegetation/objects-stage';
/* the ground manifest compile-stands.mjs published its 120 stand tiles into
   (the committed course manifest of 2026-09-10 resolves it); superseded
   manifests stay on disk content-addressed, which is what makes this a
   stable handle */
export const STAND_SOURCE_GROUND = 'grounds/tortuna/ground-v2-f5a56cb0082030572f10df6ba8bf8dafbcd0227b509c667541e9f8e7999e837a.json';
export const STAND_SOURCE_TILES = 120;
const json = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
/* the same inventory compile-stands.mjs applies, so the two layers agree on what is not a tree */
export const EXCLUSION_INPUTS = ['tortunabuild/mapping/playing-surfaces.geojson', 'tortunabuild/mapping/facilities.geojson',
  'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson', 'geo_data/course-v2/tortuna/mapping/water-runtime-epsg3006.geojson',
  'tortunabuild/mapping/environment.geojson', 'tortunabuild/mapping/building-roof-envelopes.geojson',
  'tortunabuild/mapping/environment-context-extra.geojson', 'tortunabuild/mapping/canopy-changes-2026.geojson'];

/** The pinned campaign inventory, read off the canopy evidence the rasters were built from. */
export function tortunaCampaigns(evidence) {
  const s = evidence.source;
  return {
    groundId: 'tortuna',
    terms: { attribution: 'Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0' },
    activeItemIds: [s.id], supersededItemIds: [], seams: [],
    items: [{ id: s.id, collection: s.collection, projBbox: s.projBbox, capturedAt: s.capturedAt,
      captureStart: s.captureStart, captureEnd: s.captureEnd, role: 'active',
      declaredPointDensityPerSquareMetre: s.pointDensityPerSquareMetre }],
  };
}

/** Lidingö-format exclusion records in the rasteriser's own shape. */
export function rasteriserFeatures(records) {
  return records.flatMap(record => {
    const out = [];
    const rings = record.polygons.map(polygon => polygon[0]).filter(ring => ring && ring.length >= 3);
    if (rings.length) out.push({ kind: record.kind, rings });
    const lines = (record.lines || []).filter(line => line && line.length >= 2);
    if (lines.length) out.push({ kind: record.kind, lines });
    return out;
  });
}

export const ORTHO_REVIEW = 'geo_data/course-v2/tortuna/vegetation/ortho-crown-review.json';

/** A crown the 2026 imagery shows as open ground, outside the traced
    clear-fells, becomes an override exclusion of its own radius: the stand
    field then plants nothing there either. Only in the approvals pass -- the
    review is read off the machine-review pass's own candidates. */
export function orthoAbsentOverrides(review) {
  const ring = (e, n, r) => Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2; return [e + Math.cos(a) * r, n + Math.sin(a) * r];
  });
  return { kind: 'override', rings: (review.absent?.keys || []).map(k => ring(k.easting, k.northing, Math.max(2, k.radiusMetres + 1))) };
}

export async function compileTortunaObjects({ approvals = null, machineReview = false, observedOn = '2026-09-10', outDir = OBJECTS_STAGE } = {}) {
  const evidence = json('geo_data/course-v2/tortuna/vegetation/canopy-evidence.json');
  assertTortunaCanopyEvidence(evidence);
  const raster = sourceRaster(evidence.files.chm);
  const campaigns = tortunaCampaigns(evidence);
  const dataDir = path.join(ROOT, 'geo_data/course-v2/tortuna');
  const geometry = loadGroundGeometry(dataDir, 'tortuna');
  const publicDir = path.join(ROOT, 'apps/golf/public');
  const { ground } = readActivePublishedGround(publicDir, 'tortuna');
  const readAsset = async url => fs.readFileSync(path.join(publicDir, url));
  const extraExclusionFeatures = rasteriserFeatures(tortunaExclusionFeatures(EXCLUSION_INPUTS.map(json)));
  if (approvals) {
    const overrides = orthoAbsentOverrides(json(ORTHO_REVIEW));
    if (overrides.rings.length) extraExclusionFeatures.push(overrides);
  }
  const result = await compileVegetation({
    groundId: 'tortuna', observedOn, campaigns, geometry, ground, readAsset,
    rasters: [{ campaignId: evidence.source.id, raster }],
    machineReview: machineReview ? MACHINE_REVIEW_RULES : null,
    approvals,
    extraExclusionFeatures,
  });
  const out = path.join(ROOT, outDir);
  fs.rmSync(out, { recursive: true, force: true });
  writeCompilation(out, result);
  const carried = carryExpandedStands(out, publicDir);
  if (approvals) writeObjectsEvidence(out, result, carried);
  return { ...result, carriedStands: carried };
}

export const OBJECTS_EVIDENCE = 'geo_data/course-v2/tortuna/vegetation/objects-evidence.json';

/** The committed record of the approvals pass: what was compiled from what,
    what the imagery check said, and the exact layer references published. */
export function writeObjectsEvidence(stageDir, result, carried) {
  const sha256 = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const review = json(ORTHO_REVIEW);
  const registry = result.records;
  const layers = JSON.parse(fs.readFileSync(path.join(stageDir, 'layers.json'), 'utf8'));
  const standLayers = JSON.parse(fs.readFileSync(path.join(stageDir, 'stand-layers.json'), 'utf8'));
  const byZone = {}; for (const r of registry) byZone[r.truthZone] = (byZone[r.truthZone] || 0) + 1;
  const q = (v, p) => { const s = Float64Array.from(v).sort(); return s[Math.floor(p * (s.length - 1))]; };
  const dist = key => ({ p10: q(registry.map(r => r[key]), .1), p50: q(registry.map(r => r[key]), .5), p90: q(registry.map(r => r[key]), .9) });
  const out = {
    schemaVersion: 1, groundId: 'tortuna', state: 'machine-reviewed-individuals-with-orthophoto-check', observedOn: result.evidence.observedOn,
    compiler: 'geo_data/course-v2/tortuna/vegetation/compile-objects.mjs (packages/course-v2/vegetation/compile-vegetation.mjs, crown-detect.mjs)',
    campaignId: '21c035-661_59', sourceCapture: '2021-04-05T12:00:00Z',
    inputs: ['geo_data/course-v2/tortuna/vegetation/canopy-evidence.json', 'tortunabuild/cache/canopy/chm.f32',
      'geo_data/course-v2/tortuna/migration/course-model.epsg3006.json', ...EXCLUSION_INPUTS, ORTHO_REVIEW]
      .map(p => ({ path: p, sha256: fs.existsSync(path.join(ROOT, p)) ? sha256(path.join(ROOT, p)) : null })),
    compile: result.evidence,
    orthophotoCheck: { review: ORTHO_REVIEW, counts: review.counts, byZone: review.byZone, refused: review.refused.count, promoted: review.promoted.count, absentTakenOutOfStands: review.absent.count },
    records: { count: registry.length, tiles: Object.keys(layers).length, byZone, heightMetres: dist('objectHeightMetres'), radiusMetres: dist('radiusMetres') },
    stands: { tiles: Object.keys(standLayers).length, recompiledTiles: Object.keys(standLayers).length - carried.tiles, carriedTiles: carried.tiles, carriedFrom: carried.from,
      note: 'the canopy-window tiles are recompiled with every record\'s crown cells and every imagery-absent crown taken out; the expanded-window tiles beyond them are compile-stands.mjs\'s fields, carried byte for byte' },
    layers: { objects: layers, stands: standLayers },
    limitations: ['Positions and heights are the April 2021 laser\'s; the May 2026 orthophoto confirms a crown stood there in 2026 and removes those it does not, but adds no height of its own.',
      'A crown inside closed canopy that neither record can separate from its neighbours stays in the stand field, planted as a representative and not as a stem.',
      'Trees the leaf-off laser never measured and only the imagery shows are not records; the census in ortho-crown-review.json says why.'],
  };
  fs.writeFileSync(path.join(ROOT, OBJECTS_EVIDENCE), JSON.stringify(out, null, 2) + '\n');
}

/** The expanded-window stand tiles this compile does not cover, from the
    ground that published them, into the stage the publisher reads. */
export function carryExpandedStands(stageDir, publicDir) {
  const source = JSON.parse(fs.readFileSync(path.join(publicDir, STAND_SOURCE_GROUND), 'utf8'));
  if (source.groundId !== 'tortuna') throw new Error('stand source ground is not tortuna');
  const sourceStands = source.tiles.filter(tile => tile.layers?.stands);
  if (sourceStands.length !== STAND_SOURCE_TILES) throw new Error(`stand source ground carries ${sourceStands.length} stand tiles, not ${STAND_SOURCE_TILES}`);
  const file = path.join(stageDir, 'stand-layers.json');
  const layers = JSON.parse(fs.readFileSync(file, 'utf8'));
  const carried = [];
  for (const tile of sourceStands) {
    if (layers[tile.id]) continue;                       /* recompiled here, crowns taken out */
    const bytes = fs.readFileSync(path.join(publicDir, tile.layers.stands.url));
    fs.writeFileSync(path.join(stageDir, 'stands', `${tile.layers.stands.sha256}.bvch`), bytes);
    layers[tile.id] = tile.layers.stands;
    carried.push(tile.id);
  }
  fs.writeFileSync(file, JSON.stringify(layers, null, 2) + '\n');
  return { tiles: carried.length, from: STAND_SOURCE_GROUND, total: Object.keys(layers).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
  const approvalsPath = flag('approvals');
  const machineReview = args.includes('--machine-review');
  if (!approvalsPath && !machineReview) { console.error('usage: compile-objects.mjs --machine-review | --approvals FILE [--out DIR]'); process.exit(2); }
  const result = await compileTortunaObjects({
    machineReview,
    approvals: approvalsPath ? JSON.parse(fs.readFileSync(path.resolve(ROOT, approvalsPath), 'utf8')) : null,
    outDir: flag('out', OBJECTS_STAGE),
  });
  const e = result.evidence;
  console.log(JSON.stringify({ candidates: e.candidates, records: e.records, stands: e.stands, carriedStands: result.carriedStands, machineReview: e.machineReview, campaigns: e.campaigns?.map?.(c => ({ id: c.campaignId, crowns: c.crowns, individuals: c.individuals, excluded: c.excludedCandidates, exclusions: c.exclusions?.cellsByKind })) }, null, 1));
}
