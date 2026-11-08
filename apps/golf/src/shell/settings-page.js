/* ===========================================================================
   Inställningar: everything a visitor can set, before a course is loaded.

   Until 7 November every setting lived inside the program it belongs to: the
   detailed course's quality, frame cap and light behind a 40-second boot, the
   map's light and looks in its own menu, the bag in both. Now they are on one
   page off the start menu, grouped by the mode they change, and each is stored
   where its program already reads it (settings-store.mjs says how), so the
   two programs and this page can never disagree.

   Every change saves at once and says so; there is no Save button to forget.
   The bag opens the same editor the detailed course uses, and the reset clears
   preferences only -- never the bag, the handicap, rounds or offline courses.
   =========================================================================== */
import '../styles/hub.css';
import {
  FRAME_CAP_CHOICES, FRAME_CAP_KEY, DEV_OVERLAY_KEY, LIGHTS, MAP_DEFAULT_LIGHT, MAP_DETAIL, MAP_KEYS,
  NOW_LIGHT, PLAYER_DEFAULT_LIGHT, PREFERENCE_KEYS, QUALITY, RENDERERS, START_VIEWS, BAG_KEY,
  mapDetail, mapLight, mapSwitch, readFrameCap, readSettings, readText, writeSettings, writeText,
  exportBackup, readBackup, restoreBackup, offlineCourses,
} from './settings-store.mjs';
import { displayChoices, systemDisplay } from '../map/map-display.mjs';
import { MAX_HANDICAP, MIN_HANDICAP } from '../map/map-score.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { parseBag } from '../engine/caddie.js';
import { clubAssetKey, clubIcon, clubKind } from '../engine/club-design.mjs';

const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const BACK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

