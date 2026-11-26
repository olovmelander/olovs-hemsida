import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchPlayingHeightArt, retainPlayingHeightArt } from './playing-height-art-cache.mjs';

const url = 'https://banvy.test/golf/assets/bank-norrfallsviken-DI0_SnqZ.bin';
const model = 'https://banvy.test/golf/models/trees/realistic-v2/' + 'a'.repeat(64) + '.glb';
const put = vi.fn(), open = vi.fn(), fetchArt = vi.fn();
beforeEach(() => {
  open.mockResolvedValue({ put });
  vi.stubGlobal('location',new URL('https://banvy.test/golf/'));
  vi.stubGlobal('navigator',{serviceWorker:{controller:null}});
  vi.stubGlobal('caches',{open});
  vi.stubGlobal('fetch',fetchArt);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('fills the Workbox cache even if the first worker takes control during the request',async () => {
  fetchArt.mockImplementation(() => {
    globalThis.navigator.serviceWorker.controller = {};
    return Promise.resolve(new Response('asset'));
  });
  const response = await fetchPlayingHeightArt(url);
  expect(open).toHaveBeenCalledWith('banvy-playing-height-art');
  expect(put.mock.calls[0][0]).toBe(url);
  expect(await put.mock.calls[0][1].text()).toBe('asset');
  expect(await response.text()).toBe('asset');
  await retainPlayingHeightArt(model,new Response('verified glb'),false);
  expect(open).toHaveBeenLastCalledWith('banvy-ghibli-foliage-assets');
});
it('only accepts a fresh immutable same-origin art GET and a usable binary response',async () => {
  await retainPlayingHeightArt(url,new Response('x'),true);
  await retainPlayingHeightArt(url.replace('banvy.test','other.test'),new Response('x'),false);
  await retainPlayingHeightArt(url.replace('-DI0_SnqZ',''),new Response('x'),false);
  await retainPlayingHeightArt(url+'?version=else',new Response('x'),false);
  await retainPlayingHeightArt(url.replace(/[^/]+$/,'other-12345678.webp'),new Response('x'),false);
  await retainPlayingHeightArt(new Request(url,{method:'POST'}),new Response('x'),false);
  await retainPlayingHeightArt(url,new Response('error',{status:404}),false);
  await retainPlayingHeightArt(url,new Response('<html>',{headers:{'Content-Type':'text/html'}}),false);
  expect(open).not.toHaveBeenCalled();
});
it('a full cache does not lose the decoded art',async () => {
  put.mockRejectedValue(new Error('QuotaExceededError'));
  fetchArt.mockResolvedValue(new Response('image'));
  const response = await fetchPlayingHeightArt('./assets/normal-roughness-ML8yVJHY.webp');
  expect(put).toHaveBeenCalledOnce();
  expect(await response.text()).toBe('image');
});
