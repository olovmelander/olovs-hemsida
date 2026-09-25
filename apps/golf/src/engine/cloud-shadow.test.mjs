/* Cloud shadows: a tiling pattern whose cover is what each preset asks for,
   only in presets with a sun, lighter than a tree's shadow; the sun they leave
   keeps the sky-lit tint and lets a tree's shadow fade into a cloud's shade;
   main.js gives the same share of sun to the ground, the crowns and both
   impostor tiers. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LinearFilter, RepeatWrapping } from 'three/webgpu';
import { CLOUD_SHADOW, cloudPattern, cloudPatternTexture, cloudShadowOf, cloudSunlight, coverThreshold, createCloudShadow } from './cloud-shadow.mjs';
import { PAINTED_ATMOSPHERES } from './painted-world-palette.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { foliageCloudShadeFor } from './ghibli-foliage-material.mjs';

const N = CLOUD_SHADOW.size;
const bytes = cloudPattern();

describe('cloud shadows', () => {
  it('draw one deterministic pattern that tiles without a seam', () => {
    expect(bytes).toEqual(cloudPattern());
    expect(Math.min(...bytes.subarray(0, 4096))).toBeGreaterThanOrEqual(0);
    /* across the tile's edge the pattern steps no more than it does between any two neighbours inside */
    let inside = 0, seam = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x + 1 < N; x++) inside = Math.max(inside, Math.abs(bytes[y * N + x + 1] - bytes[y * N + x]));
      seam = Math.max(seam, Math.abs(bytes[y * N] - bytes[y * N + N - 1]));
    }
    for (let x = 0; x < N; x++) seam = Math.max(seam, Math.abs(bytes[x] - bytes[(N - 1) * N + x]));
    expect(seam).toBeLessThanOrEqual(inside);
    /* and it uses the whole byte range */
    expect(Math.min(...bytes)).toBe(0);
    expect(Math.max(...bytes)).toBe(255);
    /* the one copy the clouds and the water's patches share (nordic-water.mjs) is this pattern, uploaded as it was */
    const shared = cloudPatternTexture();
    expect(shared.bytes).toEqual(bytes);
    expect(shared.map.image.data).toBe(shared.bytes);
    expect([shared.map.wrapS, shared.map.wrapT, shared.map.magFilter, shared.map.minFilter, shared.map.generateMipmaps])
      .toEqual([RepeatWrapping, RepeatWrapping, LinearFilter, LinearFilter, false]);
    expect(createCloudShadow().map).toBe(shared.map);
  });
  it('covers the share of the ground each preset asks for, hard-edged and with its soft edge', () => {
    for (const cover of [0.1, 0.18, 0.3, 0.5]) {
      const t = coverThreshold(bytes, cover);
      let hard = 0, soft = 0;
      for (const b of bytes) { if (b / 255 > t) hard++; soft += 1 - cloudSunlight(b / 255, t, 1); }
      expect(Math.abs(hard / bytes.length - cover)).toBeLessThan(0.01);
      expect(Math.abs(soft / bytes.length - cover)).toBeLessThan(0.02);
    }
    /* no cover, no shade anywhere */
    const none = coverThreshold(bytes, 0);
    expect(Math.min(...Array.from(bytes, b => cloudSunlight(b / 255, none, 0.7)))).toBe(1);
  });
  it('fall in every preset with a sun, lighter than a tree\'s shadow, and in none without', () => {
    for (const [name, painted] of Object.entries(PAINTED_ATMOSPHERES)) {
      const preset = { ...ATMOSPHERE_PRESETS[name], ...painted };
      const c = cloudShadowOf(preset);
      if (painted.shadowSky > 0) {
        expect(c.cover, name).toBeGreaterThan(0.1);
        expect(c.opacity, name).toBeGreaterThan(0.3);
        expect(c.opacity, name).toBeLessThan(0.75);
      } else expect(c, name).toEqual({ cover: 0, opacity: 0 });
    }
    expect(cloudShadowOf({ cloudShadow: { cover: 2, opacity: 2 } })).toEqual({ cover: 0.9, opacity: 0.9 });
    expect(cloudShadowOf({})).toEqual({ cover: 0, opacity: 0 });
  });
  it('leave the sun sky-lit: a tree\'s shadow keeps its tint, and fades into a cloud\'s shade as the cloud thickens', () => {
    /* sunUnderClouds (shadow-tint.mjs): the sun's colour takes mix(tint, 1, c) and a
       receiver's shadow node mix(tint, 1, s c) / mix(tint, 1, c) -- together sun x mix(tint, 1, s c) */
    const mix = (a, b, t) => a + (b - a) * t;
    const light = (tint, s, c) => mix(tint, 1, c) * (mix(tint, 1, s * c) / Math.max(mix(tint, 1, c), 1e-3));
    const tint = 0.11;
    for (const s of [0, 0.3, 1]) for (const c of [0.25, 0.6, 1]) expect(light(tint, s, c)).toBeCloseTo(mix(tint, 1, s * c), 12);
    /* clear sky is the before exactly */
    for (const s of [0, 0.5, 1]) expect(light(tint, s, 1)).toBe(mix(tint, 1, s));
    /* a tree's shadow is no darker inside the thickest cloud a preset draws than the tint, and
       the cloud's shade sits between the sun and the tree's shadow */
    const thickest = 1 - Math.max(...Object.values(PAINTED_ATMOSPHERES).map(p => p.cloudShadow?.opacity ?? 0));
    expect(light(tint, 0, thickest)).toBeCloseTo(tint, 12);
    expect(light(tint, 1, thickest)).toBeGreaterThan(tint);
    expect(light(tint, 1, thickest)).toBeLessThan(1);
  });
  it('dim a crown to the share of its light it keeps without the sun, as a tree\'s shadow leaves open ground', () => {
    for (const [name, painted] of Object.entries(PAINTED_ATMOSPHERES)) {
      const preset = { ...ATMOSPHERE_PRESETS[name], ...painted };
      const k = foliageCloudShadeFor(preset);
      if (cloudShadowOf(preset).opacity > 0) {
        /* between a quarter and a half: most of a sunlit crown's strength is the sun's */
        expect(k, name).toBeGreaterThan(0.25);
        expect(k, name).toBeLessThan(0.55);
      }
      expect(k, name).toBeLessThanOrEqual(1);
    }
    /* no sun, nothing to take away */
    expect(foliageCloudShadeFor({ int: 0, hemiI: 1.8 })).toBe(1);
    /* the sky-lit share of the sun stays, as in a tree's shadow on the ground */
    expect(foliageCloudShadeFor({ int: 2, hemiI: 1, shadowSky: 0.1 })).toBeGreaterThan(foliageCloudShadeFor({ int: 2, hemiI: 1 }));
  });
  it('reach the ground, the crowns, both impostor tiers, the water, the flags and the light through reeds and tufts in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/sunUnderClouds\(sun, \{ cloud: CLOUD\.vertex/);
    expect(main).toMatch(/sun\.colorNode = clouded\.colorNode/);
    /* the painted crowns and both impostor batches take the same per-vertex share */
    expect((main.match(/sunlit: SUNLIT/g) || []).length).toBe(3);
    /* the water's sparkle and body, in its own shading (water-shading.mjs), to which main.js hands the clouds:
       read once per pixel, for both (the body's by water-above.mjs) */
    const water = fs.readFileSync(new URL('./water-shading.mjs', import.meta.url), 'utf8');
    expect(water).toMatch(/const sunlit = cloud \? cloud\.sunlightAt\(positionWorld\) : null;/);
    expect(water).toMatch(/sparkle\.mul\(sunlit\)/);
    expect(water.match(/sunlightAt\(/g)).toHaveLength(1);
    expect(main).toMatch(/cloud: CLOUD, ocean, showBed/);
    expect(main).toMatch(/createFlagMaterial\(flagAtlas, uSun, SUNLIT \? uThroughSun\.mul\(SUNLIT\) : uThroughSun\)/);
    expect((main.match(/mul\(uSunThrough\)\.mul\(SUNLIT \?\? 1\)/g) || []).length).toBe(3);
    expect(main).toMatch(/CLOUD\.setPreset\(p\); CLOUD\.setSun\(d\);/);
  });
});
