/* Which stored keys are the player's own data, and which belong to one device.
   No imports: the backup (settings-store.mjs) reads these rules, and so does the
   page GitHub Pages serves since Banvy moved (tools/pages-moved-site.mjs), which
   carries a visitor's data to the main site. */

/* The player's keys. Account credentials, sync metadata and undo copies use
   banvy_ with an underscore, and stay out. */
export const OWN_KEY_SOURCE = '^banvy[-:]';

/* A device's own state: its identity, cached catalogue and receipts for files
   kept offline, the weather, a live round's owner lease and GPS fixes. */
export const DEVICE_ONLY_KEYS = Object.freeze(['banvy-device-id-v1', 'banvy-hub-catalogue-v1']);
export const OFFLINE_PREFIX = 'banvy-map-offline:';
export const DEVICE_ONLY_PREFIXES = Object.freeze([OFFLINE_PREFIX, 'banvy-weather:', 'banvy-live-owner-v1:', 'banvy-map-gps-v1:']);

const OWN_KEY = new RegExp(OWN_KEY_SOURCE);
export const isOwnKey = key => typeof key === 'string' && OWN_KEY.test(key);
export const isDeviceOnlyKey = key => DEVICE_ONLY_KEYS.includes(key) || DEVICE_ONLY_PREFIXES.some(prefix => key.startsWith(prefix));
