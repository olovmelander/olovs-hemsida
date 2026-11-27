/* Banvy's move from GitHub Pages: the old address's side (pages-move.mjs) and the
   main site's (move-in.mjs) must agree byte for byte, since nobody can choose the
   data again once the old app is gone. */
import { afterEach, describe, expect, it } from 'vitest';
import { MAIN_SITE, MOVED_PAGES, MOVE_LIMIT, MOVE_PARAM, PAGES_BASE, movedLocation } from './pages-move.mjs';
import { MOVE_SEEN, decodeMove, movePrint, readMoveHash, receiveMove, rememberMove, takePendingMove } from './move-in.mjs';
import { DEVICE_ONLY_KEYS, DEVICE_ONLY_PREFIXES, OWN_KEY_SOURCE } from './backup-keys.mjs';
import { MAP_KEYS, SETTINGS_KEY, readMove } from './settings-store.mjs';

const RULES = { base: PAGES_BASE, site: MAIN_SITE, pages: [...MOVED_PAGES], param: MOVE_PARAM, limit: MOVE_LIMIT, own: OWN_KEY_SOURCE,
  deviceKeys: [...DEVICE_ONLY_KEYS], devicePrefixes: [...DEVICE_ONLY_PREFIXES], now: Date.UTC(2026, 10, 27, 12) };
const at = (path, search = '', hash = '') => ({ pathname: path, search, hash });

function memory(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  };
}

const ROUNDS = JSON.stringify({ version: 1, rounds: [{ id: 1_700_000_000_000, course: 'visby', holes: [{ n: 1, strokes: 4, putts: 2 }] }] });
const PLAYER = {
  [MAP_KEYS.rounds]: ROUNDS,
  [SETTINGS_KEY]: JSON.stringify({ quality: 'lo' }),
  [MAP_KEYS.handicap]: '12.4',
  'banvy-last-course': 'visby',
};
const DEVICE = {
  'banvy-device-id-v1': 'device-1',
  'banvy-map-gps-v1:visby': '[[1,2]]',
  'banvy-map-offline:visby': '{"ok":true}',
  'banvy_sync_meta_v1': '{"userId":"u"}',
  'another-app': 'theirs',
};
const fromUrl = url => new URL(url).hash;

describe('the old address sends the visitor to the same place', () => {
  it('maps the root, its index, deep paths and the old bookmarks onto the main site', async () => {
    const empty = memory();
    expect((await movedLocation(at('/olovs-hemsida/'), empty, RULES)).url).toBe(MAIN_SITE);
    expect((await movedLocation(at('/olovs-hemsida/index.html', '?bana=visby&hal=3'), empty, RULES)).url).toBe(MAIN_SITE + '?bana=visby&hal=3');
    expect((await movedLocation(at('/olovs-hemsida/veckefjarden3d.html', '?hal=14', '#bookmark'), empty, RULES)).url)
      .toBe(MAIN_SITE + 'veckefjarden3d.html?hal=14#bookmark');
    expect((await movedLocation(at('/olovs-hemsida', '?x=1'), empty, RULES)).url).toBe(MAIN_SITE + '?x=1');
    expect((await movedLocation(at('/elsewhere/page.html'), empty, RULES)).url).toBe(MAIN_SITE);
    expect((await movedLocation(at('/olovs-hemsida/integritet.html'), empty, RULES)).url).toBe(MAIN_SITE + 'integritet.html');
  });

  it('sends a path the main site does not have to its start, keeping the query and hash', async () => {
    const empty = memory();
    expect((await movedLocation(at('/olovs-hemsida/probe-404-path', '?bana=visby', '#statistik'), empty, RULES)).url)
      .toBe(MAIN_SITE + '?bana=visby#statistik');
    expect((await movedLocation(at('/olovs-hemsida/courses/visby/pack.bin'), empty, RULES)).url).toBe(MAIN_SITE);
    expect((await movedLocation(at('/olovs-hemsida/unknown3d.html'), empty, RULES)).url).toBe(MAIN_SITE);
    for (const page of MOVED_PAGES) expect((await movedLocation(at('/olovs-hemsida/' + page), empty, RULES)).url).toBe(MAIN_SITE + page);
  });

  it('carries nothing when the visitor kept nothing', async () => {
    const moved = await movedLocation(at('/olovs-hemsida/', '', '#statistik'), memory(DEVICE), RULES);
    expect(moved).toEqual({ url: MAIN_SITE + '#statistik', entries: 0 });
  });

  it('carries the player\'s own keys, never a device\'s or another site\'s, and keeps the hash', async () => {
    const moved = await movedLocation(at('/olovs-hemsida/', '?bana=visby', '#statistik'), memory({ ...PLAYER, ...DEVICE }), RULES);
    expect(moved.url.startsWith(MAIN_SITE + '?bana=visby#' + MOVE_PARAM + '=g')).toBe(true);
    const arrived = readMoveHash(fromUrl(moved.url));
    expect(arrived.hash).toBe('#statistik');
    const backup = JSON.parse(await decodeMove(arrived.payload));
    expect(backup).toMatchObject({ kind: 'banvy-backup', version: 1, exportedAt: '2026-11-27T12:00:00.000Z', accountRounds: false });
    expect(backup.data).toEqual(PLAYER);
  });

  it('falls back to plain base64 where the browser cannot compress', async () => {
    const saved = globalThis.CompressionStream;
    globalThis.CompressionStream = undefined;
    try {
      const moved = await movedLocation(at('/olovs-hemsida/'), memory(PLAYER), RULES);
      const { payload } = readMoveHash(fromUrl(moved.url));
      expect(payload[0]).toBe('j');
      expect(JSON.parse(await decodeMove(payload)).data).toEqual(PLAYER);
    } finally { globalThis.CompressionStream = saved; }
  });

  it('offers the file instead of a URL past the budget', async () => {
    const moved = await movedLocation(at('/olovs-hemsida/veckefjarden3d.html', '?hal=2'), memory(PLAYER), { ...RULES, limit: 20 });
    expect(moved.tooLarge).toBe(true);
    expect(moved.url).toBe(MAIN_SITE + 'veckefjarden3d.html?hal=2');
    expect(JSON.parse(moved.text).data).toEqual(PLAYER);
  });

  it('is self-contained, as the generated page embeds its source', async () => {
    const embedded = (0, eval)(`(${movedLocation.toString()})`);
    const moved = await embedded(at('/olovs-hemsida/'), memory(PLAYER), RULES);
    expect(JSON.parse(await decodeMove(readMoveHash(fromUrl(moved.url)).payload)).data).toEqual(PLAYER);
  });

  it('moves a storage that refuses to be read as an address alone', async () => {
    const refusing = { get length() { throw new Error('denied'); } };
    expect(await movedLocation(at('/olovs-hemsida/'), refusing, RULES)).toEqual({ url: MAIN_SITE, entries: 0 });
  });
});

