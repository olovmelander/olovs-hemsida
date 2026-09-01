import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileTerrainAssets } from '../../../../packages/course-v2/terrain-compiler-node.mjs';
import { createTerrainPreviewDescriptor } from '../../../../packages/course-v2/terrain-preview-node.mjs';
import { loadTerrainPreview } from './v2-terrain-preview-loader.mjs';

function fixture() {
  const width = 9, height = 9;
  const heights = new Float32Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    heights[row * width + column] = 41 + Math.sin(column / 3) + row * 0.2;
  }
  const compiled = compileTerrainAssets({
    groundId: 'proof-ground', courseSlugs: ['proof-course'], heights,
    width, height, originEasting: 650000, originNorthing: 6640008,
    tileSegments: 4, codec: 'raw',
  });
  const descriptor = createTerrainPreviewDescriptor(compiled, { label: 'Riktig terräng' });
  return { compiled, descriptor };
}

function fetcher(compiled, descriptor, mutate = bytes => bytes) {
  return async input => {
    const url = new URL(input);
    if (url.pathname === '/preview.json') {
      return new Response(JSON.stringify(descriptor), { headers: { 'content-type': 'application/json' } });
    }
    const relative = url.pathname.slice(1);
    const source = compiled.resources.get(relative);
    if (!source) return new Response('missing', { status: 404 });
    const bytes = mutate(new Uint8Array(source), relative);
    return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } });
  };
}

describe('real terrain preview loader', () => {
  it('verifies every BVCH before creating renderer resources', async () => {
    const { compiled, descriptor } = fixture();
    const loaded = await loadTerrainPreview('https://proof.test/preview.json', {
      fetchImpl: fetcher(compiled, descriptor),
      cryptoImpl: webcrypto,
    });
    expect(loaded.descriptor.provisional).toBe(true);
    expect(loaded.resources).toHaveLength(4);
    expect(loaded.resources.every(resource => resource.layout === 'rgba8x2-height-parent-octnormal-v1')).toBe(true);
    expect(loaded.resources.every(resource => resource.noDataCount === 0)).toBe(true);
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
    const loaded = await loadTerrainPreview('https://proof.test/preview.json', {
      fetchImpl: async (input, init) => {
        const response = await withHeader(input, init);
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      },
      cryptoImpl: webcrypto,
    });
    expect(loaded.resources).toHaveLength(4);
  });

  it('still rejects a declared byte count that disagrees with the descriptor', async () => {
    const { compiled, descriptor } = fixture();
    const withHeader = fetcher(compiled, descriptor);
    await expect(loadTerrainPreview('https://proof.test/preview.json', {
      fetchImpl: async (input, init) => {
        const response = await withHeader(input, init);
        const headers = new Headers(response.headers);
        if (headers.has('content-length')) headers.set('content-length', '7');
        return new Response(await response.arrayBuffer(), { status: response.status, headers });
      },
      cryptoImpl: webcrypto,
    })).rejects.toThrow(/declares 7 bytes/);
  });

  it('fails closed when a retained preview chunk is corrupt', async () => {
    const { compiled, descriptor } = fixture();
    await expect(loadTerrainPreview('https://proof.test/preview.json', {
      fetchImpl: fetcher(compiled, descriptor, bytes => {
        const changed = new Uint8Array(bytes);
        changed[changed.length - 1] ^= 1;
        return changed;
      }),
      cryptoImpl: webcrypto,
    })).rejects.toThrow(/integrity mismatch/);
  });

  it('locks a published descriptor to its reviewed SHA-256', async () => {
    const { compiled, descriptor } = fixture();
    await expect(loadTerrainPreview('https://proof.test/preview.json', {
      fetchImpl: fetcher(compiled, descriptor),
      cryptoImpl: webcrypto,
      expectedDescriptorSha256: '0'.repeat(64),
    })).rejects.toThrow(/descriptor integrity mismatch/);
  });
});
