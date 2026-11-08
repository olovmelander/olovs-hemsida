/* ===========================================================================
   A course, before the round: the page a course card opens.

   The owner asked for it on 7 November: "When starting a course you should be
   able to start a round, selecting the tee and other things before you start
   playing, like in other apps." A card used to launch at once, and the tee,
   the handicap and the light were things to find afterwards, inside a program
   that had just spent seconds loading.

   So a card opens this: the course in its posters, what it is, how you have
   played it before, and the few choices a round starts with --
     - how to play it (the detailed course or the light map),
     - the tee (kept per course and shared with the map, so it is the same tee
       in both),
     - where to start (the 1st or the 10th, on an eighteen),
     - for the map, the playing handicap the card counts strokes with,
     - for the detailed course, the light it opens in.
   One button starts it. The map begins its round at once (runda=1) and asks
   for the position; "Bara titta" opens it without a round.

   A native <dialog>: the browser keeps the focus inside, Escape closes it, and
   the page under it is inert.
   =========================================================================== */
/* the segmented choices and the stepper are the settings page's; over a running
   course (the player's list) they are not loaded yet */
import '../styles/hub.css';
import '../styles/course-sheet.css';
import { MAX_HANDICAP, MIN_HANDICAP } from '../map/map-score.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import {
  LIGHTS, MAP_KEYS, MODES, NOW_LIGHT, PLAYER_DEFAULT_LIGHT, TEE_KEY, readSettings, readText, savedTee, teeColour, writeText,
} from './settings-store.mjs';
import { perEighteen } from './stats-model.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';

const BASE = import.meta.env.BASE_URL;
const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const ICON = {
  detailed: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>',
};
const SUB = { detailed: 'Hela banan i full grafik', map: 'GPS-avstånd, klubbhjul och score' };

