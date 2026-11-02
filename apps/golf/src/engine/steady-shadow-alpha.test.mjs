import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { steadyShadowAlpha } from './steady-shadow-alpha.mjs';

const shadowMaterial = () => { const m = new THREE.NodeMaterial(); m.isShadowPassMaterial = true; return m; };

describe('steady shadow alphaTest', () => {
  it('stores each caster value without moving the shared material version', () => {
    const m = shadowMaterial();
    expect(steadyShadowAlpha(m)).toBe(true);
    const version = m.version;
    for (const v of [0.5, 0, 0.5, 0, 0.01, 0]) { m.alphaTest = v; expect(m.alphaTest).toBe(v); }
    expect(m.version).toBe(version);
  });
  it('is what three bumps without it, so the test measures the real churn', () => {
    const m = shadowMaterial(), version = m.version;
    for (const v of [0.5, 0, 0.5, 0]) m.alphaTest = v;
    expect(m.version).toBe(version + 4);
  });
  it('keeps alphaTest visible to the cache key and leaves other materials alone', () => {
    const m = shadowMaterial();
    steadyShadowAlpha(m); m.alphaTest = 0.5;
    expect(Object.keys(m)).not.toContain('alphaTest');
    expect(m['alphaTest']).toBe(0.5);
    expect(steadyShadowAlpha(m)).toBe(false);
    const plain = new THREE.NodeMaterial();
    expect(steadyShadowAlpha(plain)).toBe(false);
    const v = plain.version; plain.alphaTest = 0.5; expect(plain.version).toBe(v + 1);
  });
  it('reads what r187 writes: the override\'s _alphaTest, bypassing the setter', () => {
    const m = shadowMaterial();
    steadyShadowAlpha(m);
    const version = m.version;
    for (const v of [0.5, 0, 0.01, 0.5]) {
      m._alphaTest = v;                     // Renderer.renderObject, r187
      expect(m.alphaTest).toBe(v);          // what the node material reads
    }
    expect(m.version).toBe(version);
  });
  it('agrees with three\'s own accessor on a patched and an unpatched material', () => {
    const patched = shadowMaterial(), plain = shadowMaterial();
    steadyShadowAlpha(patched);
    for (const v of [0.5, 0]) {
      patched.alphaTest = v; plain.alphaTest = v;
      expect(patched._alphaTest).toBe(plain._alphaTest);
      patched._alphaTest = v; plain._alphaTest = v;
      expect(patched.alphaTest).toBe(plain.alphaTest);
    }
  });
});
