import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { GOLF_CART_ASSET, PARKED_CAR_ASSET, MOTORHOME_ASSET, SWAN_ASSET, HERON_ASSET, cartMatrix } from './golf-cart-prop.mjs';
import { inspectBuildingGlb } from './authored-buildings.mjs';

const file = new URL(`../../public/${GOLF_CART_ASSET.url}`, import.meta.url);

describe('the modelled golf cart', () => {
  it('is the published file: bytes, sha256 and its record', () => {
    const bytes = fs.readFileSync(file);
    expect(bytes.length).toBe(GOLF_CART_ASSET.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GOLF_CART_ASSET.sha256);
    const record = JSON.parse(fs.readFileSync(new URL('../../public/models/props/golf-cart.json', import.meta.url)));
    expect(record.asset).toEqual({ url: GOLF_CART_ASSET.url, sha256: GOLF_CART_ASSET.sha256, bytes: GOLF_CART_ASSET.bytes });
    expect(Object.keys(record.meshes)).toEqual([...GOLF_CART_ASSET.meshes]);
    const total = Object.values(record.meshes).reduce((sum, m) => sum + m.triangles, 0);
    expect(total).toBeLessThanOrEqual(3000);
  });
  it('is a self-contained GLB with the two meshes and their colours', () => {
    const bytes = fs.readFileSync(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const json = inspectBuildingGlb(buffer);
    const meshes = (json.meshes || []).map(m => m.name);
    for (const name of GOLF_CART_ASSET.meshes) expect(meshes).toContain(name);
    for (const m of json.meshes) for (const p of m.primitives) {
      expect(p.attributes.COLOR_0).toBeDefined();
      expect(p.attributes.NORMAL).toBeDefined();
    }
  });
  it('stands each cart along its row\'s axis', () => {
    const m = cartMatrix(10, 2, -5, 0, 1);
    const front = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(front.x).toBeCloseTo(10, 6); expect(front.y).toBeCloseTo(2, 6); expect(front.z).toBeCloseTo(-4, 6);
  });
  it('is drawn behind ?props=0 in main.js, its file cached by the service worker', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const PROPS_ON = new URLSearchParams\(location\.search\)\.get\('props'\) !== '0'/);
    const vite = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(vite).toContain("cacheName: 'banvy-props'");
  });
  it.each([['parked-car', PARKED_CAR_ASSET], ['motorhome', MOTORHOME_ASSET], ['swan', SWAN_ASSET], ['heron', HERON_ASSET]])('carries the %s the same way: its bytes, sha256, record and two meshes', (id, ASSET) => {
    const PARKED_CAR_ASSET = ASSET;
    const bytes = fs.readFileSync(new URL(`../../public/${PARKED_CAR_ASSET.url}`, import.meta.url));
    expect(bytes.length).toBe(PARKED_CAR_ASSET.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PARKED_CAR_ASSET.sha256);
    const record = JSON.parse(fs.readFileSync(new URL(`../../public/models/props/${id}.json`, import.meta.url)));
    expect(record.asset).toEqual({ url: PARKED_CAR_ASSET.url, sha256: PARKED_CAR_ASSET.sha256, bytes: PARKED_CAR_ASSET.bytes });
    const json = inspectBuildingGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(json.meshes.map(m => m.name).sort()).toEqual([...PARKED_CAR_ASSET.meshes].sort());
    expect(Object.values(record.meshes).reduce((sum, m) => sum + m.triangles, 0)).toBeLessThanOrEqual(2600);
  });
});
