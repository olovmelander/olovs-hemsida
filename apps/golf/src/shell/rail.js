/* ===========================================================================
   Banvy Course Hub & Main Menu
   A showcase for Swedish golf courses in 3D with rich hero cards,
   categories, instant search, and an interactive Sweden OpenStreetMap.
   =========================================================================== */
import '../styles/shell.css';
import { ICONS } from './icons.js';

const CATEGORIES = {
  angso: { id: 'kust', label: 'Mälaren · Halvö', iconName: 'wave' },
  norrfallsviken: { id: 'kust', label: 'Höga Kusten · Seaside', iconName: 'wave' },
  puttom: { id: 'skog', label: 'Örnsköldsvik · Skog & Sjö', iconName: 'tree' },
  upsala: { id: 'skog', label: 'Uppsala · Parkbana', iconName: 'tree' },
  johannesberg: { id: 'slott', label: 'Gottröra · Slottsmiljö', iconName: 'castle' },
  veckefjarden: { id: 'kust', label: 'Örnsköldsvik · Ö-green', iconName: 'wave' },
};

const LINES = {
  veckefjarden: 'Mästerskapsbanan vid fjärden, känd för sin ikoniska ö-green och utmanande vattenhinder.',
  norrfallsviken: 'Dramatisk skogs- och linkskaraktär på Mjällomlandet med klippor direkt mot Bottenhavet.',
  puttom: 'Naturskön skogs- och parkbana som slingrar sig elegant mellan två glittrande sjöar.',
  angso: 'Mälarnära bana på halvön norr om Ängsön med fem tees, mäktiga ekar och strategisk bunkring.',
  upsala: 'Klassisk svensk mästerskapsparkbana på historiska Håmö gårds böljande marker väster om Uppsala.',
  johannesberg: 'Slottsbana i rofylld herrgårdsmiljö med dammar, månghundraåriga ekar och ståtligt klubbhus.',
};

const TEE_WORD = n => `${n} tees`;

