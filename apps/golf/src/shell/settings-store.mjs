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

import { parseHistory } from '../map/map-shots.mjs';
import { roundEntry } from '../map/map-rounds.mjs';
import { normalizeBag } from '../engine/caddie.js';
import { MIN_HANDICAP, MAX_HANDICAP } from '../map/map-score.mjs';
import { PLAY_KEYS, readPlayCheckpoint } from '../play/play-rules.mjs';
import { OFFLINE_PREFIX, isDeviceOnlyKey, isOwnKey } from './backup-keys.mjs';

export const SETTINGS_KEY = 'banvy-settings-v1';
export const LAST_COURSE_KEY = 'banvy-last-course';
export const LAST_MODE_KEY = 'banvy-last-mode';

/* The ways to play, as the start menu names them. `route` is the hub's
   hash; `mode` is what a launch is asked for. Spela is the detailed course
   played as a game (apps/golf/src/play). */
export const MODES = Object.freeze({
  detailed: Object.freeze({ route: '3d', label: 'Detaljerad 3D', short: 'Detaljerad', cta: 'Starta i 3D' }),
  map: Object.freeze({ route: 'karta', label: 'Lätt 3D', short: 'Lätt 3D', cta: 'Öppna kartan' }),
  play: Object.freeze({ route: 'spela', label: 'Simulator', short: 'Simulator', cta: 'Välj bana' }),
});
/* The golfers Spela can play as (engine/golfer.mjs GOLFER_CHARACTERS) */
export const PLAY_CHARACTERS = Object.freeze([
  Object.freeze({ id: 'female', label: 'Kvinna' }),
  Object.freeze({ id: 'male', label: 'Man' }),
]);
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
  return writeText(storage, SETTINGS_KEY, JSON.stringify(next)) ? readSettings(storage) : null;
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
    if (plan?.round === 'resume') {
      params.set('runda', 'fortsatt');
    } else if (plan?.round === 'end') {
      params.set('runda', 'avsluta');
    } else {
      if (plan?.round === true) params.set('runda', '1');
      if (plan?.round === false) {
        params.set('runda', 'visa');
        if (Number.isInteger(plan.tee) && plan.tee >= 0) params.set('tee', String(plan.tee + 1));
        if (plan.offline) params.set('offline', '1');
      }
      if (Number.isInteger(hole) && hole >= 1) params.set('hal', String(hole));
      else if (plan?.round === true) params.set('hal', '1');
    }
    return '?' + params.toString();
  }
  /* Spela is the detailed course with the game on: karta=0 always, since a
     plain course link on a phone opens the map */
  if (phone || mode === 'play') params.set('karta', '0');
  if (mode === 'play') {
    params.set('spela', '1');
    if (['ny', 'fortsatt', 'traning'].includes(plan?.sim)) params.set('sim', plan.sim);
    if (PLAY_CHARACTERS.some(c => c.id === plan?.character)) params.set('golfare', plan.character);
  }
  for (const [key, value] of detailedParams(settings)) params.set(key, value);
  /* a game is played from behind the golfer: the course's own start view does not apply */
  if (mode === 'play') params.delete('vy');
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
/* The courses launched lately, newest first, each with its time: the start menu's
   own clubs once the catalogue is too long to list whole (lobby-model.mjs). Kept
   with the last course, so every way in -- the club page, the list, the map and
   the detailed course -- adds to it. */
export const RECENT_COURSES_KEY = 'banvy-recent-courses-v1';
const RECENT_COURSES = 24;

export function rememberLaunch(storage, slug, mode, now = Date.now()) {
  try {
    storage?.setItem(LAST_COURSE_KEY, slug);
    if (MODES[mode]) storage?.setItem(LAST_MODE_KEY, mode);
    const earlier = recentLaunches(storage).filter(entry => entry.slug !== slug);
    storage?.setItem(RECENT_COURSES_KEY, JSON.stringify([{ slug, at: now }, ...earlier].slice(0, RECENT_COURSES)));
  } catch { /* the start menu simply offers no shortcut */ }
}

