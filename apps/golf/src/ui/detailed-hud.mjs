/** Detailed 3D HUD shell (built over main.js DOM contracts without modifying main.js).
    Unifies the top-center Hole & Tee Stepper Pill with anchored 18-hole and Tee popovers,
    bottom-center floating Camera Pill Bar, collapsible tabbed Right Inspector, [?] Shortcut
    Popover, one-time drag hint, and harmonized shortcuts (I, G, B, ?, Esc). */

const HINT_SEEN_KEY = 'banvy-det-hint-seen-v1';

export function installDetailedHud() {
  /* ---- 1. Deduplicated strategy readout ----
     When the camera sits on the tee box on desktop, the 3D world target sprite
     already reads clearly over the fairway; show the HUD pill on other angles
     or mobile so "Sikta här" never appears twice on screen. */
  const target = document.getElementById('strategyReadout');
  const activeCamMode = () => document.querySelector('#rail .btn[data-cam].on')?.dataset.cam || 'orbit';
  function syncTarget() {
    const caddie = window.V3D?.caddie();
    const zone = caddie?.strategyOn && caddie.strategy?.status === 'playable' && caddie.strategy.zones[0];
    const desktopTee = window.innerWidth >= 981 && activeCamMode() === 'tee';
    target.hidden = !zone || desktopTee;
    if (!zone) return;
    const green = zone.kind === 'green';
    target.querySelector('b').textContent = `${green ? 'Green' : 'Sikta här'} · ${Math.round(zone.distance)} m`;
    target.querySelector('span').textContent = [zone.club?.name, green ? 'till mitten' : `${Math.round(zone.remain)} m kvar`].filter(Boolean).join(' · ');
  }
  const targetObserver = new MutationObserver(syncTarget);
  targetObserver.observe(document.getElementById('boot'), { attributes: true, attributeFilter: ['class'] });
  targetObserver.observe(document.getElementById('strategyStatus'), { childList: true });
  const railEl = document.getElementById('rail');
  if (railEl) targetObserver.observe(railEl, { attributes: true, attributeFilter: ['class'], subtree: true });
  syncTarget();

  /* ---- 2. Sync light name & elevation badges ---- */
  const lights = document.getElementById('railLights');
  const lightName = document.getElementById('railLightName');
  const syncLight = () => {
    if (lightName && lights) lightName.textContent = lights.querySelector('[data-preset].on')?.textContent.trim() || '';
  };
  if (lights) new MutationObserver(syncLight).observe(lights, { attributes: true, attributeFilter: ['class'], subtree: true });
  syncLight();

  for (const id of ['railHoleSub', 'tourElev']) {
    const elevation = document.getElementById(id);
    if (!elevation) continue;
    const sync = () => { elevation.hidden = !elevation.textContent.trim() || /\b0 m (uppför|nedför)\b/.test(elevation.textContent); };
    new MutationObserver(sync).observe(elevation, { childList: true, subtree: true });
    sync();
  }

  /* ---- 3. One-time drag hint ---- */
  const hint = document.getElementById('hint');
  if (hint) {
    try {
      if (localStorage.getItem(HINT_SEEN_KEY)) {
        hint.hidden = true;
      } else {
        setTimeout(() => { try { localStorage.setItem(HINT_SEEN_KEY, '1'); } catch {} }, 4000);
      }
    } catch {}
  }

  /* ---- 4. Unified Top-Center Hole & Tee Stepper Pill (#card) ---- */
  const card = document.getElementById('card');
  const holesHost = document.getElementById('holes');
  const teesHost = document.getElementById('tees');
  const prevHoleBtn = document.getElementById('holePrevBtn');
  const nextHoleBtn = document.getElementById('holeNextBtn');

  const holePop = document.createElement('div');
  holePop.id = 'detHolePop';
  holePop.className = 'bv-popover det-hud det-pop det-hole-pop';
  holePop.hidden = true;
  holePop.setAttribute('role', 'dialog');
  holePop.setAttribute('aria-label', 'Välj hål');
  holePop.innerHTML = '<div class="det-pop-head"><strong>Välj hål</strong><button type="button" class="det-pop-close" aria-label="Stäng">×</button></div><div class="det-hole-grid"></div>';

  const teePop = document.createElement('div');
  teePop.id = 'detTeePop';
  teePop.className = 'bv-popover det-hud det-pop det-tee-pop';
  teePop.hidden = true;
  teePop.setAttribute('role', 'dialog');
  teePop.setAttribute('aria-label', 'Välj tee');
  teePop.innerHTML = '<div class="det-pop-head"><strong>Välj tee</strong><button type="button" class="det-pop-close" aria-label="Stäng">×</button></div><div class="det-tee-list"></div>';

  const shortcutsPop = document.createElement('div');
  shortcutsPop.id = 'detShortcutsPop';
  shortcutsPop.className = 'bv-popover det-hud det-pop det-shortcuts-pop';
  shortcutsPop.hidden = true;
  shortcutsPop.setAttribute('role', 'dialog');
  shortcutsPop.setAttribute('aria-label', 'Tangentbordsgenvägar');
  shortcutsPop.innerHTML = `
    <div class="det-pop-head"><strong>Kortkommandon</strong><button type="button" class="det-pop-close" aria-label="Stäng">×</button></div>
    <ul class="det-sc-list">
      <li><span>Föregående / nästa hål</span><b><kbd>←</kbd> <kbd>→</kbd> · <kbd>P</kbd> <kbd>N</kbd></b></li>
      <li><span>Hoppa till hål</span><b><kbd>1</kbd>–<kbd>18</kbd></b></li>
      <li><span>Byt kameravy</span><b><kbd>C</kbd></b></li>
      <li><span>Flygtur över hålet</span><b><kbd>F</kbd></b></li>
      <li><span>Fri kamera (flyg)</span><b><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · <kbd>Q</kbd><kbd>E</kbd></b></li>
      <li><span>Byt ljus / atmosfär</span><b><kbd>L</kbd></b></li>
      <li><span>Verktygspanel (Inspector)</span><b><kbd>I</kbd></b></li>
      <li><span>Greengrid / Banguide</span><b><kbd>G</kbd> · <kbd>B</kbd></b></li>
      <li><span>Skyltar på / av</span><b><kbd>M</kbd></b></li>
      <li><span>Ren vy (dölj reglage)</span><b><kbd>H</kbd></b></li>
      <li><span>Stäng / Meny</span><b><kbd>Esc</kbd></b></li>
    </ul>`;

  document.body.append(holePop, teePop, shortcutsPop);

  const allPops = [holePop, teePop, shortcutsPop];
  function closeAllPops(except = null) {
    for (const pop of allPops) {
      if (pop === except) continue;
      pop.hidden = true;
    }
    cardHoleTrigger?.setAttribute('aria-expanded', String(!holePop.hidden));
    cardTeeBtn?.setAttribute('aria-expanded', String(!teePop.hidden));
    topHelpBtn?.setAttribute('aria-expanded', String(!shortcutsPop.hidden));
  }

  for (const pop of allPops) {
    pop.querySelector('.det-pop-close')?.addEventListener('click', () => closeAllPops());
    pop.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    pop.addEventListener('pointerdown', e => e.stopPropagation());
  }

  let cardHoleTrigger = null;
  let cardTeeBtn = null;
  if (card) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.id = 'cardPrevBtn';
    prevBtn.className = 'card-step';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', 'Föregående hål');
    prevBtn.addEventListener('click', e => { e.stopPropagation(); prevHoleBtn?.click(); });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.id = 'cardNextBtn';
    nextBtn.className = 'card-step';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', 'Nästa hål');
    nextBtn.addEventListener('click', e => { e.stopPropagation(); nextHoleBtn?.click(); });

    cardHoleTrigger = document.createElement('button');
    cardHoleTrigger.type = 'button';
    cardHoleTrigger.id = 'cardHoleTrigger';
    cardHoleTrigger.className = 'card-hole-trigger';
    cardHoleTrigger.setAttribute('aria-haspopup', 'dialog');
    cardHoleTrigger.setAttribute('aria-controls', holePop.id);
    cardHoleTrigger.setAttribute('aria-expanded', 'false');
    cardHoleTrigger.setAttribute('aria-label', 'Välj hål');
    const cno = document.getElementById('cno');
    const mid = card.querySelector('.mid');
    if (cno) cardHoleTrigger.append(cno);
    if (mid) cardHoleTrigger.append(mid);

    cardTeeBtn = document.createElement('button');
    cardTeeBtn.type = 'button';
    cardTeeBtn.id = 'cardTeeBtn';
    cardTeeBtn.className = 'card-tee-btn';
    cardTeeBtn.setAttribute('aria-haspopup', 'dialog');
    cardTeeBtn.setAttribute('aria-controls', teePop.id);
    cardTeeBtn.setAttribute('aria-expanded', 'false');
    cardTeeBtn.innerHTML = '<span class="card-tee-dot" aria-hidden="true"></span><span class="card-tee-label">Tee</span><span class="card-tee-chev" aria-hidden="true">▾</span>';

    card.prepend(prevBtn, cardHoleTrigger, nextBtn);
    if (teesHost) card.insertBefore(cardTeeBtn, teesHost);
    else card.append(cardTeeBtn);

    cardHoleTrigger.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = holePop.hidden;
      closeAllPops(willOpen ? holePop : null);
      if (willOpen) {
        syncHoleGrid();
        holePop.hidden = false;
        cardHoleTrigger.setAttribute('aria-expanded', 'true');
        holePop.querySelector('.is-active')?.focus({ preventScroll: true });
      }
    });

    cardTeeBtn.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = teePop.hidden;
      closeAllPops(willOpen ? teePop : null);
      if (willOpen) {
        syncTeeList();
        teePop.hidden = false;
        cardTeeBtn.setAttribute('aria-expanded', 'true');
        teePop.querySelector('.is-active')?.focus({ preventScroll: true });
      }
    });
  }

  function syncHoleGrid() {
    const grid = holePop.querySelector('.det-hole-grid');
    if (!grid || !holesHost) return;
    const buttons = [...holesHost.querySelectorAll('.hb')];
    grid.replaceChildren(...buttons.map(src => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'det-hole-cell' + (src.classList.contains('on') ? ' is-active' : '');
      btn.textContent = src.textContent.trim();
      btn.setAttribute('aria-pressed', String(src.classList.contains('on')));
      btn.addEventListener('click', () => {
        src.click();
        closeAllPops();
      });
      return btn;
    }));
  }

  function syncTeeChipAndList() {
    if (!teesHost || !cardTeeBtn) return;
    const tees = [...teesHost.querySelectorAll('.tee')];
    cardTeeBtn.hidden = tees.length === 0;
    const active = tees.find(t => t.classList.contains('on')) || tees[0];
    if (active) {
      const dist = active.querySelector('b')?.textContent.trim() || '';
      const name = active.querySelector('i')?.textContent.trim() || 'Tee';
      const dot = cardTeeBtn.querySelector('.card-tee-dot');
      const label = cardTeeBtn.querySelector('.card-tee-label');
      if (dot) dot.style.background = active.style.color || active.querySelector('i')?.style.color || 'var(--bv-ink-2)';
      if (label) label.textContent = dist ? `${name} ${dist} m` : name;
      cardTeeBtn.setAttribute('aria-label', `Tee: ${name}${dist ? `, ${dist} meter` : ''}. Tryck för att byta tee.`);
    }
    if (!teePop.hidden) syncTeeList();
  }

  function syncTeeList() {
    const list = teePop.querySelector('.det-tee-list');
    if (!list || !teesHost) return;
    const tees = [...teesHost.querySelectorAll('.tee')];
    list.replaceChildren(...tees.map(src => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = src.classList.contains('on');
      btn.className = 'det-tee-row' + (active ? ' is-active' : '');
      btn.setAttribute('aria-pressed', String(active));
      const dist = src.querySelector('b')?.textContent.trim() || '';
      const name = src.querySelector('i')?.textContent.trim() || 'Tee';
      const color = src.style.color || src.querySelector('i')?.style.color || 'var(--bv-ink-2)';
      btn.innerHTML = `<span class="card-tee-dot" style="background:${color}"></span><b>${name}</b><span>${dist ? `${dist} m` : ''}</span>`;
      btn.addEventListener('click', () => {
        src.click();
        closeAllPops();
      });
      return btn;
    }));
  }

  if (teesHost) {
    new MutationObserver(syncTeeChipAndList).observe(teesHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    syncTeeChipAndList();
  }
  if (holesHost) {
    new MutationObserver(() => { if (!holePop.hidden) syncHoleGrid(); }).observe(holesHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  /* ---- 5. Bottom-Center Floating Camera Pill Bar (#detCamBar) ---- */
  const camBar = document.createElement('div');
  camBar.id = 'detCamBar';
  camBar.className = 'det-hud det-cam-bar bv-panel';
  camBar.setAttribute('role', 'toolbar');
  camBar.setAttribute('aria-label', 'Kameravy och verktyg');
  camBar.innerHTML = `
    <div class="bv-seg det-cam-seg" role="group" aria-label="Kameravy">
      <button type="button" data-det-cam="tee" aria-pressed="false">Tee</button>
      <button type="button" data-det-cam="green" aria-pressed="false">Green</button>
      <button type="button" data-det-cam="orbit" aria-pressed="true">Fri</button>
      <button type="button" data-det-cam="top" aria-pressed="false"><span class="det-cam-long">Ovanifrån</span><span class="det-cam-short">Ovan</span></button>
    </div>
    <button type="button" class="det-bar-btn det-fly-btn" id="detFlyBtn" title="Flygtur över hålet (F)"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Flygtur</span></button>
    <button type="button" class="det-bar-btn det-tools-btn" id="detToolsBtn" aria-label="Verktyg och ljus"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg><span>Verktyg</span></button>
  `;
  camBar.addEventListener('pointerdown', e => e.stopPropagation());
  camBar.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  document.body.append(camBar);

  const detCamButtons = [...camBar.querySelectorAll('[data-det-cam]')];
  for (const btn of detCamButtons) {
    btn.addEventListener('click', () => {
      document.querySelector(`#rail .btn[data-cam="${btn.dataset.detCam}"]`)?.click();
    });
  }
  const detFlyBtn = document.getElementById('detFlyBtn');
  detFlyBtn?.addEventListener('click', () => document.getElementById('flyBtn')?.click());
  const detToolsBtn = document.getElementById('detToolsBtn');
  detToolsBtn?.addEventListener('click', () => document.getElementById('uiToggle')?.click());

  function syncCamBar() {
    for (const btn of detCamButtons) {
      const src = document.querySelector(`#rail .btn[data-cam="${btn.dataset.detCam}"]`);
      const on = Boolean(src?.classList.contains('on'));
      btn.setAttribute('aria-pressed', String(on));
    }
    const flySrc = document.getElementById('flyBtn');
    if (detFlyBtn && flySrc) detFlyBtn.classList.toggle('is-on', flySrc.classList.contains('on'));
  }
  if (railEl) new MutationObserver(syncCamBar).observe(railEl, { attributes: true, attributeFilter: ['class'], subtree: true });
  syncCamBar();

  /* ---- 6. Top-Right Desktop Inspector Toggle [◧] & Shortcuts [?] ---- */
  const topRight = document.createElement('div');
  topRight.id = 'detTopRight';
  topRight.className = 'det-hud det-top-right';
  topRight.innerHTML = `
    <button type="button" class="bv-icon-btn det-icon-btn" id="detHelpBtn" aria-label="Kortkommandon (?)" aria-haspopup="dialog" aria-controls="${shortcutsPop.id}" aria-expanded="false" title="Kortkommandon (?)">?</button>
    <button type="button" class="bv-icon-btn det-icon-btn" id="detInspectorBtn" aria-label="Verktyg och ljus (I)" aria-controls="rail" aria-expanded="true" title="Verktyg & ljus (I)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg></button>
  `;
  topRight.addEventListener('pointerdown', e => e.stopPropagation());
  document.body.append(topRight);

  const topHelpBtn = document.getElementById('detHelpBtn');
  const inspectorBtn = document.getElementById('detInspectorBtn');

  topHelpBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = shortcutsPop.hidden;
    closeAllPops(willOpen ? shortcutsPop : null);
    if (willOpen) {
      shortcutsPop.hidden = false;
      topHelpBtn.setAttribute('aria-expanded', 'true');
      shortcutsPop.querySelector('.det-pop-close')?.focus({ preventScroll: true });
    }
  });

  function syncInspectorBtn() {
    const folded = document.body.classList.contains('rail-folded');
    inspectorBtn?.setAttribute('aria-expanded', String(!folded));
    inspectorBtn?.classList.toggle('is-active', !folded);
  }
  function toggleInspector() {
    if (window.innerWidth <= 768) {
      document.getElementById('uiToggle')?.click();
      return;
    }
    const foldBtn = document.getElementById('railFoldBtn');
    if (foldBtn) foldBtn.click();
    else document.body.classList.toggle('rail-folded');
    syncInspectorBtn();
  }
  inspectorBtn?.addEventListener('click', toggleInspector);

  /* Default Inspector closed on desktop viewports < 1440px so the 3D scene breathes. */
  if (window.innerWidth > 768 && window.innerWidth < 1440 && !document.body.classList.contains('rail-folded')) {
    document.body.classList.add('rail-folded');
  }
  new MutationObserver(syncInspectorBtn).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncInspectorBtn();

  /* ---- 7. Tabbed Inspector (Verktyg | Ljus) + Mobile Quick Rows inside #rail ---- */
  if (railEl) {
    railEl.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    railEl.addEventListener('pointerdown', e => e.stopPropagation());

    const tabsBar = document.createElement('div');
    tabsBar.className = 'bv-seg det-rail-tabs';
    tabsBar.setAttribute('role', 'tablist');
    tabsBar.setAttribute('aria-label', 'Inspector');
    tabsBar.innerHTML = `
      <button type="button" role="tab" data-rail-tab="tools" aria-selected="true">Verktyg</button>
      <button type="button" role="tab" data-rail-tab="lights" aria-selected="false">Ljus</button>
    `;
    const summary = document.getElementById('railHoleSummary');
    if (summary) summary.after(tabsBar);
    else railEl.prepend(tabsBar);

    /* Mobile quick access to Banguide and Banöversikt inside the single Verktyg sheet. */
    const mobileExtras = document.createElement('div');
    mobileExtras.className = 'grp det-mobile-extras';
    mobileExtras.innerHTML = `
      <button type="button" class="btn btn-nav" id="detSheetNoteBtn">Banguide</button>
      <button type="button" class="btn btn-nav" id="detSheetMiniBtn">Banöversikt</button>
    `;
    const facts = document.getElementById('facts');
    if (facts) railEl.insertBefore(mobileExtras, facts);
    else railEl.append(mobileExtras);

    document.getElementById('detSheetNoteBtn')?.addEventListener('click', () => {
      document.getElementById('railCloseBtn')?.click();
      document.getElementById('mobileNoteToggle')?.click();
    });
    document.getElementById('detSheetMiniBtn')?.addEventListener('click', () => {
      document.getElementById('railCloseBtn')?.click();
      document.getElementById('mobileMiniToggle')?.click();
    });

    const setRailTab = tab => {
      railEl.dataset.railTab = tab;
      for (const btn of tabsBar.querySelectorAll('[data-rail-tab]')) {
        btn.setAttribute('aria-selected', String(btn.dataset.railTab === tab));
      }
      if (lights) lights.open = tab === 'lights';
    };
    for (const btn of tabsBar.querySelectorAll('[data-rail-tab]')) {
      btn.addEventListener('click', () => setRailTab(btn.dataset.railTab));
    }
    setRailTab('tools');
  }

  /* ---- 8. Dismiss popovers on outside tap + harmonized shortcuts ---- */
  document.addEventListener('pointerdown', e => {
    if (allPops.every(p => p.hidden)) return;
    if (allPops.some(p => p.contains(e.target))) return;
    if (card?.contains(e.target) || topRight.contains(e.target)) return;
    closeAllPops();
  }, true);

  document.addEventListener('keydown', event => {
    if (document.body.classList.contains('hub') || document.body.classList.contains('course-map') || document.body.classList.contains('pl-on')) return;
    if (event.key === 'Escape') {
      if (allPops.some(p => !p.hidden)) {
        event.preventDefault();
        event.stopPropagation();
        closeAllPops();
        return;
      }
      for (const [panel, launcher] of panels) {
        if (panel?.classList.contains('mobile-open')) queueMicrotask(() => {
          if (!panel.classList.contains('mobile-open')) launcher?.focus({ preventScroll: true });
        });
      }
      return;
    }
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const lower = event.key.length === 1 ? event.key.toLowerCase() : '';
    if (event.key === '?') {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = shortcutsPop.hidden;
      closeAllPops(willOpen ? shortcutsPop : null);
      shortcutsPop.hidden = !willOpen;
      topHelpBtn?.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    if (lower === 'i') {
      event.preventDefault();
      event.stopPropagation();
      toggleInspector();
      return;
    }
    if (lower === 'g') {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById('gridBtn')?.click();
      return;
    }
    if (lower === 'b') {
      event.preventDefault();
      event.stopPropagation();
      const note = document.getElementById('note');
      if (window.innerWidth <= 980) document.getElementById('mobileNoteToggle')?.click();
      else if (note) note.classList.toggle('folded');
      return;
    }
  }, true);

  /* ---- 9. Mirror mobile drawer aria-expanded & clean view focus ---- */
  const panels = [
    ['mini', 'mobileMiniToggle', 'miniCloseBtn'],
    ['note', 'mobileNoteToggle', 'noteCloseBtn'],
  ].map(ids => ids.map(id => document.getElementById(id)));
  for (const [panel, launcher, close] of panels) {
    if (!panel || !launcher) continue;
    const sync = () => launcher.setAttribute('aria-expanded', String(panel.classList.contains('mobile-open')));
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    sync();
    close?.addEventListener('click', () => queueMicrotask(() => launcher.focus({ preventScroll: true })));
  }

  const exit = document.getElementById('cleanExit');
  let clean = false, returnTo = null;
  document.addEventListener('focusin', event => {
    if (!document.body.classList.contains('clean') && event.target !== exit) returnTo = event.target;
  });
  function syncClean() {
    const on = document.body.classList.contains('clean');
    if (on === clean) return;
    clean = on;
    if (on) {
      closeAllPops();
      exit.textContent = document.body.classList.contains('tour') ? 'Avsluta rundturen' : 'Visa reglage';
      exit.focus({ preventScroll: true });
    } else {
      const back = returnTo?.checkVisibility?.({ visibilityProperty: true }) && !returnTo.closest('[inert],[aria-hidden="true"]')
        ? returnTo : document.getElementById('menuToggle');
      back?.focus({ preventScroll: true });
    }
  }
  new MutationObserver(syncClean).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncClean();
}
