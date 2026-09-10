import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { centroid, decodeHF, pointInPoly, polyLen } from '../geobuild/lib.mjs';
import { holeNotes, teeMarks, vistaLandcover } from './build-course.mjs';
import { runtimeWater } from '../packages/course-pack/runtime-water.mjs';
import { assertVisbyCanonicalRouting, visbyRuntimeContract } from '../packages/course-v2/compile-visby-ground-graph.mjs';
import { VISBY_V2_CONFIG } from '../apps/golf/src/engine/v2-visby-config.mjs';
import { assertV2LegacyCutoutContract } from '../apps/golf/src/engine/v2-legacy-cutout.mjs';
import { loadPublishedGraphTerrainFrontier } from '../apps/golf/src/engine/v2-graph-frontier.mjs';
import { local } from './frame.mjs';
import { applyReviewedFacilities, facilityPoint } from './mapping/reviewed-facilities.mjs';
import { applyReviewedTeePlatforms } from './mapping/reviewed-tee-platforms.mjs';
import { applyReviewedEnvironment } from './mapping/reviewed-environment.mjs';
import { applyReviewedOrthophoto } from './mapping/reviewed-orthophoto.mjs';
import { applyReviewedTeeAlignment } from './mapping/reviewed-tee-alignment.mjs';

const bytes = relative => readFileSync(new URL(relative, import.meta.url));
const json = relative => JSON.parse(bytes(relative));
const applyCurrentReviews = geometry => applyReviewedTeeAlignment(applyReviewedOrthophoto(
  applyReviewedEnvironment(applyReviewedTeePlatforms(applyReviewedFacilities(geometry,
    json('./mapping/facilities-review.json')), json('./mapping/tee-platform-review.json')),
  json('./mapping/environment-surfaces-review.json')), json('./mapping/orthophoto-review-2026.json')));

test('expanded tee inventory survives regeneration and keeps reviewed cameras on real turf', () => {
  const geometry = json('./mapping/geometry.json'), model = json('./course-model.json');
  const review = json('./mapping/tee-platform-review.json');
  assert.equal(Object.keys(review.sources).length, 18);
  assert.deepEqual(applyCurrentReviews(geometry), geometry);
  const unreviewed = structuredClone(geometry);
  for (const entry of review.holes) {
    const hole = unreviewed.holes[entry.n - 1];
    for (const tee of Object.keys(entry.cameraReferencesPixels)) delete hole.tees.references[tee];
  }
  assert.deepEqual(applyCurrentReviews(unreviewed), geometry, 'ordered source overlays reconstruct the current accepted references');
  assert.equal(model.holes.reduce((n, hole) => n + hole.tees.pads.length, 0),
    geometry.holes.reduce((n, hole) => n + hole.tees.pads.length, 0));
  for (const entry of review.holes) {
    const hole = model.holes[entry.n - 1], source = review.sources[entry.sourceKey];
    for (const pad of entry.additionalPads) {
      const expected = pad.ringPixels.map(p => local(facilityPoint({ source }, p)));
      assert.ok(hole.tees.pads.some(p => JSON.stringify(p.ring) === JSON.stringify(expected)));
    }
    for (const move of entry.cameraMoves) {
      const index = [63, 59, 55, 51, 46, 41].indexOf(move.tee), mark = hole.tees.marks[index];
      // Historical move limits validate that historical decision. A later
      // source review can identify a different numbered platform.
      const historicalPoint = local(facilityPoint({ source }, entry.cameraReferencesPixels[`tee-${move.tee}`]));
      const distance = Math.hypot(historicalPoint[0] - move.fromLocal[0], historicalPoint[1] - move.fromLocal[1]);
      if (move.assignment === 'caddee-platform-identity') {
        assert.ok(entry.numberedPlatformReview, 'a larger move requires independent numbered-platform evidence');
      } else assert.ok(distance <= review.method.maxCameraMoveMetres + 1e-6);
      assert.ok(Math.abs(distance - move.distanceMetres) < 0.001);
      assert.ok(hole.tees.pads.some(p => pointInPoly(...historicalPoint, p.ring)));
      assert.ok(mark.placement.includes('daily marker location unverified'));
    }
  }
});

