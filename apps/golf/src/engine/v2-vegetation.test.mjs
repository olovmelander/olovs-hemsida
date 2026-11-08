import { describe, expect, it } from 'vitest';
import { createSyntheticAssetGraph } from '../../../../packages/course-v2/synthetic-fixture.mjs';
import { assetReferenceForChunk, writeChunk } from '../../../../packages/course-v2/chunk-node.mjs';
import { STAND_FIELD_FEATURE, STAND_FIELD_FORMAT, encodeStandField } from '../../../../packages/course-v2/stand-field.mjs';
import { legacyGridBridge } from './geodetic-frame.mjs';
import {
  DEFAULT_SPECIES_MIX,
  STAND_PLANTING,
  SPECIES_INDEX,
  createCoverage,
  createFrameMapper,
  crownRadiusForHeight,
  defaultSpeciesForHash,
  hash01,
  isConiferSpecies,
  keepWoodlandRecord,
  loadV2Vegetation,
  planV2Vegetation,
  speciesForType,
} from './v2-vegetation.mjs';

const BASE = 'https://banvy.test/app/';

function fakeGraph() {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
  const course = JSON.parse(Buffer.from(graph.resources.get(entry.manifest.url)).toString('utf8'));
  const ground = JSON.parse(Buffer.from(graph.resources.get(course.groundManifest.url)).toString('utf8'));
  /* add a stand field to tile B, which the fixture publishes without objects */
  const tileB = ground.tiles.find(tile => tile.id === 'l0/1/0');
  const field = encodeStandField({
    width: 2, height: 2, cellMetres: 64,
    fraction: Float32Array.from([0.9, 0.1, 0.6, 0]),
    meanHeight: Float32Array.from([16, 6, 12, 0]),
    p95Height: Float32Array.from([20, 7, 15, 0]),
    measured: Uint8Array.from([1, 1, 1, 0]),
    north: Uint8Array.from([0, 0, 0, 0]),
    excluded: Uint8Array.from([0, 0, 1, 0]),
  });
  const chunk = writeChunk({
    header: {
      schemaVersion: 2, id: tileB.id, kind: 'stands', owner: { type: 'ground', id: ground.groundId },
      bounds: tileB.bounds, payloadFormat: STAND_FIELD_FORMAT,
      requiredFeatures: ['chunk-envelope-v2', STAND_FIELD_FEATURE], standField: field.standField,
    },
    payload: field.payload,
  });
  const reference = assetReferenceForChunk(chunk, { kind: 'stands', directory: 'grounds/synthetic-ground/stands' });
  tileB.layers.stands = reference;
  graph.resources.set(reference.url, chunk);
  const fetchImpl = async url => {
    const relative = new URL(url).pathname.replace('/app/', '');
    const resource = graph.resources.get(relative);
    return resource ? new Response(resource) : new Response('missing', { status: 404 });
  };
  return { graph: { ground, course }, fetchImpl, resources: graph.resources };
}

const identityBridge = Object.freeze({
  translateX: 0, translateY: 0, translateZ: 0, rotationRadians: 0, scaleX: 1, scaleZ: 1,
  toLegacy: (x, z) => [x, z], toGrid: (x, z) => [x, z],
});

describe('frame mapper', () => {
  it('maps EPSG:3006 to the legacy world and back through the bridge', () => {
    const geodetic = legacyGridBridge({ latitude: 63.2992, longitude: 18.9413, metresPerLatitude: 111320, metresPerLongitude: 50019.58 });
    const bridge = { ...geodetic, translateX: 697428.5 - 697498.022, translateZ: 7024997.739 - 7024826.5 };
    const mapper = createFrameMapper({ bridge, frameOrigin: { easting: 697428.5, northing: 7024826.5 } });
    expect(mapper.legacyOriginEasting).toBeCloseTo(697498.022, 6);
    expect(mapper.legacyOriginNorthing).toBeCloseTo(7024997.739, 6);
    const [x, z] = mapper.toWorld(697498.022, 7024997.739);
    expect(Math.hypot(x, z)).toBeLessThan(1e-6);
    const [e, n] = mapper.toEpsg(...mapper.toWorld(697600, 7025100));
    expect(e).toBeCloseTo(697600, 6);
    expect(n).toBeCloseTo(7025100, 6);
    /* north in EPSG:3006 is grid north; the bridge rotates it by the convergence */
    const [nx, nz] = mapper.toWorld(697498.022, 7025097.739);
    expect(nz).toBeLessThan(-99);
    expect(Math.abs(nx)).toBeGreaterThan(0);
  });
});