const signed = value => (Math.abs(value) < 0.05 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1).replace('.', ',')}`);

export function createCourseSheet({ courses, lines = {}, onLaunch }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'courseSheet';
  dialog.className = 'cs';
  dialog.setAttribute('aria-labelledby', 'csTitle');
  document.body.append(dialog);

  let course = null, plan = null, slide = 0, slideTimer = 0;

  function history(slug) {
    const rounds = parseRounds(readText(storage(), MAP_KEYS.rounds, null)).filter(r => r.course === slug);
    if (!rounds.length) return null;
    const scores = rounds.map(perEighteen).filter(Number.isFinite);
    const full = rounds.filter(r => (r.holes || []).filter(h => !h.picked && Number.isFinite(h.strokes)).length >= 9);
    const best = full.reduce((top, r) => (!top || r.totals.toPar < top.totals.toPar ? r : top), null);
    return {
      rounds: rounds.length,
      average: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      best: best ? { strokes: best.totals.strokes, toPar: best.totals.toPar } : null,
      last: rounds.map(r => r.date).sort().at(-1),
    };
  }

  function render() {
    const c = course;
    const place = COURSE_LOCATIONS[c.slug];
    const tees = c.tees?.names ?? [];
    const photos = Math.max(1, c.photos || 1);
    const past = history(c.slug);
    const settings = readSettings(storage());
    const hcpText = readText(storage(), MAP_KEYS.handicap, '');
    plan.handicap = hcpText !== '' && Number.isFinite(Number(hcpText)) ? Number(hcpText) : null;
    plan.light = plan.light ?? settings.light;
    const lightTile = (key, label, sky) => `<label class="cs-light${key === NOW_LIGHT.player ? ' is-now' : ''}">
      <input type="radio" name="cs-light" value="${key}"${plan.light === key ? ' checked' : ''}>
      <span class="cs-light-sky" aria-hidden="true"${sky ? ` style="--z:${sky[0]};--h:${sky[1]};--g:${sky[2]}"` : ''}></span><span>${label}</span></label>`;

    dialog.innerHTML = `
      <form method="dialog" class="cs-shell">
        <div class="cs-media">
          <div class="cs-slides" aria-hidden="true">${Array.from({ length: photos }, (_, i) =>
            `<i class="${i === 0 ? 'is-on' : ''}" data-src="${BASE}courses/${c.slug}/hero-${i + 1}.webp"></i>`).join('')}</div>
          <div class="cs-media-shade" aria-hidden="true"></div>
          ${photos > 1 ? `<div class="cs-slide-nav">
            <button type="button" class="cs-round-btn" data-slide="-1" aria-label="Föregående bild">${PREV}</button>
            <span class="cs-dots" aria-hidden="true">${Array.from({ length: photos }, (_, i) => `<i class="${i === 0 ? 'is-on' : ''}"></i>`).join('')}</span>
            <button type="button" class="cs-round-btn" data-slide="1" aria-label="Nästa bild">${NEXT}</button>
          </div>` : ''}
          <div class="cs-media-text">
            <p class="cs-where">${esc(c.club)}${place?.city ? ` · ${esc(place.city)}` : ''}</p>
            <h2 class="cs-title" id="csTitle">${esc(c.name)}</h2>
            <dl class="cs-facts">
              <div><dt>Par</dt><dd>${c.par}</dd></div>
              <div><dt>Hål</dt><dd>${c.holes}</dd></div>
              <div><dt>Tees</dt><dd>${tees.length}</dd></div>
            </dl>
          </div>
        </div>
        <button type="button" class="cs-close" data-close aria-label="Stäng">${CLOSE}</button>

        <div class="cs-form">
          <div class="cs-scroll">
            ${lines[c.slug] || c.description ? `<p class="cs-line">${esc(c.description || lines[c.slug])}</p>` : ''}
            ${past ? `<div class="cs-past" aria-label="Dina rundor här">
              <div><span>Rundor här</span><b>${past.rounds}</b></div>
              <div><span>Bästa</span><b>${past.best ? `${past.best.strokes}` : '–'}</b>${past.best ? `<small>${past.best.toPar > 0 ? '+' : past.best.toPar < 0 ? '−' : '±'}${Math.abs(past.best.toPar)}</small>` : ''}</div>
              <div><span>Snitt per 18</span><b>${past.average !== null ? signed(past.average) : '–'}</b></div>
            </div>` : ''}

            <fieldset class="cs-field">
              <legend>Spela i</legend>
              <div class="cs-modes">${Object.entries(MODES).map(([key, m]) => `
                <label class="cs-mode"><input type="radio" name="cs-mode" value="${key}"${plan.mode === key ? ' checked' : ''}>
                  <span class="cs-mode-icon">${ICON[key]}</span><span class="cs-mode-text"><b>${m.label}</b><small>${SUB[key]}</small></span></label>`).join('')}
              </div>
            </fieldset>

            ${tees.length > 1 ? `<fieldset class="cs-field">
              <legend>Tee</legend>
              <div class="cs-tees">${tees.map((name, i) => `
                <label class="cs-tee"><input type="radio" name="cs-tee" value="${i}"${plan.tee === i ? ' checked' : ''}>
                  <span><i style="background:${teeColour(c.tees.cols?.[i])}"></i>${esc(name)}</span></label>`).join('')}
              </div>
            </fieldset>` : ''}

            ${c.holes >= 18 ? `<fieldset class="cs-field">
              <legend>Starta på</legend>
              <div class="seg cs-seg">${[1, 10].map(n => `<label class="seg-opt"><input type="radio" name="cs-hole" value="${n}"${plan.hole === n ? ' checked' : ''}><span>Hål ${n}</span></label>`).join('')}</div>
            </fieldset>` : ''}

            <fieldset class="cs-field" data-only="map">
              <legend>Spelhandicap</legend>
              <div class="cs-hcp">
                <div class="stepper" role="group" aria-label="Spelhandicap">
                  <button type="button" data-hcp-step="-1" aria-label="Sänk spelhandicap">−</button>
                  <input type="number" inputmode="numeric" min="${MIN_HANDICAP}" max="${MAX_HANDICAP}" step="1" data-hcp aria-label="Spelhandicap" placeholder="–" value="${plan.handicap ?? ''}">
                  <button type="button" data-hcp-step="1" aria-label="Höj spelhandicap">+</button>
                </div>
                <p class="cs-note">Ger slag per hål och poäng på scorekortet. Utan handicap räknas slagen.</p>
              </div>
            </fieldset>

            <fieldset class="cs-field" data-only="detailed">
              <legend>Ljus</legend>
              <div class="cs-lights">
                ${lightTile(NOW_LIGHT.player, 'Nu', null)}
                ${LIGHTS.map(light => lightTile(light.player, light.label, light.sky)).join('')}
              </div>
            </fieldset>
          </div>

          <div class="cs-actions">
            <button type="button" class="cs-go" data-go></button>
            <button type="button" class="cs-ghost" data-look data-only="map">Bara titta på banan</button>
            <p class="cs-hint" data-hint></p>
          </div>
        </div>
      </form>`;

    /* the posters, loaded as they come up, and rolled slowly */
    const slides = [...dialog.querySelectorAll('.cs-slides i')];
    const dots = [...dialog.querySelectorAll('.cs-dots i')];
    const paint = i => { const s = slides[i]; if (s?.dataset.src) { s.style.backgroundImage = `url('${s.dataset.src}')`; delete s.dataset.src; } };
    paint(0);
    const show = i => {
      slide = (i + slides.length) % slides.length;
      paint(slide);
      paint((slide + 1) % slides.length);
      slides.forEach((s, k) => s.classList.toggle('is-on', k === slide));
      dots.forEach((d, k) => d.classList.toggle('is-on', k === slide));
    };
    for (const btn of dialog.querySelectorAll('[data-slide]')) btn.addEventListener('click', () => { show(slide + Number(btn.dataset.slide)); restartRoll(); });
    const restartRoll = () => {
      clearInterval(slideTimer);
      if (!REDUCED && slides.length > 1) slideTimer = setInterval(() => show(slide + 1), 5200);
    };
    restartRoll();
    if (slides.length > 1) setTimeout(() => paint(1), 400);

    /* the choices */
    const hcp = dialog.querySelector('[data-hcp]');
    const clampHcp = n => Math.max(MIN_HANDICAP, Math.min(MAX_HANDICAP, Math.round(n)));
    for (const btn of dialog.querySelectorAll('[data-hcp-step]')) btn.addEventListener('click', () => {
      plan.handicap = clampHcp((plan.handicap ?? 18) + Number(btn.dataset.hcpStep));
      hcp.value = String(plan.handicap);
    });
    hcp.addEventListener('change', () => { plan.handicap = hcp.value.trim() === '' ? null : clampHcp(Number(hcp.value)); hcp.value = plan.handicap ?? ''; });
    dialog.querySelector('form').addEventListener('change', e => {
      const { name, value } = e.target;
      if (name === 'cs-mode') { plan.mode = value; reflect(); }
      if (name === 'cs-tee') plan.tee = Number(value);
      if (name === 'cs-hole') plan.hole = Number(value);
      if (name === 'cs-light') plan.light = value;
    });
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelector('[data-go]').addEventListener('click', () => launch(true));
    dialog.querySelector('[data-look]').addEventListener('click', () => launch(false));
    reflect();
  }

  /* what changes with the mode: the choices that belong to it, and the button's words */
  function reflect() {
    dialog.dataset.mode = plan.mode;
    for (const el of dialog.querySelectorAll('[data-only]')) el.hidden = el.dataset.only !== plan.mode;
    const go = dialog.querySelector('[data-go]');
    go.innerHTML = plan.mode === 'map'
      ? `${ICON.map}<span>Starta rundan</span>`
      : `${ICON.detailed}<span>Spela i 3D</span>`;
    dialog.querySelector('[data-hint]').textContent = plan.mode === 'map'
      ? 'Rundan startar direkt och GPS:en slås på. Du kan avsluta den när som helst.'
      : 'Banan laddas i full grafik. Tee och ljus går att byta på banan.';
  }

  function launch(round) {
    /* the choices are kept where the map reads them, so both programs agree */
    writeText(storage(), `${TEE_KEY}:${course.slug}`, plan.tee);
    if (plan.mode === 'map') writeText(storage(), MAP_KEYS.handicap, plan.handicap ?? null);
    close();
    onLaunch(course.slug, plan.mode, { tee: plan.tee, hole: plan.hole, light: plan.light, round: plan.mode === 'map' && round });
  }

  function close() {
    clearInterval(slideTimer);
    if (dialog.open) dialog.close();
  }
  dialog.addEventListener('close', () => clearInterval(slideTimer));
  /* a press that starts and ends on the backdrop closes, as on any sheet */
  let downOutside = false;
  const outside = e => e.target === dialog;
  dialog.addEventListener('pointerdown', e => { downOutside = outside(e); });
  dialog.addEventListener('click', e => { if (downOutside && outside(e)) close(); downOutside = false; });
  /* keys typed here are not the page's: the hub's 1-4, a running course's own keys,
     and an Escape that would close the list behind it all stay out. The dialog's own
     Escape still closes it: that is the browser's, not a listener's. */
  dialog.addEventListener('keydown', e => e.stopPropagation());

  return {
    open(slug, mode = 'detailed') {
      course = courses.find(c => c.slug === slug);
      if (!course) return;
      plan = { mode: MODES[mode] ? mode : 'detailed', tee: savedTee(storage(), course), hole: 1, light: null };
      if (!readSettings(storage()).light) plan.light = PLAYER_DEFAULT_LIGHT;
      render();
      dialog.showModal();
      dialog.querySelector('[data-go]').focus();
    },
    close,
    isOpen: () => dialog.open,
  };
}
