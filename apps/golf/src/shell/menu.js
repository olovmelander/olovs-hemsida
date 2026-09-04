/* ===========================================================================
   Banvy In-Game Navigation Drawer & Header Menu Hub
   Handles the top-left hamburger trigger, drawer slide-out, course switching,
   camera views, lighting, interactive tools, and shortcuts.
   =========================================================================== */

import { ICONS } from './icons.js';

export function buildNavDrawer({ courses, current, onBackToStart, onSwitchCourse, onAction }) {
  const drawer = document.createElement('div');
  drawer.id = 'navDrawer';
  drawer.className = 'nav-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Huvudmeny och navigering');

  const currentCourse = courses.find(c => c.slug === current) || courses[0];

  drawer.innerHTML = `
    <div class="nav-drawer-backdrop" id="navDrawerBackdrop"></div>
    <div class="nav-drawer-panel">
      <div class="drawer-header">
        <div class="drawer-brand">
          <div class="brand-badge">
            <span class="brand-icon"></span>
            <span class="wordmark">Ban<i>v</i>y</span>
          </div>
          <span class="drawer-tag">3D Golf</span>
        </div>
        <button class="drawer-close-btn" id="drawerCloseBtn" title="Stäng meny (Esc)">
          ${ICONS.close(18)}
        </button>
      </div>

      <div class="drawer-course-card">
        <div class="dcc-tag">${esc(currentCourse.tag || 'Sverige')}</div>
        <h2 class="dcc-title">${esc(currentCourse.name)}</h2>
        <p class="dcc-sub">${esc(currentCourse.club)} · ${currentCourse.holes} hål · Par ${currentCourse.par}</p>
      </div>

      <div class="drawer-scroll">
        <!-- Start / Course Switch Section -->
        <div class="drawer-section">
          <button class="drawer-main-btn" id="drawerStartBtn">
            <div class="dmb-icon">
              ${ICONS.home(22)}
            </div>
            <div class="dmb-content">
              <div class="dmb-title">Tillbaka till Start / Välj bana</div>
              <div class="dmb-sub">Öppna startmenyn och utforska alla ${courses.length} banor</div>
            </div>
            <div class="dmb-arrow">→</div>
          </button>
        </div>

        <!-- Quick Switch Courses -->
        <div class="drawer-section">
          <div class="drawer-sec-title">Snabbval av banor (${courses.length})</div>
          <div class="drawer-course-grid">
            ${courses.map(c => `
              <button class="d-course-btn ${c.slug === current ? 'active' : ''}" data-slug="${c.slug}">
                <div class="d-course-name">${esc(c.name)}</div>
                <div class="d-course-info">${c.holes} hål · Par ${c.par} · ${esc(c.tag)}</div>
                ${c.slug === current ? '<span class="d-active-pill">Aktiv</span>' : ''}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Quick Navigation / Views -->
        <div class="drawer-section">
          <div class="drawer-sec-title">Kameravyer</div>
          <div class="drawer-btn-grid">
            <button class="d-btn" data-cam="tee">
              ${ICONS.golfBall(15)}
              Tee-vy
            </button>
            <button class="d-btn" data-cam="green">
              ${ICONS.flag(15)}
              Green-vy
            </button>
            <button class="d-btn active" data-cam="orbit">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 9 9"></path><path d="M3 12a9 9 0 0 1 9-9"></path></svg>
              Fritt läge
            </button>
            <button class="d-btn" data-cam="top">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="12" cy="12" r="3"></circle></svg>
              Ovanifrån
            </button>
          </div>
        </div>

        <!-- Lighting Presets -->
        <div class="drawer-section">
          <div class="drawer-sec-title">Ljus & Atmosfär</div>
          <div class="drawer-btn-grid cols-3">
            <button class="d-btn active" data-preset="golden">Kväll</button>
            <button class="d-btn" data-preset="noon">Dag</button>
            <button class="d-btn" data-preset="dawn">Gryning</button>
            <button class="d-btn" data-preset="mist">Dis</button>
            <button class="d-btn" data-preset="host">Höst</button>
          </div>
        </div>

        <!-- Interactive Tools -->
        <div class="drawer-section">
          <div class="drawer-sec-title">Verktyg & Upplevelser</div>
          <div class="drawer-tools-list">
            <button class="d-tool-btn" id="dMiniBtn">
              <span class="dt-icon">${ICONS.miniMap(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Minimap & Översikt</div>
                <div class="dt-desc">Visa eller dölj 2D-banöversikten</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dNoteBtn">
              <span class="dt-icon">${ICONS.book(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Banguide & Hålstrategi</div>
                <div class="dt-desc">Klubbens råd, höjdskillnad och detaljer</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dFlyBtn">
              <span class="dt-icon">${ICONS.fly(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Flygtur längs hålet</div>
                <div class="dt-desc">Sväva från tee till green</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dTourBtn">
              <span class="dt-icon">${ICONS.compass(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Bansafari (Full tur)</div>
                <div class="dt-desc">Automatisk genomgång av alla hål</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dRangeBtn">
              <span class="dt-icon">${ICONS.rangefinder(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Kikaren (Avståndsmätare)</div>
                <div class="dt-desc">Mät exakt avstånd och höjdskillnad</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dGpsBtn">
              <span class="dt-icon">${ICONS.compass(18)}</span>
              <div class="dt-text">
                <div class="dt-name">GPS-läge</div>
                <div class="dt-desc">Följ din boll och uppdatera caddien live</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dStrategyBtn">
              <span class="dt-icon">${ICONS.flag(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Taktisk spellinje</div>
                <div class="dt-desc">Siktlinje, landningszoner och avståndsbågar</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dBagBtn">
              <span class="dt-icon">${ICONS.golfBall(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Min bag</div>
                <div class="dt-desc">Dina carry-avstånd och personliga klubbval</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dGridBtn">
              <span class="dt-icon">${ICONS.grid(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Greengrid</div>
                <div class="dt-desc">Visualisera greenens lutningar</div>
              </div>
            </button>
            <button class="d-tool-btn" id="dCleanBtn">
              <span class="dt-icon">${ICONS.cleanView(18)}</span>
              <div class="dt-text">
                <div class="dt-name">Ren vy (Minimalt UI)</div>
                <div class="dt-desc">Dölj menyer för fri panoramavy</div>
              </div>
            </button>
          </div>
        </div>

        <!-- Shortcuts Help -->
        <div class="drawer-section">
          <div class="drawer-sec-title">Kortkommandon</div>
          <div class="drawer-shortcuts">
            <div class="sc-row"><kbd>1</kbd>–<kbd>9</kbd> <span>Byt till hål 1–9</span></div>
            <div class="sc-row"><kbd>0</kbd>+<kbd>1-8</kbd> <span>Hål 10–18</span></div>
            <div class="sc-row"><kbd>C</kbd> <span>Byt kameravy</span></div>
            <div class="sc-row"><kbd>L</kbd> <span>Växla ljus / tid på dygnet</span></div>
            <div class="sc-row"><kbd>F</kbd> <span>Starta flygtur</span></div>
            <div class="sc-row"><kbd>H</kbd> <span>Dölj / visa UI</span></div>
            <div class="sc-row"><kbd>Esc</kbd> <span>Stäng meny</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind internal events
  const backdrop = drawer.querySelector('#navDrawerBackdrop');
  const closeBtn = drawer.querySelector('#drawerCloseBtn');
  const startBtn = drawer.querySelector('#drawerStartBtn');

  const close = () => {
    drawer.classList.remove('open');
    const toggleBtn = document.getElementById('menuToggle');
    if (toggleBtn) toggleBtn.classList.remove('open');
  };

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  startBtn.addEventListener('click', () => {
    close();
    onBackToStart();
  });

  // Course switcher buttons
  drawer.querySelectorAll('.d-course-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug;
      close();
      if (slug !== current) {
        onSwitchCourse(slug);
      }
    });
  });

  // Camera buttons
  drawer.querySelectorAll('[data-cam]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.cam;
      drawer.querySelectorAll('[data-cam]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // sync with right rail
      const railBtn = document.querySelector(`#rail .btn[data-cam="${mode}"]`);
      if (railBtn) railBtn.click();
      else onAction('cam', mode);
      close();
    });
  });

  // Preset buttons
  drawer.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      drawer.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const railBtn = document.querySelector(`#rail .btn[data-preset="${preset}"]`);
      if (railBtn) railBtn.click();
      else onAction('preset', preset);
    });
  });

  // Tool buttons
  drawer.querySelector('#dMiniBtn')?.addEventListener('click', () => {
    close();
    onAction('toggleMini');
  });
  drawer.querySelector('#dNoteBtn')?.addEventListener('click', () => {
    close();
    onAction('toggleNote');
  });
  drawer.querySelector('#dFlyBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('flyBtn')?.click();
  });
  drawer.querySelector('#dTourBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('tourBtn')?.click();
  });
  drawer.querySelector('#dRangeBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('rangeBtn')?.click();
  });
  drawer.querySelector('#dGpsBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('gpsBtn')?.click();
  });
  drawer.querySelector('#dStrategyBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('strategyBtn')?.click();
  });
  drawer.querySelector('#dBagBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('bagBtn')?.click();
  });
  drawer.querySelector('#dGridBtn')?.addEventListener('click', () => {
    close();
    document.getElementById('gridBtn')?.click();
  });
  drawer.querySelector('#dCleanBtn')?.addEventListener('click', () => {
    close();
    onAction('clean');
  });

  // Touch swipe to dismiss drawer on mobile
  let touchStartX = 0;
  let touchStartY = 0;
  const panel = drawer.querySelector('.nav-drawer-panel');
  if (panel) {
    panel.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    panel.addEventListener('touchend', e => {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY);
      // Swipe left by more than 48px with mostly horizontal motion
      if (deltaX < -48 && deltaY < 80) {
        close();
      }
    }, { passive: true });
  }

  return {
    el: drawer,
    open: () => {
      drawer.classList.add('open');
      const toggleBtn = document.getElementById('menuToggle');
      if (toggleBtn) toggleBtn.classList.add('open');
    },
    close,
    isOpen: () => drawer.classList.contains('open'),
    updateActiveCam: (mode) => {
      drawer.querySelectorAll('[data-cam]').forEach(b => {
        b.classList.toggle('active', b.dataset.cam === mode);
      });
    },
    updateActivePreset: (preset) => {
      drawer.querySelectorAll('[data-preset]').forEach(b => {
        b.classList.toggle('active', b.dataset.preset === preset);
      });
    }
  };
}

const esc = s => String(s || '').replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
