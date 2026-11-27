/* The bare route: the unified Club Lobby, Club View, Statistics, and Settings.

   Canonical hashes:
     (none) / #       Unified Club Lobby (shell/home.js)
     #klubb/<id>      Club View dialog over Lobby (?bana=<slug>&lage=<mode>&tee=<n>&hal=<n>&tab=<tab>)
     #statistik       Rounds & club statistics (shell/stats-page.js)
     #installningar   Player & device settings (shell/settings-page.js)

   Legacy bookmarks (#3d, #karta, #spela, #<mode>/<slug>, #<mode>/klubb/<id>)
   resolve cleanly without breaking external links or browser Back/Forward. */
import { COURSE_LINES } from './shell/club-search.mjs';
import { CLUB_LAYOUT_KEY, clubIdFor, clubLayouts, groupCourses, layoutLabel, preferredLayout } from './shell/course-clubs.mjs';
import { buildHome } from './shell/home.js';
import { createCourseSheet } from './shell/course-sheet.js';
import { isPhone } from './shell/map-default.mjs';
import { parentHubRoute, previousCourseEntry } from './shell/router.js';
import { LAST_COURSE_KEY, LAST_MODE_KEY, MODES, courseSessions, launchUrl, modeOfRoute, readSettings, readText, rememberLaunch, savedTee, writeText } from './shell/settings-store.mjs';
import { getCloudState, initCloud } from './shell/cloud.mjs';
import { recoverPlayWrites } from './play/play-persistence.mjs';

const boot = document.getElementById('boot');
document.body.classList.add('hub');
const message = document.getElementById('bmsg');
const bar = document.querySelector('#bar i');
const storage = () => { try { return localStorage; } catch { return null; } };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const TITLES = {
  home: 'Banvy — Svenska golfbanor i 3D',
  detailed: 'Detaljerad 3D · Banvy',
  map: 'Lätt 3D · Banvy',
  settings: 'Inställningar · Banvy',
  stats: 'Statistik · Banvy',
  play: 'Simulator · Banvy',
};

const TAB_ICONS = {
  home: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V5l10 3.5L5 12"/><path d="M4 20h16"/></svg>',
  stats: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-3.8 3.6-5.6 7-5.6s6 1.8 7 5.6"/></svg>',
};

