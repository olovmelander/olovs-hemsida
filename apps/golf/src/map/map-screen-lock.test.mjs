import { afterEach, expect, it, vi } from 'vitest';
import { createScreenLock } from './map-field.mjs';

function phone() {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const request = vi.fn();
  vi.stubGlobal('document', page);
  vi.stubGlobal('navigator', { wakeLock: { request } });
  return { request, page, screen: createScreenLock() };
}

const sentinel = () => Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
afterEach(() => vi.unstubAllGlobals());

it('releases a late grant when the golfer has already turned GPS off', async () => {
  const { request, page, screen } = phone();
  let grant;
  request.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  screen.hold();
  page.dispatchEvent(new Event('visibilitychange'));
  expect(request).toHaveBeenCalledTimes(1);
  screen.release();
  const late = sentinel();
  grant(late);
  await Promise.resolve();
  expect(late.release).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(1);
});

it('keeps the new lock when the browser reports the previous lock released after reopening', async () => {
  const { request, page, screen } = phone();
  const previous = sentinel(), current = sentinel();
  request.mockResolvedValueOnce(previous).mockResolvedValueOnce(current);
  screen.hold();
  await Promise.resolve();
  previous.released = true;
  page.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  previous.dispatchEvent(new Event('release'));
  screen.release();
  expect(current.release).toHaveBeenCalledOnce();
});
