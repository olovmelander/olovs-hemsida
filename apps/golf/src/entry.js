/* Keep the bare course chooser off the 3D engine's critical path. Deep links and
   historical URLs still enter the player directly. */
import { isPhone, navigationParams, opensMap } from './shell/map-default.mjs';
import { legacyTarget, mapUrl } from './shell/router.js';
import { coursePreview } from './course-previews.mjs';
import { supportedVisualSearch } from './engine/look-mode.mjs';

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
if (legacy) {
  location.replace(legacy + location.hash);
} else if (opensMap(location.search, isPhone())) {
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
  // A failed graphics boot can still open the GPS map this golfer downloaded.
  addEventListener('banvy-boot-failed', async () => {
    const params = new URLSearchParams(location.search);
    const slug = params.get('bana');
    if (!slug) return;
    try {
      const { savedCourseStatus } = await import('./map/map-offline-status.mjs');
      if (await savedCourseStatus(slug) !== 'ready') return;
      const link = document.getElementById('bootSaved');
      link.href = mapUrl(slug, { hole: params.get('hal'), tee: params.get('tee'), preview: true }) + '&kopia=1';
      link.hidden = false;
    } catch { /* Reload and course setup work even if modules are unavailable. */ }
  }, { once: true });
  await Promise.all([import('./main.js'), import('./ui/detailed-hud.mjs').then(({ installDetailedHud }) => installDetailedHud())]);
}
