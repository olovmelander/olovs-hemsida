/* The bare route: the start menu, the courses for a mode, and the settings.

   Three screens on one page, chosen by the hash, so the browser's back and
   forward walk them and a link can open any of them:

     (none)          the start menu (shell/home.js)
     #3d, #karta     the courses, for the detailed course or the light map
     #statistik      the rounds and clubs (shell/stats-page.js, loaded on first use)
     #installningar  the settings (shell/settings-page.js, loaded on first use)

   The hash keeps entry.js's rule intact -- a bare search is this page -- and
   this route still never loads the 3D engine. A course opens as a navigation
   with everything the visit needs in its URL (settings-store.mjs launchUrl). */
import { buildRail, lastCourse, COURSE_LINES } from './shell/rail.js';
import { buildHome } from './shell/home.js';
import { createCourseSheet } from './shell/course-sheet.js';
import { isPhone } from './shell/map-default.mjs';
import { packRequestUrl } from './loader/pack.js';
import { MODES, launchUrl, modeOfRoute, readSettings, rememberLaunch, savedTee } from './shell/settings-store.mjs';

const boot = document.getElementById('boot');
/* The bare route never loads the player, so its HUD is placeholder markup ("1",
   "—", the camera buttons): it showed through the chooser's 95%-opaque glass
   and its buttons sat in the tab order behind it. index.html hides it. */
document.body.classList.add('hub');
const message = document.getElementById('bmsg');
const bar = document.querySelector('#bar i');
const storage = () => { try { return localStorage; } catch { return null; } };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const TITLES = {
  home: 'Banvy 3D — Svenska golfbanor i realtid',
  detailed: 'Detaljerad 3D — välj bana · Banvy',
  map: 'Lätt 3D med GPS — välj bana · Banvy',
  settings: 'Inställningar · Banvy',
  stats: 'Statistik · Banvy',
};