export function recentLaunches(storage) {
  try {
    const list = JSON.parse(storage?.getItem(RECENT_COURSES_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(entry => typeof entry?.slug === 'string' && Number.isFinite(entry.at)) : [];
  } catch { return []; }
}

export function lastLaunch(storage, courses) {
  let slug = null, mode = null;
  try { slug = storage?.getItem(LAST_COURSE_KEY); mode = storage?.getItem(LAST_MODE_KEY); } catch { return null; }
  const course = courses.find(c => c.slug === slug);
  if (!course) return null;
  return { course, mode: MODES[mode] ? mode : 'detailed' };
}

/* A portable copy of the device's current player data. Account credentials,
   sync metadata and per-account archives use a different storage namespace. */
export const BACKUP_KIND = 'banvy-backup';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const point = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const named = value => typeof value === 'string' && Boolean(value.trim());

const validScore = score => object(score)
  && [score.strokes, score.putts].every(value => value == null || count(value))
  && (score.picked == null || typeof score.picked === 'boolean');
const validRound = round => object(round) && positive(round.id) && named(round.course)
  && Array.isArray(round.holes) && round.holes.every(hole => validScore(hole) && positive(hole.n))
  && (round.pars == null || (Array.isArray(round.pars) && round.pars.every(par => par == null || positive(par))))
  && (round.totals == null || (object(round.totals) && ['played', 'strokes', 'putts', 'par', 'points', 'fairways',
    'fairwaysTried', 'greens', 'greensTried'].every(key => round.totals[key] == null || count(round.totals[key]))
    && (round.totals.toPar == null || Number.isSafeInteger(round.totals.toPar))));
const validShot = shot => object(shot) && positive(shot.hole) && named(shot.club)
  && point(shot.from) && (shot.to == null || point(shot.to)) && (shot.penalty == null || count(shot.penalty))
  && (shot.round == null || positive(shot.round)) && (shot.course == null || named(shot.course))
  && (shot.outcome == null || ['open', 'played', 'ended', 'out'].includes(shot.outcome));
const validPlayRound = round => object(round) && Number.isFinite(round.id) && named(round.slug)
  && Array.isArray(round.order) && round.order.length > 0 && round.order.every(positive)
  && object(round.pars) && object(round.holes) && Object.values(round.holes).every(card =>
    validScore(card) && Array.isArray(card.shots) && card.shots.every(object));

/* Keep the raw entry, including fields from older versions. A permissive
   reader's fallback (an empty scorecard or the default bag) is not a restore. */
function validBackupValue(key, raw) {
  if (typeof raw !== 'string') return false;
  if (key === MAP_KEYS.handicap) {
    const hcp = Number(raw);
    return raw === '' || (raw.trim() !== '' && Number.isFinite(hcp) && hcp >= MIN_HANDICAP && hcp <= MAX_HANDICAP);
  }
  if (key.startsWith(PLAY_KEYS.checkpoint)) {
    return Boolean(readPlayCheckpoint({ getItem: () => raw }, key.slice(PLAY_KEYS.checkpoint.length)));
  }
  let validate;
  if (key === BAG_KEY) validate = bag => {
    const clubs = Array.isArray(bag) ? bag : bag?.clubs;
    return Array.isArray(clubs) && clubs.length > 0 && clubs.every(club => named(club?.name))
      && normalizeBag(clubs, []).length === clubs.length;
  };
  else if (key === MAP_KEYS.rounds) validate = log => log?.version === 1 && Array.isArray(log.rounds) && log.rounds.every(validRound);
  else if (key === MAP_KEYS.shots) validate = log => log?.version === 1 && Array.isArray(log.shots) && log.shots.every(validShot);
  else if (key === PLAY_KEYS.rounds) validate = log => log?.version === 1 && Array.isArray(log.rounds) && log.rounds.every(validPlayRound);
  else if (key.startsWith(ROUND_KEY + ':')) validate = round => round?.version === 1 && object(round.scores)
    && Object.entries(round.scores).every(([n, score]) => positive(Number(n)) && validScore(score));
  else if (key === SETTINGS_KEY || key === MAP_KEYS.display) validate = object;
  else return true;
  try { return validate(JSON.parse(raw)); } catch { return false; }
}

function validateBackupEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Säkerhetskopian är tom.');
  const seen = new Set();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Säkerhetskopian har en ogiltig post.');
    const [key, value] = entry;
    if (!named(key) || !isOwnKey(key) || isDeviceOnlyKey(key) || seen.has(key) || !validBackupValue(key, value)) {
      throw new Error(`Ogiltiga uppgifter i säkerhetskopian (${key}).`);
    }
    seen.add(key);
  }
}

export function activeBackupRounds(entries) {
  const cards = [];
  for (const [key, raw] of entries) {
    if (!key.startsWith(ROUND_KEY + ':')) continue;
    const card = JSON.parse(raw);
    if (card.begunAt && !card.endedAt && positive(card.id)) cards.push({ course: key.slice(ROUND_KEY.length + 1), id: card.id });
  }
  return cards;
}

