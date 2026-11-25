/* The start menu's settings, tested without a browser: what a launch URL says
   for each choice, that stored rubbish never reaches a URL, and that the light
   and key tables agree with the programs that read them. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from '../engine/atmosphere-presets.mjs';
import { FRAME_CAPS, FRAME_CAP_KEY as PACER_KEY } from '../engine/frame-pacer.mjs';
import { DEV_OVERLAY_STORAGE_KEY } from '../engine/dev-overlay.mjs';
import { DEFAULT_LIGHT, MAP_LIGHTS } from '../map/map-light.mjs';
import { storeHistory } from '../map/map-shots.mjs';
import { DISPLAY_KEY } from '../map/map-display.mjs';
import { opensMap } from './map-default.mjs';
import { createRound, holeCard, PLAY_KEYS } from '../play/play-rules.mjs';
import {
  DEV_OVERLAY_KEY, FRAME_CAP_CHOICES, FRAME_CAP_KEY, LIGHTS, MAP_DEFAULT_LIGHT, MAP_KEYS, MODES, NOW_LIGHT,
  PREFERENCE_KEYS, BAG_KEY, SETTINGS_KEY, TEE_KEY, ROUND_KEY, HOLE_KEY, liveRound, exportBackup, readBackup, restoreBackup, detailedParams, lastLaunch, launchUrl, mapDetail, mapLight, modeOfRoute,
  readFrameCap, readSettings, rememberLaunch, savedTee, settingsSummary, teeColour, withSettings, writeSettings,
  OFFLINE_PREFIX, offlineCourses, hasBackupUndo, undoBackup, writeText, replaceStoredValues, courseSessions,
  RECENT_COURSES_KEY, recentLaunches,
} from './settings-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = file => fs.readFileSync(path.join(here, file), 'utf8');

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    data,
  };
}
const q = url => Object.fromEntries(new URLSearchParams(url.slice(1)));

describe('launchUrl', () => {
  it('opens an untouched setup with the same plain link as before', () => {
    expect(launchUrl('visby', 'detailed')).toBe('?bana=visby');
  });

  it('says karta=0 for the detailed course on a phone, which opens the map by default', () => {
    const url = launchUrl('visby', 'detailed', { phone: true });
    expect(q(url)).toEqual({ bana: 'visby', karta: '0' });
    expect(opensMap(url, true)).toBe(false);
  });

  it('always says karta=1 for the light map, on any device', () => {
    for (const phone of [true, false]) {
      const url = launchUrl('puttom', 'map', { phone, settings: { quality: 'hi', renderer: 'webgl', light: 'dag', view: 'tee' } });
      expect(q(url)).toEqual({ bana: 'puttom', karta: '1' });
      expect(opensMap(url, phone)).toBe(true);
    }
  });

  it('opens Spela on the detailed course on every device, with its golfer and the plan, never a start view', () => {
    for (const phone of [true, false]) {
      const url = launchUrl('visby', 'play', { phone, settings: { quality: 'hi', renderer: 'auto', light: 'dag', view: 'tee' },
        plan: { tee: 1, hole: 10, light: 'kvall', character: 'male' } });
      expect(q(url)).toEqual({ bana: 'visby', karta: '0', spela: '1', golfare: 'male', q: 'hi', tee: '2', hal: '10' });
      expect(opensMap(url, phone)).toBe(false);
    }
    expect(q(launchUrl('visby', 'play', { plan: { character: 'robot' } }))).toEqual({ bana: 'visby', karta: '0', spela: '1' });
  });

  it('carries each detailed setting in the grammar the player reads', () => {
    const url = launchUrl('angso', 'detailed', { settings: { quality: 'hi', renderer: 'webgl', light: 'nu', view: 'green' } });
    expect(q(url)).toEqual({ bana: 'angso', q: 'hi', gl: '1', ljus: 'nu', vy: 'green' });
  });

  it('carries a round planned on the course page', () => {
    const settings = { quality: 'auto', renderer: 'auto', light: 'dag', view: 'fritt' };
    /* the tee is an index; main.js reads ?tee= from 1; the plan's light wins over the setting */
    expect(q(launchUrl('visby', 'detailed', { settings, plan: { tee: 2, hole: 10, light: 'nu' } })))
      .toEqual({ bana: 'visby', ljus: 'nu', tee: '3', hal: '10' });
    /* choosing the player's own default light takes the setting's word out of the link */
    expect(q(launchUrl('visby', 'detailed', { settings, plan: { tee: 0, hole: 1, light: 'kvall' } }))).toEqual({ bana: 'visby', tee: '1' });
    expect(q(launchUrl('visby', 'map', { plan: { tee: 2, hole: 10, round: true } }))).toEqual({ bana: 'visby', karta: '1', runda: '1', hal: '10' });
    expect(q(launchUrl('visby', 'map', { plan: { round: true, hole: 1 } }))).toEqual({ bana: 'visby', karta: '1', runda: '1', hal: '1' });
    expect(q(launchUrl('visby', 'map', { plan: { round: true } }))).toEqual({ bana: 'visby', karta: '1', runda: '1', hal: '1' });
    expect(q(launchUrl('visby', 'play', { plan: { sim: 'fortsatt' } }))).toEqual({ bana: 'visby', karta: '0', spela: '1', sim: 'fortsatt' });
    expect(q(launchUrl('visby', 'map', { plan: { round: false, tee: 1, hole: 7 } }))).toEqual({ bana: 'visby', karta: '1', runda: 'visa', tee: '2', hal: '7' });
    expect(q(launchUrl('visby', 'map', { plan: { round: false } }))).toEqual({ bana: 'visby', karta: '1', runda: 'visa' });
    expect(q(launchUrl('visby', 'map', { plan: { round: false, hole: 10, offline: true } }))).toEqual({ bana: 'visby', karta: '1', runda: 'visa', hal: '10', offline: '1' });
    expect(q(launchUrl('visby', 'map', { plan: { round: 'resume', hole: 1, tee: 0 } }))).toEqual({ bana: 'visby', karta: '1', runda: 'fortsatt' });
    expect(q(launchUrl('visby', 'detailed', { plan: { tee: 9, hole: 0, light: 'disco' } }))).toEqual({ bana: 'visby' });
  });

  it('keeps the tee where the map reads it, and falls back on the course\'s own', () => {
    const course = { slug: 'visby', tees: { names: ['63', '59', '55'], def: 2 } };
    expect(savedTee(memory(), course)).toBe(2);
    expect(savedTee(memory({ [`${TEE_KEY}:visby`]: '1' }), course)).toBe(1);
    expect(savedTee(memory({ [`${TEE_KEY}:visby`]: '7' }), course)).toBe(2);
    expect(source('../map/map-session.js')).toContain(`const TEE_KEY = '${TEE_KEY}'`);
    expect(teeColour(16053486)).toBe('#f4f4ee');
  });

  it('leaves out what is the player\'s own default', () => {
    expect(detailedParams({ quality: 'auto', renderer: 'auto', light: 'kvall', view: 'fritt' })).toEqual([]);
  });
});

