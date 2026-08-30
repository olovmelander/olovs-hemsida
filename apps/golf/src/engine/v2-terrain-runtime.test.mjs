import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import { createSyntheticAssetGraph } from '../../../../packages/course-v2/synthetic-fixture.mjs';
import { prepareTerrainRenderData } from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import {
  CourseV2TerrainRuntime,
  activeHoleTerrainTileIds,
  worldToCanonicalCamera,
} from './v2-terrain-runtime.mjs';

function fixture() {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses.find(candidate => candidate.slug === 'synthetic-main');
  const course = JSON.parse(graph.resources.get(entry.manifest.url));
  const ground = JSON.parse(graph.resources.get(course.groundManifest.url));
  const decoded = new Map();
  for (const reference of [ground.shell, ...ground.tiles.map(tile => tile.layers.terrain)]) {
    const verified = verifyChunkAsset(reference, graph.resources.get(reference.url));
    decoded.set(reference.url, {
      ...verified,
      terrainRenderData: prepareTerrainRenderData(verified),
    });
  }
  const loader = {
    request: vi.fn(async reference => decoded.get(reference.url)),
    reprioritizeScope: vi.fn(),
    stats: () => ({ queued: 0, running: 0, jobs: 0 }),
  };
  return { course, ground, loader };
}

async function settle(predicate) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('runtime did not settle');
}

describe('isolated v2 terrain runtime', () => {
  it('maps Banvy world axes to EPSG:5845 and resolves active-hole tiles', () => {
    const { course, ground } = fixture();
    expect(worldToCanonicalCamera({ x: 12, y: 3, z: 40 }, ground.frame)).toEqual({
      easting: 650012,
      northing: 6640216,
      heightRH2000: 23,
    });
    expect(activeHoleTerrainTileIds(course, 1)).toEqual(['l0/0/0']);
    expect(activeHoleTerrainTileIds(course, 99)).toEqual([]);
  });

  it('streams shell to regular tiles, batches one draw and exposes the same CPU height', async () => {
    const { course, ground, loader } = fixture();
    const scene = new THREE.Scene();
    let now = 0;
    const invalidated = vi.fn();
    const runtime = new CourseV2TerrainRuntime({
      ground,
      course,
      scene,
      backend: 'webgl2',
      mobile: true,
      assetLoader: loader,
      clock: () => now,
      onInvalidate: invalidated,
    });
    const camera = new THREE.PerspectiveCamera(48, 1, 1, 2000);
    camera.position.set(64, 50, 192);
    camera.lookAt(64, 0, 192);
    runtime.update({
      camera,
      viewportHeightPixels: 720,
      activeHoleNumber: 1,
      visible: () => true,
    });
    await settle(() => runtime.snapshot().stream.readyTileIds.length === 3);
    const snapshot = runtime.snapshot();
    expect(snapshot.profile).toEqual({ targetErrorPixels: 2.5, maximumSelectedTiles: 16 });
    expect(snapshot.stream.coverageComplete ?? snapshot.stream.plan.coverageComplete).toBe(true);
    expect(snapshot.renderer).toMatchObject({
      renderedTiles: 2,
      drawCalls: 1,
    });
    expect(loader.request).toHaveBeenCalledTimes(3);
    expect(invalidated).toHaveBeenCalled();
    expect(runtime.heightAt(64, 192)).toEqual({
      height: 0.5,
      tileId: 'l0/0/0',
      sampleSpacingMetres: 64,
    });
    now = 300;
    expect(runtime.tick().morphing).toBe(false);
    runtime.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
