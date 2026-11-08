/* What the start menu's Inställningar can set, and how a choice reaches the
   program it is for. Pure: no DOM, and storage is passed in, so every rule here
   is tested without a browser (settings-store.test.mjs).

   THE DETAILED COURSE IS NOT EDITED TO READ THESE. main.js, engine/ and loader/
   feed the prepared startup data's source revision, and any edit there turns
   that data off until the next bake. So a setting for the detailed course
   reaches it the way a shared link always has -- as the URL grammar it already
   reads (q, gl, ljus, vy) -- or through the storage key it already reads
   (banvy-fps, banvy:dev-overlay, the caddie bag). The light map's settings are
   the map's own stored keys, written in the map's own formats. One home for
   each value: nothing here keeps a second copy of something another program
   stores. */

export const SETTINGS_KEY = 'banvy-settings-v1';
export const LAST_COURSE_KEY = 'banvy-last-course';
export const LAST_MODE_KEY = 'banvy-last-mode';

/* The two ways to play, as the start menu names them. `route` is the hub's
   hash; `mode` is what a launch is asked for. */
export const MODES = Object.freeze({
  detailed: Object.freeze({ route: '3d', label: 'Detaljerad 3D', short: 'Detaljerad', cta: 'Starta i 3D' }),
  map: Object.freeze({ route: 'karta', label: 'Lätt 3D', short: 'Lätt 3D', cta: 'Öppna kartan' }),
});
export const modeOfRoute = route => Object.keys(MODES).find(mode => MODES[mode].route === route) || null;

/* ---------------------------------------------------------------- the lights
   One table for both programs, since they name the same nine lights
   differently: the player's ?ljus= words (main.js LJUS2P) and the map's keys
   (map-light.mjs). The swatch is each preset's own environment -- zenith,
   horizon, ground -- from engine/atmosphere-presets.mjs, so a tile looks like
   the light it starts; the test holds both name lists and the colours. */
export const LIGHTS = Object.freeze([
  { preset: 'golden', label: 'Kväll', player: 'kvall', map: 'kvall', sky: ['#6c91bc', '#d3b89a', '#9c9984'] },
  { preset: 'noon', label: 'Dag', player: 'dag', map: 'dag', sky: ['#568bc6', '#c3dbe9', '#9aa68d'] },
  { preset: 'summer', label: 'Sommar', player: 'sommar', map: 'sommar', sky: ['#4f8fcb', '#c0dcec', '#9aa68d'] },
  { preset: 'dawn', label: 'Gryning', player: 'gryning', map: 'gryning', sky: ['#8295ba', '#d5bbc9', '#98998e'] },
  { preset: 'midnight', label: 'Midnattssol', player: 'midnattssol', map: 'midnatt', sky: ['#7686ae', '#c8a59f', '#959082'] },
  { preset: 'bluehour', label: 'Blå timmen', player: 'blatimmen', map: 'bla', sky: ['#435f98', '#889bbb', '#737e91'] },
  { preset: 'storm', label: 'Oväder', player: 'ovader', map: 'ovader', sky: ['#536677', '#8799a5', '#7e8887'] },
  { preset: 'mist', label: 'Dis', player: 'dis', map: 'dis', sky: ['#a2b8c4', '#c8d6d9', '#a8b0a5'] },
  { preset: 'host', label: 'Höst', player: 'host', map: 'host', sky: ['#849aae', '#c9b193', '#a29477'] },
  { preset: 'winter', label: 'Vinter', player: 'vinter', map: 'vinter', sky: ['#6f9bd0', '#cfdbe8', '#c6ccd4'] },
].map(Object.freeze));
/* Nu: the real sun over the course, its season and the weather now. Both
   programs know it by the same word. */
export const NOW_LIGHT = Object.freeze({ label: 'Nu', player: 'nu', map: 'nu' });
/* What each program opens in when nobody has said: the player's golden hour
   (main.js), the map's summer day (map-light.mjs DEFAULT_LIGHT). */
export const PLAYER_DEFAULT_LIGHT = 'kvall';
export const MAP_DEFAULT_LIGHT = 'sommar';

