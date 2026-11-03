import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WIRES, createWireMesh } from './wires.mjs';
import { PYLON_ASSET } from './golf-cart-prop.mjs';

describe('the wires', () => {
  it('draws each segment as a four-corner ribbon, drawn with the overlays and writing no depth', () => {
    const mesh = createWireMesh([0, 10, 0, 50, 9, 0, 50, 9, 0, 100, 10, 0]);
    expect(mesh.geometry.getAttribute('position').count).toBe(8);
    expect(mesh.geometry.index.count).toBe(12);
    expect(mesh.geometry.getAttribute('aCorner').getY(0)).toBe(-1);
    expect(mesh.geometry.getAttribute('aCorner').getY(1)).toBe(1);
    expect(mesh.renderOrder).toBe(1);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.transparent).toBe(true);
    expect(createWireMesh([])).toBeNull();
    expect(WIRES.diameter).toBeLessThan(0.05);
  });
  it('hangs the big lines from the modelled pylon\'s insulators and turns every crossarm across its line', () => {
    expect(PYLON_ASSET.phases).toHaveLength(3);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('const ARM_TURN = POWER_BEFORE ? 0 : Math.PI / 2;');
    expect(main).toContain('support.yaw + ARM_TURN');
    expect(main).toContain('yaw + ARM_TURN]);');
    /* the course's own lines run as far as its terrain, not to a box written for one course */
    expect(main).toContain("const IN = POWER_BEFORE ? (x, z) => x > -1450 && x < 980 && z > -1900 && z < 700 : inFarRing;");
    expect(main).toContain("createWireMesh(wire, { name: 'power-wires' })");
    expect(main).toContain("createWireMesh(cables, { diameter: 0.045, name: 'lift-cables' })");
  });
});