const SECTIONS = [
  { id: 'set-3d', label: 'Detaljerad 3D', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>' },
  { id: 'set-map', label: 'Lätt 3D', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>' },
  { id: 'set-player', label: 'Spelare', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="7.5" r="3.6"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>' },
  { id: 'set-data', label: 'Data', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>' },
];

/* ------------------------------------------------------------ the controls */
let uid = 0;
const row = (label, help, control, { stack = false, id } = {}) => `
  <div class="set-row${stack ? ' is-stacked' : ''}">
    <div class="set-label"><b id="${id}">${label}</b>${help ? `<small>${help}</small>` : ''}</div>
    <div class="set-control">${control}</div>
  </div>`;

function seg(name, choices, value, labelId) {
  return `<div class="seg" role="radiogroup" aria-labelledby="${labelId}" data-name="${name}">
    ${choices.map(c => `<label class="seg-opt"><input type="radio" name="${name}" value="${c.value}"${String(c.value) === String(value) ? ' checked' : ''}><span>${c.label}</span></label>`).join('')}
  </div>`;
}

function switchRow(name, label, help, checked) {
  const id = `sw-${++uid}`;
  return `<label class="set-row set-switch" for="${id}">
    <span class="set-label"><b>${label}</b>${help ? `<small>${help}</small>` : ''}</span>
    <input id="${id}" type="checkbox" role="switch" data-switch="${name}"${checked ? ' checked' : ''}>
  </label>`;
}

/* A light as its own sky: the tile is the preset's zenith, horizon and ground. */
function swatches(name, field, value, fallback, labelId) {
  const nowTile = `<label class="swatch is-now"><input type="radio" name="${name}" value="${NOW_LIGHT[field]}"${value === NOW_LIGHT[field] ? ' checked' : ''}>
    <span class="sw-sky" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></svg></span>
    <span class="sw-name">Nu</span><span class="sw-note">Solen och vädret just nu</span><span class="sw-check" aria-hidden="true">${CHECK}</span></label>`;
  return `<div class="swatches" role="radiogroup" aria-labelledby="${labelId}" data-name="${name}">
    ${nowTile}
    ${LIGHTS.map(light => `<label class="swatch"><input type="radio" name="${name}" value="${light[field]}"${light[field] === value ? ' checked' : ''}>
      <span class="sw-sky" aria-hidden="true" style="--z:${light.sky[0]};--h:${light.sky[1]};--g:${light.sky[2]}"></span>
      <span class="sw-name">${light.label}</span>${light[field] === fallback ? '<span class="sw-note">Standard</span>' : ''}<span class="sw-check" aria-hidden="true">${CHECK}</span></label>`).join('')}
  </div>`;
}

export function buildSettings({ courses, onBack }) {
  const el = document.createElement('div');
  el.id = 'settings';
  el.className = 'hub-screen';
  el.setAttribute('aria-labelledby', 'settingsTitle');

  const s = readSettings(storage());
  const display = displayChoices(readText(storage(), MAP_KEYS.display), systemDisplay());
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  el.innerHTML = `
    <header class="set-top">
      <div class="hub-top set-top-in">
        <button class="hub-back" type="button" data-back aria-label="Tillbaka">${BACK}<span>Tillbaka</span></button>
        <h1 class="set-title" id="settingsTitle" tabindex="-1">Inställningar</h1>
        <span class="set-saved" data-saved role="status" aria-live="polite"></span>
      </div>
    </header>
    <div class="set-inner">
      <div class="set-layout">
        <nav class="set-nav" aria-label="Avsnitt">
          ${SECTIONS.map(sec => `<button type="button" data-jump="${sec.id}"><span class="sn-icon" aria-hidden="true">${sec.icon}</span>${sec.label}</button>`).join('')}
        </nav>
        <div class="set-main">

          <section class="set-section" id="set-3d" aria-labelledby="set-3d-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[0].icon}</span>
              <div><h2 id="set-3d-h">Detaljerad 3D</h2><p>Gäller varje bana du startar i detaljerad 3D, härifrån eller från en annan bana.</p></div></header>
            <div class="set-panel">
              ${row('Grafikkvalitet', 'Auto väljer låg kvalitet på mobiler och enklare datorer, och höjer igen när bildfrekvensen räcker.', seg('quality', QUALITY, s.quality, 'lbl-quality'), { id: 'lbl-quality' })}
              ${row('Grafikmotor', webgpu ? 'Din webbläsare har WebGPU, som Auto använder. WebGL2 är reserven om något ser fel ut.' : 'WebGPU saknas i den här webbläsaren, så banan använder WebGL2 oavsett val.', seg('renderer', RENDERERS, s.renderer, 'lbl-renderer'), { id: 'lbl-renderer' })}
              ${row('Bildfrekvens', 'Ett tak ger en svalare och tystare dator och längre batteritid. Bilden blir inte sämre.', seg('fps', FRAME_CAP_CHOICES.map(c => ({ ...c, label: c.value ? `${c.label} bilder/s` : c.label })), readFrameCap(storage()), 'lbl-fps'), { id: 'lbl-fps' })}
              ${row('Ljus när banan öppnas', 'Ljuset går alltid att byta under Ljus på banan.', swatches('light', 'player', s.light, PLAYER_DEFAULT_LIGHT, 'lbl-light'), { stack: true, id: 'lbl-light' })}
              ${row('Kameravy vid start', '', seg('view', START_VIEWS, s.view, 'lbl-view'), { id: 'lbl-view' })}
              ${switchRow('dev', 'Utvecklarläge', 'Visar terrängpanelen: marknivå, antal tiles och grafikmotor.', readText(storage(), DEV_OVERLAY_KEY) === '1')}
            </div>
          </section>

          <section class="set-section" id="set-map" aria-labelledby="set-map-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[1].icon}</span>
              <div><h2 id="set-map-h">Lätt 3D</h2><p>Kartan för rundan. Samma val finns under Meny i kartan.</p></div></header>
            <div class="set-panel">
              ${row('Kartans ljus', '', swatches('maplight', 'map', mapLight(storage()), MAP_DEFAULT_LIGHT, 'lbl-maplight'), { stack: true, id: 'lbl-maplight' })}
              ${switchRow('sun', 'Solläge', 'Ljusa paneler som syns i starkt solljus.', display.sun)}
              ${switchRow('large', 'Större text', '', display.large)}
              ${switchRow('left', 'Klubbhjulet till vänster', 'För dig som håller telefonen i vänster hand.', display.left)}
              ${switchRow('hazards', 'Hinderavstånd', 'Avstånd till bunkrar och vatten framåt på hålet.', mapSwitch(storage(), MAP_KEYS.hazards))}
              ${switchRow('contours', 'Höjdkurvor', '', mapSwitch(storage(), MAP_KEYS.contours))}
              ${row('Detaljnivå', 'Sänks av sig själv om telefonen inte hinner med, och sparas till nästa runda. Välj Full för att börja om.', seg('mapdetail', MAP_DETAIL, mapDetail(storage()), 'lbl-mapdetail'), { id: 'lbl-mapdetail' })}
            </div>
          </section>

          <section class="set-section" id="set-player" aria-labelledby="set-player-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[2].icon}</span>
              <div><h2 id="set-player-h">Spelare</h2><p>Din bag ger klubbråden i båda lägena; handicapet fylls i när du startar en runda.</p></div></header>
            <div class="set-panel">
              ${row('Spelhandicap', 'Ger slag per hål på scorekortet i kartan.', `
                <div class="stepper" role="group" aria-labelledby="lbl-hcp">
                  <button type="button" data-hcp-step="-1" aria-label="Sänk spelhandicap">−</button>
                  <input type="number" inputmode="numeric" min="${MIN_HANDICAP}" max="${MAX_HANDICAP}" step="1" data-hcp aria-labelledby="lbl-hcp" placeholder="–">
                  <button type="button" data-hcp-step="1" aria-label="Höj spelhandicap">+</button>
                </div>`, { id: 'lbl-hcp' })}
              <div class="set-row is-stacked set-bag">
                <div class="set-label"><b>Min bag</b><small data-bag-summary></small></div>
                <ol class="bag-ladder" data-bag-ladder aria-label="Carry per klubba"></ol>
                <button class="set-primary" type="button" data-bag-edit>Redigera bagen</button>
              </div>
            </div>
          </section>

          <section class="set-section" id="set-data" aria-labelledby="set-data-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[3].icon}</span>
              <div><h2 id="set-data-h">Data</h2><p>Allt sparas bara på den här enheten.</p></div></header>
            <div class="set-panel">
              <div class="set-row"><div class="set-label"><b>Sparade rundor</b><small>Allt de räknas till finns under Statistik, och varje runda under Meny, Mina rundor, i kartan.</small></div><div class="set-control set-inline"><span class="set-metric" data-rounds>0</span><a class="set-link" href="#statistik">Statistik</a></div></div>
              <div class="set-row"><div class="set-label"><b>Banor sparade för spel utan nät</b><small data-offline-names>Spara en bana under Meny i kartan.</small></div><div class="set-control"><span class="set-metric" data-offline>0</span></div></div>
              <div class="set-row is-stacked set-backup">
                <div class="set-label"><b>Säkerhetskopia</b><small>Rundor, slag, bag, handicap och inställningar finns bara i den här webbläsaren. Spara dem i en fil, och läs in filen igen på en ny telefon eller efter att webbläsarens data rensats.</small></div>
                <div class="set-inline">
                  <button class="set-primary" type="button" data-backup-save>Spara fil</button>
                  <button class="set-link" type="button" data-backup-load>Läs in fil</button>
                  <input type="file" accept="application/json,.json" data-backup-file hidden>
                </div>
                <div class="set-confirm" data-backup-confirm hidden role="alert">
                  <p data-backup-text></p>
                  <div class="set-inline"><button class="set-danger" type="button" data-backup-apply>Läs in och ersätt</button><button class="set-link" type="button" data-backup-cancel>Avbryt</button></div>
                </div>
              </div>
              <div class="set-row"><div class="set-label"><b>Återställ inställningar</b><small>Ställer tillbaka alla val på den här sidan. Bagen, handicapet och rundorna påverkas inte.</small></div>
                <div class="set-control"><button class="set-danger" type="button" data-reset>Återställ</button></div></div>
            </div>
          </section>

        </div>
      </div>
    </div>`;

  const $ = sel => el.querySelector(sel);
  const savedEl = $('[data-saved]');
  let savedTimer = 0;
  const saved = (text = 'Sparat') => {
    savedEl.innerHTML = `${CHECK}<span>${text}</span>`;
    savedEl.classList.add('is-on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => savedEl.classList.remove('is-on'), 1800);
  };

  /* ---------------------------------------------------------- radio groups */
  const onRadio = {
    quality: v => writeSettings(storage(), { quality: v }),
    renderer: v => writeSettings(storage(), { renderer: v }),
    light: v => writeSettings(storage(), { light: v }),
    view: v => writeSettings(storage(), { view: v }),
    fps: v => writeText(storage(), FRAME_CAP_KEY, Number(v)),
    maplight: v => writeText(storage(), MAP_KEYS.light, v),
    mapdetail: v => writeText(storage(), MAP_KEYS.quality, Number(v)),
  };
  el.addEventListener('change', e => {
    const input = e.target;
    if (input.type === 'radio' && onRadio[input.name]) { onRadio[input.name](input.value); saved(); }
    if (input.dataset.switch) { onSwitch[input.dataset.switch](input.checked); saved(); }
  });

  /* ------------------------------------------------------------- switches */
  const onSwitch = {
    dev: on => writeText(storage(), DEV_OVERLAY_KEY, on ? '1' : null),
    hazards: on => writeText(storage(), MAP_KEYS.hazards, on ? '1' : '0'),
    contours: on => writeText(storage(), MAP_KEYS.contours, on ? '1' : '0'),
  };
  /* the map stores its three looks as one choice (map-display.mjs createDisplay) */
  for (const name of ['sun', 'large', 'left']) {
    onSwitch[name] = on => {
      display[name] = on;
      writeText(storage(), MAP_KEYS.display, JSON.stringify(display));
    };
  }

  /* ------------------------------------------------------------- handicap */
  const hcp = $('[data-hcp]');
  const readHcp = () => {
    const text = readText(storage(), MAP_KEYS.handicap, '');
    const n = Number(text);
    return text !== '' && Number.isFinite(n) ? n : null;
  };
  const showHcp = () => { const n = readHcp(); hcp.value = n === null ? '' : String(n); };
  const setHcp = (n, quiet = false) => {
    if (n === null) writeText(storage(), MAP_KEYS.handicap, null);
    else writeText(storage(), MAP_KEYS.handicap, String(Math.max(MIN_HANDICAP, Math.min(MAX_HANDICAP, Math.round(n)))));
    showHcp();
    if (!quiet) saved();
  };
  /* press and hold keeps stepping: 18 to 36 is one hold, not eighteen taps */
  for (const btn of el.querySelectorAll('[data-hcp-step]')) {
    const step = Number(btn.dataset.hcpStep);
    let repeat = 0, delay = 0;
    const once = () => { const n = readHcp(); setHcp(n === null ? 18 : n + step, true); };
    const stop = () => { clearTimeout(delay); clearInterval(repeat); if (delay || repeat) saved(); delay = repeat = 0; };
    btn.addEventListener('pointerdown', e => {
      if (e.button) return;
      once();
      delay = setTimeout(() => { repeat = setInterval(once, 90); }, 420);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); once(); saved(); } });
  }
  hcp.addEventListener('change', () => setHcp(hcp.value.trim() === '' ? null : Number(hcp.value)));

  /* ------------------------------------------------------------------ bag */
  const ladder = $('[data-bag-ladder]');
  const readBag = () => parseBag(readText(storage(), BAG_KEY, null));
  function showBag() {
    const bag = readBag();
    const carries = bag.filter(c => c.carry > 0).map(c => c.carry);
    const longest = Math.max(1, ...carries);
    $('[data-bag-summary]').textContent = `${bag.length} klubbor${carries.length ? ` · ${Math.min(...carries)}–${Math.max(...carries)} m carry` : ''}`;
    ladder.innerHTML = bag.map(club => {
      const putter = clubKind(club) === 'putter';
      return `<li${putter ? ' class="is-putter"' : ''}>
        <span class="bl-icon" aria-hidden="true">${clubIcon(clubAssetKey(club))}</span>
        <span class="bl-name">${esc(club.name)}</span>
        <span class="bl-bar" aria-hidden="true"><i style="width:${putter ? 0 : (100 * club.carry / longest).toFixed(1)}%"></i></span>
        <span class="bl-carry">${putter ? 'På green' : `${club.carry}<small> m</small>`}</span>
      </li>`;
    }).join('');
  }
  let editor = null;
  $('[data-bag-edit]').addEventListener('click', async () => {
    try {
      if (!editor) {
        const { createBagEditor } = await import('../ui/bag-editor.mjs');
        editor = createBagEditor({
          getBag: readBag,
          onSave(clubs) {
            /* the format the detailed course writes (main.js BAG_KEY) */
            writeText(storage(), BAG_KEY, JSON.stringify({ version: 3, clubs }));
            showBag();
            saved('Bagen sparad');
          },
        });
      }
      editor.open();
    } catch {
      saved('Bagen gick inte att öppna');
    }
  });

  /* ----------------------------------------------------------------- data */
  function showData() {
    $('[data-rounds]').textContent = String(parseRounds(readText(storage(), MAP_KEYS.rounds, null)).length);
    const offline = offlineCourses(storage());
    $('[data-offline]').textContent = String(offline.length);
    if (offline.length) {
      $('[data-offline-names]').textContent = offline.map(slug => courses.find(c => c.slug === slug)?.name || slug).join(', ');
    }
  }

  /* ------------------------------------------------------------- backup
     Out as a file named by its day; in only after saying what it holds and
     what it replaces. */
  $('[data-backup-save]').addEventListener('click', () => {
    const backup = exportBackup(storage());
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `banvy-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    saved(`Sparade ${Object.keys(backup.data).length} poster`);
  });
  const fileInput = $('[data-backup-file]'), confirmBox = $('[data-backup-confirm]');
  let pending = null;
  $('[data-backup-load]').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const read = readBackup(await file.text());
    confirmBox.hidden = false;
    if (!read.ok) {
      pending = null;
      $('[data-backup-text]').textContent = read.reason;
      $('[data-backup-apply]').hidden = true;
      return;
    }
    pending = read.entries;
    const day = read.exportedAt ? new Date(read.exportedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'okänt datum';
    const rounds = parseRounds(read.entries.find(([key]) => key === MAP_KEYS.rounds)?.[1] ?? null).length;
    $('[data-backup-text]').textContent = `Kopian från ${day} har ${rounds} ${rounds === 1 ? 'runda' : 'rundor'} och ${read.entries.length} poster. Det som finns här med samma namn ersätts.`;
    $('[data-backup-apply]').hidden = false;
  });
  $('[data-backup-cancel]').addEventListener('click', () => { pending = null; confirmBox.hidden = true; });
  $('[data-backup-apply]').addEventListener('click', () => {
    if (!pending) return;
    const written = restoreBackup(storage(), pending);
    pending = null;
    confirmBox.hidden = true;
    sync();
    saved(`Läste in ${written} poster`);
  });

  /* Two steps, because it cannot be undone: the first press asks, the second
     within four seconds does it. */
  const resetBtn = $('[data-reset]');
  let armed = 0;
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      resetBtn.textContent = 'Tryck igen för att återställa';
      resetBtn.classList.add('is-armed');
      armed = setTimeout(() => { armed = 0; resetBtn.textContent = 'Återställ'; resetBtn.classList.remove('is-armed'); }, 4000);
      return;
    }
    clearTimeout(armed); armed = 0;
    for (const key of PREFERENCE_KEYS) writeText(storage(), key, null);
    resetBtn.textContent = 'Återställ';
    resetBtn.classList.remove('is-armed');
    sync();
    saved('Återställt');
  });

  /* Back to what the page shows: after a reset, and whenever it is opened
     again (the map or the course may have changed a value meanwhile). */
  function sync() {
    const now = readSettings(storage());
    const fresh = displayChoices(readText(storage(), MAP_KEYS.display), systemDisplay());
    Object.assign(display, fresh);
    const values = {
      quality: now.quality, renderer: now.renderer, light: now.light, view: now.view,
      fps: readFrameCap(storage()), maplight: mapLight(storage()), mapdetail: mapDetail(storage()),
    };
    for (const [name, value] of Object.entries(values)) {
      for (const input of el.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === String(value);
    }
    const switches = { dev: readText(storage(), DEV_OVERLAY_KEY) === '1', sun: display.sun, large: display.large, left: display.left,
      hazards: mapSwitch(storage(), MAP_KEYS.hazards), contours: mapSwitch(storage(), MAP_KEYS.contours) };
    for (const [name, on] of Object.entries(switches)) { const input = el.querySelector(`[data-switch="${name}"]`); if (input) input.checked = on; }
    showHcp();
    showBag();
    showData();
  }

  /* ----------------------------------------------------- nav and the way back */
  const scroller = el;
  const navBtns = [...el.querySelectorAll('[data-jump]')];
  navBtns.forEach(btn => btn.addEventListener('click', () => {
    const target = el.querySelector(`#${btn.dataset.jump}`);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: target.offsetTop - 84, behavior: reduced ? 'auto' : 'smooth' });
    target.querySelector('h2')?.focus?.({ preventScroll: true });
  }));
  /* the section in view is the one the nav marks */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        navBtns.forEach(b => b.setAttribute('aria-current', String(b.dataset.jump === entry.target.id)));
      }
    }, { root: scroller, rootMargin: '-30% 0px -60% 0px' });
    for (const sec of el.querySelectorAll('.set-section')) io.observe(sec);
  }
  $('[data-back]').addEventListener('click', () => onBack());

  sync();
  el.refresh = sync;
  return el;
}
