import '../styles/hub.css';
import { isPhone } from './map-default.mjs';
import { parseRounds } from '../map/map-rounds.mjs';
import { parseHistory } from '../map/map-shots.mjs';
import { MAP_KEYS, MODES, courseSessions, lastLaunch, sessionPosition, readSettings, readText, settingsSummary, readFrameCap } from './settings-store.mjs';
import { perEighteen, playedHoles, scoreToPar } from './stats-model.mjs';
import { clubIdFor, groupCourses, layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { coursesByDistance, distanceText } from './nearest-course.mjs';
import { subscribeCloud } from './cloud.mjs';
import { showLiveRounds } from './live-round-panel.mjs';

/* Within this, a phone is at the course or on its way there. */
const NEAR_METRES = 5000;

const BASE = import.meta.env.BASE_URL;
const poster = (slug, n = 1) => `${BASE}courses/${slug}/hero-${n}.webp`;
const backdrop = slug => `${BASE}courses/${slug}/backdrop.webp`;
/* The island green in the fjord: the frame that says "a real course, in 3D" fastest. */
const DEFAULT_BACKDROP = 'veckefjarden';
const DETAILED_ART = poster('visby');
const GPS_ART = `${BASE}play/gps-card.webp`;
/* Spela's card: the game itself, from behind the golfer on the first tee */
const PLAY_ART = `${BASE}play/spela-card.webp`;

const storage = () => { try { return localStorage; } catch { return null; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

const ARROW = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>';
const CUBE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/></svg>';
const INSTALL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>';
const STATS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="M7 16v-4M12 16V7M17 16v-7"/></svg>';
const GOLFER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20.5c3.2-1.6 10.8-1.6 14 0"/><path d="M15.5 3.5v13"/><path d="M15.5 3.8l4.6 1.9-4.6 1.9"/><circle cx="8.5" cy="16.6" r="1.6"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.9 6.5-11.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>';
const USER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1-3.8 3.6-5.6 7-5.6s6 1.8 7 5.6"/></svg>';

export function buildHome({ courses, onMode, onSettings, onAccount = null, onStats, onResume, onPlan = null, onNearby = null }) {
  const phone = isPhone();
  let playable = [];

  const el = document.createElement('div');
  el.id = 'home';
  el.className = 'hub-screen';
  /* the screen on show is the page's main landmark; the hidden ones are out of the tree */
  el.setAttribute('role', 'main');
  el.setAttribute('aria-labelledby', 'homeTitle');

  const activities = {
    detailed: { action: 'Utforska banan', detail: 'Flyg över hålen och läs greenerna.', icon: CUBE, image: DETAILED_ART, key: 1 },
    map: { label: 'Lätt 3D med GPS', action: 'Spela på banan', detail: 'Mät avstånd och för score under rundan.', icon: PIN, image: GPS_ART, key: 2 },
    play: { action: 'Spela en virtuell runda', detail: 'Sikta, slå och putta med din egen bag.', icon: GOLFER, image: PLAY_ART, key: 3 },
  };

  function activityCard(mode) {
    const { label = MODES[mode].label, action, detail, icon, image, key } = activities[mode];
    return `<a class="mode-card mode-${mode}" href="#${MODES[mode].route}" data-mode="${mode}" aria-keyshortcuts="${key}">
      <span class="mc-art" style="background-image:url('${image}')" aria-hidden="true"></span>
      <span class="mc-top"><span class="mc-mode">${icon}${label}</span><kbd aria-hidden="true">${key}</kbd></span>
      <span class="mc-body"><strong class="mc-title">${action}</strong><span class="mc-text">${detail}</span></span>
      <span class="mc-go" aria-hidden="true">${ARROW}</span>
    </a>`;
  }
  el.innerHTML = `
    <div class="home-backdrop" aria-hidden="true"><i class="home-bg"></i></div>
    <div class="home-inner">
      <div class="hub-top">
        <a class="hub-brand" href="#" aria-label="Banvy, startmenyn">
          <span class="crest-dot"></span><span class="wordmark">Ban<i>v</i>y</span>
        </a>
        <span class="hub-top-actions">
          <button class="hub-icon-btn hub-install" type="button" data-install hidden>${INSTALL}<span>Installera</span></button>
          <button class="hub-icon-btn hub-account" type="button" data-account hidden></button>
        </span>
      </div>

      <section class="home-hero">
        <h1 class="home-title" id="homeTitle" tabindex="-1">Välj aktivitet</h1>
        <p class="home-lead"></p>
      </section>
      <div class="home-resume-slot"></div>
      <section class="home-live-transfer" data-live-rounds aria-label="Rundor mellan enheter" hidden></section>
      <nav class="home-modes" aria-label="Aktiviteter">
        ${(phone ? ['map', 'detailed', 'play'] : ['detailed', 'play', 'map']).map(activityCard).join('')}
      </nav>
      <nav class="home-side" aria-label="Dina sidor">
        <a class="mode-card home-tool mode-stats" href="#statistik" data-mode="stats" data-stats aria-keyshortcuts="4">
          ${STATS}<span><strong>Statistik</strong><small data-stats-summary></small></span><kbd aria-hidden="true">4</kbd>
        </a>
        <a class="mode-card home-tool mode-settings" href="#installningar" data-mode="settings" data-settings aria-keyshortcuts="5">
          ${GEAR}<span><strong>Inställningar</strong><small data-summary></small></span><kbd aria-hidden="true">5</kbd>
        </a>
      </nav>
      <footer class="home-legal">
        <a href="${BASE}integritet.html">Integritetspolicy</a>
        <span aria-hidden="true">·</span>
        <a href="${BASE}villkor.html">Villkor</a>
      </footer>
    </div>`;

  const bg = el.querySelector('.home-bg');
  const resumeSlot = el.querySelector('.home-resume-slot');
  const transfers = showLiveRounds(el.querySelector('[data-live-rounds]'), courses);
  const summaryEl = el.querySelector('[data-summary]');
  const statsSummaryEl = el.querySelector('[data-stats-summary]');
  /* the rounds the map kept: how many, and where the scoring stands */
  function statsSummary() {
    const rounds = parseRounds(readText(storage(), MAP_KEYS.rounds, null));
    const scores = rounds.map(perEighteen).filter(Number.isFinite);
    if (!scores.length) {
      const holes = rounds.flatMap(playedHoles);
      if (holes.length) {
        const toPar = scoreToPar(holes);
        if (toPar === null) return `${holes.length} hål med score · par saknas`;
        const strokes = holes.reduce((total, hole) => total + hole.strokes, 0);
        const result = toPar === 0 ? 'Par' : `${toPar > 0 ? '+' : '−'}${Math.abs(toPar)} mot par`;
        return `${holes.length} hål med score · ${strokes} slag · ${result}`;
      }
      const shots = parseHistory(readText(storage(), MAP_KEYS.shots, null));
      if (shots.length) return `${shots.length} ${shots.length === 1 ? 'loggat slag' : 'loggade slag'} · ingen hålscore`;
      if (rounds.length) return `${rounds.length} ${rounds.length === 1 ? 'sparad runda' : 'sparade rundor'} · ingen hålscore`;
      return '';
    }
    const average = scores.reduce((s, v) => s + v, 0) / scores.length;
    const sign = average > 0.05 ? '+' : average < -0.05 ? '−' : '±';
    return `${rounds.length} ${rounds.length === 1 ? 'runda' : 'rundor'} · snitt ${sign}${Math.abs(average).toFixed(1).replace('.', ',')} per 18 hål`;
  }

  /* The backdrop fades in once decoded, so the menu never flashes a half-drawn picture. */
  let shownBackdrop = null;
  function paintBackdrop(slug) {
    if (shownBackdrop === slug) return;
    shownBackdrop = slug;
    const tryUrl = (urls) => {
      if (!urls.length) return;
      const img = new Image();
      img.onload = () => {
        if (shownBackdrop !== slug) return;
        bg.style.backgroundImage = `url('${urls[0]}')`;
        bg.classList.add('is-on');
      };
      img.onerror = () => tryUrl(urls.slice(1));
      img.src = urls[0];
    };
    bg.classList.remove('is-on');
    tryUrl([backdrop(slug), poster(slug)]);
  }

  function refresh() {
    playable = courses.filter(c => c.status !== 'mapping');
    const clubs = groupCourses(playable);
    el.querySelector('.home-lead').textContent = playable.length
      ? `${playable.length} banor på ${clubs.length} klubbar i Sverige`
      : 'Dina rundor och din bag finns i Statistik och Inställningar.';
    requestAnimationFrame(() => transfers.refresh());
    const last = lastLaunch(storage(), playable);
    const sessions = courseSessions(storage(), playable);
    const featured = (phone ? ['map', 'play'] : ['play', 'map']).map(mode => sessions.find(s => s.mode === mode)).filter(Boolean);
    const courseCaption = course => {
      const title = layoutLabel(course);
      const club = clubs.find(group => group.id === clubIdFor(course.slug));
      return club?.courses.length > 1 ? `${club.name} · ${title}` : title;
    };
    paintBackdrop(featured[0]?.course.slug || last?.course.slug || DEFAULT_BACKDROP);
    summaryEl.textContent = settingsSummary(readSettings(storage()), readFrameCap(storage()));
    statsSummaryEl.textContent = statsSummary();
    resumeSlot.classList.toggle('has-multiple', featured.length > 1);
    if (featured.length) {
      const focusId = resumeSlot.contains(document.activeElement) ? document.activeElement.id : null;
      resumeSlot.innerHTML = featured.map(session => {
        const gps = session.mode === 'map';
        const action = gps ? 'Fortsätt GPS-rundan' : 'Fortsätt simuleringen';
        const completed = gps ? (session.holes === 1 ? '1 spelat hål' : `${session.holes} spelade hål`) : '';
        const where = [sessionPosition(session), completed, session.strokes ? `${session.strokes} slag` : ''].filter(Boolean).join(' · ');
        return `<button class="home-resume${gps ? ' is-live' : ''}" id="homeResume-${session.mode}" type="button" data-resume="${session.mode}"${gps ? '' : ' data-simulation'}>
          <span class="hr-thumb" style="background-image:url('${poster(session.course.slug)}')" aria-hidden="true"></span>
          <span class="hr-text"><span class="hr-kicker">${gps ? '<i class="hr-live" aria-hidden="true"></i>' : ''}${action}</span>
            <span class="hr-name">${esc(courseCaption(session.course))}</span><span class="hr-sub">${esc(where)}</span></span>
          <span class="hr-mode">${activities[session.mode].icon}${MODES[session.mode].label}</span>
          <span class="hr-go" aria-hidden="true">${ARROW}</span></button>`;
      }).join('');
      for (const session of featured) {
        resumeSlot.querySelector(`[data-resume="${session.mode}"]`).onclick = () => onResume(session.course.slug, session.mode,
          session.mode === 'map' ? { round: 'resume' } : { sim: 'fortsatt', tee: session.tee, hole: session.hole });
      }
      if (focusId) resumeSlot.querySelector('#' + CSS.escape(focusId))?.focus({ preventScroll: true });
      return;
    }
    lookNear();
    if (resumeSlot.querySelector('[data-near]')) return;
    if (!last) { resumeSlot.innerHTML = ''; return; }
    const { course, mode } = last;
    resumeSlot.innerHTML = `
      <button class="home-resume" type="button" data-resume>
        <span class="hr-thumb" style="background-image:url('${poster(course.slug)}')" aria-hidden="true"></span>
        <span class="hr-text">
          <span class="hr-kicker">Senast öppnad</span>
          <span class="hr-name">${esc(courseCaption(course))}</span>
        </span>
        <span class="hr-mode">${activities[mode].icon}${MODES[mode].label}</span>
        <span class="hr-go" aria-hidden="true">${ARROW}</span>
      </button>`;
    const btn = resumeSlot.querySelector('[data-resume]');
    btn.setAttribute('aria-label', `Öppna ${layoutLabel(course)} i ${MODES[mode].label}`);
    btn.addEventListener('click', () => onResume(course.slug, mode));
  }

  /* Standing at a course: the menu offers that course's round. Only where the phone has
     already said yes to its position -- asking belongs to a tap, in the list -- and
     never over a round under way, which refresh() has shown first. */
  let nearAsked = false;
  function lookNear() {
    if (!playable.length || nearAsked || !onPlan || !navigator.permissions || !navigator.geolocation) return;
    nearAsked = true;
    navigator.permissions.query({ name: 'geolocation' }).then(answer => {
      if (answer.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition(({ coords }) => {
        const nearest = coursesByDistance(coords, COURSE_LOCATIONS).find(({ slug }) => playable.some(c => c.slug === slug));
        if (!nearest || nearest.metres > NEAR_METRES || resumeSlot.querySelector('.is-live, [data-simulation]')) return;
        const course = playable.find(c => c.slug === nearest.slug);
        const club = groupCourses(playable).find(group => group.id === clubIdFor(course.slug));
        const multiple = club?.courses.length > 1;
        const name = multiple ? club.name : course.name;
        resumeSlot.innerHTML = `
          <button class="home-resume is-near" type="button" data-near data-slug="${esc(course.slug)}">
            <span class="hr-thumb" style="background-image:url('${poster(course.slug)}')" aria-hidden="true"></span>
            <span class="hr-text">
              <span class="hr-kicker">${PIN}${nearest.metres < 1500 ? 'Du är vid banan' : 'Nära dig'}</span>
              <span class="hr-name">${esc(name)}</span>
              <span class="hr-sub">${distanceText(nearest.metres)} bort · ${multiple ? 'välj bana för GPS-rundan' : 'starta rundan med GPS'}</span>
            </span>
            <span class="hr-go" aria-hidden="true">${ARROW}</span>
          </button>`;
        const btn = resumeSlot.querySelector('[data-near]');
        btn.setAttribute('aria-label', `Välj bana för en runda på ${name}, ${distanceText(nearest.metres)} bort`);
        btn.addEventListener('click', () => multiple && onNearby ? onNearby(club.id) : onPlan(course.slug, 'map'));
      }, () => {}, { timeout: 10000, maximumAge: 120000 });
    }).catch(() => {});
  }

  const accountBtn = el.querySelector('[data-account]');
  accountBtn.addEventListener('click', () => (onAccount ? onAccount() : onSettings()));
  subscribeCloud(cloud => {
    accountBtn.hidden = !cloud.available;
    if (!cloud.available) return;
    if (cloud.user) {
      const firstName = (cloud.user.name || cloud.user.email || 'Konto').trim().split(/\s+/)[0];
      const initial = firstName.charAt(0).toUpperCase() || 'G';
      const avatar = cloud.user.image
        ? `<img class="hub-account-avatar" src="${esc(cloud.user.image)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="hub-account-avatar" aria-hidden="true">${esc(initial)}</span>`;
      const dotClass = cloud.syncing ? ' is-syncing' : (cloud.offline || cloud.dirty) ? ' is-pending' : '';
      accountBtn.innerHTML = `${avatar}<span class="hub-account-name">${esc(firstName)}</span><span class="hub-sync-dot${dotClass}" aria-hidden="true"></span>`;
      accountBtn.setAttribute('aria-label', `Konto: ${cloud.user.name || cloud.user.email}`);
      accountBtn.title = cloud.syncing ? 'Synkar…' : cloud.offline ? 'Offline — väntar på nät' : 'Synkat konto';
    } else {
      accountBtn.innerHTML = `${USER_ICON}<span>Logga in</span>`;
      accountBtn.setAttribute('aria-label', 'Logga in för att synka dina rundor');
      accountBtn.title = 'Logga in';
    }
  });
  addEventListener('banvy-sync-changed', () => refresh());

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
  /* 1 to 5 -- only while the menu is what is on screen, never out of a field */
  addEventListener('keydown', e => {
    if (el.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === '1') onMode('detailed');
    else if (e.key === '2') onMode('map');
    else if (e.key === '3') onMode('play');
    else if (e.key === '4') onStats();
    else if (e.key === '5') onSettings();
  });

  refresh();
  el.refresh = refresh;
  return el;
}
