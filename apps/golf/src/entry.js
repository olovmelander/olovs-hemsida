/* Keep the bare course chooser off the 3D engine's critical path. Deep links and
   historical URLs still enter the player directly. */
import { legacyTarget } from './shell/router.js';

const legacy = legacyTarget(location.pathname, location.search);
if (legacy) {
  location.replace(legacy);
} else {
  const isBare = location.search === '' && /(?:\/|\/index\.html)$/.test(location.pathname);
  await import(isBare ? './hub.js' : './main.js');
}
