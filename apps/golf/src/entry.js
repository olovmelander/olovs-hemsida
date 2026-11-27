/* Keep the bare course chooser off the 3D engine's critical path. Deep links and
   historical URLs still enter the player directly. */
/* The design tokens come first, so every route (start menu, map, player, game)
   reads one palette and one type scale (styles/tokens.css). */
import './styles/tokens.css';
import './styles/primitives.css';
import { isPhone, navigationParams, opensMap } from './shell/map-default.mjs';
import { clubIdFor } from './shell/course-clubs.mjs';
import { hubUrl, legacyTarget, mapUrl } from './shell/router.js';
import { coursePreview } from './course-previews.mjs';
import { supportedVisualSearch } from './engine/look-mode.mjs';
import { MOVE_PARAM } from './shell/pages-move.mjs';

/* Banvy left GitHub Pages: a visitor from an old address may bring their data in
   the fragment. It leaves the address first, then Inställningar offers it. */
if (location.hash.startsWith(`#${MOVE_PARAM}=`)) {
  const { receiveMove } = await import('./shell/move-in.mjs');
  let storage = null;
  try { storage = localStorage; } catch { /* the move is offered every time */ }
  await receiveMove({ location, history, storage, base: import.meta.env.BASE_URL });
}

/* The browser offers to install the app once, early, before the start menu has
   loaded: kept here, so the menu can offer it as its own "Installera". */
addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  globalThis.__banvyInstall = event;
  globalThis.dispatchEvent(new globalThis.Event('banvy-installable'));
});

const supportedSearch = supportedVisualSearch(location.search);
if (supportedSearch !== location.search) {
  history.replaceState(history.state, '', location.pathname + supportedSearch + location.hash);
}

const legacy = legacyTarget(location.pathname, location.search);
const lightMap = opensMap(location.search, isPhone());
const launch = navigationParams(location.search);
if (!legacy && launch.get('bana')) showLaunchContext(launch, lightMap);
if (legacy) {
  location.replace(legacy + location.hash);
} else if (lightMap) {
  /* The light map for a real round: its own small program, with no 3D engine. */
  await import('./map/map-app.js');
} else if (coursePreview(new URLSearchParams(location.search).get('bana'))) {
  await import('./course-preview.js');
} else if (navigationParams(location.search).size === 0 && /(?:\/|\/index\.html)$/.test(location.pathname)) {
  /* Two separate import() call sites, never one with a ternary: the bundler
     attaches each call site's dependency preloads to the CALL, so a shared
     expression preloads the union -- the bare route was fetching all of
     three.js before the chooser ran. */
  await import('./hub.js');
} else {
  // A failed graphics boot can always fall back to Lätt 3D (no WebGPU/Three.js required),
  // and to an offline saved copy when this course was cached on the device.
  addEventListener('banvy-boot-failed', async () => {
    const params = new URLSearchParams(location.search);
    const slug = params.get('bana');
    if (!slug) return;
    const lite = document.getElementById('bootLite');
    if (lite) {
      lite.href = mapUrl(slug, { hole: params.get('hal'), tee: params.get('tee'), preview: true });
      lite.hidden = false;
    }
    try {
      const { savedCourseStatus } = await import('./map/map-offline-status.mjs');
      if (await savedCourseStatus(slug) !== 'ready') return;
      const link = document.getElementById('bootSaved');
      link.href = mapUrl(slug, { hole: params.get('hal'), tee: params.get('tee'), preview: true }) + '&kopia=1';
      link.hidden = false;
    } catch { /* Reload and Lätt 3D fallback work even if offline helpers are unavailable. */ }
  }, { once: true });
  await Promise.all([
    /* The mouse and the keyboard move through the course by ui/camera-navigation.mjs,
       bound once the course is up. It is outside the hashed folders, like the HUD. */
    import('./main.js').then(() => import('./ui/camera-navigation.mjs')
      .then(({ installCameraNavigation }) => installCameraNavigation())
      .catch(error => console.error('Navigation:', error))),
    import('./ui/detailed-hud.mjs').then(({ installDetailedHud }) => installDetailedHud()),
  ]);
}

function showLaunchContext(params, map) {
  const slug = params.get('bana');
  const mode = map ? 'Lätt 3D med GPS' : params.get('spela') === '1' ? 'Simulator' : 'Detaljerad 3D';
  const boot = document.getElementById('boot');
  const kicker = document.getElementById('bootMode');
  const hole = params.get('hal');
  kicker.textContent = /^[1-9]\d*$/.test(hole) ? `${mode} · Hål ${hole}` : mode;
  kicker.hidden = false;
  const back = document.getElementById('bootReturn');
  if (back) {
    const modeRoute = map ? 'karta' : params.get('spela') === '1' ? 'spela' : '3d';
    const q = new URLSearchParams({ bana: slug, lage: modeRoute });
    for (const key of ['hal', 'tee']) if (/^[1-9]\d*$/.test(params.get(key))) q.set(key, params.get(key));
    back.href = hubUrl(`klubb/${encodeURIComponent(clubIdFor(slug))}?${q}`);
    back.textContent = 'Avbryt';
    back.hidden = false;
  }
  try {
    const catalogue = JSON.parse(localStorage.getItem('banvy-hub-catalogue-v1'));
    const course = Array.isArray(catalogue) && catalogue.find(c => c.slug === slug);
    if (course?.name) document.getElementById('bootTitle').textContent = course.name;
    if (course?.club) document.getElementById('bootSub').textContent = course.club;
  } catch { /* Direct links receive their official names when the course loads. */ }

  const bar = document.getElementById('bar');
  const fill = bar.firstElementChild;
  const stage = document.getElementById('bootStage');
  const message = document.getElementById('bmsg');
  const update = () => {
    if (boot.classList.contains('done') || !document.getElementById('bootRecovery').hidden) {
      observer.disconnect();
      stage.textContent = '';
      return;
    }
    const percent = parseFloat(fill.style.width);
    if (Number.isFinite(percent)) bar.setAttribute('aria-valuenow', String(percent));
    const phase = percent >= 85 ? 'Ritar banan' : percent > 3 || message.textContent === 'hämtar terrängen'
      ? 'Förbereder banan' : 'Hämtar banan';
    if (stage.textContent !== phase) stage.textContent = phase;
  };
  const observer = new MutationObserver(update);
  observer.observe(boot, { attributes: true, attributeFilter: ['class'] });
  observer.observe(fill, { attributes: true, attributeFilter: ['style'] });
  observer.observe(message, { childList: true });
  observer.observe(document.getElementById('bootRecovery'), { attributes: true, attributeFilter: ['hidden'] });
  update();
}
