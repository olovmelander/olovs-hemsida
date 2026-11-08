/* The weather on a course now, for its page before the round: the temperature,
   the sky, and the wind a golfer plays in (its strength, where it blows from, its
   gusts).

   The reading is engine/weather.js's: Open-Meteo, kept half an hour under the
   course's position, offline the last one marked as such. As everywhere in the
   app, it is never fetched under det=1 or a webdriver (the gates and the
   harnesses must not depend on the weather). */
import { compassName, fetchWeather, weatherWord } from '../engine/weather.js';

/* The words for one reading, or null when it has no wind to tell. Gusts are named
   only when they are at least 2 m/s over the mean, as a forecast would. */
export function weatherLine(w) {
  if (!w || !Number.isFinite(w.windMs) || !Number.isFinite(w.windFromDeg)) return null;
  const wind = Math.round(w.windMs);
  const gust = Number.isFinite(w.gustMs) && w.gustMs >= w.windMs + 2 ? Math.round(w.gustMs) : null;
  return {
    temp: Number.isFinite(w.tempC) ? `${Math.round(w.tempC)}°` : null,
    sky: weatherWord(w.code),
    wind: wind === 0 ? 'Vindstilla' : `${wind} m/s från ${compassName(w.windFromDeg)}${gust ? `, byar ${gust}` : ''}`,
    /* where the wind blows to, for an arrow drawn pointing north */
    towardDeg: Math.round((((w.windFromDeg + 180) % 360) + 360) % 360),
    stale: !!w.stale,
  };
}

/* The reading for a place, unless this visit must not read the weather. */
export function courseWeather(place, { search = globalThis.location?.search ?? '', webdriver = globalThis.navigator?.webdriver } = {}) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return Promise.resolve(null);
  if (webdriver || new URLSearchParams(search).get('det') === '1') return Promise.resolve(null);
  return fetchWeather(place.lat, place.lng).catch(() => null);
}
