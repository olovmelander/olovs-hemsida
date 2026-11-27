/* Club catalogue shared by the start menu and the in-course chooser. */
import '../styles/shell.css';
import { CLUB_LAYOUT_KEY, clubIdFor, clubLayouts, groupCourses, layoutLabel, preferredLayout } from './course-clubs.mjs';
import { sortClubs } from './club-sort.mjs';
import { createPanelHistory } from '../ui/panel-history.mjs';
import { ICONS } from './icons.js';
import { isPhone } from './map-default.mjs';
import { hubUrl } from './router.js';
import { COURSE_PREVIEWS } from '../course-previews.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { distanceText } from './nearest-course.mjs';
import { CATEGORIES, COURSE_LINES, courseSearchKey, layoutMatches, parseQuery, searchText } from './club-search.mjs';
import { LAST_COURSE_KEY, MODES, launchUrl, courseSessions, sessionBadge, sessionPosition, readSettings, readText, rememberLaunch, writeText } from './settings-store.mjs';

const SORT_KEY = 'banvy-club-sort-v1';

const comparableName = name => searchText(name).replace(/\b(golfklubb|golf club|gk|gc)\b/g, '').replace(/[^a-z0-9]/g, '');

/* the course page (course-sheet.js) tells the same story under its posters */
export { COURSE_LINES };

/* The resting poster. The first cards are what the visitor sees before anything
   can run, so theirs is in the markup; the rest carry it as data and are painted
   as they come near the screen (see "card posters" below). */
const EAGER_POSTERS = 6;
const posterAttr = (c, index) => {
  if (!c.photos && !c.overviewUrl) return '';
  const url = `${import.meta.env.BASE_URL}${c.photos ? `courses/${c.slug}/hero-1.webp` : c.overviewUrl}`;
  return index < EAGER_POSTERS ? `style="background-image: url('${url}')"` : `data-bg="${url}"`;
};

/* The player and start menu share the last-opened course. */
export function lastCourse() {
  try { return localStorage.getItem(LAST_COURSE_KEY); } catch { return null; }
}
const storage = () => { try { return localStorage; } catch { return null; } };

const MODE_ICON = {
  detailed: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20.5c3.2-1.6 10.8-1.6 14 0"/><path d="M15.5 3.5v13"/><path d="M15.5 3.8l4.6 1.9-4.6 1.9"/><circle cx="8.5" cy="16.6" r="1.6"/></svg>',
};
const MODE_SUB = { detailed: 'Full grafik · hemma', map: 'GPS · på banan', play: 'Som ett golfspel' };

/* `context` is where the list lives: 'hub', the start menu's own page, or
   'player', the glass over a running course (main.js). `mode` is which way the
   cards open, and setMode() changes it in place. */
