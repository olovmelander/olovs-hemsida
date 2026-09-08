import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { applyInfrastructureMapping } from '../upsalabuild/ground-mapping.mjs';
import { exportGroundMap } from '../geobuild/export-ground-map.mjs';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../upsalabuild/${name}`, import.meta.url)));
const evidence = read('mapping/infrastructure-2025.json');
const osm = read('osm-features.json');
function sourceModel() {
  return structuredClone({ ...evidence.frame,
    infra: { paths: osm.paths, parking: osm.parking }, streams: osm.waterway });
}

describe('reviewed Upsala transport infrastructure', () => {
  it('ships a connected reviewed bridge approach in both course routings', () => {
    const approachEvidence = read('mapping/bridge-approach-2025.json').features[0];
    for (const build of ['upsalabuild', 'upsalamellanbuild']) {
      const model = JSON.parse(fs.readFileSync(new URL(`../${build}/course-model.json`, import.meta.url)));
      const bridge = model.infra.bridges.find(b => b.osmId === 'w438983250');
      const approach = model.infra.paths.find(p => p.id === 'w438983252');
      expect(bridge, `${build}: mapped footbridge`).toBeDefined();
      expect(approach.line.at(-1), `${build}: path must reach the visible deck end`).toEqual(bridge.line[0]);
      expect(approach.line.slice(0, -1)).toEqual(approachEvidence.assertOriginalLine.slice(0, -1));
    }
  });

  it('preserves source culverts and old parking while correcting only the displaced bridge path', () => {
    const model = sourceModel(), original = structuredClone(model);
    applyInfrastructureMapping(model, evidence);
    expect(model.infra.bridgePlacement).toBe('mapped-only');
    expect(model.infra.bridges).toHaveLength(3);
    expect(model.infra.parking).toHaveLength(original.infra.parking.length + 2);
    expect(model.infra.parking.slice(0, original.infra.parking.length)).toEqual(original.infra.parking);
    expect(model.streams).toEqual(original.streams);
    expect(model.streams.filter(s => s.tunnel === 'culvert')).toHaveLength(10);
    const changed = model.infra.paths.filter((p, i) => JSON.stringify(p.line) !== JSON.stringify(original.infra.paths[i].line));
    expect(changed.map(p => p.id)).toEqual(['w438983250']);
    expect(changed[0].bridge).toBe('yes');
    const deck = model.infra.bridges.find(b => b.osmId === changed[0].id);
    expect(changed[0].line).toEqual(deck.line);
    expect(deck.centroidShiftFromOldPathM).toBeGreaterThan(3);
  });

  it('refuses a stale review without partially adopting other footprints', () => {
    const model = sourceModel();
    model.infra.paths.find(p => p.id === 'w438983250').line[0][0] += 1;
    const before = structuredClone(model);
    expect(() => applyInfrastructureMapping(model, evidence)).toThrow(/path changed; re-review required/);
    expect(model).toEqual(before);
    const movedFrame = sourceModel();
    movedFrame.mPerLat += 1;
    expect(() => applyInfrastructureMapping(movedFrame, evidence)).toThrow(/latitude scale changed/);
  });

  it('keeps unmeasured heights unknown and source/pixel geometry out of migration inputs', () => {
    const model = sourceModel();
    applyInfrastructureMapping(model, evidence);
    for (const deck of model.infra.bridges) {
      expect(deck.railsObserved).toBe(true);
      expect(deck.deckHeightM).toBeNull();
      expect(deck.railHeightM).toBeNull();
      expect(deck.deckMaterial).toBeNull();
      expect(deck.absoluteHorizontalAccuracyRMSEM).toBeNull();
      expect(deck.notSurveyed).toBe(true);
      expect(deck.evidenceGeometry).toBeUndefined();
      expect(deck.assertOriginalLine).toBeUndefined();
      expect(deck.axis).toBeUndefined();
      expect(deck.abutments).toBeUndefined();
    }
    const collected = collectCoordinatePairs({ bridges: model.infra.bridges });
    expect(collected.coordinates).toHaveLength(18); // Three four-corner decks plus two endpoints each.
    expect(collected.coordinates.every(({ pair }) => pair.every(n => Math.abs(n) < 1000))).toBe(true);
    expect(() => applyInfrastructureMapping(model, evidence)).toThrow(/already applied/);
  });

  it('exports geographically transformed bridge footprints once across shared course routings', async () => {
    const model = sourceModel();
    applyInfrastructureMapping(model, evidence);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upsala-infrastructure-'));
    try {
      for (const build of ['stora', 'mellan']) {
        fs.mkdirSync(path.join(root, build));
        fs.writeFileSync(path.join(root, build, 'course-model.json'), JSON.stringify(model));
      }
      const geojson = await exportGroundMap({ root, builds: ['stora', 'mellan'], includeV2: false });
      const bridges = geojson.features.filter(f => f.properties.featureKind === 'footbridge');
      expect(bridges).toHaveLength(3);
      for (const feature of bridges) {
        expect(feature.geometry.type).toBe('Polygon');
        expect(feature.geometry.coordinates[0]).toHaveLength(5);
        expect(feature.properties.occurrences).toHaveLength(2);
        expect(feature.properties.surveyed).toBe(false);
        expect(feature.properties.horizontalAccuracyMetres).toBeNull();
        expect(feature.properties.line).toBeUndefined();
        const deck = model.infra.bridges.find(b => b.id === feature.properties.id);
        const expected = deck.ring.map(([x, z]) => [model.origin.lon + x / model.mPerLon,
          model.origin.lat - z / model.mPerLat]);
        for (const [lon, lat] of feature.geometry.coordinates[0]) {
          expect(expected.some(p => Math.abs(p[0] - lon) < 1e-9 && Math.abs(p[1] - lat) < 1e-9)).toBe(true);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
