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
  it('verifies every retained surface BVCH without duplicating decoded channel arrays', async () => {
    const { compiled, descriptor } = fixture();
    const loaded = await loadSurfacePreview('https://proof.test/surface-preview.json', {
      fetchImpl: fetcher(compiled, descriptor), cryptoImpl: webcrypto,
    });
    expect(loaded.descriptor.provisional).toBe(true);
    expect(loaded.resources).toHaveLength(1);
    expect(loaded.resources[0].inspection.surfaceIds).toContain(SURFACE.GREEN);
    expect(loaded.resources[0]).not.toHaveProperty('values');
  });

  it('loads from a host that sends no content-length at all', async () => {
    /* Chunked transfer encoding is the ordinary answer from any host that does
       not know the length up front, and this repo's own tools/serve.mjs is one.
       The header was being read with Number(), which turns an absent header
       into a finite 0, so every such response was rejected as "declares 0
       bytes" -- while every fixture here set the header and could not see it.
       The bytes that arrive are still counted and still hashed. */
    const { compiled, descriptor } = fixture();
    const withHeader = fetcher(compiled, descriptor);
    const loaded = await loadSurfacePreview('https://proof.test/surface-preview.json', {
      fetchImpl: async (input, init) => {
        const response = await withHeader(input, init);
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      },
      cryptoImpl: webcrypto,
    });
    expect(loaded.resources).toHaveLength(1);
  });

  it('loads from a host that gzips the chunk, as GitHub Pages does', async () => {
    /* The live failure this file could not see. Pages answers .bvch with
       content-encoding: gzip and a content-length describing the COMPRESSED
       body -- 81628 where the descriptor says 81751. fetch() hands back the
       decoded bytes, so the payload is right and only the header disagrees;
       comparing them failed the pilot closed on the real site while every
       local harness passed, because tools/serve.mjs sends neither header. */
    const { compiled, descriptor } = fixture();
    const withHeader = fetcher(compiled, descriptor);
    const loaded = await loadSurfacePreview('https://proof.test/surface-preview.json', {
      fetchImpl: async (input, init) => {
        const response = await withHeader(input, init);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const headers = new Headers(response.headers);
        if (headers.has('content-length')) {
          /* what a gzipping host reports: encoded length, decoded body */
          headers.set('content-encoding', 'gzip');
          headers.set('content-length', String(bytes.byteLength - 123));
        }
        return new Response(bytes, { status: response.status, headers });
      },
      cryptoImpl: webcrypto,
    });
    expect(loaded.resources).toHaveLength(1);
  });

  it('still rejects a declared byte count that disagrees with the descriptor', async () => {
    const { compiled, descriptor } = fixture();
    const withHeader = fetcher(compiled, descriptor);
    await expect(loadSurfacePreview('https://proof.test/surface-preview.json', {
      fetchImpl: async (input, init) => {
        const response = await withHeader(input, init);
        const headers = new Headers(response.headers);
        if (headers.has('content-length')) headers.set('content-length', '7');
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      },
      cryptoImpl: webcrypto,
    })).rejects.toThrow(/declares 7 bytes/);
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
