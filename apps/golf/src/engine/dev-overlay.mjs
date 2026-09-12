/* The developer overlay, and the one panel it currently governs.

   The terrain badge ("1 M TERRÄNG · HELA VÄRLDEN · 469 tiles i 7 nivåer till
   16 km") is developer information: it says which ground served, how many tiles
   in how many levels, which backend, and at what mesh resolution. That is worth
   a lot while working on the terrain and worth nothing to a golfer looking at
   the 3rd, where on a phone it covers the top of the hole. So it is OFF by
   default and a developer turns it on.

   ONE STATE IS NEVER HIDDEN. A fallback badge is the only report a fallback
   ever sends: a phone has no tooltip, the cause is printed in the badge itself,
   and a screenshot of it is how a broken v2 ground gets reported at all. Hiding
   it behind a developer switch would mean the failures nobody is watching for
   become the failures nobody can see. So `terrainBadgeVisible` returns true for
   the fallback state whatever the switch says.

   The badge's CONTENT is written regardless of visibility — `dataset.state` and
   the text stay current — because `capture-puttom-app-preview.mjs` reads both as
   its fallback signal when `V3D.v2Terrain()` is not yet answering. Visibility is
   the only thing this module decides. */

export const DEV_OVERLAY_STORAGE_KEY = 'banvy:dev-overlay';
export const DEV_OVERLAY_PARAM = 'dev';

/* Whether the terrain badge is displayed. `requested` is the app's own
   TERRAIN_PREVIEW.requested: a course that never asked for v2 terrain has no
   badge to show in any mode. */
export function terrainBadgeVisible({ requested = false, state = null, devOverlay = false } = {}) {
  if (!requested) return false;
  if (state === 'fallback') return true;
  return devOverlay === true;
}

/* `?dev=1` wins over a stored preference and `?dev=0` forces it off, so a
   harness or a shared link states what it wants and a developer's own phone
   keeps its choice across reloads. localStorage throws in a private window and
   can come back empty after cleared site data, so every access is guarded and
   the default is simply off. */
export function readDevOverlay({ search = '', storage = null } = {}) {
  let param = null;
  try { param = new URLSearchParams(search).get(DEV_OVERLAY_PARAM); } catch { param = null; }
  if (param === '1') return { on: true, source: 'url' };
  if (param === '0') return { on: false, source: 'url' };
  try {
    if (storage && storage.getItem(DEV_OVERLAY_STORAGE_KEY) === '1') return { on: true, source: 'storage' };
  } catch { /* private window, or site data blocked */ }
  return { on: false, source: 'default' };
}

export function persistDevOverlay(on, storage = null) {
  try {
    if (!storage) return false;
    if (on) storage.setItem(DEV_OVERLAY_STORAGE_KEY, '1');
    else storage.removeItem(DEV_OVERLAY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
