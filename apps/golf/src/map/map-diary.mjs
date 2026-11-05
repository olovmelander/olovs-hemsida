/* The test round's diary: what happened on the course, for reading afterwards.

   A round played to test the map answers questions nothing at a desk can: how good the
   position really was, how often a hold on the wheel slipped, how long the battery
   lasted. It stays on the phone until the player chooses to hand it over, and it holds
   no position: an accuracy says how well a fix was placed, never where. */
const KEY = 'banvy-map-diary-v1';
const MAX_ENTRIES = 1500;
/* Only a fix's quality is kept, and one a minute says as much as sixty. */
const FIX_SAMPLE_MS = 60000;
const BATTERY_SAMPLE_MS = 10 * 60 * 1000;
const SAVE_EVERY = 12;

export const trimDiary = (entries, most = MAX_ENTRIES) => (entries.length > most ? entries.slice(entries.length - most) : entries);

export function parseDiary(text) {
  try {
    const stored = JSON.parse(text);
    return Array.isArray(stored) ? stored : [];
  } catch { return []; }
}

/* A count of everything in it, so a long log can be read at a glance. */
export function diaryCounts(entries) {
  const counts = {};
  for (const [, kind] of entries) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

export function createDiary({ read, write, now = () => Date.now() }) {
  let entries = parseDiary(read(KEY)), unsaved = 0, lastFix = -Infinity;
  const save = () => {
    unsaved = 0;
    write(KEY, JSON.stringify(entries));
  };
  const add = (kind, detail = null) => {
    entries = trimDiary([...entries, detail === null ? [now(), kind] : [now(), kind, detail]]);
    if (++unsaved >= SAVE_EVERY) save();
  };
  const readBattery = async () => {
    try {
      const battery = await navigator.getBattery?.();
      if (battery) add('battery', Math.round(battery.level * 100));
    } catch { /* many phones keep this to themselves */ }
  };
  readBattery();
  const batteryTimer = setInterval(readBattery, BATTERY_SAMPLE_MS);
  document.addEventListener('visibilitychange', () => {
    add(document.visibilityState === 'hidden' ? 'hidden' : 'shown');
    if (document.visibilityState === 'hidden') save();
  });
  return {
    add,
    fix(accuracy) {
      if (now() - lastFix < FIX_SAMPLE_MS) return;
      lastFix = now();
      add('fix', Math.round(accuracy));
    },
    count: () => entries.length,
    clear() {
      entries = [];
      save();
    },
    /* The whole diary as a file, with what the phone is: a log says little without. */
    file() {
      save();
      return JSON.stringify({
        kept: new Date(now()).toISOString(),
        phone: { agent: navigator.userAgent, screen: [screen.width, screen.height], ratio: devicePixelRatio, memory: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null },
        counts: diaryCounts(entries),
        entries,
      });
    },
    stop: () => clearInterval(batteryTimer),
  };
}
