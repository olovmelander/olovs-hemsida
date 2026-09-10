import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createCourseModel, projectedCourseModel, localRing, verifyInputSources, adoptMeasuredRoof, holeNotes, teeStatus } from './build-course.mjs';
import { pointInPoly } from '../geobuild/lib.mjs';
import { TORTUNA_FRAME as FRAME, projected } from './frame.mjs';
import { assertTortunaCanonicalRouting } from '../packages/course-v2/compile-tortuna-ground-graph.mjs';

// Deliberately small test fixtures; these are never emitted as Tortuna sources.
const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]].map(projected);
const fixture = () => ({ schemaVersion: 1, groundId: 'tortuna', horizontalCrs: 'EPSG:3006', inputs: [],
  card: { source: 'test fixture', teeNames: ['A', 'B'], par: 72, teeTotals: [5400, 4500] },
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1, strokeIndexStatus: 'verified', teeLengths: [300, 250],
    sourceFeatureId: `fixture-route-${i + 1}`, line: [[-100, -100], [0, 0]].map(projected), green: { ring, sourceFeatureId: `fixture-green-${i + 1}` },
    teePlatforms: [], teeReferences: [[-100, -100], [-90, -90]].map(projected), teeReferenceStatus: 'source-camera-reference; coloured marker locations unknown', fairways: [], bunkers: [] })) });

test('source adapter preserves every hole coordinate and leaves unsupported tee pads/fairways absent', () => {
  const source = fixture(), before = structuredClone(source);
  const model = createCourseModel(source, () => 30);
  assert.deepEqual(source, before);
  const master = projectedCourseModel(model, 'a'.repeat(64));
  for (let i = 0; i < 18; i++) {
    assert.deepEqual(master.geometry.holes[i].line, source.holes[i].line);
    assert.deepEqual(master.geometry.holes[i].green.ring, source.holes[i].green.ring);
    assert.deepEqual(master.geometry.holes[i].tees.marks.map(mark => mark.c), source.holes[i].teeReferences);
    assert.equal(model.holes[i].tees.inferPads, false);
    assert.deepEqual(model.holes[i].tees.pads, []);
    assert.deepEqual(model.holes[i].fairway.rings, []);
  }
  assert.equal(model.infra.objectPlacement, 'mapped-only');
  assert.equal(model.infra.terrainPlacement, 'measured-only');
});

test('changing scorecard distances changes no mapped geometry or terrain controls', () => {
  const source = fixture(), changes = fixture();
  changes.card.teeTotals[0] += 18;
  changes.holes.forEach(hole => hole.teeLengths[0]++);
  const original = createCourseModel(source, () => 30), updated = createCourseModel(changes, () => 30);
  for (let i = 0; i < 18; i++) {
    assert.deepEqual(updated.holes[i].line, original.holes[i].line);
    assert.deepEqual(updated.holes[i].green, original.holes[i].green);
    assert.deepEqual(updated.holes[i].tees.marks.map(mark => mark.c), original.holes[i].tees.marks.map(mark => mark.c));
    assert.deepEqual(updated.holes[i].elev, original.holes[i].elev);
  }
});

test('canonical projection transforms shared pin and green centre coordinates exactly once', () => {
  const model = createCourseModel(fixture(), () => 30), before = structuredClone(model);
  const liveProjection = projectedCourseModel(model, 'a'.repeat(64));
  const serializedProjection = projectedCourseModel(JSON.parse(JSON.stringify(model)), 'a'.repeat(64));
  assert.deepEqual(liveProjection, serializedProjection);
  assert.deepEqual(model, before);
  for (const hole of liveProjection.geometry.holes) {
    assert.deepEqual(hole.pin, projected([0, 0]));
    assert.deepEqual(hole.green.c, projected([0, 0]));
  }
});

