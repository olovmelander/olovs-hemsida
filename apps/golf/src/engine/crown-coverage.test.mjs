/* The crowns' cut through the MSAA samples (docs/tree-sparkle-2026-09-28.md):
   the mesh crowns' leaf cards take the impostors' coverage, centred on the hard
   cut so a crown keeps its area; the shadow pass keeps its own cut; and
   ?crowncoverage=0 builds the hard cut exactly as before. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AddEquation, CustomBlending, NormalBlending, OneFactor, OneMinusSrcAlphaFactor, Texture, ZeroFactor } from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import { makeGhibliFoliageMaterial } from './ghibli-foliage-material.mjs';
import { coverOpaqueBackdrop, centredCoverageCut, coveredShare } from './msaa-coverage.mjs';

const crown = options => makeGhibliFoliageMaterial({ key: 'gran', map: new Texture(), sunDirection: uniform(vec3(0, 0.2, 1)),
  tint: vec3(1), seed: float(0.5), autumn: float(0), ...options });

/* one covered sample under the material's blend: [rgb, alpha] out, from the fragment's and the backdrop's */
const FACTOR = { [OneFactor]: () => 1, [ZeroFactor]: () => 0, [OneMinusSrcAlphaFactor]: srcA => 1 - srcA };
function blendSample(m, [srcRgb, srcA], [dstRgb, dstA]) {
  expect(m.blendEquation).toBe(AddEquation);
  expect(m.blendEquationAlpha).toBe(AddEquation);
  const rgb = srcRgb.map((s, i) => s * FACTOR[m.blendSrc](srcA) + dstRgb[i] * FACTOR[m.blendDst](srcA));
  return [rgb, srcA * FACTOR[m.blendSrcAlpha](srcA) + dstA * FACTOR[m.blendDstAlpha](srcA)];
}

describe('the crowns\' cut through the samples', () => {
  it('cuts the leaf cards through the MSAA samples, and keeps the hard cut behind coverage: false', () => {
    const covered = crown(), before = crown({ coverage: false });
    expect(covered.alphaToCoverage).toBe(true);
    expect(covered.blending).toBe(CustomBlending);
    expect(covered.alphaTestNode?.isNode).toBe(true);
    /* the before: all or nothing per pixel at 0.5, as main drew it */
    expect(before.alphaToCoverage).toBe(false);
    expect(before.blending).toBe(NormalBlending);
    expect(before.alphaTestNode).toBe(null);
    for (const m of [covered, before]) {
      expect(m.alphaTest).toBe(0.5);
      expect(m.opacityNode?.isNode).toBe(true);
      /* the shadow pass copies alphaTest and cuts with its own mask, whichever cut the colour pass takes */
      expect(m.maskShadowNode?.isNode).toBe(true);
    }
    /* a crown without cards is a solid mesh: nothing to cut */
    const solid = makeGhibliFoliageMaterial({ key: 'gran', sunDirection: uniform(vec3(0, 0.2, 1)), tint: vec3(1), seed: float(0.5), autumn: float(0) });
    expect(solid.alphaToCoverage).toBe(false);
    expect(solid.alphaTest).toBe(0);
  });

  it('replaces the colour of each covered sample and keeps an opaque backdrop opaque', () => {
    const m = coverOpaqueBackdrop(crown({ coverage: false }));
    expect(m.alphaToCoverage).toBe(true);
    for (const srcA of [0.01, 0.25, 0.5, 0.8, 1]) {
      const [rgb, a] = blendSample(m, [[0.2, 0.5, 0.1], srcA], [[0.9, 0.8, 0.7], 1]);
      expect(rgb).toEqual([0.2, 0.5, 0.1]);
      /* coverage written as alpha would make the resolved frame translucent at every edge */
      expect(a).toBeCloseTo(1, 12);
    }
  });

  it('centres the samples\' ramp on the hard cut, so a crown keeps its area', () => {
    /* an edge across which the filtered alpha falls linearly, `change` a pixel: pixels at 1/64 steps */
    for (const change of [0.05, 0.2, 0.5]) {
      const pixels = Array.from({ length: 4096 }, (_, i) => 0.5 + (i / 4096 - 0.5) * change * 64);
      const hard = pixels.filter(a => a > 0.5).length;
      const centred = pixels.reduce((s, a) => s + coveredShare(a, change, 0.5 - change / 2), 0);
      const three = pixels.reduce((s, a) => s + coveredShare(a, change, 0.5), 0);
      expect(Math.abs(centred - hard) / hard).toBeLessThan(0.002);
      /* three's own ramp from the test upward draws the edge half a pixel inside (64 steps a pixel) */
      expect((hard - three) / 64).toBeCloseTo(0.5, 1);
      expect(coveredShare(0.5, change, 0.5 - change / 2)).toBeCloseTo(0.5, 12);
    }
    expect(centredCoverageCut(float(0.5)).isNode).toBe(true);
  });

  it('matches three\'s alpha to coverage, which ramps from the test to the test plus fwidth', () => {
    /* coveredShare mirrors this line of the pinned three; the centring is half of its ramp */
    const source = fs.readFileSync(new URL('../../node_modules/three/src/materials/nodes/NodeMaterial.js', import.meta.url), 'utf8');
    expect(source).toContain('diffuseColor.a = smoothstep( alphaTestNode, alphaTestNode.add( fwidth( diffuseColor.a ) ), diffuseColor.a );');
  });

  it('is wired in main.js behind ?crowncoverage=0, for the drawn crowns', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const CROWN_COVERAGE_ON = new URLSearchParams\(location\.search\)\.get\('crowncoverage'\) !== '0';/);
    expect(main).toMatch(/makeGhibliFoliageMaterial\(\{[^}]*coverage: CROWN_COVERAGE_ON \}\)/s);
  });

  it('shares its coverage with the impostors', () => {
    const impostor = fs.readFileSync(new URL('./tree-impostor.mjs', import.meta.url), 'utf8');
    expect(impostor).toMatch(/const enableImpostorCoverage = coverOpaqueBackdrop;/);
    expect(impostor).toMatch(/enableImpostorCoverage\(material\);/);
  });
});
