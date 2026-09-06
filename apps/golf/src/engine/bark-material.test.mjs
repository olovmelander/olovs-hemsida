import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { averageBarkSample, createBarkMaterial } from './bark-material.mjs';

function nodes(root) {
  const found = new Set();
  const visit = node => {
    if (!node || found.has(node)) return;
    found.add(node);
    for (const child of node.getChildren()) visit(child);
  };
  visit(root);
  return [...found];
}
const makeTexture = () => new THREE.DataTexture(new Uint8Array(16), 2, 2);
const scalarConstants = root => nodes(root).filter(node => node.isConstNode && typeof node.value === 'number').map(node => node.value);

describe('hero bark material', () => {
  it('aligns colour and relief UVs while keeping derivative samples independently cacheable', () => {
    const barkTexture = makeTexture();
    const material = createBarkMaterial({ barkTexture, hex: 0xc9c6b2, graphicsPolish: true });
    const colourNodes = nodes(material.colorNode), reliefNodes = nodes(material.normalNode);
    const colourSamples = colourNodes.filter(node => node.isTextureNode);
    const reliefSamples = reliefNodes.filter(node => node.isTextureNode);
    expect(colourSamples).toHaveLength(1);
    expect(reliefSamples).toHaveLength(1);
    expect(reliefSamples[0]).not.toBe(colourSamples[0]);
    expect(reliefSamples[0].uvNode).toBe(colourSamples[0].uvNode);
    expect(colourSamples[0].value).toBe(barkTexture);
    expect(reliefSamples[0].value).toBe(barkTexture);
    expect(new Set([...colourSamples, ...reliefSamples].map(sample => sample.value)).size).toBe(1);
    expect(colourNodes).not.toContain(material.normalNode.textureNode);
    expect(scalarConstants(material.normalNode.scaleNode)).toEqual([0.05]);
    expect(material.bumpMap).toBeNull();
    expect(material.positionNode).toBeNull();
    expect(material.opacityNode).toBeNull();
    expect(material.roughness).toBe(0.95);
    expect(material.metalness).toBe(0);
    const uvScale = nodes(colourSamples[0].uvNode).find(node => node.isConstNode && node.value?.isVector2);
    expect(uvScale.value.toArray()).toEqual([3, 1.5]);
    material.dispose();
    barkTexture.dispose();
  });

  it('keeps conventional bump UVs and original albedo gain when the preview is disabled', () => {
    const barkTexture = makeTexture();
    for (const hex of [0x3f3122, 0x6b4326, 0xc9c6b2]) {
      const material = createBarkMaterial({ barkTexture, hex, meanSample: 0.25 });
      expect(material.normalNode).toBeNull();
      expect(material.bumpMap).toBe(barkTexture);
      expect(material.bumpScale).toBe(0.05);
      expect(material.color.toArray()).toEqual(new THREE.Color(hex).toArray());
      expect(scalarConstants(material.colorNode)).toContain(0.62);
      expect(scalarConstants(material.colorNode)).toContain(0.6);
      expect(scalarConstants(material.colorNode)).not.toContain(0.85);
      expect(nodes(material.colorNode).filter(node => node.isTextureNode)).toHaveLength(1);
      material.dispose();
    }
    barkTexture.dispose();
  });

  it('centres albedo using measured bytes while retaining the same contrast operations', () => {
    const pixels = new Uint8ClampedArray([0, 17, 240, 255, 51, 250, 2, 255, 204, 0, 14, 255, 255, 19, 33, 255]);
    const meanSample = averageBarkSample(pixels);
    expect(meanSample).toBe(0.5);
    const barkTexture = makeTexture();
    const material = createBarkMaterial({ barkTexture, hex: 0x6b4326, graphicsPolish: true, meanSample });
    const constants = scalarConstants(material.colorNode);
    expect(constants).toContain(0.7);
    expect(constants).toContain(0.6);
    expect(constants).not.toContain(0.62);
    const operators = nodes(material.colorNode).filter(node => node.isOperatorNode).map(node => node.op).sort();
    expect(operators).toEqual(['*', '*', '*', '+']);
    material.dispose();
    barkTexture.dispose();
  });

  it('can align relief without changing the established colour gain', () => {
    const barkTexture = makeTexture();
    const material = createBarkMaterial({ barkTexture, hex: 0x3f3122, graphicsPolish: true });
    expect(material.normalNode).not.toBeNull();
    expect(scalarConstants(material.colorNode)).toContain(0.62);
    material.dispose();
    barkTexture.dispose();
  });

  it('measures the quantized red channel and rejects invalid pixels or means', () => {
    const pixels = new Uint8ClampedArray([0.51, 255, 255, 255, 254.49, 0, 0, 0]);
    expect(averageBarkSample(pixels)).toBe((1 + 254) / 2 / 255);
    for (const invalid of [[], new Uint8Array(), new Uint8Array(3), new Float32Array(4)]) {
      expect(() => averageBarkSample(invalid)).toThrow(TypeError);
    }
    const barkTexture = makeTexture();
    for (const meanSample of [-0.1, 1.1, NaN, Infinity]) {
      expect(() => createBarkMaterial({ barkTexture, hex: 0x3f3122, graphicsPolish: true, meanSample })).toThrow(RangeError);
    }
    barkTexture.dispose();
  });
});