try {
  if (message) message.textContent = 'laddar banor';
  if (bar) bar.style.width = '45%';
  const recoveredSessions = recoverPlayWrites();
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
      try { storage()?.setItem(catalogueKey, JSON.stringify(courses)); } catch { /* storage full */ }
    } catch { catalogueFailed = true; }
  })();

  const rememberLayout = slug => writeText(storage(), `${CLUB_LAYOUT_KEY}:${clubIdFor(slug)}`, slug);
  const preferredMode = () => {
    const last = readText(storage(), LAST_MODE_KEY, null);
    return MODES[last] ? last : isPhone() ? 'map' : 'detailed';
  };
  const launch = (slug, mode, plan = null) => {
    rememberLaunch(storage(), slug, mode);
    rememberLayout(slug);
    location.assign(launchUrl(slug, mode, { phone: isPhone(), settings: readSettings(storage()), plan }));
  };

  function clubRoute(slug, mode, { hole = 1, tee = null, guideHole = null, tab = null } = {}) {
    const clubId = clubIdFor(slug);
    const q = new URLSearchParams();
    q.set('bana', slug);
    if (MODES[mode]) q.set('lage', MODES[mode].route);
    if (hole && hole !== 1) q.set('hal', String(hole));
    if (Number.isInteger(tee)) q.set('tee', String(tee + 1));
    if (guideHole && guideHole !== hole) q.set('guide', String(guideHole));
    if (tab && tab !== 'card') q.set('tab', tab);
    return `klubb/${encodeURIComponent(clubId)}?${q}`;
  }

  const sheet = createCourseSheet({
    courses,
    lines: COURSE_LINES,
    onLaunch: launch,
    onDismiss: () => back(),
    onLayout: rememberLayout,
    onEdit: () => {
      if (!sheet.isOpen()) return;
      const setup = sheet.snapshot();
      const [path] = location.hash.slice(1).split('?');
      const [route, id] = path.split('/');
      if (route !== 'klubb' && !modeOfRoute(route)) return;
      const currentClub = route === 'klubb' ? decodeURIComponent(id || '') : clubIdFor(decodeURIComponent(id || ''));
      if (currentClub && currentClub !== clubIdFor(setup.slug)) return;
      const nextHash = `#${clubRoute(setup.slug, setup.mode, setup)}`;
      history.replaceState({ ...history.state, setup }, '', nextHash);
      const shown = courses.find(c => c.slug === setup.slug);
      if (shown) document.title = `${layoutLabel(shown)} · ${TITLES[setup.mode]}`;
    },
  });

  /* Persistent mobile 3-tab bottom bar (Klubbar · Statistik · Profil) */
  const tabBar = document.createElement('nav');
  tabBar.id = 'hubTabBar';
  tabBar.className = 'hub-tabbar';
  tabBar.setAttribute('aria-label', 'Snabbnavigering');
  tabBar.innerHTML = `
    <a class="htb-item" href="#" data-tab="home">${TAB_ICONS.home}<span>Klubbar</span></a>
    <a class="htb-item" href="#statistik" data-tab="stats">${TAB_ICONS.stats}<span>Statistik</span></a>
    <a class="htb-item" href="#installningar" data-tab="settings">${TAB_ICONS.settings}<span>Profil</span></a>`;
  document.body.append(tabBar);
  tabBar.addEventListener('click', e => {
    const link = e.target.closest('[data-tab]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const t = link.dataset.tab;
    if (t === 'home') openHome();
    else if (t === 'stats') go('statistik');
    else if (t === 'settings') go('installningar');
  });

  function syncTabBar(key, dialogOpen) {
    tabBar.hidden = Boolean(dialogOpen);
    for (const a of tabBar.querySelectorAll('[data-tab]')) {
      a.setAttribute('aria-current', a.dataset.tab === key ? 'page' : 'false');
    }
  }

  const patchHistory = patch => {
    const previous = history.state;
    if (Object.keys(patch).every(key => JSON.stringify(previous?.[key]) === JSON.stringify(patch[key]))) return;
    history.replaceState({ ...previous, ...patch }, '');
  };
  const nav = window.navigation;
  if (typeof history.state?.hubFrom !== 'string' && previousCourseEntry({
    href: location.href, referrer: document.referrer, historyLength: history.length,
    previousUrl: nav?.currentEntry ? nav.entries().find(entry => entry.index === nav.currentEntry.index - 1)?.url ?? null : undefined,
  })) patchHistory({ hubFrom: document.referrer });

  let current = null, settings = null, stats = null, sequence = 0, cleanBag = false;
  let displayedHash = null;
  const routeUrl = route => route ? '#' + route : location.pathname + location.search;

  function rememberScreen() {
    if (!current) return;
    const active = document.activeElement;
    const focusId = active?.id;
    const state = { scroll: current.scrollTop, focusId: focusId || null };
    if (current === stats) state.stats = stats.snapshot();
    if (sheet.isOpen()) state.setup = sheet.snapshot();
    patchHistory(state);
  }
  function keepPlace(screen) {
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
    const from = location.hash;
    history.pushState({ hubFrom: from, ...extra }, '', routeUrl(route));
    show();
  }
  const openClub = (id, mode) => go(`klubb/${encodeURIComponent(id)}${MODES[mode] ? `?lage=${MODES[mode].route}` : ''}`, { overHome: true });
  const openCourse = (slug, mode) => go(clubRoute(slug, mode), { overHome: current === home });

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
      onMode: mode => {
        writeText(storage(), LAST_MODE_KEY, mode);
        home.querySelector('[data-club-query]')?.focus();
      },
      onSettings: () => go('installningar'),
      onAccount: () => go('installningar/konto'),
      onStats: () => go('statistik'),
      onPlan: openCourse,
      onNearby: id => openClub(id, 'map'),
      onClub: (id, mode) => openClub(id, mode),
      onLayout: (slug, mode) => openCourse(slug, mode),
      onResume: (slug, mode, plan = null) => {
        const course = courses.find(c => c.slug === slug);
        launch(slug, mode, mode === 'detailed' && course ? { tee: savedTee(storage(), course) } : plan);
      },
    });
    keepPlace(home);
    document.body.append(home);
    return home;
  }

  const getSettings = async () => {
    if (settings) return settings;
    const { buildSettings } = await import('./shell/settings-page.js');
    if (settings) return settings;
    settings = buildSettings({
      courses, onBack: back,
      onSection: section => { if (location.hash === '#installningar/' + section) settings.focusSection(section); else go('installningar/' + section); },
      onBag: () => go('installningar/bag', { bagDraft: history.state?.bagDraft, bagOwner: history.state?.bagOwner }),
      onBagDraft: draft => { if (location.hash === '#installningar/bag') patchHistory({ bagDraft: draft, bagOwner: getCloudState().user?.id ?? null }); },
      onBagClosed: () => {
        if (location.hash === '#installningar/bag') { patchHistory({ bagDraft: null }); cleanBag = true; back(); }
      },
    });
    settings.hidden = true;
    keepPlace(settings);
    document.body.append(settings);
    return settings;
  };

  const getStats = async () => {
    if (stats) return stats;
    const { buildStats } = await import('./shell/stats-page.js');
    if (stats) return stats;
    stats = buildStats({
      courses, onBack: back, onPlay: () => openHome(), onCourse: slug => openCourse(slug, 'map'),
      onLeaveExample: () => go('statistik'),
      onRound: (course, id, example) => {
        const path = `statistik/${encodeURIComponent(course)}/${encodeURIComponent(id)}${example ? '?exempel=1' : ''}`;
        if (location.hash === '#' + path) stats.revealCourse();
        else go(path);
      },
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
      (screen.querySelector('.set-top, .hub-top') ?? screen.firstElementChild)?.after(notice);
    }
  }

  function resolveClubSlug(clubId, mode) {
    const club = groupCourses(courses).find(group => group.id === clubId);
    if (!club) return null;
    const layouts = clubLayouts(club.courses, club.cover.slug).filter(c => mode === 'detailed' || c.status !== 'mapping');
    const lastPlayed = readText(storage(), LAST_COURSE_KEY, null);
    return preferredLayout(layouts, {
      sessions: courseSessions(storage(), layouts).filter(session => session.mode === mode),
      remembered: readText(storage(), `${CLUB_LAYOUT_KEY}:${club.id}`, null) ?? lastPlayed,
    });
  }

  async function show() {
    const version = ++sequence;
    const entry = history.state ?? {};
    const hash = location.hash;
    const [path, search] = hash.replace(/^#\/?/, '').split('?');
    const [route, detail = '', third = ''] = path.split('/');
    const query = new URLSearchParams(search);

    /* Legacy route resolution: #3d, #karta, #spela and #<mode>/<slug> resolve seamlessly
       into the Unified Lobby (#) or Club View (#klubb/<id>?bana=<slug>&lage=<mode>). */
    const legacyMode = modeOfRoute(route);
    if (legacyMode) {
      await catalogueReady;
      if (version !== sequence) return;
      writeText(storage(), LAST_MODE_KEY, legacyMode);
      if (detail === 'klubb' && third) {
        const clubId = decodeURIComponent(third);
        const slug = resolveClubSlug(clubId, legacyMode);
        const next = slug ? `#${clubRoute(slug, legacyMode, {
          hole: query.has('hal') ? Number(query.get('hal')) : 1,
          tee: query.has('tee') ? Number(query.get('tee')) - 1 : null,
          guideHole: query.has('guide') ? Number(query.get('guide')) : null,
        })}` : routeUrl('');
        history.replaceState(entry, '', next);
        return show();
      }
      if (detail && courses.some(c => c.slug === decodeURIComponent(detail))) {
        const slug = decodeURIComponent(detail);
        const next = `#${clubRoute(slug, legacyMode, {
          hole: query.has('hal') ? Number(query.get('hal')) : 1,
          tee: query.has('tee') ? Number(query.get('tee')) - 1 : null,
          guideHole: query.has('guide') ? Number(query.get('guide')) : null,
        })}`;
        history.replaceState(entry, '', next);
        return show();
      }
      history.replaceState(entry, '', routeUrl(''));
      return show();
    }

    const isClubRoute = route === 'klubb' && Boolean(detail);
    const key = PAGES[route] || 'home';
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
    if (isClubRoute || (key === 'stats' && query.get('exempel') === '1')) await catalogueReady;
    if (version !== sequence) return;

    const screen = key === 'settings' ? await getSettings()
      : key === 'stats' ? await getStats()
      : getHome();
    if (version !== sequence) return;

    const course = key === 'stats' && detail ? detail : null;
    if (key === 'stats') {
      const example = query.get('exempel') === '1';
      if ((course || example) && !statsView) screen.showCourse(course || 'all', third || null, example);
      else screen.restore(statsView ?? null);
    } else if (key === 'home') {
      screen.refresh?.();
    }
    if (key === 'settings') screen.selectSection(toBag ? 'spelare' : detail);

    const swap = () => {
      if (version !== sequence) return;
      for (const other of [home, settings, stats]) if (other && other !== screen) other.hidden = true;
      screen.hidden = false;
      screen.classList.remove('leaving');
      if (current !== screen) screen.scrollTop = 0;
      current = screen;
    };
    const first = !document.documentElement.classList.contains('hub-ready');
    if (!first && !REDUCED && document.startViewTransition && current !== screen) {
      document.documentElement.dataset.hubTo = key;
      const transition = document.startViewTransition(swap);
      transition.ready.catch(() => {});
      await transition.updateCallbackDone.catch(() => {});
    } else swap();
    if (version !== sequence) return;
    document.title = TITLES[key];
    document.documentElement.classList.add('hub-ready');
    if (!first && !isClubRoute) (screen.querySelector('h1[tabindex]') || screen.querySelector('h1'))?.focus({ preventScroll: true });
    if (Number.isFinite(entry.scroll) && !toBag) screen.scrollTop = entry.scroll;
    if (version !== sequence) return;

    let dialogOpen = false;
    if (isClubRoute) {
      const clubId = decodeURIComponent(detail);
      const queryMode = modeOfRoute(query.get('lage') || '') || (MODES[query.get('lage')] ? query.get('lage') : null);
      const mode = queryMode || entry.setup?.mode || preferredMode();
      const requestedSlug = query.get('bana');
      const slug = (requestedSlug && courses.some(c => c.slug === requestedSlug))
        ? requestedSlug
        : resolveClubSlug(clubId, mode);
      if (slug) {
        const nextHash = `#${clubRoute(slug, mode, {
          hole: query.has('hal') ? Number(query.get('hal')) : entry.setup?.hole ?? 1,
          tee: query.has('tee') ? Number(query.get('tee')) - 1 : entry.setup?.tee ?? null,
          guideHole: query.has('guide') ? Number(query.get('guide')) : entry.setup?.guideHole ?? null,
          tab: query.get('tab') || entry.setup?.tab || null,
        })}`;
        if (location.hash !== nextHash) history.replaceState(entry, '', nextHash);
        sheet.open(slug, mode, {
          ...entry.setup,
          mode,
          hole: query.has('hal') ? Number(query.get('hal')) : entry.setup?.hole,
          guideHole: query.has('guide') ? Number(query.get('guide')) : entry.setup?.guideHole,
          tee: query.has('tee') ? Number(query.get('tee')) - 1 : entry.setup?.tee,
          tab: query.get('tab') || entry.setup?.tab,
        });
        dialogOpen = true;
        const shown = courses.find(c => c.slug === slug);
        if (shown) document.title = `${layoutLabel(shown)} · ${TITLES[mode]}`;
      }
    } else if (toBag) {
      dialogOpen = true;
      screen.focusSection?.('set-player');
      await settings.openBag(entry.bagOwner === (getCloudState().user?.id ?? null) ? entry.bagDraft : null);
      if (version !== sequence) settings.leaveBag();
    } else if (closingFilters) {
      document.getElementById('statsFilters')?.focus({ preventScroll: true });
    } else if (entry.focusId) {
      screen.querySelector('#' + CSS.escape(entry.focusId))?.focus({ preventScroll: true });
    } else if (fromBag && key === 'settings') {
      screen.querySelector('[data-bag-edit]')?.focus({ preventScroll: true });
    }

    syncTabBar(key, dialogOpen);
    displayedHash = location.hash;
    if (course && !statsView) screen.revealCourse();
    if (key === 'stats') screen.setFiltersOpen(filterOpen);
    if (key === 'settings' && detail && !toBag && !Number.isFinite(entry.scroll)) screen.focusSection(detail);
    catalogueNotice(screen);
  }

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
      stats.restore(stats.snapshot());
      if (course && history.state?.stats?.owner !== (getCloudState().user?.id ?? null)) stats.revealCourse();
    }
    if (current === settings && settings) settings.refresh();
    if (current === home && home) home.refresh();
    if (current) catalogueNotice(current);
  });
  await recoveredSessions;
  initCloud();

  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || current === home) return;
    if (document.querySelector('dialog[open]')) return;
    back();
  });

  await show();
  if (bar) bar.style.width = '100%';
  if (message) message.textContent = 'klar';
  requestAnimationFrame(() => { boot?.classList.add('done'); boot?.setAttribute('aria-hidden', 'true'); });
} catch (error) {
  if (message) message.textContent = `kunde inte ladda banorna: ${error.message}`;
}
