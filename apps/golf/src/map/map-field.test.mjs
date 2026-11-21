import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGps, createGuidanceFix, FRESH_FIX_MS } from './map-field.mjs';

const tee = [0, 0], ball = [30, 80], next = [20, 140];
const player = (point, accuracy = 5, onCourse = true) => ({ point, accuracy, onCourse });

describe('the origin of the suggested shot', () => {
  it('uses a reliable fix only on the hole being played and returns to the tee after stopping', () => {
    const fix = createGuidanceFix(), now = 40000;
    const read = playing => fix.origin(tee, playing, now);
    expect(read(true)).toEqual({ point: tee, source: 'tee' });
    fix.receive(player(ball), now, now);
    expect(read(true)).toEqual({ point: ball, source: 'gps' });
    expect(read(false)).toEqual({ point: tee, source: 'tee' });
    fix.clear();
    expect(read(true)).toEqual({ point: tee, source: 'tee' });
  });

  it('expires a cached fix from the sample time and holds the last good point until reliable GPS returns', () => {
    const fix = createGuidanceFix(), now = 40000;
    const read = at => fix.origin(tee, true, at);
    fix.receive(player(ball), now - 2000, now);
    expect(fix.expiresAt).toBe(now - 2000 + FRESH_FIX_MS);
    expect(read(fix.expiresAt - 1).source).toBe('gps');
    expect(read(fix.expiresAt)).toEqual({ point: ball, source: 'last-gps' });
    expect(fix.receive(player(next), now, now + FRESH_FIX_MS)).toBe(false);
    expect(read(now + FRESH_FIX_MS)).toEqual({ point: ball, source: 'last-gps' });
    expect(fix.receive(player(next, 34, false), now + 11000, now + 11000)).toBe(false);
    expect(read(now + 11000)).toEqual({ point: ball, source: 'last-gps' });
    fix.receive(player(next), now + 12000, now + 12000);
    expect(read(now + 12000)).toEqual({ point: next, source: 'gps' });
    fix.interrupt();
    expect(read(now + 12000)).toEqual({ point: next, source: 'last-gps' });
    fix.receive(player(next, 5, false), now + 13000, now + 13000);
    expect(read(now + 13000)).toEqual({ point: tee, source: 'tee' });
  });
});

describe('phone geolocation callbacks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces recovery requests and ignores a one-off timeout after a newer watch fix', () => {
    const geolocation = {
      watchPosition: vi.fn(() => 7), clearWatch: vi.fn(), getCurrentPosition: vi.fn(),
    };
    vi.stubGlobal('navigator', { geolocation });
    const onFix = vi.fn(), onFailure = vi.fn(), gps = createGps({ onFix, onFailure });
    gps.start();
    gps.ask();
    gps.ask();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    const [watch] = geolocation.watchPosition.mock.calls[0];
    watch({ coords: { accuracy: 4 }, timestamp: 100 });
    geolocation.getCurrentPosition.mock.calls[0][1]({ code: 3 });
    expect(onFailure).not.toHaveBeenCalled();
    gps.ask();
    geolocation.getCurrentPosition.mock.calls[1][1]({ code: 3 });
    expect(onFailure).toHaveBeenCalledWith('GPS svarar inte ännu');
    expect(gps.active).toBe(true);
  });

  it('reports permission loss even when the browser silently drops its watch', async () => {
    const permission = Object.assign(new EventTarget(), { state: 'granted' });
    const geolocation = {
      watchPosition: vi.fn(() => 20), clearWatch: vi.fn(), getCurrentPosition: vi.fn(),
    };
    vi.stubGlobal('navigator', { geolocation, permissions: { query: async () => permission } });
    const onFix = vi.fn(), onFailure = vi.fn(), gps = createGps({ onFix, onFailure });
    gps.start();
    await Promise.resolve();
    gps.ask();
    permission.state = 'denied';
    permission.dispatchEvent(new Event('change'));
    expect(gps.active).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining('Platsåtkomst'), { denied: true });
    expect(geolocation.clearWatch).toHaveBeenCalledWith(20);
    geolocation.getCurrentPosition.mock.calls[0][0]({ coords: {}, timestamp: 100 });
    expect(onFix).not.toHaveBeenCalled();
    permission.dispatchEvent(new Event('change'));
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('passes the sensor timestamp and discards watch, error and one-off callbacks from a previous session', () => {
    const geolocation = {
      watchPosition: vi.fn(() => 17), clearWatch: vi.fn(), getCurrentPosition: vi.fn(),
    };
    vi.stubGlobal('navigator', { geolocation });
    const onFix = vi.fn(), onFailure = vi.fn(), gps = createGps({ onFix, onFailure });
    gps.start();
    gps.ask();
    const [watched, failed] = geolocation.watchPosition.mock.calls[0];
    const [asked] = geolocation.getCurrentPosition.mock.calls[0];
    const position = { coords: { latitude: 60, longitude: 18, accuracy: 4 }, timestamp: 1234 };
    watched(position);
    asked(position);
    expect(onFix.mock.calls).toEqual([[position.coords, 1234], [position.coords, 1234]]);
    gps.stop();
    gps.start();
    watched(position);
    asked(position);
    failed({ code: 1 });
    expect(onFix).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
    expect(gps.active).toBe(true);
    expect(geolocation.clearWatch.mock.calls).toEqual([[17]]);
  });
});
