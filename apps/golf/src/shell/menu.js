/* ===========================================================================
   The detailed course's menu: the drawer behind the top-left button.

   REBUILT 8 NOVEMBER, after an audit for clutter. It had grown into one
   2,000 px list: a course card, two big buttons, all thirteen courses again
   (the same list "Byt bana" opens), the four camera views and eleven lights
   again (both on the Vy och ljus panel and on the C and L keys), twelve tool
   rows with a sentence each, and the shortcuts. Now:

     - the course on top, in its own poster, with its two ways out: switch
       course, or the start menu;
     - three tabs, so nothing is more than one tap and no tab scrolls far:
         Spela    the tools, as tiles that show whether they are on;
         Visning  the camera, the lights as their own skies, clean view,
                  frame cap and the developer overlay;
         Mer      the start menu's pages and the keyboard shortcuts;
     - the course pill under the button says where the course is and how
       many holes, as it promises; the renderer it used to print as well
       (WebGPU, 1 m preview) is developer information and shows with the
       developer overlay.

   The tools are the panel's own buttons, clicked through, so there is one
   behaviour and one state for each. main.js keeps its API: open, close,
   isOpen, updateActiveCam, updateActivePreset, setDevOverlay, setFrameCap,
   and the drawer's `open` class its key guard reads.
   =========================================================================== */
import '../styles/drawer.css';
import { ICONS } from './icons.js';
import { hubUrl, mapUrl } from './router.js';
import { SHORTCUT_ROWS } from '../engine/keyboard-shortcuts.mjs';
import { LIGHTS } from './settings-store.mjs';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';

/* One row per shortcut, from the same table the keyboard handler is tested
   against: a list kept by hand here promised five keys that did nothing. */
const shortcutRows = () => SHORTCUT_ROWS.map(([keys, text]) =>
  `<div class="sc-row">${keys.map(k => k === '–' ? '–' : `<kbd>${esc(k)}</kbd>`).join(' ')} <span>${esc(text)}</span></div>`).join('');