describe('stored settings', () => {
  it('reads defaults from nothing, and from rubbish', () => {
    const defaults = { quality: 'auto', renderer: 'auto', light: 'kvall', view: 'fritt' };
    expect(readSettings(memory())).toEqual(defaults);
    expect(readSettings(memory({ [SETTINGS_KEY]: '{not json' }))).toEqual(defaults);
    expect(readSettings(null)).toEqual(defaults);
  });

  it('ignores a stored value outside its set rather than putting it in a URL', () => {
    const st = memory({ [SETTINGS_KEY]: JSON.stringify({ quality: 'ultra', light: '<script>', view: 'ovan' }) });
    expect(readSettings(st)).toEqual({ quality: 'auto', renderer: 'auto', light: 'kvall', view: 'ovan' });
  });

  it('writes a patch over what is there', () => {
    const st = memory();
    writeSettings(st, { quality: 'lo' });
    writeSettings(st, { light: 'vinter' });
    expect(readSettings(st)).toMatchObject({ quality: 'lo', light: 'vinter' });
  });

  it('survives a storage that throws', () => {
    const angry = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(readSettings(angry).quality).toBe('auto');
    expect(writeSettings(angry, { quality: 'hi' })).toBeNull();
    expect(readFrameCap(angry)).toBe(60);
    expect(mapLight(angry)).toBe(MAP_DEFAULT_LIGHT);
  });
});

