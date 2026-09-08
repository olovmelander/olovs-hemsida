import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMunicipalObjects20260907 } from '../tools/apply-upsala-municipal-objects.mjs';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';
import { pointInPoly } from '../upsalabuild/lib.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const evidence = read('../upsalabuild/mapping/municipal-objects-2026-09-07.json');
const shipped = read('../upsalabuild/course-model.json');
const clone = value => structuredClone(value);
const fixture = () => {
  const model = clone(shipped);
  model.infra.barriers = clone(evidence.baselineAssertions['infra.barriers']);
  delete model.infra.drainage;
  model.infra.bridges = clone(evidence.baselineAssertions['infra.bridges']);
  model.streams = model.streams.map(s => clone(evidence.baselineObjects[s.id] || s));
  return model;
};
const positions = streams => streams.map(({ municipalCorroboration, ...s }) => s);

describe('Upsala municipal survey object integration', () => {
  it('adds measured drainage and boundaries without changing channels, terrain, playing surfaces or tree populations', () => {
    const model = fixture(), before = clone(model);
    applyMunicipalObjects20260907(model, evidence);
    expect(model.infra.drainage).toHaveLength(4);
    expect(model.infra.barriers).toHaveLength(19);
    expect(model.infra.bridges).toHaveLength(4);
    expect(positions(model.streams)).toEqual(before.streams);
    expect(model.streams.flatMap(s => s.municipalCorroboration || [])).toHaveLength(9);
    expect(model.holes).toEqual(before.holes);
    expect(model.water).toEqual(before.water);
    expect(model.vegetation).toEqual(before.vegetation);
    expect(model.scenery).toEqual(before.scenery);
    expect(model.infra.mappedPoints).toEqual(before.infra.mappedPoints);
    expect(model.infra.paths).toEqual(before.infra.paths);
    for (const ditch of model.infra.drainage) {
      expect(ditch.preserveTerrain).toBe(true);
      expect(ditch.widthM).toBeNull(); expect(ditch.depthM).toBeNull();
      expect(ditch.waterPermanence).toBe('unknown');
      expect(ditch.renderStatus).toMatch(/no inferred water body/);
    }
  });

  it('keeps nine corroborating source segments separate from four new ditch observations', () => {
    const model = fixture(); applyMunicipalObjects20260907(model, evidence);
    expect(model.infra.drainage.map(d => d.id).sort()).toEqual([
      'uppsala-primary-564-18921', 'uppsala-primary-564-145640',
      'uppsala-primary-564-145642', 'uppsala-primary-564-145643',
    ].sort());
    for (const f of evidence.features.filter(f => f.status === 'corroboration-only')) {
      const target = model.streams.find(s => s.id === f.nearestExisting[0].id);
      expect(target.line).toEqual(evidence.baselineObjects[target.id].line);
      expect(target.municipalCorroboration.some(c => c.sourceId === f.id)).toBe(true);
      expect(model.infra.drainage.some(d => d.id === f.id)).toBe(false);
    }
  });

  it('preserves the existing decks and derives a contained horizontal axis for the newly surveyed crossing', () => {
    const model = fixture(), existing = clone(model.infra.bridges);
    applyMunicipalObjects20260907(model, evidence);
    expect(model.infra.bridges.slice(0, 3)).toEqual(existing);
    const bridge = model.infra.bridges.at(-1);
    expect(bridge.id).toBe('uppsala-primary-571-64915');
    expect(bridge.equivalentSourceId).toBe('uppsala-primary-568-111560');
    expect(bridge.ring).toHaveLength(4);
    const midpoint = bridge.line[0].map((v, i) => (v + bridge.line[1][i]) / 2);
    expect(pointInPoly(...midpoint, bridge.ring)).toBe(true);
    expect(bridge.areaM2).toBeGreaterThan(10); expect(bridge.areaM2).toBeLessThan(12);
    expect(bridge.deckHeightM).toBeNull(); expect(bridge.deckMaterial).toBeNull();
    expect(bridge.renderStatus).toMatch(/rendering estimates/);
  });

  it('fails before any mutation when an original corridor changed, a late source is unaccepted, or coordinates no longer agree', () => {
    const stale = fixture();
    const ref = evidence.features.find(f => f.status === 'corroboration-only').nearestExisting[0].id;
    stale.streams.find(s => s.id === ref).line[0][0] += 2;
    const beforeStale = clone(stale);
    expect(() => applyMunicipalObjects20260907(stale, evidence)).toThrow(/original drainage changed/);
    expect(stale).toEqual(beforeStale);
    for (const change of [
      e => { e.features.findLast(f => f.kind === 'barrier').status = 'candidate'; },
      e => { e.features.findLast(f => f.kind === 'barrier').geometryLocal.lines[0][0][0] += 1; },
      e => { e.features.findLast(f => f.kind === 'barrier').sourceAttributes.STATUS = 4; },
    ]) {
      const model = fixture(), before = clone(model), bad = clone(evidence); change(bad);
      expect(() => applyMunicipalObjects20260907(model, bad)).toThrow();
      expect(model).toEqual(before);
    }
  });

  it('rejects duplicate bridge representations, repeat application, and wrong coordinate frames', () => {
    const duplicate = fixture();
    duplicate.infra.bridges.push({ id: 'existing-other-id', sourceId: 'uppsala-primary-568-111560' });
    const before = clone(duplicate);
    expect(() => applyMunicipalObjects20260907(duplicate, evidence)).toThrow(/bridge identity already exists/);
    expect(duplicate).toEqual(before);
    const model = fixture(); applyMunicipalObjects20260907(model, evidence);
    const applied = clone(model);
    expect(() => applyMunicipalObjects20260907(model, evidence)).toThrow(/original boundaries changed|already applied/);
    expect(model).toEqual(applied);
    const wrong = clone(evidence); wrong.frame.mPerLon += 1;
    expect(() => applyMunicipalObjects20260907(fixture(), wrong)).toThrow(/frame changed/);
  });

  it('keeps projected source geometry out of runtime metadata and does not alias accepted source geometry', () => {
    const model = fixture(), input = clone(evidence);
    input.features.find(f => f.kind === 'bridge').unreviewedMetadata = { coordinates3006: [640000, 6635500] };
    applyMunicipalObjects20260907(model, input);
    expect(JSON.stringify(model)).not.toMatch(/sourceGeometryEPSG3006|sourceAttributes|nearestCrownCandidates|unreviewedMetadata/);
    for (const { pair } of collectCoordinatePairs(model).coordinates) {
      expect(Math.max(...pair.map(Math.abs))).toBeLessThan(10000);
    }
    const first = input.features.find(f => f.id === model.infra.drainage[0].id);
    const originalPoint = clone(first.geometryLocal.lines[0][0]);
    model.infra.drainage[0].line[0][0] += 1;
    expect(first.geometryLocal.lines[0][0]).toEqual(originalPoint);
    const nested = clone(evidence); nested.features.find(f => f.kind === 'bridge').method = { source3006: [640000, 6635500] };
    expect(() => applyMunicipalObjects20260907(fixture(), nested)).toThrow(/scalar metadata/);
  });

  it('exports observed tree types and open road edges without turning them into additional crowns or filled surfaces', () => {
    const geo = read('../upsalabuild/mapping/municipal-objects-2026-09-07.geojson');
    const trees = geo.features.filter(f => f.properties.kind === 'tree-observation');
    expect(trees).toHaveLength(50);
    expect(trees.filter(f => f.properties.leafType === 'broadleaf')).toHaveLength(32);
    expect(trees.filter(f => f.properties.leafType === 'conifer')).toHaveLength(18);
    expect(trees.every(f => f.properties.species === null && f.properties.runtimeAdoptionRecommended === false)).toBe(true);
    const edges = geo.features.filter(f => f.properties.kind === 'road-edge-observation');
    expect(edges).toHaveLength(148);
    expect(edges.every(f => f.geometry.type === 'MultiLineString')).toBe(true);
    expect(edges.filter(f => f.properties.status === 'unsuitable-for-precision-mapping')).toHaveLength(28);
    expect(geo.completeSurvey).toBe(false);
  });
});
