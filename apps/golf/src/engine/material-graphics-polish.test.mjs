import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createV2GroundMaterialDecorator } from './material.js';
import { SURFACE } from './surface.js';

const C = Object.fromEntries([
  'rough', 'forest', 'heath', 'semi', 'fair', 'fringe', 'green', 'tee',
  'sand', 'path', 'aspL', 'hard', 'soil', 'wet', 'rock', 'shore',
].map(name => [name, [0.3, 0.4, 0.2]]));
const SHADE = Array.from({ length: 32 }, () => [1.5, 0.4, 0.3, 0.6]);

function resources(representation) {
  const makeTexture = () => new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const DETAIL = makeTexture();
  const atlas = {
    bounds: { x0: 0, z0: 0, x1: 2, z1: 2, w: 2, h: 2, res: 1 },
    texF: makeTexture(), texID: makeTexture(), texSdf: [makeTexture()],
    data: { representation, channels: [SURFACE.GREEN, SURFACE.SAND, SURFACE.PATH],
      routeStepMetres: 0.25, ringStepMetres: 0.16 },
  };
  return { DETAIL, atlas };
}

/* Walk the actual TSL graph, retaining node identity: a channel reused by
   roughness must reference a sample already present in the colour graph. */
function textureSamples(roots, texture) {
  const seen = new Set(), samples = new Set();
  const visit = node => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.isTextureNode && node.value === texture) samples.add(node);
    for (const child of node.getChildren()) visit(child);
  };
  roots.forEach(visit);
  return samples;
}

describe.each(['class-sdf-v1', 'pair-sdf-v1'])('%s graphics polish', representation => {
  it('reuses the colour samples and preserves terrain normals and atlas authority', () => {
    const { atlas, DETAIL } = resources(representation);
    const owned = new Set([DETAIL, atlas.texF, atlas.texID, ...atlas.texSdf]);
    for (const graphicsPolish of [undefined, false, true]) {
      const normal = vec3(0, 1, 0), position = vec3(0, 0, 0);
      const material = new THREE.MeshStandardNodeMaterial();
      material.normalNode = normal;
      material.positionNode = position;
      const decorate = createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, graphicsPolish });
      decorate(material);
      expect(decorate.v2SurfaceAuthority).toBe(atlas);
      expect(material.normalNode).toBe(normal);
      expect(material.positionNode).toBe(position);
      expect(material.userData.graphicsPolish).toBe(graphicsPolish === true);
      expect(material.userData.surfaceRepresentation).toBe(representation);
      const colourSamples = textureSamples([material.colorNode], DETAIL);
      const allSamples = textureSamples([material.colorNode, material.roughnessNode], DETAIL);
      expect(colourSamples.size).toBe(4);
      expect(allSamples).toEqual(colourSamples);
      const roughnessSamples = textureSamples([material.roughnessNode], DETAIL);
      expect(roughnessSamples.size > 0).toBe(graphicsPolish === true);
      for (const tex of material.userData.terrainPreviewTextures) owned.add(tex);
      material.dispose();
    }
    for (const tex of owned) tex.dispose();
  });

  it('keeps classification diagnostics independent of the appearance option', () => {
    const { atlas, DETAIL } = resources(representation);
    const owned = new Set([DETAIL, atlas.texF, atlas.texID, ...atlas.texSdf]);
    for (const graphicsPolish of [false, true]) {
      const decorate = createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, graphicsPolish, debugMode: 'weights' });
      const material = decorate(new THREE.MeshStandardNodeMaterial());
      expect(material.userData.graphicsPolish).toBe(false);
      expect(material.toneMapped).toBe(false);
      expect(material.fog).toBe(false);
      expect(textureSamples([material.colorNode, material.roughnessNode, material.emissiveNode], DETAIL).size).toBe(0);
      for (const tex of material.userData.terrainPreviewTextures) owned.add(tex);
      material.dispose();
    }
    for (const tex of owned) tex.dispose();
  });
});