describe('switching course inside the player', () => {
  it('adds the start settings only where the link is silent', () => {
    const settings = { quality: 'hi', renderer: 'auto', light: 'dag', view: 'fritt' };
    expect(q(withSettings('?bana=visby&q=lo', settings))).toEqual({ bana: 'visby', q: 'lo', ljus: 'dag' });
    expect(withSettings('?bana=visby', { quality: 'auto', renderer: 'auto', light: 'kvall', view: 'fritt' })).toBe('?bana=visby');
  });

  it('is what goToCourse uses, so the router keeps courseUrl and adds settings', () => {
    expect(source('router.js')).toMatch(/withSettings\(courseUrl\(slug, location\.search\), readSettings\(/);
  });
});

describe('the last way played', () => {
  const courses = [{ slug: 'visby', name: 'Visby GK' }, { slug: 'puttom', name: 'Puttom' }];
  it('remembers the course and the mode together', () => {
    const st = memory();
    rememberLaunch(st, 'puttom', 'map');
    expect(lastLaunch(st, courses)).toEqual({ course: courses[1], mode: 'map' });
  });
  it('offers nothing for a course that no longer exists, and the detailed course for an unknown mode', () => {
    expect(lastLaunch(memory({ 'banvy-last-course': 'gone' }), courses)).toBeNull();
    expect(lastLaunch(memory({ 'banvy-last-course': 'visby', 'banvy-last-mode': 'vr' }), courses).mode).toBe('detailed');
  });
  it('keeps the courses launched lately, newest first, each once, for the start menu', () => {
    const st = memory();
    rememberLaunch(st, 'visby', 'map', 1000);
    rememberLaunch(st, 'puttom', 'detailed', 2000);
    rememberLaunch(st, 'visby', 'play', 3000);
    expect(recentLaunches(st)).toEqual([{ slug: 'visby', at: 3000 }, { slug: 'puttom', at: 2000 }]);
    for (let i = 0; i < 40; i++) rememberLaunch(st, `course-${i}`, 'map', 4000 + i);
    expect(recentLaunches(st)).toHaveLength(24);
    expect(recentLaunches(st)[0]).toEqual({ slug: 'course-39', at: 4039 });
  });
  it('reads a damaged or foreign recent list as empty, and still remembers the launch', () => {
    expect(recentLaunches(memory({ [RECENT_COURSES_KEY]: '{oops' }))).toEqual([]);
    expect(recentLaunches(memory({ [RECENT_COURSES_KEY]: '[{"slug":1},{"slug":"visby"},{"slug":"angso","at":5}]' }))).toEqual([{ slug: 'angso', at: 5 }]);
    const st = memory({ [RECENT_COURSES_KEY]: 'null' });
    rememberLaunch(st, 'visby', 'map', 7);
    expect(recentLaunches(st)).toEqual([{ slug: 'visby', at: 7 }]);
    expect(lastLaunch(st, courses).course.slug).toBe('visby');
  });
});

describe('the backup', () => {
  it('takes Banvy\'s own keys out, and only those', () => {
    const st = memory({ 'banvy-map-rounds-v1': '{"version":1,"rounds":[]}', 'banvy:dev-overlay': '1', 'banvy-fps': '30', 'someone-else': 'x' });
    const backup = exportBackup(st, new Date('2026-11-08T01:00:00Z'));
    expect(backup).toMatchObject({ kind: 'banvy-backup', version: 1, exportedAt: '2026-11-08T01:00:00.000Z' });
    expect(Object.keys(backup.data).sort()).toEqual(['banvy-fps', 'banvy-map-rounds-v1', 'banvy:dev-overlay']);
  });
  it('reads its own file back and refuses anything else', () => {
    const file = JSON.stringify(exportBackup(memory({ 'banvy-fps': '30', 'banvy-caddie-bag-v1': JSON.stringify([{ name: 'PW', carry: 95 }, { name: 'Putter', carry: 0 }]) })));
    const read = readBackup(file);
    expect(read.ok).toBe(true);
    const st = memory();
    expect(restoreBackup(st, read.entries)).toBe(2);
    expect(st.getItem('banvy-fps')).toBe('30');
    expect(readBackup('not json').ok).toBe(false);
    expect(readBackup(JSON.stringify({ kind: 'other', version: 1, data: {} })).ok).toBe(false);
    expect(readBackup(JSON.stringify({ kind: 'banvy-backup', version: 1, data: { 'evil': 'x', 'banvy-x': 5 } })).ok).toBe(false);
  });
  const fileOf = data => JSON.stringify({ kind: 'banvy-backup', version: 1, data });
  it.each([
    [MAP_KEYS.rounds, 'not json'],
    [MAP_KEYS.rounds, '{"version":1,"rounds":[{}]}'],
    [MAP_KEYS.rounds, '{"version":1,"rounds":[{"id":9,"course":"visby","holes":[null]}]}'],
    [MAP_KEYS.shots, '{"version":1,"shots":[{"hole":1,"club":"pw","from":[3,null]}]}'],
    [MAP_KEYS.rounds, '{"version":1,"rounds":[{"id":1,"course":"visby","holes":[],"totals":{"strokes":"wrong"}}]}'],
    [ROUND_KEY + ':visby', '{"version":1,"scores":{"1":{"strokes":"four"}}}'],
    [BAG_KEY, '{"clubs":[{"name":"Järn 7","carry":151},{"name":"Trasig"}]}'],
    [MAP_KEYS.handicap, '200'],
  ])('rejects an invalid record (%s) before changing any entry', (key, bad) => {
    const st = memory({ 'banvy-fps': '60' });
    const data = { 'banvy-fps': '30', [key]: bad };
    expect(readBackup(fileOf(data))).toMatchObject({ ok: false });
    expect(() => restoreBackup(st, Object.entries(data))).toThrow(/Ogiltiga/);
    expect(Object.fromEntries(st.data)).toEqual({ 'banvy-fps': '60' });
  });
  it('retains valid legacy bags, shots without round IDs and scorecards without a playing hole', () => {
    const data = { [BAG_KEY]: JSON.stringify([{ name: 'PW', carry: 90 }, { name: 'Putter', carry: 0 }]),
      [MAP_KEYS.shots]: JSON.stringify({ version: 1, shots: [{ hole: 1, club: 'pw', from: [0, 4], to: null }] }),
      [ROUND_KEY + ':visby']: JSON.stringify({ version: 1, scores: { 1: { strokes: 5 } } }) };
    const result = readBackup(fileOf(data));
    expect(result.ok).toBe(true);
    const st = memory();
    restoreBackup(st, result.entries);
    expect(exportBackup(st).data).toEqual(data);
  });
  it('excludes cache receipts on export and reads old files without overwriting this device’s receipts', () => {
    const receipt = OFFLINE_PREFIX + 'visby';
    const deviceKeys = [receipt, 'banvy-weather:1,2', 'banvy-hub-catalogue-v1', 'banvy-device-id-v1', 'banvy-map-gps-v1:visby',
      'banvy-live-owner-v1:["A","visby",9]'];
    const privateEntries = value => Object.fromEntries(deviceKeys.map(key => [key, value]));
    const st = memory({ 'banvy-fps': '60', ...privateEntries('current') });
    expect(exportBackup(st).data).toEqual({ 'banvy-fps': '60' });
    const read = readBackup(fileOf({ 'banvy-fps': '30', ...privateEntries('old') }));
    restoreBackup(st, read.entries);
    for (const key of deviceKeys) expect(st.getItem(key)).toBe('current');
    expect(() => restoreBackup(st, [['banvy-device-id-v1', 'other']])).toThrow();
  });
  it('reports unreadable or empty backups and storage failures', () => {
    expect(() => exportBackup(null)).toThrow(/lagring/);
    expect(() => exportBackup(memory())).toThrow(/tom/);
    const denied = memory({ 'banvy-fps': '60', 'banvy-x': '1' });
    denied.getItem = key => { if (key === 'banvy-x') throw new Error('denied'); return '60'; };
    expect(() => exportBackup(denied)).toThrow(/lagring/);
    expect(() => restoreBackup(null, [['banvy-fps', '30']])).toThrow(/lagring/);
    expect(writeText(null, 'banvy-fps', '30')).toBe(false);
  });
  it('requires enough space for the recovery copy before the first record is changed', () => {
    const st = memory({ 'banvy-fps': '60' }), writes = [];
    st.setItem = key => { writes.push(key); throw new Error('quota'); };
    expect(() => restoreBackup(st, [['banvy-fps', '30']])).toThrow(/ångerkopia/);
    expect(writes).toHaveLength(1);
    expect(st.getItem('banvy-fps')).toBe('60');
    expect(hasBackupUndo(st)).toBe(false);
  });
  it.each(['throw', 'silent'])('rolls back replaced and newly added entries after a %s write failure', failure => {
    const st = memory({ 'banvy-old': 'longer original', 'unrelated': 'keep' });
    const before = Object.fromEntries(st.data), write = st.setItem;
    st.setItem = (key, value) => {
      if (key !== 'banvy-fails') return write(key, value);
      if (failure === 'throw') throw new Error('quota');
    };
    expect(() => restoreBackup(st, [['banvy-old', 'short'], ['banvy-new', 'x'], ['banvy-fails', 'longest']])).toThrow(/Tidigare/);
    expect(Object.fromEntries(st.data)).toEqual(before);
  });
  it('undoes after reload, scoped to the importing player, without removing later edits', () => {
    const st = memory({ 'banvy-fps': '60' });
    const user = id => st.setItem('banvy_sync_meta_v1', JSON.stringify({ version: 1, userId: id }));
    user('A');
    restoreBackup(st, [['banvy-fps', '30'], ['banvy-fresh', 'new']]);
    expect(hasBackupUndo(st)).toBe(true);
    for (const account of [null, 'B']) {
      user(account);
      expect(hasBackupUndo(st)).toBe(false);
      expect(() => undoBackup(st)).toThrow();
    }
    user('A');
    st.setItem('banvy-fresh', 'later');
    expect(() => undoBackup(st)).toThrow(/ändrats/);
    expect(st.getItem('banvy-fps')).toBe('30');
    st.setItem('banvy-fresh', 'new');
    expect(undoBackup(st)).toEqual(['banvy-fps', 'banvy-fresh']);
    expect(st.getItem('banvy-fps')).toBe('60');
    expect(st.getItem('banvy-fresh')).toBeNull();
    expect(hasBackupUndo(st)).toBe(false);
  });
  it('recovers a partially written import after the browser was interrupted', () => {
    const st = memory({ 'banvy-fps': '60', [MAP_KEYS.handicap]: '6' });
    restoreBackup(st, [['banvy-fps', '30'], [MAP_KEYS.handicap, '18']]);
    st.setItem(MAP_KEYS.handicap, '6');
    expect(undoBackup(st)).toEqual(['banvy-fps']);
    expect(Object.fromEntries(st.data)).toEqual({ 'banvy-fps': '60', [MAP_KEYS.handicap]: '6' });
  });
  it('commits sync metadata with the restore, including on undo, and rolls back on quota failure', () => {
    const st = memory({ 'banvy-fps': '60' }), write = st.setItem;
    const metadata = (after, before) => [['meta', JSON.stringify({ after: [...after], before })]];
    const failOnMeta = (key, value) => { if (key === 'meta') throw new Error('quota'); write(key, value); };
    st.setItem = failOnMeta;
    expect(() => restoreBackup(st, [['banvy-fps', '30']], metadata)).toThrow(/Tidigare/);
    expect(Object.fromEntries(st.data)).toEqual({ 'banvy-fps': '60' });
    st.setItem = write;
    restoreBackup(st, [['banvy-fps', '30']], metadata);
    expect(JSON.parse(st.getItem('meta'))).toEqual({ after: [['banvy-fps', '30']], before: { 'banvy-fps': '60' } });
    st.setItem = failOnMeta;
    expect(() => undoBackup(st, metadata)).toThrow(/Tidigare/);
    expect(hasBackupUndo(st)).toBe(true);
    expect(st.getItem('banvy-fps')).toBe('30');
    st.setItem = write;
    undoBackup(st, metadata);
    expect(JSON.parse(st.getItem('meta'))).toEqual({ after: [['banvy-fps', '60']], before: { 'banvy-fps': '30' } });
  });
  it('atomically replaces and removes arbitrary keys for the account store', () => {
    const st = memory({ before: 'release space', unaffected: 'leave' });
    replaceStoredValues(st, new Map([['after', 'new'], ['before', null]]));
    expect(Object.fromEntries(st.data)).toEqual({ after: 'new', unaffected: 'leave' });
  });

});

describe('a round under way', () => {
  const courses = [{ slug: 'visby', name: 'Visby GK' }, { slug: 'puttom', name: 'Puttom' }];
  const NOW = Date.parse('2026-11-08T12:00:00Z');
  const round = (extra) => JSON.stringify({ version: 1, startedAt: '2026-11-08', handicap: 18, scores: {}, ...extra });
  it('finds the freshest begun round, with where it stands', () => {
    const st = memory({
      [`${ROUND_KEY}:visby`]: round({ begunAt: NOW - 3600e3, scores: { 1: { strokes: 5 }, 2: { strokes: 4 }, 3: { picked: true } } }),
      [`${HOLE_KEY}:visby`]: JSON.stringify({ value: 4, at: NOW - 600e3 }),
      [`${ROUND_KEY}:puttom`]: round({ begunAt: NOW - 7200e3 }),
    });
    expect(liveRound(st, courses, NOW)).toMatchObject({ course: courses[0], hole: 4, holes: 3, strokes: 9 });
  });
  it('shows the same next hole as the map for an older card with an expired preview', () => {
    const st = memory({
      [`${ROUND_KEY}:visby`]: round({ touchedAt: NOW, scores: { 5: { strokes: 4 } } }),
      [`${HOLE_KEY}:visby`]: JSON.stringify({ value: 16, at: NOW - 7 * 3600e3 }),
    });
    expect(liveRound(st, courses, NOW)?.hole).toBe(6);
  });
  it('leaves out an ended round, a stale one, and a card never begun', () => {
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: round({ begunAt: NOW - 600e3, endedAt: NOW - 60e3 }) }), courses, NOW)).toBeNull();
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: round({ begunAt: NOW - 7 * 3600e3 }) }), courses, NOW)).toBeNull();
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: round({}) }), courses, NOW)).toBeNull();
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: '{broken' }), courses, NOW)).toBeNull();
  });
  it('resumes the played hole and round activity even after another hole was previewed', () => {
    const st = memory({
      [`${ROUND_KEY}:visby`]: round({ begunAt: NOW - 7 * 3600e3, touchedAt: NOW - 120e3, playingHole: 10 }),
      [`${HOLE_KEY}:visby`]: JSON.stringify({ value: 11, at: NOW }),
    });
    expect(liveRound(st, courses, NOW)).toMatchObject({ hole: 10, touched: NOW - 120e3 });
    expect(liveRound(st, courses, NOW + 6 * 3600e3)).toBeNull();
  });
  it('resumes a legacy shots-only round from its own shot history', () => {
    const st = memory({
      [`${ROUND_KEY}:visby`]: round({ id: 123 }),
      [`${HOLE_KEY}:visby`]: JSON.stringify({ value: 11, at: NOW - 3600e3 }),
      [MAP_KEYS.shots]: storeHistory([
        { course: 'visby', round: 123, hole: 10, at: NOW - 120e3 },
        { course: 'puttom', round: 123, hole: 1, at: NOW - 60e3 },
        { course: 'visby', round: 999, hole: 3, at: NOW },
      ]),
    });
    expect(liveRound(st, courses, NOW)).toMatchObject({ hole: 10, touched: NOW - 120e3 });
  });
  it('names the keys the map writes', () => {
    expect(source('../map/map-session.js')).toContain(`const ROUND_KEY = '${ROUND_KEY}'`);
    expect(source('../map/map-session.js')).toContain(`const HOLE_KEY = '${HOLE_KEY}'`);
    expect(source('../map/map-session.js')).toContain('const RESUME_MS = 6 * 60 * 60 * 1000');
  });
});

