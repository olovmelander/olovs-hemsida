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
  activeBackupRounds, exportBackup, readBackup, restoreBackup, undoBackup, hasBackupUndo, launchUrl, replaceStoredValues,
} from './settings-store.mjs';
import { restoredSyncEntries } from './sync-model.mjs';
import { prepareLiveBackup } from './live-rounds.mjs';
import { savedCourseStatus } from '../map/map-offline-status.mjs';
import { displayChoices, systemDisplay } from '../map/map-display.mjs';
import { MAX_HANDICAP, MIN_HANDICAP } from '../map/map-score.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { parseBag } from '../engine/caddie.js';
import { clubAssetKey, clubIcon, clubKind } from '../engine/club-design.mjs';
import { notifyLocalChange, savePlayerProfile, signInDevLocal, signInWithGoogle, signOutCloud, subscribeCloud, syncNow } from './cloud.mjs';

const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const BACK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const GOOGLE_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.8 12.23c0-.72-.06-1.41-.18-2.07H12v3.92h5.5a4.7 4.7 0 0 1-2.04 3.09v2.57h3.3c1.93-1.78 3.04-4.4 3.04-7.51z"/><path fill="currentColor" opacity=".82" d="M12 22c2.76 0 5.07-.91 6.76-2.46l-3.3-2.57c-.91.61-2.08.98-3.46.98-2.66 0-4.91-1.8-5.72-4.21H2.87v2.65A10.2 10.2 0 0 0 12 22z"/><path fill="currentColor" opacity=".68" d="M6.28 13.74a6.12 6.12 0 0 1 0-3.48V7.61H2.87a10.2 10.2 0 0 0 0 8.78l3.41-2.65z"/><path fill="currentColor" opacity=".92" d="M12 6.05c1.5 0 2.85.52 3.91 1.53l2.93-2.93C17.06 2.99 14.76 2 12 2A10.2 10.2 0 0 0 2.87 7.61l3.41 2.65C7.09 7.85 9.34 6.05 12 6.05z"/></svg>';

