/* The data a visitor brings from the retired GitHub Pages address
   (shell/pages-move.mjs). entry.js runs receiveMove first on every route: the data
   leaves the address bar at once, and Inställningar offers it through the
   backup's own confirmation, with its undo, before the visitor goes on to where
   their bookmark pointed. A move already read in or declined is not offered again. */
import { MOVE_PARAM } from './pages-move.mjs';

/* Outside the player's banvy- keys, so it is never in a backup or a move itself. */
export const MOVE_SEEN = 'banvy_moved_in_v1';

export function readMoveHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(`#${MOVE_PARAM}=`)) return null;
  const params = new URLSearchParams(hash.slice(1));
  const payload = params.get(MOVE_PARAM);
  if (!payload) return null;
  const rest = params.get('h');
  return { payload, hash: rest ? '#' + rest : '' };
}

export async function decodeMove(payload) {
  const form = payload[0];
  if (form !== 'g' && form !== 'j') throw new Error('unknown move form');
  const base64 = payload.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  let bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (form === 'g') {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return new TextDecoder().decode(bytes);
}

/* Which data this is, not when it left: the same records arriving again from
   another old bookmark are the same move. */
export async function movePrint(text) {
  let basis = text;
  try { basis = JSON.stringify(Object.entries(JSON.parse(text).data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))); }
  catch { /* an unreadable move is printed as it came */ }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return [...new Uint8Array(digest).subarray(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function seenMoves(storage) {
  try {
    const list = JSON.parse(storage.getItem(MOVE_SEEN));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function rememberMove(storage, print) {
  if (!print) return;
  const list = seenMoves(storage).filter(item => item !== print);
  list.push(print);
  try { storage.setItem(MOVE_SEEN, JSON.stringify(list.slice(-20))); } catch { /* offered again next time */ }
}

/* Held in memory for this page only: a reload before the visitor answers drops it,
   and the next old bookmark brings it again. */
let pending = null;
export function takePendingMove() {
  const move = pending;
  pending = null;
  return move;
}

export async function receiveMove({ location, history, storage, base }) {
  const move = readMoveHash(location.hash);
  if (!move) return null;
  const destination = location.pathname + location.search + move.hash;
  history.replaceState(history.state, '', destination);
  let text = null;
  try { text = await decodeMove(move.payload); } catch { /* offered as a problem */ }
  const print = text === null ? null : await movePrint(text);
  if (print && seenMoves(storage).includes(print)) return { destination, offered: false };
  pending = { text, print, destination };
  history.replaceState(history.state, '', base + '#installningar/konto');
  return { destination, offered: true };
}