export function exportBackup(storage, now = new Date()) {
  const entries = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && isOwnKey(key) && !isDeviceOnlyKey(key)) entries.push([key, storage.getItem(key)]);
    }
  } catch { throw new Error('Webbläsarens lagring kunde inte läsas.'); }
  validateBackupEntries(entries);
  // Identify account-backed active cards without exporting an account or installation ID.
  let owner;
  try { owner = JSON.parse(storage.getItem('banvy_sync_meta_v1'))?.userId; } catch { /* legacy sync metadata */ }
  return { kind: BACKUP_KIND, version: 1, exportedAt: now.toISOString(), accountRounds: Boolean(owner), data: Object.fromEntries(entries) };
}

export function readBackup(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { /* handle invalid files below */ }
  if (backup?.kind !== BACKUP_KIND || backup.version !== 1 || !object(backup.data)) {
    return { ok: false, reason: 'Filen är inte en Banvy-säkerhetskopia.' };
  }
  /* Older files included device identities, GPS fixes and cache receipts. */
  const entries = Object.entries(backup.data).filter(([key]) => !isDeviceOnlyKey(key));
  try { validateBackupEntries(entries); } catch (error) { return { ok: false, reason: error.message }; }
  const date = typeof backup.exportedAt === 'string' && Number.isFinite(Date.parse(backup.exportedAt)) ? backup.exportedAt : null;
  return { ok: true, entries, exportedAt: date, accountRounds: backup.accountRounds === true };
}

/* The data a visitor brought from the old address (shell/move-in.mjs). Unlike a
   file, it cannot be chosen again: one damaged record must not strand the rest, so
   every entry a restore would accept is kept, and the others are named. */
export function readMove(text) {
  let backup;
  try { backup = JSON.parse(text); } catch { /* handled below */ }
  if (backup?.kind !== BACKUP_KIND || backup.version !== 1 || !object(backup.data)) {
    return { ok: false, reason: 'Uppgifterna från den gamla adressen kunde inte läsas.' };
  }
  const entries = [], skipped = [];
  for (const [key, value] of Object.entries(backup.data)) {
    if (!isOwnKey(key) || isDeviceOnlyKey(key)) continue;
    if (validBackupValue(key, value)) entries.push([key, value]);
    else skipped.push(key);
  }
  if (!entries.length) {
    return { ok: false, reason: skipped.length ? `Uppgifterna från den gamla adressen var skadade (${skipped.join(', ')}).` : 'Det fanns inga uppgifter att flytta.' };
  }
  const date = typeof backup.exportedAt === 'string' && Number.isFinite(Date.parse(backup.exportedAt)) ? backup.exportedAt : null;
  return { ok: true, entries, skipped, exportedAt: date, accountRounds: backup.accountRounds === true };
}

/* Web Storage is atomic per key. Snapshot the whole change before writing,
   release space first, then read back. Roll back synchronously on failure. */
export function replaceStoredValues(storage, entries) {
  let changes;
  try {
    if (!storage) throw new Error();
    changes = Array.from(new Map(entries), ([key, value]) => {
      if (value !== null && typeof value !== 'string') throw new TypeError();
      const previous = storage.getItem(key);
      return { key, value, previous, growth: (value?.length ?? 0) - (previous?.length ?? 0) };
    });
  } catch { throw new Error('Webbläsarens lagring kunde inte läsas.'); }
  changes.sort((a, b) => a.growth - b.growth);
  const attempted = [];
  try {
    for (const change of changes) {
      if (change.previous === change.value) continue;
      attempted.push(change);
      if (!writeText(storage, change.key, change.value)) throw new Error();
    }
    if (changes.some(({ key, value }) => storage.getItem(key) !== value)) throw new Error();
  } catch {
    let recovered = true;
    for (const { key, previous } of attempted.reverse()) {
      try {
        if (storage.getItem(key) !== previous && !writeText(storage, key, previous)) recovered = false;
      } catch { recovered = false; }
    }
    if (!recovered) throw new Error('Webbläsarens lagring avbröts. Det gick inte att verifiera alla tidigare uppgifter.');
    throw new Error('Uppgifterna kunde inte sparas. Tidigare uppgifter finns kvar. Kontrollera webbläsarens lagringsutrymme.');
  }
}

/* Undo stays with the player who imported, even across reloads and sign-outs.
   Save exact replaced bytes, including absent keys, and guard later edits. */
function undoKey(storage) {
  const meta = JSON.parse(storage.getItem('banvy_sync_meta_v1') ?? 'null');
  const owner = meta?.userId;
  return 'banvy_restore_undo_v1:' + (named(owner) ? 'user:' + owner : 'guest');
}

