import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { fitGroundContact, loadFacilities, validateFacilitiesManifest } from './veckefjarden-facilities.mjs';

const original = JSON.parse(fs.readFileSync(new URL('../../../public/models/veckefjarden/facilities-v1.json', import.meta.url)));
const bytes = fs.readFileSync(new URL('../../../public/models/veckefjarden/facilities-v1.glb', import.meta.url));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
function context(overrides = {}) {
  const manifest = structuredClone(original), buildings = [], parking = [];
  for (const f of manifest.facilities) {
    for (const { index, ring } of f.sourceBuildingRingsLocal) buildings[index] = { ring: structuredClone(ring) };
    for (const { index, ring } of f.sourceParkingRingsLocal) parking[index] = { ring: structuredClone(ring) };
  }
  const fetchImpl = vi.fn(async url => url.endsWith('.json')
    ? { ok: true, json: async () => manifest } : { ok: true, arrayBuffer: async () => buffer });
  return { THREE, scene: new THREE.Scene(), courseSlug: 'veckefjarden', buildings, parking,
    terrainH: () => 50, v2Active: true, verticalDatumOffsetMetres: 20.9924,
    baseUrl: 'https://example.test/golf/', manifest, fetchImpl, ...overrides };
}

describe('Veckefjarden Blender facilities', () => {
  it('loads the actual optimized GLB, retains all 20 groups, and replaces only identified outlines', async () => {
    const c = context(), result = await loadFacilities(c);
    expect(result.report.status, result.report.reason).toBe('loaded');
    expect(result.root.parent).toBe(c.scene);
    expect(result.report.facilities).toHaveLength(20);
    expect(result.report.triangles).toBe(44422);
    expect(result.replacedBuildingIds.size).toBe(0); // pack has no IDs; never store undefined
    expect([...result.replacedBuildingIndices].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5, 6, 24, 25, 26, 28]);
    expect([...result.replacedParkingIndices].sort()).toEqual([0, 1, 3]);
    expect(c.fetchImpl.mock.calls.map(args => args[0])).toEqual([
      'https://example.test/golf/models/veckefjarden/facilities-v1.json',
      'https://example.test/golf/models/veckefjarden/facilities-v1.glb',
    ]);
    for (const node of result.root.children) {
      const source = original.facilities.find(f => f.id === node.userData.facilityId);
      const placement = result.report.facilities.find(f => f.id === node.userData.facilityId);
      const bounds = new THREE.Box3().setFromObject(node);
      expect(bounds.min.y - placement.boundsAfterGroundContact.min[1]).toBeCloseTo(20.9924, 5);
      expect(placement.boundsBeforePlacement.min[1]).toBeCloseTo(source.boundsLocalRh2000.min[1], 3);
      expect(bounds.min.x).toBeCloseTo(source.boundsLocalRh2000.min[0], 3);
      expect(bounds.max.z).toBeCloseTo(source.boundsLocalRh2000.max[2], 3);
    }
    const geometry = result.root.children[0].children[0].geometry;
    const disposed = vi.spyOn(geometry, 'dispose');
    result.dispose(); result.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(c.scene.children).toHaveLength(0);
    expect(result.replacedBuildingIndices.size).toBe(0);
  });

  it('fits paving over a ridge between model vertices while preserving the plan coordinates', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 2], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const terrain = (x, z) => 10 + Math.max(0, .4 - Math.hypot(x - 1, z - 1) * .3);
    const fit = fitGroundContact(g, terrain, 10);
    expect(fit.samples).toBeGreaterThan(4);
    expect(fit.maximumLiftMetres).toBeCloseTo(.5, 5);
    const p = g.getAttribute('position');
    expect(Array.from({ length: 4 }, (_, i) => [p.getX(i), p.getZ(i)])).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect((p.getY(0) + p.getY(2)) / 2 + 10).toBeGreaterThanOrEqual(terrain(1, 1) + .099);
    g.dispose();
  });

  it('accepts the short course frame and rejects changed or reordered building footprints', () => {
    const c = context({ courseSlug: 'veckefjarden-korthalsbanan' });
    expect(validateFacilitiesManifest(c.manifest, c)).toBe(c.manifest);
    c.buildings[3].ring[0][0] += 2;
    expect(() => validateFacilitiesManifest(c.manifest, c)).toThrow(/footprint changed/);
    expect(() => validateFacilitiesManifest(original, { ...c, courseSlug: 'johannesberg' })).toThrow(/another course/);
  });

  it('retains all source fallbacks on a corrupt asset or changed parking', async () => {
    const c = context(); c.manifest.asset.sha256 = '0'.repeat(64);
    const result = await loadFacilities(c);
    expect(result.report.status).toBe('fallback');
    expect(result.report.reason).toMatch(/checksum/);
    expect(result.root).toBeNull();
    expect(result.replacedBuildingIndices.size + result.replacedParkingIndices.size).toBe(0);
    expect(c.scene.children).toHaveLength(0);
    const changed = context(); changed.parking[0].ring[0][1] += 1;
    expect((await loadFacilities(changed)).report.reason).toMatch(/parking changed/);
  });

  it('does not attach geometry after navigation or use an incorrect height bridge', async () => {
    const cancelled = context({ isCurrentCourse: () => false });
    expect((await loadFacilities(cancelled)).report.status).toBe('fallback');
    expect(cancelled.fetchImpl).not.toHaveBeenCalled();
    const wrongHeight = context({ verticalDatumOffsetMetres: 0 });
    const result = await loadFacilities(wrongHeight);
    expect(result.report.reason).toMatch(/height bridge mismatch/);
    expect(wrongHeight.scene.children).toHaveLength(0);
    expect(result.replacedBuildingIndices.size).toBe(0);
  });
});
