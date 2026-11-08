/* ===========================================================================
   Banvy Course Hub & Main Menu
   A showcase for Swedish golf courses in 3D with rich hero cards,
   categories, instant search, and an interactive Sweden OpenStreetMap.

   ONE DOM, TWO SHAPES. The same markup is a wide poster grid on a desktop and a
   two-up gallery on a phone; every difference between them is CSS (shell.css),
   because a second phone-only tree is a second thing to keep true. What the
   phone shape is FOR was measured before it was drawn, at 390x844:

     before  one card fully on screen, 233 px (28%) of fixed chrome that never
             scrolled away, 4434 px of list, and a fourth filter chip that was
             cut off and could not be reached at all
     after   six cards on screen, 56 px of chrome once the list moves, and
             every control at least 40 px tall

   tools/check-chooser-ui.mjs holds those numbers as a gate.

   ONE LIST, TWO MODES (7 November). The start menu asks first how the visitor
   wants to play -- the detailed course or the light map for a real round -- and
   this list is the courses FOR that mode. It used to decide by device without
   saying so: a card opened the map on a phone and the detailed course on a
   desktop, and a small "Karta" or "3D" chip on each card was the only way to
   the other. Now the mode is named at the top, switches in place, and every
   card and call to action says what it opens.
   =========================================================================== */
import '../styles/shell.css';
import { ICONS } from './icons.js';
import { isPhone } from './map-default.mjs';
import { hubUrl, mapUrl } from './router.js';
import { COURSE_PREVIEWS } from '../course-previews.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { coursesByDistance, distanceText } from './nearest-course.mjs';
import { LAST_COURSE_KEY, MODES, launchUrl, liveRound, readSettings, rememberLaunch } from './settings-store.mjs';

/* `places` is search vocabulary only, never shown: the placeholder promises
   "bana, ort eller par", and a promise on the front door has to be kept. It
   used to search name, club, tag and blurb -- so "Västerås" did not find Ängsö
   and "72" found nothing at all. */
const CATEGORIES = {
  visby: { id: 'kust', label: 'Kronholmen · Seaside', iconName: 'wave', places: 'Gotland Västergarn Visby' },
  lidingo: { id: 'skog', label: 'Lidingö · Parkbana', iconName: 'tree', places: 'Stockholm Sticklinge' },
  tortuna: { id: 'skog', label: 'Västerås · Skog & Park', iconName: 'tree', places: 'Västmanland Mälardalen' },
  angso: { id: 'kust', label: 'Mälaren · Halvö', iconName: 'wave', places: 'Västerås Västmanland Mälardalen' },
  norrfallsviken: { id: 'kust', label: 'Höga Kusten · Seaside', iconName: 'wave', places: 'Mjällom Nordingrå Kramfors Ångermanland' },
  puttom: { id: 'skog', label: 'Örnsköldsvik · Skog & Sjö', iconName: 'tree', places: 'Arnäsvall Ångermanland Höga Kusten' },
  upsala: { id: 'skog', label: 'Uppsala · Parkbana', iconName: 'tree', places: 'Håmö Uppland' },
  johannesberg: { id: 'slott', label: 'Gottröra · Slottsmiljö', iconName: 'castle', places: 'Uppland Roslagen' },
  veckefjarden: { id: 'kust', label: 'Örnsköldsvik · Ö-green', iconName: 'wave', places: 'Ångermanland Höga Kusten' },
  ribbingsfors: { id: 'skog', label: 'Gullspång · Park & Hagmark', iconName: 'tree', places: 'Skagern Västra Götaland' },
  /* the second courses, categorised with the club they belong to */
  'upsala-mellanbanan': { id: 'skog', label: 'Uppsala · Andra nio', iconName: 'tree', places: 'Håmö Uppland' },
  'johannesberg-9': { id: 'slott', label: 'Gottröra · Andra nio', iconName: 'castle', places: 'Uppland Roslagen' },
  'veckefjarden-korthalsbanan': { id: 'kust', label: 'Örnsköldsvik · Korthål', iconName: 'wave', places: 'Ångermanland Höga Kusten' },
};