const svg = (d, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TOOL_ICONS = {
  fly: svg('<path d="M3 17c4-1 6-5 9-10 2 4 5 7 9 8"/><path d="M12 7v14"/>'),
  tour: ICONS.compass(22),
  range: ICONS.rangefinder(22),
  strategy: svg('<path d="M5 20 19 4"/><circle cx="7" cy="17" r="2"/><circle cx="16" cy="8" r="3"/>'),
  grid: ICONS.grid(22),
  gps: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  note: ICONS.book(22),
  mini: ICONS.miniMap(22),
  bag: ICONS.golfBall(22),
  map: svg('<path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>'),
};
const CAMS = [
  ['tee', 'Tee', svg('<path d="M12 21V11"/><circle cx="12" cy="7" r="3"/><path d="M9 21h6"/>')],
  ['green', 'Green', svg('<path d="M7 21V4l11 4.5L7 13"/>')],
  ['orbit', 'Fri', svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/><circle cx="12" cy="12" r="2"/>')],
  ['top', 'Ovanifrån', svg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="12" cy="12" r="3"/>')],
];
const NOW_SKY = 'conic-gradient(from 200deg, #294885, #8295ba, #d3b89a, #568bc6, #294885)';

export function buildNavDrawer({ courses, current, onBackToStart, onSwitchCourse, onAction, devOverlay = false }) {
  const drawer = document.createElement('div');
  drawer.id = 'navDrawer';
  drawer.className = 'nav-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Meny');

  const course = courses.find(c => c.slug === current) || courses[0];
  const poster = course.photos ? `${BASE}courses/${course.slug}/hero-1.webp` : '';
  const tile = (id, key, name, sub = '') => `
    <button class="nd-tile" type="button" id="${id}" data-tool="${key}">
      <span class="nd-tile-icon">${TOOL_ICONS[key]}</span>
      <span class="nd-tile-name">${name}</span>${sub ? `<span class="nd-tile-sub">${sub}</span>` : ''}
      <span class="nd-tile-on" aria-hidden="true">På</span>
    </button>`;

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
          <a class="nd-pill" id="drawerHomeLink" href="${hubUrl()}">${ICONS.home(16)}<span>Startmenyn</span></a>
        </div>
      </header>

      <div class="nd-tabs" role="tablist" aria-label="Menyns delar">
        <button type="button" role="tab" id="ndTabPlay" aria-controls="ndPlay" data-tab="play" aria-selected="true">Spela</button>
        <button type="button" role="tab" id="ndTabView" aria-controls="ndView" data-tab="view" aria-selected="false">Visning</button>
        <button type="button" role="tab" id="ndTabMore" aria-controls="ndMore" data-tab="more" aria-selected="false">Mer</button>
      </div>

      <div class="drawer-scroll nd-scroll">
        <section class="nd-panel" id="ndPlay" role="tabpanel" aria-labelledby="ndTabPlay" data-panel="play">
          <h3 class="nd-h">Upplev hålet</h3>
          <div class="nd-grid">
            ${tile('dFlyBtn', 'fly', 'Flygtur', 'Tee till green')}
            ${tile('dTourBtn', 'tour', 'Bansafari', 'Alla hål i följd')}
          </div>
          <h3 class="nd-h">Verktyg</h3>
          <div class="nd-grid">
            ${tile('dRangeBtn', 'range', 'Kikaren', 'Mät avstånd')}
            ${tile('dStrategyBtn', 'strategy', 'Spellinje', 'Sikte och landning')}
            ${tile('dGridBtn', 'grid', 'Greengrid', 'Greenens lutning')}
            ${tile('dGpsBtn', 'gps', 'GPS-läge', 'Följ din boll')}
            ${tile('dNoteBtn', 'note', 'Banguide', 'Klubbens råd')}
            ${tile('dMiniBtn', 'mini', 'Minikarta', 'Hela banan i 2D')}
            ${tile('dBagBtn', 'bag', 'Min bag', 'Dina carry-längder')}
            <a class="nd-tile" id="dMapBtn" href="${mapUrl(current)}" data-tool="map">
              <span class="nd-tile-icon">${TOOL_ICONS.map}</span>
              <span class="nd-tile-name">Lätt 3D</span><span class="nd-tile-sub">Kartan för rundan</span>
            </a>
          </div>
        </section>

        <section class="nd-panel" id="ndView" role="tabpanel" aria-labelledby="ndTabView" data-panel="view" hidden>
          <h3 class="nd-h">Kamera</h3>
          <div class="nd-cams">${CAMS.map(([key, label, icon]) => `
            <button class="nd-cam" type="button" data-cam="${key}">${icon}<span>${label}</span></button>`).join('')}
          </div>
          <h3 class="nd-h">Ljus</h3>
          <div class="nd-lights">
            <button class="nd-light" type="button" data-preset="nu" title="Solen och vädret just nu"><i style="background:${NOW_SKY}"></i><span>Nu</span></button>
            ${LIGHTS.map(light => `<button class="nd-light" type="button" data-preset="${light.preset}"><i style="background:linear-gradient(180deg, ${light.sky[0]} 0%, ${light.sky[1]} 64%, ${light.sky[2]} 100%)"></i><span>${light.label}</span></button>`).join('')}
          </div>
          <h3 class="nd-h">Skärmen</h3>
          <div class="nd-rows">
            <button class="nd-row" type="button" id="dCleanBtn">
              <span class="nd-row-icon">${ICONS.cleanView(18)}</span>
              <span class="nd-row-text"><b>Ren vy</b><small>Bara banan, utan paneler</small></span>
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
        </section>

        <section class="nd-panel" id="ndMore" role="tabpanel" aria-labelledby="ndTabMore" data-panel="more" hidden>
          <div class="nd-rows">
            <a class="nd-row" href="${hubUrl('installningar')}">
              <span class="nd-row-icon">${svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>', 18)}</span>
              <span class="nd-row-text"><b>Inställningar</b><small>Grafik, ljus vid start, bag och handicap</small></span>
              <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
            </a>
            <a class="nd-row" href="${hubUrl('statistik')}">
              <span class="nd-row-icon">${svg('<path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/>', 18)}</span>
              <span class="nd-row-text"><b>Statistik</b><small>Dina rundor, slag och klubbor</small></span>
              <span class="nd-row-go" aria-hidden="true">${ICONS.chevronRight(16, 2.4)}</span>
            </a>
          </div>
          <h3 class="nd-h">Kortkommandon</h3>
          <div class="drawer-shortcuts">${shortcutRows()}</div>
        </section>
      </div>
    </div>
  `;

  const $ = sel => drawer.querySelector(sel);
  const close = () => {
    drawer.classList.remove('open');
    document.getElementById('menuToggle')?.classList.remove('open');
  };
  $('#navDrawerBackdrop').addEventListener('click', close);
  $('#drawerCloseBtn').addEventListener('click', close);
  $('#drawerStartBtn').addEventListener('click', () => { close(); onBackToStart(); });

  /* ------------------------------------------------------------ tabs */
  const TAB_KEY = 'banvy-drawer-tab';
  const tabs = [...drawer.querySelectorAll('[role="tab"]')];
  const selectTab = (name, focus = false) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    for (const panel of drawer.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
    $('.nd-scroll').scrollTop = 0;
    try { window.sessionStorage.setItem(TAB_KEY, name); } catch { /* the first tab next time */ }
  };
  tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
  $('.nd-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    selectTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
  });
  try { const kept = window.sessionStorage.getItem(TAB_KEY); if (kept && tabs.some(t => t.dataset.tab === kept)) selectTab(kept); } catch { /* Spela */ }

  /* ------------------------------------------------------------ tools
     Each tile clicks the panel's own button, so the course has one behaviour
     and one state for it; the tile reads that state back. */
  const RAIL_OF = { fly: 'flyBtn', tour: 'tourBtn', range: 'rangeBtn', strategy: 'strategyBtn', grid: 'gridBtn', gps: 'gpsBtn', bag: 'bagBtn' };
  const ACTION_OF = { note: 'toggleNote', mini: 'toggleMini' };
  const isOn = key => {
    const btn = RAIL_OF[key] && document.getElementById(RAIL_OF[key]);
    if (!btn) return false;
    return btn.classList.contains('on') || btn.getAttribute('aria-pressed') === 'true';
  };
  const syncTiles = () => {
    for (const el of drawer.querySelectorAll('[data-tool]')) el.classList.toggle('is-on', ['range', 'strategy', 'grid', 'gps'].includes(el.dataset.tool) && isOn(el.dataset.tool));
  };
  for (const el of drawer.querySelectorAll('button[data-tool]')) {
    el.addEventListener('click', () => {
      const key = el.dataset.tool;
      close();
      if (RAIL_OF[key]) document.getElementById(RAIL_OF[key])?.click();
      else if (ACTION_OF[key]) onAction(ACTION_OF[key]);
    });
  }

  /* ----------------------------------------------------- camera, lights */
  drawer.querySelectorAll('[data-cam]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.cam;
      const railBtn = document.querySelector(`#rail .btn[data-cam="${mode}"]`);
      if (railBtn) railBtn.click(); else onAction('cam', mode);
      close();
    });
  });
  /* a light is chosen with the drawer open, so the next can be tried at once */
  drawer.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const railBtn = document.querySelector(`#rail .btn[data-preset="${preset}"]`);
      if (railBtn) railBtn.click(); else onAction('preset', preset);
    });
  });
  $('#dCleanBtn').addEventListener('click', () => { close(); onAction('clean'); });

  /* The developer switch does NOT close the drawer: it is flicked while looking
     at the terrain panel it governs, so closing would hide the thing under
     inspection and cost a second trip through the menu. */
  const devBtn = $('#dDevBtn');
  devBtn.addEventListener('click', () => onAction('devOverlay'));
  /* the frame cap cycles 60, unlimited, 30 and keeps the drawer open, like the developer switch */
  $('#dFpsBtn').addEventListener('click', () => onAction('frameCap'));
  const setFrameCap = label => { const state = $('#dFpsState'); if (state) state.textContent = label; };

  /* --------------------------------------------- the course pill's line
     main.js writes the place and the renderer into it; a golfer is told the
     place and the holes, the renderer comes with the developer overlay. */
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

  /* Touch swipe to dismiss drawer on mobile */
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

  return {
    el: drawer,
    setDevOverlay,
    setFrameCap,
    open: () => {
      syncTiles();
      drawer.classList.add('open');
      document.getElementById('menuToggle')?.classList.add('open');
      const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true');
      requestAnimationFrame(() => selected?.focus({ preventScroll: true }));
    },
    close,
    isOpen: () => drawer.classList.contains('open'),
    updateActiveCam: mode => {
      drawer.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('active', b.dataset.cam === mode));
    },
    updateActivePreset: preset => {
      drawer.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    },
  };
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