export function hasBackupUndo(storage) {
  try { return storage.getItem(undoKey(storage)) !== null; } catch { return false; }
}

export function restoreBackup(storage, entries, additionalEntries = () => []) {
  validateBackupEntries(entries);
  let key, snapshot;
  try {
    key = undoKey(storage);
    snapshot = entries.map(([name, value]) => [name, storage.getItem(name), value])
      .filter(([, previous, value]) => previous !== value);
  } catch { throw new Error('Webbläsarens lagring kunde inte läsas.'); }
  if (!snapshot.length) return entries.length;
  const changes = new Map(snapshot.map(([name, , value]) => [name, value]));
  const previous = Object.fromEntries(snapshot.map(([name, value]) => [name, value]));
  const metadata = additionalEntries(changes, previous);
  // The recovery copy is durable before the first player record is touched.
  // Keep the earlier undo record if any subsequent write fails.
  const earlier = storage.getItem(key);
  if (!writeText(storage, key, JSON.stringify(snapshot))) {
    throw new Error('En ångerkopia fick inte plats. Frigör lagringsutrymme och försök igen.');
  }
  try {
    replaceStoredValues(storage, [...entries, ...metadata]);
  } catch (error) {
    // Preserve this recovery copy if the storage itself disappeared midway.
    if (snapshot.every(([name, previous]) => storage.getItem(name) === previous)) {
      replaceStoredValues(storage, [[key, earlier]]);
    }
    throw error;
  }
  return entries.length;
}

export function undoBackup(storage, additionalEntries = () => []) {
  const key = undoKey(storage);
  const snapshot = JSON.parse(storage.getItem(key));
  if (!Array.isArray(snapshot) || !snapshot.length || !snapshot.every(entry =>
    Array.isArray(entry) && entry.length === 3 && named(entry[0]) && isOwnKey(entry[0])
    && !isDeviceOnlyKey(entry[0]) && (entry[1] === null || typeof entry[1] === 'string')
    && typeof entry[2] === 'string')) throw new Error('Det finns ingen giltig ångerkopia.');
  // A browser closed mid-import may already have some of the original values.
  const changes = new Map(), beforeUndo = {};
  for (const [name, previous, imported] of snapshot) {
    const current = storage.getItem(name);
    if (current === previous) continue;
    if (current !== imported) throw new Error('Uppgifter har ändrats efter inläsningen. De senare ändringarna behålls.');
    changes.set(name, previous);
    beforeUndo[name] = current;
  }
  const metadata = additionalEntries(changes, beforeUndo);
  replaceStoredValues(storage, [...changes, ...metadata, [key, null]]);
  return [...changes.keys()];
}

/* The map offers its active rounds for six hours after their last activity. */
export const ROUND_KEY = 'banvy-map-round-v1';
export const HOLE_KEY = 'banvy-map-hole-v1';
const RESUME_MS = 6 * 60 * 60 * 1000;
function liveRounds(storage, courses, now) {
  const rounds = [];
  let history;
  for (const course of courses) {
    let round = null, hole = null;
    try { round = JSON.parse(storage?.getItem(`${ROUND_KEY}:${course.slug}`) ?? 'null'); } catch { round = null; }
    if (!round || round.endedAt || typeof round.scores !== 'object' || round.scores === null) continue;
    const played = Object.values(round.scores).filter(score => score && (score.picked || Number.isFinite(score.strokes)));
    let lastShot;
    const count = course.holes || 18;
    const hasPlayingHole = Number.isInteger(round.playingHole) && round.playingHole >= 1 && round.playingHole <= count;
    if (round.id != null && (!hasPlayingHole || (!round.begunAt && !played.length))) {
      history ??= parseHistory(readText(storage, MAP_KEYS.shots, null));
      lastShot = history.findLast(shot => shot?.course === course.slug && shot.round === round.id);
    }
    if (!round.begunAt && !played.length && !lastShot) continue;
    try { hole = JSON.parse(storage?.getItem(`${HOLE_KEY}:${course.slug}`) ?? 'null'); } catch { hole = null; }
    const touched = Number(round.touchedAt) || Math.max(Number(round.begunAt) || 0, Number(lastShot?.at) || 0, Number(hole?.at) || 0);
    if (!touched || now - touched > RESUME_MS) continue;
    const recentHole = hole && now - hole.at < RESUME_MS ? hole.value : null;
    const { playing } = roundEntry({ round, active: true, shotHole: lastShot?.hole, recentHole, count, intent: 'fortsatt' });
    rounds.push({ course, touched, hole: playing, holes: played.length,
      strokes: played.reduce((sum, score) => sum + (Number.isFinite(score.strokes) ? score.strokes : 0), 0) });
  }
  return rounds.sort((a, b) => b.touched - a.touched);
}

