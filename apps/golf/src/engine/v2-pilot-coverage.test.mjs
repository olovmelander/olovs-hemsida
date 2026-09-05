import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { createSurfacePreviewAtlas } from './v2-surface-preview-atlas.mjs';
import { SURFACE } from './surface.js';
import {
  PUTTOM_PREVIEW_CONFIG,
  alignTerrainPreviewToLegacyFrame,
} from './v2-puttom-preview.mjs';

/* ------------------------------------------------- does the pilot reach the course

   The 16-tile pilot did not, and no placement of a 1024 m window could: the
   best one still left 183 played vertices outside, among them three greens.
   This is the gate on the answer, stated in the units the question was asked
   in -- greens, bunkers, tees -- because "64 tiles" is not an answer to it. */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PUBLIC = `${REPO}apps/golf/public`;
const ROOT = `${PUBLIC}/${PUTTOM_PREVIEW_CONFIG.descriptorPath}`.replace(/\/[^/]+$/, '');

async function pilot() {
  const descriptor = JSON.parse(readFileSync(`${PUBLIC}/${PUTTOM_PREVIEW_CONFIG.descriptorPath}`, 'utf8'));
  const resources = await Promise.all(descriptor.tiles.map(async tile => {
    const decoded = await verifyChunkAsset(tile.reference, new Uint8Array(readFileSync(`${ROOT}/${tile.reference.url}`)));
    return createTerrainRenderResource({
      tileId: tile.id,
      frame: descriptor.frame,
      decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
    });
  }));
  const aligned = alignTerrainPreviewToLegacyFrame(
    { descriptor, resources },
    PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006,
    PUTTOM_PREVIEW_CONFIG.legacyFrame,
  );
  const surfaceDescriptor = JSON.parse(
    readFileSync(`${PUBLIC}/${PUTTOM_PREVIEW_CONFIG.surfaceDescriptorPath}`, 'utf8'));
  const surfaceResources = await Promise.all(surfaceDescriptor.tiles.map(async tile => ({
    tileId: tile.id,
    ...await verifyChunkAsset(tile.reference, new Uint8Array(readFileSync(`${ROOT}/${tile.reference.url}`))),
  })));
  const atlas = createSurfacePreviewAtlas({
    resources: surfaceResources, frame: descriptor.frame, bridge: aligned.bridge,
  });
  return { aligned, atlas, descriptor, surfaceDescriptor };
}

const centroid = ring => [
  ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
  ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
];

describe('the pilot reaches the whole course', () => {
  it('carries 1 m terrain under every green, bunker, tee and hole line', async () => {
    const { aligned, atlas, descriptor, surfaceDescriptor } = await pilot();
    expect(descriptor.tiles.length).toBe(PUTTOM_PREVIEW_CONFIG.expectedTileCount);
    expect(surfaceDescriptor.tiles.length).toBe(PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount);
    const model = JSON.parse(readFileSync(`${REPO}puttombuild/course-model.json`, 'utf8'));
    const on = (x, z) => Number.isFinite(aligned.sample(x, z));
    const count = { greens: [0, 0], bunkers: [0, 0], tees: [0, 0], line: [0, 0], painted: [0, 0] };
    for (const hole of model.holes) {
      if (hole.green?.c) {
        count.greens[1]++;
        if (on(...hole.green.c)) count.greens[0]++;
        const sample = atlas.sampleAt(...hole.green.c);
        count.painted[1]++;
        /* the occupying class, which both surface representations report */
        if (sample?.surface === SURFACE.GREEN) count.painted[0]++;
      }
      for (const bunker of hole.bunkers || []) if (bunker.ring?.length) {
        count.bunkers[1]++; if (on(...centroid(bunker.ring))) count.bunkers[0]++;
      }
      for (const pad of hole.tees?.pads || []) if (pad.ring?.length) {
        count.tees[1]++; if (on(...centroid(pad.ring))) count.tees[0]++;
      }
      for (const point of hole.line || []) { count.line[1]++; if (on(point[0], point[1])) count.line[0]++; }
    }
    /* the practice ground's bunker beside the inspelsgreen is the 41st: it
       used to be assigned to the 14th as a fairway bunker 29 m from the tee */
    for (const ring of model.scenery?.bunkers || []) if (ring.length) {
      count.bunkers[1]++; if (on(...centroid(ring))) count.bunkers[0]++;
    }
    atlas.dispose();
    /* every one, not most: this is the whole point of the widening.
       The 29 tee pads are the ones the committed MODEL carries; the app infers
       a pad per card tee on top of them, so a running page has 72. The browser
       probe is what covers those, and reports all 72 on v2 -- this file cannot,
       because the inference lives in main.js and needs a document. */
    expect(count.greens).toEqual([18, 18]);
    expect(count.bunkers).toEqual([41, 41]);
    expect(count.tees).toEqual([29, 29]);
    expect(count.line[0]).toBe(count.line[1]);
    /* and the surface, which covers only the played window, still paints them */
    expect(count.painted).toEqual([18, 18]);
  }, 120_000);
});
