import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { applyUpsalaPracticePath } from '../tools/apply-upsala-practice-path.mjs';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const evidence = JSON.parse(fs.readFileSync(new URL('../upsalabuild/mapping/practice-path-review-2026-09-07.json', import.meta.url)));
const fixture = () => ({ ...structuredClone(evidence.frame),
  infra: { tracks: [structuredClone(evidence.features[0].replacesTrack)] }, scenery: { mappedFeatures: [] } });

describe('reviewed municipal practice path', () => {
  it('replaces the coarse strip with the exact polygon, without publishing source coordinates', () => {
    const model = applyUpsalaPracticePath(fixture(), evidence);
    expect(model.infra.tracks).toEqual([]);
    expect(model.scenery.mappedFeatures[0].rings).toEqual([evidence.features[0].ring]);
    expect(model.scenery.mappedFeatures[0].horizontalAccuracyMetres).toBeNull();
    expect(collectCoordinatePairs(model).coordinates.every(({ pair }) => pair.every(n => Math.abs(n) < 1000))).toBe(true);
  });
  it('rejects a changed source or repeated adoption before mutation', () => {
    const model = fixture(); model.infra.tracks[0].line[0][0] += 1;
    const original = structuredClone(model);
    expect(() => applyUpsalaPracticePath(model, evidence)).toThrow(/source track changed/);
    expect(model).toEqual(original);
    const done = applyUpsalaPracticePath(fixture(), evidence);
    const saved = structuredClone(done);
    expect(() => applyUpsalaPracticePath(done, evidence)).toThrow();
    expect(done).toEqual(saved);
  });
  it('retains a simple positive-area polygon when source segments join', () => {
    const ring = evidence.features[0].ring;
    const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for (let i = 0; i < ring.length; i++) for (let j = i+2; j < ring.length; j++) {
      if (i === 0 && j === ring.length-1) continue;
      const a=ring[i], b=ring[(i+1)%ring.length], c=ring[j], d=ring[(j+1)%ring.length];
      expect(cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0).toBe(false);
    }
  });
});
