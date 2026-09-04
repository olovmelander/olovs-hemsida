import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RIBBINGSFORS_V2_CONFIG } from './v2-ribbingsfors-config.mjs';
import { loadPublishedGraphTerrainFrontier } from './v2-graph-frontier.mjs';

const PUBLIC = path.resolve(import.meta.dirname, '../../public');
const readJson = relative => JSON.parse(readFileSync(path.join(PUBLIC, relative), 'utf8'));

function publishedGraph() {
  const root = readJson('courses/v2-index.json');
  const entry = root.courses.find(course => course.slug === 'ribbingsfors');
  if (!entry) throw new Error('the committed v2 root has no Ribbingsfors course');
  const course = readJson(entry.manifest.url);
  const ground = readJson(course.groundManifest.url);
  return {
    slug: entry.slug,
    groundId: entry.groundId,
    entry,
    course,
    ground,
    summary: {
      surfaceTiles: ground.tiles.filter(tile => tile.layers.surface).length,
    },
  };
}

function localFetch() {
  return vi.fn(async (url, options) => {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://proof.test') return new Response(null, { status: 403 });
    const relative = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    let bytes;
    try { bytes = readFileSync(path.join(PUBLIC, relative)); }
    catch { return new Response(null, { status: 404 }); }
    return new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    });
  });
}

const GEO = Object.freeze({
  origin: Object.freeze({
    lat: RIBBINGSFORS_V2_CONFIG.packOriginWgs84.latitude,
    lon: RIBBINGSFORS_V2_CONFIG.packOriginWgs84.longitude,
  }),
  mPerLon: RIBBINGSFORS_V2_CONFIG.packMetresPerLongitude,
  frame: RIBBINGSFORS_V2_CONFIG.packFrame,
});

describe('published graph fixed frontier', () => {
  it('verifies and bridges the committed 8 by 8 Ribbingsfors 1 m frontier', async () => {
    const fetchImpl = localFetch();
    const source = await loadPublishedGraphTerrainFrontier({
      graph: publishedGraph(),
      geo: GEO,
      config: RIBBINGSFORS_V2_CONFIG,
      baseUrl: 'https://proof.test/',
      locationHref: 'https://proof.test/app',
      fetchImpl,
    });
    expect(source.ready).toBe(true);
    expect(source.resources).toHaveLength(64);
    expect(source.surfaceDescriptor).toBeNull();
    expect(source.surfaceAtlas).toBeNull();
    expect(source.surfacePolicy).toBe('legacy-ground-atlas');
    expect(source.bounds).toEqual({ x0: -1024, x1: 1024, z0: -1024, z1: 1024 });
    expect(source.legacyBounds).toBe(source.bounds);
    expect(source.bridge).toMatchObject({
      translateX: 0, translateY: 69.14, translateZ: 0,
      rotationRadians: 0, scaleX: 1, scaleZ: 1,
      verticalDatumOffsetMetres: 0,
    });
    expect(source.heightAt(0, 0)).toBeGreaterThan(69);
    expect(source.heightAt(0, 0)).toBeLessThan(104);
    expect(source.renderResources(2)).toHaveLength(64);
    expect(source.renderResources(2)[0]).toMatchObject({
      width: 129, height: 129, sampleSpacingMetres: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(64);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(new URL(url).origin).toBe('https://proof.test');
      expect(options).toMatchObject({
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      });
    }
  }, 30_000);

  it('rejects a changed compatibility-pack frame before requesting a tile', async () => {
    const fetchImpl = localFetch();
    await expect(loadPublishedGraphTerrainFrontier({
      graph: publishedGraph(),
      geo: { ...GEO, frame: 'local metres about a different origin' },
      config: RIBBINGSFORS_V2_CONFIG,
      baseUrl: 'https://proof.test/',
      locationHref: 'https://proof.test/app',
      fetchImpl,
    })).rejects.toThrow(/bridge is no longer valid/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
