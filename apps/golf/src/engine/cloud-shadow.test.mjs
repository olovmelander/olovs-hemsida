/* Cloud shadows: a tiling pattern whose cover is what each preset asks for,
   only in presets with a sun, lighter than a tree's shadow; the sun they leave
   keeps the sky-lit tint and lets a tree's shadow fade into a cloud's shade;
   main.js gives the same share of sun to the ground, the crowns and both
   impostor tiers. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LinearFilter, RepeatWrapping } from 'three/webgpu';
import { Vector3 } from 'three/webgpu';
import { CLOUD_SHADOW, cloudPattern, cloudPatternTexture, cloudShadowOf, cloudSunlight, coverThreshold, createCloudShadow, shadowStretch } from './cloud-shadow.mjs';
import { PAINTED_ATMOSPHERES } from './painted-world-palette.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { foliageCloudShadeFor } from './ghibli-foliage-material.mjs';

const N = CLOUD_SHADOW.size;
const bytes = cloudPattern();
const sunAt = (degrees, azimuth = 0) => {
  const e = degrees * Math.PI / 180;
  return new Vector3(Math.cos(e) * Math.sin(azimuth), Math.sin(e), Math.cos(e) * Math.cos(azimuth));
};
/* the pattern as the shader reads it at world (x, y, z): the same ground point, stretch and drift, filtered as the
   texture filters it (linear, repeating, texel centres at half a texel) */