test('numbered tee references use the plan-identified platform, not just any nearby tee turf', () => {
  const geometry = json('./mapping/geometry.json'), model = json('./course-model.json');
  const facility = json('./mapping/facilities-review.json');
  const platforms = json('./mapping/tee-platform-review.json');
  const resources = json('./reference/club-resources.json');
  for (const [n, review] of [[1, facility.hole1.numberedPlatformReview], [9, platforms.holes.find(h => h.n === 9).numberedPlatformReview]]) {
    const asset = resources.downloads.find(a => a.id === review.sourceAssetId);
    assert.equal(asset.holeNumber, n);
    assert.equal(asset.sha256, review.sourceSha256);
    assert.equal(asset.resolvedUrl, review.sourceUrl);
    const hole = model.holes[n - 1];
    for (const [i, tee] of ['tee-63', 'tee-59', 'tee-55', 'tee-51', 'tee-46', 'tee-41'].entries()) {
      const ring = hole.tees.pads[review.padIndicesByTee[tee]].ring;
      assert.ok(pointInPoly(...hole.tees.marks[i].c, ring), `hole ${n} ${tee} must be on its associated platform`);
    }
  }
  const wrong = structuredClone(facility);
  wrong.hole1.cameraReferencesPixels['tee-59'] = [256, 573]; // Previously accepted: inside the middle tee, but 59 belongs on the rear one.
  assert.throws(() => applyReviewedFacilities(geometry, wrong), /outside its numbered platform/);
});

test('tee review rejects bad source grids, duplicate holes and cameras off platforms', () => {
  const geometry = json('./mapping/geometry.json'), original = json('./mapping/tee-platform-review.json');
  let review = structuredClone(original);
  review.sources[review.holes[0].sourceKey].imageSize[0] = 0;
  assert.throws(() => applyReviewedTeePlatforms(geometry, review), /image coordinates/);
  review = structuredClone(original); review.holes.push(review.holes[0]);
  assert.throws(() => applyReviewedTeePlatforms(geometry, review), /unique hole/);
  review = structuredClone(original); review.holes[0].cameraReferencesPixels['tee-59'] = [0, 0];
  assert.throws(() => applyReviewedTeePlatforms(geometry, review), /inside an observed/);
  review = structuredClone(original); review.holes[0].cameraReferencesPixels['tee-63'] = [300, 500];
  assert.throws(() => applyReviewedTeePlatforms(geometry, review), /retain back references/);
});

test('range-side greens retain source outlines and regenerate without duplication', () => {
  const geometry = json('./mapping/geometry.json'), model = json('./course-model.json');
  const review = json('./mapping/environment-surfaces-review.json');
  assert.deepEqual(applyReviewedEnvironment(geometry, review), geometry);
  assert.equal(model.scenery.greens.length, 3);
  for (const entry of review.greens) {
    const slot = geometry.scenery.reviewedEnvironmentGreenIndices[entry.id];
    assert.deepEqual(model.scenery.greens[slot], entry.ringPixels.map(p => local(facilityPoint(review, p))));
  }
  const bad = structuredClone(geometry);
  bad.scenery.reviewedEnvironmentGreenIndices[review.greens[0].id] = 999;
  assert.throws(() => applyReviewedEnvironment(bad, review), /index is stale/);
});

