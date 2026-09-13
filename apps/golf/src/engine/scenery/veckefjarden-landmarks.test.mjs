import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadLandmarks, validateLandmarkManifest, LANDMARK_SPECS,
  isReplacedLandmarkBox, isReplacedLandmarkRail, isLandmarkTreeObstruction } from './veckefjarden-landmarks.mjs';

const publicRoot = new URL('../../../public/', import.meta.url);
// This module is in src/engine/scenery; public is three levels up.
const manifest = JSON.parse(await fs.readFile(new URL('models/veckefjarden/landmarks-v1.json', publicRoot)));
const baseUrl = 'https://example.test/golf/';
const parseGlb = buffer => new GLTFLoader().parseAsync(buffer, '');
const fetchAsset = async url => {
  const pathname = new URL(url).pathname.replace('/golf/', '');
  return new Response(await fs.readFile(new URL(pathname, publicRoot)), { status: 200 });
};
const options = (extra = {}) => ({ THREE, scene: new THREE.Scene(), courseSlug: 'veckefjarden',
  demH: () => 46, baseUrl, fetchImpl: fetchAsset, parseGlb, ...extra });

describe('Veckefjärden Blender landmark assets', () => {
  it.each(['veckefjarden', 'veckefjarden-korthalsbanan'])('loads both real models for %s', async courseSlug => {
    const opts = options({ courseSlug });
    const result = await loadLandmarks(opts);
    expect(result.report.status).toBe('loaded');
    expect([...result.replacedLandmarkIds]).toEqual(LANDMARK_SPECS.map(s => s.id));
    expect(result.roots).toHaveLength(2);
    expect(result.report.meshes).toBeLessThanOrEqual(30);
    for (const item of result.report.landmarks) {
      expect(item.min.every(Number.isFinite)).toBe(true);
      expect(item.max.every(Number.isFinite)).toBe(true);
      expect(item.ground).toBe(46);
    }
    expect(opts.scene.children).toHaveLength(2);
    result.dispose(); result.dispose();
    expect(opts.scene.children).toHaveLength(0);
    expect(result.replacedLandmarkIds.size).toBe(0);
  });

  it('verifies exported assets are static, self-contained geometry with matching receipts', async () => {
    for (const item of manifest.landmarks) {
      const bytes = await fs.readFile(new URL(item.asset.url, publicRoot));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.asset.sha256);
      expect(bytes.length).toBe(item.asset.bytes);
      expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
      const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)).trim());
      expect(doc.images?.length || 0).toBe(0);
      expect(doc.animations?.length || 0).toBe(0);
      expect(doc.buffers.some(b => b.uri)).toBe(false);
      expect(doc.nodes.some(n => n.name === item.nodeName)).toBe(true);
      for (const mat of doc.materials) {
        expect(mat.pbrMetallicRoughness.baseColorFactor.slice(0, 3).every(v => v > .01 && v <= 1)).toBe(true);
      }
    }
  });

  it('preserves the other replacement when one model is unavailable', async () => {
    const result = await loadLandmarks(options({ fetchImpl: url => String(url).includes('sjalevads-kyrka-v1.glb')
      ? Promise.resolve(new Response('', { status: 404 })) : fetchAsset(url) }));
    expect(result.report.status).toBe('partial');
    expect([...result.replacedLandmarkIds]).toEqual(['w70606159']);
    expect(result.report.landmarks[0].reason).toContain('404');
    result.dispose();
  });

  it('does not suppress a source church for corrupt bytes', async () => {
    const result = await loadLandmarks(options({ fetchImpl: async url => {
      const response = await fetchAsset(url);
      if (!String(url).includes('sjalevads-kyrka-v1.glb')) return response;
      const bytes = new Uint8Array(await response.arrayBuffer()); bytes[bytes.length - 10] ^= 1;
      return new Response(bytes);
    } }));
    expect(result.replacedLandmarkIds.has('w104048726')).toBe(false);
    expect(result.report.landmarks[0].reason).toContain('checksum');
    result.dispose();
  });

  it('disposes parsed geometry when the course is left during parsing', async () => {
    const controller = new AbortController(); let parsed, disposed = 0;
    const opts = options({ signal: controller.signal, parseGlb: async buffer => {
      const gltf = await parseGlb(buffer); parsed = gltf.scene;
      parsed.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++));
      controller.abort(); return gltf;
    } });
    const result = await loadLandmarks(opts);
    expect(result.report.status).toBe('fallback');
    expect(result.replacedLandmarkIds.size).toBe(0);
    expect(opts.scene.children).toHaveLength(0);
    expect(parsed.parent).toBe(null);
    expect(disposed).toBeGreaterThan(0);
  });

  it('refuses a foreign course, shifted coordinates, or a duplicated record', () => {
    expect(() => validateLandmarkManifest(manifest, 'upsala')).toThrow(/course/);
    const moved = structuredClone(manifest); moved.landmarks[0].anchor[0] += 20;
    expect(() => validateLandmarkManifest(moved, 'veckefjarden')).toThrow(/placement/);
    const duplicate = structuredClone(manifest); duplicate.landmarks[1] = duplicate.landmarks[0];
    expect(() => validateLandmarkManifest(duplicate, 'veckefjarden')).toThrow(/duplicate/);
  });

  it('keeps the original town church and removes the duplicate custom Själevad geometry', async () => {
    const main = await fs.readFile(new URL('../../main.js', import.meta.url), 'utf8');
    const scenery = await fs.readFile(new URL('./veckefjarden.js', import.meta.url), 'utf8');
    expect(LANDMARK_SPECS.map(s => s.id)).not.toContain('w108651042');
    expect(main).toContain('landmarkArchitecture?.replacedLandmarkIds.has(b.id)');
    expect(main).toContain('landmarkArchitecture?.replacedLandmarkIds.has(p.id)');
    expect(scenery).not.toContain('const kx = -3310');
  });

  it.each(['veckefjarden', 'veckefjarden-korthalsbanan'])('replaces only the mapped ramp box and crossing spans in %s', async slug => {
    const bytes = await fs.readFile(new URL(`courses/${slug}/pack.bin`, publicRoot));
    const length = bytes.readUInt32LE(4), header = JSON.parse(bytes.toString('utf8', 8, 8 + length));
    const model = JSON.parse(inflateRawSync(bytes.subarray(8 + length + header.HF0.bytes + header.HF1.bytes)));
    const loaded = new Set(['w70606159']);
    expect(model.infra.farB.filter(b => isReplacedLandmarkBox(b, loaded))).toHaveLength(1);
    expect(model.infra.railway.filter(r => isReplacedLandmarkRail(r, loaded)).map(r => r.id).sort())
      .toEqual(['w75298818', 'w75298820']);
    expect(model.infra.farB.some(b => isReplacedLandmarkBox(b, new Set()))).toBe(false);
    expect(model.infra.railway.some(r => isReplacedLandmarkRail(r, new Set()))).toBe(false);
  });

  it('clears intersecting tree crowns only around the loaded jump', () => {
    const loaded = new Set(['w70606159']);
    expect(isLandmarkTreeObstruction(1344.8, -506, 4, loaded)).toBe(true);
    expect(isLandmarkTreeObstruction(1467, -545, 4, loaded)).toBe(true);
    expect(isLandmarkTreeObstruction(1344.8, -470, 4, loaded)).toBe(false);
    expect(isLandmarkTreeObstruction(1344.8, -506, 4, new Set())).toBe(false);
  });
});