export function buildRail({ courses, current, onPick, onIntent, isInitialBoot = false }) {
  const el = document.createElement('div');
  el.id = 'chooser';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Välj bana');

  const currentCourse = courses.find(c => c.slug === current);

  el.innerHTML = `
    <div class="chooser-top-bar">
      <div class="chooser-brand">
        <div class="brand-crest">
          <span class="crest-dot"></span>
          <span class="wordmark">Ban<i>v</i>y</span>
        </div>
        <span class="hub-pill">3D Golf Experience</span>
      </div>

      <div class="chooser-top-actions">
        <div class="chooser-view-toggle" id="chooserViewToggle">
          <button class="c-view-btn active" data-view="grid" id="viewGridBtn" title="Visa som kort">
            ${ICONS.gridCards(14)}
            <span>Kortvy</span>
          </button>
          <button class="c-view-btn" data-view="map" id="viewMapBtn" title="Visa på Sverigekarta">
            ${ICONS.map(14)}
            <span>Sverigekarta</span>
          </button>
        </div>

        ${!isInitialBoot && currentCourse ? `
          <button class="chooser-resume-btn" id="chooserResumeBtn">
            <span>Återgå till ${esc(currentCourse.name)}</span>
            ${ICONS.close(14)}
          </button>
        ` : ''}
      </div>
    </div>

    <div class="chooser-head">
      <div class="chooser-title-wrap">
        <h1 class="chooser-main-title">Välj golfbana</h1>
        <p class="chooser-subtitle">Utforska sex unika svenska golfbanor mätta mot klubbarnas originalkort och modellerade i full 3D-terräng.</p>
      </div>

      <div class="chooser-controls" id="chooserControls">
        <div class="chooser-search-box">
          ${ICONS.search(16)}
          <input type="text" id="courseSearchInput" placeholder="Sök bana, stad eller par..." autocomplete="off" />
        </div>

        <div class="chooser-filters" id="chooserFilters">
          <button class="c-filter-btn active" data-filter="all">Alla banor (6)</button>
          <button class="c-filter-btn" data-filter="kust">${ICONS.wave(13)} Kust & Hav (3)</button>
          <button class="c-filter-btn" data-filter="skog">${ICONS.tree(13)} Skog & Park (2)</button>
          <button class="c-filter-btn" data-filter="slott">${ICONS.castle(13)} Slott & Herrgård (1)</button>
        </div>
      </div>
    </div>

    <div class="chooser-scroll" id="chooserScroll">
      <!-- Grid Cards View -->
      <div id="cardsViewWrap" class="cards-view-wrap">
        <ul class="cards" id="coursesCardList">
          ${courses.map(c => {
            const cat = CATEGORIES[c.slug] || { id: 'all', label: c.tag, iconName: 'flag' };
            const iconSvg = ICONS[cat.iconName] ? ICONS[cat.iconName](13) : ICONS.flag(13);
            const isCurrent = c.slug === current;
            return `
              <li class="card-item" data-slug="${c.slug}" data-category="${cat.id}" data-search="${esc(c.name + ' ' + c.club + ' ' + c.tag + ' ' + (LINES[c.slug] || '')).toLowerCase()}">
                <button class="card ${isCurrent ? 'is-current' : ''}" type="button" data-slug="${c.slug}">
                  <div class="shot" style="background-image: url('/courses/${c.slug}/hero-1.png')">
                    <div class="shot-badges">
                      <span class="cat-badge">${iconSvg} <span>${esc(cat.label)}</span></span>
                      ${isCurrent ? '<span class="current-badge">Aktiv bana</span>' : ''}
                    </div>
                    <div class="on-shot">
                      <p class="where">${esc(c.club)}</p>
                      <h2>${esc(c.name)}</h2>
                    </div>
                    <div class="shot-hover-action">
                      <span>${isCurrent ? 'Fortsätt spela' : 'Starta bana'}</span>
                      <span class="sha-arrow">→</span>
                    </div>
                  </div>
                  <div class="body">
                    <p class="line">${esc(LINES[c.slug] || c.club)}</p>
                    <div class="facts">
                      <div class="fact-item"><span class="f-lbl">Par</span> <b class="f-val">${c.par}</b></div>
                      <div class="fact-item"><span class="f-lbl">Hål</span> <b class="f-val">${c.holes}</b></div>
                      <div class="fact-item"><span class="f-lbl">Utslag</span> <b class="f-val">${TEE_WORD(c.tees.names.length)}</b></div>
                      <div class="fact-item fact-tag"><b>3D</b></div>
                    </div>
                  </div>
                </button>
              </li>
            `;
          }).join('')}
        </ul>
        <div id="noCoursesMsg" class="no-courses-msg" style="display:none;">
          <p>Inga banor matchar din sökning.</p>
          <button id="resetSearchBtn">Återställ sökning</button>
        </div>
      </div>

      <!-- Sweden Map View Wrap -->
      <div id="mapViewWrap" class="map-view-wrap" style="display: none;"></div>
    </div>
  `;

  // Search and Filter Logic
  const searchInput = el.querySelector('#courseSearchInput');
  const filterBtns = el.querySelectorAll('.c-filter-btn');
  const cardItems = el.querySelectorAll('.card-item');
  const noMsg = el.querySelector('#noCoursesMsg');
  const resetBtn = el.querySelector('#resetSearchBtn');

  let activeFilter = 'all';
  let activeQuery = '';

  function applyFilters() {
    let visibleCount = 0;
    cardItems.forEach(item => {
      const matchCat = activeFilter === 'all' || item.dataset.category === activeFilter;
      const matchQuery = !activeQuery || item.dataset.search.includes(activeQuery);
      if (matchCat && matchQuery) {
        item.style.display = '';
        visibleCount++;
      } else {
        item.style.display = 'none';
      }
    });
    noMsg.style.display = visibleCount === 0 ? 'block' : 'none';
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      activeQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      activeQuery = '';
      activeFilter = 'all';
      filterBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
      applyFilters();
    });
  }

  // Course Pick Handler
  el.querySelectorAll('.card').forEach(btn => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug;
      onPick(slug);
    });
    if (onIntent) {
      const hint = () => onIntent(btn.dataset.slug);
      btn.addEventListener('pointerenter', hint, { once: true });
      btn.addEventListener('focus', hint, { once: true });
    }
  });

  // Map View Initialization
  const cardsWrap = el.querySelector('#cardsViewWrap');
  const mapWrap = el.querySelector('#mapViewWrap');
  const viewGridBtn = el.querySelector('#viewGridBtn');
  const viewMapBtn = el.querySelector('#viewMapBtn');
  const chooserControls = el.querySelector('#chooserControls');

  let swedenMapInstance = null;

  async function switchView(viewMode) {
    if (viewMode === 'map') {
      viewGridBtn.classList.remove('active');
      viewMapBtn.classList.add('active');
      cardsWrap.style.display = 'none';
      mapWrap.style.display = 'block';
      chooserControls.style.display = 'none';

      if (!swedenMapInstance) {
        const { createSwedenMap } = await import('./map.js');
        swedenMapInstance = createSwedenMap({
          container: mapWrap,
          courses,
          current,
          onPickCourse: onPick,
        });
      }
      swedenMapInstance.invalidateSize();
    } else {
      viewMapBtn.classList.remove('active');
      viewGridBtn.classList.add('active');
      mapWrap.style.display = 'none';
      cardsWrap.style.display = 'block';
      chooserControls.style.display = 'flex';
    }
  }

  viewGridBtn.addEventListener('click', () => switchView('grid'));
  viewMapBtn.addEventListener('click', () => switchView('map'));

  return el;
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