const playerLights = new Set([NOW_LIGHT.player, ...LIGHTS.map(light => light.player)]);
export const mapLights = new Set([NOW_LIGHT.map, ...LIGHTS.map(light => light.map)]);

/* ------------------------------------------------------ the detailed course */
export const QUALITY = Object.freeze([
  { value: 'auto', label: 'Auto' }, { value: 'hi', label: 'Hög' }, { value: 'lo', label: 'Låg' },
]);
export const RENDERERS = Object.freeze([
  { value: 'auto', label: 'Auto' }, { value: 'webgl', label: 'WebGL2' },
]);
/* main.js VY2CAM: fritt is the orbit it opens in when nothing is asked */
export const START_VIEWS = Object.freeze([
  { value: 'fritt', label: 'Fri' }, { value: 'tee', label: 'Tee' },
  { value: 'green', label: 'Green' }, { value: 'ovan', label: 'Ovanifrån' },
]);
/* engine/frame-pacer.mjs FRAME_CAPS, in the order a person reads them */
export const FRAME_CAP_CHOICES = Object.freeze([
  { value: 30, label: '30' }, { value: 60, label: '60' }, { value: 0, label: 'Obegränsad' },
]);

const DEFAULTS = Object.freeze({ quality: 'auto', renderer: 'auto', light: PLAYER_DEFAULT_LIGHT, view: 'fritt' });
const ALLOWED = {
  quality: new Set(QUALITY.map(choice => choice.value)),
  renderer: new Set(RENDERERS.map(choice => choice.value)),
  light: playerLights,
  view: new Set(START_VIEWS.map(choice => choice.value)),
};

/* A stored value outside its set is ignored, never trusted: a hand-edited or
   older value must not become a URL the player cannot read. */
export function readSettings(storage) {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? '{}') ?? {}; } catch { saved = {}; }
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (ALLOWED[key].has(saved?.[key])) settings[key] = saved[key];
  }
  return settings;
}

export function writeSettings(storage, patch) {
  const next = { ...readSettings(storage), ...patch };
  for (const key of Object.keys(next)) if (!ALLOWED[key]?.has(next[key])) delete next[key];
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* it holds for this visit */ }
  return readSettings(storage) ?? next;
}

/* Only what differs from the player's own default goes into the link, so an
   untouched setup launches the same plain URL it always did. */
export function detailedParams(settings) {
  const params = [];
  if (settings.quality === 'hi' || settings.quality === 'lo') params.push(['q', settings.quality]);
  if (settings.renderer === 'webgl') params.push(['gl', '1']);
  if (settings.light && settings.light !== PLAYER_DEFAULT_LIGHT && playerLights.has(settings.light)) params.push(['ljus', settings.light]);
  if (settings.view && settings.view !== 'fritt' && ALLOWED.view.has(settings.view)) params.push(['vy', settings.view]);
  return params;
}

/* The link a course card opens, for the mode the visitor chose. A phone opens
   the map by default (map-default.mjs), so a phone asking for the detailed
   course has to say karta=0; elsewhere the plain link already means it. The
   map always says karta=1, as mapUrl has since the map arrived. */
/* `plan` is what the course page sets up before a round: a tee (an index into
   the course's tees), the hole to start on, a light for this visit, and for the
   map whether the round begins at once (runda=1, map-session.js). */
export function launchUrl(slug, mode, { phone = false, settings = DEFAULTS, plan = null } = {}) {
  const params = new URLSearchParams();
  params.set('bana', slug);
  const hole = Number(plan?.hole);
  if (mode === 'map') {
    params.set('karta', '1');
    if (plan?.round) params.set('runda', '1');
    if (Number.isInteger(hole) && hole > 1) params.set('hal', String(hole));
    return '?' + params.toString();
  }
  if (phone) params.set('karta', '0');
  for (const [key, value] of detailedParams(settings)) params.set(key, value);
  /* main.js reads ?tee= from 1 to 6 and ?hal= as the hole to open on */
  const tee = Number(plan?.tee);
  if (Number.isInteger(tee) && tee >= 0 && tee < 6) params.set('tee', String(tee + 1));
  if (Number.isInteger(hole) && hole > 1) params.set('hal', String(hole));
  if (plan?.light && playerLights.has(plan.light)) {
    if (plan.light === PLAYER_DEFAULT_LIGHT) params.delete('ljus'); else params.set('ljus', plan.light);
  }
  return '?' + params.toString();
}