const SECTIONS = [
  { id: 'set-player', label: 'Spelare och bag', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="7.5" r="3.6"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>' },
  { id: 'set-display', label: 'Visning och tillgänglighet', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>' },
  { id: 'set-offline', label: 'Offlinebanor', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>' },
  { id: 'set-account', label: 'Konto och data', icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>' },
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

export function buildSettings({ courses, onBack, onBag, onBagClosed, onBagDraft }) {
  const el = document.createElement('div');
  el.id = 'settings';
  el.className = 'hub-screen';
  /* the screen on show is the page's main landmark; the hidden ones are out of the tree */
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'settingsTitle');

  const s = readSettings(storage());
  const display = displayChoices(readText(storage(), MAP_KEYS.display), systemDisplay());
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  el.innerHTML = `
    <div class="set-top">
      <div class="hub-top set-top-in">
        <button class="hub-back" type="button" data-back aria-label="Tillbaka">${BACK}<span>Tillbaka</span></button>
        <h1 class="set-title" id="settingsTitle" tabindex="-1">Inställningar</h1>
        <span class="set-saved" data-saved role="status" aria-live="polite"></span>
      </div>
    </div>
    <div class="set-inner">
      <div class="set-layout">
        <nav class="set-nav" aria-label="Avsnitt">
          ${SECTIONS.map(sec => `<button type="button" data-jump="${sec.id}"><span class="sn-icon" aria-hidden="true">${sec.icon}</span>${sec.label}</button>`).join('')}
        </nav>
        <div class="set-main">

          <section class="set-section" id="set-player" aria-labelledby="set-player-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[0].icon}</span>
              <div><h2 id="set-player-h" tabindex="-1">Spelare och bag</h2><p>Klubbråd utgår från din bag. Spelhandicapet används när du startar en runda.</p></div></header>
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

          <section class="set-section" id="set-display" aria-labelledby="set-display-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[1].icon}</span>
              <div><h2 id="set-display-h" tabindex="-1">Visning och tillgänglighet</h2></div></header>
            <h3 class="set-subhead" id="set-3d" tabindex="-1">Detaljerad 3D</h3>
            <div class="set-panel">
              ${row('Grafikkvalitet', 'Auto väljer låg kvalitet på mobiler och enklare datorer, och höjer igen när bildfrekvensen räcker.', seg('quality', QUALITY, s.quality, 'lbl-quality'), { id: 'lbl-quality' })}
              ${row('Grafikmotor', webgpu ? 'Din webbläsare har WebGPU, som Auto använder. WebGL2 är reserven om något ser fel ut.' : 'WebGPU saknas i den här webbläsaren, så banan använder WebGL2 oavsett val.', seg('renderer', RENDERERS, s.renderer, 'lbl-renderer'), { id: 'lbl-renderer' })}
              ${row('Bildfrekvens', 'Ett tak ger en svalare och tystare dator och längre batteritid. Bilden blir inte sämre.', seg('fps', FRAME_CAP_CHOICES.map(c => ({ ...c, label: c.value ? `${c.label} bilder/s` : c.label })), readFrameCap(storage()), 'lbl-fps'), { id: 'lbl-fps' })}
              ${row('Ljus när banan öppnas', 'Ljuset går alltid att byta under Ljus på banan.', swatches('light', 'player', s.light, PLAYER_DEFAULT_LIGHT, 'lbl-light'), { stack: true, id: 'lbl-light' })}
              ${row('Kameravy vid start', '', seg('view', START_VIEWS, s.view, 'lbl-view'), { id: 'lbl-view' })}
              ${switchRow('dev', 'Utvecklarläge', 'Visar terrängpanelen: marknivå, antal tiles och grafikmotor.', readText(storage(), DEV_OVERLAY_KEY) === '1')}
            </div>
            <h3 class="set-subhead" id="set-map" tabindex="-1">Lätt 3D</h3>
            <div class="set-panel">
              ${row('Kartans ljus', '', swatches('maplight', 'map', mapLight(storage()), MAP_DEFAULT_LIGHT, 'lbl-maplight'), { stack: true, id: 'lbl-maplight' })}
              ${switchRow('sun', 'Solläge', 'Ljusa paneler som syns i starkt solljus.', display.sun)}
              ${switchRow('large', 'Större text', '', display.large)}
              ${switchRow('left', 'Klubbhjulet till vänster', 'För dig som håller telefonen i vänster hand.', display.left)}
              ${switchRow('hazards', 'Hinderavstånd', 'Avstånd till bunkrar och vatten framåt på hålet.', mapSwitch(storage(), MAP_KEYS.hazards))}
              ${switchRow('rings', 'Avståndscirklar', 'Bågar vid 100, 150, 200 och 250 m på kartan.', mapSwitch(storage(), MAP_KEYS.rings, '0'))}
              ${switchRow('contours', 'Höjdkurvor', '', mapSwitch(storage(), MAP_KEYS.contours))}
              ${row('Detaljnivå', 'Sänks av sig själv om telefonen inte hinner med, och sparas till nästa runda. Välj Full för att börja om.', seg('mapdetail', MAP_DETAIL, mapDetail(storage()), 'lbl-mapdetail'), { id: 'lbl-mapdetail' })}
            </div>
          </section>

          <section class="set-section" id="set-offline" aria-labelledby="set-offline-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[2].icon}</span>
              <div><h2 id="set-offline-h" tabindex="-1">Offlinebanor</h2><p data-offline-names role="status">Kontrollerar filer på den här enheten…</p></div></header>
            <div class="set-panel" data-offline-list></div>
          </section>

          <section class="set-section" id="set-account" aria-labelledby="set-account-h">
            <header class="set-head"><span class="sh-icon" aria-hidden="true">${SECTIONS[3].icon}</span>
              <div><h2 id="set-account-h" tabindex="-1">Konto och data</h2><p data-data-sub></p></div></header>
            <div class="set-panel" data-account-panel hidden></div>
            <h3 class="set-subhead" id="set-data" tabindex="-1">Data på enheten</h3>
            <div class="set-panel">
              <div class="set-row"><div class="set-label"><b>Sparade rundor</b><small>Allt de räknas till finns under Statistik, och varje runda under Meny, Mina rundor, i kartan.</small></div><div class="set-control set-inline"><span class="set-metric" data-rounds>0</span><a class="set-link" href="#statistik">Statistik</a></div></div>
              <div class="set-row is-stacked set-backup">
                <div class="set-label"><b>Säkerhetskopia</b><small>Spara dina rundor, slag, din bag och dina inställningar i en fil. Offlinebanor hämtas på varje enhet.</small></div>
                <div class="set-inline">
                  <button class="set-primary" type="button" data-backup-save>Spara fil</button>
                  <button class="set-link" type="button" data-backup-load>Läs in fil</button>
                  <button class="set-link" type="button" data-backup-undo hidden>Ångra senaste inläsningen</button>
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
  const saved = (text = 'Sparat', ok = true) => {
    savedEl.innerHTML = `${ok ? CHECK : ''}<span>${esc(text)}</span>`;
    savedEl.classList.add('is-on');
    savedEl.classList.toggle('is-error', !ok);
    clearTimeout(savedTimer);
    if (ok) savedTimer = setTimeout(() => savedEl.classList.remove('is-on'), 1800);
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
    const persist = input.type === 'radio' ? onRadio[input.name] : onSwitch[input.dataset.switch];
    if (!persist) return;
    if (persist(input.type === 'radio' ? input.value : input.checked)) saved();
    else { sync(); saved('Valet kunde inte sparas', false); }
  });

  /* ------------------------------------------------------------- switches */
  const onSwitch = {
    dev: on => writeText(storage(), DEV_OVERLAY_KEY, on ? '1' : null),
    hazards: on => writeText(storage(), MAP_KEYS.hazards, on ? '1' : '0'),
    rings: on => writeText(storage(), MAP_KEYS.rings, on ? '1' : '0'),
    contours: on => writeText(storage(), MAP_KEYS.contours, on ? '1' : '0'),
  };
  /* the map stores its three looks as one choice (map-display.mjs createDisplay) */
  for (const name of ['sun', 'large', 'left']) {
    onSwitch[name] = on => {
      display[name] = on;
      return writeText(storage(), MAP_KEYS.display, JSON.stringify(display));
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
    const value = Number.isFinite(n) ? Math.max(MIN_HANDICAP, Math.min(MAX_HANDICAP, Math.round(n))) : null;
    const ok = savePlayerProfile('handicap', value);
    showHcp();
    if (!ok) saved('Handicap kunde inte sparas', false);
    else if (!quiet) saved();
    return ok;
  };
  /* press and hold keeps stepping: 18 to 36 is one hold, not eighteen taps */
  for (const btn of el.querySelectorAll('[data-hcp-step]')) {
    const step = Number(btn.dataset.hcpStep);
    let repeat = 0, delay = 0, written = false;
    const once = () => { const n = readHcp(); written = setHcp(n === null ? 18 : n + step, true); };
    const stop = () => { clearTimeout(delay); clearInterval(repeat); if (written && (delay || repeat)) saved(); delay = repeat = 0; };
    btn.addEventListener('pointerdown', e => {
      if (e.button) return;
      once();
      delay = setTimeout(() => { repeat = setInterval(once, 90); }, 420);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); once(); if (written) saved(); } });
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
  el.openBag = async draft => {
    try {
      if (!editor) {
        const { createBagEditor } = await import('../ui/bag-editor.mjs');
        editor = createBagEditor({
          getBag: readBag,
          persistsProfile: true,
          onClose: onBagClosed,
          onDraft: onBagDraft,
          onSave(clubs) {
            if (!savePlayerProfile('bag', clubs)) { saved('Bagen kunde inte sparas', false); return false; }
            showBag();
            saved('Bagen sparad');
          },
        });
      }
      editor.open(draft);
    } catch {
      saved('Bagen gick inte att öppna');
    }
  };
  el.leaveBag = () => editor?.leave();
  el.discardBag = () => editor?.discard();
  $('[data-bag-edit]').addEventListener('click', () => onBag ? onBag() : el.openBag());

  /* ----------------------------------------------------------------- data */
  let offlineCheck = 0;
  async function checkOfflineCourses() {
    const check = ++offlineCheck;
    const available = courses.filter(course => course.status !== 'mapping');
    const list = $('[data-offline-list]');
    const status = $('[data-offline-names]');
    status.textContent = 'Kontrollerar filer på den här enheten…';
    const statuses = await Promise.all(available.map(course => savedCourseStatus(course.slug, { catalogue: course })));
    if (check !== offlineCheck) return;
    const ready = statuses.filter(value => value === 'ready').length;
    status.textContent = `${ready} av ${available.length} ${available.length === 1 ? 'bana' : 'banor'} redo för spel utan täckning.`;
    const labels = {
      ready: ['Redo för spel offline', ''],
      repair: ['Filer saknas eller behöver uppdateras', 'Reparera'],
      unsaved: ['Finns inte på enheten', 'Spara offline'],
      unavailable: ['Kunde inte kontrollera filerna', 'Kontrollera'],
    };
    list.innerHTML = available.map((course, i) => {
      const [message, action] = labels[statuses[i]] ?? labels.unavailable;
      const url = launchUrl(course.slug, 'map', { plan: { round: false, offline: true } });
      return `<div class="set-row" data-offline-course="${esc(course.slug)}"><div class="set-label"><b>${esc(course.name)}</b><small>${message}</small></div>
        ${action ? `<a class="set-link" href="${esc(url)}" aria-label="${esc(action + ' · ' + course.name)}">${action}</a>` : ''}</div>`;
    }).join('');
  }
  window.addEventListener('pageshow', () => { if (!el.hidden) checkOfflineCourses(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !el.hidden) checkOfflineCourses(); });
  function showData() {
    $('[data-rounds]').textContent = String(parseRounds(readText(storage(), MAP_KEYS.rounds, null)).length);
    $('[data-backup-undo]').hidden = !hasBackupUndo(storage());
    checkOfflineCourses();
  }

  /* ------------------------------------------------------------- backup
     Out as a file named by its day; in only after saying what it holds and
     what it replaces. */
  const fileInput = $('[data-backup-file]'), confirmBox = $('[data-backup-confirm]');
  const applyBackup = $('[data-backup-apply]'), backupText = $('[data-backup-text]');
  let selection = 0, pending = null, backupOwner;
  function closeBackup() {
    selection++;
    pending = null;
    confirmBox.hidden = true;
    applyBackup.hidden = true;
  }
  function backupProblem(message) {
    backupText.textContent = message;
    confirmBox.hidden = false;
    applyBackup.hidden = !pending;
  }
  $('[data-backup-save]').addEventListener('click', () => {
    closeBackup();
    try {
      const backup = exportBackup(storage());
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `banvy-${backup.exportedAt.slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      saved(`Exporterade ${Object.keys(backup.data).length} poster`);
    } catch (error) { backupProblem(error.message); }
  });
  $('[data-backup-load]').addEventListener('click', () => { closeBackup(); fileInput.value = ''; fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    closeBackup();
    const selected = selection, file = fileInput.files?.[0];
    if (!file) return;
    let read;
    try { read = readBackup(await file.text()); }
    catch { read = { ok: false, reason: 'Filen kunde inte läsas. Välj den igen.' }; }
    if (selected !== selection) return;
    if (!read.ok) { backupProblem(read.reason); return; }
    pending = read;
    const day = read.exportedAt ? new Date(read.exportedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'okänt datum';
    const rounds = parseRounds(read.entries.find(([key]) => key === MAP_KEYS.rounds)?.[1] ?? null).length;
    const account = backupOwner ? ' Inlästa spelaruppgifter synkas till ditt konto.' : '';
    const active = activeBackupRounds(read.entries).length > 0;
    const transfer = active && (read.accountRounds || backupOwner) ? ' En pågående kontorunda på en annan enhet tas över via startsidan.' : '';
    backupText.textContent = `Kopian från ${day} har ${rounds} ${rounds === 1 ? 'runda' : 'rundor'} och ${read.entries.length} poster. Motsvarande uppgifter på enheten ersätts. En ångerkopia sparas först.${account}${transfer}`;
    confirmBox.hidden = false;
    applyBackup.hidden = false;
  });
  $('[data-backup-cancel]').addEventListener('click', closeBackup);
  const importMetadata = (changes, previous) => restoredSyncEntries(storage(), changes, previous);
  applyBackup.addEventListener('click', async () => {
    if (!pending) return;
    const selected = selection;
    applyBackup.disabled = true;
    try {
      const result = await prepareLiveBackup(pending.entries, pending.accountRounds);
      if (selected !== selection) return;
      const written = result.entries.length ? restoreBackup(storage(), result.entries, importMetadata) : 0;
      closeBackup();
      if (written) notifyLocalChange('backup-restored', { keys: result.entries.map(([key]) => key), durable: true });
      sync();
      saved(`Läste in ${written} poster`);
      if (result.courses.length) {
        const names = result.courses.map(slug => courses.find(c => c.slug === slug)?.name ?? slug).join(', ');
        backupProblem(`Läste in ${written} poster. Pågående runda på ${names} och dess slag lämnades orörda. Anslut till nätet och använd Byt enhet på startsidan för att ta över rundan.`);
      }
    } catch (error) { if (selected === selection) backupProblem(error.message); }
    finally { applyBackup.disabled = false; }
  });
  $('[data-backup-undo]').addEventListener('click', () => {
    closeBackup();
    try {
      const keys = undoBackup(storage(), importMetadata);
      notifyLocalChange('backup-restored', { keys, durable: true });
      sync();
      saved('Inläsningen ångrad');
    } catch (error) { backupProblem(error.message); }
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
    resetBtn.textContent = 'Återställ';
    resetBtn.classList.remove('is-armed');
    try {
      replaceStoredValues(storage(), PREFERENCE_KEYS.map(key => [key, null]));
      saved('Återställt');
    } catch { saved('Återställningen misslyckades', false); }
    sync();
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
      hazards: mapSwitch(storage(), MAP_KEYS.hazards), rings: mapSwitch(storage(), MAP_KEYS.rings, '0'), contours: mapSwitch(storage(), MAP_KEYS.contours) };
    for (const [name, on] of Object.entries(switches)) { const input = el.querySelector(`[data-switch="${name}"]`); if (input) input.checked = on; }
    showHcp();
    showBag();
    showData();
  }

  /* ---------------------------------------------------------------- account */
  const accountPanel = $('[data-account-panel]');
  const dataSub = $('[data-data-sub]');

  function syncStatusText(cloud) {
    if (cloud.syncing) return { text: 'Synkar…', cls: ' is-syncing' };
    if (cloud.offline) return { text: cloud.dirty ? 'Offline · väntar på nät för att synka' : 'Offline · sparas lokalt', cls: ' is-pending' };
    if (cloud.dirty) return { text: 'Ändringar väntar på synk', cls: ' is-pending' };
    if (cloud.lastSyncedAt) {
      const time = new Date(cloud.lastSyncedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      return { text: `Synkad kl. ${time}`, cls: '' };
    }
    return { text: 'Ansluten', cls: '' };
  }

  function renderAccount(cloud) {
    const owner = cloud.user?.id ?? null;
    if (owner !== backupOwner) {
      backupOwner = owner;
      closeBackup();
      $('[data-backup-undo]').hidden = !hasBackupUndo(storage());
    }
    accountPanel.hidden = !cloud.available;
    if (dataSub) {
      dataSub.textContent = cloud.user
        ? 'Rundor, slag, bag och handicap synkas med ditt konto. Säkerhetskopian nedan sparar allt lokalt.'
        : 'Allt sparas bara på den här enheten.';
    }
    if (!cloud.available) return;

    if (cloud.user) {
      const initial = (cloud.user.name || cloud.user.email || 'G').trim().charAt(0).toUpperCase();
      const avatar = cloud.user.image
        ? `<img class="set-avatar" src="${esc(cloud.user.image)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="set-avatar" aria-hidden="true">${esc(initial)}</span>`;
      const status = syncStatusText(cloud);
      accountPanel.innerHTML = `
        <div class="set-row is-stacked">
          <div class="set-account-user">
            ${avatar}
            <div class="set-account-meta">
              <b>${esc(cloud.user.name || 'Golfare')}</b>
              <small>${esc(cloud.user.email)}</small>
            </div>
          </div>
          <span class="set-sync-pill${status.cls}">${esc(status.text)}</span>
          ${cloud.error ? `<p class="set-account-err" role="alert">${esc(cloud.error)}</p>` : ''}
          <div class="set-inline">
            <button class="set-primary" type="button" data-sync-now${cloud.syncing ? ' disabled' : ''}>${cloud.syncing ? 'Synkar…' : 'Synka nu'}</button>
            <button class="set-danger" type="button" data-sign-out>Logga ut</button>
          </div>
        </div>`;
      accountPanel.querySelector('[data-sync-now]')?.addEventListener('click', async () => {
        const res = await syncNow();
        if (res.ok && !res.dirty) saved('Synkat');
      });
      accountPanel.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
        const result = await signOutCloud();
        if (result.ok) saved('Utloggad');
      });
      return;
    }

    const actions = [];
    if (cloud.google) {
      actions.push(`<button class="set-primary set-google-btn" type="button" data-google-login>${GOOGLE_MARK}<span>Logga in med Google</span></button>`);
    }
    if (cloud.devAuth) {
      actions.push(`<button class="${cloud.google ? 'set-link' : 'set-primary'}" type="button" data-dev-login>Testa lokalt konto (endast dev)</button>`);
    }
    const note = !cloud.google
      ? (cloud.devAuth
        ? '<p class="set-account-note">Google-inloggning aktiveras när GOOGLE_CLIENT_ID och GOOGLE_CLIENT_SECRET läggs till i .dev.vars eller Cloudflare. Du kan testa D1-synkning direkt med det lokala testkontot.</p>'
        : '<p class="set-account-note">Google-inloggning är inte konfigurerad på servern ännu.</p>')
      : '<p class="set-account-note">Rundor du redan spelat i den här webbläsaren slås ihop med ditt konto vid första inloggningen.</p>';

    accountPanel.innerHTML = `
      <div class="set-row is-stacked">
        <div class="set-label">
          <b>Skapa konto eller logga in</b>
          <small>Du kan alltid spela utan konto. Med konto följer rundor, statistik, klubblängder, bag och handicap med mellan mobil och dator.</small>
        </div>
        ${actions.length ? `<div class="set-inline">${actions.join('')}</div>` : ''}
        ${note}
        ${cloud.error ? `<p class="set-account-err" role="alert">${esc(cloud.error)}</p>` : ''}
      </div>`;

    accountPanel.querySelector('[data-google-login]')?.addEventListener('click', () => signInWithGoogle());
    accountPanel.querySelector('[data-dev-login]')?.addEventListener('click', async () => {
      const res = await signInDevLocal();
      if (res.ok) saved('Inloggad');
    });
  }

  subscribeCloud(renderAccount);
  addEventListener('banvy-sync-changed', () => sync());

  /* ----------------------------------------------------- nav and the way back */
  const scroller = el;
  const navBtns = [...el.querySelectorAll('[data-jump]')];
  const jumpTo = id => {
    const target = el.querySelector(`#${id}`);
    if (!target || target.hidden) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: Math.max(0, target.offsetTop - 84), behavior: reduced ? 'auto' : 'smooth' });
    const heading = target.querySelector('h2') || target;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  navBtns.forEach(btn => btn.addEventListener('click', () => jumpTo(btn.dataset.jump)));
  el.focusSection = jumpTo;
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
