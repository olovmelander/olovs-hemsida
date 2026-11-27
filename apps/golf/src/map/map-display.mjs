/* How the map shows itself to this player: for the sun, for the eyes and for the hand.

   A choice once made is kept. Until then the phone's own settings speak for the player:
   more contrast asked of the system is the sun's look, and a large iOS text size is
   large text here. Reading that size takes the Apple system font's own keyword, which
   any other browser ignores. See docs/course-map-mode.md. */
/* Time spent drawing or waiting for a requested frame. A new event after an
   idle spell is the first frame of a new sequence, regardless of its timestamp. */
export function activeFrameMs(previous, requestedAt, nextStart) {
  if (previous.end == null) return null;
  const idle = Math.max(0, requestedAt - previous.end);
  if (idle >= 200) return null;
  return Math.max(0, nextStart - previous.start - idle);
}

export const DISPLAY_KEY = 'banvy-map-display-v1';
const KEY = DISPLAY_KEY;
/* Above this a player has turned the size up: the system's default is 17 px. */
const LARGE_SYSTEM_TEXT_PX = 19;
const CHOICES = Object.freeze(['sun', 'large', 'left']);
const CLASS_OF = Object.freeze({ sun: 'is-sun', large: 'is-large', left: 'is-left' });
export const SUN_MODES = Object.freeze(['dag', 'auto', 'natt']);
const AUTO_SUN_ELEVATION_DEG = 8;

function parseSaved(savedText) {
  try { return JSON.parse(savedText) ?? {}; } catch { return {}; }
}

export function displayChoices(savedText, system) {
  const saved = parseSaved(savedText);
  return {
    sun: typeof saved.sun === 'boolean' ? saved.sun : system.contrast,
    large: typeof saved.large === 'boolean' ? saved.large : system.textPixels > LARGE_SYSTEM_TEXT_PX,
    left: saved.left === true,
  };
}

export function sunModeOf(savedText) {
  const saved = parseSaved(savedText);
  if (SUN_MODES.includes(saved.sunMode)) return saved.sunMode;
  if (typeof saved.sun === 'boolean') return saved.sun ? 'dag' : 'natt';
  return 'auto';
}

export function resolveSunActive(mode, { contrast = false, solarElevation = null, activeRound = false } = {}) {
  if (mode === 'dag') return true;
  if (mode === 'natt') return false;
  return Boolean(contrast || (activeRound && Number.isFinite(solarElevation) && solarElevation > AUTO_SUN_ELEVATION_DEG));
}

export function sleepPreference(savedText) {
  return parseSaved(savedText).allowSleep === true;
}

/* The start menu's Inställningar reads the same answer, so its switches show
   what the map will really do before a choice is made. */
export const systemDisplay = () => ({ contrast: matchMedia('(prefers-contrast: more)').matches, textPixels: systemTextPixels() });

function systemTextPixels() {
  const probe = document.createElement('span');
  probe.style.font = '-apple-system-body';
  probe.style.position = 'absolute';
  document.body.append(probe);
  const pixels = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return pixels;
}

export function createDisplay(root, { read, write }) {
  const system = systemDisplay();
  const savedText = read(KEY);
  const choices = displayChoices(savedText, system);
  let sunMode = sunModeOf(savedText);
  let allowSleep = sleepPreference(savedText);
  let autoContext = { solarElevation: null, activeRound: false };
  const recomputeSun = () => {
    choices.sun = resolveSunActive(sunMode, { contrast: system.contrast, ...autoContext });
  };
  const apply = () => {
    recomputeSun();
    for (const name of CHOICES) root.classList.toggle(CLASS_OF[name], choices[name]);
    /* Solläge is the design system's Dag material (styles/tokens.css) */
    root.classList.toggle('bv-dag', choices.sun);
  };
  const persist = () => {
    write(KEY, JSON.stringify({ ...choices, sunMode, allowSleep }));
  };
  apply();
  return {
    get(name) {
      if (name === 'sunMode') return sunMode;
      if (name === 'allowSleep') return allowSleep;
      return choices[name];
    },
    set(name, value) {
      if (name === 'sunMode') {
        sunMode = SUN_MODES.includes(value) ? value : 'auto';
        apply();
        persist();
        return;
      }
      if (name === 'allowSleep') {
        allowSleep = Boolean(value);
        persist();
        return;
      }
      if (name === 'sun') {
        sunMode = value ? 'dag' : 'natt';
      }
      choices[name] = value;
      apply();
      persist();
    },
    setAutoContext(next) {
      autoContext = { ...autoContext, ...next };
      const before = choices.sun;
      apply();
      return choices.sun !== before;
    },
  };
}
