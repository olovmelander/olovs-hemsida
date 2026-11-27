/* GitHub Pages is retired (owner, 27 November 2026): Cloudflare is Banvy's one
   site. The last Pages publication (tools/pages-moved-site.mjs) answers every old
   address with one page that sends the visitor to the same place on the main site.
   It carries the player's own data along in the URL fragment, which a browser
   never sends to a server, because stored data belongs to one site and would
   otherwise stay behind. shell/move-in.mjs receives it there. */
import { LEGACY_PAGES } from './legacy-links.mjs';

export const MAIN_SITE = 'https://banvy.olovmelander.workers.dev/';
export const PAGES_BASE = '/olovs-hemsida/';
export const MOVE_PARAM = 'flytt';
/* The fragment's budget, in characters. Chrome takes 2 MB of URL and Firefox about
   1 MB; past this the page offers the backup file rather than risk a cut URL. */
export const MOVE_LIMIT = 500_000;

/* The pages a visitor could have opened on the old address: the app routes by its
   hash, so besides its root these are the seven old bookmarks and the two policy
   pages. Any other path is sent to the start, never to a 404 on the main site. */
export const MOVED_PAGES = Object.freeze([...Object.keys(LEGACY_PAGES), 'integritet.html', 'villkor.html']);

/* Keep this function self-contained: the generator embeds its source in the page.
   `rules`: { base, site, pages, param, limit, own, deviceKeys, devicePrefixes, now },
   the last four from backup-keys.mjs, so both sites agree on what is the player's. */
export async function movedLocation(location, storage, rules) {
  const { base, site, pages, param, limit, own, deviceKeys, devicePrefixes, now } = rules;
  const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : '';
  const target = new URL((pages.includes(path) ? path : '') + location.search, site).href;
  const data = {};
  try {
    const ownKey = new RegExp(own);
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && ownKey.test(key) && !deviceKeys.includes(key) && !devicePrefixes.some(prefix => key.startsWith(prefix))) {
        data[key] = storage.getItem(key);
      }
    }
  } catch { /* storage refused: the address still moves */ }
  const entries = Object.keys(data).length;
  if (!entries) return { url: target + location.hash, entries };
  const text = JSON.stringify({ kind: 'banvy-backup', version: 1, exportedAt: new Date(now).toISOString(), accountRounds: false, data });
  let bytes = new TextEncoder().encode(text), form = 'j';
  if (typeof CompressionStream === 'function') {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    form = 'g';
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const payload = form + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (payload.length > limit) return { url: target + location.hash, entries, text, tooLarge: true };
  const fragment = new URLSearchParams({ [param]: payload });
  if (location.hash.length > 1) fragment.set('h', location.hash.slice(1));
  return { url: target + '#' + fragment, entries, text };
}