it('resumes the most recently played Simulator course, including legacy checkpoints', () => {
  const store = memory();
  const courses = [{ slug: 'bro-hof-castle', holes: 1 }, { slug: 'bro-hof-stadium', holes: 1 }];
  for (const [i, course] of courses.entries()) {
    const round = createRound({ slug: course.slug, holes: [{ n: 1, par: 4 }], now: 100 + i });
    holeCard(round, 1);
    const checkpoint = { version: 1, revision: 'r1', position: { phase: 'address', ball: [0, 0] }, round };
    if (i === 0) checkpoint.savedAt = 120;
    store.setItem(PLAY_KEYS.checkpoint + course.slug, JSON.stringify(checkpoint));
  }
  expect(courseSessions(store, courses).map(session => [session.course.slug, session.touched]))
    .toEqual([['bro-hof-castle', 120], ['bro-hof-stadium', 101]]);
});

describe('routes', () => {
  it('maps the hub hash to a mode', () => {
    expect(modeOfRoute('3d')).toBe('detailed');
    expect(modeOfRoute('karta')).toBe('map');
    expect(modeOfRoute('installningar')).toBeNull();
    expect(modeOfRoute('')).toBeNull();
    for (const [mode, m] of Object.entries(MODES)) expect(modeOfRoute(m.route)).toBe(mode);
  });
});