test('reviewed clubhouse practice green and first-hole cameras retain image registration and observed platforms', () => {
  const geometry = json('./mapping/geometry.json'), model = json('./course-model.json');
  const review = json('./mapping/facilities-review.json');
  assert.deepEqual(applyCurrentReviews(geometry), geometry, 'ordered review adoption is idempotent');
  assert.deepEqual(facilityPoint(review, [0, 0]), [687105.5, 6370936.5]);
  assert.deepEqual(facilityPoint(review, [880, 880]), [687325.5, 6370716.5]);
  assert.deepEqual(model.scenery.greens, geometry.scenery.greens.map(ring => ring.map(local)));
  assert.deepEqual(model.scenery.greens[geometry.scenery.reviewedPracticeGreenIndex], review.practiceGreen.ringPixels.map(pixel => local(facilityPoint(review, pixel))));
  const hole = model.holes[0];
  assert.equal(hole.tees.pads.length, 3);
  assert.ok(hole.tees.marks.every(mark => hole.tees.pads.some(pad => pointInPoly(...mark.c, pad.ring))), 'all first-hole camera starts are on observed platforms');
  assert.ok(hole.tees.marks.slice(1).every(mark => mark.placement.includes('daily marker location unverified')));
  const withoutReview = structuredClone(geometry);
  withoutReview.holes[0].tees.pads = withoutReview.holes[0].tees.pads.filter(pad => !pad.reviewId);
  withoutReview.scenery.greens = [];
  delete withoutReview.scenery.reviewedPracticeGreenIndex;
  const reapplied = applyReviewedFacilities(withoutReview, review);
  assert.deepEqual(reapplied.holes.slice(1), geometry.holes.slice(1), 'no other hole changes during adoption');
  assert.deepEqual(applyCurrentReviews({ ...reapplied, scenery: structuredClone(geometry.scenery) }).holes[0].tees, geometry.holes[0].tees);
});