describe('the main site receives it', () => {
  afterEach(() => { takePendingMove(); });
  const browser = hash => {
    const location = { pathname: '/', search: '?bana=visby&hal=3', hash };
    const history = { state: { kept: 1 }, urls: [], replaceState(state, _, url) { this.urls.push(url); } };
    return { location, history };
  };

  it('takes the data out of the address, then opens Konto och data with it', async () => {
    const moved = await movedLocation(at('/olovs-hemsida/', '?bana=visby&hal=3', '#bookmark'), memory(PLAYER), RULES);
    const { location, history } = browser(fromUrl(moved.url));
    const storage = memory();
    expect(await receiveMove({ location, history, storage, base: '/' })).toEqual({ destination: '/?bana=visby&hal=3#bookmark', offered: true });
    expect(history.urls).toEqual(['/?bana=visby&hal=3#bookmark', '/#installningar/konto']);
    const pending = takePendingMove();
    expect(pending.destination).toBe('/?bana=visby&hal=3#bookmark');
    expect(JSON.parse(pending.text).data).toEqual(PLAYER);
    expect(takePendingMove()).toBeNull();
  });

  it('does not offer the same data twice, whenever it left the old address', async () => {
    const storage = memory();
    const first = await movedLocation(at('/olovs-hemsida/'), memory(PLAYER), RULES);
    const later = await movedLocation(at('/olovs-hemsida/'), memory(PLAYER), { ...RULES, now: RULES.now + 86_400_000 });
    expect(await movePrint(first.text)).toBe(await movePrint(later.text));
    rememberMove(storage, await movePrint(first.text));
    expect(JSON.parse(storage.getItem(MOVE_SEEN))).toHaveLength(1);
    const { location, history } = browser(fromUrl(later.url));
    expect(await receiveMove({ location, history, storage, base: '/' })).toEqual({ destination: '/?bana=visby&hal=3', offered: false });
    expect(history.urls).toEqual(['/?bana=visby&hal=3']);
    expect(takePendingMove()).toBeNull();
  });

  it('offers a move it cannot read as a problem rather than dropping it', async () => {
    const { location, history } = browser(`#${MOVE_PARAM}=g!!not-base64`);
    expect((await receiveMove({ location, history, storage: memory(), base: '/' })).offered).toBe(true);
    expect(takePendingMove()).toMatchObject({ text: null, print: null });
  });

  it('ignores every other fragment', async () => {
    for (const hash of ['', '#installningar', '#flytt', `#${MOVE_PARAM}=`]) expect(readMoveHash(hash)).toBeNull();
    const { location, history } = browser('#statistik');
    expect(await receiveMove({ location, history, storage: memory(), base: '/' })).toBeNull();
    expect(history.urls).toEqual([]);
  });
});

describe('readMove', () => {
  it('keeps every entry a restore accepts and names the damaged ones', () => {
    const text = JSON.stringify({ kind: 'banvy-backup', version: 1, exportedAt: '2026-11-27T12:00:00.000Z',
      data: { ...PLAYER, [MAP_KEYS.shots]: '{"version":2}', 'banvy-device-id-v1': 'x' } });
    const read = readMove(text);
    expect(read.ok).toBe(true);
    expect(Object.fromEntries(read.entries)).toEqual(PLAYER);
    expect(read.skipped).toEqual([MAP_KEYS.shots]);
  });

  it('refuses what is not a move, and a move with nothing usable', () => {
    expect(readMove('nonsense').ok).toBe(false);
    const broken = readMove(JSON.stringify({ kind: 'banvy-backup', version: 1, data: { [MAP_KEYS.rounds]: '{}' } }));
    expect(broken).toMatchObject({ ok: false });
    expect(broken.reason).toMatch(/skadade/);
  });
});