export function buildRail({ courses, current, last = null, onPick, onPickClub, isInitialBoot = false,
  context = 'player', mode: initialMode = 'detailed', onModeChange = null, onHome = null, onSettings = null }) {
  const phone = isPhone();
  let mode = MODES[initialMode] ? initialMode : 'detailed';
  courses = [...courses, ...COURSE_PREVIEWS.filter(p => !courses.some(c => c.slug === p.slug))];
  /* A named course is a chosen course, and the player is the detailed one. A
     bare visit to the player boots the manifest's first entry, which nobody
     chose, so that one is not remembered. */
  if (current && !isInitialBoot) rememberLaunch(storage(), current, 'detailed');
  let sessions = courseSessions(storage(), courses);

  const el = document.createElement('div');
  el.id = 'chooser';
  el.setAttribute('role', context === 'hub' ? 'main' : 'dialog');
  if (context !== 'hub') el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Välj klubb');

  const currentCourse = courses.find(c => c.slug === current);
  const leadSlug = [current, last].find(s => s && courses.some(c => c.slug === s)) || null;
  const clubs = groupCourses(courses);
  const leadClub = leadSlug && clubIdFor(leadSlug);
  const preference = readText(storage(), SORT_KEY);
  let sortOrder = preference === 'recent' && leadSlug ? 'recent' : 'name';
  const ordered = sortClubs(clubs, sortOrder, { recentSlug: leadSlug });
  const groupsById = new Map(clubs.map(group => [group.id, group]));
  const searchKeys = new Map(courses.map(course => [course.slug, courseSearchKey(course)]));
  const available = c => c.status !== 'mapping' || mode === 'detailed';
  const category = c => CATEGORIES[c.slug]?.id || 'all';
  const nCat = id => clubs.filter(group => group.courses.some(c => available(c) && (category(c) === id || id === 'all'))).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const totalText = (n, k) => `${plural(n, 'klubb', 'klubbar')} · ${plural(k, 'bana', 'banor')}`;
  const back = context === 'hub'
    ? `<button class="chooser-back" type="button" id="chooserBack" aria-label="Till startmenyn">${ICONS.chevronLeft(20, 2.4)}</button>`
    : `<a class="chooser-back" id="chooserBack" href="${hubUrl()}" aria-label="Startmenyn" title="Startmenyn">${ICONS.chevronLeft(20, 2.4)}</a>`;

  const filterBtn = (id, long, short, n, icon = '') => `
    <button class="c-filter-btn${id === 'all' ? ' active' : ''}" type="button" data-filter="${id}" aria-pressed="${id === 'all'}">
      ${icon}<span class="cf-long">${long}</span><span class="cf-short">${short}</span><span class="cf-n">${n}</span>
    </button>`;

  el.innerHTML = `
    <div class="chooser-scrim" aria-hidden="true"></div>
    <div class="chooser-inner">
      <div class="chooser-top-bar">
        <div class="chooser-brand">
          ${back}
          <div class="brand-crest">
            <span class="crest-dot"></span>
            <span class="wordmark">Ban<i>v</i>y</span>
          </div>
        </div>

        <div class="chooser-view-toggle" id="chooserViewToggle" role="group" aria-label="Klubbvisning">
          <button class="c-view-btn active" type="button" data-view="grid" id="viewGridBtn" title="Visa som kort" aria-controls="cardsViewWrap" aria-pressed="true">
            ${ICONS.gridCards(15)}
            <span class="cv-long">Kortvy</span><span class="cv-short">Kort</span>
          </button>
          <button class="c-view-btn" type="button" data-view="map" id="viewMapBtn" title="Visa på Sverigekarta" aria-controls="mapViewWrap" aria-pressed="false">
            ${ICONS.map(15)}
            <span class="cv-long">Sverigekarta</span><span class="cv-short">Karta</span>
          </button>
        </div>

        <div class="chooser-top-actions">
          ${context === 'hub' ? `
            <button class="chooser-settings" type="button" id="chooserSettings" aria-label="Inställningar" title="Inställningar">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>
            </button>` : ''}
          ${!isInitialBoot && currentCourse ? `
            <button class="chooser-resume-btn" type="button" id="chooserResumeBtn"
                    aria-label="Återgå till ${esc(currentCourse.name)}" title="Återgå till ${esc(currentCourse.name)} (Esc)">
              <span>Återgå till ${esc(currentCourse.name)}</span>
              ${ICONS.close(16)}
            </button>
          ` : ''}
        </div>
      </div>

      <div class="chooser-head">
        <div class="chooser-head-row">
          <h1 class="chooser-main-title" tabindex="-1">Välj klubb</h1>
          <button id="chooserModeToggle" type="button" aria-controls="chooserModes" aria-expanded="false"><span data-mode-name>${MODES[mode].label}</span><span>Ändra</span></button>
          <div class="chooser-modes" id="chooserModes" hidden role="radiogroup" aria-label="Spela i">
            ${Object.entries(MODES).map(([key, m]) => `
              <button class="c-mode-btn" type="button" role="radio" data-mode="${key}" tabindex="${key === mode ? 0 : -1}" aria-checked="${key === mode}">
                <span class="cm-icon">${MODE_ICON[key]}</span>
                <span class="cm-text"><b>${m.label}</b><small>${MODE_SUB[key]}</small></span>
              </button>`).join('')}
          </div>
        </div>

      </div>

      <div class="chooser-controls" id="chooserControls">
        <div class="chooser-search-box">
          ${ICONS.search(16)}
          <input type="search" id="courseSearchInput" placeholder="Sök klubbar"
                 aria-label="Sök klubbar efter namn, bana, ort eller par" autocomplete="off" autocapitalize="off"
                 spellcheck="false" enterkeyhint="search" />
          <kbd class="search-key" aria-hidden="true">/</kbd>
          <button class="search-clear" type="button" id="courseSearchClear" aria-label="Rensa sökningen" hidden>${ICONS.close(14)}</button>
        </div>

        <div class="chooser-sort">
          <label for="chooserSort">Sortera</label>
          <select id="chooserSort">
            <option value="name">Klubbnamn A–Ö</option>
            <option value="distance">Närmast mig</option>
            <option value="recent"${leadSlug ? '' : ' disabled'}>Senast öppnad</option>
          </select>
        </div>
        <div class="chooser-filters" id="chooserFilters" role="group" aria-label="Filtrera på bantyp">
          ${filterBtn('all', 'Alla klubbar', 'Alla', clubs.length)}
          ${filterBtn('kust', 'Kust & Hav', 'Kust', nCat('kust'), ICONS.wave(13))}
          ${filterBtn('skog', 'Skog & Park', 'Skog', nCat('skog'), ICONS.tree(13))}
          ${filterBtn('slott', 'Slott & Herrgård', 'Slott', nCat('slott'), ICONS.castle(13))}
        </div>
        <span class="chooser-count" id="chooserCount" role="status" aria-live="polite"></span>
      </div>
      <div class="chooser-sort-feedback">
        <span class="chooser-sort-status" id="chooserSortStatus" role="status"></span>
        <button class="chooser-sort-retry" type="button" id="chooserSortRetry" hidden>Försök igen</button>
      </div>

      <div class="chooser-scroll" id="chooserScroll">
        <!-- Grid Cards View -->
        <div id="cardsViewWrap" class="cards-view-wrap">
          <ul class="cards" id="coursesCardList">
            ${ordered.map(({ club: group }, index) => {
              const c = group.cover;
              const place = COURSE_LOCATIONS[c.slug]?.city || c.boot;
              return `<li class="card-item" data-slug="${esc(c.slug)}" data-club-id="${esc(group.id)}">
                <button class="card club-card" type="button" data-slug="${esc(c.slug)}" data-club-id="${esc(group.id)}">
                  <span class="shot" ${posterAttr(c, index)} aria-hidden="true"></span>
                  <span class="club-info"><span class="club-place">${esc(place)} <span class="is-near" title="Avstånd fågelvägen till klubben" hidden></span></span>
                    <strong class="club-name">${esc(group.name)}</strong>
                    <span class="club-layouts" data-layout-names></span>
                    <span class="club-foot"><span data-layout-count></span><span class="club-arrow" aria-hidden="true">${ICONS.chevronRight(16)}</span></span>
                    <small class="club-state" hidden></small>
                  </span>
                </button>
              </li>`;
            }).join('')}
          </ul>
          <div id="noCoursesMsg" class="no-courses-msg" hidden>
            <p>Inga klubbar matchar din sökning.</p>
            <button type="button" id="resetSearchBtn">Visa alla klubbar</button>
          </div>
        </div>

        <!-- Sweden Map View Wrap -->
        <div id="mapViewWrap" class="map-view-wrap" hidden></div>
      </div>
    </div>
  `;

  // Search and Filter Logic
  const searchInput = el.querySelector('#courseSearchInput');
  const searchClear = el.querySelector('#courseSearchClear');
  const filterBtns = el.querySelectorAll('.c-filter-btn');
  const cardList = el.querySelector('#coursesCardList');
  const cardItems = new Map([...cardList.children].map(item => [item.dataset.clubId, item]));
  const noMsg = el.querySelector('#noCoursesMsg');
  const resetBtn = el.querySelector('#resetSearchBtn');
  const countEl = el.querySelector('#chooserCount');
  const controls = el.querySelector('#chooserControls');
  const filtersEl = el.querySelector('#chooserFilters');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let swedenMapInstance = null, mapVersion = 0, mapKey = '';
  let activeFilter = 'all';
  let activeQuery = '';

  const matches = new Map();
  function applyFilters() {
    matches.clear();
    let layoutCount = 0;
    // Match all words on one layout (club-search.mjs, shared with the start menu).
    const query = parseQuery(activeQuery);
    cardItems.forEach(item => {
      const group = groupsById.get(item.dataset.clubId);
      const layouts = group.courses.filter(c => available(c) && (activeFilter === 'all' || category(c) === activeFilter)
        && layoutMatches(c, searchKeys.get(c.slug), query));
      item.hidden = !layouts.length;
      if (!layouts.length) return;
      layoutCount += layouts.length;
      const orderedLayouts = clubLayouts(layouts, group.cover.slug);
      const sortedLayouts = sortOrder === 'recent' && leadSlug && orderedLayouts.some(c => c.slug === leadSlug)
        ? [orderedLayouts.find(c => c.slug === leadSlug), ...orderedLayouts.filter(c => c.slug !== leadSlug)]
        : orderedLayouts;
      matches.set(group.id, sortedLayouts);
      const active = sessions.filter(session => session.mode === mode && layouts.some(c => c.slug === session.course.slug));
      const recent = layouts.find(c => c.slug === leadSlug);
      const badge = item.querySelector('.club-state');
      badge.textContent = active.length
        ? active.map(s => [sessionBadge(s), layoutLabel(s.course), sessionPosition(s)].filter(Boolean).join(' · ')).join(' / ')
        : recent ? `${current ? 'Aktiv bana' : 'Senast öppnad'} · ${layoutLabel(recent)}` : '';
      badge.hidden = !badge.textContent;
      const names = item.querySelector('[data-layout-names]');
      const facts = item.querySelector('[data-layout-count]');
      const single = layouts.length === 1 && group.courses.length === 1;
      const singleName = layoutLabel(layouts[0]);
      const repeatedName = single && comparableName(singleName) === comparableName(group.name);
      names.hidden = repeatedName;
      names.textContent = sortedLayouts.map(layoutLabel).join(' · ');
      facts.textContent = single ? `${layouts[0].holes} hål · Par ${layouts[0].par}`
        : layouts.length < group.courses.length ? `${layouts.length} av ${group.courses.length} banor`
        : plural(layouts.length, 'bana', 'banor');
    });
    filterBtns.forEach(btn => { btn.querySelector('.cf-n').textContent = nCat(btn.dataset.filter); });
    noMsg.hidden = matches.size > 0;
    countEl.textContent = totalText(matches.size, layoutCount);
    /* An active query keeps the search field pinned beside the chips (see
       shell.css): a list narrowed by words you can no longer see is a list
       that looks broken. */
    controls.classList.toggle('has-query', !!activeQuery);
    searchClear.hidden = !activeQuery;
    if (el.classList.contains('map-mode')) switchView('map');
  }

  const sortSelect = el.querySelector('#chooserSort');
  const sortStatus = el.querySelector('#chooserSortStatus');
  const sortRetry = el.querySelector('#chooserSortRetry');
  sortSelect.value = sortOrder;
  // Ignore a late GPS fix or permission lookup once the golfer chooses another order.
  let sortRequest = 0;
  function sortFeedback(message = '', retry = false) {
    sortStatus.textContent = message;
    sortRetry.hidden = !retry;
  }
  function applySort(order, rows, remember) {
    sortOrder = order;
    sortSelect.value = order;
    if (remember) writeText(storage(), SORT_KEY, order);
    const focused = cardList.contains(document.activeElement) ? document.activeElement : null;
    for (const { club, metres } of rows) {
      const item = cardItems.get(club.id);
      const badge = item.querySelector('.is-near');
      badge.hidden = metres === null;
      badge.textContent = metres === null ? '' : distanceText(metres);
      cardList.append(item);
    }
    focused?.focus({ preventScroll: true });
    applyFilters();
  }

  function locate(remember) {
    const request = ++sortRequest;
    const failed = code => {
      if (request !== sortRequest) return;
      sortSelect.value = sortOrder;
      const message = code === 1 ? 'Tillåt platsåtkomst i webbläsaren för att sortera efter avstånd.'
        : code === 3 ? 'Det tog för lång tid att hitta din position.'
        : 'Din position är inte tillgänglig.';
      sortFeedback(message, true);
    };
    if (!navigator.geolocation) { failed(); return; }
    sortSelect.value = 'distance';
    sortFeedback('Hämtar din position…');
    try {
      navigator.geolocation.getCurrentPosition(async position => {
        if (request !== sortRequest) return;
        const rows = sortClubs(clubs, 'distance', { coords: position.coords });
        const nearest = rows.find(({ metres }) => metres !== null);
        if (!nearest) { failed(); return; }
        const focusMap = remember && el.classList.contains('map-mode');
        applySort('distance', rows, remember);
        sortFeedback();
        if (focusMap) {
          await switchView('map');
          const visible = rows.find(({ club, metres }) => metres !== null && matches.has(club.id));
          if (visible && request === sortRequest && el.classList.contains('map-mode') && !el.hidden) {
            swedenMapInstance?.focusClub(visible.club.id, true);
          }
        }
      }, error => failed(error.code), { timeout: 12000, maximumAge: 120000 });
    } catch { failed(); }
  }

  sortSelect.addEventListener('change', () => {
    if (sortSelect.value === 'distance') { locate(true); return; }
    ++sortRequest;
    sortFeedback();
    const order = sortSelect.value;
    applySort(order, sortClubs(clubs, order, { recentSlug: leadSlug }), true);
    revealResults();
  });
  sortRetry.addEventListener('click', () => { sortSelect.focus(); locate(true); });

  async function restoreDistance() {
    if (sortRequest || preference === 'name' || preference === 'recent') return;
    let permission;
    try { permission = (await navigator.permissions?.query({ name: 'geolocation' }))?.state; }
    catch { /* Some browsers only support asking from the select. */ }
    if (sortRequest) return;
    if (permission === 'granted') locate(false);
    else if (preference === 'distance') sortFeedback('Platsåtkomst behövs för att visa närmaste klubb.', true);
  }
  if (context === 'hub') restoreDistance();
  else el.addEventListener('focusin', restoreDistance, { once: true });

  /* How much of the bar stays on screen once it is pinned. On a phone its `top`
     is negative, so the search row slides out and only the chips stay (see
     shell.css); read from the computed style so this never restates that. */
  const listEl = el.querySelector('#chooserScroll');
  const stickyTop = () => parseFloat(getComputedStyle(controls).top) || 0;

  /* Narrowing the list from the pinned bar, half way down it, must not leave the
     visitor looking at the empty space below a list that just got shorter. */
  function revealResults() {
    const top = listEl.offsetTop - (controls.offsetHeight + stickyTop());
    if (el.scrollTop > top) el.scrollTo({ top: Math.max(0, top), behavior: REDUCED ? 'auto' : 'smooth' });
  }

  function setFilter(id) {
    activeFilter = id;
    filterBtns.forEach(b => {
      const on = b.dataset.filter === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    applyFilters();
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => { setFilter(btn.dataset.filter); revealResults(); });
  });

  const clearSearch = () => {
    searchInput.value = '';
    activeQuery = '';
    applyFilters();
  };

  searchInput.addEventListener('input', e => {
    activeQuery = searchText(e.target.value);
    applyFilters();
  });
  /* Escape empties the field first and only closes the chooser once there is
     nothing left to empty -- the way every search box behaves. Enter puts the
     keyboard away on a phone so the results are what is on screen. */
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchInput.value) { e.stopPropagation(); clearSearch(); }
    if (e.key === 'Enter') searchInput.blur();
  });
  searchClear.addEventListener('click', () => { clearSearch(); searchInput.focus(); });
  resetBtn.addEventListener('click', () => { clearSearch(); setFilter('all'); });

  /* "/" reaches the search from anywhere, the desktop convention. Only while
     the chooser is actually the thing on screen, and never out of a field. */
  addEventListener('keydown', e => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (el.hidden || !el.isConnected || document.querySelector('dialog[open]')) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  });

  /* The bar turns to glass only once it is actually pinned. Paint-only, so
     nothing moves when it flips. Pinned means it sits at its own sticky `top`,
     which is not zero on a phone or under a notch -- hence measured, and not an
     IntersectionObserver against the viewport's edge. */
  let stuckFrame = 0;
  const markStuck = () => {
    stuckFrame = 0;
    const y = controls.getBoundingClientRect().top - el.getBoundingClientRect().top;
    controls.classList.toggle('is-stuck', el.scrollTop > 0 && y <= stickyTop() + 0.5);
  };
  el.addEventListener('scroll', () => { if (!stuckFrame) stuckFrame = requestAnimationFrame(markStuck); }, { passive: true });

  /* The chips fit on every phone measured (320 px and up), but a larger text
     size or a future fifth chip makes them a scroller -- and a scroller with no
     sign of more is how the fourth chip went missing before. The fade appears
     only when there is something under it. */
  const markOverflow = () => {
    const more = filtersEl.scrollWidth - filtersEl.clientWidth > 1;
    filtersEl.classList.toggle('is-scrollable', more);
    filtersEl.classList.toggle('at-end', !more || filtersEl.scrollLeft + filtersEl.clientWidth >= filtersEl.scrollWidth - 1);
  };
  filtersEl.addEventListener('scroll', markOverflow, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(markOverflow).observe(filtersEl);

  applyFilters();

  // The hub keeps its hash routes. Player panels open #courseSheet directly
  // (no legacy #clubPicker 3-modal stack) so switching Stadium <-> Castle stays inline.
  let sheet = null, playerSequence = 0;
  function launchFromPlayer(slug, next, plan) {
    rememberLaunch(storage(), slug, next);
    writeText(storage(), `${CLUB_LAYOUT_KEY}:${clubIdFor(slug)}`, slug);
    const params = new URLSearchParams(launchUrl(slug, next, { phone, settings: readSettings(storage()), plan }).slice(1));
    const from = new URLSearchParams(location.search);
    for (const key of ['det', 'hero', 'q', 'gl']) if (from.has(key) && !params.has(key)) params.set(key, from.get(key));
    location.search = `?${params}`;
  }
  const panels = context !== 'hub' && createPanelHistory({ history, key: 'banvyCatalogue', course: current,
    async render(path, previous) {
      const version = ++playerSequence;
      const panel = path.at(-1);
      sheet?.close();
      if (!panel) {
        const origin = previous[0];
        if (origin) el.focusCourse(origin.id || origin.slug);
        return;
      }
      if (mode !== panel.mode) setMode(panel.mode);
      if (el.hidden) {
        // Re-enter via the existing player control so its HUD and Escape state agree.
        document.getElementById('bytBtn')?.click();
        await el.restore(panel.chooser);
        if (version !== playerSequence) return;
      }
      if (!sheet) {
        try {
          const { createCourseSheet } = await import('./course-sheet.js');
          if (version !== playerSequence) return;
          sheet = createCourseSheet({
            courses, lines: COURSE_LINES,
            onDismiss: () => panels.back(),
            onLaunch: launchFromPlayer,
            onLayout: slug => writeText(storage(), `${CLUB_LAYOUT_KEY}:${clubIdFor(slug)}`, slug),
            onEdit: () => { if (sheet.isOpen()) panels.update({ setup: sheet.snapshot() }); },
          });
        } catch {
          // A previously visited course can still open if the setup chunk is unavailable offline.
          if (version === playerSequence) launchFromPlayer(panel.slug, panel.mode, panel.setup);
          return;
        }
      }
      sheet.open(panel.slug, panel.mode, panel.setup);
    },
  });
  const pick = slug => {
    if (context === 'hub') return onPick(slug, mode);
    if (slug === current && mode === 'detailed') {
      if (panels.current) panels.close();
      return onPick(slug, mode);
    }
    panels.open({ kind: 'layout', slug, mode, chooser: el.snapshot() });
  };
  if (panels) {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && event.target.closest?.('#courseSheet[open]')) event.stopPropagation();
    });
    addEventListener('popstate', event => panels.restore(event.state));
    if (history.state?.banvyCatalogue) queueMicrotask(() => panels.restore(history.state));
  }
  function pickClub(id) {
    const layouts = matches.get(id);
    if (!layouts?.length) return;
    if (layouts.length === 1) return pick(layouts[0].slug);
    if (context === 'hub') return onPickClub(id, mode);
    const chosen = preferredLayout(layouts, {
      sessions: sessions.filter(session => session.mode === mode),
      remembered: readText(storage(), `${CLUB_LAYOUT_KEY}:${id}`, null) ?? leadSlug,
    });
    pick(chosen || layouts[0].slug);
  }
  el.querySelectorAll('.card').forEach(btn => {
    btn.addEventListener('click', () => pickClub(btn.dataset.clubId));
  });

  const lazyShots = [...el.querySelectorAll('.shot[data-bg]')];
  const paintShot = shot => {
    shot.style.backgroundImage = `url('${shot.dataset.bg}')`;
    shot.removeAttribute('data-bg');
  };
  if ('IntersectionObserver' in window) {
    const bgIo = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { paintShot(e.target); bgIo.unobserve(e.target); }
    }, { root: el, rootMargin: '500px 0px' });
    lazyShots.forEach(shot => bgIo.observe(shot));
  } else lazyShots.forEach(paintShot);

  // Map View Initialization
  const cardsWrap = el.querySelector('#cardsViewWrap');
  const mapWrap = el.querySelector('#mapViewWrap');
  const viewGridBtn = el.querySelector('#viewGridBtn');
  const viewMapBtn = el.querySelector('#viewMapBtn');

  async function switchView(viewMode) {
    const map = viewMode === 'map';
    viewGridBtn.classList.toggle('active', !map);
    viewMapBtn.classList.toggle('active', map);
    viewGridBtn.setAttribute('aria-pressed', String(!map));
    viewMapBtn.setAttribute('aria-pressed', String(map));
    /* map-mode is what lets the map take the whole screen under the brand row
       instead of a fixed slice of it with dead space beneath (shell.css). */
    el.classList.toggle('map-mode', map);
    cardsWrap.hidden = map;
    mapWrap.hidden = !map;
    const version = ++mapVersion;
    if (!map) return;
    el.scrollTop = 0;
    const groups = [...matches].map(([id, layouts]) => ({ ...groupsById.get(id), courses: layouts }));
    const key = mode + ':' + groups.map(group => group.courses.map(c => c.slug).sort().join('/')).join(',');
    if (!swedenMapInstance || mapKey !== key) {
      swedenMapInstance?.map.remove();
      swedenMapInstance?.el.remove();
      swedenMapInstance = null;
      mapWrap.replaceChildren();
      if (!groups.length) {
        const none = document.createElement('p');
        none.textContent = 'Ingen bana matchar din sökning.';
        mapWrap.append(none);
        return;
      }
      mapKey = key;
      const { createSwedenMap } = await import('./map.js');
      if (version !== mapVersion) return;
      swedenMapInstance = createSwedenMap({
        container: mapWrap,
        groups,
        current: current && clubIdFor(current),
        lead: leadClub,
        onPickClub: pickClub,
      });
    }
    swedenMapInstance.invalidateSize();
  }

  viewGridBtn.addEventListener('click', () => switchView('grid'));
  viewMapBtn.addEventListener('click', () => switchView('map'));

  /* ------------------------------------------------------------ the mode */
  const modeBtns = [...el.querySelectorAll('.c-mode-btn')];
  const switcher = el.querySelector('#chooserModes');
  const modeToggle = el.querySelector('#chooserModeToggle');
  const showModes = expanded => {
    switcher.hidden = !expanded;
    modeToggle.setAttribute('aria-expanded', String(expanded));
  };
  modeToggle.addEventListener('click', () => {
    showModes(switcher.hidden);
    if (!switcher.hidden) switcher.querySelector('[aria-checked="true"]')?.focus();
  });
  switcher.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    showModes(false);
    modeToggle.focus();
  });
  function setMode(next) {
    if (!MODES[next]) return;
    mode = next;
    el.dataset.mode = mode;
    modeBtns.forEach(b => {
      const checked = b.dataset.mode === mode;
      b.setAttribute('aria-checked', String(checked));
      b.tabIndex = checked ? 0 : -1;
    });
    modeToggle.querySelector('[data-mode-name]').textContent = MODES[mode].label;
    applyFilters();
  }
  el.dataset.mode = mode;
  modeBtns.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) {
      if (onModeChange) onModeChange(b.dataset.mode); else setMode(b.dataset.mode);
    }
    showModes(false);
    modeToggle.focus();
  }));
  /* the radio group's own keys: an arrow moves the choice, as in any radio group */
  el.querySelector('#chooserModes').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = modeBtns.findIndex(b => b.dataset.mode === mode);
    const next = modeBtns[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? modeBtns.length - 1 : 1)) % modeBtns.length];
    if (onModeChange) onModeChange(next.dataset.mode); else setMode(next.dataset.mode);
    next.focus();
  });
  if (context === 'hub') {
    el.querySelector('#chooserBack')?.addEventListener('click', () => onHome?.());
    el.querySelector('#chooserSettings')?.addEventListener('click', () => onSettings?.());
  }

  el.snapshot = () => ({ query: searchInput.value, filter: activeFilter, view: el.classList.contains('map-mode') ? 'map' : 'grid', map: swedenMapInstance?.snapshot(), scroll: el.scrollTop });
  el.restore = async data => {
    if (!data) return;
    sessions = courseSessions(storage(), courses);
    searchInput.value = data.query ?? '';
    activeQuery = searchText(searchInput.value);
    setFilter([...filterBtns].some(b => b.dataset.filter === data.filter) ? data.filter : 'all');
    await switchView(data.view === 'map' ? 'map' : 'grid');
    if (data.view === 'map' && data.map) swedenMapInstance?.restore(data.map);
    el.scrollTop = Number(data.scroll) || 0;
  };
  el.focusCourse = slug => {
    const id = clubIdFor(slug);
    if (el.classList.contains('map-mode')) swedenMapInstance?.focusClub(id);
    else el.querySelector(`.card[data-club-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  };
  el.setMode = setMode;
  el.getMode = () => mode;
  el.getSort = () => ({ order: sortOrder, recentSlug: leadSlug });
  return el;
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
