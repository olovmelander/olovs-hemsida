import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadArchitectureFixture } from '../../../../../lidingobuild/architecture-fixture.mjs';
import { readChunk, sha256Bytes } from '../../../../../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../../../../packages/course-v2/terrain-grid.mjs';
import { loadLidingoFacilities, LIDINGO_PRIMARY_BUILDING_IDS } from './lidingo-facilities.mjs';

const PUBLIC = new URL('../../../public/', import.meta.url);
const json = relative => JSON.parse(readFileSync(new URL(relative, PUBLIC), 'utf8'));
const bytes = relative => readFileSync(new URL(relative, PUBLIC));
const arrayBuffer = data => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

function terrainSampler(manifest) {
  const graph = json('lidingo-ground-graph-report.json');
  const ground = json(`grounds/lidingo/ground-v2-${graph.graph.groundManifestSha256}.json`);
  const anchors = manifest.facilities.map(f => [677700.5+f.groundAnchorLocal[0],6586399.5-f.groundAnchorLocal[1]]);
  const tiles = ground.tiles.filter(t => t.lod === 0 && anchors.some(([e,n]) => e >= t.bounds.minEasting
    && e <= t.bounds.maxEasting && n >= t.bounds.minNorthing && n <= t.bounds.maxNorthing)).map(t => {
    const data = bytes(t.layers.terrain.url);
    expect(sha256Bytes(data)).toBe(t.layers.terrain.sha256);
    const { header, payload } = readChunk(data);
    expect(header.grid.sampleSpacingMetres).toBe(1);
    return { ...t, grid: header.grid, heights: decodeTerrainGrid(payload, header.grid) };
  });
  return (x,z) => {
    const e = 677700.5+x, n = 6586399.5-z;
    const tile = tiles.find(t => e >= t.bounds.minEasting && e <= t.bounds.maxEasting
      && n >= t.bounds.minNorthing && n <= t.bounds.maxNorthing);
    if (!tile) throw new Error(`Missing published terrain at ${x},${z}`);
    const { bounds:b, grid:g, heights:h } = tile, u = e-b.minEasting, v = b.maxNorthing-n;
    const i = Math.min(g.width-2,Math.floor(u)), j = Math.min(g.height-2,Math.floor(v));
    const a = u-i, c = v-j, k = j*g.width+i;
    return (h[k]*(1-a)+h[k+1]*a)*(1-c)+(h[k+g.width]*(1-a)+h[k+g.width+1]*a)*c;
  };
}

describe('Published Lidingö Blender facilities', () => {
  it('loads the shipping GLB through the production loader against the shipping pack and one metre terrain', async () => {
    const manifest = json('models/lidingo/facilities-v1.json');
    const data = bytes(manifest.asset.url);
    expect(manifest.asset.bytes).toBe(data.length);
    expect(manifest.asset.sha256).toBe(createHash('sha256').update(data).digest('hex'));
    const { model } = loadArchitectureFixture(), before = structuredClone(model.infra.buildings);
    const terrainH = terrainSampler(manifest), scene = new THREE.Scene();
    const result = await loadLidingoFacilities({ THREE, scene, courseSlug: 'lidingo', buildings: model.infra.buildings,
      terrainH, v2Active: true, verticalDatumOffsetMetres: 0, baseUrl: 'https://example.test/golf/',
      fetchImpl: async url => url.endsWith('.json') ? { ok: true, json: async () => manifest }
        : { ok: true, arrayBuffer: async () => arrayBuffer(data) } });
    expect(result.report.status, result.report.reason).toBe('loaded');
    try {
      expect(result.report.assetSha256).toBe(manifest.asset.sha256);
      expect(result.report.facilities).toHaveLength(manifest.facilities.length);
      expect(result.report.triangles).toBeGreaterThan(1000);
      expect(result.report.triangles).toBeLessThanOrEqual(750000);
      expect(result.report.replacesCourtyard).toBe(true); expect(result.report.replacesRangeFacilities).toBe(true);
      expect(LIDINGO_PRIMARY_BUILDING_IDS.every(id => result.replacedBuildingIds.has(id))).toBe(true);
      expect(result.report.facilities.every(f => f.shift === 0 && f.mode === 'absolute-rh2000')).toBe(true);
      // Anchors are evidence from the published terrain, not invented floor or
      // roof heights. A modest bound permits the exporter's 2 m interpolation.
      expect(Math.max(...result.report.facilities.map(f => Math.abs(f.groundResidualMetres)))).toBeLessThan(.4);
      expect(model.infra.buildings).toEqual(before);
      expect(scene.children).toEqual([result.root]);
      expect(result.facilityFootprints.length).toBe(manifest.facilities.filter(f => f.excludeVegetation).length);
      expect(result.report.facilities.find(f => f.id === 'courtyard')).toBeDefined();
      const replacementRoofCount = model.infra.buildings.filter(b => b.roofSurface && result.replacedBuildingIds.has(b.id)).length;
      expect(replacementRoofCount).toBe(5);
      expect(model.infra.buildings.filter(b => b.roofSurface).reduce((n,b) => n+b.roofSurface.triangleIndices.length/3,0)).toBe(7069);
    } finally {
      result.dispose();
    }
    expect(scene.children).toEqual([]); expect(result.replacedBuildingIds.size).toBe(0);
  });
});