test('Visby published compatibility pack preserves canonical observed geometry and all official card values', () => {
  const model = json('./course-model.json'), geometry = json('./mapping/geometry.json');
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  assert.equal(assertVisbyCanonicalRouting(geometry, model, pack).length, 18);
  const card = json('./reference/club-scorecard.json');
  assert.deepEqual(model.holes.map(hole => [hole.par, hole.idx, hole.t]), card.holes.map(hole => [hole.par, hole.index, card.tees.map(tee => hole.lengths[tee.id])]));
  for (const hole of model.holes) {
    const source = geometry.holes.find(candidate => candidate.n === hole.n);
    assert.deepEqual(hole.green.ring, source.green.ring.map(local));
    assert.deepEqual(hole.tees.pads.map(pad => pad.ring), source.tees.pads.map(pad => pad.ring.map(local)));
    assert.deepEqual(hole.fairway.rings, source.fairway.rings.map(ring => ring.map(local)));
    assert.equal(hole.tees.inferPads, false);
    assert.ok(hole.tees.pads.every(pad => pad.preserveTerrain));
    if (hole.tees.status === 'unresolved-physical-platform') {
      assert.equal(hole.n, 12);
      assert.deepEqual(hole.tees.pads, []);
      assert.deepEqual(hole.tees.sourceIds, source.tees.sourceIds);
      assert.ok(hole.tees.marks.every(mark => hole.fairway.rings.some(ring => pointInPoly(...mark.c, ring))));
    } else {
      assert.ok(hole.tees.pads.length > 0);
      for (const [i, tee] of card.tees.entries()) {
        const review = source.tees.referenceReview[tee.id];
        assert.ok(['source-corroborated', 'retained-unresolved'].includes(review?.status));
        assert.ok(source.tees.references[tee.id], 'every resolved-platform hole has an explicit navigation reference');
        assert.ok(!hole.tees.marks[i].placement.startsWith('card-offset'), 'reviewed holes cannot regenerate card-offset cameras');
        if (review.status === 'source-corroborated') {
          assert.ok(hole.tees.pads.some(pad => pointInPoly(...hole.tees.marks[i].c, pad.ring)));
          assert.match(hole.tees.marks[i].placement, /source-corroborated/);
        } else {
          assert.ok(review.reason);
          assert.match(hole.tees.marks[i].placement, /numbered platform unresolved/);
        }
      }
    }
    /* The model and its generator must not be able to disagree. `build-course`
       cannot run in a checkout without the acquired 1 m raster it pins by
       sha256, so the marks were applied to the model by `apply-tee-marks`; this
       calls the same exported rule a third time and demands the committed model
       equals it exactly. The sea flags were once applied to the model alone,
       and a later generator run would have written them straight back. */
    const centres = hole.tees.pads.map(pad => centroid(pad.ring));
    const nearest = hole.tees.status === 'unresolved-physical-platform' ? hole.tees.marks[0].c
      : [...centres].sort((a, b) => Math.hypot(a[0] - hole.line[0][0], a[1] - hole.line[0][1])
                                  - Math.hypot(b[0] - hole.line[0][0], b[1] - hole.line[0][1]))[0];
    assert.deepEqual(hole.tees.marks, teeMarks({
      line: hole.line, lineLen: polyLen(hole.line), lengths: hole.t, nearest, pads: hole.tees.pads,
      unresolvedPlatform: hole.tees.status === 'unresolved-physical-platform',
      references: card.tees.map(tee => source.tees.references?.[tee.id] ? local(source.tees.references[tee.id]) : null),
      referenceReview: card.tees.map(tee => source.tees.referenceReview?.[tee.id] ?? null), hole: hole.n,
    }));
    assert.deepEqual(hole.tees.marks.map(mark => mark.m), hole.t);
    assert.ok(pointInPoly(...hole.pin, hole.green.ring));
  }
  /* The tee dimension exists: 108 numbered tees used to stand on 18 points, so
     `?tee=N` moved nothing and the rangefinder read one distance to the green
     for all six against the card printed beside it. */
  const teePoints = new Set(model.holes.flatMap(hole => hole.tees.marks.map(mark => mark.c.join(','))));
  const authoredTeePoints = new Set(geometry.holes.flatMap(hole => Object.values(Object.keys(hole.tees.references ?? {}).length
    ? hole.tees.references : { unresolved: hole.tees.cameraReference }).map(point => local(point).join(','))));
  assert.equal(teePoints.size, authoredTeePoints.size, 'published cameras retain the distinct source references without synthesizing locations');
  assert.equal(model.holes.filter(hole => new Set(hole.tees.marks.map(mark => mark.c.join(','))).size === 1).length, 1,
    'only hole 12, whose platform is unresolved, may still share one point across all six tees');
  /* The horizon's land cover is the committed OSM artifact and nothing else --
     re-derived through the generator's own rule, so a hand edit to either side
     fails. It is vista dressing: it reaches +-6 km, well beyond the 2,048 m
     acquired terrain, and it plants nothing on the course, which stays
     measured-only. What it is FOR is the far ring's open-land test: Gotland's
     OSM cover here is 279 farmland polygons against 24 forest, and a horizon
     that ignores that carpets a farmed island in conifers. */
  const vista = vistaLandcover(json('../geo_data/course-v2/visby/mapping/osm-vista-landcover-epsg3006.geojson'));
  assert.deepEqual(model.vegetation, vista.vegetation);
  assert.deepEqual(model.infra.landuse, vista.landuse);
  assert.equal(model.infra.landuse.filter(item => item.kind === 'farmland').length, 279);
  assert.equal(model.vegetation.forest.length + model.vegetation.wood.length, 30);
  assert.equal(model.infra.vegetationPlacement, 'measured-only');
  assert.equal(model.infra.terrainPlacement, 'measured-only');
  assert.equal(model.infra.objectPlacement, 'mapped-only');
  /* SOMEBODY HAS TO NAME THE CLUBHOUSE. The engine finds one by
     `amenity=clubhouse` or a name matching golfklubb|klubbhus, and OSM tags
     none of this property's buildings with either -- there is no
     `amenity=clubhouse` in the whole extract -- so it rendered as one of 32
     anonymous grey houses with no levelled bench, no mown apron, no clubhouse
     look and no K marker. The identification is reviewed in geometry.json
     beside its evidence, and asserted here against that file rather than
     against a coordinate written down twice. */
  assert.ok(geometry.clubhouseWayId, 'geometry.json must declare which building is the clubhouse');
  const clubhouses = model.infra.buildings.filter(building => building.amenity === 'clubhouse');
  assert.equal(clubhouses.length, 1);
  assert.equal(clubhouses[0].id, geometry.clubhouseWayId);
  assert.match(clubhouses[0].name, /klubbhus/i);
  /* Retain the historical diagram census and its disagreements. The later
     numbered-platform review reads source labels and native image geometry;
     the earlier group count cannot force camera positions to fit card lengths. */
  const plans = json('./mapping/hole-plans.json');
  assert.equal(plans.summary.holesWhereThePlanDrawsSixTees, 18);
  assert.equal(plans.summary.holesWhereTheGroupingMatchesTheCard, 16);
  assert.deepEqual(plans.summary.disagreements.map(row => row.hole), [13, 14]);
  // The old diagram-group census remains evidence. Native-image review owns
  // current reference positions; a diagram group count cannot move them.
  /* ALL EIGHTEEN HOLES SHOWED THE SAME DISCLAIMER where every other course
     shows a description of the hole -- `note` is the line a player reads under
     the hole number. There is no club-authored text to use (Caddee's per-hole
     description field is present and empty on all 18), so the hålguide is
     written from records that do exist and each hole says which in its `basis`.
     Re-derived here through the generator's own rule so the two cannot drift.
     `name` is an editorial tagline since 2026-09-10, as on every other course
     (the owner asked for parity); the file's `source` says so. */
  const guide = json('./guide-notes.json');
  const notes = holeNotes(guide);
  for (const hole of model.holes) assert.equal(hole.note, notes.get(hole.n).note);
  assert.equal(new Set(model.holes.map(hole => hole.note)).size, 18);
  for (const hole of model.holes) assert.equal(hole.name, notes.get(hole.n).name);
  assert.equal(new Set(model.holes.map(hole => hole.name)).size, 18);
  assert.equal(guide.holes.filter(hole => hole.press).length, 3, 'only holes 2, 6 and 11 have published prose');
  assert.equal(model.evidence.terrainModifiedForPlayingSurfaces, false);
  assert.equal(model.evidence.canonicalOriginApproval, 'pending-independent-control');
});

