import { savePlayerProfile } from './cloud.mjs';
import { readPlayCheckpoint } from '../play/play-rules.mjs';
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
import { savedCourseStatus } from '../map/map-offline-status.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import {
  LIGHTS, MAP_KEYS, MODES, NOW_LIGHT, PLAYER_DEFAULT_LIGHT, PLAY_CHARACTERS, TEE_KEY, liveRound, readSettings, readText, savedTee, teeColour, writeText,
} from './settings-store.mjs';
import { bestScorecard, perEighteen, perHole } from './stats-model.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { loadScorecard } from './course-scorecard.mjs';
import { hubUrl } from './router.js';
import { layoutLabel } from './course-clubs.mjs';
import { courseWeather, weatherLine } from './course-weather.mjs';

const BASE = import.meta.env.BASE_URL;
const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20.5c3.2-1.6 10.8-1.6 14 0"/><path d="M15.5 3.5v13"/><path d="M15.5 3.8l4.6 1.9-4.6 1.9"/><circle cx="8.5" cy="16.6" r="1.6"/></svg>',
  detailed: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>',
};
const SUB = { detailed: 'Hela banan i full grafik', map: 'GPS-avstånd, klubbhjul och score', play: 'Som ett golfspel, slag för slag' };
/* Spela's golfer, kept for the next round (play/play-mode.mjs reads ?golfare=) */
const CHARACTER_KEY = 'banvy-play-character';
/* an arrow pointing north, turned to where the wind blows */
const WIND = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M6 10l6-6 6 6"/></svg>';

