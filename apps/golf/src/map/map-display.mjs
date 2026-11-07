/* How the map shows itself to this player: for the sun, for the eyes and for the hand.

   A choice once made is kept. Until then the phone's own settings speak for the player:
   more contrast asked of the system is the sun's look, and a large iOS text size is
   large text here. Reading that size takes the Apple system font's own keyword, which
   any other browser ignores. See docs/course-map-mode.md. */
export const DISPLAY_KEY = 'banvy-map-display-v1';
const KEY = DISPLAY_KEY;
/* Above this a player has turned the size up: the system's default is 17 px. */
const LARGE_SYSTEM_TEXT_PX = 19;
const CHOICES = Object.freeze(['sun', 'large', 'left']);
const CLASS_OF = Object.freeze({ sun: 'is-sun', large: 'is-large', left: 'is-left' });

export function displayChoices(savedText, system) {
  let saved = {};
  try { saved = JSON.parse(savedText) ?? {}; } catch { /* the phone's own settings stand */ }
  return {
    sun: typeof saved.sun === 'boolean' ? saved.sun : system.contrast,
    large: typeof saved.large === 'boolean' ? saved.large : system.textPixels > LARGE_SYSTEM_TEXT_PX,
    left: saved.left === true,
  };
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
  const choices = displayChoices(read(KEY), system);
  const apply = () => { for (const name of CHOICES) root.classList.toggle(CLASS_OF[name], choices[name]); };
  apply();
  return {
    get: name => choices[name],
    set(name, value) {
      choices[name] = value;
      write(KEY, JSON.stringify(choices));
      apply();
    },
  };
}