test('water render partitions preserve source topology, levels and physical shorelines without enabling a global ocean', () => {
  const model = json('./course-model.json');
  const simple = json('../geo_data/course-v2/visby/mapping/water-breakgeometry-simple-epsg3006.geojson');
  const canonical = json('../geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson');
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  const vectors = JSON.parse(inflateStream(pack.sv));
  assert.equal(model.water.length, simple.features.length);
  assert.deepEqual(vectors.water, model.water.map(runtimeWater));
  simple.features.forEach((feature, index) => {
    const water = model.water[index], parent = canonical.features.find(candidate => candidate.id === feature.properties.parentWaterId);
    assert.deepEqual(water.ring, feature.geometry.coordinates[0].map(coordinate => local(coordinate.slice(0, 2))));
    assert.deepEqual(water.shoreline.lines, parent.properties.shoreline.lines.map(line => ({ line: line.map(coordinate => local(coordinate.slice(0, 2))) })));
    assert.equal(water.level, feature.properties.heightRH2000);
    /* The model no longer disagrees with its own source about what the sea
       is. It used to write isSea:false on every ring while carrying
       sourceIsSea from the national water break geometry -- so 906.7 ha of
       Baltic across seven rings was flagged neither sea nor lake, which cost
       it the horizon plane, the 55 m shore bench, the foam and the wetness
       test, and left the vista tint painting the open sea as forest. It
       adopts the source now, and the count is asserted below so a silent
       flip in either direction fails. */
    assert.equal(water.isSea, feature.properties.isSea);
    assert.equal(water.isLake, true, 'every Visby ring takes the wide shore treatment, the sea included');
    assert.equal(water.sourceIsSea, feature.properties.isSea);
    assert.equal(water.bathymetry, null);
  });
  assert.equal(model.water.filter(water => water.isSea).length, 7, 'seven rings are the Baltic');
  assert.equal(model.water.filter(water => water.isSea).reduce((sum, water) => sum + water.area, 0) > 9e6, true,
    'and they are the water that matters: over 900 ha against 24 ha of inland ponds');
  /* Measured on Visby's own far ring by connectivity, not by height: 0.05 m
     mislabels 1.7 ha of enclosed low pocket where 0.5 m mislabels 7.5. */
  assert.equal(model.seaTintBandMetres, 0.05);
  assert.equal(canonical.features.reduce((sum, feature) => sum + feature.geometry.coordinates.length - 1, 0), 10);
});

