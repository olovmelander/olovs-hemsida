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
import { createClubPicker } from './shell/club-picker.js';
import { groupCourses, layoutLabel } from './shell/course-clubs.mjs';
import { buildHome } from './shell/home.js';
import { createCourseSheet } from './shell/course-sheet.js';
import { isPhone } from './shell/map-default.mjs';
import { parentHubRoute, previousCourseEntry } from './shell/router.js';
import { packRequestUrl } from './loader/pack.js';
import { MODES, launchUrl, modeOfRoute, readSettings, rememberLaunch, savedTee } from './shell/settings-store.mjs';
import { getCloudState, initCloud } from './shell/cloud.mjs';

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
  detailed: 'Detaljerad 3D — välj klubb · Banvy',
  map: 'Lätt 3D med GPS — välj klubb · Banvy',
  settings: 'Inställningar · Banvy',
  stats: 'Statistik · Banvy',
  play: 'Simulator — välj klubb · Banvy',
};

try {
  if (message) message.textContent = 'laddar banor';
  if (bar) bar.style.width = '45%';
  const catalogueKey = 'banvy-hub-catalogue-v1';
  const courses = [];
  let catalogueFailed = false;
  try {
    const saved = JSON.parse(storage()?.getItem(catalogueKey));
    if (Array.isArray(saved)) courses.push(...saved);
  } catch { /* no local catalogue yet */ }
  const catalogueReady = (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}courses/index.json`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Banlistan kunde inte hämtas');
      const manifest = await response.json();
      if (!Array.isArray(manifest.courses)) throw new Error('Banlistan saknas');
      courses.splice(0, courses.length, ...manifest.courses);
      try { storage()?.setItem(catalogueKey, JSON.stringify(courses)); } catch { /* storage can be full */ }
    } catch { catalogueFailed = true; }
  })();
  const prefetched = new Set();

  /* A course opens in the mode it was picked in, with the settings' launch
     values, and is remembered so the start menu can offer it again. */
  const launch = (slug, mode, plan = null) => {
    rememberLaunch(storage(), slug, mode);
    location.assign(launchUrl(slug, mode, { phone: isPhone(), settings: readSettings(storage()), plan }));
  };
  /* A course card opens the course's own page, where the round is set up. */
  const sheet = createCourseSheet({ courses, lines: COURSE_LINES, onLaunch: launch, onDismiss: () => back(), onEdit: () => {
    if (!sheet.isOpen()) return;
    const setup = sheet.snapshot();
    const [route, slug] = location.hash.slice(1).split('?')[0].split('/');
    // Loading the guide can finish during a Back or new hash navigation.
    if (!modeOfRoute(route) || slug !== encodeURIComponent(setup.slug)) return;
    const query = new URLSearchParams();
    if (setup.hole !== 1) query.set('hal', setup.hole);
    query.set('tee', setup.tee + 1);
    if (setup.guideHole !== setup.hole) query.set('guide', setup.guideHole);
    const path = `#${MODES[setup.mode].route}/${encodeURIComponent(setup.slug)}?${query}`;
    history.replaceState({ ...history.state, setup }, '', path);
  } });

  /* Did this visit reach the current screen from inside the hub? Then the
     page's own back button is the browser's back; a screen opened by a link
     goes back to the start menu instead of out of the site. */
  const patchHistory = patch => {
    const previous = history.state;
    if (Object.keys(patch).every(key => JSON.stringify(previous?.[key]) === JSON.stringify(patch[key]))) return;
    history.replaceState({ ...previous, ...patch }, '');
  };
  const nav = window.navigation;
  if (typeof history.state?.hubFrom !== 'string' && previousCourseEntry({ href: location.href, referrer: document.referrer, historyLength: history.length,
    previousUrl: nav?.currentEntry ? nav.entries().find(entry => entry.index === nav.currentEntry.index - 1)?.url ?? null : undefined,
  })) patchHistory({ hubFrom: document.referrer });
  let current = null, chooser = null, settings = null, stats = null, sequence = 0, cleanBag = false;
  let displayedHash = null;
  const routeUrl = route => route ? '#' + route : location.pathname + location.search;
  function rememberScreen() {
    if (!current) return;
    const active = document.activeElement;
    const focus = active?.closest('.card[data-slug]')?.dataset.slug;
    const focusId = active?.id;
    const state = { scroll: current.scrollTop, focusCourse: focus || null, focusId: focusId || null };
    if (current === home) state.focusMode = active?.closest('.mode-card')?.dataset.mode || null;
    if (current === chooser) state.chooser = chooser.snapshot();
    if (current === stats) state.stats = stats.snapshot();
    if (sheet.isOpen()) state.setup = sheet.snapshot();
    patchHistory(state);
  }
  function keepPlace(screen) {
    // Same-document history traversal never runs pagehide. Save the scroll and
    // keyboard target on the entry the user is actually interacting with.
    const remember = () => {
      if (current === screen && displayedHash === location.hash && !document.querySelector('dialog[open]')) rememberScreen();
    };
    for (const type of ['focusin', 'input', 'click']) screen.addEventListener(type, remember);
    let scrollTimer;
    screen.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(remember, 140);
    }, { passive: true });
  }
  function go(route, extra = {}) {
    rememberScreen();
    if (extra.returnCourse && current === chooser) patchHistory({ focusCourse: extra.returnCourse });
    const from = location.hash;
    history.pushState({ hubFrom: from, ...extra }, '', routeUrl(route));
    show();
  }
  const openClub = (id, mode) => go(`${MODES[mode].route}/klubb/${encodeURIComponent(id)}`, {
    chooser: chooser?.snapshot(), returnCourse: id,
  });
  const clubPicker = createClubPicker({ onSelect: slug => {
    patchHistory({ focusLayout: slug });
    openCourse(slug, chooser.getMode());
  }, onDismiss: back });
  const openCourse = (slug, mode) => go(`${MODES[mode].route}/${encodeURIComponent(slug)}`, {
    chooser: chooser?.snapshot(), returnCourse: slug,
  });
  function back() {
    if (typeof history.state?.hubFrom === 'string') { history.back(); return; }
    history.replaceState(null, '', routeUrl(parentHubRoute(location.hash)));
    show();
  }
  function openHome() {
    const from = history.state?.hubFrom;
    if (from === '' || from === '#') history.back();
    else if (from == null) { history.replaceState(null, '', routeUrl('')); show(); }
    else go('');
  }

  let home = null;
  function getHome() {
    if (home) return home;
    home = buildHome({
      courses,
      onMode: mode => go(MODES[mode].route),
      onSettings: () => go('installningar'),
      onAccount: () => go('installningar/konto'),
      onStats: () => go('statistik'),
      /* at a course: its own page, in the map */
      onPlan: openCourse,
      onNearby: id => openClub(id, 'map'),
      /* back on the tee last chosen there; the map reads it from its own key */
      onResume: (slug, mode, plan = null) => {
        const course = courses.find(c => c.slug === slug);
        launch(slug, mode, mode === 'detailed' && course ? { tee: savedTee(storage(), course) } : plan);
      },
    });
    keepPlace(home);
    document.body.append(home);
    return home;
  }

  const getChooser = mode => {
    if (chooser) return chooser;
    chooser = buildRail({
      courses,
      current: null,
      last: lastCourse(),
      isInitialBoot: true,
      context: 'hub',
      mode,
      onPick: openCourse,
      onPickClub: openClub,
      /* switching mode in place is not a new step back */
      onModeChange: next => {
        history.replaceState(history.state, '', `#${MODES[next].route}`);
        displayedHash = location.hash;
        chooser.setMode(next);
        document.title = TITLES[next];
      },
      onHome: openHome,
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
    keepPlace(chooser);
    chooser.hidden = true;
    document.body.append(chooser);
    return chooser;
  };

  const getSettings = async () => {
    if (settings) return settings;
    const { buildSettings } = await import('./shell/settings-page.js');
    if (settings) return settings;
    settings = buildSettings({ courses, onBack: back,
      onSection: section => { if (location.hash === '#installningar/' + section) settings.focusSection(section); else go('installningar/' + section); },
      onBag: () => go('installningar/bag', { bagDraft: history.state?.bagDraft, bagOwner: history.state?.bagOwner }),
      onBagDraft: draft => { if (location.hash === '#installningar/bag') patchHistory({ bagDraft: draft, bagOwner: getCloudState().user?.id ?? null }); }, onBagClosed: () => {
      if (location.hash === '#installningar/bag') { patchHistory({ bagDraft: null }); cleanBag = true; back(); }
    } });
    settings.hidden = true;
    keepPlace(settings);
    document.body.append(settings);
    return settings;
  };

  const getStats = async () => {
    if (stats) return stats;
    const { buildStats } = await import('./shell/stats-page.js');
    if (stats) return stats;
    /* the rounds are the map's, so a course is played next in the map */
    stats = buildStats({ courses, onBack: back, onPlay: () => go(MODES.map.route), onCourse: slug => openCourse(slug, 'map'),
      onFiltersOpen: () => {
        const [path, search] = location.hash.slice(1).split('?');
        const query = new URLSearchParams(search);
        if (query.get('filter') === '1') return;
        query.set('filter', '1');
        go(path + '?' + query, { stats: stats.snapshot() });
      },
      onFiltersClose: back,
    });
    stats.addEventListener('stats-view-change', () => {
      if (current === stats && displayedHash === location.hash) patchHistory({ stats: stats.snapshot() });
    });
    stats.hidden = true;
    keepPlace(stats);
    document.body.append(stats);
    return stats;
  };

  /* --------------------------------------------------------------- show */
  const PAGES = { installningar: 'settings', statistik: 'stats' };
  function catalogueNotice(screen) {
    if (catalogueFailed && !screen.querySelector('.hub-catalogue-error')) {
      const notice = document.createElement('aside');
      notice.className = 'hub-catalogue-error';
      const words = document.createElement('span');
      words.textContent = courses.length ? 'Visar sparad banlista.' : 'Banlistan kunde inte hämtas.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Försök igen';
      retry.onclick = () => { rememberScreen(); location.reload(); };
      notice.append(words, retry);
      (screen.querySelector('.set-top, .hub-top, .chooser-top-bar') ?? screen.firstElementChild)?.after(notice);
    }
  }
  async function show() {
    const version = ++sequence;
    const entry = history.state ?? {};
    const hash = location.hash;
    const [path, search] = hash.replace(/^#\/?/, '').split('?');
    const [route, detail = '', roundId = ''] = path.split('/');
    const query = new URLSearchParams(search);
    const mode = modeOfRoute(route);
    const key = mode || PAGES[route] || 'home';
    const toBag = key === 'settings' && detail === 'bag';
    const filterOpen = key === 'stats' && query.get('filter') === '1';
    const closingFilters = current === stats && stats && !filterOpen && displayedHash != null
      && new URLSearchParams(displayedHash.split('?')[1]).get('filter') === '1'
      && displayedHash.split('?')[0] === hash.split('?')[0];
    const savedStats = entry.stats?.owner === (getCloudState().user?.id ?? null) ? entry.stats : null;
    const statsView = closingFilters ? stats.snapshot() : savedStats;
    if (closingFilters) patchHistory({ stats: statsView });
    if (current === stats && stats && !filterOpen) stats.setFiltersOpen(false);
    const fromBag = document.querySelector('#bagDialog[open]');
    if (!toBag && fromBag) {
      const draft = settings?.leaveBag();
      if (key === 'settings' && draft) patchHistory({ bagDraft: draft, bagOwner: getCloudState().user?.id ?? null });
    }
    if (!toBag && cleanBag) { cleanBag = false; patchHistory({ bagDraft: null }); }
    if (sheet.isOpen()) sheet.close();
    if (clubPicker.isOpen()) clubPicker.close();
    if (mode) await catalogueReady;
    if (version !== sequence) return;
    const screen = key === 'settings' ? await getSettings() : key === 'stats' ? await getStats() : mode ? getChooser(mode) : getHome();
    if (version !== sequence) return;
    if (mode && screen.getMode() !== mode) screen.setMode(mode);
    const course = key === 'stats' && detail ? detail : null;
    if (key === 'stats') {
      if (course && !statsView) screen.showCourse(course, roundId || null);
      else screen.restore(statsView ?? null);
    } else if (!mode) screen.refresh?.();
    if (key === 'settings') screen.selectSection(toBag ? 'spelare' : detail);
    const swap = () => {
      if (version !== sequence) return;
      for (const other of [home, chooser, settings, stats]) if (other && other !== screen) other.hidden = true;
      screen.hidden = false;
      screen.classList.remove('leaving');
      if (current !== screen) screen.scrollTop = 0;
      current = screen;
    };
    const first = !document.documentElement.classList.contains('hub-ready');
    if (!first && !REDUCED && document.startViewTransition && current !== screen) {
      document.documentElement.dataset.hubTo = key;
      const transition = document.startViewTransition(swap);
      transition.ready.catch(() => {}); // a faster navigation can skip this animation
      await transition.updateCallbackDone.catch(() => {});
    } else swap();
    if (version !== sequence) return;
    document.title = TITLES[key];
    document.documentElement.classList.add('hub-ready');
    /* where a keyboard and a screen reader land: the screen's own heading */
    if (!first) (screen.querySelector('h1[tabindex]') || screen.querySelector('h1'))?.focus({ preventScroll: true });
    if (mode) await chooser.restore(entry.chooser ?? {});
    else if (Number.isFinite(entry.scroll) && !toBag) screen.scrollTop = entry.scroll;
    if (version !== sequence) return;
    const club = mode && detail === 'klubb' && groupCourses(courses).find(group => group.id === roundId);
    if (club) {
      const layouts = club.courses.filter(c => mode === 'detailed' || c.status !== 'mapping');
      if (layouts.length === 1) {
        const target = `#${MODES[mode].route}/${encodeURIComponent(layouts[0].slug)}`;
        history.replaceState(entry, '', target);
        return show();
      }
      if (layouts.length) {
        clubPicker.open({ ...club, courses: layouts }, mode, entry.focusLayout);
        document.title = `${club.name} · ${TITLES[key]}`;
      }
    } else if (mode && detail && courses.some(c => c.slug === detail)) {
      sheet.open(detail, mode, { ...entry.setup, mode,
        hole: query.has('hal') ? Number(query.get('hal')) : entry.setup?.hole,
        guideHole: query.has('guide') ? Number(query.get('guide')) : entry.setup?.guideHole,
        tee: query.has('tee') ? Number(query.get('tee')) - 1 : entry.setup?.tee,
      });
      document.title = `${layoutLabel(courses.find(c => c.slug === detail))} · ${TITLES[key]}`;
    } else if (toBag) {
      screen.focusSection?.('set-player');
      await settings.openBag(entry.bagOwner === (getCloudState().user?.id ?? null) ? entry.bagDraft : null);
      if (version !== sequence) settings.leaveBag();
    } else if (entry.focusCourse && mode) {
      chooser.focusCourse(entry.focusCourse);
    } else if (entry.focusMode && screen === home) {
      screen.querySelector(`.mode-card[data-mode="${CSS.escape(entry.focusMode)}"]`)?.focus({ preventScroll: true });
    } else if (closingFilters) document.getElementById('statsFilters')?.focus({ preventScroll: true });
    else if (entry.focusId) screen.querySelector('#' + CSS.escape(entry.focusId))?.focus({ preventScroll: true });
    else if (fromBag && key === 'settings') screen.querySelector('[data-bag-edit]')?.focus({ preventScroll: true });
    displayedHash = hash;
    if (course && !statsView) screen.revealCourse();
    if (key === 'stats') screen.setFiltersOpen(filterOpen);
    if (key === 'settings' && detail && !toBag && !Number.isFinite(entry.scroll)) screen.focusSection(detail);
    catalogueNotice(screen);
  }
  // Same-document links from the course guide and settings are hub entries too.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const target = new URL(link.href);
    const base = new URL(import.meta.env.BASE_URL, location.href);
    if (!target.hash || target.origin !== base.origin || ![base.pathname, base.pathname + 'index.html'].includes(target.pathname)) return;
    if (target.search && target.search !== location.search) return;
    event.preventDefault();
    if (target.hash !== location.hash) go(target.hash.slice(1));
  });
  addEventListener('hashchange', show);
  addEventListener('pagehide', rememberScreen);
  addEventListener('pageshow', e => { if (e.persisted) show(); });
  addEventListener('banvy-account-changed', e => {
    if (!e.detail?.previousUserId && !e.detail?.cacheReplaced) return;
    settings?.discardBag?.();
    patchHistory({ bagDraft: null });
    if (location.hash === '#installningar/bag') back();
  });
  catalogueReady.then(() => {
    if (current === stats && stats) {
      const [, course] = location.hash.slice(1).split('?')[0].split('/');
      // Catalogue names can finish loading after local statistics and filters.
      stats.restore(stats.snapshot());
      if (course && history.state?.stats?.owner !== (getCloudState().user?.id ?? null)) stats.revealCourse();
    }
    if (current === settings && settings) settings.refresh();
    if (current === home && home) home.refresh();
    if (current) catalogueNotice(current);
  });
  initCloud();

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
  /* faded out, the loading screen is not read out either ("Banvy … klar") */
  requestAnimationFrame(() => { boot?.classList.add('done'); boot?.setAttribute('aria-hidden', 'true'); });
} catch (error) {
  if (message) message.textContent = `kunde inte ladda banorna: ${error.message}`;
}
