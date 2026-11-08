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
import { perEighteen, perHole } from './stats-model.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { loadScorecard } from './course-scorecard.mjs';
import { hubUrl } from './router.js';
import { courseWeather, weatherLine } from './course-weather.mjs';

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
/* an arrow pointing north, turned to where the wind blows */
const WIND = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M6 10l6-6 6 6"/></svg>';

const signed = value => (Math.abs(value) < 0.05 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1).replace('.', ',')}`);

export function createCourseSheet({ courses, lines = {}, onLaunch }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'courseSheet';
  dialog.className = 'cs';
  dialog.setAttribute('aria-labelledby', 'csTitle');
  document.body.append(dialog);

  let course = null, plan = null, slide = 0, slideTimer = 0, card = null, guideShown = false, mine = null;

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
      /* each hole as you usually play it: the scorecard's own row */
      holes: perHole(rounds),
    };
  }

  function render() {
    const c = course;
    const place = COURSE_LOCATIONS[c.slug];
    const tees = c.tees?.names ?? [];
    const photos = Math.max(1, c.photos || 1);
    const past = history(c.slug);
    mine = past?.holes?.length ? { holes: new Map(past.holes.map(h => [h.n, h])), rounds: past.rounds } : null;
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
              <div><dt>Meter</dt><dd class="is-wait" data-length>····</dd></div>
            </dl>
          </div>
        </div>
        <button type="button" class="cs-close" data-close aria-label="Stäng">${CLOSE}</button>

        <div class="cs-form">
          <div class="cs-scroll">
            ${lines[c.slug] || c.description ? `<p class="cs-line">${esc(c.description || lines[c.slug])}</p>` : ''}
            <p class="cs-weather" data-weather hidden></p>
            ${past ? `<div class="cs-past" aria-label="Dina rundor här">
              <div><span>Rundor här</span><b>${past.rounds}</b></div>
              <div><span>Bästa</span><b>${past.best ? `${past.best.strokes}` : '–'}</b>${past.best ? `<small>${past.best.toPar > 0 ? '+' : past.best.toPar < 0 ? '−' : '±'}${Math.abs(past.best.toPar)}</small>` : ''}</div>
              <div><span>Snitt per 18</span><b>${past.average !== null ? signed(past.average) : '–'}</b></div>
              <a class="cs-past-more" href="${hubUrl(`statistik/${encodeURIComponent(c.slug)}`)}">Hål för hål i Statistik<span aria-hidden="true">→</span></a>
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

            <section class="cs-field" aria-labelledby="csCardTitle">
              <h3 class="cs-legend" id="csCardTitle">Scorekort</h3>
              <div class="cs-card" data-card><p class="cs-card-note">Hämtar scorekortet …</p></div>
            </section>

            <section class="cs-field" aria-labelledby="csGuideTitle" data-guide-wrap hidden>
              <div class="cs-guide-head">
                <h3 class="cs-legend" id="csGuideTitle">Banguide</h3>
                <div class="cs-guide-nav">
                  <button type="button" class="cs-round-btn" data-guide-step="-1" aria-label="Föregående hål">${PREV}</button>
                  <button type="button" class="cs-round-btn" data-guide-step="1" aria-label="Nästa hål">${NEXT}</button>
                </div>
              </div>
              <ol class="cs-guide" data-guide tabindex="0" aria-label="Hålen ett i taget"></ol>
            </section>
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
      if (name === 'cs-tee') { plan.tee = Number(value); paintCard(); }
      if (name === 'cs-hole') { plan.hole = Number(value); showHole(plan.hole); }
      if (name === 'cs-light') plan.light = value;
    });
    dialog.querySelector('[data-close]').addEventListener('click', close);
    dialog.querySelector('[data-go]').addEventListener('click', () => launch(true));
    dialog.querySelector('[data-look]').addEventListener('click', () => launch(false));
    /* scrolled, the column's top fades under the close button (course-sheet.css) */
    const scroller = dialog.querySelector('.cs-scroll');
    scroller.addEventListener('scroll', () => scroller.classList.toggle('is-scrolled', scroller.scrollTop > 6), { passive: true });
    for (const btn of dialog.querySelectorAll('[data-guide-step]')) btn.addEventListener('click', () => {
      const list = dialog.querySelector('[data-guide]');
      const step = (list.firstElementChild?.offsetWidth ?? 260) + 10;
      list.scrollBy({ left: Number(btn.dataset.guideStep) * step, behavior: REDUCED ? 'auto' : 'smooth' });
    });
    reflect();

    /* the weather on the course now: the reading the app keeps half an hour */
    courseWeather(place).then(reading => {
      const line = course === c ? weatherLine(reading) : null;
      const el = dialog.querySelector('[data-weather]');
      if (!line || !el) return;
      el.innerHTML = `<span class="cs-w-arrow" style="--to:${line.towardDeg}deg" aria-hidden="true">${WIND}</span>
        <span class="cs-sr">Vädret på banan ${line.stale ? 'vid senaste avläsningen' : 'nu'}:</span>
        <span class="cs-w-text">${line.temp ? `<b>${line.temp}</b>` : ''}<span>${esc(line.sky)}</span><span>${esc(line.wind)}</span></span>
        <small aria-hidden="true">${line.stale ? 'Senast' : 'Nu'}</small>`;
      el.hidden = false;
    });

    /* the card comes from the course's pack, which the round reads next. A phone
       asking to save data fetches it only when asked, and is told its size. */
    card = null;
    guideShown = false;
    if (globalThis.navigator?.connection?.saveData) {
      const kb = Math.max(1, Math.round((c.bytes || 0) / 1024));
      dialog.querySelector('[data-card]').innerHTML = `<button type="button" class="cs-ghost cs-card-load" data-card-load>Hämta scorekort och banguide · ${kb} kB</button>`;
      const length = dialog.querySelector('[data-length]');
      length.textContent = '–';
      length.classList.remove('is-wait');
      dialog.querySelector('[data-card-load]').addEventListener('click', () => {
        dialog.querySelector('[data-card]').innerHTML = '<p class="cs-card-note">Hämtar scorekortet …</p>';
        fetchCard(c);
      });
    } else fetchCard(c);
  }

  function fetchCard(c) {
    loadScorecard(c).then(
      loaded => { if (course === c) { card = loaded; paintCard(); } },
      () => {
        if (course !== c) return;
        dialog.querySelector('[data-card]').innerHTML = '<p class="cs-card-note">Scorekortet kunde inte hämtas just nu.</p>';
        const length = dialog.querySelector('[data-length]');
        length.textContent = '–';
        length.classList.remove('is-wait');
      },
    );
  }

  /* the card in the tee chosen above: par, index and that tee's length, nine by nine */
  function paintCard() {
    if (!card) return;
    const c = course;
    const tee = Math.min(plan.tee, Math.max(0, (card.lengths.length || 1) - 1));
    const name = c.tees?.names?.[tee] ?? 'Meter';
    const dot = `<i style="background:${teeColour(c.tees?.cols?.[tee])}"></i>`;
    const value = v => (v === null || v === undefined ? '–' : v);
    const row = (label, cells, sum, extra = '', cell = 'td') =>
      `<tr${extra}><th scope="row">${label}</th>${cells.map(v => `<${cell}>${value(v)}</${cell}>`).join('')}<${cell} class="cs-sc-sum">${sum === '' ? '' : value(sum)}</${cell}></tr>`;
    /* your own average on each hole, under par blue and over it orange (the
       statistics' diverging scale); the figure itself carries the meaning */
    const decimal = v => v.toFixed(1).replace('.', ',');
    const tone = d => (d <= -0.2 ? ' class="is-under"' : d >= 0.2 ? ' class="is-over"' : '');
    const mineRow = nine => {
      if (!mine) return '';
      const played = nine.holes.map(h => mine.holes.get(h.n));
      const cells = played.map(m => (m ? `<td${tone(m.toPar)}>${decimal(m.average)}</td>` : '<td>–</td>')).join('');
      const sum = played.every(Boolean) ? decimal(played.reduce((s, m) => s + m.average, 0)) : '';
      return `<tr class="cs-sc-mine"><th scope="row">Snitt</th>${cells}<td class="cs-sc-sum">${sum}</td></tr>`;
    };
    dialog.querySelector('[data-card]').innerHTML = card.nines.map(nine => `
      <table class="cs-sc" aria-label="Hål ${nine.holes[0].n}–${nine.holes.at(-1).n}, ${esc(name)} tee">
        <thead>${row('Hål', nine.holes.map(h => h.n), nine.label, '', 'th')}</thead>
        <tbody>
          ${row('Par', nine.holes.map(h => h.par), nine.par)}
          ${card.indexed ? row('Index', nine.holes.map(h => h.index), '') : ''}
          ${row(`${dot}${esc(name)}`, nine.holes.map(h => h.lengths[tee]), nine.lengths[tee], ' class="cs-sc-len"')}
          ${mineRow(nine)}
        </tbody>
      </table>`).join('') + (mine ? `<p class="cs-card-key">Snitt är dina slag per hål på ${mine.rounds} ${mine.rounds === 1 ? 'runda' : 'rundor'} här: <b class="is-under">blått</b> under par, <b class="is-over">orange</b> över.</p>` : '');
    const length = dialog.querySelector('[data-length]');
    const total = card.lengths[tee];
    length.textContent = Number.isFinite(total) ? total.toLocaleString('sv-SE') : '–';
    length.classList.remove('is-wait');

    /* the hole guide: each hole in the course's own words, from the same tee */
    const wrap = dialog.querySelector('[data-guide-wrap]');
    wrap.hidden = !card.described;
    if (!card.described) return;
    const list = dialog.querySelector('[data-guide]');
    const keep = list.scrollLeft;
    list.innerHTML = card.holes.map(h => `
      <li class="cs-hole" data-hole="${h.n}">
        <div class="cs-hole-top">
          <span class="cs-hole-n">${h.n}</span>
          <div class="cs-hole-head">
            <p class="cs-hole-name">${esc(h.name || `Hål ${h.n}`)}</p>
            <p class="cs-hole-facts">Par ${h.par}${Number.isFinite(h.lengths[tee]) ? ` · ${h.lengths[tee]} m` : ''}${h.index !== null ? ` · index ${h.index}` : ''}</p>
          </div>
        </div>
        ${h.note ? `<p class="cs-hole-note">${esc(h.note)}</p>` : ''}
      </li>`).join('');
    list.scrollLeft = keep;
    if (!guideShown) { guideShown = true; showHole(plan.hole, false); }
  }

  /* the guide follows the hole the round starts on (the list is the holes' offset parent) */
  function showHole(n, smooth = true) {
    const list = dialog.querySelector('[data-guide]');
    const item = list?.querySelector(`[data-hole="${n}"]`);
    if (!item) return;
    list.scrollTo({ left: item.offsetLeft, behavior: smooth && !REDUCED ? 'smooth' : 'auto' });
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
