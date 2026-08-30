import { describe, expect, it } from 'vitest';
import { compileTerrainAssets } from '../../../../packages/course-v2/terrain-compiler-node.mjs';
import { createTerrainPreviewDescriptor } from '../../../../packages/course-v2/terrain-preview-node.mjs';
import { createTerrainRenderResource, prepareTerrainRenderData } from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import {
  alignTerrainPreviewToLegacyFrame,
  createTerrainResourceSampler,
  loadPuttomTerrainPreview,
  puttomPreviewRequested,
} from './v2-puttom-preview.mjs';

function fixture() {
  const size = 9;
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = 71 + column * 0.25 + row * 0.5;
  }
  const compiled = compileTerrainAssets({
    groundId: 'bridge-test', courseSlugs: ['bridge-test'], heights,
    width: size, height: size, originEasting: 650000, originNorthing: 6640008,
    tileSegments: 4, codec: 'raw',
  });
  const descriptor = createTerrainPreviewDescriptor(compiled, { label: 'Bridge test' });
  const resources = descriptor.tiles.map(tile => {
    const decoded = verifyChunkAsset(tile.reference, compiled.resources.get(tile.reference.url));
    return createTerrainRenderResource({
      tileId: tile.id,
      decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
      frame: descriptor.frame,
    });
  });
  return { descriptor, resources };
}

describe('Puttom interactive terrain preview bridge', () => {
  it('only enables the explicit Puttom opt-in', () => {
    expect(puttomPreviewRequested('puttom', '?v2=1')).toBe(true);
    expect(puttomPreviewRequested('puttom', '?v2=0')).toBe(false);
    expect(puttomPreviewRequested('upsala', '?v2=1')).toBe(false);
  });

  it('keeps ordinary visits off the v2 network path and reports unsupported courses', async () => {
    const off = await loadPuttomTerrainPreview({ slug: 'puttom', search: '' });
    expect(off).toMatchObject({ requested: false, ready: false, status: 'off' });
    const other = await loadPuttomTerrainPreview({ slug: 'upsala', search: '?v2=1' });
    expect(other).toMatchObject({ requested: true, ready: false, status: 'fallback', reason: 'course-not-enabled' });
  });

  it('turns a missing preview into a non-throwing GPK1 fallback', async () => {
    const fallback = await loadPuttomTerrainPreview({
      slug: 'puttom',
      geo: { origin: { lat: 63.2992, lon: 18.9413 }, frame: 'local metres about ORIGIN; north -z, east +x' },
      search: '?v2=1',
      locationHref: 'https://banvy.test/',
      loaderOptions: { fetchImpl: async () => new Response('missing', { status: 404 }) },
    });
    expect(fallback).toMatchObject({ requested: true, ready: false, status: 'fallback', reason: 'load-failed' });
  });

  it('translates EPSG:5845 resources into legacy x/y/z without changing terrain height', () => {
    const loaded = fixture();
    const legacy = { easting: 650003, northing: 6640005 };
    const aligned = alignTerrainPreviewToLegacyFrame(loaded, legacy);
    expect(aligned.resources).toHaveLength(4);
    expect(aligned.bridge.translateX).toBeCloseTo(1, 9);
    expect(aligned.bridge.translateZ).toBeCloseTo(1, 9);
    expect(aligned.sample(0, 0)).toBeCloseTo(73.25, 2);
    expect(aligned.sample(-3, -3)).toBeCloseTo(71, 2);
    expect(aligned.sample(5.01, 5)).toBeNaN();
  });

  it('samples shared tile boundaries continuously', () => {
    const aligned = alignTerrainPreviewToLegacyFrame(fixture(), {
      easting: 650000, northing: 6640008,
    });
    expect(aligned.sample(4, 4)).toBeCloseTo(74, 2);
    expect(aligned.sample(4 - 1e-7, 4)).toBeCloseTo(aligned.sample(4 + 1e-7, 4), 5);
    expect(createTerrainResourceSampler(aligned.resources).bounds).toEqual(aligned.bounds);
  });
});