export function liveRound(storage, courses, now = Date.now()) {
  return liveRounds(storage, courses, now)[0] ?? null;
}

/* Each mode keeps its own progress, even at two layouts of the same club. */
export function courseSessions(storage, courses, now = Date.now()) {
  const sessions = liveRounds(storage, courses, now).map(round => ({
    ...round, mode: 'map', tee: savedTee(storage, round.course),
  }));
  for (const course of courses) {
    const checkpoint = readPlayCheckpoint(storage, course.slug, course.holes);
    if (!checkpoint) continue;
    const { round, savedAt } = checkpoint;
    const touched = Number.isFinite(savedAt) ? savedAt : round.id;
    sessions.push({ mode: 'play', course, hole: round.current, tee: round.tee, touched });
  }
  return sessions.sort((a, b) => b.touched - a.touched);
}

export function sessionPosition(session) {
  const name = session.course.tees?.names?.[session.tee];
  return [session.hole ? `Hål ${session.hole}` : '', name ? `Tee ${name}` : ''].filter(Boolean).join(' · ');
}

export function sessionBadge(session) {
  return session.mode === 'map' ? 'GPS-runda pågår' : 'Simulering pågår';
}

/* ------------------------------------------------------------ the light map
   The map's own keys and formats (map-session.js, map-display.mjs). */
export const MAP_KEYS = Object.freeze({
  light: 'banvy-map-light-v1',
  display: 'banvy-map-display-v1',
  contours: 'banvy-map-contours-v1',
  hazards: 'banvy-map-hazards-v1',
  rings: 'banvy-map-rings-v1',
  quality: 'banvy-map-quality-v1',
  handicap: 'banvy-map-handicap-v1',
  rounds: 'banvy-map-rounds-v1',
  shots: 'banvy-map-shots-v1',
});
/* map-session.js QUALITY_STEPS, read from its end: what a slow phone gives up */
export const MAP_DETAIL = Object.freeze([
  { value: 0, label: 'Full' }, { value: 1, label: 'Hög' }, { value: 2, label: 'Medel' }, { value: 3, label: 'Låg' },
]);
/* map-field.mjs downloadCourse marks a course kept for play without a signal
   (OFFLINE_PREFIX, from backup-keys.mjs) */
export { OFFLINE_PREFIX };
export function offlineCourses(storage) {
  const slugs = [];
  try {
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage.key(i);
      if (key?.startsWith(OFFLINE_PREFIX)) slugs.push(key.slice(OFFLINE_PREFIX.length));
    }
  } catch { /* nothing to read */ }
  return slugs;
}
export const BAG_KEY = 'banvy-caddie-bag-v1';
export const FRAME_CAP_KEY = 'banvy-fps';
export const DEV_OVERLAY_KEY = 'banvy:dev-overlay';

/* What "Återställ inställningar" clears: preferences only. The bag, the
   handicap, rounds, shots and courses kept for offline are the player's own
   record and are never touched from here. */
export const PREFERENCE_KEYS = Object.freeze([
  SETTINGS_KEY, FRAME_CAP_KEY, DEV_OVERLAY_KEY,
  MAP_KEYS.light, MAP_KEYS.display, MAP_KEYS.contours, MAP_KEYS.hazards, MAP_KEYS.rings, MAP_KEYS.quality,
]);

export function readText(storage, key, fallback = null) {
  try { return storage?.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writeText(storage, key, value) {
  try {
    if (!storage) return false;
    const expected = value === null ? null : String(value);
    if (expected === null) storage.removeItem(key); else storage.setItem(key, expected);
    return storage.getItem(key) === expected;
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
/* map-session.js: on unless switched off, or off unless switched on when fallback is '0' */
export const mapSwitch = (storage, key, fallback = '1') => readText(storage, key, fallback) !== '0';

export const lightLabel = (key, field = 'player') =>
  key === NOW_LIGHT[field] ? NOW_LIGHT.label : LIGHTS.find(light => light[field] === key)?.label ?? '';

/* One line under the settings card on the start menu: what a launch will use. */
export function settingsSummary(settings, frameCap) {
  const quality = QUALITY.find(choice => choice.value === settings.quality)?.label ?? 'Auto';
  const fps = frameCap > 0 ? `${frameCap} bilder/s` : 'Obegränsad bildfrekvens';
  return [`Grafik ${quality.toLowerCase()}`, fps, lightLabel(settings.light)].join(' · ');
}
