import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import { compileSurfacePreviewAssets } from '../../../../packages/course-v2/surface-compiler-node.mjs';
import { createV2GroundMaterialDecorator } from './material.js';
import { SURFACE, surfaceTransitionWidthMetres } from './surface.js';
import { createSurfacePreviewAtlas } from './v2-surface-preview-atlas.mjs';

const frame = Object.freeze({
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
  origin: Object.freeze({ easting: 650008, northing: 6640008, heightRH2000: 20 }),
  axisMapping: Object.freeze({
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  }),
  fingerprint: 'e'.repeat(64),
});
const bridge = Object.freeze({ translateX: 0, translateZ: 0 });

function bounds(minEasting, minNorthing, maxEasting, maxNorthing) {
  return { minEasting, minNorthing, minHeightRH2000: 19, maxEasting, maxNorthing, maxHeightRH2000: 22 };
}

/* a green inside a fairway inside rough; world (0,0) is the green centre */
function resources() {
  const compiled = compileSurfacePreviewAssets({
    groundId: 'class-sdf-test', frame, legacyBridge: bridge,
    terrainTiles: [
      { id: 'l0/0/0', bounds: bounds(650000, 6640008, 650008, 6640016), sampleSpacingMetres: 1 },
      { id: 'l0/0/1', bounds: bounds(650000, 6640000, 650008, 6640008), sampleSpacingMetres: 1 },
      { id: 'l0/1/0', bounds: bounds(650008, 6640008, 650016, 6640016), sampleSpacingMetres: 1 },
      { id: 'l0/1/1', bounds: bounds(650008, 6640000, 650016, 6640008), sampleSpacingMetres: 1 },
    ],
    holes: [{ n: 5, line: [[-7, -7], [7, 7]] }],
    features: [
      { surface: SURFACE.FAIRWAY, rings: [[[-6, -6], [6, -6], [6, 6], [-6, 6]]], hole: 5 },
      { surface: SURFACE.GREEN, rings: [[[-3, -3], [3, -3], [3, 3], [-3, 3]]], hole: 5 },
    ],
    codec: 'raw',
    representation: 'class-sdf-v1',
  });
  return compiled.tiles.map(tile => {
    const decoded = verifyChunkAsset(tile.reference, compiled.resources.get(tile.reference.url));
    return { tileId: tile.id, header: decoded.header, payload: decoded.payload, inspection: decoded.inspection };
  });
}

const C = {
  rough: [0.10, 0.20, 0.05], forest: [0.08, 0.15, 0.05], heath: [0.2, 0.2, 0.1],
  semi: [0.15, 0.30, 0.08], fair: [0.18, 0.36, 0.09], fringe: [0.16, 0.33, 0.08],
  green: [0.14, 0.38, 0.10], tee: [0.16, 0.34, 0.09], sand: [0.8, 0.75, 0.6],
  path: [0.5, 0.5, 0.5], aspL: [0.3, 0.3, 0.3], hard: [0.45, 0.42, 0.38], soil: [0.3, 0.25, 0.2],
  wet: [0.2, 0.25, 0.15], rock: [0.4, 0.4, 0.4], shore: [0.5, 0.45, 0.35],
};
const SHADE = Array.from({ length: 32 }, () => [1.5, 0.4, 0.3, 0.6]);

