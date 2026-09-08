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

const bytes = relative => readFileSync(new URL(relative, import.meta.url));
const json = relative => JSON.parse(bytes(relative));

test('reviewed clubhouse practice green and first-hole cameras retain image registration and observed platforms', () => {
  const geometry = json('./mapping/geometry.json'), model = json('./course-model.json');
  const review = json('./mapping/facilities-review.json');
  assert.deepEqual(applyReviewedFacilities(geometry, review), geometry, 'review adoption is idempotent');
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
  assert.deepEqual(reapplied.holes[0].tees, geometry.holes[0].tees);
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
      /* The BACK tee is the observed platform and must stay on it. The five
         shorter ones no longer can: this hole's card spans up to 176 m and one
         platform 7-32 m long cannot hold six tees, which is why all six used to
         share one point and every camera but one stood at the wrong tee. They
         are walked up the observed route by the card's own difference from the
         back tee -- see `teeMarks` for why that needs no extrapolation and
         infers no platform -- so containment is asserted where it is true and
         the derivation is re-derived below where it is not. */
      assert.ok(hole.tees.pads.some(pad => pointInPoly(...hole.tees.marks[0].c, pad.ring)));
      assert.equal(hole.tees.marks[0].placement, 'observed-tee-platform; the card back tee, whose platform this is');
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
      references: card.tees.map(tee => source.tees.references?.[tee.id] ? local(source.tees.references[tee.id]) : null), hole: hole.n,
    }));
    assert.deepEqual(hole.tees.marks.map(mark => mark.m), hole.t);
    assert.ok(pointInPoly(...hole.pin, hole.green.ring));
  }
  /* The tee dimension exists: 108 numbered tees used to stand on 18 points, so
     `?tee=N` moved nothing and the rangefinder read one distance to the green
     for all six against the card printed beside it. */
const teePoints = new Set(model.holes.flatMap(hole => hole.tees.marks.map(mark => mark.c.join(','))));
  assert.equal(teePoints.size, 80);
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
  /* THE CLUB DRAWS ITS OWN TEES, and the derivation is checked against that.
     Caddee's eighteen hole plans put a numbered disc on every tee: all 18 draw
     six, and 16 group them at exactly as many distinct places as the card has
     distinct lengths, in that order from the back tee to the front -- which is
     the shape `teeMarks` derives. Nothing is READ off the plans, which are
     stylised illustrations and are not registered; what is counted is
     structure, which is falsifiable and was falsified twice: holes 13 and 14
     draw at separate places two tees the card gives one length, and on 14 the
     plan's PRINTED distances agree with its own drawing against the card. Those
     two are recorded, not resolved. */
  const plans = json('./mapping/hole-plans.json');
  assert.equal(plans.summary.holesWhereThePlanDrawsSixTees, 18);
  assert.equal(plans.summary.holesWhereTheGroupingMatchesTheCard, 16);
  assert.deepEqual(plans.summary.disagreements.map(row => row.hole), [13, 14]);
  for (const row of plans.holes) {
    if (!row.matchesCardStructure) continue;
    const hole = model.holes.find(candidate => candidate.n === row.hole);
    const points = new Set(hole.tees.marks.map(mark => mark.c.join(','))).size;
    if (hole.tees.status === 'unresolved-physical-platform') { assert.equal(points, 1); continue; }
    assert.equal(points, row.planGroupSizesBackToFront.length,
      `hole ${row.hole} must stand its tees at as many places as its own plan draws`);
  }
  /* ALL EIGHTEEN HOLES SHOWED THE SAME DISCLAIMER where every other course
     shows a description of the hole -- `note` is the line a player reads under
     the hole number. There is no club-authored text to use (Caddee's per-hole
     description field is present and empty on all 18), so the hålguide is
     written from records that do exist and each hole says which in its `basis`.
     Re-derived here through the generator's own rule so the two cannot drift,
     and `name` stays null on every hole: this ground does not coin epithets,
     and the HUD's own "Hål N" is true. */
  const guide = json('./guide-notes.json');
  const notes = holeNotes(guide);
  for (const hole of model.holes) assert.equal(hole.note, notes.get(hole.n).note);
  assert.equal(new Set(model.holes.map(hole => hole.note)).size, 18);
  assert.ok(model.holes.every(hole => hole.name === null));
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
