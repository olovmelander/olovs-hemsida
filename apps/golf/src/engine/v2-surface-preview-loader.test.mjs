import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SURFACE } from './surface.js';
import {
  compileSurfacePreviewAssets,
  createSurfacePreviewDescriptor,
} from '../../../../packages/course-v2/surface-compiler-node.mjs';
import { loadSurfacePreview } from './v2-surface-preview-loader.mjs';

const frame = Object.freeze({
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
  origin: Object.freeze({ easting: 650002, northing: 6640002, heightRH2000: 20 }),
  axisMapping: Object.freeze({
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  }),
  fingerprint: 'd'.repeat(64),
});

function bounds(minEasting, minNorthing, maxEasting, maxNorthing) {
  return { minEasting, minNorthing, minHeightRH2000: 18, maxEasting, maxNorthing, maxHeightRH2000: 24 };
}

function fixture() {
  const compiled = compileSurfacePreviewAssets({
    groundId: 'loader-test', frame, legacyBridge: { translateX: 0, translateZ: 0 },
    terrainTiles: [{ id: 'l0/0/0', bounds: bounds(650000, 6640000, 650004, 6640004), sampleSpacingMetres: 1 }],
    holes: [{ n: 1, line: [[-2, -2], [2, 2]] }],
    features: [{
      surface: SURFACE.GREEN,
      rings: [[[-1, -1], [1, -1], [1, 1], [-1, 1]]],
      hole: 1,
    }],
    codec: 'raw',
  });
  return {
    compiled,
    descriptor: createSurfacePreviewDescriptor(compiled, {
      label: 'Surface loader fixture', terrainDescriptorSha256: 'e'.repeat(64), packSha256: 'f'.repeat(64),
    }),
  };
}

function fetcher(compiled, descriptor, mutate = bytes => bytes) {
  return async input => {
    const url = new URL(input);
    if (url.pathname === '/surface-preview.json') {
      return new Response(JSON.stringify(descriptor), { headers: { 'content-type': 'application/json' } });
    }
    const source = compiled.resources.get(url.pathname.slice(1));
    if (!source) return new Response('missing', { status: 404 });
    const bytes = mutate(new Uint8Array(source));
    return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } });
  };
}

describe('real surface preview loader', () => {
  it('verifies and decodes every retained surface BVCH before returning it', async () => {
    const { compiled, descriptor } = fixture();
    const loaded = await loadSurfacePreview('https://proof.test/surface-preview.json', {
      fetchImpl: fetcher(compiled, descriptor), cryptoImpl: webcrypto,
    });
    expect(loaded.descriptor.provisional).toBe(true);
    expect(loaded.resources).toHaveLength(1);
    expect(loaded.resources[0].values.primarySurfaceIds).toContain(SURFACE.GREEN);
  });

  it('fails closed on a corrupted retained surface payload', async () => {
    const { compiled, descriptor } = fixture();
    await expect(loadSurfacePreview('https://proof.test/surface-preview.json', {
      fetchImpl: fetcher(compiled, descriptor, bytes => {
        const changed = new Uint8Array(bytes);
        changed[changed.length - 1] ^= 1;
        return changed;
      }),
      cryptoImpl: webcrypto,
    })).rejects.toThrow(/integrity mismatch/);
  });
});
