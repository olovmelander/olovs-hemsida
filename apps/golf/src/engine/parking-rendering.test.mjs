import fs from 'node:fs';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRoadGravel } from './road-material.mjs';
import { parkingSurface } from './road-surface.mjs';
import { shouldRenderLegacySurfaceOverlays } from './surface-render-policy.mjs';
import { SURFACE } from './surface.js';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('  const lots =', main.indexOf('const PARKING_RENDER_PROOFS'));
const source = main.slice(start, main.indexOf('  const posts = [];', start));
const ring = [[0, 0], [20, 0], [20, 20], [0, 20]];
const lots = [
  { id: 'paved', ring, surface: 'asphalt', prov: 'dated-orthophoto-trace' },
  { id: 'gravel', ring, surface: 'unpaved' },
  { id: 'authored', ring, surface: 'asphalt' },
];

function renderParking({ groundMode, v2Active }) {
  const scene = new THREE.Scene(), stats = {}, proofs = [], polygons = [];
  const detail = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  const run = new Function('M', 'facilityArchitecture', 'stats', 'PARKING_RENDER_PROOFS',
    'parkingSurface', 'legacySurfaceOverlays', 'C', 'fbm', 'SURFACE', 'surfaceMesh', 'THREE',
    'nudged', 'makeGravel', 'scene', source);
  run({ infra: { parking: lots } }, { replacedParkingIndices: new Set([2]) }, stats, proofs,
    parkingSurface, shouldRenderLegacySurfaceOverlays({ groundMode, v2Active }),
    { gravel: [.2, .2, .2], aspL: [.1, .1, .1] }, () => 0, SURFACE,
    values => { polygons.push(...values); return new THREE.BufferGeometry(); }, THREE,
    (tier, factory) => factory(), () => createRoadGravel(detail), scene);
  return { scene, stats, proofs, polygons, dispose() {
    for (const mesh of scene.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
    detail.dispose();
  } };
}

describe('shared parking renderer', () => {
  it.each([['atlas', false], ['atlas', true], ['mesh', true]])(
    'does not overlay terrain-owned parking in %s mode with v2=%s', (groundMode, v2Active) => {
      const result = renderParking({ groundMode, v2Active });
      expect(result.scene.children).toHaveLength(0);
      expect(result.polygons).toHaveLength(0);
      expect(result.proofs.map(p => p.renderer)).toEqual(['terrain', 'terrain']);
      result.dispose();
    });

  it('uses a matte material with one vertex-colour application in the real mesh fallback', () => {
    const result = renderParking({ groundMode: 'mesh', v2Active: false });
    expect(result.scene.children).toHaveLength(1);
    const material = result.scene.children[0].material;
    expect(material.vertexColors).toBe(false);
    expect(material.roughness).toBeGreaterThan(.9);
    expect(result.polygons[0].shade(0, 0).col).toEqual([.096, .096, .096]);
    expect(result.polygons[1].shade(0, 0).col).toEqual([.19, .19, .19]);
    expect(result.polygons[0].rings).toEqual([ring]);
    result.dispose();
  });

  it('retains authored replacements as the sole owner of their parking footprint', () => {
    const result = renderParking({ groundMode: 'mesh', v2Active: false });
    expect(result.stats.sourceParkingBatchIndices).toEqual([0, 1]);
    expect(result.stats.sourceParkingBatchIds).toEqual(['paved', 'gravel']);
    expect(result.polygons).toHaveLength(2);
    result.dispose();
  });
});