const LINES = {
  tortuna: 'Skogsslinga och parkhål vid Tortuna nordost om Västerås, ritad av Bengt Husell och spelklar 1991: en stor damm delar fyran och sexan, och Lillån slingrar genom de nio parkhålen.',
  lidingo: 'Sveriges första 18-hålsbana, spelklar 1927 på Sticklinge: en kuperad parkbana bland villor och skogsdungar, ombyggd av Peter Chamberlain 2006–2009 med hårda, ondulerade greener.',
  veckefjarden: 'Mästerskapsbanan vid fjärden, känd för sin ikoniska ö-green och utmanande vattenhinder.',
  norrfallsviken: 'Dramatisk skogs- och linkskaraktär på Mjällomlandet med klippor direkt mot Bottenhavet.',
  puttom: 'Naturskön skogs- och parkbana som slingrar sig elegant mellan två glittrande sjöar.',
  angso: 'Mälarnära bana på halvön norr om Ängsön med fem tees, mäktiga ekar och strategisk bunkring.',
  upsala: 'Klassisk svensk mästerskapsparkbana på historiska Håmö gårds böljande marker väster om Uppsala.',
  johannesberg: 'Slottsbana i rofylld herrgårdsmiljö med dammar, månghundraåriga ekar och ståtligt klubbhus.',
  ribbingsfors: 'Niohåls park- och hagmarksbana i herrgårdsmiljö vid sjön Skagern, ritad av Janne Lundvall och spelklar 1991.',
  'upsala-mellanbanan': 'Upsala GK:s andra nio, där åttans tee blickar ut över stora banan och fyrans green ligger tjugo meter från dammen.',
  'johannesberg-9': 'Johannesbergs andra nio, med en damm tvärs igenom och ett andrahål som faller drygt tolv meter ner mot vattnet.',
  'veckefjarden-korthalsbanan': 'Veckefjärdens korthålsbana: nio korta hål i tallskogen, med fjärden i sikte från tredje tee.',
  visby: 'Seaside med linkskaraktär på Kronholmen vid Västergarn, spelad sedan 1958 och rankad som Sveriges bästa bana av Svensk Golf 2020; Östersjön ligger några tiotal meter från de flesta greenerna, greenerna ombyggda av Pierre Fulke.',
};

/* the course page (course-sheet.js) tells the same story under its posters */
export const COURSE_LINES = LINES;

const TEE_WORD = n => `${n} tees`;

/* The resting poster. The first cards are what the visitor sees before anything
   can run, so theirs is in the markup; the rest carry it as data and are painted
   as they come near the screen (see "card posters" below). */
const EAGER_POSTERS = 6;
const posterAttr = (c, index) => {
  if (!c.photos && !c.overviewUrl) return '';
  const url = `${import.meta.env.BASE_URL}${c.photos ? `courses/${c.slug}/hero-1.webp` : c.overviewUrl}`;
  return index < EAGER_POSTERS ? `style="background-image: url('${url}')"` : `data-bg="${url}"`;
};

/* The course a returning golfer almost certainly wants is the one they had open
   last, so it leads the list. Written by the player (buildRail is its boot-time
   call), read by the bare hub. Storage can be absent or refuse -- private
   windows, blocked site data -- and the chooser is exactly as usable without. */
export function lastCourse() {
  try { return localStorage.getItem(LAST_COURSE_KEY); } catch { return null; }
}
const storage = () => { try { return localStorage; } catch { return null; } };

/* What each mode promises, under the switch. */
const MODE_LINES = {
  detailed: n => `${n} banor i full 3D-grafik. Flyg längs hålen, läs greenerna och mät varje slag.`,
  map: n => `${n} banor som snabb 3D-karta för rundan: GPS-avstånd, klubbhjulet och scorekortet.`,
};
const MODE_ICON = {
  detailed: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>',
};
const MODE_SUB = { detailed: 'Full grafik · hemma', map: 'GPS · på banan' };

/* `context` is where the list lives: 'hub', the start menu's own page, or
   'player', the glass over a running course (main.js). `mode` is which way the
   cards open, and setMode() changes it in place. */