describe('class-sdf-v1 atlas and material', () => {
  it('stitches per-class SDF tiles into mipmapped textures with a rough complement', () => {
    const atlas = createSurfacePreviewAtlas({ resources: resources(), frame, bridge });
    expect(atlas.data.representation).toBe('class-sdf-v1');
    expect(atlas.data.channels).toEqual([SURFACE.FAIRWAY, SURFACE.GREEN]);
    expect(atlas.texID).toBeNull();
    expect(atlas.texSdf).toHaveLength(1);
    expect(atlas.texSdf[0].generateMipmaps).toBe(true);
    expect(atlas.texSdf[0].minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(atlas.texF.generateMipmaps).toBe(false);
    expect(atlas.bounds).toMatchObject({ x0: -8.5, z0: -8.5, x1: 8.5, z1: 8.5, w: 17, h: 17, res: 1 });
    expect(atlas.data.classCounts[SURFACE.GREEN]).toBeGreaterThan(0);
    expect(atlas.data.classCounts[SURFACE.FAIRWAY]).toBeGreaterThan(0);
    expect(atlas.data.classCounts[SURFACE.ROUGH]).toBeGreaterThan(0);
    expect(atlas.data.textureBytes).toBe(17 * 17 * 8);

    /* the green centre is all green; the far corner is all rough */
    const centre = atlas.probeAt(0, 0);
    expect(centre.surface).toBe(SURFACE.GREEN);
    expect(centre.weights.find(item => item.surface === SURFACE.GREEN).weight).toBeCloseTo(1, 6);
    expect(centre.weightSum).toBeCloseTo(1, 12);
    expect(centre.owner).toBe(5);
    expect(centre.ringCoordinateMetres).toBeGreaterThan(2.5);
    const corner = atlas.probeAt(-8, -8);
    expect(corner.surface).toBe(SURFACE.ROUGH);
    expect(corner.weights.find(item => item.surface === SURFACE.ROUGH).weight).toBeCloseTo(1, 6);
    expect(atlas.probeAt(100, 100)).toMatchObject({ inBounds: false, surface: SURFACE.ROUGH });

    /* walking across the green edge at x = 3 the green weight falls through
       0.5 within the green's physical transition width and the pair sums to 1 */
    const width = Math.max(surfaceTransitionWidthMetres(SURFACE.GREEN), surfaceTransitionWidthMetres(SURFACE.FAIRWAY));
    let crossing = null;
    let previous = atlas.probeAt(2.0, 0).weights.find(item => item.surface === SURFACE.GREEN).weight;
    for (let x = 2.05; x <= 4; x += 0.05) {
      const probe = atlas.probeAt(x, 0);
      const green = probe.weights.find(item => item.surface === SURFACE.GREEN).weight;
      const fairway = probe.weights.find(item => item.surface === SURFACE.FAIRWAY).weight;
      expect(probe.weightSum).toBeCloseTo(1, 12);
      /* with the pair-width rule both sides of a two-class edge blend over the
         same width, so the raw sum stays within the byte quantisation of 1 */
      expect(probe.weightError).toBeLessThan(0.02);
      /* and rough never appears between two mown classes: the regression a
         distance-complement would have drawn as a seam along every green */
      expect(probe.weights.find(item => item.surface === SURFACE.ROUGH).weight).toBeLessThan(1e-6);
      if (previous >= 0.5 && green < 0.5) crossing = x;
      previous = green;
      if (x > 3 + width + 0.3) expect(fairway).toBeCloseTo(1, 3);
    }
    expect(crossing).not.toBeNull();
    expect(Math.abs(crossing - 3)).toBeLessThanOrEqual(0.25);
    atlas.dispose();
  });

  it('decorates the terrain material without sampling any id', () => {
    const atlas = createSurfacePreviewAtlas({ resources: resources(), frame, bridge });
    const DETAIL = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const debugMode of ['off', 'weights']) {
      const decorate = createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, debugMode });
      const material = decorate(new THREE.MeshStandardNodeMaterial());
      expect(material.userData.surfaceRepresentation).toBe('class-sdf-v1');
      expect(material.userData.surfaceChannels).toEqual([SURFACE.FAIRWAY, SURFACE.GREEN]);
      expect(material.userData.surfaceDebugMode).toBe(debugMode);
      expect(material.colorNode).toBeTruthy();
      expect(material.roughnessNode).toBeTruthy();
      if (debugMode === 'weights') expect(material.emissiveNode).toBeTruthy();
    }
    atlas.dispose();
  });

  it('fails closed on a mixed payload format and on a seam mismatch', () => {
    const mixed = resources();
    mixed[0] = { ...mixed[0], header: { ...mixed[0].header, payloadFormat: 'surface-grid-u8-i16-le-v1' } };
    expect(() => createSurfacePreviewAtlas({ resources: mixed, frame, bridge })).toThrow(/one payload format/);
    const broken = resources();
    broken[1].payload = new Uint8Array(broken[1].payload);
    broken[1].payload[0] ^= 0x40;
    expect(() => createSurfacePreviewAtlas({ resources: broken, frame, bridge })).toThrow(/seam mismatch/);
  });
});
