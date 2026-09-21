/* Keep the bare course chooser off the 3D engine's critical path. Deep links and
   historical URLs still enter the player directly. */
import { legacyTarget } from './shell/router.js';
import { coursePreview } from './course-previews.mjs';
import { supportedVisualSearch } from './engine/look-mode.mjs';

const supportedSearch = supportedVisualSearch(location.search);
if (supportedSearch !== location.search) {
  history.replaceState(history.state, '', location.pathname + supportedSearch + location.hash);
}

const legacy = legacyTarget(location.pathname, location.search);
if (legacy) {
  location.replace(legacy);
} else if (coursePreview(new URLSearchParams(location.search).get('bana'))) {
  await import('./course-preview.js');
} else if (location.search === '' && /(?:\/|\/index\.html)$/.test(location.pathname)) {
  /* Two separate import() call sites, never one with a ternary: the bundler
     attaches each call site's dependency preloads to the CALL, so a shared
     expression preloads the union -- the bare route was fetching all of
     three.js before the chooser ran. */
  await import('./hub.js');
} else {
  await import('./main.js');
}
