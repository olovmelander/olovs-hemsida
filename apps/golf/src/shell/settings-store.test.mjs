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
import { DISPLAY_KEY } from '../map/map-display.mjs';
import { opensMap } from './map-default.mjs';
import {
  DEV_OVERLAY_KEY, FRAME_CAP_CHOICES, FRAME_CAP_KEY, LIGHTS, MAP_DEFAULT_LIGHT, MAP_KEYS, MODES, NOW_LIGHT,
  PREFERENCE_KEYS, BAG_KEY, SETTINGS_KEY, TEE_KEY, ROUND_KEY, HOLE_KEY, liveRound, exportBackup, readBackup, restoreBackup, detailedParams, lastLaunch, launchUrl, mapDetail, mapLight, modeOfRoute,
  readFrameCap, readSettings, rememberLaunch, savedTee, settingsSummary, teeColour, withSettings, writeSettings,
  OFFLINE_PREFIX, offlineCourses,
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
    expect(q(launchUrl('visby', 'map', { plan: { round: false } }))).toEqual({ bana: 'visby', karta: '1' });
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
    expect(() => writeSettings(angry, { quality: 'hi' })).not.toThrow();
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
});

describe('the backup', () => {
  it('takes Banvy\'s own keys out, and only those', () => {
    const st = memory({ 'banvy-map-rounds-v1': '{"version":1,"rounds":[]}', 'banvy:dev-overlay': '1', 'banvy-fps': '30', 'someone-else': 'x' });
    const backup = exportBackup(st, new Date('2026-11-08T01:00:00Z'));
    expect(backup).toMatchObject({ kind: 'banvy-backup', version: 1, exportedAt: '2026-11-08T01:00:00.000Z' });
    expect(Object.keys(backup.data).sort()).toEqual(['banvy-fps', 'banvy-map-rounds-v1', 'banvy:dev-overlay']);
  });
  it('reads its own file back and refuses anything else', () => {
    const file = JSON.stringify(exportBackup(memory({ 'banvy-fps': '30', 'banvy-caddie-bag-v1': '{}' })));
    const read = readBackup(file);
    expect(read.ok).toBe(true);
    const st = memory();
    expect(restoreBackup(st, read.entries)).toBe(2);
    expect(st.getItem('banvy-fps')).toBe('30');
    expect(readBackup('not json').ok).toBe(false);
    expect(readBackup(JSON.stringify({ kind: 'other', version: 1, data: {} })).ok).toBe(false);
    expect(readBackup(JSON.stringify({ kind: 'banvy-backup', version: 1, data: { 'evil': 'x', 'banvy-x': 5 } })).ok).toBe(false);
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
  it('leaves out an ended round, a stale one, and a card never begun', () => {
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: round({ begunAt: NOW - 600e3, endedAt: NOW - 60e3 }) }), courses, NOW)).toBeNull();
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: round({ begunAt: NOW - 7 * 3600e3 }) }), courses, NOW)).toBeNull();
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: round({}) }), courses, NOW)).toBeNull();
    expect(liveRound(memory({ [`${ROUND_KEY}:visby`]: '{broken' }), courses, NOW)).toBeNull();
  });
  it('names the keys the map writes', () => {
    expect(source('../map/map-session.js')).toContain(`const ROUND_KEY = '${ROUND_KEY}'`);
    expect(source('../map/map-session.js')).toContain(`const HOLE_KEY = '${HOLE_KEY}'`);
    expect(source('../map/map-session.js')).toContain('const RESUME_MS = 6 * 60 * 60 * 1000');
  });
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
    for (const name of ['light', 'contours', 'hazards', 'quality', 'handicap', 'rounds', 'shots']) {
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
    expect(source('../map/map-field.mjs')).toContain(`\`${OFFLINE_PREFIX}\${course.slug}\``);
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
