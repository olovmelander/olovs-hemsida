import { describe, expect, it } from 'vitest';
import { courseWeather, weatherLine } from './course-weather.mjs';

describe('weatherLine', () => {
  it('says the temperature, the sky and the wind with its gusts', () => {
    const line = weatherLine({ tempC: 8.4, code: 3, windMs: 4.4, windFromDeg: 225, gustMs: 7.2 });
    expect(line).toEqual({ temp: '8°', sky: 'Mulet', wind: '4 m/s från SV, byar 7', towardDeg: 45, stale: false });
  });

  it('leaves out gusts close to the mean, and calls no wind still', () => {
    expect(weatherLine({ tempC: 12, code: 0, windMs: 5, windFromDeg: 0, gustMs: 6.5 }).wind).toBe('5 m/s från N');
    expect(weatherLine({ tempC: 12, code: 0, windMs: 0.3, windFromDeg: 90 }).wind).toBe('Vindstilla');
  });

  it('marks an old reading, and has nothing to say without wind', () => {
    expect(weatherLine({ tempC: 2, code: 61, windMs: 3, windFromDeg: 350, stale: true }).stale).toBe(true);
    expect(weatherLine({ tempC: 2, code: 61 })).toBeNull();
    expect(weatherLine(null)).toBeNull();
  });
});

describe('courseWeather', () => {
  it('never reads the weather under a webdriver or det=1', async () => {
    const place = { lat: 59.5675, lng: 16.8684 };
    expect(await courseWeather(place, { search: '', webdriver: true })).toBeNull();
    expect(await courseWeather(place, { search: '?det=1', webdriver: false })).toBeNull();
    expect(await courseWeather(null, { search: '', webdriver: false })).toBeNull();
  });
});
