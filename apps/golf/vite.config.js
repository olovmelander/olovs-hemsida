/* Banvy's build.
   Two things live here: the PWA, and nothing else -- the app has no aliases, no
   polyfills and no special resolution, because three.js is a normal dependency
   and the engine is plain modules.

   WHY A SERVICE WORKER AT ALL. A course is a 400 KB pack plus a 1.4 MB engine,
   and the brief names Android and iOS before desktop. Installed, Banvy opens a
   course it has already seen with no network at all -- which is the difference
   between "a website about golf courses" and something you can open standing on
   the 1st tee with one bar of signal.

   THE CACHING RULES MIRROR public/_headers ON PURPOSE. The CDN and the service
   worker are two caches in front of the same files; if they disagree about which
   ones are immutable, the bug only appears for people who installed the app,
   which is the worst possible place to find it. Read the two together. */
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/* Cloudflare would serve this at a domain root; GitHub Pages serves it under the
   repository name. Vite rewrites the tags in index.html and every asset URL it
   processes, but it cannot touch three things, and all three are below: the web
   app manifest's own fields, the service worker's route patterns, and any URL
   the app builds at runtime (those read import.meta.env.BASE_URL instead). */
const BASE = process.env.BANVY_BASE || '/';

export default defineConfig({
  /* Where this build will be served from. Cloudflare would serve it at a domain
     root ('/'); GitHub Pages serves it under the repository name
     ('/olovs-hemsida/'). One config, both hosts -- and nothing in the app may
     assume either, which is why the runtime reads import.meta.env.BASE_URL
     instead of writing a leading slash. Vite guarantees that value ends in '/'. */
  base: BASE,

  plugins: [
    VitePWA({
      /* The whole view lives in the URL -- bana, hal, vy, ljus, tee, skylt, ren,
         q, gl -- so a reload restores exactly the view that was on screen. That
         is what makes autoUpdate safe here: the update costs a scene rebuild,
         not your place in the round. */
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      /* The tab icon is the SVG; these are the installed-app icons, drawn by
         tools/make-icons.py from the same three shapes so they cannot drift. */
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Banvy — svenska golfbanor i 3D',
        short_name: 'Banvy',
        description: 'Sex svenska golfbanor i 3D, mätta mot klubbarnas egna kort och byggda ur verklig terräng.',
        lang: 'sv',
        theme_color: '#0b1a13',
        background_color: '#0b1a13',
        display: 'standalone',
        orientation: 'any',        /* a course reads well in both; do not force one */
        /* NOT '/': on a subpath host that is someone else's site.
           An installed app opening the wrong page is the worst kind of
           bug, because it only appears once the app is installed. */
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${BASE}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        /* Precache the SHELL only: markup, engine, styles, fonts, icons. The
           packs are deliberately absent -- six of them is 2.4 MB, and nobody
           should pay for five courses they did not open. They arrive below, on
           demand, and then stay. */
        globPatterns: ['**/*.{js,css,html,svg}', 'icons/*.png', 'fonts/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,   /* three.tsl is ~1 MB */

        /* No path routes exist, so the only navigations are / and the six legacy
           page names; those must still open the app offline. Everything under
           /courses/ is data, never a navigation -- the denylist is what stops a
           missing pack being answered with the HTML shell, exactly as the absent
           /* rule in _redirects does on the host. */
        navigateFallback: 'index.html',
        /* not anchored with ^: under a subpath the pathname is
           /olovs-hemsida/courses/... and an anchored pattern silently
           never matches, which would quietly disable offline packs */
        navigateFallbackDenylist: [
          /\/courses\//,
          /* The seven standalone pages are REAL FILES on GitHub Pages -- pages.yml
             copies them beside the app, because that host has no rewrite rules --
             and they sit inside this worker's scope. Without this the navigation
             fallback answers them with the app shell, and a bookmarked link
             silently stops being the page that was bookmarked. MEASURED: before
             the worker installs, /veckefjarden3d.html?hal=3 serves the real page;
             after it installs, the same URL landed on /?bana=veckefjarden&hal=3
             carrying the app's bundle. The old gate could not see it, because the
             app redirects to the same hole and wears the same title.

             Matched with (\?|$) because workbox tests pathname AND SEARCH, so a
             bare $ would miss every shared link carrying the view grammar --
             exactly the links worth protecting. Only on a subpath: at a domain
             root these names are _redirects rewrites INTO the app, no file
             exists, and denying them would only cost the offline shell. */
          ...(BASE !== '/' ? [/\/[a-z]+3d\.html(\?|$)/, /\/veckefjardensgc\.html(\?|$)/] : []),
        ],

        runtimeCaching: [
          {
            /* The manifest is the one file that must be current: it says which
               pack bytes are correct. Network first, cache only as the offline
               fallback. Matches Cache-Control: no-cache in _headers. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('/courses/index.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'banvy-manifest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            /* Packs are content-addressed -- loadCourse puts the sha256 prefix in
               the query -- so a cached response can never be the wrong bytes for
               its URL, and cache-first is both safe and the whole point. This is
               the rule that makes a course open offline. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/courses\/[^/]+\/pack\.bin$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'banvy-packs',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            /* Posters are decoration and are NOT content-addressed, so they get
               the same treatment as in _headers: serve what we have, refresh
               behind. A re-render reaches people without a cache-busting trick. */
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/courses\/[^/]+\/hero-1\.webp$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'banvy-posters',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
        /* OpenStreetMap's tiles are deliberately NOT cached here. They are
           someone else's donated infrastructure and their usage policy is not
           ours to stretch by shipping a service worker that hoards them; the map
           needs a provider of its own before this is public (see map.js). */
      },
    }),
  ],
});
