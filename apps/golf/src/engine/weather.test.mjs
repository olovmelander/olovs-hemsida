import { describe, it, expect } from 'vitest';
import { fetchWeather, parseOpenMeteo, openMeteoUrl, compassName, weatherWord, WEATHER_TTL_MS } from './weather.js';

const payload = { current: { time: '2026-09-03T19:00', temperature_2m: 15.1, wind_speed_10m: 1.6, wind_direction_10m: 283, wind_gusts_10m: 4.8, weather_code: 0 } };
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
const okFetch = (calls, body = payload) => async url => { calls.push(url); return { ok: true, json: async () => body }; };

describe('openMeteoUrl', () => {
  it('asks for wind in m/s at the course origin', () => {
    const u = openMeteoUrl(63.2992, 18.9413);
    expect(u).toContain('latitude=63.2992');
    expect(u).toContain('wind_speed_unit=ms');
    expect(u).toContain('wind_direction_10m');
  });
});

describe('parseOpenMeteo', () => {
  it('keeps the fields the card uses', () => {
    expect(parseOpenMeteo(payload)).toEqual({ tempC: 15.1, windMs: 1.6, windFromDeg: 283, gustMs: 4.8, code: 0, time: '2026-09-03T19:00' });
  });
  it('refuses a payload without wind', () => {
    expect(parseOpenMeteo({ current: { temperature_2m: 10 } })).toBeNull();
    expect(parseOpenMeteo(null)).toBeNull();
  });
});

describe('fetchWeather', () => {
  it('fetches once, then serves the cache inside the TTL', async () => {
    const calls = [], storage = memStore();
    let t = 1_000_000;
    const opts = { storage, fetchImpl: okFetch(calls), now: () => t };
    const a = await fetchWeather(63.2992, 18.9413, opts);
    expect(a.source).toBe('open-meteo');
    expect(a.windMs).toBe(1.6);
    t += WEATHER_TTL_MS / 2;
    const b = await fetchWeather(63.2992, 18.9413, opts);
    expect(b.source).toBe('cache');
    expect(b.stale).toBe(false);
    expect(calls.length).toBe(1);
    t += WEATHER_TTL_MS;
    await fetchWeather(63.2992, 18.9413, opts);
    expect(calls.length).toBe(2);
  });
  it('offline, hands back the last reading marked stale, or null with none', async () => {
    const storage = memStore();
    let t = 5_000_000;
    const failing = async () => { throw new Error('offline'); };
    expect(await fetchWeather(63.3, 18.9, { storage, fetchImpl: failing, now: () => t })).toBeNull();
    await fetchWeather(63.3, 18.9, { storage, fetchImpl: okFetch([]), now: () => t });
    t += 2 * WEATHER_TTL_MS;
    const w = await fetchWeather(63.3, 18.9, { storage, fetchImpl: failing, now: () => t });
    expect(w.source).toBe('cache');
    expect(w.stale).toBe(true);
  });
});

describe('names', () => {
  it('uses SMHI compass points', () => {
    expect(compassName(0)).toBe('N');
    expect(compassName(283)).toBe('V');
    expect(compassName(225)).toBe('SV');
    expect(compassName(359)).toBe('N');
  });
  it('turns a WMO code into a Swedish word', () => {
    expect(weatherWord(0)).toBe('Klart');
    expect(weatherWord(3)).toBe('Mulet');
    expect(weatherWord(61)).toBe('Regn');
    expect(weatherWord(95)).toBe('Åska');
  });
});
