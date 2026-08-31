import { describe, expect, it } from 'vitest';
import { canonicalJsonBytes } from '../../../../packages/course-v2/canonical-json.mjs';
import { createSyntheticAssetGraph } from '../../../../packages/course-v2/synthetic-fixture.mjs';
import { resolvePublishedGraph } from './v2-graph-source.mjs';

const BASE = 'https://banvy.test/app/';
const ROOT_URL = new URL('courses/v2-index.json', BASE).href;

function graphFetch(graph, { rootBytes } = {}) {
  const fetched = [];
  const fetchImpl = async url => {
    fetched.push(String(url));
    if (String(url) === ROOT_URL) return new Response(rootBytes ?? canonicalJsonBytes(graph.root));
    const relative = new URL(url).pathname.replace('/app/', '');
    const resource = graph.resources.get(relative);
    return resource ? new Response(resource) : new Response('missing', { status: 404 });
  };
  return { fetched, fetchImpl };
}

function livePackMeta(entry) {
  return {
    slug: entry.slug,
    packUrl: entry.fallbackV1.packUrl,
    bytes: entry.fallbackV1.bytes,
    sha256: entry.fallbackV1.sha256,
  };
}

describe('resolvePublishedGraph', () => {
  it('resolves and verifies a published graph and summarises it without fetching chunks', async () => {
    const graph = createSyntheticAssetGraph();
    const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
    const { fetched, fetchImpl } = graphFetch(graph);
    const resolved = await resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: '/app/',
      locationHref: 'https://banvy.test/app/?bana=synthetic-main&v2=1',
      packMeta: livePackMeta(entry),
      fetchImpl,
    });
    expect(resolved.groundId).toBe('synthetic-ground');
    expect(resolved.rootSource).toBe('network');
    expect(resolved.summary.tiles).toBe(2);
    expect(resolved.summary.holes).toBe(2);
    expect(resolved.summary.shellBytes).toBe(resolved.ground.shell.bytes);
    expect(resolved.summary.encodedTerrainBytes).toBe(
      resolved.ground.shell.bytes +
      resolved.ground.tiles.reduce((sum, tile) => sum + tile.layers.terrain.bytes, 0),
    );
    expect(fetched).toHaveLength(3);
    expect(fetched.some(url => url.endsWith('.bvch'))).toBe(false);
  });

  it('refuses to select a graph whose fallback is not the live GPK1 pack', async () => {
    const graph = createSyntheticAssetGraph();
    const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
    const withDifferentSha = { ...livePackMeta(entry), sha256: 'b'.repeat(64) };
    await expect(resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: withDifferentSha,
      fetchImpl: graphFetch(graph).fetchImpl,
    })).rejects.toThrow(/does not match the live course manifest/);

    const withDifferentBytes = { ...livePackMeta(entry), bytes: entry.fallbackV1.bytes + 1 };
    await expect(resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: withDifferentBytes,
      fetchImpl: graphFetch(graph).fetchImpl,
    })).rejects.toThrow(/does not match the live course manifest/);
  });

  it('tolerates a leading slash difference in the fallback pack URL only', async () => {
    const graph = createSyntheticAssetGraph();
    const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
    const resolved = await resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: { ...livePackMeta(entry), packUrl: `/${entry.fallbackV1.packUrl}` },
      fetchImpl: graphFetch(graph).fetchImpl,
    });
    expect(resolved.slug).toBe('synthetic-main');

    await expect(resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: { ...livePackMeta(entry), packUrl: 'courses/other/pack.bin' },
      fetchImpl: graphFetch(graph).fetchImpl,
    })).rejects.toThrow(/does not match the live course manifest/);
  });

  it('fails on a missing root, an unlisted course and a corrupt root', async () => {
    const graph = createSyntheticAssetGraph();
    const entry = graph.root.courses.find(course => course.slug === 'synthetic-main');
    const meta = livePackMeta(entry);

    await expect(resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: meta,
      fetchImpl: async () => new Response('missing', { status: 404 }),
    })).rejects.toThrow(/root manifest could not be loaded/);

    await expect(resolvePublishedGraph({
      slug: 'not-published',
      baseUrl: BASE,
      packMeta: { ...meta, slug: 'not-published' },
      fetchImpl: graphFetch(graph).fetchImpl,
    })).rejects.toThrow(/no course not-published/);

    const corrupt = canonicalJsonBytes({ schemaVersion: 2, courses: [] });
    await expect(resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: meta,
      fetchImpl: graphFetch(graph, { rootBytes: corrupt }).fetchImpl,
    })).rejects.toThrow(/root manifest could not be loaded/);
  });

  it('requires the live GPK1 identity before any request', async () => {
    let fetches = 0;
    await expect(resolvePublishedGraph({
      slug: 'synthetic-main',
      baseUrl: BASE,
      packMeta: { packUrl: 'courses/synthetic-main/pack.bin', bytes: 4096, sha256: 'not-a-sha' },
      fetchImpl: async () => { fetches++; throw new Error('unreachable'); },
    })).rejects.toThrow(/live GPK1 manifest identity/);
    expect(fetches).toBe(0);
  });
});
