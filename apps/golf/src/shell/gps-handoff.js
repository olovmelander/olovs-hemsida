/* GPS mode across a course switch.

   Changing course is navigation (router.js), so the page that follows a
   player to the course they are standing on is a new page -- and GPS mode is
   opt-in per visit and never starts from stored state. What crosses the
   navigation is therefore not a preference but a HANDOFF: written only at the
   moment GPS mode itself (or the chooser's locate button, which the player
   pressed) decides the player is on another course, read exactly once by the
   next page, and refused unless it names that very course and is under two
   minutes old. A reload, a bookmark or a shared link never carries it, and
   sessionStorage dies with the tab.

   Coming back is a choice. When a player returns to the course GPS just moved
   them away from, that course is theirs for the rest of the tab: GPS keeps
   saying where they stand but does not move them again. Without this, "back"
   would bounce straight forward on the next fix. */
const HANDOFF = 'banvy:gps-handoff';
const SWITCH = 'banvy:gps-switch';
const DECLINED = 'banvy:gps-declined';
export const HANDOFF_MAX_AGE_MS = 120000;

/* Storage can be absent or throw (a private window, blocked site data); every
   rule here then degrades to "no handoff", which is GPS mode's default. */
const read = (store, key) => { try { return JSON.parse(store?.getItem(key) || 'null'); } catch { return null; } };
const write = (store, key, value) => { try { store?.setItem(key, JSON.stringify(value)); } catch { /* unavailable */ } };
const drop = (store, key) => { try { store?.removeItem(key); } catch { /* unavailable */ } };
const session = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

export function writeGpsHandoff({ from = null, to, hole = null }, { now = Date.now(), store = session() } = {}) {
  if (typeof to !== 'string' || !to) return;
  write(store, HANDOFF, { from, to, hole: Number.isInteger(hole) ? hole : null, at: now });
}

/* Once, at boot, by the page that may be the handoff's target. Returns the
   handoff when GPS mode should carry on here, null otherwise -- and, when there
   is none, notices a return to the course GPS last moved the player away from. */
export function takeGpsHandoff(slug, { now = Date.now(), store = session() } = {}) {
  const handoff = read(store, HANDOFF);
  drop(store, HANDOFF);
  const age = handoff ? now - Number(handoff.at) : NaN;
  if (handoff && handoff.to === slug && age >= 0 && age < HANDOFF_MAX_AGE_MS) {
    if (handoff.from && handoff.from !== slug) write(store, SWITCH, { from: handoff.from, to: slug });
    return handoff;
  }
  const last = read(store, SWITCH);
  if (last?.from === slug && typeof last.to === 'string') {
    const declined = read(store, DECLINED) || {};
    const list = Array.isArray(declined[slug]) ? declined[slug] : [];
    if (!list.includes(last.to)) declined[slug] = [...list, last.to];
    write(store, DECLINED, declined);
    drop(store, SWITCH);
  }
  return null;
}

/* a switch called off before its navigation: nothing may start GPS later */
export function clearGpsHandoff({ store = session() } = {}) {
  drop(store, HANDOFF);
}

/* the courses GPS must not move a player to from `slug`, in this tab */
export function declinedCourses(slug, { store = session() } = {}) {
  const list = (read(store, DECLINED) || {})[slug];
  return Array.isArray(list) ? list.filter(s => typeof s === 'string') : [];
}
