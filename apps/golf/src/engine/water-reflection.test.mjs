import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FloatType, HalfFloatType, RenderTarget } from 'three/webgpu';
import { WATER_REFLECTION, createWaterReflection } from './water-reflection.mjs';

/* the march's schedule as the shader steps it: t' = t x growth + first, from first x growth^noise */
const schedule = (noise = 0, p = WATER_REFLECTION) => {
  const first = p.first * p.growth ** noise, out = [];
  let t = first;
  for (let i = 0; i < p.steps; i++) { out.push(t); t = t * p.growth + first; }
  return out;
};

describe('the water that mirrors its shores', () => {
  it('marches from a hand off the water out past the far shore of the largest lake', () => {
    const t = schedule();
    expect(t[0]).toBeLessThan(0.5);
    /* the fjärd's far shore lies some 1.5 km off; the march must reach it before its hit fades */
    expect(t.at(-1)).toBeGreaterThan(WATER_REFLECTION.reachFade[1]);
    expect(WATER_REFLECTION.reachFade[1]).toBeLessThanOrEqual(WATER_REFLECTION.background[1]);
    /* the noise scales the whole schedule by up to a step: each pixel's steps fall a different share along */
    const shifted = schedule(0.999);
    for (let i = 0; i < t.length; i++) expect(shifted[i] / t[i]).toBeCloseTo(WATER_REFLECTION.growth ** 0.999, 6);
  });
  it('copies the scene only in the scene pass\'s own target, and only while active', () => {
    const r = createWaterReflection({ reversedDepth: true });
    /* the scene pass's formats: half-float colour, float depth under the reversed buffer */
    expect(r.nodes.colour.value.type).toBe(HalfFloatType);
    expect(r.nodes.depth.value.type).toBe(FloatType);
    const target = new RenderTarget(4, 4), other = new RenderTarget(4, 4);
    let copied = 0, current = target;
    const renderer = { getRenderTarget: () => current, getCanvasTarget: () => null, copyFramebufferToTexture: () => { copied++; } };
    const frame = { renderer };
    /* no target, or not active: nothing copied, and three is told so (false) to ask again */
    expect(r.nodes.depth.updateBefore(frame)).toBe(false);
    r.setTarget(target);
    expect(r.nodes.depth.updateBefore(frame)).toBe(false);
    r.setActive(true);
    expect(r.nodes.depth.updateBefore(frame)).not.toBe(false);
    expect(copied).toBe(1);
    /* another target (a bake, the impostor atlas) or the runtime drop's direct draw: no copy */
    current = other;
    expect(r.nodes.colour.updateBefore(frame)).toBe(false);
    current = target;
    r.setActive(false);
    expect(r.nodes.colour.updateBefore(frame)).toBe(false);
    expect(copied).toBe(1);
    expect(r.snapshot()).toMatchObject({ on: true, active: false, target: true, copies: 1 });
    /* a sampled clone keeps the gate */
    expect(r.nodes.depth.clone().gate).toBe(r.nodes.depth.gate);
  });
  it('keeps the depth texture three\'s own default without the reversed buffer (WebGL2)', () => {
    const r = createWaterReflection({ reversedDepth: false });
    expect(r.nodes.depth.value.type).not.toBe(FloatType);
  });
  it('runs with the temporal AA only, keeps its before, and lays the sun road over what it finds', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("const WATER_REFLECTION = TEMPORAL_AA && new URLSearchParams(location.search).get('waterreflect') !== '0'");
    expect(main).toContain('WATER_REFLECTION?.setTarget(scenePass.renderTarget);');
    expect(main).toContain('WATER_REFLECTION?.setActive(!lowfx);');
    expect(main).toContain('reflection: WATER_REFLECTION, lightScale: paintedWaterLight');
    const shading = fs.readFileSync(new URL('./water-shading.mjs', import.meta.url), 'utf8');
    const traced = shading.indexOf('reflection.trace('), mixed = shading.indexOf('let c = mix(body, skyC'), road = shading.indexOf('c = c.add(');
    expect(traced).toBeGreaterThan(0);
    expect(mixed).toBeGreaterThan(traced);
    expect(road).toBeGreaterThan(mixed);
  });
});