export function buildRail({ courses, current, last = null, onPick, onIntent, isInitialBoot = false,
  context = 'player', mode: initialMode = 'detailed', onModeChange = null, onHome = null, onSettings = null }) {
  const phone = isPhone();
  let mode = MODES[initialMode] ? initialMode : 'detailed';
  courses = [...courses, ...COURSE_PREVIEWS.filter(p => !courses.some(c => c.slug === p.slug))];
  /* A named course is a chosen course, and the player is the detailed one. A
     bare visit to the player boots the manifest's first entry, which nobody
     chose, so that one is not remembered. */
  if (current && !isInitialBoot) rememberLaunch(storage(), current, 'detailed');
  /* a round under way in the map, marked on its course's card */
  const live = liveRound(storage(), courses);

  const el = document.createElement('div');
  el.id = 'chooser';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Välj bana');

  const currentCourse = courses.find(c => c.slug === current);
  /* The lead card: the running course in the player, the last one opened on the
     hub. Everything else keeps the manifest's order. */
  const leadSlug = [current, last].find(s => s && courses.some(c => c.slug === s)) || null;
  const ordered = leadSlug
    ? [courses.find(c => c.slug === leadSlug), ...courses.filter(c => c.slug !== leadSlug)]
    : courses;

  /* Counted, never written down. A static total goes stale the moment a course
     is added, which makes the front door tell the visitor something untrue. */
  const nCat = id => courses.filter(c => (CATEGORIES[c.slug] || {}).id === id).length;
  const nPlayable = courses.filter(c => c.status !== 'mapping').length;
  const nMapping = courses.length - nPlayable;
  /* ...and the same goes for the sentence: it used to promise "nya banor under
     kartläggning" on a list that had none. A course still being mapped has no
     light map, so it is only counted where it can be opened. */
  const subtitleFor = m => MODE_LINES[m](nPlayable) +
    (nMapping && m === 'detailed' ? ` Följ också ${nMapping} ${nMapping === 1 ? 'bana' : 'banor'} under kartläggning.` : '');
  const ctaFor = (c, m = mode) => (c.status === 'mapping' ? 'Visa bankarta'
    : c.slug === current && m === 'detailed' ? 'Fortsätt spela'
    : c.slug === leadSlug ? 'Fortsätt' : MODES[m].cta);
  const cardLabel = (c, m = mode) =>
    `${c.name}${c.club && c.club !== c.name ? `, ${c.club}` : ''}. Par ${c.par}, ${c.holes} hål. ${ctaFor(c, m)}${c.status === 'mapping' ? '' : ` i ${MODES[m].label}`}.`;
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

        <div class="chooser-top-actions">
          <div class="chooser-view-toggle" id="chooserViewToggle" role="group" aria-label="Visa som">
            <button class="c-view-btn active" type="button" data-view="grid" id="viewGridBtn" title="Visa som kort" aria-pressed="true">
              ${ICONS.gridCards(15)}
              <span class="cv-long">Kortvy</span><span class="cv-short">Kort</span>
            </button>
            <button class="c-view-btn" type="button" data-view="map" id="viewMapBtn" title="Visa på Sverigekarta" aria-pressed="false">
              ${ICONS.map(15)}
              <span class="cv-long">Sverigekarta</span><span class="cv-short">Karta</span>
            </button>
          </div>

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
          <h1 class="chooser-main-title">Välj bana</h1>
          <div class="chooser-modes" id="chooserModes" role="radiogroup" aria-label="Spela i">
            ${Object.entries(MODES).map(([key, m]) => `
              <button class="c-mode-btn" type="button" role="radio" data-mode="${key}" aria-checked="${key === mode}">
                <span class="cm-icon">${MODE_ICON[key]}</span>
                <span class="cm-text"><b>${m.label}</b><small>${MODE_SUB[key]}</small></span>
              </button>`).join('')}
          </div>
        </div>
        <p class="chooser-subtitle" id="chooserSubtitle">${subtitleFor(mode)}</p>
      </div>

      <div class="chooser-controls" id="chooserControls">
        <div class="chooser-search-box">
          ${ICONS.search(16)}
          <input type="search" id="courseSearchInput" placeholder="Sök bana, ort eller par…"
                 aria-label="Sök bana, ort eller par" autocomplete="off" autocapitalize="off"
                 spellcheck="false" enterkeyhint="search" />
          <kbd class="search-key" aria-hidden="true">/</kbd>
          <button class="search-clear" type="button" id="courseSearchClear" aria-label="Rensa sökningen" hidden>${ICONS.close(14)}</button>
          ${phone ? `<button class="chooser-near" type="button" id="chooserNear" aria-pressed="false" aria-label="Visa banorna närmast mig först">${ICONS.pin(18)}</button>` : ''}
        </div>

        <div class="chooser-filters" id="chooserFilters" role="group" aria-label="Filtrera på bantyp">
          ${filterBtn('all', 'Alla banor', 'Alla', courses.length)}
          ${filterBtn('kust', 'Kust & Hav', 'Kust', nCat('kust'), ICONS.wave(13))}
          ${filterBtn('skog', 'Skog & Park', 'Skog', nCat('skog'), ICONS.tree(13))}
          ${filterBtn('slott', 'Slott & Herrgård', 'Slott', nCat('slott'), ICONS.castle(13))}
        </div>
        <span class="chooser-count" id="chooserCount" role="status" aria-live="polite"></span>
      </div>

      <div class="chooser-scroll" id="chooserScroll">
        <!-- Grid Cards View -->
        <div id="cardsViewWrap" class="cards-view-wrap">
          <ul class="cards" id="coursesCardList">
            ${ordered.map((c, index) => {
              const cat = CATEGORIES[c.slug] || { id: 'all', label: c.tag, iconName: 'flag' };
              const iconSvg = ICONS[cat.iconName] ? ICONS[cat.iconName](13) : ICONS.flag(13);
              const isCurrent = c.slug === current;
              const isLead = c.slug === leadSlug;
              /* "Place · kind". The icon already says the kind, so a narrow card
                 keeps the place and lets the rest go. */
              const [place, ...kind] = String(cat.label || '').split(' · ');
              const search = [c.name, c.club, c.tag, cat.label, cat.places, `par ${c.par}`, `${c.holes} hål`, LINES[c.slug]]
                .filter(Boolean).join(' ').toLowerCase();
              return `
                <li class="card-item${isLead ? ' is-lead' : ''}" data-slug="${c.slug}" data-category="${cat.id}" data-status="${esc(c.status || 'playable')}" data-search="${esc(search)}">
                  <button class="card ${isCurrent ? 'is-current' : ''}" type="button" data-slug="${c.slug}"
                          aria-label="${esc(cardLabel(c))}">
                    <div class="shot" data-slug="${c.slug}" data-photos="${c.photos || 0}" ${posterAttr(c, index)}>
                      <span class="shot-frames" aria-hidden="true"></span>
                      <div class="shot-badges">
                        <span class="cat-badge">${iconSvg}<span class="cat-text"><span class="cat-place">${esc(place)}</span>${kind.length ? `<span class="cat-kind"> · ${esc(kind.join(' · '))}</span>` : ''}</span></span>
                        ${live?.course.slug === c.slug ? '<span class="current-badge is-live">Runda pågår</span>'
                          : isCurrent ? '<span class="current-badge">Aktiv bana</span>' : isLead ? '<span class="current-badge is-last">Senast spelad</span>' : ''}
                        ${c.status === 'mapping' ? '<span class="current-badge">Under kartläggning</span>' : ''}
                        ${c.status === 'provisional' ? '<span class="current-badge">Preliminär 3D</span>' : ''}
                      </div>
                      <div class="on-shot">
                        <p class="where">${esc(c.club)}</p>
                        <h2>${esc(c.name)}</h2>
                      </div>
                      <div class="shot-hover-action">
                        <span class="sha-text">${ctaFor(c)}</span>
                        <span class="sha-arrow">→</span>
                      </div>
                    </div>
                    <div class="body">
                      <p class="line">${esc(c.description || LINES[c.slug] || c.club)}</p>
                      <div class="facts">
                        <div class="fact-item"><span class="f-lbl">Par</span> <b class="f-val">${c.par}</b></div>
                        <div class="fact-item"><span class="f-lbl">Hål</span> <b class="f-val">${c.holes}</b></div>
                        <div class="fact-item fact-tees"><span class="f-lbl">Utslag</span> <b class="f-val">${TEE_WORD(c.tees.names.length)}</b></div>
                        <div class="fact-item fact-tag"><b>${c.status === 'mapping' ? 'Bankarta' : mode === 'map' ? 'GPS' : '3D'}</b></div>
                        <span class="fact-go" aria-hidden="true">${ICONS.chevronRight(14, 2.4)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              `;
            }).join('')}
          </ul>
          <div id="noCoursesMsg" class="no-courses-msg" hidden>
            <p>Inga banor matchar din sökning.</p>
            <button type="button" id="resetSearchBtn">Visa alla banor</button>
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
  const cardItems = el.querySelectorAll('.card-item');
  const noMsg = el.querySelector('#noCoursesMsg');
  const resetBtn = el.querySelector('#resetSearchBtn');
  const countEl = el.querySelector('#chooserCount');
  const controls = el.querySelector('#chooserControls');
  const filtersEl = el.querySelector('#chooserFilters');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let activeFilter = 'all';
  let activeQuery = '';

  function applyFilters() {
    let visibleCount = 0;
    let openable = 0;
    cardItems.forEach(item => {
      const matchMode = mode !== 'map' || item.dataset.status !== 'mapping';
      const matchCat = activeFilter === 'all' || item.dataset.category === activeFilter;
      const matchQuery = !activeQuery || item.dataset.search.includes(activeQuery);
      if (matchMode) openable++;
      item.hidden = !(matchMode && matchCat && matchQuery);
      if (!item.hidden) visibleCount++;
    });
    noMsg.hidden = visibleCount !== 0;
    const narrowed = activeFilter !== 'all' || !!activeQuery;
    countEl.textContent = narrowed
      ? `${visibleCount} av ${openable} banor`
      : `${openable} banor`;
    /* An active query keeps the search field pinned beside the chips (see
       shell.css): a list narrowed by words you can no longer see is a list
       that looks broken. */
    controls.classList.toggle('has-query', !!activeQuery);
    searchClear.hidden = !activeQuery;
  }

  /* On a course a golfer wants that course, without searching for it. The position is
     asked for by a tap, and read by itself only where the phone has already said yes. */
  const nearBtn = el.querySelector('#chooserNear');
  if (nearBtn) {
    const cardList = el.querySelector('#coursesCardList');
    const showNearest = ({ coords }) => {
      const items = new Map([...cardItems].map(item => [item.dataset.slug, item]));
      const sorted = coursesByDistance(coords, COURSE_LOCATIONS).filter(({ slug }) => items.has(slug));
      for (const { slug, metres } of sorted) {
        const badges = items.get(slug).querySelector('.shot-badges');
        badges.querySelector('.is-near')?.remove();
        const badge = document.createElement('span');
        badge.className = 'current-badge is-near';
        badge.textContent = distanceText(metres);
        badges.prepend(badge);
      }
      cardList.prepend(...sorted.map(({ slug }) => items.get(slug)));
      cardItems.forEach(item => item.classList.toggle('is-lead', item === items.get(sorted[0]?.slug)));
      nearBtn.classList.remove('is-busy');
      nearBtn.setAttribute('aria-pressed', 'true');
    };
    const locate = () => {
      nearBtn.classList.add('is-busy');
      navigator.geolocation?.getCurrentPosition(showNearest, () => {
        nearBtn.classList.remove('is-busy');
        countEl.textContent = 'Positionen gick inte att läsa';
      }, { timeout: 12000, maximumAge: 120000 });
    };
    nearBtn.addEventListener('click', locate);
    if (!current) navigator.permissions?.query({ name: 'geolocation' }).then(answer => { if (answer.state === 'granted') locate(); }).catch(() => {});
  }

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
    activeQuery = e.target.value.trim().toLowerCase();
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
    if (el.hidden || !el.isConnected || el.classList.contains('map-mode')) return;
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

  /* A pick opens the course in the mode on the switch. Over a running course
     the detailed pick is main.js's (the same course just closes the glass); a
     light-map pick is a plain navigation wherever the list lives. */
  /* Over a running course (8 November) a pick opens the course's own page too, so a
     round is set up the same way from anywhere; the running course itself, picked in
     its own mode, just closes the glass. A harness's det and hero ride along. */
  let sheet = null;
  const pick = async slug => {
    if (context === 'hub' || (slug === current && mode === 'detailed')) { onPick(slug, mode); return; }
    try {
      if (!sheet) {
        const { createCourseSheet } = await import('./course-sheet.js');
        sheet = createCourseSheet({ courses, lines: LINES, onLaunch: (s, m, plan) => {
          rememberLaunch(storage(), s, m);
          const params = new URLSearchParams(launchUrl(s, m, { phone, settings: readSettings(storage()), plan }).slice(1));
          const from = new URLSearchParams(location.search);
          for (const key of ['det', 'hero', 'q', 'gl']) if (from.has(key) && !params.has(key)) params.set(key, from.get(key));
          location.search = `?${params}`;
        } });
      }
      sheet.open(slug, mode);
    } catch {
      /* the page could not load: go as the list always did */
      if (mode === 'map') { rememberLaunch(storage(), slug, 'map'); location.search = mapUrl(slug); } else onPick(slug, mode);
    }
  };
  el.querySelectorAll('.card').forEach(btn => {
    btn.addEventListener('click', () => pick(btn.dataset.slug));
    if (onIntent) {
      let hinted = false;
      const hint = () => { if (!hinted) { hinted = true; onIntent(btn.dataset.slug); } };
      /* A mouse resting on a card is intent; a finger landing on one is a
         scroll. On a touch screen pointerenter fires for every swipe that
         happens to start on a card, and each would have fetched a whole course
         pack over a phone's connection. */
      btn.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') hint(); });
      btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) hint(); });
    }
  });

  /* ------------------------------------------------------------ card posters
     Each card carries several stills of its own course and crossfades between
     them. What keeps that from costing anything was MEASURED, because the first
     cut of the two-up gallery got it badly wrong: with six to eight cards on a
     phone's screen instead of one, the front door pulled 54 posters -- 3.5 MB --
     inside two seconds of opening, against 21 and 1.35 MB for the single column
     it replaced. Decoration had become most of the page's weight. So:

     - hero-1 is the .shot background, set at once for the first cards and only
       when a card comes near the screen for the rest: a poster nobody scrolls
       to is never fetched, which is what lets the list grow past thirteen.
     - every card rolls through all of its stills, the phone's small tiles
       included. They used to stay still below 260 px, on the reasoning that
       eight small pictures changing is restlessness rather than motion; the
       owner looked at it on a phone and wanted them rolling (2026-09-19), and
       the owner's eye decides. What keeps that affordable is the queue below,
       not the width: a phone tile pays only while it is ON SCREEN.
     - ONE queue for the whole list, one fetch at a time, a pause between
       fetches, lowest frame first: every visible card gets its second poster
       before any gets its fifth, and a visitor who picks a course five seconds
       in has paid for a handful of extras instead of forty.
     - one timer drives every card, each with its own phase, because all cards
       flipping in unison reads as a glitch rather than as motion.

     Reduced motion gets the resting poster and no fetches: the extra stills are
     decoration, and decoration is exactly what that preference is about. So
     does a visitor who has asked their browser to save data. */
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

  const SAVE_DATA = !!(navigator.connection && navigator.connection.saveData);
  const SLIDE_MS = 5400, STAGGER_MS = 900;
  const FETCH_GAP_MS = 650;     /* between two extra posters, so the queue trickles and never bursts */
  const shows = [];
  if (!REDUCED && !SAVE_DATA) {
    el.querySelectorAll('.shot[data-photos]').forEach((shot, i) => {
      const count = +shot.dataset.photos || 1;
      if (count < 2) return;
      shows.push({ slug: shot.dataset.slug, count, shot, wrap: shot.querySelector('.shot-frames'),
                   frames: [], idx: 0, phase: i,
                   nextAt: performance.now() + SLIDE_MS + i * STAGGER_MS,
                   queued: false, visible: false });
    });
  }

  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 700));
  const pending = [];
  let fetching = false;
  const pump = () => {
    if (fetching || el.hidden || document.hidden) return;
    let best = -1;
    for (let k = 0; k < pending.length; k++) {
      if (!pending[k].s.visible) continue;
      if (best < 0 || pending[k].i < pending[best].i) best = k;
    }
    if (best < 0) return;
    const { s, i } = pending.splice(best, 1)[0];
    fetching = true;
    const url = `${import.meta.env.BASE_URL}courses/${s.slug}/hero-${i}.webp`;
    const done = () => setTimeout(() => { fetching = false; idle(pump); }, FETCH_GAP_MS);
    /* decode before it is ever shown -- a frame that fades in while still
       downloading crossfades to an empty rectangle */
    const img = new Image();
    img.onload = () => {
      const layer = document.createElement('i');
      layer.style.backgroundImage = `url('${url}')`;
      s.wrap.append(layer);
      s.frames.push(layer);
      done();
    };
    /* a missing poster ends this card's set rather than the whole slideshow */
    img.onerror = () => {
      for (let k = pending.length - 1; k >= 0; k--) if (pending[k].s === s) pending.splice(k, 1);
      done();
    };
    img.src = url;
  };
  const ensureFrames = s => {
    if (!s.queued) {
      s.queued = true;
      for (let i = 2; i <= s.count; i++) pending.push({ s, i });
    }
    idle(pump);
  };

  if (shows.length) {
    const byShot = new Map(shows.map(s => [s.shot, s]));
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const s = byShot.get(e.target);
        if (!s) continue;
        s.visible = e.isIntersecting;
        if (e.isIntersecting) ensureFrames(s);
      }
    }, { root: el });
    shows.forEach(s => io.observe(s.shot));

    setInterval(() => {
      /* The chooser is an overlay: when it is shut, or the tab is in the
         background, nothing here should be animating. Re-arm each card as we
         wait, keeping its stagger -- otherwise every card comes back owing
         several turns and they all flip together the moment it reopens, which
         is the one thing the stagger exists to prevent. */
      const now = performance.now();
      if (el.hidden || document.hidden) {
        for (const s of shows)
          if (now > s.nextAt) s.nextAt = now + SLIDE_MS + s.phase * STAGGER_MS;
        return;
      }
      pump();
      for (const s of shows) {
        if (!s.visible || s.frames.length < 1 || now < s.nextAt) continue;
        s.nextAt = now + SLIDE_MS;
        s.idx = (s.idx + 1) % (s.frames.length + 1);
        s.frames.forEach((f, k) => f.classList.toggle('is-on', k === s.idx - 1));
      }
    }, 400);
  }

  // Map View Initialization
  const cardsWrap = el.querySelector('#cardsViewWrap');
  const mapWrap = el.querySelector('#mapViewWrap');
  const viewGridBtn = el.querySelector('#viewGridBtn');
  const viewMapBtn = el.querySelector('#viewMapBtn');

  let swedenMapInstance = null;

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
    if (!map) return;
    el.scrollTop = 0;
    if (!swedenMapInstance) {
      const { createSwedenMap } = await import('./map.js');
      swedenMapInstance = createSwedenMap({
        container: mapWrap,
        courses: courses.filter(c => mode !== 'map' || c.status !== 'mapping'),
        current,
        lead: leadSlug,
        onPickCourse: pick,
        ctaFor: c => (c.status === 'mapping' ? 'Visa bankarta' : `${ctaFor(c)} · ${MODES[mode].label}`),
      });
    }
    swedenMapInstance.invalidateSize();
  }

  viewGridBtn.addEventListener('click', () => switchView('grid'));
  viewMapBtn.addEventListener('click', () => switchView('map'));

  /* ------------------------------------------------------------ the mode */
  const modeBtns = [...el.querySelectorAll('.c-mode-btn')];
  const subtitleEl = el.querySelector('#chooserSubtitle');
  function setMode(next) {
    if (!MODES[next]) return;
    mode = next;
    el.dataset.mode = mode;
    modeBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    subtitleEl.textContent = subtitleFor(mode);
    for (const c of courses) {
      const item = el.querySelector(`.card-item[data-slug="${c.slug}"]`);
      if (!item) continue;
      item.querySelector('.card').setAttribute('aria-label', cardLabel(c));
      item.querySelector('.sha-text').textContent = ctaFor(c);
      const tag = item.querySelector('.fact-tag b');
      if (tag && c.status !== 'mapping') tag.textContent = mode === 'map' ? 'GPS' : '3D';
    }
    applyFilters();
    /* the map's pins were placed for the other mode's list; it rebuilds on next open */
    if (swedenMapInstance) { swedenMapInstance.map.remove(); swedenMapInstance.el.remove(); swedenMapInstance = null; }
    if (el.classList.contains('map-mode')) switchView('map');
  }
  el.dataset.mode = mode;
  modeBtns.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === mode) return;
    if (onModeChange) onModeChange(b.dataset.mode); else setMode(b.dataset.mode);
  }));
  /* the radio group's own keys: an arrow moves the choice, as in any radio group */
  el.querySelector('#chooserModes').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const i = modeBtns.findIndex(b => b.dataset.mode === mode);
    const next = modeBtns[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? modeBtns.length - 1 : 1)) % modeBtns.length];
    next.click();
    next.focus();
  });
  if (context === 'hub') {
    el.querySelector('#chooserBack')?.addEventListener('click', () => onHome?.());
    el.querySelector('#chooserSettings')?.addEventListener('click', () => onSettings?.());
  }

  el.setMode = setMode;
  el.getMode = () => mode;
  return el;
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
