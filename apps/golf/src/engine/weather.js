/* Live conditions for the rangefinder, from Open-Meteo (free, no key, CORS open).
   One reading per course, cached for half an hour so a round does not fetch on
   every tap; offline returns the last reading it has, marked stale, or null so
   the card can say so. Nothing here touches the DOM. */
export const WEATHER_TTL_MS = 30 * 60 * 1000;

export function openMeteoUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code',
    wind_speed_unit: 'ms', timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* the fields the card uses; null when the payload has no usable wind */
export function parseOpenMeteo(json) {
  const c = json && json.current;
  if (!c) return null;
  const r = { tempC: num(c.temperature_2m), windMs: num(c.wind_speed_10m), windFromDeg: num(c.wind_direction_10m),
              gustMs: num(c.wind_gusts_10m), code: num(c.weather_code), time: typeof c.time === 'string' ? c.time : null };
  return r.windMs !== null && r.windFromDeg !== null ? r : null;
}

export async function fetchWeather(lat, lon, { ttlMs = WEATHER_TTL_MS, storage = null, fetchImpl = null, now = Date.now } = {}) {
  const key = `banvy-weather:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  let cached = null;
  try { const raw = store && store.getItem(key); if (raw) cached = JSON.parse(raw); } catch { cached = null; }
  const t = now();
  if (cached && Number.isFinite(cached.fetchedAt) && t - cached.fetchedAt < ttlMs) return { ...cached, source: 'cache', stale: false };
  const f = fetchImpl || (typeof fetch === 'function' ? (u => fetch(u)) : null);
  if (f) {
    try {
      const res = await f(openMeteoUrl(lat, lon));
      if (res && res.ok) {
        const parsed = parseOpenMeteo(await res.json());
        if (parsed) {
          const rec = { ...parsed, fetchedAt: t };
          try { if (store) store.setItem(key, JSON.stringify(rec)); } catch { /* storage may be full or blocked */ }
          return { ...rec, source: 'open-meteo', stale: false };
        }
      }
    } catch { /* offline or the API is down: fall through to the last reading */ }
  }
  return cached ? { ...cached, source: 'cache', stale: true } : null;
}

/* SMHI's eight-point compass, the way a Swedish forecast prints it */
export function compassName(deg) {
  const names = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/* WMO weather code to one Swedish word */
export function weatherWord(code) {
  if (code === null || code === undefined) return 'Väder';
  if (code === 0) return 'Klart';
  if (code <= 2) return 'Halvklart';
  if (code === 3) return 'Mulet';
  if (code <= 48) return 'Dimma';
  if (code <= 57) return 'Duggregn';
  if (code <= 67) return 'Regn';
  if (code <= 77) return 'Snö';
  if (code <= 82) return 'Regnskurar';
  if (code <= 86) return 'Snöbyar';
  return 'Åska';
}