const signed = value => (Math.abs(value) < 0.05 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1).replace('.', ',')}`);

export function createCourseSheet({ courses, lines = {}, onLaunch, onDismiss = null, onEdit = null }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'courseSheet';
  dialog.className = 'cs';
  dialog.setAttribute('aria-labelledby', 'csTitle');
  document.body.append(dialog);

  let restoreScroll = 0, restoreFocus = '';
  let expanded = [];
  let course = null, plan = null, card = null, guideShown = false, mine = null, activeRound = null, checkpoint = null, guideHole = 1;

  function history(slug) {
    const rounds = parseRounds(readText(storage(), MAP_KEYS.rounds, null)).filter(r => r.course === slug);
    if (!rounds.length) return null;
    const scores = rounds.map(perEighteen).filter(Number.isFinite);
    return {
      rounds: rounds.length,
      average: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      best: bestScorecard(rounds),
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
    const startingHoles = [...new Set([1, ...(c.holes >= 18 ? [10] : []), plan.hole])].sort((a, b) => a - b);
    const openIf = name => expanded.includes(name) ? ' open' : '';
    const past = history(c.slug);
    mine = past?.holes?.length ? { holes: new Map(past.holes.map(h => [h.n, h])), rounds: past.rounds } : null;
    const settings = readSettings(storage());
    const hcpText = readText(storage(), MAP_KEYS.handicap, '');
    if (plan.handicap === undefined) plan.handicap = hcpText !== '' && Number.isFinite(Number(hcpText)) ? Number(hcpText) : null;
    plan.light = plan.light ?? settings.light;
    const lightTile = (key, label, sky) => `<label class="cs-light${key === NOW_LIGHT.player ? ' is-now' : ''}">
      <input type="radio" id="csLight-${key}" name="cs-light" value="${key}"${plan.light === key ? ' checked' : ''}>
      <span class="cs-light-sky" aria-hidden="true"${sky ? ` style="--z:${sky[0]};--h:${sky[1]};--g:${sky[2]}"` : ''}></span><span>${label}</span></label>`;

    dialog.innerHTML = `
      <form method="dialog" class="cs-shell">
        <div class="cs-media">
          <div class="cs-slides" aria-hidden="true">${Array.from({ length: photos }, (_, i) =>
            `<i class="${i === 0 ? 'is-on' : ''}" data-src="${BASE}courses/${c.slug}/hero-${i + 1}.webp"></i>`).join('')}</div>
          <div class="cs-media-shade" aria-hidden="true"></div>
          ${photos > 1 ? `<div class="cs-slide-nav">
            <button type="button" class="cs-round-btn" data-slide="-1" aria-label="Föregående bild">${PREV}</button>
            <span class="cs-sr" aria-live="polite" data-photo-count>Bild 1 av ${photos}</span>
            <span class="cs-dots" aria-hidden="true">${Array.from({ length: photos }, (_, i) => `<i class="${i === 0 ? 'is-on' : ''}"></i>`).join('')}</span>
            <button type="button" class="cs-round-btn" data-slide="1" aria-label="Nästa bild">${NEXT}</button>
          </div>` : ''}
          <div class="cs-media-text">
            <p class="cs-where">${esc(c.club)}${place?.city ? ` · ${esc(place.city)}` : ''}</p>
            <h2 class="cs-title" id="csTitle">${esc(layoutLabel(c))}</h2>
            <dl class="cs-facts">
              <div><dt>Par</dt><dd>${c.par}</dd></div>
              <div><dt>Hål</dt><dd>${c.holes}</dd></div>
              <div><dt>Meter</dt><dd class="is-wait" data-length>····</dd></div>
            </dl>
          </div>
          <button type="button" class="cs-close" data-close aria-label="Stäng">${CLOSE}</button>
        </div>

        <div class="cs-form">
          <div class="cs-scroll">
            <details class="cs-collapse cs-choose-mode" data-disclosure="mode"${openIf('mode')}>
              <summary id="csModeTitle"><b data-mode-label></b><span>Byt läge</span></summary>
              <fieldset class="cs-field">
                <legend class="cs-sr">Välj läge</legend>
                <div class="cs-modes">${Object.entries(MODES).map(([key, m]) => `
                <label class="cs-mode"><input type="radio" id="csMode-${key}" name="cs-mode" value="${key}"${plan.mode === key ? ' checked' : ''}>
                  <span class="cs-mode-icon">${ICON[key]}</span><span class="cs-mode-text"><b>${m.label}</b><small>${SUB[key]}</small></span></label>`).join('')}
              </div>
              </fieldset>
            </details>

            ${tees.length ? `<fieldset class="cs-field">
              <legend data-tee-legend>Tee</legend>
              <div class="cs-tees">${tees.map((name, i) => `
                <label class="cs-tee"><input type="radio" id="csTee-${i}" name="cs-tee" value="${i}"${plan.tee === i ? ' checked' : ''}>
                  <span class="cs-tee-option"><b><i style="background:${teeColour(c.tees.cols?.[i])}"></i>${esc(name)}</b>
                    <small data-tee-metres></small></span></label>`).join('')}
              </div>
            </fieldset>` : ''}

            <fieldset class="cs-field" data-round-setup>
              <legend>Starta på</legend>
              <div class="seg cs-seg">${startingHoles.map(n => `<label class="seg-opt"><input type="radio" id="csStart-${n}" name="cs-hole" value="${n}"${plan.hole === n ? ' checked' : ''}><span>Hål ${n}</span></label>`).join('')}</div>
            </fieldset>

            <fieldset class="cs-field" data-round-setup data-only="map play">
              <legend>Spelhandicap</legend>
              <div class="cs-hcp">
                <div class="stepper" role="group" aria-label="Spelhandicap">
                  <button type="button" data-hcp-step="-1" aria-label="Sänk spelhandicap">−</button>
                  <input type="number" id="csHandicap" inputmode="numeric" min="${MIN_HANDICAP}" max="${MAX_HANDICAP}" step="1" data-hcp aria-label="Spelhandicap" placeholder="Ingen" value="${plan.handicap ?? ''}">
                  <button type="button" data-hcp-step="1" aria-label="Höj spelhandicap">+</button>
                </div>
                <p class="cs-note">Ger slag per hål och poäng på scorekortet. Utan handicap räknas slagen.</p>
              </div>
            </fieldset>

            <details class="cs-collapse" data-disclosure="options" data-only="detailed play"${openIf('options')}>
              <summary id="csOptionsTitle"><b data-options-label></b><span data-light-label></span></summary>
              <div class="cs-section-body">
                <fieldset class="cs-field" data-only="play">
                  <legend>Golfare</legend>
                  <div class="seg cs-seg">${PLAY_CHARACTERS.map(c => `<label class="seg-opt"><input type="radio" id="csGolfer-${c.id}" name="cs-character" value="${c.id}"${plan.character === c.id ? ' checked' : ''}><span>${c.label}</span></label>`).join('')}</div>
                </fieldset>

                <fieldset class="cs-field" data-only="detailed play">
                  <legend>Ljus</legend>
                  <div class="cs-lights">
                    ${lightTile(NOW_LIGHT.player, 'Nu', null)}
                    ${LIGHTS.map(light => lightTile(light.player, light.label, light.sky)).join('')}
                  </div>
                </fieldset>
              </div>
            </details>

            <details class="cs-collapse" data-disclosure="info"${openIf('info')}>
              <summary id="csInfoTitle">Om banan</summary>
              <div class="cs-section-body">
                ${lines[c.slug] || c.description || c.boot ? `<p class="cs-line">${esc(c.description || lines[c.slug] || c.boot)}</p>` : ''}
                <p class="cs-weather" data-weather hidden></p>
                ${past ? `<div class="cs-past" aria-label="Dina rundor här">
                  <div><span>Rundor här</span><b>${past.rounds}</b></div>
                  <div><span>Bästa per 18 hål</span><b>${past.best ? signed(past.best.perEighteen) : '–'}</b>${past.best ? `<small>${past.best.strokes} slag på ${past.best.holes} hål</small>` : ''}</div>
                  <div><span>Snitt per 18</span><b>${past.average !== null ? signed(past.average) : '–'}</b></div>
                  <a id="csPastStats" class="cs-past-more" href="${hubUrl(`statistik/${encodeURIComponent(c.slug)}`)}">Hål för hål i Statistik<span aria-hidden="true">→</span></a>
                </div>` : ''}
              </div>
            </details>

            <details class="cs-collapse" data-disclosure="card"${openIf('card')}>
              <summary id="csCardTitle">Scorekort</summary>
              <div class="cs-card" data-card><p class="cs-card-note">Hämtar scorekortet …</p></div>
            </details>

            <details class="cs-collapse" data-disclosure="guide" data-guide-wrap hidden${openIf('guide')}>
              <summary id="csGuideTitle">Banguide</summary>
              <div class="cs-guide-head"><div class="cs-guide-nav">
                  <button type="button" class="cs-round-btn" data-guide-step="-1" aria-label="Föregående hål">${PREV}</button>
                  <button type="button" class="cs-round-btn" data-guide-step="1" aria-label="Nästa hål">${NEXT}</button>
                </div>
              </div>
              <ol class="cs-guide" data-guide tabindex="0" aria-label="Hålen ett i taget"></ol>
            </details>
            <section class="cs-offline-tools" data-only="map" aria-label="Offlinebana">
              <p class="cs-hint" role="status" data-offline-status></p>
              <button type="button" class="cs-ghost" id="csOffline" data-offline-action hidden>Kontrollera offlinebanan</button>
            </section>
            <p class="cs-hint" role="status" data-hint></p>
          </div>

          <div class="cs-actions">
            <button type="button" class="cs-go" id="csLaunch" data-go></button>
            <button type="button" class="cs-ghost" id="csNewSimulator" data-new-sim hidden>Starta ny simulering</button>
            <button type="button" class="cs-ghost" id="csPractice" data-practice data-only="play">Träna slag</button>
            <button type="button" class="cs-ghost" id="csPreview" data-look data-only="map">Bara titta på banan</button>
          </div>
        </div>
      </form>`;

    /* A golfer advances the gallery deliberately. Only the displayed poster is requested. */
    let slide = 0;
    const slides = [...dialog.querySelectorAll('.cs-slides i')];
    const dots = [...dialog.querySelectorAll('.cs-dots i')];
    const paint = i => { const s = slides[i]; if (s?.dataset.src) { s.style.backgroundImage = `url('${s.dataset.src}')`; delete s.dataset.src; } };
    paint(0);
    const show = i => {
      slide = (i + slides.length) % slides.length;
      paint(slide);
      slides.forEach((s, k) => s.classList.toggle('is-on', k === slide));
      dots.forEach((d, k) => d.classList.toggle('is-on', k === slide));
      const count = dialog.querySelector('[data-photo-count]');
      if (count) count.textContent = `Bild ${slide + 1} av ${photos}`;
    };
    for (const btn of dialog.querySelectorAll('[data-slide]')) {
      btn.addEventListener('click', () => show(slide + Number(btn.dataset.slide)));
    }

    for (const disclosure of dialog.querySelectorAll('[data-disclosure]')) {
      disclosure.addEventListener('toggle', () => {
        if (!dialog.open) return;
        if (disclosure.open && disclosure.dataset.disclosure === 'guide') showHole(guideHole, false);
        onEdit?.();
      });
    }

    /* the choices */
    const hcp = dialog.querySelector('[data-hcp]');
    const clampHcp = n => Math.max(MIN_HANDICAP, Math.min(MAX_HANDICAP, Math.round(n)));
    for (const btn of dialog.querySelectorAll('[data-hcp-step]')) btn.addEventListener('click', () => {
      plan.handicap = clampHcp((plan.handicap ?? 18) + Number(btn.dataset.hcpStep));
      hcp.value = String(plan.handicap);
      onEdit?.();
    });
    hcp.addEventListener('change', () => { plan.handicap = hcp.value.trim() === '' ? null : clampHcp(Number(hcp.value)); hcp.value = plan.handicap ?? ''; });
    dialog.querySelector('form').addEventListener('submit', e => e.preventDefault());
    dialog.querySelector('form').addEventListener('change', e => {
      const { name, value } = e.target;
      if (name === 'cs-mode') {
        plan.mode = value;
        reflect();
        paintCard();
        if (!e.target.matches(':focus-visible')) {
          dialog.querySelector('[data-disclosure="mode"]').open = false;
          dialog.querySelector('#csModeTitle').focus({ preventScroll: true });
        }
      }
      if (name === 'cs-tee') { plan.tee = Number(value); paintCard(); }
      if (name === 'cs-hole') { plan.hole = Number(value); showHole(plan.hole); }
      if (name === 'cs-light') { plan.light = value; updateLightLabel(); }
      if (name === 'cs-character') plan.character = value;
      onEdit?.();
    });
    dialog.querySelector('[data-close]').addEventListener('click', dismiss);
    dialog.querySelector('[data-go]').addEventListener('click', () => {
      if (plan.mode === 'play' && checkpoint) { onEdit?.(); close(); onLaunch(course.slug, 'play', { sim: 'fortsatt' }); }
      else launch(true);
    });
    dialog.querySelector('[data-new-sim]').onclick = () => launch(true);
    dialog.querySelector('[data-practice]').onclick = () => {
      onEdit?.();
      close();
      onLaunch(course.slug, 'play', { ...plan, sim: 'traning' });
    };
    dialog.querySelector('[data-look]').addEventListener('click', () => launch(false));
    dialog.querySelector('[data-offline-action]').addEventListener('click', () => launch(false, true));
    const scroller = dialog.querySelector('.cs-scroll');
    scroller.addEventListener('scrollend', () => { if (dialog.open) onEdit?.(); });
    for (const btn of dialog.querySelectorAll('[data-guide-step]')) btn.addEventListener('click', () => {
      const list = dialog.querySelector('[data-guide]');
      const step = (list.firstElementChild?.offsetWidth ?? 260) + 10;
      const nearest = Math.round(list.scrollLeft / step) + 1;
      showHole(Math.min(course.holes, Math.max(1, nearest + Number(btn.dataset.guideStep))));
    });
    dialog.querySelector('[data-guide]').onscrollend = e => {
      const list = e.currentTarget;
      const nearest = [...list.children].reduce((best, item) =>
        !best || Math.abs(item.offsetLeft - list.scrollLeft) < Math.abs(best.offsetLeft - list.scrollLeft) ? item : best, null);
      if (nearest) { guideHole = Number(nearest.dataset.hole); onEdit?.(); }
    };
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

    card = null;
    guideShown = false;
    fetchCard(c);
  }

  function fetchCard(c) {
    const cardEl = dialog.querySelector('[data-card]');
    cardEl.innerHTML = '<p class="cs-card-note">Hämtar scorekortet …</p>';
    loadScorecard(c).then(
      loaded => {
        if (course !== c) return;
        card = loaded;
        const teeOptions = dialog.querySelectorAll('[data-tee-metres]');
        teeOptions.forEach((option, i) => {
          const distance = loaded.lengths[i];
          option.textContent = Number.isFinite(distance) ? `${distance.toLocaleString('sv-SE')} m` : 'Längd saknas';
        });
        paintCard();
      },
      () => {
        if (course !== c) return;
        cardEl.innerHTML = '<p class="cs-card-note">Scorekortet kunde inte hämtas just nu.</p><button type="button" class="cs-ghost" data-card-retry>Försök igen</button>';
        cardEl.querySelector('[data-card-retry]').onclick = () => fetchCard(c);
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
            ${mine?.holes.get(h.n) ? `<p class="cs-hole-mine">Ditt snitt <b${tone(mine.holes.get(h.n).toPar)}>${decimal(mine.holes.get(h.n).average)}</b></p>` : ''}
          </div>
        </div>
        ${h.note ? `<p class="cs-hole-note">${esc(h.note)}</p>` : ''}
        <button type="button" class="cs-ghost" id="csGuidePreview${h.n}" data-guide-preview="${h.n}">Visa hål ${h.n} i ${plan.mode === 'detailed' ? 'detaljerad 3D' : 'Lätt 3D'}</button>
      </li>`).join('');
    list.onclick = e => {
      const button = e.target.closest('[data-guide-preview]');
      if (!button) return;
      const hole = Number(button.dataset.guidePreview);
      guideHole = hole;
      onEdit?.();
      close();
      onLaunch(course.slug, plan.mode === 'detailed' ? 'detailed' : 'map', { round: false, tee: plan.tee, hole, light: plan.light });
    };
    list.scrollLeft = keep;
    if (!guideShown) {
      guideShown = true;
      showHole(guideHole, false);
      if (restoreScroll) dialog.querySelector('.cs-scroll').scrollTop = restoreScroll;
      if (restoreFocus && document.activeElement === dialog.querySelector('[data-go]')) {
        dialog.querySelector('#' + CSS.escape(restoreFocus))?.focus({ preventScroll: true });
      }
      restoreScroll = 0;
      restoreFocus = '';
    }
  }

  /* the guide follows the hole the round starts on (the list is the holes' offset parent) */
  function showHole(n, smooth = true) {
    const list = dialog.querySelector('[data-guide]');
    const item = list?.querySelector(`[data-hole="${n}"]`);
    guideHole = n;
    if (!item || !dialog.querySelector('[data-guide-wrap]').open || !list.clientWidth) return;
    onEdit?.();
    list.scrollTo({ left: item.offsetLeft, behavior: smooth && !REDUCED ? 'smooth' : 'auto' });
  }

  let offlineCheck = 0;
  async function checkOffline() {
    const current = ++offlineCheck;
    if (plan?.mode !== 'map') return;
    const status = dialog.querySelector('[data-offline-status]');
    const button = dialog.querySelector('[data-offline-action]');
    status.textContent = 'Kontrollerar offlinefiler …';
    button.hidden = true;
    const saved = await savedCourseStatus(course.slug, { catalogue: course }).catch(() => 'unavailable');
    if (current !== offlineCheck) return;
    const labels = {
      ready: ['Banan är klar för spel offline.', ''],
      repair: ['Offlinebanan behöver repareras.', 'Reparera offlinebanan'],
      unsaved: ['Banan är inte sparad för offline.', 'Spara för offline'],
      unavailable: ['Offlinefilerna kunde inte kontrolleras.', 'Kontrollera offlinebanan'],
    };
    const [message, action] = labels[saved] ?? labels.unavailable;
    status.textContent = message;
    button.hidden = !action;
    if (action) button.textContent = action;
  }
  window.addEventListener('pageshow', () => { if (dialog.open) checkOffline(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) checkOffline(); });

  /* what changes with the mode: the choices that belong to it, and the button's words */
  function updateLightLabel() {
    const light = plan.light === NOW_LIGHT.player ? 'Nu' : LIGHTS.find(item => item.player === plan.light)?.label;
    dialog.querySelector('[data-light-label]').textContent = light || '';
  }

  function reflect() {
    dialog.dataset.mode = plan.mode;
    dialog.querySelector('[data-mode-label]').textContent = MODES[plan.mode].label;
    dialog.querySelector('[data-options-label]').textContent = plan.mode === 'play' ? 'Ljus och golfare' : 'Ljus';
    updateLightLabel();
    const resume = plan.mode === 'map' && Boolean(activeRound);
    const teeLegend = dialog.querySelector('[data-tee-legend]');
    if (teeLegend) teeLegend.textContent = resume ? 'Tee för förhandsvisning' : 'Tee';
    for (const el of dialog.querySelectorAll('[data-only], [data-round-setup]')) {
      el.hidden = (el.dataset.only && !el.dataset.only.split(' ').includes(plan.mode))
        || (resume && el.hasAttribute('data-round-setup'));
    }
    checkOffline();
    const go = dialog.querySelector('[data-go]');
    dialog.querySelector('[data-new-sim]').hidden = !(plan.mode === 'play' && checkpoint);
    go.innerHTML = plan.mode === 'map'
      ? `${ICON.map}<span>${resume ? 'Fortsätt rundan' : 'Starta rundan'}</span>`
      : plan.mode === 'play' ? `${ICON.play}<span>${checkpoint ? `Fortsätt simuleringen · hål ${checkpoint.round.current}` : 'Starta simuleringen'}</span>`
      : `${ICON.detailed}<span>Utforska i 3D</span>`;
    dialog.querySelector('[data-hint]').textContent = resume
      ? `GPS-rundan pågår${activeRound.hole ? ` på hål ${activeRound.hole}` : ''}.`
      : plan.mode === 'map' ? 'GPS används när du startar rundan.' : '';
  }

  function launch(round, offline = false) {
    onEdit?.();
    if (plan.mode === 'map' && (!round || activeRound)) {
      close();
      onLaunch(course.slug, 'map', round ? { round: 'resume' } : { round: false, tee: plan.tee, hole: activeRound?.hole ?? plan.hole, offline });
      return;
    }
    /* the choices are kept where the map reads them, so both programs agree */
    writeText(storage(), `${TEE_KEY}:${course.slug}`, plan.tee);
    /* the player's handicap is theirs in both: the map's card and the game's points */
    if ((plan.mode === 'map' || plan.mode === 'play') && !savePlayerProfile('handicap', plan.handicap ?? null)) {
      const hint = dialog.querySelector('[data-hint]');
      hint.textContent = 'Handicap kunde inte sparas på enheten. Kontrollera webbläsarens lagring och försök igen.';
      hint.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (plan.mode === 'play') { try { storage()?.setItem(CHARACTER_KEY, plan.character); } catch {} }
    close();
    onLaunch(course.slug, plan.mode, { tee: plan.tee, hole: plan.hole, light: plan.light, sim: plan.mode === 'play' ? 'ny' : undefined, character: plan.character, round: plan.mode === 'map' && round });
  }

  function dismiss() { if (onDismiss) onDismiss(); else close(); }
  function close() {
    if (dialog.open) dialog.close();
  }
  /* a press that starts and ends on the backdrop closes, as on any sheet */
  let downOutside = false;
  const outside = e => e.target === dialog;
  dialog.addEventListener('pointerdown', e => { downOutside = outside(e); });
  dialog.addEventListener('click', e => { if (downOutside && outside(e)) dismiss(); downOutside = false; });
  /* keys typed here are not the page's: the hub's 1-4, a running course's own keys,
     and an Escape that would close the list behind it all stay out. The dialog's own
     Escape still closes it: that is the browser's, not a listener's. */
  dialog.addEventListener('keydown', e => e.stopPropagation());

  dialog.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
  return {
    snapshot: () => ({ ...plan, slug: course?.slug, guideHole,
      expanded: [...dialog.querySelectorAll('[data-disclosure][open]')].map(item => item.dataset.disclosure),
      scroll: dialog.querySelector('.cs-scroll')?.scrollTop ?? 0,
      focusId: dialog.contains(document.activeElement) ? document.activeElement.id : null }),
    open(slug, mode = 'detailed', draft = {}) {
      course = courses.find(c => c.slug === slug);
      if (!course) return;
      activeRound = liveRound(storage(), [course]);
      checkpoint = readPlayCheckpoint(storage(), slug, course.holes);
      let character = 'female';
      try { character = PLAY_CHARACTERS.some(c => c.id === storage()?.getItem(CHARACTER_KEY)) ? storage().getItem(CHARACTER_KEY) : 'female'; } catch {}
      plan = { mode: MODES[mode] ? mode : 'detailed', tee: savedTee(storage(), course), hole: 1, light: null, character };
      if (!readSettings(storage()).light) plan.light = PLAYER_DEFAULT_LIGHT;
      const validHole = n => Number.isInteger(n) && n > 0 && n <= course.holes;
      if (validHole(draft.hole)) plan.hole = draft.hole;
      if (Number.isInteger(draft.tee) && course.tees?.names?.[draft.tee]) plan.tee = draft.tee;
      if (MODES[draft.mode]) plan.mode = draft.mode;
      if (draft.handicap === null || Number.isFinite(draft.handicap)) plan.handicap = draft.handicap;
      if (PLAY_CHARACTERS.some(c => c.id === draft.character)) plan.character = draft.character;
      if (draft.light === NOW_LIGHT.player || LIGHTS.some(l => l.player === draft.light)) plan.light = draft.light;
      guideHole = validHole(draft.guideHole) ? draft.guideHole : plan.hole;
      restoreScroll = Math.max(0, Number(draft.scroll) || 0);
      restoreFocus = draft.focusId || '';
      expanded = Array.isArray(draft.expanded) ? draft.expanded : draft.guideHole ? ['guide'] : [];
      render();
      dialog.showModal();
      const opener = draft.focusId ? dialog.querySelector('#' + CSS.escape(draft.focusId)) : null;
      (opener || dialog.querySelector('[data-go]')).focus({ preventScroll: true });
      if (restoreScroll) dialog.querySelector('.cs-scroll').scrollTop = restoreScroll;
    },
    close,
    isOpen: () => dialog.open,
  };
}
