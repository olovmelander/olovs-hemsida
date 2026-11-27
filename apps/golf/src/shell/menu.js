/* ===========================================================================
   The detailed course's menu: App & Course Navigation behind the top-left pill.

   Scene controls (cameras, lights, tools) live directly in the bottom Camera
   Pill Bar and collapsible Right Inspector so nothing is duplicated here.
   This drawer owns:
     - Course hero + Byt bana / Alla klubbar
     - Sibling-course switcher for multi-course clubs (e.g., Bro Hof Stadium ⇄ Castle)
     - Mode switcher (Lätt 3D / Simulator preserving hole & tee)
     - App pages & display preferences (Min bag, Statistik, Inställningar, Ren vy, FPS, Dev)
     - Keyboard shortcuts reference

   Preserves main.js's full contract: el, open, close, isOpen, updateActiveCam,
   updateActivePreset, setDevOverlay, setFrameCap, and `#navDrawer.open`.
   =========================================================================== */
import { createPanelHistory } from '../ui/panel-history.mjs';
import '../styles/drawer.css';
import { ICONS } from './icons.js';
import { clubIdFor, clubLayouts, layoutLabel } from './course-clubs.mjs';
import { hubUrl, mapUrl, playUrl } from './router.js';
import { SHORTCUT_ROWS } from '../engine/keyboard-shortcuts.mjs';
import { LIGHTS, MAP_KEYS, readText } from './settings-store.mjs';
import { parseRounds } from '../map/map-rounds.mjs';

function roundsOn(slug) {
  try { return parseRounds(readText(globalThis.localStorage, MAP_KEYS.rounds, null)).filter(r => r.course === slug).length; }
  catch { return 0; }
}

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';

const EXTRA_SHORTCUTS = [
  [['W', 'A', 'S', 'D', 'Q', 'E'], 'Flyg i fri kamera'],
  [['I'], 'Verktygspanel (Inspector)'],
  [['G'], 'Greengrid på / av'],
  [['B'], 'Banguide på / av'],
  [['?'], 'Visa kortkommandon'],
];

const shortcutRows = () => [...SHORTCUT_ROWS, ...EXTRA_SHORTCUTS].map(([keys, text]) =>
  `<div class="sc-row">${keys.map(k => k === '–' ? '–' : `<kbd>${esc(k)}</kbd>`).join(' ')} <span>${esc(text)}</span></div>`).join('');

const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TOOL_ICONS = {
  bag: ICONS.golfBall(20),
  map: svg('<path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>'),
  play: svg('<path d="M5 20.5c3.2-1.6 10.8-1.6 14 0"/><path d="M15.5 3.5v13"/><path d="M15.5 3.8l4.6 1.9-4.6 1.9"/><circle cx="8.5" cy="16.6" r="1.6"/>'),
  swap: svg('<path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>'),
};

const NOW_SKY = 'conic-gradient(from 200deg, #294885, #8295ba, #d3b89a, #568bc6, #294885)';
const DRAWER_KEY = 'banvyDetailedMenu';
const initialEntry = globalThis.history?.state?.[DRAWER_KEY];

function compactCourseHeader(course, layouts) {
  if (layouts.length <= 1) return course.name;
  const club = (course.club || course.name).replace(/\s+Golf\s+Club$/i, '').replace(/\s+GK$/i, '').trim();
  const layout = layoutLabel(course).replace(/^The\s+/i, '').replace(/\s+Course$/i, '').trim();
  if (layout.toLowerCase().includes(club.toLowerCase())) return layout;
  return `${club} · ${layout}`;
}

