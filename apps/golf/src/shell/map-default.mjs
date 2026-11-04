/* Which program a course link opens.

   A phone opens the light map, a real round being what a phone is out on the
   course for; everything else opens the detailed course. Only a plain link follows
   that default. A link that says more than which course and hole was written for
   the player: a shared view, a harness pinning its quality, a historical bookmark
   with its camera. Those keep opening it, and `karta` says so either way:
   `karta=1` is the map on any device and `karta=0` the detailed course on a phone. */
const PLAIN_LINK_KEYS = new Set(['bana', 'hal']);

/* The player's own test for a phone (main.js), by capability and never by user
   agent: a touch-first screen whose short side is phone-sized. */
export function isPhone(environment = globalThis) {
  if (!environment.matchMedia?.('(pointer: coarse) and (hover: none)').matches) return false;
  const screen = environment.screen;
  return Math.min(screen?.width ?? Infinity, screen?.height ?? Infinity) <= 768;
}

export function opensMap(search, phone) {
  const params = new URLSearchParams(search);
  if (params.has('karta')) return params.get('karta') !== '0';
  return phone && params.has('bana') && [...params.keys()].every(key => PLAIN_LINK_KEYS.has(key));
}