describe('the lights agree with both programs', () => {
  it('names every map light the map knows, and no other', () => {
    expect(new Set(LIGHTS.map(light => light.map))).toEqual(new Set(MAP_LIGHTS.map(light => light.key)));
    expect(NOW_LIGHT.map).toBe('nu');
    expect(MAP_DEFAULT_LIGHT).toBe(DEFAULT_LIGHT);
  });

  it('names every player light main.js reads from ?ljus=', () => {
    const block = /const LJUS2P = \{([\s\S]*?)\};/.exec(source('../main.js'))[1];
    const map = Object.fromEntries([...block.matchAll(/(\w+): '(\w+)'/g)].map(m => [m[1], m[2]]));
    for (const light of LIGHTS) expect(map[light.player], light.player).toBe(light.preset);
    expect(source('../main.js')).toMatch(/LJUS_ASKED === 'nu'/);
  });

  it('paints each swatch with its preset\'s own sky', () => {
    const hex = n => `#${n.toString(16).padStart(6, '0')}`;
    for (const light of LIGHTS) {
      const env = ATMOSPHERE_PRESETS[light.preset].environment;
      expect(light.sky, light.preset).toEqual([hex(env.zenith), hex(env.horizon), hex(env.ground)]);
    }
  });
});

describe('the keys are the ones the programs read', () => {
  it('shares the frame cap and the developer switch with the player', () => {
    expect(FRAME_CAP_KEY).toBe(PACER_KEY);
    expect(new Set(FRAME_CAP_CHOICES.map(c => c.value))).toEqual(new Set(FRAME_CAPS));
    expect(DEV_OVERLAY_KEY).toBe(DEV_OVERLAY_STORAGE_KEY);
    expect(MAP_KEYS.display).toBe(DISPLAY_KEY);
  });

  it('names the map\'s own keys', () => {
    const map = source('../map/map-session.js');
    for (const name of ['light', 'contours', 'hazards', 'rings', 'quality', 'handicap', 'rounds', 'shots']) {
      expect(map, name).toContain(`'${MAP_KEYS[name]}'`);
    }
    expect(map).toContain(`'${BAG_KEY}'`);
    expect(source('../main.js')).toContain(`'${BAG_KEY}'`);
  });

  it('reads the frame cap as the pacer would', () => {
    expect(readFrameCap(memory())).toBe(60);
    expect(readFrameCap(memory({ [FRAME_CAP_KEY]: '0' }))).toBe(0);
    expect(readFrameCap(memory({ [FRAME_CAP_KEY]: '' }))).toBe(60);
    expect(readFrameCap(memory({ [FRAME_CAP_KEY]: '144' }))).toBe(60);
  });

  it('reads the map\'s detail step and light, falling back on its defaults', () => {
    expect(mapDetail(memory({ [MAP_KEYS.quality]: '2' }))).toBe(2);
    expect(mapDetail(memory({ [MAP_KEYS.quality]: '9' }))).toBe(0);
    expect(mapLight(memory({ [MAP_KEYS.light]: 'nu' }))).toBe('nu');
    expect(mapLight(memory({ [MAP_KEYS.light]: 'disco' }))).toBe(MAP_DEFAULT_LIGHT);
  });

  it('resets preferences, never the player\'s own record', () => {
    for (const kept of [BAG_KEY, MAP_KEYS.handicap, MAP_KEYS.rounds, 'banvy-map-shots-v1', 'banvy-last-course']) {
      expect(PREFERENCE_KEYS).not.toContain(kept);
    }
  });

  it('lists the courses the map kept for play without a signal, by the key it writes', () => {
    expect(source('../map/map-offline-status.mjs')).toContain(`\`${OFFLINE_PREFIX}\${slug}\``);
    const kept = memory({ [`${OFFLINE_PREFIX}angso`]: 'abc', [`${OFFLINE_PREFIX}visby`]: '1', [BAG_KEY]: '[]' });
    expect(offlineCourses(kept).sort()).toEqual(['angso', 'visby']);
    expect(offlineCourses(null)).toEqual([]);
  });
});

describe('the summary under the settings card', () => {
  it('says what a launch will use', () => {
    expect(settingsSummary({ quality: 'hi', light: 'nu' }, 30)).toBe('Grafik hög · 30 bilder/s · Nu');
    expect(settingsSummary({ quality: 'auto', light: 'kvall' }, 0)).toBe('Grafik auto · Obegränsad bildfrekvens · Kväll');
  });
});