describe('loadV2Vegetation', () => {
  it('loads, verifies and decodes object and stand layers, fail-closed', async () => {
    const { graph, fetchImpl } = fakeGraph();
    const loaded = await loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl });
    expect(loaded.counts).toEqual({ referencedObjectTiles: 1, referencedStandTiles: 1, loadedTiles: 2, records: 2 });
    const tileA = loaded.tiles.find(tile => tile.id === 'l0/0/0');
    expect(tileA.objects.map(record => record.id)).toEqual(['boulder-001', 'tree-001']);
    const tileB = loaded.tiles.find(tile => tile.id === 'l0/1/0');
    expect(tileB.stands.width).toBe(2);
    expect(tileB.stands.fraction[0]).toBeCloseTo(0.9, 2);
    expect(loaded.bytes).toBeGreaterThan(0);

    /* a corrupt chunk fails the whole load */
    const corrupt = async url => {
      const response = await fetchImpl(url);
      if (!/stands/.test(url)) return response;
      const data = new Uint8Array(await response.arrayBuffer());
      data[data.length - 1] ^= 0xff;
      return new Response(data);
    };
    await expect(loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl: corrupt })).rejects.toThrow(/integrity|decode|declared/);
    /* an unsupported feature list fails too */
    await expect(loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl, supportedFeatures: ['chunk-envelope-v2'] })).rejects.toThrow(/unsupported/);
  });
});