test('graph integration rejects canonical green and tee mutations even when the route and source digest are unchanged', () => {
  const model = createCourseModel(fixture(), () => 30), digest = 'a'.repeat(64);
  const migration = projectedCourseModel(model, digest);
  const pack = { header: { slug: 'tortuna', GEO: { frame: FRAME.text, origin: { lat: FRAME.latitude, lon: FRAME.longitude }, mPerLon: model.mPerLon } },
    sv: deflateRawSync(Buffer.from(JSON.stringify({ holes: model.holes, water: [] }))) };
  assert.equal(assertTortunaCanonicalRouting(migration, model, pack, digest).length, 18);
  const changedGreen = structuredClone(migration);
  changedGreen.geometry.holes[0].green.ring[0][0]++;
  assert.throws(() => assertTortunaCanonicalRouting(changedGreen, model, pack, digest), /canonical geometry differs/);
  const changedTee = structuredClone(migration);
  changedTee.geometry.holes[0].tees.marks[0].c[0]++;
  assert.throws(() => assertTortunaCanonicalRouting(changedTee, model, pack, digest), /canonical geometry differs/);
});

test('missing or duplicate holes, bad card totals, unsupported references and detached targets fail closed', () => {
  const changes = [
    value => { value.holes.pop(); },
    value => { value.holes[1].number = 1; },
    value => { value.card.par = 71; },
    value => { value.card.teeTotals[0]--; },
    value => { value.holes[0].strokeIndex = 2; },
    value => { value.holes[0].green.sourceFeatureId = ''; },
    value => { value.holes[0].teeReferences = null; },
    value => { delete value.holes[0].teeReferenceStatus; },
    value => { value.holes[0].pin = projected([100, 100]); },
    value => { value.horizontalCrs = 'EPSG:4326'; },
  ];
  for (const change of changes) { const value = fixture(); change(value); assert.throws(() => createCourseModel(value, () => 30)); }
  assert.throws(() => localRing(ring.slice(0, -1), 'unclosed'), /closed/);
  assert.throws(() => localRing(ring.map(([e, n]) => [e + 5000, n]), 'outside'), /leaves acquired/);
});

test('facility adoption is atomic and rejects discarded water islands', () => {
  const source = fixture();
  source.buildings = [{ id: 'test-clubhouse', ring, sourceId: 'test-building-source', amenity: 'clubhouse' }];
  source.facilities = [{ id: 'test-practice', rings: [ring], kind: 'practice_green', sourceId: 'test-ortho', material: 'grass' }];
  source.facilities.push({ id: 'test-target', rings: [ring], kind: 'range_target', sourceId: 'test-ortho', material: 'turf' },
    { id: 'test-parking', rings: [ring], kind: 'parking', sourceId: 'test-ortho', material: 'unknown' },
    { id: 'test-shelter', rings: [ring], kind: 'range_shelter', sourceId: 'test-ortho' });
  const model = createCourseModel(source, () => 30);
  assert.deepEqual(model.infra.buildings[0].ring, ring.map(([e, n]) => [e - 597400.5, 6614899.5 - n]));
  assert.equal(model.scenery.mappedFeatures[0].id, 'test-practice');
  assert.equal(model.scenery.practiceGreens.length, 1);
  assert.equal(model.scenery.mappedFeatures[1].kind, 'range_target_surface');
  assert.equal(model.scenery.mappedFeatures[1].material, 'turf');
  assert.equal(model.infra.parking[0].id, 'test-parking');
  assert.equal(model.infra.parking[0].cars, false);
  assert.equal(model.infra.buildings[1].id, 'test-shelter');
  assert.equal(model.infra.buildings[1].heightStatus, 'estimated-rendering-height-not-measured');
  const before = structuredClone(source);
  source.water = [{ id: 'island-water', rings: [ring, ring], heightRH2000: 20, sourceId: 'test-water' }];
  assert.throws(() => createCourseModel(source, () => 30), /cannot discard islands/);
  assert.deepEqual(source.buildings, before.buildings);
  assert.deepEqual(source.facilities, before.facilities);
});