test('compatibility terrain streams retain the declared acquired extent and static live frontier cutout', () => {
  const model = json('./course-model.json'), heights = json('./heightfields.json');
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  assert.deepEqual(pack.s0, Buffer.from(heights.hf0.b64, 'base64'));
  assert.deepEqual(pack.s1, Buffer.from(heights.hf1.b64, 'base64'));
  for (const [name, dx] of [['hf0', 4], ['hf1', 16]]) {
    const field = heights[name], values = decodeHF(field);
    assert.equal(field.dx, dx);
    assert.equal(field.x0, -2048); assert.equal(field.z0, -2048);
    assert.equal((field.nx - 1) * field.dx, 4096);
    assert.equal((field.nz - 1) * field.dx, 4096);
    assert.ok(values.every(height => Number.isFinite(height) && height >= 0.09 && height <= 11.03));
  }
  const contract = visbyRuntimeContract(model, { origin: VISBY_V2_CONFIG.canonicalOrigin }, VISBY_V2_CONFIG.expectedBoundsEpsg5845);
  assert.equal(contract.expectedTileCount, VISBY_V2_CONFIG.expectedTileCount);
  assert.deepEqual(contract.frontierBounds, VISBY_V2_CONFIG.expectedFrontierBoundsEpsg5845);
  assertV2LegacyCutoutContract({ grid: contract.core, plan: contract.cutout, contract: VISBY_V2_CONFIG.legacyCoreCutout });
});

/* The frontier stays 64 native-metre tiles after the ring publish -- the rings
   change what serves BEYOND it, not the eager set the loader installs, which is
   still bounded by the 8 MiB cap. What the publish does move is the ground's
   own extent, from the 4,096 m source window to the 16,384 m root, and
   loadPublishedGraphTerrainFrontier asserts that against
   config.expectedBoundsEpsg5845; the config carries the root now. */
test('the real runtime decodes exactly the reviewed 64 native-metre tiles and aligns source RH2000 heights', async () => {
  const entry = json('../apps/golf/public/courses/v2-index.json').courses.find(course => course.slug === 'visby');
  const course = json(`../apps/golf/public/${entry.manifest.url}`);
  const ground = json(`../apps/golf/public/${course.groundManifest.url}`);
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  const requested = [];
  const source = await loadPublishedGraphTerrainFrontier({
    graph: { slug: 'visby', groundId: 'visby', ground, summary: { surfaceTiles: 0 } },
    geo: pack.header.GEO, config: VISBY_V2_CONFIG, baseUrl: '/', locationHref: 'https://visby-test.invalid/',
    fetchImpl: async url => {
      const pathname = new URL(url).pathname;
      requested.push(pathname);
      return new Response(bytes(`../apps/golf/public${pathname}`));
    },
  });
  assert.equal(source.ready, true);
  assert.equal(requested.length, 64);
  assert.equal(source.resources.length, 64);
  assert.ok(source.resources.every(resource => resource.width === 257 && resource.height === 257 && resource.sampleSpacingMetres === 1));
  assert.deepEqual(source.bounds, { x0: -1024, x1: 1024, z0: -1280, z1: 768 });
  assert.equal(source.waterBed, null);
  for (const hole of json('./course-model.json').holes) {
    assert.ok(Math.abs(source.heightAt(...hole.pin) - hole.elev.green) <= 0.061, `hole ${hole.n} green source height must stay on RH2000`);
    assert.ok(Math.abs(source.heightAt(...hole.tees.marks[1].c) - hole.elev.tee) <= 0.061, `hole ${hole.n} camera source height must stay on RH2000`);
  }
});