export function buildNavDrawer({ courses, current, onBackToStart, onSwitchCourse, onAction, devOverlay = false }) {
  const drawer = document.createElement('dialog');
  drawer.id = 'navDrawer';
  drawer.className = 'nav-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Meny');

  const course = courses.find(c => c.slug === current) || courses[0];
  const layouts = clubLayouts(courses, course.slug);
  const siblings = layouts.filter(c => c.slug !== course.slug);
  const played = roundsOn(course.slug);
  const poster = course.photos ? `${BASE}courses/${course.slug}/hero-1.webp` : '';

  const siblingsHtml = siblings.length ? `
    <h3 class="nd-h">Byt bana på ${esc(course.club || course.name)}</h3>
    <div class="nd-rows">
      ${siblings.map(other => `
        <button class="nd-row" type="button" data-switch-course="${esc(other.slug)}">
          <span class="nd-row-icon">${TOOL_ICONS.swap}</span>
          <span class="nd-row-text"><b>${esc(layoutLabel(other))}</b><small>${other.holes} hål · par ${other.par}</small></span>
          <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
        </button>`).join('')}
    </div>` : '';

  drawer.innerHTML = `
    <div class="nav-drawer-backdrop" id="navDrawerBackdrop"></div>
    <div class="nav-drawer-panel nd">
      <header class="nd-hero"${poster ? ` style="--poster:url('${poster}')"` : ''}>
        <div class="nd-hero-top">
          <span class="nd-brand"><span class="crest-dot"></span><span class="wordmark">Ban<i>v</i>y</span></span>
          <button class="nd-close" id="drawerCloseBtn" type="button" aria-label="Stäng menyn (Esc)" title="Stäng (Esc)">${ICONS.close(18)}</button>
        </div>
        <div class="nd-course">
          <p class="nd-where">${esc(course.tag || 'Sverige')}</p>
          <h2>${esc(course.name)}</h2>
          <p class="nd-facts">${esc(course.club)} · ${course.holes} hål · par ${course.par}</p>
        </div>
        <div class="nd-hero-actions">
          <button class="nd-pill is-primary" type="button" id="drawerStartBtn">${ICONS.gridCards(16)}<span>Byt bana</span></button>
          <a class="nd-pill" id="drawerHomeLink" href="${hubUrl()}">${ICONS.home(16)}<span>Alla klubbar</span></a>
        </div>
      </header>

      <div class="drawer-scroll nd-scroll">
        ${siblingsHtml}

        <h3 class="nd-h">Byt läge</h3>
        <div class="nd-grid">
          <a class="nd-tile" id="dMapBtn" href="${mapUrl(current)}" data-tool="map">
            <span class="nd-tile-icon">${TOOL_ICONS.map}</span>
            <span class="nd-tile-name">Lätt 3D</span><span class="nd-tile-sub">Kartan för rundan</span>
          </a>
          <a class="nd-tile" id="dPlayBtn" href="${playUrl(current)}" data-tool="play">
            <span class="nd-tile-icon">${TOOL_ICONS.play}</span>
            <span class="nd-tile-name">Simulator</span><span class="nd-tile-sub">Spela hålet</span>
          </a>
        </div>

        <h3 class="nd-h">Spel & klubbsida</h3>
        <div class="nd-rows">
          <button class="nd-row" type="button" id="dBagBtn" data-tool="bag">
            <span class="nd-row-icon">${TOOL_ICONS.bag}</span>
            <span class="nd-row-text"><b>Min bag</b><small>Dina klubbor och carry-längder</small></span>
            <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
          </button>
          <a class="nd-row" id="dClubLink" href="${hubUrl(`klubb/${encodeURIComponent(clubIdFor(course.slug))}?bana=${encodeURIComponent(course.slug)}&lage=3d`)}">
            <span class="nd-row-icon">${svg('<path d="M5 21V4"/><path d="M5 4h11l-2.5 3.5L16 11H5"/>', 18)}</span>
            <span class="nd-row-text"><b>Klubbsida & scorekort</b><small>Baninformation, tees och banguide</small></span>
            <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
          </a>
          <a class="nd-row" href="${hubUrl('statistik')}">
            <span class="nd-row-icon">${svg('<path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/>', 18)}</span>
            <span class="nd-row-text"><b>Statistik</b><small>Dina rundor, slag och klubbor</small></span>
            <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
          </a>
          ${played ? `<a class="nd-row" id="dCourseStats" href="${hubUrl(`statistik/${encodeURIComponent(course.slug)}`)}">
            <span class="nd-row-icon">${svg('<path d="M5 21V4"/><path d="M5 4h11l-2.5 3.5L16 11H5"/>', 18)}</span>
            <span class="nd-row-text"><b>${esc(course.name)}, hål för hål</b><small>${played === 1 ? 'Din runda här' : `Dina ${played} rundor här`}</small></span>
            <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
          </a>` : ''}
          <a class="nd-row" href="${hubUrl('installningar')}">
            <span class="nd-row-icon">${svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>', 18)}</span>
            <span class="nd-row-text"><b>Inställningar</b><small>Grafik, ljus vid start och handicap</small></span>
            <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
          </a>
        </div>

        <h3 class="nd-h">Skärm & prestanda</h3>
        <div class="nd-rows">
          <button class="nd-row" type="button" id="dCleanBtn">
            <span class="nd-row-icon">${ICONS.cleanView(18)}</span>
            <span class="nd-row-text"><b>Ren vy</b><small>Bara banan, utan paneler (H)</small></span>
          </button>
          <button class="nd-row" type="button" id="dFpsBtn">
            <span class="nd-row-icon">${ICONS.layers(18)}</span>
            <span class="nd-row-text"><b>Bildfrekvens</b><small>Ett tak ger svalare dator och längre batteritid</small></span>
            <span class="nd-row-value" id="dFpsState">60</span>
          </button>
          <button class="nd-row" type="button" id="dDevBtn" aria-pressed="false">
            <span class="nd-row-icon">${ICONS.layers(18)}</span>
            <span class="nd-row-text"><b>Utvecklarläge</b><small>Terrängpanelen och grafikmotorn</small></span>
            <span class="nd-switch" aria-hidden="true"></span><span class="nd-sr" id="dDevState">AV</span>
          </button>
        </div>

        <details class="nd-shortcuts-details">
          <summary class="nd-h">Ljus & atmosfär</summary>
          <div class="nd-lights">
            <button class="nd-light" type="button" data-preset="nu" title="Solen och vädret just nu"><i style="background:${NOW_SKY}"></i><span>Nu</span></button>
            ${LIGHTS.map(light => `<button class="nd-light" type="button" data-preset="${light.preset}"><i style="background:linear-gradient(180deg, ${light.sky[0]} 0%, ${light.sky[1]} 64%, ${light.sky[2]} 100%)"></i><span>${light.label}</span></button>`).join('')}
          </div>
        </details>

        <details class="nd-shortcuts-details">
          <summary class="nd-h">Kortkommandon</summary>
          <div class="drawer-shortcuts">${shortcutRows()}</div>
        </details>
      </div>
    </div>
  `;

  const $ = sel => drawer.querySelector(sel);
  const panels = createPanelHistory({ history, key: DRAWER_KEY, course: current, render(path) {
    const launcher = document.getElementById('menuToggle');
    const panel = path.at(-1);
    launcher?.setAttribute('aria-expanded', String(Boolean(panel)));
    launcher?.classList.toggle('open', Boolean(panel));
    drawer.classList.toggle('open', Boolean(panel));
    if (!panel) {
      if (drawer.open) {
        drawer.close();
        launcher?.focus({ preventScroll: true });
      }
      return;
    }
    const selectedTee = document.querySelector('#tees .tee.on');
    const params = new URLSearchParams(location.search);
    const place = {
      hole: Number(params.get('hal')) || undefined,
      tee: Number(params.get('tee')) || (selectedTee ? [...selectedTee.parentElement.children].indexOf(selectedTee) + 1 : undefined),
    };
    $('#dMapBtn').href = mapUrl(current, { ...place, preview: true });
    $('#dPlayBtn').href = playUrl(current, place);
    const clubLink = $('#dClubLink');
    if (clubLink) {
      const q = new URLSearchParams({ bana: course.slug, lage: '3d' });
      if (place.hole) q.set('hal', String(place.hole));
      if (place.tee) q.set('tee', String(place.tee));
      clubLink.href = hubUrl(`klubb/${encodeURIComponent(clubIdFor(course.slug))}?${q}`);
    }
    if (!drawer.open && drawer.isConnected) drawer.showModal();
  } });

  const close = () => panels.close();
  const open = () => { if (!panels.current) panels.open({ open: true }); };

  window.addEventListener('popstate', event => panels.restore(event.state));
  drawer.addEventListener('cancel', event => { event.preventDefault(); close(); });
  drawer.addEventListener('keydown', event => event.stopPropagation());
  const launcher = document.getElementById('menuToggle');
  launcher?.setAttribute('aria-haspopup', 'dialog');
  launcher?.setAttribute('aria-controls', drawer.id);
  launcher?.setAttribute('aria-expanded', 'false');
  $('#navDrawerBackdrop').addEventListener('click', close);
  $('#drawerCloseBtn').addEventListener('click', close);
  $('#drawerStartBtn').addEventListener('click', () => { close(); onBackToStart(); });
  $('#dBagBtn').addEventListener('click', () => { close(); document.getElementById('bagBtn')?.click(); });
  $('#dCleanBtn').addEventListener('click', () => { close(); onAction('clean'); });
  for (const btn of drawer.querySelectorAll('[data-switch-course]')) {
    btn.addEventListener('click', () => {
      const target = btn.dataset.switchCourse;
      close();
      if (onSwitchCourse) onSwitchCourse(target);
    });
  }

  for (const btn of drawer.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const railBtn = document.querySelector(`#rail .btn[data-preset="${preset}"]`);
      if (railBtn) railBtn.click();
      else onAction('preset', preset);
    });
  }
  const devBtn = $('#dDevBtn');
  devBtn.addEventListener('click', () => onAction('devOverlay'));
  $('#dFpsBtn').addEventListener('click', () => onAction('frameCap'));
  const setFrameCap = label => { const state = $('#dFpsState'); if (state) state.textContent = label; };

  /* Tidy top-left course pill title & subtitle (avoid doubled layout strings). */
  const titleEl = document.getElementById('hdName');
  const niceTitle = compactCourseHeader(course, layouts);
  if (titleEl) {
    const syncTitle = () => { if (titleEl.textContent !== niceTitle) titleEl.textContent = niceTitle; };
    syncTitle();
    if ('MutationObserver' in window) {
      new window.MutationObserver(syncTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }
  let devOn = devOverlay === true;
  const sub = document.getElementById('hdsub');
  const plain = `${course.tag || course.club} · ${course.holes} hål`;
  let engineText = sub?.textContent ?? '';
  const tidy = () => {
    if (!sub) return;
    const want = devOn ? engineText : plain;
    if (sub.textContent !== want) sub.textContent = want;
  };
  if (sub && 'MutationObserver' in window) {
    new window.MutationObserver(() => {
      const text = sub.textContent;
      if (text !== plain && text !== engineText) engineText = text;
      tidy();
    }).observe(sub, { childList: true, characterData: true, subtree: true });
    tidy();
  }

  /* Touch swipe left to dismiss drawer */
  let touchStartX = 0, touchStartY = 0;
  const panel = $('.nav-drawer-panel');
  panel.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchend', e => {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY);
    if (deltaX < -48 && deltaY < 80) close();
  }, { passive: true });

  const setDevOverlay = on => {
    devOn = on === true;
    const state = $('#dDevState');
    if (state) state.textContent = devOn ? 'PÅ' : 'AV';
    devBtn.setAttribute('aria-pressed', devOn ? 'true' : 'false');
    devBtn.classList.toggle('active', devOn);
    tidy();
  };
  setDevOverlay(devOverlay);

  if (initialEntry?.course === current && initialEntry.path?.length) queueMicrotask(() => {
    if (!drawer.isConnected) return;
    history.replaceState({ ...history.state, [DRAWER_KEY]: initialEntry }, '');
    panels.restore(history.state);
  });

  return {
    el: drawer,
    setDevOverlay,
    setFrameCap,
    open,
    close,
    isOpen: () => drawer.classList.contains('open'),
    updateActiveCam: () => {},
    updateActivePreset: preset => {
      drawer.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    },
  };
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