test('retained input evidence must match its checksum and stay inside the repository', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tortuna-source-contract-'));
  try {
    await writeFile(path.join(directory, 'source.json'), 'retained evidence');
    const input = { inputs: [{ path: 'source.json', sha256: createHash('sha256').update('retained evidence').digest('hex') }] };
    await assert.doesNotReject(verifyInputSources(input, directory));
    await writeFile(path.join(directory, 'source.json'), 'mutated evidence');
    await assert.rejects(verifyInputSources(input, directory), /source input changed/);
    input.inputs[0].path = '../source.json';
    await assert.rejects(verifyInputSources(input, directory), /path or checksum is invalid/);
  } finally {
    assert.ok(directory.startsWith(path.join(tmpdir(), 'tortuna-source-contract-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('environment keeps source networks, coordinates, full widths and explicit object placement', () => {
  const input = fixture(), line = [[-120, -80], [70, 120]].map(projected);
  input.paths = ['paths', 'tracks', 'roads'].map((network, i) => ({ id: network, network, line, sourceId: 'mapped-context', kind: ['path', 'track', 'tertiary'][i], widthMetres: i + 2, surface: 'unpaved' }));
  input.landuse = [{ id: 'field', ring, kind: 'farmland', sourceId: 'mapped-context' }];
  input.clearfells = [{ id: 'cut-ground', ring, sourceId: 'ortho', canopyExclusion: false }];
  input.streams = [{ id: 'ditch', line, sourceId: 'mapped-context', kind: 'ditch', widthMetres: 2 }];
  input.railways = [{ id: 'rail', line, sourceId: 'mapped-context', inferMasts: false }];
  input.powerLines = [{ id: 'line', line, sourceId: 'mapped-context', voltage: '130000' }];
  input.powerSupports = [{ id: 'tower', c: line[0], kind: 'tower', sourceId: 'mapped-context' }];
  const before = structuredClone(input), model = createCourseModel(input, () => 30);
  assert.deepEqual(input, before);
  for (const [i, network] of ['paths', 'tracks', 'roads'].entries()) {
    assert.deepEqual(model.infra[network][0].line, [[-120, -80], [70, 120]]);
    assert.equal(model.infra[network][0].widthMetres, i + 2);
    assert.equal(model.infra[network][0].surface, 'unpaved');
  }
  assert.deepEqual(model.infra.landuse[0].ring, ring.map(p => [p[0] - FRAME.easting, FRAME.northing - p[1]]));
  assert.equal(model.streams[0].contextOnly, true);
  assert.equal(model.streams[0].w, 1);
  assert.equal(model.water.length, 0);
  assert.equal(model.infra.railway[0].inferMasts, false);
  assert.equal(model.infra.power.towers.length, 1);
  assert.equal(model.infra.power.lines[0].voltage, '130000');
  assert.equal(model.infra.power.poles.length, 0);
  for (const mutate of [v => { v.paths[0].network = 'building'; }, v => { v.paths[0].widthMetres = 0; },
    v => { v.paths[0].line[0] = projected([5000, 0]); }, v => { delete v.railways[0].inferMasts; },
    v => { v.powerSupports[0].kind = 'inferred'; }, v => { v.clearfells[0].canopyExclusion = true; }]) {
    const changed = structuredClone(input); mutate(changed); assert.throws(() => createCourseModel(changed, () => 30));
  }
});

test('measured roofs preserve absolute RH2000, unsupported gaps and independent source footprint', () => {
  const vertices = [[-8, -8], [8, -8], [8, 8]].map((p, i) => [...projected(p), 35 + i]);
  const source = { id: 'clubhouse', sourceId: 'laser-lm-skog', sourceEpoch: '2021-04-05', mesh: {
    verticesEpsg3006RH2000: vertices, triangleIndices: [0, 1, 2], boundaryWallSegmentsEpsg3006RH2000: [[vertices[0], vertices[1]]],
  } };
  const input = fixture();
  input.buildings = [{ id: source.id, ring, sourceId: 'osm', heightMetres: 6.2 }];
  input.buildingRoofs = [source];
  const before = structuredClone(input), model = createCourseModel(input, () => 30), b = model.infra.buildings[0];
  assert.deepEqual(input, before);
  assert.equal(b.h, undefined);
  assert.deepEqual(b.ring, ring.map(p => [p[0] - FRAME.easting, FRAME.northing - p[1]]));
  assert.deepEqual(b.roofSurface.vertices.map(v => v.heightRH2000), [35, 36, 37]);
  assert.equal(b.roofSurface.boundaryWallSegments.length, 1);
  assert.equal(b.roofSurface.triangleIndices.length, 3);
  assert.throws(() => adoptMeasuredRoof(source, () => 40), /clearance/);
  for (const indices of [[0, 1, 9], [0, 0, 1], []]) {
    const changed = structuredClone(source); changed.mesh.triangleIndices = indices;
    assert.throws(() => adoptMeasuredRoof(changed, () => 30));
  }
  input.buildingRoofs.push(source);
  assert.throws(() => createCourseModel(input, () => 30), /Duplicate measured roof/);
});

test('the committed hålguide is applied through the generator\'s own rule: every hole carries its note and tagline', () => {
  /* The HUD showed one provenance sentence on all eighteen holes. The notes
     are written from records that exist (the model's geometry, the club's
     Caddee maps, its Lokala regler 2026, its history) and each hole says which
     in `basis`; re-derived here through holeNotes() so the committed model,
     the generator and mapping/apply-guide-notes.mjs cannot drift apart. */
  const notes = holeNotes(JSON.parse(readFileSync(new URL('./guide-notes.json', import.meta.url), 'utf8')));
  const model = JSON.parse(readFileSync(new URL('./course-model.json', import.meta.url), 'utf8'));
  for (const hole of model.holes) {
    assert.equal(hole.note, notes.get(hole.n).note);
    assert.equal(hole.name, notes.get(hole.n).name);
  }
  assert.equal(new Set(model.holes.map(hole => hole.note)).size, 18);
  assert.equal(new Set(model.holes.map(hole => hole.name)).size, 18);
});

test('every hole without an observed tee platform declares it, and no hole with a pad does', () => {
  /* tools/check-app.mjs fails closed on a mapped-only ground for an undeclared
     missing platform AND for a declaration on a hole that has a pad; the
     committed model must carry exactly what teeStatus() derives from the input. */
  const model = JSON.parse(readFileSync(new URL('./course-model.json', import.meta.url), 'utf8'));
  const input = JSON.parse(readFileSync(new URL('./mapping/course-input.json', import.meta.url), 'utf8'));
  for (const hole of model.holes) {
    const want = teeStatus(hole.tees.pads, input.holes.find(h => h.number === hole.n)).status;
    assert.equal(hole.tees.status, want, `hole ${hole.n}`);
    if (want) assert.equal(hole.tees.pads.length, 0);
  }
  /* the 2026 review (mapping/tee-decisions-2026.json) gave the 6th and 15th platforms --
     card-derived and a laser-flat deck -- so no hole declares a gap any more */
  assert.deepEqual(model.holes.filter(h => h.tees.status).map(h => h.n), []);
});

test('every card colour stands on a named platform of its own hole, and the model says which kind', () => {
  /* mapping/apply-review-2026.mjs + reviewedTeeMarks(): the engine draws a colour's markers only
     for a mark that carries a platform identity and a reference kind it knows, and the
     tee camera stands on that mark. Re-derived here from the committed model. */
  const model = JSON.parse(readFileSync(new URL('./course-model.json', import.meta.url), 'utf8'));
  const kinds = new Set(['orthophoto-platform-reference', 'card-derived-platform-reference']);
  let derived = 0, observed = 0;
  for (const hole of model.holes) {
    assert.equal(hole.tees.markerLayout, 'separate-reviewed-colours', `hole ${hole.n}`);
    assert.equal(hole.tees.markerPlacement, 'reviewed', `hole ${hole.n}`);
    assert.equal(hole.tees.marks.length, hole.t.length, `hole ${hole.n}`);
    for (const [i, mark] of hole.tees.marks.entries()) {
      const pad = hole.tees.pads.find(p => p.id === mark.sourcePadId);
      assert.ok(pad, `hole ${hole.n} colour ${i} names a platform the hole carries`);
      assert.ok(kinds.has(mark.orthophotoReference?.kind), `hole ${hole.n} colour ${i} reference kind`);
      assert.ok(pointInPoly(...mark.c, pad.ring), `hole ${hole.n} colour ${i} stands inside ${pad.id}`);
      if (mark.orthophotoReference.kind === 'card-derived-platform-reference') derived++; else observed++;
    }
    /* the route starts on the back tee */
    assert.ok(Math.hypot(hole.line[0][0] - hole.tees.marks[0].c[0], hole.line[0][1] - hole.tees.marks[0].c[1]) < 0.01, `hole ${hole.n} line starts on the Gul mark`);
  }
  assert.equal(observed + derived, 72);
  assert.ok(observed >= 40, `${observed} colours stand on observed or laser platforms`);
});