try {
  if (message) message.textContent = 'laddar banor';
  if (bar) bar.style.width = '45%';
  const response = await fetch(`${import.meta.env.BASE_URL}courses/index.json`);
  if (!response.ok) throw new Error(`course manifest ${response.status}`);
  const manifest = await response.json();
  const courses = manifest.courses || [];
  const prefetched = new Set();

  /* A course opens in the mode it was picked in, with the settings' launch
     values, and is remembered so the start menu can offer it again. */
  const launch = (slug, mode, plan = null) => {
    rememberLaunch(storage(), slug, mode);
    location.assign(launchUrl(slug, mode, { phone: isPhone(), settings: readSettings(storage()), plan }));
  };
  /* A course card opens the course's own page, where the round is set up. */
  const sheet = createCourseSheet({ courses, lines: COURSE_LINES, onLaunch: launch });

  /* Did this visit reach the current screen from inside the hub? Then the
     page's own back button is the browser's back; a screen opened by a link
     goes back to the start menu instead of out of the site. */
  let walked = false;
  const go = route => { walked = true; location.hash = route; };
  const back = () => {
    if (walked && history.length > 1) history.back();
    else { history.replaceState(history.state, '', location.pathname + location.search); show(); }
  };

  const home = buildHome({
    courses,
    onMode: mode => go(MODES[mode].route),
    onSettings: () => go('installningar'),
    onStats: () => go('statistik'),
    /* at a course: its own page, in the map */
    onPlan: (slug, mode) => sheet.open(slug, mode),
    /* back on the tee last chosen there; the map reads it from its own key */
    onResume: (slug, mode) => {
      const course = courses.find(c => c.slug === slug);
      launch(slug, mode, mode === 'detailed' && course ? { tee: savedTee(storage(), course) } : null);
    },
  });
  document.body.append(home);

  let chooser = null;
  const getChooser = mode => {
    if (chooser) return chooser;
    chooser = buildRail({
      courses,
      current: null,
      last: lastCourse(),
      isInitialBoot: true,
      context: 'hub',
      mode,
      onPick: (slug, pickedMode) => sheet.open(slug, pickedMode),
      /* switching mode in place is not a new step back */
      onModeChange: next => {
        history.replaceState(history.state, '', `#${MODES[next].route}`);
        chooser.setMode(next);
        document.title = TITLES[next];
      },
      onHome: back,
      onSettings: () => go('installningar'),
      /* Warm the cache for the course under the pointer -- by the SAME url the
         player and the map will ask for, or the warm-up is a whole pack
         (214-730 kB) nobody ever reads (see packRequestUrl). Low priority: it
         must never compete with the posters. */
      onIntent: slug => {
        /* a device asking to save data fetches a pack only when it is opened */
        if (prefetched.has(slug) || navigator.connection?.saveData) return;
        prefetched.add(slug);
        const course = courses.find(c => c.slug === slug);
        if (course?.packUrl) fetch(packRequestUrl(course), { priority: 'low' }).catch(() => {});
      },
    });
    chooser.hidden = true;
    document.body.append(chooser);
    return chooser;
  };

  let settings = null;
  const getSettings = async () => {
    if (settings) return settings;
    const { buildSettings } = await import('./shell/settings-page.js');
    settings = buildSettings({ courses, onBack: back });
    settings.hidden = true;
    document.body.append(settings);
    return settings;
  };

  let stats = null;
  const getStats = async () => {
    if (stats) return stats;
    const { buildStats } = await import('./shell/stats-page.js');
    /* the rounds are the map's, so a course is played next in the map */
    stats = buildStats({ courses, onBack: back, onPlay: () => go(MODES.map.route), onCourse: slug => sheet.open(slug, 'map') });
    stats.hidden = true;
    document.body.append(stats);
    return stats;
  };

  /* --------------------------------------------------------------- show */
  let current = null;
  const PAGES = { installningar: 'settings', statistik: 'stats' };
  async function show() {
    /* the course page belongs to the list it was opened from; any other step closes it */
    if (sheet.isOpen()) sheet.close();
    /* a screen and what it opens on: #statistik/<course> is one course's statistics */
    const [route, detail = ''] = location.hash.replace(/^#\/?/, '').split('/');
    const mode = modeOfRoute(route);
    const key = mode || PAGES[route] || 'home';
    const screen = key === 'settings' ? await getSettings() : key === 'stats' ? await getStats() : mode ? getChooser(mode) : home;
    if (mode && screen.getMode() !== mode) screen.setMode(mode);
    const course = key === 'stats' && detail ? decodeURIComponent(detail) : null;
    if (course) screen.showCourse(course);
    else if (key !== 'detailed' && key !== 'map') screen.refresh?.();
    const swap = () => {
      for (const other of [home, chooser, settings, stats]) if (other && other !== screen) other.hidden = true;
      screen.hidden = false;
      screen.classList.remove('leaving');
      if (current !== screen) screen.scrollTop = 0;
      current = screen;
    };
    const first = !document.documentElement.classList.contains('hub-ready');
    if (!first && !REDUCED && document.startViewTransition && current !== screen) {
      document.documentElement.dataset.hubTo = key;
      await document.startViewTransition(swap).finished.catch(() => {});
    } else swap();
    document.title = TITLES[key];
    document.documentElement.classList.add('hub-ready');
    /* where a keyboard and a screen reader land: the screen's own heading */
    if (!first) (screen.querySelector('h1[tabindex]') || screen.querySelector('h1'))?.focus({ preventScroll: true });
    if (course) screen.revealCourse();
  }
  /* a link inside the hub (the course page's statistics) is a step walked here too */
  addEventListener('hashchange', () => { walked = true; show(); });

  /* Escape is the way back from a list or the settings. The search field and
     the bag editor take it first when they have something to close. */
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || current === home) return;
    if (document.querySelector('dialog[open]')) return;
    back();
  });

  await show();
  if (bar) bar.style.width = '100%';
  if (message) message.textContent = 'klar';
  requestAnimationFrame(() => boot?.classList.add('done'));
} catch (error) {
  if (message) message.textContent = `kunde inte ladda banorna: ${error.message}`;
}