/* The tee a player last chose on a course, shared with the map (map-session.js TEE_KEY). */
export const TEE_KEY = 'banvy-map-tee-v1';
export function savedTee(storage, course) {
  const fallback = course?.tees?.def ?? 0;
  const text = readText(storage, `${TEE_KEY}:${course?.slug}`, null);
  const index = Number(text);
  return text !== null && Number.isInteger(index) && index >= 0 && index < (course?.tees?.names?.length ?? 0) ? index : fallback;
}
export const teeColour = value => `#${(Number(value) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/* Switching course inside the player keeps that visit's own q and gl (router
   courseUrl) and adds the start settings only where the link is silent. */
export function withSettings(search, settings) {
  const params = new URLSearchParams(search);
  for (const [key, value] of detailedParams(settings)) if (!params.has(key)) params.set(key, value);
  return '?' + params.toString();
}

/* ---------------------------------------------------- the last way played */
export function rememberLaunch(storage, slug, mode) {
  try {
    storage?.setItem(LAST_COURSE_KEY, slug);
    if (MODES[mode]) storage?.setItem(LAST_MODE_KEY, mode);
  } catch { /* the start menu simply offers no shortcut */ }
}

export function lastLaunch(storage, courses) {
  let slug = null, mode = null;
  try { slug = storage?.getItem(LAST_COURSE_KEY); mode = storage?.getItem(LAST_MODE_KEY); } catch { return null; }
  const course = courses.find(c => c.slug === slug);
  if (!course) return null;
  return { course, mode: MODES[mode] ? mode : 'detailed' };
}

/* A backup of everything Banvy keeps on this device: settings, the bag, the
   handicap, every round and shot, and what the map remembers. Rounds live in
   this browser only, so clearing its data or changing phone loses them; a file
   the player keeps is the way across. Only Banvy's own keys go out and come in. */
export const BACKUP_KIND = 'banvy-backup';
const OWN_KEY = /^banvy[-:]/;
export function exportBackup(storage, now = new Date()) {
  const data = {};
  try {
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage.key(i);
      if (key && OWN_KEY.test(key)) data[key] = storage.getItem(key);
    }
  } catch { /* what could be read */ }
  return { kind: BACKUP_KIND, version: 1, exportedAt: now.toISOString(), data };
}
export function readBackup(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { return { ok: false, reason: 'Filen är inte en Banvy-säkerhetskopia.' }; }
  if (backup?.kind !== BACKUP_KIND || backup.version !== 1 || typeof backup.data !== 'object' || backup.data === null) {
    return { ok: false, reason: 'Filen är inte en Banvy-säkerhetskopia.' };
  }
  const entries = Object.entries(backup.data).filter(([key, value]) => OWN_KEY.test(key) && typeof value === 'string');
  if (!entries.length) return { ok: false, reason: 'Säkerhetskopian är tom.' };
  return { ok: true, entries, exportedAt: backup.exportedAt ?? null };
}
export function restoreBackup(storage, entries) {
  let written = 0;
  for (const [key, value] of entries) if (writeText(storage, key, value)) written++;
  return written;
}

/* A round under way in the map: begun and not ended, and touched within the
   map's own resume window (map-session.js RESUME_MS, six hours). The freshest
   wins. The start menu offers it before anything else. */
export const ROUND_KEY = 'banvy-map-round-v1';
export const HOLE_KEY = 'banvy-map-hole-v1';
const RESUME_MS = 6 * 60 * 60 * 1000;
export function liveRound(storage, courses, now = Date.now()) {
  let best = null;
  for (const course of courses) {
    let round = null, hole = null;
    try { round = JSON.parse(storage?.getItem(`${ROUND_KEY}:${course.slug}`) ?? 'null'); } catch { round = null; }
    if (!round || round.endedAt || typeof round.scores !== 'object' || round.scores === null) continue;
    const played = Object.values(round.scores).filter(score => score && (score.picked || Number.isFinite(score.strokes)));
    if (!round.begunAt && !played.length) continue;
    try { hole = JSON.parse(storage?.getItem(`${HOLE_KEY}:${course.slug}`) ?? 'null'); } catch { hole = null; }
    const touched = Math.max(Number(round.begunAt) || 0, Number(hole?.at) || 0);
    if (!touched || now - touched > RESUME_MS) continue;
    if (!best || touched > best.touched) {
      best = { course, touched, hole: Number(hole?.value) || null, holes: played.length,
        strokes: played.reduce((sum, score) => sum + (Number.isFinite(score.strokes) ? score.strokes : 0), 0) };
    }
  }
  return best;
}

/* ------------------------------------------------------------ the light map
   The map's own keys and formats (map-session.js, map-display.mjs). */
export const MAP_KEYS = Object.freeze({
  light: 'banvy-map-light-v1',
  display: 'banvy-map-display-v1',
  contours: 'banvy-map-contours-v1',
  hazards: 'banvy-map-hazards-v1',
  quality: 'banvy-map-quality-v1',
  handicap: 'banvy-map-handicap-v1',
  rounds: 'banvy-map-rounds-v1',
  shots: 'banvy-map-shots-v1',
});
/* map-session.js QUALITY_STEPS, read from its end: what a slow phone gives up */
export const MAP_DETAIL = Object.freeze([
  { value: 0, label: 'Full' }, { value: 1, label: 'Hög' }, { value: 2, label: 'Medel' }, { value: 3, label: 'Låg' },
]);
export const BAG_KEY = 'banvy-caddie-bag-v1';
export const FRAME_CAP_KEY = 'banvy-fps';
export const DEV_OVERLAY_KEY = 'banvy:dev-overlay';

/* What "Återställ inställningar" clears: preferences only. The bag, the
   handicap, rounds, shots and courses kept for offline are the player's own
   record and are never touched from here. */
export const PREFERENCE_KEYS = Object.freeze([
  SETTINGS_KEY, FRAME_CAP_KEY, DEV_OVERLAY_KEY,
  MAP_KEYS.light, MAP_KEYS.display, MAP_KEYS.contours, MAP_KEYS.hazards, MAP_KEYS.quality,
]);

export function readText(storage, key, fallback = null) {
  try { return storage?.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writeText(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key); else storage?.setItem(key, String(value));
    return true;
  } catch { return false; }
}

/* engine/frame-pacer.mjs resolveFrameCap without a URL: a stored value outside
   the menu's set is 60, and so is nothing stored. */
export function readFrameCap(storage) {
  const stored = readText(storage, FRAME_CAP_KEY, null);
  const n = stored === null || stored === '' ? NaN : Number(stored);
  return FRAME_CAP_CHOICES.some(choice => choice.value === n) ? n : 60;
}

export function mapLight(storage) {
  const key = readText(storage, MAP_KEYS.light, MAP_DEFAULT_LIGHT);
  return mapLights.has(key) ? key : MAP_DEFAULT_LIGHT;
}
export function mapDetail(storage) {
  const step = Number(readText(storage, MAP_KEYS.quality, '0'));
  return MAP_DETAIL.some(choice => choice.value === step) ? step : 0;
}
/* map-session.js: on unless switched off */
export const mapSwitch = (storage, key) => readText(storage, key, '1') !== '0';

export const lightLabel = (key, field = 'player') =>
  key === NOW_LIGHT[field] ? NOW_LIGHT.label : LIGHTS.find(light => light[field] === key)?.label ?? '';

/* One line under the settings card on the start menu: what a launch will use. */
export function settingsSummary(settings, frameCap) {
  const quality = QUALITY.find(choice => choice.value === settings.quality)?.label ?? 'Auto';
  const fps = frameCap > 0 ? `${frameCap} bilder/s` : 'Obegränsad bildfrekvens';
  return [`Grafik ${quality.toLowerCase()}`, fps, lightLabel(settings.light)].join(' · ');
}
