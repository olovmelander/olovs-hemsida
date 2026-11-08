/* ===========================================================================
   The start menu: how do you want to play?

   The bare route used to open straight onto a grid of thirteen posters, and
   the grid quietly decided the mode by device -- a card opened the light map on
   a phone and the detailed course on a desktop, with nothing on it saying so.
   The owner asked for a menu before the courses (7 November), in the spirit of
   a launch monitor's home screen: the two ways to play and the settings, each a
   card of its own, then the courses for the mode chosen.

   What it shows, and why:
   - the backdrop is a real course in the current graphics (make-posters.mjs
     writes backdrop.webp), the one played last if there is one -- a returning
     golfer sees their own course;
   - "Fortsätt" goes straight back to the last course in the mode it was played,
     one tap, because that is what most visits are for;
   - the mode a device is best at says so, but both are always offered;
   - the settings card states what a launch will use, so nobody has to open it
     to find out.
   Keys 1, 2 and 3 open the cards on a keyboard.
   =========================================================================== */
import '../styles/hub.css';
import { isPhone } from './map-default.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { MAP_KEYS, MODES, lastLaunch, liveRound, readSettings, readText, settingsSummary, readFrameCap } from './settings-store.mjs';
import { perEighteen } from './stats-model.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { coursesByDistance, distanceText } from './nearest-course.mjs';

/* Within this, a phone is at the course or on its way there. */
const NEAR_METRES = 5000;

const BASE = import.meta.env.BASE_URL;
const poster = (slug, n = 1) => `${BASE}courses/${slug}/hero-${n}.webp`;
const backdrop = slug => `${BASE}courses/${slug}/backdrop.webp`;
/* The island green in the fjord: the frame that says "a real course, in 3D" fastest. */
const DEFAULT_BACKDROP = 'veckefjarden';
/* The two modes' pictures. Both are the detailed course's own posters, as the
   cards in both lists are (owner, 7 November): the map is the same place. */
const MODE_ART = { detailed: 'visby', map: 'puttom' };

const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const ARROW = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>';
const CUBE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>';
const INSTALL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>';
const STATS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>';

/* The light map's card carries what the map is for, drawn over the course: a
   shot line from the ball to the flag and the reading the map would give. */
const GPS_ART = `<svg class="mc-gps" viewBox="0 0 400 120" preserveAspectRatio="xMinYMax meet" aria-hidden="true">
  <defs><radialGradient id="mcGlow"><stop offset="0" stop-color="#8ef0a4" stop-opacity=".55"/><stop offset="1" stop-color="#8ef0a4" stop-opacity="0"/></radialGradient></defs>
  <circle cx="300" cy="40" r="34" fill="url(#mcGlow)"/>
  <path class="mc-gps-line" d="M14 106 C 90 88, 200 60, 300 42" fill="none" stroke="#eafff0" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="2 9"/>
  <circle cx="300" cy="42" r="16" fill="none" stroke="#8ef0a4" stroke-opacity=".7" stroke-width="1.5"/>
  <circle cx="300" cy="42" r="30" fill="none" stroke="#8ef0a4" stroke-opacity=".35" stroke-width="1.2"/>
  <path d="M300 42V17l15 6-15 6" fill="#f0a23a" stroke="#f0a23a" stroke-width="1.5" stroke-linejoin="round"/>
  <circle class="mc-gps-you" cx="14" cy="106" r="7" fill="#4bb4d8" stroke="#fff" stroke-width="2.5"/>
  <g transform="translate(118 48)"><rect width="78" height="30" rx="15" fill="rgba(5,12,9,.82)" stroke="rgba(142,240,164,.55)"/>
  <text x="39" y="20" text-anchor="middle" fill="#fff" font-family="JetBrains Mono, monospace" font-size="14" font-weight="600">148 m</text></g>
</svg>`;
/* Statistics as a session report: rounds as columns, the form as a line. */
const STATS_ART = `<svg class="mc-bars" viewBox="0 0 200 120" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
  ${[46, 62, 40, 70, 54, 78, 66, 88].map((h, i) => `<rect x="${12 + i * 23}" y="${112 - h}" width="12" height="${h}" rx="3" fill="rgba(80,150,234,${0.18 + i * 0.05})"/>`).join('')}
  <path d="M18 74 L41 60 L64 80 L87 52 L110 64 L133 42 L156 50 L179 28" fill="none" stroke="#8fbcf2" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="179" cy="28" r="5" fill="#8fbcf2" stroke="#0b1622" stroke-width="2.5"/>
</svg>`;
/* Settings as instruments: three dials of a launch, set. */
const SETTINGS_ART = `<svg class="mc-dials" viewBox="0 0 400 150" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
  ${[['Grafik', 0.78], ['Ljus', 0.42], ['Bag', 0.64]].map(([label, at], i) => {
    const y = 30 + i * 50, x = 8 + at * 300;
    return `<text x="8" y="${y - 14}" fill="#a3b8ab" font-family="Outfit, sans-serif" font-size="12" font-weight="700" letter-spacing="2">${label.toUpperCase()}</text>
    <rect x="8" y="${y - 3}" width="300" height="6" rx="3" fill="rgba(255,255,255,.1)"/>
    <rect x="8" y="${y - 3}" width="${at * 300}" height="6" rx="3" fill="#5fd07a"/>
    <circle cx="${x}" cy="${y}" r="10" fill="#0b1a12" stroke="#8ef0a4" stroke-width="3"/>`;
  }).join('')}
</svg>`;

