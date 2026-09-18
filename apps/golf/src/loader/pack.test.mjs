import { afterEach, expect, it, vi } from 'vitest';
import { loadCourse, packRequestUrl } from './pack.js';

afterEach(() => vi.unstubAllGlobals());

/* One rule, two callers. The chooser's hover warm-up once restated this and got
   it wrong -- no ?v= -- so it fetched a whole pack the player never reused. */
it('asks for a pack by content, from wherever the app is mounted', () => {
  const sha256 = '778f8b2933599fbf' + '0'.repeat(48);
  const base = import.meta.env.BASE_URL;
  expect(packRequestUrl({ packUrl: 'courses/angso/pack.bin', sha256 })).toBe(`${base}courses/angso/pack.bin?v=778f8b2933599fbf`);
  /* an older manifest wrote a leading slash; on a subpath host that would be somebody else's site */
  expect(packRequestUrl({ packUrl: '/courses/angso/pack.bin', sha256 })).toBe(`${base}courses/angso/pack.bin?v=778f8b2933599fbf`);
  expect(packRequestUrl({ packUrl: 'courses/angso/pack.bin' })).toBe(`${base}courses/angso/pack.bin`);
});

it('the player fetches exactly the url the chooser warms', async () => {
  const sha256 = 'ab'.repeat(32);
  const meta = { slug: 'fixture', packUrl: 'courses/fixture/pack.bin', sha256 };
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async url => {
    calls.push(url);
    if (url.endsWith('index.json')) return Response.json({ courses: [meta] });
    return new Response('not a pack', { status: 404 });
  }));
  await expect(loadCourse('fixture')).rejects.toThrow();
  expect(calls).toContain(packRequestUrl(meta));
});
it('starts every independent sidecar before the pack completes and isolates optional failure', async () => {
  let resolvePack;
  const packPromise = new Promise(resolve => { resolvePack = resolve; });
  const calls = [];
  const meta = { slug: 'fixture', packUrl: 'pack.bin', landcover: { url: 'land.json' },
    mownSurface: { url: 'mown.json' }, surroundings: { url: 'surround.json' } };
  vi.stubGlobal('fetch', vi.fn(async url => {
    calls.push(url);
    if (url.endsWith('index.json')) return Response.json({ courses: [meta] });
    if (url.endsWith('pack.bin')) return packPromise;
    if (url.endsWith('mown.json')) return new Response('missing', { status: 404 });
    return Response.json({ value: url });
  }));
  const loading = loadCourse('fixture');
  await vi.waitFor(() => expect(calls).toHaveLength(5));
  const header = new TextEncoder().encode(JSON.stringify({ fmt: 1, slug: 'fixture', HF0: { bytes: 0 }, HF1: { bytes: 0 }, VEC: { bytes: 0 } }));
  const bytes = new Uint8Array(header.length + 8);
  bytes.set(new TextEncoder().encode('GPK1'));
  new DataView(bytes.buffer).setUint32(4, header.length, true); bytes.set(header, 8);
  resolvePack(new Response(bytes));
  const course = await loading;
  expect(course.pack.H.slug).toBe('fixture');
  expect(course.landcover.value).toContain('land.json');
  expect(course.surroundings.value).toContain('surround.json');
  expect(course.mownSurface).toBeNull();
  expect(course.mownSurfaceError).toContain('404');
});
