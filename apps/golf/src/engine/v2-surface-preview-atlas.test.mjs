import { describe, expect, it } from 'vitest';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import { compileSurfacePreviewAssets } from '../../../../packages/course-v2/surface-compiler-node.mjs';
import { decodeSurfaceGrid } from '../../../../packages/course-v2/surface-grid.mjs';
import { SURFACE } from './surface.js';
import { createSurfacePreviewAtlas } from './v2-surface-preview-atlas.mjs';

const frame = Object.freeze({
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
  origin: Object.freeze({ easting: 650004, northing: 6640004, heightRH2000: 20 }),
  axisMapping: Object.freeze({
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  }),
  fingerprint: 'f'.repeat(64),
});

function bounds(minEasting, minNorthing, maxEasting, maxNorthing) {
  return { minEasting, minNorthing, minHeightRH2000: 19, maxEasting, maxNorthing, maxHeightRH2000: 22 };
}

function resources() {
  const compiled = compileSurfacePreviewAssets({
    groundId: 'atlas-test', frame, legacyBridge: { translateX: 3, translateZ: -2 },
    terrainTiles: [
      { id: 'l0/0/0', bounds: bounds(650000, 6640004, 650004, 6640008), sampleSpacingMetres: 1 },
      { id: 'l0/0/1', bounds: bounds(650000, 6640000, 650004, 6640004), sampleSpacingMetres: 1 },
      { id: 'l0/1/0', bounds: bounds(650004, 6640004, 650008, 6640008), sampleSpacingMetres: 1 },
      { id: 'l0/1/1', bounds: bounds(650004, 6640000, 650008, 6640004), sampleSpacingMetres: 1 },
    ],
    holes: [{ n: 1, line: [[-1, -2], [3, 2]] }],
    features: [{
      surface: SURFACE.GREEN,
      rings: [[[2, -3], [4, -3], [4, -1], [2, -1]]],
      hole: 1,
    }],
    codec: 'raw',
  });
  return compiled.tiles.map(tile => {
    const decoded = verifyChunkAsset(tile.reference, compiled.resources.get(tile.reference.url));
    return {
      tileId: tile.id,
      header: decoded.header,
      payload: decoded.payload,
      values: decodeSurfaceGrid(decoded.payload, decoded.header.surfaceGrid),
    };
  });
}

describe('v2 surface preview atlas', () => {
  it('stitches a regular verified tile frontier into material textures', () => {
    const atlas = createSurfacePreviewAtlas({
      resources: resources(), frame, bridge: { translateX: 3, translateZ: -2 },
    });
    expect(atlas.bounds).toMatchObject({ x0: -1.5, z0: -6.5, x1: 7.5, z1: 2.5, w: 9, h: 9, res: 1 });
    expect(atlas.data.tileIds).toEqual(['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1']);
    expect(atlas.data.classCounts[SURFACE.GREEN]).toBeGreaterThan(0);
    expect(atlas.data.classCounts[SURFACE.ROUGH]).toBeGreaterThan(0);
    expect(atlas.data.primaryClassCounts[SURFACE.ROUGH]).toBe(0);
    expect(atlas.sampleAt(-1, -6)).toMatchObject({
      inBounds: true,
      surface: SURFACE.ROUGH,
      primary: SURFACE.GREEN,
      secondary: SURFACE.ROUGH,
    });
    expect(atlas.sampleAt(3, -2)).toMatchObject({ inBounds: true, surface: SURFACE.GREEN });
    expect(atlas.sampleAt(100, 100)).toMatchObject({ inBounds: false, surface: SURFACE.ROUGH });
    atlas.dispose();
  });

  it('fails closed when a shared surface sample differs across a tile seam', () => {
    const broken = resources();
    broken[1].payload = new Uint8Array(broken[1].payload);
    broken[1].payload[0] ^= 1;
    expect(() => createSurfacePreviewAtlas({
      resources: broken, frame, bridge: { translateX: 3, translateZ: -2 },
    })).toThrow(/seam mismatch/);
  });
});
