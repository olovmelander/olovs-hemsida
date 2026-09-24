/* The sky is drawn after the opaque world and before every overlay
   (engine/atmospheric-sky.mjs), and its band under the horizon takes the fog's
   final colour. Drawing it late is only safe while nothing opaque shares or
   precedes its slot without writing depth: the world stays at order 0 and the
   overlays at 1 and up, which this checks in main.js. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SKY_RENDER_ORDER, createAtmosphericSky, setSkyGroundHaze, atmosphereState } from './atmospheric-sky.mjs';

describe('the sky in the draw order', () => {
  it('comes after the opaque world and before the overlays; the before is first', () => {
    const sky = createAtmosphericSky({ painted: true, deterministic: true });
    expect(sky.renderOrder).toBe(SKY_RENDER_ORDER);
    expect(SKY_RENDER_ORDER).toBeGreaterThan(0);
    expect(SKY_RENDER_ORDER).toBeLessThan(1);
    /* it must still test depth, write none, and stay opaque, or drawn last it would cover the world */
    expect(sky.material.depthTest).toBe(true);
    expect(sky.material.depthWrite).toBe(false);
    expect(sky.material.transparent).toBe(false);
    expect(createAtmosphericSky({ drawLast: false }).renderOrder).toBe(-2);
  });

  it('shares no slot: every render order main.js sets is the world\'s 0 or an overlay\'s 1 and up', () => {
    const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    /* every right-hand side, and every number it can yield; a bare name is looked up where it is defined */
    const sides = [...source.matchAll(/\.renderOrder\s*=\s*([^;]+);/g)].map(m => m[1].trim());
    expect(sides.length).toBeGreaterThan(10);
    for (const side of sides) {
      const expression = /^[A-Za-z_]\w*$/.test(side) ? source.match(new RegExp(`const ${side} = ([^;]+);`))[1] : side;
      const values = [...expression.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
      expect(values.length, side).toBeGreaterThan(0);
      for (const value of values) expect(value === 0 || value >= 1, `${side}: ${value}`).toBe(true);
    }
  });

  it('meets the ground in the fog\'s final colour', () => {
    const sky = createAtmosphericSky({ painted: true, deterministic: true });
    const fog = new THREE.Color(0xc1b8a9).lerp(new THREE.Color(0x9fb3c8), 0.22);
    expect(atmosphereState(sky).groundHaze).not.toBe(fog.getHex());
    setSkyGroundHaze(sky, fog);
    expect(atmosphereState(sky).groundHaze).toBe(fog.getHex());
    expect(() => setSkyGroundHaze({}, fog)).toThrow(/Unknown atmospheric sky/);
  });
});