describe('planning', () => {
  it('draws one instance per tree record on the visible ground and reports the base mismatch', async () => {
    const { graph, fetchImpl } = fakeGraph();
    const loaded = await loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl });
    const mapper = createFrameMapper({ bridge: identityBridge, frameOrigin: loaded.frameOrigin });
    const planned = planV2Vegetation(loaded, { mapper, groundHeightAt: () => 21.4, verticalDatumOffsetMetres: 0 });
    const individuals = planned.instances.filter(instance => instance.kind === 'individual');
    expect(individuals).toHaveLength(1);
    expect(individuals[0].id).toBe('tree-001');
    expect(individuals[0].height).toBe(12);
    expect(individuals[0].radius).toBe(3.5);
    expect(individuals[0].y).toBe(21.4);
    expect(planned.stats.baseMismatch.samples).toBe(1);
    expect(planned.stats.baseMismatch.maxMetres).toBeCloseTo(Math.abs(21.4 - 21.1), 3);
    /* stand trees only in the measured, unexcluded, dense enough cells */
    const stand = planned.instances.filter(instance => instance.kind === 'stand');
    expect(stand.length).toBeGreaterThan(0);
    expect(planned.stats.cellsPlanted).toBe(1);
    expect(planned.stats.cellsSkipped).toBe(2);
    for (const tree of stand) {
      expect(tree.height).toBeGreaterThanOrEqual(STAND_PLANTING.minimumHeightMetres);
      expect(tree.height).toBeLessThanOrEqual(20 * 1.05);
      expect(tree.species).toBeGreaterThanOrEqual(0);
      expect(tree.species).toBeLessThanOrEqual(2);
    }
    /* deterministic */
    const again = planV2Vegetation(loaded, { mapper, groundHeightAt: () => 21.4 });
    expect(again.instances).toEqual(planned.instances);
    /* low quality keeps fewer cells or the same, never more */
    const low = planV2Vegetation(loaded, { mapper, groundHeightAt: () => 21.4, lowQuality: true });
    expect(low.stats.cellsPlanted).toBeLessThanOrEqual(planned.stats.cellsPlanted);
  });

  it('lets the course species rule drive every instance, and reports which rule ran', async () => {
    const { graph, fetchImpl } = fakeGraph();
    const loaded = await loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl });
    const mapper = createFrameMapper({ bridge: identityBridge, frameOrigin: loaded.frameOrigin });
    /* without a hook: the pine-led default, and the report says so */
    const defaulted = planV2Vegetation(loaded, { mapper, groundHeightAt: () => 21.4 });
    expect(defaulted.stats.speciesSource).toBe('default');
    /* a course rule (Veckefjärden's shape: {r, x, z, h} in, an index out)
       decides every individual and stand tree, and sees the visible ground */
    const calls = [];
    const birchEverywhere = ({ r, x, z, h }) => { calls.push({ r, x, z, h }); return 2; };
    const ruled = planV2Vegetation(loaded, { mapper, groundHeightAt: () => 21.4, species: birchEverywhere });
    expect(ruled.stats.speciesSource).toBe('course');
    expect(ruled.instances.length).toBe(defaulted.instances.length);
    expect(ruled.instances.every(instance => instance.species === 2)).toBe(true);
    expect(calls.length).toBe(ruled.instances.length);
    for (const call of calls) {
      expect(call.r).toBeGreaterThanOrEqual(0);
      expect(call.r).toBeLessThan(1);
      expect(call.h).toBe(21.4);
      expect(Number.isFinite(call.x) && Number.isFinite(call.z)).toBe(true);
    }
    /* everything but the species is untouched by the hook */
    expect(ruled.instances.map(({ species, ...rest }) => rest))
      .toEqual(defaulted.instances.map(({ species, ...rest }) => rest));
    /* a rule that answers nothing falls back to the default, never to NaN */
    const abstains = planV2Vegetation(loaded, { mapper, groundHeightAt: () => 21.4, species: () => undefined });
    expect(abstains.instances.map(instance => instance.species))
      .toEqual(defaulted.instances.map(instance => instance.species));
  });

  it('coverage is exactly the published tiles', async () => {
    const { graph, fetchImpl } = fakeGraph();
    const loaded = await loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl });
    const mapper = createFrameMapper({ bridge: identityBridge, frameOrigin: loaded.frameOrigin });
    const coverage = createCoverage(loaded, mapper);
    expect(coverage.tiles).toBe(2);
    const inside = mapper.toWorld(650064, 6640064);
    const outside = mapper.toWorld(650064, 6640200);
    expect(coverage.covers(...inside)).toBe(true);
    expect(coverage.covers(...outside)).toBe(false);
    expect(coverage.ownerAt(...inside).id).toBe('l0/0/0');
  });

  /* The one background mix. It exists so the far ring, the legacy lattice and
     this planner cannot draw two different forests over one ground on a course
     with no species rule of its own -- which is what 58/32/10 against 56/27/17
     did at the edge of the measured coverage. Birch is a scattered minority of
     CLOSED forest here and nothing else changed: the places something local
     says birch leads still say it. */
  it('the background mix is conifer-led, with birch scattered rather than a sixth of the stems', () => {
    const n = 20000, seen = [0, 0, 0];
    for (let i = 0; i < n; i++) seen[defaultSpeciesForHash((i + 0.5) / n)]++;
    const share = seen.map(c => c / n);
    expect(share[SPECIES_INDEX.pine]).toBeCloseTo(DEFAULT_SPECIES_MIX.pine, 3);
    expect(share[SPECIES_INDEX.spruce]).toBeCloseTo(DEFAULT_SPECIES_MIX.spruceThrough - DEFAULT_SPECIES_MIX.pine, 3);
    expect(share[SPECIES_INDEX.birch]).toBeCloseTo(1 - DEFAULT_SPECIES_MIX.spruceThrough, 3);
    /* the property the owner asked for, stated as a property and not a literal:
       the conifers lead, and birch is a scattered minority */
    expect(share[SPECIES_INDEX.pine] + share[SPECIES_INDEX.spruce]).toBeGreaterThan(0.9);
    expect(share[SPECIES_INDEX.birch]).toBeLessThan(0.1);
    expect(share[SPECIES_INDEX.birch]).toBeGreaterThan(0);
  });

  it('a caller may hand down its own background, and it is used where no course rule speaks', async () => {
    const { graph, fetchImpl } = fakeGraph();
    const loaded = await loadV2Vegetation({ graph, baseUrl: BASE, fetchImpl });
    const mapper = createFrameMapper({ bridge: identityBridge, frameOrigin: loaded.frameOrigin });
    /* main.js passes its own defaultTreeSpecies so the app has ONE default;
       a background that answers spruce everywhere must reach every tree the
       shore belt does not claim, and must not be mistaken for a course rule */
    const planned = planV2Vegetation(loaded, {
      mapper, groundHeightAt: () => 21.4, defaultSpecies: () => SPECIES_INDEX.spruce,
    });
    expect(planned.stats.speciesSource).toBe('default');
    expect(planned.instances.every(instance => instance.species === SPECIES_INDEX.spruce)).toBe(true);
    /* and a course rule still outranks it */
    const ruled = planV2Vegetation(loaded, {
      mapper, groundHeightAt: () => 21.4, defaultSpecies: () => SPECIES_INDEX.spruce, species: () => SPECIES_INDEX.birch,
    });
    expect(ruled.stats.speciesSource).toBe('course');
    expect(ruled.instances.every(instance => instance.species === SPECIES_INDEX.birch)).toBe(true);
  });

  it('allometry and hashes are bounded and stable', () => {
    expect(crownRadiusForHeight(0)).toBe(2.48);
    expect(crownRadiusForHeight(0.5)).toBe(2.542);
    expect(crownRadiusForHeight(100)).toBe(6);
    expect(crownRadiusForHeight(-100)).toBe(1.5);
    expect(hash01(1, 2)).toBe(hash01(1, 2));
    expect(hash01(1, 2)).not.toBe(hash01(2, 1));
    for (let i = 0; i < 100; i++) { const v = hash01(i, i * 7, 3); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('measured tree types and the woodland thinning', () => {
  const tile = records => ({ tiles: [{ id: 't', objects: records, stands: null, bounds: { minEasting: 0, maxNorthing: 0 } }] });
  const plan = (records, options = {}) => planV2Vegetation(tile(records), {
    mapper: { toWorld: (e, n) => [e, -n] }, groundHeightAt: () => 1, ...options,
  });
  const record = (i, extra = {}) => ({ id: `tree-g-${String(i).padStart(6, '0')}`, class: 'tree', easting: i, northing: 0, heightRH2000: 1,
    objectHeightMetres: 12, radiusMetres: 3, headingDegrees: 0, ...extra });

  it('a conifer record draws a conifer and a broadleaf record a broadleaf, whatever the background rule says', () => {
    const records = Array.from({ length: 400 }, (_, i) => record(i, { subtype: i % 2 ? 'conifer' : 'broadleaf', play: 'near', typeConfidence: 0.9 }));
    const { instances } = plan(records, { defaultSpecies: () => SPECIES_INDEX.birch });
    for (const [k, instance] of instances.entries()) {
      if (records[k].subtype === 'conifer') expect(isConiferSpecies(instance.species)).toBe(true);
      else expect(isConiferSpecies(instance.species)).toBe(false);
    }
    const conifers = instances.filter((_, k) => records[k].subtype === 'conifer');
    const pines = conifers.filter(instance => instance.species === SPECIES_INDEX.pine).length / conifers.length;
    expect(pines).toBeGreaterThan(0.45);
    expect(pines).toBeLessThan(0.78);
  });

  it("a rule that already agrees with the type keeps its choice, and an untyped record keeps today's rule", () => {
    expect(speciesForType('conifer', SPECIES_INDEX.spruce, 0.01)).toBe(SPECIES_INDEX.spruce);
    expect(speciesForType('broadleaf', 4, 0.5)).toBe(4);
    expect(speciesForType('broadleaf', SPECIES_INDEX.pine, 0.5)).toBe(SPECIES_INDEX.birch);
    expect(speciesForType(null, SPECIES_INDEX.pine, 0.5)).toBe(SPECIES_INDEX.pine);
  });

  it('a measured pine or spruce draws as that species, whatever the rule or the hash says', () => {
    for (const rule of [SPECIES_INDEX.pine, SPECIES_INDEX.spruce, SPECIES_INDEX.birch, 4]) {
      for (const hash of [0.01, 0.5, 0.99]) {
        expect(speciesForType('pine', rule, hash)).toBe(SPECIES_INDEX.pine);
        expect(speciesForType('spruce', rule, hash)).toBe(SPECIES_INDEX.spruce);
      }
    }
    const measured = plan([record(1, { subtype: 'spruce', typeConfidence: 0.9, play: 'near' }), record(2, { subtype: 'pine', typeConfidence: 0.9, play: 'near' })], { defaultSpecies: () => SPECIES_INDEX.birch });
    expect(measured.instances.map(i => i.species)).toEqual([SPECIES_INDEX.spruce, SPECIES_INDEX.pine]);
    const untyped = plan([record(1)], { defaultSpecies: () => SPECIES_INDEX.birch });
    expect(untyped.instances[0].species).toBe(SPECIES_INDEX.birch);
  });

  it('a phone thins woodland records by id at the stand keep share, draws every near record, and keeps the same ones', () => {
    const records = Array.from({ length: 2000 }, (_, i) => record(i, { subtype: 'conifer', typeConfidence: 0.8, play: i < 500 ? 'near' : 'woodland' }));
    const high = plan(records);
    const low = plan(records, { lowQuality: true });
    expect(high.instances.length).toBe(2000);
    expect(high.stats.woodlandThinned).toBe(0);
    const keptNear = low.instances.filter(instance => Number(instance.id.slice(-6)) < 500).length;
    expect(keptNear).toBe(500);
    const keptWoodland = low.instances.length - keptNear;
    expect(keptWoodland / 1500).toBeGreaterThan(STAND_PLANTING.lowQualityKeep - 0.05);
    expect(keptWoodland / 1500).toBeLessThan(STAND_PLANTING.lowQualityKeep + 0.05);
    expect(low.stats.woodlandThinned).toBe(1500 - keptWoodland);
    expect(plan(records, { lowQuality: true }).instances.map(instance => instance.id)).toEqual(low.instances.map(instance => instance.id));
    expect(keepWoodlandRecord(record(3), true)).toBe(true);
  });
});