const patternAt = (cloud, x, y, z, stretched) => {
  const { tileMetres } = CLOUD_SHADOW;
  const [sx, sz] = cloud.slope.value.toArray(), [ax, az] = cloud.along.value.toArray(), k = cloud.squeeze.value;
  let gx = x - sx * y, gz = z - sz * y;
  if (stretched) { const d = (gx * ax + gz * az) * k; gx += ax * d; gz += az * d; }
  gx -= cloud.offset.value.x; gz -= cloud.offset.value.y;
  const u = gx / tileMetres * N - 0.5, v = gz / tileMetres * N - 0.5;
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  const at = (i, j) => bytes[(((j % N) + N) % N) * N + (((i % N) + N) % N)] / 255;
  return (at(i0, j0) * (1 - fu) + at(i0 + 1, j0) * fu) * (1 - fv) + (at(i0, j0 + 1) * (1 - fu) + at(i0 + 1, j0 + 1) * fu) * fv;
};
/* how far along a direction the pattern stays like itself: the lag at which its correlation falls to a half */
const lengthAlong = (read, [dx, dz], lags) => {
  const points = [];
  for (let i = 0; i < 48; i++) for (let j = 0; j < 48; j++) points.push([i * 331 + 17, j * 293 + 5]);
  const base = points.map(([x, z]) => read(x, z)), mean = base.reduce((a, b) => a + b) / base.length;
  const variance = base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length;
  for (const lag of lags) {
    let c = 0;
    points.forEach(([x, z], n) => { c += (base[n] - mean) * (read(x + dx * lag, z + dz * lag) - mean); });
    if (c / base.length / variance < 0.5) return lag;
  }
  return Infinity;
};

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
  it('fall in every preset with a sun and clouds, lighter than a tree\'s shadow, and in none without', () => {
    for (const [name, painted] of Object.entries(PAINTED_ATMOSPHERES)) {
      const preset = { ...ATMOSPHERE_PRESETS[name], ...painted };
      const c = cloudShadowOf(preset);
      /* the summer day has a sun and no clouds (docs/visual-summer-2026-09-25.md) */
      if (painted.shadowSky > 0 && preset.cloudDensity > 0) {
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
  it('are drawn out along a low sun\'s light: 3.5 times as long as wide at golden hour, round overhead', () => {
    const sine = d => Math.sin(d * Math.PI / 180);
    expect(shadowStretch(1)).toBe(1);
    expect(shadowStretch(sine(12.5))).toBeCloseTo(1 + 0.55 / Math.tan(12.5 * Math.PI / 180), 9);
    expect(shadowStretch(sine(12.5))).toBeCloseTo(3.48, 2);
    expect(shadowStretch(sine(55.1))).toBeCloseTo(1.38, 2);
    /* never longer than the most, and a sun below the floor is taken at the floor, as the pattern's shift is */
    expect(shadowStretch(sine(4.6))).toBe(shadowStretch(CLOUD_SHADOW.sunFloor));
    expect(shadowStretch(0)).toBeLessThanOrEqual(CLOUD_SHADOW.stretch.max);
    for (let d = 1; d < 90; d++) expect(shadowStretch(sine(d + 1))).toBeLessThanOrEqual(shadowStretch(sine(d)));
    /* read as the shader reads it: longer along the light than across it, by the stretch */
    for (const [degrees, azimuth] of [[12.5, -0.67], [7.3, 2.2], [55.1, 0.9]]) {
      const sun = sunAt(degrees, azimuth), cloud = createCloudShadow({ stretch: true });
      cloud.setSun(sun); cloud.setOffset(1234, -567);
      const along = [Math.sin(azimuth), Math.cos(azimuth)], across = [Math.cos(azimuth), -Math.sin(azimuth)];
      const read = (x, z) => patternAt(cloud, x, 0, z, true), lags = Array.from({ length: 400 }, (_, i) => (i + 1) * 16);
      const ratio = lengthAlong(read, along, lags) / lengthAlong(read, across, lags);
      expect(ratio / shadowStretch(sun.y), `${degrees} degrees`).toBeGreaterThan(0.8);
      expect(ratio / shadowStretch(sun.y), `${degrees} degrees`).toBeLessThan(1.25);
    }
  });
  it('keep each preset\'s cover when drawn out, and drift with the air without a jump', () => {
    const sun = sunAt(12.5, -0.67), cloud = createCloudShadow({ stretch: true });
    cloud.setSun(sun);
    /* the air does not wrap a stretched pattern's drift: the pattern takes it in its own frame, wrapped to the tile there */
    expect(cloud.period).toBe(Infinity);
    expect(createCloudShadow().period).toBe(CLOUD_SHADOW.tileMetres);
    const t = coverThreshold(bytes, 0.22);
    let shaded = 0, n = 0;
    for (let x = 0; x < 20000; x += 97) for (let z = 0; z < 20000; z += 89) { n++; if (patternAt(cloud, x, 0, z, true) > t) shaded++; }
    expect(Math.abs(shaded / n - 0.22)).toBeLessThan(0.03);
    /* the shadows move with the air: after the air carries the drift by (dx, dz), the pattern at a point is what it
       was that far upwind -- also across every multiple of the tile a wrapped drift would have jumped at */
    for (const start of [[0, 0], [4090, -4090], [81920 - 3, 12288 + 2]]) {
      cloud.setOffset(...start);
      const before = [[100, 200], [-1500, 900], [2500, -3100]].map(([x, z]) => patternAt(cloud, x, 0, z, true));
      cloud.setOffset(start[0] + 7.5, start[1] - 3.25);
      const after = [[107.5, 196.75], [-1492.5, 896.75], [2507.5, -3103.25]].map(([x, z]) => patternAt(cloud, x, 0, z, true));
      after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 5));
      /* the drift the shader subtracts stays within the tile */
      for (const v of cloud.offset.value.toArray()) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(CLOUD_SHADOW.tileMetres); }
    }
    /* a crown takes the ground's sample beside it, moved along the sun as far as it stands up, stretched or not */
    cloud.setOffset(300, 400);
    const up = cloud.slope.value;
    expect(patternAt(cloud, 50 + up.x * 20, 20, 60 + up.y * 20, true)).toBeCloseTo(patternAt(cloud, 50, 0, 60, true), 9);
    /* the before is the round pattern, its drift the air's own */
    const round = createCloudShadow();
    round.setSun(sun); round.setOffset(5000, -300);
    expect(round.offset.value.toArray()).toEqual([5000, -300]);
    expect(round.snapshot()).toMatchObject({ stretch: null, along: null });
    expect(cloud.snapshot().stretch).toBeCloseTo(shadowStretch(sun.y), 9);
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
    /* drawn out along a low sun's light, behind its before; the air wraps the drift as the pattern asks */
    expect(main).toMatch(/const CLOUD_STRETCH_ON = new URLSearchParams\(location\.search\)\.get\('cloudstretch'\) !== '0';/);
    expect(main).toMatch(/const CLOUD = CLOUD_SHADOWS_ON \? createCloudShadow\(\{ stretch: CLOUD_STRETCH_ON \}\) : null;/);
    expect(main).toMatch(/cloudPeriod: CLOUD \? CLOUD\.period : Infinity/);
  });
});
