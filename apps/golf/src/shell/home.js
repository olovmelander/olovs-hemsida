import '../styles/hub.css';
import { isPhone } from './map-default.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { parseHistory } from '../map/map-shots.mjs';
import { LAST_MODE_KEY, MAP_KEYS, MODES, courseSessions, lastLaunch, recentLaunches, sessionBadge, sessionPosition, readSettings, readText, settingsSummary, readFrameCap } from './settings-store.mjs';
import { perEighteen, playedHoles, scoreToPar } from './stats-model.mjs';
import { clubIdFor, clubLayouts, groupCourses, layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { coursesByDistance, distanceText } from './nearest-course.mjs';
import { LOBBY_SHORT_LIST, LOBBY_SHORT_LIST_PHONE, catalogueIsLarge, dayText, lobbyClubs, recentCourses, searchClubs } from './lobby-model.mjs';
import { ICONS } from './icons.js';
import { subscribeCloud } from './cloud.mjs';
import { showLiveRounds } from './live-round-panel.mjs';

/* Within this, a phone is at the course or on its way there. */
const NEAR_METRES = 5000;

const BASE = import.meta.env.BASE_URL;
const poster = (slug, n = 1) => `${BASE}courses/${slug}/hero-${n}.webp`;
const backdrop = slug => `${BASE}courses/${slug}/backdrop.webp`;
/* a club row's 56 px picture: the poster's middle square at 168 px (tools/make-posters.mjs) */
const thumbnail = slug => `${BASE}courses/${slug}/thumb.webp`;
/* The island green in the fjord: the frame that says "a real course, in 3D" fastest. */
const DEFAULT_BACKDROP = 'veckefjarden';
const DETAILED_ART = poster('visby');
const GPS_ART = `${BASE}play/gps-card.webp`;
/* Spela's card: the game itself, from behind the golfer on the first tee */
const PLAY_ART = `${BASE}play/spela-card.webp`;

const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const ARROW = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>';
const CUBE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>';
const INSTALL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>';
const STATS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/></svg>';
const GOLFER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20.5c3.2-1.6 10.8-1.6 14 0"/><path d="M15.5 3.5v13"/><path d="M15.5 3.8l4.6 1.9-4.6 1.9"/><circle cx="8.5" cy="16.6" r="1.6"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>';
const USER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-3.8 3.6-5.6 7-5.6s6 1.8 7 5.6"/></svg>';

export function buildHome({ courses, onMode, onSettings, onAccount = null, onStats, onResume, onPlan = null, onNearby = null, onClub = null, onSearch = null }) {
  const phone = isPhone();
  let playable = [];

  const el = document.createElement('div');
  el.id = 'home';
  el.className = 'hub-screen';
  /* the screen on show is the page's main landmark; the hidden ones are out of the tree */
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'homeTitle');

  const activities = {
    detailed: { action: 'Utforska banan', detail: 'Flyg över hålen och läs greenerna.', icon: CUBE, image: DETAILED_ART, key: 1 },
    map: { label: 'Lätt 3D med GPS', action: 'Spela på banan', detail: 'Mät avstånd och för score under rundan.', icon: PIN, image: GPS_ART, key: 2 },
    play: { action: 'Spela en virtuell runda', detail: 'Sikta, slå och putta med din egen bag.', icon: GOLFER, image: PLAY_ART, key: 3 },
  };

  function activityCard(mode) {
    const { label = MODES[mode].label, action, detail, icon, image, key } = activities[mode];
    return `<a class="mode-card mode-${mode}" href="#${MODES[mode].route}" data-mode="${mode}" aria-keyshortcuts="${key}">
      <span class="mc-art" style="background-image:url('${image}')" aria-hidden="true"></span>
      <span class="mc-top"><span class="mc-mode">${icon}${label}</span><kbd aria-hidden="true">${key}</kbd></span>
      <span class="mc-body"><strong class="mc-title">${action}</strong><span class="mc-text">${detail}</span></span>
      <span class="mc-go" aria-hidden="true">${ARROW}</span>
    </a>`;
  }
  el.innerHTML = `
    <div class="home-backdrop" aria-hidden="true"><i class="home-bg"></i></div>
    <div class="home-inner">
      <div class="hub-top">
        <a class="hub-brand" href="#" aria-label="Banvy, startmenyn">
          <span class="crest-dot"></span><span class="wordmark">Ban<i>v</i>y</span>
        </a>
        <span class="hub-top-actions">
          <button class="hub-icon-btn hub-install" type="button" data-install hidden>${INSTALL}<span>Installera</span></button>
          <button class="hub-icon-btn hub-account" type="button" data-account hidden></button>
        </span>
      </div>

      <section class="home-hero">
        <h1 class="home-title" id="homeTitle" tabindex="-1">Var spelar du?</h1>
        <p class="home-lead"></p>
      </section>
      <div class="home-resume-slot"></div>
      <section class="home-live-transfer" data-live-rounds aria-label="Rundor mellan enheter" hidden></section>
      <section class="home-clubs" aria-labelledby="homeClubsTitle" data-home-clubs hidden>
        <div class="home-clubs-head">
          <h2 id="homeClubsTitle">Klubbar</h2>
          <a class="home-clubs-all" href="#" data-all-clubs><span data-all-label>Sök, sortera och karta</span>${ARROW}</a>
        </div>
        <div class="home-club-search" data-club-search hidden>
          ${ICONS.search(17)}
          <input type="search" id="homeClubQuery" data-club-query placeholder="Sök klubb, bana eller ort"
            aria-label="Sök klubbar efter namn, bana, ort eller par" aria-controls="homeClubList" aria-keyshortcuts="/"
            autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          <button class="hcs-clear" type="button" data-club-query-clear aria-label="Töm sökningen" hidden>${ICONS.close(14)}</button>
        </div>
        <p class="home-clubs-note" id="homeClubsNote" data-clubs-note role="status" hidden></p>
        <ul class="home-club-list" id="homeClubList" data-club-list aria-labelledby="homeClubsTitle"></ul>
        <div class="home-clubs-more" data-clubs-more hidden>
          <button class="home-clubs-near" type="button" data-clubs-near hidden>${PIN}<span data-near-label>Klubbar nära mig</span></button>
          <a class="home-clubs-hits" href="#" data-clubs-hits hidden><span data-hits-label></span>${ARROW}</a>
        </div>
      </section>
      <h2 class="home-modes-title" id="homeModesTitle">Eller börja med ett sätt att spela</h2>
      <nav class="home-modes" aria-labelledby="homeModesTitle">
        ${(phone ? ['map', 'detailed', 'play'] : ['detailed', 'play', 'map']).map(activityCard).join('')}
      </nav>
      <nav class="home-side" aria-label="Dina sidor">
        <a class="mode-card home-tool mode-stats" href="#statistik" data-mode="stats" data-stats aria-keyshortcuts="4">
          ${STATS}<span><strong>Statistik</strong><small data-stats-summary></small></span><kbd aria-hidden="true">4</kbd>
        </a>
        <a class="mode-card home-tool mode-settings" href="#installningar" data-mode="settings" data-settings aria-keyshortcuts="5">
          ${GEAR}<span><strong>Inställningar</strong><small data-summary></small></span><kbd aria-hidden="true">5</kbd>
        </a>
      </nav>
      <footer class="home-legal">
        <a href="${BASE}integritet.html">Integritetspolicy</a>
        <span aria-hidden="true">·</span>
        <a href="${BASE}villkor.html">Villkor</a>
      </footer>
    </div>`;

  const bg = el.querySelector('.home-bg');
  const resumeSlot = el.querySelector('.home-resume-slot');
  const transfers = showLiveRounds(el.querySelector('[data-live-rounds]'), courses);
  const summaryEl = el.querySelector('[data-summary]');
  const statsSummaryEl = el.querySelector('[data-stats-summary]');
  /* the rounds the map kept: how many, and where the scoring stands */
  function statsSummary() {
    const rounds = parseRounds(readText(storage(), MAP_KEYS.rounds, null));
    const scores = rounds.map(perEighteen).filter(Number.isFinite);
    if (!scores.length) {
      const holes = rounds.flatMap(playedHoles);
      if (holes.length) {
        const toPar = scoreToPar(holes);
        if (toPar === null) return `${holes.length} hål med score · par saknas`;
        const strokes = holes.reduce((total, hole) => total + hole.strokes, 0);
        const result = toPar === 0 ? 'Par' : `${toPar > 0 ? '+' : '−'}${Math.abs(toPar)} mot par`;
        return `${holes.length} hål med score · ${strokes} slag · ${result}`;
      }
      const shots = parseHistory(readText(storage(), MAP_KEYS.shots, null));
      if (shots.length) return `${shots.length} ${shots.length === 1 ? 'loggat slag' : 'loggade slag'} · ingen hålscore`;
      if (rounds.length) return `${rounds.length} ${rounds.length === 1 ? 'sparad runda' : 'sparade rundor'} · ingen hålscore`;
      return '';
    }
    const average = scores.reduce((s, v) => s + v, 0) / scores.length;
    const sign = average > 0.05 ? '+' : average < -0.05 ? '−' : '±';
    return `${rounds.length} ${rounds.length === 1 ? 'runda' : 'rundor'} · snitt ${sign}${Math.abs(average).toFixed(1).replace('.', ',')} per 18 hål`;
  }

  /* The backdrop fades in once decoded, so the menu never flashes a half-drawn picture. */
  let shownBackdrop = null;
  function paintBackdrop(slug) {
    if (shownBackdrop === slug) return;
    shownBackdrop = slug;
    const tryUrl = (urls) => {
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

  /* A club tapped here opens its own page in the way this golfer last played, or
     the device's own: the map on a phone, the detailed course on a computer. The
     page shows the mode and changes it in one tap (docs/ui-redesign-2026-11-25.md B1). */
  const preferredMode = () => {
    const last = readText(storage(), LAST_MODE_KEY, null);
    return MODES[last] ? last : phone ? 'map' : 'detailed';
  };
  const clubsSection = el.querySelector('[data-home-clubs]');
  const clubList = el.querySelector('[data-club-list]');
  const allClubs = el.querySelector('[data-all-clubs]');
  const allLabel = el.querySelector('[data-all-label]');
  const searchBox = el.querySelector('[data-club-search]');
  const queryInput = el.querySelector('[data-club-query]');
  const queryClear = el.querySelector('[data-club-query-clear]');
  const clubsNote = el.querySelector('[data-clubs-note]');
  const clubsMore = el.querySelector('[data-clubs-more]');
  const nearButton = el.querySelector('[data-clubs-near]');
  const nearLabel = el.querySelector('[data-near-label]');
  const hitsLink = el.querySelector('[data-clubs-hits]');
  const hitsLabel = el.querySelector('[data-hits-label]');
  const plainClick = e => !(e.metaKey || e.ctrlKey || e.shiftKey || e.button);
  allClubs.addEventListener('click', e => {
    if (!plainClick(e)) return;
    e.preventDefault();
    onMode(preferredMode());
  });
  /* every hit, in the list, with the words already in its search */
  hitsLink.addEventListener('click', e => {
    if (!plainClick(e)) return;
    e.preventDefault();
    if (onSearch) onSearch(queryInput.value.trim(), preferredMode());
    else onMode(preferredMode());
  });

  let lobby = { clubs: [], sessions: [], recent: [] };
  /* the phone's position, once it has said yes (lookNear, or Klubbar nära mig) */
  let place = null;
  let placeFailed = false;
  let shownClubs = '';

  function clubRow({ club, why, session = null, at = null, metres = null }, sessions) {
    const cover = club.cover;
    const live = session ?? sessions.find(entry => club.courses.some(course => course.slug === entry.course.slug));
    /* in the club page's order, the host's own course first */
    const layouts = club.courses.length > 1 ? clubLayouts(club.courses, cover.slug).map(layoutLabel).join(' · ') : `${cover.holes} hål · Par ${cover.par}`;
    const town = COURSE_LOCATIONS[cover.slug]?.city;
    const picture = cover.photos ? thumbnail(cover.slug) : cover.overviewUrl ? `${BASE}${cover.overviewUrl}` : '';
    /* why a row of the short list is there */
    const note = why === 'opened' ? (Number.isFinite(at) ? `Öppnad ${dayText(at)}` : 'Senast öppnad')
      : why === 'played' ? `Spelad ${dayText(at)}`
      : why === 'near' ? `${distanceText(metres)} bort` : '';
    return `<li><button type="button" class="home-club" id="homeClub-${esc(club.id)}" data-club="${esc(club.id)}">
        ${picture ? `<img class="hc-thumb" src="${esc(picture)}" alt="" width="56" height="56" loading="lazy" decoding="async">` : '<span class="hc-thumb" aria-hidden="true"></span>'}
        <span class="hc-text"><strong>${esc(club.name)}</strong><small>${esc([town, layouts].filter(Boolean).join(' · '))}</small>
          ${live ? `<span class="hc-live">${esc([sessionBadge(live), club.courses.length > 1 ? layoutLabel(live.course) : ''].filter(Boolean).join(' · '))}</span>`
            : note ? `<span class="hc-note">${esc(note)}</span>` : ''}</span>
        <span class="hc-go" aria-hidden="true">${ARROW}</span></button></li>`;
  }

  /* The lobby: every club by name while they fit; past that the golfer's own and a
     search over all of them (lobby-model.mjs). */
  function renderClubList() {
    const { clubs, sessions, recent } = lobby;
    if (!onClub || !clubs.length) { clubsSection.hidden = true; return; }
    const large = catalogueIsLarge(clubs);
    const mode = preferredMode();
    allClubs.href = `#${MODES[mode].route}`;
    allLabel.textContent = large ? `Alla ${clubs.length} klubbar` : 'Sök, sortera och karta';
    searchBox.hidden = !large;
    const query = large ? queryInput.value.trim() : '';
    queryClear.hidden = !query;
    const limit = phone ? LOBBY_SHORT_LIST_PHONE : LOBBY_SHORT_LIST;
    const found = query ? searchClubs(clubs, query, { limit }) : null;
    const shown = [...resumeSlot.querySelectorAll('[data-club-id]')].map(card => card.dataset.clubId);
    const { rows } = found ?? lobbyClubs(clubs, { sessions, recent, coords: place, exclude: shown, limit });
    let note = '';
    if (found) note = found.total ? `${found.total} ${found.total === 1 ? 'klubb' : 'klubbar'}` : `Ingen klubb matchar ”${query}”`;
    else if (large && rows.length) note = rows.some(row => row.why !== 'near') ? 'Dina klubbar' : 'Närmast dig';
    else if (large) {
      note = placeFailed ? 'Banvy fick ingen position. Sök på klubbens namn eller ort i stället.'
        : navigator.geolocation ? `Sök bland ${clubs.length} klubbar, eller låt Banvy visa de närmaste.` : `Sök bland ${clubs.length} klubbar.`;
    }
    if (clubsNote.textContent !== note) clubsNote.textContent = note;
    clubsNote.hidden = !note;
    nearButton.hidden = !(large && !query && !place && navigator.geolocation);
    const more = Boolean(found && found.total > found.rows.length);
    hitsLink.hidden = !more;
    if (more) {
      hitsLink.href = `#${MODES[mode].route}`;
      hitsLabel.textContent = `Visa alla ${found.total} träffar`;
    }
    clubsMore.hidden = nearButton.hidden && hitsLink.hidden;
    clubsSection.hidden = false;
    const html = rows.map(row => clubRow(row, sessions)).join('');
    if (html === shownClubs) return;
    const focusId = clubList.contains(document.activeElement) ? document.activeElement.id : null;
    shownClubs = html;
    clubList.innerHTML = html;
    if (focusId) clubList.querySelector('#' + CSS.escape(focusId))?.focus({ preventScroll: true });
  }
  clubList.addEventListener('click', e => {
    const row = e.target.closest('[data-club]');
    if (row) onClub?.(row.dataset.club, preferredMode());
  });
  const clearQuery = () => { queryInput.value = ''; renderClubList(); };
  queryInput.addEventListener('input', renderClubList);
  /* Escape empties the field before anything else; Enter puts a phone's keyboard
     away, so the hits are what is on screen (as in the list) */
  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Escape' && queryInput.value) { e.stopPropagation(); clearQuery(); }
    if (e.key === 'Enter') queryInput.blur();
  });
  queryClear.addEventListener('click', () => { clearQuery(); queryInput.focus(); });
  /* Asking for the position belongs to a tap: this one, or the list's sort */
  nearButton.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    nearButton.disabled = true;
    nearButton.setAttribute('aria-busy', 'true');
    nearLabel.textContent = 'Söker din position…';
    const done = label => {
      nearButton.disabled = false;
      nearButton.removeAttribute('aria-busy');
      nearLabel.textContent = label;
    };
    navigator.geolocation.getCurrentPosition(({ coords }) => { done('Klubbar nära mig'); placed(coords); }, () => {
      done('Försök igen');
      placeFailed = true;
      renderClubList();
    }, { timeout: 15000, maximumAge: 120000 });
  });

  function refresh() {
    playable = courses.filter(c => c.status !== 'mapping');
    const clubs = groupCourses(playable);
    el.querySelector('.home-lead').textContent = playable.length
      ? `${playable.length} banor på ${clubs.length} klubbar i Sverige`
      : 'Dina rundor och din bag finns i Statistik och Inställningar.';
    requestAnimationFrame(() => transfers.refresh());
    const last = lastLaunch(storage(), playable);
    const sessions = courseSessions(storage(), playable);
    lobby = {
      clubs,
      sessions,
      recent: recentCourses({
        lastSlug: last?.course.slug ?? null,
        launches: recentLaunches(storage()),
        rounds: parseRounds(readText(storage(), MAP_KEYS.rounds, null)),
      }),
    };
    /* the cards first, so the short list can leave out the clubs they show */
    renderResume(clubs, sessions, last);
    renderClubList();
    lookNear();
  }

  function renderResume(clubs, sessions, last) {
    const featured = (phone ? ['map', 'play'] : ['play', 'map']).map(mode => sessions.find(s => s.mode === mode)).filter(Boolean);
    const courseCaption = course => {
      const title = layoutLabel(course);
      const club = clubs.find(group => group.id === clubIdFor(course.slug));
      return club?.courses.length > 1 ? `${club.name} · ${title}` : title;
    };
    paintBackdrop(featured[0]?.course.slug || last?.course.slug || DEFAULT_BACKDROP);
    summaryEl.textContent = settingsSummary(readSettings(storage()), readFrameCap(storage()));
    statsSummaryEl.textContent = statsSummary();
    resumeSlot.classList.toggle('has-multiple', featured.length > 1);
    if (featured.length) {
      const focusId = resumeSlot.contains(document.activeElement) ? document.activeElement.id : null;
      resumeSlot.innerHTML = featured.map(session => {
        const gps = session.mode === 'map';
        const action = gps ? 'Fortsätt GPS-rundan' : 'Fortsätt simuleringen';
        const completed = gps ? (session.holes === 1 ? '1 spelat hål' : `${session.holes} spelade hål`) : '';
        const where = [sessionPosition(session), completed, session.strokes ? `${session.strokes} slag` : ''].filter(Boolean).join(' · ');
        return `<button class="home-resume${gps ? ' is-live' : ''}" id="homeResume-${session.mode}" type="button" data-resume="${session.mode}" data-club-id="${esc(clubIdFor(session.course.slug))}"${gps ? '' : ' data-simulation'}>
          <span class="hr-thumb" style="background-image:url('${poster(session.course.slug)}')" aria-hidden="true"></span>
          <span class="hr-text"><span class="hr-kicker">${gps ? '<i class="hr-live" aria-hidden="true"></i>' : ''}${action}</span>
            <span class="hr-name">${esc(courseCaption(session.course))}</span><span class="hr-sub">${esc(where)}</span></span>
          <span class="hr-mode">${activities[session.mode].icon}${MODES[session.mode].label}</span>
          <span class="hr-go" aria-hidden="true">${ARROW}</span></button>`;
      }).join('');
      for (const session of featured) {
        resumeSlot.querySelector(`[data-resume="${session.mode}"]`).onclick = () => onResume(session.course.slug, session.mode,
          session.mode === 'map' ? { round: 'resume' } : { sim: 'fortsatt', tee: session.tee, hole: session.hole });
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
          <span class="hr-kicker">Senast öppnad</span>
          <span class="hr-name">${esc(courseCaption(course))}</span>
        </span>
        <span class="hr-mode">${activities[mode].icon}${MODES[mode].label}</span>
        <span class="hr-go" aria-hidden="true">${ARROW}</span>
      </button>`;
    const btn = resumeSlot.querySelector('[data-resume]');
    btn.setAttribute('aria-label', `Öppna ${layoutLabel(course)} i ${MODES[mode].label}`);
    btn.addEventListener('click', () => onResume(course.slug, mode));
  }

  /* The phone's position, read only where it has already said yes -- asking belongs
     to a tap (Klubbar nära mig, or the list's sort). It gives the lobby its nearest
     clubs and, standing at a course, that course's round. */
  let nearAsked = false;
  function lookNear() {
    if (!playable.length || nearAsked || !navigator.permissions || !navigator.geolocation) return;
    nearAsked = true;
    navigator.permissions.query({ name: 'geolocation' }).then(answer => {
      if (answer.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition(({ coords }) => placed(coords), () => {}, { timeout: 10000, maximumAge: 120000 });
    }).catch(() => {});
  }
  function placed(coords) {
    place = coords;
    placeFailed = false;
    offerNear(coords);
    renderClubList();
  }
  /* Standing at a course: the menu offers that course's round, never over a round
     under way, which refresh() has shown first. */
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

  /* Installed, Banvy opens from the home screen with no browser round it and works
     without signal on a course it has seen: the menu offers it where the browser can,
     and never once it is installed. */
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
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* the browser said no */ }
  });
  for (const link of el.querySelectorAll('.mode-card')) {
    link.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      const key = link.dataset.mode;
      if (key === 'settings') onSettings(); else if (key === 'stats') onStats(); else onMode(key);
    });
  }
  /* 1 to 5 -- only while the menu is what is on screen, never out of a field */
  addEventListener('keydown', e => {
    if (el.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    /* "/" reaches the lobby's search, as it reaches the list's */
    if (e.key === '/' && !searchBox.hidden && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      queryInput.focus();
      queryInput.select();
      return;
    }
    if (e.key === '1') onMode('detailed');
    else if (e.key === '2') onMode('map');
    else if (e.key === '3') onMode('play');
    else if (e.key === '4') onStats();
    else if (e.key === '5') onSettings();
  });

  refresh();
  el.refresh = refresh;
  return el;
}
