import '../styles/hub.css';
import '../styles/shell.css';
import { isPhone } from './map-default.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { LAST_MODE_KEY, MAP_KEYS, MODES, courseSessions, lastLaunch, recentLaunches, sessionBadge, sessionPosition, readText, writeText } from './settings-store.mjs';
import { clubIdFor, clubLayouts, groupCourses, layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { coursesByDistance, distanceText } from './nearest-course.mjs';
import { CATEGORIES } from './club-search.mjs';
import { sortClubs } from './club-sort.mjs';
import { LOBBY_SHORT_LIST, LOBBY_SHORT_LIST_PHONE, catalogueIsLarge, dayText, lobbyClubs, recentCourses, searchClubs } from './lobby-model.mjs';
import { ICONS } from './icons.js';
import { subscribeCloud } from './cloud.mjs';
import { showLiveRounds } from './live-round-panel.mjs';
import { discardLocalRound, dismissLive, localRoundId } from './live-rounds.mjs';
import { MORE_ICON, bindRoundActions, openRoundSheet, removalPending, removeWithUndo, roundsChanged } from './round-actions.mjs';

const NEAR_METRES = 5000;
const SORT_KEY = 'banvy-club-sort-v1';
const BASE = import.meta.env.BASE_URL;
const poster = (slug, n = 1) => `${BASE}courses/${slug}/hero-${n}.webp`;
const backdrop = slug => `${BASE}courses/${slug}/backdrop.webp`;
const thumbnail = slug => `${BASE}courses/${slug}/thumb.webp`;
const DEFAULT_BACKDROP = 'veckefjarden';

const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
const FILTER_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
const INSTALL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>';
const USER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-3.8 3.6-5.6 7-5.6s6 1.8 7 5.6"/></svg>';

const SORT_LABELS = { name: 'A–Ö', distance: 'Närmast', recent: 'Senast' };
const FILTER_LABELS = { all: 'Alla', kust: 'Kust & Hav', skog: 'Skog & Park', slott: 'Slott & Herrgård' };

/* Short label for inline multi-course pills on club cards (e.g. "Stadium", "Castle") */
function pillLabel(course) {
  const full = layoutLabel(course);
  return full.replace(/^The\s+/i, '').replace(/\s+Course$/i, '').trim() || full;
}

export function buildHome({ courses, onMode, onSettings, onAccount = null, onStats, onResume, onPlan = null, onNearby = null, onClub = null, onLayout = null }) {
  const phone = isPhone();
  let playable = [];

  const el = document.createElement('div');
  el.id = 'home';
  el.className = 'hub-screen';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'homeTitle');

  el.innerHTML = `
    <div class="home-backdrop" aria-hidden="true"><i class="home-bg"></i></div>
    <div class="home-inner">
      <header class="hub-top lobby-top">
        <a class="hub-brand" href="#" aria-label="Banvy, klubblobby">
          <span class="crest-dot"></span><span class="wordmark">Ban<i>v</i>y</span>
        </a>

        <div class="lobby-top-search" data-top-search>
          <div class="home-club-search">
            ${ICONS.search(17)}
            <input type="search" id="homeClubQuery" data-club-query placeholder="Sök klubb, bana eller ort"
              aria-label="Sök klubbar efter namn, bana, ort eller par" aria-controls="homeClubList" aria-keyshortcuts="/"
              autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
            <kbd class="lobby-search-key" aria-hidden="true">/</kbd>
            <button class="hcs-clear" type="button" data-club-query-clear aria-label="Töm sökningen" hidden>${ICONS.close(14)}</button>
          </div>
          <button class="lobby-filter-btn" type="button" id="lobbyFilterBtn" aria-expanded="false" aria-haspopup="dialog" aria-controls="lobbyFilterPop" aria-label="Filtrera och sortera">
            ${FILTER_ICON}
            <span class="lobby-filter-text" data-filter-label>Sortera &amp; filter</span>
            <span class="lobby-filter-dot" data-filter-dot hidden aria-hidden="true"></span>
          </button>
        </div>

        <nav class="lobby-top-nav" aria-label="Huvudnavigering">
          <a class="lobby-nav-link" href="#statistik" data-nav="stats">Statistik</a>
          <a class="lobby-nav-link" href="#installningar" data-nav="settings">Inställningar</a>
        </nav>

        <span class="hub-top-actions">
          <button class="hub-icon-btn lobby-map-quick" type="button" data-view-quick aria-pressed="false" aria-label="Visa Sverigekarta">
            ${ICONS.map(16)}<span data-view-quick-label>Karta</span>
          </button>
          <button class="hub-icon-btn hub-install" type="button" data-install hidden>${INSTALL}<span>Installera</span></button>
          <button class="hub-icon-btn hub-account" type="button" data-account hidden></button>
        </span>
      </header>

      <div class="bv-popover lobby-filter-pop" id="lobbyFilterPop" role="dialog" aria-label="Sortera och filtrera klubbar" hidden>
        <div class="lfp-group">
          <p class="lfp-title">Sortera</p>
          <div class="lfp-pills" role="radiogroup" aria-label="Sortering">
            <button type="button" class="lfp-chip" role="radio" data-sort="name" aria-checked="true">Klubbnamn A–Ö</button>
            <button type="button" class="lfp-chip" role="radio" data-sort="distance" aria-checked="false">Närmast mig</button>
            <button type="button" class="lfp-chip" role="radio" data-sort="recent" aria-checked="false">Senast öppnad</button>
          </div>
        </div>
        <div class="lfp-group">
          <p class="lfp-title">Bantyp</p>
          <div class="lfp-pills" role="group" aria-label="Bantyp">
            <button type="button" class="lfp-chip" data-filter="all" aria-pressed="true">Alla</button>
            <button type="button" class="lfp-chip" data-filter="kust" aria-pressed="false">${ICONS.wave(13)} Kust &amp; Hav</button>
            <button type="button" class="lfp-chip" data-filter="skog" aria-pressed="false">${ICONS.tree(13)} Skog &amp; Park</button>
            <button type="button" class="lfp-chip" data-filter="slott" aria-pressed="false">${ICONS.castle(13)} Slott &amp; Herrgård</button>
          </div>
        </div>
        <p class="lfp-status" data-sort-status role="status" hidden></p>
        <div class="lfp-foot">
          <button type="button" class="bv-btn-ghost lfp-retry" data-sort-retry hidden>Försök igen</button>
          <button type="button" class="bv-btn-ghost lfp-reset" data-filter-reset hidden>Återställ</button>
          <button type="button" class="bv-btn-secondary lfp-done" data-filter-done>Klar</button>
        </div>
      </div>

      <h1 class="cs-sr" id="homeTitle" tabindex="-1">Banvy — Golfklubbar i Sverige</h1>

      <div class="home-resume-slot"></div>
      <section class="home-live-transfer" data-live-rounds aria-label="Rundor mellan enheter" hidden></section>

      <section class="home-clubs" aria-labelledby="homeClubsTitle" data-home-clubs>
        <div class="lobby-toolbar">
          <div class="lobby-toolbar-left">
            <h2 id="homeClubsTitle" data-clubs-heading>Klubbar</h2>
            <span class="lobby-count" data-clubs-count role="status" aria-live="polite"></span>
          </div>
          <div class="lobby-toolbar-right">
            <button class="lobby-filter-desktop" type="button" data-filter-trigger aria-expanded="false" aria-haspopup="dialog" aria-controls="lobbyFilterPop">
              ${FILTER_ICON}<span data-filter-summary>Sortera: A–Ö</span>
            </button>
            <div class="bv-seg lobby-view-seg" role="group" aria-label="Klubbvisning">
              <button type="button" id="lobbyViewList" data-lobby-view="list" aria-pressed="true">${ICONS.gridCards(15)}<span>Lista</span></button>
              <button type="button" id="lobbyViewMap" data-lobby-view="map" aria-pressed="false">${ICONS.map(15)}<span>Karta</span></button>
            </div>
          </div>
        </div>

        <p class="home-clubs-note" id="homeClubsNote" data-clubs-note role="status" hidden></p>

        <div id="lobbyListWrap" class="lobby-list-wrap">
          <ul class="home-club-list" id="homeClubList" data-club-list aria-labelledby="homeClubsTitle"></ul>
          <div class="lobby-empty" data-lobby-empty hidden>
            <p>Inga klubbar matchar sökningen eller filtret.</p>
            <button type="button" class="bv-btn-primary" data-empty-reset>Visa alla klubbar</button>
          </div>
          <div class="home-clubs-more" data-clubs-more hidden>
            <button class="home-clubs-near" type="button" data-clubs-near hidden>${PIN}<span data-near-label>Klubbar nära mig</span></button>
            <button class="bv-btn-secondary lobby-show-all" type="button" data-show-all hidden><span data-show-all-label></span></button>
          </div>
        </div>

        <div id="lobbyMapWrap" class="lobby-map-wrap" hidden></div>
      </section>

      <footer class="home-legal">
        <a href="${BASE}integritet.html">Integritetspolicy</a>
        <span aria-hidden="true">·</span>
        <a href="${BASE}villkor.html">Villkor</a>
      </footer>
    </div>`;

  const bg = el.querySelector('.home-bg');
  const resumeSlot = el.querySelector('.home-resume-slot');
  const transfers = showLiveRounds(el.querySelector('[data-live-rounds]'), courses);
  const clubsSection = el.querySelector('[data-home-clubs]');
  const clubsHeading = el.querySelector('[data-clubs-heading]');
  const clubsCount = el.querySelector('[data-clubs-count]');
  const clubList = el.querySelector('[data-club-list]');
  const listWrap = el.querySelector('#lobbyListWrap');
  const mapWrap = el.querySelector('#lobbyMapWrap');
  const emptyBox = el.querySelector('[data-lobby-empty]');
  const queryInput = el.querySelector('[data-club-query]');
  const queryClear = el.querySelector('[data-club-query-clear]');
  const clubsNote = el.querySelector('[data-clubs-note]');
  const clubsMore = el.querySelector('[data-clubs-more]');
  const nearButton = el.querySelector('[data-clubs-near]');
  const nearLabel = el.querySelector('[data-near-label]');
  const showAllBtn = el.querySelector('[data-show-all]');
  const showAllLabel = el.querySelector('[data-show-all-label]');
  const filterBtn = el.querySelector('#lobbyFilterBtn');
  const filterDesktopBtn = el.querySelector('[data-filter-trigger]');
  const filterSummary = el.querySelector('[data-filter-summary]');
  const filterDot = el.querySelector('[data-filter-dot]');
  const filterPop = el.querySelector('#lobbyFilterPop');
  const filterReset = el.querySelector('[data-filter-reset]');
  const sortStatus = el.querySelector('[data-sort-status]');
  const sortRetry = el.querySelector('[data-sort-retry]');
  const viewListBtn = el.querySelector('#lobbyViewList');
  const viewMapBtn = el.querySelector('#lobbyViewMap');
  const viewQuickBtn = el.querySelector('[data-view-quick]');
  const viewQuickLabel = el.querySelector('[data-view-quick-label]');

  const preferredMode = () => {
    const last = readText(storage(), LAST_MODE_KEY, null);
    return MODES[last] ? last : phone ? 'map' : 'detailed';
  };

  let lobby = { clubs: [], sessions: [], recent: [], lastSlug: null };
  let place = null;
  let placeFailed = false;
  let gpsRequestId = 0;
  let shownClubs = '';
  let activeFilter = 'all';
  const savedSort = readText(storage(), SORT_KEY, null);
  let explicitSort = ['name', 'recent', 'distance'].includes(savedSort) ? savedSort : null;
  let sortOrder = explicitSort === 'recent' ? 'recent' : 'name';
  let expandedAll = false;
  let viewMode = 'list';
  let swedenMapInstance = null, mapVersion = 0, mapKey = '';
  let currentFilteredClubs = [];

  let shownBackdrop = null;
  function paintBackdrop(slug) {
    if (shownBackdrop === slug) return;
    shownBackdrop = slug;
    const tryUrl = urls => {
      if (!urls.length) return;
      const img = new Image();
      img.onload = () => {
        if (shownBackdrop !== slug) return;
        bg.style.backgroundImage = `url('${urls[0]}')`;
        bg.classList.add('is-on');
      };
      img.onerror = () => tryUrl(urls.slice(1));
      img.src = urls[0];
    };
    bg.classList.remove('is-on');
    tryUrl([backdrop(slug), poster(slug)]);
  }

  function updateFilterIndicators() {
    const sortText = SORT_LABELS[sortOrder] || 'A–Ö';
    const filterText = activeFilter === 'all' ? '' : ` · ${FILTER_LABELS[activeFilter]}`;
    filterSummary.textContent = `Sortera: ${sortText}${filterText}`;
    const hasCustom = sortOrder !== 'name' || activeFilter !== 'all';
    filterDot.hidden = !hasCustom;
    filterReset.hidden = !hasCustom;
    for (const btn of filterPop.querySelectorAll('[data-sort]')) {
      btn.setAttribute('aria-checked', String(btn.dataset.sort === sortOrder));
    }
    for (const btn of filterPop.querySelectorAll('[data-filter]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.filter === activeFilter));
    }
  }

  function openFilterPopover(anchor) {
    const open = filterPop.hidden;
    filterPop.hidden = !open;
    filterBtn.setAttribute('aria-expanded', String(open));
    filterDesktopBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const rect = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 280, Math.max(12, rect.bottom + 8));
    const right = Math.max(12, window.innerWidth - rect.right);
    filterPop.style.top = `${Math.round(top)}px`;
    filterPop.style.right = `${Math.round(right)}px`;
    filterPop.style.left = 'auto';
    filterPop.querySelector('[aria-checked="true"], button')?.focus({ preventScroll: true });
  }
  function closeFilterPopover(returnFocus = false) {
    if (filterPop.hidden) return;
    filterPop.hidden = true;
    filterBtn.setAttribute('aria-expanded', 'false');
    filterDesktopBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) (filterDesktopBtn.offsetParent ? filterDesktopBtn : filterBtn).focus();
  }
  filterBtn.addEventListener('click', e => { e.stopPropagation(); openFilterPopover(filterBtn); });
  filterDesktopBtn.addEventListener('click', e => { e.stopPropagation(); openFilterPopover(filterDesktopBtn); });
  filterPop.querySelector('[data-filter-done]').addEventListener('click', () => closeFilterPopover(true));
  filterReset.addEventListener('click', () => {
    gpsRequestId++;
    sortOrder = 'name';
    explicitSort = 'name';
    activeFilter = 'all';
    writeText(storage(), SORT_KEY, 'name');
    sortStatus.hidden = true;
    sortRetry.hidden = true;
    updateFilterIndicators();
    renderClubList();
  });
  sortRetry.addEventListener('click', () => requestPosition('distance'));
  document.addEventListener('click', e => {
    if (!filterPop.hidden && !filterPop.contains(e.target) && !e.target.closest('#lobbyFilterBtn, [data-filter-trigger]')) {
      closeFilterPopover(false);
    }
  });
  filterPop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeFilterPopover(true); }
  });
  filterPop.addEventListener('click', e => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const next = sortBtn.dataset.sort;
      if (next === 'distance' && !place) {
        requestPosition('distance');
        return;
      }
      gpsRequestId++;
      sortOrder = next;
      explicitSort = next;
      writeText(storage(), SORT_KEY, next);
      sortStatus.hidden = true;
      sortRetry.hidden = true;
      updateFilterIndicators();
      renderClubList();
      return;
    }
    const catBtn = e.target.closest('[data-filter]');
    if (catBtn) {
      activeFilter = catBtn.dataset.filter;
      updateFilterIndicators();
      renderClubList();
    }
  });

  function requestPosition(forSort = null) {
    const reqId = ++gpsRequestId;
    if (!navigator.geolocation) {
      sortStatus.textContent = 'Platsåtkomst saknas i webbläsaren.';
      sortStatus.hidden = false;
      sortRetry.hidden = !forSort;
      return;
    }
    nearButton.disabled = true;
    nearButton.setAttribute('aria-busy', 'true');
    nearLabel.textContent = 'Söker din position…';
    if (forSort) {
      sortStatus.textContent = 'Hämtar din position…';
      sortStatus.hidden = false;
      sortRetry.hidden = true;
    }
    const done = label => {
      nearButton.disabled = false;
      nearButton.removeAttribute('aria-busy');
      nearLabel.textContent = label;
    };
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (reqId !== gpsRequestId) return;
      done('Klubbar nära mig');
      if (forSort === 'distance') {
        sortOrder = 'distance';
        explicitSort = 'distance';
        writeText(storage(), SORT_KEY, 'distance');
        sortStatus.hidden = true;
        sortRetry.hidden = true;
        updateFilterIndicators();
      }
      placed(coords);
    }, () => {
      if (reqId !== gpsRequestId) return;
      done('Försök igen');
      placeFailed = true;
      if (forSort) {
        sortStatus.textContent = 'Tillåt platsåtkomst för att sortera efter avstånd.';
        sortStatus.hidden = false;
        sortRetry.hidden = false;
      }
      renderClubList();
    }, { timeout: 15000, maximumAge: 120000 });
  }
  nearButton.addEventListener('click', () => requestPosition());

  function clubRow({ club, why, session = null, at = null, metres = null, matchedLayouts = null }, sessions) {
    const cover = club.cover;
    const live = session ?? sessions.find(entry => club.courses.some(course => course.slug === entry.course.slug));
    const orderedLayouts = clubLayouts(club.courses, cover.slug);
    const multi = orderedLayouts.length > 1;
    const town = COURSE_LOCATIONS[cover.slug]?.city;
    const heroImg = cover.photos ? poster(cover.slug, 1) : cover.overviewUrl ? `${BASE}${cover.overviewUrl}` : '';
    const thumbImg = cover.photos ? thumbnail(cover.slug) : heroImg;
    const distLabel = Number.isFinite(metres) ? distanceText(metres) : '';
    const note = why === 'opened' ? (Number.isFinite(at) ? `Öppnad ${dayText(at)}` : 'Senast öppnad')
      : why === 'played' ? `Spelad ${dayText(at)}`
      : why === 'near' && distLabel ? `${distLabel} bort`
      : distLabel ? `${distLabel} bort` : '';
    const singleMeta = `${cover.holes} hål · Par ${cover.par}`;
    const directHitSlug = matchedLayouts && matchedLayouts.length === 1 && multi ? matchedLayouts[0].slug : '';
    const metaText = [town, multi ? `${orderedLayouts.length} banor` : singleMeta].filter(Boolean).join(' · ');

    const pills = multi ? `<div class="hc-layouts" role="group" aria-label="Banor på ${esc(club.name)}">${orderedLayouts.map(layout => {
      const matched = matchedLayouts ? matchedLayouts.some(m => m.slug === layout.slug) : false;
      const layoutLive = sessions.find(entry => entry.course.slug === layout.slug);
      return `<button type="button" class="hc-layout-pill${matched ? ' is-hit' : ''}${layoutLive ? ' is-live' : ''}" data-club-layout="${esc(layout.slug)}" data-club-id="${esc(club.id)}">
        ${layoutLive ? '<span class="bv-live-dot" aria-hidden="true"></span>' : ''}<span>${esc(pillLabel(layout))}</span><small>${layout.holes}</small>
      </button>`;
    }).join('')}</div>` : '';

    return `<li class="home-club-card${multi ? ' is-multi' : ''}">
      <button type="button" class="home-club" id="homeClub-${esc(club.id)}" data-club="${esc(club.id)}"${directHitSlug ? ` data-direct-slug="${esc(directHitSlug)}"` : ''}>
        ${heroImg ? `<span class="hc-poster" style="background-image:url('${esc(heroImg)}')" aria-hidden="true"></span>` : '<span class="hc-poster" aria-hidden="true"></span>'}
        ${thumbImg ? `<img class="hc-thumb" src="${esc(thumbImg)}" alt="" width="56" height="56" loading="lazy" decoding="async">` : '<span class="hc-thumb" aria-hidden="true"></span>'}
        <span class="hc-text">
          <strong>${esc(club.name)}</strong>
          <small>${esc(metaText)}</small>
          ${live ? `<span class="hc-live"><i class="bv-live-dot" aria-hidden="true"></i>${esc([sessionBadge(live), multi ? pillLabel(live.course) : ''].filter(Boolean).join(' · '))}</span>`
            : note ? `<span class="hc-note">${esc(note)}</span>` : ''}
        </span>
        <span class="hc-go" aria-hidden="true">${ARROW}</span>
      </button>
      ${pills}
    </li>`;
  }

  function renderClubList() {
    const { clubs, sessions, recent, lastSlug } = lobby;
    if (!onClub || !clubs.length) { clubsSection.hidden = true; return; }
    const large = catalogueIsLarge(clubs);
    const catOf = course => CATEGORIES[course.slug]?.id || 'all';
    const filteredClubs = activeFilter === 'all'
      ? clubs
      : clubs.filter(club => club.courses.some(course => catOf(course) === activeFilter));
    const query = queryInput.value.trim();
    queryClear.hidden = !query;
    const limit = expandedAll ? clubs.length : (phone ? LOBBY_SHORT_LIST_PHONE : LOBBY_SHORT_LIST);

    let rows = [];
    let totalFound = filteredClubs.length;
    let heading = 'Alla klubbar';
    let note = '';

    if (query) {
      const found = searchClubs(clubs, query, { limit: clubs.length, filter: activeFilter });
      const allHits = found?.rows ?? [];
      totalFound = found?.total ?? 0;
      if (sortOrder !== 'name' && allHits.length > 1) {
        const byId = new Map(allHits.map(row => [row.club.id, row]));
        const ordered = sortClubs(allHits.map(row => row.club), sortOrder, { recentSlug: lastSlug, coords: place });
        rows = ordered.slice(0, expandedAll ? ordered.length : limit)
          .map(({ club, metres }) => ({ ...byId.get(club.id), metres }));
      } else {
        rows = allHits.slice(0, expandedAll ? allHits.length : limit);
      }
      heading = 'Sökresultat';
      note = totalFound ? '' : `Ingen klubb matchar ”${query}”`;
    } else if (large && !expandedAll && sortOrder === 'name' && activeFilter === 'all') {
      const shown = [...resumeSlot.querySelectorAll('[data-club-id]')].map(card => card.dataset.clubId);
      const personal = lobbyClubs(clubs, { sessions, recent, coords: place, exclude: shown, limit });
      rows = personal.rows;
      heading = rows.length ? (rows.some(row => row.why !== 'near') ? 'Dina klubbar' : 'Närmast dig') : 'Klubbar';
      totalFound = clubs.length;
      if (!rows.length) {
        note = placeFailed ? 'Banvy fick ingen position. Sök på klubbens namn eller ort i stället.'
          : navigator.geolocation ? `Sök bland ${clubs.length} klubbar, eller visa de närmaste.` : `Sök bland ${clubs.length} klubbar.`;
      }
    } else {
      const sorted = sortClubs(filteredClubs, sortOrder, { recentSlug: lastSlug, coords: place });
      const capped = large && !expandedAll ? sorted.slice(0, limit) : sorted;
      rows = capped.map(({ club, metres }) => ({ club, why: sortOrder === 'distance' ? 'near' : 'all', metres }));
      heading = activeFilter === 'all' ? 'Alla klubbar' : FILTER_LABELS[activeFilter];
      totalFound = sorted.length;
    }

    currentFilteredClubs = query
      ? (searchClubs(clubs, query, { limit: clubs.length, filter: activeFilter })?.rows ?? []).map(r => r.club)
      : filteredClubs;

    clubsHeading.textContent = heading;
    clubsCount.textContent = `${totalFound} ${totalFound === 1 ? 'klubb' : 'klubbar'}`;
    clubsNote.textContent = note;
    clubsNote.hidden = !note;

    const showEmpty = rows.length === 0 && Boolean(query || activeFilter !== 'all');
    emptyBox.hidden = !showEmpty;
    clubList.hidden = showEmpty;

    nearButton.hidden = !(large && !query && !place && navigator.geolocation && rows.length === 0);
    const hasMore = (query ? totalFound > rows.length : large && !expandedAll && totalFound > rows.length);
    showAllBtn.hidden = !hasMore;
    if (hasMore) {
      showAllLabel.textContent = query ? `Visa alla ${totalFound} träffar` : `Visa alla ${totalFound} klubbar`;
    }
    clubsMore.hidden = nearButton.hidden && showAllBtn.hidden;
    clubsSection.hidden = false;

    const html = rows.map(row => clubRow(row, sessions)).join('');
    if (html !== shownClubs) {
      const focusId = clubList.contains(document.activeElement) ? document.activeElement.id : null;
      shownClubs = html;
      clubList.innerHTML = html;
      if (focusId) clubList.querySelector('#' + CSS.escape(focusId))?.focus({ preventScroll: true });
    }
    if (viewMode === 'map') renderMap();
  }

  async function setViewMode(next) {
    viewMode = next === 'map' ? 'map' : 'list';
    const isMap = viewMode === 'map';
    el.classList.toggle('is-map-view', isMap);
    viewListBtn.setAttribute('aria-pressed', String(!isMap));
    viewMapBtn.setAttribute('aria-pressed', String(isMap));
    viewQuickBtn.setAttribute('aria-pressed', String(isMap));
    viewQuickLabel.textContent = isMap ? 'Lista' : 'Karta';
    listWrap.hidden = isMap;
    mapWrap.hidden = !isMap;
    if (isMap) await renderMap();
  }

  async function renderMap() {
    const version = ++mapVersion;
    const groups = currentFilteredClubs.length ? currentFilteredClubs : lobby.clubs;
    const key = groups.map(g => g.id).sort().join(',');
    if (!swedenMapInstance || mapKey !== key) {
      swedenMapInstance?.map.remove();
      swedenMapInstance?.el.remove();
      swedenMapInstance = null;
      mapWrap.replaceChildren();
      if (!groups.length) {
        const none = document.createElement('p');
        none.className = 'lobby-empty';
        none.textContent = 'Ingen klubb matchar din sökning.';
        mapWrap.append(none);
        return;
      }
      mapKey = key;
      const { createSwedenMap } = await import('./map.js');
      if (version !== mapVersion) return;
      swedenMapInstance = createSwedenMap({
        container: mapWrap,
        groups,
        current: null,
        lead: lobby.lastSlug ? clubIdFor(lobby.lastSlug) : null,
        onPickClub: id => onClub?.(id, preferredMode()),
      });
    }
    requestAnimationFrame(() => swedenMapInstance?.invalidateSize());
  }

  viewListBtn.addEventListener('click', () => setViewMode('list'));
  viewMapBtn.addEventListener('click', () => setViewMode('map'));
  viewQuickBtn.addEventListener('click', () => setViewMode(viewMode === 'map' ? 'list' : 'map'));

  clubList.addEventListener('click', e => {
    const pill = e.target.closest('[data-club-layout]');
    if (pill) {
      const slug = pill.dataset.clubLayout;
      if (onLayout) onLayout(slug, preferredMode());
      else onPlan?.(slug, preferredMode());
      return;
    }
    const row = e.target.closest('[data-club]');
    if (!row) return;
    if (row.dataset.directSlug && (onLayout || onPlan)) {
      (onLayout || onPlan)(row.dataset.directSlug, preferredMode());
      return;
    }
    onClub?.(row.dataset.club, preferredMode());
  });

  const clearQuery = () => { queryInput.value = ''; expandedAll = false; renderClubList(); };
  queryInput.addEventListener('input', () => { expandedAll = false; renderClubList(); });
  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Escape' && queryInput.value) { e.stopPropagation(); clearQuery(); }
    if (e.key === 'Enter') queryInput.blur();
  });
  queryClear.addEventListener('click', () => { clearQuery(); queryInput.focus(); });
  el.querySelector('[data-empty-reset]').addEventListener('click', () => {
    queryInput.value = '';
    activeFilter = 'all';
    expandedAll = false;
    updateFilterIndicators();
    renderClubList();
  });
  showAllBtn.addEventListener('click', () => { expandedAll = true; renderClubList(); });

  for (const navLink of el.querySelectorAll('[data-nav]')) {
    navLink.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      if (navLink.dataset.nav === 'stats') onStats?.();
      else if (navLink.dataset.nav === 'settings') onSettings?.();
    });
  }

  function refresh() {
    playable = courses.filter(c => c.status !== 'mapping');
    const clubs = groupCourses(playable);
    requestAnimationFrame(() => transfers.refresh());
    const last = lastLaunch(storage(), playable);
    const sessions = courseSessions(storage(), playable);
    lobby = {
      clubs,
      sessions,
      lastSlug: last?.course.slug ?? null,
      recent: recentCourses({
        lastSlug: last?.course.slug ?? null,
        launches: recentLaunches(storage()),
        rounds: parseRounds(readText(storage(), MAP_KEYS.rounds, null)),
      }),
    };
    const recentBtn = filterPop.querySelector('[data-sort="recent"]');
    if (recentBtn) recentBtn.disabled = !lobby.lastSlug;
    updateFilterIndicators();
    renderResume(clubs, sessions, last);
    renderClubList();
    lookNear();
  }

  function renderResume(clubs, sessions, last) {
    /* A GPS round on its way out (its undo still showing) is not drawn again. */
    const leaving = session => session.mode === 'map' && removalPending(`${session.course.slug}/${localRoundId(session.course.slug)}`);
    const featured = (phone ? ['map', 'play'] : ['play', 'map']).map(mode => sessions.find(s => s.mode === mode && !leaving(s))).filter(Boolean);
    const courseCaption = course => {
      const title = layoutLabel(course);
      const club = clubs.find(group => group.id === clubIdFor(course.slug));
      return club?.courses.length > 1 ? `${club.name} · ${title}` : title;
    };
    paintBackdrop(featured[0]?.course.slug || last?.course.slug || DEFAULT_BACKDROP);
    resumeSlot.classList.toggle('has-multiple', featured.length > 1);
    if (featured.length) {
      const focusId = resumeSlot.contains(document.activeElement) ? document.activeElement.id : null;
      resumeSlot.innerHTML = featured.map(session => {
        const gps = session.mode === 'map';
        const action = gps ? 'Fortsätt GPS-rundan' : 'Fortsätt simuleringen';
        const completed = gps ? (session.holes === 1 ? '1 spelat hål' : `${session.holes} spelade hål`) : '';
        const where = [sessionPosition(session), completed, session.strokes ? `${session.strokes} slag` : ''].filter(Boolean).join(' · ');
        const card = `<button class="home-resume${gps ? ' is-live' : ''}" id="homeResume-${session.mode}" type="button" data-resume="${session.mode}" data-club-id="${esc(clubIdFor(session.course.slug))}"${gps ? '' : ' data-simulation'}>
          <span class="hr-thumb" style="background-image:url('${poster(session.course.slug)}')" aria-hidden="true"></span>
          <span class="hr-text"><span class="hr-kicker"><i class="hr-live" aria-hidden="true"></i>${action}</span>
            <span class="hr-name">${esc(courseCaption(session.course))}</span><span class="hr-sub">${esc(where)}</span></span>
          <span class="hr-go" aria-hidden="true">${ARROW}</span></button>`;
        /* A GPS round has its own actions beside it (round-actions.mjs): end and keep it, or remove it. */
        const more = gps ? `<button class="hr-more" type="button" id="homeResumeMore-map" data-round-more aria-haspopup="dialog" aria-label="Val för rundan på ${esc(courseCaption(session.course))}">${MORE_ICON}</button>` : '';
        return `<div class="home-resume-item${gps ? ' is-live' : ''}">${card}${more}</div>`;
      }).join('');
      for (const session of featured) {
        const card = resumeSlot.querySelector(`[data-resume="${session.mode}"]`);
        card.onclick = () => onResume(session.course.slug, session.mode,
          session.mode === 'map' ? { round: 'resume' } : { sim: 'fortsatt', tee: session.tee, hole: session.hole });
        if (session.mode !== 'map') continue;
        const more = resumeSlot.querySelector('[data-round-more]');
        const open = () => openLocalRound(session, courseCaption(session.course), more);
        more.onclick = open;
        bindRoundActions(card, open);
      }
      if (focusId) resumeSlot.querySelector('#' + CSS.escape(focusId))?.focus({ preventScroll: true });
      return;
    }
    if (resumeSlot.querySelector('[data-near]')) return;
    if (!last) { resumeSlot.innerHTML = ''; return; }
    const { course, mode } = last;
    resumeSlot.innerHTML = `
      <button class="home-resume" type="button" data-resume data-club-id="${esc(clubIdFor(course.slug))}">
        <span class="hr-thumb" style="background-image:url('${poster(course.slug)}')" aria-hidden="true"></span>
        <span class="hr-text">
          <span class="hr-kicker">Senast öppnad · ${MODES[mode].label}</span>
          <span class="hr-name">${esc(courseCaption(course))}</span>
        </span>
        <span class="hr-go" aria-hidden="true">${ARROW}</span>
      </button>`;
    const btn = resumeSlot.querySelector('[data-resume]');
    btn.setAttribute('aria-label', `Öppna ${layoutLabel(course)} i ${MODES[mode].label}`);
    btn.addEventListener('click', () => onResume(course.slug, mode));
  }

  /* The sheet of this device's own GPS round: end it and keep it (when holes are played), or remove it. */
  function openLocalRound(session, name, returnFocus) {
    const slug = session.course.slug, id = localRoundId(slug);
    if (id == null) return;
    const holes = session.holes;
    const played = holes === 1 ? '1 spelat hål' : `${holes} spelade hål`;
    const actions = [];
    if (holes > 0) actions.push({ label: 'Avsluta och spara rundan', note: `${played} sparas i statistiken`, run: () => onResume(slug, 'map', { round: 'end' }) });
    actions.push({
      label: 'Ta bort rundan', danger: true,
      note: holes > 0 ? `${played} och scorekortet tas bort` : 'Inga hål är spelade',
      run: () => removeWithUndo({
        key: `${slug}/${id}`,
        message: `Rundan på ${name} är borttagen`,
        hide: roundsChanged,
        restore: roundsChanged,
        commit: async () => {
          discardLocalRound(slug, id);
          await dismissLive({ course: slug, id });
          roundsChanged();
        },
      }),
    });
    openRoundSheet({ title: name, detail: [sessionPosition(session), played].filter(Boolean).join(' · '), actions, returnFocus });
  }

  let nearAsked = false;
  function lookNear() {
    if (!playable.length || nearAsked || explicitSort === 'name' || explicitSort === 'recent' || !navigator.permissions || !navigator.geolocation) return;
    nearAsked = true;
    const reqId = ++gpsRequestId;
    navigator.permissions.query({ name: 'geolocation' }).then(answer => {
      if (answer.state !== 'granted' || reqId !== gpsRequestId) return;
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        if (reqId !== gpsRequestId) return;
        if (!explicitSort || explicitSort === 'distance') {
          sortOrder = 'distance';
          updateFilterIndicators();
        }
        placed(coords);
      }, () => {}, { timeout: 10000, maximumAge: 120000 });
    }).catch(() => {});
  }
  function placed(coords) {
    place = coords;
    placeFailed = false;
    offerNear(coords);
    renderClubList();
  }
  function offerNear(coords) {
    if (!onPlan) return;
    const nearest = coursesByDistance(coords, COURSE_LOCATIONS).find(({ slug }) => playable.some(c => c.slug === slug));
    if (!nearest || nearest.metres > NEAR_METRES || resumeSlot.querySelector('.is-live, [data-simulation]')) return;
    const course = playable.find(c => c.slug === nearest.slug);
    const club = groupCourses(playable).find(group => group.id === clubIdFor(course.slug));
    const multiple = club?.courses.length > 1;
    const name = multiple ? club.name : course.name;
    resumeSlot.innerHTML = `
      <button class="home-resume is-near" type="button" data-near data-slug="${esc(course.slug)}" data-club-id="${esc(club?.id ?? clubIdFor(course.slug))}">
        <span class="hr-thumb" style="background-image:url('${poster(course.slug)}')" aria-hidden="true"></span>
        <span class="hr-text">
          <span class="hr-kicker">${PIN}${nearest.metres < 1500 ? 'Du är vid banan' : 'Nära dig'}</span>
          <span class="hr-name">${esc(name)}</span>
          <span class="hr-sub">${distanceText(nearest.metres)} bort · ${multiple ? 'välj bana för GPS-rundan' : 'starta rundan med GPS'}</span>
        </span>
        <span class="hr-go" aria-hidden="true">${ARROW}</span>
      </button>`;
    const btn = resumeSlot.querySelector('[data-near]');
    btn.setAttribute('aria-label', `Välj bana för en runda på ${name}, ${distanceText(nearest.metres)} bort`);
    btn.addEventListener('click', () => multiple && onNearby ? onNearby(club.id) : onPlan(course.slug, 'map'));
  }

  const accountBtn = el.querySelector('[data-account]');
  accountBtn.addEventListener('click', () => (onAccount ? onAccount() : onSettings()));
  subscribeCloud(cloud => {
    accountBtn.hidden = !cloud.available;
    if (!cloud.available) return;
    if (cloud.user) {
      const firstName = (cloud.user.name || cloud.user.email || 'Konto').trim().split(/\s+/)[0];
      const initial = firstName.charAt(0).toUpperCase() || 'G';
      const avatar = cloud.user.image
        ? `<img class="hub-account-avatar" src="${esc(cloud.user.image)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="hub-account-avatar" aria-hidden="true">${esc(initial)}</span>`;
      const dotClass = cloud.syncing ? ' is-syncing' : (cloud.offline || cloud.dirty) ? ' is-pending' : '';
      accountBtn.innerHTML = `${avatar}<span class="hub-account-name">${esc(firstName)}</span><span class="hub-sync-dot${dotClass}" aria-hidden="true"></span>`;
      accountBtn.setAttribute('aria-label', `Konto: ${cloud.user.name || cloud.user.email}`);
      accountBtn.title = cloud.syncing ? 'Synkar…' : cloud.offline ? 'Offline — väntar på nät' : 'Synkat konto';
    } else {
      accountBtn.innerHTML = `${USER_ICON}<span>Logga in</span>`;
      accountBtn.setAttribute('aria-label', 'Logga in för att synka dina rundor');
      accountBtn.title = 'Logga in';
    }
  });
  addEventListener('banvy-sync-changed', () => refresh());
  addEventListener('banvy-rounds-changed', () => refresh());

  const installBtn = el.querySelector('[data-install]');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const offerInstall = () => { installBtn.hidden = standalone || !globalThis.__banvyInstall; };
  offerInstall();
  addEventListener('banvy-installable', offerInstall);
  addEventListener('appinstalled', () => { globalThis.__banvyInstall = null; offerInstall(); });
  installBtn.addEventListener('click', async () => {
    const prompt = globalThis.__banvyInstall;
    if (!prompt) return;
    globalThis.__banvyInstall = null;
    offerInstall();
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* declined */ }
  });

  addEventListener('keydown', e => {
    if (el.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === '/' && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      queryInput.focus();
      queryInput.select();
      return;
    }
    if (e.key === '1') onMode?.('detailed');
    else if (e.key === '2') onMode?.('map');
    else if (e.key === '3') onMode?.('play');
    else if (e.key === '4') onStats?.();
    else if (e.key === '5') onSettings?.();
  });

  refresh();
  el.refresh = refresh;
  el.setViewMode = setViewMode;
  el.focusClub = id => {
    if (viewMode === 'map') swedenMapInstance?.focusClub(id);
    else clubList.querySelector(`#homeClub-${CSS.escape(id)}`)?.focus({ preventScroll: true });
  };
  return el;
}
