import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { compareMunicipalGroundHeights, publishedOneMetreSampler } from '../geobuild/check-upsala-ground-heights.mjs';
import { encodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
import { assetReferenceForChunk, writeChunk } from '../packages/course-v2/chunk-node.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = { sourceSpatialReference: { wkid: 3011 }, fields: [
  ['STATUS', 3, 'Befintligt'], ['FITTED', 2, 'Nej'], ['ORIGINPLAN', 109, 'Geod. Nätverks-RTK'],
  ['ORIGINHEIGHT', 109, 'Geod. Nätverks-RTK'], ['SRSORIGINHEIGHT', 103, 'RH2000'], ['SRSORIGINPLAN', 457, 'SWEREF 99 18 00'],
].map(([name, code, label]) => ({ name, domain: { codedValues: [{ code, name: label }] } })) };
const point = (id, overrides = {}) => ({ attributes: { OBJECTID: id, Z_VALUE: 10, STATUS: 3, FITTED: 2,
  ORIGINPLAN: 109, ORIGINHEIGHT: 109, SRSORIGINHEIGHT: 103, SRSORIGINPLAN: 457,
  ACCURACYPLAN: .025, ACCURACYHEIGHT: .04, REGDATE: Date.UTC(2024, 1, 2),
  REGSIGN: 'must-not-travel', MODIFICATIONSIGN: 'must-not-travel', COMMENTARY: 'must-not-travel', ...overrides },
geometry: { x: 640000 + id, y: 6636000 } });
const query = features => ({ geometryType: 'esriGeometryPoint', spatialReference: { wkid: 3006 }, features });
const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('upsala-height-test-')) throw new Error('unexpected test cleanup path');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function publishedFixture(heights, spacing = 1) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upsala-height-test-'));
  temporary.push(directory);
  const encoded = encodeTerrainGrid({ heights, width: 2, height: 2, heightScaleMetres: .01 });
  const bounds = { minEasting: 640000, minNorthing: 6636000, maxEasting: 640000 + spacing,
    maxNorthing: 6636000 + spacing, minHeightRH2000: encoded.minHeightRH2000, maxHeightRH2000: encoded.maxHeightRH2000 };
  const chunk = writeChunk({ header: { schemaVersion: 2, id: 'l0/0/0', kind: 'terrain',
    owner: { type: 'ground', id: 'upsala' }, bounds, payloadFormat: 'terrain-grid-u16-le-v1',
    requiredFeatures: ['chunk-envelope-v2', 'terrain-grid-u16-v1'],
    grid: { ...encoded.grid, sampleSpacingMetres: spacing, geometricErrorMetres: .005 } }, payload: encoded.payload });
  const terrain = assetReferenceForChunk(chunk, { kind: 'terrain', directory: 'grounds/upsala/terrain' });
  const write = (url, bytes) => { const filename = path.join(directory, url); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); };
  const jsonReference = (url, value) => {
    const bytes = Buffer.from(JSON.stringify(value)); write(url, bytes);
    return { url, bytes: bytes.length, sha256: sha(bytes) };
  };
  write(terrain.url, chunk);
  const groundManifest = jsonReference('ground.json', { groundId: 'upsala', frame: { horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613' },
    tiles: [{ id: 'l0/0/0', lod: 0, bounds, layers: { terrain } }] });
  const manifest = jsonReference('course.json', { groundManifest });
  jsonReference('courses/v2-index.json', { courses: [{ slug: 'upsala', groundId: 'upsala', manifest }] });
  return { directory, terrainPath: path.join(directory, terrain.url) };
}

describe('municipal ground-height diagnostic', () => {
  it('excludes unsuitable source rows before sampling and preserves large residuals and registration semantics', () => {
    const features = [point(1), point(2, { STATUS: 4 }), point(3, { SRSORIGINHEIGHT: 102 }),
      point(4, { FITTED: 1 }), point(5, { ORIGINHEIGHT: 201 }), point(6, { ACCURACYHEIGHT: null }),
      point(7, { REGDATE: Date.UTC(2026, 5, 4) }), point(8)];
    const called = [];
    const report = compareMunicipalGroundHeights(query(features), metadata, { sample(easting) {
      called.push(easting);
      return easting === 640008 ? { exclusion: 'outside-published-one-metre-coverage' } : { heightRH2000: easting === 640007 ? 12 : 10.1, tileId: 'fixture' };
    } });
    expect(called).toEqual([640001, 640007, 640008]);
    expect(report.counts).toEqual({ source: 8, eligibleForSampling: 3, included: 2, excluded: 6 });
    expect(report.outliers.map(r => r.objectId)).toEqual([7]);
    expect(report.metrics.meanM).toBe(1.05);
    expect(report.byRegistrationYear['2026'].count).toBe(1);
    expect(report.rows[6].measurementDate).toBeNull();
    expect(report.rows[6].registrationDate).toBe('2026-06-04');
    expect(JSON.stringify(report)).not.toMatch(/must-not-travel|REGSIGN|MODIFICATIONSIGN|COMMENTARY/);
  });

  it('refuses incomplete responses, changed domain meanings and duplicate identifiers', () => {
    const sampler = { sample() { throw new Error('must not sample'); } };
    expect(() => compareMunicipalGroundHeights({ ...query([]), exceededTransferLimit: true }, metadata, sampler)).toThrow(/truncated/);
    const changed = structuredClone(metadata); changed.fields[0].domain.codedValues[0].name = 'Planned';
    expect(() => compareMunicipalGroundHeights(query([]), changed, sampler)).toThrow(/code meanings changed/);
    expect(() => compareMunicipalGroundHeights(query([point(1, { STATUS: 4 }), point(1, { STATUS: 4 })]), metadata, sampler)).toThrow(/duplicate/);
  });

  it('uses verified bilinear 1 m terrain and refuses corrupted terrain assets', () => {
    const fixture = publishedFixture([10, 12, 14, 16]);
    const sampler = publishedOneMetreSampler(fixture.directory);
    expect(sampler.sample(640000.5, 6636000.5)).toEqual({ heightRH2000: 13, tileId: 'l0/0/0' });
    expect(sampler.sample(640001.1, 6636000.5)).toEqual({ exclusion: 'outside-published-one-metre-coverage' });
    const bytes = fs.readFileSync(fixture.terrainPath); bytes[bytes.length - 1] ^= 1;
    fs.writeFileSync(fixture.terrainPath, bytes);
    expect(() => publishedOneMetreSampler(fixture.directory).sample(640000.5, 6636000.5)).toThrow(/reference changed/);
  });

  it('requires all interpolation corners and never accepts a coarser tile as a 1 m check', () => {
    const incomplete = publishedFixture([10, 12, 14, Number.NaN]);
    expect(publishedOneMetreSampler(incomplete.directory).sample(640000.5, 6636000.5))
      .toEqual({ exclusion: 'incomplete-finite-one-metre-interpolation' });
    const coarse = publishedFixture([10, 12, 14, 16], 2);
    expect(() => publishedOneMetreSampler(coarse.directory).sample(640000.5, 6636000.5)).toThrow(/not a 1 m source/);
  });
});