export function buildHome({ courses, onMode, onSettings, onStats, onResume, onPlan = null }) {
  const phone = isPhone();
  const playable = courses.filter(c => c.status !== 'mapping');
  const holes = playable.reduce((sum, c) => sum + (Number(c.holes) || 0), 0);
  const clubs = new Set(playable.map(c => c.club || c.name)).size;
  const recommended = phone ? 'map' : 'detailed';

  const el = document.createElement('div');
  el.id = 'home';
  el.className = 'hub-screen';
  el.setAttribute('aria-labelledby', 'homeTitle');

  /* `fig` is drawn in the card's own flow, just above its words, so however
     short a screen makes the card the drawing can never sit on the text. */
  const ROUTE = { settings: 'installningar', stats: 'statistik' };
  const card = (key, { kicker, title, body, feats = [], art, icon, fig = '', extra = '', small = false }) => `
    <a class="mode-card mode-${key}${small ? ' is-small' : ''}" href="#${ROUTE[key] ?? MODES[key].route}" data-mode="${key}">
      <span class="mc-art" aria-hidden="true">${art}</span>
      <span class="mc-shade" aria-hidden="true"></span>
      <span class="mc-top">
        <span class="mc-icon" aria-hidden="true">${icon}</span>
        ${key === recommended ? `<span class="mc-badge">${phone ? 'Bäst i mobilen' : 'Bäst på datorn'}</span>` : ''}
        <kbd class="mc-key" aria-hidden="true">${{ detailed: 1, map: 2, stats: 3, settings: 4 }[key]}</kbd>
      </span>
      <span class="mc-body">
        ${fig ? `<span class="mc-fig" aria-hidden="true">${fig}</span>` : ''}
        <span class="mc-kicker">${kicker}</span>
        <span class="mc-title">${title}</span>
        <span class="mc-text">${body}</span>
        ${feats.length ? `<span class="mc-feats">${feats.map(f => `<span>${f}</span>`).join('')}</span>` : ''}
        ${extra}
      </span>
      <span class="mc-go" aria-hidden="true">${ARROW}</span>
    </a>`;

  el.innerHTML = `
    <div class="home-backdrop" aria-hidden="true"><i class="home-bg"></i></div>
    <div class="home-inner">
      <header class="hub-top">
        <a class="hub-brand" href="#" aria-label="Banvy, startmenyn">
          <span class="crest-dot"></span><span class="wordmark">Ban<i>v</i>y</span>
        </a>
        <span class="hub-top-actions">
          <button class="hub-icon-btn hub-install" type="button" data-install hidden>${INSTALL}<span>Installera</span></button>
          <button class="hub-icon-btn" type="button" data-settings aria-label="Inställningar" title="Inställningar">${GEAR}</button>
        </span>
      </header>

      <section class="home-hero">
        <p class="home-eyebrow">Svenska golfbanor i 3D</p>
        <h1 class="home-title" id="homeTitle" tabindex="-1">Från soffan till <em>första tee.</em></h1>
        <p class="home-lead">${playable.length} banor byggda ur verklig terräng och mätta mot klubbarnas egna kort. Utforska dem i detaljerad 3D hemma, eller ta med kartan ut på rundan.</p>
        <dl class="home-stats">
          <div><dt>Banor</dt><dd>${playable.length}</dd></div>
          <div><dt>Hål</dt><dd>${holes}</dd></div>
          <div><dt>Klubbar</dt><dd>${clubs}</dd></div>
        </dl>
      </section>

      <div class="home-resume-slot"></div>

      <nav class="home-modes" aria-label="Välj hur du vill spela">
        ${card('detailed', {
          kicker: 'Hemma vid datorn',
          title: MODES.detailed.label,
          body: 'Hela banan i full grafik. Flyg hålen, läs greenerna och mät varje slag.',
          feats: ['Flygtur', 'Greengrid', 'Kikaren'],
          art: `<i style="background-image:url('${poster(MODE_ART.detailed)}')"></i>`,
          icon: CUBE,
        })}
        ${card('map', {
          kicker: 'Ute på banan',
          title: `${MODES.map.label} <small>med GPS</small>`,
          body: 'Snabb 3D-karta för rundan: GPS-avstånd, klubbhjulet och scorekortet.',
          feats: ['GPS', 'Klubbhjulet', 'Scorekort'],
          art: `<i style="background-image:url('${poster(MODE_ART.map)}')"></i>`,
          fig: GPS_ART,
          icon: PIN,
        })}
        <div class="home-side">
          ${card('stats', {
            kicker: 'Dina rundor',
            title: 'Statistik',
            body: 'Resultat, utveckling, fairways, puttar och dina klubbors längder.',
            art: STATS_ART,
            icon: STATS,
            small: true,
            extra: '<span class="mc-summary" data-stats-summary></span>',
          })}
          ${card('settings', {
            kicker: 'Båda lägena',
            title: 'Inställningar',
            body: 'Grafik, ljus, bag och handicap, klart innan du går ut.',
            art: '',
            fig: SETTINGS_ART,
            icon: GEAR,
            small: true,
            extra: '<span class="mc-summary" data-summary></span>',
          })}
        </div>
      </nav>
    </div>`;

  const bg = el.querySelector('.home-bg');
  const resumeSlot = el.querySelector('.home-resume-slot');
  const summaryEl = el.querySelector('[data-summary]');
  const statsSummaryEl = el.querySelector('[data-stats-summary]');
  /* the rounds the map kept: how many, and where the scoring stands */
  function statsSummary() {
    const rounds = parseRounds(readText(storage(), MAP_KEYS.rounds, null));
    const scores = rounds.map(perEighteen).filter(Number.isFinite);
    if (!rounds.length) return 'Fylls i när du spelar';
    const average = scores.reduce((s, v) => s + v, 0) / (scores.length || 1);
    const sign = average > 0.05 ? '+' : average < -0.05 ? '−' : '±';
    return `${rounds.length} ${rounds.length === 1 ? 'runda' : 'rundor'}${scores.length ? ` · snitt ${sign}${Math.abs(average).toFixed(1).replace('.', ',')}` : ''}`;
  }

  /* The backdrop fades in once decoded, so the menu never flashes a half-drawn picture. */
  let shownBackdrop = null;
  function paintBackdrop(slug) {
    if (shownBackdrop === slug) return;
    shownBackdrop = slug;
    const tryUrl = (urls) => {
      if (!urls.length) return;
      const img = new Image();
      img.onload = () => { bg.style.backgroundImage = `url('${urls[0]}')`; bg.classList.add('is-on'); };
      img.onerror = () => tryUrl(urls.slice(1));
      img.src = urls[0];
    };
    bg.classList.remove('is-on');
    tryUrl([backdrop(slug), poster(slug)]);
  }

  function refresh() {
    const last = lastLaunch(storage(), playable);
    /* A round under way comes first: it is what the golfer is standing in. */
    const live = liveRound(storage(), playable);
    paintBackdrop(live?.course.slug || last?.course.slug || DEFAULT_BACKDROP);
    summaryEl.textContent = settingsSummary(readSettings(storage()), readFrameCap(storage()));
    statsSummaryEl.textContent = statsSummary();
    if (live) {
      const where = [live.hole ? `Hål ${live.hole}` : null, `${live.holes} hål spelade`, live.strokes ? `${live.strokes} slag` : null].filter(Boolean).join(' · ');
      resumeSlot.innerHTML = `
        <button class="home-resume is-live" type="button" data-resume>
          <span class="hr-thumb" style="background-image:url('${poster(live.course.slug)}')" aria-hidden="true"></span>
          <span class="hr-text">
            <span class="hr-kicker"><i class="hr-live" aria-hidden="true"></i>Runda pågår</span>
            <span class="hr-name">${esc(live.course.name)}</span>
            <span class="hr-sub">${esc(where)}</span>
          </span>
          <span class="hr-mode">${PIN}${MODES.map.label}</span>
          <span class="hr-go" aria-hidden="true">${ARROW}</span>
        </button>`;
      const btn = resumeSlot.querySelector('[data-resume]');
      btn.setAttribute('aria-label', `Fortsätt rundan på ${live.course.name}: ${where}`);
      btn.addEventListener('click', () => onResume(live.course.slug, 'map'));
      return;
    }
    lookNear();
    if (!last) { resumeSlot.innerHTML = ''; return; }
    const { course, mode } = last;
    resumeSlot.innerHTML = `
      <button class="home-resume" type="button" data-resume>
        <span class="hr-thumb" style="background-image:url('${poster(course.slug)}')" aria-hidden="true"></span>
        <span class="hr-text">
          <span class="hr-kicker">Fortsätt där du slutade</span>
          <span class="hr-name">${esc(course.name)}</span>
        </span>
        <span class="hr-mode">${mode === 'map' ? PIN : CUBE}${MODES[mode].label}</span>
        <span class="hr-go" aria-hidden="true">${ARROW}</span>
      </button>`;
    const btn = resumeSlot.querySelector('[data-resume]');
    btn.setAttribute('aria-label', `Fortsätt med ${course.name} i ${MODES[mode].label}`);
    btn.addEventListener('click', () => onResume(course.slug, mode));
  }

  /* Standing at a course: the menu offers that course's round. Only where the phone has
     already said yes to its position -- asking belongs to a tap, in the list -- and
     never over a round under way, which refresh() has shown first. */
  let nearAsked = false;
  function lookNear() {
    if (nearAsked || !onPlan || !navigator.permissions || !navigator.geolocation) return;
    nearAsked = true;
    navigator.permissions.query({ name: 'geolocation' }).then(answer => {
      if (answer.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        const nearest = coursesByDistance(coords, COURSE_LOCATIONS).find(({ slug }) => playable.some(c => c.slug === slug));
        if (!nearest || nearest.metres > NEAR_METRES || resumeSlot.querySelector('.is-live')) return;
        const course = playable.find(c => c.slug === nearest.slug);
        resumeSlot.innerHTML = `
          <button class="home-resume is-near" type="button" data-near data-slug="${esc(course.slug)}">
            <span class="hr-thumb" style="background-image:url('${poster(course.slug)}')" aria-hidden="true"></span>
            <span class="hr-text">
              <span class="hr-kicker">${PIN}${nearest.metres < 1500 ? 'Du är vid banan' : 'Nära dig'}</span>
              <span class="hr-name">${esc(course.name)}</span>
              <span class="hr-sub">${distanceText(nearest.metres)} bort · starta rundan med GPS</span>
            </span>
            <span class="hr-go" aria-hidden="true">${ARROW}</span>
          </button>`;
        const btn = resumeSlot.querySelector('[data-near]');
        btn.setAttribute('aria-label', `Starta en runda på ${course.name}, ${distanceText(nearest.metres)} bort`);
        btn.addEventListener('click', () => onPlan(course.slug, 'map'));
      }, () => {}, { timeout: 10000, maximumAge: 120000 });
    }).catch(() => {});
  }

  el.querySelector('[data-settings]').addEventListener('click', () => onSettings());

  /* Installed, Banvy opens from the home screen with no browser round it and works
     without signal on a course it has seen: the menu offers it where the browser can,
     and never once it is installed. */
  const installBtn = el.querySelector('[data-install]');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const offerInstall = () => { installBtn.hidden = standalone || !globalThis.__banvyInstall; };
  offerInstall();
  addEventListener('banvy-installable', offerInstall);
  addEventListener('appinstalled', () => { globalThis.__banvyInstall = null; offerInstall(); });
  installBtn.addEventListener('click', async () => {
    const prompt = globalThis.__banvyInstall;
    if (!prompt) return;
    globalThis.__banvyInstall = null;
    offerInstall();
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* the browser said no */ }
  });
  for (const link of el.querySelectorAll('.mode-card')) {
    link.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      const key = link.dataset.mode;
      if (key === 'settings') onSettings(); else if (key === 'stats') onStats(); else onMode(key);
    });
  }
  /* 1 to 4 -- only while the menu is what is on screen, never out of a field */
  addEventListener('keydown', e => {
    if (el.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === '1') onMode('detailed');
    else if (e.key === '2') onMode('map');
    else if (e.key === '3') onStats();
    else if (e.key === '4') onSettings();
  });

  refresh();
  el.refresh = refresh;
  return el;
}
